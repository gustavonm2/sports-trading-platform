import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Activity, Zap, Search, ShieldAlert, Key, 
  RefreshCw, CheckCircle, AlertTriangle, AlertCircle, PlayCircle,
  Volume2, VolumeX, Bell, TrendingUp, Gauge, Trophy,
  Compass, Thermometer, UserCheck, BarChart2, Shield, Calendar, Users
} from 'lucide-react';
import { apiSports } from '../services/apiSports';
import { sportsmonks } from '../services/sportsmonks';
import { sofascore } from '../services/sofascore';
import type { Fixture, MatchStats, PreMatchDossier } from '../services/apiSports';
import { supabase } from '../services/supabase';

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

interface Opportunity {
  id: string; // unique ID
  fixtureId: number;
  match: Fixture;
  strategyName: 'Canto Limite' | 'Over 0.5 Gols HT' | 'Virada do Favorito';
  teamName: string;
  confidence: number;
  details: string;
  suggestion: string;
}

export default function Radar() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null);
  
  // Advanced scanner and dossier states
  const [allStats, setAllStats] = useState<Record<number, MatchStats>>({});
  const [allDossiers, setAllDossiers] = useState<Record<number, PreMatchDossier>>({});
  const [selectedDossier, setSelectedDossier] = useState<PreMatchDossier | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [minConfidence, setMinConfidence] = useState(65);
  const [activeTab, setActiveTab] = useState<'live' | 'prematch'>('live');
  
  // General status
  const [isApiMock, setIsApiMock] = useState(true);
  const [apiErrorReason, setApiErrorReason] = useState<'limit_reached' | 'invalid_key' | 'network_error' | null>(null);
  const [activeDataSource, setActiveDataSource] = useState<'sportsmonks' | 'sofascore' | 'apisports_real' | 'apisports_simulated'>('apisports_simulated');
  const [isLockdown, setIsLockdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Countdown for refresh
  const [countdown, setCountdown] = useState(25); // 25s scanner refresh
  
  // API Key settings
  const [showConfig, setShowConfig] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isKeyConfigured, setIsKeyConfigured] = useState(apiSports.isKeyConfigured());
  const [bypassOnboarding, setBypassOnboarding] = useState(false);
  const [smToApiSportsIds, setSmToApiSportsIds] = useState<Record<number, number>>({});

  // Gotten opportunities tracking
  const [gottenOppIds, setGottenOppIds] = useState<Set<string>>(new Set());
  const [defaultStake, setDefaultStake] = useState<number>(() => {
    const saved = localStorage.getItem('trade_default_stake');
    return saved ? Number(saved) : 200;
  });

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

  // Setup initial key input
  useEffect(() => {
    const stored = localStorage.getItem('api_sports_key') || '';
    setApiKeyInput(stored);
  }, []);

  // Fetch match stats and pre-match dossiers for all live matches in background to perform scans
  const scanAllLiveMatchStats = useCallback(async (activeFixtures: Fixture[]) => {
    setStatsLoading(true);
    try {
      const now = Date.now();
      
      for (const fixture of activeFixtures) {
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
          
          // 2. Match Stats - query only if missing OR last queried > 60 seconds ago!
          const lastFetch = statsLastFetchRef.current[fixture.id] || 0;
          if (now - lastFetch > 60000 || !allStats[fixture.id]) {
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
      setStatsLoading(false);
    }
  }, [allStats]);

  // Fetch all live matches
  const fetchLiveMatches = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      // 1. Fetch live matches from Sportsmonks Premium
      const smResult = await sportsmonks.getLiveFixtures();
      
      // 2. Fetch live matches from API-Sports (used ONLY for ID mapping / Team Matching)
      const apiSportsResult = await apiSports.getLiveFixtures();
      const apiSportsFixtures = apiSportsResult?.fixtures || [];
      
      let finalFixtures = smResult?.fixtures || [];
      let finalStats = smResult?.statsMap || {};
      
      if (finalFixtures.length > 0) {
        // Sportsmonks Live Premium is active!
        setIsApiMock(false);
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
        setSmToApiSportsIds(mapping);

        // Fetch pre-match dossiers in the background using mapped IDs
        const newDossierMap: Record<number, PreMatchDossier> = {};
        for (const fixture of finalFixtures) {
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
          setIsApiMock(false);
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
          setSmToApiSportsIds(mapping);

          // Fetch pre-match dossiers using mapped IDs
          const newDossierMap: Record<number, PreMatchDossier> = {};
          for (const fixture of finalFixtures) {
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
          // 4. Ultimate Fallback: API-Sports Live / Sandbox Simulation
          finalFixtures = apiSportsFixtures;
          setIsApiMock(apiSportsResult?.isMock ?? true);
          setApiErrorReason(apiSportsResult?.errorReason || null);
          setActiveDataSource(apiSportsResult?.isMock ? 'apisports_simulated' : 'apisports_real');
          
          // Scan stats in the background for API-Sports
          if (finalFixtures.length > 0) {
            await scanAllLiveMatchStats(finalFixtures);
          }
        }
      }
      
      setFixtures(finalFixtures);
      setIsKeyConfigured(apiSports.isKeyConfigured());
      setError(null);
    } catch (err: any) {
      setError("Erro ao varrer o radar de partidas.");
      console.error(err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [scanAllLiveMatchStats]);

  // Synchronize or auto-select selectedFixture when fixtures list or allStats updates
  useEffect(() => {
    if (fixtures.length === 0) {
      setSelectedFixture(null);
      setMatchStats(null);
      setSelectedDossier(null);
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
      
      // Update stats and dossiers from our background scans
      if (allStats[selectedFixture.id]) {
        setMatchStats(allStats[selectedFixture.id]);
      }
      if (allDossiers[selectedFixture.id]) {
        setSelectedDossier(allDossiers[selectedFixture.id]);
      }
    } else {
      setSelectedFixture(fixtures[0]);
    }
  }, [fixtures, allStats, allDossiers, selectedFixture]);

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

      // 🎯 Strategy 1: CANTO LIMITE (Late Corners in 1st/2nd Half)
      const isTimeCanto = (elapsed >= 37 && elapsed <= 45) || (elapsed >= 80 && elapsed <= 90);
      if (isTimeCanto && fixture.status !== 'HT') {
        
        // Evaluates Home Team pressure
        if (stats.home.apm1 >= 1.1 && stats.home.corners >= 3) {
          let confidence = 60 + Math.floor((stats.home.apm1 - 1.1) * 110) + (stats.home.corners * 2) + (stats.home.shotsOnGoal * 3);
          let dossierBonusDetails = '';

          // CROSSOVER: Pre-Live validation corner averages and context
          if (dossier) {
            // High historical corner average bonus (+10%)
            if (dossier.avgCornersHome >= 6.0) {
              confidence += 10;
              dossierBonusDetails += ` | Média Histórica de Cantos alta: ${dossier.avgCornersHome} (+10%)`;
            }
            // Wet weather bonus (+5%)
            if (dossier.weather.toLowerCase().includes('chuva') || dossier.weather.toLowerCase().includes('garoa')) {
              confidence += 5;
              dossierBonusDetails += ` | Clima chuvoso propício (+5%)`;
            }
            // Title/Motivation necessity bonus (+5%)
            if (dossier.motivationHome >= 85) {
              confidence += 5;
              dossierBonusDetails += ` | Necessidade crítica de resultado (+5%)`;
            }
          }

          confidence = Math.min(100, confidence);

          activeOpps.push({
            id: `${fixture.id}-canto-home`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.homeTeam.name,
            confidence,
            details: `Pressão in-play excelente! APM1: ${stats.home.apm1} | Cantos: ${stats.home.corners} | Chutes no Gol: ${stats.home.shotsOnGoal}${dossierBonusDetails}`,
            suggestion: `Entrar em "Canto Limite" da partida acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
        
        // Evaluates Away Team pressure
        if (stats.away.apm1 >= 1.1 && stats.away.corners >= 3) {
          let confidence = 60 + Math.floor((stats.away.apm1 - 1.1) * 110) + (stats.away.corners * 2) + (stats.away.shotsOnGoal * 3);
          let dossierBonusDetails = '';

          if (dossier) {
            if (dossier.avgCornersAway >= 6.0) {
              confidence += 10;
              dossierBonusDetails += ` | Média Histórica de Cantos alta: ${dossier.avgCornersAway} (+10%)`;
            }
            if (dossier.weather.toLowerCase().includes('chuva') || dossier.weather.toLowerCase().includes('garoa')) {
              confidence += 5;
              dossierBonusDetails += ` | Clima chuvoso propício (+5%)`;
            }
            if (dossier.motivationAway >= 85) {
              confidence += 5;
              dossierBonusDetails += ` | Necessidade crítica de resultado (+5%)`;
            }
          }

          confidence = Math.min(100, confidence);

          activeOpps.push({
            id: `${fixture.id}-canto-away`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Canto Limite',
            teamName: fixture.awayTeam.name,
            confidence,
            details: `Pressão in-play excelente! APM1: ${stats.away.apm1} | Cantos: ${stats.away.corners} | Chutes no Gol: ${stats.away.shotsOnGoal}${dossierBonusDetails}`,
            suggestion: `Entrar em "Canto Limite" da partida acima de ${stats.home.corners + stats.away.corners + 0.5} escanteios com odd mínima de 1.80.`
          });
        }
      }

      // ⚽ Strategy 2: OVER 0.5 GOLS HT (Half-Time Goal Pressure)
      const isTimeOverHT = elapsed >= 12 && elapsed <= 32 && scoreHome === 0 && scoreAway === 0;
      if (isTimeOverHT) {
        const combinedApm2 = Number((stats.home.apm2 + stats.away.apm2).toFixed(2));
        const combinedShots = stats.home.shotsOnGoal + stats.away.shotsOnGoal;
        
        if (combinedApm2 >= 1.4 && combinedShots >= 3) {
          let confidence = 55 + Math.floor((combinedApm2 - 1.4) * 80) + (combinedShots * 4);
          let dossierBonusDetails = '';

          // CROSSOVER: Pre-Live goals averages and tactics
          if (dossier) {
            // High combined historical goal average (+10%)
            if (dossier.avgGoalsScoredHome + dossier.avgGoalsScoredAway >= 3.5) {
              confidence += 10;
              dossierBonusDetails += ` | Alta média histórica de gols combinada (+10%)`;
            }
            // Active offensive formations bonus (+5%)
            if (dossier.formationHome === '4-3-3' || dossier.formationAway === '4-3-3') {
              confidence += 5;
              dossierBonusDetails += ` | Formações táticas agressivas (+5%)`;
            }
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-overht`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Over 0.5 Gols HT',
            teamName: 'Ambas',
            confidence,
            details: `Volume in-play alucinante! APM2: ${combinedApm2} | Chutes no Alvo: ${combinedShots}${dossierBonusDetails}`,
            suggestion: `Fazer entrada no mercado de "Acima de 0.5 Gols HT" (Over 0.5 HT) com odd mínima de 1.70.`
          });
        }
      }

      // 📈 Strategy 3: VIRADA DO FAVORITO (Back Favorite in Trouble)
      const isTimeSecondHalf = elapsed >= 50;
      if (isTimeSecondHalf && fixture.status !== 'HT') {
        
        // Evaluates if Home is favorite
        const isHomeFav = stats.home.possession >= 60 || (stats.home.attacks > stats.away.attacks * 1.3);
        const isHomeTrouble = scoreHome <= scoreAway; // Drawing or losing

        if (isHomeFav && isHomeTrouble && stats.home.apm1 >= 1.2) {
          let confidence = 65 + Math.floor((stats.home.apm1 - 1.2) * 60) + (stats.home.corners * 1);
          let dossierBonusDetails = '';

          // CROSSOVER: Pre-Live motivations, fatigue and rotation
          if (dossier) {
            // Relegation/Motivation necessity bonus (+10%)
            if (dossier.motivationHome >= 90) {
              confidence += 10;
              dossierBonusDetails += ` | Motivação crítica por vitória (+10%)`;
            }
            // Opponent fatigue bonus (+5%)
            if (dossier.fatigueAway >= 70) {
              confidence += 5;
              dossierBonusDetails += ` | Oponente desgastado/com fadiga (+5%)`;
            }
            // Full strength rotation check (+5%)
            if (dossier.rotationHome === 'Força Máxima') {
              confidence += 5;
              dossierBonusDetails += ` | Escalação com Força Máxima (+5%)`;
            }
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-virada-home`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Virada do Favorito',
            teamName: fixture.homeTeam.name,
            confidence,
            details: `Favorito pressionando muito em desvantagem! APM1: ${stats.home.apm1} | Posse: ${stats.home.possession}%${dossierBonusDetails}`,
            suggestion: `Entrar no mercado a favor da vitória "Back ${fixture.homeTeam.name}" ou buscar "Over Gols no Jogo".`
          });
        }

        // Evaluates if Away is favorite
        const isAwayFav = stats.away.possession >= 60 || (stats.away.attacks > stats.home.attacks * 1.3);
        const isAwayTrouble = scoreAway <= scoreHome;

        if (isAwayFav && isAwayTrouble && stats.away.apm1 >= 1.2) {
          let confidence = 65 + Math.floor((stats.away.apm1 - 1.2) * 60) + (stats.away.corners * 1);
          let dossierBonusDetails = '';

          if (dossier) {
            if (dossier.motivationAway >= 90) {
              confidence += 10;
              dossierBonusDetails += ` | Motivação crítica por vitória (+10%)`;
            }
            if (dossier.fatigueHome >= 70) {
              confidence += 5;
              dossierBonusDetails += ` | Oponente desgastado/com fadiga (+5%)`;
            }
            if (dossier.rotationAway === 'Força Máxima') {
              confidence += 5;
              dossierBonusDetails += ` | Escalação com Força Máxima (+5%)`;
            }
          }

          confidence = Math.min(100, confidence);
          
          activeOpps.push({
            id: `${fixture.id}-virada-away`,
            fixtureId: fixture.id,
            match: fixture,
            strategyName: 'Virada do Favorito',
            teamName: fixture.awayTeam.name,
            confidence,
            details: `Favorito pressionando muito em desvantagem! APM1: ${stats.away.apm1} | Posse: ${stats.away.possession}%${dossierBonusDetails}`,
            suggestion: `Entrar no mercado a favor da vitória "Back ${fixture.awayTeam.name}" ou buscar "Over Gols no Jogo".`
          });
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
  }, [fixtures, allStats, allDossiers, minConfidence, soundEnabled]);

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

  // Credentials actions
  const handleSaveKey = () => {
    if (apiKeyInput.trim() !== '') {
      apiSports.saveKeyLocally(apiKeyInput);
      setIsKeyConfigured(true);
      setShowConfig(false);
      fetchLiveMatches(true);
    }
  };

  const handleClearKey = () => {
    apiSports.clearKeyLocally();
    setApiKeyInput('');
    setIsKeyConfigured(false);
    setShowConfig(false);
    fetchLiveMatches(true);
  };

  const triggerLockdown = () => {
    setIsLockdown(true);
  };

  // Filtered active opportunities
  const filteredOpps = opportunities.filter(o => o.confidence >= minConfidence);

  // If scanner is not configured and user hasn't chosen to bypass, show professional onboarding activation
  if (!isKeyConfigured && !bypassOnboarding) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px', animation: 'fadeIn 0.3s ease-out' }}>
        <div className="card glass-panel" style={{ 
          padding: 40,
          background: 'linear-gradient(135deg, rgba(30,58,138,0.04) 0%, rgba(255,255,255,1) 100%)',
          border: '1px solid rgba(30,58,138,0.1)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.04)',
          borderRadius: 16,
          textAlign: 'center'
        }}>
          
          <div style={{ display: 'inline-flex', padding: 16, borderRadius: '50%', background: 'rgba(30,58,138,0.06)', color: 'var(--accent-primary)', marginBottom: 20 }}>
            <Activity size={40} className="pulse-indicator" />
          </div>

          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            Ativar Scanner de Trading Profissional
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', maxWidth: 550, margin: '0 auto 30px', lineHeight: 1.6 }}>
            O seu painel está 100% pronto para monitorar o mercado real. Insira sua chave da **API-Sports (API-Football)** para iniciar a leitura automática e disparar alertas em tempo real.
          </p>

          {/* Grid de Recursos Premium */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 35, textAlign: 'left' }}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)' }}>
              <div style={{ color: 'var(--status-green)', marginBottom: 12 }}><Zap size={20} /></div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6 }}>Varredura Geral</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Monitora chutes, posse e escanteios de qualquer partida ativa do planeta.</p>
            </div>
            
            <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)' }}>
              <div style={{ color: 'var(--accent-primary)', marginBottom: 12 }}><Compass size={20} /></div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6 }}>16 Itens Pré-Live</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Cruza cansaço físico, clima, árbitro rigoroso e desfalques automaticamente.</p>
            </div>

            <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)' }}>
              <div style={{ color: 'var(--status-red)', marginBottom: 12 }}><Bell size={20} /></div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6 }}>Chimes Digitais</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Sintetizador eletrônico nativo avisa na hora certa de fazer a entrada.</p>
            </div>
          </div>

          {/* Formulário de Ativação */}
          <div style={{ background: 'rgba(30,58,138,0.02)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 10, textAlign: 'left' }}>
              Chave da API-Sports / API-Football
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <input 
                type="password"
                placeholder="Insira sua API Key do API-Sports..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={{
                  flex: 1,
                  background: '#fff', border: '1px solid var(--border-color)', borderRadius: 8,
                  padding: '12px 16px', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace'
                }}
              />
              <button 
                className="btn btn-primary" 
                style={{ padding: '0 24px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleSaveKey}
              >
                Ativar Scanner <Zap size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: '0.75rem' }}>
              <a 
                href="https://dashboard.api-sports.io/" 
                target="_blank" 
                rel="noreferrer" 
                style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}
              >
                🔑 Não tem uma chave? Obtenha uma grátis aqui!
              </a>
              <span style={{ color: 'var(--text-muted)' }}>Mantenha sua chave segura localmente</span>
            </div>
          </div>

          {/* Continuar Simulando Fallback */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <button 
              className="btn btn-outline" 
              style={{ fontSize: '0.8rem', padding: '8px 16px', borderColor: 'var(--border-color)' }}
              onClick={() => setBypassOnboarding(true)}
            >
              💡 Entrar no Modo de Simulação (Testar com Jogos Seedados)
            </button>
          </div>

        </div>
      </div>
    );
  }

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
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', border: '1px solid rgba(124, 58, 237, 0.2)', fontSize: '0.75rem', padding: '4px 8px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowConfig(true)}>
                <CheckCircle size={12} /> 📡 SPORTSMONKS LIVE (PREMIUM)
              </span>
            )}
            {activeDataSource === 'sofascore' && (
              <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', fontSize: '0.75rem', padding: '4px 8px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowConfig(true)}>
                <CheckCircle size={12} /> 📡 SOFASCORE LIVE (100% REAL)
              </span>
            )}
            {activeDataSource === 'apisports_real' && (
              <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowConfig(true)}>
                <CheckCircle size={12} /> 📡 API-SPORTS LIVE (ATIVO)
              </span>
            )}
            {activeDataSource === 'apisports_simulated' && (
              <span className="badge badge-yellow" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowConfig(true)}>
                <PlayCircle size={12} /> ⚡ MODO SIMULADO
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

          <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setShowConfig(!showConfig)}>
            <Key size={16} />
            API Key
          </button>
          
          <button className="btn className-lock" style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }} onClick={triggerLockdown} title="Simular Meta Batida">
            Testar Lockdown
          </button>
        </div>
      </div>

      {/* API Key Panel */}
      {showConfig && (
        <div className="card glass-panel" style={{ marginBottom: 24, padding: 24, animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Key size={18} color="var(--accent-primary)" />
              Configurações da Chave API-Sports
            </h3>
            <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setShowConfig(false)}>Fechar</button>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 16, lineHeight: 1.5 }}>
            Insira sua chave de API para varrer jogos reais. Deixe em branco para testar com nosso simulador ativo que gera gatilhos de pressão reais.
          </p>
          <div style={{ display: 'flex', gap: 12, maxWidth: 600 }}>
            <input 
              type="password"
              placeholder="Sua API Key..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              style={{
                flex: 1,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '10px 16px', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace'
              }}
            />
            <button className="btn btn-primary" onClick={handleSaveKey}>Salvar Chave</button>
            {isKeyConfigured && (
              <button className="btn btn-outline" style={{ color: 'var(--status-red)', borderColor: 'var(--status-red)' }} onClick={handleClearKey}>Remover Chave</button>
            )}
          </div>
        </div>
      )}

      {/* ⚠️ Alerta de Limite ou Erro da API Real */}
      {isApiMock && apiErrorReason && (
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
              {apiErrorReason === 'limit_reached' ? 'Meta Limite Diária de Requisições Atingida!' : 'Erro na Chave de API Configurada!'}
            </h4>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {apiErrorReason === 'limit_reached' ? (
                <span>
                  A sua chave configurada atingiu o <strong>limite diário de chamadas gratuitas da API-Sports (100 requisições/dia)</strong>. O sistema ativou o <strong>Modo Simulado</strong> de segurança para garantir que você continue testando a plataforma com dados e triggers reais. Faça upgrade na sua conta em <a href="https://dashboard.api-sports.io/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>dashboard.api-sports.io</a>.
                </span>
              ) : (
                <span>
                  A chave de API salva retornou um erro de credencial inválida ou plano não assinado. O sistema ativou o <strong>Modo Simulado</strong>. Por favor, revise sua chave clicando no botão <strong>API Key</strong> no canto superior direito.
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
                      marginBottom: 16
                    }}>
                      <strong>💡 Sugestão de Entrada:</strong> {opp.suggestion}
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

                      <a 
                        href="https://www.bet365.com" 
                        target="_blank" 
                        rel="noreferrer" 
                        className="btn btn-primary" 
                        style={{ padding: '8px 16px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                      >
                        Operar Live <PlayCircle size={14} />
                      </a>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna Direita: Análise Tática Integrada & Pressão */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <TrendingUp size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Dossiê Analítico de Jogo</h2>
          </div>

          {!selectedFixture ? (
            <div className="card glass-panel" style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'var(--text-muted)', textAlign: 'center', padding: 30 }}>
              <Gauge size={48} style={{ opacity: 0.3 }} />
              <div>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>Aguardando Seleção...</h3>
                <p style={{ fontSize: '0.875rem' }}>Clique em "Análise do Jogo" em qualquer card à esquerda para abrir a telemetria ao vivo e o dossiê pré-live.</p>
              </div>
            </div>
          ) : (
            <div className="card glass-panel" style={{ padding: 24, boxShadow: '0 8px 30px rgba(0,0,0,0.03)' }}>
              
              {/* Header Jogo Selecionado */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 16, marginBottom: 20 }}>
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                    {selectedFixture.leagueName}
                  </span>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                    {selectedFixture.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {selectedFixture.awayTeam.name}
                  </h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: 800, 
                    color: 'var(--text-primary)', 
                    background: 'var(--bg-elevated)', 
                    padding: '4px 12px', 
                    borderRadius: 8,
                    display: 'inline-block' 
                  }}>
                    {selectedFixture.goalsHome} - {selectedFixture.goalsAway}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    <span className="pulse-indicator" style={{ background: 'var(--status-green)' }}></span>
                    {selectedFixture.elapsed}' Minutos
                  </div>
                </div>
              </div>

              {/* 📑 TABS SELECTOR */}
              <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: 20 }}>
                <button 
                  onClick={() => setActiveTab('live')}
                  style={{
                    flex: 1, padding: '12px 0', border: 'none', background: 'none',
                    fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer',
                    color: activeTab === 'live' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === 'live' ? '3px solid var(--accent-primary)' : 'none',
                    marginBottom: -2,
                    transition: 'all 0.15s ease'
                  }}
                >
                  Telemetria Live
                </button>
                <button 
                  onClick={() => setActiveTab('prematch')}
                  style={{
                    flex: 1, padding: '12px 0', border: 'none', background: 'none',
                    fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer',
                    color: activeTab === 'prematch' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === 'prematch' ? '3px solid var(--accent-primary)' : 'none',
                    marginBottom: -2,
                    transition: 'all 0.15s ease'
                  }}
                >
                  Dossiê Pré-Live (16 Itens)
                </button>
              </div>

              {/* TAB CONTENT: LIVE TELEMETRY */}
              {activeTab === 'live' && (
                <div>
                  {statsLoading && !matchStats ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <RefreshCw size={24} className="pulse-indicator" style={{ animation: 'spin 2s linear infinite', marginBottom: 8 }} />
                      <p>Acessando estatísticas em tempo real...</p>
                    </div>
                  ) : !matchStats ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <AlertCircle size={24} style={{ marginBottom: 8 }} />
                      <p>Sem telemetria ativa para esta partida no momento.</p>
                    </div>
                  ) : (
                    <div>
                      
                      {/* Alert for empty stats in secondary/minor leagues */}
                      {matchStats.home.corners === 0 && 
                       matchStats.away.corners === 0 && 
                       matchStats.home.dangerousAttacks === 0 && 
                       matchStats.away.dangerousAttacks === 0 && (
                        <div style={{
                          background: 'rgba(217, 119, 6, 0.04)',
                          border: '1px dashed var(--status-yellow)',
                          padding: '14px 16px',
                          borderRadius: 8,
                          marginBottom: 20,
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.5,
                          textAlign: 'left'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--status-yellow)', fontWeight: 700, marginBottom: 6 }}>
                            <AlertCircle size={16} /> 
                            Limitação de Cobertura da Liga
                          </div>
                          Esta partida pertence a uma divisão secundária/menor (<strong>{selectedFixture?.leagueName}</strong>). A API-Sports não fornece telemetria detalhada ao vivo (scouts de faltas, escanteios, chutes) em tempo real para este campeonato.
                          <div style={{ marginTop: 8, fontWeight: 600 }}>
                            💡 Dica: Selecione um jogo de uma divisão principal (Ex: Brasileirão Série A, Premier League, Champions) ou clique em "API Key" e ative o <strong>Modo Simulado</strong> para ver os gráficos, APM e chimes em ação!
                          </div>
                        </div>
                      )}

                      {/* Comparativo de Índices APM1 e APM2 */}
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 700 }}>
                        📊 Índices de Ataque Avançados (APM)
                      </h4>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                        
                        {/* APM Mandante */}
                        <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 8, textAlign: 'center', border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>APM1 / APM2 (Mandante)</span>
                          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', margin: '4px 0' }}>
                            {matchStats.home.apm1} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ {matchStats.home.apm2}</span>
                          </div>
                          <span style={{ fontSize: '0.7rem', color: matchStats.home.apm1 >= 1.0 ? 'var(--status-green)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {matchStats.home.apm1 >= 1.2 ? '🔥 Pressão Crítica' : matchStats.home.apm1 >= 0.9 ? '⚠️ Pressão Moderada' : 'Normal'}
                          </span>
                        </div>

                        {/* APM Visitante */}
                        <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 8, textAlign: 'center', border: '1px solid var(--border-color)' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>APM1 / APM2 (Visitante)</span>
                          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', margin: '4px 0' }}>
                            {matchStats.away.apm1} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ {matchStats.away.apm2}</span>
                          </div>
                          <span style={{ fontSize: '0.7rem', color: matchStats.away.apm1 >= 1.0 ? 'var(--status-green)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {matchStats.away.apm1 >= 1.2 ? '🔥 Pressão Crítica' : matchStats.away.apm1 >= 0.9 ? '⚠️ Pressão Moderada' : 'Normal'}
                          </span>
                        </div>

                      </div>

                      {/* Momentum Gauge Horizontal de Pressão */}
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 700 }}>
                        Indicador de Momentum de Pressão (0-100)
                      </h4>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                        <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                            <span>Pressão Casa</span>
                            <strong style={{ color: 'var(--text-primary)' }}>{matchStats.home.pressureIndex}%</strong>
                          </div>
                          <div style={{ height: 6, background: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${matchStats.home.pressureIndex}%`, height: '100%', background: matchStats.home.pressureIndex >= 30 ? 'var(--status-green)' : 'var(--accent-primary)' }}></div>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                            <span>Pressão Fora</span>
                            <strong style={{ color: 'var(--text-primary)' }}>{matchStats.away.pressureIndex}%</strong>
                          </div>
                          <div style={{ height: 6, background: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${matchStats.away.pressureIndex}%`, height: '100%', background: matchStats.away.pressureIndex >= 30 ? 'var(--status-green)' : 'var(--accent-primary)' }}></div>
                          </div>
                        </div>
                      </div>

                      {/* Comparativo Geral de Live Stats */}
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16, fontWeight: 700 }}>
                        Métricas Comparadas
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <StatRow label="Escanteios (Cantos)" homeVal={matchStats.home.corners} awayVal={matchStats.away.corners} />
                        <StatRow label="Ataques Perigosos" homeVal={matchStats.home.dangerousAttacks} awayVal={matchStats.away.dangerousAttacks} highlightHigher />
                        <StatRow label="Chutes no Alvo" homeVal={matchStats.home.shotsOnGoal} awayVal={matchStats.away.shotsOnGoal} highlightHigher />
                        <StatRow label="Chutes para Fora" homeVal={matchStats.home.shotsOffGoal} awayVal={matchStats.away.shotsOffGoal} />
                        
                        {/* Posse de Bola Progress */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>
                            <span>{matchStats.home.possession}%</span>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Posse de Bola</span>
                            <span>{matchStats.away.possession}%</span>
                          </div>
                          <div style={{ width: '100%', height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 4, display: 'flex', overflow: 'hidden' }}>
                            <div style={{ width: `${matchStats.home.possession}%`, height: '100%', background: 'var(--accent-primary)' }}></div>
                            <div style={{ width: `${matchStats.away.possession}%`, height: '100%', background: 'var(--status-yellow)' }}></div>
                          </div>
                        </div>

                        {/* Cartões Comparador */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Yellow Cards</span>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <span style={{ background: '#facc15', color: '#000', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>{matchStats.home.yellowCards}</span>
                              <span style={{ background: '#facc15', color: '#000', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>{matchStats.away.yellowCards}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Red Cards</span>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <span style={{ background: 'var(--status-red)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>{matchStats.home.redCards}</span>
                              <span style={{ background: 'var(--status-red)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>{matchStats.away.redCards}</span>
                            </div>
                          </div>
                        </div>

                      </div>

                    </div>
                  )}
                </div>
              )}

              {/* TAB CONTENT: 🔮 PRE-LIVE DOSSIER (16 INDICATORS) */}
              {activeTab === 'prematch' && (
                <div>
                  {!selectedDossier ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <AlertCircle size={24} style={{ marginBottom: 8 }} />
                      <p>Mapeando dossiê pré-live estruturado...</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      
                      {/* Termômetro de Motivacao / Favoritismo IA */}
                      <div style={{ 
                        background: 'var(--bg-elevated)', 
                        padding: 16, 
                        borderRadius: 8, 
                        border: '1px solid var(--border-color)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                          <span>Motivação Casa: {selectedDossier.motivationHome}%</span>
                          <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}><Trophy size={12} /> Motivação/Necessidade do Resultado</span>
                          <span>Motivação Fora: {selectedDossier.motivationAway}%</span>
                        </div>
                        <div style={{ height: 10, background: 'rgba(0,0,0,0.06)', borderRadius: 5, display: 'flex', overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ width: `${(selectedDossier.motivationHome / (selectedDossier.motivationHome + selectedDossier.motivationAway)) * 100}%`, background: 'var(--accent-primary)' }}></div>
                          <div style={{ width: `${(selectedDossier.motivationAway / (selectedDossier.motivationHome + selectedDossier.motivationAway)) * 100}%`, background: 'var(--status-yellow)' }}></div>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', textAlign: 'center', fontStyle: 'italic' }}>
                          *Heurística de peso: Palmeiras necessita da vitória para G4 ({selectedDossier.motivationAway}%).
                        </span>
                      </div>

                      {/* 1. PODER OFENSIVO & TENDÊNCIAS */}
                      <div>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                          <BarChart2 size={14} /> 📊 1. Poder Ofensivo & Tendências
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <DossierItem label="Força Ofensiva (Home/Away)" value={`${selectedDossier.offensiveStrengthHome}% / ${selectedDossier.offensiveStrengthAway}%`} />
                          <DossierItem label="Média de Gols (Marcados/Sofridos)" value={`C: ${selectedDossier.avgGoalsScoredHome} / ${selectedDossier.avgGoalsConcededHome} | F: ${selectedDossier.avgGoalsScoredAway} / ${selectedDossier.avgGoalsConcededAway}`} />
                          <DossierItem label="Média de Escanteios" value={`Casa: ${selectedDossier.avgCornersHome} | Fora: ${selectedDossier.avgCornersAway}`} />
                          <DossierItem label="Posse de Bola Média" value={`Casa: ${selectedDossier.avgPossessionHome}% | Fora: ${selectedDossier.avgPossessionAway}%`} />
                        </div>
                      </div>

                      {/* 2. ESTILO TÁTICO & RITMO */}
                      <div>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                          <Compass size={14} /> 🧠 2. Estilo Tático & Ritmo
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <DossierItem label="Estilo Tático (Home/Away)" value={`C: ${selectedDossier.tacticalStyleHome.substring(0, 18)}... / F: ${selectedDossier.tacticalStyleAway.substring(0, 18)}...`} />
                          <DossierItem label="Ritmo Médio de Partida" value={`C: ${selectedDossier.tempoHome} | F: ${selectedDossier.tempoAway}`} />
                          <DossierItem label="Agressividade / Rigor" value={`Casa: ${selectedDossier.aggressivenessHome} | Fora: ${selectedDossier.aggressivenessAway}`} />
                          <DossierItem label="Formação Inicial Escalação" value={`Mandante: ${selectedDossier.formationHome} | Visitante: ${selectedDossier.formationAway}`} />
                        </div>
                      </div>

                      {/* 3. AMBIENTE & CONDIÇÃO */}
                      <div>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                          <Thermometer size={14} /> 🌤️ 3. Ambiente & Condição Física
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <DossierItem label="Clima no Estádio" value={selectedDossier.weather} />
                          <DossierItem label="Árbitro Escudo & Rigor" value={`${selectedDossier.refereeName} (Média: ${selectedDossier.refereeCardRate} cartões)`} />
                          <DossierItem label="Desgaste / Fadiga (0-100)" value={`C: ${selectedDossier.fatigueHome}% (Desgaste) | F: ${selectedDossier.fatigueAway}% (Fresco)`} />
                          <DossierItem label="Rotação de Elenco" value={`C: ${selectedDossier.rotationHome} | F: ${selectedDossier.rotationAway}`} />
                        </div>
                      </div>

                      {/* 4. CONTEXTO & ELENCO */}
                      <div>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                          <Shield size={14} /> 🏆 4. Contexto Competitivo & Elenco
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <DossierItem label="Tabela / Classificação" value={`C: ${selectedDossier.standingsHome} | F: ${selectedDossier.standingsAway}`} />
                          <DossierItem label="Liga Perfil Estatístico" value={selectedDossier.leagueProfile} />
                          
                          {/* Desfalques Lists */}
                          <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700 }}>Desfalques Mandante</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--status-red)', fontWeight: 600 }}>
                              {selectedDossier.absencesHome.length > 0 ? selectedDossier.absencesHome.join(', ') : 'Nenhum desfalque crucial'}
                            </span>
                          </div>

                          <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700 }}>Desfalques Visitante</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--status-red)', fontWeight: 600 }}>
                              {selectedDossier.absencesAway.length > 0 ? selectedDossier.absencesAway.join(', ') : 'Nenhum desfalque crucial'}
                            </span>
                          </div>

                        </div>
                      </div>

                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// Compact Dossier visual item
interface DossierItemProps {
  label: string;
  value: string;
}

function DossierItem({ label, value }: DossierItemProps) {
  return (
    <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 700, marginTop: 2, display: 'block' }}>{value}</span>
    </div>
  );
}

// Internal comparative stats row component
interface StatRowProps {
  label: string;
  homeVal: number;
  awayVal: number;
  highlightHigher?: boolean;
}

function StatRow({ label, homeVal, awayVal, highlightHigher = false }: StatRowProps) {
  const total = homeVal + awayVal === 0 ? 1 : (homeVal + awayVal);
  const homePct = (homeVal / total) * 100;
  const awayPct = (awayVal / total) * 100;

  const isHomeHigher = homeVal > awayVal;
  const isAwayHigher = awayVal > homeVal;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
        <span style={{ 
          fontWeight: isHomeHigher && highlightHigher ? '700' : '500', 
          color: isHomeHigher && highlightHigher ? 'var(--status-green)' : 'var(--text-primary)' 
        }}>
          {homeVal}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500 }}>{label}</span>
        <span style={{ 
          fontWeight: isAwayHigher && highlightHigher ? '700' : '500', 
          color: isAwayHigher && highlightHigher ? 'var(--status-green)' : 'var(--text-primary)' 
        }}>
          {awayVal}
        </span>
      </div>
      <div style={{ width: '100%', height: 6, background: 'rgba(0,0,0,0.05)', borderRadius: 3, display: 'flex', overflow: 'hidden' }}>
        <div style={{ 
          width: `${homePct}%`, 
          height: '100%', 
          background: isHomeHigher && highlightHigher ? 'var(--status-green)' : 'var(--text-secondary)', 
          borderRight: '1px solid #fff' 
        }}></div>
        <div style={{ 
          width: `${awayPct}%`, 
          height: '100%', 
          background: isAwayHigher && highlightHigher ? 'var(--status-green)' : 'var(--text-muted)' 
        }}></div>
      </div>
    </div>
  );
}
