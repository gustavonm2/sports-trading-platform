export interface Team {
  id: number;
  name: string;
  logo: string;
}

export interface Fixture {
  id: number;
  status: string;
  elapsed: number;
  homeTeam: Team;
  awayTeam: Team;
  goalsHome: number;
  goalsAway: number;
  leagueName?: string;
}

export interface TeamStats {
  attacks: number;
  dangerousAttacks: number;
  corners: number;
  shotsOnGoal: number;
  shotsOffGoal: number;
  possession: number;
  yellowCards: number;
  redCards: number;
  pressureIndex: number;
  apm1: number;
  apm2: number;
}

export interface MatchStats {
  fixtureId: number;
  home: TeamStats;
  away: TeamStats;
}

const SPORTSMONKS_API_TOKEN = 'I2JnAHeFNSdX7f1I77MgPAd6ev79fCFnLj6hRLJsPlNWpWTxDC2Ns4WN707J';
const BASE_URL = '/api-sportsmonks/v3/football';

// Stat type IDs for Sportsmonks v3
const STATS_MAP = {
  CORNERS: 34,
  ATTACKS: 42,
  DANGEROUS_ATTACKS: 43,
  POSSESSION: 45,
  YELLOW_CARDS: 86,
  RED_CARDS: 87,
  SHOTS_ON_TARGET: 114,
  SHOTS_OFF_TARGET: 115
};

// Robust helper to extract statistics values safely from Sportsmonks v3 nested models
function extractStatValue(stats: any[], participantId: number, typeId: number): number {
  if (!Array.isArray(stats)) return 0;
  const item = stats.find(s => s.participant_id === participantId && s.type_id === typeId);
  if (!item || item.value === undefined || item.value === null) return 0;
  
  if (typeof item.value === 'object') {
    return Number(item.value.all || item.value.total || 0);
  }
  return Number(item.value || 0);
}

// Calculate pressure momentum
function calculatePressureIndex(stats: Omit<TeamStats, 'pressureIndex'>): number {
  const shotFactor = stats.shotsOnGoal * 2.5 + stats.shotsOffGoal * 1.0;
  const cornerFactor = stats.corners * 1.5;
  const dangerRatio = stats.attacks > 0 ? (stats.dangerousAttacks / stats.attacks) : 0;
  const dangerAttackFactor = stats.dangerousAttacks * 0.3 * (1 + dangerRatio);

  return Math.min(100, Math.floor(dangerAttackFactor + shotFactor + cornerFactor));
}

class SportsmonksService {
  private token: string;

  constructor() {
    this.token = SPORTSMONKS_API_TOKEN;
  }

  // Fetch all inplay matches with team info and live statistics in a single premium request
  async getLiveFixtures(): Promise<{ fixtures: Fixture[]; statsMap: Record<number, MatchStats>; isMock: boolean }> {
    try {
      const url = `${BASE_URL}/livescores/inplay?api_token=${this.token}&include=statistics;participants;league;state`;
      const response = await fetch(url, { method: 'GET' });

      if (!response.ok) {
        throw new Error(`Sportsmonks HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      const rawFixtures = data.data || [];

      const fixtures: Fixture[] = [];
      const statsMap: Record<number, MatchStats> = {};

      rawFixtures.forEach((f: any) => {
        // Find home and away participants
        const participants = f.participants || [];
        const homePart = participants.find((p: any) => p.meta?.location === 'home');
        const awayPart = participants.find((p: any) => p.meta?.location === 'away');

        if (!homePart || !awayPart) return; // Skip if participants are incomplete

        const elapsed = f.state?.elapsed || f.minute || 0;
        
        // Parse current scores
        let goalsHome = 0;
        let goalsAway = 0;
        if (Array.isArray(f.scores)) {
          // Typically in Sportsmonks, current scores have type 'CURRENT'
          const currentHomeScore = f.scores.find((s: any) => s.participant_id === homePart.id && s.description === 'CURRENT');
          const currentAwayScore = f.scores.find((s: any) => s.participant_id === awayPart.id && s.description === 'CURRENT');
          goalsHome = currentHomeScore ? Number(currentHomeScore.score?.value || 0) : 0;
          goalsAway = currentAwayScore ? Number(currentAwayScore.score?.value || 0) : 0;
        }

        const fixture: Fixture = {
          id: f.id,
          status: this.mapPeriodState(f.state?.state || ''),
          elapsed,
          goalsHome,
          goalsAway,
          homeTeam: {
            id: homePart.id,
            name: homePart.name,
            logo: homePart.image_path || '',
          },
          awayTeam: {
            id: awayPart.id,
            name: awayPart.name,
            logo: awayPart.image_path || '',
          }
        };

        fixtures.push(fixture);

        // Parse Live Statistics
        const stats = f.statistics || [];
        
        const homeStats = {
          attacks: extractStatValue(stats, homePart.id, STATS_MAP.ATTACKS),
          dangerousAttacks: extractStatValue(stats, homePart.id, STATS_MAP.DANGEROUS_ATTACKS),
          corners: extractStatValue(stats, homePart.id, STATS_MAP.CORNERS),
          shotsOnGoal: extractStatValue(stats, homePart.id, STATS_MAP.SHOTS_ON_TARGET),
          shotsOffGoal: extractStatValue(stats, homePart.id, STATS_MAP.SHOTS_OFF_TARGET),
          possession: extractStatValue(stats, homePart.id, STATS_MAP.POSSESSION) || 50,
          yellowCards: extractStatValue(stats, homePart.id, STATS_MAP.YELLOW_CARDS),
          redCards: extractStatValue(stats, homePart.id, STATS_MAP.RED_CARDS),
        };

        const awayStats = {
          attacks: extractStatValue(stats, awayPart.id, STATS_MAP.ATTACKS),
          dangerousAttacks: extractStatValue(stats, awayPart.id, STATS_MAP.DANGEROUS_ATTACKS),
          corners: extractStatValue(stats, awayPart.id, STATS_MAP.CORNERS),
          shotsOnGoal: extractStatValue(stats, awayPart.id, STATS_MAP.SHOTS_ON_TARGET),
          shotsOffGoal: extractStatValue(stats, awayPart.id, STATS_MAP.SHOTS_OFF_TARGET),
          possession: extractStatValue(stats, awayPart.id, STATS_MAP.POSSESSION) || 50,
          yellowCards: extractStatValue(stats, awayPart.id, STATS_MAP.YELLOW_CARDS),
          redCards: extractStatValue(stats, awayPart.id, STATS_MAP.RED_CARDS),
        };

        // Guarantee possession totals add up to 100
        if (homeStats.possession + awayStats.possession !== 100) {
          if (homeStats.possession > 0 && awayStats.possession === 50) {
            awayStats.possession = 100 - homeStats.possession;
          } else if (awayStats.possession > 0 && homeStats.possession === 50) {
            homeStats.possession = 100 - awayStats.possession;
          }
        }

        const divisor = elapsed > 0 ? elapsed : 1;
        const apm2Home = Number((homeStats.dangerousAttacks / divisor).toFixed(2));
        const apm2Away = Number((awayStats.dangerousAttacks / divisor).toFixed(2));

        const pHomeIndex = calculatePressureIndex(homeStats);
        const pAwayIndex = calculatePressureIndex(awayStats);

        const apm1Home = Number((apm2Home * (1 + pHomeIndex / 100)).toFixed(2));
        const apm1Away = Number((apm2Away * (1 + pAwayIndex / 100)).toFixed(2));

        statsMap[f.id] = {
          fixtureId: f.id,
          home: {
            ...homeStats,
            pressureIndex: pHomeIndex,
            apm1: apm1Home,
            apm2: apm2Home
          },
          away: {
            ...awayStats,
            pressureIndex: pAwayIndex,
            apm1: apm1Away,
            apm2: apm2Away
          }
        };
      });

      return { fixtures, statsMap, isMock: false };
    } catch (err) {
      console.error("Error fetching live scores from Sportsmonks Premium API:", err);
      // Return empty fixtures in case of hard failure so the main page displays fallback gracefully
      return { fixtures: [], statsMap: {}, isMock: false };
    }
  }

  private mapPeriodState(state: string): "1H" | "HT" | "2H" | "ET" | "FT" {
    const s = state.toUpperCase();
    if (s.includes("FIRST") || s.includes("1ST")) return "1H";
    if (s.includes("HALF") && s.includes("TIME")) return "HT";
    if (s.includes("SECOND") || s.includes("2ND")) return "2H";
    if (s.includes("EXTRA")) return "ET";
    if (s.includes("END") || s.includes("FINISHED") || s.includes("FT")) return "FT";
    return "1H";
  }
}

export const sportsmonks = new SportsmonksService();
