import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Activity, Zap, ShieldAlert, Shield,
  RefreshCw, CheckCircle, PlayCircle,
  Volume2, VolumeX, Bell, TrendingUp, Gauge,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { apiSports } from '../services/apiSports';
import { sportsmonks } from '../services/sportsmonks';
import { sofascore } from '../services/sofascore';
import type { Fixture, PreMatchDossier, TelemetrySnapshot } from '../services/apiSports';
import { supabase } from '../services/supabase';
import { getEnabledBookmakers } from '../config/bookmakers';
import { onBet365Data, findBet365Match, mergeStats, calculateEnrichedIIM, calculateDynamicAPM } from '../services/bet365Bridge';
import type { Bet365BridgePayload, Bet365MatchData } from '../services/bet365Bridge';

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
  return norm(url1) === norm(url2);
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

export default function Radar() {
  const [searchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'apm_pure';
  
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  
  // Advanced scanner and dossier states
  const [rawApiStats, setRawApiStats] = useState<Record<number, any>>({});
  const [allDossiers, setAllDossiers] = useState<Record<number, PreMatchDossier>>({});
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [minConfidence, setMinConfidence] = useState(65);
  const [showMatchesTable, setShowMatchesTable] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'all' | 'entrada' | 'potencial'>('all');
  
  // Premium filters
  const [marketFilter, setMarketFilter] = useState<'all' | 'corners' | 'goals'>('all');
  const [apmProfile, setApmProfile] = useState<'conservador' | 'medio' | 'arriscado'>('medio');
  
  // General status
  const [apiErrorReason, setApiErrorReason] = useState<'limit_reached' | 'invalid_key' | 'network_error' | null>(null);
  const [activeDataSource, setActiveDataSource] = useState<'sportsmonks' | 'sofascore' | 'apisports_real' | 'apisports_simulated'>('apisports_real');
  const [isLockdown, setIsLockdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(25); // 25s scanner refresh
  // Gotten opportunities tracking
  const [gottenOppIds, setGottenOppIds] = useState<Set<string>>(new Set());
  const [defaultStake, setDefaultStake] = useState<number>(() => {
    const saved = localStorage.getItem('trade_default_stake');
    return saved ? Number(saved) : 200;
  });

  // Bet365 Bridge state
  const [bet365Bridge, setBet365Bridge] = useState<Bet365BridgePayload | null>(null);
  const bet365DataRef = useRef<Bet365MatchData[]>([]);

  // 🚀 Gerenciador de Links Multijogos
  const [showLinkManager, setShowLinkManager] = useState(false);
  const [linkText, setLinkText] = useState(() => localStorage.getItem('bet365_multilinks') || '');
  
  // 🔍 Estado para linha expandida na tabela do radar (Dashboard Detalhado)
  const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null);

  // 📥 Central de Jogos Manuais (Contorno de limite da API)
  const [manualFixtures, setManualFixtures] = useState<Fixture[]>(() => {
    try {
      const saved = localStorage.getItem('bet365_manual_fixtures');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('bet365_manual_fixtures', JSON.stringify(manualFixtures));
  }, [manualFixtures]);

  // Concatena fixtures da API com as criadas manualmente
  const allFixtures = useMemo(() => {
    return [...fixtures, ...manualFixtures];
  }, [fixtures, manualFixtures]);

  // 🔄 Sincronizar dados da Bridge para atualizar os nomes dos times manuais e o tempo decorrido
  useEffect(() => {
    if (!bet365Bridge || !bet365Bridge.connected || bet365Bridge.matches.length === 0 || manualFixtures.length === 0) return;

    let updated = false;
    const nextManual = manualFixtures.map(f => {
      const match = bet365Bridge.matches.find(m => matchUrls(m.matchUrl, (f as any).matchUrl));
      if (match) {
        if (f.homeTeam.name.includes('Aguardando') || f.homeTeam.name !== match.homeTeam || f.elapsed !== (match.elapsed || 0)) {
          updated = true;
          return {
            ...f,
            homeTeam: { ...f.homeTeam, name: match.homeTeam },
            awayTeam: { ...f.awayTeam, name: match.awayTeam },
            elapsed: Number(match.elapsed) || f.elapsed
          };
        }
      }
      return f;
    });

    if (updated) {
      setManualFixtures(nextManual);
    }
  }, [bet365Bridge, manualFixtures]);

  // Sincronizar links no localStorage
  useEffect(() => {
    localStorage.setItem('bet365_multilinks', linkText);
  }, [linkText]);

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
          const elapsed = fixture.elapsed || 1;
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
          const elapsed = fixture.elapsed || 1;
          const hasBet365 = (bet365Match.home?.dangerousAttacks || 0) > 0 || 
                            (bet365Match.away?.dangerousAttacks || 0) > 0;
          merged.home.iim = calculateEnrichedIIM(merged.home, elapsed, hasBet365);
          merged.away.iim = calculateEnrichedIIM(merged.away, elapsed, hasBet365);
          // Marcar que tem dados da bridge mesmo sem telemetria API
          merged.hasTelemetry = false;
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
    const elapsed = fixture?.elapsed || 0;

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
    const stats = allStats[fixtureId];
    if (!stats) return 0;
    const teamStats = isHome ? stats.home : stats.away;
    
    const ap10 = getAttacksInWindow(fixtureId, 10, isHome);
    const ap5 = getAttacksInWindow(fixtureId, 5, isHome);
    const ap3 = getAttacksInWindow(fixtureId, 3, isHome);
    
    const iia = (ap10 * 0.20) + (ap5 * 0.30) + (ap3 * 0.50);
    const fa = ap5 > 0 ? (ap3 / ap5) : 1.0;
    const iap = iia * fa;
    
    const niap = Math.min(10, iap);
    const ncg = Math.min(10, ((teamStats.shotsOnGoal || 0) / 8) * 10);
    const nesc = Math.min(10, teamStats.corners || 0);
    const nft = Math.min(10, ((teamStats.totalShots || 0) / 15) * 10);
    const ncv = (teamStats.redCards || 0) === 0 ? 10 : 0;
    const npos = (Number(teamStats.possession) || 50) / 10;
    const nca = Math.min(10, (teamStats.yellowCards || 0) * 2);
    
    const score = (niap * 0.40) + (ncg * 0.25) + (nesc * 0.15) + (nft * 0.10) + (ncv * 0.05) + (npos * 0.03) + (nca * 0.02);
    return Math.round(score * 100) / 100;
  }, [allStats, getAttacksInWindow]);

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

    const stakeVal = Number(localStorage.getItem('trade_default_stake')) || defaultStake;
    const matchName = `${opp.match.homeTeam.name} x ${opp.match.awayTeam.name}`;
    
    const newTradeData = {
      match_name: matchName,
      market: opp.strategyName,
      odd: 1.80,
      stake: stakeVal,
      status: 'PENDING',
      profit_loss: 0
    };

    try {
      const { error } = await supabase.from('trades').insert([newTradeData]);
      if (error) throw error;
      console.log("Trade persisted to Supabase cloud sync!");
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

      const elapsed = fixture.elapsed;
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

      let cornerThreshold = 7.0; // Clássico default
      if (activeMode === 'arriscado') {
        cornerThreshold = 6.0;
      } else if (activeMode === 'conservador') {
        cornerThreshold = 8.0;
      }

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
        
        const iia = (ap10 * 0.20) + (ap5 * 0.30) + (ap3 * 0.50);
        const fa = ap5 > 0 ? (ap3 / ap5) : 1.0;
        const iap = iia * fa;
        
        const niap = Math.min(10, iap);
        const ncg = Math.min(10, ((teamStats.shotsOnGoal || 0) / 8) * 10);
        const nesc = Math.min(10, teamStats.corners || 0);
        const nft = Math.min(10, ((teamStats.totalShots || 0) / 15) * 10);
        const ncv = (teamStats.redCards || 0) === 0 ? 10 : 0;
        const npos = (Number(teamStats.possession) || 50) / 10;
        const nca = Math.min(10, (teamStats.yellowCards || 0) * 2);
        
        const score = (niap * 0.40) + (ncg * 0.25) + (nesc * 0.15) + (nft * 0.10) + (ncv * 0.05) + (npos * 0.03) + (nca * 0.02);
        return Math.round(score * 100) / 100;
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

      const homeScoreFinal = getScoreFinalForSide(true);
      const awayScoreFinal = getScoreFinalForSide(false);
      
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

      if (isCornerWindow) {
        // Mandante
        if (homeScoreFinal >= cornerThreshold) {
          activeOpps.push({
            id: `${fixture.id}-canto-home`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.homeTeam.name,
            confidence: homeQualityPct,
            details: `Score Final: ${homeScoreFinal} | Qualidade: ${homeQualityPct}% | IIA: ${((getAttacksInWindow(10, true)*0.2) + (getAttacksInWindow(5, true)*0.3) + (getAttacksInWindow(3, true)*0.5)).toFixed(2)} | FA: ${(getAttacksInWindow(5, true) > 0 ? getAttacksInWindow(3, true)/getAttacksInWindow(5, true) : 1.0).toFixed(2)} | Cantos: ${stats.home.corners} | Chutes Gol: ${stats.home.shotsOnGoal}${homePLS !== null ? ` | PLS: ${homePLS}` : ''}`,
            suggestion: `Entrar em "Canto Limite" acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }

        // Visitante
        if (awayScoreFinal >= cornerThreshold) {
          activeOpps.push({
            id: `${fixture.id}-canto-away`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.awayTeam.name,
            confidence: awayQualityPct,
            details: `Score Final: ${awayScoreFinal} | Qualidade: ${awayQualityPct}% | IIA: ${((getAttacksInWindow(10, false)*0.2) + (getAttacksInWindow(5, false)*0.3) + (getAttacksInWindow(3, false)*0.5)).toFixed(2)} | FA: ${(getAttacksInWindow(5, false) > 0 ? getAttacksInWindow(3, false)/getAttacksInWindow(5, false) : 1.0).toFixed(2)} | Cantos: ${stats.away.corners} | Chutes Gol: ${stats.away.shotsOnGoal}${awayPLS !== null ? ` | PLS: ${awayPLS}` : ''}`,
            suggestion: `Entrar em "Canto Limite" acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // ⚽ ESTRATÉGIA 2: OVER 0.5 GOLS HT
      // Critérios: IIM combinado + Chutes ao Gol + Placar 0x0 (todos reais)
      // ═══════════════════════════════════════════════════════════════
      const isTimeOverHT = elapsed >= htMinElapsed && elapsed <= htMaxElapsed && scoreHome === 0 && scoreAway === 0;
      if (isTimeOverHT) {
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
      if (isTimeSecondHalf && fixture.status !== 'HT') {
        
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
        
        if (isFunilWindow) {
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

    // Sound alerts triggers
    activeOpps.forEach(opp => {
      if (opp.confidence >= minConfidence) {
        if (!alertedIdsRef.current.has(opp.id)) {
          alertedIdsRef.current.add(opp.id);
          if (soundEnabled && !playedSoundThisTick) {
            playAlertSound();
            playedSoundThisTick = true;
          }
        }
      }
    });

    setOpportunities(activeOpps);
  }, [allFixtures, allStats, allDossiers, minConfidence, soundEnabled, activeMode]);

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

  // ─── Bet365 Bridge Listener ───
  useEffect(() => {
    const cleanup = onBet365Data((payload) => {
      setBet365Bridge(payload);
      bet365DataRef.current = payload.matches;
    });

    return cleanup;
  }, []);

  // Filtered active opportunities by confidence and granular market preference
  const filteredOpps = opportunities
    .filter(o => o.confidence >= minConfidence)
    .filter(opp => {
      if (marketFilter === 'corners') {
        return opp.strategyName === 'Canto Limite';
      }
      if (marketFilter === 'goals') {
        return opp.strategyName === 'Over 0.5 Gols HT' || opp.strategyName === 'Virada do Favorito' || opp.strategyName === 'Funil';
      }
      return true;
    });

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

      {/* Header Area */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Radar de Oportunidades <Activity size={24} className="pulse-indicator" color="var(--status-green)" />
            </h1>
            
            {/* Status Connection Badges */}
            {activeDataSource === 'sportsmonks' && (
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', border: '1px solid rgba(124, 58, 237, 0.2)', fontSize: '0.75rem', padding: '4px 8px', borderRadius: 4, fontWeight: 700 }}>
                <CheckCircle size={12} /> 📡 SPORTSMONKS LIVE (PREMIUM)
              </span>
            )}
            {activeDataSource === 'sofascore' && (
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', fontSize: '0.75rem', padding: '4px 8px', borderRadius: 4, fontWeight: 700 }}>
                <CheckCircle size={12} /> 📡 SOFASCORE LIVE (100% REAL)
              </span>
            )}
            {activeDataSource === 'apisports_real' && (
              <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle size={12} /> 📡 API-SPORTS LIVE (ATIVO)
              </span>
            )}
            {bet365Bridge?.connected && (
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.7rem', padding: '3px 8px', borderRadius: 4, fontWeight: 800, animation: 'pulse 2s ease-in-out infinite' }}>
                🔗 BET365 BRIDGE ({bet365Bridge.matchCount} jogos)
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Mapeamento e leitura automatizada do mercado de trading de futebol.</p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={loading ? 'pulse-indicator' : ''} />
            Próxima varredura em {countdown}s
          </span>
        </div>
      </div>

      {/* 🚀 GERENCIADOR DE LINKS MULTIJOGOS - COLLAPSIBLE PREMIUM CARD */}
      <div className="card glass-panel" style={{
        marginBottom: 20,
        padding: '16px 24px',
        background: 'rgba(255, 255, 255, 0.75)',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        transition: 'all 0.3s ease'
      }}>
        <div 
          onClick={() => setShowLinkManager(!showLinkManager)}
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={18} color="var(--accent-primary)" className={bet365Bridge?.connected ? 'pulse-indicator' : ''} />
            <div>
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                Gerenciador de Links Multijogos (Bet365 Bridge)
              </span>
              <span style={{ 
                marginLeft: 12, 
                fontSize: '0.75rem', 
                background: 'rgba(16, 185, 129, 0.15)', 
                color: '#10b981', 
                padding: '2px 8px', 
                borderRadius: 4, 
                fontWeight: 700 
              }}>
                NOVO
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {showLinkManager ? 'Ocultar Painel' : 'Configurar Varredura Multi-Abas'}
            </span>
            {showLinkManager ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>

        {showLinkManager && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
              Cole abaixo os links dos jogos ao vivo da Bet365 que deseja monitorar. Ao adicioná-los ao Radar, eles aparecerão instantaneamente na sua lista (contornando os limites de cota da API). Conforme você abrir os jogos correspondentes no seu navegador, a extensão <strong>Bet365 Bridge</strong> enviará os dados em tempo real (zero delay), sincronizando automaticamente os nomes das equipes, o tempo e as estatísticas!
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Cole as URLs da Bet365 aqui, uma por linha. Ex:&#10;https://www.bet365.com/#/IP/B1&#10;https://www.bet365.com/#/IP/B2"
                style={{
                  width: '100%',
                  height: 100,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255, 255, 255, 0.5)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    const urls = linkText
                      .split('\n')
                      .map(line => line.trim())
                      .filter(line => line.startsWith('http://') || line.startsWith('https://'));

                    if (urls.length === 0) return;

                    const newManualFixtures: Fixture[] = urls.map((url, index) => {
                      let hash = 0;
                      for (let i = 0; i < url.length; i++) {
                        hash = (hash << 5) - hash + url.charCodeAt(i);
                        hash |= 0;
                      }
                      const id = -Math.abs(hash + index);

                      return {
                        id: id,
                        status: '1H',
                        elapsed: 0,
                        homeTeam: { name: 'Jogo Manual — Aguardando Bridge...' },
                        awayTeam: { name: 'Aguardando Bridge...' },
                        goalsHome: 0,
                        goalsAway: 0,
                        leagueName: 'Jogo Manual (Bet365)',
                        matchUrl: url
                      } as any;
                    });

                    // Prevenir duplicatas se a mesma URL já foi adicionada
                    setManualFixtures(prev => {
                      const existingUrls = prev.map(f => (f as any).matchUrl);
                      const filteredNew = newManualFixtures.filter(f => !existingUrls.includes((f as any).matchUrl));
                      return [...prev, ...filteredNew];
                    });

                    // Limpar a caixa de texto após adicionar
                    setLinkText('');
                  }}
                  disabled={!linkText.trim()}
                  className="btn btn-primary"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 700
                  }}
                >
                  📥 Adicionar URLs como Jogos no Radar ({linkText.split('\n').filter(l => l.trim().startsWith('http')).length} links)
                </button>

                <button
                  onClick={() => {
                    if (window.confirm("Deseja mesmo remover TODOS os jogos manuais do Radar?")) {
                      setManualFixtures([]);
                    }
                  }}
                  disabled={manualFixtures.length === 0}
                  className="btn btn-outline"
                  style={{ 
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    borderColor: '#ef4444',
                    color: '#ef4444'
                  }}
                >
                  🗑️ Limpar Jogos Manuais
                </button>

                <button
                  onClick={() => setLinkText('')}
                  disabled={!linkText.trim()}
                  className="btn btn-outline"
                  style={{ 
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 700
                  }}
                >
                  Clean Links
                </button>
              </div>

              {/* Status Indicator */}
              <div style={{ 
                marginTop: 8, 
                padding: 12, 
                background: 'rgba(59, 130, 246, 0.05)', 
                border: '1px solid rgba(59, 130, 246, 0.15)', 
                borderRadius: 8,
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span>
                  <strong>Bypass de API Ativo:</strong> Você pode adicionar partidas manuais colando os links da Bet365 acima. Para cada partida inserida, clique no link de atalho ao lado do nome do time para abrir a aba do jogo correspondente no navegador e iniciar a captação de telemetria da extensão.
                </span>
                <span style={{ fontWeight: 800, color: 'var(--status-green)' }}>
                  Ponte Ativa 🔗
                </span>
              </div>
            </div>
          </div>
        )}
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

        {/* Sensibilidade APM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sensibilidade APM:</span>
          <div style={{ display: 'inline-flex', background: 'var(--bg-elevated)', padding: 3, borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <button 
              onClick={() => setApmProfile('conservador')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: apmProfile === 'conservador' ? '#fbbf24' : 'transparent',
                color: apmProfile === 'conservador' ? '#1f2937' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Conservador
            </button>
            <button 
              onClick={() => setApmProfile('medio')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: apmProfile === 'medio' ? 'var(--accent-primary)' : 'transparent',
                color: apmProfile === 'medio' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Médio
            </button>
            <button 
              onClick={() => setApmProfile('arriscado')}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                background: apmProfile === 'arriscado' ? '#ef4444' : 'transparent',
                color: apmProfile === 'arriscado' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              Arriscado
            </button>
          </div>
        </div>
      </div>

      {/* ⚠️ Alerta de Limite ou Erro da API Real */}
      {apiErrorReason && (
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
              {apiErrorReason === 'limit_reached' ? 'Meta Limite Diária de Requisições da API Atingida!' : 'Erro de Conexão com a API!'}
            </h4>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {apiErrorReason === 'limit_reached' ? (
                <span>
                  A chave integrada atingiu o <strong>limite diário de chamadas gratuitas da API-Sports</strong>. Verifique o limite da sua conta de assinatura ou faça upgrade em <a href="https://dashboard.api-sports.io/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>dashboard.api-sports.io</a>.
                </span>
              ) : (
                <span>
                  Ocorreu um erro ao validar a chave de API integrada ou houve falha na rede de telemetria. Certifique-se de que sua conexão de internet está ativa e que a API Key integrada está ativa no painel do provedor de dados.
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* 📡 MONITOR DO SCANNER (Controles Gerais) */}
      <div className="card glass-panel" style={{ 
        marginBottom: 24, 
        padding: '20px 24px', 
        background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(255,255,255,1) 100%)',
        border: '1px solid rgba(30,58,138,0.08)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          
          {/* Status Lote */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="pulse-indicator" style={{ width: 14, height: 14, background: 'var(--status-green)' }}></span>
              <span style={{ position: 'absolute', width: 24, height: 24, border: '2px solid var(--status-green)', borderRadius: '50%', animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}></span>
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Varredura de IA Ativa</span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
                Lendo {allFixtures.length} {allFixtures.length === 1 ? 'partida' : 'partidas'} ao vivo com Crossover Pré-Live...
              </h3>
            </div>
          </div>

          {/* Filtros e Sons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            
            {/* Som Alertas */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Alerta Sonoro:</span>
              <button 
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="btn btn-outline"
                style={{ 
                  padding: '8px 12px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8,
                  borderColor: soundEnabled ? 'var(--status-green)' : 'var(--border-color)',
                  backgroundColor: soundEnabled ? 'var(--status-green-glow)' : 'transparent',
                  color: soundEnabled ? 'var(--status-green)' : 'var(--text-primary)'
                }}
              >
                {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{soundEnabled ? 'ATIVADO' : 'MUTADO'}</span>
              </button>
            </div>

            {/* Confiança Mínima Filtro */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Confiança Mínima:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input 
                  type="range" 
                  min="40" 
                  max="90" 
                  value={minConfidence} 
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  style={{ width: 100, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                />
                <span className="badge badge-green" style={{ fontSize: '0.85rem', padding: '4px 8px', width: 44, textAlign: 'center' }}>
                  {minConfidence}%
                </span>
              </div>
            </div>

          </div>

        </div>
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
            {allFixtures.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600 }}>Nenhuma partida ao vivo sob varredura no momento.</p>
              </div>
            ) : (
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
                  {allFixtures
                    .map(f => {
                    const stats = allStats[f.id];
                    const dossier = allDossiers[f.id];
                    
                    // Check if this fixture has an active opportunity matching the criteria
                    const hasOpp = opportunities.some(opp => opp.fixtureId === f.id && opp.confidence >= minConfidence);
                    
                    // 🔥 DETECÇÃO DE POTENCIAL & GATILHO BASEADOS NO SCORE FINAL
                    const triggerThreshold = activeMode === 'arriscado' ? 6.0 : activeMode === 'conservador' ? 8.0 : 7.0;
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
                              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                {expandedFixtureId === f.id ? (
                                  <ChevronUp size={16} style={{ color: 'var(--accent-primary)' }} />
                                ) : (
                                  <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                                )}
                              </div>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span>{f.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {f.awayTeam.name}</span>
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
                              {f.goalsHome} - {f.goalsAway}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 2 }}>
                              <span className="pulse-indicator" style={{ background: 'var(--status-green)', width: 6, height: 6 }}></span>
                              {f.elapsed}' Min
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
                                  f.elapsed || 0,
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
                                const homeIia = (homeAp10 * 0.20) + (homeAp5 * 0.30) + (homeAp3 * 0.50);
                                const homeFa = homeAp5 > 0 ? (homeAp3 / homeAp5) : 1.0;
                                const homeIap = homeIia * homeFa;

                                const homeNiap = Math.min(10, homeIap);
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
                                const awayIia = (awayAp10 * 0.20) + (awayAp5 * 0.30) + (awayAp3 * 0.50);
                                const awayFa = awayAp5 > 0 ? (awayAp3 / awayAp5) : 1.0;
                                const awayIap = awayIia * awayFa;

                                const awayNiap = Math.min(10, awayIap);
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
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Zap size={14} /> Raio-X de Finalizações
                                        </h4>
                                        
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>No Alvo</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '4px', color: 'var(--status-green)' }}>
                                              {homeShotsOn} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsOn}
                                            </div>
                                          </div>
                                          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Para Fora</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '4px' }}>
                                              {homeShotsOff} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsOff}
                                            </div>
                                          </div>
                                          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Bloqueados</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '4px' }}>
                                              {homeShotsBlocked} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsBlocked}
                                            </div>
                                          </div>
                                          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Dentro Área</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '4px', color: '#10b981' }}>
                                              {homeShotsInside} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsInside}
                                            </div>
                                          </div>
                                        </div>
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

                                    {/* 🏆 ANÁLISE PRÉ-LIVE (PLS) & SCORE DE CANTOS */}
                                    <div style={{ 
                                      marginTop: '24px', 
                                      paddingTop: '20px', 
                                      borderTop: '1px solid var(--border-color)',
                                      display: 'grid', 
                                      gridTemplateColumns: '1fr 1.2fr', 
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
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>40%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNiap * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNiap * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Chutes no Gol Normalizados (NCG)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>25%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcg * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcg * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Escanteios Normalizados (NESC)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>15%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNesc * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNesc * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Finalizações Normalizadas (NFT)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>10%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNft * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNft * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Vermelhos Normalizados (NCV)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>5%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNcv * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNcv * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Posse de Bola Normalizada (NPOS)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>3%</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(homeNpos * 10) / 10}</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700 }}>{Math.round(awayNpos * 10) / 10}</td>
                                              </tr>
                                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>Cartões Amarelos Normalizados (NCA)</td>
                                                <td style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--text-muted)' }}>2%</td>
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

                                    {/* ⚡ APM Dinâmico & Pressão Recente */}
                                    {stats.hasBridge && (
                                      <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-primary)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <Zap size={14} color="var(--accent-primary)" /> ⚡ APM Dinâmico & Pressão Recente
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'start' }}>
                                          {/* Left side: Comparative Table */}
                                          <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '16px', overflow: 'hidden' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                              <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                  <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 700 }}>Janela de Tempo</th>
                                                  <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--status-green)', fontWeight: 800 }}>{f.homeTeam.name}</th>
                                                  <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--status-yellow)', fontWeight: 800 }}>{f.awayTeam.name}</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                  <td style={{ padding: '8px', fontWeight: 600 }}>APM Global (Ataques Perigosos/min)</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700 }}>{apmData.home.apmGlobal}</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700 }}>{apmData.away.apmGlobal}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                  <td style={{ padding: '8px', fontWeight: 600 }}>APM 10 Minutos (Pressão Média)</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.home.apm10 >= 1.0 ? '#ef4444' : 'inherit' }}>{apmData.home.apm10}</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.away.apm10 >= 1.0 ? '#ef4444' : 'inherit' }}>{apmData.away.apm10}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px dashed var(--border-color)' }}>
                                                  <td style={{ padding: '8px', fontWeight: 600 }}>APM 5 Minutos (Pressão Alta)</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.home.apm5 >= 1.2 ? '#ef4444' : 'inherit' }}>{apmData.home.apm5}</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.away.apm5 >= 1.2 ? '#ef4444' : 'inherit' }}>{apmData.away.apm5}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                  <td style={{ padding: '8px', fontWeight: 600 }}>APM 3 Minutos (Pressão Ultra)</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.home.apm3 >= 1.5 ? '#ef4444' : 'inherit' }}>{apmData.home.apm3}</td>
                                                  <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: apmData.away.apm3 >= 1.5 ? '#ef4444' : 'inherit' }}>{apmData.away.apm3}</td>
                                                </tr>
                                                {/* Fator de Aceleração */}
                                                <tr>
                                                  <td style={{ padding: '8px', fontWeight: 700 }}>Fator de Aceleração (Velocidade)</td>
                                                  <td style={{ textAlign: 'center', padding: '8px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                      <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{apmData.home.accelerationFactor}x</span>
                                                      {(() => {
                                                        const factor = apmData.home.accelerationFactor;
                                                        let label = 'Abaixo'; let color = 'var(--text-muted)'; let bg = 'var(--bg-elevated)';
                                                        if (apmProfile === 'conservador') {
                                                          if (factor >= 1.5) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 1.2) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 1.0) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        } else if (apmProfile === 'medio') {
                                                          if (factor >= 1.2) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 1.0) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 0.8) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        } else {
                                                          if (factor >= 1.0) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 0.8) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 0.6) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        }
                                                        return <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '2px 6px', borderRadius: '4px', color, backgroundColor: bg, border: `1px solid ${color}33`, textTransform: 'uppercase' }}>{label}</span>;
                                                      })()}
                                                    </div>
                                                  </td>
                                                  <td style={{ textAlign: 'center', padding: '8px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                      <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{apmData.away.accelerationFactor}x</span>
                                                      {(() => {
                                                        const factor = apmData.away.accelerationFactor;
                                                        let label = 'Abaixo'; let color = 'var(--text-muted)'; let bg = 'var(--bg-elevated)';
                                                        if (apmProfile === 'conservador') {
                                                          if (factor >= 1.5) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 1.2) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 1.0) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        } else if (apmProfile === 'medio') {
                                                          if (factor >= 1.2) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 1.0) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 0.8) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        } else {
                                                          if (factor >= 1.0) { label = 'ACELERAÇÃO 🔥'; color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; }
                                                          else if (factor >= 0.8) { label = 'PRESSÃO ⚡'; color = '#f59e0b'; bg = 'rgba(245, 158, 11, 0.15)'; }
                                                          else if (factor >= 0.6) { label = 'NORMAL ✅'; color = '#10b981'; bg = 'rgba(16, 185, 129, 0.15)'; }
                                                        }
                                                        return <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '2px 6px', borderRadius: '4px', color, backgroundColor: bg, border: `1px solid ${color}33`, textTransform: 'uppercase' }}>{label}</span>;
                                                      })()}
                                                    </div>
                                                  </td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          </div>
                                          {/* Right side: IPR Progress Bars */}
                                          <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', justifyContent: 'center', height: '100%', boxSizing: 'border-box' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '4px' }}>
                                              🔥 IPR — Índice de Pressão Recente
                                            </div>
                                            {/* Home IPR */}
                                            <div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '6px' }}>
                                                <span style={{ color: 'var(--status-green)' }}>{f.homeTeam.name}</span>
                                                <span style={{ fontWeight: 800 }}>{apmData.home.ipr} <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>IPR</span></span>
                                              </div>
                                              <div style={{ height: '8px', background: 'var(--bg-surface)', borderRadius: '4px', display: 'flex', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                {(() => {
                                                  const ipr = apmData.home.ipr;
                                                  const widthPct = Math.min(100, (ipr / 2.5) * 100);
                                                  let bg = 'linear-gradient(90deg, #10b981, #059669)';
                                                  if (ipr >= 1.5) bg = 'linear-gradient(90deg, #f59e0b, #ef4444)';
                                                  else if (ipr >= 1.0) bg = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
                                                  return <div style={{ width: `${widthPct}%`, background: bg, height: '100%', borderRadius: '4px', transition: 'width 0.3s ease' }}></div>;
                                                })()}
                                              </div>
                                            </div>
                                            {/* Away IPR */}
                                            <div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '6px' }}>
                                                <span style={{ color: 'var(--status-yellow)' }}>{f.awayTeam.name}</span>
                                                <span style={{ fontWeight: 800 }}>{apmData.away.ipr} <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>IPR</span></span>
                                              </div>
                                              <div style={{ height: '8px', background: 'var(--bg-surface)', borderRadius: '4px', display: 'flex', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                {(() => {
                                                  const ipr = apmData.away.ipr;
                                                  const widthPct = Math.min(100, (ipr / 2.5) * 100);
                                                  let bg = 'linear-gradient(90deg, #10b981, #059669)';
                                                  if (ipr >= 1.5) bg = 'linear-gradient(90deg, #f59e0b, #ef4444)';
                                                  else if (ipr >= 1.0) bg = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
                                                  return <div style={{ width: `${widthPct}%`, background: bg, height: '100%', borderRadius: '4px', transition: 'width 0.3s ease' }}></div>;
                                                })()}
                                              </div>
                                            </div>
                                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                              💡 <strong>IPR (Recent Pressure Index):</strong> Analisa a pressão de ataques perigosos nas janelas móveis de 10m (50% peso), 5m (30% peso) e 3m (20% peso). Valores acima de <strong>1.0</strong> indicam forte pressão recente, e acima de <strong>1.5</strong> indicam pressão extrema imediata de ataque!
                                            </div>
                                          </div>
                                        </div>
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
            )}
          </div>
        )}
      </div>

      {/* Grid Duplo do Scanner */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'start' }}>
        
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
                Nenhuma partida atende às diretrizes configuradas (confiança ≥ {minConfidence}%). O bot continuará lendo o mercado a cada {countdown}s em segundo plano.
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
                    const triggerThreshold = activeMode === 'arriscado' ? 6.0 : activeMode === 'conservador' ? 8.0 : 7.0;
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
                const triggerThreshold = activeMode === 'arriscado' ? 6.0 : activeMode === 'conservador' ? 8.0 : 7.0;
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
                        {f.elapsed}'
                      </div>
                    </div>

                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {f.homeTeam.name} <span style={{ color: 'var(--text-muted)' }}>{f.goalsHome}-{f.goalsAway}</span> {f.awayTeam.name}
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
                <p style={{ fontSize: '0.85rem' }}>O bot continua monitorando. Confiança mínima: {minConfidence}%</p>
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


