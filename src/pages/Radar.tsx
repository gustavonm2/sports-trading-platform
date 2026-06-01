import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Activity, Zap, ShieldAlert,
  RefreshCw, CheckCircle, PlayCircle,
  Volume2, VolumeX, Bell, TrendingUp, Gauge,
  ChevronDown, ChevronUp, Filter
} from 'lucide-react';
import { apiSports } from '../services/apiSports';
import { sportsmonks } from '../services/sportsmonks';
import { sofascore } from '../services/sofascore';
import type { Fixture, MatchStats, PreMatchDossier } from '../services/apiSports';
import { supabase } from '../services/supabase';
import { getEnabledBookmakers } from '../config/bookmakers';
import { onBet365Data, findBet365Match, mergeStats, calculateEnrichedIIM } from '../services/bet365Bridge';
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
  const [allStats, setAllStats] = useState<Record<number, MatchStats>>({});
  const [allDossiers, setAllDossiers] = useState<Record<number, PreMatchDossier>>({});
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [minConfidence, setMinConfidence] = useState(65);
  const [showMatchesTable, setShowMatchesTable] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'all' | 'entrada' | 'potencial'>('all');
  
  // Premium filters
  const [marketFilter, setMarketFilter] = useState<'all' | 'corners' | 'goals'>('all');
  
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
              setAllStats(prevStats => ({ ...prevStats, [fixture.id]: statsRes.stats }));
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
        setAllStats(finalStats);
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
          setAllStats(sfResult.statsMap || {});
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
    if (fixtures.length === 0) {
      setSelectedFixture(null);
      return;
    }

    // Auto-select first game initially
    if (!selectedFixture) {
      setSelectedFixture(fixtures[0]);
      return;
    }

    const updated = fixtures.find(f => f.id === selectedFixture.id);
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
      setSelectedFixture(fixtures[0]);
    }
  }, [fixtures, selectedFixture]);

  // Rule processing engine with Crossover logic matching live pressure with historical Pre-Live parameters
  useEffect(() => {
    const activeOpps: Opportunity[] = [];
    let playedSoundThisTick = false;

    fixtures.forEach(fixture => {
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
      let cantoMinCorners = 3;          // Escanteios mínimos
      let cantoMinElapsedFirst = 37;    // Janela 1°T início
      let cantoMaxElapsedFirst = 45;    // Janela 1°T fim
      let cantoMinElapsedSecond = 80;   // Janela 2°T início
      let cantoMaxElapsedSecond = 90;   // Janela 2°T fim
      
      let htMinElapsed = 12;            // Over 0.5 HT: minuto mínimo
      let htMaxElapsed = 32;            // Over 0.5 HT: minuto máximo
      let htMinCombinedIIM = 1.4;       // Over 0.5 HT: IIM combinado mínimo
      let htMinShots = 3;               // Over 0.5 HT: chutes ao gol mínimo
      
      let backFavMinIIM = 1.2;          // Virada: IIM mínimo
      let backFavMinPossession = 60;    // Virada: posse mínima
      let backFavMinElapsed = 50;       // Virada: minuto mínimo

      if (activeMode === 'apm_pure') {
        iimThreshold = 1.2;
        cantoMinCorners = 4;
        htMinElapsed = 10; htMaxElapsed = 35;
        htMinCombinedIIM = 1.5; htMinShots = 4;
        backFavMinIIM = 1.25; backFavMinPossession = 60; backFavMinElapsed = 45;
      } else if (activeMode === 'aggressive') {
        iimThreshold = 0.8;
        cantoMinCorners = 2;
        cantoMinElapsedFirst = 33; cantoMinElapsedSecond = 72;
        htMinElapsed = 8; htMaxElapsed = 38;
        htMinCombinedIIM = 1.0; htMinShots = 2;
        backFavMinIIM = 0.9; backFavMinPossession = 50; backFavMinElapsed = 45;
      } else if (activeMode === 'conservative') {
        iimThreshold = 1.2;
        htMinCombinedIIM = 1.4; htMinShots = 3;
        backFavMinIIM = 1.2; backFavMinPossession = 60; backFavMinElapsed = 50;
      } else if (activeMode === 'defensive') {
        iimThreshold = 1.4;
        cantoMinCorners = 4;
        cantoMinElapsedFirst = 38; cantoMinElapsedSecond = 82;
        htMinElapsed = 15; htMaxElapsed = 30;
        htMinCombinedIIM = 1.6; htMinShots = 4;
        backFavMinIIM = 1.4; backFavMinPossession = 65; backFavMinElapsed = 55;
      } else if (activeMode === 'funnel') {
        // Técnica do Funil: pressão nos minutos finais de cada tempo
        iimThreshold = 1.0;
        cantoMinCorners = 2;
        cantoMinElapsedFirst = 38; cantoMaxElapsedFirst = 45;
        cantoMinElapsedSecond = 85; cantoMaxElapsedSecond = 90;
        htMinElapsed = 38; htMaxElapsed = 45;
        htMinCombinedIIM = 1.2; htMinShots = 2;
        backFavMinIIM = 1.0; backFavMinPossession = 50; backFavMinElapsed = 85;
      }

      // ═══════════════════════════════════════════════════════════════
      // 🎯 ESTRATÉGIA 1: CANTO LIMITE
      // Critérios: IIM + Escanteios + Chutes ao Gol (todos dados reais)
      // ═══════════════════════════════════════════════════════════════
      const isTimeCanto = (elapsed >= cantoMinElapsedFirst && elapsed <= cantoMaxElapsedFirst) || 
                          (elapsed >= cantoMinElapsedSecond && elapsed <= cantoMaxElapsedSecond);
      if (isTimeCanto && fixture.status !== 'HT') {
        
        // Avalia pressão do Mandante (APENAS dados reais)
        const homeHasPressure = stats.home.iim >= iimThreshold && stats.home.corners >= cantoMinCorners;
        if (homeHasPressure) {
          let confidence = 60 
            + Math.floor((stats.home.iim - iimThreshold) * 110)  // Bônus IIM
            + (stats.home.corners * 2)                            // Bônus escanteios
            + (stats.home.shotsOnGoal * 3)                        // Bônus chutes ao gol
            + (stats.home.shotsInsideBox * 1);                    // Bônus chutes dentro da área
          
          // Bônus Dossiê: APENAS dados reais da API (probabilidade de vitória)
          let dossierBonusDetails = '';
          if (dossier && dossier.motivationHome >= 60) {
            confidence += 5;
            dossierBonusDetails += ` | Win%: ${dossier.motivationHome}% (+5%)`;
          }
          // Bônus: média histórica de gols alta
          if (dossier && (dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway) >= 3.0) {
            confidence += 5;
            dossierBonusDetails += ` | Média gols alta: ${(dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway).toFixed(1)} (+5%)`;
          }

          confidence = Math.min(100, confidence);

          activeOpps.push({
            id: `${fixture.id}-canto-home`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.homeTeam.name,
            confidence,
            details: `IIM: ${stats.home.iim} | Cantos: ${stats.home.corners} | Chutes Gol: ${stats.home.shotsOnGoal} | Total Chutes: ${stats.home.totalShots} | Dentro Área: ${stats.home.shotsInsideBox}${dossierBonusDetails}`,
            suggestion: `Entrar em "Canto Limite" acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
        
        // Avalia pressão do Visitante
        const awayHasPressure = stats.away.iim >= iimThreshold && stats.away.corners >= cantoMinCorners;
        if (awayHasPressure) {
          let confidence = 60 
            + Math.floor((stats.away.iim - iimThreshold) * 110)
            + (stats.away.corners * 2)
            + (stats.away.shotsOnGoal * 3)
            + (stats.away.shotsInsideBox * 1);
          
          let dossierBonusDetails = '';
          if (dossier && dossier.motivationAway >= 60) {
            confidence += 5;
            dossierBonusDetails += ` | Win%: ${dossier.motivationAway}% (+5%)`;
          }
          if (dossier && (dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway) >= 3.0) {
            confidence += 5;
            dossierBonusDetails += ` | Média gols alta (+5%)`;
          }

          confidence = Math.min(100, confidence);

          activeOpps.push({
            id: `${fixture.id}-canto-away`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.awayTeam.name,
            confidence,
            details: `IIM: ${stats.away.iim} | Cantos: ${stats.away.corners} | Chutes Gol: ${stats.away.shotsOnGoal} | Total Chutes: ${stats.away.totalShots} | Dentro Área: ${stats.away.shotsInsideBox}${dossierBonusDetails}`,
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
  }, [fixtures, allStats, allDossiers, minConfidence, soundEnabled, activeMode]);

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

      // Merge dados da Bet365 com allStats existentes
      if (payload.connected && payload.matches.length > 0) {
        setAllStats(prevStats => {
          const updated = { ...prevStats };
          
          for (const [fixtureId, stats] of Object.entries(updated)) {
            const fId = Number(fixtureId);
            const fixture = fixtures.find(f => f.id === fId);
            if (!fixture) continue;

            const bet365Match = findBet365Match(
              fixture.homeTeam.name,
              fixture.awayTeam.name,
              payload.matches
            );

            if (bet365Match) {
              const merged = mergeStats(stats, bet365Match);
              
              // Recalcular IIM enriquecido
              const elapsed = fixture.elapsed || 1;
              const hasBet365 = (bet365Match.home?.dangerousAttacks || 0) > 0 || 
                                (bet365Match.away?.dangerousAttacks || 0) > 0;
              
              merged.home.iim = calculateEnrichedIIM(merged.home, elapsed, hasBet365);
              merged.away.iim = calculateEnrichedIIM(merged.away, elapsed, hasBet365);
              
              updated[fId] = merged;
            }
          }
          
          return updated;
        });
      }
    });

    return cleanup;
  }, [fixtures]);

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
            background: activeMode === 'aggressive' ? 'rgba(239, 68, 68, 0.1)' : activeMode === 'apm_pure' ? 'var(--accent-glow)' : activeMode === 'funnel' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(16, 185, 129, 0.1)',
            color: activeMode === 'aggressive' ? '#ef4444' : activeMode === 'apm_pure' ? 'var(--accent-primary)' : activeMode === 'funnel' ? '#a855f7' : '#10b981',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}>
            {activeMode === 'apm_pure' && <Zap size={14} />}
            {activeMode === 'aggressive' && <TrendingUp size={14} />}
            {activeMode === 'conservative' && <CheckCircle size={14} />}
            {activeMode === 'defensive' && <ShieldAlert size={14} />}
            {activeMode === 'funnel' && <Filter size={14} />}
            {activeMode === 'apm_pure' && 'APM Puro'}
            {activeMode === 'aggressive' && 'Agressivo'}
            {activeMode === 'conservative' && 'Conservador Clássico'}
            {activeMode === 'defensive' && 'Conservador Defensivo'}
            {activeMode === 'funnel' && 'Funil'}
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
                Lendo {fixtures.length} {fixtures.length === 1 ? 'partida' : 'partidas'} ao vivo com Crossover Pré-Live...
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
              {fixtures.length} {fixtures.length === 1 ? 'Jogo' : 'Jogos'}
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
            {fixtures.length === 0 ? (
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
                    <th style={{ padding: '12px 8px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Status Scanner</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures
                    .map(f => {
                    const stats = allStats[f.id];
                    const dossier = allDossiers[f.id];
                    
                    // Check if this fixture has an active opportunity matching the criteria
                    const hasOpp = opportunities.some(opp => opp.fixtureId === f.id && opp.confidence >= minConfidence);
                    
                    // 🔥 DETECÇÃO DE POTENCIAL: IIM esquentando + contexto válido para entrada
                    const iimThresholdRef = activeMode === 'aggressive' ? 0.8 : activeMode === 'defensive' ? 1.4 : 1.1;
                    const homeIIMRatio = stats.home.iim / iimThresholdRef;
                    const awayIIMRatio = stats.away.iim / iimThresholdRef;
                    
                    // Filtros de contexto: só marca potencial se faz sentido apostar
                    const isValidTime = f.elapsed <= 85 && f.status !== 'HT';        // Não nos minutos finais
                    const totalGoals = f.goalsHome + f.goalsAway;
                    const isOpenGame = totalGoals <= 4;                                // Jogo não está goleado
                    
                    const hasPotential = !hasOpp && isValidTime && isOpenGame && (
                      (homeIIMRatio >= 0.7 && stats.home.corners >= 2) ||
                      (awayIIMRatio >= 0.7 && stats.away.corners >= 2) ||
                      (stats.home.iim + stats.away.iim >= iimThresholdRef * 1.2 && stats.home.shotsOnGoal + stats.away.shotsOnGoal >= 2)
                    );
                    
                    return (
                      <tr 
                        key={`table-fixture-${f.id}`}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          background: hasOpp ? 'rgba(16, 185, 129, 0.06)' : hasPotential ? 'rgba(245, 158, 11, 0.04)' : 'transparent',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        {/* Partida */}
                        <td style={{ padding: '14px 8px' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                            {f.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {f.awayTeam.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2, fontWeight: 700 }}>
                            {f.leagueName}
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

                        <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                          {!stats ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mapeando IIM...</span>
                          ) : !stats.hasTelemetry ? (
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
                            </div>
                          )}
                        </td>

                        {/* APM - Ataques Perigosos por Minuto (dados da Bet365 Bridge) */}
                        <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                          {!stats ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                          ) : !stats.hasTelemetry ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                          ) : (stats.home.dangerousAttacks > 0 || stats.away.dangerousAttacks > 0) ? (() => {
                            // Calcular minutos do tempo atual (HT ou ST)
                            const halfElapsed = f.status === '2H' ? Math.max(f.elapsed - 45, 1) : Math.max(f.elapsed, 1);
                            const homeAPM = Math.round((stats.home.dangerousAttacks / halfElapsed) * 100) / 100;
                            const awayAPM = Math.round((stats.away.dangerousAttacks / halfElapsed) * 100) / 100;
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
                          ) : !stats.hasTelemetry ? (
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                          ) : (
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                              {stats.home.corners} - {stats.away.corners}
                            </div>
                          )}
                        </td>

                        {/* Chutes no Alvo */}
                        <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                          {!stats ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                          ) : !stats.hasTelemetry ? (
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                          ) : (
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                              {stats.home.shotsOnGoal} - {stats.away.shotsOnGoal}
                            </div>
                          )}
                        </td>

                        {/* Posse */}
                        <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                          {!stats ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                          ) : !stats.hasTelemetry ? (
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem' }}>⚠️ SEM TELEMETRIA</span>
                          ) : (
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                              {stats.home.possession}% - {stats.away.possession}%
                            </div>
                          )}
                        </td>

                        {/* Necessidade IA / Motivação */}
                        <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                          {!dossier ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cruzando dados...</span>
                          ) : (
                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                              {dossier.motivationHome}% <span style={{ color: 'var(--text-muted)' }}>/</span> {dossier.motivationAway}%
                            </div>
                          )}
                        </td>

                        {/* Status / Oportunidade + Links rápidos */}
                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                          {hasOpp ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
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
                  const potentialAlerts = fixtures.filter(f => {
                    const s = allStats[f.id];
                    if (!s || !s.hasTelemetry) return false;
                    const hasOpp = filteredOpps.some(o => o.fixtureId === f.id);
                    const thRef = activeMode === 'aggressive' ? 0.8 : activeMode === 'defensive' ? 1.4 : activeMode === 'funnel' ? 1.0 : 1.1;
                    const hR = s.home.iim / thRef; const aR = s.away.iim / thRef;
                    const vt = f.elapsed <= 85 && f.status !== 'HT';
                    const og = f.goalsHome + f.goalsAway <= 4;
                    return !hasOpp && vt && og && (
                      (hR >= 0.7 && s.home.corners >= 2) || (aR >= 0.7 && s.away.corners >= 2) ||
                      (s.home.iim + s.away.iim >= thRef * 1.2 && s.home.shotsOnGoal + s.away.shotsOnGoal >= 2)
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
            {(alertFilter === 'all' || alertFilter === 'potencial') && fixtures
              .filter(f => {
                const s = allStats[f.id];
                if (!s || !s.hasTelemetry) return false;
                const hasOpp = filteredOpps.some(o => o.fixtureId === f.id);
                const thRef = activeMode === 'aggressive' ? 0.8 : activeMode === 'defensive' ? 1.4 : activeMode === 'funnel' ? 1.0 : 1.1;
                const hR = s.home.iim / thRef; const aR = s.away.iim / thRef;
                const vt = f.elapsed <= 85 && f.status !== 'HT';
                const og = f.goalsHome + f.goalsAway <= 4;
                return !hasOpp && vt && og && (
                  (hR >= 0.7 && s.home.corners >= 2) || (aR >= 0.7 && s.away.corners >= 2) ||
                  (s.home.iim + s.away.iim >= thRef * 1.2 && s.home.shotsOnGoal + s.away.shotsOnGoal >= 2)
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

            {alertFilter === 'potencial' && fixtures.filter(f => {
              const s = allStats[f.id];
              if (!s || !s.hasTelemetry) return false;
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


