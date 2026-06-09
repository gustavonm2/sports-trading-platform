// ═══════════════════════════════════════════════════════════════════════════════
// learningEngine.ts — Motor de Aprendizado para a plataforma de trading esportivo
// ═══════════════════════════════════════════════════════════════════════════════
// Responsável por capturar snapshots de trades, persistir no Supabase,
// analisar padrões estatísticos localmente e gerar relatórios via Gemini AI.
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de mercado e modo operacional
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de mercado operado */
export type MarketType = 'gols' | 'escanteios';

/** Resultado final do trade */
export type TradeOutcome = 'green' | 'red' | 'void';

/** Tier da liga (afeta a confiabilidade dos dados) */
export type LeagueTier = 100 | 70 | 40 | 10;

// ─────────────────────────────────────────────────────────────────────────────
// Interface principal: TradeEntry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registro completo de um trade capturado.
 * Contém todas as métricas APM, normalizadas, raw stats e contexto do jogo
 * no momento exato da entrada.
 */
export interface TradeEntry {
  // Identificadores
  id?: string;
  created_at?: string;

  // Informações da partida
  fixture_id: number;
  league: string;
  home_team: string;
  away_team: string;
  elapsed: number;
  period: string; // '1H' | '2H' | 'HT'
  goals_home: number;
  goals_away: number;
  source: string; // Fonte de dados (ex: 'api-sports', 'sofascore')

  // Tier da liga
  league_tier: LeagueTier;

  // Métricas APM — Mandante
  home_apm_global: number;
  home_apm_10: number;
  home_apm_5: number;
  home_apm_3: number;
  home_ipr: number;
  home_acceleration_factor: number;

  // Métricas APM — Visitante
  away_apm_global: number;
  away_apm_10: number;
  away_apm_5: number;
  away_apm_3: number;
  away_ipr: number;
  away_acceleration_factor: number;

  // Métricas normalizadas — Mandante
  home_niap: number;
  home_ncg: number;
  home_nesc: number;
  home_nft: number;
  home_ncv: number;
  home_npos: number;
  home_nca: number;

  // Métricas normalizadas — Visitante
  away_niap: number;
  away_ncg: number;
  away_nesc: number;
  away_nft: number;
  away_ncv: number;
  away_npos: number;
  away_nca: number;

  // Scores compostos
  home_score: number;
  away_score: number;
  home_pls: number;
  away_pls: number;
  home_qual_pct: number;
  away_qual_pct: number;

  // Stats brutos — Mandante
  home_shots_on: number;
  home_total_shots: number;
  home_corners: number;
  home_possession: number;
  home_da: number;
  home_yellow: number;
  home_red: number;

  // Stats brutos — Visitante
  away_shots_on: number;
  away_total_shots: number;
  away_corners: number;
  away_possession: number;
  away_da: number;
  away_yellow: number;
  away_red: number;

  // Contexto do trade
  market_type: MarketType;
  bet_type: string; // Descrição da aposta (ex: 'Over 2.5 Gols', 'Under 8.5 Corners')
  operating_mode: string; // Modo de operação (ex: 'manual', 'assistido', 'automático')
  score_weights: Record<string, number>; // Pesos utilizados no score final

  // Resolução (preenchidos após o trade ser resolvido)
  outcome?: TradeOutcome;
  resolved_at?: string;
  final_goals_home?: number;
  final_goals_away?: number;
  final_corners_home?: number;
  final_corners_away?: number;
  profit_loss?: number;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface: Recomendação de IA
// ─────────────────────────────────────────────────────────────────────────────

/** Uma recomendação individual gerada pela análise */
export interface AIRecommendation {
  /** Tipo da recomendação */
  type: 'avoid' | 'prefer' | 'insight' | 'warning';
  /** Nível de confiança (0-100) */
  confidence: number;
  /** Texto descritivo da recomendação */
  description: string;
  /** Métricas ou condições associadas */
  conditions?: Record<string, string | number>;
  /** Impacto estimado na taxa de acerto */
  estimated_impact?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface: Relatório de Aprendizado
// ─────────────────────────────────────────────────────────────────────────────

/** Relatório consolidado de análise de padrões */
export interface LearningReport {
  id?: string;
  created_at?: string;

  /** Período coberto pelo relatório */
  period_start: string;
  period_end: string;

  /** Total de entradas analisadas */
  total_entries: number;

  /** Taxa de acerto geral (0-100) */
  overall_win_rate: number;

  /** Taxa de acerto por tier de liga */
  win_rate_by_tier: Record<string, number>;

  /** Taxa de acerto por faixa de minuto */
  win_rate_by_elapsed: Record<string, number>;

  /** Taxa de acerto por faixa de score */
  win_rate_by_score_range: Record<string, number>;

  /** Taxa de acerto por tipo de mercado */
  win_rate_by_market: Record<string, number>;

  /** Métricas mais correlacionadas com green */
  top_green_correlations: Array<{ metric: string; correlation: number }>;

  /** Métricas mais correlacionadas com red */
  top_red_correlations: Array<{ metric: string; correlation: number }>;

  /** Recomendações geradas */
  recommendations: AIRecommendation[];

  /** Fonte da análise ('local' ou 'gemini') */
  analysis_source: 'local' | 'gemini';

  /** Dados brutos resumidos (opcional) */
  raw_summary?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parâmetros para captureTradeSnapshot
// ─────────────────────────────────────────────────────────────────────────────

/** Parâmetros de APM por equipe */
interface ApmParams {
  apmGlobal: number;
  apm10: number;
  apm5: number;
  apm3: number;
  ipr: number;
  accelerationFactor: number;
}

/** Métricas normalizadas por equipe */
interface NormalizedParams {
  niap: number;
  ncg: number;
  nesc: number;
  nft: number;
  ncv: number;
  npos: number;
  nca: number;
}

/** Stats brutos por equipe */
interface RawStatsParams {
  shotsOn: number;
  totalShots: number;
  corners: number;
  possession: number;
  da: number;
  yellow: number;
  red: number;
}

/** Parâmetros completos para capturar um snapshot do trade */
export interface CaptureTradeParams {
  // Informações da partida
  fixtureId: number;
  league: string;
  homeTeam: string;
  awayTeam: string;
  elapsed: number;
  period: string;
  goalsHome: number;
  goalsAway: number;
  source: string;
  leagueTier: LeagueTier;

  // APM por equipe
  homeApm: ApmParams;
  awayApm: ApmParams;

  // Métricas normalizadas por equipe
  homeNormalized: NormalizedParams;
  awayNormalized: NormalizedParams;

  // Scores compostos
  homeScore: number;
  awayScore: number;
  homePLS: number;
  awayPLS: number;
  homeQualPct: number;
  awayQualPct: number;

  // Stats brutos por equipe
  homeRawStats: RawStatsParams;
  awayRawStats: RawStatsParams;

  // Contexto do trade
  marketType: MarketType;
  betType: string;
  operatingMode: string;
  scoreWeights: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES PRINCIPAIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * captureTradeSnapshot — Monta um objeto TradeEntry a partir dos dados do jogo.
 * Não salva no banco; retorna o objeto pronto para inserção.
 */
export function captureTradeSnapshot(params: CaptureTradeParams): TradeEntry {
  return {
    // Informações da partida
    fixture_id: params.fixtureId,
    league: params.league,
    home_team: params.homeTeam,
    away_team: params.awayTeam,
    elapsed: params.elapsed,
    period: params.period,
    goals_home: params.goalsHome,
    goals_away: params.goalsAway,
    source: params.source,
    league_tier: params.leagueTier,

    // APM Mandante
    home_apm_global: params.homeApm.apmGlobal,
    home_apm_10: params.homeApm.apm10,
    home_apm_5: params.homeApm.apm5,
    home_apm_3: params.homeApm.apm3,
    home_ipr: params.homeApm.ipr,
    home_acceleration_factor: params.homeApm.accelerationFactor,

    // APM Visitante
    away_apm_global: params.awayApm.apmGlobal,
    away_apm_10: params.awayApm.apm10,
    away_apm_5: params.awayApm.apm5,
    away_apm_3: params.awayApm.apm3,
    away_ipr: params.awayApm.ipr,
    away_acceleration_factor: params.awayApm.accelerationFactor,

    // Normalizadas Mandante
    home_niap: params.homeNormalized.niap,
    home_ncg: params.homeNormalized.ncg,
    home_nesc: params.homeNormalized.nesc,
    home_nft: params.homeNormalized.nft,
    home_ncv: params.homeNormalized.ncv,
    home_npos: params.homeNormalized.npos,
    home_nca: params.homeNormalized.nca,

    // Normalizadas Visitante
    away_niap: params.awayNormalized.niap,
    away_ncg: params.awayNormalized.ncg,
    away_nesc: params.awayNormalized.nesc,
    away_nft: params.awayNormalized.nft,
    away_ncv: params.awayNormalized.ncv,
    away_npos: params.awayNormalized.npos,
    away_nca: params.awayNormalized.nca,

    // Scores compostos
    home_score: params.homeScore,
    away_score: params.awayScore,
    home_pls: params.homePLS,
    away_pls: params.awayPLS,
    home_qual_pct: params.homeQualPct,
    away_qual_pct: params.awayQualPct,

    // Stats brutos Mandante
    home_shots_on: params.homeRawStats.shotsOn,
    home_total_shots: params.homeRawStats.totalShots,
    home_corners: params.homeRawStats.corners,
    home_possession: params.homeRawStats.possession,
    home_da: params.homeRawStats.da,
    home_yellow: params.homeRawStats.yellow,
    home_red: params.homeRawStats.red,

    // Stats brutos Visitante
    away_shots_on: params.awayRawStats.shotsOn,
    away_total_shots: params.awayRawStats.totalShots,
    away_corners: params.awayRawStats.corners,
    away_possession: params.awayRawStats.possession,
    away_da: params.awayRawStats.da,
    away_yellow: params.awayRawStats.yellow,
    away_red: params.awayRawStats.red,

    // Contexto do trade
    market_type: params.marketType,
    bet_type: params.betType,
    operating_mode: params.operatingMode,
    score_weights: params.scoreWeights,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência no Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * saveTradeEntry — Salva uma entrada de trade na tabela `trade_entries`.
 * Retorna o registro inserido com o `id` gerado.
 */
export async function saveTradeEntry(entry: TradeEntry): Promise<TradeEntry> {
  const { data, error } = await supabase
    .from('trade_entries')
    .insert([entry])
    .select()
    .single();

  if (error) {
    console.error('[LearningEngine] Erro ao salvar trade entry:', error);
    throw new Error(`Falha ao salvar entrada de trade: ${error.message}`);
  }

  return data as TradeEntry;
}

/**
 * saveSimplifiedTradeEntry — Salva uma entrada simplificada (vinda do Diário).
 * Preenche todos os campos obrigatórios de métricas com 0.
 * Retorna o registro inserido.
 */
export async function saveSimplifiedTradeEntry(params: {
  diaryTradeId: string;
  matchName: string;
  market: string;
  odd: number;
  stake: number;
  status: 'GREEN' | 'RED' | 'PENDING';
  profitLoss: number;
}): Promise<TradeEntry | null> {
  // Parse team names from "Team A x Team B"
  const parts = params.matchName.split(/\s+x\s+/i);
  const homeTeam = parts[0]?.trim() || params.matchName;
  const awayTeam = parts[1]?.trim() || 'N/A';

  // Map Diary market to learning market_type
  const marketType: MarketType = params.market.toLowerCase().includes('gol') ? 'gols' : 'escanteios';

  // Map outcome
  let outcome: TradeOutcome | undefined;
  if (params.status === 'GREEN') outcome = 'green';
  else if (params.status === 'RED') outcome = 'red';

  const entry: Partial<TradeEntry> = {
    // Match info
    fixture_id: 0,
    league: 'Manual',
    home_team: homeTeam,
    away_team: awayTeam,
    elapsed: 0,
    period: 'N/A',
    goals_home: 0,
    goals_away: 0,
    source: 'diary',
    league_tier: 40,

    // APM (all zero — not available from Diary)
    home_apm_global: 0, home_apm_10: 0, home_apm_5: 0, home_apm_3: 0, home_ipr: 0, home_acceleration_factor: 0,
    away_apm_global: 0, away_apm_10: 0, away_apm_5: 0, away_apm_3: 0, away_ipr: 0, away_acceleration_factor: 0,

    // Normalized (all zero)
    home_niap: 0, home_ncg: 0, home_nesc: 0, home_nft: 0, home_ncv: 0, home_npos: 0, home_nca: 0,
    away_niap: 0, away_ncg: 0, away_nesc: 0, away_nft: 0, away_ncv: 0, away_npos: 0, away_nca: 0,

    // Scores (all zero)
    home_score: 0, away_score: 0, home_pls: 0, away_pls: 0, home_qual_pct: 0, away_qual_pct: 0,

    // Raw stats (all zero)
    home_shots_on: 0, home_total_shots: 0, home_corners: 0, home_possession: 0, home_da: 0, home_yellow: 0, home_red: 0,
    away_shots_on: 0, away_total_shots: 0, away_corners: 0, away_possession: 0, away_da: 0, away_yellow: 0, away_red: 0,

    // Trade context
    market_type: marketType,
    bet_type: params.market,
    operating_mode: 'manual',
    score_weights: {},

    // Resolution
    outcome,
    resolved_at: outcome ? new Date().toISOString() : undefined,
    profit_loss: params.profitLoss,
    notes: `Diary ID: ${params.diaryTradeId}`,
  };

  try {
    const { data, error } = await supabase
      .from('trade_entries')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.error('[LearningEngine] ❌ Erro ao sincronizar com aprendizagem:', error.code, error.message, error.details, error.hint);
      return null;
    }

    console.log('[LearningEngine] ✅ Entrada salva na aprendizagem:', data?.id);
    return data as TradeEntry;
  } catch (err) {
    console.error('[LearningEngine] ❌ Exception ao sincronizar:', err);
    return null;
  }
}

/**
 * syncDiaryOutcome — Atualiza o outcome de uma entrada do learning vinculada a um diary trade.
 * Busca pelo notes contendo o diary ID e atualiza.
 */
export async function syncDiaryOutcome(
  diaryTradeId: string,
  outcome: TradeOutcome,
  profitLoss: number
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('trade_entries')
      .update({
        outcome,
        resolved_at: new Date().toISOString(),
        profit_loss: profitLoss,
      })
      .like('notes', `%${diaryTradeId}%`)
      .select();

    if (error) {
      console.warn('[LearningEngine] Erro ao sincronizar outcome:', error.message);
    } else if (data && data.length === 0) {
      console.warn('[LearningEngine] Nenhuma entrada encontrada para diary ID:', diaryTradeId);
    }
  } catch (err) {
    console.warn('[LearningEngine] syncDiaryOutcome falhou silenciosamente:', err);
  }
}

/**
 * resolveTradeEntry — Atualiza o resultado de um trade existente.
 * Agora opera diretamente na tabela `trades` do Diário.
 */
export async function resolveTradeEntry(
  id: string,
  outcome: TradeOutcome,
  resolution: {
    finalGoalsHome?: number;
    finalGoalsAway?: number;
    finalCornersHome?: number;
    finalCornersAway?: number;
    profitLoss?: number;
    notes?: string;
  }
): Promise<TradeEntry> {
  // Map outcome to Diary status format
  const status = outcome === 'green' ? 'GREEN' : outcome === 'red' ? 'RED' : 'PENDING';

  const updatePayload: Record<string, any> = {
    status,
    profit_loss: resolution.profitLoss || 0,
  };

  const { data, error } = await supabase
    .from('trades')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[LearningEngine] Erro ao resolver trade:', error);
    throw new Error(`Falha ao resolver trade: ${error.message}`);
  }

  // Converte de volta para o formato TradeEntry
  return convertDiaryToTradeEntry(data);
}

/** Filtros opcionais para buscar entradas */
export interface TradeEntryFilters {
  /** Filtrar por tipo de mercado */
  marketType?: MarketType;
  /** Filtrar por outcome específico */
  outcome?: TradeOutcome;
  /** Filtrar apenas resolvidos */
  resolvedOnly?: boolean;
  /** Filtrar por tier de liga */
  leagueTier?: LeagueTier;
  /** Data inicial (ISO string) */
  dateFrom?: string;
  /** Data final (ISO string) */
  dateTo?: string;
  /** Limite de registros retornados */
  limit?: number;
}

/**
 * getTradeEntries — Busca entradas de trade DIRETAMENTE da tabela `trades` do Diário.
 * Converte os registros do formato simplificado para o formato TradeEntry da Aprendizagem.
 * Isso garante que toda entrada no Diário apareça automaticamente na Aprendizagem.
 */
export async function getTradeEntries(filters?: TradeEntryFilters): Promise<TradeEntry[]> {
  // Primeiro tenta ler da tabela `trades` (Diário) — fonte primária
  let query = supabase
    .from('trades')
    .select('*')
    .order('created_at', { ascending: false });

  // Aplica filtros de outcome mapeando GREEN→green, RED→red
  if (filters?.outcome) {
    query = query.eq('status', filters.outcome.toUpperCase());
  }
  if (filters?.resolvedOnly) {
    query = query.neq('status', 'PENDING');
  }
  if (filters?.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[LearningEngine] Erro ao buscar trades do diário:', error);
    // Fallback: tenta ler de localStorage
    const localTrades = localStorage.getItem('trades_db_replica');
    if (localTrades) {
      const parsed = JSON.parse(localTrades);
      return parsed.map((t: any) => convertDiaryToTradeEntry(t));
    }
    return [];
  }

  // Converte cada registro do Diário para o formato TradeEntry
  return (data || []).map((t: any) => convertDiaryToTradeEntry(t));
}

/**
 * Converte um registro da tabela `trades` (Diário) para o formato TradeEntry (Aprendizagem).
 * Se o registro possui `metrics` JSONB (capturado via Peguei no Radar), usa os dados reais.
 */
function convertDiaryToTradeEntry(t: any): TradeEntry {
  // Parse team names from "Team A x Team B"
  const parts = (t.match_name || '').split(/\s+x\s+/i);
  const homeTeam = parts[0]?.trim() || t.match_name || 'N/A';
  const awayTeam = parts[1]?.trim() || 'N/A';

  // Map market string to MarketType
  const marketStr = (t.market || '').toLowerCase();
  const marketType: MarketType = marketStr.includes('gol') || marketStr.includes('over') ? 'gols' : 'escanteios';

  // Map status to outcome
  let outcome: TradeOutcome | undefined;
  if (t.status === 'GREEN') outcome = 'green';
  else if (t.status === 'RED') outcome = 'red';

  // 📸 Ler métricas do snapshot (capturadas pelo Peguei no Radar)
  const m = t.metrics || {};
  const hasMetrics = Object.keys(m).length > 0;

  return {
    id: t.id,
    created_at: t.created_at,
    fixture_id: 0,
    league: m.league || 'Manual',
    home_team: homeTeam,
    away_team: awayTeam,
    elapsed: m.elapsed || 0,
    period: m.period || 'N/A',
    goals_home: m.goals_home ?? 0,
    goals_away: m.goals_away ?? 0,
    source: hasMetrics ? 'radar' : 'diary',
    league_tier: 40,

    // APM
    home_apm_global: 0,
    home_apm_10: m.home_apm_10 || 0,
    home_apm_5: m.home_apm_5 || 0,
    home_apm_3: m.home_apm_3 || 0,
    home_ipr: m.home_ipr || 0,
    home_acceleration_factor: 0,

    away_apm_global: 0,
    away_apm_10: m.away_apm_10 || 0,
    away_apm_5: m.away_apm_5 || 0,
    away_apm_3: m.away_apm_3 || 0,
    away_ipr: m.away_ipr || 0,
    away_acceleration_factor: 0,

    // Normalized (calculated from raw stats)
    home_niap: 0, home_ncg: 0, home_nesc: 0, home_nft: 0, home_ncv: 0, home_npos: 0, home_nca: 0,
    away_niap: 0, away_ncg: 0, away_nesc: 0, away_nft: 0, away_ncv: 0, away_npos: 0, away_nca: 0,

    // Scores compostos
    home_score: m.home_score || 0,
    away_score: m.away_score || 0,
    home_pls: 0,
    away_pls: 0,
    home_qual_pct: 0,
    away_qual_pct: 0,

    // Stats brutos
    home_shots_on: m.home_shots_on || 0,
    home_total_shots: m.home_total_shots || 0,
    home_corners: m.home_corners || 0,
    home_possession: m.home_possession || 0,
    home_da: m.home_da || 0,
    home_yellow: m.home_yellow || 0,
    home_red: m.home_red || 0,

    away_shots_on: m.away_shots_on || 0,
    away_total_shots: m.away_total_shots || 0,
    away_corners: m.away_corners || 0,
    away_possession: m.away_possession || 0,
    away_da: m.away_da || 0,
    away_yellow: m.away_yellow || 0,
    away_red: m.away_red || 0,

    // Context
    market_type: marketType,
    bet_type: t.market || '',
    operating_mode: hasMetrics ? 'radar' : 'manual',
    score_weights: {},

    // Resolution
    outcome,
    resolved_at: outcome ? t.created_at : undefined,
    profit_loss: t.profit_loss || 0,
    notes: '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANÁLISE DE PADRÕES — Motor Estatístico Local
// ═══════════════════════════════════════════════════════════════════════════════

/** Faixas de minuto para agrupamento */
const ELAPSED_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-15', min: 0, max: 15 },
  { label: '15-30', min: 16, max: 30 },
  { label: '30-45', min: 31, max: 45 },
  { label: '45-60', min: 46, max: 60 },
  { label: '60-75', min: 61, max: 75 },
  { label: '75-90', min: 76, max: 90 },
];

/** Faixas de score composto para agrupamento */
const SCORE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-3', min: 0, max: 3 },
  { label: '3-5', min: 3, max: 5 },
  { label: '5-7', min: 5, max: 7 },
  { label: '7-10', min: 7, max: 10 },
];

/** Nomes legíveis dos tiers */
const TIER_LABELS: Record<number, string> = {
  100: 'Elite',
  70: 'Tier 2',
  40: 'Outros',
  10: 'Juvenil',
};

/**
 * Calcula taxa de acerto (win rate) para um subconjunto de entries.
 * Ignora trades com outcome 'void'.
 */
function calculateWinRate(entries: TradeEntry[]): number {
  const resolved = entries.filter(e => e.outcome && e.outcome !== 'void');
  if (resolved.length === 0) return 0;

  const greens = resolved.filter(e => e.outcome === 'green').length;
  return Number(((greens / resolved.length) * 100).toFixed(1));
}

/**
 * Calcula correlação ponto-biserial entre uma métrica numérica
 * e o resultado binário (green=1, red=0).
 * Métrica simplificada mas eficaz para identificar padrões.
 */
function calculateCorrelation(entries: TradeEntry[], metricExtractor: (e: TradeEntry) => number): number {
  const resolved = entries.filter(e => e.outcome === 'green' || e.outcome === 'red');
  if (resolved.length < 5) return 0; // Mínimo de 5 entries para significância

  const greens = resolved.filter(e => e.outcome === 'green');
  const reds = resolved.filter(e => e.outcome === 'red');

  if (greens.length === 0 || reds.length === 0) return 0;

  // Média da métrica para greens e reds
  const meanGreen = greens.reduce((sum, e) => sum + metricExtractor(e), 0) / greens.length;
  const meanRed = reds.reduce((sum, e) => sum + metricExtractor(e), 0) / reds.length;

  // Desvio padrão geral da métrica
  const allValues = resolved.map(metricExtractor);
  const meanAll = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const variance = allValues.reduce((sum, v) => sum + (v - meanAll) ** 2, 0) / allValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Correlação ponto-biserial simplificada
  const n = resolved.length;
  const nGreen = greens.length;
  const nRed = reds.length;
  const correlation = ((meanGreen - meanRed) / stdDev) * Math.sqrt((nGreen * nRed) / (n * n));

  return Number(correlation.toFixed(3));
}

/**
 * Mapa de métricas numéricas extraíveis de um TradeEntry.
 * Usado para calcular correlações automaticamente.
 */
const METRIC_EXTRACTORS: Array<{ name: string; extractor: (e: TradeEntry) => number }> = [
  // APM Mandante
  { name: 'home_apm_global', extractor: e => e.home_apm_global },
  { name: 'home_apm_10', extractor: e => e.home_apm_10 },
  { name: 'home_apm_5', extractor: e => e.home_apm_5 },
  { name: 'home_apm_3', extractor: e => e.home_apm_3 },
  { name: 'home_ipr', extractor: e => e.home_ipr },
  { name: 'home_acceleration_factor', extractor: e => e.home_acceleration_factor },
  // APM Visitante
  { name: 'away_apm_global', extractor: e => e.away_apm_global },
  { name: 'away_apm_10', extractor: e => e.away_apm_10 },
  { name: 'away_apm_5', extractor: e => e.away_apm_5 },
  { name: 'away_apm_3', extractor: e => e.away_apm_3 },
  { name: 'away_ipr', extractor: e => e.away_ipr },
  { name: 'away_acceleration_factor', extractor: e => e.away_acceleration_factor },
  // Normalizadas
  { name: 'home_niap', extractor: e => e.home_niap },
  { name: 'home_ncg', extractor: e => e.home_ncg },
  { name: 'home_nesc', extractor: e => e.home_nesc },
  { name: 'home_nft', extractor: e => e.home_nft },
  { name: 'away_niap', extractor: e => e.away_niap },
  { name: 'away_ncg', extractor: e => e.away_ncg },
  { name: 'away_nesc', extractor: e => e.away_nesc },
  { name: 'away_nft', extractor: e => e.away_nft },
  // Scores
  { name: 'home_score', extractor: e => e.home_score },
  { name: 'away_score', extractor: e => e.away_score },
  { name: 'home_pls', extractor: e => e.home_pls },
  { name: 'away_pls', extractor: e => e.away_pls },
  { name: 'home_qual_pct', extractor: e => e.home_qual_pct },
  { name: 'away_qual_pct', extractor: e => e.away_qual_pct },
  // Raw stats derivados
  { name: 'total_shots_sum', extractor: e => e.home_total_shots + e.away_total_shots },
  { name: 'total_corners_sum', extractor: e => e.home_corners + e.away_corners },
  { name: 'possession_diff', extractor: e => Math.abs(e.home_possession - e.away_possession) },
  { name: 'score_diff', extractor: e => e.home_score - e.away_score },
  { name: 'elapsed', extractor: e => e.elapsed },
  { name: 'league_tier', extractor: e => e.league_tier },
];

/**
 * analyzePatterns — Analisa padrões estatísticos localmente a partir das entradas.
 *
 * Calcula:
 * - Win rate geral, por tier, por faixa de minuto, por faixa de score, por mercado
 * - Correlações de métricas com outcomes
 * - Gera recomendações baseadas nos padrões encontrados
 */
export function analyzePatterns(entries: TradeEntry[]): LearningReport {
  // Filtra apenas entries resolvidas (green ou red) para análise
  const resolved = entries.filter(e => e.outcome === 'green' || e.outcome === 'red');

  // ── Taxa de acerto geral ──
  const overallWinRate = calculateWinRate(resolved);

  // ── Win rate por tier de liga ──
  const winRateByTier: Record<string, number> = {};
  for (const tier of [100, 70, 40, 10]) {
    const tierEntries = resolved.filter(e => e.league_tier === tier);
    if (tierEntries.length > 0) {
      winRateByTier[TIER_LABELS[tier] || `Tier ${tier}`] = calculateWinRate(tierEntries);
    }
  }

  // ── Win rate por faixa de minuto ──
  const winRateByElapsed: Record<string, number> = {};
  for (const range of ELAPSED_RANGES) {
    const rangeEntries = resolved.filter(e => e.elapsed >= range.min && e.elapsed <= range.max);
    if (rangeEntries.length > 0) {
      winRateByElapsed[range.label] = calculateWinRate(rangeEntries);
    }
  }

  // ── Win rate por faixa de score ──
  const winRateByScoreRange: Record<string, number> = {};
  for (const range of SCORE_RANGES) {
    // Usa o maior score entre home e away como referência
    const rangeEntries = resolved.filter(e => {
      const maxScore = Math.max(e.home_score, e.away_score);
      return maxScore >= range.min && maxScore < range.max;
    });
    if (rangeEntries.length > 0) {
      winRateByScoreRange[range.label] = calculateWinRate(rangeEntries);
    }
  }

  // ── Win rate por tipo de mercado ──
  const winRateByMarket: Record<string, number> = {};
  for (const mt of ['gols', 'escanteios'] as MarketType[]) {
    const marketEntries = resolved.filter(e => e.market_type === mt);
    if (marketEntries.length > 0) {
      winRateByMarket[mt] = calculateWinRate(marketEntries);
    }
  }

  // ── Correlações de métricas ──
  const correlations = METRIC_EXTRACTORS.map(({ name, extractor }) => ({
    metric: name,
    correlation: calculateCorrelation(resolved, extractor),
  })).filter(c => Math.abs(c.correlation) > 0.05); // Filtra correlações muito fracas

  // Ordena por valor absoluto da correlação (mais forte primeiro)
  correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  // Separa correlações positivas (green) e negativas (red)
  const topGreenCorrelations = correlations
    .filter(c => c.correlation > 0)
    .slice(0, 5);

  const topRedCorrelations = correlations
    .filter(c => c.correlation < 0)
    .map(c => ({ ...c, correlation: Math.abs(c.correlation) }))
    .slice(0, 5);

  // ── Gerar recomendações automáticas ──
  const recommendations = generateLocalRecommendations(
    resolved,
    winRateByTier,
    winRateByElapsed,
    winRateByScoreRange,
    winRateByMarket,
    topGreenCorrelations,
    topRedCorrelations
  );

  // ── Determinar período coberto ──
  const dates = entries
    .map(e => e.created_at)
    .filter((d): d is string => !!d)
    .sort();
  const periodStart = dates[0] || new Date().toISOString();
  const periodEnd = dates[dates.length - 1] || new Date().toISOString();

  return {
    period_start: periodStart,
    period_end: periodEnd,
    total_entries: resolved.length,
    overall_win_rate: overallWinRate,
    win_rate_by_tier: winRateByTier,
    win_rate_by_elapsed: winRateByElapsed,
    win_rate_by_score_range: winRateByScoreRange,
    win_rate_by_market: winRateByMarket,
    top_green_correlations: topGreenCorrelations,
    top_red_correlations: topRedCorrelations,
    recommendations,
    analysis_source: 'local',
  };
}

/**
 * Gera recomendações textuais baseadas nos padrões estatísticos identificados.
 * Lógica determinística — sem IA, apenas regras estatísticas.
 */
function generateLocalRecommendations(
  entries: TradeEntry[],
  winRateByTier: Record<string, number>,
  winRateByElapsed: Record<string, number>,
  winRateByScoreRange: Record<string, number>,
  winRateByMarket: Record<string, number>,
  greenCorrelations: Array<{ metric: string; correlation: number }>,
  redCorrelations: Array<{ metric: string; correlation: number }>
): AIRecommendation[] {
  const recommendations: AIRecommendation[] = [];
  const minSampleSize = 5; // Mínimo de amostras para gerar recomendação

  // ── Recomendações por tier de liga ──
  for (const [tier, wr] of Object.entries(winRateByTier)) {
    const tierEntries = entries.filter(e => TIER_LABELS[e.league_tier] === tier);
    if (tierEntries.length < minSampleSize) continue;

    if (wr < 40) {
      recommendations.push({
        type: 'avoid',
        confidence: Math.min(90, 50 + tierEntries.length),
        description: `Evitar entradas em ligas ${tier} — win rate de apenas ${wr}% em ${tierEntries.length} trades.`,
        conditions: { tier, win_rate: wr, sample_size: tierEntries.length },
        estimated_impact: `Eliminaria ${tierEntries.length} trades com baixa taxa de acerto`,
      });
    } else if (wr > 70) {
      recommendations.push({
        type: 'prefer',
        confidence: Math.min(90, 50 + tierEntries.length),
        description: `Priorizar entradas em ligas ${tier} — win rate de ${wr}% em ${tierEntries.length} trades.`,
        conditions: { tier, win_rate: wr, sample_size: tierEntries.length },
        estimated_impact: `Taxa de acerto acima da média geral`,
      });
    }
  }

  // ── Recomendações por faixa de minuto ──
  for (const [range, wr] of Object.entries(winRateByElapsed)) {
    const rangeEntries = entries.filter(e => {
      const r = ELAPSED_RANGES.find(r => r.label === range);
      return r && e.elapsed >= r.min && e.elapsed <= r.max;
    });
    if (rangeEntries.length < minSampleSize) continue;

    if (wr < 35) {
      recommendations.push({
        type: 'warning',
        confidence: Math.min(85, 45 + rangeEntries.length),
        description: `Atenção: entradas no minuto ${range} têm win rate de ${wr}%. Considere evitar esse intervalo.`,
        conditions: { elapsed_range: range, win_rate: wr, sample_size: rangeEntries.length },
      });
    } else if (wr > 75) {
      recommendations.push({
        type: 'prefer',
        confidence: Math.min(85, 45 + rangeEntries.length),
        description: `Janela ideal: entradas no minuto ${range} têm win rate de ${wr}%.`,
        conditions: { elapsed_range: range, win_rate: wr, sample_size: rangeEntries.length },
      });
    }
  }

  // ── Recomendações por faixa de score ──
  for (const [range, wr] of Object.entries(winRateByScoreRange)) {
    const rangeEntries = entries.filter(e => {
      const r = SCORE_RANGES.find(r => r.label === range);
      const maxScore = Math.max(e.home_score, e.away_score);
      return r && maxScore >= r.min && maxScore < r.max;
    });
    if (rangeEntries.length < minSampleSize) continue;

    if (wr < 40) {
      recommendations.push({
        type: 'avoid',
        confidence: Math.min(80, 40 + rangeEntries.length),
        description: `Evitar entradas com SFS na faixa ${range} — win rate de ${wr}%.`,
        conditions: { score_range: range, win_rate: wr },
      });
    }
  }

  // ── Recomendações por tipo de mercado ──
  for (const [market, wr] of Object.entries(winRateByMarket)) {
    const marketEntries = entries.filter(e => e.market_type === market);
    if (marketEntries.length < minSampleSize) continue;

    if (wr < 40) {
      recommendations.push({
        type: 'warning',
        confidence: Math.min(80, 40 + marketEntries.length),
        description: `Mercado de ${market} com desempenho fraco: win rate de ${wr}%.`,
        conditions: { market, win_rate: wr },
      });
    }
  }

  // ── Insights baseados em correlações ──
  for (const corr of greenCorrelations.slice(0, 3)) {
    if (corr.correlation > 0.15) {
      recommendations.push({
        type: 'insight',
        confidence: Math.round(corr.correlation * 100),
        description: `Métrica "${corr.metric}" mostra correlação positiva forte (${corr.correlation}) com trades green. Valores altos favorecem acerto.`,
        conditions: { metric: corr.metric, correlation: corr.correlation },
      });
    }
  }

  for (const corr of redCorrelations.slice(0, 3)) {
    if (corr.correlation > 0.15) {
      recommendations.push({
        type: 'insight',
        confidence: Math.round(corr.correlation * 100),
        description: `Métrica "${corr.metric}" mostra correlação com trades red (${corr.correlation}). Valores extremos desta métrica indicam risco.`,
        conditions: { metric: corr.metric, correlation: corr.correlation },
      });
    }
  }

  return recommendations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRAÇÃO COM GEMINI AI
// ═══════════════════════════════════════════════════════════════════════════════

/** URL base da API Gemini */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * generateGeminiReport — Envia um lote de trades para o Gemini 2.0 Flash
 * e recebe análise de padrões e recomendações em português.
 *
 * A chave da API é lida de localStorage ('gemini_api_key').
 * Retorna um LearningReport com fonte 'gemini'.
 */
export async function generateGeminiReport(entries: TradeEntry[]): Promise<LearningReport> {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    throw new Error('Chave da API Gemini não configurada. Salve em localStorage com a chave "gemini_api_key".');
  }

  // Filtra apenas entries resolvidas para análise
  const resolved = entries.filter(e => e.outcome === 'green' || e.outcome === 'red');
  if (resolved.length < 3) {
    throw new Error('Mínimo de 3 trades resolvidos necessários para gerar relatório Gemini.');
  }

  // Prepara resumo dos dados para o prompt (evita enviar dados demais)
  const tradeSummaries = resolved.map(e => ({
    liga: e.league,
    tier: TIER_LABELS[e.league_tier] || e.league_tier,
    minuto: e.elapsed,
    periodo: e.period,
    placar: `${e.goals_home}x${e.goals_away}`,
    mercado: e.market_type,
    tipo_aposta: e.bet_type,
    score_mandante: e.home_score,
    score_visitante: e.away_score,
    apm_global_mandante: e.home_apm_global,
    apm_global_visitante: e.away_apm_global,
    apm3_mandante: e.home_apm_3,
    apm3_visitante: e.away_apm_3,
    ipr_mandante: e.home_ipr,
    ipr_visitante: e.away_ipr,
    aceleracao_mandante: e.home_acceleration_factor,
    aceleracao_visitante: e.away_acceleration_factor,
    pls_mandante: e.home_pls,
    pls_visitante: e.away_pls,
    qualidade_mandante: e.home_qual_pct,
    qualidade_visitante: e.away_qual_pct,
    chutes_total: e.home_total_shots + e.away_total_shots,
    escanteios_total: e.home_corners + e.away_corners,
    posse_mandante: e.home_possession,
    resultado: e.outcome,
  }));

  // Prompt estruturado em português
  const prompt = `Você é um analista especializado em trading esportivo ao vivo. Analise os seguintes ${resolved.length} trades registrados e forneça insights estatísticos e recomendações práticas.

## DADOS DOS TRADES:
${JSON.stringify(tradeSummaries, null, 2)}

## INSTRUÇÕES:
Analise os padrões dos trades acima e responda OBRIGATORIAMENTE em formato JSON válido com a seguinte estrutura:

{
  "resumo_geral": "Texto resumindo os principais achados",
  "win_rate_geral": <número 0-100>,
  "padroes_identificados": [
    "Padrão 1...",
    "Padrão 2..."
  ],
  "recomendacoes": [
    {
      "type": "avoid|prefer|insight|warning",
      "confidence": <número 0-100>,
      "description": "Descrição detalhada em português",
      "conditions": {"chave": "valor"},
      "estimated_impact": "Descrição do impacto"
    }
  ],
  "metricas_chave": {
    "mais_correlacionada_green": "nome_da_metrica",
    "mais_correlacionada_red": "nome_da_metrica",
    "melhor_faixa_minuto": "ex: 45-60",
    "pior_faixa_minuto": "ex: 0-15",
    "melhor_tier": "ex: Elite",
    "pior_tier": "ex: Juvenil"
  }
}

## FOCO DA ANÁLISE:
1. Identifique quais condições (minuto, tier, score, APM, aceleração) mais se correlacionam com trades GREEN vs RED
2. Sugira filtros ou regras que melhorariam a taxa de acerto
3. Identifique se há viés de minuto, liga ou mercado
4. Avalie se a aceleração (APM3 vs APM Global) é preditiva
5. Recomende thresholds específicos para métricas-chave

Responda APENAS com o JSON válido, sem markdown ou texto adicional.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.3, // Baixa temperatura para análise mais factual
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[LearningEngine] Erro na API Gemini:', response.status, errorBody);
      throw new Error(`API Gemini retornou status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();

    // Extrai o texto da resposta do Gemini
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Resposta vazia do Gemini. Verifique a chave da API e os limites de uso.');
    }

    // Limpa possíveis wrappers de markdown (```json ... ```)
    const cleanedText = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Parse do JSON retornado
    let geminiResponse: any;
    try {
      geminiResponse = JSON.parse(cleanedText);
    } catch {
      console.error('[LearningEngine] Falha ao parsear resposta do Gemini:', cleanedText);
      throw new Error('Resposta do Gemini não é um JSON válido. Tente novamente.');
    }

    // Converte recomendações do Gemini para o formato AIRecommendation
    const recommendations: AIRecommendation[] = (geminiResponse.recomendacoes || []).map((rec: any) => ({
      type: (['avoid', 'prefer', 'insight', 'warning'].includes(rec.type) ? rec.type : 'insight') as AIRecommendation['type'],
      confidence: Math.min(100, Math.max(0, Number(rec.confidence) || 50)),
      description: String(rec.description || ''),
      conditions: rec.conditions || {},
      estimated_impact: rec.estimated_impact || undefined,
    }));

    // Executa também a análise local para enriquecer com dados estatísticos precisos
    const localReport = analyzePatterns(entries);

    // Determinar período coberto
    const dates = entries
      .map(e => e.created_at)
      .filter((d): d is string => !!d)
      .sort();

    return {
      period_start: dates[0] || new Date().toISOString(),
      period_end: dates[dates.length - 1] || new Date().toISOString(),
      total_entries: resolved.length,
      overall_win_rate: geminiResponse.win_rate_geral ?? localReport.overall_win_rate,
      win_rate_by_tier: localReport.win_rate_by_tier,
      win_rate_by_elapsed: localReport.win_rate_by_elapsed,
      win_rate_by_score_range: localReport.win_rate_by_score_range,
      win_rate_by_market: localReport.win_rate_by_market,
      top_green_correlations: localReport.top_green_correlations,
      top_red_correlations: localReport.top_red_correlations,
      recommendations,
      analysis_source: 'gemini',
      raw_summary: {
        resumo_geral: geminiResponse.resumo_geral,
        padroes_identificados: geminiResponse.padroes_identificados,
        metricas_chave: geminiResponse.metricas_chave,
      },
    };
  } catch (error) {
    // Se for erro já tratado (não de rede), re-lança
    if (error instanceof Error && !error.message.includes('fetch')) {
      throw error;
    }
    console.error('[LearningEngine] Erro de rede ao chamar Gemini:', error);
    throw new Error('Falha na comunicação com a API Gemini. Verifique sua conexão.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTÊNCIA DE RELATÓRIOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * saveLearningReport — Salva um relatório de aprendizado na tabela `learning_reports`.
 * Retorna o registro inserido com o `id` gerado.
 */
export async function saveLearningReport(report: LearningReport): Promise<LearningReport> {
  const { data, error } = await supabase
    .from('learning_reports')
    .insert([report])
    .select()
    .single();

  if (error) {
    console.error('[LearningEngine] Erro ao salvar relatório:', error);
    throw new Error(`Falha ao salvar relatório de aprendizado: ${error.message}`);
  }

  return data as LearningReport;
}

/**
 * getLearningReports — Busca todos os relatórios de aprendizado.
 * Ordena por data de criação decrescente.
 */
export async function getLearningReports(): Promise<LearningReport[]> {
  const { data, error } = await supabase
    .from('learning_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[LearningEngine] Erro ao buscar relatórios:', error);
    throw new Error(`Falha ao buscar relatórios de aprendizado: ${error.message}`);
  }

  return (data || []) as LearningReport[];
}
