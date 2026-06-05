const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/pages/Radar.tsx');
let content = fs.readFileSync(targetFile, 'utf8');

// Normalizar quebras de linha
let normalizedContent = content.replace(/\r\n/g, '\n');

// 1. Declarar manualFixtures e allFixtures após expandedFixtureId
const stateTarget = `  // 🔍 Estado para linha expandida na tabela do radar (Dashboard Detalhado)
  const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null);`;

const stateReplacement = `  // 🔍 Estado para linha expandida na tabela do radar (Dashboard Detalhado)
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
      const match = bet365Bridge.matches.find(m => m.matchUrl && m.matchUrl.trim() === (f as any).matchUrl?.trim());
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
  }, [bet365Bridge, manualFixtures]);`;

// 2. Substituir o useMemo de allStats para usar allFixtures e buscar por URL
const statsTargetRegex = /const allStats = useMemo\(\(\) => {[\s\S]*?return updated;\s*}, \[rawApiStats, bet365Bridge, fixtures\]\);/;

const statsReplacement = `const allStats = useMemo(() => {
    const updated = { ...rawApiStats };
    
    // Se a bridge estiver conectada e tiver matches, fazemos o merge inteligente
    if (bet365Bridge && bet365Bridge.connected && bet365Bridge.matches.length > 0) {
      for (const fixture of allFixtures) {
        // Encontrar o jogo correspondente na bridge: prioridade para URL exata, senão fuzzy
        const bet365Match = (fixture as any).matchUrl
          ? bet365Bridge.matches.find(m => m.matchUrl && m.matchUrl.trim() === (fixture as any).matchUrl?.trim())
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
  }, [rawApiStats, bet365Bridge, allFixtures]);`;

// 3. Substituir o bloco descritivo do Link Manager
const descTarget = `Cole abaixo os links dos jogos ao vivo da Bet365 que você deseja monitorar simultaneamente. 
              Ao iniciar a varredura, o sistema abrirá os jogos em abas separadas de forma segura e a extensão 
              Bet365 Bridge capturará a telemetria de todas em paralelo!`;

const descReplacement = `Cole abaixo os links dos jogos ao vivo da Bet365 que deseja monitorar. Ao adicioná-los ao Radar, eles aparecerão instantaneamente na sua lista (contornando os limites de cota da API). Conforme você abrir os jogos correspondentes no seu navegador, a extensão <strong>Bet365 Bridge</strong> enviará os dados em tempo real (zero delay), sincronizando automaticamente os nomes das equipes, o tempo e as estatísticas!`;

// 4. Substituir os botões do Link Manager
const buttonsTargetRegex = /<button\s*onClick=\{\(\) => {[\s\S]*?window\.open\(url, '_blank'\);[\s\S]*?<\/button>\s*<button\s*onClick=\{\(\) => setLinkText\(''\)\}[\s\S]*?Clean Links\s*<\/button>/;

const buttonsReplacement = `<button
                  onClick={() => {
                    const urls = linkText
                      .split('\\n')
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
                  📥 Adicionar URLs como Jogos no Radar ({linkText.split('\\n').filter(l => l.trim().startsWith('http')).length} links)
                </button>

                <button
                  onClick={() => {
                    setManualFixtures([]);
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
                  🧹 Limpar Jogos Manuais
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
                </button>`;

// 5. Substituir o aviso de popup do Link Manager
const warningTarget = `<strong>Aviso:</strong> Certifique-se de que o bloqueador de popups do seu navegador esteja desativado para este site, permitindo a abertura de todas as abas.`;

const warningReplacement = `<strong>Bypass de API Ativo:</strong> Você pode adicionar partidas colando os links da Bet365. Para cada partida inserida, clique no link de atalho ao lado do nome do time para abrir a aba do jogo correspondente no navegador e iniciar a captação de telemetria da extensão.`;

// 6. Substituir a exibição do nome dos times na tabela do Radar para incluir o link
const teamNameTarget = `{f.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {f.awayTeam.name}`;

const teamNameReplacement = `{f.homeTeam.name} <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>vs</span> {f.awayTeam.name}
                                  {(f as any).matchUrl && (
                                    <a 
                                      href={(f as any).matchUrl} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ 
                                        marginLeft: '8px', 
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
                                    >
                                      🔗 Abrir Bet365
                                    </a>
                                  )}`;

// Aplicar as substituições
let success = true;

// A. State
if (normalizedContent.includes(stateTarget)) {
  normalizedContent = normalizedContent.replace(stateTarget, stateReplacement);
  console.log('✅ State de manualFixtures adicionado.');
} else {
  console.error('❌ Falha ao encontrar stateTarget.');
  success = false;
}

// B. allStats useMemo
if (statsTargetRegex.test(normalizedContent)) {
  normalizedContent = normalizedContent.replace(statsTargetRegex, statsReplacement);
  console.log('✅ allStats useMemo atualizado.');
} else {
  console.error('❌ Falha ao encontrar statsTargetRegex.');
  success = false;
}

// C. Link Manager Descrição
if (normalizedContent.includes(descTarget)) {
  normalizedContent = normalizedContent.replace(descTarget, descReplacement);
  console.log('✅ Descrição do Link Manager atualizada.');
} else {
  console.error('❌ Falha ao encontrar descTarget.');
  success = false;
}

// D. Link Manager Botões
if (buttonsTargetRegex.test(normalizedContent)) {
  normalizedContent = normalizedContent.replace(buttonsTargetRegex, buttonsReplacement);
  console.log('✅ Botões do Link Manager atualizados.');
} else {
  console.error('❌ Falha ao encontrar buttonsTargetRegex.');
  success = false;
}

// E. Link Manager Aviso
if (normalizedContent.includes(warningTarget)) {
  normalizedContent = normalizedContent.replace(warningTarget, warningReplacement);
  console.log('✅ Aviso do Link Manager atualizado.');
} else {
  console.error('❌ Falha ao encontrar warningTarget.');
  success = false;
}

// F. Link de "Abrir Jogo" ao lado dos times
if (normalizedContent.includes(teamNameTarget)) {
  normalizedContent = normalizedContent.replace(teamNameTarget, teamNameReplacement);
  console.log('✅ Links rápidos das partidas adicionados.');
} else {
  console.error('❌ Falha ao encontrar teamNameTarget.');
  success = false;
}

// G. Substituir todas as outras ocorrências de fixtures por allFixtures
// (Exceto onde é a declaração de fixtures ou setFixtures)
const replacements = [
  { from: 'fixtures.length === 0', to: 'allFixtures.length === 0' },
  { from: 'fixtures.forEach(', to: 'allFixtures.forEach(' },
  { from: 'fixtures[0]', to: 'allFixtures[0]' },
  { from: 'fixtures.find(', to: 'allFixtures.find(' },
  { from: '[fixtures, selectedFixture]', to: '[allFixtures, selectedFixture]' },
  { from: '[fixtures, allStats', to: '[allFixtures, allStats' },
  { from: 'Lendo {fixtures.length}', to: 'Lendo {allFixtures.length}' },
  { from: '{fixtures.length} {fixtures.length', to: '{allFixtures.length} {allFixtures.length' },
  { from: '{fixtures\n                    .map(f => {', to: '{allFixtures\n                    .map(f => {' },
  { from: 'potentialAlerts = fixtures.filter(', to: 'potentialAlerts = allFixtures.filter(' },
  { from: 'alertFilter === \'all\' || alertFilter === \'potencial\') && fixtures', to: 'alertFilter === \'all\' || alertFilter === \'potencial\') && allFixtures' },
  { from: 'alertFilter === \'potencial\' && fixtures.filter(', to: 'alertFilter === \'potencial\' && allFixtures.filter(' }
];

replacements.forEach(r => {
  if (normalizedContent.includes(r.from)) {
    normalizedContent = normalizedContent.split(r.from).join(r.to);
    console.log(`✅ Substituído: ${r.from} -> ${r.to}`);
  } else {
    console.warn(`⚠️ Não foi possível substituir: ${r.from}`);
  }
});

if (success) {
  fs.writeFileSync(targetFile, normalizedContent, 'utf8');
  console.log('🎉 Radar.tsx com Fallback Manual atualizado e 100% pronto!');
} else {
  console.error('⚠️ Algumas substituições falharam. Operação abortada.');
}
