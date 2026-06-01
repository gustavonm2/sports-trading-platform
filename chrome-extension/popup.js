/**
 * Bet365 Bridge — Popup Script
 * Exibe status e lista de jogos mapeados
 */

document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const matchCountEl = document.getElementById('matchCount');
  const lastScanEl = document.getElementById('lastScan');
  const scanCountEl = document.getElementById('scanCount');
  const matchListEl = document.getElementById('matchList');

  function updateUI() {
    chrome.storage.local.get(null, (allData) => {
      const status = allData['bet365_bridge_status'];
      const index = allData['bet365_bridge_index'];

      if (status && status.active && (Date.now() - status.lastUpdate) < 60000) {
        statusDot.className = 'status-dot active';
        statusText.textContent = 'Conectado';
        statusText.className = 'status-value green';
        matchCountEl.textContent = status.matchCount;
        scanCountEl.textContent = status.scanNumber;
      } else {
        statusDot.className = 'status-dot inactive';
        statusText.textContent = 'Aguardando Bet365';
        statusText.className = 'status-value yellow';
        matchCountEl.textContent = '0';
      }

      // Último scan
      if (index && index.lastScan) {
        const ago = Math.round((Date.now() - index.lastScan) / 1000);
        lastScanEl.textContent = ago < 60 ? `${ago}s atrás` : `${Math.round(ago / 60)}min atrás`;
      }

      // Lista de jogos
      if (index && index.matches && index.matches.length > 0) {
        matchListEl.innerHTML = index.matches.map(m => `
          <div class="match-item">
            <div class="teams">${m.home} vs ${m.away}</div>
            <div class="meta">${m.statsCount} estatísticas mapeadas</div>
          </div>
        `).join('');
      } else {
        // Verificar se há dados mesmo sem index
        const bridgeKeys = Object.keys(allData).filter(k => 
          k.startsWith('bet365_bridge_') && 
          k !== 'bet365_bridge_index' && 
          k !== 'bet365_bridge_status'
        );

        if (bridgeKeys.length > 0) {
          matchListEl.innerHTML = bridgeKeys.map(key => {
            const d = allData[key];
            return `
              <div class="match-item">
                <div class="teams">${d.homeTeam} vs ${d.awayTeam}</div>
                <div class="meta">${Object.keys(d.home || {}).length} stats</div>
              </div>
            `;
          }).join('');
        }
      }
    });
  }

  // Atualizar ao abrir
  updateUI();
  
  // Atualizar a cada 5s enquanto o popup estiver aberto
  setInterval(updateUI, 5000);
});
