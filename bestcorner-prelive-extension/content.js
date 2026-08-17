/**
 * BestCorner Pré-Live Extension — Content Script v4
 * Usa seletores CSS exatos baseados na estrutura real do HTML do BCS.
 * SEÇÃO 1: TOP 10/TOP 3 — dentro de .section-header "TOP 10"/"TOP 3"
 * SEÇÃO 2: Listing detalhado — após .filter-header, separador "VS", 4+ stats
 */
(function () {
  const SUPABASE_URL = 'https://kpldcqujhpcihpdlzpeh.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwbGRjcXVqaHBjaWhwZGx6cGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTIyMTAsImV4cCI6MjA5NTcyODIxMH0.zfpSeKGm-RF0bvbj-H-yVm4it9qZNzBOX7KjrjieGfs';

  let scannedData = [];

  // ═══════════════════════════════════════════════════════════════════
  // PAINEL FLUTUANTE
  // ═══════════════════════════════════════════════════════════════════
  function injectPanel() {
    if (document.getElementById('tradepro-prelive-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tradepro-prelive-panel';
    panel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: rgba(15, 23, 42, 0.94); backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,0.15); border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 340px; overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
    `;

    const todayStr = new Date().toISOString().split('T')[0];
    panel.innerHTML = `
      <div id="tradepro-panel-header" style="padding:12px 16px; background:rgba(30,41,59,0.8); border-bottom:1px solid rgba(255,255,255,0.12); display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none;">
        <span style="font-weight:700; font-size:0.9rem; display:flex; align-items:center; gap:8px;">📊 TradePro Pré-Live v4</span>
        <span id="tradepro-panel-toggle" style="font-size:0.75rem; color:#94a3b8; font-weight:500;">[Minimizar]</span>
      </div>
      <div id="tradepro-panel-body" style="padding:16px; display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="display:block; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:#94a3b8; margin-bottom:5px; font-weight:600;">Data de Referência</label>
          <input type="date" id="tradepro-sync-date" value="${todayStr}" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(30,41,59,0.8); color:#fff; font-size:0.85rem; box-sizing:border-box; outline:none;" />
        </div>
        <button id="tradepro-btn-scan" style="width:100%; padding:10px; border-radius:6px; border:none; background:#3b82f6; color:#fff; font-weight:700; cursor:pointer; font-size:0.8rem; box-shadow:0 4px 12px rgba(59,130,246,0.25);">
          🔍 Escanear Dados na Página
        </button>
        <div id="tradepro-scan-status" style="font-size:0.78rem; color:#cbd5e1; background:rgba(30,41,59,0.4); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); min-height:48px; display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.4;">
          Abra qualquer página de estatísticas do BCS e clique em Escanear.
        </div>
        <button id="tradepro-btn-sync" disabled style="width:100%; padding:10px; border-radius:6px; border:none; background:#10b981; color:#fff; font-weight:700; cursor:not-allowed; opacity:0.4; font-size:0.8rem; box-shadow:0 4px 12px rgba(16,185,129,0.15);">
          🟢 Sincronizar com TradePro
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    const header = document.getElementById('tradepro-panel-header');
    const body = document.getElementById('tradepro-panel-body');
    const toggle = document.getElementById('tradepro-panel-toggle');
    let minimized = false;

    header.addEventListener('click', () => {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : 'flex';
      panel.style.width = minimized ? '200px' : '340px';
      toggle.textContent = minimized ? '[Maximizar]' : '[Minimizar]';
    });

    document.getElementById('tradepro-btn-scan').addEventListener('click', handleScan);
    document.getElementById('tradepro-btn-sync').addEventListener('click', handleSync);
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════
  function cleanTeamName(name) {
    if (!name) return '';
    return name
      .replace(/[\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z0-9\s\u00C0-\u024F\-\.\']/g, '')
      .trim();
  }

  function parseNum(str) {
    if (!str) return null;
    const m = str.replace('%', '').trim().replace(',', '.').match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function isNumericish(str) {
    return /^[\d.,]+%?$/.test(str.trim());
  }

  function isValidTeamName(text) {
    if (!text) return false;
    const clean = text.trim();
    if (clean.length < 2 || clean.length > 60) return false;
    if (/^[\d.,]+%?$/.test(clean)) return false;
    if (clean.includes('|') || clean.includes(':')) return false;
    const lower = clean.toLowerCase();
    const banned = [
      'vs', 'x', 'limite', 'casa', 'visitante', 'media',
      'classificacao', 'detalhes', 'voltar', 'ordenar', 'buscar',
      'destaque', 'top 10', 'melhores', 'tecnica',
      'carregar', 'ver mais', 'best corner stats',
      'filtros', 'partidas', 'destaques', 'ht', 'ft',
      'lim ht', 'lim ft', 'casa ht', 'casa ft', 'vis ht', 'vis ft'
    ];
    if (banned.some(b => lower === b)) return false;
    return true;
  }

  function resolveFullDate(dateStr, fallbackDate) {
    if (!dateStr) return fallbackDate;
    const parts = dateStr.trim().split('/');
    if (parts.length === 2) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = new Date().getFullYear();
      return `${year}-${month}-${day}`;
    }
    return fallbackDate;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SEÇÃO 1: PARSER DOS DESTAQUES TOP 10 / TOP 3
  // Padrão: ⚽ [Home] x [Away] 🏆 [Liga] | 🕐 [DD/MM] [HH:MM] [NN%]
  // ═══════════════════════════════════════════════════════════════════
  function parseTop10Matches() {
    const results = [];
    const seen = new Set();

    const sectionHeaders = document.querySelectorAll('.section-header');
    console.log(`[TradePro v4] Encontradas ${sectionHeaders.length} section-headers.`);

    sectionHeaders.forEach(header => {
      const headerText = header.textContent.trim();
      if (!/TOP\s*\d+/i.test(headerText)) return;

      const isHT = /limite\s*ht/i.test(headerText);
      const isFT = /limite\s*ft/i.test(headerText);
      const period = isHT ? 'HT' : (isFT ? 'FT' : 'HT');

      console.log(`[TradePro v4] Seção TOP: "${headerText}" → ${period}`);

      // Subir até achar container com os jogos (procura ⚽)
      let container = header.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!container) break;
        if ((container.textContent || '').includes('\u26BD') && container.textContent.length > 200) break;
        container = container.parentElement;
      }
      if (!container) return;

      // Regex para o padrão exato do BCS
      const regex = /\u26BD\s*(.+?)\s+x\s+(.+?)\s+\uD83C\uDFC6\s*(.+?)\s*\|\s*\uD83D\uDD50\s*(\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+(\d+)%/g;
      let m;
      while ((m = regex.exec(container.textContent)) !== null) {
        const homeTeam = cleanTeamName(m[1]);
        const awayTeam = cleanTeamName(m[2]);
        const league = m[3].trim();
        const timeStr = m[5];
        const rate = parseInt(m[6]);

        if (!isValidTeamName(homeTeam) || !isValidTeamName(awayTeam)) continue;

        const key = `${period}|${homeTeam}|${awayTeam}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          home_team: homeTeam,
          away_team: awayTeam,
          league: league || null,
          date_str: m[4],
          match_time: timeStr,
          ht_avg: null, ht_limit_rate: null, home_ht_limit_rate: null,
          away_ht_limit_rate: null, ht_limit_avg: null,
          ft_avg: null, ft_limit_rate: null, home_ft_limit_rate: null,
          away_ft_limit_rate: null, ft_limit_avg: null,
          is_top_ht: period === 'HT',
          is_top_ft: period === 'FT',
          top_ht_rate: period === 'HT' ? rate : null,
          top_ft_rate: period === 'FT' ? rate : null,
          _source: 'top10'
        });

        console.log(`[TradePro v4] 🔥 TOP ${period}: ${homeTeam} x ${awayTeam} → ${rate}%`);
      }
    });

    console.log(`[TradePro v4] Total TOP: ${results.length} jogos.`);
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SEÇÃO 2: PARSER DA LISTAGEM DETALHADA (médias e taxas)
  // Exclui o container de Destaques, só processa "VS" standalone com 4+ stats
  // ═══════════════════════════════════════════════════════════════════
  function parseDetailedMatches(topMatchKeys) {
    const results = [];

    const url = window.location.href.toLowerCase();
    let defaultPeriod = 'HT';

    if (url.includes('/ft') || url.includes('ft=1') || url.includes('type=ft') || url.includes('period=ft') || url.includes('limite-ft')) {
      defaultPeriod = 'FT';
    } else {
      const activeEl = document.querySelector('.nav-link.active, .tab.active, button.active, .btn-primary, [aria-selected="true"], .active');
      const activeText = activeEl ? (activeEl.textContent || '').toUpperCase() : '';
      if (activeText.includes('FT') || activeText.includes('FULL TIME')) {
        defaultPeriod = 'FT';
      }
    }

    // Coletar folhas EXCLUINDO o container de Destaques
    const leaves = [];
    function collectLeaves(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        const tag = node.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') return;
        if (node.id === 'tradepro-prelive-panel') return;

        // EXCLUIR apenas o container específico de Destaques
        if (node.classList && node.classList.contains('card-demo')) {
          const firstH4 = node.querySelector('h4');
          if (firstH4 && firstH4.textContent && firstH4.textContent.includes('Partidas Destaques')) return;
        }

        for (let i = 0; i < node.children.length; i++) {
          collectLeaves(node.children[i]);
        }
      } else if (node.nodeType === 3) {
        const txt = (node.textContent || '').trim();
        if (txt.length > 0) leaves.push(txt);
      }
    }
    collectLeaves(document.body);

    console.log(`[TradePro v4] Listing: ${leaves.length} folhas (sem Destaques). Período: ${defaultPeriod}`);

    // Encontrar separadores standalone: VS, X, ×
    const separators = [];
    leaves.forEach((txt, i) => {
      const upper = txt.trim().toUpperCase();
      if (upper === 'VS' || upper === 'X' || upper === '×') separators.push(i);
    });

    console.log(`[TradePro v4] Listing: ${separators.length} separadores (VS/X/×).`);

    separators.forEach((si, idx) => {
      try {
        let homeTeam = '';
        for (let i = si - 1; i >= Math.max(si - 4, 0); i--) {
          const candidate = cleanTeamName(leaves[i]);
          if (isValidTeamName(candidate)) {
            homeTeam = candidate;
            break;
          }
        }

        let awayTeam = '';
        for (let i = si + 1; i <= Math.min(si + 4, leaves.length - 1); i++) {
          const candidate = cleanTeamName(leaves[i]);
          if (isValidTeamName(candidate)) {
            awayTeam = candidate;
            break;
          }
        }

        if (!homeTeam || !awayTeam) return;

        // Pular se já foi capturado pelo TOP parser
        const matchKey = `${homeTeam}|||${awayTeam}`.toLowerCase();
        if (topMatchKeys && topMatchKeys.has(matchKey)) {
          console.log(`[TradePro v4] ⏭ Listing: ${homeTeam} vs ${awayTeam} — já no TOP, pulando.`);
          return;
        }

        // Liga: procurar para trás
        let league = '';
        for (let i = si - 2; i >= Math.max(si - 6, 0); i--) {
          const t = leaves[i].trim();
          const tLow = t.toLowerCase();
          if (tLow === 'classificação' || tLow === 'classificacao') continue;
          if (!isNumericish(t) && t.length > 3 && t.length < 80) {
            league = t;
            break;
          }
        }

        // Data e Horário
        let timeStr = '';
        let dateStr = '';
        for (let i = si - 5; i <= si + 2 && i < leaves.length; i++) {
          if (i < 0) continue;
          const dt = leaves[i].match(/(\d{2}\/\d{2})/);
          if (dt && !dateStr) { dateStr = dt[1]; }
          const tm = leaves[i].match(/(\d{2}:\d{2})/);
          if (tm && !timeStr) { timeStr = tm[1]; }
        }

        // Limite: próximo separador ou +15
        const nextSep = separators[idx + 1];
        const boundary = nextSep ? nextSep : Math.min(si + 15, leaves.length);

        // Stats numéricos após away team
        const stats = [];
        for (let i = si + 2; i < boundary; i++) {
          const t = leaves[i].trim();
          if (isNumericish(t)) {
            stats.push(t);
            if (stats.length >= 7) break;
          } else if (stats.length > 0 && isValidTeamName(t)) {
            break;
          }
        }

        // Incluir se tiver pelo menos 1 stat numérico
        if (stats.length < 1) {
          console.log(`[TradePro v4] ⚠ Listing: ${homeTeam} vs ${awayTeam} — 0 stats, ignorando.`);
          return;
        }

        const match = {
          home_team: homeTeam,
          away_team: awayTeam,
          league: league || null,
          date_str: dateStr || null,
          match_time: timeStr || null,
          ht_avg: null, ht_limit_rate: null, home_ht_limit_rate: null,
          away_ht_limit_rate: null, ht_limit_avg: null,
          ft_avg: null, ft_limit_rate: null, home_ft_limit_rate: null,
          away_ft_limit_rate: null, ft_limit_avg: null,
          is_top_ht: false, is_top_ft: false,
          top_ht_rate: null, top_ft_rate: null,
          _source: 'detailed'
        };

        const avg = parseNum(stats[0]);
        const limitRate = parseNum(stats[1]);
        const homeRate = parseNum(stats[2]);
        const awayRate = stats[3] ? parseNum(stats[3]) : null;
        const limitAvg = stats[4] ? parseNum(stats[4]) : null;

        if (defaultPeriod === 'HT') {
          match.ht_avg = avg;
          match.ht_limit_rate = limitRate;
          match.home_ht_limit_rate = homeRate;
          match.away_ht_limit_rate = awayRate;
          match.ht_limit_avg = limitAvg;
        } else {
          match.ft_avg = avg;
          match.ft_limit_rate = limitRate;
          match.home_ft_limit_rate = homeRate;
          match.away_ft_limit_rate = awayRate;
          match.ft_limit_avg = limitAvg;
        }

        results.push(match);
        console.log(`[TradePro v4] 📊 ${homeTeam} vs ${awayTeam} [${defaultPeriod}] avg=${avg} rate=${limitRate}%`);
      } catch (err) {
        console.error(`[TradePro v4] Erro VS #${idx}:`, err);
      }
    });

    console.log(`[TradePro v4] Total detalhado: ${results.length} jogos.`);
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PARSER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════
  function scanPage() {
    console.log('[TradePro v4] Iniciando escaneamento...');
    const topMatches = parseTop10Matches();

    // Criar set de chaves dos TOP para evitar duplicatas no listing
    const topMatchKeys = new Set();
    topMatches.forEach(m => {
      topMatchKeys.add(`${m.home_team}|||${m.away_team}`.toLowerCase());
    });

    const detailedMatches = parseDetailedMatches(topMatchKeys);
    const all = [...topMatches, ...detailedMatches];
    console.log(`[TradePro v4] Total bruto: ${all.length} (TOP: ${topMatches.length}, Det: ${detailedMatches.length})`);
    return all;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  function handleScan() {
    const statusEl = document.getElementById('tradepro-scan-status');
    const syncBtn = document.getElementById('tradepro-btn-sync');

    scannedData = [];

    try {
      const rawResults = scanPage();

      // Mesclar duplicatas
      const combinedMap = new Map();
      rawResults.forEach(m => {
        const key = `${m.home_team}|||${m.away_team}`.toLowerCase();
        if (combinedMap.has(key)) {
          const ex = combinedMap.get(key);
          const mg = (nv, ov) => (nv !== null && nv !== undefined) ? nv : ov;
          combinedMap.set(key, {
            ...ex,
            league: m.league || ex.league,
            match_time: m.match_time || ex.match_time,
            date_str: m.date_str || ex.date_str,
            ht_avg: mg(m.ht_avg, ex.ht_avg),
            ht_limit_rate: mg(m.ht_limit_rate, ex.ht_limit_rate),
            home_ht_limit_rate: mg(m.home_ht_limit_rate, ex.home_ht_limit_rate),
            away_ht_limit_rate: mg(m.away_ht_limit_rate, ex.away_ht_limit_rate),
            ht_limit_avg: mg(m.ht_limit_avg, ex.ht_limit_avg),
            ft_avg: mg(m.ft_avg, ex.ft_avg),
            ft_limit_rate: mg(m.ft_limit_rate, ex.ft_limit_rate),
            home_ft_limit_rate: mg(m.home_ft_limit_rate, ex.home_ft_limit_rate),
            away_ft_limit_rate: mg(m.away_ft_limit_rate, ex.away_ft_limit_rate),
            ft_limit_avg: mg(m.ft_limit_avg, ex.ft_limit_avg),
            is_top_ht: m.is_top_ht || ex.is_top_ht,
            is_top_ft: m.is_top_ft || ex.is_top_ft,
            top_ht_rate: mg(m.top_ht_rate, ex.top_ht_rate),
            top_ft_rate: mg(m.top_ft_rate, ex.top_ft_rate),
            _source: m._source || ex._source
          });
        } else {
          combinedMap.set(key, { ...m });
        }
      });

      scannedData = Array.from(combinedMap.values());
      const topCount = scannedData.filter(r => r.is_top_ht || r.is_top_ft).length;
      const detCount = scannedData.filter(r => r.ht_avg !== null || r.ft_avg !== null).length;
      
      // Auto-detectar data principal dos jogos escaneados para atualizar o input
      const firstWithDate = scannedData.find(r => r.date_str);
      if (firstWithDate) {
        const autoDetectedDate = resolveFullDate(firstWithDate.date_str, document.getElementById('tradepro-sync-date')?.value);
        const dateInput = document.getElementById('tradepro-sync-date');
        if (dateInput && autoDetectedDate) {
          dateInput.value = autoDetectedDate;
        }
      }

      scannedData.forEach(m => delete m._source);

      console.log(`[TradePro v4] Final: ${scannedData.length} jogos únicos.`, scannedData);

      if (scannedData.length > 0) {
        statusEl.innerHTML = `🟢 <b>Sucesso!</b> <b>${scannedData.length}</b> jogo(s).<br><span style="font-size:0.72rem; color:#94a3b8;">🔥 TOP: ${topCount} | 📊 Detalhado: ${detCount}</span><br><span style="font-size:0.72rem; color:#10b981; font-weight:700;">Pronto para sincronizar!</span>`;
        syncBtn.disabled = false;
        syncBtn.style.opacity = '1';
        syncBtn.style.cursor = 'pointer';
      } else {
        statusEl.innerHTML = '❌ Nenhum jogo detectado.<br><span style="font-size:0.7rem;color:#94a3b8;">Verifique console (F12).</span>';
        statusEl.style.color = '#ef4444';
      }
    } catch (e) {
      console.error('[TradePro v4] Erro:', e);
      statusEl.textContent = '❌ Erro interno. Veja console.';
    }
  }

  async function handleSync() {
    const statusEl = document.getElementById('tradepro-scan-status');
    const syncBtn = document.getElementById('tradepro-btn-sync');
    const targetDate = document.getElementById('tradepro-sync-date').value;

    if (!targetDate) { statusEl.textContent = '❌ Selecione uma data!'; return; }
    if (scannedData.length === 0) return;

    syncBtn.disabled = true;
    syncBtn.style.opacity = '0.4';
    syncBtn.textContent = '⏳ Sincronizando...';

    try {
      const getUrl = `${SUPABASE_URL}/rest/v1/bestcorner_prelive_stats?date=eq.${targetDate}&select=*`;
      const fetchRes = await fetch(getUrl, {
        method: 'GET',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });

      if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);

      const existingRows = await fetchRes.json();
      const existingMap = new Map();
      existingRows.forEach(row => {
        existingMap.set(`${row.home_team}|||${row.away_team}`.toLowerCase(), row);
      });

      const mg = (nv, ov) => (nv !== null && nv !== undefined) ? nv : ((ov !== null && ov !== undefined) ? ov : null);

      const mergedList = scannedData.map(newItem => {
        const key = `${newItem.home_team}|||${newItem.away_team}`.toLowerCase();
        const old = existingMap.get(key) || {};
        const itemDate = resolveFullDate(newItem.date_str, targetDate);
        return {
          date: itemDate,
          home_team: newItem.home_team,
          away_team: newItem.away_team,
          league: newItem.league || old.league || null,
          match_time: newItem.match_time || old.match_time || null,
          ht_avg: mg(newItem.ht_avg, old.ht_avg),
          ht_limit_rate: mg(newItem.ht_limit_rate, old.ht_limit_rate),
          home_ht_limit_rate: mg(newItem.home_ht_limit_rate, old.home_ht_limit_rate),
          away_ht_limit_rate: mg(newItem.away_ht_limit_rate, old.away_ht_limit_rate),
          ht_limit_avg: mg(newItem.ht_limit_avg, old.ht_limit_avg),
          ft_avg: mg(newItem.ft_avg, old.ft_avg),
          ft_limit_rate: mg(newItem.ft_limit_rate, old.ft_limit_rate),
          home_ft_limit_rate: mg(newItem.home_ft_limit_rate, old.home_ft_limit_rate),
          away_ft_limit_rate: mg(newItem.away_ft_limit_rate, old.away_ft_limit_rate),
          ft_limit_avg: mg(newItem.ft_limit_avg, old.ft_limit_avg),
          is_top_ht: newItem.is_top_ht || old.is_top_ht || false,
          is_top_ft: newItem.is_top_ft || old.is_top_ft || false,
          top_ht_rate: mg(newItem.top_ht_rate, old.top_ht_rate),
          top_ft_rate: mg(newItem.top_ft_rate, old.top_ft_rate)
        };
      });

      const upsertUrl = `${SUPABASE_URL}/rest/v1/bestcorner_prelive_stats?on_conflict=date,home_team,away_team`;
      const upsertRes = await fetch(upsertUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(mergedList)
      });

      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        throw new Error(`HTTP ${upsertRes.status} — ${errText}`);
      }

      statusEl.innerHTML = `✅ <b>Sincronizado!</b><br><b>${mergedList.length}</b> jogos → <b>${targetDate}</b>.`;
      statusEl.style.color = '#10b981';
    } catch (e) {
      console.error('[TradePro v4] Erro sync:', e);
      statusEl.innerHTML = `❌ ${e.message || e}`;
      statusEl.style.color = '#ef4444';
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
    } finally {
      syncBtn.textContent = '🟢 Sincronizar com TradePro';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPanel);
  } else {
    injectPanel();
  }
})();
