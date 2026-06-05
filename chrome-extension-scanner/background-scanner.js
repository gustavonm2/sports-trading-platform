/**
 * Bet365 Scanner — Background Service Worker v5
 * Apenas badge update. Sem tab management.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCANNER_UPDATE') {
    chrome.action.setBadgeText({ text: msg.matchCount > 0 ? String(msg.matchCount) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Bet365 Scanner] ✅ Scanner v5 instalado (read-only)');
  chrome.action.setBadgeText({ text: '' });
});
