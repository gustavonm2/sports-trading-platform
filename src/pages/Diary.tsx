import { CheckCircle, XCircle } from 'lucide-react';

export default function Diary() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Diário de Entradas</h1>
          <p style={{ color: 'var(--text-muted)' }}>Registre suas entradas e mantenha a disciplina.</p>
        </div>
        <button className="btn btn-primary">Registrar Entrada</button>
      </div>

      <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Data/Hora</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Jogo</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Mercado</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Odd</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Stake</th>
              <th style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.875rem' }}>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>Hoje, 14:30</td>
              <td style={{ padding: '16px 24px', fontWeight: 500 }}>Flamengo x Palmeiras</td>
              <td style={{ padding: '16px 24px' }}>Canto Asiático O8.5</td>
              <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>@1.85</td>
              <td style={{ padding: '16px 24px' }}>R$ 200,00</td>
              <td style={{ padding: '16px 24px' }}>
                <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle size={14} /> GREEN (+R$170)
                </span>
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>Hoje, 11:15</td>
              <td style={{ padding: '16px 24px', fontWeight: 500 }}>Liverpool x Chelsea</td>
              <td style={{ padding: '16px 24px' }}>Over 1.5 HT</td>
              <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>@2.10</td>
              <td style={{ padding: '16px 24px' }}>R$ 150,00</td>
              <td style={{ padding: '16px 24px' }}>
                <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <XCircle size={14} /> RED (-R$150)
                </span>
              </td>
            </tr>
             <tr>
              <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>Ontem, 20:00</td>
              <td style={{ padding: '16px 24px', fontWeight: 500 }}>Boca Jrs x River</td>
              <td style={{ padding: '16px 24px' }}>Ambas Marcam</td>
              <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>@1.95</td>
              <td style={{ padding: '16px 24px' }}>R$ 200,00</td>
              <td style={{ padding: '16px 24px' }}>
                <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle size={14} /> GREEN (+R$190)
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
