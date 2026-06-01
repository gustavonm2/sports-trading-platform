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

import type { MatchStats, TeamStats } from './apiSports';

// ─── Tipos da Bridge ───

export interface Bet365MatchData {
  storageKey: string;
  homeTeam: string;
  awayTeam: string;
  timestamp: number;
  home: Partial<Record<string, number>>;
  away: Partial<Record<string, number>>;
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
    if (typeof bet365Val === 'number' && bet365Val > 0) {
      // Se a API já tem dados para este campo, usar o maior
      // Se a API tem 0, usar o valor da Bet365
      const apiVal = merged[side][apiField] as number;
      if (apiVal === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged[side] as any)[apiField] = bet365Val;
      }
    }
  };

  // 🎯 Campos mais valiosos (que a API geralmente não fornece)
  mergeField('home', 'dangerousAttacks', 'dangerousAttacks');
  mergeField('away', 'dangerousAttacks', 'dangerousAttacks');
  mergeField('home', 'attacks', 'attacks');
  mergeField('away', 'attacks', 'attacks');

  // 📊 Campos que a API já fornece (backup apenas se zerados)
  mergeField('home', 'shotsOnGoal', 'shotsOnGoal');
  mergeField('away', 'shotsOnGoal', 'shotsOnGoal');
  mergeField('home', 'shotsOffGoal', 'shotsOffGoal');
  mergeField('away', 'shotsOffGoal', 'shotsOffGoal');
  mergeField('home', 'corners', 'corners');
  mergeField('away', 'corners', 'corners');
  mergeField('home', 'possession', 'possession');
  mergeField('away', 'possession', 'possession');
  mergeField('home', 'yellowCards', 'yellowCards');
  mergeField('away', 'yellowCards', 'yellowCards');
  mergeField('home', 'redCards', 'redCards');
  mergeField('away', 'redCards', 'redCards');

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

  if (hasBet365 && stats.dangerousAttacks > 0) {
    // IIM ENRIQUECIDO: com Dangerous Attacks (dado mais valioso da Bet365)
    const raw = (
      stats.dangerousAttacks * 2.5 +
      stats.shotsOnGoal * 3.0 +
      stats.shotsOffGoal * 1.0 +
      stats.corners * 2.0 +
      (stats.attacks || 0) * 0.5
    ) / elapsed;
    return Math.round(raw * 100) / 100;
  }

  // IIM PADRÃO: sem Bet365
  const raw = (
    stats.shotsOnGoal * 3.0 +
    stats.shotsOffGoal * 1.2 +
    stats.corners * 2.0 +
    (stats.blockedShots || 0) * 0.8
  ) / elapsed;
  return Math.round(raw * 100) / 100;
}

// ─── Event Listener Manager ───

type BridgeCallback = (payload: Bet365BridgePayload) => void;

let currentCallback: BridgeCallback | null = null;

/**
 * Registra um listener para dados da Bet365 Bridge
 * Retorna uma função de cleanup
 */
export function onBet365Data(callback: BridgeCallback): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<Bet365BridgePayload>;
    callback(customEvent.detail);
  };

  window.addEventListener('bet365-bridge-data', handler);
  currentCallback = callback;

  return () => {
    window.removeEventListener('bet365-bridge-data', handler);
    currentCallback = null;
  };
}

/**
 * Verifica se a bridge está disponível (extensão instalada + dados frescos)
 */
export function isBridgeAvailable(): boolean {
  return currentCallback !== null;
}
