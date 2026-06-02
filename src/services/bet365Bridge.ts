/**
 * Bet365 Bridge Service
 * 
 * Serviço que recebe dados da extensão Chrome (Bet365 Bridge)
 * e faz merge inteligente com os dados existentes das APIs.
 * 
 * A extensão envia dados via CustomEvent('bet365-bridge-data')
 * Este serviço escuta o evento e expõe funções de merge.
 * 
 * IMPORTANTE: Este serviço COMPLEMENTA as APIs, nunca substitui.
 */

import type { MatchStats, TeamStats, TelemetrySnapshot } from './apiSports';

// ─── Tipos da Bridge ───

export interface Bet365MatchData {
  storageKey: string;
  homeTeam: string;
  awayTeam: string;
  timestamp: number;
  elapsed?: number;
  matchUrl?: string;
  home: Partial<Record<string, number>>;
  away: Partial<Record<string, number>>;
  snapshots?: TelemetrySnapshot[];
}

export interface Bet365BridgePayload {
  connected: boolean;
  matchCount: number;
  lastScan: number | null;
  scanNumber: number;
  matches: Bet365MatchData[];
}

// ─── Fuzzy Matching ───

/**
 * Normaliza nome de time para comparação fuzzy
 * Remove acentos, sufixos comuns, espaços extras
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/\b(fc|sc|cf|ac|rc|cd|ud|ca|se|ec|cr|sp|rj|mg|rs|pr|ba|ce|pa|go|es|al|pe|ma|am|pi|mt|ms|to|df|ap|rr|ro|ac|club|united|city|sport|sporting|athletic|atletico|athletic|town|rovers|wanderers|albion)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Calcula similaridade entre dois nomes de times (0-1)
 * Usa uma combinação de inclusão de substring + distância
 */
function teamSimilarity(apiName: string, bet365Name: string): number {
  const a = normalizeTeamName(apiName);
  const b = normalizeTeamName(bet365Name);

  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;

  // Longest Common Substring ratio
  let maxLen = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
        k++;
      }
      maxLen = Math.max(maxLen, k);
    }
  }

  const lcsRatio = maxLen / Math.max(a.length, b.length);
  return lcsRatio;
}

// ─── Merge Engine ───

/**
 * Encontra o melhor match da Bet365 para um jogo da API
 * Retorna null se nenhum match tiver similaridade >= 0.6
 */
export function findBet365Match(
  apiHome: string,
  apiAway: string,
  bet365Matches: Bet365MatchData[]
): Bet365MatchData | null {
  let bestMatch: Bet365MatchData | null = null;
  let bestScore = 0;

  for (const match of bet365Matches) {
    const homeScore = teamSimilarity(apiHome, match.homeTeam);
    const awayScore = teamSimilarity(apiAway, match.awayTeam);
    const combinedScore = (homeScore + awayScore) / 2;

    if (combinedScore > bestScore && combinedScore >= 0.6) {
      bestScore = combinedScore;
      bestMatch = match;
    }
  }

  return bestMatch;
}

/**
 * Faz merge dos dados da Bet365 com os stats da API
 * Regra: Bet365 COMPLEMENTA, nunca substitui dados > 0 da API
 */
export function mergeStats(
  apiStats: MatchStats,
  bet365Data: Bet365MatchData
): MatchStats {
  const merged = { ...apiStats };
  merged.home = { ...apiStats.home };
  merged.away = { ...apiStats.away };

  // Merge individual fields
  const mergeField = (
    side: 'home' | 'away',
    apiField: keyof TeamStats,
    bet365Field: string
  ) => {
    const bet365Val = bet365Data[side]?.[bet365Field];
    if (typeof bet365Val === 'number') {
      // Prioridade absoluta para a telemetria ao vivo da Bet365 (zero delay)
      // Se for posse de bola (que varia no tempo), usamos diretamente o valor da Bet365
      // Para estatísticas cumulativas, usamos o valor máximo para robustez contra flutuações temporárias
      const apiVal = Number(merged[side][apiField]) || 0;
      if (apiField === 'possession') {
        (merged[side] as any)[apiField] = bet365Val;
      } else {
        (merged[side] as any)[apiField] = Math.max(apiVal, bet365Val);
      }
    }
  };

  // 🎯 1. Campos de volume e pressão
  mergeField('home', 'dangerousAttacks', 'dangerousAttacks');
  mergeField('away', 'dangerousAttacks', 'dangerousAttacks');
  mergeField('home', 'attacks', 'attacks');
  mergeField('away', 'attacks', 'attacks');
  mergeField('home', 'possession', 'possession');
  mergeField('away', 'possession', 'possession');

  // 📊 2. Finalizações & Perigo Real
  mergeField('home', 'corners', 'corners');
  mergeField('away', 'corners', 'corners');
  mergeField('home', 'shotsOnGoal', 'shotsOnGoal');
  mergeField('away', 'shotsOnGoal', 'shotsOnGoal');
  mergeField('home', 'shotsOffGoal', 'shotsOffGoal');
  mergeField('away', 'shotsOffGoal', 'shotsOffGoal');
  mergeField('home', 'totalShots', 'totalShots');
  mergeField('away', 'totalShots', 'totalShots');
  mergeField('home', 'blockedShots', 'blockedShots');
  mergeField('away', 'blockedShots', 'blockedShots');
  mergeField('home', 'shotsInsideBox', 'shotsInsideBox');
  mergeField('away', 'shotsInsideBox', 'shotsInsideBox');

  // 🛡️ 3. Defesa, Disciplina & Extras
  mergeField('home', 'yellowCards', 'yellowCards');
  mergeField('away', 'yellowCards', 'yellowCards');
  mergeField('home', 'redCards', 'redCards');
  mergeField('away', 'redCards', 'redCards');
  mergeField('home', 'fouls', 'fouls');
  mergeField('away', 'fouls', 'fouls');
  mergeField('home', 'goalkeeperSaves', 'goalkeeperSaves');
  mergeField('away', 'goalkeeperSaves', 'goalkeeperSaves');
  mergeField('home', 'offsides', 'offsides');
  mergeField('away', 'offsides', 'offsides');

  merged.snapshots = bet365Data.snapshots || [];
  merged.hasBridge = true;
  return merged;
}

/**
 * Calcula o IIM Enriquecido quando dados da Bet365 estão disponíveis
 * Fórmula diferente: inclui dangerousAttacks com peso alto
 */
export function calculateEnrichedIIM(
  stats: TeamStats,
  elapsed: number,
  hasBet365: boolean
): number {
  if (elapsed <= 0) return 0;

  // 📊 1. Base standard IIM (chutes + escanteios = perigo real)
  const baseStandard = (
    stats.shotsOnGoal * 3.0 +
    stats.shotsOffGoal * 1.2 +
    stats.corners * 2.0 +
    (stats.blockedShots || 0) * 0.8
  );

  if (hasBet365 && stats.dangerousAttacks > 0) {
    // ⚡ 2. APM (Ataques Perigosos por Minuto) como Multiplicador de Intensidade
    const apm = stats.dangerousAttacks / elapsed;
    
    // Multiplicador dinâmico: apm 0.6 = 1.0 (neutro). 
    // apm > 0.6 aumenta a intensidade. apm < 0.6 diminui a intensidade.
    const intensityMultiplier = Math.max(0.5, 0.7 + (apm * 0.5));

    // 🕒 3. Pequeno bônus de volume de campo (sem inflacionar o perigo real)
    const fieldPressureBonus = (
      stats.dangerousAttacks * 0.3 +
      (stats.attacks || 0) * 0.05
    );

    const raw = (baseStandard * intensityMultiplier + fieldPressureBonus) / elapsed;
    return Math.round(raw * 100) / 100;
  }

  // IIM PADRÃO: sem Bet365
  const raw = baseStandard / elapsed;
  return Math.round(raw * 100) / 100;
}

// ─── Event Listener Manager ───

type BridgeCallback = (payload: Bet365BridgePayload) => void;

let currentCallback: BridgeCallback | null = null;

/**
 * Registra um listener para dados da Bet365 Bridge
 * Usa window.postMessage (cruza a barreira do content script isolado)
 * Retorna uma função de cleanup
 */
export function onBet365Data(callback: BridgeCallback): () => void {
  const handler = (event: MessageEvent) => {
    // Filtrar apenas mensagens da bridge
    if (event.data?.type !== 'BET365_BRIDGE_DATA') return;
    const payload = event.data.payload as Bet365BridgePayload;
    if (payload) {
      callback(payload);
    }
  };

  window.addEventListener('message', handler);
  currentCallback = callback;

  return () => {
    window.removeEventListener('message', handler);
    currentCallback = null;
  };
}

/**
 * Verifica se a bridge está disponível (extensão instalada + dados frescos)
 */
export function isBridgeAvailable(): boolean {
  return currentCallback !== null;
}

export interface APMMetrics {
  apmGlobal: number;
  apm10: number;
  apm5: number;
  apm3: number;
  accelerationFactor: number;
  ipr: number;
}

export function calculateDynamicAPM(
  snapshots: TelemetrySnapshot[],
  currentElapsed: number,
  globalHomeDA: number,
  globalAwayDA: number
): { home: APMMetrics; away: APMMetrics } {
  // Métrica padrão caso não haja série histórica suficiente
  const defaultMetrics = (globalDA: number): APMMetrics => {
    const globalApm = currentElapsed > 0 ? globalDA / currentElapsed : 0;
    const roundedApm = Math.round(globalApm * 100) / 100;
    return {
      apmGlobal: roundedApm,
      apm10: roundedApm,
      apm5: roundedApm,
      apm3: roundedApm,
      accelerationFactor: 1.0,
      ipr: roundedApm,
    };
  };

  if (!snapshots || snapshots.length === 0 || currentElapsed <= 0) {
    return {
      home: defaultMetrics(globalHomeDA),
      away: defaultMetrics(globalAwayDA),
    };
  }

  // Ordenar snapshots para garantir ordem cronológica
  const sortedSnaps = [...snapshots].sort((a, b) => a.elapsed - b.elapsed);
  const currentSnap = sortedSnaps[sortedSnaps.length - 1];

  const calculateSideAPM = (
    isHome: boolean,
    globalDA: number
  ): APMMetrics => {
    const getDA = (s: TelemetrySnapshot) => (isHome ? s.homeDA : s.awayDA);
    const apmGlobal = currentElapsed > 0 ? globalDA / currentElapsed : 0;
    
    // Função local para extrair APM dinâmico baseada em janelas móveis
    const getApmForWindow = (minutes: number): number => {
      const targetTime = currentElapsed - minutes;
      
      // Se a janela extrapolar o início do monitoramento
      if (targetTime <= 0) {
        const earliest = sortedSnaps[0];
        const timeDiff = currentElapsed - earliest.elapsed;
        if (timeDiff > 0) {
          return Math.max(0, (getDA(currentSnap) - getDA(earliest)) / timeDiff);
        }
        return apmGlobal;
      }
      
      // Encontrar o snapshot com o elapsed mais próximo da janela t - minutos
      let closest = sortedSnaps[0];
      let minDiff = Math.abs(closest.elapsed - targetTime);
      for (const s of sortedSnaps) {
        const diff = Math.abs(s.elapsed - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = s;
        }
      }

      const elapsedDiff = currentElapsed - closest.elapsed;
      if (elapsedDiff > 0) {
        return Math.max(0, (getDA(currentSnap) - getDA(closest)) / elapsedDiff);
      }
      return apmGlobal;
    };

    const apm10 = getApmForWindow(10);
    const apm5 = getApmForWindow(5);
    const apm3 = getApmForWindow(3);

    // Fator de Aceleração = APM_10 / APM_Global
    const accelerationFactor = apmGlobal > 0 ? apm10 / apmGlobal : 1.0;

    // Índice de Pressão Recente (IPR) = (APM_10 * 0.5) + (APM_5 * 0.3) + (APM_3 * 0.2)
    const ipr = (apm10 * 0.5) + (apm5 * 0.3) + (apm3 * 0.2);

    return {
      apmGlobal: Math.round(apmGlobal * 100) / 100,
      apm10: Math.round(apm10 * 100) / 100,
      apm5: Math.round(apm5 * 100) / 100,
      apm3: Math.round(apm3 * 100) / 100,
      accelerationFactor: Math.round(accelerationFactor * 100) / 100,
      ipr: Math.round(ipr * 100) / 100,
    };
  };

  return {
    home: calculateSideAPM(true, globalHomeDA),
    away: calculateSideAPM(false, globalAwayDA),
  };
}
