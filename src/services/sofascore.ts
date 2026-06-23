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

const BASE_URL = '/api-sofascore/api/v1';

// Calculate pressure index
function calculatePressureIndex(stats: Omit<TeamStats, 'pressureIndex' | 'iim'>): number {
  const shotFactor = stats.shotsOnGoal * 2.5 + stats.shotsOffGoal * 1.0;
  const cornerFactor = stats.corners * 1.5;
  const dangerRatio = stats.attacks > 0 ? (stats.dangerousAttacks / stats.attacks) : 0;
  const dangerAttackFactor = stats.dangerousAttacks * 0.3 * (1 + dangerRatio);

  return Math.min(100, Math.floor(dangerAttackFactor + shotFactor + cornerFactor));
}

// Extract statistic value by name from Sofascore items array
function extractSofascoreStat(items: any[], name: string): { home: number; away: number } {
  if (!Array.isArray(items)) return { home: 0, away: 0 };
  const item = items.find(i => i.name.toLowerCase().includes(name.toLowerCase()));
  if (!item) return { home: 0, away: 0 };

  const homeVal = parseInt(String(item.home).replace(/%/g, '')) || 0;
  const awayVal = parseInt(String(item.away).replace(/%/g, '')) || 0;
  return { home: homeVal, away: awayVal };
}

class SofascoreService {
  // Fetch live matches and statistics from Sofascore's completely free public JSON feed
  async getLiveFixtures(): Promise<{ fixtures: Fixture[]; statsMap: Record<number, MatchStats>; isMock: boolean }> {
    try {
      const url = `${BASE_URL}/sport/football/events/live?t=${Date.now()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Sofascore Live HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      const events = data.events || [];

      const fixtures: Fixture[] = [];
      const statsMap: Record<number, MatchStats> = {};

      // Only scan active in-progress games and keep top 10 live games for lighting-fast performance
      const activeEvents = events
        .filter((event: any) => event.status?.type === 'inprogress' || [6, 31, 7, 41, 42, 32, 50].includes(event.status?.code))
        .slice(0, 10);

      // Async fetch stats for all these live games in parallel
      await Promise.all(activeEvents.map(async (event: any) => {
        try {
          const statsUrl = `${BASE_URL}/event/${event.id}/statistics?t=${Date.now()}`;
          const statsRes = await fetch(statsUrl, { method: 'GET' });
          let statItems: any[] = [];

          if (statsRes.ok) {
            const statsData = await statsRes.json();
            // Typically Sofascore groups statistics, we want the "ALL" period
            const allPeriodStats = statsData.statistics?.find((s: any) => s.period === 'ALL');
            if (allPeriodStats && Array.isArray(allPeriodStats.groups)) {
              allPeriodStats.groups.forEach((g: any) => {
                if (Array.isArray(g.statisticsItems)) {
                  statItems.push(...g.statisticsItems);
                }
              });
            }
          }

          // Calculate elapsed time from currentPeriodStartTimestamp
          let elapsed = 0;
          const startTimestamp = event.time?.currentPeriodStartTimestamp;
          if (startTimestamp) {
            const now = Math.floor(Date.now() / 1000);
            elapsed = Math.floor((now - startTimestamp) / 60);
            if (event.status?.code === 7) { // 2nd Half
              elapsed = Math.min(90, elapsed + 45);
            } else {
              elapsed = Math.min(45, elapsed);
            }
          } else {
            // Backup elapsed time mapping
            elapsed = event.status?.code === 6 ? 25 : event.status?.code === 7 ? 70 : 15;
          }

          const goalsHome = Number(event.homeScore?.current ?? 0);
          const goalsAway = Number(event.awayScore?.current ?? 0);

          const fixture: Fixture = {
            id: event.id,
            status: event.status?.code === 6 ? "1H" : event.status?.code === 31 ? "HT" : event.status?.code === 7 ? "2H" : "FT",
            elapsed,
            goalsHome,
            goalsAway,
            homeTeam: {
              id: event.homeTeam?.id || 1,
              name: event.homeTeam?.name || 'Home Team',
              logo: event.homeTeam?.slug ? `https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image` : ''
            },
            awayTeam: {
              id: event.awayTeam?.id || 2,
              name: event.awayTeam?.name || 'Away Team',
              logo: event.awayTeam?.slug ? `https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image` : ''
            }
          };

          fixtures.push(fixture);

          // Parse metrics
          const possession = extractSofascoreStat(statItems, 'possession');
          const corners = extractSofascoreStat(statItems, 'corner');
          const shotsOnGoal = extractSofascoreStat(statItems, 'on target');
          const shotsOffGoal = extractSofascoreStat(statItems, 'off target');
          const yellowCards = extractSofascoreStat(statItems, 'yellow card');
          const redCards = extractSofascoreStat(statItems, 'red card');
          
          const attacks = extractSofascoreStat(statItems, 'attacks');
          const dangerousAttacks = extractSofascoreStat(statItems, 'dangerous attacks');

          const hasTelemetry = statItems.length > 0 && !(
            attacks.home === 0 && attacks.away === 0 &&
            dangerousAttacks.home === 0 && dangerousAttacks.away === 0 &&
            corners.home === 0 && corners.away === 0 &&
            shotsOnGoal.home === 0 && shotsOnGoal.away === 0
          );

          const homeStats = {
            shotsOnGoal: shotsOnGoal.home,
            shotsOffGoal: shotsOffGoal.home,
            totalShots: 0,
            blockedShots: 0,
            shotsInsideBox: 0,
            corners: corners.home,
            fouls: 0,
            possession: possession.home || 50,
            yellowCards: yellowCards.home,
            redCards: redCards.home,
            goalkeeperSaves: 0,
            attacks: attacks.home,
            dangerousAttacks: dangerousAttacks.home,
          };

          const awayStats = {
            shotsOnGoal: shotsOnGoal.away,
            shotsOffGoal: shotsOffGoal.away,
            totalShots: 0,
            blockedShots: 0,
            shotsInsideBox: 0,
            corners: corners.away,
            fouls: 0,
            possession: possession.away || 50,
            yellowCards: yellowCards.away,
            redCards: redCards.away,
            goalkeeperSaves: 0,
            attacks: attacks.away,
            dangerousAttacks: dangerousAttacks.away,
          };

          const pHomeIndex = calculatePressureIndex(homeStats);
          const pAwayIndex = calculatePressureIndex(awayStats);

          const divisor = elapsed > 0 ? elapsed : 1;
          const iimHome = Number((homeStats.dangerousAttacks / divisor).toFixed(2));
          const iimAway = Number((awayStats.dangerousAttacks / divisor).toFixed(2));

          statsMap[event.id] = {
            fixtureId: event.id,
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
        } catch (e) {
          console.error(`Error loading stats for Sofascore event ${event.id}:`, e);
        }
      }));

      return { fixtures, statsMap, isMock: false };
    } catch (err) {
      console.error("Error connecting to Sofascore Live API feed:", err);
      return { fixtures: [], statsMap: {}, isMock: true };
    }
  }

  async getFixtureDetails(eventId: number): Promise<any> {
    try {
      const url = `${BASE_URL}/event/${eventId}`;
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error(`Error fetching fixture details for ${eventId}:`, e);
    }
    return null;
  }

  async getFixtureStatistics(eventId: number): Promise<any> {
    try {
      const url = `${BASE_URL}/event/${eventId}/statistics`;
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error(`Error fetching fixture statistics for ${eventId}:`, e);
    }
    return null;
  }
}

export const sofascore = new SofascoreService();
