// ═══════════════════════════════════════════════════════════════════════════════
// Bet365 Robot — Background Controller (Fase 4: Persistente + Anti-Duplicata)
// ═══════════════════════════════════════════════════════════════════════════════
// Cérebro central: gerencia fila, abas, memória, ciclo, e auto-close FT.
// IMPORTANTE: Usa chrome.alarms (sobrevive ao sleep do Service Worker)
//             e chrome.storage.local (persiste ROBOT_ENABLED entre restarts)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Configuração ──────────────────────────────────────────────────────────────
const CONFIG = {
  MAX_OPEN_TABS: 30,
  WORKER_COOLDOWN_MS: 12_000,    // Mínimo 12s entre criar workers
  SCAN_INTERVAL_MS: 60_000,      // Scan da lista a cada 60s
  TAB_OPEN_TIMEOUT_MS: 45_000,   // Timeout para confirmação de abertura
  TICK_INTERVAL_MS: 5_000,       // Ciclo principal a cada 5s
  MAX_ERROR_COUNT: 3,            // Retries antes de ERRO permanente
  BET365_URL: 'https://bet365.bet.br/#/IP/B1',  // Direto para Ao-Vivo/Futebol
  ROBOT_ENABLED: false,          // Estado em memória — restaurado do storage no boot
  AUTO_CLOSE_DELAY_MS: 10_000,   // Esperar 10s após confirmação antes de fechar aba
  AUTO_CLOSE_MINUTES: 95,         // Fechar aba quando elapsed >= 95 minutos
};

// ─── Estado em Memória ─────────────────────────────────────────────────────────
const STATE = {
  // Jogos descobertos: Map<eventId, MatchData>
  matches: new Map(),

  // Fila de abertura: Array<eventId>
  queue: [],

  // Registry de abas: Map<tabId, eventId>
  tabToEvent: new Map(),
  eventToTab: new Map(),

  // Worker ativo
  activeWorkerId: null,
  workerBusy: false,
  workerTarget: null,  // eventId que o worker deve abrir (null = scan only)

  // Timing
  lastWorkerCreate: 0,
  lastScanTime: 0,
  scanCount: 0,

  // Stats
  totalDiscovered: 0,
  totalOpened: 0,
  totalClosed: 0,
  totalErrors: 0,

  // Circuit breaker
  consecutiveFailures: 0,
  circuitBreakerUntil: 0,

  // Logs (últimos 50)
  logs: [],

  // Set de tabIds que o robot está fechando (para distinguir de close manual)
  closingTabs: new Set(),
};

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(level, module, message, data = null) {
  const entry = {
    timestamp: Date.now(),
    level,
    module,
    message,
    data,
  };

  STATE.logs.unshift(entry);
  if (STATE.logs.length > 50) STATE.logs.length = 50;

  const icon = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '📋';
  console.log(`[Robot ${module}] ${icon} ${message}`, data || '');
}

// ─── Parser de Elapsed ──────────────────────────────────────────────────────────────────
function parseElapsedToMinutes(elapsed) {
  if (!elapsed) return null;
  const text = elapsed.toString().trim();

  // Formato "MM:SS" (ex: "91:17", "45:00")
  const mmss = text.match(/^(\d{1,3}):(\d{2})$/);
  if (mmss) return parseInt(mmss[1], 10);

  // Formato "MM'" (ex: "45'", "90'")
  const min = text.match(/^(\d{1,3})'$/);
  if (min) return parseInt(min[1], 10);

  // Formato número puro
  if (/^\d{1,3}$/.test(text)) return parseInt(text, 10);

  // "FT", "Encerrado", etc.
  if (/^(FT|Encerrado|Fim|Full Time|Finalizado)$/i.test(text)) return 95;

  // "HT", "Intervalo"
  if (/^(HT|Intervalo|Half Time)$/i.test(text)) return 45;

  return null;
}

// ─── Contagem de abas monitorando ─────────────────────────────────────────────
function getOpenTabCount() {
  let count = 0;
  STATE.matches.forEach(m => {
    if (m.status === 'ABRINDO' || m.status === 'MONITORANDO') count++;
  });
  return count;
}

// ─── Atualizar Badge ──────────────────────────────────────────────────────────
function updateBadge() {
  const monitoring = [...STATE.matches.values()].filter(m => m.status === 'MONITORANDO').length;
  const discovered = [...STATE.matches.values()].filter(m => !['ENCERRADO', 'ERRO'].includes(m.status)).length;

  // Mostrar monitorando se há jogos abertos, senão total descobertos
  const text = monitoring > 0 ? String(monitoring) : (discovered > 0 ? String(discovered) : '');
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: CONFIG.ROBOT_ENABLED ? '#10b981' : '#6b7280'
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {

    // ── Worker pergunta: "sou worker?" ──
    case 'AM_I_WORKER': {
      const isWorker = tabId === STATE.activeWorkerId;
      sendResponse({
        isWorker,
        targetEventId: isWorker ? STATE.workerTarget : null,
        robotEnabled: CONFIG.ROBOT_ENABLED,
      });
      break;
    }

    // ── Discovery/Worker encontrou jogos na lista ──
    case 'GAMES_FOUND': {
      STATE.scanCount++;
      STATE.lastScanTime = Date.now();

      let newCount = 0;
      const currentIds = new Set();

      (msg.games || []).forEach(game => {
        currentIds.add(game.eventId);

        if (!STATE.matches.has(game.eventId)) {
          // Jogo genuinamente novo!
          STATE.matches.set(game.eventId, {
            eventId: game.eventId,
            home: game.home,
            away: game.away,
            league: game.league,
            score: game.score,
            elapsed: game.elapsed,
            elapsedMinutes: parseElapsedToMinutes(game.elapsed),
            status: 'DESCOBERTO',
            tabId: null,
            discoveredAt: Date.now(),
            openedAt: null,
            closedAt: null,
            errorCount: 0,
            errorReason: null,
            lastSeen: Date.now(),
            gameIndex: game.index,
          });
          newCount++;
          STATE.totalDiscovered++;

          // Adicionar à fila se robot ativo
          if (CONFIG.ROBOT_ENABLED && !STATE.queue.includes(game.eventId)) {
            STATE.queue.push(game.eventId);
            log('INFO', 'QUEUE', `Enfileirado: ${game.home} x ${game.away}`, { eventId: game.eventId });
          }
        } else {
          // Atualizar dados do jogo existente
          const existing = STATE.matches.get(game.eventId);
          existing.score = game.score;
          existing.elapsed = game.elapsed;
          existing.elapsedMinutes = parseElapsedToMinutes(game.elapsed) || existing.elapsedMinutes;
          existing.lastSeen = Date.now();
          existing.gameIndex = game.index;
        }
      });

      // Detectar jogos que sumiram (possível FT)
      STATE.matches.forEach((match, id) => {
        if (!currentIds.has(id) && ['DESCOBERTO', 'NA_FILA'].includes(match.status)) {
          match.status = 'ENCERRADO';
          match.closedAt = Date.now();
          // Remover da fila se estiver lá
          STATE.queue = STATE.queue.filter(q => q !== id);
          log('INFO', 'END', `Sumiu da lista: ${match.home} x ${match.away}`);
        }
      });

      if (newCount > 0) {
        log('INFO', 'DISC', `Scan #${STATE.scanCount}: ${msg.games.length} jogos, ${newCount} novos`);
      }

      updateBadge();
      sendResponse({ ok: true, newCount });
      break;
    }

    // ── Worker navegou até a lista e está pronto ──
    case 'WORKER_READY': {
      if (tabId !== STATE.activeWorkerId) {
        sendResponse({ action: 'CLOSE' });
        break;
      }

      log('INFO', 'WORKER', 'Worker chegou na lista de jogos');

      // Determinar próximo jogo a abrir
      const target = findNextGameToOpen();

      if (target) {
        STATE.workerTarget = target.eventId;
        target.status = 'ABRINDO';
        log('INFO', 'WORKER', `Abrindo: ${target.home} x ${target.away}`, { eventId: target.eventId });
        sendResponse({
          action: 'OPEN_GAME',
          eventId: target.eventId,
          home: target.home,
          away: target.away,
          gameIndex: target.gameIndex,
        });
      } else {
        log('INFO', 'WORKER', 'Nenhum jogo novo para abrir. Fechando worker.');
        sendResponse({ action: 'CLOSE' });
        closeWorker();
      }
      break;
    }

    // ── Worker abriu o jogo com sucesso ──
    case 'GAME_OPENED': {
      const eventId = msg.eventId;
      const match = STATE.matches.get(eventId);

      if (match) {
        match.status = 'MONITORANDO';
        match.tabId = tabId;
        match.openedAt = Date.now();

        STATE.tabToEvent.set(tabId, eventId);
        STATE.eventToTab.set(eventId, tabId);

        STATE.totalOpened++;
        STATE.consecutiveFailures = 0;

        log('INFO', 'TABS', `✅ Monitorando: ${match.home} x ${match.away} (tab ${tabId})`);

        // Remover da fila
        STATE.queue = STATE.queue.filter(q => q !== eventId);
      }

      // Worker agora é aba de jogo — limpar referência
      STATE.activeWorkerId = null;
      STATE.workerBusy = false;
      STATE.workerTarget = null;

      updateBadge();
      sendResponse({ ok: true });
      break;
    }

    // ── Worker falhou ao abrir o jogo ──
    case 'OPEN_FAILED': {
      const match = STATE.matches.get(msg.eventId);
      if (match) {
        match.errorCount++;
        if (match.errorCount >= CONFIG.MAX_ERROR_COUNT) {
          match.status = 'ERRO';
          match.errorReason = msg.reason || 'Falha ao abrir';
          STATE.queue = STATE.queue.filter(q => q !== msg.eventId);
          STATE.totalErrors++;
          log('ERROR', 'TABS', `ERRO permanente: ${match.home} x ${match.away} (${match.errorCount} tentativas)`);
        } else {
          match.status = 'DESCOBERTO';
          log('WARN', 'TABS', `Falha ao abrir (tentativa ${match.errorCount}): ${match.home} x ${match.away}`);
        }
      }

      STATE.consecutiveFailures++;
      if (STATE.consecutiveFailures >= 5) {
        STATE.circuitBreakerUntil = Date.now() + 120_000;
        log('ERROR', 'SYSTEM', '🔴 CIRCUIT BREAKER: 5 falhas seguidas. Pausando 2 min.');
      }

      closeWorker();
      updateBadge();
      sendResponse({ ok: true });
      break;
    }

    // ── Popup: obter status completo ──
    case 'GET_STATUS': {
      const matches = [...STATE.matches.values()];
      sendResponse({
        robotEnabled: CONFIG.ROBOT_ENABLED,
        scanCount: STATE.scanCount,
        lastScanTime: STATE.lastScanTime,
        totalDiscovered: STATE.totalDiscovered,
        totalOpened: STATE.totalOpened,
        totalClosed: STATE.totalClosed,
        totalErrors: STATE.totalErrors,
        queueLength: STATE.queue.length,
        openTabs: getOpenTabCount(),
        maxTabs: CONFIG.MAX_OPEN_TABS,
        workerActive: STATE.activeWorkerId !== null,
        circuitBreaker: Date.now() < STATE.circuitBreakerUntil,
        matches: {
          monitoring: matches.filter(m => m.status === 'MONITORANDO'),
          queue: matches.filter(m => ['DESCOBERTO', 'NA_FILA'].includes(m.status)),
          ended: matches.filter(m => m.status === 'ENCERRADO'),
          errors: matches.filter(m => m.status === 'ERRO'),
        },
        logs: STATE.logs.slice(0, 20),
      });
      break;
    }

    // ── Popup: toggle robot ──
    case 'TOGGLE_ROBOT': {
      CONFIG.ROBOT_ENABLED = !CONFIG.ROBOT_ENABLED;
      // 💾 Persistir no storage para sobreviver ao restart do Service Worker
      chrome.storage.local.set({ robot_enabled: CONFIG.ROBOT_ENABLED });
      log('INFO', 'SYSTEM', CONFIG.ROBOT_ENABLED ? '🟢 Robot ATIVADO (persistido)' : '🔴 Robot DESATIVADO (persistido)');

      // Se ativando, enfileirar todos os jogos descobertos que não estão abertos
      if (CONFIG.ROBOT_ENABLED) {
        STATE.matches.forEach((match, id) => {
          if (match.status === 'DESCOBERTO' && !STATE.queue.includes(id)) {
            STATE.queue.push(id);
          }
        });
        // Garantir que o alarm está rodando
        ensureTickAlarm();
      } else {
        closeWorker();
      }

      updateBadge();
      sendResponse({ robotEnabled: CONFIG.ROBOT_ENABLED });
      break;
    }

    // ── Popup: limpar tudo ──
    case 'CLEAR_ALL': {
      // Fechar todas as abas monitorando
      STATE.tabToEvent.forEach((eventId, tabId) => {
        try { chrome.tabs.remove(tabId); } catch (e) {}
      });
      STATE.matches.clear();
      STATE.queue = [];
      STATE.tabToEvent.clear();
      STATE.eventToTab.clear();
      closeWorker();
      STATE.totalDiscovered = 0;
      STATE.totalOpened = 0;
      STATE.totalClosed = 0;
      STATE.totalErrors = 0;
      STATE.scanCount = 0;
      STATE.logs = [];
      updateBadge();
      log('INFO', 'SYSTEM', '🗑️ Tudo limpo');
      sendResponse({ ok: true });
      break;
    }

    // ── Discovery passiva (Fase 1 compat) ──
    case 'DISCOVERY_HEARTBEAT': {
      sendResponse({ ok: true });
      break;
    }

    // ── EndDetector: jogo terminou (FT confirmado) ──
    case 'GAME_ENDED': {
      const eventId = STATE.tabToEvent.get(tabId);
      const match = eventId ? STATE.matches.get(eventId) : null;

      const gameName = match
        ? `${match.home} x ${match.away}`
        : `${msg.home || '?'} x ${msg.away || '?'}`;

      log('INFO', 'FT', `🏁 FT confirmado: ${gameName} (${msg.score || '?'}) — Timer: "${msg.timerText}"`);

      if (match) {
        match.status = 'ENCERRADO';
        match.closedAt = Date.now();
        match.score = msg.score || match.score;
        STATE.totalClosed++;

        // Remover da fila (se por algum motivo estiver lá)
        STATE.queue = STATE.queue.filter(q => q !== eventId);
      }

      // Fechar a aba após delay de cortesia (10s)
      if (tabId) {
        log('INFO', 'FT', `⏳ Fechando aba #${tabId} em ${CONFIG.AUTO_CLOSE_DELAY_MS / 1000}s...`);
        setTimeout(() => {
          STATE.closingTabs.add(tabId);
          try {
            chrome.tabs.remove(tabId, () => {
              if (chrome.runtime.lastError) {
                log('WARN', 'FT', `Aba #${tabId} já foi fechada`);
              } else {
                log('INFO', 'FT', `✅ Aba #${tabId} fechada: ${gameName}`);
              }
              // Cleanup do registry
              if (eventId) {
                STATE.tabToEvent.delete(tabId);
                STATE.eventToTab.delete(eventId);
              }
              STATE.closingTabs.delete(tabId);
              updateBadge();
            });
          } catch (e) {
            log('ERROR', 'FT', `Erro ao fechar aba #${tabId}: ${e.message}`);
            STATE.closingTabs.delete(tabId);
          }
        }, CONFIG.AUTO_CLOSE_DELAY_MS);
      }

      updateBadge();
      sendResponse({ ok: true, action: 'CLOSING' });
      break;
    }

    default:
      sendResponse({ error: 'Unknown: ' + msg.type });
  }

  return true;
});

// ═══════════════════════════════════════════════════════════════════════════════
// CICLO PRINCIPAL — chrome.alarms (sobrevive ao sleep do Service Worker!)
// ═══════════════════════════════════════════════════════════════════════════════

function ensureTickAlarm() {
  chrome.alarms.get('robot_tick', (alarm) => {
    if (!alarm) {
      // periodInMinutes mínimo é 0.083 (~5s) — Chrome limita a 1 min em produção
      // Então usamos 0.1 min (~6s) como fallback confiável
      chrome.alarms.create('robot_tick', { periodInMinutes: 0.1 });
      console.log('[Robot] ⏰ Alarm robot_tick criado (a cada ~6s)');
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'robot_tick') {
    tick();
  }
});

// Também manter setInterval como backup (funciona enquanto SW está acordado)
setInterval(tick, CONFIG.TICK_INTERVAL_MS);

function tick() {
  if (!CONFIG.ROBOT_ENABLED) return;

  // Circuit breaker ativo?
  if (Date.now() < STATE.circuitBreakerUntil) return;

  // ── Auto-close: verificar jogos que passaram de 95 min ──
  checkExpiredGames();

  // Worker já ativo?
  if (STATE.workerBusy || STATE.activeWorkerId !== null) return;

  // Cooldown entre workers
  if (Date.now() - STATE.lastWorkerCreate < CONFIG.WORKER_COOLDOWN_MS) return;

  // Verificar se há jogos para abrir E há vaga
  const openTabs = getOpenTabCount();
  const hasCapacity = openTabs < CONFIG.MAX_OPEN_TABS;
  const hasQueue = STATE.queue.length > 0;
  const needsScan = Date.now() - STATE.lastScanTime > CONFIG.SCAN_INTERVAL_MS;

  if (hasQueue && hasCapacity) {
    createWorkerTab();
  } else if (needsScan) {
    createWorkerTab();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-CLOSE POR TEMPO
// ═══════════════════════════════════════════════════════════════════════════════

function checkExpiredGames() {
  STATE.matches.forEach((match, eventId) => {
    if (match.status !== 'MONITORANDO') return;
    if (STATE.closingTabs.has(match.tabId)) return; // Já está fechando

    let shouldClose = false;
    let reason = '';

    // Critério 1: elapsed >= 95 min (do scan da lista)
    if (match.elapsedMinutes && match.elapsedMinutes >= CONFIG.AUTO_CLOSE_MINUTES) {
      shouldClose = true;
      reason = `Timer: ${match.elapsed} (≥${CONFIG.AUTO_CLOSE_MINUTES}min)`;
    }

    // Critério 2: Estimativa — elapsed no scan + tempo decorrido desde o scan
    if (!shouldClose && match.elapsedMinutes && match.openedAt) {
      const minutesSinceOpen = (Date.now() - match.openedAt) / 60_000;
      const initialElapsed = match.elapsedMinutes || 0;
      const estimatedNow = initialElapsed + minutesSinceOpen;
      if (estimatedNow >= CONFIG.AUTO_CLOSE_MINUTES) {
        shouldClose = true;
        reason = `Estimativa: ~${Math.round(estimatedNow)}min (${initialElapsed}' + ${Math.round(minutesSinceOpen)}min aberto)`;
      }
    }

    // Critério 3: Fallback — aberto há mais de 2h (safety net)
    if (!shouldClose && match.openedAt) {
      const openMinutes = (Date.now() - match.openedAt) / 60_000;
      if (openMinutes >= 120) {
        shouldClose = true;
        reason = `Aberto há ${Math.round(openMinutes)}min (safety net)`;
      }
    }

    if (shouldClose) {
      autoCloseTab(match, eventId, reason);
    }
  });
}

function autoCloseTab(match, eventId, reason) {
  const gameName = `${match.home} x ${match.away}`;
  log('INFO', 'FT', `🏁 Auto-close: ${gameName} (${match.score}) — ${reason}`);

  match.status = 'ENCERRADO';
  match.closedAt = Date.now();
  STATE.totalClosed++;
  STATE.queue = STATE.queue.filter(q => q !== eventId);

  const tabId = match.tabId;
  if (tabId) {
    STATE.closingTabs.add(tabId);
    setTimeout(() => {
      try {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            log('WARN', 'FT', `Aba #${tabId} já fechada`);
          } else {
            log('INFO', 'FT', `✅ Aba fechada: ${gameName}`);
          }
          STATE.tabToEvent.delete(tabId);
          STATE.eventToTab.delete(eventId);
          STATE.closingTabs.delete(tabId);
          updateBadge();
        });
      } catch (e) {
        STATE.closingTabs.delete(tabId);
      }
    }, 5_000); // 5s de cortesia
  }

  updateBadge();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER TAB
// ═══════════════════════════════════════════════════════════════════════════════

function createWorkerTab() {
  STATE.workerBusy = true;
  STATE.lastWorkerCreate = Date.now();

  chrome.tabs.create({
    url: CONFIG.BET365_URL,
    active: false,
  }, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      log('ERROR', 'WORKER', 'Falha ao criar aba worker');
      STATE.workerBusy = false;
      return;
    }

    STATE.activeWorkerId = tab.id;
    log('INFO', 'WORKER', `Worker tab criado: #${tab.id}`);

    // Timeout: se worker não responder em 60s, fechar
    setTimeout(() => {
      if (STATE.activeWorkerId === tab.id) {
        log('WARN', 'WORKER', `Worker timeout (60s). Fechando tab #${tab.id}`);
        closeWorker();
      }
    }, 60_000);
  });
}

function closeWorker() {
  if (STATE.activeWorkerId) {
    try { chrome.tabs.remove(STATE.activeWorkerId); } catch (e) {}
  }
  STATE.activeWorkerId = null;
  STATE.workerBusy = false;
  STATE.workerTarget = null;
}

function findNextGameToOpen() {
  for (let i = 0; i < STATE.queue.length; i++) {
    const eventId = STATE.queue[i];
    const match = STATE.matches.get(eventId);
    if (match && match.status === 'DESCOBERTO' && match.errorCount < CONFIG.MAX_ERROR_COUNT) {
      return match;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB LIFECYCLE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

// Aba fechada externamente (usuário ou crash)
chrome.tabs.onRemoved.addListener((tabId) => {
  // Worker fechado?
  if (tabId === STATE.activeWorkerId) {
    log('WARN', 'WORKER', `Worker tab #${tabId} fechado externamente`);
    STATE.activeWorkerId = null;
    STATE.workerBusy = false;
    STATE.workerTarget = null;
    return;
  }

  // Aba de jogo fechada?
  const eventId = STATE.tabToEvent.get(tabId);
  if (eventId) {
    const match = STATE.matches.get(eventId);
    
    // Se o robot fechou (auto-close), o status já é ENCERRADO
    if (STATE.closingTabs.has(tabId)) {
      STATE.closingTabs.delete(tabId);
      // Cleanup silencioso — já logou no GAME_ENDED
    } else if (match && match.status === 'MONITORANDO') {
      // Fechado pelo usuário ou crash — marcar como erro para poder reabrir
      match.status = 'ERRO';
      match.errorReason = 'Aba fechada externamente';
      match.closedAt = Date.now();
      STATE.totalErrors++;
      log('WARN', 'TABS', `Aba #${tabId} fechada manualmente: ${match.home} x ${match.away}`);
    }
    STATE.tabToEvent.delete(tabId);
    STATE.eventToTab.delete(eventId);
    updateBadge();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE ABAS DUPLICADAS
// ═══════════════════════════════════════════════════════════════════════════════
// Quando um jogo termina, Bet365 redireciona a tab para a lista ou outro jogo.
// Detectamos isso e fechamos a aba se ela já não corresponde ao jogo esperado.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const eventId = STATE.tabToEvent.get(tabId);
  if (!eventId) return; // Não é uma aba nossa

  const match = STATE.matches.get(eventId);
  if (!match || match.status !== 'MONITORANDO') return;

  const url = changeInfo.url;

  // Se a URL mudou para a lista (sem /EV/) — jogo encerrou e redirecionou
  if (url.includes('#/IP/') && !url.includes('/EV')) {
    log('INFO', 'TABS', `🔄 Aba #${tabId} redirecionou para lista (jogo terminou): ${match.home} x ${match.away}`);
    autoCloseTab(match, eventId, 'Redirecionou para lista (FT)');
    return;
  }

  // Se a URL mudou para OUTRO evento (/EV/xxxxx diferente)
  if (url.includes('/EV')) {
    // Verificar se é um eventId diferente do esperado
    const urlEventMatch = url.match(/EV(\d+)/);
    if (urlEventMatch) {
      const urlEventNum = urlEventMatch[1];
      // Se o eventId original continha esse número, ok — é o mesmo jogo
      if (!eventId.includes(urlEventNum)) {
        log('INFO', 'TABS', `🔄 Aba #${tabId} mudou para outro jogo. Fechando duplicata: ${match.home} x ${match.away}`);
        autoCloseTab(match, eventId, 'Redirecionou para outro jogo');
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP & BOOT — Restaurar estado persistido
// ═══════════════════════════════════════════════════════════════════════════════

function restorePersistedState() {
  chrome.storage.local.get(['robot_enabled'], (data) => {
    if (chrome.runtime.lastError) return;
    if (data.robot_enabled === true) {
      CONFIG.ROBOT_ENABLED = true;
      log('INFO', 'SYSTEM', '🟢 Robot restaurado do storage (estava ATIVO)');
      ensureTickAlarm();
    } else {
      CONFIG.ROBOT_ENABLED = false;
    }
    updateBadge();
  });
}

chrome.runtime.onStartup?.addListener(() => {
  log('INFO', 'SYSTEM', '🚀 Extensão iniciou (onStartup). Restaurando...');
  STATE.activeWorkerId = null;
  STATE.workerBusy = false;
  restorePersistedState();
});

chrome.runtime.onInstalled?.addListener(() => {
  log('INFO', 'SYSTEM', '📦 Extensão instalada/atualizada. Restaurando...');
  restorePersistedState();
});

// Boot imediato (Service Worker acordou)
restorePersistedState();
ensureTickAlarm();
console.log('[Robot] 🤖 Background Controller v4 (Persistente) started.');
