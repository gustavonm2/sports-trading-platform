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
    'ataques': 'attacks',
    'ataques perigosos': 'dangerousAttacks',
    'chutes ao gol': 'shotsOnGoal',
    'chutes a gol': 'shotsOnGoal',
    'chutes no gol': 'shotsOnGoal',
    'chutes fora do gol': 'shotsOffGoal',
    'chutes fora': 'shotsOffGoal',
    'chutes para fora': 'shotsOffGoal',
    'escanteios': 'corners',
    'posse de bola': 'possession',
    '% de posse': 'possession',
    'de posse': 'possession',
    'cartões amarelos': 'yellowCards',
    'cartoes amarelos': 'yellowCards',
    'cartões vermelhos': 'redCards',
    'cartoes vermelhos': 'redCards',
    'total de chutes': 'totalShots',
    'finalizações': 'totalShots',
    'finalizacoes': 'totalShots',
    'chutes bloqueados': 'blockedShots',
    'chutes dentro da área': 'shotsInsideBox',
    'chutes dentro da area': 'shotsInsideBox',
    'faltas': 'fouls',
    'impedimentos': 'offsides',
    'defesas do goleiro': 'goalkeeperSaves',
    'tiros de meta': 'goalKicks',
    'arremessos laterais': 'throwIns',
    // Inglês
    'attacks': 'attacks',
    'dangerous attacks': 'dangerousAttacks',
    'shots on target': 'shotsOnGoal',
    'shots off target': 'shotsOffGoal',
    'corners': 'corners',
    'possession': 'possession',
    'ball possession': 'possession',
    'yellow cards': 'yellowCards',
    'red cards': 'redCards',
    'total shots': 'totalShots',
    'fouls': 'fouls',
    'offsides': 'offsides',
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
    // (odds, nomes de times, seções do site, etc.)
    if (/\d/.test(normalized)) return null; // Labels não contêm números
    if (normalized.includes('resultado') || normalized.includes('chance') || 
        normalized.includes('gol') && !normalized.includes('chutes') && !normalized.includes('goleiro') ||
        normalized.includes('mais de') || normalized.includes('menos de') ||
        normalized.includes('empate') || normalized.includes('login') ||
        normalized.includes('registre') || normalized.includes('odds')) {
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
   * PARSER PRINCIPAL v1.2
   * 
   * Estratégia: Buscar ELEMENTOS (não text nodes) que contenham labels de stat,
   * depois subir no DOM até encontrar um container com exatamente 2 números.
   */
  function scanLiveStats() {
    const stats = [];
    const teamNames = { home: '', away: '' };

    try {
      extractTeamNamesFromPage(teamNames);

      // 1. Buscar todos os elementos "pequenos" que contêm apenas texto de label
      const candidates = document.querySelectorAll('div, span, td, th, p, label');
      
      for (const el of candidates) {
        // Pular elementos grandes (com muitos filhos = containers)
        if (el.children.length > 3) continue;
        
        // Pegar texto direto do elemento (sem filhos profundos)
        const directText = getDirectText(el);
        if (!directText) continue;

        const fieldName = matchStatLabel(directText);
        if (!fieldName) continue;
        if (stats.find(s => s.field === fieldName)) continue; // Já encontrado

        // 2. Subir no DOM para encontrar o "stat row" container
        const values = findValuesInParent(el, fieldName);
        if (values) {
          stats.push({
            field: fieldName,
            home: values.home,
            away: values.away,
            label: directText
          });
        }
      }

      // Estratégia extra: buscar pelo padrão innerText completo do painel de stats
      if (stats.length < 2) {
        findStatsByInnerText(stats);
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
    // Se o elemento tem poucos filhos, pegar textContent
    if (el.childNodes.length <= 3) {
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent;
        }
      }
      text = text.trim();
      // Se não achou texto direto, usar textContent se o elemento é pequeno
      if (!text && el.textContent && el.textContent.trim().length < 40) {
        text = el.textContent.trim();
      }
      return text || null;
    }
    return null;
  }

  /**
   * A partir de um elemento label, sobe no DOM procurando um container
   * que tenha exatamente 2 valores numéricos (home e away)
   */
  function findValuesInParent(labelEl, fieldName) {
    let container = labelEl.parentElement;
    const maxVal = STAT_MAX[fieldName] || 999;

    for (let level = 0; level < 6; level++) {
      if (!container) break;

      // Pegar todos os números neste container
      const numbers = getAllNumbersFromElement(container);
      
      // Filtrar números razoáveis para este tipo de stat
      const validNumbers = numbers.filter(n => n >= 0 && n <= maxVal);

      if (validNumbers.length === 2) {
        return { home: validNumbers[0], away: validNumbers[1] };
      }

      // Se encontrou mais que 2, talvez seja um container pai demais
      // Tentar com os filhos imediatos
      if (validNumbers.length > 2 && container.children.length >= 2) {
        const result = extractFromDirectChildren(container, maxVal);
        if (result) return result;
      }

      container = container.parentElement;
    }

    return null;
  }

  /**
   * Extrai números dos filhos diretos de um container (primeiro = home, último = away)
   */
  function extractFromDirectChildren(container, maxVal) {
    const children = Array.from(container.children);
    
    // Procurar o primeiro e último filho que contenham um número
    let homeVal = null;
    let awayVal = null;
    
    for (const child of children) {
      const text = child.textContent.trim();
      const num = parseInt(text, 10);
      if (!isNaN(num) && num >= 0 && num <= maxVal && text === String(num)) {
        if (homeVal === null) {
          homeVal = num;
        } else {
          awayVal = num;
        }
      }
    }

    // Se não encontrou iterando filhos, tentar pelo texto posicional
    if (homeVal === null || awayVal === null) {
      const allText = container.textContent || '';
      // Procurar padrão: "número ... label ... número"
      const nums = [];
      const regex = /\b(\d{1,3})\b/g;
      let m;
      while ((m = regex.exec(allText)) !== null) {
        const val = parseInt(m[1], 10);
        if (val <= maxVal) nums.push(val);
      }
      if (nums.length >= 2) {
        return { home: nums[0], away: nums[nums.length - 1] };
      }
    }

    if (homeVal !== null && awayVal !== null) {
      return { home: homeVal, away: awayVal };
    }
    return null;
  }

  /**
   * Extrai todos os números de um elemento (texto completo)
   * Só pega números "isolados" (não parte de odds como "1.40")
   */
  function getAllNumbersFromElement(el) {
    const text = el.textContent || '';
    const numbers = [];
    // Match apenas números inteiros isolados (não decimais como odds 1.40, 10.00)
    const regex = /(?<!\d)(?<!\.)(\d{1,3})(?!\.\d)(?!\d)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      numbers.push(parseInt(m[1], 10));
    }
    return numbers;
  }

  /**
   * ESTRATÉGIA 2: Buscar por innerText do body inteiro
   * Procura pelo padrão: "Ataques Perigosos\n41\n39" ou similar
   */
  function findStatsByInnerText(stats) {
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    
    for (let i = 0; i < lines.length; i++) {
      const fieldName = matchStatLabel(lines[i]);
      if (!fieldName || stats.find(s => s.field === fieldName)) continue;
      
      const maxVal = STAT_MAX[fieldName] || 999;
      
      // Olhar as próximas linhas para encontrar 2 números
      let homeVal = null;
      let awayVal = null;
      
      for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
        const num = parseInt(lines[j], 10);
        if (!isNaN(num) && num >= 0 && num <= maxVal && lines[j] === String(num)) {
          if (homeVal === null) homeVal = num;
          else if (awayVal === null) { awayVal = num; break; }
        }
      }
      
      // Também olhar para trás
      if (homeVal === null) {
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const num = parseInt(lines[j], 10);
          if (!isNaN(num) && num >= 0 && num <= maxVal && lines[j] === String(num)) {
            homeVal = num;
            break;
          }
        }
      }
      
      // Também procurar na mesma linha: "83 Ataques 97" → linha anterior/seguinte
      if (homeVal === null || awayVal === null) {
        // Checar se a linha do label contém números
        const inlineMatch = lines[i].match(/(\d{1,3})/g);
        if (inlineMatch && inlineMatch.length >= 2) {
          const vals = inlineMatch.map(Number).filter(n => n <= maxVal);
          if (vals.length >= 2) {
            homeVal = vals[0];
            awayVal = vals[vals.length - 1];
          }
        }
      }
      
      if (homeVal !== null && awayVal !== null) {
        stats.push({ field: fieldName, home: homeVal, away: awayVal, label: lines[i] });
      }
    }
  }

  /**
   * Extrai nomes dos times
   */
  function extractTeamNamesFromPage(result) {
    // Método 1: Procurar no body inteiro pelo padrão "Time A v Time B"
    const bodyText = document.body.innerText || '';
    let match = bodyText.match(/^(.{2,30}?)\s+v\s+(.{2,30})$/m);
    if (match) {
      result.home = match[1].trim();
      result.away = match[2].trim();
      return;
    }

    // Método 2: Título da página
    const title = document.title || '';
    match = title.match(/(.+?)\s+(?:v|vs|x)\s+(.+?)(?:\s*[-|]|$)/i);
    if (match) {
      result.home = match[1].trim().substring(0, 30);
      result.away = match[2].trim().substring(0, 30);
      return;
    }

    // Método 3: Procurar headers
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

  console.log('[Bet365 Bridge] 🟢 v1.2 carregado em', window.location.hostname);
  setTimeout(runScan, 3000);
  setInterval(runScan, SCAN_INTERVAL_MS);

})();
