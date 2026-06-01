/**
 * Bet365 Bridge — Content Script (Trading Platform)
 * 
 * Roda no domínio da plataforma (localhost / vercel).
 * Lê os dados do chrome.storage.local escritos pelo content-bet365.js
 * e os injeta na página via CustomEvent para o React capturar.
 */

(function () {
  'use strict';

  const READ_INTERVAL_MS = 8_000; // 8 segundos (mais rápido que o scan)
  const EXPIRY_MS = 120_000; // 2 minutos — dados mais velhos são descartados

  let lastDispatchedData = null;

  function readAndDispatch() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[Bet365 Bridge Platform] chrome.storage não disponível');
      return;
    }

    chrome.storage.local.get(null, (allData) => {
      if (chrome.runtime.lastError) {
        console.warn('[Bet365 Bridge Platform] Erro lendo storage:', chrome.runtime.lastError);
        return;
      }

      const now = Date.now();
      const bridgeMatches = [];

      // Filtrar apenas as chaves da bridge
      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('bet365_bridge_') || key === 'bet365_bridge_index') continue;
        
        // Verificar expiração
        if (value.timestamp && (now - value.timestamp) > EXPIRY_MS) {
          // Remover dados expirados
          chrome.storage.local.remove(key);
          continue;
        }

        bridgeMatches.push({
          storageKey: key,
          homeTeam: value.homeTeam || '',
          awayTeam: value.awayTeam || '',
          timestamp: value.timestamp || 0,
          home: value.home || {},
          away: value.away || {}
        });
      }

      // Ler o índice para metadata
      const index = allData['bet365_bridge_index'] || null;

      // Compor payload do evento
      const payload = {
        connected: bridgeMatches.length > 0,
        matchCount: bridgeMatches.length,
        lastScan: index ? index.lastScan : null,
        scanNumber: index ? index.scanNumber : 0,
        matches: bridgeMatches
      };

      // Só despachar se os dados mudaram
      const payloadJson = JSON.stringify(payload);
      if (payloadJson !== lastDispatchedData) {
        lastDispatchedData = payloadJson;

        // Disparar CustomEvent que o React vai capturar
        window.dispatchEvent(new CustomEvent('bet365-bridge-data', {
          detail: payload
        }));

        if (bridgeMatches.length > 0) {
          console.log(`[Bet365 Bridge Platform] 📡 ${bridgeMatches.length} jogo(s) recebidos da Bet365`);
        }
      }
    });
  }

  // Iniciar
  console.log('[Bet365 Bridge Platform] 🟢 Content script da plataforma carregado');
  
  // Primeiro read após 3s
  setTimeout(readAndDispatch, 3000);
  
  // Reads subsequentes
  setInterval(readAndDispatch, READ_INTERVAL_MS);

})();
