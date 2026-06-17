/**
 * BestCorner Bridge — Content Script (Scanner)
 * 
 * Roda no domínio bestcornerstats.com e varre os dados ao vivo.
 */

(function () {
  'use strict';

  const SCAN_INTERVAL_MS = 5_000;
  const STORAGE_KEY_PREFIX = 'bestcorner_bridge_';

  // --- INTEGRAÇÃO SUPABASE CENTRAL (REST API) ---
  const SUPABASE_URL = 'https://kpldcqujhpcihpdlzpeh.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwbGRjcXVqaHBjaWhwZGx6cGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTIyMTAsImV4cCI6MjA5NTcyODIxMH0.zfpSeKGm-RF0bvbj-H-yVm4it9qZNzBOX7KjrjieGfs';
  const MASTER_USER_ID = 'master_' + Math.random().toString(36).substring(7); // Cada aba aberta terá um ID único de mestre
  const SOURCE = 'bestcorner';
  const isMasterCapturing = {}; // matchId -> boolean

  async function attemptTakeover(matchId) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/active_captures?fixture_id=eq.${matchId}&select=*`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await res.json();
      
      if (data && data.length > 0) {
        const capture = data[0];
        if (capture.status === 'active' && capture.master_user_id !== MASTER_USER_ID) {
          const lastUpdate = new Date(capture.updated_at).getTime();
          // Se o mestre original enviou update há menos de 3 min, não interfere
          if (Date.now() - lastUpdate < 3 * 60 * 1000) {
            isMasterCapturing[matchId] = false;
            return false; 
          }
        }
      }

      // Assumir
      await fetch(`${SUPABASE_URL}/rest/v1/active_captures`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          fixture_id: matchId,
          master_user_id: MASTER_USER_ID,
          source: SOURCE,
          status: 'active',
          updated_at: new Date().toISOString()
        })
      });

      isMasterCapturing[matchId] = true;
      return true;
    } catch (e) {
      console.error("[Bridge] Erro ao verificar Mestre:", e);
      return false;
    }
  }

  async function sendTelemetrySnapshot(match) {
    if (!isMasterCapturing[match.matchId]) return;

    const payload = {
      fixture_id: String(match.matchId),
      elapsed: match.elapsed,
      home_da: match.home.dangerousAttacks,
      away_da: match.away.dangerousAttacks,
      home_possession: match.home.possession,
      away_possession: match.away.possession,
      home_score: match.goalsHome,
      away_score: match.goalsAway,
      home_corners: match.home.corners,
      away_corners: match.away.corners,
      home_shots_on_goal: match.home.shotsOnGoal,
      away_shots_on_goal: match.away.shotsOnGoal,
      source: SOURCE
    };

    fetch(`${SUPABASE_URL}/rest/v1/telemetry_snapshots`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).catch(e => console.error("[Bridge] Erro ao salvar snapshot:", e));
  }
  // ----------------------------------------------

  function extractNumber(text) {
    if (!text) return 0;
    const match = text.match(/[\d\.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  function scanMatches() {
    try {
      const allScores = Array.from(document.querySelectorAll('.resultInPLay'));
      if (allScores.length === 0) {
        console.warn('[BestCorner Bridge] Nenhum placar (.resultInPLay) encontrado na página.');
        return;
      }

      const bridgeMatches = [];
      
      allScores.forEach((scoreEl, i) => {
        // Encontrar o container deste jogo específico. 
        // Subimos na árvore, mas paramos ANTES de pegar um container que tenha mais de 1 jogo.
        let gameCard = scoreEl.parentElement;
        let lastValidCard = gameCard;
        
        while (gameCard && gameCard.tagName !== 'BODY') {
          if (gameCard.querySelectorAll('.resultInPLay').length > 1) {
            // Opa, esse container tem mais de um jogo. O container correto era o anterior.
            gameCard = lastValidCard;
            break;
          }
          // Se esse container já abrange pelo menos 2 teamNames, é um ótimo candidato
          if (gameCard.querySelectorAll('.teamName').length >= 2) {
             // Vamos salvar e subir mais um pouco só pra ver se não quebra a regra de > 1 placar
             lastValidCard = gameCard;
          } else {
             lastValidCard = gameCard;
          }
          gameCard = gameCard.parentElement;
        }
        
        if (!gameCard || gameCard === document.body) {
           gameCard = lastValidCard; // fallback
        }

        // Se mesmo assim o gameCard tiver < 2 times, vamos usar o index matemático global (fallback infalível)
        const teamsInCard = Array.from(gameCard.querySelectorAll('.teamName'));
        
        const allTeamNames = Array.from(document.querySelectorAll('.teamName'));
        
        let homeTeamName = "";
        let awayTeamName = "";

        if (teamsInCard.length >= 2) {
          homeTeamName = teamsInCard[0].innerText.trim();
          awayTeamName = teamsInCard[1].innerText.trim();
        } else if (allTeamNames.length >= (i * 2 + 2)) {
          homeTeamName = allTeamNames[i * 2].innerText.trim();
          awayTeamName = allTeamNames[i * 2 + 1].innerText.trim();
        } else {
          return; // Falha total em achar os times
        }

        let goalsHome = 0;
        let goalsAway = 0;
        const scoreMatch = scoreEl.innerText.match(/(\d+)\s*[Xx-]\s*(\d+)/i);
        if (scoreMatch) {
          goalsHome = parseInt(scoreMatch[1], 10);
          goalsAway = parseInt(scoreMatch[2], 10);
        }

        // Tempo e Liga
        let elapsed = 0;
        let leagueName = "";
        let aTag = scoreEl.closest('a');
        if (aTag && aTag.parentElement && aTag.parentElement.previousElementSibling) {
           let timerRow = aTag.parentElement.previousElementSibling;
           let timerEls = timerRow.querySelectorAll('.timerPlay');
           if (timerEls.length > 0) {
               elapsed = parseInt(timerEls[0].innerText.replace(/\D/g, ''), 10) || 0;
           }
           if (timerEls.length > 1) {
               leagueName = timerEls[1].innerText.trim();
           }
        }

        const stats = {
          home: { corners: 0, dangerousAttacks: 0, totalShots: 0, shotsOnGoal: 0, shotsOffGoal: 0, yellowCards: 0, redCards: 0, possession: 50 },
          away: { corners: 0, dangerousAttacks: 0, totalShots: 0, shotsOnGoal: 0, shotsOffGoal: 0, yellowCards: 0, redCards: 0, possession: 50 },
        };

        const allDomElements = Array.from(document.querySelectorAll('*'));
        const scoreDomIndex = allDomElements.indexOf(scoreEl);

        function findStat(labelSubstring, statKey, isFloat = false) {
          let closestLabelEl = null;
          let minDistance = Infinity;
          
          allDomElements.forEach((el, idx) => {
             if (el.children.length === 0 && typeof el.textContent === 'string' && el.textContent.trim().toLowerCase().includes(labelSubstring.toLowerCase())) {
                 const dist = Math.abs(idx - scoreDomIndex);
                 if (dist < 800 && dist < minDistance) {
                     minDistance = dist;
                     closestLabelEl = el;
                 }
             }
          });

          if (closestLabelEl) {
             const labelIndex = allDomElements.indexOf(closestLabelEl);
             let nums = [];
             for(let k = Math.max(0, labelIndex - 200); k < Math.min(allDomElements.length, labelIndex + 200); k++) {
                 const node = allDomElements[k];
                 if (node.children.length === 0 && typeof node.textContent === 'string') {
                     const txt = node.textContent.trim();
                     // Matches numbers, optionally with decimals, and optionally followed by / and another number
                     if (/^[\d\.]+(?:\s*\/\s*[\d\.]+)?$/.test(txt)) {
                         // Se tiver barra (ex: "59 / 14"), pegamos o primeiro número (FT)
                         const valToUse = txt.includes('/') ? txt.split('/')[0].trim() : txt;
                         nums.push({ val: valToUse, domIndex: k, rawTxt: txt });
                     }
                 }
             }
             nums.sort((a,b) => a.domIndex - b.domIndex);
             const closestNums = nums.sort((a,b) => Math.abs(a.domIndex - labelIndex) - Math.abs(b.domIndex - labelIndex)).slice(0, 2);
             closestNums.sort((a,b) => a.domIndex - b.domIndex);
             
             if (closestNums.length >= 2) {
                 stats.home[statKey] = isFloat ? parseFloat(closestNums[0].val) || 0 : parseInt(closestNums[0].val, 10) || 0;
                 stats.away[statKey] = isFloat ? parseFloat(closestNums[1].val) || 0 : parseInt(closestNums[1].val, 10) || 0;
                 
                 // --- VISUAL DELIMITATION ---
                 try {
                     const homeEl = allDomElements[closestNums[0].domIndex];
                     const awayEl = allDomElements[closestNums[1].domIndex];
                     if (homeEl) {
                         homeEl.style.border = '2px dashed #00ff66';
                         homeEl.title = `Home ${statKey}: ${closestNums[0].rawTxt}`;
                     }
                     if (awayEl) {
                         awayEl.style.border = '2px dashed #00ff66';
                         awayEl.title = `Away ${statKey}: ${closestNums[1].rawTxt}`;
                     }
                     if (closestLabelEl) {
                         closestLabelEl.style.border = '1px solid #a855f7';
                         closestLabelEl.title = `Label: ${statKey}`;
                     }
                 } catch (e) {}
             }
          }
        }

        findStat('Ataques Perigosos', 'dangerousAttacks');
        findStat('XC / XG', 'xg', true);
        
        // --- REMOVIDO A LEITURA DE ATMs (A pedido do usuario, o Radar vai calcular localmente) ---
        // findStat('Indice de', 'apmGlobal', true);
        // findStat('Atm(Jogo Todo)', 'apmGlobal', true);
        // findStat('Atm10', 'apm10', true);
        // findStat('Atm5', 'apm5', true);

        let startIndex = scoreDomIndex;
        let endIndex = allDomElements.length;
        if (i < allScores.length - 1) {
            endIndex = allDomElements.indexOf(allScores[i + 1]);
        }
        let gameDomEls = allDomElements.slice(startIndex, endIndex);

        // --- NOVA LÓGICA: Ler do FLIP CARD (Novo Layout) ---
        function extractFlipCardStat(labelText, isFloat = false) {
            const labelEl = gameDomEls.find(el => 
                el.textContent && 
                el.textContent.includes(labelText) && 
                el.children.length === 0 &&
                el.closest('.flip-card-inner') // OBRIGA a buscar dentro do flip card!
            );
            if (labelEl) {
                const labelRow = labelEl.closest('.row');
                if (labelRow && labelRow.nextElementSibling) {
                    const valRow = labelRow.nextElementSibling;
                    const spans = valRow.querySelectorAll('span');
                    if (spans.length >= 2) {
                        const parseVal = (txt) => {
                            if (!txt) return 0;
                            // Lida com "FT / HT" pegando o primeiro número (FT)
                            const valToUse = txt.includes('/') ? txt.split('/')[0].trim() : txt;
                            return isFloat ? parseFloat(valToUse) || 0 : parseInt(valToUse, 10) || 0;
                        };
                        return {
                            home: parseVal(spans[0].textContent),
                            away: parseVal(spans[spans.length - 1].textContent)
                        };
                    }
                }
            }
            return null;
        }

        const flipDA = extractFlipCardStat('Ataques Perigosos');
        if (flipDA) {
            stats.home.dangerousAttacks = flipDA.home;
            stats.away.dangerousAttacks = flipDA.away;
        } else {
            findStat('Ataques Perigosos', 'dangerousAttacks');
        }

        const flipXG = extractFlipCardStat('XC / XG', true);
        if (flipXG) {
            stats.home.xg = flipXG.home;
            stats.away.xg = flipXG.away;
        } else {
            findStat('XC / XG', 'xg', true);
        }

        const flipCG = extractFlipCardStat('CG');
        if (flipCG) {
            stats.home.shotsOnGoal = flipCG.home;
            stats.away.shotsOnGoal = flipCG.away;
        }

        const flipChutes = extractFlipCardStat('Chutes');
        if (flipChutes) {
            stats.home.shotsOffGoal = flipChutes.home;
            stats.away.shotsOffGoal = flipChutes.away;
        }

        let noAlvoEl = gameDomEls.find(el => el.children.length === 0 && typeof el.textContent === 'string' && el.textContent.trim().toLowerCase().includes('no alvo'));
        let aoLadoEl = gameDomEls.find(el => el.children.length === 0 && typeof el.textContent === 'string' && el.textContent.trim().toLowerCase().includes('ao lado'));

        // --- EXTRAÇÃO DA ABA EVENTS ---
        const pastEvents = [];
        try {
            // Find the "EVENTS" header
            let eventsHeader = gameDomEls.find(el => el.textContent && el.textContent.trim().endsWith('EVENTS') && el.children.length <= 1);
            if (eventsHeader) {
                let container = eventsHeader.parentElement;
                // subimos alguns níveis para achar a caixa que contém as linhas do evento
                for(let k=0; k<4; k++) {
                    if (container && (container.textContent.includes('Canto') || container.textContent.includes('Cartão') || container.textContent.includes('Chute'))) {
                        break;
                    }
                    if (container && container.parentElement) container = container.parentElement;
                }
                
                if (container) {
                    const lines = container.innerText.split('\n').map(l => l.trim()).filter(l => l);
                    lines.forEach(line => {
                        const match = line.replace(/\n/g, ' ').match(/^(\d+)\s+(.+)$/);
                        if (match) {
                            const elapsed = parseInt(match[1], 10);
                            const desc = match[2].toLowerCase();
                            
                            let type = null;
                            if (desc.includes('canto') || desc.includes('escanteio')) type = 'corner';
                            else if (desc.includes('gol') && !desc.includes('chute')) type = 'goal'; // "Chute Gol" is SoG
                            else if (desc.includes('vermelho')) type = 'red_card';
                            else if (desc.includes('cartão') || desc.includes('amarelo')) type = 'yellow_card';
                            
                            if (type) {
                                let side = 'home';
                                const hLower = homeTeamName.toLowerCase();
                                const aLower = awayTeamName.toLowerCase();
                                // simple side detection
                                if (desc.includes(hLower)) side = 'home';
                                else if (desc.includes(aLower)) side = 'away';
                                else {
                                    // fallback by words
                                    const words = desc.split(' ');
                                    const lastWord = words[words.length - 1];
                                    if (hLower.includes(lastWord)) side = 'home';
                                    else if (aLower.includes(lastWord)) side = 'away';
                                }
                                
                                if (!pastEvents.some(e => e.elapsed === elapsed && e.type === type && e.side === side)) {
                                    pastEvents.push({ elapsed, type, side, text: match[0] });
                                }
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[BestCorner Bridge] Error parsing events:', e);
        }
        stats.pastEvents = pastEvents;

        if (noAlvoEl && aoLadoEl) {
            let noAlvoIndexInGame = gameDomEls.indexOf(noAlvoEl);
            let aoLadoIndexInGame = gameDomEls.indexOf(aoLadoEl);

            // Coletar infoLabels ANTES do No Alvo (Home stats)
            let homeLabels = [];
            for (let k = noAlvoIndexInGame - 1; k >= 0; k--) {
                const el = gameDomEls[k];
                if (el && typeof el.className === 'string' && el.className.includes('infoLabels')) {
                    homeLabels.push({ el, val: el.textContent.trim() });
                }
                if (homeLabels.length === 5) break; 
            }

            // Coletar infoLabels DEPOIS do Ao Lado (Away stats)
            let awayLabels = [];
            for (let k = aoLadoIndexInGame + 1; k < gameDomEls.length; k++) {
                const el = gameDomEls[k];
                if (el && typeof el.className === 'string' && el.className.includes('infoLabels')) {
                    awayLabels.push({ el, val: el.textContent.trim() });
                }
                if (awayLabels.length === 5) break; 
            }

            if (homeLabels.length >= 5) {
                // homeLabels normais lidos de trás pra frente do "No Alvo": 
                // [0] Ao Lado (SoF), [1] No Alvo (SoG), [2] Yellow, [3] Red, [4] Corners
                stats.home.shotsOffGoal = parseInt(homeLabels[0]?.el?.textContent, 10) || 0;
                stats.home.shotsOnGoal = parseInt(homeLabels[1]?.el?.textContent, 10) || 0;
                stats.home.yellowCards = parseInt(homeLabels[2]?.el?.textContent, 10) || 0;
                stats.home.redCards = parseInt(homeLabels[3]?.el?.textContent, 10) || 0;
                stats.home.corners = parseInt(homeLabels[4]?.el?.textContent, 10) || 0;
                
                // VISUAL DELIMITATION
                try {
                    ['SoF', 'SoG', 'YC', 'RC', 'Cor'].forEach((lbl, i) => {
                        if (homeLabels[i]?.el) {
                            homeLabels[i].el.style.border = '2px solid #3b82f6';
                            homeLabels[i].el.title = `Home ${lbl}: ${homeLabels[i].el.textContent.trim()}`;
                        }
                    });
                } catch (e) {}
            }

            if (awayLabels.length >= 5) {
                // awayLabels normais: [0] No Alvo, [1] Ao Lado, [2] Yellow, [3] Red, [4] Corners
                stats.away.shotsOnGoal = parseInt(awayLabels[0]?.el?.textContent, 10) || 0;
                stats.away.shotsOffGoal = parseInt(awayLabels[1]?.el?.textContent, 10) || 0;
                stats.away.yellowCards = parseInt(awayLabels[2]?.el?.textContent, 10) || 0;
                stats.away.redCards = parseInt(awayLabels[3]?.el?.textContent, 10) || 0;
                stats.away.corners = parseInt(awayLabels[4]?.el?.textContent, 10) || 0;
                
                // VISUAL DELIMITATION
                try {
                    ['SoG', 'SoF', 'YC', 'RC', 'Cor'].forEach((lbl, i) => {
                        if (awayLabels[i]?.el) {
                            awayLabels[i].el.style.border = '2px solid #ef4444';
                            awayLabels[i].el.title = `Away ${lbl}: ${awayLabels[i].el.textContent.trim()}`;
                        }
                    });
                } catch (e) {}
            }

            stats.home.totalShots = stats.home.shotsOnGoal + stats.home.shotsOffGoal;
            stats.away.totalShots = stats.away.shotsOnGoal + stats.away.shotsOffGoal;
        } else {
            console.warn(`[BestCorner Bridge] Jogo ${homeTeamName}: Faltou âncora No Alvo/Ao Lado.`);
        }

        const matchId = `match_${homeTeamName.replace(/\s+/g,'')}_${awayTeamName.replace(/\s+/g,'')}`;

        const matchData = {
          matchId: matchId,
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          matchUrl: '', // DO NOT use window.location.href, as it's the same for all matches on the scanner page
          leagueName: leagueName,
          elapsed: elapsed,
          period: elapsed > 45 ? '2H' : '1H',
          goalsHome: goalsHome,
          goalsAway: goalsAway,
          home: stats.home,
          away: stats.away,
          timestamp: Date.now()
        };

        bridgeMatches.push(matchData);
      });

      if (bridgeMatches.length > 0) {
        const payload = {};
        bridgeMatches.forEach(m => {
          const cleanHome = m.homeTeam.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const cleanAway = m.awayTeam.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const uniqueKey = `${STORAGE_KEY_PREFIX}${cleanHome}_${cleanAway}`;
          payload[uniqueKey] = m;

          // --- SUPABASE SYNC ---
          if (isMasterCapturing[m.matchId] === undefined) {
            attemptTakeover(m.matchId).then(() => {
              sendTelemetrySnapshot(m);
            });
          } else {
            sendTelemetrySnapshot(m);
          }
          // ---------------------
        });

        // --- SUPABASE: DETECTAR FIM DE JOGO (Jogo sumiu da tela) ---
        const currentlyActiveMatchIds = bridgeMatches.map(m => m.matchId);
        Object.keys(isMasterCapturing).forEach(id => {
          if (isMasterCapturing[id] && !currentlyActiveMatchIds.includes(id)) {
            fetch(`${SUPABASE_URL}/rest/v1/active_captures?fixture_id=eq.${id}`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
            }).then(() => {
              delete isMasterCapturing[id];
              console.log(`[Bridge] Partida ${id} sumiu e foi marcada como finalizada no Supabase.`);
            });
          }
        });
        // -----------------------------------------------------------

        // Clear old storage before setting new to avoid ghost matches?
        // Let's just set. The bridge handles timestamps.
        chrome.storage.local.set(payload);
        console.log(`[BestCorner Bridge] Encontrados ${bridgeMatches.length} jogos.`);
      }

    } catch (err) {
      console.error('[BestCorner Bridge] Erro:', err);
    }
  }

  setInterval(scanMatches, SCAN_INTERVAL_MS);
  setTimeout(scanMatches, 2000);
  console.log('[BestCorner Bridge Scanner] Iniciado com novos seletores.');

})();
