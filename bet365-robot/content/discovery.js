// ═══════════════════════════════════════════════════════════════════════════════
// Bet365 Robot — Discovery + Worker Content Script (Fase 2)
// ═══════════════════════════════════════════════════════════════════════════════
// Dois modos:
//   1. PASSIVE: Lê lista de jogos e envia ao background (Fase 1)
//   2. WORKER:  Navega bet365 → Ao-Vivo → Futebol → lê lista → clica jogo
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const SCAN_INTERVAL_MS = 15_000;
  const INITIAL_DELAY_MS = 3_000;
  const TAG = '[Robot]';

  let scanCount = 0;
  let scanTimer = null;
  let isWorker = false;
  let workerPhase = 'INIT'; // INIT → NAVIGATE_LIVE → NAVIGATE_FOOTBALL → READ_LIST → CLICK_GAME → DONE

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECÇÃO DE PÁGINA
  // ═══════════════════════════════════════════════════════════════════════════

  function isLivePage() {
    const hash = window.location.hash || '';
    if (hash.includes('/IP')) return true;
    if (hash.includes('/InPlay')) return true;
    const liveIndicators = document.querySelectorAll(
      '[class*="InPlay"], [class*="ovm-"]'
    );
    return liveIndicators.length > 5;
  }

  function isHomePage() {
    const hash = window.location.hash || '';
    return hash.includes('/HO') || hash === '' || hash === '#/' || hash === '#';
  }

  function isGamePage() {
    // Está numa página de detalhe de jogo (não a lista)
    const hash = window.location.hash || '';
    // Quando está dentro de um jogo, o URL costuma ter /IP/ com sub-paths
    // E a página mostra campo de jogo, stats, etc.
    const hasStats = document.querySelector(
      '[class*="ml1-"], [class*="ipe-EventViewDetail"], [class*="ScoreBoard"]'
    );
    return hasStats !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  function normalize(text) {
    return (text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .toLowerCase();
  }

  function generateEventId(home, away, league) {
    const h = normalize(home).replace(/\s+/g, '');
    const a = normalize(away).replace(/\s+/g, '');
    const l = normalize(league).replace(/\s+/g, '').substring(0, 20);
    return `${h}_${a}_${l}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLICK SIMULADO — Botão esquerdo do mouse
  // ═══════════════════════════════════════════════════════════════════════════

  function simulateRealClick(element) {
    if (!element) return false;

    // Scroll para o elemento ficar visível
    element.scrollIntoView({ behavior: 'instant', block: 'center' });

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const baseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY,
    };

    // Sequência realista: pointer → mouse → click
    element.dispatchEvent(new PointerEvent('pointerdown', { ...baseOpts, pointerId: 1 }));
    element.dispatchEvent(new MouseEvent('mousedown', baseOpts));

    // Delay humano entre press e release
    setTimeout(() => {
      element.dispatchEvent(new PointerEvent('pointerup', { ...baseOpts, pointerId: 1 }));
      element.dispatchEvent(new MouseEvent('mouseup', baseOpts));
      element.dispatchEvent(new MouseEvent('click', baseOpts));
    }, 50 + Math.random() * 80);

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVEGAÇÃO DO WORKER
  // ═══════════════════════════════════════════════════════════════════════════

  function workerNavigate() {
    console.log(`${TAG} 🔧 Worker fase: ${workerPhase}, URL: ${location.hash}`);

    switch (workerPhase) {

      case 'INIT': {
        // Esperar a página carregar minimamente
        console.log(`${TAG} ⏳ Aguardando página carregar...`);
        waitForCondition(
          () => document.body && document.body.children.length > 0,
          15_000,
          () => {
            if (isLivePage()) {
              console.log(`${TAG} ✅ Já na página ao-vivo!`);
              workerPhase = 'CHECK_FOOTBALL';
              setTimeout(workerNavigate, 2500);
            } else {
              workerPhase = 'NAVIGATE_LIVE';
              setTimeout(workerNavigate, 3000);
            }
          },
          () => {
            console.log(`${TAG} ⚠️ Página demorou. Tentando navegar direto...`);
            workerPhase = 'NAVIGATE_LIVE';
            setTimeout(workerNavigate, 1000);
          }
        );
        break;
      }

      case 'NAVIGATE_LIVE': {
        // Navegar direto para a página de futebol ao-vivo via hash
        // #/IP/B1 = In-Play / Football (B1 = soccer)
        console.log(`${TAG} 🚀 Navegando direto para #/IP/B1 (Ao-Vivo Futebol)...`);
        
        window.location.hash = '#/IP/B1';
        
        workerPhase = 'WAIT_LIVE';
        waitForCondition(
          () => {
            // Verificar se a página de ao-vivo carregou (fixtures aparecem)
            return document.querySelectorAll('[class*="ovm-Fixture"], [class*="ovm-"]').length > 3;
          },
          20_000,
          () => {
            console.log(`${TAG} ✅ Página ao-vivo carregou!`);
            workerPhase = 'CHECK_FOOTBALL';
            setTimeout(workerNavigate, 3000);
          },
          () => {
            // Fallback: tentar clicar no botão Ao-Vivo
            console.log(`${TAG} ⚠️ Hash não carregou. Tentando clicar Ao-Vivo...`);
            const liveLink = findAoVivoLink();
            if (liveLink) {
              simulateRealClick(liveLink);
              waitForCondition(isLivePage, 10_000, () => {
                workerPhase = 'CHECK_FOOTBALL';
                setTimeout(workerNavigate, 3000);
              }, () => reportWorkerFailure('Timeout: nem hash nem click funcionaram'));
            } else {
              reportWorkerFailure('Não conseguiu navegar para ao-vivo');
            }
          }
        );
        break;
      }

      case 'CHECK_FOOTBALL': {
        // Verificar se "Futebol" já está selecionado
        console.log(`${TAG} 🔍 Verificando se Futebol está selecionado...`);
        
        // Bet365: na barra de esportes, o esporte selecionado tem classe diferente
        const footballTab = findFootballTab();
        const hasFixtures = document.querySelectorAll('[class*="ovm-Fixture"]').length > 0;

        if (hasFixtures) {
          console.log(`${TAG} ✅ Futebol já tem fixtures visíveis!`);
          workerPhase = 'SCROLL_LIST';
          setTimeout(workerNavigate, 2500); // Dar tempo para todos os jogos renderizarem
        } else if (footballTab) {
          console.log(`${TAG} 🖱️ Clicando em Futebol...`);
          simulateRealClick(footballTab);
          workerPhase = 'WAIT_FOOTBALL';
          waitForCondition(
            () => document.querySelectorAll('[class*="ovm-Fixture"]').length > 0,
            12_000,
            () => {
              console.log(`${TAG} ✅ Futebol carregou!`);
              workerPhase = 'SCROLL_LIST';
              setTimeout(workerNavigate, 2500);
            },
            () => {
              console.log(`${TAG} ❌ Timeout esperando fixtures de futebol`);
              reportWorkerFailure('Timeout carregando futebol');
            }
          );
        } else {
          // Tentar esperar mais tempo para a página carregar
          setTimeout(() => {
            const retryFixtures = document.querySelectorAll('[class*="ovm-Fixture"]').length > 0;
            if (retryFixtures) {
              workerPhase = 'SCROLL_LIST';
              setTimeout(workerNavigate, 2000);
            } else {
              const retryTab = findFootballTab();
              if (retryTab) {
                simulateRealClick(retryTab);
                waitForCondition(
                  () => document.querySelectorAll('[class*="ovm-Fixture"]').length > 0,
                  10_000,
                  () => { workerPhase = 'SCROLL_LIST'; setTimeout(workerNavigate, 2500); },
                  () => reportWorkerFailure('Futebol não carregou após retry')
                );
              } else {
                reportWorkerFailure('Futebol não encontrado e sem fixtures');
              }
            }
          }, 5000);
        }
        break;
      }

      case 'SCROLL_LIST': {
        // Scrollar a lista para forçar a Bet365 a renderizar TODOS os jogos
        // (Bet365 usa scroll virtual — só renderiza o que está visível)
        console.log(`${TAG} 📜 Scrollando lista para carregar todos os jogos...`);

        const scrollContainer = findScrollableContainer();
        if (!scrollContainer) {
          console.log(`${TAG} ⚠️ Container scrollável não encontrado. Lendo direto...`);
          workerPhase = 'READ_LIST';
          setTimeout(workerNavigate, 1000);
          break;
        }

        const countBefore = document.querySelectorAll('[class*="ovm-FixtureDetailsTwoWay"], [class*="ovm-FixtureDetails"]').length;
        console.log(`${TAG} 📜 Fixtures antes do scroll: ${countBefore}`);

        // Scroll progressivo: descer 500px a cada 400ms
        let scrollAttempts = 0;
        const maxScrollAttempts = 30; // Máximo 30 scrolls (~15s)
        let lastFixtureCount = countBefore;
        let stableCount = 0; // Quantas vezes o count ficou igual

        function scrollStep() {
          scrollAttempts++;
          scrollContainer.scrollTop += 500;

          setTimeout(() => {
            const currentCount = document.querySelectorAll('[class*="ovm-FixtureDetailsTwoWay"], [class*="ovm-FixtureDetails"]').length;

            if (currentCount === lastFixtureCount) {
              stableCount++;
            } else {
              stableCount = 0;
              lastFixtureCount = currentCount;
            }

            // Parar se: fixture count estabilizou por 3 checks OU excedeu máximo
            if (stableCount >= 3 || scrollAttempts >= maxScrollAttempts) {
              // Voltar ao topo
              scrollContainer.scrollTop = 0;
              console.log(`${TAG} 📜 Scroll completo. Fixtures: ${countBefore} → ${currentCount} (${scrollAttempts} scrolls)`);
              
              // Esperar um pouco para DOM estabilizar depois de voltar ao topo
              setTimeout(() => {
                workerPhase = 'READ_LIST';
                workerNavigate();
              }, 1500);
            } else {
              scrollStep(); // Continuar scrollando
            }
          }, 400);
        }

        scrollStep();
        break;
      }

      case 'READ_LIST': {
        console.log(`${TAG} 📖 Lendo lista de jogos...`);
        const result = extractGamesFromPage();

        if (result.games.length === 0) {
          console.log(`${TAG} ⚠️ Nenhum jogo encontrado na lista`);
          reportWorkerFailure('Lista de jogos vazia');
          return;
        }

        console.log(`${TAG} 📋 ${result.games.length} jogos encontrados. Enviando ao background...`);

        // Enviar lista ao background
        chrome.runtime.sendMessage({
          type: 'GAMES_FOUND',
          games: result.games,
          strategy: `${result.strategy}:${result.selector}`,
          timestamp: Date.now(),
          scanNumber: ++scanCount,
        });

        // Pedir ao background: o que fazer?
        chrome.runtime.sendMessage({ type: 'WORKER_READY' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`${TAG} ❌ Erro comunicando com background`);
            return;
          }

          if (response?.action === 'OPEN_GAME') {
            workerPhase = 'CLICK_GAME';
            handleOpenGame(response, result.games);
          } else {
            console.log(`${TAG} 📭 Nenhum jogo para abrir. Worker fechando.`);
            // Background vai fechar esta aba
          }
        });
        break;
      }

      case 'DONE': {
        console.log(`${TAG} ✅ Worker finalizado.`);
        break;
      }
    }
  }

  // ── Encontrar link "Ao-Vivo" ──
  // ── Encontrar container scrollável da lista ──
  function findScrollableContainer() {
    // Estratégia 1: seletores conhecidos da Bet365
    const selectors = [
      '[class*="ovm-OverviewModule"]',
      '[class*="ovm-Overview"]',
      '[class*="ip-ClassificationContent"]',
      '[class*="ip-FixtureList"]',
      '.ovm-OverviewModule_Container',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) {
        return el;
      }
    }

    // Estratégia 2: subir do primeiro fixture até achar um scrollable
    const firstFixture = document.querySelector('[class*="ovm-Fixture"]');
    if (firstFixture) {
      let parent = firstFixture.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        const style = window.getComputedStyle(parent);
        if ((style.overflow === 'auto' || style.overflow === 'scroll' || 
             style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            parent.scrollHeight > parent.clientHeight + 50) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    // Fallback: document.documentElement (página inteira)
    return document.documentElement;
  }

  function findAoVivoLink() {
    // Procurar por texto "Ao-Vivo" em links e botões
    const candidates = document.querySelectorAll('a, [role="link"], [role="button"], span, div');
    for (const el of candidates) {
      const text = el.textContent.trim();
      if (/^ao[- ]?vivo$/i.test(text) && el.offsetParent !== null) {
        return el;
      }
    }
    
    // Fallback: procurar link com href #/IP
    const links = document.querySelectorAll('a[href*="/IP"], a[href*="InPlay"]');
    if (links.length > 0) return links[0];

    return null;
  }

  // ── Encontrar tab "Futebol" ──
  function findFootballTab() {
    const candidates = document.querySelectorAll(
      '[class*="ovm-ClassificationBar"] *, [class*="ip-ClassificationBar"] *, ' +
      '[class*="ClassificationBarButton"] *, [class*="SportHeader"] *'
    );
    
    for (const el of candidates) {
      const text = el.textContent.trim();
      if (/^futebol$/i.test(text) && el.offsetParent !== null) {
        return el;
      }
    }

    // Fallback: procurar qualquer elemento visível com "Futebol"
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim().toLowerCase() === 'futebol') {
        if (el.offsetParent !== null && el.getBoundingClientRect().height > 0) {
          return el;
        }
      }
    }

    return null;
  }

  // ── Abrir um jogo específico ──
  function handleOpenGame(response, games) {
    const { eventId, home, away, gameIndex } = response;
    console.log(`${TAG} 🎯 Abrindo: ${home} x ${away} (index: ${gameIndex})`);

    // Encontrar o elemento do jogo na lista
    const targetGame = findGameElement(eventId, home, away, gameIndex, games);

    if (!targetGame) {
      console.log(`${TAG} ❌ Elemento do jogo não encontrado no DOM`);
      chrome.runtime.sendMessage({
        type: 'OPEN_FAILED',
        eventId,
        reason: 'Elemento não encontrado no DOM',
      });
      return;
    }

    console.log(`${TAG} 🖱️ Clicando no jogo...`);
    simulateRealClick(targetGame);

    // Aguardar a página mudar (navegar para o detalhe do jogo)
    const hashBefore = location.hash;
    waitForCondition(
      () => {
        // A página mudou? URL mudou ou apareceu conteúdo de jogo
        return location.hash !== hashBefore || isGamePage();
      },
      15_000,
      () => {
        console.log(`${TAG} ✅ Jogo aberto! Página mudou.`);
        workerPhase = 'DONE';
        chrome.runtime.sendMessage({
          type: 'GAME_OPENED',
          eventId,
        });
      },
      () => {
        console.log(`${TAG} ❌ Timeout esperando jogo abrir`);
        chrome.runtime.sendMessage({
          type: 'OPEN_FAILED',
          eventId,
          reason: 'Timeout esperando jogo abrir',
        });
      }
    );
  }

  // ── Encontrar elemento DOM do jogo ──
  function findGameElement(eventId, home, away, gameIndex, games) {
    // Tentar encontrar pelo index na lista de fixtures
    const fixtures = document.querySelectorAll('[class*="ovm-FixtureDetailsTwoWay"]');
    const filtered = filterDeepest(fixtures);

    if (gameIndex !== undefined && gameIndex < filtered.length) {
      // Verificar se o fixture no index tem os nomes corretos
      const fixture = filtered[gameIndex];
      const text = fixture.textContent || '';
      const homeNorm = normalize(home);
      const awayNorm = normalize(away);
      const textNorm = normalize(text);

      if (textNorm.includes(homeNorm.substring(0, 8)) || textNorm.includes(awayNorm.substring(0, 8))) {
        // Match! Encontrar o elemento clicável dentro do fixture
        return findClickableInFixture(fixture);
      }
    }

    // Fallback: buscar por nome do time em todos os fixtures
    for (const fixture of filtered) {
      const text = normalize(fixture.textContent || '');
      const homeNorm = normalize(home).substring(0, 10);
      const awayNorm = normalize(away).substring(0, 10);

      if (text.includes(homeNorm) && text.includes(awayNorm)) {
        return findClickableInFixture(fixture);
      }
    }

    return null;
  }

  // ── Encontrar o melhor elemento para clicar dentro do fixture ──
  function findClickableInFixture(fixture) {
    // Prioridade 1: link <a> interno
    const link = fixture.querySelector('a[href]');
    if (link) return link;

    // Prioridade 2: elemento com nome do time (mais específico para click)
    const participant = fixture.querySelector(
      '[class*="Participant"], [class*="TeamName"], [class*="Name"]'
    );
    if (participant) return participant;

    // Prioridade 3: o próprio fixture
    return fixture;
  }

  // ── Esperar condição com timeout ──
  function waitForCondition(condFn, timeoutMs, onSuccess, onFail) {
    const start = Date.now();
    const check = () => {
      if (condFn()) {
        onSuccess();
      } else if (Date.now() - start > timeoutMs) {
        onFail();
      } else {
        setTimeout(check, 500);
      }
    };
    setTimeout(check, 500);
  }

  // ── Reportar falha do worker ──
  function reportWorkerFailure(reason) {
    if (isWorker) {
      chrome.runtime.sendMessage({
        type: 'OPEN_FAILED',
        eventId: null,
        reason,
      });
    }
  }

  // ── Padrões de ligas/jogos bloqueados (e-sports, virtuais) ──
  const BLOCKED_PATTERNS = [
    /e-soccer/i, /esports?/i, /e-basketball/i, /e-hockey/i, /e-tennis/i,
    /fifa/i, /nba\s*2k/i, /counter.strike/i, /dota/i, /league of legends/i,
    /virtual/i, /cyber/i, /sim\s*racing/i, /e-cricket/i, /e-baseball/i,
    /e-futebol/i, /battle/i, /esoccer/i,
  ];

  function isBlockedGame(game) {
    const text = `${game.league} ${game.home} ${game.away}`.toLowerCase();
    return BLOCKED_PATTERNS.some(p => p.test(text));
  }

  function extractGamesFromPage() {
    const games = [];
    const fixtureSelectors = [
      '[class*="ovm-FixtureDetailsTwoWay"]',
      '[class*="ovm-FixtureDetails"]',
      '[class*="ovm-Fixture"]',
    ];

    let fixtures = [];
    let usedSelector = '';

    for (const sel of fixtureSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        fixtures = filterDeepest(found);
        usedSelector = sel;
        break;
      }
    }

    if (fixtures.length === 0) {
      return { games: [], selector: 'none', strategy: 'class-fixture' };
    }

    let blocked = 0;
    fixtures.forEach((fixture, idx) => {
      try {
        const game = smartExtract(fixture, idx);
        if (game) {
          if (isBlockedGame(game)) {
            blocked++;
          } else {
            games.push(game);
          }
        }
      } catch (e) {
        console.warn(`${TAG} Erro fixture #${idx}:`, e);
      }
    });

    if (blocked > 0) {
      console.log(`${TAG} 🚫 ${blocked} jogos bloqueados (e-sports/virtual)`);
    }

    return { games, selector: usedSelector, strategy: 'class-fixture' };
  }

  function filterDeepest(nodeList) {
    const arr = [...nodeList];
    return arr.filter(el => !arr.some(other => other !== el && other.contains(el)));
  }

  function smartExtract(fixture, idx) {
    const leaves = [];
    const walker = document.createTreeWalker(fixture, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text.length > 0) {
        leaves.push({
          text,
          element: walker.currentNode.parentElement,
          rect: walker.currentNode.parentElement?.getBoundingClientRect(),
        });
      }
    }

    const teamNames = [];
    const scores = [];
    const timers = [];
    const odds = [];

    leaves.forEach(leaf => {
      const t = leaf.text;
      if (/^\d{1,2}:\d{2}$/.test(t) || /^\d{1,3}'$/.test(t)) {
        timers.push(leaf);
      } else if (/^\d+\.\d{2}$/.test(t)) {
        odds.push(leaf);
      } else if (/^\d{1,2}$/.test(t) && parseInt(t) < 30) {
        scores.push(leaf);
      } else if (t.length >= 3 && !/^\d/.test(t) && !isOddsLabel(t) && !isMarketLabel(t)) {
        teamNames.push(leaf);
      }
    });

    if (teamNames.length < 2) return null;

    teamNames.sort((a, b) => (a.rect?.top || 0) - (b.rect?.top || 0));

    const home = teamNames[0].text;
    const away = teamNames[1].text;
    if (home.length < 2 || away.length < 2) return null;

    let score = '?-?';
    if (scores.length >= 2) {
      scores.sort((a, b) => (a.rect?.top || 0) - (b.rect?.top || 0));
      score = `${scores[0].text}-${scores[1].text}`;
    }

    let elapsed = '';
    if (timers.length > 0) {
      elapsed = timers[0].text;
    } else {
      let parent = fixture.parentElement;
      for (let up = 0; up < 3 && parent; up++) {
        const allLeaves = parent.querySelectorAll('*');
        for (const leaf of allLeaves) {
          if (leaf.children.length === 0) {
            const txt = leaf.textContent.trim();
            if (/^\d{1,2}:\d{2}$/.test(txt) && !fixture.contains(leaf)) {
              elapsed = txt;
              break;
            }
          }
        }
        if (elapsed) break;
        parent = parent.parentElement;
      }
    }

    const league = findLeague(fixture);

    return {
      index: idx,
      home,
      away,
      league,
      score,
      elapsed,
      eventId: generateEventId(home, away, league),
    };
  }

  function isOddsLabel(text) {
    const t = text.toLowerCase();
    return /^(1|x|2|1x|x2|12)$/.test(t) ||
           t === 'sim' || t === 'não' || t === 'nao' ||
           t === 'sem' || t === 'yes' || t === 'no';
  }

  function isMarketLabel(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.includes('para marcar') || t.includes('resultado') ||
           t.includes('proximo gol') || t.includes('partida') ||
           t.includes('gols') || t.includes('handicap') ||
           t.includes('total') || t.includes('ambas') ||
           t.includes('chance dupla') || t.includes('intervalo') ||
           /^(over|under|mais|menos)\b/.test(t);
  }

  function cleanLeagueName(raw) {
    let name = raw.trim();
    name = name.replace(/\s*1\s*[Xx×]\s*2\s*$/, '');
    name = name.replace(/\s+[12Xx]\s*$/, '');
    name = name.replace(/\s*(Resultado Final|Próximo Gol|Partida\s*-\s*Gols).*$/i, '');
    return name.trim();
  }

  function findLeague(fixture) {
    let current = fixture;
    for (let i = 0; i < 8; i++) {
      current = current.parentElement;
      if (!current) break;

      const headerSelectors = [
        '[class*="ovm-CompetitionName"]',
        '[class*="CompetitionName"]',
        '[class*="LeagueName"]',
        '[class*="GroupName"]',
      ];

      for (const sel of headerSelectors) {
        const el = current.querySelector(sel);
        if (el) {
          const text = cleanLeagueName(el.textContent.trim().split('\n')[0]);
          if (text.length > 2 && text.length < 80 && !isMarketLabel(text)) {
            return text;
          }
        }
      }
    }

    current = fixture;
    for (let i = 0; i < 6; i++) {
      current = current.parentElement;
      if (!current) break;
      let prev = current.previousElementSibling;
      let checked = 0;
      while (prev && checked < 5) {
        const cls = (prev.className || '').toString();
        if (/header|league|competition|group/i.test(cls)) {
          const nameEl = prev.querySelector('[class*="CompetitionName"], [class*="LeagueName"]');
          const text = cleanLeagueName((nameEl || prev).textContent.trim().split('\n')[0]);
          if (text.length > 2 && text.length < 80 && !isMarketLabel(text) && !/\d+\.\d{2}/.test(text)) {
            return text;
          }
        }
        prev = prev.previousElementSibling;
        checked++;
      }
    }

    return 'Desconhecida';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    console.log(`${TAG} 🤖 Content script carregado. URL: ${location.href}`);

    // Perguntar ao background: sou worker?
    chrome.runtime.sendMessage({ type: 'AM_I_WORKER' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(`${TAG} ⚠️ Background não respondeu. Modo passivo.`);
        startPassiveMode();
        return;
      }

      if (response?.isWorker) {
        isWorker = true;
        console.log(`${TAG} 🔧 MODO WORKER ativado!`);
        setTimeout(workerNavigate, 5000); // Esperar página carregar completamente
      } else {
        console.log(`${TAG} 📡 Modo passivo (discovery).`);
        startPassiveMode();
      }
    });
  }

  function startPassiveMode() {
    // Observar mudanças de hash (SPA)
    let lastHash = location.hash;
    setInterval(() => {
      if (location.hash !== lastHash) {
        lastHash = location.hash;
        if (isLivePage() && !scanTimer) {
          scanTimer = setInterval(runPassiveScan, SCAN_INTERVAL_MS);
          setTimeout(runPassiveScan, 1500);
        } else if (!isLivePage() && scanTimer) {
          clearInterval(scanTimer);
          scanTimer = null;
        }
      }
    }, 1000);

    // Iniciar se já na live
    if (isLivePage()) {
      setTimeout(() => {
        runPassiveScan();
        scanTimer = setInterval(runPassiveScan, SCAN_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    }
  }

  function runPassiveScan() {
    if (!isLivePage()) return;
    scanCount++;

    const result = extractGamesFromPage();
    if (result.games.length === 0) return;

    const uniqueGames = [];
    const seen = new Set();
    result.games.forEach(g => {
      if (!seen.has(g.eventId)) {
        seen.add(g.eventId);
        uniqueGames.push(g);
      }
    });

    chrome.runtime.sendMessage({
      type: 'GAMES_FOUND',
      games: uniqueGames,
      strategy: `${result.strategy}:${result.selector}`,
      timestamp: Date.now(),
      scanNumber: scanCount,
    });
  }

  // Iniciar com delay
  setTimeout(init, 1500); // Dar tempo para o DOM estabilizar

})();
