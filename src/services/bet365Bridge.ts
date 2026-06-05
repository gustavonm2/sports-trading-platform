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

// Mapa de tradução PT→EN para seleções/times com nomes muito diferentes entre idiomas
const TEAM_NAME_TRANSLATIONS: Record<string, string> = {
  // Seleções — nomes que o LCS/fuzzy não consegue resolver
  'costa do marfim': 'ivory coast',
  'cote divoire': 'ivory coast',
  'franca': 'france',
  'alemanha': 'germany',
  'inglaterra': 'england',
  'espanha': 'spain',
  'italia': 'italy',
  'holanda': 'netherlands',
  'paises baixos': 'netherlands',
  'suica': 'switzerland',
  'suecia': 'sweden',
  'noruega': 'norway',
  'dinamarca': 'denmark',
  'belgica': 'belgium',
  'turquia': 'turkey',
  'turkiye': 'turkey',
  'grecia': 'greece',
  'croacia': 'croatia',
  'servia': 'serbia',
  'romenia': 'romania',
  'hungria': 'hungary',
  'polonia': 'poland',
  'ucrania': 'ukraine',
  'russia': 'russia',
  'escocia': 'scotland',
  'irlanda': 'ireland',
  'irlanda do norte': 'northern ireland',
  'pais de gales': 'wales',
  'estados unidos': 'united states',
  'eua': 'united states',
  'coreia do sul': 'south korea',
  'coreia sul': 'south korea',
  'coreia do norte': 'north korea',
  'japao': 'japan',
  'china': 'china',
  'australia': 'australia',
  'nova zelandia': 'new zealand',
  'africa do sul': 'south africa',
  'arabia saudita': 'saudi arabia',
  'emirados arabes': 'uae',
  'republica tcheca': 'czech republic',
  'tchequi': 'czech republic',
  'eslovaquia': 'slovakia',
  'eslovenia': 'slovenia',
  'bosnia': 'bosnia',
  'macedonia': 'north macedonia',
  'macedonia do norte': 'north macedonia',
  'montenegro': 'montenegro',
  'georgia': 'georgia',
  'azerbaijao': 'azerbaijan',
  'cazaquistao': 'kazakhstan',
  'israel': 'israel',
  'marrocos': 'morocco',
  'tunisia': 'tunisia',
  'argelia': 'algeria',
  'egito': 'egypt',
  'camaroes': 'cameroon',
  'senegal': 'senegal',
  'gana': 'ghana',
  'nigeria': 'nigeria',
  'congo': 'congo',
  'paraguai': 'paraguay',
  'uruguai': 'uruguay',
  'equador': 'ecuador',
  'venezuela': 'venezuela',
  'colombia': 'colombia',
  'peru': 'peru',
  'bolivia': 'bolivia',
  'chile': 'chile',
  'mexico': 'mexico',
  'costa rica': 'costa rica',
  'panama': 'panama',
  'honduras': 'honduras',
  'jamaica': 'jamaica',
  'iraque': 'iraq',
  'ira': 'iran',
  'catar': 'qatar',
  'libano': 'lebanon',
  'jordania': 'jordan',
  'chipre': 'cyprus',
  'andorra': 'andorra',
  'liechtenstein': 'liechtenstein',
  'luxemburgo': 'luxembourg',
  'malta': 'malta',
  'islandia': 'iceland',
  'finlandia': 'finland',
  'estonia': 'estonia',
  'letonia': 'latvia',
  'lituania': 'lithuania',
  'albania': 'albania',
  'guine': 'guinea',
};

function normalizeTeamName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/\b(fc|sc|cf|ac|rc|cd|ud|ca|se|ec|cr|sp|rj|mg|rs|pr|ba|ce|pa|go|es|al|pe|ma|am|pi|mt|ms|to|df|ap|rr|ro|ac|club|united|city|sport|sporting|athletic|atletico|athletic|town|rovers|wanderers|albion)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  
  // Tentar tradução antes de remover espaços
  const translated = TEAM_NAME_TRANSLATIONS[cleaned];
  if (translated) return translated.replace(/[^a-z0-9]/g, '');
  
  return cleaned.replace(/\s+/g, '');
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
      const directOverwriteFields = ['possession', 'shotsOnGoal', 'shotsOffGoal', 'totalShots', 'yellowCards', 'redCards'];
      if (directOverwriteFields.includes(apiField as string)) {
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
  /** Tempo coberto pelos snapshots em minutos (0 = sem dados) */
  dataAge: number;
  /** Confiabilidade de cada janela: true = dados suficientes, false = fallback para global */
  reliable10: boolean;
  reliable5: boolean;
  reliable3: boolean;
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
      dataAge: 0,
      reliable10: false,
      reliable5: false,
      reliable3: false,
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
  const earliestSnap = sortedSnaps[0];
  
  // ⚠️ dataAge usa TIMESTAMP REAL (wall-clock), não elapsed do jogo.
  // Isso evita inflar o dataAge quando a telemetria acabou de ser ativada
  // em um jogo que já está rolando (ex: ativar no min 38, dataAge = 0, não 13).
  const dataAgeMs = (currentSnap.timestamp && earliestSnap.timestamp) 
    ? currentSnap.timestamp - earliestSnap.timestamp 
    : 0;
  const dataAge = Math.max(0, dataAgeMs / 60000); // em minutos reais
  
  // Elapsed coverage (para cálculos de janela que usam minuto do jogo)
  const elapsedCoverage = currentSnap.elapsed - earliestSnap.elapsed;

  const calculateSideAPM = (
    isHome: boolean,
    globalDA: number
  ): APMMetrics => {
    const getDA = (s: TelemetrySnapshot) => (isHome ? s.homeDA : s.awayDA);
    const apmGlobal = currentElapsed > 0 ? globalDA / currentElapsed : 0;
    
    // ─── Tempo no meio-tempo atual (2º tempo reinicia contagem) ──────
    const halfElapsed = currentElapsed > 45 ? currentElapsed - 45 : currentElapsed;

    // ─── Janelas de ativação por tempo do meio ──────────────────────
    const RAMP_DURATION = 5;
    
    const ramp = (activateAt: number): number => {
      if (halfElapsed < activateAt) return 0;
      if (halfElapsed >= activateAt + RAMP_DURATION) return 1;
      return (halfElapsed - activateAt) / RAMP_DURATION;
    };

    const ramp10 = ramp(20);
    const ramp5  = ramp(25);
    const ramp3  = ramp(30);
    
    // ─── Cálculo com detecção de dados insuficientes ─────────────────
    // Uma janela é CONFIÁVEL se temos snapshots cobrindo pelo menos 60% dela
    // Ex: ATM 10 precisa de pelo menos 6 min de dados
    const MIN_COVERAGE = 0.6; // 60% da janela coberta
    
    const getApmForWindow = (minutes: number): { value: number; reliable: boolean } => {
      const targetTime = currentElapsed - minutes;
      
      // Verificar cobertura: usar elapsed coverage (minutos de jogo cobertos)
      const coverageMinutes = elapsedCoverage;
      const isReliable = coverageMinutes >= (minutes * MIN_COVERAGE) && dataAge >= 2;
      
      if (targetTime <= 0) {
        // Jogo não tem tempo suficiente para esta janela
        // Se menos de 2 min reais de dados, usar APM Global para evitar valores distorcidos
        if (dataAge >= 2 && elapsedCoverage > 0) {
          const daDiff = getDA(currentSnap) - getDA(earliestSnap);
          const apm = Math.max(0, daDiff / elapsedCoverage);
          return { value: apm, reliable: false };
        }
        return { value: apmGlobal, reliable: false };
      }
      
      // Encontrar snapshot mais próximo do targetTime
      let closest = sortedSnaps[0];
      let minDiff = Math.abs(closest.elapsed - targetTime);
      for (const s of sortedSnaps) {
        const diff = Math.abs(s.elapsed - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = s;
        }
      }

      // Se o snapshot mais próximo está muito longe do target → dados insuficientes
      // Gap máximo aceitável: 40% da janela
      const maxGap = minutes * 0.4;
      if (minDiff > maxGap) {
        // Dados insuficientes → usar APM Global se tempo real < 2 min
        if (dataAge >= 2 && elapsedCoverage > 0) {
          const daDiff = getDA(currentSnap) - getDA(earliestSnap);
          return { value: Math.max(0, daDiff / elapsedCoverage), reliable: false };
        }
        return { value: apmGlobal, reliable: false };
      }

      const daDiff = getDA(currentSnap) - getDA(closest);
      const actualWindow = currentSnap.elapsed - closest.elapsed;
      if (daDiff <= 0 || actualWindow <= 0) return { value: 0, reliable: isReliable };
      return { value: Math.max(0, daDiff / minutes), reliable: isReliable };
    };

    const raw10 = getApmForWindow(10);
    const raw5 = getApmForWindow(5);
    const raw3 = getApmForWindow(3);

    // ─── Se dados insuficientes, usar APM Global em vez de valor distorcido ─
    const rawApm10 = raw10.reliable ? raw10.value : apmGlobal;
    const rawApm5  = raw5.reliable  ? raw5.value  : apmGlobal;
    const rawApm3  = raw3.reliable  ? raw3.value  : apmGlobal;

    // ─── Aplicar ramp: mistura suave entre APM Global e APM da janela ─
    const apm10 = ramp10 * rawApm10 + (1 - ramp10) * apmGlobal;
    const apm5  = ramp5  * rawApm5  + (1 - ramp5)  * apmGlobal;
    const apm3  = ramp3  * rawApm3  + (1 - ramp3)  * apmGlobal;

    // ─── Fator de Aceleração ──────────────────────────────────────────
    const MIN_APM_FOR_ACCELERATION = 0.3;
    const recentAPM = ramp3 >= 0.5 ? apm3 : ramp5 >= 0.5 ? apm5 : ramp10 >= 0.5 ? apm10 : apmGlobal;
    const rawAcceleration = apmGlobal > 0 ? recentAPM / apmGlobal : 1.0;
    const accelerationFactor = recentAPM >= MIN_APM_FOR_ACCELERATION
      ? rawAcceleration 
      : Math.min(rawAcceleration, 1.0);

    // ─── IPR com pesos dinâmicos ──────────────────────────────────────
    const w10 = 0.5 * ramp10;
    const w5  = 0.3 * ramp5;
    const w3  = 0.2 * ramp3;
    const totalWeight = w10 + w5 + w3;

    let ipr: number;
    if (totalWeight > 0) {
      ipr = (apm10 * w10 + apm5 * w5 + apm3 * w3) / totalWeight;
    } else {
      ipr = apmGlobal;
    }

    return {
      apmGlobal: Math.round(apmGlobal * 100) / 100,
      apm10: Math.round(apm10 * 100) / 100,
      apm5: Math.round(apm5 * 100) / 100,
      apm3: Math.round(apm3 * 100) / 100,
      accelerationFactor: Math.round(accelerationFactor * 100) / 100,
      ipr: Math.round(ipr * 100) / 100,
      dataAge: Math.round(dataAge * 10) / 10,
      reliable10: raw10.reliable && ramp10 > 0,
      reliable5: raw5.reliable && ramp5 > 0,
      reliable3: raw3.reliable && ramp3 > 0,
    };
  };

  return {
    home: calculateSideAPM(true, globalHomeDA),
    away: calculateSideAPM(false, globalAwayDA),
  };
}
