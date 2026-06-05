/**
 * Bet365 Scanner — Platform Bridge v5
 *
 * Apenas lê matches do storage e despacha para a plataforma.
 * Sem lógica de abertura de abas (confirmado que não funciona programaticamente).
 */
(function () {
  'use strict';

  function readAndDispatch() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(['bet365_scanner_live_matches', 'scanner_enabled'], (data) => {
      const scannerData = data.bet365_scanner_live_matches;
      if (!scannerData || Date.now() - scannerData.timestamp > 30000) return;
      window.postMessage({
        type: 'BET365_SCANNER_MATCHES',
        payload: { ...scannerData, scannerEnabled: data.scanner_enabled || false },
      }, '*');
    });
  }

  // Toggle scanner
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'BET365_SCANNER_TOGGLE') {
      chrome.storage.local.set({ scanner_enabled: e.data.enabled });
    }
  });

  setInterval(readAndDispatch, 5000);
  setTimeout(readAndDispatch, 1000);

  console.log('[Bet365 Scanner Platform] 📡 Bridge v5 (read-only)');
})();
