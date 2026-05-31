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
  shotsOnGoal: number;
  shotsOffGoal: number;
  totalShots: number;
  blockedShots: number;
  shotsInsideBox: number;
  corners: number;
  fouls: number;
  possession: number;
  yellowCards: number;
  redCards: number;
  goalkeeperSaves: number;
  attacks: number;
  dangerousAttacks: number;
  pressureIndex: number;
  iim: number;
}

export interface MatchStats {
  fixtureId: number;
  home: TeamStats;
  away: TeamStats;
  hasTelemetry: boolean;
}

const SPORTSMONKS_API_TOKEN = 'fzEpDBRBQwESuWNdH9rJCMXXq3auUTvzr1eo7cPToXR4IQHMn23sdErNUBwm';
const BASE_URL = '/api-sportsmonks/v3/football';

// Stat type IDs for Sportsmonks v3
// Stat type IDs CORRETOS para Sportsmonks v3 (verificados na documentação oficial)
// Bug anterior: ATTACKS era 42 (Shots Total), DANGEROUS_ATTACKS era 43 (Attacks)
const STATS_MAP = {
  CORNERS: 34,
  ATTACKS: 43,           // ✅ CORRETO: type_id 43 = Attacks
  DANGEROUS_ATTACKS: 44, // ✅ CORRETO: type_id 44 = Dangerous Attacks
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
function calculatePressureIndex(stats: Omit<TeamStats, 'pressureIndex' | 'iim'>): number {
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
        const status = this.mapPeriodState(f.state?.state || '');
        if (status === 'FT') return; // Skip finished matches!
        
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
          shotsOnGoal: extractStatValue(stats, homePart.id, STATS_MAP.SHOTS_ON_TARGET),
          shotsOffGoal: extractStatValue(stats, homePart.id, STATS_MAP.SHOTS_OFF_TARGET),
          totalShots: 0,
          blockedShots: 0,
          shotsInsideBox: 0,
          corners: extractStatValue(stats, homePart.id, STATS_MAP.CORNERS),
          fouls: 0,
          possession: extractStatValue(stats, homePart.id, STATS_MAP.POSSESSION) || 50,
          yellowCards: extractStatValue(stats, homePart.id, STATS_MAP.YELLOW_CARDS),
          redCards: extractStatValue(stats, homePart.id, STATS_MAP.RED_CARDS),
          goalkeeperSaves: 0,
          attacks: extractStatValue(stats, homePart.id, STATS_MAP.ATTACKS),
          dangerousAttacks: extractStatValue(stats, homePart.id, STATS_MAP.DANGEROUS_ATTACKS),
        };

        const awayStats = {
          shotsOnGoal: extractStatValue(stats, awayPart.id, STATS_MAP.SHOTS_ON_TARGET),
          shotsOffGoal: extractStatValue(stats, awayPart.id, STATS_MAP.SHOTS_OFF_TARGET),
          totalShots: 0,
          blockedShots: 0,
          shotsInsideBox: 0,
          corners: extractStatValue(stats, awayPart.id, STATS_MAP.CORNERS),
          fouls: 0,
          possession: extractStatValue(stats, awayPart.id, STATS_MAP.POSSESSION) || 50,
          yellowCards: extractStatValue(stats, awayPart.id, STATS_MAP.YELLOW_CARDS),
          redCards: extractStatValue(stats, awayPart.id, STATS_MAP.RED_CARDS),
          goalkeeperSaves: 0,
          attacks: extractStatValue(stats, awayPart.id, STATS_MAP.ATTACKS),
          dangerousAttacks: extractStatValue(stats, awayPart.id, STATS_MAP.DANGEROUS_ATTACKS),
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

        const pHomeIndex = calculatePressureIndex(homeStats);
        const pAwayIndex = calculatePressureIndex(awayStats);

        const iimHome = Number((homeStats.dangerousAttacks / divisor).toFixed(2));
        const iimAway = Number((awayStats.dangerousAttacks / divisor).toFixed(2));

        const hasTelemetry = stats.length > 0 && !(
          homeStats.attacks === 0 && awayStats.attacks === 0 &&
          homeStats.dangerousAttacks === 0 && awayStats.dangerousAttacks === 0 &&
          homeStats.corners === 0 && awayStats.corners === 0 &&
          homeStats.shotsOnGoal === 0 && awayStats.shotsOnGoal === 0
        );

        statsMap[f.id] = {
          fixtureId: f.id,
          home: {
            ...homeStats,
            pressureIndex: pHomeIndex,
            iim: iimHome
          },
          away: {
            ...awayStats,
            pressureIndex: pAwayIndex,
            iim: iimAway
          },
          hasTelemetry
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
