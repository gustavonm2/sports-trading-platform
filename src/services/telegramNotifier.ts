// 📲 Telegram Notification Service
// Sends trade alerts via Telegram Bot API with configurable filters

const STORAGE_KEY_TOKEN = 'telegram_bot_token';
const STORAGE_KEY_CHAT_ID = 'telegram_chat_id';
const STORAGE_KEY_ENABLED = 'telegram_enabled';

export function getTelegramConfig() {
  return {
    botToken: localStorage.getItem(STORAGE_KEY_TOKEN) || '',
    chatId: localStorage.getItem(STORAGE_KEY_CHAT_ID) || '',
    enabled: localStorage.getItem(STORAGE_KEY_ENABLED) === 'true',
  };
}

export function saveTelegramConfig(botToken: string, chatId: string, enabled: boolean) {
  localStorage.setItem(STORAGE_KEY_TOKEN, botToken);
  localStorage.setItem(STORAGE_KEY_CHAT_ID, chatId);
  localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const { botToken, chatId, enabled } = getTelegramConfig();
  if (!enabled || !botToken || !chatId) return false;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[Telegram] Erro ao enviar:', err);
    return false;
  }
}

// ── Alert Filter Config (loaded from AlertConfig page) ──
interface AlertConfig {
  strategyCanto: boolean;
  strategyGols: boolean;
  strategyVirada: boolean;
  strategyFunil: boolean;
  minConfidence: number;
  minScore: number;
  excludeYouth: boolean;
  period: 'both' | '1h' | '2h';
  minMinute: number;
  maxMinute: number;
  minCorners: number;
  minPossession: number;
  minDangerousAttacks: number;
  minShotsOnGoal: number;
  maxGoalDifference: number;
  funilMinScoreDiff: number;
  funilTeamStatus: 'drawing_or_losing' | 'any';
}

function loadAlertConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem('telegram_alert_config');
    if (raw) return { ...getDefaults(), ...JSON.parse(raw) };
  } catch {}
  return getDefaults();
}

function getDefaults(): AlertConfig {
  return {
    strategyCanto: true,
    strategyGols: true,
    strategyVirada: false,
    strategyFunil: true,
    minConfidence: 70,
    minScore: 7.0,
    excludeYouth: true,
    period: 'both',
    minMinute: 25,
    maxMinute: 85,
    minCorners: 3,
    minPossession: 45,
    minDangerousAttacks: 30,
    minShotsOnGoal: 2,
    maxGoalDifference: 2,
    funilMinScoreDiff: 2,
    funilTeamStatus: 'drawing_or_losing',
  };
}

// Youth league detection
const YOUTH_KEYWORDS = ['sub-', 'sub ', 'u19', 'u20', 'u21', 'u23', 'youth', 'junior', 'juvenil', 'reserve', 'academy', 'primavera', 'b team'];

function isYouthLeague(leagueName: string): boolean {
  const lower = leagueName.toLowerCase();
  return YOUTH_KEYWORDS.some(kw => lower.includes(kw));
}

export interface TelegramAlertOpp {
  strategyName: string;
  teamName: string;
  confidence: number;
  details: string;
  suggestion: string;
  isFunnel?: boolean;
  matchUrl?: string;
  match: {
    homeTeam: { name: string };
    awayTeam: { name: string };
    goalsHome: number;
    goalsAway: number;
    elapsed: number;
    status: string;
    leagueName: string;
  };
  // Extra stats for filtering (optional, passed from Radar)
  stats?: {
    homeCorners: number;
    awayCorners: number;
    homePossession: number;
    awayPossession: number;
    homeDangerousAttacks: number;
    awayDangerousAttacks: number;
    homeShotsOnGoal: number;
    awayShotsOnGoal: number;
    homeScoreFinal?: number;
    awayScoreFinal?: number;
  };
}

function passesFilters(opp: TelegramAlertOpp): boolean {
  const cfg = loadAlertConfig();
  const { match, stats } = opp;

  // 1. Strategy filter
  if (opp.strategyName === 'Canto Limite') {
    if (opp.isFunnel) {
      if (!cfg.strategyFunil) return false;
    } else {
      if (!cfg.strategyCanto) return false;
    }
  }
  if (opp.strategyName === 'Over 0.5 Gols HT' && !cfg.strategyGols) return false;
  if (opp.strategyName === 'Virada do Favorito' && !cfg.strategyVirada) return false;

  // 2. Confidence filter
  if (opp.confidence < cfg.minConfidence) return false;

  // 3. Score filter (from details)
  if (stats?.homeScoreFinal !== undefined && stats?.awayScoreFinal !== undefined) {
    const isHome = opp.teamName === match.homeTeam.name;
    const teamScore = isHome ? stats.homeScoreFinal : stats.awayScoreFinal;
    if (teamScore < cfg.minScore) return false;
  }

  // 4. Youth league filter
  if (cfg.excludeYouth && isYouthLeague(match.leagueName)) return false;

  // 5. Period filter
  if (cfg.period === '1h' && match.status !== '1H') return false;
  if (cfg.period === '2h' && match.status !== '2H') return false;

  // 6. Minute range filter
  if (match.elapsed < cfg.minMinute || match.elapsed > cfg.maxMinute) return false;

  // 7. Goal difference filter
  const goalDiff = Math.abs(match.goalsHome - match.goalsAway);
  if (goalDiff > cfg.maxGoalDifference) return false;

  // 8. Stats filters (only if stats provided)
  if (stats) {
    const totalCorners = stats.homeCorners + stats.awayCorners;
    if (totalCorners < cfg.minCorners) return false;

    const isHome = opp.teamName === match.homeTeam.name;
    const teamPossession = isHome ? stats.homePossession : stats.awayPossession;
    if (teamPossession < cfg.minPossession) return false;

    const teamDA = isHome ? stats.homeDangerousAttacks : stats.awayDangerousAttacks;
    if (teamDA < cfg.minDangerousAttacks) return false;

    const teamSOG = isHome ? stats.homeShotsOnGoal : stats.awayShotsOnGoal;
    if (teamSOG < cfg.minShotsOnGoal) return false;

    // 9. Funil specific filters
    if (opp.isFunnel && cfg.strategyFunil) {
      const homeScore = stats.homeScoreFinal ?? 0;
      const awayScore = stats.awayScoreFinal ?? 0;
      const scoreDiff = isHome ? homeScore - awayScore : awayScore - homeScore;
      if (scoreDiff < cfg.funilMinScoreDiff) return false;

      if (cfg.funilTeamStatus === 'drawing_or_losing') {
        const teamGoals = isHome ? match.goalsHome : match.goalsAway;
        const oppGoals = isHome ? match.goalsAway : match.goalsHome;
        if (teamGoals > oppGoals) return false; // Team is winning, skip
      }
    }
  }

  return true;
}

export async function sendTelegramAlert(opp: TelegramAlertOpp): Promise<boolean> {
  // Apply filters before sending
  if (!passesFilters(opp)) {
    console.log(`[Telegram] Filtro bloqueou: ${opp.match.homeTeam.name} vs ${opp.match.awayTeam.name} (${opp.strategyName})`);
    return false;
  }

  const { match } = opp;
  const score = `${match.goalsHome}×${match.goalsAway}`;
  const isCorners = opp.strategyName === 'Canto Limite';
  const isFunil = opp.isFunnel;

  const emoji = isFunil ? '🔻' : isCorners ? '🚩' : '⚽';
  const strategyLabel = isFunil ? 'FUNIL (DOMÍNIO)' : opp.strategyName.toUpperCase();
  
  const lines = [
    `${emoji} <b>${strategyLabel}</b>`,
    ``,
    `🏟️ <b>${match.homeTeam.name} ${score} ${match.awayTeam.name}</b>`,
    `🏆 ${match.leagueName} · ⏱️ ${match.elapsed}' (${match.status})`,
    ``,
    `🎯 <b>Time:</b> ${opp.teamName}`,
    `📊 <b>Confiança:</b> ${opp.confidence}%`,
    ``,
    `📋 ${opp.details}`,
    ``,
    `💡 <i>${opp.suggestion}</i>`,
  ];

  if (opp.matchUrl) {
    lines.push(``);
    lines.push(`🔗 <a href="${opp.matchUrl}">Abrir na Bet365</a>`);
  }

  return sendTelegramMessage(lines.join('\n'));
}

export async function testTelegramConnection(): Promise<{ ok: boolean; error?: string }> {
  const { botToken, chatId } = getTelegramConfig();
  if (!botToken || !chatId) {
    return { ok: false, error: 'Token ou Chat ID não configurados' };
  }

  try {
    const ok = await sendTelegramMessage('✅ <b>TradePro conectado!</b>\n\nVocê receberá alertas de entradas aqui.');
    return ok ? { ok: true } : { ok: false, error: 'Falha ao enviar mensagem. Verifique o token e chat ID.' };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Erro desconhecido' };
  }
}
