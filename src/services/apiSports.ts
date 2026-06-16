export interface Team {
  id: number;
  name: string;
  logo: string;
}

export interface Fixture {
  id: number;
  status: string; // "1H", "2H", "HT", "FT"
  elapsed: number; // minutes elapsed
  homeTeam: Team;
  awayTeam: Team;
  goalsHome: number;
  goalsAway: number;
  leagueName: string;
  kickoffTime?: string;
}

export interface TeamStats {
  // ✅ Campos REAIS da API-Sports /fixtures/statistics
  shotsOnGoal: number;       // Shots on Goal
  shotsOffGoal: number;      // Shots off Goal
  totalShots: number;        // Total Shots (NOVO)
  blockedShots: number;      // Blocked Shots (NOVO)
  shotsInsideBox: number;    // Shots insidebox (NOVO)
  corners: number;           // Corner Kicks
  fouls: number;             // Fouls (NOVO)
  possession: number;        // Ball Possession (%)
  yellowCards: number;       // Yellow Cards
  redCards: number;           // Red Cards
  goalkeeperSaves: number;   // Goalkeeper Saves (NOVO)
  offsides?: number;          // Impedimentos
  // ❌ Campos que a API NÃO fornece (mantidos para compatibilidade com Sportmonks)
  attacks: number;           // Attacks — sempre 0 na API-Sports
  dangerousAttacks: number;  // Dangerous Attacks — sempre 0 na API-Sports
  // 📊 Campos CALCULADOS a partir dos dados reais
  pressureIndex: number;     // Índice de pressão (0-100)
  iim: number;               // IIM: Índice de Intensidade por Minuto (chutes+cantos/min)
  apmGlobal?: number;        // APM Nativo lido da extensão (Bridge)
  apm10?: number;            // APM 10 Nativo lido da extensão (Bridge)
  apm5?: number;             // APM 5 Nativo lido da extensão (Bridge)
}

export interface TelemetrySnapshot {
  elapsed: number;     // Minuto do jogo (ex: 35)
  homeDA: number;      // Ataques Perigosos Mandante
  awayDA: number;      // Ataques Perigosos Visitante
  timestamp: number;   // Epoch timestamp em ms
}

export interface MatchStats {
  fixtureId: number;
  home: TeamStats;
  away: TeamStats;
  hasTelemetry: boolean; // Flag to indicate whether the API actually returned live statistics
  elapsed?: number;      // Tempo decorrido (opcional, vindo da bridge se disponível)
  hasBridge?: boolean; // Flag indicating if the match has been enriched with Bet365 bridge data
  snapshots?: TelemetrySnapshot[]; // Telemetry snapshots time-series
  pastEvents?: { elapsed: number, type: string, side: 'home' | 'away', text: string }[];
}

export interface PreMatchDossier {
  fixtureId: number;
  // 1. Força Ofensiva (0-100)
  offensiveStrengthHome: number;
  offensiveStrengthAway: number;
  // 2. Média de Gols
  avgGoalsScoredHome: number;
  avgGoalsConcededHome: number;
  avgGoalsScoredAway: number;
  avgGoalsConcededAway: number;
  // 3. Média de Escanteios
  avgCornersHome: number;
  avgCornersAway: number;
  // 4. Posse Média
  avgPossessionHome: number;
  avgPossessionAway: number;
  // 5. Estilo Tático
  tacticalStyleHome: string;
  tacticalStyleAway: string;
  // 6. Ritmo Médio
  tempoHome: string;
  tempoAway: string;
  // 7. Agressividade
  aggressivenessHome: string;
  aggressivenessAway: string;
  // 8. Formação Inicial
  formationHome: string;
  formationAway: string;
  // 9. Clima
  weather: string;
  // 10. Árbitro
  refereeName: string;
  refereeCardRate: number; // e.g. 5.4 cards/match
  // 11. Desgaste/Fadiga (0-100)
  fatigueHome: number;
  fatigueAway: number;
  // 12. Rotação
  rotationHome: string;
  rotationAway: string;
  // 13. Necessidade do Resultado (0-100)
  motivationHome: number;
  motivationAway: number;
  // 14. Tabela/Classificação
  standingsHome: string;
  standingsAway: string;
  formHome?: string[];
  formAway?: string[];
  // 15. Liga
  leagueProfile: string;
  // 16. Desfalques
  absencesHome: string[];
  absencesAway: string[];
  hasPredictions?: boolean; // Flag to indicate whether pre-match predictions were available
}

// Mathematically sound momentum/pressure formula
export function calculatePressureIndex(stats: Omit<TeamStats, 'pressureIndex' | 'iim'>): number {
  const shotFactor = stats.shotsOnGoal * 2.5 + stats.shotsOffGoal * 1.0;
  const cornerFactor = stats.corners * 1.5;
  const dangerRatio = stats.attacks > 0 ? (stats.dangerousAttacks / stats.attacks) : 0;
  
  // Dynamic weight representing dangerous attacks momentum
  const dangerAttackFactor = stats.dangerousAttacks * 0.3 * (1 + dangerRatio);

  return Math.min(100, Math.floor(dangerAttackFactor + shotFactor + cornerFactor));
}

// Main service class targeting the API-Sports / API-Football endpoints with permanently integrated Pro key
class ApiSportsService {
  private getApiKey(): string {
    // Return localStorage key if configured, otherwise fallback to permanently integrated active plan Pro API Key
    return localStorage.getItem('api_sports_key') || '1006612834b19b26953088378103a894';
  }

  isKeyConfigured(): boolean {
    return !!this.getApiKey();
  }

  saveKeyLocally(key: string) {
    if (key) {
      localStorage.setItem('api_sports_key', key);
    }
  }

  clearKeyLocally() {
    localStorage.removeItem('api_sports_key');
  }

  // Fetch all active live fixtures
  async getLiveFixtures(): Promise<{ fixtures: Fixture[]; isMock: boolean; errorReason?: 'limit_reached' | 'invalid_key' | 'network_error' }> {
    const apiKey = this.getApiKey();

    try {
      const response = await fetch(`/api-sports/fixtures?live=all`, {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });

      if (!response.ok) {
        throw new Error(`API HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("API-Sports returned errors:", data.errors);
        
        const firstError = String(Object.values(data.errors)[0] || '').toLowerCase();
        let reason: 'limit_reached' | 'invalid_key' | 'network_error' = 'network_error';
        if (firstError.includes('limit') || firstError.includes('reached') || firstError.includes('exceeded')) {
          reason = 'limit_reached';
        } else if (firstError.includes('key') || firstError.includes('token') || firstError.includes('subscription')) {
          reason = 'invalid_key';
        }
        
        return { fixtures: [], isMock: false, errorReason: reason };
      }

      const rawFixtures = data.response || [];
      const activeStatuses = ['1H', 'HT', '2H', 'ET', 'BT', 'P'];
      
      const fixtures: Fixture[] = rawFixtures
        .filter((f: any) => activeStatuses.includes(f.fixture.status.short))
        .map((f: any) => ({
          id: f.fixture.id,
          status: this.mapStatus(f.fixture.status.short),
          elapsed: f.fixture.status.elapsed || 0,
          homeTeam: {
            id: f.teams.home.id,
            name: f.teams.home.name,
            logo: f.teams.home.logo,
          },
          awayTeam: {
            id: f.teams.away.id,
            name: f.teams.away.name,
            logo: f.teams.away.logo,
          },
          goalsHome: f.goals.home ?? 0,
          goalsAway: f.goals.away ?? 0,
          leagueName: f.league.name,
        }));

      return { fixtures, isMock: false };
    } catch (error) {
      console.error("Error fetching real API-Sports live fixtures:", error);
      return { fixtures: [], isMock: false };
    }
  }

  // Fetch real upcoming fixtures for a specific date (default: today)
  async getUpcomingFixtures(dateStr?: string): Promise<{ fixtures: Fixture[]; isMock: boolean; errorReason?: string }> {
    const apiKey = this.getApiKey();

    try {
      const targetDateStr = dateStr || new Date().toISOString().split('T')[0];
      const response = await fetch(`/api-sports/fixtures?date=${targetDateStr}`, {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });

      if (!response.ok) {
        throw new Error(`API HTTP Error: ${response.status}`);
      }

      const data = await response.json();

      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("API-Sports upcoming fixtures returned errors:", data.errors);
        return { fixtures: [], isMock: false, errorReason: 'limit_reached' };
      }

      const rawFixtures = data.response || [];
      
      const now = Date.now();
      // Filter scheduled or not started matches (NS = Not Started) that start in the future (or at most 15 minutes ago)
      const upcoming = rawFixtures
        .filter((f: any) => f.fixture.status.short === 'NS' || f.fixture.status.short === 'TBD')
        .filter((f: any) => new Date(f.fixture.date).getTime() > now - 15 * 60 * 1000)
        .slice(0, 30) // Increased to top 30 matches
        .map((f: any) => {
          const kickoffDate = new Date(f.fixture.date);
          const formattedTime = kickoffDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const isToday = kickoffDate.toDateString() === new Date().toDateString();
          const kickoffTime = isToday ? `Hoje às ${formattedTime}` : `Amanhã às ${formattedTime}`;

          return {
            id: f.fixture.id,
            status: 'NS',
            elapsed: 0,
            homeTeam: {
              id: f.teams.home.id,
              name: f.teams.home.name,
              logo: f.teams.home.logo,
            },
            awayTeam: {
              id: f.teams.away.id,
              name: f.teams.away.name,
              logo: f.teams.away.logo,
            },
            goalsHome: 0,
            goalsAway: 0,
            leagueName: `${f.league.name} - ${f.league.country}`,
            kickoffTime,
          };
        });

      return { fixtures: upcoming, isMock: false };
    } catch (error) {
      console.error("Error fetching real upcoming fixtures:", error);
      return { fixtures: [], isMock: false };
    }
  }

  // Fetch detailed statistics for a specific fixture
  async getMatchStats(fixtureId: number, elapsed: number = 45): Promise<{ stats: MatchStats; isMock: boolean }> {
    const apiKey = this.getApiKey();

    try {
      const response = await fetch(`/api-sports/fixtures/statistics?fixture=${fixtureId}`, {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });

      if (!response.ok) {
        throw new Error(`API HTTP Error: ${response.status}`);
      }

      const data = await response.json();

      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("API-Sports stats returned errors:", data.errors);
        return { stats: this.generateEmptyStats(fixtureId), isMock: false };
      }

      const teamsData = data.response || [];
      
      // Check if the API returned an empty statistics array (common for minor/regional leagues)
      if (teamsData.length === 0 || !teamsData[0]?.statistics || teamsData[0].statistics.length === 0) {
        const stats = this.generateEmptyStats(fixtureId);
        stats.hasTelemetry = false; // Flag as lacking live telemetry
        return { stats, isMock: false };
      }

      const stats: MatchStats = {
        fixtureId,
        home: this.parseTeamStats(teamsData[0]?.statistics || [], elapsed),
        away: this.parseTeamStats(teamsData[1]?.statistics || [], elapsed),
        hasTelemetry: true
      };

      return { stats, isMock: false };
    } catch (error) {
      console.error(`Error fetching real match stats for fixture ${fixtureId}:`, error);
      return { stats: this.generateEmptyStats(fixtureId), isMock: false };
    }
  }

  // Fetch comprehensive Pre-Match Dossier containing the 16 core variables
  async getPreMatchDossier(fixtureId: number): Promise<{ dossier: PreMatchDossier; isMock: boolean }> {
    const apiKey = this.getApiKey();

    try {
      // QueryPredictions endpoint from API-Sports
      const response = await fetch(`/api-sports/predictions?fixture=${fixtureId}`, {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });

      if (!response.ok) {
        throw new Error(`API HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("API-Sports predictions returned errors:", data.errors);
        const dossier = this.generateEmptyDossier(fixtureId);
        dossier.hasPredictions = false;
        return { dossier, isMock: false };
      }

      const rawPrediction = data.response?.[0];
      if (!rawPrediction) {
        const dossier = this.generateEmptyDossier(fixtureId);
        dossier.hasPredictions = false;
        return { dossier, isMock: false };
      }

      const dossier = this.parseRealDossier(fixtureId, rawPrediction);
      dossier.hasPredictions = true;
      return { dossier, isMock: false };
    } catch (error) {
      console.error(`Error fetching real predictions for ${fixtureId}:`, error);
      const dossier = this.generateEmptyDossier(fixtureId);
      dossier.hasPredictions = false;
      return { dossier, isMock: false };
    }
  }

  /**
   * parseRealDossier — Constrói o dossiê pré-jogo usando APENAS dados reais da API-Sports.
   *
   * ═══════════════════════════════════════════════════════════════
   * CAMPOS FORNECIDOS PELA API /predictions (dados reais):
   * ═══════════════════════════════════════════════════════════════
   * ✅ predictions.percent.home/draw/away         → Probabilidades de vitória
   * ✅ predictions.winner.comment                  → Texto de análise curta
   * ✅ comparison.att/def/poisson_distribution/form/h2h/goals → Comparações percentuais
   * ✅ teams.home/away.league.form                 → String de forma recente (ex: 'WWDLW')
   * ✅ teams.home/away.league.goals.for/against.average.home/away → Médias de gols
   * ✅ teams.home/away.league.fixtures.wins/draws/loses → Contagem V/E/D
   *
   * ═══════════════════════════════════════════════════════════════
   * CAMPOS NÃO FORNECIDOS PELA API (preenchidos com marcadores):
   * ═══════════════════════════════════════════════════════════════
   * ❌ avgCornersHome/Away       → 0 (API não fornece médias de escanteios)
   * ❌ tacticalStyleAway         → "" (API não fornece estilo tático detalhado)
   * ❌ tempoHome/Away            → Mostra win% real em vez de análise tática inventada
   * ❌ aggressivenessHome/Away   → "" (API não fornece dados de agressividade)
   * ❌ formationHome/Away        → "Sem dados da API" (API não fornece formação neste endpoint)
   * ❌ weather                   → "Sem dados da API" (API não fornece clima neste endpoint)
   * ❌ refereeName               → "Sem dados da API" (API não fornece árbitro neste endpoint)
   * ❌ refereeCardRate           → 0 (API não fornece taxa de cartões do árbitro)
   * ❌ fatigueHome/Away          → 0 (API não fornece índice de fadiga)
   * ❌ rotationHome/Away         → "Sem dados da API" (API não fornece dados de rotação)
   * ❌ standingsHome/Away        → "Sem dados da API" (API não fornece classificação neste endpoint)
   * ❌ leagueProfile             → "" (API não fornece perfil da liga)
   * ❌ absencesHome/Away         → [] (API não fornece lesões neste endpoint)
   */
  private parseRealDossier(fixtureId: number, pred: any): PreMatchDossier {
    // ✅ DADOS REAIS: Probabilidades de vitória da API
    const percentHome = pred.predictions?.percent?.home ? parseInt(pred.predictions.percent.home.replace('%', ''), 10) : 0;
    const percentAway = pred.predictions?.percent?.away ? parseInt(pred.predictions.percent.away.replace('%', ''), 10) : 0;

    // ✅ DADOS REAIS: Comparações percentuais da API
    const getComp = (type: string, team: 'home' | 'away'): number => {
      const val = pred.comparison?.[type]?.[team];
      if (!val) return 0;
      return parseInt(val.replace('%', ''), 10);
    };

    // ✅ DADOS REAIS: Forma recente (últimos 5 jogos)
    const formHome = pred.teams?.home?.league?.form
      ? pred.teams.home.league.form.split('').slice(-5)
      : [];
    const formAway = pred.teams?.away?.league?.form
      ? pred.teams.away.league.form.split('').slice(-5)
      : [];

    // ✅ DADOS REAIS: Médias de gols da liga (0 se ausente)
    const avgGoalsScoredHome = Number(pred.teams?.home?.league?.goals?.for?.average?.home || 0);
    const avgGoalsConcededHome = Number(pred.teams?.home?.league?.goals?.against?.average?.home || 0);
    const avgGoalsScoredAway = Number(pred.teams?.away?.league?.goals?.for?.average?.away || 0);
    const avgGoalsConcededAway = Number(pred.teams?.away?.league?.goals?.against?.average?.away || 0);

    // ✅ DADOS REAIS: Posse estimada a partir das comparações (comparison.poisson_distribution)
    const possHome = getComp('poisson_distribution', 'home');
    const possAway = getComp('poisson_distribution', 'away');

    // ✅ DADOS REAIS: Texto de análise do winner.comment (pode ser vazio)
    const winnerComment = pred.predictions?.winner?.comment || '';

    return {
      fixtureId,
      // ✅ Da API: comparison.att
      offensiveStrengthHome: getComp('att', 'home'),
      offensiveStrengthAway: getComp('att', 'away'),
      // ✅ Da API: teams.X.league.goals.for/against.average
      avgGoalsScoredHome,
      avgGoalsConcededHome,
      avgGoalsScoredAway,
      avgGoalsConcededAway,
      // ❌ API NÃO FORNECE: escanteios
      avgCornersHome: 0,
      avgCornersAway: 0,
      // ✅ Da API: derivado de comparison.poisson_distribution
      avgPossessionHome: possHome,
      avgPossessionAway: possAway,
      // ✅ Da API: predictions.winner.comment (apenas para home)
      tacticalStyleHome: winnerComment,
      // ❌ API NÃO FORNECE: estilo tático detalhado do visitante
      tacticalStyleAway: '',
      // ✅ Da API: mostra win% real em vez de rótulo inventado
      tempoHome: percentHome > 0 ? `Win%: ${percentHome}%` : '',
      tempoAway: percentAway > 0 ? `Win%: ${percentAway}%` : '',
      // ❌ API NÃO FORNECE: agressividade
      aggressivenessHome: '',
      aggressivenessAway: '',
      // ❌ API NÃO FORNECE: formação neste endpoint
      formationHome: 'Sem dados da API',
      formationAway: 'Sem dados da API',
      // ❌ API NÃO FORNECE: clima
      weather: 'Sem dados da API',
      // ❌ API NÃO FORNECE: árbitro neste endpoint
      refereeName: 'Sem dados da API',
      refereeCardRate: 0,
      // ❌ API NÃO FORNECE: fadiga
      fatigueHome: 0,
      fatigueAway: 0,
      // ❌ API NÃO FORNECE: rotação
      rotationHome: 'Sem dados da API',
      rotationAway: 'Sem dados da API',
      // ✅ Da API: predictions.percent (usado como proxy de motivação)
      motivationHome: percentHome,
      motivationAway: percentAway,
      // ❌ API NÃO FORNECE: classificação neste endpoint
      standingsHome: 'Sem dados da API',
      standingsAway: 'Sem dados da API',
      // ✅ Da API: teams.X.league.form
      formHome,
      formAway,
      // ❌ API NÃO FORNECE: perfil da liga
      leagueProfile: '',
      // ❌ API NÃO FORNECE: lesões neste endpoint
      absencesHome: [],
      absencesAway: [],
      hasPredictions: true
    };
  }

  /**
   * generateEmptyDossier — Dossiê vazio para quando não há dados da API.
   * Todos os campos numéricos são 0, todos os textuais são "Sem dados da API".
   */
  private generateEmptyDossier(fixtureId: number): PreMatchDossier {
    return {
      fixtureId,
      offensiveStrengthHome: 0, offensiveStrengthAway: 0,
      avgGoalsScoredHome: 0, avgGoalsConcededHome: 0,
      avgGoalsScoredAway: 0, avgGoalsConcededAway: 0,
      avgCornersHome: 0, avgCornersAway: 0,
      avgPossessionHome: 0, avgPossessionAway: 0,
      tacticalStyleHome: '', tacticalStyleAway: '',
      tempoHome: '', tempoAway: '',
      aggressivenessHome: '', aggressivenessAway: '',
      formationHome: 'Sem dados da API', formationAway: 'Sem dados da API',
      weather: 'Sem dados da API', refereeName: 'Sem dados da API', refereeCardRate: 0,
      fatigueHome: 0, fatigueAway: 0,
      rotationHome: 'Sem dados da API', rotationAway: 'Sem dados da API',
      motivationHome: 0, motivationAway: 0,
      standingsHome: 'Sem dados da API', standingsAway: 'Sem dados da API',
      formHome: [], formAway: [],
      leagueProfile: '', absencesHome: [], absencesAway: [],
      hasPredictions: false
    };
  }

  private mapStatus(short: string): string {
    switch (short) {
      case '1H': return '1H';
      case '2H': return '2H';
      case 'HT': return 'HT';
      case 'FT': return 'FT';
      default: return '1H';
    }
  }

  private parseTeamStats(statistics: any[], elapsed: number = 45): TeamStats {
    const getVal = (type: string): number => {
      const stat = statistics.find(s => s.type === type);
      if (!stat || stat.value === null || stat.value === undefined) return 0;
      if (typeof stat.value === 'string' && stat.value.endsWith('%')) {
        return parseInt(stat.value.replace('%', ''), 10);
      }
      return Number(stat.value);
    };

    // ✅ TODOS os campos reais da API-Sports
    const shotsOnGoal = getVal("Shots on Goal");
    const shotsOffGoal = getVal("Shots off Goal");
    const totalShots = getVal("Total Shots");
    const blockedShots = getVal("Blocked Shots");
    const shotsInsideBox = getVal("Shots insidebox");
    const corners = getVal("Corner Kicks");
    const fouls = getVal("Fouls");
    const possession = getVal("Ball Possession") || 50;
    const yellowCards = getVal("Yellow Cards");
    const redCards = getVal("Red Cards");
    const goalkeeperSaves = getVal("Goalkeeper Saves");

    // ❌ Campos que a API-Sports NÃO fornece (apenas Sportmonks)
    const attacks = getVal("Attacks");
    const dangerousAttacks = getVal("Dangerous Attacks");

    const tempStats = {
      shotsOnGoal, shotsOffGoal, totalShots, blockedShots, shotsInsideBox,
      corners, fouls, possession, yellowCards, redCards, goalkeeperSaves,
      attacks, dangerousAttacks
    };

    const pressureIndex = calculatePressureIndex(tempStats);
    const el = elapsed > 0 ? elapsed : 1;

    /**
     * IIM: Índice de Intensidade por Minuto
     * Calculado APENAS com dados reais da API-Sports:
     *   IIM = (Chutes ao Gol × 3.0 + Chutes Fora × 1.2 + Escanteios × 2.0 + Chutes Bloqueados × 0.8) / minutos
     * 
     * Se Sportmonks estiver disponível e fornecer dangerousAttacks nativos, usa esses.
     */
    const hasNativeAttacks = dangerousAttacks > 0 || attacks > 0;
    
    let iim: number;
    if (hasNativeAttacks) {
      iim = Number((dangerousAttacks / el).toFixed(2));
    } else {
      const intensityScore = (shotsOnGoal * 3.0) + (shotsOffGoal * 1.2) + (corners * 2.0) + (blockedShots * 0.8);
      iim = Number((intensityScore / el).toFixed(2));
    }

    return {
      ...tempStats,
      pressureIndex,
      iim
    };
  }

  private generateEmptyStats(fixtureId: number): MatchStats {
    const emptyTeam: TeamStats = {
      shotsOnGoal: 0, shotsOffGoal: 0, totalShots: 0, blockedShots: 0,
      shotsInsideBox: 0, corners: 0, fouls: 0, possession: 50,
      yellowCards: 0, redCards: 0, goalkeeperSaves: 0,
      attacks: 0, dangerousAttacks: 0,
      pressureIndex: 0, iim: 0
    };
    return {
      fixtureId,
      home: { ...emptyTeam },
      away: { ...emptyTeam },
      hasTelemetry: false
    };
  }
}

export const apiSports = new ApiSportsService();
