import { useState, useCallback, useEffect } from 'react';
import { sendTelegramMessage } from '../services/telegramNotifier';
import { supabase } from '../services/supabase';

// ─── Interface ───────────────────────────────────────────────────────────────

export interface TelegramAlertConfig {
  // Estratégias ON/OFF
  strategyCanto: boolean;
  strategyGols: boolean;
  strategyVirada: boolean;
  strategyFunil: boolean;

  // Filtros gerais
  minConfidence: number;
  minScore: number;
  onlyFavorites: boolean;

  // Filtro de ligas
  excludeYouth: boolean;

  // Filtro de tempo
  period: 'both' | '1h' | '2h';
  minMinute: number;
  maxMinute: number;

  // Filtro de métricas
  minCorners: number;
  minPossession: number;
  minDangerousAttacks: number;
  minShotsOnGoal: number;

  // Filtro de placar
  maxGoalDifference: number;

  // Funil strategy specific
  funilMinScoreDiff: number;
  funilTeamStatus: 'drawing_or_losing' | 'any';
}

// ─── Defaults & persistence ─────────────────────────────────────────────────

const STORAGE_KEY = 'telegram_alert_config';

export function getDefaultAlertConfig(): TelegramAlertConfig {
  return {
    strategyCanto: true,
    strategyGols: true,
    strategyVirada: false,
    strategyFunil: true,
    minConfidence: 70,
    minScore: 7.0,
    onlyFavorites: false,
    excludeYouth: true,
    period: 'both',
    minMinute: 25,
    maxMinute: 85,
    minCorners: 3,
    minPossession: 45,
    minDangerousAttacks: 30,
    minShotsOnGoal: 2,
    maxGoalDifference: 2,
    funilMinScoreDiff: 2,
    funilTeamStatus: 'drawing_or_losing',
  };
}

export function loadAlertConfig(): TelegramAlertConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...getDefaultAlertConfig(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return getDefaultAlertConfig();
}

export function saveAlertConfig(config: TelegramAlertConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '8px 16px 80px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)',
    minHeight: '100vh',
  } as React.CSSProperties,

  header: {
    textAlign: 'center' as const,
    marginBottom: 28,
  } as React.CSSProperties,

  title: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.6rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: 0,
  } as React.CSSProperties,

  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    marginTop: 6,
  } as React.CSSProperties,

  section: {
    marginBottom: 20,
  } as React.CSSProperties,

  sectionTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.05rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 10,
    letterSpacing: '-0.01em',
  } as React.CSSProperties,

  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
    padding: 18,
    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
  } as React.CSSProperties,

  strategyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 10,
  } as React.CSSProperties,

  strategyCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 14,
    padding: '14px 16px',
  } as React.CSSProperties,

  strategyInfo: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,

  strategyName: {
    fontWeight: 600,
    fontSize: '0.92rem',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as React.CSSProperties,

  strategyDesc: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    marginTop: 2,
    lineHeight: 1.3,
  } as React.CSSProperties,

  toggleOn: {
    background: 'var(--status-green)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontWeight: 700,
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    minWidth: 52,
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  toggleOff: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontWeight: 700,
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    minWidth: 52,
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid var(--border-color)',
  } as React.CSSProperties,

  rowLast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
  } as React.CSSProperties,

  rowLabel: {
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
    fontWeight: 500,
  } as React.CSSProperties,

  rowValue: {
    fontSize: '0.88rem',
    fontWeight: 700,
    color: 'var(--accent-primary)',
    minWidth: 40,
    textAlign: 'right' as const,
  } as React.CSSProperties,

  slider: {
    width: '100%',
    height: 6,
    marginTop: 4,
    cursor: 'pointer',
    borderRadius: 3,
    WebkitAppearance: 'none' as any,
    appearance: 'none' as any,
    background: 'var(--bg-elevated)',
  } as React.CSSProperties,

  periodGroup: {
    display: 'flex',
    gap: 6,
    marginBottom: 12,
  } as React.CSSProperties,

  periodBtn: (active: boolean) =>
    ({
      flex: 1,
      padding: '8px 0',
      border: 'none',
      borderRadius: 8,
      fontWeight: 600,
      fontSize: '0.82rem',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      transition: 'all 0.15s ease',
      background: active ? 'var(--accent-primary)' : 'var(--bg-elevated)',
      color: active ? '#fff' : 'var(--text-muted)',
    }) as React.CSSProperties,

  testBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '14px 0',
    border: 'none',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
    color: '#fff',
    boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,

  testStatus: {
    textAlign: 'center' as const,
    fontSize: '0.82rem',
    marginTop: 8,
    fontWeight: 500,
  } as React.CSSProperties,
};

// ─── Tiny helper components ──────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  accentColor,
  onChange,
  isLast,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  accentColor?: string;
  onChange: (v: number) => void;
  isLast?: boolean;
}) {
  const display = format ? format(value) : String(value);
  return (
    <div style={isLast ? s.rowLast : s.row}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={s.rowLabel}>{label}</span>
          <span style={s.rowValue}>{display}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...s.slider, accentColor: accentColor || 'var(--accent-primary)' }}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  isLast,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  isLast?: boolean;
}) {
  return (
    <div style={isLast ? s.rowLast : s.row}>
      <span style={s.rowLabel}>{label}</span>
      <button style={value ? s.toggleOn : s.toggleOff} onClick={() => onChange(!value)}>
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

// ─── Strategy metadata ──────────────────────────────────────────────────────

const strategies: {
  key: 'strategyCanto' | 'strategyGols' | 'strategyVirada' | 'strategyFunil';
  emoji: string;
  name: string;
  desc: string;
}[] = [
  {
    key: 'strategyCanto',
    emoji: '🚩',
    name: 'Canto Limite',
    desc: 'Score ≥ gatilho + histerese + confirmação',
  },
  {
    key: 'strategyGols',
    emoji: '⚽',
    name: 'Over 0.5 Gols HT',
    desc: 'IIM ≥ 1.4, chutes ≥ 3, placar 0-0',
  },
  {
    key: 'strategyVirada',
    emoji: '⚽',
    name: 'Virada do Favorito',
    desc: 'Favorito perdendo com posse ≥ 60%',
  },
  {
    key: 'strategyFunil',
    emoji: '🔻',
    name: 'Funil (Domínio)',
    desc: 'Time dominante (diff ≥ 2) empatando/perdendo',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AlertConfig() {
  const [config, setConfig] = useState<TelegramAlertConfig>(loadAlertConfig);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');

  // 🔄 Carregar configurações do Supabase ao montar
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('telegram_alert_config')
          .select('config')
          .eq('id', 'default')
          .single();
        if (error || !data || !data.config) return;
        const cloudConfig = data.config as TelegramAlertConfig;
        setConfig(cloudConfig);
        saveAlertConfig(cloudConfig); // atualiza cache local
        console.log('✅ Telegram alert config loaded from Supabase');
      } catch (e) {
        console.warn('⚠️ Supabase telegram_alert_config not available, using localStorage fallback');
      }
    })();
  }, []);

  const update = useCallback(
    (patch: Partial<TelegramAlertConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        saveAlertConfig(next);

        // Salvar no Supabase (Upsert assíncrono)
        supabase
          .from('telegram_alert_config')
          .upsert({ id: 'default', config: next })
          .then(({ error }) => {
            if (error) {
              console.warn('[Supabase] Erro ao salvar config de alertas:', error.message);
            }
          });

        return next;
      });
    },
    [],
  );

  const handleTest = useCallback(async () => {
    setTestStatus('sending');
    try {
      const lines = [
        '🧪 <b>TESTE DE FILTROS</b>',
        '',
        '📲 Seus filtros de alerta estão configurados:',
        `  🚩 Canto Limite: ${config.strategyCanto ? '✅' : '❌'}`,
        `  ⚽ Over 0.5 HT: ${config.strategyGols ? '✅' : '❌'}`,
        `  ⚽ Virada: ${config.strategyVirada ? '✅' : '❌'}`,
        `  🔻 Funil: ${config.strategyFunil ? '✅' : '❌'}`,
        '',
        `📊 Confiança ≥ ${config.minConfidence}% · Score ≥ ${config.minScore}`,
        `⏱️ Respeitando as janelas de tempo globais do sistema.`,
        '',
        '✅ Conexão OK! Alertas serão enviados aqui.',
      ];
      const ok = await sendTelegramMessage(lines.join('\n'));
      setTestStatus(ok ? 'ok' : 'error');
    } catch {
      setTestStatus('error');
    }
    setTimeout(() => setTestStatus('idle'), 4000);
  }, [config]);

  return (
    <div style={s.page}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={s.header}>
        <h1 style={s.title}>📲 Configuração de Alertas</h1>
        <p style={s.subtitle}>Personalize quais alertas você recebe no Telegram</p>
      </div>

      {/* ── 1. Estratégias ─────────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>🎯 Estratégias</h2>
        <div style={s.strategyGrid}>
          {strategies.map((st) => (
            <div key={st.key} style={s.strategyCard}>
              <span style={{ fontSize: '1.4rem' }}>{st.emoji}</span>
              <div style={s.strategyInfo}>
                <div style={s.strategyName}>{st.name}</div>
                <div style={s.strategyDesc}>{st.desc}</div>
              </div>
              <button
                style={config[st.key] ? s.toggleOn : s.toggleOff}
                onClick={() => update({ [st.key]: !config[st.key] })}
              >
                {config[st.key] ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. Filtros de Qualidade ────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>📊 Filtros de Qualidade</h2>
        <div style={s.card}>
          <SliderRow
            label="Confiança mínima"
            value={config.minConfidence}
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            accentColor="var(--status-green)"
            onChange={(v) => update({ minConfidence: v })}
          />
          <SliderRow
            label="Score mínimo para Telegram"
            value={config.minScore}
            min={4}
            max={10}
            step={0.5}
            format={(v) => v.toFixed(1)}
            accentColor="var(--accent-primary)"
            onChange={(v) => update({ minScore: v })}
            isLast
          />
        </div>
      </div>


      {/* ── 4. Filtro de Métricas ─────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>📈 Filtro de Métricas</h2>
        <div style={s.card}>
          <SliderRow
            label="Escanteios mínimos"
            value={config.minCorners}
            min={0}
            max={10}
            step={1}
            accentColor="var(--status-green)"
            onChange={(v) => update({ minCorners: v })}
          />
          <SliderRow
            label="Posse mínima %"
            value={config.minPossession}
            min={30}
            max={70}
            step={1}
            format={(v) => `${v}%`}
            accentColor="var(--accent-primary)"
            onChange={(v) => update({ minPossession: v })}
          />
          <SliderRow
            label="Ataques perigosos mín"
            value={config.minDangerousAttacks}
            min={0}
            max={80}
            step={1}
            accentColor="var(--status-red)"
            onChange={(v) => update({ minDangerousAttacks: v })}
          />
          <SliderRow
            label="Chutes a gol mín"
            value={config.minShotsOnGoal}
            min={0}
            max={10}
            step={1}
            accentColor="var(--status-yellow)"
            onChange={(v) => update({ minShotsOnGoal: v })}
            isLast
          />
        </div>
      </div>

      {/* ── 5. Filtro de Placar ────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>⚽ Filtro de Placar</h2>
        <div style={s.card}>
          <SliderRow
            label="Diferença máxima de gols"
            value={config.maxGoalDifference}
            min={1}
            max={5}
            step={1}
            accentColor="var(--status-red)"
            onChange={(v) => update({ maxGoalDifference: v })}
            isLast
          />
        </div>
      </div>

      {/* ── 6. Config Funil (conditional) ─────────────────────── */}
      {config.strategyFunil && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>🔻 Config Funil</h2>
          <div style={s.card}>
            <SliderRow
              label="Diferença mínima de Score"
              value={config.funilMinScoreDiff}
              min={1}
              max={5}
              step={0.5}
              format={(v) => v.toFixed(1)}
              accentColor="var(--accent-primary)"
              onChange={(v) => update({ funilMinScoreDiff: v })}
            />
            <div style={s.rowLast}>
              <span style={s.rowLabel}>Status do time dominante</span>
              <button
                style={
                  config.funilTeamStatus === 'drawing_or_losing' ? s.toggleOn : s.toggleOff
                }
                onClick={() =>
                  update({
                    funilTeamStatus:
                      config.funilTeamStatus === 'drawing_or_losing' ? 'any' : 'drawing_or_losing',
                  })
                }
              >
                {config.funilTeamStatus === 'drawing_or_losing' ? 'Emp/Perd' : 'Qualquer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. Filtro de Ligas ─────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>🏆 Filtro de Ligas</h2>
        <div style={s.card}>
          <ToggleRow
            label="Excluir ligas juvenis / sub"
            value={config.excludeYouth}
            onChange={(v) => update({ excludeYouth: v })}
            isLast
          />
        </div>
      </div>

      {/* ── 8. Testar ──────────────────────────────────────────── */}
      <div style={s.section}>
        <button
          style={{
            ...s.testBtn,
            opacity: testStatus === 'sending' ? 0.7 : 1,
            pointerEvents: testStatus === 'sending' ? 'none' : 'auto',
          }}
          onClick={handleTest}
        >
          🚀 {testStatus === 'sending' ? 'Enviando...' : 'Testar Alerta no Telegram'}
        </button>

        {testStatus === 'ok' && (
          <p style={{ ...s.testStatus, color: 'var(--status-green)' }}>
            ✅ Mensagem enviada com sucesso!
          </p>
        )}
        {testStatus === 'error' && (
          <p style={{ ...s.testStatus, color: 'var(--status-red)' }}>
            ❌ Falha ao enviar. Verifique token e chat ID.
          </p>
        )}
      </div>
    </div>
  );
}
