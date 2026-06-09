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
  connected: boolean;
  isOperator: boolean;
  lastCloudData: number | null;
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
const BROADCAST_THROTTLE_MS = 3000;

// ─── Inicialização ───

export function initCloudSync(): () => void {
  if (channel) {
    console.log('[CloudSync] Canal já inicializado');
    return () => {};
  }

  console.log('[CloudSync] 🔌 Inicializando canal Realtime Broadcast...');

  channel = supabase.channel(CHANNEL_NAME, {
    config: {
      broadcast: { self: false },
    },
  });

  // Listener para dados da Bridge
  channel.on('broadcast', { event: 'bridge-update' }, (msg) => {
    const data = msg.payload;
    if (!data) return;

    _lastCloudData = Date.now();
    console.log('[CloudSync] 📡 Bridge recebida via cloud:', data.matchCount || 0, 'jogos');

    if (!_isOperator) {
      bridgeCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[CloudSync] Erro no callback bridge:', e); }
      });
    }
  });

  // Listener para dados do Scanner
  channel.on('broadcast', { event: 'scanner-update' }, (msg) => {
    const data = msg.payload;
    if (!data) return;

    _lastCloudData = Date.now();
    console.log('[CloudSync] 📡 Scanner recebida via cloud:', (data.matches || []).length, 'jogos');

    if (!_isOperator) {
      scannerCallbacks.forEach(cb => {
        try { cb(data.matches || [], data.scannerEnabled || false); } catch (e) { console.error('[CloudSync] Erro no callback scanner:', e); }
      });
    }
  });

  // Subscribe
  channel.subscribe((status, err) => {
    console.log('[CloudSync] Status do canal:', status, err || '');
    if (status === 'SUBSCRIBED') {
      _connected = true;
      console.log('[CloudSync] ✅ Conectado ao canal Realtime Broadcast!');
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      _connected = false;
      console.warn('[CloudSync] ❌ Canal fechado/erro:', status, err);
    } else if (status === 'TIMED_OUT') {
      _connected = false;
      console.warn('[CloudSync] ⏰ Timeout na conexão Realtime');
    }
  });

  return () => {
    cleanupCloudSync();
  };
}

export function cleanupCloudSync(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
    _connected = false;
    console.log('[CloudSync] 🔌 Canal desconectado');
  }
  bridgeCallbacks = [];
  scannerCallbacks = [];
}

// ─── Broadcasting (Operador → Nuvem) ───

export function broadcastBridgeData(payload: any): void {
  if (!channel || !_connected) {
    return;
  }

  const now = Date.now();
  if (now - _lastBridgeBroadcast < BROADCAST_THROTTLE_MS) return;
  _lastBridgeBroadcast = now;

  _isOperator = true;

  channel.send({
    type: 'broadcast',
    event: 'bridge-update',
    payload,
  }).then((status) => {
    if (status === 'ok') {
      console.log('[CloudSync] 📤 Bridge broadcast enviado com sucesso');
    } else {
      console.warn('[CloudSync] ⚠️ Bridge broadcast retornou:', status);
    }
  }).catch((err) => {
    console.warn('[CloudSync] ❌ Erro ao enviar bridge broadcast:', err);
  });
}

export function broadcastScannerData(matches: any[], scannerEnabled: boolean): void {
  if (!channel || !_connected) {
    return;
  }

  const now = Date.now();
  if (now - _lastScannerBroadcast < BROADCAST_THROTTLE_MS) return;
  _lastScannerBroadcast = now;

  _isOperator = true;

  channel.send({
    type: 'broadcast',
    event: 'scanner-update',
    payload: { matches, scannerEnabled },
  }).then((status) => {
    if (status === 'ok') {
      console.log('[CloudSync] 📤 Scanner broadcast enviado com sucesso');
    } else {
      console.warn('[CloudSync] ⚠️ Scanner broadcast retornou:', status);
    }
  }).catch((err) => {
    console.warn('[CloudSync] ❌ Erro ao enviar scanner broadcast:', err);
  });
}

// ─── Receiving ───

export function onCloudBridgeData(callback: BridgeCallback): () => void {
  bridgeCallbacks.push(callback);
  return () => {
    bridgeCallbacks = bridgeCallbacks.filter(cb => cb !== callback);
  };
}

export function onCloudScannerData(callback: ScannerCallback): () => void {
  scannerCallbacks.push(callback);
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
