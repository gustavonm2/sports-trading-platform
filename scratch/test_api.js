async function checkAllLiveStats() {
  const apiKey = '1006612834b19b26953088378103a894';
  const url = 'https://v3.football.api-sports.io/fixtures?live=all';
  
  console.log("Fetching live matches from API-Sports...");
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-apisports-key': apiKey,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    const data = await res.json();
    const fixtures = data.response || [];
    console.log(`Found ${fixtures.length} live matches.`);
    
    // Pick the first 5 live matches that are not Germany, and fetch their stats
    const otherFixtures = fixtures.filter(f => f.fixture.id !== 1501818).slice(0, 5);
    
    for (const f of otherFixtures) {
      console.log(`\nChecking stats for: ${f.teams.home.name} vs ${f.teams.away.name} (League: ${f.league.name}, ID: ${f.fixture.id})`);
      const statsUrl = `https://v3.football.api-sports.io/fixtures/statistics?fixture=${f.fixture.id}`;
      const statsRes = await fetch(statsUrl, {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
        }
      });
      
      const statsData = await statsRes.json();
      const teamsData = statsData.response || [];
      
      if (teamsData.length === 0) {
        console.log("-> NO STATISTICS AVAILABLE at all for this match.");
        continue;
      }
      
      const statsList = teamsData[0]?.statistics || [];
      const hasAttacks = statsList.some(s => s.type === "Attacks");
      const hasDangerousAttacks = statsList.some(s => s.type === "Dangerous Attacks");
      
      console.log("-> Available Stats fields:", statsList.map(s => s.type).join(', '));
      console.log(`-> Has Attacks: ${hasAttacks} | Has Dangerous Attacks: ${hasDangerousAttacks}`);
    }
    
  } catch (err) {
    console.error("Error checking stats:", err);
  }
}

checkAllLiveStats();
