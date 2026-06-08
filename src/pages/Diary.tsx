import { useState, useEffect } from 'react';
import { 
  CheckCircle, XCircle, Clock, Trash2, Plus, AlertCircle, 
  DollarSign, TrendingUp, Award, Percent, ArrowUpRight
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { saveSimplifiedTradeEntry, syncDiaryOutcome } from '../services/learningEngine';

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

export default function Diary() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [initialBankroll, setInitialBankroll] = useState<number>(() => {
    const saved = localStorage.getItem('trade_initial_bankroll');
    return saved ? Number(saved) : 5000;
  });
  
  const [isEditingInitial, setIsEditingInitial] = useState(false);
  const [tempBankrollInput, setTempBankrollInput] = useState(initialBankroll.toString());
  
  // Modal states
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [matchName, setMatchName] = useState('');
  const [market, setMarket] = useState('Cantos Limite');
  const [odd, setOdd] = useState('1.80');
  const [defaultStake, setDefaultStake] = useState<number>(() => {
    const saved = localStorage.getItem('trade_default_stake');
    return saved ? Number(saved) : 200;
  });
  const [stake, setStake] = useState(() => {
    const saved = localStorage.getItem('trade_default_stake');
    return saved || '200';
  });
  const [status, setStatus] = useState<'GREEN' | 'RED' | 'PENDING'>('PENDING');
  
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Load trades from Supabase (or fallback to localStorage)
  const fetchTrades = async () => {
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setTrades(data || []);
      setUsingFallback(false);
    } catch (e) {
      console.warn("Supabase table 'trades' not set up yet. Falling back to local replication.", e);
      // Fallback local storage database
      const localTrades = localStorage.getItem('trades_db_replica');
      setTrades(localTrades ? JSON.parse(localTrades) : []);
      setUsingFallback(true);
      setShowSqlGuide(true);
    }
  };

  useEffect(() => {
    fetchTrades();
  }, []);

  // Save bankroll locally
  const handleSaveBankroll = () => {
    const num = Number(tempBankrollInput) || 0;
    setInitialBankroll(num);
    localStorage.setItem('trade_initial_bankroll', num.toString());
    setIsEditingInitial(false);
  };

  // Add new trade
  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchName.trim()) return;

    const oddNum = Number(odd) || 1.80;
    const stakeNum = Number(stake) || 200;
    let profitLoss = 0;
    if (status === 'GREEN') profitLoss = Number((stakeNum * (oddNum - 1)).toFixed(2));
    if (status === 'RED') profitLoss = -stakeNum;

    const newTradeData = {
      match_name: matchName,
      market,
      odd: oddNum,
      stake: stakeNum,
      status,
      profit_loss: profitLoss
    };

    let generatedTradeId = '';

    if (usingFallback) {
      // Local replication
      generatedTradeId = crypto.randomUUID();
      const newTrade: Trade = {
        id: generatedTradeId,
        created_at: new Date().toISOString(),
        ...newTradeData
      };
      const updated = [newTrade, ...trades];
      setTrades(updated);
      localStorage.setItem('trades_db_replica', JSON.stringify(updated));
    } else {
      // Supabase
      try {
        const { data, error } = await supabase.from('trades').insert([newTradeData]).select().single();
        if (error) throw error;
        generatedTradeId = data?.id || 'supabase-' + Date.now();
        await fetchTrades();
      } catch (err) {
        alert("Erro ao salvar no banco de dados. Tentando replicar localmente.");
        console.error(err);
      }
    }

    // Reset form
    setMatchName('');
    setIsOpenModal(false);

    // 🧠 Sync with Learning module (fire-and-forget)
    if (generatedTradeId) {
      saveSimplifiedTradeEntry({
        diaryTradeId: generatedTradeId,
        matchName,
        market,
        odd: oddNum,
        stake: stakeNum,
        status,
        profitLoss,
      }).catch(() => {}); // silent fail
    }
  };

  // Quick Resolve: mark pending trade as GREEN or RED
  const handleResolveTrade = async (id: string, newStatus: 'GREEN' | 'RED') => {
    const target = trades.find(t => t.id === id);
    if (!target) return;

    const profitLoss = newStatus === 'GREEN' 
      ? Number((target.stake * (target.odd - 1)).toFixed(2))
      : -target.stake;

    if (usingFallback) {
      const updated = trades.map(t => t.id === id ? { ...t, status: newStatus, profit_loss: profitLoss } : t);
      setTrades(updated);
      localStorage.setItem('trades_db_replica', JSON.stringify(updated));
    } else {
      try {
        const { error } = await supabase
          .from('trades')
          .update({ status: newStatus, profit_loss: profitLoss })
          .eq('id', id);
        if (error) throw error;
        await fetchTrades();
      } catch (err) {
        console.error("Error updating trade:", err);
      }
    }

    // 🧠 Sync outcome with Learning module (fire-and-forget)
    syncDiaryOutcome(
      id,
      newStatus === 'GREEN' ? 'green' : 'red',
      profitLoss
    ).catch(() => {}); // silent fail
  };

  // Delete trade
  const handleDeleteTrade = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este registro de aposta?")) return;

    if (usingFallback) {
      const updated = trades.filter(t => t.id !== id);
      setTrades(updated);
      localStorage.setItem('trades_db_replica', JSON.stringify(updated));
    } else {
      try {
        const { error } = await supabase
          .from('trades')
          .delete()
          .eq('id', id);
        if (error) throw error;
        await fetchTrades();
      } catch (err) {
        console.error("Error deleting trade:", err);
      }
    }
  };

  // Metrics Calculations
  const totalProfitLoss = Number(trades.reduce((acc, curr) => acc + curr.profit_loss, 0).toFixed(2));
  const currentBankroll = initialBankroll + totalProfitLoss;
  const growthPercent = initialBankroll > 0 ? Number(((totalProfitLoss / initialBankroll) * 100).toFixed(2)) : 0;
  
  const resolvedTrades = trades.filter(t => t.status !== 'PENDING');
  const greensCount = trades.filter(t => t.status === 'GREEN').length;
  const redsCount = trades.filter(t => t.status === 'RED').length;
  
  const winRate = resolvedTrades.length > 0 ? Number(((greensCount / resolvedTrades.length) * 100).toFixed(1)) : 0;
  const totalStakeInvested = resolvedTrades.reduce((acc, curr) => acc + curr.stake, 0);
  const roi = totalStakeInvested > 0 ? Number(((totalProfitLoss / totalStakeInvested) * 100).toFixed(2)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Diário & Gestão de Banca</h1>
          <p style={{ color: 'var(--text-muted)' }}>Controle de banca profissional integrado em tempo real com o banco de dados cloud.</p>
        </div>
        <button 
          onClick={() => setIsOpenModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
        >
          <Plus size={18} /> Registrar Entrada
        </button>
      </div>

      {/* SQL Setup Alert (collapsible guide) */}
      {showSqlGuide && (
        <div className="card glass-panel" style={{ padding: 20, border: '1px dashed var(--status-yellow)', background: 'rgba(245, 158, 11, 0.02)', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowSqlGuide(!showSqlGuide)}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <AlertCircle size={18} color="var(--status-yellow)" />
              Persistência Cloud Pendente: A tabela 'trades' não foi criada no seu Supabase.
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {showSqlGuide ? 'OCULTAR INSTRUÇÕES ▲' : 'MOSTRAR INSTRUÇÕES ▼'}
            </span>
          </div>
          
          <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <p style={{ marginBottom: 8 }}>
              O sistema está usando a <strong>Replicação Local (LocalStorage)</strong> para salvar suas apostas temporariamente, garantindo que o painel funcione imediatamente. Para persistir na nuvem do Supabase, siga estes passos rápidos:
            </p>
            <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <li>Acesse o dashboard do seu Supabase.</li>
              <li>Clique na aba <strong>"SQL Editor"</strong> no menu lateral esquerdo.</li>
              <li>Clique em <strong>"New Query"</strong> e cole o seguinte script SQL:</li>
            </ol>
            <pre style={{
              background: 'var(--bg-elevated)', padding: 16, borderRadius: 8, overflowX: 'auto',
              border: '1px solid var(--border-color)', color: '#a78bfa', fontSize: '0.8rem', fontFamily: 'monospace'
            }}>
{`CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  match_name VARCHAR NOT NULL,
  market VARCHAR NOT NULL,
  odd NUMERIC NOT NULL,
  stake NUMERIC NOT NULL,
  status VARCHAR DEFAULT 'PENDING' NOT NULL,
  profit_loss NUMERIC DEFAULT 0 NOT NULL
);`}
            </pre>
            <p style={{ marginTop: 10 }}>
              4. Clique em <strong>"Run"</strong> no painel do Supabase. Em seguida, recarregue esta página!
            </p>
          </div>
        </div>
      )}

      {/* Analytics Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        
        {/* Card 1: Bankroll Balance */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ background: 'var(--accent-glow)', padding: 12, borderRadius: 10, color: 'var(--accent-primary)' }}>
            <DollarSign size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>BANCA ATUAL</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ffffff' }}>
              R$ {currentBankroll.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {isEditingInitial ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    value={tempBankrollInput}
                    onChange={(e) => setTempBankrollInput(e.target.value)}
                    style={{
                      width: 80, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4
                    }}
                  />
                  <button onClick={handleSaveBankroll} style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}>OK</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span 
                    onClick={() => setIsEditingInitial(true)}
                    style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Edit. Banca Inicial (R$ {initialBankroll})
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Stake Padrão: R$</span>
                    <input
                      type="number"
                      value={defaultStake}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setDefaultStake(val);
                        setStake(val.toString());
                        localStorage.setItem('trade_default_stake', val.toString());
                      }}
                      style={{
                        width: 55, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                        color: '#fff', fontSize: '0.75rem', padding: '1px 4px', borderRadius: 4, outline: 'none'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Growth % */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ 
            background: totalProfitLoss >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
            padding: 12, borderRadius: 10, 
            color: totalProfitLoss >= 0 ? 'var(--status-green)' : 'var(--status-red)' 
          }}>
            <TrendingUp size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>LUCRO / CRESCIMENTO</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: totalProfitLoss >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
              R$ {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toLocaleString('pt-BR')} 
              <span style={{ fontSize: '0.9rem', fontWeight: 600, marginLeft: 8 }}>({growthPercent >= 0 ? '+' : ''}{growthPercent}%)</span>
            </span>
          </div>
        </div>

        {/* Card 3: Winrate and Stats */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 12, borderRadius: 10, color: 'var(--status-yellow)' }}>
            <Award size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>TAXA DE ACERTO (WINRATE)</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ffffff' }}>
              {winRate}%
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginLeft: 8 }}>
                ({greensCount}G - {redsCount}R)
              </span>
            </span>
          </div>
        </div>

        {/* Card 4: ROI */}
        <div className="card glass-panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: 12, borderRadius: 10, color: '#a78bfa' }}>
            <Percent size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>RETORNO SOBRE INVESTIMENTO</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: roi >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
              {roi >= 0 ? '+' : ''}{roi}%
            </span>
          </div>
        </div>

      </div>

      {/* Trade Log Table Card */}
      <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Histórico de Entradas Registradas</h2>
          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {usingFallback ? 'Sandbox Local Ativo' : 'Supabase Cloud Sync'}
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Data/Hora</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Jogo</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Mercado</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Odd</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Stake</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>Lucro/Prejuízo</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem', textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  Nenhuma entrada registrada ainda. Clique em "Registrar Entrada" para iniciar seu histórico!
                </td>
              </tr>
            ) : (
              trades.map(trade => (
                <tr key={trade.id} style={{ borderBottom: '1px solid var(--border-color)', background: trade.status === 'PENDING' ? 'rgba(59, 130, 246, 0.01)' : 'transparent' }}>
                  <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {new Date(trade.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '16px 24px', fontWeight: 700 }}>{trade.match_name}</td>
                  <td style={{ padding: '16px 24px' }}>
                    <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {trade.market}
                    </span>
                  </td>
                  <td style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 600 }}>@{trade.odd.toFixed(2)}</td>
                  <td style={{ padding: '16px 24px', fontWeight: 600 }}>R$ {trade.stake.toFixed(2)}</td>
                  <td style={{ padding: '16px 24px' }}>
                    {trade.status === 'GREEN' && (
                      <span style={{ color: 'var(--status-green)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle size={14} /> +R$ {trade.profit_loss.toFixed(2)}
                      </span>
                    )}
                    {trade.status === 'RED' && (
                      <span style={{ color: 'var(--status-red)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <XCircle size={14} /> R$ {trade.profit_loss.toFixed(2)}
                      </span>
                    )}
                    {trade.status === 'PENDING' && (
                      <span style={{ color: 'var(--status-yellow)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={14} className="pulse-indicator" /> Pendente / Live
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {trade.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleResolveTrade(trade.id, 'GREEN')}
                            style={{
                              padding: '4px 8px', background: 'rgba(16, 185, 129, 0.1)', border: 'none',
                              color: 'var(--status-green)', fontSize: '0.75rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer'
                            }}
                            title="Marcar como GREEN"
                          >
                            GREEN
                          </button>
                          <button
                            onClick={() => handleResolveTrade(trade.id, 'RED')}
                            style={{
                              padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', border: 'none',
                              color: 'var(--status-red)', fontSize: '0.75rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer'
                            }}
                            title="Marcar como RED"
                          >
                            RED
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteTrade(trade.id)}
                        style={{ background: 'transparent', border: 'none', color: 'rgba(239, 68, 68, 0.6)', cursor: 'pointer', padding: 4 }}
                        title="Excluir Registro"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Register Trade Modal */}
      {isOpenModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="card glass-panel" style={{ width: 440, padding: 24, borderRadius: 16 }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowUpRight size={20} color="var(--accent-primary)" /> Registrar Nova Entrada
            </h3>
            
            <form onSubmit={handleAddTrade} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>NOME DO CONFRONTO</label>
                <input
                  type="text"
                  placeholder="Ex: Real Madrid x Barcelona"
                  value={matchName}
                  onChange={(e) => setMatchName(e.target.value)}
                  style={{
                    width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                    color: '#fff', padding: '10px 12px', borderRadius: 8, outline: 'none', fontSize: '0.875rem'
                  }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>MERCADO</label>
                  <select
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', padding: '10px 12px', borderRadius: 8, outline: 'none', fontSize: '0.875rem', cursor: 'pointer'
                    }}
                  >
                    <option value="Cantos Limite">Cantos Limite</option>
                    <option value="Back Favorito">Back Favorito</option>
                    <option value="Over Gols HT">Over Gols HT</option>
                    <option value="Rigor de Cartões">Rigor de Cartões</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>STATUS DA ENTRADA</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', padding: '10px 12px', borderRadius: 8, outline: 'none', fontSize: '0.875rem', cursor: 'pointer'
                    }}
                  >
                    <option value="PENDING">Pendente / Ao Vivo</option>
                    <option value="GREEN">GREEN (Lucro)</option>
                    <option value="RED">RED (Prejuízo)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>ODD DA ENTRADA</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    value={odd}
                    onChange={(e) => setOdd(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', padding: '10px 12px', borderRadius: 8, outline: 'none', fontSize: '0.875rem'
                    }}
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>VALOR DA STAKE (R$)</label>
                  <input
                    type="number"
                    min="1"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                      color: '#fff', padding: '10px 12px', borderRadius: 8, outline: 'none', fontSize: '0.875rem'
                    }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setIsOpenModal(false)}
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
                  Registrar Entrada
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
