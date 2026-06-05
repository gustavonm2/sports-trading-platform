/**
 * Bet365 Scanner — Popup Script v3 (simplificado)
 *
 * Gerencia a interface do popup:
 * - Toggle de Scanner ON/OFF
 * - Estatísticas de jogos/ligas detectados
 * - Lista de ligas com opção de bloquear/desbloquear
 * - Detecção automática de e-sports
 */
document.addEventListener('DOMContentLoaded', () => {
  const statusBanner = document.getElementById('statusBanner');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const toggleScanner = document.getElementById('toggleScanner');
  const matchCountEl = document.getElementById('matchCount');
  const leagueCountEl = document.getElementById('leagueCount');
  const lastScanEl = document.getElementById('lastScan');
  const leagueListEl = document.getElementById('leagueList');
  const btnClear = document.getElementById('btnClear');

  const ESPORTS_PATTERNS = [
    /e-soccer/i, /esports?/i, /e-basketball/i, /e-hockey/i, /e-tennis/i,
    /fifa/i, /nba\s*2k/i, /counter.strike/i, /dota/i, /league of legends/i,
    /virtual/i, /cyber/i, /sim\s*racing/i, /e-cricket/i, /e-baseball/i,
    /e-futebol/i, /battle/i
  ];

  function isEsports(name) {
    return ESPORTS_PATTERNS.some((p) => p.test(name));
  }

  function updateUI() {
    chrome.storage.local.get(
      ['scanner_enabled', 'scanner_blocked_leagues', 'bet365_scanner_live_matches'],
      (data) => {
        const enabled = data.scanner_enabled || false;
        const blocked = new Set(data.scanner_blocked_leagues || []);
        const scanData = data.bet365_scanner_live_matches;

        toggleScanner.checked = enabled;

        // Status banner
        if (enabled && scanData && Date.now() - scanData.timestamp < 30000) {
          statusBanner.className = 'status-banner active';
          statusDot.className = 'status-dot active';
          statusText.textContent = `Escaneando — ${scanData.matchCount} jogos`;
        } else if (enabled) {
          statusBanner.className = 'status-banner active';
          statusDot.className = 'status-dot active';
          statusText.textContent = 'Scanner ligado — aguardando In-Play';
        } else {
          statusBanner.className = 'status-banner inactive';
          statusDot.className = 'status-dot inactive';
          statusText.textContent = 'Scanner desligado';
        }

        // Stats
        if (scanData) {
          matchCountEl.textContent = scanData.matchCount || 0;
          leagueCountEl.textContent = scanData.detectedLeagues?.length || 0;
          if (scanData.timestamp) {
            const agoSec = Math.round((Date.now() - scanData.timestamp) / 1000);
            lastScanEl.textContent = agoSec < 60 ? `${agoSec}s atrás` : `${Math.round(agoSec / 60)}min atrás`;
          }
        } else {
          matchCountEl.textContent = '0';
          leagueCountEl.textContent = '0';
          lastScanEl.textContent = '—';
        }

        // Liga list
        const leagues = scanData?.detectedLeagues || [];
        if (leagues.length === 0) {
          leagueListEl.innerHTML = '<div class="empty-leagues">Aguardando scan...</div>';
          return;
        }

        const matchesByLeague = {};
        if (scanData?.matches) {
          for (const m of scanData.matches) {
            matchesByLeague[m.league] = (matchesByLeague[m.league] || 0) + 1;
          }
        }

        const sorted = [...leagues].sort((a, b) => {
          const aB = blocked.has(a) || isEsports(a);
          const bB = blocked.has(b) || isEsports(b);
          if (aB && !bB) return 1;
          if (!aB && bB) return -1;
          return a.localeCompare(b);
        });

        leagueListEl.innerHTML = sorted.map((league) => {
          const esports = isEsports(league);
          const isBlocked = blocked.has(league);
          const checked = !esports && !isBlocked ? 'checked' : '';
          const disabled = esports ? 'disabled' : '';
          const count = matchesByLeague[league] || 0;

          let tag = '';
          if (esports) tag = '<span class="league-tag auto">AUTO</span>';
          else if (isBlocked) tag = '<span class="league-tag blocked">BLOQ</span>';

          const countTag = count > 0 ? `<span class="league-tag count">${count}</span>` : '';

          return `
            <label class="league-item" data-league="${league.replace(/"/g, '&quot;')}">
              <input type="checkbox" ${checked} ${disabled}
                     data-league-name="${league.replace(/"/g, '&quot;')}"
                     ${esports ? 'title="E-sports — bloqueado automaticamente"' : ''}>
              <span class="league-name">${league}</span>
              ${countTag}
              ${tag}
            </label>
          `;
        }).join('');

        leagueListEl.querySelectorAll('input[data-league-name]').forEach((cb) => {
          cb.addEventListener('change', () => {
            const leagueName = cb.dataset.leagueName;
            if (cb.checked) blocked.delete(leagueName);
            else blocked.add(leagueName);
            chrome.storage.local.set({ scanner_blocked_leagues: [...blocked] });
          });
        });
      }
    );
  }

  toggleScanner.addEventListener('change', () => {
    chrome.storage.local.set({ scanner_enabled: toggleScanner.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SCANNER_SETTINGS_CHANGED' }, () => {
          if (chrome.runtime.lastError) { /* noop */ }
        });
      }
    });
    setTimeout(updateUI, 100);
  });

  btnClear.addEventListener('click', () => {
    chrome.storage.local.set({ scanner_blocked_leagues: [] }, () => updateUI());
  });

  updateUI();
  setInterval(updateUI, 5000);
});
