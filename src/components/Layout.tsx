import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, Activity, BookOpen, ShieldAlert, Calendar, 
  Shield, TrendingUp, CheckCircle, Clock, Download, Brain,
  Bell, ChevronDown, ChevronUp, Goal, CornerDownRight, Trophy,
  Menu, X
} from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { supabase } from '../services/supabase';

// Tipo para janelas de notificação
interface NotificationWindow {
  id: string;
  market: 'gols' | 'escanteios';
  period: '1H' | '2H';
  min_minute: number;
  max_minute: number;
  enabled: boolean;
}

const DEFAULT_WINDOWS: NotificationWindow[] = [
  { id: 'gols_1h', market: 'gols', period: '1H', min_minute: 12, max_minute: 40, enabled: true },
  { id: 'gols_2h', market: 'gols', period: '2H', min_minute: 50, max_minute: 85, enabled: true },
  { id: 'escanteios_1h', market: 'escanteios', period: '1H', min_minute: 30, max_minute: 45, enabled: true },
  { id: 'escanteios_2h', market: 'escanteios', period: '2H', min_minute: 75, max_minute: 90, enabled: true },
];

export default function Layout() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const currentMode = searchParams.get('mode') || 'classico';
  const [notifOpen, setNotifOpen] = useState(false);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [windows, setWindows] = useState<NotificationWindow[]>(() => {
    const saved = localStorage.getItem('notification_windows');
    return saved ? JSON.parse(saved) : DEFAULT_WINDOWS;
  });
  const [saving, setSaving] = useState(false);

  // Carregar do Supabase ao montar
  useEffect(() => {
    supabase.from('notification_windows').select('*').then(({ data }) => {
      if (data && data.length > 0) {
        setWindows(data as NotificationWindow[]);
        localStorage.setItem('notification_windows', JSON.stringify(data));
      }
    });
  }, []);

  // Persistir alterações no Supabase
  const saveWindow = useCallback(async (w: NotificationWindow) => {
    setSaving(true);
    // Salvar localmente primeiro (otimista)
    const newWindows = windows.map(win => win.id === w.id ? w : win);
    setWindows(newWindows);
    localStorage.setItem('notification_windows', JSON.stringify(newWindows));
    
    // Persistir no Supabase
    await supabase.from('notification_windows').upsert({
      ...w,
      updated_at: new Date().toISOString()
    });
    setSaving(false);
  }, [windows]);

  const updateField = (id: string, field: string, value: number | boolean) => {
    const w = windows.find(win => win.id === id);
    if (!w) return;
    const updated = { ...w, [field]: value };
    saveWindow(updated);
  };

  const isLinkActive = (path: string, modeParam?: string) => {
    if (location.pathname !== path) return false;
    if (path === '/radar') {
      return currentMode === (modeParam || 'classico');
    }
    return true;
  };

  const closeSidebar = () => setSidebarOpen(false);

  const inputStyle: React.CSSProperties = {
    width: 48,
    padding: '4px 6px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: '0.8rem',
    textAlign: 'center',
    outline: 'none',
  };

  const toggleStyle = (enabled: boolean): React.CSSProperties => ({
    width: 36,
    height: 20,
    borderRadius: 10,
    background: enabled ? '#10b981' : 'var(--bg-surface)',
    border: enabled ? 'none' : '1px solid var(--border-color)',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.2s',
    flexShrink: 0,
  });

  const toggleDotStyle = (enabled: boolean): React.CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 2,
    left: enabled ? 18 : 2,
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  });

  const renderWindowRow = (w: NotificationWindow) => {
    const icon = w.market === 'gols' 
      ? <Goal size={14} color={w.enabled ? '#f59e0b' : 'var(--text-muted)'} /> 
      : <CornerDownRight size={14} color={w.enabled ? '#3b82f6' : 'var(--text-muted)'} />;
    const label = `${w.market === 'gols' ? 'Gols' : 'Cant.'} ${w.period}`;
    
    return (
      <div key={w.id} style={{ 
        display: 'flex', alignItems: 'center', gap: 8, 
        padding: '6px 0',
        opacity: w.enabled ? 1 : 0.4,
        transition: 'opacity 0.2s',
      }}>
        {icon}
        <span style={{ fontSize: '0.75rem', fontWeight: 600, minWidth: 55, color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <input
          type="number"
          min={0}
          max={90}
          value={w.min_minute}
          onChange={e => updateField(w.id, 'min_minute', Math.max(0, Math.min(90, Number(e.target.value))))}
          style={inputStyle}
          disabled={!w.enabled}
          title="Minuto mínimo"
        />
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>—</span>
        <input
          type="number"
          min={0}
          max={95}
          value={w.max_minute}
          onChange={e => updateField(w.id, 'max_minute', Math.max(0, Math.min(95, Number(e.target.value))))}
          style={inputStyle}
          disabled={!w.enabled}
          title="Minuto máximo"
        />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>'</span>
        <div 
          style={toggleStyle(w.enabled)} 
          onClick={() => updateField(w.id, 'enabled', !w.enabled)}
          title={w.enabled ? 'Desativar' : 'Ativar'}
        >
          <div style={toggleDotStyle(w.enabled)} />
        </div>
      </div>
    );
  };

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <div className="mobile-header">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-primary)', padding: 8, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Menu"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <Activity className="pulse-indicator" style={{ width: 20, height: 20 }} color="var(--accent-primary)" />
          <span className="title-glow" style={{ fontSize: '1.1rem' }}>TradePro</span>
        </div>
        <button
          onClick={() => {
            if ('Notification' in window) {
              if (Notification.permission === 'default') {
                Notification.requestPermission().then(p => {
                  if (p === 'granted') {
                    alert('✅ Notificações push ativadas! Você receberá alertas do Radar.');
                  }
                });
              } else if (Notification.permission === 'granted') {
                alert('✅ Push notifications já estão ativas!');
              } else {
                alert('⚠️ Notificações bloqueadas pelo navegador.\n\nPara ativar:\n1. Acesse as configurações do Safari\n2. Encontre este site\n3. Permita notificações');
              }
            } else {
              alert('⚠️ Este navegador não suporta notificações push.\n\nNo iPhone, use o Safari e adicione à Tela de Início.');
            }
          }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: ('Notification' in window && Notification.permission === 'granted') ? 'var(--status-green)' : 'var(--text-muted)',
            padding: 8, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Ativar notificações"
        >
          <Bell size={20} />
        </button>
      </div>

      {/* Sidebar Backdrop (mobile only) */}
      {isMobile && sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} style={!isMobile ? { minWidth: 260 } : undefined}>
        {/* Close button for mobile */}
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              onClick={closeSidebar}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 4,
              }}
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className="sidebar-logo">
          <Activity className="pulse-indicator" style={{ width: 24, height: 24 }} color="var(--accent-primary)" />
          <span className="title-glow">TradePro</span>
        </div>

        <nav>
          <Link 
            to="/dashboard" 
            className={`nav-item ${isLinkActive('/dashboard') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </Link>
          
          <Link 
            to="/radar" 
            className={`nav-item ${isLinkActive('/radar', 'classico') && location.search === '' ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <Activity size={20} />
            Radar Ao Vivo
          </Link>

          <Link 
            to="/prelive" 
            className={`nav-item ${isLinkActive('/prelive') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <Calendar size={20} />
            Varredura Pré-Live
          </Link>

          <Link 
            to="/scheduler" 
            className={`nav-item ${isLinkActive('/scheduler') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <Clock size={20} />
            Scheduler de Operação
          </Link>

          <Link 
            to="/diary" 
            className={`nav-item ${isLinkActive('/diary') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <BookOpen size={20} />
            Diário & Banca
          </Link>

          <Link 
            to="/learning" 
            className={`nav-item ${isLinkActive('/learning') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <Brain size={20} />
            Aprendizagem
            <span style={{ 
              marginLeft: 'auto', 
              fontSize: '0.55rem', 
              fontWeight: 800, 
              background: 'rgba(139, 92, 246, 0.15)', 
              color: '#8b5cf6', 
              padding: '2px 6px', 
              borderRadius: 4,
              lineHeight: 1.3
            }}>IA</span>
          </Link>

          <Link 
            to="/copa2026" 
            className={`nav-item ${isLinkActive('/copa2026') ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            <Trophy size={20} />
            Copa 2026
            <span style={{ 
              marginLeft: 'auto', 
              fontSize: '0.55rem', 
              fontWeight: 800, 
              background: 'rgba(234, 179, 8, 0.15)', 
              color: '#eab308', 
              padding: '2px 6px', 
              borderRadius: 4,
              lineHeight: 1.3
            }}>🏆</span>
          </Link>
        </nav>

        {/* Operation Modes Section */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 12 }}>
            Modos de Operação
          </span>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link 
              to="/radar?mode=arriscado" 
              className={`nav-item ${isLinkActive('/radar', 'arriscado') ? 'active' : ''}`}
              onClick={closeSidebar}
            >
              <TrendingUp size={18} />
              Arriscado
            </Link>
            
            <Link 
              to="/radar?mode=classico" 
              className={`nav-item ${isLinkActive('/radar', 'classico') ? 'active' : ''}`}
              onClick={closeSidebar}
            >
              <CheckCircle size={18} />
              Clássico
            </Link>
            
            <Link 
              to="/radar?mode=conservador" 
              className={`nav-item ${isLinkActive('/radar', 'conservador') ? 'active' : ''}`}
              onClick={closeSidebar}
            >
              <Shield size={18} />
              Conservador
            </Link>
          </nav>
        </div>

        {/* 🔔 Central de Notificações */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <div 
            onClick={() => setNotifOpen(!notifOpen)}
            style={{ 
              display: 'flex', alignItems: 'center', gap: 8, 
              paddingLeft: 12, paddingRight: 12, cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <Bell size={16} color="var(--text-muted)" />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', flex: 1 }}>
              Janela de Alertas
            </span>
            {saving && <span style={{ fontSize: '0.6rem', color: '#10b981' }}>Salvando...</span>}
            {notifOpen ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
          </div>

          {notifOpen && (
            <div style={{ 
              margin: '8px 12px 0', 
              padding: '10px 12px', 
              background: 'var(--bg-elevated)', 
              borderRadius: 10,
              border: '1px solid var(--border-color)',
            }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                Configure os minutos em que o sistema pode notificar entradas. Fora dessas janelas, os alertas são silenciados.
              </p>
              
              {/* Gols */}
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚽ Gols
                </span>
                {windows.filter(w => w.market === 'gols').map(renderWindowRow)}
              </div>

              {/* Escanteios */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 6 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🚩 Escanteios
                </span>
                {windows.filter(w => w.market === 'escanteios').map(renderWindowRow)}
              </div>
            </div>
          )}
        </div>

        {/* Ferramentas Section */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 12 }}>
            Ferramentas
          </span>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a 
              href="/bet365-bridge.zip"
              download="bet365-bridge.zip"
              className="nav-item"
              style={{ textDecoration: 'none' }}
              onClick={closeSidebar}
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
              }}>DOWNLOAD</span>
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
