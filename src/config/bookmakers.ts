// Centralized bookmaker configuration for quick betting links
// Each bookmaker has a name, short label, color scheme, and live football URL

export interface Bookmaker {
  id: string;
  name: string;
  shortName: string;
  liveUrl: string;
  color: string;
  bgColor: string;
  logo: string; // emoji or unicode symbol
  enabled: boolean;
}

export const BOOKMAKERS: Bookmaker[] = [
  {
    id: 'bet365',
    name: 'Bet365',
    shortName: '365',
    liveUrl: 'https://www.bet365.com/#/IP/B1/',
    color: '#127B3D',
    bgColor: 'rgba(18, 123, 61, 0.12)',
    logo: '🟢',
    enabled: true,
  },
  {
    id: 'betano',
    name: 'Betano',
    shortName: 'BTN',
    liveUrl: 'https://www.betano.bet.br/ao-vivo/futebol/',
    color: '#E4032E',
    bgColor: 'rgba(228, 3, 46, 0.10)',
    logo: '🔴',
    enabled: true,
  },
  {
    id: 'sportingbet',
    name: 'Sportingbet',
    shortName: 'SBT',
    liveUrl: 'https://www.sportingbet.bet.br/ao-vivo/futebol',
    color: '#00A651',
    bgColor: 'rgba(0, 166, 81, 0.10)',
    logo: '⚽',
    enabled: true,
  },
  {
    id: 'betfair',
    name: 'Betfair',
    shortName: 'BFR',
    liveUrl: 'https://www.betfair.com/exchange/plus/pt/futebol-ao-vivo',
    color: '#FFB80C',
    bgColor: 'rgba(255, 184, 12, 0.10)',
    logo: '🟡',
    enabled: true,
  },
  {
    id: 'pinnacle',
    name: 'Pinnacle',
    shortName: 'PIN',
    liveUrl: 'https://www.pinnacle.com/pt/football/live',
    color: '#1A3A5C',
    bgColor: 'rgba(26, 58, 92, 0.12)',
    logo: '🔵',
    enabled: false, // Disabled by default — user can enable
  },
  {
    id: 'stake',
    name: 'Stake',
    shortName: 'STK',
    liveUrl: 'https://stake.com/sports/soccer/live',
    color: '#1475E1',
    bgColor: 'rgba(20, 117, 225, 0.10)',
    logo: '💎',
    enabled: false,
  },
];

// Get only enabled bookmakers
export function getEnabledBookmakers(): Bookmaker[] {
  // Check localStorage for user preferences
  const saved = localStorage.getItem('enabled_bookmakers');
  if (saved) {
    try {
      const enabledIds: string[] = JSON.parse(saved);
      return BOOKMAKERS.filter(b => enabledIds.includes(b.id));
    } catch {
      // fallback to defaults
    }
  }
  return BOOKMAKERS.filter(b => b.enabled);
}

// Save user bookmaker preferences
export function saveBookmakerPreferences(enabledIds: string[]): void {
  localStorage.setItem('enabled_bookmakers', JSON.stringify(enabledIds));
}
