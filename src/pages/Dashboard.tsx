import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, DollarSign, Target, RefreshCw, AlertCircle, Plus, ArrowUpRight } from 'lucide-react';
import { supabase } from '../services/supabase';

interface Trade {
  id: string;
  created_at: string;
  match_name: string;
  market: string;
  odd: number;
  stake: number;
  status: 'GREEN' | 'RED' | 'PENDING';
  profit_loss: number;
}

const mapBancaFromDb = (dbBanca: any) => ({
  id: dbBanca.id,
  name: dbBanca.name,
  initial: Number(dbBanca.initial),
  defaultStake: Number(dbBanca.default_stake),
  defaultOdd: Number(dbBanca.default_odd)
});

const mapBancaToDb = (banca: any) => ({
  id: banca.id,
  name: banca.name,
  initial: banca.initial,
  default_stake: banca.defaultStake,
  default_odd: banca.defaultOdd
});

const loadLocalBancas = () => {
  const savedBancas = localStorage.getItem('trade_bancas');
  const savedInitial = localStorage.getItem('trade_initial_bankroll');
  const defaultInitial = savedInitial ? Number(savedInitial) : 5000;
  
  const savedStake = localStorage.getItem('trade_default_stake');
  const defaultStake = savedStake ? Number(savedStake) : 200;

  if (savedBancas) {
    try {
      return JSON.parse(savedBancas);
    } catch {
      return [{ id: 'default', name: 'Banca Fictícia', initial: defaultInitial, defaultStake, defaultOdd: 1.80 }];
    }
  }
  const list = [{ id: 'default', name: 'Banca Fictícia', initial: defaultInitial, defaultStake, defaultOdd: 1.80 }];
  localStorage.setItem('trade_bancas', JSON.stringify(list));
  return list;
};

export default function Dashboard() {
  const [trades, setTrades] = useState<Trade[]>([]);
  
  const [bancas, setBancas] = useState<any[]>(() => loadLocalBancas());
  const [usingBancaFallback, setUsingBancaFallback] = useState(false);

  const [activeBancaId, setActiveBancaId] = useState<string>(() => {
    return localStorage.getItem('active_banca_id') || 'default';
  });

  const activeBanca = useMemo(() => {
    return bancas.find(b => b.id === activeBancaId) || bancas[0] || { id: 'default', name: 'Banca Fictícia', initial: 5000, defaultStake: 200, defaultOdd: 1.80 };
  }, [bancas, activeBancaId]);

  const initialBankroll = activeBanca.initial;

  const handleSwitchBanca = (bancaId: string) => {
    setActiveBancaId(bancaId);
    localStorage.setItem('active_banca_id', bancaId);
  };

  const fetchBancas = async () => {
    try {
      const { data, error } = await supabase
        .from('bancas')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const localBancas = loadLocalBancas();
      if (data && data.length > 0) {
        const fetched = data.map(mapBancaFromDb);
        const fetchedIds = new Set(fetched.map(b => b.id));
        
        // Sync any missing local bancas to database
        const missing = localBancas.filter((b: any) => !fetchedIds.has(b.id));
        if (missing.length > 0) {
          for (const b of missing) {
            await supabase.from('bancas').insert([mapBancaToDb(b)]);
            fetched.push(b);
          }
        }
        
        setBancas(fetched);
        localStorage.setItem('trade_bancas', JSON.stringify(fetched));
      } else {
        // Database table exists but is empty, upload all local bancas
        for (const b of localBancas) {
          await supabase.from('bancas').insert([mapBancaToDb(b)]);
        }
        setBancas(localBancas);
      }
      setUsingBancaFallback(false);
    } catch (e: any) {
      console.warn("Supabase fetch/sync for 'bancas' failed, using localStorage:", e);
      setBancas(loadLocalBancas());
      if (e.code === '42P01') {
        setUsingBancaFallback(true);
      }
    }
  };

  const handleCreateBanca = async () => {
    const name = prompt("Digite o nome da nova banca (ex: Banca Real):");
    if (!name || !name.trim()) return;
    const initialStr = prompt("Digite o valor inicial da banca (R$):", "5000");
    if (initialStr === null) return;
    const initial = Number(initialStr) || 0;
    
    const newBanca = {
      id: 'banca_' + Date.now(),
      name: name.trim(),
      initial,
      defaultStake: 200,
      defaultOdd: 1.80
    };
    
    const updatedBancas = [...bancas, newBanca];
    setBancas(updatedBancas);
    localStorage.setItem('trade_bancas', JSON.stringify(updatedBancas));
    
    setActiveBancaId(newBanca.id);
    localStorage.setItem('active_banca_id', newBanca.id);

    // Sync to Supabase
    if (!usingBancaFallback) {
      try {
        const { error } = await supabase
          .from('bancas')
          .insert([mapBancaToDb(newBanca)]);
        if (error) throw error;
      } catch (err) {
        console.error("Error saving new banca to Supabase:", err);
      }
    }
  };
  
  const [isLoading, setIsLoading] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  
  // Aporte modal state
  const [isOpenAporteModal, setIsOpenAporteModal] = useState(false);
  const [aporteVal, setAporteVal] = useState('2000');

  // Hover state for custom SVG chart
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    date: string;
    value: number;
    index: number;
  } | null>(null);

  const fetchTrades = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTrades(data || []);
      setShowSqlGuide(false);
    } catch (e) {
      console.warn("Supabase fetch failed in Dashboard, using local replica:", e);
      const localTrades = localStorage.getItem('trades_db_replica');
      setTrades(localTrades ? JSON.parse(localTrades) : []);
      setShowSqlGuide(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrades();
    fetchBancas();
  }, []);

  const filteredTrades = useMemo(() => {
    return trades.filter((t: any) => (t.banca_id || 'default') === activeBancaId);
  }, [trades, activeBancaId]);

  // Performance calculations
  const totalProfitLoss = Number(filteredTrades.reduce((acc, curr) => acc + curr.profit_loss, 0).toFixed(2));
  const currentBankroll = initialBankroll + totalProfitLoss;
  const growthPercent = initialBankroll > 0 ? Number(((totalProfitLoss / initialBankroll) * 100).toFixed(2)) : 0;

  // Today's metrics (local calendar day)
  const todayTrades = filteredTrades.filter(t => {
    const tradeDate = new Date(t.created_at).toDateString();
    const todayDate = new Date().toDateString();
    return tradeDate === todayDate;
  });
  const todayProfitLoss = Number(todayTrades.reduce((acc, curr) => acc + curr.profit_loss, 0).toFixed(2));
  const todayGreens = todayTrades.filter(t => t.status === 'GREEN').length;
  const todayReds = todayTrades.filter(t => t.status === 'RED').length;

  // Winrate
  const resolvedTrades = filteredTrades.filter(t => t.status !== 'PENDING');
  const greensCount = filteredTrades.filter(t => t.status === 'GREEN').length;
  const winRate = resolvedTrades.length > 0 ? Math.round((greensCount / resolvedTrades.length) * 100) : 0;

  // Handle addition of new funds (Aporte)
  const handleAporte = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(aporteVal) || 0;
    if (num <= 0) return;

    const newInitial = initialBankroll + num;
    const updatedBancas = bancas.map(b => b.id === activeBancaId ? { ...b, initial: newInitial } : b);
    setBancas(updatedBancas);
    localStorage.setItem('trade_bancas', JSON.stringify(updatedBancas));

    if (activeBancaId === 'default') {
      localStorage.setItem('trade_initial_bankroll', newInitial.toString());
    }
    setIsOpenAporteModal(false);

    // Sync to Supabase
    const targetBanca = updatedBancas.find(b => b.id === activeBancaId);
    if (targetBanca && !usingBancaFallback) {
      try {
        const { error } = await supabase
          .from('bancas')
          .update(mapBancaToDb(targetBanca))
          .eq('id', activeBancaId);
        if (error) throw error;
      } catch (err) {
        console.error("Error updating bankroll initial balance in Supabase:", err);
      }
    }
  };

  // Chronological points for SVG line chart
  const resolvedChronological = [...filteredTrades]
    .filter(t => t.status !== 'PENDING')
    .reverse();

  let tempSum = initialBankroll;
  const chartPoints = [{
    date: 'Início',
    value: tempSum
  }];

  resolvedChronological.forEach(trade => {
    tempSum += trade.profit_loss;
    chartPoints.push({
      date: new Date(trade.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      value: tempSum
    });
  });

  // Calculate coordinates for responsive SVG (bounding box: 500x200)
  const values = chartPoints.map(p => p.value);
  const minVal = values.length > 0 ? Math.min(...values) : initialBankroll;
  const maxVal = values.length > 0 ? Math.max(...values) : initialBankroll;
  
  const valRange = maxVal - minVal;
  const padding = valRange > 0 ? valRange * 0.15 : 100;
  const adjustedMin = minVal - padding;
  const adjustedMax = maxVal + padding;

  let pathD = '';
  let fillD = '';
  let coords: { x: number; y: number }[] = [];

  if (chartPoints.length > 1) {
    coords = chartPoints.map((p, idx) => {
      const x = (idx / (chartPoints.length - 1)) * 500;
      const y = 200 - ((p.value - adjustedMin) / (adjustedMax - adjustedMin)) * 200;
      return { x, y };
    });
    
    pathD = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    fillD = `${pathD} L 500 200 L 0 200 Z`;
  } else {
    // Flat line fallback
    pathD = 'M 0 100 L 500 100';
    fillD = 'M 0 100 L 500 100 L 500 200 L 0 200 Z';
    coords = [
      { x: 0, y: 100 },
      { x: 500, y: 100 }
    ];
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            Dashboard Financeiro
            {isLoading && <RefreshCw size={18} className="pulse-indicator" style={{ animation: 'spin 2s linear infinite', background: 'transparent' }} />}
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Visão geral da sua banca e performance integrada ao banco de dados.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Banca Selector Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', borderRadius: 8, padding: '6px 12px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Banca:</span>
            <select
              value={activeBancaId}
              onChange={(e) => handleSwitchBanca(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                outline: 'none',
                paddingRight: 4
              }}
            >
              {bancas.map(b => (
                <option key={b.id} value={b.id} style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                  {b.name} (R$ {b.initial})
                </option>
              ))}
            </select>
          </div>

          <button 
            className="btn btn-outline" 
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleCreateBanca}
          >
            <Plus size={16} /> Nova Banca
          </button>

          <button 
            className="btn btn-outline" 
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={fetchTrades}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          <button 
            className="btn btn-primary"
            onClick={() => setIsOpenAporteModal(true)}
          >
            <Plus size={16} /> Novo Aporte
          </button>
        </div>
      </div>

      {/* SQL Warning Alert (similar to Diary) */}
      {showSqlGuide && (
        <div className="card glass-panel" style={{ padding: '16px 20px', border: '1px dashed var(--status-yellow)', background: 'rgba(217, 119, 6, 0.02)', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowSqlGuide(!showSqlGuide)}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <AlertCircle size={16} color="var(--status-yellow)" />
              Usando Sandbox Local. Para persistir no Supabase, crie a tabela 'trades' no SQL Editor.
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {showSqlGuide ? 'OCULTAR GUIA ▲' : 'MOSTRAR GUIA ▼'}
            </span>
          </div>
          
          {showSqlGuide && (
            <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <p style={{ marginBottom: 6 }}>Cole o código SQL abaixo no <strong>SQL Editor</strong> do seu dashboard do Supabase e clique em <strong>Run</strong>:</p>
              <pre style={{
                background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, overflowX: 'auto',
                border: '1px solid var(--border-color)', color: '#8b5cf6', fontSize: '0.75rem', fontFamily: 'monospace'
              }}>
{`CREATE TABLE IF NOT EXISTS trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  match_name VARCHAR NOT NULL,
  market VARCHAR NOT NULL,
  odd NUMERIC NOT NULL,
  stake NUMERIC NOT NULL,
  status VARCHAR DEFAULT 'PENDING' NOT NULL,
  profit_loss NUMERIC DEFAULT 0 NOT NULL,
  banca_id VARCHAR DEFAULT 'default'
);

-- Tabela para salvar as múltiplas bancas na nuvem
CREATE TABLE IF NOT EXISTS public.bancas (
  id VARCHAR PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  name VARCHAR NOT NULL,
  initial NUMERIC NOT NULL DEFAULT 5000,
  default_stake NUMERIC NOT NULL DEFAULT 200,
  default_odd NUMERIC NOT NULL DEFAULT 1.80
);

ALTER TABLE public.bancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir Leitura e Escrita Pública em bancas" ON public.bancas;
CREATE POLICY "Permitir Leitura e Escrita Pública em bancas" ON public.bancas FOR ALL USING (true) WITH CHECK (true);

-- Caso já possua as tabelas, execute estes comandos para atualizar as colunas e a tabela de aprendizagem:
ALTER TABLE trades ADD COLUMN IF NOT EXISTS banca_id VARCHAR DEFAULT 'default';
ALTER TABLE trade_entries ADD COLUMN IF NOT EXISTS banca_id VARCHAR DEFAULT 'default';`}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px' }}>
        
        {/* Card 1: Banca Atual */}
        <div className="card glass-panel" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>Banca Atual</span>
            <DollarSign color="var(--accent-primary)" />
          </div>
          <h2 style={{ fontSize: '2.1rem', marginBottom: 8, fontWeight: 900 }}>
            R$ {currentBankroll.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={growthPercent >= 0 ? "badge badge-green" : "badge badge-red"} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', fontSize: '0.7rem' }}>
              {growthPercent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} 
              {growthPercent >= 0 ? '+' : ''}{growthPercent}%
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>desde a banca inicial (R$ {initialBankroll})</span>
          </div>
        </div>

        {/* Card 2: Lucro do Dia */}
        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>Lucro do Dia</span>
            {todayProfitLoss >= 0 ? <TrendingUp color="var(--status-green)" /> : <TrendingDown color="var(--status-red)" />}
          </div>
          <h2 style={{ fontSize: '2.1rem', marginBottom: 8, color: todayProfitLoss >= 0 ? 'var(--status-green)' : 'var(--status-red)', fontWeight: 900 }}>
            {todayProfitLoss >= 0 ? '+' : ''} R$ {todayProfitLoss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {todayGreens} green{todayGreens !== 1 ? 's' : ''} / {todayReds} red{todayReds !== 1 ? 's' : ''} hoje
            </span>
          </div>
        </div>

        {/* Card 3: Win Rate */}
        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>Win Rate</span>
            <Target color="var(--status-yellow)" />
          </div>
          <h2 style={{ fontSize: '2.1rem', marginBottom: 8, fontWeight: 900 }}>{winRate}%</h2>
          <div style={{ width: '100%', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{ width: `${winRate}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-primary) 0%, #3b82f6 100%)', borderRadius: 3 }}></div>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Média ponderada baseada em {resolvedTrades.length} entradas resolvidas</span>
        </div>

      </div>

      {/* Chart Section */}
      <div className="card glass-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800 }}>Performance & Evolução da Banca</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Gráfico dinâmico de crescimento capitalizado ao longo das apostas.</p>
          </div>
          {chartPoints.length > 1 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
              {chartPoints.length - 1} operações resolvidas
            </span>
          )}
        </div>

        {/* Custom SVG Line Chart */}
        <div style={{ position: 'relative', width: '100%', height: 260, background: 'rgba(255,255,255,0.4)', borderRadius: 8, border: '1px solid var(--border-color)', padding: 12 }}>
          {chartPoints.length <= 1 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <TrendingUp size={36} color="var(--text-muted)" style={{ opacity: 0.4 }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.9rem' }}>Nenhum dado financeiro para exibir</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
                  Registre ou resolva entradas no <Link to="/diary" style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>Diário de Aposta</Link> para traçar sua evolução.
                </p>
              </div>
            </div>
          ) : (
            <svg 
              viewBox="0 0 500 200" 
              width="100%" 
              height="100%" 
              preserveAspectRatio="none"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                </linearGradient>
                <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="#1e3a8a" floodOpacity="0.12" />
                </filter>
              </defs>

              {/* Horizontal Grid Lines */}
              <line x1="0" y1="0" x2="500" y2="0" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="0" y1="50" x2="500" y2="50" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="0" y1="100" x2="500" y2="100" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="0" y1="200" x2="500" y2="200" stroke="var(--border-color)" strokeWidth="0.5" />

              {/* Y Axis Value Indicators */}
              <text x="-5" y="10" textAnchor="end" fontSize="7" fontWeight="600" fill="var(--text-muted)">R$ {maxVal.toFixed(0)}</text>
              <text x="-5" y="105" textAnchor="end" fontSize="7" fontWeight="600" fill="var(--text-muted)">R$ {((maxVal + minVal)/2).toFixed(0)}</text>
              <text x="-5" y="195" textAnchor="end" fontSize="7" fontWeight="600" fill="var(--text-muted)">R$ {minVal.toFixed(0)}</text>

              {/* Area Gradient Fill */}
              <path d={fillD} fill="url(#chartGradient)" />

              {/* Glowing Line */}
              <path 
                d={pathD} 
                fill="none" 
                stroke="linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%)" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                filter="url(#shadow)"
                style={{ stroke: 'var(--accent-primary)' }}
              />

              {/* Interactive Hover Indicators */}
              {coords.map((c, idx) => (
                <g key={idx}>
                  {/* Subtle point circles */}
                  <circle 
                    cx={c.x} 
                    cy={c.y} 
                    r={3} 
                    fill="var(--accent-primary)" 
                    stroke="#ffffff" 
                    strokeWidth="1" 
                  />
                  {/* Invisible wide hover areas */}
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={12}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredPoint({
                      x: c.x,
                      y: c.y,
                      date: chartPoints[idx].date,
                      value: chartPoints[idx].value,
                      index: idx
                    })}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                </g>
              ))}

              {/* Render Tooltip directly inside SVG so it scales perfectly */}
              {hoveredPoint && (
                <g>
                  {/* Vertical guiding line */}
                  <line 
                    x1={hoveredPoint.x} 
                    y1={hoveredPoint.y} 
                    x2={hoveredPoint.x} 
                    y2={200} 
                    stroke="var(--accent-primary)" 
                    strokeWidth="0.75" 
                    strokeDasharray="3 3" 
                    opacity={0.5} 
                  />
                  
                  {/* Glowing dot on hover */}
                  <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={6} fill="var(--accent-primary)" opacity={0.25} />
                  <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={3.5} fill="var(--accent-primary)" stroke="#ffffff" strokeWidth="1" />

                  {/* Tooltip Background Card */}
                  <rect 
                    x={hoveredPoint.x - (hoveredPoint.x > 380 ? 115 : hoveredPoint.x < 60 ? 5 : 55)} 
                    y={hoveredPoint.y - 50} 
                    width={110} 
                    height={40} 
                    rx={4} 
                    fill="#ffffff" 
                    stroke="var(--border-color)"
                    strokeWidth="1"
                    style={{ filter: 'drop-shadow(0px 3px 6px rgba(15,23,42,0.08))' }}
                  />
                  {/* Tooltip text - Date */}
                  <text 
                    x={hoveredPoint.x - (hoveredPoint.x > 380 ? 60 : hoveredPoint.x < 60 ? -50 : 0)} 
                    y={hoveredPoint.y - 38} 
                    textAnchor="middle" 
                    fontSize="7" 
                    fontWeight="700" 
                    fill="var(--text-muted)"
                  >
                    {hoveredPoint.index === 0 ? "Banca Inicial" : `Operação #${hoveredPoint.index}`} ({hoveredPoint.date})
                  </text>
                  {/* Tooltip text - Value */}
                  <text 
                    x={hoveredPoint.x - (hoveredPoint.x > 380 ? 60 : hoveredPoint.x < 60 ? -50 : 0)} 
                    y={hoveredPoint.y - 22} 
                    textAnchor="middle" 
                    fontSize="9.5" 
                    fontWeight="800" 
                    fill="var(--text-primary)"
                  >
                    R$ {hoveredPoint.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </text>
                </g>
              )}
            </svg>
          )}
        </div>
      </div>

      {/* Aporte Modal */}
      {isOpenAporteModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(6px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card glass-panel" style={{ width: 400, padding: 28, borderRadius: 16, border: '1px solid rgba(30,58,138,0.12)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowUpRight size={22} color="var(--accent-primary)" /> Injetar Novo Aporte
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>Adicione capital externo para expandir a sua banca inicial oficial.</p>
            
            <form onSubmit={handleAporte} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase' }}>VALOR DO APORTE (R$)</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: 12, fontWeight: 700, color: 'var(--text-muted)' }}>R$</span>
                  <input
                    type="number"
                    min="1"
                    value={aporteVal}
                    onChange={(e) => setAporteVal(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', padding: '12px 12px 12px 38px', borderRadius: 8, outline: 'none', fontSize: '0.95rem', fontWeight: 700
                    }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setIsOpenAporteModal(false)}
                  className="btn"
                  style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ fontWeight: 700, padding: '10px 24px' }}
                >
                  Confirmar Aporte
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
