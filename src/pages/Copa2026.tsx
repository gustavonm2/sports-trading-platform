import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, BellOff, Filter, Clock, Trophy, Calendar, ChevronDown, Volume2, VolumeX, Zap, Star } from 'lucide-react';

// ─── Flag Emoji Map ───
const FLAGS: Record<string, string> = {
  'México': '🇲🇽', 'Coreia do Sul': '🇰🇷', 'África do Sul': '🇿🇦', 'R. Tcheca': '🇨🇿',
  'Canadá': '🇨🇦', 'Bósnia': '🇧🇦', 'Catar': '🇶🇦', 'Suíça': '🇨🇭',
  'Brasil': '🇧🇷', 'Marrocos': '🇲🇦', 'Escócia': '🏴', 'Haiti': '🇭🇹',
  'EUA': '🇺🇸', 'Paraguai': '🇵🇾', 'Austrália': '🇦🇺', 'Turquia': '🇹🇷',
  'Alemanha': '🇩🇪', 'Curaçao': '🇨🇼', 'C. do Marfim': '🇨🇮', 'Equador': '🇪🇨',
  'Holanda': '🇳🇱', 'Japão': '🇯🇵', 'Suécia': '🇸🇪', 'Tunísia': '🇹🇳',
  'Bélgica': '🇧🇪', 'Egito': '🇪🇬', 'Irã': '🇮🇷', 'N. Zelândia': '🇳🇿',
  'Espanha': '🇪🇸', 'Cabo Verde': '🇨🇻', 'A. Saudita': '🇸🇦', 'Uruguai': '🇺🇾',
  'França': '🇫🇷', 'Senegal': '🇸🇳', 'Iraque': '🇮🇶', 'Noruega': '🇳🇴',
  'Argentina': '🇦🇷', 'Argélia': '🇩🇿', 'Áustria': '🇦🇹', 'Jordânia': '🇯🇴',
  'Portugal': '🇵🇹', 'R.D. Congo': '🇨🇩', 'Uzbequistão': '🇺🇿', 'Colômbia': '🇨🇴',
  'Inglaterra': '🏴', 'Croácia': '🇭🇷', 'Gana': '🇬🇭', 'Panamá': '🇵🇦',
  'CDM': '🏆',
};

// ─── Match Data Types ───
interface Match {
  id: string;
  home: string;
  away: string;
  date: Date;
  group: string;
}

interface GroupData {
  name: string;
  teams: string[];
  gradient: string;
  matches: Match[];
}

// ─── Helper: create a match date in Brazil Time (UTC-3) ───
function brDate(day: number, month: number, hour: number, minute: number = 0): Date {
  return new Date(Date.UTC(2026, month - 1, day, hour + 3, minute, 0));
}

// ─── Group Gradients ───
const GROUP_GRADIENTS: Record<string, string> = {
  A: 'linear-gradient(135deg, #065f46, #059669)',
  B: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
  C: 'linear-gradient(135deg, #1e40af, #3b82f6)',
  D: 'linear-gradient(135deg, #7c2d12, #ea580c)',
  E: 'linear-gradient(135deg, #581c87, #9333ea)',
  F: 'linear-gradient(135deg, #9a3412, #f97316)',
  G: 'linear-gradient(135deg, #991b1b, #dc2626)',
  H: 'linear-gradient(135deg, #854d0e, #eab308)',
  I: 'linear-gradient(135deg, #0e7490, #06b6d4)',
  J: 'linear-gradient(135deg, #4338ca, #6366f1)',
  K: 'linear-gradient(135deg, #be123c, #f43f5e)',
  L: 'linear-gradient(135deg, #166534, #22c55e)',
};

// ─── All Group Stage Match Data ───
function buildGroups(): GroupData[] {
  const groups: GroupData[] = [
    {
      name: 'A',
      teams: ['México', 'Coreia do Sul', 'África do Sul', 'R. Tcheca'],
      gradient: GROUP_GRADIENTS.A,
      matches: [
        { id: 'A1', home: 'México', away: 'África do Sul', date: brDate(11, 6, 14), group: 'A' },
        { id: 'A2', home: 'Coreia do Sul', away: 'R. Tcheca', date: brDate(11, 6, 23), group: 'A' },
        { id: 'A3', home: 'R. Tcheca', away: 'África do Sul', date: brDate(18, 6, 16), group: 'A' },
        { id: 'A4', home: 'México', away: 'Coreia do Sul', date: brDate(18, 6, 16), group: 'A' },
        { id: 'A5', home: 'R. Tcheca', away: 'México', date: brDate(24, 6, 16), group: 'A' },
        { id: 'A6', home: 'África do Sul', away: 'Coreia do Sul', date: brDate(24, 6, 16), group: 'A' },
      ],
    },
    {
      name: 'B',
      teams: ['Canadá', 'Bósnia', 'Catar', 'Suíça'],
      gradient: GROUP_GRADIENTS.B,
      matches: [
        { id: 'B1', home: 'Canadá', away: 'Bósnia', date: brDate(12, 6, 16), group: 'B' },
        { id: 'B2', home: 'Catar', away: 'Suíça', date: brDate(13, 6, 16), group: 'B' },
        { id: 'B3', home: 'Suíça', away: 'Bósnia', date: brDate(18, 6, 16), group: 'B' },
        { id: 'B4', home: 'Canadá', away: 'Catar', date: brDate(18, 6, 16), group: 'B' },
        { id: 'B5', home: 'Suíça', away: 'Canadá', date: brDate(24, 6, 16), group: 'B' },
        { id: 'B6', home: 'Bósnia', away: 'Catar', date: brDate(24, 6, 16), group: 'B' },
      ],
    },
    {
      name: 'C',
      teams: ['Brasil', 'Marrocos', 'Escócia', 'Haiti'],
      gradient: GROUP_GRADIENTS.C,
      matches: [
        { id: 'C1', home: 'Brasil', away: 'Marrocos', date: brDate(13, 6, 16), group: 'C' },
        { id: 'C2', home: 'Haiti', away: 'Escócia', date: brDate(13, 6, 16), group: 'C' },
        { id: 'C3', home: 'Escócia', away: 'Marrocos', date: brDate(19, 6, 16), group: 'C' },
        { id: 'C4', home: 'Brasil', away: 'Haiti', date: brDate(19, 6, 21, 30), group: 'C' },
        { id: 'C5', home: 'Escócia', away: 'Brasil', date: brDate(24, 6, 16), group: 'C' },
        { id: 'C6', home: 'Marrocos', away: 'Haiti', date: brDate(24, 6, 16), group: 'C' },
      ],
    },
    {
      name: 'D',
      teams: ['EUA', 'Paraguai', 'Austrália', 'Turquia'],
      gradient: GROUP_GRADIENTS.D,
      matches: [
        { id: 'D1', home: 'EUA', away: 'Paraguai', date: brDate(12, 6, 16), group: 'D' },
        { id: 'D2', home: 'Austrália', away: 'Turquia', date: brDate(14, 6, 16), group: 'D' },
        { id: 'D3', home: 'Turquia', away: 'Paraguai', date: brDate(19, 6, 16), group: 'D' },
        { id: 'D4', home: 'EUA', away: 'Austrália', date: brDate(19, 6, 16), group: 'D' },
        { id: 'D5', home: 'Paraguai', away: 'Austrália', date: brDate(25, 6, 16), group: 'D' },
        { id: 'D6', home: 'Turquia', away: 'EUA', date: brDate(25, 6, 16), group: 'D' },
      ],
    },
    {
      name: 'E',
      teams: ['Alemanha', 'Curaçao', 'C. do Marfim', 'Equador'],
      gradient: GROUP_GRADIENTS.E,
      matches: [
        { id: 'E1', home: 'Alemanha', away: 'Curaçao', date: brDate(14, 6, 14), group: 'E' },
        { id: 'E2', home: 'C. do Marfim', away: 'Equador', date: brDate(14, 6, 16), group: 'E' },
        { id: 'E3', home: 'Alemanha', away: 'C. do Marfim', date: brDate(20, 6, 16), group: 'E' },
        { id: 'E4', home: 'Curaçao', away: 'Equador', date: brDate(20, 6, 16), group: 'E' },
        { id: 'E5', home: 'Equador', away: 'Alemanha', date: brDate(25, 6, 16), group: 'E' },
        { id: 'E6', home: 'C. do Marfim', away: 'Curaçao', date: brDate(25, 6, 16), group: 'E' },
      ],
    },
    {
      name: 'F',
      teams: ['Holanda', 'Japão', 'Suécia', 'Tunísia'],
      gradient: GROUP_GRADIENTS.F,
      matches: [
        { id: 'F1', home: 'Holanda', away: 'Japão', date: brDate(14, 6, 16), group: 'F' },
        { id: 'F2', home: 'Suécia', away: 'Tunísia', date: brDate(14, 6, 16), group: 'F' },
        { id: 'F3', home: 'Tunísia', away: 'Japão', date: brDate(20, 6, 16), group: 'F' },
        { id: 'F4', home: 'Holanda', away: 'Suécia', date: brDate(20, 6, 16), group: 'F' },
        { id: 'F5', home: 'Japão', away: 'Suécia', date: brDate(25, 6, 16), group: 'F' },
        { id: 'F6', home: 'Tunísia', away: 'Holanda', date: brDate(25, 6, 16), group: 'F' },
      ],
    },
    {
      name: 'G',
      teams: ['Bélgica', 'Egito', 'Irã', 'N. Zelândia'],
      gradient: GROUP_GRADIENTS.G,
      matches: [
        { id: 'G1', home: 'Bélgica', away: 'Egito', date: brDate(15, 6, 16), group: 'G' },
        { id: 'G2', home: 'Irã', away: 'N. Zelândia', date: brDate(15, 6, 18), group: 'G' },
        { id: 'G3', home: 'Bélgica', away: 'Irã', date: brDate(21, 6, 16), group: 'G' },
        { id: 'G4', home: 'N. Zelândia', away: 'Egito', date: brDate(21, 6, 16), group: 'G' },
        { id: 'G5', home: 'N. Zelândia', away: 'Bélgica', date: brDate(27, 6, 16), group: 'G' },
        { id: 'G6', home: 'Egito', away: 'Irã', date: brDate(27, 6, 16), group: 'G' },
      ],
    },
    {
      name: 'H',
      teams: ['Espanha', 'Cabo Verde', 'A. Saudita', 'Uruguai'],
      gradient: GROUP_GRADIENTS.H,
      matches: [
        { id: 'H1', home: 'Espanha', away: 'Cabo Verde', date: brDate(15, 6, 16), group: 'H' },
        { id: 'H2', home: 'A. Saudita', away: 'Uruguai', date: brDate(15, 6, 16), group: 'H' },
        { id: 'H3', home: 'Uruguai', away: 'Espanha', date: brDate(21, 6, 16), group: 'H' },
        { id: 'H4', home: 'Cabo Verde', away: 'A. Saudita', date: brDate(21, 6, 16), group: 'H' },
        { id: 'H5', home: 'Uruguai', away: 'Cabo Verde', date: brDate(26, 6, 16), group: 'H' },
        { id: 'H6', home: 'Espanha', away: 'A. Saudita', date: brDate(26, 6, 16), group: 'H' },
      ],
    },
    {
      name: 'I',
      teams: ['França', 'Senegal', 'Iraque', 'Noruega'],
      gradient: GROUP_GRADIENTS.I,
      matches: [
        { id: 'I1', home: 'França', away: 'Senegal', date: brDate(16, 6, 16), group: 'I' },
        { id: 'I2', home: 'Iraque', away: 'Noruega', date: brDate(16, 6, 16), group: 'I' },
        { id: 'I3', home: 'França', away: 'Iraque', date: brDate(18, 6, 16), group: 'I' },
        { id: 'I4', home: 'Noruega', away: 'Senegal', date: brDate(22, 6, 16), group: 'I' },
        { id: 'I5', home: 'Noruega', away: 'França', date: brDate(26, 6, 16), group: 'I' },
        { id: 'I6', home: 'Senegal', away: 'Iraque', date: brDate(26, 6, 16), group: 'I' },
      ],
    },
    {
      name: 'J',
      teams: ['Argentina', 'Argélia', 'Áustria', 'Jordânia'],
      gradient: GROUP_GRADIENTS.J,
      matches: [
        { id: 'J1', home: 'Argentina', away: 'Argélia', date: brDate(16, 6, 16), group: 'J' },
        { id: 'J2', home: 'Áustria', away: 'Jordânia', date: brDate(17, 6, 14), group: 'J' },
        { id: 'J3', home: 'Argentina', away: 'Áustria', date: brDate(23, 6, 16), group: 'J' },
        { id: 'J4', home: 'Jordânia', away: 'Argélia', date: brDate(23, 6, 16), group: 'J' },
        { id: 'J5', home: 'Jordânia', away: 'Argentina', date: brDate(27, 6, 16), group: 'J' },
        { id: 'J6', home: 'Argélia', away: 'Áustria', date: brDate(27, 6, 16), group: 'J' },
      ],
    },
    {
      name: 'K',
      teams: ['Portugal', 'R.D. Congo', 'Uzbequistão', 'Colômbia'],
      gradient: GROUP_GRADIENTS.K,
      matches: [
        { id: 'K1', home: 'Portugal', away: 'R.D. Congo', date: brDate(17, 6, 16), group: 'K' },
        { id: 'K2', home: 'Uzbequistão', away: 'Colômbia', date: brDate(17, 6, 16), group: 'K' },
        { id: 'K3', home: 'Portugal', away: 'Uzbequistão', date: brDate(23, 6, 16), group: 'K' },
        { id: 'K4', home: 'Colômbia', away: 'R.D. Congo', date: brDate(23, 6, 16), group: 'K' },
        { id: 'K5', home: 'Colômbia', away: 'Portugal', date: brDate(27, 6, 16), group: 'K' },
        { id: 'K6', home: 'R.D. Congo', away: 'Uzbequistão', date: brDate(20, 6, 16), group: 'K' },
      ],
    },
    {
      name: 'L',
      teams: ['Inglaterra', 'Croácia', 'Gana', 'Panamá'],
      gradient: GROUP_GRADIENTS.L,
      matches: [
        { id: 'L1', home: 'Inglaterra', away: 'Croácia', date: brDate(17, 6, 16), group: 'L' },
        { id: 'L2', home: 'Gana', away: 'Panamá', date: brDate(17, 6, 16), group: 'L' },
        { id: 'L3', home: 'Inglaterra', away: 'Gana', date: brDate(23, 6, 16), group: 'L' },
        { id: 'L4', home: 'Panamá', away: 'Croácia', date: brDate(23, 6, 16), group: 'L' },
        { id: 'L5', home: 'Panamá', away: 'Inglaterra', date: brDate(27, 6, 16), group: 'L' },
        { id: 'L6', home: 'Croácia', away: 'Gana', date: brDate(27, 6, 16), group: 'L' },
      ],
    },
  ];
  return groups;
}

// ─── Match Status ───
type MatchStatus = 'upcoming' | 'live' | 'finished';

function getMatchStatus(matchDate: Date, now: Date): MatchStatus {
  const diffMs = matchDate.getTime() - now.getTime();
  if (diffMs > 0) return 'upcoming';
  // assume match lasts ~2h
  if (diffMs > -2 * 60 * 60 * 1000) return 'live';
  return 'finished';
}

// ─── Countdown formatter ───
function formatCountdown(diffMs: number): string {
  if (diffMs <= 0) return '';
  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

// ─── Sound alert via AudioContext ───
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';

    // Play a pleasant two-tone chime
    osc.frequency.setValueAtTime(830, ctx.currentTime);
    osc.frequency.setValueAtTime(1050, ctx.currentTime + 0.12);
    osc.frequency.setValueAtTime(830, ctx.currentTime + 0.24);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // AudioContext not available
  }
}

// ─── Keyframes injection ───
const STYLE_ID = 'copa2026-keyframes';
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes copa-pulse-live {
      0%, 100% { box-shadow: 0 0 0 0 rgba(5, 150, 105, 0.4); }
      50% { box-shadow: 0 0 0 8px rgba(5, 150, 105, 0); }
    }
    @keyframes copa-dot-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.5); }
    }
    @keyframes copa-slide-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes copa-glow {
      0%, 100% { box-shadow: 0 0 20px rgba(37, 99, 235, 0.15); }
      50% { box-shadow: 0 0 30px rgba(37, 99, 235, 0.3); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main Component ───
export default function Copa2026() {
  const [now, setNow] = useState(() => new Date());
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    const saved = localStorage.getItem('copa2026_notifications');
    return saved !== 'false';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groups = useRef(buildGroups()).current;
  const allMatches = useRef(groups.flatMap(g => g.matches)).current;

  // Inject CSS keyframes
  useEffect(() => {
    injectKeyframes();
  }, []);

  // Main tick timer (every second)
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Request notification permission
  useEffect(() => {
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [notificationsEnabled]);

  // Save notification preference
  useEffect(() => {
    localStorage.setItem('copa2026_notifications', String(notificationsEnabled));
  }, [notificationsEnabled]);

  // Notification checker
  const sendMatchNotification = useCallback((match: Match, minutesBefore: number) => {
    const key = `${match.id}-${minutesBefore}`;
    if (notifiedRef.current.has(key)) return;
    notifiedRef.current.add(key);

    const homeFlag = FLAGS[match.home] || '';
    const awayFlag = FLAGS[match.away] || '';
    const title = minutesBefore === 15
      ? `⚽ Jogo em 15 minutos!`
      : `🔥 Jogo em 5 minutos!`;
    const body = `${homeFlag} ${match.home} x ${match.away} ${awayFlag} — Grupo ${match.group}`;

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '⚽' });
    }
    playNotificationSound();
  }, []);

  useEffect(() => {
    if (!notificationsEnabled) return;

    allMatches.forEach(match => {
      const diffMs = match.date.getTime() - now.getTime();
      const diffMin = diffMs / (1000 * 60);

      if (diffMin > 0 && diffMin <= 15 && diffMin > 5) {
        sendMatchNotification(match, 15);
      }
      if (diffMin > 0 && diffMin <= 5) {
        sendMatchNotification(match, 5);
      }
    });
  }, [now, notificationsEnabled, allMatches, sendMatchNotification]);

  // ─── Derived data ───
  const todayStr = now.toDateString();
  const todayMatches = allMatches.filter(m => {
    // Convert match date to local date string
    const matchLocal = new Date(m.date);
    return matchLocal.toDateString() === todayStr;
  });

  const filteredGroups = selectedGroup === 'all'
    ? groups
    : groups.filter(g => g.name === selectedGroup);

  // Stats
  const upcomingCount = allMatches.filter(m => getMatchStatus(m.date, now) === 'upcoming').length;
  const liveCount = allMatches.filter(m => getMatchStatus(m.date, now) === 'live').length;
  const finishedCount = allMatches.filter(m => getMatchStatus(m.date, now) === 'finished').length;

  // Next match
  const nextMatch = allMatches
    .filter(m => m.date.getTime() > now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0] || null;

  const nextMatchDiff = nextMatch ? nextMatch.date.getTime() - now.getTime() : 0;

  // ─── Render helpers ───
  function renderStatusBadge(status: MatchStatus) {
    const styles: Record<MatchStatus, React.CSSProperties> = {
      upcoming: {
        background: 'rgba(37, 99, 235, 0.1)',
        color: '#2563eb',
        border: '1px solid rgba(37, 99, 235, 0.2)',
      },
      live: {
        background: 'rgba(5, 150, 105, 0.1)',
        color: '#059669',
        border: '1px solid rgba(5, 150, 105, 0.3)',
        animation: 'copa-pulse-live 2s infinite',
      },
      finished: {
        background: 'rgba(100, 116, 139, 0.1)',
        color: '#64748b',
        border: '1px solid rgba(100, 116, 139, 0.2)',
      },
    };
    const labels: Record<MatchStatus, string> = {
      upcoming: 'EM BREVE',
      live: '🔴 AO VIVO',
      finished: 'ENCERRADO',
    };
    return (
      <span style={{
        ...styles[status],
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}>
        {status === 'live' && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#059669',
            animation: 'copa-dot-pulse 1.5s infinite',
            display: 'inline-block',
          }} />
        )}
        {labels[status]}
      </span>
    );
  }

  function renderMatchCard(match: Match, highlight = false) {
    const status = getMatchStatus(match.date, now);
    const diffMs = match.date.getTime() - now.getTime();
    const homeFlag = FLAGS[match.home] || '🏳️';
    const awayFlag = FLAGS[match.away] || '🏳️';

    const borderLeft = status === 'live'
      ? '3px solid #059669'
      : status === 'upcoming'
        ? '3px solid #2563eb'
        : '3px solid #e2e8f0';

    return (
      <div
        key={match.id}
        style={{
          background: highlight
            ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.04), rgba(37, 99, 235, 0.02))'
            : 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderLeft,
          borderRadius: 10,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          transition: 'all 0.2s ease',
          animation: 'copa-slide-in 0.3s ease-out',
          opacity: status === 'finished' ? 0.6 : 1,
          cursor: 'default',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(15,23,42,0.06)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        }}
      >
        {/* Teams */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            {/* Home */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{homeFlag}</span>
              <span style={{
                fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{match.home}</span>
            </div>
            {/* Away */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{awayFlag}</span>
              <span style={{
                fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{match.away}</span>
            </div>
          </div>
        </div>

        {/* VS Divider */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '0 8px',
        }}>
          <span style={{
            fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)',
            letterSpacing: '0.1em',
          }}>VS</span>
        </div>

        {/* Date / Time / Countdown */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
          minWidth: 130,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={12} color="var(--text-muted)" />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {match.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
            <span style={{
              fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 700,
              background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4,
            }}>
              {match.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Status badge */}
          {renderStatusBadge(status)}

          {/* Countdown */}
          {status === 'upcoming' && diffMs > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.72rem', color: '#2563eb', fontWeight: 700,
              fontFamily: 'monospace',
            }}>
              <Clock size={11} />
              {formatCountdown(diffMs)}
            </div>
          )}

          {status === 'live' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.72rem', color: '#059669', fontWeight: 700,
            }}>
              <Zap size={11} />
              Em andamento
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Main render ───
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40,
      fontFamily: 'var(--font-sans)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <Trophy size={28} color="#2563eb" />
            <h1 style={{
              fontSize: '1.75rem', fontWeight: 800,
              fontFamily: 'var(--font-display, var(--font-sans))',
              background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
            }}>
              Copa do Mundo 2026
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Calendário completo da fase de grupos · EUA / México / Canadá
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Notification toggle */}
          <button
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8,
              background: notificationsEnabled ? 'rgba(37, 99, 235, 0.08)' : 'var(--bg-elevated)',
              border: `1px solid ${notificationsEnabled ? 'rgba(37, 99, 235, 0.2)' : 'var(--border-color)'}`,
              color: notificationsEnabled ? '#2563eb' : 'var(--text-secondary)',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
              fontFamily: 'var(--font-sans)',
              transition: 'all 0.2s ease',
            }}
          >
            {notificationsEnabled
              ? <><Bell size={15} /> <Volume2 size={13} /> Alertas ON</>
              : <><BellOff size={15} /> <VolumeX size={13} /> Alertas OFF</>
            }
          </button>

          {/* Group filter dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.2s ease',
              }}
            >
              <Filter size={15} />
              {selectedGroup === 'all' ? 'Todos os Grupos' : `Grupo ${selectedGroup}`}
              <ChevronDown size={14} style={{
                transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.2s ease',
              }} />
            </button>

            {dropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 10, padding: 6, zIndex: 100,
                minWidth: 160,
                boxShadow: '0 8px 24px rgba(15,23,42,0.1)',
                animation: 'copa-slide-in 0.15s ease-out',
              }}>
                <div
                  onClick={() => { setSelectedGroup('all'); setDropdownOpen(false); }}
                  style={{
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    fontSize: '0.82rem', fontWeight: selectedGroup === 'all' ? 700 : 500,
                    color: selectedGroup === 'all' ? '#2563eb' : 'var(--text-secondary)',
                    background: selectedGroup === 'all' ? 'rgba(37,99,235,0.06)' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={e => (e.currentTarget.style.background = selectedGroup === 'all' ? 'rgba(37,99,235,0.06)' : 'transparent')}
                >
                  Todos os Grupos
                </div>
                {groups.map(g => (
                  <div
                    key={g.name}
                    onClick={() => { setSelectedGroup(g.name); setDropdownOpen(false); }}
                    style={{
                      padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                      fontSize: '0.82rem', fontWeight: selectedGroup === g.name ? 700 : 500,
                      color: selectedGroup === g.name ? '#2563eb' : 'var(--text-secondary)',
                      background: selectedGroup === g.name ? 'rgba(37,99,235,0.06)' : 'transparent',
                      display: 'flex', alignItems: 'center', gap: 8,
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={e => (e.currentTarget.style.background = selectedGroup === g.name ? 'rgba(37,99,235,0.06)' : 'transparent')}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: g.gradient, display: 'inline-block',
                    }} />
                    Grupo {g.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
      }}>
        {/* Next Match Countdown */}
        {nextMatch && (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(37, 99, 235, 0.15)',
            borderRadius: 12, padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 8,
            animation: 'copa-glow 3s infinite',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <Star size={14} color="#2563eb" />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Próximo Jogo
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {FLAGS[nextMatch.home]} {nextMatch.home} x {nextMatch.away} {FLAGS[nextMatch.away]}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '1.35rem', fontWeight: 800, color: '#1e3a8a' }}>
              {formatCountdown(nextMatchDiff)}
            </div>
          </div>
        )}

        {/* Stats cards */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(37, 99, 235, 0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Clock size={20} color="#2563eb" />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{upcomingCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Jogos Restantes</div>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(5, 150, 105, 0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={20} color="#059669" />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: liveCount > 0 ? '#059669' : 'var(--text-primary)' }}>{liveCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Ao Vivo Agora</div>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(100, 116, 139, 0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Trophy size={20} color="#64748b" />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{finishedCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Encerrados</div>
          </div>
        </div>
      </div>

      {/* ── Today's Matches ── */}
      {todayMatches.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.03), rgba(59, 130, 246, 0.02))',
          border: '1px solid rgba(37, 99, 235, 0.12)',
          borderRadius: 14, padding: 20,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          }}>
            <div style={{
              background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
              borderRadius: 8, padding: '6px 12px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Calendar size={14} color="#fff" />
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Jogos de Hoje
              </span>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {todayMatches
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .map(m => renderMatchCard(m, true))}
          </div>
        </div>
      )}

      {/* ── Group Sections ── */}
      {filteredGroups.map(group => (
        <div key={group.name} style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}>
          {/* Group Header */}
          <div style={{
            background: group.gradient,
            padding: '16px 22px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 8, padding: '4px 12px',
                fontSize: '0.85rem', fontWeight: 800, color: '#fff',
                letterSpacing: '0.05em',
              }}>
                GRUPO {group.name}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {group.teams.map(t => (
                  <span key={t} style={{
                    fontSize: '1.15rem',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
                  }} title={t}>
                    {FLAGS[t] || '🏳️'}
                  </span>
                ))}
              </div>
            </div>
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end',
            }}>
              {group.teams.map(t => (
                <span key={t} style={{
                  fontSize: '0.7rem', color: 'rgba(255,255,255,0.85)',
                  fontWeight: 600, background: 'rgba(255,255,255,0.12)',
                  padding: '2px 8px', borderRadius: 4,
                }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Matches */}
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {group.matches
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .map(m => renderMatchCard(m))}
          </div>
        </div>
      ))}

      {/* ── Footer ── */}
      <div style={{
        textAlign: 'center', padding: '20px 0',
        color: 'var(--text-muted)', fontSize: '0.75rem',
      }}>
        <p style={{ fontWeight: 600 }}>⚽ FIFA World Cup 2026™ — Horários em Brasília (UTC-3)</p>
        <p style={{ marginTop: 4, opacity: 0.7 }}>
          {allMatches.length} jogos da fase de grupos · {groups.length} grupos · 48 seleções
        </p>
      </div>
    </div>
  );
}
