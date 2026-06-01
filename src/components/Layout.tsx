import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Activity, BookOpen, ShieldAlert, Calendar, 
  Zap, Shield, TrendingUp, CheckCircle, Clock, Filter, Download
} from 'lucide-react';

export default function Layout() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const currentMode = searchParams.get('mode') || 'conservative';

  const isLinkActive = (path: string, modeParam?: string) => {
    if (location.pathname !== path) return false;
    if (path === '/radar') {
      return currentMode === (modeParam || 'conservative');
    }
    return true;
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar" style={{ minWidth: 260 }}>
        <div className="sidebar-logo">
          <Activity className="pulse-indicator" style={{ width: 24, height: 24 }} color="var(--accent-primary)" />
          <span className="title-glow">TradePro</span>
        </div>

        <nav>
          <Link 
            to="/dashboard" 
            className={`nav-item ${isLinkActive('/dashboard') ? 'active' : ''}`}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </Link>
          
          <Link 
            to="/radar" 
            className={`nav-item ${isLinkActive('/radar', 'conservative') && location.search === '' ? 'active' : ''}`}
          >
            <Activity size={20} />
            Radar Ao Vivo
          </Link>

          <Link 
            to="/prelive" 
            className={`nav-item ${isLinkActive('/prelive') ? 'active' : ''}`}
          >
            <Calendar size={20} />
            Varredura Pré-Live
          </Link>

          <Link 
            to="/scheduler" 
            className={`nav-item ${isLinkActive('/scheduler') ? 'active' : ''}`}
          >
            <Clock size={20} />
            Scheduler de Operação
          </Link>

          <Link 
            to="/diary" 
            className={`nav-item ${isLinkActive('/diary') ? 'active' : ''}`}
          >
            <BookOpen size={20} />
            Diário & Banca
          </Link>
        </nav>

        {/* Operation Modes Section */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 12 }}>
            Modos de Operação
          </span>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link 
              to="/radar?mode=apm_pure" 
              className={`nav-item ${isLinkActive('/radar', 'apm_pure') ? 'active' : ''}`}
            >
              <Zap size={18} />
              APM Puro (Favorito)
            </Link>
            
            <Link 
              to="/radar?mode=aggressive" 
              className={`nav-item ${isLinkActive('/radar', 'aggressive') ? 'active' : ''}`}
            >
              <TrendingUp size={18} />
              Agressivo
            </Link>
            
            <Link 
              to="/radar?mode=conservative" 
              className={`nav-item ${isLinkActive('/radar', 'conservative') && location.search.includes('conservative') ? 'active' : ''}`}
            >
              <CheckCircle size={18} />
              Conservador Clássico
            </Link>
            
            <Link 
              to="/radar?mode=defensive" 
              className={`nav-item ${isLinkActive('/radar', 'defensive') ? 'active' : ''}`}
            >
              <Shield size={18} />
              Conservador Defensivo
            </Link>

            <Link 
              to="/radar?mode=funnel" 
              className={`nav-item ${isLinkActive('/radar', 'funnel') ? 'active' : ''}`}
            >
              <Filter size={18} />
              Funil (Minutos Finais)
            </Link>
          </nav>
        </div>

        {/* Ferramentas Section */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 12 }}>
            Ferramentas
          </span>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a 
              href="https://github.com/gustavonm2/sports-trading-platform/tree/main/chrome-extension"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-item"
              style={{ textDecoration: 'none' }}
            >
              <Download size={18} />
              Bet365 Bridge
              <span style={{ 
                marginLeft: 'auto', 
                fontSize: '0.6rem', 
                fontWeight: 800, 
                background: 'rgba(16, 185, 129, 0.1)', 
                color: '#10b981', 
                padding: '2px 6px', 
                borderRadius: 4,
                lineHeight: 1.3
              }}>EXTENSÃO</span>
            </a>
          </nav>
        </div>

        {/* Status System - Mock */}
        <div style={{ marginTop: 'auto', padding: '16px', background: 'var(--bg-elevated)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ShieldAlert size={16} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Status da Banca</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Meta Diária</span>
            <span className="badge badge-green">38%</span>
          </div>
          <div style={{ width: '100%', height: 4, background: 'var(--bg-surface)', marginTop: 8, borderRadius: 2 }}>
            <div style={{ width: '38%', height: '100%', background: 'var(--status-green)', borderRadius: 2 }}></div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
