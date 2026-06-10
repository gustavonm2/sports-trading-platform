/**
 * cloudSync.ts — Sincronização em Tempo Real via Supabase
 * 
 * ABORDAGEM: Tabela `live_sync` no Supabase (persistência) + Realtime CDC (atualizações em tempo real)
 * 
 * FLUXO:
 * 1. Operador (PC com extensões) → UPSERT dados na tabela `live_sync`
 * 2. Receptores (outros dispositivos) → Lêem da tabela ao conectar + ouvem mudanças via Realtime
 * 
 * Isso resolve o problema do Broadcast efêmero: se o receptor abrir depois,
 * ele pega os dados mais recentes da tabela.
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Tipos ───

export interface CloudSyncStatus {
  connected: boolean;
  isOperator: boolean;
  lastCloudData: number | null;
  activeDevices: number;
}

type BridgeCallback = (payload: any) => void;
type ScannerCallback = (matches: any[], scannerEnabled: boolean) => void;

// ─── Estado interno ───

let realtimeChannel: RealtimeChannel | null = null;
let bridgeCallbacks: BridgeCallback[] = [];
let scannerCallbacks: ScannerCallback[] = [];
let _isOperator = false;
let _connected = false;
let _lastCloudData: number | null = null;
let _activeDevices = 1;
let _lastBridgeWrite = 0;
let _lastScannerWrite = 0;
let _initialLoadDone = false;

const WRITE_THROTTLE_MS = 3000; // Não gravar mais que 1x a cada 3s
const OPERATOR_ID = `op_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`;

// ─── Inicialização ───

export function initCloudSync(): () => void {
  if (realtimeChannel) {
    console.log('[CloudSync] Canal já inicializado');
    return () => {};
  }

  console.log('[CloudSync] 🔌 Inicializando Cloud Sync (Tabela + Realtime CDC)...');

  // 1) Carregar dados iniciais da tabela (para quem abre depois do operador)
  loadInitialData();

  // 2) Ouvir mudanças em tempo real na tabela live_sync
  realtimeChannel = supabase
    .channel('live-sync-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_sync', filter: 'id=eq.main' },
      (payload) => {
        const newData = payload.new as any;
        if (!newData) return;

        // Se foi eu que gravei, ignorar (evitar loop)
        if (newData.operator_id === OPERATOR_ID) return;

        _lastCloudData = Date.now();
        console.log('[CloudSync] 📡 Dados recebidos via Realtime CDC');

        // Distribuir para callbacks
        if (newData.bridge_data && !_isOperator) {
          const bridgePayload = newData.bridge_data;
          if (bridgePayload && Object.keys(bridgePayload).length > 0) {
            console.log('[CloudSync] 📡 Bridge recebida:', bridgePayload.matchCount || 0, 'jogos');
            bridgeCallbacks.forEach(cb => {
              try { cb(bridgePayload); } catch (e) { console.error('[CloudSync] Erro callback bridge:', e); }
            });
          }
        }

        if (newData.scanner_data && !_isOperator) {
          const scannerPayload = newData.scanner_data;
          if (scannerPayload) {
            console.log('[CloudSync] 📡 Scanner recebida:', (scannerPayload.matches || []).length, 'jogos');
            scannerCallbacks.forEach(cb => {
              try { cb(scannerPayload.matches || [], scannerPayload.scannerEnabled || false); } catch (e) { console.error('[CloudSync] Erro callback scanner:', e); }
            });
          }
        }
      }
    )
    .subscribe((status, err) => {
      console.log('[CloudSync] Canal Realtime status:', status, err || '');
      if (status === 'SUBSCRIBED') {
        _connected = true;
        console.log('[CloudSync] ✅ Conectado ao Realtime CDC!');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        _connected = false;
        console.warn('[CloudSync] ❌ Canal erro:', status, err);
      } else if (status === 'TIMED_OUT') {
        _connected = false;
        console.warn('[CloudSync] ⏰ Timeout');
      }
    });

  return () => {
    cleanupCloudSync();
  };
}

// ─── Carregar dados iniciais (para receptores que abrem depois) ───

async function loadInitialData(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('live_sync')
      .select('*')
      .eq('id', 'main')
      .single();

    if (error) {
      console.warn('[CloudSync] ⚠️ Erro ao carregar dados iniciais:', error.message);
      // Criar registro se não existe
      if (error.code === 'PGRST116') {
        await supabase.from('live_sync').insert({ id: 'main' });
        console.log('[CloudSync] 📝 Registro inicial criado');
      }
      return;
    }

    if (!data) return;

    // Se os dados foram atualizados nos últimos 5 minutos, considerar válidos
    const updatedAt = new Date(data.updated_at).getTime();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    if (updatedAt > fiveMinAgo) {
      console.log('[CloudSync] 📦 Dados iniciais carregados (de', Math.round((Date.now() - updatedAt) / 1000), 's atrás)');

      // Bridge data
      if (data.bridge_data && Object.keys(data.bridge_data).length > 0) {
        _lastCloudData = Date.now();
        bridgeCallbacks.forEach(cb => {
          try { cb(data.bridge_data); } catch (e) { console.error(e); }
        });
      }

      // Scanner data
      if (data.scanner_data && data.scanner_data.matches?.length > 0) {
        _lastCloudData = Date.now();
        scannerCallbacks.forEach(cb => {
          try { cb(data.scanner_data.matches || [], data.scanner_data.scannerEnabled || false); } catch (e) { console.error(e); }
        });
      }
    } else {
      console.log('[CloudSync] 📦 Dados iniciais muito antigos, ignorando');
    }

    _initialLoadDone = true;
  } catch (e) {
    console.error('[CloudSync] ❌ Erro loadInitialData:', e);
  }
}

export function cleanupCloudSync(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
    _connected = false;
    console.log('[CloudSync] 🔌 Canal desconectado');
  }
  bridgeCallbacks = [];
  scannerCallbacks = [];
}

// ─── Broadcasting (Operador → Banco) ───

export function broadcastBridgeData(payload: any): void {
  const now = Date.now();
  if (now - _lastBridgeWrite < WRITE_THROTTLE_MS) return;
  _lastBridgeWrite = now;

  _isOperator = true;

  // UPSERT na tabela — grava os dados para que receptores possam ler
  supabase
    .from('live_sync')
    .upsert({
      id: 'main',
      bridge_data: payload,
      operator_id: OPERATOR_ID,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) {
        console.warn('[CloudSync] ⚠️ Erro ao gravar bridge:', error.message);
      } else {
        console.log('[CloudSync] 📤 Bridge gravada no banco');
      }
    });
}

export function broadcastScannerData(matches: any[], scannerEnabled: boolean): void {
  const now = Date.now();
  if (now - _lastScannerWrite < WRITE_THROTTLE_MS) return;
  _lastScannerWrite = now;

  _isOperator = true;

  supabase
    .from('live_sync')
    .upsert({
      id: 'main',
      scanner_data: { matches, scannerEnabled },
      operator_id: OPERATOR_ID,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) {
        console.warn('[CloudSync] ⚠️ Erro ao gravar scanner:', error.message);
      } else {
        console.log('[CloudSync] 📤 Scanner gravada no banco');
      }
    });
}

// ─── Receiving ───

export function onCloudBridgeData(callback: BridgeCallback): () => void {
  bridgeCallbacks.push(callback);
  // Se já carregou dados iniciais e é receptor, re-carregar
  if (_initialLoadDone && !_isOperator) {
    loadInitialData();
  }
  return () => {
    bridgeCallbacks = bridgeCallbacks.filter(cb => cb !== callback);
  };
}

export function onCloudScannerData(callback: ScannerCallback): () => void {
  scannerCallbacks.push(callback);
  if (_initialLoadDone && !_isOperator) {
    loadInitialData();
  }
  return () => {
    scannerCallbacks = scannerCallbacks.filter(cb => cb !== callback);
  };
}

// ─── Status ───

export function markAsOperator(): void {
  _isOperator = true;
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return {
    connected: _connected,
    isOperator: _isOperator,
    lastCloudData: _lastCloudData,
    activeDevices: _activeDevices,
  };
}
