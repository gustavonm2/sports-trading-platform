// ═══════════════════════════════════════════════════════════════════════════════
// Bet365 Robot — End Detector (Fase 3: Auto-Close)
// ═══════════════════════════════════════════════════════════════════════════════
// Roda em TODAS as abas bet365. Se detectar que é uma página de jogo,
// monitora o timer. Quando detecta FT/Encerrado, confirma 2x e notifica
// o background para fechar a aba.
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const TAG = '[Robot EndDetect]';
  const CHECK_INTERVAL = 10_000;    // Checar a cada 10s
  const CONFIRM_DELAY = 30_000;     // Esperar 30s e confirmar de novo
  const STARTUP_DELAY = 15_000;     // Esperar 15s antes de começar (dar tempo de carregar)

  let ftDetectedAt = 0;    // Timestamp da primeira detecção
  let ftConfirmed = false;  // Já confirmou e notificou?
  let gameInfo = null;      // { home, away, score }

  // ─── Verificar se é página de jogo ──────────────────────────────────────────
  function isGamePage() {
    return document.querySelector(
      '[class*="ml1-"], [class*="ipe-EventViewDetail"], [class*="ScoreBoard"]'
    ) !== null;
  }

  // ─── Ler o timer ────────────────────────────────────────────────────────────
  function readTimer() {
    // Estratégia 1: ml1-SoccerClock_Clock (CONFIRMADO que funciona)
    const clockEl = document.querySelector('[class*="ml1-SoccerClock_Clock"]');
    if (clockEl) {
      return clockEl.textContent.trim();
    }

    // Estratégia 2: Container do clock
    const container = document.querySelector('[class*="ml1-SoccerClock"]');
    if (container) {
      const text = container.textContent.trim();
      const match = text.match(/(\d{1,3}:\d{2})/);
      if (match) return match[1];
      return text;
    }

    // Estratégia 3: Fallback genérico
    const fallbacks = [
      '[class*="ipe-EventViewDetail_Timer"]',
      '[class*="ipe-Timer"]',
      '[class*="Timer_Text"]',
    ];
    for (const sel of fallbacks) {
      const el = document.querySelector(sel);
      if (el) return el.textContent.trim();
    }

    return null;
  }

  // ─── Verificar se o timer indica fim de jogo ────────────────────────────────
  function isFinished(timerText) {
    if (!timerText) return false;
    const t = timerText.trim().toLowerCase();
    
    // Textos explícitos de fim
    if (/^(ft|full[\s-]*time|encerrado|fim|finalizado|terminado|ended)$/i.test(t)) {
      return true;
    }

    // "Resultado Final" como parte do texto
    if (t.includes('resultado final') || t.includes('encerrado')) {
      return true;
    }

    return false;
  }

  // ─── Extrair info do jogo (times + placar) ──────────────────────────────────
  function extractGameInfo() {
    if (gameInfo) return gameInfo;

    // Buscar placar
    const scoreSelectors = [
      '[class*="ipe-EventViewDetail_ScoresContainer"]',
      '[class*="ml1-ScoreBoard"]',
      '[class*="ml1-Score"]',
    ];

    let score = '?-?';
    for (const sel of scoreSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const nums = el.textContent.match(/\b(\d{1,2})\b/g);
        if (nums && nums.length >= 2) {
          score = `${nums[0]}-${nums[1]}`;
          break;
        }
      }
    }

    // Buscar nomes dos times (do header)
    let home = 'Time A';
    let away = 'Time B';

    // Procurar textos no topo que parecem nomes de times
    const allEls = document.querySelectorAll('span, div');
    const teamCandidates = [];
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.top > 200) continue;
      if (el.children.length > 2) continue;
      const text = el.textContent.trim();
      if (text.length >= 3 && text.length <= 35 && !/^\d/.test(text) && !/^[\d:]+$/.test(text)) {
        const cls = (el.className || '').toString();
        if (/participant|team|name/i.test(cls)) {
          teamCandidates.push({ text, x: rect.left });
        }
      }
    }

    if (teamCandidates.length >= 2) {
      teamCandidates.sort((a, b) => a.x - b.x);
      home = teamCandidates[0].text;
      away = teamCandidates[teamCandidates.length - 1].text;
    }

    gameInfo = { home, away, score };
    return gameInfo;
  }

  // ─── Verificação periódica ──────────────────────────────────────────────────
  function check() {
    if (!isGamePage()) return;
    if (ftConfirmed) return; // Já notificou, esperando background fechar

    const timerText = readTimer();
    
    if (!timerText) {
      console.log(`${TAG} ⚠️ Timer não encontrado`);
      return;
    }

    if (isFinished(timerText)) {
      if (ftDetectedAt === 0) {
        // Primeira detecção!
        ftDetectedAt = Date.now();
        const info = extractGameInfo();
        console.log(`${TAG} 🏁 FT DETECTADO! Timer: "${timerText}" | ${info.home} ${info.score} ${info.away}`);
        console.log(`${TAG} ⏳ Aguardando ${CONFIRM_DELAY / 1000}s para confirmar...`);

        // Agendar confirmação
        setTimeout(() => {
          const timerRecheck = readTimer();
          if (isFinished(timerRecheck)) {
            // Confirmado!
            ftConfirmed = true;
            const finalInfo = extractGameInfo();
            console.log(`${TAG} ✅ FT CONFIRMADO! Timer: "${timerRecheck}" | ${finalInfo.home} ${finalInfo.score} ${finalInfo.away}`);
            
            // Notificar background
            chrome.runtime.sendMessage({
              type: 'GAME_ENDED',
              timerText: timerRecheck,
              home: finalInfo.home,
              away: finalInfo.away,
              score: finalInfo.score,
              confirmedAt: Date.now(),
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn(`${TAG} Erro ao notificar background:`, chrome.runtime.lastError);
                return;
              }
              console.log(`${TAG} 📤 Background notificado. Resposta:`, response);
            });
          } else {
            // Falso alarme (pode ter sido intervalo ou glitch)
            console.log(`${TAG} ⚠️ Recheck falhou. Timer agora: "${timerRecheck}". Falso alarme.`);
            ftDetectedAt = 0; // Reset
          }
        }, CONFIRM_DELAY);

      } else {
        // Já detectou, esperando confirmação
        const elapsed = Math.round((Date.now() - ftDetectedAt) / 1000);
        console.log(`${TAG} 🏁 FT ainda ativo (${elapsed}s desde detecção). Timer: "${timerText}"`);
      }
    } else {
      // Jogo em andamento
      if (ftDetectedAt > 0) {
        // Tinha detectado FT mas voltou? (glitch)
        console.log(`${TAG} ⚠️ Timer voltou ao normal: "${timerText}". Resetando detecção.`);
        ftDetectedAt = 0;
      }
    }
  }

  // ─── Verificar se a página ficou "vazia" (bet365 removeu o conteúdo) ────────
  function checkPageGone() {
    if (ftConfirmed) return;

    // Se a página mudou para a lista (saiu do jogo)
    const hash = window.location.hash || '';
    if (hash.includes('/IP/') && !hash.includes('/EV/') && !hash.includes('/C/')) {
      // Voltou para a lista de ao-vivo — jogo pode ter terminado
      console.log(`${TAG} 🔄 URL mudou para lista. Possível fim de jogo.`);
    }

    // Se o conteúdo de stats desapareceu
    if (!isGamePage()) {
      console.log(`${TAG} 📭 Página não é mais de jogo. Conteúdo removido?`);
      
      // Esperar 10s e verificar de novo
      setTimeout(() => {
        if (!isGamePage()) {
          ftConfirmed = true;
          console.log(`${TAG} ✅ Página deixou de ser jogo. Notificando background.`);
          chrome.runtime.sendMessage({
            type: 'GAME_ENDED',
            timerText: 'PAGE_GONE',
            home: gameInfo?.home || '?',
            away: gameInfo?.away || '?',
            score: gameInfo?.score || '?',
            confirmedAt: Date.now(),
          });
        }
      }, 10_000);
    }
  }

  // ─── Inicialização ──────────────────────────────────────────────────────────
  setTimeout(() => {
    if (!isGamePage()) {
      console.log(`${TAG} ⏸️ Não é página de jogo. EndDetector inativo.`);
      // Verificar periodicamente caso a página mude
      setInterval(() => {
        if (isGamePage() && !ftConfirmed) {
          console.log(`${TAG} 📡 Página virou jogo! Ativando detector.`);
        }
      }, 15_000);
      return;
    }

    console.log(`${TAG} 🔬 EndDetector ATIVO nesta aba de jogo`);
    
    // Extrair info do jogo logo no início
    setTimeout(() => {
      const info = extractGameInfo();
      console.log(`${TAG} 📋 Jogo: ${info.home} ${info.score} ${info.away}`);
      
      const timerText = readTimer();
      console.log(`${TAG} ⏱️ Timer atual: "${timerText}"`);
    }, 3000);

    // Iniciar checagem periódica
    setInterval(check, CHECK_INTERVAL);
    
    // Verificar se página sumiu (fallback)
    setInterval(checkPageGone, 30_000);

  }, STARTUP_DELAY);

})();
