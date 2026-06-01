/**
 * Bet365 Bridge — Background Service Worker
 * 
 * Gerencia o ciclo de vida da extensão:
 * - Atualiza o badge do ícone com status
 * - Limpa dados expirados periodicamente
 */

// Badge de status
function updateBadge(matchCount) {
  if (matchCount > 0) {
    chrome.action.setBadgeText({ text: String(matchCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Verde
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Listener para mensagens do content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BET365_SCAN_UPDATE') {
    updateBadge(message.matchCount);
    
    // Salvar último status para o popup
    chrome.storage.local.set({
      'bet365_bridge_status': {
        active: true,
        matchCount: message.matchCount,
        scanNumber: message.scanNumber,
        lastUpdate: Date.now()
      }
    });
  }
  
  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get('bet365_bridge_status', (data) => {
      sendResponse(data['bet365_bridge_status'] || { active: false, matchCount: 0 });
    });
    return true; // async response
  }
});

// Limpar dados expirados a cada 2 minutos
const CLEANUP_INTERVAL = 120_000;
const DATA_EXPIRY = 300_000; // 5 minutos

setInterval(() => {
  chrome.storage.local.get(null, (allData) => {
    const now = Date.now();
    const keysToRemove = [];

    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith('bet365_bridge_') && key !== 'bet365_bridge_index' && key !== 'bet365_bridge_status') {
        if (value.timestamp && (now - value.timestamp) > DATA_EXPIRY) {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => {
        console.log(`[Bet365 Bridge BG] 🧹 Limpeza: ${keysToRemove.length} jogos expirados removidos`);
      });
    }
  });
}, CLEANUP_INTERVAL);

// Ao instalar a extensão
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Bet365 Bridge] ✅ Extensão instalada com sucesso');
  updateBadge(0);
});
