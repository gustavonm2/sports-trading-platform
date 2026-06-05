/**
 * Bet365 Scanner — Content Script (bet365.com) v5
 *
 * APENAS LEITURA — escaneia jogos ao vivo na página In-Play.
 * NÃO tenta clicar em fixtures (confirmado que não funciona).
 *
 * A Bridge conecta automaticamente via fuzzy matching quando o
 * usuário abre o jogo na Bet365.
 */
(function () {
  'use strict';

  const SCAN_INTERVAL = 10000;
  let scannerEnabled = false;
  let blockedLeagues = new Set();

  const ESPORTS_PATTERNS = [
    /e-soccer/i, /esports?/i, /e-basketball/i, /e-hockey/i, /e-tennis/i,
    /fifa/i, /nba\s*2k/i, /counter.strike/i, /dota/i, /league of legends/i,
    /virtual/i, /cyber/i, /sim\s*racing/i, /e-cricket/i, /e-baseball/i,
    /e-futebol/i, /battle/i
  ];

  function loadSettings() {
    chrome.storage.local.get(['scanner_enabled', 'scanner_blocked_leagues'], (data) => {
      scannerEnabled = data.scanner_enabled || false;
      blockedLeagues = new Set(data.scanner_blocked_leagues || []);
    });
  }

  function isEsports(name) { return ESPORTS_PATTERNS.some(p => p.test(name)); }
  function isScoreResolved(h, a) { return Math.abs(h - a) >= 3; }

  function isInPlayPage() {
    return (
      !!document.querySelector('.wc-InPlayPageResponsive_PageViewMain') ||
      !!document.querySelector('[class*="InPlayOverview"]') ||
      (window.location.hash.includes('#/IP/') && !window.location.hash.match(/#\/IP\/EV/))
    );
  }

  // ─── Scan principal ─────────────────────────────────────────────
  function scanLiveMatches() {
    if (!scannerEnabled || !isInPlayPage()) return;

    const matches = [];
    const detectedLeagues = new Set();
    const competitions = document.querySelectorAll('.ovm-Competition');

    competitions.forEach((comp) => {
      const headerEl = comp.querySelector('[class*="CompetitionTitle"], [class*="Competition_Name"]');
      let leagueName = '';
      if (headerEl) {
        leagueName = (headerEl.innerText || headerEl.textContent || '').split('\n')[0].trim();
      } else {
        const compText = (comp.innerText || '').trim();
        const firstLine = compText.split('\n')[0].trim();
        if (firstLine && firstLine.length > 2 && !/^[0-9X]+$/.test(firstLine)) leagueName = firstLine;
      }
      if (!leagueName) return;
      detectedLeagues.add(leagueName);
      if (blockedLeagues.has(leagueName) || isEsports(leagueName)) return;

      comp.querySelectorAll('.ovm-Fixture').forEach((fixture, index) => {
        const teamNameEls = fixture.querySelectorAll('.ovm-FixtureDetailsTwoWay_TeamName');
        if (teamNameEls.length < 2) return;
        const homeTeam = (teamNameEls[0].textContent || '').trim();
        const awayTeam = (teamNameEls[1].textContent || '').trim();
        if (!homeTeam || !awayTeam) return;

        const scorePills = fixture.querySelectorAll('.ovm-ScorePill');
        const homeGoals = scorePills.length >= 1 ? parseInt(scorePills[0].textContent || '0', 10) : 0;
        const awayGoals = scorePills.length >= 2 ? parseInt(scorePills[1].textContent || '0', 10) : 0;
        if (isScoreResolved(homeGoals, awayGoals)) return;

        const timerEl = fixture.querySelector('.ovm-FixtureFooter_Timer, [class*="InPlayTimer"]');
        const timerText = timerEl ? (timerEl.textContent || '').trim() : '';
        let elapsed = 0, status = '1H';
        if (timerText === 'HT' || timerText === 'Intervalo') { status = 'HT'; elapsed = 45; }
        else if (timerText === 'FT' || timerText === 'Encerrado') { return; }
        else { const m = timerText.match(/(\d+)/); if (m) { elapsed = parseInt(m[1], 10); status = elapsed > 45 ? '2H' : '1H'; } }

        matches.push({
          matchKey: `${homeTeam}_${awayTeam}_${leagueName}`.toLowerCase().replace(/\s+/g, '_'),
          homeTeam, awayTeam, homeGoals, awayGoals, elapsed, status,
          timer: timerText, league: leagueName, fixtureIndex: index, scannedAt: Date.now(),
        });
      });
    });

    chrome.storage.local.set({
      bet365_scanner_live_matches: {
        timestamp: Date.now(), matchCount: matches.length, matches, detectedLeagues: [...detectedLeagues],
      },
    });

    try { chrome.runtime.sendMessage({ type: 'SCANNER_UPDATE', matchCount: matches.length }); } catch (e) {}
    console.log(`[Bet365 Scanner] 🎰 Scan: ${matches.length} jogos (${detectedLeagues.size} ligas)`);
  }

  // ─── Listeners ──────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCANNER_SETTINGS_CHANGED') { loadSettings(); sendResponse({ ok: true }); }
    if (msg.type === 'GET_SCANNER_STATUS') { sendResponse({ enabled: scannerEnabled, isInPlay: isInPlayPage() }); }
    return true;
  });

  // ─── Init ───────────────────────────────────────────────────────
  loadSettings();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.scanner_enabled) scannerEnabled = changes.scanner_enabled.newValue;
    if (changes.scanner_blocked_leagues) blockedLeagues = new Set(changes.scanner_blocked_leagues.newValue || []);
  });

  setInterval(scanLiveMatches, SCAN_INTERVAL);
  setTimeout(scanLiveMatches, 2000);

  console.log('[Bet365 Scanner] 🎰 Scanner v5 (read-only)');
})();
