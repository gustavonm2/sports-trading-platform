/**
 * Bet365 Bridge — Content Script v1.2
 * 
 * Parser REESCRITO para o layout real da Bet365 Brasil.
 * 
 * Abordagem: Em vez de varrer TODOS os textos da página (que pegava odds, xG etc),
 * agora busca ESPECIFICAMENTE os containers de estatísticas.
 * 
 * Layout da Bet365 (seção "Estat."):
 *   Label: "Ataques Perigosos"
 *   Abaixo: [homeValue] [icon] [awayValue]
 * 
 * Cada stat está em seu próprio container com label + 2 valores numéricos.
 */

(function () {
  'use strict';

  const SCAN_INTERVAL_MS = 8_000;
  const STORAGE_KEY_PREFIX = 'bet365_bridge_';

  // Labels conhecidos → campo interno
  const STAT_LABELS = {
    // Ataques — múltiplas variações da Bet365 BR
    'ataques': 'attacks',
    'ataques totais': 'attacks',
    'total de ataques': 'attacks',
    'attacks': 'attacks',
    'total attacks': 'attacks',
    // Ataques Perigosos
    'ataques perigosos': 'dangerousAttacks',
    'ataques a gol': 'dangerousAttacks',
    'ataques ao gol': 'dangerousAttacks',
    'dangerous attacks': 'dangerousAttacks',
    // Chutes ao gol
    'chutes ao gol': 'shotsOnGoal',
    'chutes a gol': 'shotsOnGoal',
    'chutes no gol': 'shotsOnGoal',
    'chutes ao alvo': 'shotsOnGoal',
    'chutes a alvo': 'shotsOnGoal',
    'shots on target': 'shotsOnGoal',
    // Chutes fora
    'chutes fora do gol': 'shotsOffGoal',
    'chutes fora': 'shotsOffGoal',
    'chutes para fora': 'shotsOffGoal',
    'chutes fora do alvo': 'shotsOffGoal',
    'shots off target': 'shotsOffGoal',
    // Escanteios
    'escanteios': 'corners',
    'cantos': 'corners',
    'canto': 'corners',
    'corners': 'corners',
    // Posse de bola
    'posse de bola': 'possession',
    '% de posse': 'possession',
    'de posse': 'possession',
    'possession': 'possession',
    'ball possession': 'possession',
    // Cartões
    'cartões': 'yellowCards',
    'cartoes': 'yellowCards',
    'cartões amarelos': 'yellowCards',
    'cartoes amarelos': 'yellowCards',
    'yellow cards': 'yellowCards',
    'cartões vermelhos': 'redCards',
    'cartoes vermelhos': 'redCards',
    'red cards': 'redCards',
    // Finalizações/Chutes
    'total de chutes': 'totalShots',
    'finalizações': 'totalShots',
    'finalizacoes': 'totalShots',
    'finalizacoes / chutes ao gol': 'totalShots',
    'finalizações / chutes ao gol': 'totalShots',
    'total shots': 'totalShots',
    // Outros
    'chutes bloqueados': 'blockedShots',
    'chutes dentro da área': 'shotsInsideBox',
    'chutes dentro da area': 'shotsInsideBox',
    'faltas': 'fouls',
    'faltas cometidas': 'fouls',
    'fouls': 'fouls',
    'impedimentos': 'offsides',
    'offsides': 'offsides',
    'defesas do goleiro': 'goalkeeperSaves',
    'defesas goleiro': 'goalkeeperSaves',
    'goalkeeper saves': 'goalkeeperSaves',
    'tiros de meta': 'goalKicks',
    'arremessos laterais': 'throwIns',
  };

  // Limites razoáveis para validar dados
  const STAT_MAX = {
    attacks: 300,
    dangerousAttacks: 200,
    shotsOnGoal: 50,
    shotsOffGoal: 50,
    corners: 30,
    possession: 100,
    yellowCards: 15,
    redCards: 5,
    totalShots: 80,
    blockedShots: 40,
    shotsInsideBox: 50,
    fouls: 50,
    offsides: 20,
    goalkeeperSaves: 30,
    goalKicks: 30,
    throwIns: 60,
  };

  function normalizeLabel(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[%:]/g, '')
      .trim();
  }

  function matchStatLabel(text) {
    const normalized = normalizeLabel(text);
    if (!normalized || normalized.length < 3 || normalized.length > 40) return null;
    
    // Rejeitar textos que são claramente NÃO labels de stat
    if (/\d/.test(normalized)) return null;
    // Rejeitar abas de navegação que contém nomes de stats (ex: "Escanteios/Cartões")
    if (normalized.includes('escanteios/') || normalized.includes('cartoes/') || normalized.includes('cartões/')) return null;
    if (normalized.includes('resultado') || normalized.includes('chance') || 
        (normalized.includes('gol') && !normalized.includes('chutes') && !normalized.includes('goleiro') && !normalized.includes('finalizac')) ||
        normalized.includes('mais de') || normalized.includes('menos de') ||
        normalized.includes('empate') || normalized.includes('login') ||
        normalized.includes('registre') || normalized.includes('odds') ||
        normalized.includes('popular') || normalized.includes('criar aposta') ||
        normalized.includes('tempo')) {
      return null;
    }
    
    // Match direto
    if (STAT_LABELS[normalized]) return STAT_LABELS[normalized];
    
    // Match parcial (label é substring do texto)
    for (const [label, field] of Object.entries(STAT_LABELS)) {
      if (normalized === label) return field;
    }
    
    // Match mais flexível: texto contém o label inteiro
    for (const [label, field] of Object.entries(STAT_LABELS)) {
      if (label.length >= 5 && normalized.includes(label)) return field;
    }
    
    return null;
  }

  /**
   * Extrai tokens de valores do texto, suportando frações (como 6/3, 0/0) e números simples.
   */
  function extractValuesFromText(text) {
    const tokens = text.match(/(\d+\s*[\/\\-]\s*\d+|\d+)/g) || [];
    return tokens.map(t => t.trim().replace(/\s+/g, ''));
  }

  /**
   * Verifica se o container possui outros labels de estatísticas, 
   * evitando subir para elementos globais que mesclem estatísticas de outros blocos.
   */
  function containsOtherLabels(container, currentLabelNormalized, currentFieldName) {
    const text = normalizeLabel(container.textContent || '');
    for (const [label, field] of Object.entries(STAT_LABELS)) {
      const norm = normalizeLabel(label);
      // Evitar considerar o próprio label ou variações dele (ex: "ataques" dentro de "ataques perigosos")
      if (currentLabelNormalized.includes(norm) || norm.includes(currentLabelNormalized)) {
        continue;
      }
      // Se ambos forem campos de chute (totalShots, shotsOnGoal, shotsOffGoal), não consideramos como "outro label"
      const isCurrentShots = (currentFieldName === 'totalShots' || currentFieldName === 'shotsOnGoal' || currentFieldName === 'shotsOffGoal');
      const isOtherShots = (field === 'totalShots' || field === 'shotsOnGoal' || field === 'shotsOffGoal');
      if (isCurrentShots && isOtherShots) {
        continue;
      }
      // Se ambos forem campos de cartão (yellowCards, redCards), não consideramos como "outro label"
      const isCurrentCards = (currentFieldName === 'yellowCards' || currentFieldName === 'redCards');
      const isOtherCards = (field === 'yellowCards' || field === 'redCards');
      if (isCurrentCards && isOtherCards) {
        continue;
      }
      if (text.includes(norm)) {
        return true;
      }
    }
    return false;
  }

  function highlightElement(el) {
    if (!el) return;
    try {
      el.style.border = '2px dashed #00ff66';
      el.style.boxShadow = '0 0 6px rgba(0, 255, 102, 0.4)';
      el.setAttribute('data-bridge-highlighted', 'true');
    } catch (e) {}
  }

  function highlightStatWithColor(container, fieldName, values) {
    if (!container || !values) return;
    try {
      container.setAttribute('data-bridge-highlighted', 'true');
      
      let color = '#10b981'; // Verde padrão
      let label = fieldName;
      
      if (fieldName === 'attacks') {
        container.style.border = '2px solid #6b7280';
        container.style.boxShadow = '0 0 6px rgba(107, 114, 128, 0.4)';
        color = '#6b7280';
        label = `Ataques: ${values[0]} | ${values[1]}`;
      } else if (fieldName === 'dangerousAttacks') {
        container.style.border = '2px solid #3b82f6'; // Azul claro
        container.style.boxShadow = '0 0 6px rgba(59, 130, 246, 0.4)';
        color = '#3b82f6';
        label = `AP: ${values[0]} | ${values[1]}`;
      } else if (fieldName === 'possession') {
        container.style.border = '2px solid #a855f7'; // Roxo
        container.style.boxShadow = '0 0 6px rgba(168, 85, 247, 0.4)';
        color = '#a855f7';
        label = `Posse: ${values[0]}% | ${values[1]}%`;
      } else {
        container.style.border = '2px dashed #10b981';
        container.style.boxShadow = '0 0 6px rgba(16, 185, 129, 0.4)';
        label = `${fieldName}: ${values[0]} v ${values[1]}`;
      }
      
      addDebugBadge(container, label, color, 'top');
    } catch (e) {}
  }

  function addDebugBadge(element, text, color, position = 'top') {
    if (!element) return;
    try {
      const existing = element.querySelector('.bridge-debug-badge');
      if (existing) {
        existing.remove();
      }
      
      const badge = document.createElement('div');
      badge.className = 'bridge-debug-badge';
      badge.textContent = text;
      badge.style.position = 'absolute';
      badge.style.backgroundColor = color;
      badge.style.color = '#fff';
      badge.style.fontSize = '9px';
      badge.style.fontWeight = 'bold';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '3px';
      badge.style.zIndex = '9999';
      badge.style.pointerEvents = 'none';
      badge.style.fontFamily = 'Inter, sans-serif';
      badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5)';
      badge.style.whiteSpace = 'nowrap';
      
      if (window.getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
      }
      
      if (position === 'top') {
        badge.style.top = '-16px';
        badge.style.left = '50%';
        badge.style.transform = 'translateX(-50%)';
      } else {
        badge.style.bottom = '-16px';
        badge.style.left = '50%';
        badge.style.transform = 'translateX(-50%)';
      }
      
      element.appendChild(badge);
    } catch (e) {}
  }

  function clearHighlights() {
    try {
      const highlighted = document.querySelectorAll('[data-bridge-highlighted="true"]');
      for (const el of highlighted) {
        el.style.border = '';
        el.style.boxShadow = '';
        el.removeAttribute('data-bridge-highlighted');
      }
      const badges = document.querySelectorAll('.bridge-debug-badge');
      for (const b of badges) {
        b.remove();
      }
    } catch (e) {}
  }

  /**
   * Busca o placar do jogo no DOM da Bet365.
   * NÃO depende dos nomes dos times — usa seletores de classes e posição no DOM.
   * Também tenta extrair os nomes dos times do mesmo cabeçalho.
   */
  function findScoreElements(homeName, awayName, teamNames) {
    // ─── Estratégia 1: Seletores específicos Bet365 ───
    const scoreSelectors = [
      // Classes conhecidas do header de evento da Bet365
      '[class*="ipe-EventViewDetail_ScoresContainer"]',
      '[class*="ipe-EventHeader"] [class*="score" i]',
      '[class*="ml1-ScoreBoard"]',
      '[class*="ml1-Score"]',
      '[class*="ScoreBoard"]',
      '[class*="MatchScore"]',
      '[class*="ipe-SummaryHeader_Score"]',
      '[class*="ipe-SummaryHeader_MatchScore"]',
    ];
    
    for (const sel of scoreSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.innerText || el.textContent || '').trim();
          const nums = text.match(/\b(\d{1,2})\b/g);
          if (nums && nums.length >= 2) {
            console.log(`[Bet365 Bridge] ⚽ Score via selector "${sel}": "${text}" → [${nums.join(', ')}]`);
            
            // Tentar extrair nomes dos times do container pai
            if (teamNames) {
              tryExtractTeamNamesFromScoreArea(el, teamNames);
            }
            
            return {
              container: el,
              homeScore: parseInt(nums[0], 10),
              awayScore: parseInt(nums[1], 10)
            };
          }
        }
      } catch (e) {}
    }
    
    // ─── Estratégia 2: Procurar pares de números grandes isolados no topo da página ───
    // Bet365 coloca o placar em elementos separados (um para cada gol)
    const allElements = document.querySelectorAll('div, span');
    const scoreCandidates = [];
    
    for (const el of allElements) {
      try {
        const rect = el.getBoundingClientRect();
        // Só considerar elementos no topo da página (header do jogo)
        if (rect.top > 250 || rect.top < 0) continue;
        if (rect.width < 10 || rect.height < 10) continue;
        
        const text = (el.textContent || '').trim();
        // Procurar elementos que contenham apenas um número de 1-2 dígitos
        if (/^\d{1,2}$/.test(text)) {
          const fontSize = parseFloat(window.getComputedStyle(el).fontSize) || 12;
          // O placar geralmente tem fonte grande (>= 16px)
          if (fontSize >= 14) {
            scoreCandidates.push({
              el,
              num: parseInt(text, 10),
              x: rect.left,
              y: rect.top,
              fontSize
            });
          }
        }
      } catch (e) {}
    }
    
    // Agrupar candidatos por proximidade vertical (mesma linha ≈ mesmo Y)
    if (scoreCandidates.length >= 2) {
      // Ordenar por Y, depois por X
      scoreCandidates.sort((a, b) => a.y - b.y || a.x - b.x);
      
      for (let i = 0; i < scoreCandidates.length - 1; i++) {
        const left = scoreCandidates[i];
        const right = scoreCandidates[i + 1];
        
        // Devem estar na mesma linha (diferença Y < 20px) e separados horizontalmente
        if (Math.abs(left.y - right.y) < 20 && right.x - left.x > 20 && right.x - left.x < 500) {
          console.log(`[Bet365 Bridge] ⚽ Score via posição: ${left.num} - ${right.num} (y=${Math.round(left.y)}, fontSize=${left.fontSize}px)`);
          
          // Encontrar o container comum
          let container = findCommonParent(left.el, right.el);
          
          if (teamNames) {
            tryExtractTeamNamesFromScoreArea(container || left.el.parentElement, teamNames);
          }
          
          return {
            container: container || left.el.parentElement,
            homeScore: left.num,
            awayScore: right.num
          };
        }
      }
    }
    
    // ─── Estratégia 3: Buscar container com padrão "N - N" ou "N  N" no header ───
    const headerSelectors = [
      '[class*="ipe-EventViewDetail"]',
      '[class*="EventHeader"]',
      '[class*="MatchHeader"]',
      '[class*="ml1-Header"]',
    ];
    
    for (const sel of headerSelectors) {
      try {
        const header = document.querySelector(sel);
        if (!header) continue;
        
        const text = (header.innerText || '').trim();
        const scoreMatch = text.match(/(\d{1,2})\s*[-–—:]\s*(\d{1,2})/);
        if (scoreMatch) {
          console.log(`[Bet365 Bridge] ⚽ Score via header "${sel}": ${scoreMatch[1]} - ${scoreMatch[2]}`);
          
          if (teamNames) {
            tryExtractTeamNamesFromScoreArea(header, teamNames);
          }
          
          return {
            container: header,
            homeScore: parseInt(scoreMatch[1], 10),
            awayScore: parseInt(scoreMatch[2], 10)
          };
        }
      } catch (e) {}
    }
    
    console.log('[Bet365 Bridge] ⚽ Placar NÃO encontrado em nenhuma estratégia');
    return null;
  }

  /**
   * Encontra o container pai comum de dois elementos
   */
  function findCommonParent(el1, el2) {
    const parents1 = [];
    let p = el1;
    while (p) {
      parents1.push(p);
      p = p.parentElement;
    }
    p = el2;
    while (p) {
      if (parents1.includes(p)) return p;
      p = p.parentElement;
    }
    return null;
  }

  /**
   * Tenta extrair nomes dos times a partir da área do placar
   */
  function tryExtractTeamNamesFromScoreArea(scoreEl, teamNames) {
    if (teamNames.home && teamNames.away) return; // Já tem nomes
    
    try {
      // Subir até encontrar um container que tenha os nomes dos times
      let container = scoreEl;
      for (let i = 0; i < 5; i++) {
        if (!container || !container.parentElement) break;
        container = container.parentElement;
        
        const text = (container.innerText || '').trim();
        // Procurar padrão "Time A   N - N   Time B" ou "Time A\nN\nN\nTime B"
        const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
        
        // Procurar linhas que NÃO são números e que parecem nomes de times
        const nonNumericLines = lines.filter(l => !/^\d{1,2}$/.test(l) && l.length >= 3 && l.length <= 35 && !/^\d+['′:]/.test(l));
        
        if (nonNumericLines.length >= 2) {
          // Procurar o padrão: textos antes e depois do placar
          const scoreIdx = lines.findIndex(l => /^\d{1,2}$/.test(l));
          if (scoreIdx > 0) {
            // Nome do time da casa: linha(s) antes do placar
            const homeCandidates = lines.slice(0, scoreIdx).filter(l => !/^\d{1,2}$/.test(l) && l.length >= 3);
            // Nome do time de fora: linha(s) depois do placar
            const lastScoreIdx = lines.length - 1 - [...lines].reverse().findIndex(l => !/^\d{1,2}$/.test(l) && l.length >= 3);
            const awayCandidates = lines.slice(scoreIdx).filter(l => !/^\d{1,2}$/.test(l) && l.length >= 3);
            
            if (homeCandidates.length > 0 && awayCandidates.length > 0) {
              teamNames.home = homeCandidates[homeCandidates.length - 1].substring(0, 30);
              teamNames.away = awayCandidates[0].substring(0, 30);
              console.log(`[Bet365 Bridge] 👥 Times extraídos do header: "${teamNames.home}" vs "${teamNames.away}"`);
              return;
            }
          }
        }
      }
    } catch (e) {}
  }

  function highlightScore(scoreData) {
    if (!scoreData || !scoreData.container) return;
    try {
      const el = scoreData.container;
      el.style.border = '2px solid #ef4444'; // Caixa vermelha para o placar
      el.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
      el.style.borderRadius = '4px';
      el.setAttribute('data-bridge-highlighted', 'true');
      addDebugBadge(el, `Placar: ${scoreData.homeScore} - ${scoreData.awayScore}`, '#ef4444', 'top');
    } catch (e) {}
  }

  /**
   * Analisa a linha composta contendo cantos, cartões e chutes (ex: "5 0 2 Finalizações 7/2 12/2 1 0 2")
   * Usa navegação por filhos diretos do container para evitar erros de concatenação de texto.
   * 
   * Layout Bet365:
   *   Coluna Esquerda (Home):  Cantos | Red | Yellow  →  números da esquerda para direita
   *   Coluna Central:          Finalizações / Chutes ao Gol  →  fração home / fração away
   *   Coluna Direita (Away):   Yellow | Red | Cantos  →  números da esquerda para direita
   */
  function parseCompositeRow(labelEl) {
    let container = labelEl.parentElement;
    
    for (let level = 0; level < 5; level++) {
      if (!container) break;
      
      // Se o container contiver outros labels de stat (ataques, posse), recusa subir mais
      if (containsOtherLabels(container, normalizeLabel(labelEl.textContent || ''), 'totalShots')) {
        break;
      }
      
      const children = Array.from(container.children || []);
      
      // Precisamos de pelo menos 3 filhos diretos (coluna esquerda, centro, coluna direita)
      if (children.length < 3) {
        container = container.parentElement;
        continue;
      }
      
      // Identificar as 3 colunas
      const leftCol = children[0];
      const rightCol = children[children.length - 1];
      
      // A coluna do meio é o filho que contém o label de finalizações
      let midCol = null;
      for (let i = 1; i < children.length - 1; i++) {
        const childText = normalizeLabel(children[i].innerText || children[i].textContent || '');
        if (childText.includes('finaliza') || childText.includes('chutes') || childText.includes('shots')) {
          midCol = children[i];
          break;
        }
      }
      
      if (!midCol) {
        container = container.parentElement;
        continue;
      }
      
      // Extrair frações da coluna central
      const midText = midCol.innerText || midCol.textContent || '';
      const midTokens = extractValuesFromText(midText);
      const fractions = midTokens.filter(t => t.includes('/') || t.includes('\\'));
      
      if (fractions.length < 2) {
        container = container.parentElement;
        continue;
      }
      
      /**
       * Extrai números de uma coluna ordenando os filhos pela posição visual X (esquerda→direita).
       * Isso garante que a leitura siga a ordem visual, não a ordem do DOM.
       */
      function extractNumsByVisualOrder(colEl) {
        // Buscar todos os elementos-folha que contêm apenas um número
        const numEls = [];
        const walker = document.createTreeWalker(colEl, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const val = node.textContent.trim();
          if (/^\d+$/.test(val)) {
            const parentEl = node.parentElement;
            if (parentEl) {
              const rect = parentEl.getBoundingClientRect();
              numEls.push({ val: parseInt(val, 10), x: rect.left });
            }
          }
        }
        // Ordenar pela posição X (esquerda → direita)
        numEls.sort((a, b) => a.x - b.x);
        return numEls.map(n => n.val);
      }
      
      // Extrair números na ORDEM VISUAL (esquerda→direita) de cada coluna
      const leftNums = extractNumsByVisualOrder(leftCol);
      const rightNums = extractNumsByVisualOrder(rightCol);
      
      console.log(`[Bet365 Bridge] 📊 Esquerda (Home) visual: [${leftNums.join(', ')}] | Centro: [${fractions.join(', ')}] | Direita (Away) visual: [${rightNums.join(', ')}]`);
      
      // Home (esquerda): ordem visual = Cantos, Red, Yellow
      let homeCorners = null, homeRed = null, homeYellow = null;
      if (leftNums.length === 3) {
        homeCorners = leftNums[0];
        homeRed = leftNums[1];
        homeYellow = leftNums[2];
      } else if (leftNums.length === 2) {
        homeCorners = leftNums[0];
        homeYellow = leftNums[1];
      } else if (leftNums.length === 1) {
        homeCorners = leftNums[0];
      }
      
      // Away (direita): ordem visual = Yellow, Red, Cantos
      let awayYellow = null, awayRed = null, awayCorners = null;
      if (rightNums.length === 3) {
        awayYellow = rightNums[0];
        awayRed = rightNums[1];
        awayCorners = rightNums[2];
      } else if (rightNums.length === 2) {
        awayYellow = rightNums[0];
        awayCorners = rightNums[1];
      } else if (rightNums.length === 1) {
        awayCorners = rightNums[0];
      }
      
      const result = {
        container: container,
        homeShots: fractions[0],
        awayShots: fractions[1],
        homeCorners, homeRed, homeYellow,
        awayYellow, awayRed, awayCorners
      };
      
      console.log(`[Bet365 Bridge] 📊 Resultado Composto:`, JSON.stringify({
        homeShots: result.homeShots, awayShots: result.awayShots,
        homeCorners, homeRed, homeYellow,
        awayYellow, awayRed, awayCorners
      }));
      
      // Destacar visualmente
      container.style.border = '1px dashed rgba(16, 185, 129, 0.15)';
      container.setAttribute('data-bridge-highlighted', 'true');
      
      // Coluna Esquerda: Cantos e Cartões Casa (Caixa verde)
      leftCol.style.border = '2px solid #10b981';
      leftCol.style.borderRadius = '4px';
      leftCol.style.boxShadow = '0 0 6px rgba(16, 185, 129, 0.4)';
      leftCol.setAttribute('data-bridge-highlighted', 'true');
      addDebugBadge(leftCol, `Cantos: ${homeCorners} | R: ${homeRed} | Y: ${homeYellow}`, '#10b981', 'bottom');
      
      // Coluna do Meio: Finalizações / Chutes (Tracejado verde)
      midCol.style.border = '2px dashed #00ff66';
      midCol.style.borderRadius = '4px';
      midCol.style.boxShadow = '0 0 6px rgba(0, 255, 102, 0.4)';
      midCol.setAttribute('data-bridge-highlighted', 'true');
      addDebugBadge(midCol, `Chutes: ${fractions[0]} | ${fractions[1]}`, '#00ff66', 'top');
      
      // Coluna Direita: Cantos e Cartões Fora (Caixa amarela)
      rightCol.style.border = '2px solid #eab308';
      rightCol.style.borderRadius = '4px';
      rightCol.style.boxShadow = '0 0 6px rgba(234, 179, 8, 0.4)';
      rightCol.setAttribute('data-bridge-highlighted', 'true');
      addDebugBadge(rightCol, `Y: ${awayYellow} | R: ${awayRed} | Cantos: ${awayCorners}`, '#eab308', 'bottom');
      
      return result;
    }
    
    return null;
  }

  /**
   * Encontra os valores home e away subindo no DOM a partir de um label,
   * respeitando as salvaguardas de escopo.
   */
  function findValuesForLabel(labelEl, currentFieldName, currentLabelNormalized) {
    let container = labelEl.parentElement;
    
    for (let level = 0; level < 4; level++) {
      if (!container) break;
      
      // Se o container contiver outros labels de stat, recusa subir mais
      if (containsOtherLabels(container, currentLabelNormalized, currentFieldName)) {
        break;
      }
      
      const text = container.innerText || container.textContent || '';
      const tokens = extractValuesFromText(text);
      
      if (tokens.length >= 2) {
        // Verificar se é um campo composto (finalizações ou cartões)
        const isComposite = (
          currentFieldName === 'totalShots' || 
          currentFieldName === 'shotsOnGoal' || 
          currentFieldName === 'shotsOffGoal' ||
          currentFieldName === 'yellowCards' || 
          currentFieldName === 'redCards'
        );
        
        if (isComposite) {
          // 1. Procurar frações explícitas (ex: "6/2", "7/1")
          const fractions = tokens.filter(t => t.includes('/') || t.includes('\\'));
          if (fractions.length >= 2) {
            highlightStatWithColor(container, currentFieldName, [fractions[0], fractions[1]]);
            return [fractions[0], fractions[1]];
          }
          
          // 2. Procurar 4 números simples para sintetizar frações (ex: "6", "2", "7", "1")
          const numbers = tokens.map(t => t.replace(/[^\d]/g, '')).filter(t => t.length > 0);
          if (numbers.length >= 4) {
            const synthHome = `${numbers[0]}/${numbers[1]}`;
            const synthAway = `${numbers[2]}/${numbers[3]}`;
            highlightStatWithColor(container, currentFieldName, [synthHome, synthAway]);
            return [synthHome, synthAway];
          }
        }
        
        // Para campos simples (ou fallback de composto com apenas 2 valores)
        // Retornamos os dois primeiros tokens encontrados
        highlightStatWithColor(container, currentFieldName, [tokens[0], tokens[1]]);
        return [tokens[0], tokens[1]];
      }
      
      container = container.parentElement;
    }
    
    return null;
  }

  /**
   * PARSER PRINCIPAL v1.3
   * 
   * Estratégia robusta: Buscar ELEMENTOS que contenham labels de stat,
   * depois subir no DOM controladamente para encontrar o container com exatamente 2 tokens (valores).
   */
  function scanLiveStats() {
    const stats = [];
    const teamNames = { home: '', away: '' };

    try {
      clearHighlights();
      extractTeamNamesFromPage(teamNames);

      // 1. Buscar todos os elementos "pequenos" que contêm apenas texto de label
      const candidates = document.querySelectorAll('div, span, td, th, p, label');
      
      for (const el of candidates) {
        // Pular elementos grandes (com muitos filhos = containers)
        if (el.children.length > 3) continue;
        
        // Pular abas de navegação e botões
        const elRole = el.getAttribute('role') || '';
        const elClass = el.className || '';
        if (elRole === 'tab' || elRole === 'button' || 
            (typeof elClass === 'string' && (elClass.includes('Tab') || elClass.includes('tab') || elClass.includes('Nav') || elClass.includes('nav')))) continue;
        
        // Pegar texto direto do elemento (sem filhos profundos)
        const directText = getDirectText(el);
        if (!directText) continue;

        const fieldName = matchStatLabel(directText);
        if (!fieldName) continue;
        
        // Se já encontramos esse campo na lista, pula (exceto para chutes/cartões para permitir sobrescrever simples por compostos)
        const isShotsOrCards = (fieldName === 'totalShots' || fieldName === 'shotsOnGoal' || fieldName === 'shotsOffGoal' || fieldName === 'yellowCards' || fieldName === 'redCards');
        if (stats.find(s => s.field === fieldName) && !isShotsOrCards) continue;

        // Encontrar valores
        const normLabel = normalizeLabel(directText);

        // Tentar primeiro o parser composto da linha principal (que inclui escanteios, cartões e chutes)
        const isShotsField = (fieldName === 'totalShots' || fieldName === 'shotsOnGoal' || fieldName === 'shotsOffGoal');
        if (isShotsField) {
          const compositeData = parseCompositeRow(el);
          if (compositeData) {
            console.log('[Bet365 Bridge] 🌟 Linha Composta Detectada e Processada:', compositeData);
            
            // 1. Salvar Finalizações e Chutes ao Gol
            const hParts = compositeData.homeShots.split('/').map(Number);
            const aParts = compositeData.awayShots.split('/').map(Number);
            
            if (hParts.length >= 2 && aParts.length >= 2) {
              // Remover chutes antigos simples
              for (let idx = stats.length - 1; idx >= 0; idx--) {
                if (stats[idx].field === 'totalShots' || stats[idx].field === 'shotsOnGoal' || stats[idx].field === 'shotsOffGoal') {
                  stats.splice(idx, 1);
                }
              }
              const homeTotal = hParts[0];
              const awayTotal = aParts[0];
              const homeOnGoal = hParts[1];
              const awayOnGoal = aParts[1];
              const homeOffGoal = Math.max(0, homeTotal - homeOnGoal);
              const awayOffGoal = Math.max(0, awayTotal - awayOnGoal);

              stats.push({ field: 'totalShots', home: homeTotal, away: awayTotal, label: 'Finalizações' });
              stats.push({ field: 'shotsOnGoal', home: homeOnGoal, away: awayOnGoal, label: 'Chutes ao gol' });
              stats.push({ field: 'shotsOffGoal', home: homeOffGoal, away: awayOffGoal, label: 'Chutes fora' });
            }
            
            // 2. Salvar Escanteios se detectados
            if (compositeData.homeCorners !== null && compositeData.awayCorners !== null) {
              for (let idx = stats.length - 1; idx >= 0; idx--) {
                if (stats[idx].field === 'corners') {
                  stats.splice(idx, 1);
                }
              }
              stats.push({ field: 'corners', home: compositeData.homeCorners, away: compositeData.awayCorners, label: 'Escanteios' });
            }
            
            // 3. Salvar Cartões se detectados
            if (compositeData.homeYellow !== null && compositeData.awayYellow !== null) {
              for (let idx = stats.length - 1; idx >= 0; idx--) {
                if (stats[idx].field === 'yellowCards') {
                  stats.splice(idx, 1);
                }
              }
              stats.push({ field: 'yellowCards', home: compositeData.homeYellow, away: compositeData.awayYellow, label: 'Cartões Amarelos' });
            }
            if (compositeData.homeRed !== null && compositeData.awayRed !== null) {
              for (let idx = stats.length - 1; idx >= 0; idx--) {
                if (stats[idx].field === 'redCards') {
                  stats.splice(idx, 1);
                }
              }
              stats.push({ field: 'redCards', home: compositeData.homeRed, away: compositeData.awayRed, label: 'Cartões Vermelhos' });
            }
            
            continue; // Já processou tudo dessa linha!
          }
        }

        const tokens = findValuesForLabel(el, fieldName, normLabel);
        
        if (tokens) {
          const tokenHome = tokens[0];
          const tokenAway = tokens[1];
          console.log(`[Bet365 Bridge] 🎯 Encontrado: "${directText}" (${fieldName}) -> Home="${tokenHome}", Away="${tokenAway}"`);
          
          if (tokenHome.includes('/') && tokenAway.includes('/')) {
            const hParts = tokenHome.split('/').map(Number);
            const aParts = tokenAway.split('/').map(Number);
            
            if (hParts.length >= 2 && aParts.length >= 2 && !isNaN(hParts[0]) && !isNaN(aParts[0])) {
              console.log(`[Bet365 Bridge] 🧩 Fração lida para "${fieldName}": Home=[${hParts.join(', ')}], Away=[${aParts.join(', ')}]`);
              if (fieldName === 'totalShots' || fieldName === 'shotsOnGoal' || fieldName === 'shotsOffGoal') {
                // Remover estatísticas de chutes anteriores (simples) para priorizar a fração composta
                for (let idx = stats.length - 1; idx >= 0; idx--) {
                  if (stats[idx].field === 'totalShots' || stats[idx].field === 'shotsOnGoal' || stats[idx].field === 'shotsOffGoal') {
                    stats.splice(idx, 1);
                  }
                }
                const homeTotal = hParts[0];
                const awayTotal = aParts[0];
                const homeOnGoal = hParts[1];
                const awayOnGoal = aParts[1];
                const homeOffGoal = Math.max(0, homeTotal - homeOnGoal);
                const awayOffGoal = Math.max(0, awayTotal - awayOnGoal);

                if (!stats.find(s => s.field === 'totalShots')) {
                  stats.push({ field: 'totalShots', home: homeTotal, away: awayTotal, label: 'Finalizações' });
                  console.log(`[Bet365 Bridge]   -> Salvo totalShots: Home=${homeTotal}, Away=${awayTotal}`);
                }
                if (!stats.find(s => s.field === 'shotsOnGoal')) {
                  stats.push({ field: 'shotsOnGoal', home: homeOnGoal, away: awayOnGoal, label: 'Chutes ao gol' });
                  console.log(`[Bet365 Bridge]   -> Salvo shotsOnGoal: Home=${homeOnGoal}, Away=${awayOnGoal}`);
                }
                if (!stats.find(s => s.field === 'shotsOffGoal')) {
                  stats.push({ field: 'shotsOffGoal', home: homeOffGoal, away: awayOffGoal, label: 'Chutes fora' });
                  console.log(`[Bet365 Bridge]   -> Salvo shotsOffGoal: Home=${homeOffGoal}, Away=${awayOffGoal}`);
                }
              } else if (fieldName === 'yellowCards' || fieldName === 'redCards') {
                // Remover cartões anteriores
                for (let idx = stats.length - 1; idx >= 0; idx--) {
                  if (stats[idx].field === 'yellowCards' || stats[idx].field === 'redCards') {
                    stats.splice(idx, 1);
                  }
                }
                if (!stats.find(s => s.field === 'yellowCards')) {
                  stats.push({ field: 'yellowCards', home: hParts[0], away: aParts[0], label: 'Cartões Amarelos' });
                }
                if (!stats.find(s => s.field === 'redCards')) {
                  stats.push({ field: 'redCards', home: hParts[1], away: aParts[1], label: 'Cartões Vermelhos' });
                }
              }
            }
          } else {
            const hVal = parseInt(tokenHome.replace('%', ''), 10);
            const aVal = parseInt(tokenAway.replace('%', ''), 10);
            
            if (!isNaN(hVal) && !isNaN(aVal)) {
              if (!stats.find(s => s.field === fieldName)) {
                stats.push({
                  field: fieldName,
                  home: hVal,
                  away: aVal,
                  label: directText
                });
                console.log(`[Bet365 Bridge]   -> Salvo ${fieldName}: Home=${hVal}, Away=${aVal}`);
              }
            }
          }
        }
      }

      // Estratégia extra: buscar pelo padrão innerText completo do painel de stats
      if (stats.length < 2) {
        findStatsByInnerText(stats);
      }

      // 4. Buscar e destacar o placar (independente dos nomes dos times)
      const scoreData = findScoreElements(teamNames.home, teamNames.away, teamNames);
      if (scoreData) {
        console.log(`[Bet365 Bridge] ⚽ Placar encontrado: ${scoreData.homeScore} - ${scoreData.awayScore}`);
        highlightScore(scoreData);
        stats.push({
          field: 'goals',
          home: scoreData.homeScore,
          away: scoreData.awayScore,
          label: 'Placar'
        });
      }

    } catch (err) {
      console.warn('[Bet365 Bridge] Erro:', err.message);
    }

    return { stats, teamNames };
  }

  /**
   * Pega texto diretamente de um elemento (excluindo filhos com muitos nós)
   */
  function getDirectText(el) {
    if (el.childNodes.length <= 3) {
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent;
        }
      }
      text = text.trim();
      if (!text && el.textContent && el.textContent.trim().length < 40) {
        text = el.textContent.trim();
      }
      return text || null;
    }
    return null;
  }

  /**
   * ESTRATÉGIA 2: Buscar por innerText do body inteiro como fallback
   */
  function findStatsByInnerText(stats) {
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    
    for (let i = 0; i < lines.length; i++) {
      const fieldName = matchStatLabel(lines[i]);
      if (!fieldName) continue;
      
      if (stats.find(s => s.field === fieldName)) continue;
      
      const maxVal = STAT_MAX[fieldName] || 999;
      
      let tokens = [];
      for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
        const line = lines[j];
        const isVal = /^\d+$/.test(line) || /^\d+\s*[\/\\-]\s*\d+$/.test(line);
        if (isVal) {
          tokens.push(line.trim());
        } else {
          break;
        }
      }
      
      if (tokens.length >= 2) {
        const isComposite = (
          fieldName === 'totalShots' || 
          fieldName === 'shotsOnGoal' || 
          fieldName === 'shotsOffGoal' ||
          fieldName === 'yellowCards' || 
          fieldName === 'redCards'
        );
        
        let finalTokens = null;
        if (isComposite) {
          const fractions = tokens.filter(t => t.includes('/') || t.includes('\\'));
          if (fractions.length >= 2) {
            finalTokens = [fractions[0], fractions[1]];
          } else {
            const numbers = tokens.map(t => t.replace(/[^\d]/g, '')).filter(t => t.length > 0);
            if (numbers.length >= 4) {
              finalTokens = [`${numbers[0]}/${numbers[1]}`, `${numbers[2]}/${numbers[3]}`];
            }
          }
        }
        
        if (!finalTokens) {
          finalTokens = [tokens[0], tokens[1]];
        }

        const tokenHome = finalTokens[0];
        const tokenAway = finalTokens[1];
        
        if (tokenHome.includes('/') && tokenAway.includes('/')) {
          const hParts = tokenHome.split('/').map(Number);
          const aParts = tokenAway.split('/').map(Number);
          if (hParts.length >= 2 && aParts.length >= 2 && !isNaN(hParts[0]) && !isNaN(aParts[0])) {
            if (fieldName === 'totalShots' || fieldName === 'shotsOnGoal' || fieldName === 'shotsOffGoal') {
              const homeTotal = hParts[0];
              const awayTotal = aParts[0];
              const homeOnGoal = hParts[1];
              const awayOnGoal = aParts[1];
              const homeOffGoal = Math.max(0, homeTotal - homeOnGoal);
              const awayOffGoal = Math.max(0, awayTotal - awayOnGoal);

              if (!stats.find(s => s.field === 'totalShots')) {
                stats.push({ field: 'totalShots', home: homeTotal, away: awayTotal, label: lines[i] });
              }
              if (!stats.find(s => s.field === 'shotsOnGoal')) {
                stats.push({ field: 'shotsOnGoal', home: homeOnGoal, away: awayOnGoal, label: lines[i] });
              }
              if (!stats.find(s => s.field === 'shotsOffGoal')) {
                stats.push({ field: 'shotsOffGoal', home: homeOffGoal, away: awayOffGoal, label: lines[i] });
              }
            } else if (fieldName === 'yellowCards' || fieldName === 'redCards') {
              if (!stats.find(s => s.field === 'yellowCards')) {
                stats.push({ field: 'yellowCards', home: hParts[0], away: aParts[0], label: lines[i] });
              }
              if (!stats.find(s => s.field === 'redCards')) {
                stats.push({ field: 'redCards', home: hParts[1], away: aParts[1], label: lines[i] });
              }
            }
          }
        } else {
          const hVal = parseInt(tokenHome.replace('%', ''), 10);
          const aVal = parseInt(tokenAway.replace('%', ''), 10);
          if (!isNaN(hVal) && !isNaN(aVal) && hVal <= maxVal && aVal <= maxVal) {
            stats.push({ field: fieldName, home: hVal, away: aVal, label: lines[i] });
          }
        }
      }
    }
  }

  /**
   * Extrai nomes dos times do contexto da página
   */
  function extractTeamNamesFromPage(result) {
    // Método 1: Título da página (mais seguro e específico para a aba ativa)
    const title = document.title || '';
    let match = title.match(/(.+?)\s+(?:v|vs|x)\s+(.+?)(?:\s*[-|]|$)/i);
    if (match) {
      result.home = match[1].trim().substring(0, 30);
      result.away = match[2].trim().substring(0, 30);
      return;
    }

    // Método 2: Procurar headers na página
    const headers = document.querySelectorAll('h1, h2, h3, [class*="header"], [class*="Header"]');
    for (const h of headers) {
      const text = h.textContent.trim();
      match = text.match(/^(.{2,25})\s+(?:v|vs|x)\s+(.{2,25})$/i);
      if (match) {
        result.home = match[1].trim();
        result.away = match[2].trim();
        return;
      }
    }

    // Método 3: Procurar no body pelo padrão "Time A v Time B"
    const bodyText = document.body.innerText || '';
    match = bodyText.match(/^(.{2,30}?)\s+v\s+(.{2,30})$/m);
    if (match) {
      result.home = match[1].trim();
      result.away = match[2].trim();
      return;
    }
  }

  // ─── Storage ───
  function saveToStorage(stats, teamNames) {
    if (stats.length === 0) return;
    
    const normalize = (name) => name
      .toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);

    const matchKey = `${STORAGE_KEY_PREFIX}${normalize(teamNames.home || 'unknown')}_${normalize(teamNames.away || 'unknown')}`;

    const home = {}, away = {};
    for (const stat of stats) {
      home[stat.field] = stat.home;
      away[stat.field] = stat.away;
    }

    const storageData = {};
    storageData[matchKey] = {
      homeTeam: teamNames.home || 'Unknown Home',
      awayTeam: teamNames.away || 'Unknown Away',
      matchUrl: window.location.href,
      timestamp: Date.now(),
      home,
      away
    };

    storageData['bet365_bridge_index'] = {
      matchCount: 1,
      lastScan: Date.now(),
      scanNumber: scanCount,
      matches: [{
        home: teamNames.home || 'Unknown',
        away: teamNames.away || 'Unknown',
        statsCount: stats.length
      }]
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set(storageData, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Bet365 Bridge] Erro salvando:', chrome.runtime.lastError);
        }
      });
    }
  }

  // ─── Main Loop ───
  let scanCount = 0;

  function runScan() {
    scanCount++;
    const { stats, teamNames } = scanLiveStats();

    if (stats.length > 0) {
      saveToStorage(stats, teamNames);
      console.log(`[Bet365 Bridge] ✅ Scan #${scanCount} — ${teamNames.home} vs ${teamNames.away} — ${stats.length} stats:`);
      stats.forEach(s => console.log(`  ${s.label}: ${s.home} | ${s.away} (${s.field})`));

      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'BET365_SCAN_UPDATE', matchCount: 1, scanNumber: scanCount
        }).catch(() => {});
      }
    } else {
      console.log(`[Bet365 Bridge] 🔍 Scan #${scanCount} — Nenhuma stat encontrada.`);
      
      // Debug: listar textos que parecem labels
      const bodyText = document.body.innerText || '';
      const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
      const candidates = lines.filter(l => {
        const low = l.toLowerCase();
        return (low.includes('ataques') || low.includes('posse') || 
                low.includes('escanteio') || low.includes('chutes') ||
                low.includes('attacks') || low.includes('dangerous'));
      });
      if (candidates.length > 0) {
        console.log('[Bet365 Bridge] 🔎 Labels candidatos:', candidates.slice(0, 10));
      }
    }
  }

  console.log('[Bet365 Bridge] 🟢 v1.3 carregado em', window.location.hostname);
  setTimeout(runScan, 3000);
  setInterval(runScan, SCAN_INTERVAL_MS);

})();
