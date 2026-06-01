/**
 * Bet365 Bridge — Content Script (bet365.com)
 * 
 * Lê passivamente as estatísticas ao vivo do DOM da Bet365.
 * NÃO faz requests HTTP extras, NÃO automatiza cliques.
 * Apenas lê o que já está renderizado na página.
 * 
 * Extrai: Attacks, Dangerous Attacks, Shots on/off Target, 
 *         Corners, Possession, Cards
 */

(function () {
  'use strict';

  const SCAN_INTERVAL_MS = 10_000; // 10 segundos
  const STORAGE_KEY_PREFIX = 'bet365_bridge_';

  // ─── Mapeamento de labels Bet365 → campo interno ───
  // Bet365 usa vários idiomas dependendo do locale
  const STAT_LABELS = {
    // Inglês
    'attacks': 'attacks',
    'dangerous attacks': 'dangerousAttacks',
    'shots on target': 'shotsOnGoal',
    'shots off target': 'shotsOffGoal',
    'corners': 'corners',
    'possession': 'possession',
    'yellow cards': 'yellowCards',
    'red cards': 'redCards',
    'total shots': 'totalShots',
    'shots blocked': 'blockedShots',
    'shots inside box': 'shotsInsideBox',
    'fouls': 'fouls',
    'goalkeeper saves': 'goalkeeperSaves',
    // Português
    'ataques': 'attacks',
    'ataques perigosos': 'dangerousAttacks',
    'chutes ao gol': 'shotsOnGoal',
    'chutes a gol': 'shotsOnGoal',
    'chutes para fora': 'shotsOffGoal',
    'chutes fora': 'shotsOffGoal',
    'escanteios': 'corners',
    'posse de bola': 'possession',
    'cartões amarelos': 'yellowCards',
    'cartoes amarelos': 'yellowCards',
    'cartões vermelhos': 'redCards',
    'cartoes vermelhos': 'redCards',
    'total de chutes': 'totalShots',
    'chutes bloqueados': 'blockedShots',
    'faltas': 'fouls',
    // Espanhol
    'ataques peligrosos': 'dangerousAttacks',
    'tiros a puerta': 'shotsOnGoal',
    'tiros fuera': 'shotsOffGoal',
    'córners': 'corners',
    'posesión': 'possession',
    'tarjetas amarillas': 'yellowCards',
    'tarjetas rojas': 'redCards',
  };

  /**
   * Scanner principal: percorre o DOM buscando containers de estatísticas
   * Bet365 usa classes ofuscadas, então buscamos por padrão de conteúdo
   */
  function scanLiveStats() {
    const matches = [];

    try {
      // Estratégia 1: Buscar por containers com layout "valor | label | valor"
      // Bet365 renderiza stats em linhas com 3 colunas: home val, label, away val
      const allElements = document.querySelectorAll('*');
      
      // Agrupar estatísticas por contexto de jogo
      // Procurar containers que tenham texto reconhecível de stats
      const statContainers = findStatContainers();
      
      if (statContainers.length > 0) {
        for (const container of statContainers) {
          const matchData = extractStatsFromContainer(container);
          if (matchData && matchData.stats.length >= 2) {
            matches.push(matchData);
          }
        }
      }

      // Estratégia 2: Busca genérica por textos de stats na página toda
      if (matches.length === 0) {
        const genericMatch = extractStatsFromPage();
        if (genericMatch && genericMatch.stats.length >= 2) {
          matches.push(genericMatch);
        }
      }

    } catch (err) {
      console.warn('[Bet365 Bridge] Erro ao escanear DOM:', err.message);
    }

    return matches;
  }

  /**
   * Encontra containers de estatísticas na página
   * Bet365 agrupa stats em um painel com múltiplas linhas
   */
  function findStatContainers() {
    const containers = [];
    
    // Procurar por containers que contenham pelo menos 2 labels de stats conhecidos
    const allDivs = document.querySelectorAll('div');
    
    for (const div of allDivs) {
      const text = (div.textContent || '').toLowerCase();
      let matchCount = 0;
      
      // Verifica se o container tem pelo menos 3 stats reconhecíveis
      const keysToCheck = ['attacks', 'dangerous', 'corners', 'shots', 'possession', 
                           'ataques', 'perigosos', 'escanteios', 'chutes', 'posse'];
      
      for (const key of keysToCheck) {
        if (text.includes(key)) matchCount++;
      }
      
      if (matchCount >= 3) {
        // Verificar se não é um container pai de um container já encontrado
        const isChild = containers.some(c => c.contains(div));
        const isParent = containers.some(c => div.contains(c));
        
        if (isParent) {
          // Substituir o filho pelo pai (mais completo)
          const idx = containers.findIndex(c => div.contains(c));
          containers[idx] = div;
        } else if (!isChild) {
          containers.push(div);
        }
      }
    }

    return containers;
  }

  /**
   * Extrai estatísticas de um container específico
   * Procura pelo padrão: [homeVal] [label] [awayVal] em cada linha
   */
  function extractStatsFromContainer(container) {
    const stats = [];
    const teamNames = extractTeamNames(container);
    
    // Buscar todas as linhas/rows dentro do container
    // Padrão Bet365: cada stat é um row com 3 elementos inline
    const rows = container.querySelectorAll('div, tr, li');
    
    for (const row of rows) {
      const children = row.children;
      if (children.length < 3) continue;
      
      // Tentar extrair: número | texto | número
      const texts = [];
      for (const child of children) {
        const t = (child.textContent || '').trim();
        if (t) texts.push(t);
      }
      
      if (texts.length >= 3) {
        const stat = parseStatRow(texts);
        if (stat) stats.push(stat);
      }
    }

    // Fallback: buscar por padrão de texto direto
    if (stats.length < 2) {
      const textContent = container.textContent || '';
      const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
      
      for (const line of lines) {
        // Padrão: "45 Attacks 32" ou "45Attacks32"
        const match = line.match(/^(\d+)\s*([A-Za-zÀ-ÿ\s]+?)\s*(\d+)$/);
        if (match) {
          const stat = parseStatRow([match[1], match[2].trim(), match[3]]);
          if (stat) stats.push(stat);
        }
      }
    }

    if (stats.length === 0) return null;

    return {
      homeTeam: teamNames.home || 'Unknown Home',
      awayTeam: teamNames.away || 'Unknown Away',
      stats: stats,
      timestamp: Date.now()
    };
  }

  /**
   * Tenta extrair nomes dos times do contexto da página
   */
  function extractTeamNames(container) {
    const result = { home: '', away: '' };
    
    // Procurar por headers de jogo acima do container de stats
    // Bet365 mostra "Team A v Team B" ou "Team A - Team B"
    let current = container;
    
    for (let i = 0; i < 10; i++) {
      current = current.parentElement;
      if (!current) break;
      
      const text = current.textContent || '';
      // Procurar padrão "Team A v Team B" ou "Team A vs Team B"
      const vsMatch = text.match(/^(.+?)\s+(?:v|vs|x)\s+(.+?)$/m);
      if (vsMatch) {
        result.home = vsMatch[1].trim().substring(0, 30);
        result.away = vsMatch[2].trim().substring(0, 30);
        break;
      }
    }

    // Fallback: pegar do título da página
    if (!result.home) {
      const title = document.title || '';
      const titleMatch = title.match(/(.+?)\s+(?:v|vs|x|-)\s+(.+?)(?:\s*[-|]|$)/);
      if (titleMatch) {
        result.home = titleMatch[1].trim().substring(0, 30);
        result.away = titleMatch[2].trim().substring(0, 30);
      }
    }

    return result;
  }

  /**
   * Faz parse de uma linha de stat [homeVal, label, awayVal]
   */
  function parseStatRow(parts) {
    if (parts.length < 3) return null;
    
    const homeVal = parseFloat(parts[0].replace('%', ''));
    const label = parts[1].toLowerCase().trim();
    const awayVal = parseFloat(parts[parts.length - 1].replace('%', ''));

    if (isNaN(homeVal) || isNaN(awayVal)) return null;

    // Verificar se o label corresponde a um campo conhecido
    const fieldName = STAT_LABELS[label];
    if (!fieldName) return null;

    return {
      field: fieldName,
      home: homeVal,
      away: awayVal,
      label: label
    };
  }

  /**
   * Fallback: Busca genérica na página inteira
   */
  function extractStatsFromPage() {
    const stats = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text.length > 0 && text.length < 50) {
        textNodes.push({ text, node: walker.currentNode });
      }
    }

    // Procurar labels conhecidos e seus vizinhos numéricos
    for (let i = 0; i < textNodes.length; i++) {
      const labelText = textNodes[i].text.toLowerCase();
      const fieldName = STAT_LABELS[labelText];
      
      if (fieldName) {
        // Procurar números antes e depois deste nó (±3 posições)
        let homeVal = null;
        let awayVal = null;

        // Buscar para trás (home value)
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const num = parseFloat(textNodes[j].text.replace('%', ''));
          if (!isNaN(num) && num >= 0 && num <= 999) {
            homeVal = num;
            break;
          }
        }

        // Buscar para frente (away value)
        for (let j = i + 1; j <= Math.min(textNodes.length - 1, i + 3); j++) {
          const num = parseFloat(textNodes[j].text.replace('%', ''));
          if (!isNaN(num) && num >= 0 && num <= 999) {
            awayVal = num;
            break;
          }
        }

        if (homeVal !== null && awayVal !== null) {
          stats.push({
            field: fieldName,
            home: homeVal,
            away: awayVal,
            label: labelText
          });
        }
      }
    }

    const teamNames = extractTeamNames(document.body);

    return {
      homeTeam: teamNames.home || 'Unknown',
      awayTeam: teamNames.away || 'Unknown',
      stats: stats,
      timestamp: Date.now()
    };
  }

  /**
   * Formata os dados extraídos para salvar no storage
   */
  function formatForStorage(matchData) {
    const result = {
      homeTeam: matchData.homeTeam,
      awayTeam: matchData.awayTeam,
      timestamp: matchData.timestamp,
      home: {},
      away: {}
    };

    for (const stat of matchData.stats) {
      result.home[stat.field] = stat.home;
      result.away[stat.field] = stat.away;
    }

    return result;
  }

  /**
   * Gera uma chave de storage baseada nos nomes dos times
   */
  function generateMatchKey(homeTeam, awayTeam) {
    const normalize = (name) => name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 15);
    
    return `${STORAGE_KEY_PREFIX}${normalize(homeTeam)}_${normalize(awayTeam)}`;
  }

  // ─── LOOP PRINCIPAL ───
  let scanCount = 0;

  function runScan() {
    scanCount++;
    const matches = scanLiveStats();
    
    if (matches.length > 0) {
      const storageData = {};
      
      for (const match of matches) {
        const key = generateMatchKey(match.homeTeam, match.awayTeam);
        storageData[key] = formatForStorage(match);
      }

      // Também salvar um índice de todos os jogos ativos
      storageData['bet365_bridge_index'] = {
        matchCount: matches.length,
        lastScan: Date.now(),
        scanNumber: scanCount,
        matches: matches.map(m => ({
          home: m.homeTeam,
          away: m.awayTeam,
          statsCount: m.stats.length
        }))
      };

      // Salvar no chrome.storage.local
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set(storageData, () => {
          console.log(`[Bet365 Bridge] ✅ Scan #${scanCount} — ${matches.length} jogo(s) mapeados, ${matches.reduce((a, m) => a + m.stats.length, 0)} stats`);
        });
      }

      // Notificar background sobre dados atualizados
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'BET365_SCAN_UPDATE',
          matchCount: matches.length,
          scanNumber: scanCount
        }).catch(() => {}); // Ignora se background não está ouvindo
      }
    } else {
      console.log(`[Bet365 Bridge] 🔍 Scan #${scanCount} — Nenhuma stat encontrada no DOM`);
    }
  }

  // Iniciar scanner
  console.log('[Bet365 Bridge] 🟢 Content script carregado — escaneando a cada 10s');
  
  // Primeiro scan após 2s (dar tempo pro DOM carregar)
  setTimeout(runScan, 2000);
  
  // Scans subsequentes
  setInterval(runScan, SCAN_INTERVAL_MS);

})();
