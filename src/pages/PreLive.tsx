import { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Calendar, Search, ShieldAlert, Award, Compass, Thermometer,
  BarChart2, Shield, AlertCircle, TrendingUp, Info, ChevronRight, CheckCircle, RefreshCw,
  Radio
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
  dossierLoading?: boolean;
}

/**
 * Determina a estratégia com base nos dados REAIS do dossiê da API.
 * Usa comparison.att, comparison.def, forma recente e médias de gols.
 */
function determineStrategy(dossier: PreMatchDossier): {
  strategy: PreLiveMatch['strategy'];
  suggestion: string;
  potentialScore: number;
} {
  const attDiff = Math.abs(dossier.offensiveStrengthHome - dossier.offensiveStrengthAway);
  const totalGoalsAvg = dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway;
  const motivationDiff = Math.abs(dossier.motivationHome - dossier.motivationAway);
  const maxMotivation = Math.max(dossier.motivationHome, dossier.motivationAway);

  // Calcula potentialScore com base em dados reais
  // Usa a soma das probabilidades máximas como indicador de confiança
  const predictionConfidence = maxMotivation; // win% da API
  const offensiveTotal = dossier.offensiveStrengthHome + dossier.offensiveStrengthAway;
  const potentialScore = Math.min(99, Math.max(50, Math.round(
    predictionConfidence * 0.5 + (offensiveTotal / 2) * 0.3 + totalGoalsAvg * 5
  )));

  // Estratégia baseada em dados reais
  if (totalGoalsAvg >= 2.5) {
    return {
      strategy: 'Over Gols HT',
      suggestion: `Média de gols combinada: ${totalGoalsAvg.toFixed(1)} — tendência de jogo aberto.`,
      potentialScore
    };
  }

  if (motivationDiff >= 20 && maxMotivation >= 50) {
    const favorito = dossier.motivationHome > dossier.motivationAway ? 'mandante' : 'visitante';
    return {
      strategy: 'Back Favorito',
      suggestion: `Probabilidade API: ${dossier.motivationHome}% x ${dossier.motivationAway}% — ${favorito} favorito.`,
      potentialScore
    };
  }

  if (attDiff >= 15) {
    return {
      strategy: 'Cantos Limite',
      suggestion: `Força ofensiva: ${dossier.offensiveStrengthHome}% x ${dossier.offensiveStrengthAway}% — desequilíbrio pode gerar escanteios.`,
      potentialScore
    };
  }

  return {
    strategy: 'Rigor de Cartões',
    suggestion: `Jogo equilibrado (${dossier.motivationHome}% x ${dossier.motivationAway}%) — possível disputa intensa.`,
    potentialScore
  };
}

/**
 * Utilitário para exibir um valor do dossiê.
 * Retorna "—" para valores vazios, 0, ou "Sem dados da API".
 */
function displayValue(value: string | number, suffix?: string): string {
  if (value === '' || value === 'Sem dados da API' || value === 0 || value === '0') {
    return '—';
  }
  return suffix ? `${value}${suffix}` : String(value);
}

/** Verifica se um campo do dossiê tem dados reais */
function hasData(value: string | number): boolean {
  return value !== '' && value !== 'Sem dados da API' && value !== 0 && value !== '0';
}

export default function PreLive() {
  const [matches, setMatches] = useState<PreLiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<PreLiveMatch | null>(null);
  const [minPotential, setMinPotential] = useState(50);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingDossiers, setLoadingDossiers] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [dataSource, setDataSource] = useState<'real' | 'empty'>('empty');
  
  // Custom Date Selection: today or tomorrow
  const [selectedDate, setSelectedDate] = useState<'today' | 'tomorrow'>('today');
  
  // API key configuration
  const [apiKeyInput, setApiKeyInput] = useState(localStorage.getItem('api_sports_key') || '');
  const [showKeyConfig, setShowKeyConfig] = useState(false);

  // Helper para delay entre chamadas (rate limiting)
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Load upcoming real games based on selected date
  const loadRealGames = useCallback(async () => {
    setIsLoading(true);
    setLoadingDossiers(false);
    setLoadingProgress({ current: 0, total: 0 });
    try {
      const getLocalDateString = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const todayStr = getLocalDateString(new Date());
      const tomorrowStr = getLocalDateString(new Date(new Date().setDate(new Date().getDate() + 1)));
      const targetStr = selectedDate === 'today' ? todayStr : tomorrowStr;

      const res = await apiSports.getUpcomingFixtures(targetStr);
      if (res.fixtures && res.fixtures.length > 0 && !res.isMock) {
        // Fase 1: Montar partidas com dossiê vazio (exibir imediatamente)
        const emptyDossier: PreMatchDossier = {
          fixtureId: 0,
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

        const initialMatches: PreLiveMatch[] = res.fixtures.map((f) => ({
          id: f.id,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          leagueName: f.leagueName || 'Liga Internacional',
          kickoffTime: f.kickoffTime || 'Hoje',
          potentialScore: 0,
          strategy: 'Back Favorito' as const,
          suggestion: 'Carregando dossiê da API...',
          dossier: { ...emptyDossier, fixtureId: f.id },
          dossierLoading: true
        }));

        setMatches(initialMatches);
        setDataSource('real');
        setIsLoading(false);

        // Fase 2: Buscar dossiês reais em batch com rate limiting (300ms entre cada)
        setLoadingDossiers(true);
        setLoadingProgress({ current: 0, total: res.fixtures.length });

        for (let i = 0; i < res.fixtures.length; i++) {
          const f = res.fixtures[i];
          try {
            const { dossier } = await apiSports.getPreMatchDossier(f.id);
            const { strategy, suggestion, potentialScore } = determineStrategy(dossier);

            setMatches(prev => prev.map(m => 
              m.id === f.id 
                ? { ...m, dossier, strategy, suggestion, potentialScore, dossierLoading: false }
                : m
            ));
            
            // Atualizar selectedMatch se for o mesmo
            setSelectedMatch(prev => 
              prev?.id === f.id 
                ? { ...prev, dossier, strategy, suggestion, potentialScore, dossierLoading: false }
                : prev
            );
          } catch (err) {
            console.error(`Erro ao buscar dossiê para fixture ${f.id}:`, err);
            setMatches(prev => prev.map(m => 
              m.id === f.id ? { ...m, dossierLoading: false } : m
            ));
          }
          setLoadingProgress({ current: i + 1, total: res.fixtures.length });
          
          // Rate limit: 300ms entre chamadas para não exceder limites da API
          if (i < res.fixtures.length - 1) {
            await delay(300);
          }
        }
        setLoadingDossiers(false);
      } else {
        // Sem jogos disponíveis
        setMatches([]);
        setDataSource('empty');
      }
    } catch (e) {
      console.error("Erro ao buscar jogos pré-live:", e);
      setMatches([]);
      setDataSource('empty');
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadRealGames();
  }, [loadRealGames]);

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
              Análise estatística preditiva com dados reais da API-Sports — sem dados fabricados.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(isLoading || loadingDossiers) && (
              <span className="badge" style={{ background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                <RefreshCw size={12} className="pulse-indicator" style={{ animation: 'spin 2s linear infinite' }} />
                {loadingDossiers 
                  ? `Dossiês: ${loadingProgress.current}/${loadingProgress.total}`
                  : 'Carregando jogos...'
                }
              </span>
            )}
            {dataSource === 'real' ? (
              <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
                <CheckCircle size={12} /> 📡 API-Sports Real-Time
              </span>
            ) : (
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                <AlertCircle size={12} /> Aguardando dados...
              </span>
            )}
          </div>
        </div>

        {/* API Key configuration banner */}
        <div className="card glass-panel" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(245, 158, 11, 0.03)', border: '1px dashed var(--status-yellow)', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowKeyConfig(!showKeyConfig)}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={16} color="var(--status-yellow)" />
              {dataSource === 'empty' 
                ? 'Nenhum jogo encontrado ou cota esgotada. Clique para gerenciar sua chave API-Sports.' 
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
              min="0" 
              max="95" 
              value={minPotential} 
              onChange={(e) => setMinPotential(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
            />
            <span className="badge badge-yellow" style={{ fontSize: '0.8rem', fontWeight: 700 }}>{minPotential}%</span>
          </div>

        </div>

        {/* Match Cards list */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <RefreshCw size={32} style={{ marginBottom: 12, color: 'var(--accent-primary)', animation: 'spin 2s linear infinite' }} />
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Buscando jogos reais na API-Sports...</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>Sem dados fabricados — apenas jogos reais</p>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <AlertCircle size={32} style={{ marginBottom: 12, color: 'var(--text-muted)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Nenhum jogo encontrado com os filtros atuais.</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>Tente ajustar os filtros ou verificar outra data.</p>
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
                    borderLeft: `4px solid ${match.dossierLoading ? 'var(--text-muted)' : match.potentialScore >= 80 ? 'var(--status-green)' : 'var(--accent-primary)'}`,
                    transition: 'all 0.2s ease-out',
                    opacity: match.dossierLoading ? 0.7 : 1
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{match.leagueName}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {match.dossier.hasPredictions && (
                        <span style={{ fontSize: '0.6rem', color: 'var(--status-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Radio size={8} /> API
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{match.kickoffTime}</span>
                    </div>
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
                        {match.dossierLoading ? (
                          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)' }}>...</span>
                        ) : (
                          <span style={{ fontSize: '1.2rem', fontWeight: 900, color: match.potentialScore >= 80 ? 'var(--status-green)' : 'var(--accent-primary)' }}>{match.potentialScore}%</span>
                        )}
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
                    {match.dossierLoading ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                        <RefreshCw size={14} style={{ animation: 'spin 2s linear infinite' }} />
                        Carregando análise da API...
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
                        <TrendingUp size={14} color="var(--accent-primary)" />
                        <strong>Gatilho: {match.strategy}</strong> — {match.suggestion}
                      </span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 700 }}>VER DOSSIÊ →</span>
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
            <p style={{ fontSize: '0.875rem', marginTop: 8 }}>Selecione uma oportunidade na lista ao lado para ver a análise dos 16 pontos vitais com dados reais da API.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24 }}>
            
            {/* Header Selected Match */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="badge badge-green" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>{selectedMatch.strategy}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedMatch.leagueName}</span>
                {selectedMatch.dossier.hasPredictions && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--status-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                    📡 API-Sports
                  </span>
                )}
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: 4 }}>
                {selectedMatch.homeTeam.name} vs {selectedMatch.awayTeam.name}
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedMatch.kickoffTime}</span>
            </div>

            {/* Loading state for dossier */}
            {selectedMatch.dossierLoading ? (
              <div style={{ 
                background: 'var(--bg-elevated)', 
                padding: 40, 
                borderRadius: 12, 
                border: '1px solid var(--border-color)',
                textAlign: 'center'
              }}>
                <RefreshCw size={28} style={{ marginBottom: 12, color: 'var(--accent-primary)', animation: 'spin 2s linear infinite' }} />
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Carregando dossiê da API...</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>Buscando predições reais</p>
              </div>
            ) : (
              <>
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
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Índice de Potencial (dados reais)</span>
                    <h3 style={{ fontSize: '2rem', fontWeight: 950, color: 'var(--accent-primary)', lineHeight: 1 }}>{selectedMatch.potentialScore}%</h3>
                  </div>
                  <div style={{ width: 50, height: 50, borderRadius: 25, background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'center', alignContent: 'center', alignItems: 'center', border: '2px solid var(--accent-primary)' }}>
                    <Award size={24} color="var(--accent-primary)" />
                  </div>
                </div>

                {/* Predictions unavailable warning */}
                {!selectedMatch.dossier.hasPredictions && (
                  <div style={{ 
                    background: 'rgba(245, 158, 11, 0.05)', 
                    border: '1px solid rgba(245, 158, 11, 0.2)', 
                    borderRadius: 8, 
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.8rem',
                    color: 'var(--status-yellow)'
                  }}>
                    <AlertCircle size={16} />
                    <span>Predições da API indisponíveis para esta partida. Os dados abaixo podem estar incompletos.</span>
                  </div>
                )}

                {/* 16 VITAL POINTS ANALYTICS DOSSIER */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  
                  {/* Termômetro de Motivação / Probabilidades da API */}
                  {(selectedMatch.dossier.motivationHome > 0 || selectedMatch.dossier.motivationAway > 0) ? (
                    <div style={{ 
                      background: 'var(--bg-elevated)', 
                      padding: 16, 
                      borderRadius: 8, 
                      border: '1px solid var(--border-color)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        <span>Casa: {selectedMatch.dossier.motivationHome}%</span>
                        <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}><Info size={12} /> Probabilidade de Vitória (API)</span>
                        <span>Fora: {selectedMatch.dossier.motivationAway}%</span>
                      </div>
                      <div style={{ height: 10, background: 'rgba(0,0,0,0.06)', borderRadius: 5, display: 'flex', overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{ width: `${(selectedMatch.dossier.motivationHome / Math.max(1, selectedMatch.dossier.motivationHome + selectedMatch.dossier.motivationAway)) * 100}%`, background: 'var(--accent-primary)' }}></div>
                        <div style={{ width: `${(selectedMatch.dossier.motivationAway / Math.max(1, selectedMatch.dossier.motivationHome + selectedMatch.dossier.motivationAway)) * 100}%`, background: 'var(--status-yellow)' }}></div>
                      </div>
                    </div>
                  ) : (
                    <DossierItemUnavailable label="Probabilidade de Vitória" />
                  )}

                  {/* 1. PODER OFENSIVO & TENDÊNCIAS */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                      <BarChart2 size={14} /> 📊 1. Poder Ofensivo & Gols
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(hasData(selectedMatch.dossier.offensiveStrengthHome) || hasData(selectedMatch.dossier.offensiveStrengthAway)) ? (
                        <DossierItem label="Força Ofensiva (Home/Away)" value={`${displayValue(selectedMatch.dossier.offensiveStrengthHome, '%')} / ${displayValue(selectedMatch.dossier.offensiveStrengthAway, '%')}`} fromApi />
                      ) : (
                        <DossierItemUnavailable label="Força Ofensiva" />
                      )}
                      
                      {(hasData(selectedMatch.dossier.avgGoalsScoredHome) || hasData(selectedMatch.dossier.avgGoalsScoredAway)) ? (
                        <DossierItem label="Média de Gols (Marcados/Sofridos)" value={`C: ${displayValue(selectedMatch.dossier.avgGoalsScoredHome)} / ${displayValue(selectedMatch.dossier.avgGoalsConcededHome)} | F: ${displayValue(selectedMatch.dossier.avgGoalsScoredAway)} / ${displayValue(selectedMatch.dossier.avgGoalsConcededAway)}`} fromApi />
                      ) : (
                        <DossierItemUnavailable label="Média de Gols" />
                      )}
                      
                      {/* Escanteios: API não fornece */}
                      <DossierItemUnavailable label="Média de Escanteios" detail="API não fornece neste endpoint" />
                      
                      {(hasData(selectedMatch.dossier.avgPossessionHome) || hasData(selectedMatch.dossier.avgPossessionAway)) ? (
                        <DossierItem label="Distribuição Poisson (Home/Away)" value={`Casa: ${displayValue(selectedMatch.dossier.avgPossessionHome, '%')} | Fora: ${displayValue(selectedMatch.dossier.avgPossessionAway, '%')}`} fromApi />
                      ) : (
                        <DossierItemUnavailable label="Distribuição Poisson" />
                      )}
                    </div>
                  </div>

                  {/* Forma Recente */}
                  {((selectedMatch.dossier.formHome && selectedMatch.dossier.formHome.length > 0) || (selectedMatch.dossier.formAway && selectedMatch.dossier.formAway.length > 0)) && (
                    <div>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                        📈 Forma Recente (Últimos 5 Jogos)
                      </h4>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 6 }}>Mandante</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(selectedMatch.dossier.formHome || []).map((r, i) => (
                              <span key={i} style={{
                                width: 24, height: 24, borderRadius: 4,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.7rem', fontWeight: 800,
                                background: r === 'W' ? 'rgba(16, 185, 129, 0.2)' : r === 'L' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                color: r === 'W' ? 'var(--status-green)' : r === 'L' ? 'var(--status-red)' : 'var(--status-yellow)'
                              }}>{r}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 6 }}>Visitante</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(selectedMatch.dossier.formAway || []).map((r, i) => (
                              <span key={i} style={{
                                width: 24, height: 24, borderRadius: 4,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.7rem', fontWeight: 800,
                                background: r === 'W' ? 'rgba(16, 185, 129, 0.2)' : r === 'L' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                color: r === 'W' ? 'var(--status-green)' : r === 'L' ? 'var(--status-red)' : 'var(--status-yellow)'
                              }}>{r}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2. ESTILO TÁTICO & RITMO */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                      <Compass size={14} /> 🧠 2. Estilo Tático & Ritmo
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {hasData(selectedMatch.dossier.tacticalStyleHome) ? (
                        <DossierItem label="Análise da API (Comentário)" value={selectedMatch.dossier.tacticalStyleHome} fromApi />
                      ) : (
                        <DossierItemUnavailable label="Análise Tática" detail="API não fornece análise detalhada" />
                      )}
                      
                      {(hasData(selectedMatch.dossier.tempoHome) || hasData(selectedMatch.dossier.tempoAway)) ? (
                        <DossierItem label="Probabilidades (Win%)" value={`C: ${displayValue(selectedMatch.dossier.tempoHome)} | F: ${displayValue(selectedMatch.dossier.tempoAway)}`} fromApi />
                      ) : (
                        <DossierItemUnavailable label="Probabilidades" />
                      )}
                      
                      {/* Agressividade: API não fornece */}
                      <DossierItemUnavailable label="Agressividade" detail="API não fornece neste endpoint" />
                      
                      {/* Formação: API não fornece */}
                      <DossierItemUnavailable label="Formação Inicial" detail="API não fornece neste endpoint" />
                    </div>
                  </div>

                  {/* 3. AMBIENTE & CONDIÇÃO */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                      <Thermometer size={14} /> 🌤️ 3. Ambiente & Condição Física
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Todos os campos desta seção NÃO são fornecidos pela API */}
                      <DossierItemUnavailable label="Clima no Estádio" detail="API não fornece neste endpoint" />
                      <DossierItemUnavailable label="Árbitro & Rigor" detail="API não fornece neste endpoint" />
                      <DossierItemUnavailable label="Desgaste / Fadiga" detail="API não fornece neste endpoint" />
                      <DossierItemUnavailable label="Rotação de Elenco" detail="API não fornece neste endpoint" />
                    </div>
                  </div>

                  {/* 4. CONTEXTO & ELENCO */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                      <Shield size={14} /> 🏆 4. Contexto Competitivo & Elenco
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Classificação: API não fornece neste endpoint */}
                      <DossierItemUnavailable label="Tabela / Classificação" detail="API não fornece neste endpoint" />
                      
                      {/* Liga: API não fornece perfil */}
                      <DossierItemUnavailable label="Liga Perfil Estatístico" detail="API não fornece neste endpoint" />
                      
                      {/* Desfalques */}
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 4 }}>Desfalques Mandante</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontStyle: 'italic' }}>
                            API não fornece dados de lesões neste endpoint
                          </span>
                        </div>

                        <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, marginBottom: 4 }}>Desfalques Visitante</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontStyle: 'italic' }}>
                            API não fornece dados de lesões neste endpoint
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </>
            )}

          </div>
        )}

      </div>

    </div>
  );
}

/** Componente para itens do dossiê com dados disponíveis */
function DossierItem({ label, value, fromApi }: { label: string; value: string; fromApi?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
        {fromApi && (
          <span style={{ fontSize: '0.55rem', color: 'var(--status-green)', fontWeight: 700, background: 'rgba(16, 185, 129, 0.1)', padding: '1px 5px', borderRadius: 3 }}>
            ✅ API
          </span>
        )}
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/** Componente para itens do dossiê SEM dados disponíveis — exibe estado elegante de indisponibilidade */
function DossierItemUnavailable({ label, detail }: { label: string; detail?: string }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px dashed var(--border-color)', opacity: 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontWeight: 600, background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 3 }}>
          Indisponível
        </span>
      </div>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        {detail || '—'}
      </span>
    </div>
  );
}
