import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useSearchParams } from 'react-router-dom';
import { 
  Activity, Zap, ShieldAlert, Shield,
  RefreshCw, CheckCircle, PlayCircle,
  Volume2, VolumeX, Bell, TrendingUp, Gauge,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { Settings as SettingsIcon } from 'lucide-react';
import { apiSports } from '../services/apiSports';
import { sportsmonks } from '../services/sportsmonks';
import { sofascore } from '../services/sofascore';
import type { Fixture, PreMatchDossier, TelemetrySnapshot } from '../services/apiSports';
import { supabase } from '../services/supabase';
import { getEnabledBookmakers } from '../config/bookmakers';
import { onBet365Data, findBet365Match, mergeStats, calculateEnrichedIIM, calculateDynamicAPM } from '../services/bet365Bridge';
import type { Bet365BridgePayload, Bet365MatchData } from '../services/bet365Bridge';
import { initCloudSync, broadcastBridgeData, broadcastScannerData, onCloudBridgeData, onCloudScannerData, markAsOperator, getCloudSyncStatus } from '../services/cloudSync';
import type { CloudSyncStatus } from '../services/cloudSync';

// Fuzzy team matching helper to link Sportsmonks/Sofascore matches to API-Sports dossiers
function fuzzyMatchTeam(name1: string | undefined | null, name2: string | undefined | null): boolean {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const n2 = name2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  const words1 = n1.split(/\s+/).filter(w => w.length > 3);
  const words2 = n2.split(/\s+/).filter(w => w.length > 3);
  
  return words1.some(w => words2.includes(w));
}

// Robust URL matching helper
function matchUrls(url1: string | undefined | null, url2: string | undefined | null): boolean {
  if (!url1 || !url2) return false;
  const norm = (u: string) => u.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim();
  
  // Match exato
  if (norm(url1) === norm(url2)) return true;
  
  // Extrair Event ID da Bet365 (ex: #/IP/EV15134505944C1 → EV15134505944)
  const extractEventId = (u: string): string | null => {
    const m = u.match(/EV(\d+)/i);
    return m ? m[1] : null;
  };
  
  const ev1 = extractEventId(url1);
  const ev2 = extractEventId(url2);
  if (ev1 && ev2 && ev1 === ev2) return true;
  
  return false;
}

// Priority sorting helper based on league status to ensure premium matches are scanned first
function getFixturePriority(leagueName: string | undefined): number {
  if (!leagueName) return 0;
  const name = leagueName.toLowerCase();
  
  if (
    name.includes('premier league') || 
    name.includes('la liga') || 
    name.includes('serie a') || 
    name.includes('bundesliga') || 
    name.includes('champions league') || 
    name.includes('libertadores') || 
    name.includes('copa do brasil') ||
    name.includes('brasileir')
  ) {
    return 100;
  }
  
  if (
    name.includes('championship') || 
    name.includes('ligue 1') || 
    name.includes('eredivisie') || 
    name.includes('primeira liga') ||
    name.includes('serie b') ||
    name.includes('copa sudamericana')
  ) {
    return 70;
  }
  
  if (
    name.includes('youth') || 
    name.includes('u19') || 
    name.includes('sub-') || 
    name.includes('sub19') ||
    name.includes('under')
  ) {
    return 10;
  }
  
  return 40;
}

interface Opportunity {
  id: string; // unique ID
  fixtureId: number;
  match: Fixture;
  strategyName: 'Canto Limite' | 'Over 0.5 Gols HT' | 'Virada do Favorito' | 'Funil';
  teamName: string;
  confidence: number;
  details: string;
  suggestion: string;
}

// 🎰 Scanner Match type — dados vindos da extensão Bet365 Scanner
interface ScannerMatch {
  matchKey: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  elapsed: number;
  status: string;
  timer: string;
  league: string;
  fixtureIndex: number;
  scannedAt: number;
}

export default function Radar() {
  const [searchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'apm_pure';
  const isMobile = useIsMobile();
  
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  
  // Advanced scanner and dossier states
  const [rawApiStats, setRawApiStats] = useState<Record<number, any>>({});
  const [allDossiers, setAllDossiers] = useState<Record<number, PreMatchDossier>>({});
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [showMatchesTable, setShowMatchesTable] = useState(false);
  const [scannerDropdownOpen, setScannerDropdownOpen] = useState(false);
  const [fixtureSourceFilter, setFixtureSourceFilter] = useState<'all' | 'api' | 'bet365' | 'favorites'>('all');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({ connected: false, isOperator: false, lastCloudData: null, activeDevices: 1 });
  const [alertFilter, setAlertFilter] = useState<'all' | 'entrada' | 'potencial'>('all');
  
  // 🧠 Smart Filters
  const [smartFilters, setSmartFilters] = useState<Set<string>>(new Set());

  // ⭐ Favorites system
  const [favoriteFixtureIds, setFavoriteFixtureIds] = useState<Set<number>>(() => {
    try { const s = localStorage.getItem('favorite_fixtures'); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });
  useEffect(() => { localStorage.setItem('favorite_fixtures', JSON.stringify([...favoriteFixtureIds])); }, [favoriteFixtureIds]);
  const toggleFavorite = useCallback((id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavoriteFixtureIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  
  // Premium filters
  const [marketFilter, setMarketFilter] = useState<'all' | 'corners' | 'goals'>('all');

  
  // 🎯 Threshold configurável para gatilho de entrada (Score Final mínimo para disparar notificação)
  const [cornerTriggerThreshold, setCornerTriggerThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('corner_trigger_threshold');
    return saved ? parseFloat(saved) : 6.0;
  });
  useEffect(() => {
    localStorage.setItem('corner_trigger_threshold', String(cornerTriggerThreshold));
  }, [cornerTriggerThreshold]);

  // 🔔 Janelas de Notificação (carregadas do Layout/Supabase via localStorage)
  const getNotificationWindows = useCallback(() => {
    try {
      const saved = localStorage.getItem('notification_windows');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }, []);

  const isAlertAllowed = useCallback((elapsed: number, period: string, market: 'gols' | 'escanteios'): boolean => {
    const windows = getNotificationWindows();
    if (!windows || windows.length === 0) return true; // sem config = permite tudo
    
    const normalizedPeriod = period === '1H' ? '1H' : '2H';
    const matching = windows.find((w: any) => w.market === market && w.period === normalizedPeriod);
    
    if (!matching) return true; // sem janela definida = permite
    if (!matching.enabled) return false; // janela desativada = bloqueia
    
    return elapsed >= matching.min_minute && elapsed <= matching.max_minute;
  }, [getNotificationWindows]);
  
  // General status
  const [apiErrorReason, setApiErrorReason] = useState<'limit_reached' | 'invalid_key' | 'network_error' | null>(null);
  const [activeDataSource, setActiveDataSource] = useState<'sportsmonks' | 'sofascore' | 'apisports_real' | 'apisports_simulated'>('apisports_real');
  const [isLockdown, setIsLockdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(25); // 25s scanner refresh
  // Gotten opportunities tracking
  const [gottenOppIds, setGottenOppIds] = useState<Set<string>>(new Set());
  // Dismissed fixture IDs — hides notifications for these matches
  // Persisted in localStorage to survive navigation/reload
  const dismissedFixtureIdsRef = useRef<Set<number>>(
    (() => {
      try {
        const saved = localStorage.getItem('dismissed_fixture_ids');
        if (saved) return new Set(JSON.parse(saved) as number[]);
      } catch { /* ignore */ }
      return new Set<number>();
    })()
  );
  const [dismissedVersion, setDismissedVersion] = useState(0);

  const dismissFixture = useCallback((fixtureId: number) => {
    dismissedFixtureIdsRef.current.add(fixtureId);
    try {
      localStorage.setItem('dismissed_fixture_ids', JSON.stringify([...dismissedFixtureIdsRef.current]));
    } catch { /* ignore */ }
    setDismissedVersion(v => v + 1);
  }, []);
  const [defaultStake, setDefaultStake] = useState<number>(() => {
    const saved = localStorage.getItem('trade_default_stake');
    return saved ? Number(saved) : 200;
  });

  // Bet365 Bridge state
  const [bet365Bridge, setBet365Bridge] = useState<Bet365BridgePayload | null>(null);
  const bet365DataRef = useRef<Bet365MatchData[]>([]);



  // 🔍 Estado para linha expandida na tabela do radar (Dashboard Detalhado)
  const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null);
  const [chartViewMode, setChartViewMode] = useState<'da' | 'apm10' | 'apm5' | 'apm3'>('da');

  // ⚙️ Pesos customizáveis do Score por mercado (gols / escanteios)
  interface ScoreWeights { niap: number; ncg: number; nesc: number; nft: number; ncv: number; npos: number; nca: number; }
  const defaultWeightsGols: ScoreWeights = { niap: 40, ncg: 25, nesc: 10, nft: 10, ncv: 5, npos: 5, nca: 5 };
  const defaultWeightsEscanteios: ScoreWeights = { niap: 25, ncg: 10, nesc: 35, nft: 10, ncv: 5, npos: 10, nca: 5 };
  const [scoreWeightsGols, setScoreWeightsGols] = useState<ScoreWeights>(() => {
    try { const s = localStorage.getItem('score_weights_gols'); return s ? JSON.parse(s) : defaultWeightsGols; } catch { return defaultWeightsGols; }
  });
  const [scoreWeightsEscanteios, setScoreWeightsEscanteios] = useState<ScoreWeights>(() => {
    try { const s = localStorage.getItem('score_weights_escanteios'); return s ? JSON.parse(s) : defaultWeightsEscanteios; } catch { return defaultWeightsEscanteios; }
  });
  const [showWeightsModal, setShowWeightsModal] = useState(false);
  const [weightsMarketTab, setWeightsMarketTab] = useState<'gols' | 'escanteios'>('gols');
  const [weightsSyncStatus, setWeightsSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  // 🔄 Load weights from Supabase on mount (fallback: localStorage already loaded above)
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('score_weights')
          .select('*');
        if (error || !data || data.length === 0) return; // Tabela não existe ainda — usar localStorage
        for (const row of data) {
          const weights: ScoreWeights = { niap: row.niap, ncg: row.ncg, nesc: row.nesc, nft: row.nft, ncv: row.ncv, npos: row.npos, nca: row.nca };
          if (row.market_type === 'gols') setScoreWeightsGols(weights);
          if (row.market_type === 'escanteios') setScoreWeightsEscanteios(weights);
        }
        setWeightsSyncStatus('synced');
        console.log('✅ Score weights loaded from Supabase cloud');
      } catch (e) {
        console.warn('⚠️ Supabase score_weights not available, using localStorage fallback');
      }
    })();
  }, []);

  // Persist weights to localStorage + Supabase (dual write)
  const persistWeights = useCallback(async (marketType: 'gols' | 'escanteios', weights: ScoreWeights) => {
    // 1. Always save to localStorage (immediate)
    localStorage.setItem(`score_weights_${marketType}`, JSON.stringify(weights));
    // 2. Try to save to Supabase (async)
    try {
      setWeightsSyncStatus('syncing');
      const { error } = await supabase
        .from('score_weights')
        .upsert({
          market_type: marketType,
          niap: weights.niap,
          ncg: weights.ncg,
          nesc: weights.nesc,
          nft: weights.nft,
          ncv: weights.ncv,
          npos: weights.npos,
          nca: weights.nca,
          preset_name: 'Personalizado',
        }, { onConflict: 'market_type' });
      if (error) throw error;
      setWeightsSyncStatus('synced');
    } catch (e) {
      setWeightsSyncStatus('error');
      console.warn('⚠️ Failed to sync weights to Supabase:', e);
    }
  }, []);

  useEffect(() => { persistWeights('gols', scoreWeightsGols); }, [scoreWeightsGols, persistWeights]);
  useEffect(() => { persistWeights('escanteios', scoreWeightsEscanteios); }, [scoreWeightsEscanteios, persistWeights]);

  // Active weights based on marketFilter
  const activeScoreWeights = useMemo(() => {
    if (marketFilter === 'corners') return scoreWeightsEscanteios;
    return scoreWeightsGols; // 'goals' or 'all' use gols weights
  }, [marketFilter, scoreWeightsGols, scoreWeightsEscanteios]);

  // 🎰 Bet365 Scanner state
  const [scannerMatches, setScannerMatches] = useState<ScannerMatch[]>([]);
  const [scannerEnabled, setScannerEnabled] = useState(false);
  const scannerFixtureIdsRef = useRef<Set<string>>(new Set()); // track already-added scanner matches

  // 📥 Central de Jogos Manuais (Contorno de limite da API)
  const [manualFixtures, setManualFixtures] = useState<Fixture[]>(() => {
    try {
      const saved = localStorage.getItem('bet365_manual_fixtures');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // 🆕 Rastrear fixtures recém-adicionados (badge "NOVO" por 60s)
  const newFixtureIdsRef = useRef<Set<number>>(new Set());
  const [newFixtureIds, setNewFixtureIds] = useState<Set<number>>(new Set());
  const knownFixtureIdsRef = useRef<Set<number>>(new Set());

  // Inicializar: marcar fixtures recentes (addedAt < 60s) como NOVO
  useEffect(() => {
    const now = Date.now();
    const NEW_THRESHOLD = 60000; // 60s
    manualFixtures.forEach(f => {
      knownFixtureIdsRef.current.add(f.id);
      const addedAt = (f as any).addedAt || 0;
      if (addedAt > 0 && (now - addedAt) < NEW_THRESHOLD && !newFixtureIdsRef.current.has(f.id)) {
        newFixtureIdsRef.current.add(f.id);
        const remaining = NEW_THRESHOLD - (now - addedAt);
        setTimeout(() => {
          newFixtureIdsRef.current.delete(f.id);
          setNewFixtureIds(new Set(newFixtureIdsRef.current));
        }, remaining);
      }
    });
    if (newFixtureIdsRef.current.size > 0) {
      setNewFixtureIds(new Set(newFixtureIdsRef.current));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Apenas na montagem

  // Detectar novos fixtures adicionados (por qualquer caminho)
  useEffect(() => {
    let changed = false;
    manualFixtures.forEach(f => {
      if (!knownFixtureIdsRef.current.has(f.id)) {
        knownFixtureIdsRef.current.add(f.id);
        newFixtureIdsRef.current.add(f.id);
        changed = true;
        setTimeout(() => {
          newFixtureIdsRef.current.delete(f.id);
          setNewFixtureIds(new Set(newFixtureIdsRef.current));
        }, 60000);
      }
    });
    if (changed) {
      setNewFixtureIds(new Set(newFixtureIdsRef.current));
    }
  }, [manualFixtures]);

  useEffect(() => {
    localStorage.setItem('bet365_manual_fixtures', JSON.stringify(manualFixtures));
  }, [manualFixtures]);

  // Concatena fixtures da API com as criadas manualmente
  const allFixtures = useMemo(() => {
    return [...fixtures, ...manualFixtures];
  }, [fixtures, manualFixtures]);

  // 🔄 Sincronizar dados da Bridge para atualizar os nomes dos times manuais, tempo decorrido e placar
  useEffect(() => {
    if (!bet365Bridge || !bet365Bridge.connected || bet365Bridge.matches.length === 0 || manualFixtures.length === 0) return;

    let updated = false;
    const nextManual = manualFixtures.map(f => {
      const match = bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (f as any).matchUrl));
      if (match) {
        const goalsHome = typeof match.home?.goals === 'number' ? match.home.goals : f.goalsHome || 0;
        const goalsAway = typeof match.away?.goals === 'number' ? match.away.goals : f.goalsAway || 0;

        if (
          f.homeTeam.name.includes('Aguardando') || 
          f.homeTeam.name !== match.homeTeam || 
          f.elapsed !== (match.elapsed || 0) ||
          f.goalsHome !== goalsHome ||
          f.goalsAway !== goalsAway
        ) {
          updated = true;
          return {
            ...f,
            homeTeam: { ...f.homeTeam, name: match.homeTeam },
            awayTeam: { ...f.awayTeam, name: match.awayTeam },
            elapsed: (Number(match.elapsed) || 0) >= (f.elapsed || 0) ? Number(match.elapsed) : f.elapsed,
            goalsHome,
            goalsAway
          };
        }
      }
      return f;
    });

    if (updated) {
      setManualFixtures(nextManual);
    }
  }, [bet365Bridge, manualFixtures]);

  // 🎰 Sincronizar Scanner Fixtures com dados ao vivo do Scanner + Bridge (elapsed, goals, status)
  useEffect(() => {
    if (manualFixtures.length === 0) return;
    if (scannerMatches.length === 0 && (!bet365Bridge || !bet365Bridge.connected)) return;

    let updated = false;
    const nextManual = manualFixtures.map(f => {
      if ((f as any).source !== 'scanner') return f;
      
      // 🥇 PRIORIDADE 1: Bridge elapsed/goals (zero delay, da aba aberta na Bet365)
      let bridgeElapsed: number | null = null;
      let bridgeGoalsH: number | null = null;
      let bridgeGoalsA: number | null = null;
      let bridgePeriod: string | null = null;
      
      if (bet365Bridge?.connected && bet365Bridge.matches.length > 0) {
        const bridgeMatch = (f as any).matchUrl
          ? bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (f as any).matchUrl))
          : findBet365Match(f.homeTeam.name, f.awayTeam.name, bet365Bridge.matches);
        
        if (bridgeMatch) {
          if (bridgeMatch.elapsed && bridgeMatch.elapsed > 0 && bridgeMatch.elapsed >= (f.elapsed || 0)) {
            bridgeElapsed = bridgeMatch.elapsed;
          }
          if (bridgeMatch.period) {
            bridgePeriod = bridgeMatch.period;
          }
          const bHome = bridgeMatch.goalsHome ?? bridgeMatch.home?.goals;
          const bAway = bridgeMatch.goalsAway ?? bridgeMatch.away?.goals;
          if (typeof bHome === 'number') bridgeGoalsH = bHome;
          if (typeof bAway === 'number') bridgeGoalsA = bAway;
        }
      }
      
      // 🥈 PRIORIDADE 2: Scanner match data (fallback)
      const matchKey = `${f.homeTeam.name}_${f.awayTeam.name}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      const scanMatch = scannerMatches.find(m => {
        const key = m.matchKey.toLowerCase().replace(/[^a-z0-9]/g, '');
        return key === matchKey || 
          (m.homeTeam.toLowerCase() === f.homeTeam.name.toLowerCase() && m.awayTeam.toLowerCase() === f.awayTeam.name.toLowerCase());
      });

      // Resolver valores finais: Bridge > Scanner > Existente
      const candidateElapsed = bridgeElapsed ?? (scanMatch?.elapsed || f.elapsed);
      const newElapsed = candidateElapsed >= (f.elapsed || 0) ? candidateElapsed : f.elapsed;
      const newGoalsH = bridgeGoalsH ?? (scanMatch?.homeGoals ?? f.goalsHome);
      const newGoalsA = bridgeGoalsA ?? (scanMatch?.awayGoals ?? f.goalsAway);
      const newStatus = bridgePeriod ?? (scanMatch?.status || f.status);

      if (f.elapsed !== newElapsed || f.goalsHome !== newGoalsH || f.goalsAway !== newGoalsA || f.status !== newStatus) {
        updated = true;
        return { ...f, elapsed: newElapsed, goalsHome: newGoalsH, goalsAway: newGoalsA, status: newStatus };
      }
      
      return f;
    });

    if (updated) {
      setManualFixtures(nextManual);
    }
  }, [scannerMatches, manualFixtures, bet365Bridge]);

  // 🗑️ Auto-remover jogos encerrados a cada 30s
  // Scanner fixtures: removidos por idade (>3h) OU quando sumiram do scanner ativo
  // Manual fixtures: removidos por elapsed >= 95, status FT, ou idade >3h
  const MAX_FIXTURE_AGE_MS = 3 * 60 * 60 * 1000; // 3 horas
  useEffect(() => {
    const doCleanup = () => {
      const now = Date.now();
      setManualFixtures(prev => {
        const before = prev.length;
        const filtered = prev.filter(f => {
          // REGRA 1: Idade máxima — qualquer fixture com mais de 3h é removida
          const addedAt = (f as any).addedAt || 0;
          if (addedAt > 0 && (now - addedAt) > MAX_FIXTURE_AGE_MS) return false;
          
          // REGRA 2: Fixtures do scanner sem timestamp (legados de sessões antigas) — remover sempre
          if ((f as any).source === 'scanner' && addedAt === 0) return false;

          // REGRA 3: Scanner inativo — fixtures do scanner com mais de 90min sem scanner ativo
          if ((f as any).source === 'scanner' && scannerMatches.length === 0) {
            const SCANNER_INACTIVE_AGE = 90 * 60 * 1000; // 90 minutos
            if (addedAt > 0 && (now - addedAt) > SCANNER_INACTIVE_AGE) return false;
          }

          // REGRA 4: Scanner ativo + jogo sumiu do In-Play
          if ((f as any).source === 'scanner' && scannerMatches.length > 0) {
            const stillLive = scannerMatches.some(m => 
              m.homeTeam.toLowerCase() === f.homeTeam.name.toLowerCase() && 
              m.awayTeam.toLowerCase() === f.awayTeam.name.toLowerCase()
            );
            if (!stillLive) return false;
          }

          // REGRA 4: Status de jogo encerrado
          const status = (f.status || '').toUpperCase();
          if (['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(status)) return false;
          if (f.elapsed >= 95) return false;
          return true;
        });

        if (filtered.length < before) {
          console.log(`[Radar] 🗑️ Auto-removidos ${before - filtered.length} jogos encerrados`);
          // Limpar IDs do scanner ref para permitir re-adição
          prev.filter(f => !filtered.includes(f)).forEach(removed => {
            scannerFixtureIdsRef.current.forEach(key => {
              const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
              const normRemoved = `${removed.homeTeam.name}${removed.awayTeam.name}`.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (normKey.includes(normRemoved) || normRemoved.includes(normKey)) {
                scannerFixtureIdsRef.current.delete(key);
              }
            });
          });
        }
        return filtered;
      });
    };

    // Executar imediatamente (limpa jogos antigos ao carregar)
    doCleanup();

    // E periodicamente a cada 30s
    const interval = setInterval(doCleanup, 30000);
    return () => clearInterval(interval);
  }, [scannerMatches]);

  // ⏱️ Interpolação de Tempo Local — Bridge-priority + Ref-based anchor
  // PRIORIDADE 1: Bridge elapsed (zero delay, lido da Bet365 em tempo real)
  // PRIORIDADE 2: Âncora interpolada (quando bridge não tem dados)
  const elapsedAnchorRef = useRef<Record<number, { baseElapsed: number; baseTimestamp: number }>>({});
  const [, forceElapsedTick] = useState(0); // Dummy state para forçar re-render
  
  // Função que retorna o elapsed interpolado para display
  const getDisplayElapsed = useCallback((fixtureId: number, rawElapsed: number, status: string): number => {
    const st = (status || '').toUpperCase();
    // Só interpolar durante tempo de jogo ativo
    if (st !== '1H' && st !== '2H' && st !== 'ET' && st !== 'LIVE') {
      return rawElapsed;
    }
    
    const maxElapsed = st === 'ET' ? 120 : 90;
    const anchor = elapsedAnchorRef.current[fixtureId];
    const lastKnown = anchor ? anchor.baseElapsed : 0;
    
    // 🥇 PRIORIDADE 1: Bridge elapsed (zero delay)
    if (bet365Bridge?.connected && bet365Bridge.matches.length > 0) {
      const allFx = [...(fixtures || []), ...(manualFixtures || [])];
      const fixture = allFx.find(f => f.id === fixtureId);
      if (fixture) {
        const bridgeMatch = (fixture as any).matchUrl
          ? bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (fixture as any).matchUrl))
          : findBet365Match(fixture.homeTeam.name, fixture.awayTeam.name, bet365Bridge.matches);
        
        if (bridgeMatch?.elapsed != null && bridgeMatch.elapsed > 0) {
          const bridgeAge = (Date.now() - bridgeMatch.timestamp) / 60000;
          const bridgeInterpolated = bridgeMatch.elapsed + Math.floor(bridgeAge);
          
          // 🛡️ FILTRO MONOTÔNICO: impedir que elapsed volte atrás
          // Tolerância de 2 min para atraso normal da API, exceto intervalo (45→46)
          const isHalftimeTransition = lastKnown >= 43 && lastKnown <= 48 && bridgeMatch.elapsed >= 45;
          if (bridgeMatch.elapsed >= lastKnown - 2 || isHalftimeTransition || lastKnown === 0) {
            // Valor válido — atualizar âncora
            elapsedAnchorRef.current[fixtureId] = { 
              baseElapsed: bridgeMatch.elapsed, 
              baseTimestamp: bridgeMatch.timestamp 
            };
            return Math.min(maxElapsed, bridgeInterpolated);
          } else {
            // ⚠️ Bridge zerou/retrocedeu — IGNORAR e continuar interpolando da última âncora boa
            console.warn(`[Elapsed Filter] 🛡️ Bridge zerou para ${bridgeMatch.elapsed}' (último: ${lastKnown}'). Ignorando.`);
          }
        }
      }
    }
    
    // 🥈 PRIORIDADE 2: Âncora interpolada (fallback API)
    if (!anchor) {
      elapsedAnchorRef.current[fixtureId] = { baseElapsed: rawElapsed, baseTimestamp: Date.now() };
      return rawElapsed;
    }
    
    // Se a API enviou um elapsed MAIOR, atualizar âncora
    if (rawElapsed > anchor.baseElapsed) {
      elapsedAnchorRef.current[fixtureId] = { baseElapsed: rawElapsed, baseTimestamp: Date.now() };
      return rawElapsed;
    }
    
    // Interpolar: base + minutos desde a âncora
    const minutesSinceAnchor = (Date.now() - anchor.baseTimestamp) / 60000;
    const interpolated = anchor.baseElapsed + Math.floor(minutesSinceAnchor);
    
    return Math.min(maxElapsed, interpolated);
  }, [bet365Bridge, fixtures, manualFixtures]);
  
  // 🏆 Score com prioridade Bridge (zero delay) > API
  const getDisplayScore = useCallback((fixtureId: number, rawHome: number, rawAway: number): { home: number; away: number } => {
    if (bet365Bridge?.connected && bet365Bridge.matches.length > 0) {
      const allFx = [...(fixtures || []), ...(manualFixtures || [])];
      const fixture = allFx.find(f => f.id === fixtureId);
      if (fixture) {
        const bridgeMatch = (fixture as any).matchUrl
          ? bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (fixture as any).matchUrl))
          : findBet365Match(fixture.homeTeam.name, fixture.awayTeam.name, bet365Bridge.matches);
        
        if (bridgeMatch) {
          const bHome = bridgeMatch.goalsHome ?? bridgeMatch.home?.goals;
          const bAway = bridgeMatch.goalsAway ?? bridgeMatch.away?.goals;
          if (typeof bHome === 'number' && typeof bAway === 'number') {
            return { home: bHome, away: bAway };
          }
        }
      }
    }
    return { home: rawHome, away: rawAway };
  }, [bet365Bridge, fixtures, manualFixtures]);
  
  // Tick para forçar re-render e atualizar o display de tempo
  useEffect(() => {
    const interval = setInterval(() => {
      forceElapsedTick(prev => prev + 1);
    }, 15000); // Re-render a cada 15s para maior precisão com bridge
    return () => clearInterval(interval);
  }, []);


  // ─── useMemo de allStats: Combina rawApiStats (API) com a Bridge da Bet365 ───
  const allStats = useMemo(() => {
    const updated = { ...rawApiStats };
    
    // Se a bridge estiver conectada e tiver matches, fazemos o merge inteligente
    if (bet365Bridge && bet365Bridge.connected && bet365Bridge.matches.length > 0) {
      for (const fixture of allFixtures) {
        // Encontrar o jogo correspondente na bridge: prioridade para URL exata, senão fuzzy
        const bet365Match = (fixture as any).matchUrl
          ? bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (fixture as any).matchUrl))
          : findBet365Match(
              fixture.homeTeam.name,
              fixture.awayTeam.name,
              bet365Bridge.matches
            );

        if (!bet365Match) continue;

        const existingStats = updated[fixture.id];

        if (existingStats) {
          // Fixture JÁ TEM stats da API → merge complementar
          const merged = mergeStats(existingStats, bet365Match);
          const elapsed = getDisplayElapsed(fixture.id, fixture.elapsed || 1, fixture.status || '') || 1;
          const hasBet365 = (bet365Match.home?.dangerousAttacks || 0) > 0 || 
                            (bet365Match.away?.dangerousAttacks || 0) > 0;
          merged.home.iim = calculateEnrichedIIM(merged.home, elapsed, hasBet365);
          merged.away.iim = calculateEnrichedIIM(merged.away, elapsed, hasBet365);
          updated[fixture.id] = merged;
        } else {
          // Fixture SEM stats da API (ex: Jogo Manual!) → criar stats a partir da bridge
          const emptyTeam = (): import('../services/apiSports').TeamStats => ({
            shotsOnGoal: 0, shotsOffGoal: 0, totalShots: 0, blockedShots: 0,
            shotsInsideBox: 0, corners: 0, fouls: 0, possession: 0,
            yellowCards: 0, redCards: 0, goalkeeperSaves: 0,
            attacks: 0, dangerousAttacks: 0, pressureIndex: 0, iim: 0
          });
          const bridgeStats: import('../services/apiSports').MatchStats = {
            fixtureId: fixture.id,
            home: emptyTeam(),
            away: emptyTeam(),
            hasTelemetry: false
          };
          const merged = mergeStats(bridgeStats, bet365Match);
          const elapsed = getDisplayElapsed(fixture.id, fixture.elapsed || 1, fixture.status || '') || 1;
          const hasBet365 = (bet365Match.home?.dangerousAttacks || 0) > 0 || 
                            (bet365Match.away?.dangerousAttacks || 0) > 0;
          merged.home.iim = calculateEnrichedIIM(merged.home, elapsed, hasBet365);
          merged.away.iim = calculateEnrichedIIM(merged.away, elapsed, hasBet365);
          // Marcar que tem dados da bridge mesmo sem telemetria API
          merged.hasTelemetry = false;
          merged.hasBridge = true;
          updated[fixture.id] = merged;
        }
      }
    }
    
    return updated;
  }, [rawApiStats, bet365Bridge, allFixtures]);

  // 💾 Platform-Side Telemetry Snapshot Store (Anti-Background Throttling)
  const [platformSnapshots, setPlatformSnapshots] = useState<Record<number, { elapsed: number; homeDA: number; awayDA: number; timestamp: number }[]>>(() => {
    try {
      const saved = sessionStorage.getItem('platform_telemetry_snapshots');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // Salvar platformSnapshots no sessionStorage sempre que atualizados
  useEffect(() => {
    try {
      sessionStorage.setItem('platform_telemetry_snapshots', JSON.stringify(platformSnapshots));
    } catch (e) {}
  }, [platformSnapshots]);

  // 🧮 Reusable Operations Modes & ScoreFinal Helper Functions
  const getAttacksInWindow = useCallback((fixtureId: number, minutes: number, isHome: boolean): number => {
    const stats = allStats[fixtureId];
    if (!stats) return 0;
    const fixture = allFixtures.find(f => f.id === fixtureId);
    const elapsed = fixture ? getDisplayElapsed(fixture.id, fixture.elapsed || 0, fixture.status || '') : 0;

    const unifiedSnapshots = [
      ...(stats.snapshots || []),
      ...(platformSnapshots[fixtureId] || [])
    ].reduce((acc: TelemetrySnapshot[], curr: any) => {
      if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
        acc.push(curr);
      }
      return acc;
    }, [] as TelemetrySnapshot[]).sort((a: TelemetrySnapshot, b: TelemetrySnapshot) => a.elapsed - b.elapsed);

    const apmData = calculateDynamicAPM(
      unifiedSnapshots,
      elapsed,
      stats.home.dangerousAttacks || 0,
      stats.away.dangerousAttacks || 0
    );

    const sideApm = isHome ? apmData.home : apmData.away;
    if (minutes === 10) return sideApm.apm10 * 10;
    if (minutes === 5) return sideApm.apm5 * 5;
    if (minutes === 3) return sideApm.apm3 * 3;
    return 0;
  }, [allStats, allFixtures, platformSnapshots]);

  const getScoreFinalForSide = useCallback((fixtureId: number, isHome: boolean): number => {
    // Retorna o ScoreEMA suavizado se disponível, senão calcula bruto
    const ema = scoreEmaRef.current[fixtureId];
    if (ema) {
      return Math.round((isHome ? ema.home : ema.away) * 100) / 100;
    }
    // Fallback: cálculo bruto (primeira vez antes do useEffect rodar)
    const stats = allStats[fixtureId];
    if (!stats) return 0;
    const teamStats = isHome ? stats.home : stats.away;
    
    const ap10 = getAttacksInWindow(fixtureId, 10, isHome);
    const ap5 = getAttacksInWindow(fixtureId, 5, isHome);
    const ap3 = getAttacksInWindow(fixtureId, 3, isHome);
    // Converter para APM (ataques por minuto)
    const atm10 = ap10 / 10, atm5 = ap5 / 5, atm3 = ap3 / 3;
    // Pressão Base (média ponderada dos APM, priorizando recente)
    const pressao = (0.20 * atm10) + (0.30 * atm5) + (0.50 * atm3);
    // Momentum: sqrt(ATM3/ATM10) — captura aceleração sem explodir
    const accelRatio = atm10 > 0 ? atm3 / atm10 : 1.0;
    const momentum = Math.max(0.8, Math.min(1.8, Math.sqrt(accelRatio)));
    // NIAP = Pressão × Escala × Momentum (0-10)
    const niap = Math.min(10, pressao * 10 * momentum);
    const ncg = Math.min(10, ((teamStats.shotsOnGoal || 0) / 8) * 10);
    const nesc = Math.min(10, teamStats.corners || 0);
    const nft = Math.min(10, ((teamStats.totalShots || 0) / 15) * 10);
    const ncv = (teamStats.redCards || 0) === 0 ? 10 : 0;
    const npos = (Number(teamStats.possession) || 50) / 10;
    const nca = Math.min(10, (teamStats.yellowCards || 0) * 2);
    
    // Usar pesos customizáveis (normalizados para somar 1.0)
    const w = activeScoreWeights;
    const totalW = w.niap + w.ncg + w.nesc + w.nft + w.ncv + w.npos + w.nca;
    const n = totalW > 0 ? totalW / 100 : 1;
    const score = (niap * w.niap/100) + (ncg * w.ncg/100) + (nesc * w.nesc/100) + (nft * w.nft/100) + (ncv * w.ncv/100) + (npos * w.npos/100) + (nca * w.nca/100);
    return Math.round((score / n * 100) * 100) / 10000 * 100 > 10 ? 10 : Math.round(score / n * 100) / 100;
  }, [allStats, getAttacksInWindow, activeScoreWeights]);

  const getPLSForSide = useCallback((fixtureId: number, isHome: boolean): number | null => {
    const dossier = allDossiers[fixtureId];
    if (!dossier || !dossier.hasPredictions) return null;
    
    const strength = isHome ? dossier.offensiveStrengthHome : dossier.offensiveStrengthAway;
    const motivation = isHome ? dossier.motivationHome : dossier.motivationAway;
    const avgGoals = isHome ? dossier.avgGoalsScoredHome : dossier.avgGoalsScoredAway;
    const avgCorners = isHome ? dossier.avgCornersHome : dossier.avgCornersAway;
    
    const nStrength = Math.min(10, (strength || 50) / 10);
    const nMotivation = Math.min(10, (motivation || 50) / 10);
    const nGoals = Math.min(10, ((avgGoals || 1.2) / 2.5) * 10);
    const nCorners = Math.min(10, ((avgCorners || 4.5) / 7.0) * 10);
    
    const score = (nStrength * 0.40) + (nMotivation * 0.30) + (nGoals * 0.20) + (nCorners * 0.10);
    return Math.round(score * 10) / 10;
  }, [allDossiers]);

  const getPLSTier = useCallback((score: number) => {
    if (score >= 9.0) return { label: 'Elite', color: '#ef4444' };
    if (score >= 7.0) return { label: 'Forte', color: '#10b981' };
    if (score >= 4.0) return { label: 'Médio', color: '#f59e0b' };
    return { label: 'Fraco', color: 'var(--text-muted)' };
  }, []);

  const getQualityPctForSide = useCallback((fixtureId: number, isHome: boolean): number => {
    const scoreFinal = getScoreFinalForSide(fixtureId, isHome);
    const pls = getPLSForSide(fixtureId, isHome);
    if (pls !== null) {
      return Math.min(100, Math.round((pls * 3.0) + (scoreFinal * 7.0)));
    }
    return Math.min(100, Math.round(scoreFinal * 10.0));
  }, [getScoreFinalForSide, getPLSForSide]);

  // 🧠 Smart Filter logic (multi-select OR)
  const passesSmartFilter = useCallback((f: any): boolean => {
    if (smartFilters.size === 0) return true;
    
    const stats = allStats[f.id];
    const elapsed = getDisplayElapsed(f.id, f.elapsed || 0, f.status || '');
    const status = (f.status || '').toUpperCase();
    
    // OR logic: match passes if it satisfies ANY active filter
    if (smartFilters.has('apm_window')) {
      if ((elapsed >= 15 && elapsed <= 32) && status !== 'HT' && status !== 'FT') return true;
    }
    
    if (smartFilters.has('draw_underdog')) {
      const goalsH = f.goalsHome ?? 0;
      const goalsA = f.goalsAway ?? 0;
      if (goalsH === goalsA) return true;
      
      if (stats) {
        const homePoss = Number(stats.home?.possession) || 50;
        const awayPoss = Number(stats.away?.possession) || 50;
        const homeDA = stats.home?.dangerousAttacks || 0;
        const awayDA = stats.away?.dangerousAttacks || 0;
        const homeIsFav = homePoss > awayPoss || homeDA > awayDA;
        
        if (homeIsFav && goalsH < goalsA) return true;
        if (!homeIsFav && goalsA < goalsH) return true;
      }
    }
    
    if (smartFilters.has('high_pressure')) {
      if (stats) {
        const homeIIM = stats.home?.iim || 0;
        const awayIIM = stats.away?.iim || 0;
        const maxIIM = Math.max(homeIIM, awayIIM);
        const isCornerZone = (elapsed >= 35 && elapsed <= 45 && status === '1H') || 
                             (elapsed >= 75 && status === '2H');
        if (maxIIM >= 1.0 && isCornerZone) return true;
      }
    }
    
    return false;
  }, [smartFilters, allStats]);

  // 🚀 Gravador Resiliente de Snapshots no Frontend (Varre a cada atualização de allStats)
  useEffect(() => {
    if (Object.keys(allStats).length === 0) return;

    setPlatformSnapshots(prev => {
      let changed = false;
      const next = { ...prev };

      for (const fixture of allFixtures) {
        const stats = allStats[fixture.id];
        if (!stats) continue;

        const elapsed = fixture.elapsed || 0;
        if (elapsed <= 0) continue;

        const homeDA = stats.home.dangerousAttacks || 0;
        const awayDA = stats.away.dangerousAttacks || 0;

        const snaps = next[fixture.id] ? [...next[fixture.id]] : [];
        const lastSnap = snaps[snaps.length - 1];

        // Só adicionar se for um novo minuto de jogo
        if (!lastSnap || lastSnap.elapsed !== elapsed) {
          snaps.push({
            elapsed,
            homeDA,
            awayDA,
            timestamp: Date.now()
          });

          // Limitar aos últimos 60 minutos para segurança de memória
          if (snaps.length > 60) {
            snaps.shift();
          }

          next[fixture.id] = snaps;
          changed = true;
        } else {
          // Se ainda estamos no mesmo minuto, atualizamos se houver incremento
          if (lastSnap.homeDA !== homeDA || lastSnap.awayDA !== awayDA) {
            lastSnap.homeDA = homeDA;
            lastSnap.awayDA = awayDA;
            lastSnap.timestamp = Date.now();
            next[fixture.id] = snaps;
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [allStats, allFixtures]);

  const handlePeguei = async (opp: Opportunity) => {
    if (gottenOppIds.has(opp.id)) return;
    
    const newGotten = new Set(gottenOppIds);
    newGotten.add(opp.id);
    setGottenOppIds(newGotten);

    // Auto-dismiss: hide notification for this fixture
    dismissFixture(opp.fixtureId);

    const stakeVal = Number(localStorage.getItem('trade_default_stake')) || defaultStake;
    const matchName = `${opp.match.homeTeam.name} x ${opp.match.awayTeam.name}`;

    // 📸 SNAPSHOT: Captura todas as métricas do jogo no momento da entrada
    const stats = allStats[opp.fixtureId];
    const fixture = allFixtures.find(f => f.id === opp.fixtureId);
    const elapsed = fixture ? getDisplayElapsed(fixture.id, fixture.elapsed || 0, fixture.status || '') : 0;

    // Calcular APM/IPR
    let homeIpr = 0, awayIpr = 0;
    let homeApm10 = 0, awayApm10 = 0, homeApm5 = 0, awayApm5 = 0, homeApm3 = 0, awayApm3 = 0;
    if (stats) {
      const unifiedSnapshots = [
        ...(stats.snapshots || []),
        ...(platformSnapshots[opp.fixtureId] || [])
      ].reduce((acc: TelemetrySnapshot[], curr: any) => {
        if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) acc.push(curr);
        return acc;
      }, [] as TelemetrySnapshot[]).sort((a: TelemetrySnapshot, b: TelemetrySnapshot) => a.elapsed - b.elapsed);

      const apmData = calculateDynamicAPM(
        unifiedSnapshots, elapsed,
        stats.home.dangerousAttacks || 0,
        stats.away.dangerousAttacks || 0
      );
      homeIpr = apmData.home.ipr;
      awayIpr = apmData.away.ipr;
      homeApm10 = apmData.home.apm10;
      awayApm10 = apmData.away.apm10;
      homeApm5 = apmData.home.apm5;
      awayApm5 = apmData.away.apm5;
      homeApm3 = apmData.home.apm3;
      awayApm3 = apmData.away.apm3;
    }

    // Calcular Score Final
    const homeScore = getScoreFinalForSide(opp.fixtureId, true);
    const awayScore = getScoreFinalForSide(opp.fixtureId, false);

    // Montar objeto de métricas
    const metricsSnapshot = {
      elapsed,
      period: elapsed <= 45 ? '1H' : elapsed > 45 && elapsed <= 90 ? '2H' : 'HT',
      league: fixture?.leagueName || opp.match?.leagueName || 'N/A',
      goals_home: fixture?.goalsHome ?? 0,
      goals_away: fixture?.goalsAway ?? 0,
      // Score composto
      home_score: homeScore,
      away_score: awayScore,
      // IPR
      home_ipr: Math.round(homeIpr * 100) / 100,
      away_ipr: Math.round(awayIpr * 100) / 100,
      // ATM (APM por janela)
      home_apm_10: Math.round(homeApm10 * 100) / 100,
      away_apm_10: Math.round(awayApm10 * 100) / 100,
      home_apm_5: Math.round(homeApm5 * 100) / 100,
      away_apm_5: Math.round(awayApm5 * 100) / 100,
      home_apm_3: Math.round(homeApm3 * 100) / 100,
      away_apm_3: Math.round(awayApm3 * 100) / 100,
      // Stats brutos
      home_shots_on: stats?.home?.shotsOnGoal || 0,
      away_shots_on: stats?.away?.shotsOnGoal || 0,
      home_total_shots: stats?.home?.totalShots || 0,
      away_total_shots: stats?.away?.totalShots || 0,
      home_corners: stats?.home?.corners || 0,
      away_corners: stats?.away?.corners || 0,
      home_possession: Number(stats?.home?.possession) || 0,
      away_possession: Number(stats?.away?.possession) || 0,
      home_da: stats?.home?.dangerousAttacks || 0,
      away_da: stats?.away?.dangerousAttacks || 0,
      // Cartões
      home_yellow: stats?.home?.yellowCards || 0,
      away_yellow: stats?.away?.yellowCards || 0,
      home_red: stats?.home?.redCards || 0,
      away_red: stats?.away?.redCards || 0,
    };
    
    const newTradeData = {
      match_name: matchName,
      market: opp.strategyName,
      odd: 1.80,
      stake: stakeVal,
      status: 'PENDING',
      profit_loss: 0,
      metrics: metricsSnapshot,
    };

    try {
      const { error } = await supabase.from('trades').insert([newTradeData]);
      if (error) throw error;
      console.log("✅ Trade + Snapshot de métricas salvo no Supabase!", metricsSnapshot);
    } catch (e) {
      console.warn("Supabase insert failed. Falling back to local replication.", e);
      const localTrades = localStorage.getItem('trades_db_replica');
      const parsed = localTrades ? JSON.parse(localTrades) : [];
      const newTrade = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...newTradeData
      };
      localStorage.setItem('trades_db_replica', JSON.stringify([newTrade, ...parsed]));
    }
  };
  // Track already alerted opportunities to avoid double playing the sound
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const statsLastFetchRef = useRef<Record<number, number>>({});

  // 📈 EMA Smoothing: Suaviza o ScoreFinal para evitar volatilidade nos gatilhos
  const EMA_ALPHA = 0.35; // Fator de suavização (0-1): maior = mais reativo, menor = mais suave
  const HYSTERESIS = 0.5; // Zona morta: gatilho desativa apenas se cair threshold - 0.5
  const MIN_SCANS_ABOVE = 2; // Scans consecutivos acima do threshold para confirmar gatilho
  const scoreEmaRef = useRef<Record<number, { home: number; away: number }>>({});
  const triggerStateRef = useRef<Record<string, { active: boolean; scansAbove: number }>>({});
  const prevWeightsRef = useRef<string>(JSON.stringify(activeScoreWeights));
  useEffect(() => {
    const k = JSON.stringify(activeScoreWeights);
    if (k !== prevWeightsRef.current) {
      console.log('🔄 Pesos alterados — resetando EMA para recálculo imediato');
      scoreEmaRef.current = {};
      prevWeightsRef.current = k;
    }
  }, [activeScoreWeights]);


  // Synthesize native audio chimes for premium user feedback without external asset dependencies
  const playAlertSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch (A5 note)
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12); // Sweeping harmonic chime up
      
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); // Fade out smoothly
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn("Blocked AudioContext or unsupported audio interface:", e);
    }
  };

  // 📱 Push Notification via Service Worker (funciona com tela bloqueada)
  const sendPushNotification = (opp: Opportunity) => {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
      Notification.requestPermission();
      return;
    }
    navigator.serviceWorker.ready.then(reg => {
      const matchName = `${opp.match.homeTeam.name} ${opp.match.goalsHome}×${opp.match.goalsAway} ${opp.match.awayTeam.name}`;
      reg.showNotification(`🎯 ${opp.strategyName}`, {
        body: `${matchName} · ${opp.teamName} · Confiança: ${opp.confidence}%`,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        vibrate: [200, 100, 200, 100, 300],
        tag: `opp-${opp.id}`,
        data: { url: '/radar' },
        requireInteraction: true,
      } as NotificationOptions);
    }).catch(() => {});
  };



  // Fetch match stats and pre-match dossiers for all live matches in background to perform scans
  const scanAllLiveMatchStats = useCallback(async (activeFixtures: Fixture[]) => {
    try {
      const now = Date.now();
      
      // Sort fixtures by league priority so major games (like Brasileirão, Premier League) are scanned first!
      const sortedFixtures = [...activeFixtures].sort(
        (a, b) => getFixturePriority(b.leagueName) - getFixturePriority(a.leagueName)
      );

      // Increase concurrent scans to top 15 games to cover all major matches on Pro plan
      const targetFixtures = sortedFixtures.slice(0, 15);
      
      for (const fixture of targetFixtures) {
        try {
          // 1. Pre-Match Dossier is strictly static - fetch only ONCE!
          setAllDossiers(prevDossiers => {
            if (!prevDossiers[fixture.id]) {
              apiSports.getPreMatchDossier(fixture.id).then(dossierRes => {
                if (dossierRes?.dossier) {
                  setAllDossiers(d => ({ ...d, [fixture.id]: dossierRes.dossier }));
                }
              }).catch(e => console.error("Error loading dossier in background:", e));
            }
            return prevDossiers;
          });
          
          // 2. Match Stats - query only if missing OR last queried > 45 seconds ago!
          const lastFetch = statsLastFetchRef.current[fixture.id] || 0;
          if (now - lastFetch > 45000) {
            const statsRes = await apiSports.getMatchStats(fixture.id, fixture.elapsed);
            if (statsRes?.stats) {
              statsLastFetchRef.current[fixture.id] = now;
              setRawApiStats(prevStats => ({ ...prevStats, [fixture.id]: statsRes.stats }));
            }
          }
        } catch (e) {
          console.error(`Error loading stats for scan fixture ${fixture.id}:`, e);
        }
      }
    } finally {
      // Done scan
    }
  }, []);

  // Fetch all live matches
  const fetchLiveMatches = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {


      // Real-time mode fetching live fixtures
      // 1. Fetch live matches from Sportsmonks Premium
      const smResult = await sportsmonks.getLiveFixtures();
      
      // 2. Fetch live matches from API-Sports (used ONLY for ID mapping / Team Matching)
      const apiSportsResult = await apiSports.getLiveFixtures();
      const apiSportsFixtures = apiSportsResult?.fixtures || [];
      
      let finalFixtures: any[] = smResult?.fixtures || [];
      let finalStats = smResult?.statsMap || {};
      
      if (finalFixtures.length > 0) {
        // Sportsmonks Live Premium is active!
        setApiErrorReason(null);
        setRawApiStats(finalStats);
        setActiveDataSource('sportsmonks');
        
        // Create ID mapping between Sportsmonks and API-Sports
        const mapping: Record<number, number> = {};
        finalFixtures.forEach(smFix => {
          const matched = apiSportsFixtures.find(apiFix => 
            fuzzyMatchTeam(smFix.homeTeam.name, apiFix.homeTeam.name) ||
            fuzzyMatchTeam(smFix.awayTeam.name, apiFix.awayTeam.name)
          );
          if (matched) {
            mapping[smFix.id] = matched.id;
          }
        });
        // Fetch pre-match dossiers in the background using mapped IDs
        const newDossierMap: Record<number, PreMatchDossier> = {};
        // Rate-limit the mapping to only the top 6 games to prevent API key depletion
        const targetFixtures = finalFixtures.slice(0, 6);
        for (const fixture of targetFixtures) {
          try {
            const apiSportsId = mapping[fixture.id] || fixture.id;
            const dossierRes = await apiSports.getPreMatchDossier(apiSportsId);
            newDossierMap[fixture.id] = dossierRes.dossier;
          } catch (e) {
            console.error(`Error loading dossier for Sportsmonks fixture ${fixture.id}:`, e);
          }
        }
        setAllDossiers(prev => ({ ...prev, ...newDossierMap }));
      } else {
        // 3. Fallback to Sofascore Live (Free, Unrestricted, Real live matches!)
        const sfResult = await sofascore.getLiveFixtures();
        const sfFixtures = sfResult?.fixtures || [];
        
        if (sfFixtures.length > 0) {
          setApiErrorReason(null);
          setRawApiStats(sfResult.statsMap || {});
          setActiveDataSource('sofascore');
          finalFixtures = sfFixtures;
          
          // Create ID mapping between Sofascore and API-Sports
          const mapping: Record<number, number> = {};
          finalFixtures.forEach(sfFix => {
            const matched = apiSportsFixtures.find(apiFix => 
              fuzzyMatchTeam(sfFix.homeTeam.name, apiFix.homeTeam.name) ||
              fuzzyMatchTeam(sfFix.awayTeam.name, apiFix.awayTeam.name)
            );
            if (matched) {
              mapping[sfFix.id] = matched.id;
            }
          });
          // Fetch pre-match dossiers using mapped IDs (rate-limited to 6)
          const newDossierMap: Record<number, PreMatchDossier> = {};
          const targetFixtures = finalFixtures.slice(0, 6);
          for (const fixture of targetFixtures) {
            try {
              const apiSportsId = mapping[fixture.id] || fixture.id;
              const dossierRes = await apiSports.getPreMatchDossier(apiSportsId);
              newDossierMap[fixture.id] = dossierRes.dossier;
            } catch (e) {
              console.error(`Error loading dossier for Sofascore fixture ${fixture.id}:`, e);
            }
          }
          setAllDossiers(prev => ({ ...prev, ...newDossierMap }));
        } else {
          // 4. Ultimate Fallback: API-Sports Live
          finalFixtures = apiSportsFixtures;
          setApiErrorReason(apiSportsResult?.errorReason || null);
          setActiveDataSource('apisports_real');
          
          if (finalFixtures.length > 0) {
            await scanAllLiveMatchStats(finalFixtures as any);
          }
        }
      }
      
      setFixtures(finalFixtures as any);
    } catch (err: any) {
      console.error(err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [scanAllLiveMatchStats]);

  // Synchronize or auto-select selectedFixture when fixtures list or allStats updates
  useEffect(() => {
    if (allFixtures.length === 0) {
      setSelectedFixture(null);
      return;
    }

    // Auto-select first game initially
    if (!selectedFixture) {
      setSelectedFixture(allFixtures[0]);
      return;
    }

    const updated = allFixtures.find(f => f.id === selectedFixture.id);
    if (updated) {
      if (
        updated.goalsHome !== selectedFixture.goalsHome ||
        updated.goalsAway !== selectedFixture.goalsAway ||
        updated.elapsed !== selectedFixture.elapsed ||
        updated.status !== selectedFixture.status
      ) {
        setSelectedFixture(updated);
      }
    } else {
      setSelectedFixture(allFixtures[0]);
    }
  }, [allFixtures, selectedFixture]);

  // Rule processing engine with Crossover logic matching live pressure with historical Pre-Live parameters
  useEffect(() => {
    const activeOpps: Opportunity[] = [];
    let playedSoundThisTick = false;

    allFixtures.forEach(fixture => {
      const stats = allStats[fixture.id];
      const dossier = allDossiers[fixture.id];
      if (!stats) return;

      const elapsed = getDisplayElapsed(fixture.id, fixture.elapsed || 0, fixture.status || '');
      const scoreHome = fixture.goalsHome;
      const scoreAway = fixture.goalsAway;

      // ═══════════════════════════════════════════════════════════════
      // THRESHOLDS baseados APENAS em dados reais da API-Sports
      // ═══════════════════════════════════════════════════════════════
      // Dados usados: IIM (chutes+cantos/min), corners, shotsOnGoal,
      //               totalShots, shotsInsideBox, possession, fouls,
      //               goalkeeperSaves, elapsed, placar
      // ═══════════════════════════════════════════════════════════════
      
      let iimThreshold = 1.1;           // IIM mínimo para cantos
      
      let htMinElapsed = 12;            // Over 0.5 HT: minuto mínimo
      let htMaxElapsed = 32;            // Over 0.5 HT: minuto máximo
      let htMinCombinedIIM = 1.4;       // Over 0.5 HT: IIM combinado mínimo
      let htMinShots = 3;               // Over 0.5 HT: chutes ao gol mínimo
      
      let backFavMinIIM = 1.2;          // Virada: IIM mínimo
      let backFavMinPossession = 60;    // Virada: posse mínima
      let backFavMinElapsed = 50;       // Virada: minuto mínimo

      let cornerThreshold = cornerTriggerThreshold;

      // 📊 Consolidar e calcular o APM Dinâmico e o ScoreFinal
      const unifiedSnapshots = [
        ...(stats.snapshots || []),
        ...(platformSnapshots[fixture.id] || [])
      ].reduce((acc: TelemetrySnapshot[], curr: any) => {
        if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
          acc.push(curr);
        }
        return acc;
      }, [] as TelemetrySnapshot[]).sort((a: TelemetrySnapshot, b: TelemetrySnapshot) => a.elapsed - b.elapsed);

      const getAttacksInWindow = (minutes: number, isHome: boolean): number => {
        const apmData = calculateDynamicAPM(
          unifiedSnapshots,
          elapsed || 0,
          stats.home.dangerousAttacks || 0,
          stats.away.dangerousAttacks || 0
        );
        const sideApm = isHome ? apmData.home : apmData.away;
        if (minutes === 10) return sideApm.apm10 * 10;
        if (minutes === 5) return sideApm.apm5 * 5;
        if (minutes === 3) return sideApm.apm3 * 3;
        return 0;
      };

      const getScoreFinalForSide = (isHome: boolean): number => {
        const teamStats = isHome ? stats.home : stats.away;
        
        const ap10 = getAttacksInWindow(10, isHome);
        const ap5 = getAttacksInWindow(5, isHome);
        const ap3 = getAttacksInWindow(3, isHome);
        const atm10 = ap10 / 10, atm5 = ap5 / 5, atm3 = ap3 / 3;
        const pressao = (0.20 * atm10) + (0.30 * atm5) + (0.50 * atm3);
        const accelRatio = atm10 > 0 ? atm3 / atm10 : 1.0;
        const momentum = Math.max(0.8, Math.min(1.8, Math.sqrt(accelRatio)));
        const niap = Math.min(10, pressao * 10 * momentum);
        const ncg = Math.min(10, ((teamStats.shotsOnGoal || 0) / 8) * 10);
        const nesc = Math.min(10, teamStats.corners || 0);
        const nft = Math.min(10, ((teamStats.totalShots || 0) / 15) * 10);
        const ncv = (teamStats.redCards || 0) === 0 ? 10 : 0;
        const npos = (Number(teamStats.possession) || 50) / 10;
        const nca = Math.min(10, (teamStats.yellowCards || 0) * 2);
        
        const w = activeScoreWeights;
        const totalW = w.niap + w.ncg + w.nesc + w.nft + w.ncv + w.npos + w.nca;
        const norm = totalW > 0 ? totalW / 100 : 1;
        const score = (niap * w.niap/100) + (ncg * w.ncg/100) + (nesc * w.nesc/100) + (nft * w.nft/100) + (ncv * w.ncv/100) + (npos * w.npos/100) + (nca * w.nca/100);
        return Math.min(10, Math.round(score / norm * 100) / 100);
      };

      const getPLSForSide = (isHome: boolean): number | null => {
        if (!dossier || !dossier.hasPredictions) return null;
        
        const strength = isHome ? dossier.offensiveStrengthHome : dossier.offensiveStrengthAway;
        const motivation = isHome ? dossier.motivationHome : dossier.motivationAway;
        const avgGoals = isHome ? dossier.avgGoalsScoredHome : dossier.avgGoalsScoredAway;
        const avgCorners = isHome ? dossier.avgCornersHome : dossier.avgCornersAway;
        
        const nStrength = Math.min(10, (strength || 50) / 10);
        const nMotivation = Math.min(10, (motivation || 50) / 10);
        const nGoals = Math.min(10, ((avgGoals || 1.2) / 2.5) * 10);
        const nCorners = Math.min(10, ((avgCorners || 4.5) / 7.0) * 10);
        
        const score = (nStrength * 0.40) + (nMotivation * 0.30) + (nGoals * 0.20) + (nCorners * 0.10);
        return Math.round(score * 10) / 10;
      };

      const homeScoreRaw = getScoreFinalForSide(true);
      const awayScoreRaw = getScoreFinalForSide(false);

      // ─── EMA Smoothing ───
      const prevEma = scoreEmaRef.current[fixture.id];
      let homeScoreFinal: number;
      let awayScoreFinal: number;
      if (prevEma) {
        homeScoreFinal = Math.round((EMA_ALPHA * homeScoreRaw + (1 - EMA_ALPHA) * prevEma.home) * 100) / 100;
        awayScoreFinal = Math.round((EMA_ALPHA * awayScoreRaw + (1 - EMA_ALPHA) * prevEma.away) * 100) / 100;
      } else {
        homeScoreFinal = homeScoreRaw;
        awayScoreFinal = awayScoreRaw;
      }
      scoreEmaRef.current[fixture.id] = { home: homeScoreFinal, away: awayScoreFinal };
      
      const homePLS = getPLSForSide(true);
      const awayPLS = getPLSForSide(false);

      const getQualityPctForSide = (scoreFinal: number, pls: number | null): number => {
        if (pls !== null) {
          return Math.min(100, Math.round((pls * 3.0) + (scoreFinal * 7.0)));
        }
        return Math.min(100, Math.round(scoreFinal * 10.0));
      };

      const homeQualityPct = getQualityPctForSide(homeScoreFinal, homePLS);
      const awayQualityPct = getQualityPctForSide(awayScoreFinal, awayPLS);

      // ═══════════════════════════════════════════════════════════════
      // 🎯 ESTRATÉGIA 1: CANTO LIMITE (MATEMÁTICO - SCORE FINAL)
      // Janelas obrigatórias: HT >= 35min ou FT >= 85min
      // ═══════════════════════════════════════════════════════════════
      const isCornerWindow = ((elapsed >= 35 && elapsed <= 45 && fixture.status === '1H') || 
                             (elapsed >= 85 && elapsed <= 95 && fixture.status === '2H'));
      // 🔔 Verificar janela de notificação configurada
      const isCornerAlertAllowed = isAlertAllowed(elapsed, fixture.status || '', 'escanteios');

      if (isCornerWindow && isCornerAlertAllowed) {
        // ─── Histerese + Confirmação por Scans (Mandante) ───
        const homeTriggerKey = `${fixture.id}-canto-home`;
        const homeTriggerState = triggerStateRef.current[homeTriggerKey] || { active: false, scansAbove: 0 };
        
        if (homeScoreFinal >= cornerThreshold) {
          homeTriggerState.scansAbove++;
        } else if (homeScoreFinal < cornerThreshold - HYSTERESIS) {
          homeTriggerState.active = false;
          homeTriggerState.scansAbove = 0;
        }
        // Mantém estado se está na zona de histerese (entre threshold-0.5 e threshold)
        
        if (homeTriggerState.scansAbove >= MIN_SCANS_ABOVE || homeTriggerState.active) {
          homeTriggerState.active = true;
          activeOpps.push({
            id: homeTriggerKey,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.homeTeam.name,
            confidence: homeQualityPct,
            details: `ScoreEMA: ${homeScoreFinal} (bruto: ${homeScoreRaw}) | Qualidade: ${homeQualityPct}% | IIA: ${((getAttacksInWindow(10, true)*0.2) + (getAttacksInWindow(5, true)*0.3) + (getAttacksInWindow(3, true)*0.5)).toFixed(2)} | FA: ${(getAttacksInWindow(5, true) > 0 ? getAttacksInWindow(3, true)/getAttacksInWindow(5, true) : 1.0).toFixed(2)} | Cantos: ${stats.home.corners} | Chutes Gol: ${stats.home.shotsOnGoal}${homePLS !== null ? ` | PLS: ${homePLS}` : ''}`,
            suggestion: `Entrar em "Canto Limite" acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
        triggerStateRef.current[homeTriggerKey] = homeTriggerState;

        // ─── Histerese + Confirmação por Scans (Visitante) ───
        const awayTriggerKey = `${fixture.id}-canto-away`;
        const awayTriggerState = triggerStateRef.current[awayTriggerKey] || { active: false, scansAbove: 0 };
        
        if (awayScoreFinal >= cornerThreshold) {
          awayTriggerState.scansAbove++;
        } else if (awayScoreFinal < cornerThreshold - HYSTERESIS) {
          awayTriggerState.active = false;
          awayTriggerState.scansAbove = 0;
        }
        
        if (awayTriggerState.scansAbove >= MIN_SCANS_ABOVE || awayTriggerState.active) {
          awayTriggerState.active = true;
          activeOpps.push({
            id: awayTriggerKey,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.awayTeam.name,
            confidence: awayQualityPct,
            details: `ScoreEMA: ${awayScoreFinal} (bruto: ${awayScoreRaw}) | Qualidade: ${awayQualityPct}% | IIA: ${((getAttacksInWindow(10, false)*0.2) + (getAttacksInWindow(5, false)*0.3) + (getAttacksInWindow(3, false)*0.5)).toFixed(2)} | FA: ${(getAttacksInWindow(5, false) > 0 ? getAttacksInWindow(3, false)/getAttacksInWindow(5, false) : 1.0).toFixed(2)} | Cantos: ${stats.away.corners} | Chutes Gol: ${stats.away.shotsOnGoal}${awayPLS !== null ? ` | PLS: ${awayPLS}` : ''}`,
            suggestion: `Entrar em "Canto Limite" acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
        triggerStateRef.current[awayTriggerKey] = awayTriggerState;
      }

      // ═══════════════════════════════════════════════════════════════
      // ⚽ ESTRATÉGIA 2: OVER 0.5 GOLS HT
      // Critérios: IIM combinado + Chutes ao Gol + Placar 0x0 (todos reais)
      // ═══════════════════════════════════════════════════════════════
      const isTimeOverHT = elapsed >= htMinElapsed && elapsed <= htMaxElapsed && scoreHome === 0 && scoreAway === 0;
      const isGoalsAlertAllowed = isAlertAllowed(elapsed, fixture.status || '', 'gols');
      if (isTimeOverHT && isGoalsAlertAllowed) {
        const combinedIIM = Number((stats.home.iim + stats.away.iim).toFixed(2));
        const combinedShots = stats.home.shotsOnGoal + stats.away.shotsOnGoal;
        const combinedTotalShots = stats.home.totalShots + stats.away.totalShots;
        const combinedInsideBox = stats.home.shotsInsideBox + stats.away.shotsInsideBox;
        
        if (combinedIIM >= htMinCombinedIIM && combinedShots >= htMinShots) {
          let confidence = 55 
            + Math.floor((combinedIIM - htMinCombinedIIM) * 80) 
            + (combinedShots * 4)
            + (combinedInsideBox * 2);
          
          // Bônus Dossiê: APENAS média de gols histórica (dado real da API)
          let dossierBonusDetails = '';
          if (dossier && (dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway) >= 3.0) {
            confidence += 10;
            dossierBonusDetails += ` | Média gols: ${(dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway).toFixed(1)} (+10%)`;
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-overht`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Over 0.5 Gols HT',
            teamName: 'Ambas',
            confidence,
            details: `IIM combinado: ${combinedIIM} | Chutes Gol: ${combinedShots} | Total Chutes: ${combinedTotalShots} | Dentro Área: ${combinedInsideBox}${dossierBonusDetails}`,
            suggestion: `Fazer entrada no mercado de "Acima de 0.5 Gols HT" (Over 0.5 HT) com odd mínima de 1.70.`
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // 📈 ESTRATÉGIA 3: VIRADA DO FAVORITO
      // Critérios: IIM + Posse + Placar desfavorável (todos dados reais)
      // ═══════════════════════════════════════════════════════════════
      const isTimeSecondHalf = elapsed >= backFavMinElapsed;
      const isViradaAlertAllowed = isAlertAllowed(elapsed, fixture.status || '', 'gols');
      if (isTimeSecondHalf && fixture.status !== 'HT' && isViradaAlertAllowed) {
        
        // Avalia se Mandante é favorito (dados reais: posse + volume de chutes)
        const isHomeFav = stats.home.possession >= backFavMinPossession || stats.home.totalShots > stats.away.totalShots * 1.5;
        const isHomeTrouble = scoreHome <= scoreAway;

        if (isHomeFav && isHomeTrouble && stats.home.iim >= backFavMinIIM) {
          let confidence = 65 
            + Math.floor((stats.home.iim - backFavMinIIM) * 60) 
            + (stats.home.corners * 1)
            + (stats.home.shotsInsideBox * 2);
          
          // Bônus Dossiê: APENAS probabilidade de vitória (dado real)
          let dossierBonusDetails = '';
          if (dossier && dossier.motivationHome >= 60) {
            confidence += 8;
            dossierBonusDetails += ` | Win% API: ${dossier.motivationHome}% (+8%)`;
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-virada-home`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Virada do Favorito',
            teamName: fixture.homeTeam.name,
            confidence,
            details: `IIM: ${stats.home.iim} | Posse: ${stats.home.possession}% | Chutes Gol: ${stats.home.shotsOnGoal} | Dentro Área: ${stats.home.shotsInsideBox}${dossierBonusDetails}`,
            suggestion: `Entrar a favor de "${fixture.homeTeam.name}" ou buscar "Over Gols no Jogo".`
          });
        }

        // Avalia se Visitante é favorito
        const isAwayFav = stats.away.possession >= backFavMinPossession || stats.away.totalShots > stats.home.totalShots * 1.5;
        const isAwayTrouble = scoreAway <= scoreHome;

        if (isAwayFav && isAwayTrouble && stats.away.iim >= backFavMinIIM) {
          let confidence = 65 
            + Math.floor((stats.away.iim - backFavMinIIM) * 60) 
            + (stats.away.corners * 1)
            + (stats.away.shotsInsideBox * 2);
          
          let dossierBonusDetails = '';
          if (dossier && dossier.motivationAway >= 60) {
            confidence += 8;
            dossierBonusDetails += ` | Win% API: ${dossier.motivationAway}% (+8%)`;
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-virada-away`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Virada do Favorito',
            teamName: fixture.awayTeam.name,
            confidence,
            details: `IIM: ${stats.away.iim} | Posse: ${stats.away.possession}% | Chutes Gol: ${stats.away.shotsOnGoal} | Dentro Área: ${stats.away.shotsInsideBox}${dossierBonusDetails}`,
            suggestion: `Entrar a favor de "${fixture.awayTeam.name}" ou buscar "Over Gols no Jogo".`
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // 🔻 ESTRATÉGIA 4: FUNIL (Pressão nos minutos finais)
      // Critérios: Janela final + IIM do dominante + empatando/perdendo por 1
      // ═══════════════════════════════════════════════════════════════
      if (activeMode === 'funnel') {
        const isFunilWindow = (elapsed >= 38 && elapsed <= 45 && fixture.status === '1H') ||
                              (elapsed >= 85 && elapsed <= 90 && fixture.status === '2H');
        const isFunilMarket = fixture.status === '1H' ? 'gols' as const : 'escanteios' as const;
        const isFunilAlertAllowed = isAlertAllowed(elapsed, fixture.status || '', isFunilMarket);
        
        if (isFunilWindow && isFunilAlertAllowed) {
          // Identifica time dominante (maior IIM)
          const homeDominant = stats.home.iim > stats.away.iim;
          const dominantIIM = homeDominant ? stats.home.iim : stats.away.iim;
          const dominantName = homeDominant ? fixture.homeTeam.name : fixture.awayTeam.name;
          const dominantGoals = homeDominant ? scoreHome : scoreAway;
          const opponentGoals = homeDominant ? scoreAway : scoreHome;
          const dominantStats = homeDominant ? stats.home : stats.away;
          
          // Condição do placar: empatando OU perdendo por 1
          const isDrawing = dominantGoals === opponentGoals;
          const isLosingByOne = (opponentGoals - dominantGoals) === 1;
          const isWinning = dominantGoals > opponentGoals;
          
          // NÃO gerar alerta se dominante está ganhando
          if (!isWinning && dominantIIM >= iimThreshold && (isDrawing || isLosingByOne)) {
            const situacao = isDrawing ? 'Empatando' : 'Perdendo por 1';
            let confidence = 65
              + Math.floor((dominantIIM - iimThreshold) * 100)
              + (dominantStats.shotsOnGoal * 3)
              + (dominantStats.shotsInsideBox * 2)
              + (dominantStats.corners * 2);
            
            let dossierBonusDetails = '';
            const dossier = allDossiers[fixture.id];
            if (dossier) {
              const dominantMotivation = homeDominant ? dossier.motivationHome : dossier.motivationAway;
              if (dominantMotivation >= 55) {
                confidence += 8;
                dossierBonusDetails += ` | Win%: ${dominantMotivation}% (+8%)`;
              }
            }
            
            confidence = Math.min(100, confidence);
            
            activeOpps.push({
              id: `${fixture.id}-funil-${homeDominant ? 'home' : 'away'}`,
              fixtureId: fixture.id,
              match: fixture,
              strategyName: 'Funil',
              teamName: dominantName,
              confidence,
              details: `🔻 FUNIL ${fixture.status === '1H' ? '1°T' : '2°T'} | ${situacao} | IIM: ${dominantIIM} | Chutes Gol: ${dominantStats.shotsOnGoal} | Cantos: ${dominantStats.corners} | Dentro Área: ${dominantStats.shotsInsideBox}${dossierBonusDetails}`,
              suggestion: `Pressão alta nos minutos finais! ${dominantName} ${situacao.toLowerCase()} com intensidade elevada. Buscar Over Gols ou Canto próximo.`
            });
          }
        }
      }
    });

    // Filter out dismissed fixtures BEFORE setting state and playing sounds
    const nonDismissedOpps = activeOpps.filter(opp => !dismissedFixtureIdsRef.current.has(opp.fixtureId));

    // Sound alerts triggers — only for non-dismissed
    nonDismissedOpps.forEach(opp => {
      if (!alertedIdsRef.current.has(opp.id)) {
        alertedIdsRef.current.add(opp.id);
        if (soundEnabled && !playedSoundThisTick) {
          playAlertSound();
          playedSoundThisTick = true;
        }
        // 📱 Push notification para mobile
        sendPushNotification(opp);
      }
    });

    setOpportunities(nonDismissedOpps);
  }, [allFixtures, allStats, allDossiers, soundEnabled, activeMode]);

  // Main polling effect for scanner (every 25 seconds for highly responsive scans)
  useEffect(() => {
    fetchLiveMatches(true);

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchLiveMatches(false); // Background silently updates
          return 25;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [fetchLiveMatches]);

  // ─── Cloud Sync Initialization ───
  useEffect(() => {
    const cleanup = initCloudSync();

    // Atualizar status periodicamente
    const statusInterval = setInterval(() => {
      setCloudSyncStatus(getCloudSyncStatus());
    }, 2000);

    return () => {
      cleanup();
      clearInterval(statusInterval);
    };
  }, []);

  // ─── Bet365 Bridge Listener (local + cloud broadcast) ───
  useEffect(() => {
    const cleanup = onBet365Data((payload) => {
      setBet365Bridge(payload);
      bet365DataRef.current = payload.matches;

      // 📡 Se temos extensão local, somos operador → transmitir para a nuvem
      markAsOperator();
      broadcastBridgeData(payload);
    });

    return cleanup;
  }, []);

  // ─── Bet365 Scanner Listener (local + cloud broadcast) ───
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'BET365_SCANNER_MATCHES') {
        const payload = e.data.payload;
        setScannerMatches(payload.matches || []);
        setScannerEnabled(payload.scannerEnabled || false);

        // 📡 Operador → transmitir para a nuvem
        markAsOperator();
        broadcastScannerData(payload.matches || [], payload.scannerEnabled || false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ─── Cloud Sync Receiver (receber dados de outro operador) ───
  useEffect(() => {
    const cleanupBridge = onCloudBridgeData((payload) => {
      setBet365Bridge(payload);
      bet365DataRef.current = payload.matches;
      console.log('[CloudSync] 📡 Bridge data recebida via cloud:', payload.matchCount, 'jogos');
    });

    const cleanupScanner = onCloudScannerData((matches, scannerEnabled) => {
      setScannerMatches(matches);
      setScannerEnabled(scannerEnabled);
      console.log('[CloudSync] 📡 Scanner data recebida via cloud:', matches.length, 'jogos');
    });

    return () => {
      cleanupBridge();
      cleanupScanner();
    };
  }, []);

  // 🎰 Função para adicionar jogo do Scanner como fixture manual (com nomes reais!)
  const addScannerFixture = useCallback((match: ScannerMatch) => {
    // Gerar ID determinístico a partir do matchKey
    let hash = 0;
    for (let i = 0; i < match.matchKey.length; i++) {
      hash = (hash << 5) - hash + match.matchKey.charCodeAt(i);
      hash |= 0;
    }
    const id = -Math.abs(hash);

    // Verificar se já foi adicionado
    if (scannerFixtureIdsRef.current.has(match.matchKey)) return;
    if (manualFixtures.some(f => f.id === id)) return;
    scannerFixtureIdsRef.current.add(match.matchKey);

    const newFixture = {
      id,
      status: match.status || '1H',
      elapsed: match.elapsed || 0,
      homeTeam: { name: match.homeTeam },
      awayTeam: { name: match.awayTeam },
      goalsHome: match.homeGoals || 0,
      goalsAway: match.awayGoals || 0,
      leagueName: match.league || 'Bet365 Scanner',
      matchUrl: '',
      source: 'scanner' as const,
      addedAt: Date.now()
    } as any;

    setManualFixtures(prev => [...prev, newFixture]);

    console.log(`[Scanner] ➕ Fixture criada: ${match.homeTeam} vs ${match.awayTeam}. Abra na Bet365 para conectar a Bridge.`);
  }, [manualFixtures]);

  // Separar fixtures por fonte: API vs Scanner
  const scannerFixtures = useMemo(() => {
    return manualFixtures.filter((f: any) => f.source === 'scanner');
  }, [manualFixtures]);
  const nonScannerManualFixtures = useMemo(() => {
    return manualFixtures.filter((f: any) => f.source !== 'scanner');
  }, [manualFixtures]);

  // Handle Recusar — dismiss notification for this fixture
  const handleRecusar = useCallback((opp: Opportunity) => {
    dismissFixture(opp.fixtureId);
  }, [dismissFixture]);

  // Filtered active opportunities by confidence, market preference, and dismissed
  const filteredOpps = useMemo(() => opportunities
    .filter(opp => {
      // Exclude dismissed fixtures
      if (dismissedFixtureIdsRef.current.has(opp.fixtureId)) return false;
      if (marketFilter === 'corners') {
        return opp.strategyName === 'Canto Limite';
      }
      if (marketFilter === 'goals') {
        return opp.strategyName === 'Over 0.5 Gols HT' || opp.strategyName === 'Virada do Favorito' || opp.strategyName === 'Funil';
      }
      return true;
    }), [opportunities, marketFilter, dismissedVersion]);

  return (
    <div>
      {/* ⚙️ Modal de Configuração de Pesos do Score */}
      {showWeightsModal && (() => {
        const currentWeights = weightsMarketTab === 'gols' ? scoreWeightsGols : scoreWeightsEscanteios;
        const setCurrentWeights = weightsMarketTab === 'gols' ? setScoreWeightsGols : setScoreWeightsEscanteios;
        const defaults = weightsMarketTab === 'gols' ? defaultWeightsGols : defaultWeightsEscanteios;
        const totalPct = currentWeights.niap + currentWeights.ncg + currentWeights.nesc + currentWeights.nft + currentWeights.ncv + currentWeights.npos + currentWeights.nca;
        const isBalanced = totalPct === 100;

        const factors: Array<{ key: keyof typeof currentWeights; label: string; icon: string; desc: string; color: string }> = [
          { key: 'niap', label: 'IAP (Intensidade de Ataque)', icon: '⚡', desc: 'Ataques perigosos por janela temporal', color: '#ef4444' },
          { key: 'ncg', label: 'Chutes ao Gol', icon: '🎯', desc: 'Finalizações no alvo', color: '#f59e0b' },
          { key: 'nesc', label: 'Escanteios', icon: '🚩', desc: 'Total de escanteios cobrados', color: '#10b981' },
          { key: 'nft', label: 'Finalizações Totais', icon: '👟', desc: 'Todas as finalizações (gol + fora)', color: '#3b82f6' },
          { key: 'ncv', label: 'Cartão Vermelho', icon: '🟥', desc: 'Penalidade: 0 se houver vermelho', color: '#dc2626' },
          { key: 'npos', label: 'Posse de Bola', icon: '⚽', desc: 'Domínio territorial', color: '#8b5cf6' },
          { key: 'nca', label: 'Cartões Amarelos', icon: '🟨', desc: 'Intensidade física / faltas', color: '#eab308' },
        ];

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setShowWeightsModal(false)}>
            <div style={{
              background: 'var(--bg-primary)', borderRadius: '16px',
              border: '1px solid var(--border-color)', width: isMobile ? '95vw' : '560px', maxWidth: '560px', maxHeight: '90vh',
              overflow: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <SettingsIcon size={18} /> ⚙️ Configurar Pesos do Score
                  </h3>
                  <button onClick={() => setShowWeightsModal(false)} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: '4px',
                  }}>✕</button>
                </div>
                {/* Market Tabs */}
                <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-surface)', borderRadius: '8px', padding: '3px' }}>
                  {[
                    { id: 'gols' as const, label: '⚽ Gols', desc: 'Over/Under, BTTS' },
                    { id: 'escanteios' as const, label: '🚩 Escanteios', desc: 'Over/Under Corners' },
                  ].map(tab => (
                    <button key={tab.id} onClick={() => setWeightsMarketTab(tab.id)} style={{
                      flex: 1, padding: '10px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                      background: weightsMarketTab === tab.id ? 'var(--accent-primary)' : 'transparent',
                      color: weightsMarketTab === tab.id ? '#fff' : 'var(--text-secondary)',
                      fontWeight: 800, fontSize: '0.8rem', transition: 'all 0.2s ease',
                      display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '2px',
                    }}>
                      <span>{tab.label}</span>
                      <span style={{ fontSize: '0.6rem', fontWeight: 600, opacity: 0.7 }}>{tab.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Total indicator */}
              <div style={{
                padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isBalanced ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                borderBottom: '1px solid var(--border-color)',
              }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isBalanced ? '#10b981' : '#ef4444' }}>
                  {isBalanced ? '✅ Pesos balanceados' : `⚠️ Total: ${totalPct}% (precisa somar 100%)`}
                </span>
                <button onClick={() => setCurrentWeights({...defaults})} style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                  fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)',
                }}>
                  🔄 Resetar Padrão
                </button>
              </div>

              {/* Sliders */}
              <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {factors.map(f => {
                  const val = currentWeights[f.key];
                  return (
                    <div key={f.key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>{f.icon} {f.label}</span>
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: '8px' }}>{f.desc}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button onClick={() => setCurrentWeights(prev => ({ ...prev, [f.key]: Math.max(0, prev[f.key] - 1) }))}
                            style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-secondary)' }}>−</button>
                          <span style={{
                            fontWeight: 900, fontSize: '0.95rem', color: f.color,
                            minWidth: '36px', textAlign: 'center' as const,
                          }}>{val}%</span>
                          <button onClick={() => setCurrentWeights(prev => ({ ...prev, [f.key]: Math.min(100, prev[f.key] + 1) }))}
                            style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-secondary)' }}>+</button>
                        </div>
                      </div>
                      <input
                        type="range" min={0} max={100} step={1} value={val}
                        onChange={e => setCurrentWeights(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                        style={{
                          width: '100%', height: '6px', borderRadius: '3px', cursor: 'pointer',
                          accentColor: f.color,
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 🎯 Threshold de Gatilho */}
              <div style={{
                padding: '16px 24px', borderTop: '1px solid var(--border-color)',
                background: 'rgba(239, 68, 68, 0.04)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>🎯 Gatilho de Entrada</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: '8px' }}>Score mínimo para notificar</span>
                  </div>
                  <span style={{
                    fontWeight: 900, fontSize: '1.1rem', color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.1)', padding: '4px 12px', borderRadius: '8px',
                  }}>{cornerTriggerThreshold.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={4.0} max={9.0} step={0.5} value={cornerTriggerThreshold}
                  onChange={e => setCornerTriggerThreshold(Number(e.target.value))}
                  style={{ width: '100%', height: '8px', borderRadius: '4px', cursor: 'pointer', accentColor: '#ef4444' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>4.0 (Muito Arriscado)</span>
                  <span>6.0 (Padrão)</span>
                  <span>9.0 (Ultra Conservador)</span>
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' as const }}>
                  Score ≥ <strong style={{ color: '#ef4444' }}>{cornerTriggerThreshold.toFixed(1)}</strong> → Dispara notificação de entrada | Potencial ≥ <strong>{(cornerTriggerThreshold - 1.0).toFixed(1)}</strong> → Fundo amarelo
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  Mercado ativo: <strong>{weightsMarketTab === 'gols' ? '⚽ Gols' : '🚩 Escanteios'}</strong>
                  {' • '}
                  {weightsSyncStatus === 'synced' ? '☁️ Supabase Sync ✅' : weightsSyncStatus === 'syncing' ? '⏳ Salvando...' : weightsSyncStatus === 'error' ? '⚠️ Offline (localStorage)' : '💾 Auto-save'}
                </span>
                <button onClick={() => setShowWeightsModal(false)} style={{
                  background: 'var(--accent-primary)', color: '#fff', border: 'none',
                  borderRadius: '8px', padding: '8px 20px', cursor: 'pointer',
                  fontWeight: 800, fontSize: '0.8rem',
                }}>
                  ✓ Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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

      {/* Header Area */}
      <div style={{ marginBottom: 20 }}>
        {/* Row 1: Title + Subtitle */}
        <div style={{ marginBottom: 10 }}>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            Radar de Oportunidades <Activity size={22} className="pulse-indicator" color="var(--status-green)" />
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Mapeamento e leitura automatizada do mercado de trading de futebol.</p>
        </div>

        {/* Row 2: Badges + Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 8, flexWrap: 'wrap' }}>
          {/* Status Connection Badges */}
          {activeDataSource === 'sportsmonks' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', border: '1px solid rgba(124, 58, 237, 0.2)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <CheckCircle size={10} /> SPORTSMONKS
            </span>
          )}
          {activeDataSource === 'sofascore' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <CheckCircle size={10} /> SOFASCORE LIVE
            </span>
          )}
          {activeDataSource === 'apisports_real' && (
            apiErrorReason === 'limit_reached' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
                <ShieldAlert size={10} /> API-SPORTS LIMITE
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--status-green-glow)', color: 'var(--status-green)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
                <CheckCircle size={10} /> API-SPORTS
              </span>
            )
          )}
          {activeDataSource !== 'apisports_real' && apiErrorReason === 'limit_reached' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <ShieldAlert size={10} /> API-SPORTS LIMITE
            </span>
          )}
          {bet365Bridge?.connected && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.65rem', padding: '3px 7px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
              🔗 BET365 ({bet365Bridge.matchCount})
            </span>
          )}

          {/* Separator */}
          <span style={{ width: 1, height: 18, background: 'var(--border-color)', margin: '0 4px', flexShrink: 0 }} />

          {/* Sound Toggle */}
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            style={{ 
              padding: '3px 8px', 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: 4,
              border: `1px solid ${soundEnabled ? 'rgba(5, 150, 105, 0.3)' : 'var(--border-color)'}`,
              borderRadius: 4,
              background: soundEnabled ? 'var(--status-green-glow)' : 'transparent',
              color: soundEnabled ? 'var(--status-green)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.65rem',
              outline: 'none',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {soundEnabled ? <Volume2 size={10} /> : <VolumeX size={10} />}
            {soundEnabled ? 'SOM ON' : 'SOM OFF'}
          </button>

          {/* 📱 Push Notification Toggle */}
          {'Notification' in window && (
            <button 
              onClick={() => {
                if (Notification.permission === 'default') {
                  Notification.requestPermission();
                }
              }}
              style={{ 
                padding: '3px 8px', 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: 4,
                border: `1px solid ${Notification.permission === 'granted' ? 'rgba(5, 150, 105, 0.3)' : 'var(--border-color)'}`,
                borderRadius: 4,
                background: Notification.permission === 'granted' ? 'var(--status-green-glow)' : 'transparent',
                color: Notification.permission === 'granted' ? 'var(--status-green)' : 'var(--text-muted)',
                cursor: Notification.permission === 'default' ? 'pointer' : 'default',
                fontWeight: 700,
                fontSize: '0.65rem',
                outline: 'none',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-sans)',
              }}
              title={Notification.permission === 'granted' ? 'Push notifications ativadas' : Notification.permission === 'denied' ? 'Bloqueado pelo navegador' : 'Clique para ativar push notifications'}
            >
              {Notification.permission === 'granted' ? '🔔' : Notification.permission === 'denied' ? '🔕' : '🔔'}
              {Notification.permission === 'granted' ? 'PUSH ON' : Notification.permission === 'denied' ? 'PUSH OFF' : 'ATIVAR PUSH'}
            </button>
          )}

          {/* Cloud Sync Status Badge */}
          <span style={{
            padding: '3px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            border: `1px solid ${cloudSyncStatus.connected ? (cloudSyncStatus.isOperator ? 'rgba(5, 150, 105, 0.3)' : 'rgba(59, 130, 246, 0.3)') : 'var(--border-color)'}`,
            borderRadius: 4,
            background: cloudSyncStatus.connected ? (cloudSyncStatus.isOperator ? 'var(--status-green-glow)' : 'rgba(59, 130, 246, 0.1)') : 'transparent',
            color: cloudSyncStatus.connected ? (cloudSyncStatus.isOperator ? 'var(--status-green)' : '#3b82f6') : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.6rem',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-sans)',
          }}>
            {cloudSyncStatus.connected ? (
              cloudSyncStatus.isOperator ? '🟢 OPERADOR' : '📡 CLOUD SYNC'
            ) : '⚪ OFFLINE'}
            {cloudSyncStatus.activeDevices > 1 && ` (${cloudSyncStatus.activeDevices})`}
          </span>

          {/* Countdown */}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <RefreshCw size={11} className={loading ? 'pulse-indicator' : ''} />
            {countdown}s
          </span>
        </div>
      </div>


      {/* 🛠️ BARRA DE CONTROLE PREMIUM (Market Filters, Data Sources and Mode Status) */}
      <div className="card glass-panel" style={{
        marginBottom: 20,
        padding: '12px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.7)',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        flexWrap: 'wrap',
        gap: 16
      }}>
        {/* Operation Mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Estratégia:</span>
          <span style={{
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '6px 12px',
            borderRadius: 6,
            background: activeMode === 'arriscado' ? 'rgba(239, 68, 68, 0.1)' : activeMode === 'conservador' ? 'rgba(16, 185, 129, 0.1)' : 'var(--accent-glow)',
            color: activeMode === 'arriscado' ? '#ef4444' : activeMode === 'conservador' ? '#10b981' : 'var(--accent-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}>
            {activeMode === 'arriscado' && <TrendingUp size={14} />}
            {activeMode === 'classico' && <CheckCircle size={14} />}
            {activeMode === 'conservador' && <Shield size={14} />}
            {activeMode === 'arriscado' && 'Arriscado'}
            {activeMode === 'classico' && 'Clássico'}
            {activeMode === 'conservador' && 'Conservador'}
          </span>
        </div>

        {/* Market Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Mercado:</span>
          <div style={{ display: 'inline-flex', background: 'var(--bg-elevated)', padding: 3, borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <button 
              onClick={() => setMarketFilter('all')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: marketFilter === 'all' ? 'var(--accent-primary)' : 'transparent',
                color: marketFilter === 'all' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Todos
            </button>
            <button 
              onClick={() => setMarketFilter('corners')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: marketFilter === 'corners' ? 'var(--accent-primary)' : 'transparent',
                color: marketFilter === 'corners' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Escanteios
            </button>
            <button 
              onClick={() => setMarketFilter('goals')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: marketFilter === 'goals' ? 'var(--accent-primary)' : 'transparent',
                color: marketFilter === 'goals' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Gols
            </button>
          </div>
        </div>


      </div>

      {/* ⚠️ Alerta de Limite ou Erro da API Real */}
      {apiErrorReason && apiErrorReason !== 'limit_reached' && (
        <div className="card" style={{ 
          marginBottom: 20, 
          padding: '16px 20px', 
          background: 'rgba(239, 68, 68, 0.05)', 
          border: '1px solid rgba(239, 68, 68, 0.2)', 
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{ color: 'var(--status-red)', display: 'flex', alignItems: 'center' }}>
            <ShieldAlert size={28} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--status-red)', marginBottom: 4 }}>
              Erro de Conexão com a API!
            </h4>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <span>
                Ocorreu um erro ao validar a chave de API integrada ou houve falha na rede de telemetria. Certifique-se de que sua conexão de internet está ativa e que a API Key integrada está ativa no painel do provedor de dados.
              </span>
            </p>
          </div>
        </div>
      )}



      {/* 🎰 Painel Scanner — Dropdown Fixo */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => scannerMatches.length > 0 && setScannerDropdownOpen(!scannerDropdownOpen)}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderRadius: scannerDropdownOpen ? '12px 12px 0 0' : 12,
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(139, 92, 246, 0.03) 100%)',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            borderBottom: scannerDropdownOpen ? '1px solid rgba(168, 85, 247, 0.12)' : '1px solid rgba(168, 85, 247, 0.25)',
            cursor: scannerMatches.length > 0 ? 'pointer' : 'default',
            transition: 'all 0.2s ease',
            outline: 'none',
            boxShadow: '0 4px 20px rgba(168, 85, 247, 0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>🎰</span>
            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Bet365 Scanner
            </span>
            {scannerMatches.length === 0 ? (
              <span style={{ 
                fontSize: '0.75rem', 
                color: 'var(--text-muted)', 
                fontWeight: 500 
              }}>
                — Nenhum jogo detectado
              </span>
            ) : (
              <span className="badge" style={{ 
                background: 'rgba(168, 85, 247, 0.15)', 
                color: '#a855f7', 
                fontWeight: 700, 
                fontSize: '0.75rem',
                padding: '3px 10px',
                animation: 'pulse 2s ease-in-out infinite'
              }}>
                {scannerMatches.length} {scannerMatches.length === 1 ? 'jogo encontrado' : 'jogos encontrados'}
              </span>
            )}
            {scannerEnabled && (
              <span style={{ 
                width: 8, height: 8, borderRadius: '50%', 
                background: '#10b981', 
                boxShadow: '0 0 6px #10b981',
                flexShrink: 0
              }} />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {scannerMatches.length > 0 && (
              <span style={{ 
                fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 
              }}>
                {scannerDropdownOpen ? '▲ Fechar' : '▼ Ver jogos'}
              </span>
            )}
            {/* Botão Limpar Travados */}
            {manualFixtures.filter((f: any) => f.source === 'scanner').length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const scannerCount = manualFixtures.filter((f: any) => f.source === 'scanner').length;
                  if (window.confirm(`🗑️ LIMPAR TUDO (${scannerCount} jogos)\n\nIsso remove TODOS os jogos do scanner e seus dados acumulados (stats, alertas, snapshots).\n\nJogos ativos serão re-adicionados do zero pelo scanner.`)) {
                    // 1. Remover fixtures do scanner
                    setManualFixtures(prev => prev.filter((f: any) => f.source !== 'scanner'));
                    
                    // 3. Limpar localStorage
                    localStorage.removeItem('bet365_manual_fixtures');
                    localStorage.removeItem('dismissed_fixture_ids');
                    
                    // 4. Limpar sessionStorage (telemetry snapshots)
                    sessionStorage.removeItem('platform_telemetry_snapshots');
                    
                    // 5. Limpar TODOS os refs de tracking
                    scannerFixtureIdsRef.current.clear();
                    newFixtureIdsRef.current.clear();
                    setNewFixtureIds(new Set());
                    alertedIdsRef.current.clear();
                    dismissedFixtureIdsRef.current.clear();
                    setDismissedVersion(v => v + 1);
                    scoreEmaRef.current = {};
                    triggerStateRef.current = {};
                    elapsedAnchorRef.current = {};
                    
                    // 6. Limpar snapshots de telemetria em memória
                    setPlatformSnapshots({});
                    
                    // 7. Limpar oportunidades ativas
                    setOpportunities([]);
                    
                    console.log(`[Scanner] 🗑️ LIMPEZA TOTAL: ${scannerCount} jogos + todos os dados associados`);
                  }
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  fontSize: '0.65rem', fontWeight: 700, color: '#ef4444',
                  display: 'flex', alignItems: 'center', gap: 4,
                  whiteSpace: 'nowrap',
                }}
                title="Remove todos os jogos do scanner (jogos ativos serão re-adicionados)"
              >
                🗑️ Limpar
              </button>
            )}
          </div>
        </button>

        {/* Dropdown com lista de jogos */}
        {scannerDropdownOpen && scannerMatches.length > 0 && (
          <div style={{
            border: '1px solid rgba(168, 85, 247, 0.25)',
            borderTop: 'none',
            borderRadius: '0 0 12px 12px',
            background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.03) 0%, rgba(139, 92, 246, 0.01) 100%)',
            padding: '12px 16px',
            maxHeight: 350,
            overflowY: 'auto',
          }}>
            {/* Botão Acompanhar Todos */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  scannerMatches.forEach(m => {
                    if (!scannerFixtureIdsRef.current.has(m.matchKey)) {
                      addScannerFixture(m);
                    }
                  });
                }}
                className="btn"
                style={{
                  fontSize: '0.75rem',
                  padding: '5px 12px',
                  borderRadius: 6,
                  background: 'rgba(168, 85, 247, 0.12)',
                  color: '#a855f7',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                ▶ Acompanhar Todos
              </button>
            </div>

            {/* Lista agrupada por liga */}
            {(() => {
              const grouped: Record<string, ScannerMatch[]> = {};
              scannerMatches.forEach(m => {
                const league = m.league || 'Outros';
                if (!grouped[league]) grouped[league] = [];
                grouped[league].push(m);
              });
              
              return Object.entries(grouped).map(([league, matches]) => (
                <div key={league} style={{ marginBottom: 10 }}>
                  <div style={{ 
                    fontSize: '0.7rem', 
                    fontWeight: 700, 
                    color: '#a855f7', 
                    textTransform: 'uppercase',
                    marginBottom: 4,
                    letterSpacing: '0.03em'
                  }}>
                    🏆 {league}
                  </div>
                  {matches.map(match => {
                    const isAdded = scannerFixtureIdsRef.current.has(match.matchKey);
                    return (
                      <div 
                        key={match.matchKey}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: isAdded ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isAdded ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.04)'}`,
                          marginBottom: 3,
                          transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 180 }}>
                            {match.homeTeam} <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>vs</span> {match.awayTeam}
                          </span>
                          <span style={{ 
                            fontSize: '0.8rem', fontWeight: 800, 
                            color: 'var(--text-primary)',
                            background: 'rgba(255,255,255,0.06)',
                            padding: '1px 6px', borderRadius: 4,
                            minWidth: 36, textAlign: 'center'
                          }}>
                            {match.homeGoals} - {match.awayGoals}
                          </span>
                          <span style={{ 
                            fontSize: '0.7rem', 
                            color: match.status === 'HT' ? '#f59e0b' : '#10b981',
                            fontWeight: 600
                          }}>
                            {match.timer || `${match.elapsed}'`} {match.status}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); !isAdded && addScannerFixture(match); }}
                          disabled={isAdded}
                          style={{
                            fontSize: '0.7rem',
                            padding: '3px 10px',
                            borderRadius: 5,
                            background: isAdded ? 'rgba(16, 185, 129, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                            color: isAdded ? '#10b981' : '#a855f7',
                            border: `1px solid ${isAdded ? 'rgba(16, 185, 129, 0.3)' : 'rgba(168, 85, 247, 0.3)'}`,
                            fontWeight: 700,
                            cursor: isAdded ? 'default' : 'pointer',
                            transition: 'all 0.2s',
                            minWidth: 90
                          }}
                        >
                          {isAdded ? '✅ Adicionado' : '▶ Acompanhar'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      {/* Seletor de Partidas Ativas (Dropdown / Tabela Collapsible) */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => setShowMatchesTable(!showMatchesTable)}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderRadius: 12,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            outline: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-primary)' }}>
            <Activity size={18} color="var(--accent-primary)" className="pulse-indicator" />
            <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
              Partidas Ativas sob Varredura Inteligente
            </span>
            <span className="badge" style={{ marginLeft: 6, fontSize: '0.75rem', background: 'var(--accent-glow)', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {allFixtures.length} {allFixtures.length === 1 ? 'Jogo' : 'Jogos'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
              {showMatchesTable ? 'Ocultar Painel' : 'Visualizar Tabela de Métricas'}
            </span>
            {showMatchesTable ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {showMatchesTable && (
          <div 
            className="card glass-panel" 
            style={{ 
              marginTop: 12, 
              padding: '16px 20px', 
              borderRadius: 12, 
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              overflowX: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
              transition: 'all 0.2s ease'
            }}
          >
            {/* Filtros de Fonte */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: 4 }}>FONTE:</span>
              {([
                { key: 'all' as const, label: 'TODOS', icon: '📊', color: 'var(--accent-primary)' },
                { key: 'api' as const, label: 'API', icon: '📡', color: '#3b82f6' },
                { key: 'bet365' as const, label: 'BET365', icon: '🎰', color: '#a855f7' },
                { key: 'favorites' as const, label: 'FAVORITOS', icon: '⭐', color: '#f59e0b' },
              ]).map(f => (
                <button
                  key={f.key}
                  onClick={() => setFixtureSourceFilter(f.key)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 20,
                    border: fixtureSourceFilter === f.key ? `2px solid ${f.color}` : '2px solid transparent',
                    background: fixtureSourceFilter === f.key ? `${f.color}18` : 'var(--bg-card)',
                    color: fixtureSourceFilter === f.key ? f.color : 'var(--text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {f.icon} {f.label}
                  <span style={{
                    fontSize: '0.65rem',
                    background: fixtureSourceFilter === f.key ? `${f.color}25` : 'var(--bg-surface)',
                    padding: '1px 5px',
                    borderRadius: 8,
                    marginLeft: 2,
                    fontWeight: 700,
                  }}>
                    {f.key === 'all' ? allFixtures.length : f.key === 'api' ? (fixtures.length + nonScannerManualFixtures.length) : scannerFixtures.length}
                  </span>
                </button>
              ))}
            </div>
            
            {/* 🧠 Smart Filters */}
            {(() => {
              // Pre-calculate counts for each smart filter
              const allFixturesForCount = allFixtures.filter(f => {
                if (fixtureSourceFilter === 'favorites') return favoriteFixtureIds.has(f.id);
                return true;
              });
              
              const passesSmartFilterCheck = (filter: string, f: any) => {
                const stats = allStats[f.id];
                const elapsed = getDisplayElapsed(f.id, f.elapsed || 0, f.status || '');
                const status = (f.status || '').toUpperCase();
                
                if (filter === 'apm_window') {
                  // Jogos próximos de abrir janelas APM: 15-22 (pré-APM10), 22-27 (pré-APM5), 27-32 (pré-APM3)
                  // Ou já dentro da janela ativa
                  return (elapsed >= 15 && elapsed <= 32) && status !== 'HT' && status !== 'FT';
                }
                
                if (filter === 'draw_underdog') {
                  // Empate OU favorito perdendo (favorito = mais posse ou mais ataques perigosos)
                  const goalsH = f.goalsHome ?? 0;
                  const goalsA = f.goalsAway ?? 0;
                  const isDraw = goalsH === goalsA;
                  
                  if (isDraw) return true;
                  
                  // Favorito perdendo: quem tem mais posse/ataques está perdendo
                  if (stats) {
                    const homePoss = Number(stats.home?.possession) || 50;
                    const awayPoss = Number(stats.away?.possession) || 50;
                    const homeDA = stats.home?.dangerousAttacks || 0;
                    const awayDA = stats.away?.dangerousAttacks || 0;
                    const homeIsFav = homePoss > awayPoss || homeDA > awayDA;
                    
                    if (homeIsFav && goalsH < goalsA) return true;
                    if (!homeIsFav && goalsA < goalsH) return true;
                  }
                  return false;
                }
                
                if (filter === 'high_pressure') {
                  // IIM alto (>= 1.0) + janela de escanteio (35-45 1H / 75-95 2H)
                  if (!stats) return false;
                  const homeIIM = stats.home?.iim || 0;
                  const awayIIM = stats.away?.iim || 0;
                  const maxIIM = Math.max(homeIIM, awayIIM);
                  const isCornerZone = (elapsed >= 35 && elapsed <= 45 && status === '1H') || 
                                       (elapsed >= 75 && status === '2H');
                  return maxIIM >= 1.0 && isCornerZone;
                }
                
                return true;
              };
              
              const countApmWindow = allFixturesForCount.filter(f => passesSmartFilterCheck('apm_window', f)).length;
              const countDrawUnderdog = allFixturesForCount.filter(f => passesSmartFilterCheck('draw_underdog', f)).length;
              const countHighPressure = allFixturesForCount.filter(f => passesSmartFilterCheck('high_pressure', f)).length;
              
              const smartFilterDefs = [
                { key: 'none' as const, label: 'TODOS', icon: '🔍', color: 'var(--text-muted)', count: allFixturesForCount.length, desc: '' },
                { key: 'apm_window' as const, label: 'JANELA APM', icon: '⏱️', color: '#f59e0b', count: countApmWindow, desc: '15-32 min' },
                { key: 'draw_underdog' as const, label: 'EMPATE / FAVORITO ↓', icon: '⚖️', color: '#8b5cf6', count: countDrawUnderdog, desc: 'Placares favoráveis' },
                { key: 'high_pressure' as const, label: 'PRESSÃO ALTA', icon: '🔥', color: '#ef4444', count: countHighPressure, desc: 'IIM alto + Janela canto' },
              ];
              
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: 4 }}>FILTRO:</span>
                  {smartFilterDefs.map(sf => {
                    const isActive = sf.key === 'none' ? smartFilters.size === 0 : smartFilters.has(sf.key);
                    const handleClick = () => {
                      if (sf.key === 'none') {
                        setSmartFilters(new Set());
                      } else {
                        setSmartFilters(prev => {
                          const next = new Set(prev);
                          if (next.has(sf.key)) {
                            next.delete(sf.key);
                          } else {
                            next.add(sf.key);
                          }
                          return next;
                        });
                      }
                    };
                    return (
                      <button
                        key={sf.key}
                        onClick={handleClick}
                        title={sf.desc}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 16,
                          border: isActive ? `2px solid ${sf.color}` : '2px solid transparent',
                          background: isActive ? `${sf.color}18` : 'var(--bg-card)',
                          color: isActive ? sf.color : 'var(--text-muted)',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          opacity: sf.key !== 'none' && sf.count === 0 ? 0.4 : 1,
                        }}
                      >
                        {sf.icon} {sf.label}
                        <span style={{
                          fontSize: '0.6rem',
                          background: isActive ? `${sf.color}25` : 'var(--bg-surface)',
                          padding: '1px 5px',
                          borderRadius: 8,
                          marginLeft: 1,
                          fontWeight: 700,
                        }}>{sf.count}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {fixtureSourceFilter === 'favorites' && favoriteFixtureIds.size === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⭐</div>
                <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '6px', color: 'var(--text-primary)' }}>Nenhum jogo favoritado</p>
                <p style={{ fontSize: '0.8rem' }}>Clique na ⭐ ao lado do nome de qualquer jogo para adicioná-lo aos favoritos.</p>
              </div>
            ) : allFixtures.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600 }}>Nenhuma partida ao vivo sob varredura no momento.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 800 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Partida / Liga</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Placar / Tempo</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>IIM (C / F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>APM (C / F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Escanteios (C-F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Chutes Alvo (C-F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Posse (C-F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Motivação IA (C-F)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Score Final</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Qualidade (%)</th>
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Status Scanner</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ═══ SEÇÃO 1: Partidas da API ═══ */}
                  {fixtureSourceFilter !== 'bet365' && fixtures.length > 0 && (
                    <tr>
                      <td colSpan={11} style={{
                        padding: '10px 8px 6px',
                        borderBottom: '2px solid rgba(59, 130, 246, 0.3)',
                        background: 'rgba(59, 130, 246, 0.04)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.85rem' }}>📡</span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Partidas API</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', padding: '2px 6px', borderRadius: 4 }}>
                            {fixtures.length + nonScannerManualFixtures.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {fixtureSourceFilter !== 'bet365' && [...fixtures, ...nonScannerManualFixtures]
                    .filter(f => fixtureSourceFilter !== 'favorites' || favoriteFixtureIds.has(f.id))
                    .filter(f => passesSmartFilter(f))
                    .map(f => {
                    const stats = allStats[f.id];
                    const dossier = allDossiers[f.id];
                    
                    // Check if this fixture has an active opportunity matching the criteria
                    const hasOpp = opportunities.some(opp => opp.fixtureId === f.id);
                    
                    // 🔥 DETECÇÃO DE POTENCIAL & GATILHO BASEADOS NO SCORE FINAL
                    const triggerThreshold = cornerTriggerThreshold;
                    const potentialThreshold = triggerThreshold - 1.0;

                    const homeScore = stats ? getScoreFinalForSide(f.id, true) : 0;
                    const awayScore = stats ? getScoreFinalForSide(f.id, false) : 0;
                    const homeQual = stats ? getQualityPctForSide(f.id, true) : 0;
                    const awayQual = stats ? getQualityPctForSide(f.id, false) : 0;

                    // Filtros de contexto: só marca potencial se faz sentido apostar
                    const isValidTime = f.elapsed <= 90 && f.status !== 'HT';
                    const hasPotential = !hasOpp && isValidTime && stats && (
                      homeScore >= potentialThreshold || awayScore >= potentialThreshold
                    );
                    
                    return (
                      <Fragment key={`group-fixture-${f.id}`}>
                        <tr 
                          key={`table-fixture-${f.id}`}
                          onClick={() => setExpandedFixtureId(expandedFixtureId === f.id ? null : f.id)}
                          style={{ 
                            borderBottom: '1px solid var(--border-color)',
                            background: hasOpp ? 'rgba(16, 185, 129, 0.06)' : hasPotential ? 'rgba(245, 158, 11, 0.04)' : 'transparent',
                            transition: 'background 0.15s ease',
                            cursor: 'pointer'
                          }}
                        >
                          {/* Partida */}
                          <td style={{ padding: '14px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {expandedFixtureId === f.id ? (
                                  <ChevronUp size={16} style={{ color: 'var(--accent-primary)' }} />
                                ) : (
                                  <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                                )}
                                <button
                                  onClick={(e) => toggleFavorite(f.id, e)}
                                  title={favoriteFixtureIds.has(f.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                                  style={{
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                                    fontSize: '1rem', lineHeight: 1, transition: 'transform 0.2s ease',
                                    transform: favoriteFixtureIds.has(f.id) ? 'scale(1.2)' : 'scale(1)',
                                    filter: favoriteFixtureIds.has(f.id) ? 'none' : 'grayscale(1) opacity(0.4)',
                                  }}
                                >
                                  ⭐
                                </button>
                              </div>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span>{f.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {f.awayTeam.name}</span>
                                  {newFixtureIds.has(f.id) && (
                                    <span style={{
                                      fontSize: '0.55rem', fontWeight: 900, color: '#fff',
                                      background: 'linear-gradient(135deg, #10b981, #059669)',
                                      padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em',
                                      animation: 'pulse 2s infinite',
                                      boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)',
                                    }}>🆕 NOVO</span>
                                  )}
                                  {(f as any).matchUrl && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <a 
                                        href={(f as any).matchUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ 
                                          fontSize: '0.65rem', 
                                          fontWeight: 800, 
                                          color: '#3b82f6', 
                                          background: 'rgba(59, 130, 246, 0.1)', 
                                          padding: '2px 6px', 
                                          borderRadius: '4px',
                                          textDecoration: 'none',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '2px'
                                        }}
                                        title="Abrir partida na Bet365 para ativar telemetria"
                                      >
                                        🔗 Conectar
                                      </a>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm(`Deseja remover a partida "${f.homeTeam.name} vs ${f.awayTeam.name}" do Radar?`)) {
                                            setManualFixtures(prev => prev.filter(m => m.id !== f.id));
                                          }
                                        }}
                                        style={{
                                          fontSize: '0.65rem',
                                          fontWeight: 800,
                                          color: '#ef4444',
                                          background: 'rgba(239, 68, 68, 0.1)',
                                          border: 'none',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '2px',
                                          outline: 'none'
                                        }}
                                        title="Excluir partida manual do Radar"
                                      >
                                        🗑️ Excluir
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2, fontWeight: 700 }}>
                                  {f.leagueName}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Placar e Tempo */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>
                              {getDisplayScore(f.id, f.goalsHome, f.goalsAway).home} - {getDisplayScore(f.id, f.goalsHome, f.goalsAway).away}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 2 }}>
                              <span className="pulse-indicator" style={{ background: 'var(--status-green)', width: 6, height: 6 }}></span>
                              {getDisplayElapsed(f.id, f.elapsed, f.status)}' Min
                            </div>
                          </td>

                          {/* IIM */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mapeando IIM...</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                <span style={{ color: stats.home.iim >= 1.0 ? 'var(--status-green)' : 'var(--text-primary)' }}>
                                  {stats.home.iim}
                                </span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                <span style={{ color: stats.away.iim >= 1.0 ? 'var(--status-green)' : 'var(--text-primary)' }}>
                                  {stats.away.iim}
                                </span>
                                {!stats.hasTelemetry && stats.hasBridge && (
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* APM */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                            ) : (stats.home.dangerousAttacks > 0 || stats.away.dangerousAttacks > 0) ? (() => {
                              const fullElapsed = Math.max(f.elapsed, 1);
                              const homeAPM = Math.round((stats.home.dangerousAttacks / fullElapsed) * 100) / 100;
                              const awayAPM = Math.round((stats.away.dangerousAttacks / fullElapsed) * 100) / 100;
                              return (
                                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                  <span style={{ color: homeAPM >= 1.0 ? '#ef4444' : homeAPM >= 0.6 ? 'var(--status-yellow)' : 'var(--text-primary)' }}>
                                    {homeAPM}
                                  </span>
                                  <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                  <span style={{ color: awayAPM >= 1.0 ? '#ef4444' : awayAPM >= 0.6 ? 'var(--status-yellow)' : 'var(--text-primary)' }}>
                                    {awayAPM}
                                  </span>
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                </div>
                              );
                            })() : (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>s/ bridge</span>
                            )}
                          </td>

                          {/* Escanteios */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                {stats.home.corners} - {stats.away.corners}
                                {!stats.hasTelemetry && stats.hasBridge && (
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Chutes no Alvo */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                {stats.home.shotsOnGoal} - {stats.away.shotsOnGoal}
                                {!stats.hasTelemetry && stats.hasBridge && (
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Posse */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                {stats.home.possession}% - {stats.away.possession}%
                                {!stats.hasTelemetry && stats.hasBridge && (
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Necessidade IA */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!dossier ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cruzando dados...</span>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                {dossier.motivationHome}% <span style={{ color: 'var(--text-muted)' }}>/</span> {dossier.motivationAway}%
                              </div>
                            )}
                          </td>

                          {/* Score Final */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                            ) : (
                              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>
                                <span style={{ color: homeScore >= 8.0 ? '#ef4444' : homeScore >= 7.0 ? 'var(--status-green)' : homeScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)' }}>
                                  {homeScore}
                                </span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                <span style={{ color: awayScore >= 8.0 ? '#ef4444' : awayScore >= 7.0 ? 'var(--status-green)' : awayScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)' }}>
                                  {awayScore}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Qualidade (%) */}
                          <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                            {!stats ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                            ) : (
                              <div style={{ fontWeight: 900, fontSize: '0.85rem' }}>
                                <span style={{ color: homeQual >= 80 ? '#ef4444' : homeQual >= 70 ? 'var(--status-green)' : homeQual >= 50 ? 'var(--status-yellow)' : 'var(--text-muted)' }}>
                                  {homeQual}%
                                </span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                <span style={{ color: awayQual >= 80 ? '#ef4444' : awayQual >= 70 ? 'var(--status-green)' : awayQual >= 50 ? 'var(--status-yellow)' : 'var(--text-muted)' }}>
                                  {awayQual}%
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Status Scanner */}
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            {hasOpp ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                <span className="badge" style={{ fontSize: '0.7rem', fontWeight: 800, padding: '4px 8px', background: 'var(--status-green-glow)', color: 'var(--status-green)', animation: 'pulse 2s ease-in-out infinite' }}>
                                  ⚡ GATILHO ATIVO
                                </span>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                                  {getEnabledBookmakers().map(bk => (
                                    <a
                                      key={bk.id}
                                      href={bk.liveUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        fontSize: '0.6rem', fontWeight: 800,
                                        color: bk.color, background: bk.bgColor,
                                        padding: '2px 6px', borderRadius: 4,
                                        textDecoration: 'none', border: `1px solid ${bk.color}30`,
                                        transition: 'all 0.15s ease'
                                      }}
                                      title={`Abrir ${bk.name} ao vivo`}
                                    >
                                      {bk.logo} {bk.shortName}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : hasPotential ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                <span className="badge" style={{ fontSize: '0.7rem', fontWeight: 800, padding: '4px 8px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--status-yellow)' }}>
                                  🔥 POTENCIAL
                                </span>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                                  {getEnabledBookmakers().slice(0, 3).map(bk => (
                                    <a
                                      key={bk.id}
                                      href={bk.liveUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        fontSize: '0.55rem', fontWeight: 700,
                                        color: bk.color, background: bk.bgColor,
                                        padding: '1px 5px', borderRadius: 3,
                                        textDecoration: 'none', opacity: 0.8
                                      }}
                                      title={`Preparar no ${bk.name}`}
                                    >
                                      {bk.logo} {bk.shortName}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="badge" style={{ fontSize: '0.7rem', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', padding: '4px 8px', fontWeight: 600 }}>
                                🔍 MONITORANDO
                              </span>
                            )}
                          </td>
                        </tr>
                        
                        {/* 🔍 Painel Expandido de Telemetria Detalhada */}
                        {expandedFixtureId === f.id && (
                          <tr style={{ background: 'rgba(0, 0, 0, 0.15)' }} onClick={(e) => e.stopPropagation()}>
                            <td colSpan={11} style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
                              <style>{`
                                @keyframes slideDown {
                                  from { opacity: 0; transform: translateY(-8px); }
                                  to { opacity: 1; transform: translateY(0); }
                                }
                              `}</style>
                              {!stats ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  Mapeando dados em tempo real...
                                </div>
                              ) : (() => {
                                // 🛡️ Sanitização completa e segura de dados para evitar NaN ou falhas de render
                                const homeAttacks = Number(stats.home.attacks) || 0;
                                const awayAttacks = Number(stats.away.attacks) || 0;
                                const totalAtt = homeAttacks + awayAttacks;
                                const homeAttPct = totalAtt > 0 ? (homeAttacks / totalAtt) * 100 : 50;
                                const awayAttPct = totalAtt > 0 ? (awayAttacks / totalAtt) * 100 : 50;

                                const homeDA = Number(stats.home.dangerousAttacks) || 0;
                                const awayDA = Number(stats.away.dangerousAttacks) || 0;
                                const totalDA = homeDA + awayDA;
                                const homeDAPct = totalDA > 0 ? (homeDA / totalDA) * 100 : 50;
                                const awayDAPct = totalDA > 0 ? (awayDA / totalDA) * 100 : 50;

                                // 📊 Consolidar e calcular o APM Dinâmico a partir dos snapshots da bridge e do gravador local
                                const unifiedSnapshots = [
                                  ...(stats.snapshots || []),
                                  ...(platformSnapshots[f.id] || [])
                                ].reduce((acc: TelemetrySnapshot[], curr: any) => {
                                  if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
                                    acc.push(curr);
                                  }
                                  return acc;
                                }, [] as TelemetrySnapshot[]).sort((a: TelemetrySnapshot, b: TelemetrySnapshot) => a.elapsed - b.elapsed);

                                const apmData = calculateDynamicAPM(
                                  unifiedSnapshots,
                                  getDisplayElapsed(f.id, f.elapsed || 0, f.status || ''),
                                  homeDA,
                                  awayDA
                                );

                                const homePoss = Number(stats.home.possession) || 50;
                                const awayPoss = Number(stats.away.possession) || 50;
                                const totalPoss = homePoss + awayPoss;
                                const homePossPct = totalPoss > 0 ? (homePoss / totalPoss) * 100 : 50;
                                const awayPossPct = totalPoss > 0 ? (awayPoss / totalPoss) * 100 : 50;

                                const homeShotsOn = Number(stats.home.shotsOnGoal) || 0;
                                const awayShotsOn = Number(stats.away.shotsOnGoal) || 0;
                                const homeShotsOff = Number(stats.home.shotsOffGoal) || 0;
                                const awayShotsOff = Number(stats.away.shotsOffGoal) || 0;
                                const homeTotalShots = Number(stats.home.totalShots) || (homeShotsOn + homeShotsOff);
                                const awayTotalShots = Number(stats.away.totalShots) || (awayShotsOn + awayShotsOff);
                                const homeShotsBlocked = Number(stats.home.blockedShots) || 0;
                                const awayShotsBlocked = Number(stats.away.blockedShots) || 0;
                                const homeShotsInside = Number(stats.home.shotsInsideBox) || 0;
                                const awayShotsInside = Number(stats.away.shotsInsideBox) || 0;
                                const homeCorners = Number(stats.home.corners) || 0;
                                const awayCorners = Number(stats.away.corners) || 0;

                                const homeFouls = Number(stats.home.fouls) || 0;
                                const awayFouls = Number(stats.away.fouls) || 0;
                                const homeOffsides = Number(stats.home.offsides) || 0;
                                const awayOffsides = Number(stats.away.offsides) || 0;
                                const homeSaves = Number(stats.home.goalkeeperSaves) || 0;
                                const awaySaves = Number(stats.away.goalkeeperSaves) || 0;

                                const homeYellow = Number(stats.home.yellowCards) || 0;
                                const awayYellow = Number(stats.away.yellowCards) || 0;
                                const homeRed = Number(stats.home.redCards) || 0;
                                const awayRed = Number(stats.away.redCards) || 0;

                                // 🔥 Métricas Normalizadas & Score Final
                                const homeScore = getScoreFinalForSide(f.id, true);
                                const awayScore = getScoreFinalForSide(f.id, false);

                                const homePLS = getPLSForSide(f.id, true);
                                const awayPLS = getPLSForSide(f.id, false);

                                const homePLSTier = homePLS !== null ? getPLSTier(homePLS) : null;
                                const awayPLSTier = awayPLS !== null ? getPLSTier(awayPLS) : null;

                                const homeQualPct = getQualityPctForSide(f.id, true);
                                const awayQualPct = getQualityPctForSide(f.id, false);

                                // CASA - Normalização
                                const homeAp10 = getAttacksInWindow(f.id, 10, true);
                                const homeAp5 = getAttacksInWindow(f.id, 5, true);
                                const homeAp3 = getAttacksInWindow(f.id, 3, true);
                                const hAtm10 = homeAp10/10, hAtm5 = homeAp5/5, hAtm3 = homeAp3/3;
                                const homePressao = (0.20*hAtm10) + (0.30*hAtm5) + (0.50*hAtm3);
                                const homeAccel = hAtm10 > 0 ? hAtm3/hAtm10 : 1.0;
                                const homeMomentum = Math.max(0.8, Math.min(1.8, Math.sqrt(homeAccel)));
                                const homeNiap = Math.min(10, homePressao * 10 * homeMomentum);
                                const homeNcg = Math.min(10, (homeShotsOn / 8) * 10);
                                const homeNesc = Math.min(10, homeCorners);
                                const homeNft = Math.min(10, (((stats.home.totalShots || 0) / 15) * 10));
                                const homeNcv = homeRed === 0 ? 10 : 0;
                                const homeNpos = (Number(stats.home.possession) || 50) / 10;
                                const homeNca = Math.min(10, homeYellow * 2);

                                // FORA - Normalização
                                const awayAp10 = getAttacksInWindow(f.id, 10, false);
                                const awayAp5 = getAttacksInWindow(f.id, 5, false);
                                const awayAp3 = getAttacksInWindow(f.id, 3, false);
                                const aAtm10 = awayAp10/10, aAtm5 = awayAp5/5, aAtm3 = awayAp3/3;
                                const awayPressao = (0.20*aAtm10) + (0.30*aAtm5) + (0.50*aAtm3);
                                const awayAccel = aAtm10 > 0 ? aAtm3/aAtm10 : 1.0;
                                const awayMomentum = Math.max(0.8, Math.min(1.8, Math.sqrt(awayAccel)));
                                const awayNiap = Math.min(10, awayPressao * 10 * awayMomentum);
                                const awayNcg = Math.min(10, (awayShotsOn / 8) * 10);
                                const awayNesc = Math.min(10, awayCorners);
                                const awayNft = Math.min(10, (((stats.away.totalShots || 0) / 15) * 10));
                                const awayNcv = awayRed === 0 ? 10 : 0;
                                const awayNpos = (Number(stats.away.possession) || 50) / 10;
                                const awayNca = Math.min(10, awayYellow * 2);

                                return (
                                  <div style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                    animation: 'slideDown 0.25s ease-out'
                                  }}>
                                    {/* Header Badge */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {(() => {
                                          const snapsCount = [
                                            ...(stats.snapshots || []),
                                            ...(platformSnapshots[f.id] || [])
                                          ].reduce((acc: TelemetrySnapshot[], curr: any) => {
                                            if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
                                              acc.push(curr);
                                            }
                                            return acc;
                                          }, [] as TelemetrySnapshot[]).length;

                                          let badgeColor = 'var(--text-secondary)';
                                          let dotColor = '#3b82f6';
                                          let shadow = 'none';
                                          let text = '📡 Dados via API de Telemetria';

                                          if (stats.hasBridge) {
                                            if (snapsCount > 0) {
                                              dotColor = '#10b981';
                                              badgeColor = '#10b981';
                                              shadow = '0 0 10px #10b981';
                                              text = `● 🔗 TELEMETRIA ATIVA (${snapsCount} Snapshots - Zero Delay)`;
                                            } else {
                                              dotColor = '#fbbf24';
                                              badgeColor = '#fbbf24';
                                              shadow = '0 0 10px #fbbf24';
                                              text = '● 🔗 AGUARDANDO TELEMETRIA (Abra a aba Bet365 do jogo)';
                                            }
                                          }

                                          return (
                                            <>
                                              <span style={{
                                                display: 'inline-block',
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                backgroundColor: dotColor,
                                                boxShadow: shadow
                                              }}></span>
                                              <span style={{ fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', color: badgeColor }}>
                                                {text}
                                              </span>
                                            </>
                                          );
                                        })()}
                                      </div>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                        Partida ID: #{f.id}
                                      </div>
                                    </div>

                                    {/* Comparison Columns Container */}
                                    {!isMobile && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                                      
                                      {/* 1. ATAQUE & VOLUME DE JOGO */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Activity size={14} /> Volume de Jogo
                                        </h4>
                                        
                                        {/* Attacks Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span>{homeAttacks}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Ataques Totais</span>
                                            <span>{awayAttacks}</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homeAttPct}%`, 
                                              background: 'linear-gradient(90deg, #10b981, #34d399)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayAttPct}%`, 
                                              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>

                                        {/* Dangerous Attacks Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span style={{ color: '#10b981' }}>{homeDA}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Ataques Perigosos</span>
                                            <span style={{ color: '#f59e0b' }}>{awayDA}</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homeDAPct}%`, 
                                              background: 'linear-gradient(90deg, #10b981, #059669)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayDAPct}%`, 
                                              background: 'linear-gradient(90deg, #fbbf24, #d97706)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>

                                        {/* Possession Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span>{homePoss}%</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Posse de Bola</span>
                                            <span>{awayPoss}%</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homePossPct}%`, 
                                              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayPossPct}%`, 
                                              background: 'linear-gradient(90deg, #f43f5e, #fb7185)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* 2. RAIO-X DE FINALIZAÇÕES */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {(() => {
                                          const totalShotsMax = Math.max(homeTotalShots, awayTotalShots, 1);
                                          return (
                                            <div style={{ 
                                              display: 'flex', 
                                              flexDirection: 'column', 
                                              alignItems: 'center', 
                                              width: '100%', 
                                              background: 'rgba(255, 255, 255, 0.02)',
                                              padding: '12px 14px', 
                                              borderRadius: '8px', 
                                              border: '1px solid var(--border-color)',
                                              fontFamily: 'Inter, sans-serif'
                                            }}>
                                              {/* Label Centrado */}
                                              <div style={{ 
                                                fontSize: '0.7rem', 
                                                fontWeight: 800,
                                                textTransform: 'uppercase', 
                                                color: 'var(--text-secondary)', 
                                                marginBottom: '10px',
                                                textAlign: 'center',
                                                letterSpacing: '0.05em'
                                              }}>
                                                Finalizações / Chutes ao Gol
                                              </div>
                                              
                                              {/* Painel Central com Números e Barras */}
                                              <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between', 
                                                width: '100%',
                                                gap: '12px'
                                              }}>
                                                {/* Casa (Home) */}
                                                <div style={{ 
                                                  fontSize: '1.2rem', 
                                                  fontWeight: 700, 
                                                  color: 'var(--text-primary)',
                                                  minWidth: '50px',
                                                  textAlign: 'right'
                                                }}>
                                                  {homeTotalShots}
                                                  <span style={{ color: 'var(--text-secondary)', opacity: 0.5, fontWeight: 400, margin: '0 2px' }}>/</span>
                                                  {homeShotsOn}
                                                </div>

                                                {/* Duas Barras de Progresso */}
                                                <div style={{ 
                                                  display: 'flex', 
                                                  flexDirection: 'column', 
                                                  gap: '4px', 
                                                  flexGrow: 1, 
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  minWidth: '100px'
                                                }}>
                                                  {/* Barra 1: Finalizações Totais */}
                                                  <div style={{ display: 'flex', width: '100%', height: '4px', alignItems: 'center' }}>
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                                                      <div style={{ 
                                                        width: `${(homeTotalShots / totalShotsMax) * 100}%`, 
                                                        height: '4px', 
                                                        backgroundColor: '#3a75e2', 
                                                        borderTopLeftRadius: '2px', 
                                                        borderBottomLeftRadius: '2px' 
                                                      }} />
                                                    </div>
                                                    <div style={{ width: '2px', height: '4px', backgroundColor: 'transparent' }} />
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-start' }}>
                                                      <div style={{ 
                                                        width: `${(awayTotalShots / totalShotsMax) * 100}%`, 
                                                        height: '4px', 
                                                        backgroundColor: '#00b02f', 
                                                        borderTopRightRadius: '2px', 
                                                        borderBottomRightRadius: '2px' 
                                                      }} />
                                                    </div>
                                                  </div>

                                                  {/* Barra 2: Chutes ao Gol (No Alvo) */}
                                                  <div style={{ display: 'flex', width: '100%', height: '3px', alignItems: 'center' }}>
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                                                      <div style={{ 
                                                        width: `${(homeShotsOn / totalShotsMax) * 100}%`, 
                                                        height: '3px', 
                                                        backgroundColor: '#3a75e2', 
                                                        borderTopLeftRadius: '1.5px', 
                                                        borderBottomLeftRadius: '1.5px',
                                                        opacity: 0.85
                                                      }} />
                                                    </div>
                                                    <div style={{ width: '2px', height: '3px', backgroundColor: 'transparent' }} />
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-start' }}>
                                                      <div style={{ 
                                                        width: `${(awayShotsOn / totalShotsMax) * 100}%`, 
                                                        height: '3px', 
                                                        backgroundColor: '#00b02f', 
                                                        borderTopRightRadius: '1.5px', 
                                                        borderBottomRightRadius: '1.5px',
                                                        opacity: 0.85
                                                      }} />
                                                    </div>
                                                  </div>
                                                </div>

                                                {/* Fora (Away) */}
                                                <div style={{ 
                                                  fontSize: '1.2rem', 
                                                  fontWeight: 700, 
                                                  color: 'var(--text-primary)',
                                                  minWidth: '50px',
                                                  textAlign: 'left'
                                                }}>
                                                  {awayTotalShots}
                                                  <span style={{ color: 'var(--text-secondary)', opacity: 0.5, fontWeight: 400, margin: '0 2px' }}>/</span>
                                                  {awayShotsOn}
                                                </div>
                                              </div>
                                              <div style={{ display: 'none' }}>
                                                {homeShotsBlocked} {awayShotsBlocked} {homeShotsInside} {awayShotsInside}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                        {/* Escanteios (Cantos) Highlight */}
                                        <div style={{ 
                                          background: 'rgba(16, 185, 129, 0.08)', 
                                          padding: '8px 12px', 
                                          borderRadius: '8px', 
                                          border: '1px dashed rgba(16, 185, 129, 0.3)', 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center',
                                          marginTop: '10px'
                                        }}>
                                          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--status-green)' }}>{homeCorners}</span>
                                          <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-primary)' }}>Escanteios (Cantos)</span>
                                          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--status-green)' }}>{awayCorners}</span>
                                        </div>
                                      </div>

                                      {/* 3. DEFESA & DISCIPLINA */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <ShieldAlert size={14} /> Defesa & Disciplina
                                        </h4>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                          {/* Fouls Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800 }}>{homeFouls}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Faltas Cometidas</span>
                                            <span style={{ fontWeight: 800 }}>{awayFouls}</span>
                                          </div>

                                          {/* Offsides Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800 }}>{homeOffsides}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Impedimentos</span>
                                            <span style={{ fontWeight: 800 }}>{awayOffsides}</span>
                                          </div>

                                          {/* Goalkeeper Saves Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800, color: 'var(--status-green)' }}>{homeSaves}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Defesas Goleiro</span>
                                            <span style={{ fontWeight: 800, color: 'var(--status-green)' }}>{awaySaves}</span>
                                          </div>

                                          {/* Cards Display */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                            {/* Home Cards */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#fbbf24', borderRadius: '2px' }}></span>
                                                {homeYellow}
                                              </span>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#ef4444', borderRadius: '2px' }}></span>
                                                {homeRed}
                                              </span>
                                            </div>

                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>Cartões</span>

                                            {/* Away Cards */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                {awayYellow}
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#fbbf24', borderRadius: '2px' }}></span>
                                              </span>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                {awayRed}
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#ef4444', borderRadius: '2px' }}></span>
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                    </div>
                                    )}

                                    {/* 🏆 ANÁLISE PRÉ-LIVE (PLS) & SCORE DE CANTOS */}
                                    {!isMobile && (
                                    <div style={{ 
                                      marginTop: '24px', 
                                      paddingTop: '20px', 
                                      borderTop: '1px solid var(--border-color)',
                                      display: 'grid', 
                                      gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr', 
                                      gap: '24px' 
                                    }}>
                                      {/* Left Card: Pre-Live (PLS) & Qualidade do Confronto */}
                                      <div style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        padding: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '16px'
                                      }}>
                                        <h4 style={{ 
                                          fontSize: '0.85rem', 
                                          fontWeight: 800, 
                                          textTransform: 'uppercase', 
                                          color: 'var(--accent-primary)', 
                                          margin: '0', 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          gap: '6px' 
                                        }}>
                                          <TrendingUp size={16} /> 🏆 Análise Pré-Live (PLS) & Qualidade do Confronto
                                        </h4>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                          {/* Home Pre-Live */}
                                          <div style={{ 
                                            background: 'var(--bg-surface)', 
                                            padding: '12px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--border-color)',
                                            textAlign: 'center',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '6px'
                                          }}>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                              {f.homeTeam.name}
                                            </span>
                                            {homePLS !== null ? (
                                              <>
                                                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: homePLSTier?.color }}>
                                                  {homePLS}
                                                </div>
                                                <span style={{ 
                                                  fontSize: '0.65rem', 
                                                  fontWeight: 800, 
                                                  padding: '2px 8px', 
                                                  borderRadius: '4px', 
                                                  backgroundColor: `${homePLSTier?.color}15`, 
                                                  color: homePLSTier?.color,
                                                  border: `1px solid ${homePLSTier?.color}33`,
                                                  textTransform: 'uppercase'
                                                }}>
                                                  {homePLSTier?.label}
                                                </span>
                                              </>
                                            ) : (
                                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                                                Dossiê Indisponível
                                              </span>
                                            )}
                                          </div>

                                          {/* Away Pre-Live */}
                                          <div style={{ 
                                            background: 'var(--bg-surface)', 
                                            padding: '12px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--border-color)',
                                            textAlign: 'center',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '6px'
                                          }}>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                              {f.awayTeam.name}
                                            </span>
                                            {awayPLS !== null ? (
                                              <>
                                                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: awayPLSTier?.color }}>
                                                  {awayPLS}
                                                </div>
                                                <span style={{ 
                                                  fontSize: '0.65rem', 
                                                  fontWeight: 800, 
                                                  padding: '2px 8px', 
                                                  borderRadius: '4px', 
                                                  backgroundColor: `${awayPLSTier?.color}15`, 
                                                  color: awayPLSTier?.color,
                                                  border: `1px solid ${awayPLSTier?.color}33`,
                                                  textTransform: 'uppercase'
                                                }}>
                                                  {awayPLSTier?.label}
                                                </span>
                                              </>
                                            ) : (
                                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                                                Dossiê Indisponível
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Dynamic Quality Pct Indicator Cards */}
                                        <div style={{ 
                                          background: 'var(--bg-surface)', 
                                          borderRadius: '8px', 
                                          padding: '14px', 
                                          border: '1px solid var(--border-color)',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '12px'
                                        }}>
                                          <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-primary)', textAlign: 'center' }}>
                                            🎯 Taxa de Qualidade de Mercado (%)
                                          </div>
                                          
                                          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                                            {/* Home Quality Circle */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                              <div style={{ 
                                                width: '64px', 
                                                height: '64px', 
                                                borderRadius: '50%', 
                                                border: `4px solid ${homeQualPct >= 80 ? '#ef4444' : homeQualPct >= 70 ? 'var(--status-green)' : homeQualPct >= 50 ? 'var(--status-yellow)' : 'var(--border-color)'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 900,
                                                fontSize: '1rem',
                                                color: 'var(--text-primary)',
                                                background: 'rgba(255, 255, 255, 0.02)',
                                                boxShadow: homeQualPct >= 70 ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none'
                                              }}>
                                                {homeQualPct}%
                                              </div>
                                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)' }}>CASA</span>
                                            </div>

                                            {/* Away Quality Circle */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                              <div style={{ 
                                                width: '64px', 
                                                height: '64px', 
                                                borderRadius: '50%', 
                                                border: `4px solid ${awayQualPct >= 80 ? '#ef4444' : awayQualPct >= 70 ? 'var(--status-green)' : awayQualPct >= 50 ? 'var(--status-yellow)' : 'var(--border-color)'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 900,
                                                fontSize: '1rem',
                                                color: 'var(--text-primary)',
                                                background: 'rgba(255, 255, 255, 0.02)',
                                                boxShadow: awayQualPct >= 70 ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none'
                                              }}>
                                                {awayQualPct}%
                                              </div>
                                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)' }}>FORA</span>
                                            </div>
                                          </div>

                                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.4, textAlign: 'center' }}>
                                            Calculado ponderando <strong>30% do Histórico PLS</strong> com <strong>70% da Telemetria Ao Vivo (Score Final)</strong>. Se o dossiê não estiver disponível, o score em tempo real representa 100% da nota.
                                          </div>
                                        </div>
                                      </div>

                                      {/* Right Card: Comparison Grid with the 7 Normalized Metrics & Score Final */}
                                      <div style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        padding: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                      }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <h4 style={{ 
                                            fontSize: '0.85rem', 
                                            fontWeight: 800, 
                                            textTransform: 'uppercase', 
                                            color: 'var(--accent-primary)', 
                                            margin: '0', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '6px' 
                                          }}>
                                            <Gauge size={16} /> 📊 Detalhamento de Métricas Normalizadas (0-10)
                                          </h4>
                                          <button onClick={() => setShowWeightsModal(true)} style={{
                                            background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                                            borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                                            fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-primary)',
                                            display: 'flex', alignItems: 'center', gap: '4px',
                                            transition: 'all 0.2s ease',
                                          }}
                                          onMouseEnter={e => { (e.target as HTMLElement).style.background = 'var(--accent-primary)'; (e.target as HTMLElement).style.color = '#fff'; }}
                                          onMouseLeave={e => { (e.target as HTMLElement).style.background = 'var(--bg-elevated)'; (e.target as HTMLElement).style.color = 'var(--accent-primary)'; }}
                                          >
                                            <SettingsIcon size={12} /> ⚙️ Ajustar Pesos
                                          </button>
                                        </div>

                                        <div style={{ overflowX: 'auto' }}>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                            <thead>
                                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: 700 }}>Métrica Normalizada</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: 700 }}>Peso</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--status-green)', fontWeight: 800 }}>CASA</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--status-yellow)', fontWeight: 800 }}>FORA</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>IAP Normalizado (NIAP)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.niap}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNiap * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNiap * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Chutes no Gol Normalizados (NCG)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.ncg}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcg * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcg * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Escanteios Normalizados (NESC)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nesc}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNesc * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNesc * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Finalizações Normalizadas (NFT)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nft}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNft * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNft * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Vermelhos Normalizados (NCV)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.ncv}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcv * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcv * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Posse de Bola Normalizada (NPOS)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.npos}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNpos * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNpos * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Amarelos Normalizados (NCA)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nca}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNca * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNca * 10) / 10}</td>
                                              </tr>
                                              {/* Row for SCORE FINAL */}
                                              <tr style={{ background: 'var(--bg-surface)' }}>
                                                <td style={{ padding: '8px 4px', fontWeight: 900, fontSize: '0.8rem', color: 'var(--text-primary)' }}>🏆 SCORE FINAL DO SISTEMA (SFS)</td>
                                                <td style={{ textAlign: 'center', padding: '8px 4px', fontWeight: 800, color: 'var(--accent-primary)' }}>100%</td>
                                                <td style={{ 
                                                  textAlign: 'center', 
                                                  padding: '8px 4px', 
                                                  fontWeight: 900, 
                                                  fontSize: '0.9rem', 
                                                  color: homeScore >= 8.0 ? '#ef4444' : homeScore >= 7.0 ? 'var(--status-green)' : homeScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)'
                                                }}>
                                                  {homeScore}
                                                </td>
                                                <td style={{ 
                                                  textAlign: 'center', 
                                                  padding: '8px 4px', 
                                                  fontWeight: 900, 
                                                  fontSize: '0.9rem', 
                                                  color: awayScore >= 8.0 ? '#ef4444' : awayScore >= 7.0 ? 'var(--status-green)' : awayScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)'
                                                }}>
                                                  {awayScore}
                                                </td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </div>
                                    )}

                                    {/* ⚡ GRÁFICO DE PRESSÃO — Visualização completa */}
                                    {stats.hasBridge && (
                                      <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Zap size={14} color="var(--accent-primary)" /> ⚡ Gráfico de Pressão & APM Dinâmico
                                        </h4>

                                        {/* SVG Pressure Chart */}
                                        {(() => {
                                          const chartW = 680, chartH = 200, padL = 45, padR = 20, padT = 15, padB = 30;
                                          const plotW = chartW - padL - padR;
                                          const plotH = chartH - padT - padB;
                                          const snaps = unifiedSnapshots;
                                          const elapsed = getDisplayElapsed(f.id, f.elapsed || 1, f.status || '') || 1;
                                          const halfElapsed = elapsed > 45 ? elapsed - 45 : elapsed;
                                          const isSecondHalf = elapsed > 45;

                                          // Time gates (based on half elapsed) - aligned with fixed blocks
                                          const gate10 = isSecondHalf ? 55 : 10;
                                          const gate5 = isSecondHalf ? 50 : 5;
                                          const gate3 = isSecondHalf ? 48 : 3;

                                          // Calculate max DA for scale
                                          const maxDA = Math.max(
                                            homeDA, awayDA,
                                            ...snaps.map(s => Math.max(s.homeDA || 0, s.awayDA || 0)),
                                            10
                                          );
                                          const maxTime = Math.max(elapsed, 45);

                                          // Helper: data point to SVG coordinates
                                          const toX = (t: number) => padL + (t / maxTime) * plotW;
                                          const toY = (da: number) => padT + plotH - (da / maxDA) * plotH;

                                          // ─── APM Block calculation for chart ─────────────────
                                          const buildApmBlockBars = (blockSize: number) => {
                                            const blocks: Array<{start: number; end: number; homeApm: number; awayApm: number}> = [];
                                            const numBlocks = Math.floor(elapsed / blockSize);
                                            for (let i = 0; i < numBlocks; i++) {
                                              const bStart = i * blockSize;
                                              const bEnd = (i + 1) * blockSize;
                                              // Find closest snaps to boundaries
                                              let startSnap = snaps[0], endSnap = snaps[0];
                                              let startDiff = Infinity, endDiff = Infinity;
                                              for (const s of snaps) {
                                                const sd = Math.abs(s.elapsed - bStart);
                                                const ed = Math.abs(s.elapsed - bEnd);
                                                if (sd < startDiff) { startDiff = sd; startSnap = s; }
                                                if (ed < endDiff) { endDiff = ed; endSnap = s; }
                                              }
                                              if (startDiff > blockSize * 0.4 || endDiff > blockSize * 0.4) continue;
                                              const hDiff = (endSnap.homeDA || 0) - (startSnap.homeDA || 0);
                                              const aDiff = (endSnap.awayDA || 0) - (startSnap.awayDA || 0);
                                              blocks.push({
                                                start: bStart, end: bEnd,
                                                homeApm: Math.max(0, hDiff / blockSize),
                                                awayApm: Math.max(0, aDiff / blockSize)
                                              });
                                            }
                                            // Current partial block
                                            if (elapsed > numBlocks * blockSize && snaps.length > 0) {
                                              const bStart = numBlocks * blockSize;
                                              let startSnap = snaps[0];
                                              let startDiff = Infinity;
                                              for (const s of snaps) {
                                                const sd = Math.abs(s.elapsed - bStart);
                                                if (sd < startDiff) { startDiff = sd; startSnap = s; }
                                              }
                                              const currentSnap = snaps[snaps.length - 1];
                                              const partialTime = elapsed - bStart;
                                              if (partialTime > 0.5 && startDiff < blockSize * 0.4) {
                                                const hDiff = (currentSnap.homeDA || 0) - (startSnap.homeDA || 0);
                                                const aDiff = (currentSnap.awayDA || 0) - (startSnap.awayDA || 0);
                                                blocks.push({
                                                  start: bStart, end: elapsed,
                                                  homeApm: Math.max(0, hDiff / partialTime),
                                                  awayApm: Math.max(0, aDiff / partialTime)
                                                });
                                              }
                                            }
                                            return blocks;
                                          };

                                          const apmBlockSize = chartViewMode === 'apm10' ? 10 : chartViewMode === 'apm5' ? 5 : chartViewMode === 'apm3' ? 3 : 0;
                                          const apmBlockColor = chartViewMode === 'apm10' ? '#3b82f6' : chartViewMode === 'apm5' ? '#8b5cf6' : '#ef4444';
                                          const apmBlocks = apmBlockSize > 0 ? buildApmBlockBars(apmBlockSize) : [];
                                          const maxApm = apmBlocks.length > 0 ? Math.max(...apmBlocks.flatMap(b => [b.homeApm, b.awayApm]), 0.5) : 1;
                                          const toYapm = (v: number) => padT + plotH - (v / maxApm) * plotH;

                                          // Build path data for home and away DA lines
                                          const buildPath = (side: 'home' | 'away'): string => {
                                            const points: Array<{x: number; y: number}> = [];
                                            // Start at origin
                                            points.push({ x: toX(0), y: toY(0) });
                                            for (const s of snaps) {
                                              const da = side === 'home' ? (s.homeDA || 0) : (s.awayDA || 0);
                                              points.push({ x: toX(s.elapsed), y: toY(da) });
                                            }
                                            // Add current point
                                            const curDA = side === 'home' ? homeDA : awayDA;
                                            points.push({ x: toX(elapsed), y: toY(curDA) });
                                            return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
                                          };

                                          const buildArea = (side: 'home' | 'away'): string => {
                                            const linePath = buildPath(side);
                                            return `${linePath} L${toX(elapsed).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;
                                          };

                                          const homePath = buildPath('home');
                                          const awayPath = buildPath('away');
                                          const homeArea = buildArea('home');
                                          const awayArea = buildArea('away');

                                          // Y-axis ticks
                                          const yTicks = [0, Math.round(maxDA * 0.25), Math.round(maxDA * 0.5), Math.round(maxDA * 0.75), maxDA];

                                          // X-axis ticks (every 5 or 10 min)
                                          const xStep = maxTime > 30 ? 10 : 5;
                                          const xTicks: number[] = [];
                                          for (let t = 0; t <= maxTime; t += xStep) xTicks.push(t);

                                          // Time gate active check (aligned with fixed blocks)
                                          const is10Active = halfElapsed >= 10;
                                          const is5Active = halfElapsed >= 5;
                                          const is3Active = halfElapsed >= 3;

                                          return (
                                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: '16px', alignItems: 'start' }}>
                                              {/* LEFT: SVG Chart */}
                                              <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '16px 12px 12px' }}>
                                                {/* Chart Header */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                                    {chartViewMode === 'da' ? 'Ataques Perigosos — Evolução Temporal' : `APM Blocos Fixos — ${apmBlockSize} min/bloco`}
                                                  </span>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ display: 'flex', gap: '3px', background: 'var(--bg-surface)', borderRadius: '6px', padding: '2px' }}>
                                                      {(['da', 'apm10', 'apm5', 'apm3'] as const).map(mode => {
                                                        const lb: Record<string, string> = { da: 'DA', apm10: 'ATM 10', apm5: 'ATM 5', apm3: 'ATM 3' };
                                                        const cl: Record<string, string> = { da: 'var(--accent-primary)', apm10: '#3b82f6', apm5: '#8b5cf6', apm3: '#ef4444' };
                                                        const ac = chartViewMode === mode;
                                                        return (
                                                          <button key={mode} onClick={() => setChartViewMode(mode)} style={{
                                                            padding: '3px 10px', borderRadius: '4px', border: 'none',
                                                            cursor: 'pointer', fontWeight: 800, fontSize: '0.6rem',
                                                            background: ac ? cl[mode] : 'transparent',
                                                            color: ac ? '#fff' : 'var(--text-muted)',
                                                            transition: 'all 0.2s ease',
                                                            boxShadow: ac ? `0 1px 4px ${cl[mode]}40` : 'none'
                                                          }}>
                                                            {lb[mode]}
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', fontWeight: 700 }}>
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ width: 10, height: 3, background: '#10b981', display: 'inline-block', borderRadius: 2 }}></span>
                                                        {f.homeTeam.name}
                                                      </span>
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ width: 10, height: 3, background: '#f59e0b', display: 'inline-block', borderRadius: 2 }}></span>
                                                        {f.awayTeam.name}
                                                      </span>
                                                    </div>
                                                  </div>
                                                </div>
                                                <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + (chartViewMode !== 'da' ? 18 : 0)}`} style={{ overflow: 'visible' }}>
                                                  <defs>
                                                    <linearGradient id={`homeGrad-${f.id}`} x1="0" y1="0" x2="0" y2="1">
                                                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                                                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                                                    </linearGradient>
                                                    <linearGradient id={`awayGrad-${f.id}`} x1="0" y1="0" x2="0" y2="1">
                                                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                                                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                                                    </linearGradient>
                                                  </defs>
                                                  {chartViewMode === 'da' ? (
                                                    <>
                                                      {yTicks.map(v => (
                                                        <g key={`y-${v}`}>
                                                          <line x1={padL} y1={toY(v)} x2={chartW - padR} y2={toY(v)} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4,4" />
                                                          <text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontWeight="600">{v}</text>
                                                        </g>
                                                      ))}
                                                      {xTicks.map(t => (
                                                        <text key={`x-${t}`} x={toX(t)} y={chartH - 4} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontWeight="600">{t}'</text>
                                                      ))}
                                                      {[
                                                        { t: gate10, label: 'ATM 10', color: '#3b82f6', active: is10Active },
                                                        { t: gate5, label: 'ATM 5', color: '#8b5cf6', active: is5Active },
                                                        { t: gate3, label: 'ATM 3', color: '#ef4444', active: is3Active },
                                                      ].filter(g => g.t <= maxTime).map(gate => (
                                                        <g key={gate.label}>
                                                          <line x1={toX(gate.t)} y1={padT} x2={toX(gate.t)} y2={padT + plotH}
                                                            stroke={gate.active ? gate.color : 'var(--text-muted)'}
                                                            strokeWidth={gate.active ? "1.5" : "1"}
                                                            strokeDasharray={gate.active ? "none" : "3,3"}
                                                            opacity={gate.active ? 0.8 : 0.3} />
                                                          <rect x={toX(gate.t) - 16} y={padT - 12} width="32" height="12" rx="3"
                                                            fill={gate.active ? gate.color : 'var(--bg-surface)'}
                                                            opacity={gate.active ? 0.9 : 0.5} stroke={gate.color} strokeWidth="0.5" />
                                                          <text x={toX(gate.t)} y={padT - 3} textAnchor="middle" fill={gate.active ? '#fff' : 'var(--text-muted)'} fontSize="7" fontWeight="800">{gate.label}</text>
                                                        </g>
                                                      ))}
                                                      <path d={homeArea} fill={`url(#homeGrad-${f.id})`} />
                                                      <path d={awayArea} fill={`url(#awayGrad-${f.id})`} />
                                                      <path d={homePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                      <path d={awayPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                      <circle cx={toX(elapsed)} cy={toY(homeDA)} r="4" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                                                      <circle cx={toX(elapsed)} cy={toY(awayDA)} r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
                                                      <text x={toX(elapsed) + 8} y={toY(homeDA) + 3} fill="#10b981" fontSize="10" fontWeight="800">{homeDA}</text>
                                                      <text x={toX(elapsed) + 8} y={toY(awayDA) + 3} fill="#f59e0b" fontSize="10" fontWeight="800">{awayDA}</text>
                                                      <line x1={toX(elapsed)} y1={padT} x2={toX(elapsed)} y2={padT + plotH} stroke="var(--accent-primary)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
                                                    </>
                                                  ) : (
                                                    <>
                                                      {[0, 0.25, 0.5, 0.75, 1.0].map(frac => {
                                                        const v = Math.round(maxApm * frac * 100) / 100;
                                                        return (
                                                          <g key={`yapm-${frac}`}>
                                                            <line x1={padL} y1={toYapm(v)} x2={chartW - padR} y2={toYapm(v)} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4,4" />
                                                            <text x={padL - 6} y={toYapm(v) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontWeight="600">{v.toFixed(1)}</text>
                                                          </g>
                                                        );
                                                      })}
                                                      <text x={8} y={padT + plotH / 2} textAnchor="middle" fill={apmBlockColor} fontSize="8" fontWeight="700" transform={`rotate(-90, 8, ${padT + plotH / 2})`} opacity="0.7">AP/min</text>
                                                      {apmBlocks.map((block, bi) => {
                                                        const bx1 = toX(block.start);
                                                        const bx2 = toX(block.end);
                                                        const bW = bx2 - bx1;
                                                        const barW = Math.max((bW - 6) / 2, 3);
                                                        const isPartial = block.end === elapsed && block.end % apmBlockSize !== 0;
                                                        return (
                                                          <g key={`ab-${bi}`}>
                                                            <rect x={bx1} y={padT} width={bW} height={plotH} fill={apmBlockColor} opacity={isPartial ? 0.02 : 0.04} rx="2" />
                                                            <rect x={bx1 + 2} y={toYapm(block.homeApm)} width={barW} height={Math.max(padT + plotH - toYapm(block.homeApm), 1)} fill="#10b981" opacity={isPartial ? 0.35 : 0.75} rx="2" />
                                                            <rect x={bx1 + barW + 4} y={toYapm(block.awayApm)} width={barW} height={Math.max(padT + plotH - toYapm(block.awayApm), 1)} fill="#f59e0b" opacity={isPartial ? 0.35 : 0.75} rx="2" />
                                                            {bW > 30 && (
                                                              <>
                                                                <text x={bx1 + 2 + barW/2} y={toYapm(block.homeApm) - 4} textAnchor="middle" fill="#10b981" fontSize="8" fontWeight="800">{block.homeApm.toFixed(2)}</text>
                                                                <text x={bx1 + barW + 4 + barW/2} y={toYapm(block.awayApm) - 4} textAnchor="middle" fill="#f59e0b" fontSize="8" fontWeight="800">{block.awayApm.toFixed(2)}</text>
                                                              </>
                                                            )}
                                                            <text x={bx1 + bW/2} y={padT + plotH + 12} textAnchor="middle" fill={isPartial ? 'var(--text-muted)' : apmBlockColor} fontSize="7.5" fontWeight="700" opacity={isPartial ? 0.5 : 0.85}>{Math.round(block.start)}'-{Math.round(block.end)}'</text>
                                                            {isPartial && <text x={bx1 + bW/2} y={padT + plotH + 21} textAnchor="middle" fill="var(--text-muted)" fontSize="6" fontWeight="600" opacity="0.5">parcial</text>}
                                                          </g>
                                                        );
                                                      })}
                                                      {apmData.home.apmGlobal > 0 && (
                                                        <>
                                                          <line x1={padL} y1={toYapm(apmData.home.apmGlobal)} x2={chartW - padR} y2={toYapm(apmData.home.apmGlobal)} stroke="#10b981" strokeWidth="1" strokeDasharray="6,3" opacity="0.4" />
                                                          <text x={chartW - padR + 2} y={toYapm(apmData.home.apmGlobal) - 2} fill="#10b981" fontSize="7" fontWeight="700" opacity="0.6">Global {apmData.home.apmGlobal}</text>
                                                        </>
                                                      )}
                                                      {apmData.away.apmGlobal > 0 && (
                                                        <>
                                                          <line x1={padL} y1={toYapm(apmData.away.apmGlobal)} x2={chartW - padR} y2={toYapm(apmData.away.apmGlobal)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="6,3" opacity="0.4" />
                                                          <text x={chartW - padR + 2} y={toYapm(apmData.away.apmGlobal) + 8} fill="#f59e0b" fontSize="7" fontWeight="700" opacity="0.6">Global {apmData.away.apmGlobal}</text>
                                                        </>
                                                      )}
                                                      <line x1={toX(elapsed)} y1={padT} x2={toX(elapsed)} y2={padT + plotH} stroke="var(--accent-primary)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
                                                    </>
                                                  )}
                                                  <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--border-color)" strokeWidth="1" />
                                                  <line x1={padL} y1={padT + plotH} x2={chartW - padR} y2={padT + plotH} stroke="var(--border-color)" strokeWidth="1" />
                                                </svg>
                                              </div>

                                              {/* RIGHT: APM Cards + IPR */}
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {/* APM Window Cards */}
                                                {/* Data Age indicator */}
                                                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'right', marginBottom: '2px', fontWeight: 600 }}>
                                                  📡 Dados: {apmData.home.dataAge > 0 ? `${apmData.home.dataAge} min coletados` : 'Sem snapshots'}
                                                </div>
                                                {[
                                                  { label: 'Global', home: apmData.home.apmGlobal, away: apmData.away.apmGlobal, active: true, reliable: true, color: '#6b7280', icon: '📊' },
                                                  { label: 'ATM 10', home: apmData.home.apm10, away: apmData.away.apm10, active: is10Active, reliable: apmData.home.reliable10, color: '#3b82f6', icon: '🔵', gate: `${gate10}'`, need: 6 },
                                                  { label: 'ATM 5', home: apmData.home.apm5, away: apmData.away.apm5, active: is5Active, reliable: apmData.home.reliable5, color: '#8b5cf6', icon: '🟣', gate: `${gate5}'`, need: 3 },
                                                  { label: 'ATM 3', home: apmData.home.apm3, away: apmData.away.apm3, active: is3Active, reliable: apmData.home.reliable3, color: '#ef4444', icon: '🔴', gate: `${gate3}'`, need: 2 },
                                                ].map(w => (
                                                  <div key={w.label} style={{
                                                    background: w.active ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                                                    border: `1px solid ${w.active ? w.color + '40' : 'var(--border-color)'}`,
                                                    borderRadius: '8px',
                                                    padding: '8px 12px',
                                                    opacity: w.active ? 1 : 0.5,
                                                    transition: 'all 0.3s ease',
                                                    position: 'relative' as const,
                                                    overflow: 'hidden' as const,
                                                  }}>
                                                    {/* Active indicator bar */}
                                                    {w.active && <div style={{ position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: '3px', background: w.reliable ? w.color : '#fbbf24', borderRadius: '0 2px 2px 0' }}></div>}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: w.active ? w.color : 'var(--text-muted)', textTransform: 'uppercase' }}>
                                                        {w.icon} {w.label}
                                                      </span>
                                                      {w.gate && (
                                                        <span style={{
                                                          fontSize: '0.55rem', fontWeight: 700,
                                                          padding: '1px 5px', borderRadius: '3px',
                                                          background: !w.active ? 'var(--bg-elevated)' : w.reliable ? `${w.color}20` : 'rgba(251, 191, 36, 0.15)',
                                                          color: !w.active ? 'var(--text-muted)' : w.reliable ? w.color : '#fbbf24',
                                                        }}>
                                                          {!w.active ? `Ativa ${w.gate}` : w.reliable ? '✓ ATIVO' : `⚠ COLETANDO (${w.need}min)`}
                                                        </span>
                                                      )}
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                      <span style={{ fontSize: '0.95rem', fontWeight: 900, color: w.active && w.reliable && w.home >= 1.0 ? '#ef4444' : w.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                        {w.home}
                                                      </span>
                                                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                                        {w.active && !w.reliable && w.gate ? '≈ Global' : 'AP/min'}
                                                      </span>
                                                      <span style={{ fontSize: '0.95rem', fontWeight: 900, color: w.active && w.reliable && w.away >= 1.0 ? '#ef4444' : w.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                        {w.away}
                                                      </span>
                                                    </div>
                                                  </div>
                                                ))}

                                                {/* Aceleração */}
                                                <div style={{
                                                  background: 'var(--bg-elevated)', borderRadius: '8px',
                                                  border: '1px solid var(--border-color)', padding: '8px 12px',
                                                }}>
                                                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                    ⚡ Aceleração
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{
                                                      fontSize: '0.95rem', fontWeight: 900,
                                                      color: apmData.home.accelerationFactor >= 1.2 ? '#ef4444' : apmData.home.accelerationFactor >= 1.0 ? '#f59e0b' : 'var(--text-primary)',
                                                    }}>
                                                      {apmData.home.accelerationFactor}x
                                                    </span>
                                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fator</span>
                                                    <span style={{
                                                      fontSize: '0.95rem', fontWeight: 900,
                                                      color: apmData.away.accelerationFactor >= 1.2 ? '#ef4444' : apmData.away.accelerationFactor >= 1.0 ? '#f59e0b' : 'var(--text-primary)',
                                                    }}>
                                                      {apmData.away.accelerationFactor}x
                                                    </span>
                                                  </div>
                                                </div>

                                                {/* IPR Bars */}
                                                <div style={{
                                                  background: 'var(--bg-elevated)', borderRadius: '8px',
                                                  border: '1px solid var(--border-color)', padding: '8px 12px',
                                                }}>
                                                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                                    🔥 IPR — Índice de Pressão Recente
                                                  </div>
                                                  {[
                                                    { name: f.homeTeam.name, ipr: apmData.home.ipr, color: '#10b981' },
                                                    { name: f.awayTeam.name, ipr: apmData.away.ipr, color: '#f59e0b' },
                                                  ].map(team => {
                                                    const pct = Math.min(100, (team.ipr / 2.5) * 100);
                                                    const barColor = team.ipr >= 1.5 ? '#ef4444' : team.ipr >= 1.0 ? '#f59e0b' : team.color;
                                                    return (
                                                      <div key={team.name} style={{ marginBottom: '4px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 700, marginBottom: '2px' }}>
                                                          <span style={{ color: team.color }}>{team.name}</span>
                                                          <span style={{ fontWeight: 900, color: barColor }}>{team.ipr}</span>
                                                        </div>
                                                        <div style={{ height: '6px', background: 'var(--bg-surface)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                          <div style={{
                                                            width: `${pct}%`, height: '100%', borderRadius: '3px',
                                                            background: `linear-gradient(90deg, ${team.color}, ${barColor})`,
                                                            transition: 'width 0.5s ease',
                                                          }}></div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                  <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.3 }}>
                                                    IPR = (ATM3×50% + ATM5×30% + ATM10×20%) × Aceleração. Acima de <strong>1.0</strong> = pressão forte.
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}

                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {/* ═══ SEÇÃO 2: Partidas do Scanner Bet365 ═══ */}
                  {fixtureSourceFilter !== 'api' && scannerFixtures.length > 0 && (
                    <tr>
                      <td colSpan={11} style={{
                        padding: '14px 8px 6px',
                        borderBottom: '2px solid var(--border-color)',
                        background: 'var(--bg-surface)',
                        borderTop: '3px solid var(--border-color)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.85rem' }}>🎰</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Partidas Scanner — Bet365</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, background: 'var(--accent-glow)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: 4 }}>
                              {scannerFixtures.length}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Abra os jogos na Bet365 para ativar telemetria
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {fixtureSourceFilter !== 'api' && scannerFixtures
                    .filter(f => fixtureSourceFilter !== 'favorites' || favoriteFixtureIds.has(f.id))
                    .filter(f => passesSmartFilter(f))
                    .map(f => {
                    const stats = allStats[f.id];
                    const dossier = allDossiers[f.id];
                    const hasOpp = opportunities.some(opp => opp.fixtureId === f.id);
                    const triggerThreshold = cornerTriggerThreshold;
                    const potentialThreshold = triggerThreshold - 1.0;
                    const homeScore = stats ? getScoreFinalForSide(f.id, true) : 0;
                    const awayScore = stats ? getScoreFinalForSide(f.id, false) : 0;
                    const homeQual = stats ? getQualityPctForSide(f.id, true) : 0;
                    const awayQual = stats ? getQualityPctForSide(f.id, false) : 0;
                    const isValidTime = f.elapsed <= 90 && f.status !== 'HT';
                    const hasPotential = !hasOpp && isValidTime && stats && (
                      homeScore >= potentialThreshold || awayScore >= potentialThreshold
                    );
                    
                    return (
                      <Fragment key={`group-scanner-${f.id}`}>
                        <tr 
                          key={`table-scanner-${f.id}`}
                          onClick={() => setExpandedFixtureId(expandedFixtureId === f.id ? null : f.id)}
                          style={{ 
                            borderBottom: '1px solid var(--border-color)', 
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                            background: hasOpp 
                              ? 'rgba(16, 185, 129, 0.06)' 
                              : hasPotential 
                                ? 'rgba(251, 191, 36, 0.04)'
                                : 'transparent',
                            borderLeft: hasOpp ? '3px solid var(--status-green)' : hasPotential ? '3px solid #fbbf24' : '3px solid var(--border-color)'
                          }}
                        >
                          {/* Partida / Liga */}
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {expandedFixtureId === f.id ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                              <button
                                onClick={(e) => toggleFavorite(f.id, e)}
                                title={favoriteFixtureIds.has(f.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                                  fontSize: '0.9rem', lineHeight: 1, transition: 'transform 0.2s ease',
                                  transform: favoriteFixtureIds.has(f.id) ? 'scale(1.2)' : 'scale(1)',
                                  filter: favoriteFixtureIds.has(f.id) ? 'none' : 'grayscale(1) opacity(0.4)',
                                }}
                              >
                                ⭐
                              </button>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                  {f.homeTeam?.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs</span> {f.awayTeam?.name}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: 2, textTransform: 'uppercase' }}>
                                  {(f as any).leagueName || 'Scanner'}
                                </div>
                              </div>
                            </div>
                          </td>
                          {/* Placar / Tempo */}
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{getDisplayScore(f.id, f.goalsHome ?? 0, f.goalsAway ?? 0).home} - {getDisplayScore(f.id, f.goalsHome ?? 0, f.goalsAway ?? 0).away}</div>
                            <div style={{ fontSize: '0.7rem', color: f.status === 'HT' ? '#f59e0b' : 'var(--status-green)', fontWeight: 600, marginTop: 2 }}>
                              ● {getDisplayElapsed(f.id, f.elapsed, f.status)}' Min
                            </div>
                          </td>
                          {/* IIM */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {!stats ? (
                              <span style={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>⚠ SEM TELEMETRIA</span>
                            ) : (!stats.hasTelemetry && !stats.hasBridge) ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                            ) : (
                              <div style={{ fontWeight: 700 }}>
                                <span style={{ color: stats.home.iim >= 1.0 ? 'var(--status-green)' : 'var(--text-primary)' }}>{stats.home.iim}</span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                <span style={{ color: stats.away.iim >= 1.0 ? 'var(--status-green)' : 'var(--text-primary)' }}>{stats.away.iim}</span>
                                {!stats.hasTelemetry && stats.hasBridge && (
                                  <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 800, marginTop: 2 }}>🔗 BRIDGE</div>
                                )}
                              </div>
                            )}
                          </td>
                          {/* APM */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {!stats ? '—' : (!stats.hasTelemetry && !stats.hasBridge) ? '—' : (
                              <div style={{ fontWeight: 700 }}>
                                <span>{stats.home.apm}</span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                                <span>{stats.away.apm}</span>
                              </div>
                            )}
                          </td>
                          {/* Escanteios */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {stats ? `${stats.home.corners ?? 0}-${stats.away.corners ?? 0}` : '—'}
                          </td>
                          {/* Chutes no Alvo */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {stats ? `${stats.home.shotsOnGoal ?? 0}-${stats.away.shotsOnGoal ?? 0}` : '—'}
                          </td>
                          {/* Posse */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {stats ? `${stats.home.possession ?? 0}%-${stats.away.possession ?? 0}%` : '—'}
                          </td>
                          {/* Motivação IA */}
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem' }}>
                            {dossier ? `${dossier.motivationHome ?? 0}% / ${dossier.motivationAway ?? 0}%` : '0% / 0%'}
                          </td>
                          {/* Score Final */}
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.85rem', color: homeScore >= triggerThreshold || awayScore >= triggerThreshold ? 'var(--status-green)' : 'var(--text-primary)' }}>
                              {homeScore.toFixed(2)} | {awayScore.toFixed(2)}
                            </span>
                          </td>
                          {/* Qualidade */}
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                              {homeQual}% | {awayQual}%
                            </span>
                          </td>
                          {/* Status + Botão Abrir Link */}
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            {stats && (stats.hasTelemetry || stats.hasBridge) ? (
                              <span style={{ 
                                fontSize: '0.68rem', padding: '4px 10px', borderRadius: 6, 
                                background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', fontWeight: 800,
                                display: 'inline-flex', alignItems: 'center', gap: 4
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                CONECTADO
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const searchText = `${f.homeTeam.name} vs ${f.awayTeam.name}`;
                                  navigator.clipboard.writeText(searchText).then(() => {
                                    const btn = e.currentTarget;
                                    btn.textContent = '✅ Copiado!';
                                    setTimeout(() => { btn.textContent = '📋 Buscar na Bet'; }, 2000);
                                  });
                                }}
                                style={{ 
                                  fontSize: '0.65rem', padding: '4px 8px', borderRadius: 6, 
                                  background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', fontWeight: 800,
                                  border: '1px solid rgba(59, 130, 246, 0.2)', cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                                title={`Copiar "${f.homeTeam.name} vs ${f.awayTeam.name}" — abra na Bet365 para ativar telemetria`}
                              >
                                📋 Buscar na Bet
                              </button>
                            )}
                          </td>
                        </tr>
                        {/* 🔍 Painel Expandido de Telemetria Detalhada */}
                        {expandedFixtureId === f.id && (
                          <tr style={{ background: 'rgba(0, 0, 0, 0.15)' }} onClick={(e) => e.stopPropagation()}>
                            <td colSpan={11} style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
                              <style>{`
                                @keyframes slideDown {
                                  from { opacity: 0; transform: translateY(-8px); }
                                  to { opacity: 1; transform: translateY(0); }
                                }
                              `}</style>
                              {!stats ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  Mapeando dados em tempo real...
                                </div>
                              ) : (() => {
                                // 🛡️ Sanitização completa e segura de dados para evitar NaN ou falhas de render
                                const homeAttacks = Number(stats.home.attacks) || 0;
                                const awayAttacks = Number(stats.away.attacks) || 0;
                                const totalAtt = homeAttacks + awayAttacks;
                                const homeAttPct = totalAtt > 0 ? (homeAttacks / totalAtt) * 100 : 50;
                                const awayAttPct = totalAtt > 0 ? (awayAttacks / totalAtt) * 100 : 50;

                                const homeDA = Number(stats.home.dangerousAttacks) || 0;
                                const awayDA = Number(stats.away.dangerousAttacks) || 0;
                                const totalDA = homeDA + awayDA;
                                const homeDAPct = totalDA > 0 ? (homeDA / totalDA) * 100 : 50;
                                const awayDAPct = totalDA > 0 ? (awayDA / totalDA) * 100 : 50;

                                // 📊 Consolidar e calcular o APM Dinâmico a partir dos snapshots da bridge e do gravador local
                                const unifiedSnapshots = [
                                  ...(stats.snapshots || []),
                                  ...(platformSnapshots[f.id] || [])
                                ].reduce((acc: TelemetrySnapshot[], curr: any) => {
                                  if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
                                    acc.push(curr);
                                  }
                                  return acc;
                                }, [] as TelemetrySnapshot[]).sort((a: TelemetrySnapshot, b: TelemetrySnapshot) => a.elapsed - b.elapsed);

                                const apmData = calculateDynamicAPM(
                                  unifiedSnapshots,
                                  getDisplayElapsed(f.id, f.elapsed || 0, f.status || ''),
                                  homeDA,
                                  awayDA
                                );

                                const homePoss = Number(stats.home.possession) || 50;
                                const awayPoss = Number(stats.away.possession) || 50;
                                const totalPoss = homePoss + awayPoss;
                                const homePossPct = totalPoss > 0 ? (homePoss / totalPoss) * 100 : 50;
                                const awayPossPct = totalPoss > 0 ? (awayPoss / totalPoss) * 100 : 50;

                                const homeShotsOn = Number(stats.home.shotsOnGoal) || 0;
                                const awayShotsOn = Number(stats.away.shotsOnGoal) || 0;
                                const homeShotsOff = Number(stats.home.shotsOffGoal) || 0;
                                const awayShotsOff = Number(stats.away.shotsOffGoal) || 0;
                                const homeTotalShots = Number(stats.home.totalShots) || (homeShotsOn + homeShotsOff);
                                const awayTotalShots = Number(stats.away.totalShots) || (awayShotsOn + awayShotsOff);
                                const homeShotsBlocked = Number(stats.home.blockedShots) || 0;
                                const awayShotsBlocked = Number(stats.away.blockedShots) || 0;
                                const homeShotsInside = Number(stats.home.shotsInsideBox) || 0;
                                const awayShotsInside = Number(stats.away.shotsInsideBox) || 0;
                                const homeCorners = Number(stats.home.corners) || 0;
                                const awayCorners = Number(stats.away.corners) || 0;

                                const homeFouls = Number(stats.home.fouls) || 0;
                                const awayFouls = Number(stats.away.fouls) || 0;
                                const homeOffsides = Number(stats.home.offsides) || 0;
                                const awayOffsides = Number(stats.away.offsides) || 0;
                                const homeSaves = Number(stats.home.goalkeeperSaves) || 0;
                                const awaySaves = Number(stats.away.goalkeeperSaves) || 0;

                                const homeYellow = Number(stats.home.yellowCards) || 0;
                                const awayYellow = Number(stats.away.yellowCards) || 0;
                                const homeRed = Number(stats.home.redCards) || 0;
                                const awayRed = Number(stats.away.redCards) || 0;

                                // 🔥 Métricas Normalizadas & Score Final
                                const homeScore = getScoreFinalForSide(f.id, true);
                                const awayScore = getScoreFinalForSide(f.id, false);

                                const homePLS = getPLSForSide(f.id, true);
                                const awayPLS = getPLSForSide(f.id, false);

                                const homePLSTier = homePLS !== null ? getPLSTier(homePLS) : null;
                                const awayPLSTier = awayPLS !== null ? getPLSTier(awayPLS) : null;

                                const homeQualPct = getQualityPctForSide(f.id, true);
                                const awayQualPct = getQualityPctForSide(f.id, false);

                                // CASA - Normalização
                                const homeAp10 = getAttacksInWindow(f.id, 10, true);
                                const homeAp5 = getAttacksInWindow(f.id, 5, true);
                                const homeAp3 = getAttacksInWindow(f.id, 3, true);
                                const hAtm10 = homeAp10/10, hAtm5 = homeAp5/5, hAtm3 = homeAp3/3;
                                const homePressao = (0.20*hAtm10) + (0.30*hAtm5) + (0.50*hAtm3);
                                const homeAccel = hAtm10 > 0 ? hAtm3/hAtm10 : 1.0;
                                const homeMomentum = Math.max(0.8, Math.min(1.8, Math.sqrt(homeAccel)));
                                const homeNiap = Math.min(10, homePressao * 10 * homeMomentum);
                                const homeNcg = Math.min(10, (homeShotsOn / 8) * 10);
                                const homeNesc = Math.min(10, homeCorners);
                                const homeNft = Math.min(10, (((stats.home.totalShots || 0) / 15) * 10));
                                const homeNcv = homeRed === 0 ? 10 : 0;
                                const homeNpos = (Number(stats.home.possession) || 50) / 10;
                                const homeNca = Math.min(10, homeYellow * 2);

                                // FORA - Normalização
                                const awayAp10 = getAttacksInWindow(f.id, 10, false);
                                const awayAp5 = getAttacksInWindow(f.id, 5, false);
                                const awayAp3 = getAttacksInWindow(f.id, 3, false);
                                const aAtm10 = awayAp10/10, aAtm5 = awayAp5/5, aAtm3 = awayAp3/3;
                                const awayPressao = (0.20*aAtm10) + (0.30*aAtm5) + (0.50*aAtm3);
                                const awayAccel = aAtm10 > 0 ? aAtm3/aAtm10 : 1.0;
                                const awayMomentum = Math.max(0.8, Math.min(1.8, Math.sqrt(awayAccel)));
                                const awayNiap = Math.min(10, awayPressao * 10 * awayMomentum);
                                const awayNcg = Math.min(10, (awayShotsOn / 8) * 10);
                                const awayNesc = Math.min(10, awayCorners);
                                const awayNft = Math.min(10, (((stats.away.totalShots || 0) / 15) * 10));
                                const awayNcv = awayRed === 0 ? 10 : 0;
                                const awayNpos = (Number(stats.away.possession) || 50) / 10;
                                const awayNca = Math.min(10, awayYellow * 2);

                                return (
                                  <div style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                    animation: 'slideDown 0.25s ease-out'
                                  }}>
                                    {/* Header Badge */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {(() => {
                                          const snapsCount = [
                                            ...(stats.snapshots || []),
                                            ...(platformSnapshots[f.id] || [])
                                          ].reduce((acc: TelemetrySnapshot[], curr: any) => {
                                            if (!acc.some((s: TelemetrySnapshot) => s.elapsed === curr.elapsed)) {
                                              acc.push(curr);
                                            }
                                            return acc;
                                          }, [] as TelemetrySnapshot[]).length;

                                          let badgeColor = 'var(--text-secondary)';
                                          let dotColor = '#3b82f6';
                                          let shadow = 'none';
                                          let text = '📡 Dados via API de Telemetria';

                                          if (stats.hasBridge) {
                                            if (snapsCount > 0) {
                                              dotColor = '#10b981';
                                              badgeColor = '#10b981';
                                              shadow = '0 0 10px #10b981';
                                              text = `● 🔗 TELEMETRIA ATIVA (${snapsCount} Snapshots - Zero Delay)`;
                                            } else {
                                              dotColor = '#fbbf24';
                                              badgeColor = '#fbbf24';
                                              shadow = '0 0 10px #fbbf24';
                                              text = '● 🔗 AGUARDANDO TELEMETRIA (Abra a aba Bet365 do jogo)';
                                            }
                                          }

                                          return (
                                            <>
                                              <span style={{
                                                display: 'inline-block',
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                backgroundColor: dotColor,
                                                boxShadow: shadow
                                              }}></span>
                                              <span style={{ fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', color: badgeColor }}>
                                                {text}
                                              </span>
                                            </>
                                          );
                                        })()}
                                      </div>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                        Partida ID: #{f.id}
                                      </div>
                                    </div>

                                    {/* Comparison Columns Container */}
                                    {!isMobile && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                                      
                                      {/* 1. ATAQUE & VOLUME DE JOGO */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Activity size={14} /> Volume de Jogo
                                        </h4>
                                        
                                        {/* Attacks Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span>{homeAttacks}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Ataques Totais</span>
                                            <span>{awayAttacks}</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homeAttPct}%`, 
                                              background: 'linear-gradient(90deg, #10b981, #34d399)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayAttPct}%`, 
                                              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>

                                        {/* Dangerous Attacks Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span style={{ color: '#10b981' }}>{homeDA}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Ataques Perigosos</span>
                                            <span style={{ color: '#f59e0b' }}>{awayDA}</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homeDAPct}%`, 
                                              background: 'linear-gradient(90deg, #10b981, #059669)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayDAPct}%`, 
                                              background: 'linear-gradient(90deg, #fbbf24, #d97706)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>

                                        {/* Possession Progression Bar */}
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            <span>{homePoss}%</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Posse de Bola</span>
                                            <span>{awayPoss}%</span>
                                          </div>
                                          <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                            <div style={{ 
                                              width: `${homePossPct}%`, 
                                              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', 
                                              height: '100%' 
                                            }}></div>
                                            <div style={{ 
                                              width: `${awayPossPct}%`, 
                                              background: 'linear-gradient(90deg, #f43f5e, #fb7185)', 
                                              height: '100%' 
                                            }}></div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* 2. RAIO-X DE FINALIZAÇÕES */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {(() => {
                                          const totalShotsMax = Math.max(homeTotalShots, awayTotalShots, 1);
                                          return (
                                            <div style={{ 
                                              display: 'flex', 
                                              flexDirection: 'column', 
                                              alignItems: 'center', 
                                              width: '100%', 
                                              background: 'rgba(255, 255, 255, 0.02)',
                                              padding: '12px 14px', 
                                              borderRadius: '8px', 
                                              border: '1px solid var(--border-color)',
                                              fontFamily: 'Inter, sans-serif'
                                            }}>
                                              {/* Label Centrado */}
                                              <div style={{ 
                                                fontSize: '0.7rem', 
                                                fontWeight: 800,
                                                textTransform: 'uppercase', 
                                                color: 'var(--text-secondary)', 
                                                marginBottom: '10px',
                                                textAlign: 'center',
                                                letterSpacing: '0.05em'
                                              }}>
                                                Finalizações / Chutes ao Gol
                                              </div>
                                              
                                              {/* Painel Central com Números e Barras */}
                                              <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between', 
                                                width: '100%',
                                                gap: '12px'
                                              }}>
                                                {/* Casa (Home) */}
                                                <div style={{ 
                                                  fontSize: '1.2rem', 
                                                  fontWeight: 700, 
                                                  color: 'var(--text-primary)',
                                                  minWidth: '50px',
                                                  textAlign: 'right'
                                                }}>
                                                  {homeTotalShots}
                                                  <span style={{ color: 'var(--text-secondary)', opacity: 0.5, fontWeight: 400, margin: '0 2px' }}>/</span>
                                                  {homeShotsOn}
                                                </div>

                                                {/* Duas Barras de Progresso */}
                                                <div style={{ 
                                                  display: 'flex', 
                                                  flexDirection: 'column', 
                                                  gap: '4px', 
                                                  flexGrow: 1, 
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  minWidth: '100px'
                                                }}>
                                                  {/* Barra 1: Finalizações Totais */}
                                                  <div style={{ display: 'flex', width: '100%', height: '4px', alignItems: 'center' }}>
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                                                      <div style={{ 
                                                        width: `${(homeTotalShots / totalShotsMax) * 100}%`, 
                                                        height: '4px', 
                                                        backgroundColor: '#3a75e2', 
                                                        borderTopLeftRadius: '2px', 
                                                        borderBottomLeftRadius: '2px' 
                                                      }} />
                                                    </div>
                                                    <div style={{ width: '2px', height: '4px', backgroundColor: 'transparent' }} />
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-start' }}>
                                                      <div style={{ 
                                                        width: `${(awayTotalShots / totalShotsMax) * 100}%`, 
                                                        height: '4px', 
                                                        backgroundColor: '#00b02f', 
                                                        borderTopRightRadius: '2px', 
                                                        borderBottomRightRadius: '2px' 
                                                      }} />
                                                    </div>
                                                  </div>

                                                  {/* Barra 2: Chutes ao Gol (No Alvo) */}
                                                  <div style={{ display: 'flex', width: '100%', height: '3px', alignItems: 'center' }}>
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                                                      <div style={{ 
                                                        width: `${(homeShotsOn / totalShotsMax) * 100}%`, 
                                                        height: '3px', 
                                                        backgroundColor: '#3a75e2', 
                                                        borderTopLeftRadius: '1.5px', 
                                                        borderBottomLeftRadius: '1.5px',
                                                        opacity: 0.85
                                                      }} />
                                                    </div>
                                                    <div style={{ width: '2px', height: '3px', backgroundColor: 'transparent' }} />
                                                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-start' }}>
                                                      <div style={{ 
                                                        width: `${(awayShotsOn / totalShotsMax) * 100}%`, 
                                                        height: '3px', 
                                                        backgroundColor: '#00b02f', 
                                                        borderTopRightRadius: '1.5px', 
                                                        borderBottomRightRadius: '1.5px',
                                                        opacity: 0.85
                                                      }} />
                                                    </div>
                                                  </div>
                                                </div>

                                                {/* Fora (Away) */}
                                                <div style={{ 
                                                  fontSize: '1.2rem', 
                                                  fontWeight: 700, 
                                                  color: 'var(--text-primary)',
                                                  minWidth: '50px',
                                                  textAlign: 'left'
                                                }}>
                                                  {awayTotalShots}
                                                  <span style={{ color: 'var(--text-secondary)', opacity: 0.5, fontWeight: 400, margin: '0 2px' }}>/</span>
                                                  {awayShotsOn}
                                                </div>
                                              </div>
                                              <div style={{ display: 'none' }}>
                                                {homeShotsBlocked} {awayShotsBlocked} {homeShotsInside} {awayShotsInside}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                        {/* Escanteios (Cantos) Highlight */}
                                        <div style={{ 
                                          background: 'rgba(16, 185, 129, 0.08)', 
                                          padding: '8px 12px', 
                                          borderRadius: '8px', 
                                          border: '1px dashed rgba(16, 185, 129, 0.3)', 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center',
                                          marginTop: '10px'
                                        }}>
                                          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--status-green)' }}>{homeCorners}</span>
                                          <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-primary)' }}>Escanteios (Cantos)</span>
                                          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--status-green)' }}>{awayCorners}</span>
                                        </div>
                                      </div>

                                      {/* 3. DEFESA & DISCIPLINA */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <ShieldAlert size={14} /> Defesa & Disciplina
                                        </h4>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                          {/* Fouls Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800 }}>{homeFouls}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Faltas Cometidas</span>
                                            <span style={{ fontWeight: 800 }}>{awayFouls}</span>
                                          </div>

                                          {/* Offsides Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800 }}>{homeOffsides}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Impedimentos</span>
                                            <span style={{ fontWeight: 800 }}>{awayOffsides}</span>
                                          </div>

                                          {/* Goalkeeper Saves Comparison */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                                            <span style={{ fontWeight: 800, color: 'var(--status-green)' }}>{homeSaves}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Defesas Goleiro</span>
                                            <span style={{ fontWeight: 800, color: 'var(--status-green)' }}>{awaySaves}</span>
                                          </div>

                                          {/* Cards Display */}
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                            {/* Home Cards */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#fbbf24', borderRadius: '2px' }}></span>
                                                {homeYellow}
                                              </span>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#ef4444', borderRadius: '2px' }}></span>
                                                {homeRed}
                                              </span>
                                            </div>

                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>Cartões</span>

                                            {/* Away Cards */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                {awayYellow}
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#fbbf24', borderRadius: '2px' }}></span>
                                              </span>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                                                {awayRed}
                                                <span style={{ display: 'inline-block', width: '10px', height: '14px', background: '#ef4444', borderRadius: '2px' }}></span>
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                    </div>
                                    )}

                                    {/* 🏆 ANÁLISE PRÉ-LIVE (PLS) & SCORE DE CANTOS */}
                                    {!isMobile && (
                                    <div style={{ 
                                      marginTop: '24px', 
                                      paddingTop: '20px', 
                                      borderTop: '1px solid var(--border-color)',
                                      display: 'grid', 
                                      gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr', 
                                      gap: '24px' 
                                    }}>
                                      {/* Left Card: Pre-Live (PLS) & Qualidade do Confronto */}
                                      <div style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        padding: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '16px'
                                      }}>
                                        <h4 style={{ 
                                          fontSize: '0.85rem', 
                                          fontWeight: 800, 
                                          textTransform: 'uppercase', 
                                          color: 'var(--accent-primary)', 
                                          margin: '0', 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          gap: '6px' 
                                        }}>
                                          <TrendingUp size={16} /> 🏆 Análise Pré-Live (PLS) & Qualidade do Confronto
                                        </h4>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                          {/* Home Pre-Live */}
                                          <div style={{ 
                                            background: 'var(--bg-surface)', 
                                            padding: '12px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--border-color)',
                                            textAlign: 'center',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '6px'
                                          }}>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                              {f.homeTeam.name}
                                            </span>
                                            {homePLS !== null ? (
                                              <>
                                                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: homePLSTier?.color }}>
                                                  {homePLS}
                                                </div>
                                                <span style={{ 
                                                  fontSize: '0.65rem', 
                                                  fontWeight: 800, 
                                                  padding: '2px 8px', 
                                                  borderRadius: '4px', 
                                                  backgroundColor: `${homePLSTier?.color}15`, 
                                                  color: homePLSTier?.color,
                                                  border: `1px solid ${homePLSTier?.color}33`,
                                                  textTransform: 'uppercase'
                                                }}>
                                                  {homePLSTier?.label}
                                                </span>
                                              </>
                                            ) : (
                                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                                                Dossiê Indisponível
                                              </span>
                                            )}
                                          </div>

                                          {/* Away Pre-Live */}
                                          <div style={{ 
                                            background: 'var(--bg-surface)', 
                                            padding: '12px', 
                                            borderRadius: '8px', 
                                            border: '1px solid var(--border-color)',
                                            textAlign: 'center',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '6px'
                                          }}>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                              {f.awayTeam.name}
                                            </span>
                                            {awayPLS !== null ? (
                                              <>
                                                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: awayPLSTier?.color }}>
                                                  {awayPLS}
                                                </div>
                                                <span style={{ 
                                                  fontSize: '0.65rem', 
                                                  fontWeight: 800, 
                                                  padding: '2px 8px', 
                                                  borderRadius: '4px', 
                                                  backgroundColor: `${awayPLSTier?.color}15`, 
                                                  color: awayPLSTier?.color,
                                                  border: `1px solid ${awayPLSTier?.color}33`,
                                                  textTransform: 'uppercase'
                                                }}>
                                                  {awayPLSTier?.label}
                                                </span>
                                              </>
                                            ) : (
                                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                                                Dossiê Indisponível
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Dynamic Quality Pct Indicator Cards */}
                                        <div style={{ 
                                          background: 'var(--bg-surface)', 
                                          borderRadius: '8px', 
                                          padding: '14px', 
                                          border: '1px solid var(--border-color)',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '12px'
                                        }}>
                                          <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-primary)', textAlign: 'center' }}>
                                            🎯 Taxa de Qualidade de Mercado (%)
                                          </div>
                                          
                                          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                                            {/* Home Quality Circle */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                              <div style={{ 
                                                width: '64px', 
                                                height: '64px', 
                                                borderRadius: '50%', 
                                                border: `4px solid ${homeQualPct >= 80 ? '#ef4444' : homeQualPct >= 70 ? 'var(--status-green)' : homeQualPct >= 50 ? 'var(--status-yellow)' : 'var(--border-color)'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 900,
                                                fontSize: '1rem',
                                                color: 'var(--text-primary)',
                                                background: 'rgba(255, 255, 255, 0.02)',
                                                boxShadow: homeQualPct >= 70 ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none'
                                              }}>
                                                {homeQualPct}%
                                              </div>
                                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)' }}>CASA</span>
                                            </div>

                                            {/* Away Quality Circle */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                              <div style={{ 
                                                width: '64px', 
                                                height: '64px', 
                                                borderRadius: '50%', 
                                                border: `4px solid ${awayQualPct >= 80 ? '#ef4444' : awayQualPct >= 70 ? 'var(--status-green)' : awayQualPct >= 50 ? 'var(--status-yellow)' : 'var(--border-color)'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 900,
                                                fontSize: '1rem',
                                                color: 'var(--text-primary)',
                                                background: 'rgba(255, 255, 255, 0.02)',
                                                boxShadow: awayQualPct >= 70 ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none'
                                              }}>
                                                {awayQualPct}%
                                              </div>
                                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)' }}>FORA</span>
                                            </div>
                                          </div>

                                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.4, textAlign: 'center' }}>
                                            Calculado ponderando <strong>30% do Histórico PLS</strong> com <strong>70% da Telemetria Ao Vivo (Score Final)</strong>. Se o dossiê não estiver disponível, o score em tempo real representa 100% da nota.
                                          </div>
                                        </div>
                                      </div>

                                      {/* Right Card: Comparison Grid with the 7 Normalized Metrics & Score Final */}
                                      <div style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        padding: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                      }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <h4 style={{ 
                                            fontSize: '0.85rem', 
                                            fontWeight: 800, 
                                            textTransform: 'uppercase', 
                                            color: 'var(--accent-primary)', 
                                            margin: '0', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '6px' 
                                          }}>
                                            <Gauge size={16} /> 📊 Detalhamento de Métricas Normalizadas (0-10)
                                          </h4>
                                          <button onClick={() => setShowWeightsModal(true)} style={{
                                            background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                                            borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                                            fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-primary)',
                                            display: 'flex', alignItems: 'center', gap: '4px',
                                            transition: 'all 0.2s ease',
                                          }}
                                          onMouseEnter={e => { (e.target as HTMLElement).style.background = 'var(--accent-primary)'; (e.target as HTMLElement).style.color = '#fff'; }}
                                          onMouseLeave={e => { (e.target as HTMLElement).style.background = 'var(--bg-elevated)'; (e.target as HTMLElement).style.color = 'var(--accent-primary)'; }}
                                          >
                                            <SettingsIcon size={12} /> ⚙️ Ajustar Pesos
                                          </button>
                                        </div>

                                        <div style={{ overflowX: 'auto' }}>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                            <thead>
                                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: 700 }}>Métrica Normalizada</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: 700 }}>Peso</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--status-green)', fontWeight: 800 }}>CASA</th>
                                                <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--status-yellow)', fontWeight: 800 }}>FORA</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>IAP Normalizado (NIAP)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.niap}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNiap * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNiap * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Chutes no Gol Normalizados (NCG)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.ncg}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcg * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcg * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Escanteios Normalizados (NESC)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nesc}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNesc * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNesc * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Finalizações Normalizadas (NFT)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nft}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNft * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNft * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Vermelhos Normalizados (NCV)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.ncv}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcv * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcv * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Posse de Bola Normalizada (NPOS)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.npos}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNpos * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNpos * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Amarelos Normalizados (NCA)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 700 }}>{activeScoreWeights.nca}%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNca * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNca * 10) / 10}</td>
                                              </tr>
                                              {/* Row for SCORE FINAL */}
                                              <tr style={{ background: 'var(--bg-surface)' }}>
                                                <td style={{ padding: '8px 4px', fontWeight: 900, fontSize: '0.8rem', color: 'var(--text-primary)' }}>🏆 SCORE FINAL DO SISTEMA (SFS)</td>
                                                <td style={{ textAlign: 'center', padding: '8px 4px', fontWeight: 800, color: 'var(--accent-primary)' }}>100%</td>
                                                <td style={{ 
                                                  textAlign: 'center', 
                                                  padding: '8px 4px', 
                                                  fontWeight: 900, 
                                                  fontSize: '0.9rem', 
                                                  color: homeScore >= 8.0 ? '#ef4444' : homeScore >= 7.0 ? 'var(--status-green)' : homeScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)'
                                                }}>
                                                  {homeScore}
                                                </td>
                                                <td style={{ 
                                                  textAlign: 'center', 
                                                  padding: '8px 4px', 
                                                  fontWeight: 900, 
                                                  fontSize: '0.9rem', 
                                                  color: awayScore >= 8.0 ? '#ef4444' : awayScore >= 7.0 ? 'var(--status-green)' : awayScore >= 6.0 ? 'var(--status-yellow)' : 'var(--text-primary)'
                                                }}>
                                                  {awayScore}
                                                </td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </div>
                                    )}

                                    {/* ⚡ GRÁFICO DE PRESSÃO — Visualização completa */}
                                    {stats.hasBridge && (
                                      <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Zap size={14} color="var(--accent-primary)" /> ⚡ Gráfico de Pressão & APM Dinâmico
                                        </h4>

                                        {/* SVG Pressure Chart */}
                                        {(() => {
                                          const chartW = 680, chartH = 200, padL = 45, padR = 20, padT = 15, padB = 30;
                                          const plotW = chartW - padL - padR;
                                          const plotH = chartH - padT - padB;
                                          const snaps = unifiedSnapshots;
                                          const elapsed = getDisplayElapsed(f.id, f.elapsed || 1, f.status || '') || 1;
                                          const halfElapsed = elapsed > 45 ? elapsed - 45 : elapsed;
                                          const isSecondHalf = elapsed > 45;

                                          // Time gates (based on half elapsed) - aligned with fixed blocks
                                          const gate10 = isSecondHalf ? 55 : 10;
                                          const gate5 = isSecondHalf ? 50 : 5;
                                          const gate3 = isSecondHalf ? 48 : 3;

                                          // Calculate max DA for scale
                                          const maxDA = Math.max(
                                            homeDA, awayDA,
                                            ...snaps.map(s => Math.max(s.homeDA || 0, s.awayDA || 0)),
                                            10
                                          );
                                          const maxTime = Math.max(elapsed, 45);

                                          // Helper: data point to SVG coordinates
                                          const toX = (t: number) => padL + (t / maxTime) * plotW;
                                          const toY = (da: number) => padT + plotH - (da / maxDA) * plotH;

                                          // Build path data for home and away DA lines
                                          const buildPath = (side: 'home' | 'away'): string => {
                                            const points: Array<{x: number; y: number}> = [];
                                            // Start at origin
                                            points.push({ x: toX(0), y: toY(0) });
                                            for (const s of snaps) {
                                              const da = side === 'home' ? (s.homeDA || 0) : (s.awayDA || 0);
                                              points.push({ x: toX(s.elapsed), y: toY(da) });
                                            }
                                            // Add current point
                                            const curDA = side === 'home' ? homeDA : awayDA;
                                            points.push({ x: toX(elapsed), y: toY(curDA) });
                                            return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
                                          };

                                          const buildArea = (side: 'home' | 'away'): string => {
                                            const linePath = buildPath(side);
                                            return `${linePath} L${toX(elapsed).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;
                                          };

                                          const homePath = buildPath('home');
                                          const awayPath = buildPath('away');
                                          const homeArea = buildArea('home');
                                          const awayArea = buildArea('away');

                                          // Y-axis ticks
                                          const yTicks = [0, Math.round(maxDA * 0.25), Math.round(maxDA * 0.5), Math.round(maxDA * 0.75), maxDA];

                                          // X-axis ticks (every 5 or 10 min)
                                          const xStep = maxTime > 30 ? 10 : 5;
                                          const xTicks: number[] = [];
                                          for (let t = 0; t <= maxTime; t += xStep) xTicks.push(t);

                                          // Time gate active check (aligned with fixed blocks)
                                          const is10Active = halfElapsed >= 10;
                                          const is5Active = halfElapsed >= 5;
                                          const is3Active = halfElapsed >= 3;


                                          // ─── APM Block calculation for chart ─────────────────
                                          const buildApmBlockBars2 = (blockSize: number) => {
                                            const blocks: Array<{start: number; end: number; homeApm: number; awayApm: number}> = [];
                                            const numBlocks = Math.floor(elapsed / blockSize);
                                            for (let i = 0; i < numBlocks; i++) {
                                              const bStart = i * blockSize;
                                              const bEnd = (i + 1) * blockSize;
                                              let startSnap = snaps[0], endSnap = snaps[0];
                                              let startDiff = Infinity, endDiff = Infinity;
                                              for (const s of snaps) {
                                                const sd = Math.abs(s.elapsed - bStart);
                                                const ed = Math.abs(s.elapsed - bEnd);
                                                if (sd < startDiff) { startDiff = sd; startSnap = s; }
                                                if (ed < endDiff) { endDiff = ed; endSnap = s; }
                                              }
                                              if (startDiff > blockSize * 0.4 || endDiff > blockSize * 0.4) continue;
                                              const hDiff = (endSnap.homeDA || 0) - (startSnap.homeDA || 0);
                                              const aDiff = (endSnap.awayDA || 0) - (startSnap.awayDA || 0);
                                              blocks.push({
                                                start: bStart, end: bEnd,
                                                homeApm: Math.max(0, hDiff / blockSize),
                                                awayApm: Math.max(0, aDiff / blockSize)
                                              });
                                            }
                                            if (elapsed > numBlocks * blockSize && snaps.length > 0) {
                                              const bStart = numBlocks * blockSize;
                                              let startSnap = snaps[0];
                                              let startDiff = Infinity;
                                              for (const s of snaps) {
                                                const sd = Math.abs(s.elapsed - bStart);
                                                if (sd < startDiff) { startDiff = sd; startSnap = s; }
                                              }
                                              const currentSnap = snaps[snaps.length - 1];
                                              const partialTime = elapsed - bStart;
                                              if (partialTime > 0.5 && startDiff < blockSize * 0.4) {
                                                const hDiff = (currentSnap.homeDA || 0) - (startSnap.homeDA || 0);
                                                const aDiff = (currentSnap.awayDA || 0) - (startSnap.awayDA || 0);
                                                blocks.push({
                                                  start: bStart, end: elapsed,
                                                  homeApm: Math.max(0, hDiff / partialTime),
                                                  awayApm: Math.max(0, aDiff / partialTime)
                                                });
                                              }
                                            }
                                            return blocks;
                                          };

                                          const apmBlockSize = chartViewMode === 'apm10' ? 10 : chartViewMode === 'apm5' ? 5 : chartViewMode === 'apm3' ? 3 : 0;
                                          const apmBlockColor = chartViewMode === 'apm10' ? '#3b82f6' : chartViewMode === 'apm5' ? '#8b5cf6' : '#ef4444';
                                          const apmBlocks = apmBlockSize > 0 ? buildApmBlockBars2(apmBlockSize) : [];
                                          const maxApm = apmBlocks.length > 0 ? Math.max(...apmBlocks.flatMap(b => [b.homeApm, b.awayApm]), 0.5) : 1;
                                          const toYapm = (v: number) => padT + plotH - (v / maxApm) * plotH;

                                          return (
                                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: '16px', alignItems: 'start' }}>
                                              {/* LEFT: SVG Chart */}
                                              <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '16px 12px 12px' }}>
                                                {/* Chart Header */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                                    {chartViewMode === 'da' ? 'Ataques Perigosos — Evolução Temporal' : `APM Blocos Fixos — ${apmBlockSize} min/bloco`}
                                                  </span>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ display: 'flex', gap: '3px', background: 'var(--bg-surface)', borderRadius: '6px', padding: '2px' }}>
                                                      {(['da', 'apm10', 'apm5', 'apm3'] as const).map(mode => {
                                                        const lb: Record<string, string> = { da: 'DA', apm10: 'ATM 10', apm5: 'ATM 5', apm3: 'ATM 3' };
                                                        const cl: Record<string, string> = { da: 'var(--accent-primary)', apm10: '#3b82f6', apm5: '#8b5cf6', apm3: '#ef4444' };
                                                        const ac = chartViewMode === mode;
                                                        return (
                                                          <button key={mode} onClick={() => setChartViewMode(mode)} style={{
                                                            padding: '3px 10px', borderRadius: '4px', border: 'none',
                                                            cursor: 'pointer', fontWeight: 800, fontSize: '0.6rem',
                                                            background: ac ? cl[mode] : 'transparent',
                                                            color: ac ? '#fff' : 'var(--text-muted)',
                                                            transition: 'all 0.2s ease',
                                                            boxShadow: ac ? `0 1px 4px ${cl[mode]}40` : 'none'
                                                          }}>
                                                            {lb[mode]}
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', fontWeight: 700 }}>
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ width: 10, height: 3, background: '#10b981', display: 'inline-block', borderRadius: 2 }}></span>
                                                        {f.homeTeam.name}
                                                      </span>
                                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ width: 10, height: 3, background: '#f59e0b', display: 'inline-block', borderRadius: 2 }}></span>
                                                        {f.awayTeam.name}
                                                      </span>
                                                    </div>
                                                  </div>
                                                </div>
                                                <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + (chartViewMode !== 'da' ? 18 : 0)}`} style={{ overflow: 'visible' }}>
                                                  <defs>
                                                    <linearGradient id={`homeGrad-${f.id}`} x1="0" y1="0" x2="0" y2="1">
                                                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                                                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                                                    </linearGradient>
                                                    <linearGradient id={`awayGrad-${f.id}`} x1="0" y1="0" x2="0" y2="1">
                                                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                                                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                                                    </linearGradient>
                                                  </defs>
                                                  {chartViewMode === 'da' ? (
                                                    <>
                                                      {yTicks.map(v => (
                                                        <g key={`y-${v}`}>
                                                          <line x1={padL} y1={toY(v)} x2={chartW - padR} y2={toY(v)} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4,4" />
                                                          <text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontWeight="600">{v}</text>
                                                        </g>
                                                      ))}
                                                      {xTicks.map(t => (
                                                        <text key={`x-${t}`} x={toX(t)} y={chartH - 4} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontWeight="600">{t}'</text>
                                                      ))}
                                                      {[
                                                        { t: gate10, label: 'ATM 10', color: '#3b82f6', active: is10Active },
                                                        { t: gate5, label: 'ATM 5', color: '#8b5cf6', active: is5Active },
                                                        { t: gate3, label: 'ATM 3', color: '#ef4444', active: is3Active },
                                                      ].filter(g => g.t <= maxTime).map(gate => (
                                                        <g key={gate.label}>
                                                          <line x1={toX(gate.t)} y1={padT} x2={toX(gate.t)} y2={padT + plotH}
                                                            stroke={gate.active ? gate.color : 'var(--text-muted)'}
                                                            strokeWidth={gate.active ? "1.5" : "1"}
                                                            strokeDasharray={gate.active ? "none" : "3,3"}
                                                            opacity={gate.active ? 0.8 : 0.3} />
                                                          <rect x={toX(gate.t) - 16} y={padT - 12} width="32" height="12" rx="3"
                                                            fill={gate.active ? gate.color : 'var(--bg-surface)'}
                                                            opacity={gate.active ? 0.9 : 0.5} stroke={gate.color} strokeWidth="0.5" />
                                                          <text x={toX(gate.t)} y={padT - 3} textAnchor="middle" fill={gate.active ? '#fff' : 'var(--text-muted)'} fontSize="7" fontWeight="800">{gate.label}</text>
                                                        </g>
                                                      ))}
                                                      <path d={homeArea} fill={`url(#homeGrad-${f.id})`} />
                                                      <path d={awayArea} fill={`url(#awayGrad-${f.id})`} />
                                                      <path d={homePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                      <path d={awayPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                      <circle cx={toX(elapsed)} cy={toY(homeDA)} r="4" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                                                      <circle cx={toX(elapsed)} cy={toY(awayDA)} r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
                                                      <text x={toX(elapsed) + 8} y={toY(homeDA) + 3} fill="#10b981" fontSize="10" fontWeight="800">{homeDA}</text>
                                                      <text x={toX(elapsed) + 8} y={toY(awayDA) + 3} fill="#f59e0b" fontSize="10" fontWeight="800">{awayDA}</text>
                                                      <line x1={toX(elapsed)} y1={padT} x2={toX(elapsed)} y2={padT + plotH} stroke="var(--accent-primary)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
                                                    </>
                                                  ) : (
                                                    <>
                                                      {[0, 0.25, 0.5, 0.75, 1.0].map(frac => {
                                                        const v = Math.round(maxApm * frac * 100) / 100;
                                                        return (
                                                          <g key={`yapm-${frac}`}>
                                                            <line x1={padL} y1={toYapm(v)} x2={chartW - padR} y2={toYapm(v)} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4,4" />
                                                            <text x={padL - 6} y={toYapm(v) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontWeight="600">{v.toFixed(1)}</text>
                                                          </g>
                                                        );
                                                      })}
                                                      <text x={8} y={padT + plotH / 2} textAnchor="middle" fill={apmBlockColor} fontSize="8" fontWeight="700" transform={`rotate(-90, 8, ${padT + plotH / 2})`} opacity="0.7">AP/min</text>
                                                      {apmBlocks.map((block, bi) => {
                                                        const bx1 = toX(block.start);
                                                        const bx2 = toX(block.end);
                                                        const bW = bx2 - bx1;
                                                        const barW = Math.max((bW - 6) / 2, 3);
                                                        const isPartial = block.end === elapsed && block.end % apmBlockSize !== 0;
                                                        return (
                                                          <g key={`ab-${bi}`}>
                                                            <rect x={bx1} y={padT} width={bW} height={plotH} fill={apmBlockColor} opacity={isPartial ? 0.02 : 0.04} rx="2" />
                                                            <rect x={bx1 + 2} y={toYapm(block.homeApm)} width={barW} height={Math.max(padT + plotH - toYapm(block.homeApm), 1)} fill="#10b981" opacity={isPartial ? 0.35 : 0.75} rx="2" />
                                                            <rect x={bx1 + barW + 4} y={toYapm(block.awayApm)} width={barW} height={Math.max(padT + plotH - toYapm(block.awayApm), 1)} fill="#f59e0b" opacity={isPartial ? 0.35 : 0.75} rx="2" />
                                                            {bW > 30 && (
                                                              <>
                                                                <text x={bx1 + 2 + barW/2} y={toYapm(block.homeApm) - 4} textAnchor="middle" fill="#10b981" fontSize="8" fontWeight="800">{block.homeApm.toFixed(2)}</text>
                                                                <text x={bx1 + barW + 4 + barW/2} y={toYapm(block.awayApm) - 4} textAnchor="middle" fill="#f59e0b" fontSize="8" fontWeight="800">{block.awayApm.toFixed(2)}</text>
                                                              </>
                                                            )}
                                                            <text x={bx1 + bW/2} y={padT + plotH + 12} textAnchor="middle" fill={isPartial ? 'var(--text-muted)' : apmBlockColor} fontSize="7.5" fontWeight="700" opacity={isPartial ? 0.5 : 0.85}>{Math.round(block.start)}'-{Math.round(block.end)}'</text>
                                                            {isPartial && <text x={bx1 + bW/2} y={padT + plotH + 21} textAnchor="middle" fill="var(--text-muted)" fontSize="6" fontWeight="600" opacity="0.5">parcial</text>}
                                                          </g>
                                                        );
                                                      })}
                                                      {apmData.home.apmGlobal > 0 && (
                                                        <>
                                                          <line x1={padL} y1={toYapm(apmData.home.apmGlobal)} x2={chartW - padR} y2={toYapm(apmData.home.apmGlobal)} stroke="#10b981" strokeWidth="1" strokeDasharray="6,3" opacity="0.4" />
                                                          <text x={chartW - padR + 2} y={toYapm(apmData.home.apmGlobal) - 2} fill="#10b981" fontSize="7" fontWeight="700" opacity="0.6">Global {apmData.home.apmGlobal}</text>
                                                        </>
                                                      )}
                                                      {apmData.away.apmGlobal > 0 && (
                                                        <>
                                                          <line x1={padL} y1={toYapm(apmData.away.apmGlobal)} x2={chartW - padR} y2={toYapm(apmData.away.apmGlobal)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="6,3" opacity="0.4" />
                                                          <text x={chartW - padR + 2} y={toYapm(apmData.away.apmGlobal) + 8} fill="#f59e0b" fontSize="7" fontWeight="700" opacity="0.6">Global {apmData.away.apmGlobal}</text>
                                                        </>
                                                      )}
                                                      <line x1={toX(elapsed)} y1={padT} x2={toX(elapsed)} y2={padT + plotH} stroke="var(--accent-primary)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
                                                    </>
                                                  )}
                                                  <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--border-color)" strokeWidth="1" />
                                                  <line x1={padL} y1={padT + plotH} x2={chartW - padR} y2={padT + plotH} stroke="var(--border-color)" strokeWidth="1" />
                                                </svg>
                                              </div>

                                              {/* RIGHT: APM Cards + IPR */}
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {/* APM Window Cards */}
                                                {/* Data Age indicator */}
                                                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'right', marginBottom: '2px', fontWeight: 600 }}>
                                                  📡 Dados: {apmData.home.dataAge > 0 ? `${apmData.home.dataAge} min coletados` : 'Sem snapshots'}
                                                </div>
                                                {[
                                                  { label: 'Global', home: apmData.home.apmGlobal, away: apmData.away.apmGlobal, active: true, reliable: true, color: '#6b7280', icon: '📊' },
                                                  { label: 'ATM 10', home: apmData.home.apm10, away: apmData.away.apm10, active: is10Active, reliable: apmData.home.reliable10, color: '#3b82f6', icon: '🔵', gate: `${gate10}'`, need: 6 },
                                                  { label: 'ATM 5', home: apmData.home.apm5, away: apmData.away.apm5, active: is5Active, reliable: apmData.home.reliable5, color: '#8b5cf6', icon: '🟣', gate: `${gate5}'`, need: 3 },
                                                  { label: 'ATM 3', home: apmData.home.apm3, away: apmData.away.apm3, active: is3Active, reliable: apmData.home.reliable3, color: '#ef4444', icon: '🔴', gate: `${gate3}'`, need: 2 },
                                                ].map(w => (
                                                  <div key={w.label} style={{
                                                    background: w.active ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                                                    border: `1px solid ${w.active ? w.color + '40' : 'var(--border-color)'}`,
                                                    borderRadius: '8px',
                                                    padding: '8px 12px',
                                                    opacity: w.active ? 1 : 0.5,
                                                    transition: 'all 0.3s ease',
                                                    position: 'relative' as const,
                                                    overflow: 'hidden' as const,
                                                  }}>
                                                    {/* Active indicator bar */}
                                                    {w.active && <div style={{ position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: '3px', background: w.reliable ? w.color : '#fbbf24', borderRadius: '0 2px 2px 0' }}></div>}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: w.active ? w.color : 'var(--text-muted)', textTransform: 'uppercase' }}>
                                                        {w.icon} {w.label}
                                                      </span>
                                                      {w.gate && (
                                                        <span style={{
                                                          fontSize: '0.55rem', fontWeight: 700,
                                                          padding: '1px 5px', borderRadius: '3px',
                                                          background: !w.active ? 'var(--bg-elevated)' : w.reliable ? `${w.color}20` : 'rgba(251, 191, 36, 0.15)',
                                                          color: !w.active ? 'var(--text-muted)' : w.reliable ? w.color : '#fbbf24',
                                                        }}>
                                                          {!w.active ? `Ativa ${w.gate}` : w.reliable ? '✓ ATIVO' : `⚠ COLETANDO (${w.need}min)`}
                                                        </span>
                                                      )}
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                      <span style={{ fontSize: '0.95rem', fontWeight: 900, color: w.active && w.reliable && w.home >= 1.0 ? '#ef4444' : w.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                        {w.home}
                                                      </span>
                                                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                                        {w.active && !w.reliable && w.gate ? '≈ Global' : 'AP/min'}
                                                      </span>
                                                      <span style={{ fontSize: '0.95rem', fontWeight: 900, color: w.active && w.reliable && w.away >= 1.0 ? '#ef4444' : w.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                        {w.away}
                                                      </span>
                                                    </div>
                                                  </div>
                                                ))}

                                                {/* Aceleração */}
                                                <div style={{
                                                  background: 'var(--bg-elevated)', borderRadius: '8px',
                                                  border: '1px solid var(--border-color)', padding: '8px 12px',
                                                }}>
                                                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                    ⚡ Aceleração
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{
                                                      fontSize: '0.95rem', fontWeight: 900,
                                                      color: apmData.home.accelerationFactor >= 1.2 ? '#ef4444' : apmData.home.accelerationFactor >= 1.0 ? '#f59e0b' : 'var(--text-primary)',
                                                    }}>
                                                      {apmData.home.accelerationFactor}x
                                                    </span>
                                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fator</span>
                                                    <span style={{
                                                      fontSize: '0.95rem', fontWeight: 900,
                                                      color: apmData.away.accelerationFactor >= 1.2 ? '#ef4444' : apmData.away.accelerationFactor >= 1.0 ? '#f59e0b' : 'var(--text-primary)',
                                                    }}>
                                                      {apmData.away.accelerationFactor}x
                                                    </span>
                                                  </div>
                                                </div>

                                                {/* IPR Bars */}
                                                <div style={{
                                                  background: 'var(--bg-elevated)', borderRadius: '8px',
                                                  border: '1px solid var(--border-color)', padding: '8px 12px',
                                                }}>
                                                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                                    🔥 IPR — Índice de Pressão Recente
                                                  </div>
                                                  {[
                                                    { name: f.homeTeam.name, ipr: apmData.home.ipr, color: '#10b981' },
                                                    { name: f.awayTeam.name, ipr: apmData.away.ipr, color: '#f59e0b' },
                                                  ].map(team => {
                                                    const pct = Math.min(100, (team.ipr / 2.5) * 100);
                                                    const barColor = team.ipr >= 1.5 ? '#ef4444' : team.ipr >= 1.0 ? '#f59e0b' : team.color;
                                                    return (
                                                      <div key={team.name} style={{ marginBottom: '4px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 700, marginBottom: '2px' }}>
                                                          <span style={{ color: team.color }}>{team.name}</span>
                                                          <span style={{ fontWeight: 900, color: barColor }}>{team.ipr}</span>
                                                        </div>
                                                        <div style={{ height: '6px', background: 'var(--bg-surface)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                          <div style={{
                                                            width: `${pct}%`, height: '100%', borderRadius: '3px',
                                                            background: `linear-gradient(90deg, ${team.color}, ${barColor})`,
                                                            transition: 'width 0.5s ease',
                                                          }}></div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                  <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.3 }}>
                                                    IPR = (ATM3×50% + ATM5×30% + ATM10×20%) × Aceleração. Acima de <strong>1.0</strong> = pressão forte.
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}

                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid Duplo do Scanner */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 24, alignItems: 'start' }}>
        
        {/* Coluna Esquerda: Oportunidades Ativas do Bot */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Bell size={20} color="var(--status-red)" className="pulse-indicator" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Oportunidades de Entrada</h2>
            <span className="badge badge-red" style={{ marginLeft: 6 }}>
              {filteredOpps.length}
            </span>
          </div>

          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
              <RefreshCw size={40} className="pulse-indicator" style={{ animation: 'spin 2s linear infinite', marginBottom: 16 }} />
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Iniciando Varredura...</h3>
              <p>Mapeando dados da API e cruzando com padrões de trading...</p>
            </div>
          ) : filteredOpps.length === 0 ? (
            <div className="card glass-panel" style={{ 
              textAlign: 'center', 
              padding: '60px 40px', 
              color: 'var(--text-muted)',
              borderStyle: 'dashed',
              borderColor: 'var(--border-color)',
              background: 'var(--bg-elevated)'
            }}>
              <Activity size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>Buscando Padrões Lucrativos...</h3>
              <p style={{ maxWidth: 450, margin: '0 auto', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Nenhuma partida atende às diretrizes configuradas. O bot continuará lendo o mercado a cada {countdown}s em segundo plano.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {filteredOpps.map(opp => {
                const isSelected = selectedFixture?.id === opp.fixtureId;
                
                // Color strategies
                let stratColor = 'var(--accent-primary)';
                let bgStrat = 'var(--accent-glow)';
                if (opp.strategyName === 'Canto Limite') {
                  stratColor = 'var(--status-green)';
                  bgStrat = 'var(--status-green-glow)';
                } else if (opp.strategyName === 'Over 0.5 Gols HT') {
                  stratColor = 'var(--status-yellow)';
                  bgStrat = 'rgba(217, 119, 6, 0.1)';
                } else {
                  stratColor = 'var(--status-red)';
                  bgStrat = 'var(--status-red-glow)';
                }

                return (
                  <div 
                    key={opp.id} 
                    className="card active-opp-card"
                    style={{ 
                      padding: 20,
                      borderLeft: `5px solid ${stratColor}`,
                      borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                      boxShadow: '0 4px 18px rgba(0,0,0,0.02)',
                      background: isSelected ? 'rgba(30,58,138,0.02)' : 'var(--bg-surface)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    
                    {/* Header Card */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span className="badge" style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 700, 
                        color: stratColor, 
                        background: bgStrat,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <Zap size={12} /> {opp.strategyName.toUpperCase()}
                      </span>
                      
                      {/* Confiança Badge Circular */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Confiança (Crossover):</span>
                        <span className="badge" style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: 800,
                          background: opp.confidence >= 80 ? 'var(--status-green-glow)' : 'rgba(217,119,6,0.1)',
                          color: opp.confidence >= 80 ? 'var(--status-green)' : 'var(--status-yellow)'
                        }}>{opp.confidence}%</span>
                      </div>
                    </div>

                    {/* Confronto e Minutagem */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {opp.match.homeTeam.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{opp.match.goalsHome} - {opp.match.goalsAway}</span> {opp.match.awayTeam.name}
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                          {opp.match.leagueName}
                        </span>
                      </div>
                      
                      <div className="badge badge-green" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                        {opp.match.elapsed}' Minutos
                      </div>
                    </div>

                    {/* Gatilhos e Estatísticas de Pressão */}
                    <div style={{ 
                      background: 'var(--bg-elevated)', 
                      borderRadius: 8, 
                      padding: 12, 
                      fontSize: '0.85rem', 
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                      marginBottom: 14,
                      borderLeft: `2px solid var(--text-muted)`
                    }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Mapeamento Analítico Integrado:</strong> {opp.details}
                    </div>

                    {/* Sugestão de Operação */}
                    <div style={{ 
                      background: 'rgba(5, 150, 105, 0.05)', 
                      border: '1px dashed rgba(5, 150, 105, 0.2)',
                      borderRadius: 8, 
                      padding: '12px 14px', 
                      fontSize: '0.85rem', 
                      color: 'var(--status-green)',
                      lineHeight: 1.5,
                      marginBottom: 14
                    }}>
                      <strong>💡 Sugestão de Entrada:</strong> {opp.suggestion}
                    </div>

                    {/* 🏦 Links Rápidos — Casas de Apostas */}
                    <div style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      marginBottom: 14,
                      border: '1px solid var(--border-color)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Operar Agora</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Seção Ao Vivo ↗</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {getEnabledBookmakers().map(bk => (
                          <a
                            key={bk.id}
                            href={bk.liveUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={`Abrir ${bk.name} — Futebol Ao Vivo`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '7px 14px',
                              borderRadius: 8,
                              background: bk.bgColor,
                              border: `1px solid ${bk.color}33`,
                              color: bk.color,
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              transition: 'all 0.15s ease',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
                              (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${bk.color}22`;
                              (e.currentTarget as HTMLElement).style.borderColor = `${bk.color}66`;
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                              (e.currentTarget as HTMLElement).style.borderColor = `${bk.color}33`;
                            }}
                          >
                            <span style={{ fontSize: '0.9rem' }}>{bk.logo}</span>
                            {bk.name}
                            <PlayCircle size={12} style={{ opacity: 0.7 }} />
                          </a>
                        ))}
                      </div>
                    </div>

                    {/* Ações */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
                      
                      {/* Stake customizer on-the-fly */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Stake:</span>
                        <input
                          type="number"
                          value={defaultStake}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setDefaultStake(val);
                            localStorage.setItem('trade_default_stake', val.toString());
                          }}
                          style={{
                            width: 65, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                            color: '#fff', fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, outline: 'none', textAlign: 'center'
                          }}
                        />
                      </div>

                      <button 
                        className="btn btn-outline" 
                        style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                        onClick={() => setSelectedFixture(opp.match)}
                      >
                        Análise do Jogo
                      </button>

                      <button
                        onClick={() => handleRecusar(opp)}
                        className="btn btn-outline"
                        style={{
                          padding: '8px 16px', fontSize: '0.8rem', fontWeight: 700,
                          background: 'rgba(239, 68, 68, 0.06)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          cursor: 'pointer'
                        }}
                      >
                        ✕ Recusar
                      </button>

                      <button
                        onClick={() => handlePeguei(opp)}
                        disabled={gottenOppIds.has(opp.id)}
                        className="btn"
                        style={{
                          padding: '8px 16px', fontSize: '0.8rem', fontWeight: 800,
                          background: gottenOppIds.has(opp.id) ? 'rgba(16, 185, 129, 0.1)' : 'var(--accent-primary)',
                          color: gottenOppIds.has(opp.id) ? 'var(--status-green)' : '#fff',
                          border: gottenOppIds.has(opp.id) ? '1px solid var(--status-green)' : 'none',
                          cursor: gottenOppIds.has(opp.id) ? 'default' : 'pointer'
                        }}
                      >
                        {gottenOppIds.has(opp.id) ? 'PEGADA! 🟢' : 'PEGUEI ⚡'}
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna Direita: CENTRAL DE ALERTAS */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={20} color="var(--status-yellow)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Central de Alertas</h2>
              <span className="badge" style={{ fontSize: '0.7rem', fontWeight: 800, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: '2px 8px' }}>
                {(() => {
                  const potentialAlerts = allFixtures.filter(f => {
                    const s = allStats[f.id];
                    if (!s) return false;
                    const hasOpp = filteredOpps.some(o => o.fixtureId === f.id);
                    const triggerThreshold = cornerTriggerThreshold;
                    const potentialThreshold = triggerThreshold - 1.0;
                    const homeScore = getScoreFinalForSide(f.id, true);
                    const awayScore = getScoreFinalForSide(f.id, false);
                    const vt = f.elapsed <= 90 && f.status !== 'HT';
                    return !hasOpp && vt && (
                      homeScore >= potentialThreshold || awayScore >= potentialThreshold
                    );
                  });
                  return filteredOpps.length + potentialAlerts.length;
                })()}
              </span>
            </div>

            {/* Filtros: Todos / Fazer Entrada / Potencial */}
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', padding: 3, borderRadius: 8, border: '1px solid var(--border-color)' }}>
              {(['all', 'entrada', 'potencial'] as const).map(fKey => {
                const labels: Record<string, string> = { all: 'Todos', entrada: '⚡ Entrada', potencial: '🔥 Potencial' };
                return (
                  <button
                    key={fKey}
                    onClick={() => setAlertFilter(fKey)}
                    style={{
                      padding: '5px 10px', border: 'none', borderRadius: 6,
                      fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer',
                      background: alertFilter === fKey ? (fKey === 'entrada' ? 'var(--status-green)' : fKey === 'potencial' ? 'var(--status-yellow)' : 'var(--accent-primary)') : 'transparent',
                      color: alertFilter === fKey ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.15s ease', outline: 'none'
                    }}
                  >
                    {labels[fKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feed de Alertas Unificado */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', paddingRight: 4 }}>
            {/* 🟢 ALERTAS DE ENTRADA (oportunidades ativas) */}
            {(alertFilter === 'all' || alertFilter === 'entrada') && filteredOpps.map(opp => {
              let stratColor = 'var(--accent-primary)';
              if (opp.strategyName === 'Canto Limite') stratColor = 'var(--status-green)';
              else if (opp.strategyName === 'Over 0.5 Gols HT') stratColor = 'var(--status-yellow)';
              else if (opp.strategyName === 'Funil') stratColor = '#a855f7';
              else stratColor = 'var(--status-red)';

              return (
                <div
                  key={`alert-entry-${opp.id}`}
                  className="card"
                  style={{
                    padding: 16,
                    borderLeft: `4px solid ${stratColor}`,
                    background: 'rgba(16, 185, 129, 0.03)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge" style={{ fontSize: '0.65rem', fontWeight: 800, background: 'var(--status-green-glow)', color: 'var(--status-green)', padding: '3px 8px', animation: 'pulse 2s ease-in-out infinite' }}>
                        ⚡ FAZER ENTRADA
                      </span>
                      <span className="badge" style={{ fontSize: '0.65rem', fontWeight: 700, background: `${stratColor}18`, color: stratColor, padding: '3px 6px' }}>
                        {opp.strategyName}
                      </span>
                    </div>
                    <span className="badge" style={{
                      fontSize: '0.8rem', fontWeight: 800, padding: '3px 8px',
                      background: opp.confidence >= 80 ? 'var(--status-green-glow)' : 'rgba(217,119,6,0.1)',
                      color: opp.confidence >= 80 ? 'var(--status-green)' : 'var(--status-yellow)'
                    }}>{opp.confidence}%</span>
                  </div>

                  {/* Confronto */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {opp.match.homeTeam.name} <span style={{ color: 'var(--text-muted)' }}>{opp.match.goalsHome}-{opp.match.goalsAway}</span> {opp.match.awayTeam.name}
                      </h3>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{opp.match.leagueName}</span>
                    </div>
                    <div className="badge badge-green" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                      {opp.match.elapsed}'
                    </div>
                  </div>

                  {/* Detalhes */}
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10, borderLeft: '2px solid var(--text-muted)' }}>
                    {opp.details}
                  </div>

                  {/* Ataques Perigosos (Bet365 Bridge) */}
                  {(() => {
                    const s = allStats[opp.fixtureId];
                    if (s && (s.home.dangerousAttacks > 0 || s.away.dangerousAttacks > 0)) {
                      return (
                        <div style={{ display: 'flex', gap: 12, marginBottom: 10, padding: '8px 10px', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.12)', borderRadius: 6, alignItems: 'center', fontSize: '0.75rem' }}>
                          <span style={{ color: '#10b981', fontWeight: 800, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>🔗 BET365</span>
                          <span style={{ color: 'var(--text-secondary)' }}>At. Perigosos: <strong style={{ color: 'var(--status-red)' }}>{s.home.dangerousAttacks}</strong>-<strong style={{ color: 'var(--status-red)' }}>{s.away.dangerousAttacks}</strong></span>
                          <span style={{ color: 'var(--text-secondary)' }}>Ataques: <strong>{s.home.attacks}</strong>-<strong>{s.away.attacks}</strong></span>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Sugestão */}
                  <div style={{ background: 'rgba(5,150,105,0.04)', border: '1px dashed rgba(5,150,105,0.15)', borderRadius: 6, padding: '8px 10px', fontSize: '0.78rem', color: 'var(--status-green)', lineHeight: 1.4, marginBottom: 10 }}>
                    <strong>💡</strong> {opp.suggestion}
                  </div>

                  {/* Links + Ação */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {getEnabledBookmakers().map(bk => (
                        <a key={bk.id} href={bk.liveUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '0.65rem', fontWeight: 800, color: bk.color, background: bk.bgColor, padding: '3px 8px', borderRadius: 5, textDecoration: 'none', border: `1px solid ${bk.color}30` }}
                          title={`Abrir ${bk.name}`}
                        >{bk.logo} {bk.shortName}</a>
                      ))}
                    </div>
                    <button onClick={() => handleRecusar(opp)} className="btn btn-outline"
                      style={{ padding: '6px 12px', fontSize: '0.7rem', fontWeight: 700,
                        background: 'rgba(239,68,68,0.06)', color: '#ef4444',
                        border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer'
                      }}
                    >✕ Recusar</button>
                    <button onClick={() => handlePeguei(opp)} disabled={gottenOppIds.has(opp.id)} className="btn"
                      style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 800,
                        background: gottenOppIds.has(opp.id) ? 'rgba(16,185,129,0.1)' : 'var(--accent-primary)',
                        color: gottenOppIds.has(opp.id) ? 'var(--status-green)' : '#fff',
                        border: gottenOppIds.has(opp.id) ? '1px solid var(--status-green)' : 'none',
                        cursor: gottenOppIds.has(opp.id) ? 'default' : 'pointer'
                      }}
                    >{gottenOppIds.has(opp.id) ? 'PEGADA! 🟢' : 'PEGUEI ⚡'}</button>
                  </div>
                </div>
              );
            })}

            {/* 🟡 ALERTAS DE POTENCIAL (jogos esquentando) */}
            {(alertFilter === 'all' || alertFilter === 'potencial') && allFixtures
              .filter(f => {
                const s = allStats[f.id];
                if (!s) return false;
                const hasOpp = filteredOpps.some(o => o.fixtureId === f.id);
                const triggerThreshold = cornerTriggerThreshold;
                const potentialThreshold = triggerThreshold - 1.0;
                const homeScore = getScoreFinalForSide(f.id, true);
                const awayScore = getScoreFinalForSide(f.id, false);
                const vt = f.elapsed <= 90 && f.status !== 'HT';
                return !hasOpp && vt && (
                  homeScore >= potentialThreshold || awayScore >= potentialThreshold
                );
              })
              .map(f => {
                const s = allStats[f.id]!;
                const thRef = activeMode === 'aggressive' ? 0.8 : activeMode === 'defensive' ? 1.4 : activeMode === 'funnel' ? 1.0 : 1.1;
                const dominantHome = s.home.iim > s.away.iim;
                const dominantIIM = dominantHome ? s.home.iim : s.away.iim;
                const pctReady = Math.min(99, Math.round((dominantIIM / thRef) * 100));

                return (
                  <div
                    key={`alert-potential-${f.id}`}
                    className="card"
                    style={{
                      padding: 14,
                      borderLeft: '4px solid var(--status-yellow)',
                      background: 'rgba(245, 158, 11, 0.03)',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge" style={{ fontSize: '0.65rem', fontWeight: 800, background: 'rgba(245,158,11,0.12)', color: 'var(--status-yellow)', padding: '3px 8px' }}>
                          🔥 POTENCIAL
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          {pctReady}% do gatilho
                        </span>
                      </div>
                      <div className="badge badge-green" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                        {getDisplayElapsed(f.id, f.elapsed, f.status)}'
                      </div>
                    </div>

                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {f.homeTeam.name} <span style={{ color: 'var(--text-muted)' }}>{getDisplayScore(f.id, f.goalsHome, f.goalsAway).home}-{getDisplayScore(f.id, f.goalsHome, f.goalsAway).away}</span> {f.awayTeam.name}
                    </h3>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>{f.leagueName}</span>

                    {/* Mini stats */}
                    <div style={{ display: 'flex', gap: 10, fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 10, flexWrap: 'wrap' }}>
                      <span>IIM: <strong>{s.home.iim}</strong>|<strong>{s.away.iim}</strong></span>
                      <span>Cantos: <strong>{s.home.corners}-{s.away.corners}</strong></span>
                      <span>Chutes Gol: <strong>{s.home.shotsOnGoal}-{s.away.shotsOnGoal}</strong></span>
                      <span>Posse: <strong>{s.home.possession}%-{s.away.possession}%</strong></span>
                      {(s.home.dangerousAttacks > 0 || s.away.dangerousAttacks > 0) && (
                        <span style={{ color: '#10b981' }}>🔗 At.Perig: <strong style={{ color: 'var(--status-red)' }}>{s.home.dangerousAttacks}-{s.away.dangerousAttacks}</strong></span>
                      )}
                    </div>

                    {/* Progress bar to trigger */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pctReady}%`, height: '100%', background: pctReady >= 90 ? 'var(--status-green)' : 'var(--status-yellow)', transition: 'width 0.5s ease' }}></div>
                      </div>
                    </div>

                    {/* Links rápidos */}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {getEnabledBookmakers().slice(0, 3).map(bk => (
                        <a key={bk.id} href={bk.liveUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '0.6rem', fontWeight: 700, color: bk.color, background: bk.bgColor, padding: '2px 6px', borderRadius: 4, textDecoration: 'none', opacity: 0.85 }}
                          title={`Preparar no ${bk.name}`}
                        >{bk.logo} {bk.shortName}</a>
                      ))}
                    </div>
                  </div>
                );
              })
            }

            {/* Empty State */}
            {alertFilter === 'entrada' && filteredOpps.length === 0 && (
              <div className="card glass-panel" style={{ textAlign: 'center', padding: '50px 30px', color: 'var(--text-muted)' }}>
                <Activity size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 6, fontSize: '1rem' }}>Sem entradas ativas</h3>
                <p style={{ fontSize: '0.85rem' }}>O bot continua monitorando em segundo plano.</p>
              </div>
            )}

            {alertFilter === 'potencial' && allFixtures.filter(f => {
              const s = allStats[f.id];
              if (!s || (!s.hasTelemetry && !s.hasBridge)) return false;
              const hasOpp = filteredOpps.some(o => o.fixtureId === f.id);
              const thRef = activeMode === 'aggressive' ? 0.8 : activeMode === 'defensive' ? 1.4 : activeMode === 'funnel' ? 1.0 : 1.1;
              const hR = s.home.iim / thRef; const aR = s.away.iim / thRef;
              const vt = f.elapsed <= 85 && f.status !== 'HT';
              const og = f.goalsHome + f.goalsAway <= 4;
              return !hasOpp && vt && og && (
                (hR >= 0.7 && s.home.corners >= 2) || (aR >= 0.7 && s.away.corners >= 2) ||
                (s.home.iim + s.away.iim >= thRef * 1.2 && s.home.shotsOnGoal + s.away.shotsOnGoal >= 2)
              );
            }).length === 0 && (
              <div className="card glass-panel" style={{ textAlign: 'center', padding: '50px 30px', color: 'var(--text-muted)' }}>
                <Gauge size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 6, fontSize: '1rem' }}>Sem jogos esquentando</h3>
                <p style={{ fontSize: '0.85rem' }}>Nenhum jogo está perto de disparar um gatilho no momento.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}


