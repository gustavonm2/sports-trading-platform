/**
 * Bet365 Bridge — Content Script (Trading Platform)
 * 
 * v1.2 — Corrigido: usa window.postMessage em vez de CustomEvent
 * 
 * Chrome Content Scripts rodam num "mundo isolado". O CustomEvent.detail
 * NÃO cruza essa barreira. window.postMessage serializa os dados e 
 * os entrega ao JavaScript da página (React).
 */

(function () {
  'use strict';

  const READ_INTERVAL_MS = 5_000; // 5 segundos
  const EXPIRY_MS = 120_000; // 2 minutos

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

      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('bet365_bridge_') || key === 'bet365_bridge_index' || key === 'bet365_bridge_status') continue;

        if (value.timestamp && (now - value.timestamp) > EXPIRY_MS) {
          chrome.storage.local.remove(key);
          continue;
        }

        bridgeMatches.push({
          storageKey: key,
          homeTeam: value.homeTeam || '',
          awayTeam: value.awayTeam || '',
          matchUrl: value.matchUrl || '',
          timestamp: value.timestamp || 0,
          home: value.home || {},
          away: value.away || {},
          // ⏱️ Tempo e placar da bridge (zero delay)
          elapsed: value.elapsed ?? null,
          period: value.period ?? null,
          goalsHome: value.goalsHome ?? null,
          goalsAway: value.goalsAway ?? null,
        });
      }

      const index = allData['bet365_bridge_index'] || null;

      const payload = {
        connected: bridgeMatches.length > 0,
        matchCount: bridgeMatches.length,
        lastScan: index ? index.lastScan : null,
        scanNumber: index ? index.scanNumber : 0,
        matches: bridgeMatches
      };

      // Sempre despachar (React precisa receber atualizações contínuas)
      const payloadJson = JSON.stringify(payload);
      const changed = payloadJson !== lastDispatchedData;
      lastDispatchedData = payloadJson;

      // ✅ USAR postMessage — cruza a barreira do mundo isolado do content script
      window.postMessage({
        type: 'BET365_BRIDGE_DATA',
        payload: payload
      }, '*');

      if (changed && bridgeMatches.length > 0) {
        console.log(`[Bet365 Bridge Platform] 📡 ${bridgeMatches.length} jogo(s) enviados via postMessage`);
        bridgeMatches.forEach(m => {
          console.log(`  → ${m.homeTeam} vs ${m.awayTeam} (${Object.keys(m.home).length} stats home, ${Object.keys(m.away).length} stats away)`);
        });
      }
    });
  }

  console.log('[Bet365 Bridge Platform] 🟢 v1.2 carregado — usando postMessage');
  setTimeout(readAndDispatch, 2000);
  setInterval(readAndDispatch, READ_INTERVAL_MS);

})();
