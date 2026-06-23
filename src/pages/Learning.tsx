import { useState, useEffect, useCallback } from 'react';
import {
  Brain, TrendingUp, BarChart3, CheckCircle, XCircle, Loader, Sparkles,
  Target, Award, AlertTriangle, Filter, Clock, Eye, ChevronDown,
  BookOpen, RefreshCw, Key, FileText, Download
} from 'lucide-react';
import {
  getTradeEntries, resolveTradeEntry, analyzePatterns, generateGeminiReport,
  getLearningReports, saveLearningReport,
  getGoalLearningEntries, generateGoalGeminiReport,
  type TradeEntry, type TradeOutcome, type LearningReport, type AIRecommendation,
  type GoalLearningEntry
} from '../services/learningEngine';
import { sofascore } from '../services/sofascore';

// ============================================================================
// Tipos auxiliares
// ============================================================================

type TabId = 'entries' | 'analysis' | 'gemini' | 'goal_learning';
type OutcomeFilter = 'ALL' | 'PENDING' | 'green' | 'red';
type MarketFilter = 'ALL' | 'gols' | 'escanteios';

/** Modal de resolução de trade */
interface ResolutionModal {
  entryId: string;
  outcome: TradeOutcome;
  finalGoalsHome: string;
  finalGoalsAway: string;
  finalCornersHome: string;
  finalCornersAway: string;
  profitLoss: string;
  notes: string;
}

// ============================================================================
// Estilos reutilizáveis
// ============================================================================

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  padding: '10px 12px',
  borderRadius: 8,
  outline: 'none',
  fontSize: '0.875rem',
  fontFamily: 'var(--font-sans)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 6,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
  animation: 'fadeIn 0.2s ease-out',
};

// ============================================================================
// Componente: BarChart SVG premium
// ============================================================================

function BarChartSVG({ data, title, color = 'var(--accent-primary)' }: {
  data: Record<string, number>;
  title: string;
  color?: string;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const barWidth = 50;
  const gap = 20;
  const chartWidth = entries.length * (barWidth + gap) - gap + 40;
  const chartHeight = 180;

  return (
    <div style={{ marginBottom: 8 }}>
      <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
        {title}
      </h4>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
        width="100%"
        height={chartHeight + 30}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={`barGrad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Linhas de grade horizontais */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = chartHeight - (pct / 100) * chartHeight;
          return (
            <g key={pct}>
              <line
                x1={20} y1={y} x2={chartWidth} y2={y}
                stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3"
              />
              <text x={16} y={y + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontWeight="500">
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Barras */}
        {entries.map(([label, value], idx) => {
          const x = 20 + idx * (barWidth + gap);
          const barHeight = (value / maxVal) * chartHeight;
          const y = chartHeight - barHeight;

          return (
            <g key={label}>
              <rect
                x={x} y={y} width={barWidth} height={barHeight}
                rx={6} ry={6}
                fill={`url(#barGrad-${title.replace(/\s/g, '')})`}
                style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
              />
              <text
                x={x + barWidth / 2} y={y - 6}
                textAnchor="middle" fontSize="10" fontWeight="800"
                fill={value >= 60 ? 'var(--status-green)' : value >= 40 ? 'var(--status-yellow)' : 'var(--status-red)'}
              >
                {value}%
              </text>
              <text
                x={x + barWidth / 2} y={chartHeight + 16}
                textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontWeight="600"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// Helper: ícone e cor para tipo de recomendação da IA
// ============================================================================

function getRecTypeStyle(type: AIRecommendation['type']): { color: string; label: string } {
  switch (type) {
    case 'avoid': return { color: 'var(--status-red)', label: '🚫 Evitar' };
    case 'prefer': return { color: 'var(--status-green)', label: '✅ Preferir' };
    case 'warning': return { color: 'var(--status-yellow)', label: '⚠️ Atenção' };
    case 'insight':
    default: return { color: 'var(--accent-primary)', label: '💡 Insight' };
  }
}

// ============================================================================
// Componente Principal: Learning
// ============================================================================

export default function Learning() {
  // Estado global da página
  const [activeTab, setActiveTab] = useState<TabId>('entries');
  const [origemFilter, setOrigemFilter] = useState<'manual' | 'automatica'>('manual');
  const [entries, setEntries] = useState<TradeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Tab 1: Entradas — filtros
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [resolutionModal, setResolutionModal] = useState<ResolutionModal | null>(null);

  // Tab 2: Análise
  const [analysis, setAnalysis] = useState<LearningReport | null>(null);

  // Tab 3: Gemini
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState('');
  const [currentReport, setCurrentReport] = useState<LearningReport | null>(null);
  const [reports, setReports] = useState<LearningReport[]>([]);
  const [showReportHistory, setShowReportHistory] = useState(false);

  // Aprendizado de Gols
  const [goalsList, setGoalsList] = useState<GoalLearningEntry[]>([]);
  const [goalGeminiLoading, setGoalGeminiLoading] = useState(false);
  const [goalGeminiError, setGoalGeminiError] = useState('');
  const [currentGoalReport, setCurrentGoalReport] = useState<LearningReport | null>(null);
  const [showGoalReportHistory, setShowGoalReportHistory] = useState(false);

  // ============================================================================
  // Carregamento de dados (todas as funções são async)
  // ============================================================================

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Busca todas as entradas do Supabase com base na origem selecionada
      const allEntries = await getTradeEntries({ origem_aprendizagem: origemFilter });
      setEntries(allEntries);

      // Gera análise local se tiver entradas resolvidas suficientes
      const resolved = allEntries.filter(e => e.outcome === 'green' || e.outcome === 'red');
      if (resolved.length >= 10) {
        setAnalysis(analyzePatterns(allEntries));
      } else {
        setAnalysis(null);
      }

      // Carrega relatórios salvos
      const savedReports = await getLearningReports();
      setReports(savedReports);

      // Carrega momentos dos gols
      const goals = await getGoalLearningEntries();
      setGoalsList(goals);
    } catch (err) {
      console.error('[Learning] Erro ao carregar dados:', err);
    } finally {
      setIsLoading(false);
    }
  }, [origemFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============================================================================
  // Métricas rápidas (Tab 1)
  // ============================================================================

  // Entradas resolvidas (green ou red, exclui void e pendentes)
  const resolved = entries.filter(e => e.outcome === 'green' || e.outcome === 'red');
  const greensCount = entries.filter(e => e.outcome === 'green').length;
  const redsCount = entries.filter(e => e.outcome === 'red').length;
  const pendingCount = entries.filter(e => !e.outcome || e.outcome === 'pending').length;
  const winRate = resolved.length > 0 ? Math.round((greensCount / resolved.length) * 100) : 0;

  // Filtro de entradas para exibição na tabela
  const filteredEntries = entries.filter(e => {
    // Filtro por outcome
    if (outcomeFilter === 'PENDING' && e.outcome && e.outcome !== 'pending') return false;
    if (outcomeFilter === 'green' && e.outcome !== 'green') return false;
    if (outcomeFilter === 'red' && e.outcome !== 'red') return false;
    // Filtro por mercado
    if (marketFilter !== 'ALL' && e.market_type !== marketFilter) return false;
    return true;
  });

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleExportCSV = () => {
    if (entries.length === 0) return;
    
    const allKeys = new Set<string>();
    entries.forEach(entry => Object.keys(entry).forEach(k => allKeys.add(k)));
    const headers = Array.from(allKeys);
    
    let csvContent = headers.join(",") + "\n";
    
    entries.forEach(entry => {
      const row = headers.map(key => {
        const val = (entry as any)[key];
        if (val === null || val === undefined) return '""';
        const strVal = String(val).replace(/"/g, '""');
        return `"${strVal}"`;
      });
      csvContent += row.join(",") + "\n";
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `aprendizagem_${origemFilter}_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  // ============================================================================

  /** Abrir modal de resolução */
  const openResolutionModal = async (entry: TradeEntry, outcome: TradeOutcome) => {
    let initialNotes = entry.notes || '';
    
    setResolutionModal({
      entryId: entry.id!,
      outcome,
      finalGoalsHome: '',
      finalGoalsAway: '',
      finalCornersHome: '',
      finalCornersAway: '',
      profitLoss: '',
      notes: initialNotes,
    });

    // Se temos um ID de partida real da API (número positivo), tentamos buscar os gols do Sofascore
    if (entry.fixture_id && entry.fixture_id > 0) {
      try {
        const incidentsData = await sofascore.getFixtureIncidents(entry.fixture_id);
        if (incidentsData && Array.isArray(incidentsData.incidents)) {
          const postIncGoals = incidentsData.incidents
            .filter((inc: any) => (inc.type === 'goal' || inc.incidentType === 'goal') && inc.time > entry.elapsed)
            .map((inc: any) => `${inc.time}' (${inc.isHome ? 'Mandante' : 'Visitante'})`);
          
          const goalsStr = postIncGoals.length > 0 ? `Gols após entrada: ${postIncGoals.join(', ')}` : 'Gols após entrada: Nenhum';
          
          // Se já não houver a string "Gols após entrada" nas notas, adicionamos
          if (!initialNotes.includes('Gols após entrada')) {
            const separator = initialNotes ? ' | ' : '';
            const updatedNotes = `${initialNotes}${separator}${goalsStr}`;
            setResolutionModal(prev => prev ? { ...prev, notes: updatedNotes } : null);
          }
        }
      } catch (err) {
        console.warn('[Learning] Falha ao obter incidentes para pré-preenchimento:', err);
      }
    }
  };

  /** Confirmar resolução de trade — chama a API com assinatura correta */
  const handleResolve = async () => {
    if (!resolutionModal) return;

    try {
      await resolveTradeEntry(resolutionModal.entryId, resolutionModal.outcome, {
        finalGoalsHome: resolutionModal.finalGoalsHome ? Number(resolutionModal.finalGoalsHome) : undefined,
        finalGoalsAway: resolutionModal.finalGoalsAway ? Number(resolutionModal.finalGoalsAway) : undefined,
        finalCornersHome: resolutionModal.finalCornersHome ? Number(resolutionModal.finalCornersHome) : undefined,
        finalCornersAway: resolutionModal.finalCornersAway ? Number(resolutionModal.finalCornersAway) : undefined,
        profitLoss: resolutionModal.profitLoss ? Number(resolutionModal.profitLoss) : undefined,
        notes: resolutionModal.notes || undefined,
      });

      setResolutionModal(null);
      await loadData();
    } catch (err) {
      console.error('[Learning] Erro ao resolver trade:', err);
    }
  };

  /** Resolução rápida como VOID */
  const handleQuickVoid = async (entryId: string) => {
    try {
      await resolveTradeEntry(entryId, 'void', {});
      await loadData();
    } catch (err) {
      console.error('[Learning] Erro ao marcar void:', err);
    }
  };

  /** Gerar relatório Gemini (a key é lida de localStorage internamente) */
  const handleGenerateReport = async () => {
    if (!geminiKey.trim()) {
      setGeminiError('Insira sua API Key da OpenAI antes de gerar o relatório.');
      return;
    }

    // Salva a key no localStorage para que o service a leia
    localStorage.setItem('openai_api_key', geminiKey);
    setGeminiLoading(true);
    setGeminiError('');

    try {
      // generateGeminiReport lê a key de localStorage internamente
      const report = await generateGeminiReport(entries);
      // Salva o relatório no Supabase
      const savedReport = await saveLearningReport(report);
      setCurrentReport(savedReport);
      // Recarrega relatórios
      const savedReports = await getLearningReports();
      setReports(savedReports);
    } catch (err) {
      setGeminiError((err as Error).message);
    } finally {
      setGeminiLoading(false);
    }
  };

  /** Gerar relatório de gols via ChatGPT */
  const handleGenerateGoalReport = async () => {
    if (!geminiKey.trim()) {
      setGoalGeminiError('Insira sua API Key da OpenAI antes de gerar o relatório.');
      return;
    }

    localStorage.setItem('openai_api_key', geminiKey);
    setGoalGeminiLoading(true);
    setGoalGeminiError('');

    try {
      const report = await generateGoalGeminiReport(goalsList);
      const savedReport = await saveLearningReport(report);
      setCurrentGoalReport(savedReport);
      const savedReports = await getLearningReports();
      setReports(savedReports);
    } catch (err) {
      setGoalGeminiError((err as Error).message);
    } finally {
      setGoalGeminiLoading(false);
    }
  };

  // ============================================================================
  // Renderização
  // ============================================================================

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'entries', label: 'Entradas', icon: <BookOpen size={16} /> },
    { id: 'analysis', label: 'Análise', icon: <BarChart3 size={16} /> },
    { id: 'gemini', label: 'IA ChatGPT', icon: <Brain size={16} /> },
    { id: 'goal_learning', label: 'Aprendizado Gols', icon: <Sparkles size={16} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>

      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Brain size={28} color="var(--accent-primary)" />
            Módulo de Aprendizado
            {isLoading && <RefreshCw size={18} style={{ animation: 'spin 2s linear infinite' }} />}
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Analise padrões e evolua com inteligência artificial.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Botão de Exportar CSV */}
          <button
            onClick={handleExportCSV}
            className="btn"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            disabled={entries.length === 0}
          >
            <Download size={18} /> Exportar CSV
          </button>
          
          {/* Botão de recarregar dados */}
          <button
            onClick={() => loadData()}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
            disabled={isLoading}
          >
            <RefreshCw size={18} /> Atualizar
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* FILTRO DE ORIGEM (MANUAL VS AUTOMÁTICO) */}
      {/* ================================================================== */}
      <div style={{
        display: 'flex', gap: 4, background: 'var(--bg-elevated)',
        padding: 4, borderRadius: 12, width: 'fit-content',
        border: '1px solid var(--border-color)',
      }}>
        {([
          { id: 'manual' as const, label: 'Aprendizagem Manual' },
          { id: 'automatica' as const, label: 'Aprendizagem Automática' }
        ]).map(orig => (
          <button
            key={orig.id}
            onClick={() => setOrigemFilter(orig.id)}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: origemFilter === orig.id
                ? 'linear-gradient(135deg, var(--accent-primary), #4f46e5)'
                : 'transparent',
              color: origemFilter === orig.id ? '#ffffff' : 'var(--text-secondary)',
              fontWeight: origemFilter === orig.id ? 700 : 500,
              fontSize: '0.875rem', cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: 'var(--font-sans)',
              boxShadow: origemFilter === orig.id ? '0 2px 8px rgba(99, 102, 241, 0.25)' : 'none',
            }}
          >
            {orig.label}
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* TABS */}
      {/* ================================================================== */}
      <div style={{
        display: 'flex', gap: 4, background: 'var(--bg-elevated)',
        padding: 4, borderRadius: 12, width: 'fit-content',
        border: '1px solid var(--border-color)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: activeTab === tab.id
                ? 'linear-gradient(135deg, #1e3a8a, #2563eb)'
                : 'transparent',
              color: activeTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '0.875rem', cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: 'var(--font-sans)',
              boxShadow: activeTab === tab.id ? '0 2px 8px rgba(37, 99, 235, 0.25)' : 'none',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* TAB 1: ENTRADAS */}
      {/* ================================================================== */}
      {activeTab === 'entries' && (
        <>
          {/* KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>

            {/* Total Entradas */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'var(--accent-glow)', padding: 12, borderRadius: 10, color: 'var(--accent-primary)' }}>
                <Target size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Total Entradas
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900 }}>{entries.length}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                  ({pendingCount} pendentes)
                </span>
              </div>
            </div>

            {/* Greens */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 12, borderRadius: 10, color: 'var(--status-green)' }}>
                <CheckCircle size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Greens
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--status-green)' }}>{greensCount}</span>
              </div>
            </div>

            {/* Reds */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 10, color: 'var(--status-red)' }}>
                <XCircle size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Reds
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--status-red)' }}>{redsCount}</span>
              </div>
            </div>

            {/* Win Rate */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 12, borderRadius: 10, color: 'var(--status-yellow)' }}>
                <Award size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Win Rate
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900 }}>{winRate}%</span>
                <div style={{ width: '100%', height: 4, background: 'var(--bg-elevated)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{
                    width: `${winRate}%`, height: '100%', borderRadius: 2,
                    background: winRate >= 60 ? 'var(--status-green)' : winRate >= 45 ? 'var(--status-yellow)' : 'var(--status-red)',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="card glass-panel" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Filter size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Filtrar:</span>

              {/* Filtro por outcome */}
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { key: 'ALL' as const, label: 'Todos' },
                  { key: 'PENDING' as const, label: 'Pendentes' },
                  { key: 'green' as const, label: 'Green' },
                  { key: 'red' as const, label: 'Red' },
                ]).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setOutcomeFilter(f.key)}
                    style={{
                      padding: '4px 12px', borderRadius: 20, border: 'none',
                      fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      background: outcomeFilter === f.key
                        ? f.key === 'green' ? 'var(--status-green)' : f.key === 'red' ? 'var(--status-red)' : f.key === 'PENDING' ? 'var(--status-yellow)' : 'var(--accent-primary)'
                        : 'var(--bg-elevated)',
                      color: outcomeFilter === f.key ? '#ffffff' : 'var(--text-muted)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtro de mercado */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mercado:</span>
              <select
                value={marketFilter}
                onChange={e => setMarketFilter(e.target.value as MarketFilter)}
                style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)', padding: '4px 10px', borderRadius: 6,
                  fontSize: '0.8rem', cursor: 'pointer', outline: 'none',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <option value="ALL">Todos</option>
                <option value="gols">Gols</option>
                <option value="escanteios">Escanteios</option>
              </select>
            </div>
          </div>

          {/* Tabela de Entradas */}
          <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                Registro de Entradas
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
                {filteredEntries.length} entrada{filteredEntries.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' }}>
                    {['Data', 'Liga', 'Jogo', 'Min', 'Mercado', 'Placar', 'IPR', 'Score', 'Resultado', 'Ações'].map(col => (
                      <th key={col} style={{
                        padding: '14px 16px', color: 'var(--text-secondary)',
                        fontWeight: 500, fontSize: '0.8rem', whiteSpace: 'nowrap',
                        textAlign: col === 'Ações' ? 'right' : 'left',
                      }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <BookOpen size={32} style={{ opacity: 0.4 }} />
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Nenhuma entrada encontrada</span>
                          <span style={{ fontSize: '0.8rem' }}>
                            {entries.length === 0
                              ? 'As entradas são capturadas automaticamente durante os trades.'
                              : 'Ajuste os filtros acima.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map(entry => (
                      <tr
                        key={entry.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          background: (!entry.outcome || entry.outcome === 'pending') ? 'rgba(59, 130, 246, 0.015)' : 'transparent',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        {/* Data */}
                        <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {entry.created_at
                            ? new Date(entry.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                            : '—'}
                        </td>

                        {/* Liga */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem' }}>
                          <span style={{
                            background: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: 4,
                            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                          }}>
                            {entry.league}
                          </span>
                        </td>

                        {/* Jogo (home_team x away_team) */}
                        <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '0.85rem' }}>
                          {entry.home_team} x {entry.away_team}
                        </td>

                        {/* Minuto */}
                        <td style={{ padding: '14px 16px', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {entry.elapsed}′
                        </td>

                        {/* Mercado (market_type) */}
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            background: entry.market_type === 'gols' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(139, 92, 246, 0.08)',
                            color: entry.market_type === 'gols' ? '#3b82f6' : '#8b5cf6',
                            padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700,
                            textTransform: 'capitalize',
                          }}>
                            {entry.market_type}
                          </span>
                        </td>

                        {/* Placar */}
                        <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'monospace' }}>
                          {entry.goals_home} - {entry.goals_away}
                        </td>

                        {/* IPR Casa / Fora */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {(entry.home_ipr ?? 0).toFixed(1)} / {(entry.away_ipr ?? 0).toFixed(1)}
                        </td>

                        {/* Score composto */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {(entry.home_score ?? 0).toFixed(1)} / {(entry.away_score ?? 0).toFixed(1)}
                        </td>

                        {/* Resultado (outcome) */}
                        <td style={{ padding: '14px 16px' }}>
                          {entry.outcome === 'green' && (
                            <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CheckCircle size={12} /> GREEN
                            </span>
                          )}
                          {entry.outcome === 'red' && (
                            <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <XCircle size={12} /> RED
                            </span>
                          )}
                          {entry.outcome === 'void' && (
                            <span className="badge badge-yellow" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              ⬜ VOID
                            </span>
                          )}
                          {(!entry.outcome || entry.outcome === 'pending') && (
                            <span className="badge badge-yellow" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Clock size={12} className="pulse-indicator" /> Pendente
                            </span>
                          )}
                        </td>

                        {/* Ações */}
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {(!entry.outcome || entry.outcome === 'pending') && entry.id && (
                              <>
                                <button
                                  onClick={() => openResolutionModal(entry, 'green')}
                                  title="Marcar GREEN"
                                  style={{
                                    padding: '4px 8px', background: 'rgba(16, 185, 129, 0.1)', border: 'none',
                                    color: 'var(--status-green)', fontSize: '0.7rem', fontWeight: 700,
                                    borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                                  }}
                                >
                                  ✅ Green
                                </button>
                                <button
                                  onClick={() => openResolutionModal(entry, 'red')}
                                  title="Marcar RED"
                                  style={{
                                    padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', border: 'none',
                                    color: 'var(--status-red)', fontSize: '0.7rem', fontWeight: 700,
                                    borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                                  }}
                                >
                                  ❌ Red
                                </button>
                                <button
                                  onClick={() => handleQuickVoid(entry.id!)}
                                  title="Marcar VOID"
                                  style={{
                                    padding: '4px 8px', background: 'var(--bg-elevated)', border: 'none',
                                    color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700,
                                    borderRadius: 4, cursor: 'pointer',
                                  }}
                                >
                                  ⬜ Void
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================================================================== */}
      {/* TAB 2: ANÁLISE & PADRÕES */}
      {/* ================================================================== */}
      {activeTab === 'analysis' && (
        <>
          {resolved.length < 10 ? (
            <div className="card glass-panel" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{
                  background: 'rgba(245, 158, 11, 0.1)', padding: 20, borderRadius: '50%',
                  color: 'var(--status-yellow)',
                }}>
                  <AlertTriangle size={40} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Dados Insuficientes</h3>
                <p style={{ color: 'var(--text-muted)', maxWidth: 400, lineHeight: 1.6 }}>
                  Você precisa de no mínimo <strong>10 entradas resolvidas</strong> (Green ou Red) para gerar a análise de padrões.
                  Atualmente você tem <strong>{resolved.length}</strong>.
                </p>
                <div style={{ width: '100%', maxWidth: 300, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (resolved.length / 10) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--status-yellow), var(--accent-primary))',
                    borderRadius: 3, transition: 'width 0.5s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {resolved.length}/10 entradas resolvidas
                </span>
              </div>
            </div>
          ) : analysis && (
            <>
              {/* Cards de métricas principais */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>

                {/* Win Rate Global */}
                <div className="card glass-panel" style={{ padding: 24, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', top: -30, right: -30, width: 100, height: 100,
                    borderRadius: '50%', background: 'var(--accent-glow)', opacity: 0.5,
                  }} />
                  <TrendingUp size={28} color="var(--accent-primary)" style={{ marginBottom: 12 }} />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                    Win Rate Global
                  </span>
                  <span style={{
                    fontSize: '2.4rem', fontWeight: 900, display: 'block',
                    color: analysis.overall_win_rate >= 60 ? 'var(--status-green)' : analysis.overall_win_rate >= 45 ? 'var(--status-yellow)' : 'var(--status-red)',
                  }}>
                    {analysis.overall_win_rate}%
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {analysis.total_entries} entradas resolvidas
                  </span>
                </div>

                {/* Win Rate por Mercado */}
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <BarChart3 size={18} color="var(--accent-primary)" />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Win Rate por Mercado
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Object.entries(analysis.win_rate_by_market).map(([market, wr]) => (
                      <div key={market}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize' }}>{market}</span>
                          <span style={{
                            fontSize: '0.8rem', fontWeight: 800,
                            color: wr >= 60 ? 'var(--status-green)' : wr >= 45 ? 'var(--status-yellow)' : 'var(--status-red)',
                          }}>
                            {wr}%
                          </span>
                        </div>
                        <div style={{ width: '100%', height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${wr}%`, height: '100%', borderRadius: 3,
                            background: wr >= 60 ? 'var(--status-green)' : wr >= 45 ? 'var(--status-yellow)' : 'var(--status-red)',
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Correlações Green */}
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <CheckCircle size={18} color="var(--status-green)" />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Top Correlações Green
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analysis.top_green_correlations.slice(0, 5).map((corr, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {corr.metric}
                        </span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--status-green)' }}>
                          +{corr.correlation}
                        </span>
                      </div>
                    ))}
                    {analysis.top_green_correlations.length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sem correlações significativas</span>
                    )}
                  </div>
                </div>

                {/* Correlações Red */}
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <XCircle size={18} color="var(--status-red)" />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Top Correlações Red
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analysis.top_red_correlations.slice(0, 5).map((corr, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {corr.metric}
                        </span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--status-red)' }}>
                          -{corr.correlation}
                        </span>
                      </div>
                    ))}
                    {analysis.top_red_correlations.length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sem correlações significativas</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Gráficos SVG */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <BarChartSVG
                    data={analysis.win_rate_by_score_range}
                    title="Win Rate por Faixa de Score"
                    color="#3b82f6"
                  />
                </div>
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <BarChartSVG
                    data={analysis.win_rate_by_elapsed}
                    title="Win Rate por Minuto de Entrada"
                    color="#8b5cf6"
                  />
                </div>
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <BarChartSVG
                    data={analysis.win_rate_by_tier}
                    title="Win Rate por Tier de Liga"
                    color="#1e3a8a"
                  />
                </div>
              </div>

              {/* Recomendações Automáticas */}
              {analysis.recommendations.length > 0 && (
                <div className="card glass-panel" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <Sparkles size={20} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Recomendações Automáticas</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {analysis.recommendations.map((rec, idx) => {
                      const recStyle = getRecTypeStyle(rec.type);
                      return (
                        <div
                          key={idx}
                          style={{
                            background: 'var(--bg-elevated)',
                            padding: '14px 18px', borderRadius: 10,
                            fontSize: '0.85rem', lineHeight: 1.5,
                            color: 'var(--text-secondary)',
                            borderLeft: `3px solid ${recStyle.color}`,
                            display: 'flex', flexDirection: 'column', gap: 6,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: recStyle.color, textTransform: 'uppercase' }}>
                              {recStyle.label}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              Confiança: {rec.confidence}%
                            </span>
                          </div>
                          <span>{rec.description}</span>
                          {rec.estimated_impact && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Impacto: {rec.estimated_impact}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ================================================================== */}
      {/* TAB 3: IA GEMINI */}
      {/* ================================================================== */}
      {activeTab === 'gemini' && (
        <>
          {/* Seção de API Key */}
          <div className="card glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Key size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Configuração da API</h3>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>OPENAI API KEY</label>
                <input
                  type="password"
                  placeholder="Cole sua API Key da OpenAI (sk-...)..."
                  value={geminiKey}
                  onChange={e => {
                    setGeminiKey(e.target.value);
                    localStorage.setItem('openai_api_key', e.target.value);
                  }}
                  style={inputStyle}
                />
              </div>
              <button
                onClick={handleGenerateReport}
                disabled={geminiLoading || resolved.length < 10}
                className="btn btn-primary"
                style={{
                  fontWeight: 700, padding: '10px 24px', whiteSpace: 'nowrap',
                  opacity: geminiLoading || resolved.length < 10 ? 0.5 : 1,
                  cursor: geminiLoading || resolved.length < 10 ? 'not-allowed' : 'pointer',
                }}
              >
                {geminiLoading ? (
                  <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Analisando (pode retentar)...</>
                ) : (
                  <><Brain size={16} /> 🧠 Gerar Análise com IA</>
                )}
              </button>
            </div>

            {resolved.length < 10 && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <AlertTriangle size={14} color="var(--status-yellow)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--status-yellow)' }}>
                  Mínimo de 10 entradas resolvidas necessárias. Você tem {resolved.length}.
                </span>
              </div>
            )}

            {geminiError && (
              <div style={{
                marginTop: 12, padding: '14px 18px', borderRadius: 10,
                background: geminiError.includes('⏳') 
                  ? 'rgba(245, 158, 11, 0.06)' 
                  : 'rgba(239, 68, 68, 0.06)',
                border: `1px solid ${geminiError.includes('⏳') 
                  ? 'rgba(245, 158, 11, 0.2)' 
                  : 'rgba(220, 38, 38, 0.15)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {geminiError.includes('⏳') 
                    ? <AlertTriangle size={16} color="var(--status-yellow)" style={{ marginTop: 2, flexShrink: 0 }} />
                    : <XCircle size={16} color="var(--status-red)" style={{ marginTop: 2, flexShrink: 0 }} />
                  }
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {geminiError.split('\n').map((line, idx) => (
                      <span key={idx} style={{ 
                        fontSize: line.startsWith('•') ? '0.78rem' : '0.82rem', 
                        color: line.startsWith('•') ? 'var(--text-secondary)' : (geminiError.includes('⏳') ? 'var(--status-yellow)' : 'var(--status-red)'),
                        fontWeight: idx === 0 ? 700 : 400,
                        lineHeight: 1.5,
                      }}>
                        {line || null}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Relatório Atual */}
          {currentReport && (
            <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '18px 24px', borderBottom: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.04), rgba(59, 130, 246, 0.02))',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Sparkles size={18} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Relatório ChatGPT</h3>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
                  {currentReport.created_at
                    ? new Date(currentReport.created_at).toLocaleString('pt-BR')
                    : 'Agora'}
                </span>
              </div>

              {/* Resumo do relatório com dados do raw_summary */}
              <div style={{ padding: 24 }}>
                {currentReport.raw_summary?.resumo_geral && (
                  <div style={{
                    background: 'var(--bg-elevated)', padding: 24, borderRadius: 12,
                    fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)',
                    maxHeight: 300, overflowY: 'auto',
                    border: '1px solid var(--border-color)', marginBottom: 20,
                  }}>
                    <h4 style={{ marginBottom: 8, fontWeight: 800, color: 'var(--text-primary)' }}>Resumo Geral</h4>
                    {currentReport.raw_summary.resumo_geral}
                  </div>
                )}

                {/* Padrões identificados */}
                {currentReport.raw_summary?.padroes_identificados && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <BarChart3 size={16} color="var(--accent-primary)" />
                      Padrões Identificados
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(currentReport.raw_summary.padroes_identificados as string[]).map((padrao: string, idx: number) => (
                        <div key={idx} style={{
                          background: 'var(--bg-elevated)', padding: '10px 16px', borderRadius: 8,
                          fontSize: '0.83rem', color: 'var(--text-secondary)',
                          borderLeft: '3px solid var(--accent-primary)',
                        }}>
                          {padrao}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Métricas-chave */}
                {currentReport.raw_summary?.metricas_chave && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Target size={16} color="var(--accent-primary)" />
                      Métricas-Chave
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                      {Object.entries(currentReport.raw_summary.metricas_chave as Record<string, string>).map(([key, val]) => (
                        <div key={key} style={{
                          background: 'var(--bg-elevated)', padding: '10px 14px', borderRadius: 8,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            {key.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {val}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Win Rate geral */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                  background: 'var(--bg-elevated)', borderRadius: 12, marginBottom: 20,
                }}>
                  <Award size={28} color={currentReport.overall_win_rate >= 60 ? 'var(--status-green)' : 'var(--status-yellow)'} />
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>
                      Win Rate Global (IA)
                    </span>
                    <span style={{
                      fontSize: '1.8rem', fontWeight: 900,
                      color: currentReport.overall_win_rate >= 60 ? 'var(--status-green)' : currentReport.overall_win_rate >= 45 ? 'var(--status-yellow)' : 'var(--status-red)',
                    }}>
                      {currentReport.overall_win_rate}%
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {currentReport.total_entries} entradas analisadas
                  </span>
                </div>
              </div>

              {/* Recomendações da IA */}
              {currentReport.recommendations.length > 0 && (
                <div style={{ padding: '0 24px 24px' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Target size={16} color="var(--accent-primary)" />
                    Recomendações da IA ({currentReport.recommendations.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {currentReport.recommendations.map((rec, idx) => {
                      const recStyle = getRecTypeStyle(rec.type);
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex', flexDirection: 'column', gap: 6,
                            padding: '14px 18px', borderRadius: 10,
                            background: 'var(--bg-elevated)',
                            borderLeft: `3px solid ${recStyle.color}`,
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: recStyle.color, textTransform: 'uppercase' }}>
                              {recStyle.label}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              Confiança: {rec.confidence}%
                            </span>
                          </div>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {rec.description}
                          </span>
                          {rec.estimated_impact && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Impacto estimado: {rec.estimated_impact}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Histórico de Relatórios */}
          <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              onClick={() => setShowReportHistory(!showReportHistory)}
              style={{
                width: '100%', padding: '16px 24px', border: 'none', background: 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={18} color="var(--text-muted)" />
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Histórico de Relatórios
                </span>
                <span style={{
                  fontSize: '0.7rem', background: 'var(--bg-elevated)', padding: '2px 8px',
                  borderRadius: 20, color: 'var(--text-muted)', fontWeight: 600,
                }}>
                  {reports.filter(r => r.analysis_source === 'gemini').length}
                </span>
              </div>
              <ChevronDown
                size={18}
                color="var(--text-muted)"
                style={{
                  transform: showReportHistory ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              />
            </button>

            {showReportHistory && (
              <div style={{ borderTop: '1px solid var(--border-color)' }}>
                {reports.filter(r => r.analysis_source === 'gemini').length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Nenhum relatório gerado ainda.
                  </div>
                ) : (
                  reports.filter(r => r.analysis_source === 'gemini').map(report => (
                    <div
                      key={report.id}
                      style={{
                        padding: '14px 24px', borderBottom: '1px solid var(--border-color)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        cursor: 'pointer', transition: 'background 0.15s ease',
                      }}
                      onClick={() => setCurrentReport(report)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Brain size={16} color="var(--accent-primary)" />
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block' }}>
                            Relatório — {report.created_at
                              ? new Date(report.created_at).toLocaleDateString('pt-BR')
                              : '—'}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            ChatGPT · {report.recommendations.length} recomendações
                          </span>
                        </div>
                      </div>
                      <Eye size={16} color="var(--text-muted)" />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ================================================================== */}
      {/* TAB 4: APRENDIZADO GOLS */}
      {/* ================================================================== */}
      {activeTab === 'goal_learning' && (
        <>
          {/* KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {/* Total Gols */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'var(--accent-glow)', padding: 12, borderRadius: 10, color: 'var(--accent-primary)' }}>
                <Target size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Gols Registrados
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900 }}>{goalsList.length}</span>
              </div>
            </div>

            {/* Mandantes */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: 12, borderRadius: 10, color: '#3b82f6' }}>
                <Award size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Gols de Mandantes
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#3b82f6' }}>
                  {goalsList.filter(g => g.scoring_team === 'home').length}
                </span>
              </div>
            </div>

            {/* Visitantes */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: 12, borderRadius: 10, color: '#8b5cf6' }}>
                <Award size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Gols de Visitantes
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#8b5cf6' }}>
                  {goalsList.filter(g => g.scoring_team === 'away').length}
                </span>
              </div>
            </div>

            {/* Minuto Médio */}
            <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 12, borderRadius: 10, color: 'var(--status-yellow)' }}>
                <Clock size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                  Minuto Médio do Gol
                </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900 }}>
                  {goalsList.length > 0 
                    ? `${Math.round(goalsList.reduce((acc, curr) => acc + curr.elapsed, 0) / goalsList.length)}′`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* ChatGPT IA Report Section */}
          <div className="card glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Brain size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Padrões e Correlações de Gols com IA</h3>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>OPENAI API KEY</label>
                <input
                  type="password"
                  placeholder="Cole sua API Key da OpenAI (sk-...)..."
                  value={geminiKey}
                  onChange={e => {
                    setGeminiKey(e.target.value);
                    localStorage.setItem('openai_api_key', e.target.value);
                  }}
                  style={inputStyle}
                />
              </div>
              <button
                onClick={handleGenerateGoalReport}
                disabled={goalGeminiLoading || goalsList.length < 3}
                className="btn btn-primary"
                style={{
                  fontWeight: 700, padding: '10px 24px', whiteSpace: 'nowrap',
                  opacity: goalGeminiLoading || goalsList.length < 3 ? 0.5 : 1,
                  cursor: goalGeminiLoading || goalsList.length < 3 ? 'not-allowed' : 'pointer',
                }}
              >
                {goalGeminiLoading ? (
                  <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Analisando Gols...</>
                ) : (
                  <><Brain size={16} /> 🧠 Achar Padrões dos Gols</>
                )}
              </button>
            </div>

            {goalsList.length < 3 && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <AlertTriangle size={14} color="var(--status-yellow)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--status-yellow)' }}>
                  Mínimo de 3 gols registrados necessários para disparar a IA. Você tem {goalsList.length}.
                </span>
              </div>
            )}

            {goalGeminiError && (
              <div style={{
                marginTop: 12, padding: '14px 18px', borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(220, 38, 38, 0.15)',
                fontSize: '0.82rem', color: 'var(--status-red)',
              }}>
                {goalGeminiError}
              </div>
            )}
          </div>

          {/* Relatório IA de Gols Ativo */}
          {currentGoalReport && (
            <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '18px 24px', borderBottom: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.04), rgba(59, 130, 246, 0.02))',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Sparkles size={18} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Padrões e Insights Identificados (Gols)</h3>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
                  {currentGoalReport.created_at
                    ? new Date(currentGoalReport.created_at).toLocaleString('pt-BR')
                    : 'Agora'}
                </span>
              </div>

              <div style={{ padding: 24 }}>
                {currentGoalReport.raw_summary?.resumo_geral && (
                  <div style={{
                    background: 'var(--bg-elevated)', padding: 20, borderRadius: 12,
                    fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)',
                    border: '1px solid var(--border-color)', marginBottom: 20,
                  }}>
                    <h4 style={{ marginBottom: 8, fontWeight: 800, color: 'var(--text-primary)' }}>Resumo Estratégico</h4>
                    {currentGoalReport.raw_summary.resumo_geral}
                  </div>
                )}

                {/* Padrões identificados */}
                {currentGoalReport.raw_summary?.padroes_identificados && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <BarChart3 size={16} color="var(--accent-primary)" />
                      Correlações Encontradas
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(currentGoalReport.raw_summary.padroes_identificados as string[]).map((padrao: string, idx: number) => (
                        <div key={idx} style={{
                          background: 'var(--bg-elevated)', padding: '10px 16px', borderRadius: 8,
                          fontSize: '0.83rem', color: 'var(--text-secondary)',
                          borderLeft: '3px solid var(--accent-primary)',
                        }}>
                          {padrao}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Métricas-chave */}
                {currentGoalReport.raw_summary?.metricas_chave && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Target size={16} color="var(--accent-primary)" />
                      Métricas Médias no Momento do Gol
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                      {Object.entries(currentGoalReport.raw_summary.metricas_chave as Record<string, string>).map(([key, val]) => (
                        <div key={key} style={{
                          background: 'var(--bg-elevated)', padding: '10px 14px', borderRadius: 8,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            {key.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {val}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Recomendações da IA */}
              {currentGoalReport.recommendations.length > 0 && (
                <div style={{ padding: '0 24px 24px' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Target size={16} color="var(--accent-primary)" />
                    Recomendações IA para Mercado de Gols ({currentGoalReport.recommendations.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {currentGoalReport.recommendations.map((rec, idx) => {
                      const recStyle = getRecTypeStyle(rec.type);
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex', flexDirection: 'column', gap: 6,
                            padding: '14px 18px', borderRadius: 10,
                            background: 'var(--bg-elevated)',
                            borderLeft: `3px solid ${recStyle.color}`,
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: recStyle.color, textTransform: 'uppercase' }}>
                              {recStyle.label}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              Confiança: {rec.confidence}%
                            </span>
                          </div>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {rec.description}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Histórico de Relatórios de Gols */}
          <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              onClick={() => setShowGoalReportHistory(!showGoalReportHistory)}
              style={{
                width: '100%', padding: '16px 24px', border: 'none', background: 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={18} color="var(--text-muted)" />
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Histórico de Relatórios (Gols)
                </span>
                <span style={{
                  fontSize: '0.7rem', background: 'var(--bg-elevated)', padding: '2px 8px',
                  borderRadius: 20, color: 'var(--text-muted)', fontWeight: 600,
                }}>
                  {reports.filter(r => r.analysis_source === 'gemini_gols').length}
                </span>
              </div>
              <ChevronDown
                size={18}
                color="var(--text-muted)"
                style={{
                  transform: showGoalReportHistory ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              />
            </button>

            {showGoalReportHistory && (
              <div style={{ borderTop: '1px solid var(--border-color)' }}>
                {reports.filter(r => r.analysis_source === 'gemini_gols').length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Nenhum relatório de gols gerado ainda.
                  </div>
                ) : (
                  reports.filter(r => r.analysis_source === 'gemini_gols').map(report => (
                    <div
                      key={report.id}
                      style={{
                        padding: '14px 24px', borderBottom: '1px solid var(--border-color)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        cursor: 'pointer', transition: 'background 0.15s ease',
                      }}
                      onClick={() => setCurrentGoalReport(report)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Brain size={16} color="var(--accent-primary)" />
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block' }}>
                            Relatório de Gols — {report.created_at
                              ? new Date(report.created_at).toLocaleDateString('pt-BR')
                              : '—'}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            ChatGPT · {report.recommendations.length} recomendações
                          </span>
                        </div>
                      </div>
                      <Eye size={16} color="var(--text-muted)" />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Tabela de Gols Registrados */}
          <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                Snapshots dos Gols Capturados
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
                {goalsList.length} gol{goalsList.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' }}>
                    {['Horário', 'Liga', 'Jogo', 'Minuto', 'Placar', 'Marcador', 'IPR C/F', 'Score C/F', 'Chutes C/F', 'Cantos C/F'].map(col => (
                      <th key={col} style={{
                        padding: '14px 16px', color: 'var(--text-secondary)',
                        fontWeight: 500, fontSize: '0.8rem', whiteSpace: 'nowrap',
                      }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {goalsList.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <Clock size={32} style={{ opacity: 0.4 }} />
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Nenhum gol capturado ainda</span>
                          <span style={{ fontSize: '0.8rem' }}>
                            O sistema registrará automaticamente os gols em tempo real com o Radar aberto.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    goalsList.map(goal => (
                      <tr key={goal.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s ease' }}>
                        {/* Data/Horário */}
                        <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {goal.created_at
                            ? new Date(goal.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(goal.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                            : '—'}
                        </td>

                        {/* Liga */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem' }}>
                          <span style={{
                            background: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: 4,
                            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                          }}>
                            {goal.league}
                          </span>
                        </td>

                        {/* Jogo */}
                        <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '0.85rem' }}>
                          {goal.home_team} x {goal.away_team}
                        </td>

                        {/* Minuto */}
                        <td style={{ padding: '14px 16px', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {goal.elapsed}′ ({goal.period})
                        </td>

                        {/* Placar após gol */}
                        <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'monospace' }}>
                          {goal.goals_home} - {goal.goals_away}
                        </td>

                        {/* Quem Marcou */}
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            background: goal.scoring_team === 'home' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(139, 92, 246, 0.08)',
                            color: goal.scoring_team === 'home' ? '#3b82f6' : '#8b5cf6',
                            padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700,
                          }}>
                            {goal.scoring_team === 'home' ? 'MANDANTE' : 'VISITANTE'}
                          </span>
                        </td>

                        {/* IPR */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {(goal.home_ipr ?? 0).toFixed(1)} / {(goal.away_ipr ?? 0).toFixed(1)}
                        </td>

                        {/* Score */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {(goal.home_score ?? 0).toFixed(1)} / {(goal.away_score ?? 0).toFixed(1)}
                        </td>

                        {/* Chutes */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {goal.home_total_shots} / {goal.away_total_shots}
                        </td>

                        {/* Cantos */}
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {goal.home_corners} / {goal.away_corners}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================================================================== */}
      {/* CARD DE AJUDA: MIGRACAO SQL */}
      {/* ================================================================== */}
      <div className="card glass-panel" style={{ marginTop: 12, border: '1px solid rgba(139, 92, 246, 0.25)', padding: '20px 24px', background: 'rgba(139, 92, 246, 0.015)' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)' }}>
          <Key size={16} /> Banco de Dados Supabase (Opções e Estrutura)
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Se você estiver configurando o Trade Moreira pela primeira vez ou se as novas colunas de Aprendizagem Automática ainda não estiverem ativas, execute o comando SQL abaixo no console (SQL Editor) do seu projeto Supabase para habilitar a separação das fontes de dados:
        </p>
        <pre style={{
          background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, overflowX: 'auto',
          border: '1px solid var(--border-color)', color: '#8b5cf6', fontSize: '0.75rem', fontFamily: 'monospace'
        }}>
{`-- Comando para adicionar a coluna de origem da aprendizagem (Manual vs Automática)
ALTER TABLE public.trade_entries ADD COLUMN IF NOT EXISTS origem_aprendizagem VARCHAR DEFAULT 'manual';`}
        </pre>
      </div>

      {/* ================================================================== */}
      {/* MODAL: Resolução de Entrada */}
      {/* ================================================================== */}
      {resolutionModal && (
        <div style={overlayStyle}>
          <div className="card glass-panel" style={{
            width: 480, padding: 28, borderRadius: 16,
            border: `1px solid ${resolutionModal.outcome === 'green' ? 'rgba(5, 150, 105, 0.2)' : 'rgba(220, 38, 38, 0.2)'}`,
          }}>
            <h3 style={{
              fontSize: '1.15rem', fontWeight: 800, marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 8,
              color: resolutionModal.outcome === 'green' ? 'var(--status-green)' : 'var(--status-red)',
            }}>
              {resolutionModal.outcome === 'green' ? <CheckCircle size={22} /> : <XCircle size={22} />}
              Resolver como {resolutionModal.outcome.toUpperCase()}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>
              Adicione informações opcionais sobre a resolução desta entrada.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Placar Final */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>GOLS FINAL — CASA</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ex: 2"
                    value={resolutionModal.finalGoalsHome}
                    onChange={e => setResolutionModal({ ...resolutionModal, finalGoalsHome: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>GOLS FINAL — FORA</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ex: 1"
                    value={resolutionModal.finalGoalsAway}
                    onChange={e => setResolutionModal({ ...resolutionModal, finalGoalsAway: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Escanteios finais */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>ESCANTEIOS FINAL — CASA</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ex: 5"
                    value={resolutionModal.finalCornersHome}
                    onChange={e => setResolutionModal({ ...resolutionModal, finalCornersHome: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>ESCANTEIOS FINAL — FORA</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ex: 3"
                    value={resolutionModal.finalCornersAway}
                    onChange={e => setResolutionModal({ ...resolutionModal, finalCornersAway: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Lucro/Prejuízo */}
              <div>
                <label style={labelStyle}>LUCRO / PREJUÍZO (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 50.00 ou -25.00"
                  value={resolutionModal.profitLoss}
                  onChange={e => setResolutionModal({ ...resolutionModal, profitLoss: e.target.value })}
                  style={inputStyle}
                />
              </div>

              {/* Observações */}
              <div>
                <label style={labelStyle}>OBSERVAÇÕES</label>
                <textarea
                  placeholder="Notas sobre a resolução..."
                  value={resolutionModal.notes}
                  onChange={e => setResolutionModal({ ...resolutionModal, notes: e.target.value })}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* Botões do modal */}
              <div style={{ display: 'flex', gap: 12, marginTop: 4, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setResolutionModal(null)}
                  className="btn"
                  style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleResolve}
                  className="btn"
                  style={{
                    fontWeight: 700, padding: '10px 24px', border: 'none',
                    background: resolutionModal.outcome === 'green'
                      ? 'linear-gradient(135deg, #059669, #10b981)'
                      : 'linear-gradient(135deg, #dc2626, #ef4444)',
                    color: '#ffffff', borderRadius: 8, cursor: 'pointer',
                    boxShadow: resolutionModal.outcome === 'green'
                      ? '0 4px 12px rgba(5, 150, 105, 0.25)'
                      : '0 4px 12px rgba(220, 38, 38, 0.25)',
                  }}
                >
                  {resolutionModal.outcome === 'green' ? '✅' : '❌'} Confirmar {resolutionModal.outcome.toUpperCase()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
