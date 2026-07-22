document.addEventListener('DOMContentLoaded', () => {
  // Status dos jogos
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

  // Auto-Reload controls
  const select = document.getElementById('reload-select');
  const countdown = document.getElementById('countdown');

  // Carregar config salva
  chrome.storage.local.get(['bridge_autoreload_min', 'bridge_reload_at'], (res) => {
    const savedMin = parseInt(res.bridge_autoreload_min || '0', 10);
    select.value = String(savedMin);
    
    updateCountdown(res.bridge_reload_at || 0);
  });

  // Salvar quando muda
  select.addEventListener('change', () => {
    const min = parseInt(select.value, 10);
    chrome.storage.local.set({ bridge_autoreload_min: min });
    
    if (min <= 0) {
      countdown.textContent = 'Desligado';
      countdown.className = 'countdown';
    }
  });

  // Countdown update
  function updateCountdown(reloadAt) {
    if (!reloadAt || reloadAt <= 0) {
      countdown.textContent = 'Desligado';
      countdown.className = 'countdown';
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((reloadAt - Date.now()) / 1000));
      if (remaining <= 0) {
        countdown.textContent = 'Recarregando...';
        countdown.className = 'countdown warning';
        return;
      }
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      countdown.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      countdown.className = remaining < 30 ? 'countdown warning' : 'countdown active';
    };

    tick();
    setInterval(tick, 1000);
  }

  // Escutar mudanças em tempo real
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.bridge_reload_at) {
      updateCountdown(changes.bridge_reload_at.newValue || 0);
    }
    if (changes.bridge_autoreload_min) {
      select.value = String(changes.bridge_autoreload_min.newValue || '0');
    }
  });
});
