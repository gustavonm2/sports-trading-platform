/**
 * cloudSync.ts — Sincronização em Tempo Real via Supabase
 * 
 * Usa tabela `live_sync` no Supabase:
 * - Operador (PC com extensões): UPSERT dados na tabela a cada 3s
 * - Receptores (outros dispositivos): Polling da tabela a cada 5s + Realtime CDC como bônus
 * 
 * O polling garante que funciona mesmo se o Realtime CDC não estiver habilitado.
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
type ScannerCallback = (matches: any[], scannerEnabled: boolean, manualFixtures: any[], bestCornerData: any, platformSnapshots: any) => void;

// ─── Estado interno ───

let realtimeChannel: RealtimeChannel | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let bridgeCallbacks: BridgeCallback[] = [];
let scannerCallbacks: ScannerCallback[] = [];
let _isOperator = false;
let _connected = false;
let _lastCloudData: number | null = null;
let _activeDevices = 1;
let _lastBridgeWrite = 0;
let _lastScannerWrite = 0;
let _lastKnownUpdatedAt = '';

const WRITE_THROTTLE_MS = 3000;
const POLL_INTERVAL_MS = 5000; // Poll a cada 5s para receptores
const OPERATOR_ID = `op_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`;

// ─── Inicialização ───

export function initCloudSync(): () => void {
  if (pollInterval) {
    console.log('[CloudSync] Já inicializado');
    return () => {};
  }

  console.log('[CloudSync] 🔌 Inicializando Cloud Sync...');

  // 1) Carregar dados iniciais
  loadDataFromTable();

  // 2) Polling periódico (funciona sempre, independente de CDC)
  pollInterval = setInterval(() => {
    if (!_isOperator) {
      loadDataFromTable();
    }
  }, POLL_INTERVAL_MS);

  // 3) Tentar Realtime CDC como bônus (atualização mais rápida)
  try {
    realtimeChannel = supabase
      .channel('live-sync-cdc')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_sync', filter: 'id=eq.main' },
        (payload) => {
          const newData = payload.new as any;
          if (!newData || newData.operator_id === OPERATOR_ID) return;
          if (_isOperator) return;

          console.log('[CloudSync] ⚡ Realtime CDC recebido');
          processCloudData(newData);
        }
      )
      .subscribe((status, err) => {
        console.log('[CloudSync] Realtime status:', status, err || '');
        if (status === 'SUBSCRIBED') {
          _connected = true;
          console.log('[CloudSync] ✅ Realtime CDC conectado (bônus)');
        }
      });
  } catch (e) {
    console.warn('[CloudSync] Realtime CDC não disponível, usando apenas polling', e);
  }

  _connected = true; // Polling sempre funciona

  return () => {
    cleanupCloudSync();
  };
}

// ─── Processar dados recebidos da tabela ───

function processCloudData(data: any): void {
  if (!data) return;
  
  // Verificar se é update novo
  const updatedAt = data.updated_at || '';
  if (updatedAt === _lastKnownUpdatedAt) return; // Já processado
  _lastKnownUpdatedAt = updatedAt;

  // Verificar se dados são recentes (últimos 5 minutos)
  const updatedTime = new Date(updatedAt).getTime();
  if (Date.now() - updatedTime > 5 * 60 * 1000) return; // Muito antigo

  _lastCloudData = Date.now();

  // Bridge data
  if (data.bridge_data && Object.keys(data.bridge_data).length > 0) {
    const bridgePayload = data.bridge_data;
    console.log('[CloudSync] 📡 Bridge:', bridgePayload.matchCount || 0, 'jogos');
    bridgeCallbacks.forEach(cb => {
      try { cb(bridgePayload); } catch (e) { console.error('[CloudSync] Erro bridge:', e); }
    });
  }

  // Scanner data
  if (data.scanner_data) {
    const scannerPayload = data.scanner_data;
    const matches = scannerPayload.matches || [];
    if (matches.length > 0 || scannerPayload.scannerEnabled || scannerPayload.manualFixtures || scannerPayload.bestCornerData) {
      console.log('[CloudSync] 📡 Scanner/MobileData:', matches.length, 'jogos');
      scannerCallbacks.forEach(cb => {
        try { 
          cb(
            matches, 
            scannerPayload.scannerEnabled || false, 
            scannerPayload.manualFixtures || [], 
            scannerPayload.bestCornerData || {},
            scannerPayload.platformSnapshots || {}
          ); 
        } catch (e) { console.error('[CloudSync] Erro scanner:', e); }
      });
    }
  }
}

// ─── Carregar dados da tabela (polling + carga inicial) ───

async function loadDataFromTable(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('live_sync')
      .select('*')
      .eq('id', 'main')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Tabela existe mas sem registro — criar
        await supabase.from('live_sync').insert({ id: 'main' });
        console.log('[CloudSync] 📝 Registro criado');
      } else {
        console.warn('[CloudSync] ⚠️ Erro ao ler tabela:', error.message);
      }
      return;
    }

    if (data) {
      processCloudData(data);
    }
  } catch (e) {
    console.error('[CloudSync] ❌ Erro polling:', e);
  }
}

export function cleanupCloudSync(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  _connected = false;
  bridgeCallbacks = [];
  scannerCallbacks = [];
  console.log('[CloudSync] 🔌 Desconectado');
}

// ─── Broadcasting (Operador → Banco) ───

export function broadcastBridgeData(payload: any): void {
  const now = Date.now();
  if (now - _lastBridgeWrite < WRITE_THROTTLE_MS) return;
  _lastBridgeWrite = now;
  _isOperator = true;

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
        console.warn('[CloudSync] ⚠️ Erro bridge write:', error.message);
      } else {
        console.log('[CloudSync] 📤 Bridge gravada');
      }
    });
}

export function broadcastScannerData(matches: any[], scannerEnabled: boolean, manualFixtures: any[] = [], bestCornerData: any = {}, platformSnapshots: any = {}): void {
  const now = Date.now();
  if (now - _lastScannerWrite < WRITE_THROTTLE_MS) return;
  _lastScannerWrite = now;
  _isOperator = true;

  supabase
    .from('live_sync')
    .upsert({
      id: 'main',
      scanner_data: { matches, scannerEnabled, manualFixtures, bestCornerData, platformSnapshots },
      operator_id: OPERATOR_ID,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) {
        console.warn('[CloudSync] ⚠️ Erro scanner write:', error.message);
      } else {
        console.log('[CloudSync] 📤 Scanner gravada com manualFixtures e bestCornerData');
      }
    });
}

// ─── Receiving ───

export function onCloudBridgeData(callback: BridgeCallback): () => void {
  bridgeCallbacks.push(callback);
  // Re-carregar dados para o novo callback
  if (!_isOperator) loadDataFromTable();
  return () => {
    bridgeCallbacks = bridgeCallbacks.filter(cb => cb !== callback);
  };
}

export function onCloudScannerData(callback: ScannerCallback): () => void {
  scannerCallbacks.push(callback);
  if (!_isOperator) loadDataFromTable();
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
