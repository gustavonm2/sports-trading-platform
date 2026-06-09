/**
 * cloudSync.ts — Sincronização em Tempo Real via Supabase Realtime Broadcast
 * 
 * Permite que o PC operador (com extensões Bet365) transmita dados de Bridge/Scanner
 * para todos os outros dispositivos conectados à plataforma.
 * 
 * Usa Broadcast (pub/sub efêmero) — sem gravar no banco, sem tabelas extras.
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Tipos ───

export interface CloudSyncStatus {
  /** Se este dispositivo está conectado ao canal */
  connected: boolean;
  /** Se este dispositivo é operador (tem extensões locais enviando dados) */
  isOperator: boolean;
  /** Timestamp do último dado recebido via cloud */
  lastCloudData: number | null;
  /** Quantidade de dispositivos conectados (via Presence) */
  activeDevices: number;
}

type BridgeCallback = (payload: any) => void;
type ScannerCallback = (matches: any[], scannerEnabled: boolean) => void;

// ─── Estado interno ───

let channel: RealtimeChannel | null = null;
let bridgeCallbacks: BridgeCallback[] = [];
let scannerCallbacks: ScannerCallback[] = [];
let _isOperator = false;
let _connected = false;
let _lastCloudData: number | null = null;
let _activeDevices = 1;
let _lastBridgeBroadcast = 0;
let _lastScannerBroadcast = 0;

const CHANNEL_NAME = 'trading-live-sync';
const BROADCAST_THROTTLE_MS = 3000; // Throttle broadcasts to every 3s to avoid rate limits

// ─── Inicialização ───

/**
 * Inicializa o canal Supabase Realtime.
 * Deve ser chamado uma vez ao montar o Radar.
 */
export function initCloudSync(): () => void {
  if (channel) {
    console.log('[CloudSync] Canal já inicializado');
    return () => {};
  }

  console.log('[CloudSync] 🔌 Inicializando canal:', CHANNEL_NAME);

  channel = supabase.channel(CHANNEL_NAME, {
    config: {
      broadcast: { self: false }, // Não receber próprias mensagens
    },
  });

  // Listener para dados da Bridge vindos de outro operador
  channel.on('broadcast', { event: 'bridge-update' }, (payload: any) => {
    const data = payload.payload;
    if (!data) return;

    _lastCloudData = Date.now();

    // Se este dispositivo NÃO é operador, aplica os dados
    if (!_isOperator) {
      bridgeCallbacks.forEach(cb => cb(data));
    }
  });

  // Listener para dados do Scanner vindos de outro operador
  channel.on('broadcast', { event: 'scanner-update' }, (payload: any) => {
    const data = payload.payload;
    if (!data) return;

    _lastCloudData = Date.now();

    // Se este dispositivo NÃO é operador, aplica os dados
    if (!_isOperator) {
      scannerCallbacks.forEach(cb => cb(data.matches || [], data.scannerEnabled || false));
    }
  });

  // Presence para contar dispositivos conectados
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel?.presenceState() || {};
    _activeDevices = Object.keys(state).length;
  });

  // Subscribe ao canal
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      _connected = true;
      console.log('[CloudSync] ✅ Conectado ao canal Realtime');

      // Track presence
      await channel?.track({
        device_id: crypto.randomUUID(),
        joined_at: Date.now(),
        is_operator: _isOperator,
      });
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      _connected = false;
      console.warn('[CloudSync] ❌ Desconectado do canal:', status);
    }
  });

  // Cleanup function
  return () => {
    cleanupCloudSync();
  };
}

/**
 * Limpa o canal e remove listeners.
 */
export function cleanupCloudSync(): void {
  if (channel) {
    channel.unsubscribe();
    supabase.removeChannel(channel);
    channel = null;
    _connected = false;
    console.log('[CloudSync] 🔌 Canal desconectado');
  }
  bridgeCallbacks = [];
  scannerCallbacks = [];
}

// ─── Broadcasting (Operador → Nuvem) ───

/**
 * Transmite dados da Bridge para todos os dispositivos conectados.
 * Chamado pelo operador quando recebe dados locais da extensão.
 * Throttled para evitar rate limits do Supabase.
 */
export function broadcastBridgeData(payload: any): void {
  if (!channel || !_connected) return;

  const now = Date.now();
  if (now - _lastBridgeBroadcast < BROADCAST_THROTTLE_MS) return;
  _lastBridgeBroadcast = now;

  _isOperator = true;

  channel.send({
    type: 'broadcast',
    event: 'bridge-update',
    payload,
  }).catch(err => {
    console.warn('[CloudSync] Erro ao transmitir bridge:', err);
  });
}

/**
 * Transmite dados do Scanner para todos os dispositivos conectados.
 * Chamado pelo operador quando recebe dados locais da extensão.
 */
export function broadcastScannerData(matches: any[], scannerEnabled: boolean): void {
  if (!channel || !_connected) return;

  const now = Date.now();
  if (now - _lastScannerBroadcast < BROADCAST_THROTTLE_MS) return;
  _lastScannerBroadcast = now;

  _isOperator = true;

  channel.send({
    type: 'broadcast',
    event: 'scanner-update',
    payload: { matches, scannerEnabled },
  }).catch(err => {
    console.warn('[CloudSync] Erro ao transmitir scanner:', err);
  });
}

// ─── Receiving (Nuvem → Receptor) ───

/**
 * Registra callback para receber dados da Bridge via cloud.
 * Retorna função de cleanup.
 */
export function onCloudBridgeData(callback: BridgeCallback): () => void {
  bridgeCallbacks.push(callback);
  return () => {
    bridgeCallbacks = bridgeCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Registra callback para receber dados do Scanner via cloud.
 * Retorna função de cleanup.
 */
export function onCloudScannerData(callback: ScannerCallback): () => void {
  scannerCallbacks.push(callback);
  return () => {
    scannerCallbacks = scannerCallbacks.filter(cb => cb !== callback);
  };
}

// ─── Status ───

/**
 * Marca este dispositivo como operador (tem extensões locais).
 * Chamado quando postMessage da extensão é detectado.
 */
export function markAsOperator(): void {
  _isOperator = true;
}

/**
 * Retorna o status atual do cloud sync.
 */
export function getCloudSyncStatus(): CloudSyncStatus {
  return {
    connected: _connected,
    isOperator: _isOperator,
    lastCloudData: _lastCloudData,
    activeDevices: _activeDevices,
  };
}
