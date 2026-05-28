import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, BookOpen, ShieldAlert } from 'lucide-react';

export default function Layout() {
  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Activity className="pulse-indicator" style={{ width: 24, height: 24 }} color="var(--accent-primary)" />
          <span className="title-glow">TradePro</span>
        </div>

        <nav>
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={20} />
            Dashboard
          </NavLink>
          
          <NavLink to="/radar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Activity size={20} />
            Radar Ao Vivo
          </NavLink>

          <NavLink to="/diary" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookOpen size={20} />
            Diário & Banca
          </NavLink>
        </nav>

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
