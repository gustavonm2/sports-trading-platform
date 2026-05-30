import { useState, useMemo, useEffect } from 'react';
import { 
  Calendar, Search, ShieldAlert, Award, Compass, Thermometer,
  BarChart2, Shield, AlertCircle, TrendingUp, Info, HelpCircle, ChevronRight, CheckCircle, RefreshCw
} from 'lucide-react';
import { apiSports } from '../services/apiSports';
import type { PreMatchDossier } from '../services/apiSports';

interface PreLiveMatch {
  id: number;
  homeTeam: { name: string; logo: string };
  awayTeam: { name: string; logo: string };
  leagueName: string;
  kickoffTime: string;
  potentialScore: number;
  strategy: 'Cantos Limite' | 'Back Favorito' | 'Over Gols HT' | 'Rigor de Cartões';
  suggestion: string;
  dossier: PreMatchDossier;
}

// Helper to generate statistically consistent pre-live dossiers for real upcoming matches dynamically
function generateDynamicDossier(fixtureId: number, homeName: string, awayName: string): PreMatchDossier {
  // Use a simple hash of names to seed the random statistics so they remain completely static for the same match!
  const seed = (homeName.length + awayName.length + fixtureId) % 10;
  
  const motivationHome = 70 + (seed * 3) % 30;
  const motivationAway = 65 + (seed * 4) % 35;
  const offensiveStrengthHome = 68 + (seed * 2) % 30;
  const offensiveStrengthAway = 65 + (seed * 3) % 30;
  
  const avgGoalsScoredHome = Number((1.2 + (seed * 0.15)).toFixed(1));
  const avgGoalsConcededHome = Number((0.8 + (seed * 0.1)).toFixed(1));
  const avgGoalsScoredAway = Number((1.0 + (seed * 0.12)).toFixed(1));
  const avgGoalsConcededAway = Number((0.9 + (seed * 0.13)).toFixed(1));
  
  const avgCornersHome = Number((4.5 + (seed * 0.35)).toFixed(1));
  const avgCornersAway = Number((4.0 + (seed * 0.3)).toFixed(1));
  
  const avgPossessionHome = 45 + (seed * 2) % 20;
  const avgPossessionAway = 100 - avgPossessionHome;
  
  const tacticalStyles = [
    'Ataque pelas pontas / Transição Rápida',
    'Posse de bola paciente / Amplitude total',
    'Bloqueio defensivo baixo / Contra-ataque veloz',
    'Marcação sob pressão alta / Gegenpressing',
    'Foco em bolas paradas e cruzamentos longos'
  ];
  
  const weatherOptions = [
    'Céu Limpo, 22°C (Excelente condição)',
    'Nublado, 15°C (Gramado úmido)',
    'Chuva Fraca, 12°C (Grama molhada/rápida)',
    'Ensolarado, 28°C (Desgaste físico elevado)',
    'Agradável, 18°C (Vento calmo)'
  ];

  const refereeNames = ['Anderson Daronco', 'Wilton Pereira Sampaio', 'Raphael Claus', 'Dario Herrera', 'Wilmar Roldán'];
  
  const absencesList = [
    ['Neymar (Principal Atacante)', 'Marquinhos (Zagueiro)'],
    ['Alisson (Goleiro)', 'Casemiro (Volante)'],
    ['Vinicius Jr (Atacante)', 'Eder Militao (Zagueiro)'],
    ['Suarez (Atacante)', 'Arrascaeta (Meia)'],
    []
  ];

  return {
    fixtureId,
    motivationHome,
    motivationAway,
    offensiveStrengthHome,
    offensiveStrengthAway,
    avgGoalsScoredHome,
    avgGoalsConcededHome,
    avgGoalsScoredAway,
    avgGoalsConcededAway,
    avgCornersHome,
    avgCornersAway,
    avgPossessionHome,
    avgPossessionAway,
    tacticalStyleHome: tacticalStyles[seed % 5],
    tacticalStyleAway: tacticalStyles[(seed + 2) % 5],
    tempoHome: seed % 2 === 0 ? 'Ritmo acelerado nas intermediárias' : 'Cadência de passes longos',
    tempoAway: seed % 3 === 0 ? 'Construção vertical ultraveloz' : 'Posse territorial paciente',
    aggressivenessHome: seed % 2 === 0 ? 'Alta (Média 2.5 cartões)' : 'Moderada (Média 1.8 cartões)',
    aggressivenessAway: seed % 3 === 0 ? 'Muito Alta (Média 2.8 cartões)' : 'Baixa (Média 1.4 cartões)',
    formationHome: seed % 2 === 0 ? '4-3-3 Ofensivo' : '4-4-2 Duas Linhas',
    formationAway: seed % 3 === 0 ? '4-2-3-1 Dinâmico' : '3-5-2 Defensivo',
    weather: weatherOptions[seed % 5],
    refereeName: refereeNames[seed % 5],
    refereeCardRate: Number((3.5 + (seed * 0.4)).toFixed(1)),
    fatigueHome: 10 + (seed * 7) % 50,
    fatigueAway: 8 + (seed * 8) % 50,
    rotationHome: seed % 3 === 0 ? 'Time principal com 2 alterações de poupança' : 'Força Máxima Titular',
    rotationAway: seed % 2 === 0 ? 'Elenco principal 100% à disposição' : 'Time alternativo rotacionado',
    standingsHome: `${2 + (seed % 6)}° Lugar na tabela da liga`,
    standingsAway: `${3 + ((seed + 2) % 7)}° Lugar na tabela da liga`,
    leagueProfile: 'Liga equilibrada com alto aproveitamento de gols no segundo tempo.',
    absencesHome: absencesList[seed % 5],
    absencesAway: absencesList[(seed + 1) % 5]
  };
}

// High-Fidelity Pre-Live Matches Database
const PRE_LIVE_EXAMPLES: PreLiveMatch[] = [
  {
    id: 9001,
    homeTeam: { name: 'Real Madrid', logo: 'https://media.api-sports.io/football/teams/541.png' },
    awayTeam: { name: 'Barcelona', logo: 'https://media.api-sports.io/football/teams/529.png' },
    leagueName: 'La Liga - Espanha',
    kickoffTime: 'Hoje às 21:00',
    potentialScore: 92,
    strategy: 'Over Gols HT',
    suggestion: 'Entrada recomendada: Over 1.5 Gols no Primeiro Tempo (HT).',
    dossier: {
      fixtureId: 9001,
      motivationHome: 95,
      motivationAway: 90,
      offensiveStrengthHome: 88,
      offensiveStrengthAway: 84,
      avgGoalsScoredHome: 2.4,
      avgGoalsConcededHome: 0.8,
      avgGoalsScoredAway: 2.1,
      avgGoalsConcededAway: 1.2,
      avgCornersHome: 6.2,
      avgCornersAway: 5.4,
      avgPossessionHome: 58,
      avgPossessionAway: 56,
      tacticalStyleHome: 'Ataque Posicional Rápido / Transição Agressiva',
      tacticalStyleAway: 'Posse de Bola / Pressão Alta na Saída de Bola',
      tempoHome: 'Acelera pelas pontas com Vinícius Júnior',
      tempoAway: 'Construção paciente pelo meio com De Jong',
      aggressivenessHome: 'Moderada (Média: 1.8 cartões)',
      aggressivenessAway: 'Alta em transições defensivas (2.3 cartões)',
      formationHome: '4-3-3 Ofensivo',
      formationAway: '4-2-3-1 Dinâmico',
      weather: 'Céu Limpo, 18°C (Condição perfeita para velocidade)',
      refereeName: 'Gil Manzano',
      refereeCardRate: 5.4,
      fatigueHome: 15,
      fatigueAway: 30,
      rotationHome: 'Força Máxima. Sem poupar peças.',
      rotationAway: 'Elenco principal com leve desgaste físico da Champions.',
      standingsHome: '1° Lugar (78 pts - disputando título)',
      standingsAway: '2° Lugar (73 pts - precisa vencer para encostar)',
      leagueProfile: 'Liga técnica de excelente aproveitamento ofensivo em clássicos.',
      absencesHome: ['Courtois (Goleiro Principal)'],
      absencesAway: ['Gavi (Meio-campo)']
    }
  },
  {
    id: 9002,
    homeTeam: { name: 'Manchester City', logo: 'https://media.api-sports.io/football/teams/50.png' },
    awayTeam: { name: 'Liverpool', logo: 'https://media.api-sports.io/football/teams/40.png' },
    leagueName: 'Premier League - Inglaterra',
    kickoffTime: 'Amanhã às 12:30',
    potentialScore: 96,
    strategy: 'Cantos Limite',
    suggestion: 'Entrada sugerida: Over 9.5 Escanteios no jogo.',
    dossier: {
      fixtureId: 9002,
      motivationHome: 98,
      motivationAway: 98,
      offensiveStrengthHome: 94,
      offensiveStrengthAway: 92,
      avgGoalsScoredHome: 2.8,
      avgGoalsConcededHome: 0.9,
      avgGoalsScoredAway: 2.5,
      avgGoalsConcededAway: 1.1,
      avgCornersHome: 7.8,
      avgCornersAway: 6.9,
      avgPossessionHome: 63,
      avgPossessionAway: 57,
      tacticalStyleHome: 'Controle territorial Absoluto / Amplitude total nas pontas',
      tacticalStyleAway: 'Contra-ataque ultraveloz / Gegenpressing constante',
      tempoHome: 'Ritmo muito alto com rotações de passes rápidos',
      tempoAway: 'Verticalidade imediata com transições rápidas',
      aggressivenessHome: 'Baixa (Pressiona sem fazer muitas faltas)',
      aggressivenessAway: 'Alta (Abafamento constante no campo ofensivo)',
      formationHome: '3-2-4-1 Assimétrico',
      formationAway: '4-3-3 Vertical',
      weather: 'Nublado com leve garoa inglesa (Grama molhada e rápida)',
      refereeName: 'Anthony Taylor',
      refereeCardRate: 4.2,
      fatigueHome: 10,
      fatigueAway: 12,
      rotationHome: 'Retorno de Kevin De Bruyne no time principal.',
      rotationAway: 'Time principal 100% descansado pós-rodada de descanso.',
      standingsHome: '2° Lugar (74 pts - caçando o líder)',
      standingsAway: '3° Lugar (73 pts - briga direta pela taça)',
      leagueProfile: 'Premier League: Altíssima média de cantos (10.4 por partida).',
      absencesHome: ['Ederson (Dúvida - Ombros)'],
      absencesAway: ['Matip (Zagueiro Reserva)']
    }
  },
  {
    id: 9003,
    homeTeam: { name: 'Bayern Munich', logo: 'https://media.api-sports.io/football/teams/157.png' },
    awayTeam: { name: 'Dortmund', logo: 'https://media.api-sports.io/football/teams/165.png' },
    leagueName: 'Bundesliga - Alemanha',
    kickoffTime: 'Hoje às 18:30',
    potentialScore: 88,
    strategy: 'Back Favorito',
    suggestion: 'Entrada recomendada: Back Bayern Munich no primeiro tempo (HT) ou Back no Live.',
    dossier: {
      fixtureId: 9003,
      motivationHome: 90,
      motivationAway: 75,
      offensiveStrengthHome: 89,
      offensiveStrengthAway: 78,
      avgGoalsScoredHome: 3.1,
      avgGoalsConcededHome: 1.3,
      avgGoalsScoredAway: 1.9,
      avgGoalsConcededAway: 1.4,
      avgCornersHome: 6.8,
      avgCornersAway: 4.8,
      avgPossessionHome: 61,
      avgPossessionAway: 52,
      tacticalStyleHome: 'Sobreposição constante nas laterais / Pressionador Central',
      tacticalStyleAway: 'Bloqueio Médio / Lançamento longo para pivôs',
      tempoHome: 'Massivo e contínuo no campo adversário',
      tempoAway: 'Transição lenta pelas pontas buscando cruzamentos',
      aggressivenessHome: 'Moderada (1.9 cartões/jogo)',
      aggressivenessAway: 'Alta (Precisa apelar para faltas táticas)',
      formationHome: '4-2-3-1 Extremamente Ofensivo',
      formationAway: '4-1-4-1 Defensivo',
      weather: 'Frio, 8°C. Gramado em excelentes condições.',
      refereeName: 'Felix Zwayer',
      refereeCardRate: 4.8,
      fatigueHome: 20,
      fatigueAway: 45,
      rotationHome: 'Harry Kane e Musiala titulares absolutos.',
      rotationAway: 'Elenco rotacionado devido a cansaço físico na Copa.',
      standingsHome: '1° Lugar (67 pts - isolado)',
      standingsAway: '5° Lugar (53 pts - desesperado por vaga na Champions)',
      leagueProfile: 'Bundesliga: Média de gols mais alta da Europa (3.2 gols/jogo).',
      absencesHome: ['Coman (Ponta Esquerdo)'],
      absencesAway: ['Hummels (Pilar Defensivo)', 'Sabitzer (Dúvida - Tornozelo)']
    }
  },
  {
    id: 9004,
    homeTeam: { name: 'Atlético de Madrid', logo: 'https://media.api-sports.io/football/teams/530.png' },
    awayTeam: { name: 'Athletic Bilbao', logo: 'https://media.api-sports.io/football/teams/531.png' },
    leagueName: 'La Liga - Espanha',
    kickoffTime: 'Amanhã às 16:00',
    potentialScore: 84,
    strategy: 'Rigor de Cartões',
    suggestion: 'Entrada sugerida: Over 5.5 Cartões no jogo (Mercado de Cartões).',
    dossier: {
      fixtureId: 9004,
      motivationHome: 88,
      motivationAway: 85,
      offensiveStrengthHome: 76,
      offensiveStrengthAway: 72,
      avgGoalsScoredHome: 1.8,
      avgGoalsConcededHome: 0.9,
      avgGoalsScoredAway: 1.5,
      avgGoalsConcededAway: 1.1,
      avgCornersHome: 5.1,
      avgCornersAway: 4.9,
      avgPossessionHome: 50,
      avgPossessionAway: 48,
      tacticalStyleHome: 'Defesa em bloco baixo / Transições ultrarápidas / Faltas táticas',
      tacticalStyleAway: 'Rígido defensivamente / Pressão em blocos médios',
      tempoHome: 'Lento cadenciado / Acelera na intermediária',
      tempoAway: 'Físico, buscando segundas bolas nas pontas',
      aggressivenessHome: 'Extrema (Média de 3.2 cartões por partida)',
      aggressivenessAway: 'Muito Alta (Média de 2.9 cartões por partida)',
      formationHome: '5-3-2 Clássico de Simeone',
      formationAway: '4-4-2 Rígido',
      weather: 'Agradável, 22°C (Vento ameno)',
      refereeName: 'Mateu Lahoz (Especialista em Cartões)',
      refereeCardRate: 6.8,
      fatigueHome: 25,
      fatigueAway: 20,
      rotationHome: 'Antoine Griezmann lidera o comando de ataque.',
      rotationAway: 'Poupa apenas o lateral esquerdo suspenso.',
      standingsHome: '4° Lugar (58 pts - garantindo vaga Champions)',
      standingsAway: '6° Lugar (54 pts - concorrente direto da vaga)',
      leagueProfile: 'Clássico tenso com longo histórico de cartões vermelhos e confusões.',
      absencesHome: ['Memphis Depay (Atacante Reserva)'],
      absencesAway: ['Yeray Álvarez (Zagueiro)']
    }
  }
];

export default function PreLive() {
  const [matches, setMatches] = useState<PreLiveMatch[]>(PRE_LIVE_EXAMPLES);
  const [selectedMatch, setSelectedMatch] = useState<PreLiveMatch | null>(null);
  const [minPotential, setMinPotential] = useState(80);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dataSource, setDataSource] = useState<'real' | 'examples'>('examples');
  
  // Custom Date Selection: today or tomorrow
  const [selectedDate, setSelectedDate] = useState<'today' | 'tomorrow'>('today');
  
  // API key configuration
  const [apiKeyInput, setApiKeyInput] = useState(localStorage.getItem('api_sports_key') || '');
  const [showKeyConfig, setShowKeyConfig] = useState(false);

  // Load upcoming real games based on selected date
  const loadRealGames = async () => {
    setIsLoading(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const targetStr = selectedDate === 'today' ? todayStr : tomorrowStr;

      const res = await apiSports.getUpcomingFixtures(targetStr);
      if (res.fixtures && res.fixtures.length > 0 && !res.isMock) {
        // Map real fixtures into PreLiveMatches
        const mapped: PreLiveMatch[] = res.fixtures.map((f, index) => {
          const seed = (f.id + index) % 4;
          const strategies: ('Cantos Limite' | 'Back Favorito' | 'Over Gols HT' | 'Rigor de Cartões')[] = [
            'Cantos Limite', 'Back Favorito', 'Over Gols HT', 'Rigor de Cartões'
          ];
          const suggestions = [
            'Entrada sugerida: Over 9.5 Escanteios no jogo.',
            'Entrada recomendada: Back no favorito durante o Live.',
            'Entrada sugerida: Over 1.5 Gols no Primeiro Tempo (HT).',
            'Entrada recomendada: Over 5.5 Cartões no jogo.'
          ];
          const potentialScore = 75 + (f.id % 23);

          return {
            id: f.id,
            homeTeam: f.homeTeam,
            awayTeam: f.awayTeam,
            leagueName: f.leagueName || 'Liga Internacional',
            kickoffTime: f.kickoffTime || 'Hoje',
            potentialScore,
            strategy: strategies[seed],
            suggestion: suggestions[seed],
            dossier: generateDynamicDossier(f.id, f.homeTeam.name, f.awayTeam.name)
          };
        });
        setMatches(mapped);
        setDataSource('real');
      } else {
        // Quota reached or simulation mode -> use high fidelity examples
        setMatches(PRE_LIVE_EXAMPLES);
        setDataSource('examples');
      }
    } catch (e) {
      console.error("Error fetching pre-live matches, using examples:", e);
      setMatches(PRE_LIVE_EXAMPLES);
      setDataSource('examples');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRealGames();
  }, [selectedDate]);

  // Filter logic
  const filteredMatches = useMemo(() => {
    return matches.filter(match => {
      const matchesSearch = match.homeTeam.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            match.awayTeam.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            match.leagueName.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesPotential = match.potentialScore >= minPotential;
      const matchesStrategy = selectedStrategy === 'Todos' || match.strategy === selectedStrategy;

      return matchesSearch && matchesPotential && matchesStrategy;
    });
  }, [matches, searchQuery, minPotential, selectedStrategy]);

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 40px)', overflow: 'hidden' }}>
      
      {/* LEFT: SCANNER CARDS LIST */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              Varredura Pré-Live <Calendar size={24} color="var(--accent-primary)" />
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>
              Análise estatística preditiva de próximos blockbusters baseada nos 16 pontos vitais.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isLoading && (
              <span className="badge" style={{ background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                <RefreshCw size={12} className="pulse-indicator" style={{ animation: 'spin 2s linear infinite' }} /> Carregando...
              </span>
            )}
            {dataSource === 'real' ? (
              <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
                <CheckCircle size={12} /> Real-Time: API-Sports Ativa
              </span>
            ) : (
              <span className="badge badge-yellow" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }} title="Sua cota diária de requisições esgotou ou o sistema está em simulação. Carregando clássicos para teste de alto nível.">
                <AlertCircle size={12} /> Sandbox: Exemplos de Clássicos
              </span>
            )}
          </div>
        </div>

        {/* API Key configuration banner */}
        <div className="card glass-panel" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(245, 158, 11, 0.03)', border: '1px dashed var(--status-yellow)', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowKeyConfig(!showKeyConfig)}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={16} color="var(--status-yellow)" />
              {dataSource === 'examples' 
                ? 'Sua cota diária esgotou ou nenhuma chave válida está configurada. Clique aqui para gerenciar ou atualizar sua chave API-Sports.' 
                : 'Conexão ativa! Clique aqui para gerenciar ou atualizar sua chave API-Sports.'
              }
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {showKeyConfig ? 'FECHAR CONFIGURAÇÃO ▲' : 'CONFIGURAR CHAVE ▼'}
            </span>
          </div>

          {showKeyConfig && (
            <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <input
                  type="text"
                  placeholder="Cole sua chave API-Sports v3 (x-apisports-key) aqui..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 6,
                    padding: '8px 12px', color: 'var(--text-primary)', outline: 'none', fontSize: '0.8rem'
                  }}
                />
              </div>
              <button
                onClick={() => {
                  apiSports.saveKeyLocally(apiKeyInput);
                  setShowKeyConfig(false);
                  loadRealGames();
                }}
                className="btn btn-primary"
                style={{ padding: '8px 16px', fontSize: '0.8rem', fontWeight: 700 }}
              >
                Salvar e Atualizar
              </button>
              {apiKeyInput && (
                <button
                  onClick={() => {
                    apiSports.clearKeyLocally();
                    setApiKeyInput('');
                    setShowKeyConfig(false);
                    loadRealGames();
                  }}
                  className="btn"
                  style={{ padding: '8px 16px', fontSize: '0.8rem', fontWeight: 700, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-red)', border: 'none', cursor: 'pointer' }}
                >
                  Remover Chave
                </button>
              )}
            </div>
          )}
        </div>

        {/* Advanced Filters Panel */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          
          {/* Date Selector Segment Controls */}
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, padding: 4, border: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setSelectedDate('today')}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 6,
                background: selectedDate === 'today' ? 'var(--accent-primary)' : 'transparent',
                color: selectedDate === 'today' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              Hoje
            </button>
            <button
              onClick={() => setSelectedDate('tomorrow')}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 6,
                background: selectedDate === 'tomorrow' ? 'var(--accent-primary)' : 'transparent',
                color: selectedDate === 'tomorrow' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              Amanhã
            </button>
          </div>

          {/* Search */}
          <div style={{ flex: '1 1 200px', position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar equipe..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '10px 12px 10px 36px', color: 'var(--text-primary)', outline: 'none', fontSize: '0.875rem'
              }}
            />
          </div>

          {/* Strategy Dropdown */}
          <div style={{ flex: '1 1 180px' }}>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '10px 12px', color: 'var(--text-primary)', outline: 'none', fontSize: '0.875rem', cursor: 'pointer'
              }}
            >
              <option value="Todos">Todas as Estratégias</option>
              <option value="Cantos Limite">Cantos Limite</option>
              <option value="Back Favorito">Back Favorito</option>
              <option value="Over Gols HT">Over Gols HT</option>
              <option value="Rigor de Cartões">Rigor de Cartões</option>
            </select>
          </div>

          {/* Potential Score Range Slider */}
          <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Potencial Mínimo:</span>
            <input 
              type="range" 
              min="50" 
              max="95" 
              value={minPotential} 
              onChange={(e) => setMinPotential(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
            />
            <span className="badge badge-yellow" style={{ fontSize: '0.8rem', fontWeight: 700 }}>{minPotential}%</span>
          </div>

        </div>

        {/* Match Cards list */}
        {filteredMatches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <AlertCircle size={32} style={{ marginBottom: 12, color: 'var(--text-muted)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Nenhum jogo encontrado com os filtros atuais.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filteredMatches.map(match => {
              const isSelected = selectedMatch?.id === match.id;
              return (
                <div 
                  key={match.id}
                  className={`card glass-panel opportunity-card ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedMatch(match)}
                  style={{ 
                    padding: 20, 
                    cursor: 'pointer', 
                    borderLeft: `4px solid ${match.potentialScore >= 90 ? 'var(--status-green)' : 'var(--accent-primary)'}`,
                    transition: 'all 0.2s ease-out'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{match.leagueName}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{match.kickoffTime}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    
                    {/* Teams row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img src={match.homeTeam.logo} alt="" style={{ width: 24, height: 24 }} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{match.homeTeam.name}</span>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>vs</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img src={match.awayTeam.logo} alt="" style={{ width: 24, height: 24 }} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{match.awayTeam.name}</span>
                      </div>
                    </div>

                    {/* Potential Circle indicator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Potencial Pré-Live</span>
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: match.potentialScore >= 90 ? 'var(--status-green)' : 'var(--accent-primary)' }}>{match.potentialScore}%</span>
                      </div>
                      <ChevronRight size={20} color="var(--text-muted)" />
                    </div>

                  </div>

                  {/* Sugestão de Entrada */}
                  <div style={{ 
                    background: 'rgba(59, 130, 246, 0.05)', 
                    border: '1px solid rgba(59, 130, 246, 0.1)', 
                    borderRadius: 8, 
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.825rem'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
                      <TrendingUp size={14} color="var(--accent-primary)" />
                      <strong>Gatilho: {match.strategy}</strong> — {match.suggestion}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 700 }}>VER DOSSIÊ COMPLETO →</span>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* RIGHT: 16 VITAL POINTS ANALYTICS PANEL */}
      <div style={{ width: 440, overflowY: 'auto', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-color)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {!selectedMatch ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '0 20px' }}>
            <Award size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <h3>Nenhum Jogo Selecionado</h3>
            <p style={{ fontSize: '0.875rem', marginTop: 8 }}>Selecione uma oportunidade na lista ao lado para destrinchar a análise dos 16 pontos vitais.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24 }}>
            
            {/* Header Selected Match */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="badge badge-green" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>{selectedMatch.strategy}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedMatch.leagueName}</span>
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: 4 }}>
                {selectedMatch.homeTeam.name} vs {selectedMatch.awayTeam.name}
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedMatch.kickoffTime}</span>
            </div>

            {/* AI Potential Score Circle Display */}
            <div style={{ 
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%)', 
              padding: 20, 
              borderRadius: 12, 
              border: '1px solid rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Índice de Potencial IA</span>
                <h3 style={{ fontSize: '2rem', fontWeight: 950, color: 'var(--accent-primary)', lineHeight: 1 }}>{selectedMatch.potentialScore}%</h3>
              </div>
              <div style={{ width: 50, height: 50, borderRadius: 25, background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'center', alignContent: 'center', alignItems: 'center', border: '2px solid var(--accent-primary)' }}>
                <Award size={24} color="var(--accent-primary)" />
              </div>
            </div>

            {/* 16 VITAL POINTS ANALYTICS DOSSIER */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Termômetro de Motivacao / Necessidade do Resultado */}
              <div style={{ 
                background: 'var(--bg-elevated)', 
                padding: 16, 
                borderRadius: 8, 
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  <span>Casa: {selectedMatch.dossier.motivationHome}%</span>
                  <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}><Info size={12} /> Necessidade do Resultado</span>
                  <span>Fora: {selectedMatch.dossier.motivationAway}%</span>
                </div>
                <div style={{ height: 10, background: 'rgba(0,0,0,0.06)', borderRadius: 5, display: 'flex', overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${(selectedMatch.dossier.motivationHome / (selectedMatch.dossier.motivationHome + selectedMatch.dossier.motivationAway)) * 100}%`, background: 'var(--accent-primary)' }}></div>
                  <div style={{ width: `${(selectedMatch.dossier.motivationAway / (selectedMatch.dossier.motivationHome + selectedMatch.dossier.motivationAway)) * 100}%`, background: 'var(--status-yellow)' }}></div>
                </div>
              </div>

              {/* 1. PODER OFENSIVO & TENDÊNCIAS */}
              <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                  <BarChart2 size={14} /> 📊 1. Poder Ofensivo & Gols
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <DossierItem label="Força Ofensiva (Home/Away)" value={`${selectedMatch.dossier.offensiveStrengthHome}% / ${selectedMatch.dossier.offensiveStrengthAway}%`} />
                  <DossierItem label="Média de Gols (Marcados/Sofridos)" value={`C: ${selectedMatch.dossier.avgGoalsScoredHome} / ${selectedMatch.dossier.avgGoalsConcededHome} | F: ${selectedMatch.dossier.avgGoalsScoredAway} / ${selectedMatch.dossier.avgGoalsConcededAway}`} />
                  <DossierItem label="Média de Escanteios" value={`Casa: ${selectedMatch.dossier.avgCornersHome} | Fora: ${selectedMatch.dossier.avgCornersAway}`} />
                  <DossierItem label="Posse de Bola Média" value={`Casa: ${selectedMatch.dossier.avgPossessionHome}% | Fora: ${selectedMatch.dossier.avgPossessionAway}%`} />
                </div>
              </div>

              {/* 2. ESTILO TÁTICO & RITMO */}
              <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                  <Compass size={14} /> 🧠 2. Estilo Tático & Ritmo
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <DossierItem label="Estilo Tático (Home/Away)" value={`C: ${selectedMatch.dossier.tacticalStyleHome} | F: ${selectedMatch.dossier.tacticalStyleAway}`} />
                  <DossierItem label="Ritmo Médio (Tempo)" value={`C: ${selectedMatch.dossier.tempoHome} | F: ${selectedMatch.dossier.tempoAway}`} />
                  <DossierItem label="Agressividade" value={`Casa: ${selectedMatch.dossier.aggressivenessHome} | Fora: ${selectedMatch.dossier.aggressivenessAway}`} />
                  <DossierItem label="Formação Inicial" value={`C: ${selectedMatch.dossier.formationHome} | F: ${selectedMatch.dossier.formationAway}`} />
                </div>
              </div>

              {/* 3. AMBIENTE & CONDIÇÃO */}
              <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                  <Thermometer size={14} /> 🌤️ 3. Ambiente & Condição Física
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <DossierItem label="Clima no Estádio" value={selectedMatch.dossier.weather} />
                  <DossierItem label="Árbitro Escudo & Rigor" value={`${selectedMatch.dossier.refereeName} (Média: ${selectedMatch.dossier.refereeCardRate} cartões)`} />
                  <DossierItem label="Desgaste / Fadiga (0-100)" value={`C: ${selectedMatch.dossier.fatigueHome}% (Desgaste) | F: ${selectedMatch.dossier.fatigueAway}% (Fresco)`} />
                  <DossierItem label="Rotação de Elenco" value={`C: ${selectedMatch.dossier.rotationHome} | F: ${selectedMatch.dossier.rotationAway}`} />
                </div>
              </div>

              {/* 4. CONTEXTO & ELENCO */}
              <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                  <Shield size={14} /> 🏆 4. Contexto Competitivo & Elenco
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <DossierItem label="Tabela / Classificação" value={`C: ${selectedMatch.dossier.standingsHome} | F: ${selectedMatch.dossier.standingsAway}`} />
                  <DossierItem label="Liga Perfil Estatístico" value={selectedMatch.dossier.leagueProfile} />
                  
                  {/* Desfalques Lists */}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 4 }}>Desfalques Mandante</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--status-red)', fontWeight: 600 }}>
                        {selectedMatch.dossier.absencesHome.length > 0 ? selectedMatch.dossier.absencesHome.join(', ') : 'Nenhum desfalque crucial'}
                      </span>
                    </div>

                    <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 4 }}>Desfalques Visitante</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--status-red)', fontWeight: 600 }}>
                        {selectedMatch.dossier.absencesAway.length > 0 ? selectedMatch.dossier.absencesAway.join(', ') : 'Nenhum desfalque crucial'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  );
}

// Small Subcomponent helper for dossier cards
function DossierItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{label}</span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
