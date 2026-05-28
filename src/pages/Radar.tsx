import { useState, useEffect } from 'react';
import { Activity, Zap, Search, ShieldAlert } from 'lucide-react';

export default function Radar() {
  const [isLockdown, setIsLockdown] = useState(false);

  // Mock function to simulate hitting the stop win
  const triggerLockdown = () => {
    setIsLockdown(true);
  };

  return (
    <div>
      {/* Lockdown Overlay */}
      {isLockdown && (
        <div className="lockdown-overlay">
          <div className="lockdown-content glass-panel">
            <div className="lockdown-icon win">
              <ShieldAlert size={40} />
            </div>
            <h1 style={{ fontSize: '2rem', marginBottom: 16, color: 'var(--status-green)' }}>Meta Batida!</h1>
            <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Você atingiu sua meta diária de lucros. O sistema ativou a proteção para evitar overbetting e devolver seus ganhos ao mercado.
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 32 }}>
              A interface do radar ficará bloqueada até amanhã. Vá descansar!
            </p>
            <button className="btn btn-outline" onClick={() => setIsLockdown(false)}>Desbloquear (Apenas para Testes)</button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            Radar Ao Vivo <Activity size={24} className="pulse-indicator" color="var(--status-green)" />
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Rastreamento de oportunidades em tempo real via API.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-outline" onClick={triggerLockdown} title="Simular Meta Batida">
            Testar Lockdown
          </button>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar jogo..." 
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '10px 10px 10px 36px', color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>
        </div>
      </div>

      {/* Live Matches List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Match Card 1 */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TEMPO</div>
              <div style={{ color: 'var(--status-green)', fontWeight: 700 }}>78'</div>
            </div>
            
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>Flamengo</span>
                <span style={{ fontWeight: 700, fontSize: '1.25rem' }}>1</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Palmeiras</span>
                <span style={{ color: 'var(--text-secondary)' }}>0</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
             {/* Stats Blocks */}
             <div style={{ textAlign: 'center' }}>
               <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CANTOS</div>
               <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>5 - 3</div>
             </div>
             <div style={{ textAlign: 'center' }}>
               <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ATAQUES PERIGOSOS</div>
               <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--status-yellow)' }}>64 - 21</div>
             </div>
             
             <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)', fontWeight: 600 }}>
                  <Zap size={16} /> Alerta de Canto (Final)
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Pressão alta nos últimos 10 min.</div>
             </div>
          </div>
        </div>

        {/* Match Card 2 */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', opacity: 0.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TEMPO</div>
              <div style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>Intervalo</div>
            </div>
            
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Man City</span>
                <span style={{ fontWeight: 700 }}>2</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Arsenal</span>
                <span style={{ fontWeight: 700 }}>2</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
             <div style={{ textAlign: 'center' }}>
               <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CANTOS</div>
               <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-secondary)' }}>4 - 4</div>
             </div>
             <div style={{ textAlign: 'center' }}>
               <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ATAQUES PERIGOSOS</div>
               <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-secondary)' }}>45 - 39</div>
             </div>
             
             <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 24, width: 230 }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Aguardando reinício para calcular pressão.</div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
