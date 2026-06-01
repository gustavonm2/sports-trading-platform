/**
 * Bet365 Bridge — Content Script (bet365.com / bet365.bet.br)
 * 
 * v1.1 — Reescrito baseado no DOM real da Bet365 Brasil
 * 
 * Lê passivamente as estatísticas ao vivo do DOM da Bet365.
 * NÃO faz requests HTTP extras, NÃO automatiza cliques.
 * Apenas lê o que já está renderizado na página.
 * 
 * Layout detectado da Bet365:
 *   - Abas: "Estat." "Estatísticas de Jogador" etc
 *   - Stats exibidos com: Label (ex "Ataques Perigosos")
 *   - Valores: número Home (esquerda) | número Away (direita)
 *   - Cada stat em um "row" container
 */

(function () {
  'use strict';

  const SCAN_INTERVAL_MS = 8_000; // 8 segundos
  const STORAGE_KEY_PREFIX = 'bet365_bridge_';

  // ─── Mapeamento de labels Bet365 → campo interno ───
  // Suporta Português (BR), Inglês, Espanhol
  const STAT_LABELS = {
    // Português BR (principal)
    'ataques': 'attacks',
    'ataques perigosos': 'dangerousAttacks',
    'finalizações | chutes ao gol': 'shotsOnGoal',
    'finalizações | chutes fora do gol': 'shotsOffGoal',
    'finalizações': 'totalShots',
    'finalizacoes': 'totalShots',
    'chutes ao gol': 'shotsOnGoal',
    'chutes a gol': 'shotsOnGoal',
    'chutes no gol': 'shotsOnGoal',
    'chutes fora do gol': 'shotsOffGoal',
    'chutes fora': 'shotsOffGoal',
    'chutes para fora': 'shotsOffGoal',
    'escanteios': 'corners',
    'posse de bola': 'possession',
    '% de posse': 'possession',
    'posse': 'possession',
    'cartões amarelos': 'yellowCards',
    'cartoes amarelos': 'yellowCards',
    'cartões vermelhos': 'redCards',
    'cartoes vermelhos': 'redCards',
    'total de chutes': 'totalShots',
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
    'shots blocked': 'blockedShots',
    'blocked shots': 'blockedShots',
    'shots inside box': 'shotsInsideBox',
    'fouls': 'fouls',
    'offsides': 'offsides',
    'goalkeeper saves': 'goalkeeperSaves',
    'goal kicks': 'goalKicks',
    'throw ins': 'throwIns',
    'throw-ins': 'throwIns',
    // Espanhol
    'ataques peligrosos': 'dangerousAttacks',
    'tiros a puerta': 'shotsOnGoal',
    'tiros fuera': 'shotsOffGoal',
    'córners': 'corners',
    'posesión': 'possession',
    'posesion del balon': 'possession',
    'tarjetas amarillas': 'yellowCards',
    'tarjetas rojas': 'redCards',
  };

  /**
   * Normaliza texto para comparação de labels
   */
  function normalizeLabel(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[%:]/g, '')
      .trim();
  }

  /**
   * Tenta encontrar o label de stat correspondente
   */
  function matchStatLabel(text) {
    const normalized = normalizeLabel(text);
    
    // Match direto
    if (STAT_LABELS[normalized]) return STAT_LABELS[normalized];
    
    // Match parcial (o texto contém o label)
    for (const [label, field] of Object.entries(STAT_LABELS)) {
      if (normalized === label || normalized.includes(label)) {
        return field;
      }
    }
    
    return null;
  }

  /**
   * Extrai todos os números de um texto
   */
  function extractNumbers(text) {
    const matches = text.match(/\d+/g);
    return matches ? matches.map(Number) : [];
  }

  /**
   * ESTRATÉGIA PRINCIPAL: Varredura por texto visível
   * 
   * A Bet365 usa classes CSS ofuscadas que mudam frequentemente.
   * Em vez de depender de classes, buscamos por CONTEÚDO DE TEXTO:
   * - Procuramos nós de texto com labels conhecidos (ex: "Ataques Perigosos")
   * - Depois buscamos números adjacentes (home/away values)
   */
  function scanLiveStats() {
    const stats = [];
    const teamNames = { home: '', away: '' };

    try {
      // 1. Extrair nomes dos times do header/título
      extractTeamNamesFromPage(teamNames);

      // 2. Coletar todos os nós de texto visíveis na página
      const textElements = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            // Pular elementos invisíveis
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            const text = node.textContent.trim();
            if (text.length === 0 || text.length > 100) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      while (walker.nextNode()) {
        textElements.push({
          text: walker.currentNode.textContent.trim(),
          node: walker.currentNode
        });
      }

      // 3. Para cada elemento de texto, verificar se é um label de stat
      for (let i = 0; i < textElements.length; i++) {
        const fieldName = matchStatLabel(textElements[i].text);
        if (!fieldName) continue;

        // Buscar números próximos (antes e depois)
        let homeVal = null;
        let awayVal = null;

        // Procurar números ANTES do label (valor Home)
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const nums = extractNumbers(textElements[j].text);
          if (nums.length === 1 && nums[0] <= 999) {
            homeVal = nums[0];
            break;
          }
        }

        // Procurar números DEPOIS do label (valor Away)
        for (let j = i + 1; j <= Math.min(textElements.length - 1, i + 5); j--) {
          const nums = extractNumbers(textElements[j].text);
          if (nums.length === 1 && nums[0] <= 999) {
            awayVal = nums[0];
            break;
          }
        }

        // Se não encontrou com busca direcional, tentar DOM siblings
        if (homeVal === null || awayVal === null) {
          const values = findValuesNearLabel(textElements[i].node);
          if (values) {
            homeVal = values.home;
            awayVal = values.away;
          }
        }

        if (homeVal !== null && awayVal !== null) {
          // Evitar duplicatas (mesmo campo encontrado mais de uma vez)
          if (!stats.find(s => s.field === fieldName)) {
            stats.push({
              field: fieldName,
              home: homeVal,
              away: awayVal,
              label: textElements[i].text.trim()
            });
          }
        }
      }

      // 4. ESTRATÉGIA EXTRA: buscar por padrões "número texto número" em containers
      if (stats.length < 2) {
        findStatsFromContainers(stats);
      }

    } catch (err) {
      console.warn('[Bet365 Bridge] Erro ao escanear:', err.message);
    }

    return { stats, teamNames };
  }

  /**
   * Encontra valores Home/Away perto de um nó de label no DOM
   * Sobe até o container pai e busca números entre os filhos
   */
  function findValuesNearLabel(labelNode) {
    let container = labelNode.parentElement;
    
    // Subir até 5 níveis para encontrar o container de stat row
    for (let level = 0; level < 5; level++) {
      if (!container || !container.parentElement) break;
      container = container.parentElement;
      
      // Pegar todo o texto deste container
      const fullText = container.textContent || '';
      const numbers = extractNumbers(fullText);
      
      // Se tem exatamente 2 números, provavelmente são home/away
      if (numbers.length === 2) {
        return { home: numbers[0], away: numbers[1] };
      }
      
      // Se tem mais que 2, pegar os dois mais periféricos
      if (numbers.length > 2) {
        // Buscar os números de forma posicional (esquerda/direita)
        const children = container.children;
        const values = getLeftRightValues(children);
        if (values) return values;
      }
    }
    
    return null;
  }

  /**
   * Obtém valores esquerda/direita de um container com filhos
   */
  function getLeftRightValues(children) {
    if (children.length < 2) return null;
    
    const firstNums = extractNumbers(children[0].textContent || '');
    const lastNums = extractNumbers(children[children.length - 1].textContent || '');
    
    if (firstNums.length >= 1 && lastNums.length >= 1) {
      return { home: firstNums[0], away: lastNums[0] };
    }
    
    // Tentar segundo e penúltimo
    if (children.length >= 3) {
      const secNums = extractNumbers(children[1].textContent || '');
      const penNums = extractNumbers(children[children.length - 2].textContent || '');
      if (secNums.length >= 1 && penNums.length >= 1) {
        return { home: secNums[0], away: penNums[0] };
      }
    }
    
    return null;
  }

  /**
   * ESTRATÉGIA 2: Buscar containers que pareçam ter o padrão de stat rows
   * Procura por divs que tenham exatamente: número | texto | número
   */
  function findStatsFromContainers(stats) {
    // Buscar todos elementos que contêm texto de stat label
    const allElements = document.querySelectorAll('div, span, td, li, p');
    
    for (const el of allElements) {
      // Pegar filhos diretos (não recursivo)
      const directText = [];
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.trim();
          if (t) directText.push(t);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const t = child.textContent.trim();
          if (t) directText.push(t);
        }
      }
      
      // Padrão esperado: 3+ partes (número, label, número)
      if (directText.length >= 3) {
        // Tentar extrair: primeiro é home, meio é label, último é away
        const homeNum = parseFloat(directText[0].replace('%', ''));
        const awayNum = parseFloat(directText[directText.length - 1].replace('%', ''));
        
        if (!isNaN(homeNum) && !isNaN(awayNum)) {
          // Juntar as partes do meio como label
          const middleParts = directText.slice(1, -1);
          const labelText = middleParts.join(' ');
          const fieldName = matchStatLabel(labelText);
          
          if (fieldName && !stats.find(s => s.field === fieldName)) {
            stats.push({
              field: fieldName,
              home: homeNum,
              away: awayNum,
              label: labelText.trim()
            });
          }
        }
      }
    }
  }

  /**
   * Extrai nomes dos times da página
   */
  function extractTeamNamesFromPage(result) {
    // Método 1: Título da página
    const title = document.title || '';
    let match = title.match(/(.+?)\s+(?:v|vs|x)\s+(.+?)(?:\s*[-|]|$)/i);
    if (match) {
      result.home = match[1].trim().substring(0, 30);
      result.away = match[2].trim().substring(0, 30);
      return;
    }

    // Método 2: Procurar padrão "Time A v Time B" no body
    const allText = document.body.innerText || '';
    match = allText.match(/^(.{3,25})\s+v\s+(.{3,25})$/m);
    if (match) {
      result.home = match[1].trim();
      result.away = match[2].trim();
      return;
    }

    // Método 3: URL hash pode conter referência ao jogo
    const hash = window.location.hash || '';
    // bet365 URLs: #/IP/EV15134342746C1
    // Não contém nomes, mas podemos extrair do breadcrumb
    const breadcrumb = document.querySelector('[class*="breadcrumb"], [class*="Breadcrumb"]');
    if (breadcrumb) {
      const bcText = breadcrumb.textContent || '';
      match = bcText.match(/(.+?)\s+(?:v|vs|x)\s+(.+)/i);
      if (match) {
        result.home = match[1].trim().substring(0, 30);
        result.away = match[2].trim().substring(0, 30);
      }
    }
  }

  /**
   * Salva dados no chrome.storage
   */
  function saveToStorage(stats, teamNames) {
    if (stats.length === 0) return;

    const normalize = (name) => name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 15);

    const matchKey = `${STORAGE_KEY_PREFIX}${normalize(teamNames.home || 'unknown')}_${normalize(teamNames.away || 'unknown')}`;

    const home = {};
    const away = {};
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

  // ─── LOOP PRINCIPAL ───
  let scanCount = 0;

  function runScan() {
    scanCount++;
    const { stats, teamNames } = scanLiveStats();

    if (stats.length > 0) {
      saveToStorage(stats, teamNames);

      // Log detalhado
      console.log(`[Bet365 Bridge] ✅ Scan #${scanCount} — ${stats.length} stats extraídos:`);
      stats.forEach(s => {
        console.log(`  ${s.label}: ${s.home} | ${s.away}`);
      });

      // Notificar background
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'BET365_SCAN_UPDATE',
          matchCount: 1,
          scanNumber: scanCount
        }).catch(() => {});
      }
    } else {
      console.log(`[Bet365 Bridge] 🔍 Scan #${scanCount} — Nenhuma stat encontrada. Verifique se a aba "Estat." está aberta.`);
      
      // Debug: mostrar textos que parecem labels
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      const candidates = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim().toLowerCase();
        if (text.includes('ataques') || text.includes('attacks') || text.includes('perigosos') || text.includes('dangerous')) {
          candidates.push(walker.currentNode.textContent.trim());
        }
      }
      if (candidates.length > 0) {
        console.log('[Bet365 Bridge] 🔎 Textos candidatos encontrados:', candidates);
      }
    }
  }

  // Iniciar scanner
  console.log('[Bet365 Bridge] 🟢 Content script v1.1 carregado em', window.location.hostname);
  console.log('[Bet365 Bridge] ℹ️  Abra a aba "Estat." no jogo ao vivo para que as stats sejam detectadas.');
  
  // Primeiro scan após 3s (dar tempo pro DOM carregar)
  setTimeout(runScan, 3000);
  
  // Scans subsequentes
  setInterval(runScan, SCAN_INTERVAL_MS);

})();
