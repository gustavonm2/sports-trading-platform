/**
 * BestCorner Bridge — Content Script (Trading Platform)
 * 
 * Lê os dados do BestCorner do chrome.storage e envia para o React via window.postMessage.
 */

(function () {
  'use strict';

  const READ_INTERVAL_MS = 5_000; // 5 segundos
  const EXPIRY_MS = 300_000; // 5 minutos

  let lastDispatchedData = null;

  function readAndDispatch() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[BestCorner Bridge Platform] chrome.storage não disponível');
      return;
    }

    chrome.storage.local.get(null, (allData) => {
      if (chrome.runtime.lastError) {
        console.warn('[BestCorner Bridge Platform] Erro lendo storage:', chrome.runtime.lastError);
        return;
      }

      const now = Date.now();
      const bridgeMatches = [];

      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('bestcorner_bridge_') || key === 'bestcorner_bridge_index' || key === 'bestcorner_bridge_status') continue;

        if (value.timestamp && (now - value.timestamp) > EXPIRY_MS) {
          chrome.storage.local.remove(key);
          continue;
        }

        bridgeMatches.push({
          storageKey: key,
          homeTeam: value.homeTeam || '',
          awayTeam: value.awayTeam || '',
          matchUrl: value.matchUrl || '',
          leagueName: value.leagueName || '',
          timestamp: value.timestamp || 0,
          home: value.home || {},
          away: value.away || {},
          elapsed: value.elapsed ?? null,
          period: value.period ?? null,
          goalsHome: value.goalsHome ?? null,
          goalsAway: value.goalsAway ?? null,
        });
      }

      const payload = {
        connected: bridgeMatches.length > 0,
        matchCount: bridgeMatches.length,
        matches: bridgeMatches
      };

      const payloadJson = JSON.stringify(payload);
      const changed = payloadJson !== lastDispatchedData;
      lastDispatchedData = payloadJson;

      window.postMessage({
        type: 'BESTCORNER_BRIDGE_DATA',
        payload: payload
      }, '*');

      if (changed && bridgeMatches.length > 0) {
        console.log(`[BestCorner Bridge Platform] 📡 ${bridgeMatches.length} jogo(s) enviados via postMessage`);
      }
    });
  }

  console.log('[BestCorner Bridge Platform] 🟢 Carregado');
  setTimeout(readAndDispatch, 2000);
  setInterval(readAndDispatch, READ_INTERVAL_MS);

})();
