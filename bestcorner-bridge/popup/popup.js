document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(null, (data) => {
    let count = 0;
    for (const key in data) {
      if (key.startsWith('bestcorner_bridge_')) count++;
    }
    
    const statusText = document.getElementById('status-text');
    if (count > 0) {
      statusText.textContent = `Monitorando ${count} jogos em tempo real.`;
    } else {
      statusText.textContent = `Ativo. Nenhum jogo detectado ainda.`;
    }
  });
});
