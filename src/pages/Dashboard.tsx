import { TrendingUp, TrendingDown, DollarSign, Target } from 'lucide-react';

export default function Dashboard() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard Financeiro</h1>
          <p style={{ color: 'var(--text-muted)' }}>Visão geral da sua banca e performance.</p>
        </div>
        <button className="btn btn-primary">Novo Aporte</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Banca Atual</span>
            <DollarSign color="var(--accent-primary)" />
          </div>
          <h2 style={{ fontSize: '2rem', marginBottom: 8 }}>R$ 12.450,00</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <TrendingUp size={12} /> +4.2%
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>desde o último mês</span>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Lucro do Dia</span>
            <TrendingUp color="var(--status-green)" />
          </div>
          <h2 style={{ fontSize: '2rem', marginBottom: 8, color: 'var(--status-green)' }}>+ R$ 340,00</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>3 greens / 1 red</span>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Win Rate</span>
            <Target color="var(--status-yellow)" />
          </div>
          <h2 style={{ fontSize: '2rem', marginBottom: 8 }}>68%</h2>
          <div style={{ width: '100%', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: '68%', height: '100%', background: 'var(--accent-primary)' }}></div>
          </div>
        </div>
      </div>

      {/* Chart Placeholder Area */}
      <h2 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Performance Recente</h2>
      <div className="card" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
         <TrendingUp size={48} color="var(--bg-elevated)" />
         <p style={{ color: 'var(--text-muted)' }}>Gráfico de evolução da banca será renderizado aqui (Recharts/Chart.js)</p>
      </div>
    </div>
  );
}
