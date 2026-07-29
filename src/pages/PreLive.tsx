import { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Calendar, Search, Award,
  Info, ChevronRight, CheckCircle, RefreshCw,
  Star, Flame
} from 'lucide-react';
import { supabase } from '../services/supabase';

interface BCSPreLiveMatch {
  id: string;
  created_at: string;
  date: string;
  home_team: string;
  away_team: string;
  league: string;
  match_time: string;
  
  ht_avg: number | null;
  ht_limit_rate: number | null;
  home_ht_limit_rate: number | null;
  away_ht_limit_rate: number | null;
  ht_limit_avg: number | null;
  
  ft_avg: number | null;
  ft_limit_rate: number | null;
  home_ft_limit_rate: number | null;
  away_ft_limit_rate: number | null;
  ft_limit_avg: number | null;
  
  is_top_ht: boolean;
  is_top_ft: boolean;
  top_ht_rate: number | null;
  top_ft_rate: number | null;
  
  // Médias individuais por time
  home_team_avg_corners_ht: number | null;
  away_team_avg_corners_ht: number | null;
  home_team_avg_corners_ft: number | null;
  away_team_avg_corners_ft: number | null;
}

export default function PreLive() {
  const [matches, setMatches] = useState<BCSPreLiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<BCSPreLiveMatch | null>(null);
  const [minPotential, setMinPotential] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDateMode, setSelectedDateMode] = useState<'today' | 'tomorrow' | 'all'>('today');

  // Load games from Supabase
  const loadGames = useCallback(async () => {
    setIsLoading(true);
    try {
      const getLocalDateString = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const now = new Date();
      const todayStr = getLocalDateString(now);
      
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = getLocalDateString(tomorrowDate);

      console.log(`[PreLive] Consultando bestcorner_prelive_stats (modo: ${selectedDateMode})`);
      
      let query = supabase.from('bestcorner_prelive_stats').select('*');
      if (selectedDateMode === 'today') {
        query = query.eq('date', todayStr);
      } else if (selectedDateMode === 'tomorrow') {
        query = query.eq('date', tomorrowStr);
      } else {
        query = query.gte('date', todayStr);
      }

      const { data, error } = await query
        .order('date', { ascending: true })
        .order('match_time', { ascending: true });

      if (error) {
        console.error('[PreLive] Erro Supabase:', error);
        throw error;
      }

      const rows = data || [];
      console.log(`[PreLive] ${rows.length} jogos encontrados.`, rows);
      setMatches(rows);
      
      // Update selected match if it still exists
      setSelectedMatch(prev => {
        if (!prev) return null;
        const updated = rows.find(m => m.id === prev.id);
        return updated || null;
      });
    } catch (e) {
      console.error("Erro ao buscar jogos pré-live no Supabase:", e);
      setMatches([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDateMode]);

  useEffect(() => {
    loadGames();

    // Limpeza automática: apagar registros com mais de 3 dias
    const cleanupOldData = async () => {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 3);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const { error } = await supabase
          .from('bestcorner_prelive_stats')
          .delete()
          .lt('date', cutoffStr);

        if (error) {
          console.warn('[PreLive] Erro na limpeza automática:', error);
        } else {
          console.log(`[PreLive] Limpeza: registros anteriores a ${cutoffStr} removidos.`);
        }
      } catch (e) {
        console.warn('[PreLive] Erro na limpeza:', e);
      }
    };
    cleanupOldData();
  }, [loadGames]);

  // ═══════════════════════════════════════════════════════════════════
  // SCORING COMPOSTO: 60% Taxa + 30% Média + 10% Bônus TOP
  // ═══════════════════════════════════════════════════════════════════
  const getMatchCalculatedStats = useCallback((match: BCSPreLiveMatch) => {
    const htRate = match.top_ht_rate || match.ht_limit_rate || 0;
    const ftRate = match.top_ft_rate || match.ft_limit_rate || 0;
    const bestRate = Math.max(htRate, ftRate);
    const isTop = match.is_top_ht || match.is_top_ft;

    // Nota da Taxa (0-100): mapeia 40-100% → 0-100, abaixo de 40% = 0
    const notaTaxa = bestRate > 0 ? Math.min(100, Math.max(0, (bestRate - 40) * 1.67)) : 0;
    const hasTaxa = bestRate > 0;

    // Nota da Média (0-100)
    // HT: ×14 (média 7+ → 100)  |  FT: ×8 (média 12+ → 100)
    const htAvg = match.ht_avg || 0;
    const ftAvg = match.ft_avg || 0;
    const notaMediaHT = htAvg > 0 ? Math.min(100, htAvg * 14) : 0;
    const notaMediaFT = ftAvg > 0 ? Math.min(100, ftAvg * 8) : 0;
    const notaMedia = Math.max(notaMediaHT, notaMediaFT);
    const hasMedia = htAvg > 0 || ftAvg > 0;

    // Bônus TOP: +10 pontos se estiver no destaque BCS
    const bonusTop = isTop ? 10 : 0;

    // Calcular score final baseado nos dados disponíveis
    let score = 0;
    if (hasTaxa && hasMedia) {
      // Tem ambos: 60% taxa + 30% média + 10% bônus
      score = (notaTaxa * 0.6) + (notaMedia * 0.3) + bonusTop;
    } else if (hasTaxa) {
      // Só taxa: 90% taxa + 10% bônus
      score = (notaTaxa * 0.9) + bonusTop;
    } else if (hasMedia) {
      // Só média: 90% média + 10% bônus
      score = (notaMedia * 0.9) + bonusTop;
    }
    // Sem dados = 0

    const potential = Math.round(Math.min(100, Math.max(0, score)));

    // Classificação visual
    let label = 'Sem dados';
    if (potential >= 80) label = 'Excelente';
    else if (potential >= 60) label = 'Bom';
    else if (potential >= 40) label = 'Moderado';
    else if (potential > 0) label = 'Fraco';

    // Estratégia recomendada
    const strategy = htRate >= ftRate ? 'Limite HT' : 'Limite FT';

    // Sugestão descritiva
    const parts: string[] = [];
    if (bestRate > 0) parts.push(`Taxa ${bestRate}%`);
    if (htAvg > 0) parts.push(`Média HT ${htAvg}`);
    if (ftAvg > 0) parts.push(`Média FT ${ftAvg}`);
    if (isTop) parts.push('Destaque BCS');
    const suggestion = parts.length > 0 ? parts.join(' · ') : 'Sem dados suficientes';

    return { potential, strategy, suggestion, label };
  }, []);

  // Lista unificada: TODOS os jogos sincronizados
  const allMatchesWithRate = useMemo(() => {
    return matches.filter(m => {
      const matchesSearch = 
        m.home_team.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.away_team.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.league || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    }).sort((a, b) => {
      const scoreA = getMatchCalculatedStats(a).potential;
      const scoreB = getMatchCalculatedStats(b).potential;
      return scoreB - scoreA;
    });
  }, [matches, searchQuery, getMatchCalculatedStats]);

  // Formatar valores nulos de forma limpa
  const displayValue = (val: number | null, suffix = '') => {
    if (val === null || val === undefined) return '—';
    return `${val}${suffix}`;
  };

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
              Análise estatística baseada em inteligência pré-live integrada e dados de cantos limites do BestCorner Stats.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button 
              onClick={loadGames} 
              disabled={isLoading}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={12} className={isLoading ? 'spin-indicator' : ''} style={{ animation: isLoading ? 'spin 1.5s linear infinite' : 'none' }} />
              Atualizar
            </button>
            <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
              <CheckCircle size={12} /> SUPABASE ATIVO
            </span>
          </div>
        </div>

        {/* Informative Banner */}
        <div className="card glass-panel" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(59, 130, 246, 0.03)', border: '1px dashed var(--accent-primary)', borderRadius: 12 }}>
          <Info size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Esses jogos são alimentados via <b>extensão do Chrome</b> e salvos localmente. Use o painel flutuante no BestCorner Stats para sincronizar novas rodadas.
          </span>
        </div>

        {/* Advanced Filters Panel */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          
          {/* Date Selector Segment Controls */}
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, padding: 4, border: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setSelectedDateMode('today')}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: selectedDateMode === 'today' ? 'var(--accent-primary)' : 'transparent',
                color: selectedDateMode === 'today' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              Hoje
            </button>
            <button
              onClick={() => setSelectedDateMode('tomorrow')}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: selectedDateMode === 'tomorrow' ? 'var(--accent-primary)' : 'transparent',
                color: selectedDateMode === 'tomorrow' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              Amanhã
            </button>
            <button
              onClick={() => setSelectedDateMode('all')}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: selectedDateMode === 'all' ? 'var(--accent-primary)' : 'transparent',
                color: selectedDateMode === 'all' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              Todas as Datas
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

        {/* ═══════ SEÇÃO 1: DESTAQUES TOP 10 ═══════ */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <RefreshCw size={32} style={{ marginBottom: 12, color: 'var(--accent-primary)', animation: 'spin 2s linear infinite' }} />
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Buscando jogos no Supabase...</p>
          </div>
        ) : (
          <>
            {/* ═══════ RESUMO DIÁRIO ═══════ */}
            {allMatchesWithRate.length > 0 && (() => {
              const counts = { excellent: 0, good: 0, moderate: 0, weak: 0, noData: 0 };
              allMatchesWithRate.forEach(m => {
                const s = getMatchCalculatedStats(m).potential;
                if (s >= 80) counts.excellent++;
                else if (s >= 60) counts.good++;
                else if (s >= 40) counts.moderate++;
                else if (s > 0) counts.weak++;
                else counts.noData++;
              });
              const recommended = counts.excellent + counts.good;
              const summaryCards = [
                { label: 'Excelente', count: counts.excellent, color: '#22c55e', sub: '80+' },
                { label: 'Bom', count: counts.good, color: '#f59e0b', sub: '60-79' },
                { label: 'Moderado', count: counts.moderate, color: '#3b82f6', sub: '40-59' },
                { label: 'Fraco', count: counts.weak, color: '#64748b', sub: '0-39' },
              ];
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
                    {summaryCards.map(c => (
                      <div key={c.label} className="card glass-panel" style={{ 
                        padding: '14px 12px', textAlign: 'center',
                        borderTop: `3px solid ${c.color}`
                      }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: c.color, lineHeight: 1 }}>{c.count}</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{c.label}</div>
                        <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>Score {c.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ 
                    background: recommended > 0 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(100, 116, 139, 0.08)',
                    border: `1px solid ${recommended > 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)'}`,
                    borderRadius: 8, padding: '10px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: '0.8rem'
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                      <strong style={{ color: recommended > 0 ? '#22c55e' : 'var(--text-muted)' }}>{recommended}</strong> jogos recomendados para entrada (score 60+)
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      {allMatchesWithRate.length} total
                    </span>
                  </div>
                </div>
              );
            })()}
            {/* LISTA UNIFICADA DE JOGOS */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  <Flame size={18} color="var(--status-yellow)" /> Jogos Classificados
                  <span style={{ background: 'var(--accent-primary)', color: '#fff', padding: '2px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800 }}>{allMatchesWithRate.length}</span>
                </h3>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ordenado por score composto</span>
              </div>

              {allMatchesWithRate.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                  Nenhum jogo sincronizado para este dia.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allMatchesWithRate.map(match => {
                    const isSelected = selectedMatch?.id === match.id;
                    const { potential: matchScore, label: matchLabel } = getMatchCalculatedStats(match);
                    const scoreColor = matchScore >= 80 ? '#22c55e' : matchScore >= 60 ? '#f59e0b' : matchScore >= 40 ? '#3b82f6' : '#64748b';
                    const isTop = match.is_top_ht || match.is_top_ft;
                    return (
                      <div
                        key={match.id}
                        onClick={() => setSelectedMatch(match)}
                        className={`card glass-panel ${isSelected ? 'active' : ''}`}
                        style={{
                          padding: '12px 18px',
                          cursor: 'pointer',
                          borderLeft: `4px solid ${scoreColor}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'all 0.15s ease',
                          background: isSelected ? 'rgba(59, 130, 246, 0.06)' : undefined
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{match.home_team}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>x</span>
                            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{match.away_team}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            <span>{match.league || '—'}</span>
                            {match.match_time && <><span>|</span><span>{match.match_time}</span></>}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {isTop && (
                            <span style={{ fontSize: '0.6rem', color: '#fff', background: 'var(--status-yellow)', fontWeight: 800, padding: '2px 6px', borderRadius: 4 }}>
                              {match.is_top_ht ? 'TOP HT' : 'TOP FT'}
                            </span>
                          )}
                          {match.ht_avg !== null && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                              HT: {match.ht_avg}
                            </span>
                          )}
                          {match.ft_avg !== null && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(16,185,129,0.1)', color: 'var(--status-green)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                              FT: {match.ft_avg}
                            </span>
                          )}
                          <div style={{
                            background: scoreColor,
                            color: '#fff',
                            fontWeight: 900,
                            fontSize: '0.85rem',
                            padding: '4px 10px',
                            borderRadius: 8,
                            minWidth: 48,
                            textAlign: 'center',
                            lineHeight: 1.2
                          }}>
                            <div style={{ fontSize: '1rem' }}>{matchScore}</div>
                            <div style={{ fontSize: '0.5rem', fontWeight: 600, opacity: 0.85 }}>{matchLabel}</div>
                          </div>
                          <ChevronRight size={16} color="var(--text-muted)" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* RIGHT: BCS STATISTICS DOSSIER */}
      <div style={{ width: 440, overflowY: 'auto', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-color)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {!selectedMatch ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '0 20px' }}>
            <Award size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <h3>Nenhum Jogo Selecionado</h3>
            <p style={{ fontSize: '0.875rem', marginTop: 8 }}>Selecione um confronto na lista para visualizar o dossiê estatístico de escanteios HT e FT extraído do BestCorner.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24 }}>
            
            {/* Header Selected Match */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="badge badge-green" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>{selectedMatch.league || 'Liga Geral'}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedMatch.match_time || '—'}</span>
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: 4 }}>
                {selectedMatch.home_team} vs {selectedMatch.away_team}
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Data: {selectedMatch.date}</span>
            </div>

            {/* Score Composto */}
            {(() => {
              const stats = getMatchCalculatedStats(selectedMatch);
              const scoreColor = stats.potential >= 80 ? '#22c55e' : stats.potential >= 60 ? '#f59e0b' : stats.potential >= 40 ? '#3b82f6' : '#64748b';
              return (
                <div style={{ 
                  background: `linear-gradient(135deg, ${scoreColor}18 0%, ${scoreColor}08 100%)`, 
                  padding: 20, 
                  borderRadius: 12, 
                  border: `1px solid ${scoreColor}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>Score de Confiança</span>
                    <h3 style={{ fontSize: '2.2rem', fontWeight: 950, color: scoreColor, lineHeight: 1, margin: 0 }}>
                      {stats.potential}
                    </h3>
                    <span style={{ fontSize: '0.7rem', color: scoreColor, fontWeight: 700 }}>{stats.label}</span>
                  </div>
                  <div style={{ textAlign: 'right', maxWidth: '55%' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.4, display: 'block' }}>
                      {stats.suggestion}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Destaque se for TOP */}
            {(selectedMatch.is_top_ht || selectedMatch.is_top_ft) && (
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(217, 119, 6, 0.05) 100%)',
                border: '1px solid rgba(245, 158, 11, 0.25)', 
                borderRadius: 8, 
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: '0.825rem',
                color: 'var(--status-yellow)'
              }}>
                <Star size={18} fill="var(--status-yellow)" style={{ flexShrink: 0 }} />
                <div>
                  <strong style={{ color: 'var(--status-yellow)' }}>Partida Destaque BCS</strong>
                  {selectedMatch.is_top_ht && <span style={{ display: 'block' }}>• Top Técnica Limite HT ({selectedMatch.top_ht_rate}%)</span>}
                  {selectedMatch.is_top_ft && <span style={{ display: 'block' }}>• Top Técnica Limite FT ({selectedMatch.top_ft_rate}%)</span>}
                </div>
              </div>
            )}

            {/* RESUMO SIMPLES: Média HT + Média FT */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <DossierItem label="Média HT" value={displayValue(selectedMatch.ht_avg, ' cantos')} />
              <DossierItem label="Média FT" value={displayValue(selectedMatch.ft_avg, ' cantos')} />
            </div>

          </div>
        )}

      </div>

    </div>
  );
}

interface DossierItemProps {
  label: string;
  value: string;
  highlight?: boolean;
  highlightText?: string;
}

function DossierItem({ label, value, highlight, highlightText }: DossierItemProps) {
  return (
    <div style={{ 
      background: 'var(--bg-elevated)', 
      padding: 12, 
      borderRadius: 8, 
      border: highlight ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border-color)',
      position: 'relative'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
        {highlight && (
          <span style={{ fontSize: '0.6rem', color: '#ffffff', background: 'var(--status-yellow)', fontWeight: 800, padding: '1px 5px', borderRadius: 3 }}>
            {highlightText || 'TOP'}
          </span>
        )}
      </div>
      <span style={{ fontSize: '0.9rem', color: highlight ? 'var(--status-yellow)' : 'var(--text-primary)', fontWeight: 700 }}>{value}</span>
    </div>
  );
}
