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
  minCornersHt: number;
  minCornersFt: number;
  minPossession: number;
  minDangerousAttacks: number;
  minAtm5: number;
  minAtm3: number;
  minShotsOnGoal: number;
  maxGoalDifference: number;
  funilMinScoreDiff: number;
  funilTeamStatus: 'drawing_or_losing' | 'any';

  // Goals specific
  golsMinAtm10: number;
  golsMinAtm5: number;
  golsMinAtm3: number;
  golsMinScore: number;
  golsMinSogHt: number;
  golsMinSogFt: number;
  golsMinTotalShots: number;
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
    minCornersHt: 2,
    minCornersFt: 5,
    minPossession: 45,
    minDangerousAttacks: 30,
    minAtm5: 1.0,
    minAtm3: 1.2,
    minShotsOnGoal: 2,
    maxGoalDifference: 2,
    funilMinScoreDiff: 2,
    funilTeamStatus: 'drawing_or_losing',

    // Goals defaults
    golsMinAtm10: 0.8,
    golsMinAtm5: 1.0,
    golsMinAtm3: 1.2,
    golsMinScore: 6.0,
    golsMinSogHt: 1,
    golsMinSogFt: 3,
    golsMinTotalShots: 5,
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
    homeShotsOnGoalHt?: number;
    awayShotsOnGoalHt?: number;
    homeTotalShots?: number;
    awayTotalShots?: number;
    homeScoreFinal?: number;
    awayScoreFinal?: number;
    atm10?: number;
    atm5?: number;
    atm3?: number;
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

  // 3. Youth league filter
  if (cfg.excludeYouth && isYouthLeague(match.leagueName)) return false;

  const isGoalStrategy = opp.strategyName === 'Over 0.5 Gols HT' || opp.strategyName === 'Virada do Favorito';

  if (isGoalStrategy) {
    // --- FILTROS ESPECÍFICOS PARA GOLS ---
    if (stats) {
      const isHome = opp.teamName === match.homeTeam.name;
      const teamScore = isHome ? stats.homeScoreFinal : stats.awayScoreFinal;
      const golsMinScore = cfg.golsMinScore !== undefined ? cfg.golsMinScore : 6.0;
      if (teamScore !== undefined && teamScore < golsMinScore) return false;

      // ATMs:
      const atm10 = stats.atm10 !== undefined ? stats.atm10 : 0;
      const atm5 = stats.atm5 !== undefined ? stats.atm5 : 0;
      const atm3 = stats.atm3 !== undefined ? stats.atm3 : 0;

      const golsMinAtm10 = cfg.golsMinAtm10 !== undefined ? cfg.golsMinAtm10 : 0.8;
      const golsMinAtm5 = cfg.golsMinAtm5 !== undefined ? cfg.golsMinAtm5 : 1.0;
      const golsMinAtm3 = cfg.golsMinAtm3 !== undefined ? cfg.golsMinAtm3 : 1.2;

      if (atm10 < golsMinAtm10) return false;
      if (atm5 < golsMinAtm5) return false;
      if (atm3 < golsMinAtm3) return false;

      // Chutes no alvo (SOG) HT e FT (separados):
      const isHT = match.status === '1H' || match.status === 'HT';
      const teamSog = isHome ? stats.homeShotsOnGoal : stats.awayShotsOnGoal;
      
      if (isHT) {
        const golsMinSogHt = cfg.golsMinSogHt !== undefined ? cfg.golsMinSogHt : 1;
        if (teamSog < golsMinSogHt) return false;
      } else {
        const golsMinSogFt = cfg.golsMinSogFt !== undefined ? cfg.golsMinSogFt : 3;
        if (teamSog < golsMinSogFt) return false;
      }

      // Finalizações totais
      const totalShots = isHome ? (stats.homeTotalShots ?? 0) : (stats.awayTotalShots ?? 0);
      const golsMinTotalShots = cfg.golsMinTotalShots !== undefined ? cfg.golsMinTotalShots : 5;
      if (totalShots < golsMinTotalShots) return false;
    }
  } else {
    // --- FILTROS ESPECÍFICOS PARA ESCANTEIOS (Original) ---
    // Score filter (from details)
    if (stats?.homeScoreFinal !== undefined && stats?.awayScoreFinal !== undefined) {
      const isHome = opp.teamName === match.homeTeam.name;
      const teamScore = isHome ? stats.homeScoreFinal : stats.awayScoreFinal;
      if (teamScore < cfg.minScore) return false;
    }

    // Goal difference filter
    const goalDiff = Math.abs(match.goalsHome - match.goalsAway);
    if (goalDiff > cfg.maxGoalDifference) return false;

    // Stats filters (only if stats provided)
    if (stats) {
      const totalCorners = stats.homeCorners + stats.awayCorners;
      const isHT = match.status === '1H' || match.status === 'HT';
      const minCornersHt = cfg.minCornersHt !== undefined ? cfg.minCornersHt : 2;
      const minCornersFt = cfg.minCornersFt !== undefined ? cfg.minCornersFt : 5;
      const reqCorners = isHT ? minCornersHt : minCornersFt;
      if (totalCorners < reqCorners) return false;

      const isHome = opp.teamName === match.homeTeam.name;
      const teamPossession = isHome ? stats.homePossession : stats.awayPossession;
      if (teamPossession < cfg.minPossession) return false;

      // Filtro de Ataques Perigosos por Minuto (ATM 5 e ATM 3)
      const atm5 = stats.atm5 !== undefined ? stats.atm5 : 0;
      const atm3 = stats.atm3 !== undefined ? stats.atm3 : 0;
      const minAtm5 = cfg.minAtm5 !== undefined ? cfg.minAtm5 : 0;
      const minAtm3 = cfg.minAtm3 !== undefined ? cfg.minAtm3 : 0;

      if (atm5 < minAtm5) return false;
      if (atm3 < minAtm3) return false;

      const teamSOG = isHome ? stats.homeShotsOnGoal : stats.awayShotsOnGoal;
      if (teamSOG < cfg.minShotsOnGoal) return false;

      // Funil specific filters
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
    ...(opp.stats && opp.stats.atm5 !== undefined && opp.stats.atm3 !== undefined ? [
      `⚡ <b>Ataques/Min (ATM):</b> 5m: <b>${opp.stats.atm5.toFixed(1)}</b> · 3m: <b>${opp.stats.atm3.toFixed(1)}</b>`
    ] : []),
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
