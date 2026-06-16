// ═══════════════════════════════════════════════════════════════════════════════
// Bet365 Robot — Popup Logic v2
// ═══════════════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'agora';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateUI(data) {
  // ── Toggle bar ──
  const toggleBar = $('toggleBar');
  const btnToggle = $('btnToggle');
  const dot = $('statusDot');
  const statusText = $('statusText');

  if (data.robotEnabled) {
    toggleBar.className = 'toggle-bar active';
    dot.className = 'status-dot active';
    btnToggle.textContent = '⏸ Pausar';
    btnToggle.className = 'btn-toggle active';

    if (data.circuitBreaker) {
      statusText.textContent = '🔴 Circuit Breaker';
      statusText.style.color = '#ef4444';
    } else if (data.workerActive) {
      statusText.textContent = '🔧 Abrindo jogo...';
      statusText.style.color = '#f59e0b';
    } else {
      statusText.textContent = '🟢 Ativo';
      statusText.style.color = '#10b981';
    }
  } else {
    toggleBar.className = 'toggle-bar';
    dot.className = 'status-dot';
    btnToggle.textContent = '▶ Ativar';
    btnToggle.className = 'btn-toggle';
    statusText.textContent = 'Desativado';
    statusText.style.color = '#64748b';
  }

  // ── Stats ──
  const monitoring = data.matches?.monitoring || [];
  const queue = data.matches?.queue || [];
  const ended = data.matches?.ended || [];

  $('monitoringCount').textContent = monitoring.length;
  $('tabsCount').textContent = `${data.openTabs}/${data.maxTabs}`;
  $('queueCount').textContent = data.queueLength || 0;
  $('endedCount').textContent = data.totalClosed || 0;

  // ── Monitoring list ──
  $('monBadge').textContent = monitoring.length;
  const monList = $('monitoringList');

  if (monitoring.length === 0) {
    monList.innerHTML = '<div class="empty-state">Nenhum jogo aberto</div>';
  } else {
    monList.innerHTML = monitoring.map(m => `
      <div class="game-row">
        <div class="game-teams" title="${escapeHtml(m.home)} x ${escapeHtml(m.away)}">
          🟢 ${escapeHtml(m.home)} x ${escapeHtml(m.away)}
        </div>
        <div class="game-score">${escapeHtml(m.score || '?')}</div>
        <div class="game-time">${escapeHtml(m.elapsed || '-')}</div>
      </div>
    `).join('');
  }

  // ── Queue list ──
  $('queueBadge').textContent = queue.length;
  const qList = $('queueList');

  if (queue.length === 0) {
    qList.innerHTML = '<div class="empty-state">Fila vazia</div>';
  } else {
    qList.innerHTML = queue.slice(0, 10).map((m, i) => `
      <div class="game-row queue-row">
        <div class="game-teams">
          ${i + 1}. ${escapeHtml(m.home)} x ${escapeHtml(m.away)}
        </div>
        <div class="game-time" style="color: #64748b">${escapeHtml(m.league || '')}</div>
      </div>
    `).join('') + (queue.length > 10 ? `<div class="empty-state">+${queue.length - 10} mais...</div>` : '');
  }

  // ── Logs ──
  const logsList = $('logsList');
  const logs = data.logs || [];

  if (logs.length === 0) {
    logsList.innerHTML = '<div class="empty-state">Sem atividade</div>';
  } else {
    logsList.innerHTML = logs.slice(0, 10).map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const icon = l.level === 'ERROR' ? '❌' : l.level === 'WARN' ? '⚠️' : '📋';
      return `<div class="log-row"><span class="log-time">${time}</span><span class="log-msg">${icon} ${escapeHtml(l.message)}</span></div>`;
    }).join('');
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      $('statusText').textContent = '❌ Erro';
      return;
    }
    updateUI(response);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();
  setInterval(refresh, 3000);

  $('btnToggle').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_ROBOT' }, () => refresh());
  });

  $('btnClear').addEventListener('click', () => {
    if (confirm('Limpar tudo e fechar todas as abas?')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, () => refresh());
    }
  });

  $('btnRefresh').addEventListener('click', refresh);
});
