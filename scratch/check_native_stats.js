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
    
    const matchesWithAttacks = [];
    const matchesWithoutAttacksButWithTelemetry = [];
    const matchesNoTelemetry = [];
    
    // We check first 30 matches (larger sample to verify across leagues)
    const targetFixtures = fixtures.slice(0, 30);
    
    for (const f of targetFixtures) {
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
        matchesNoTelemetry.push(`${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`);
        continue;
      }
      
      const statsList = teamsData[0]?.statistics || [];
      const hasAttacks = statsList.some(s => s.type === "Attacks");
      const hasDangerousAttacks = statsList.some(s => s.type === "Dangerous Attacks");
      
      const matchDesc = `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
      
      if (hasAttacks || hasDangerousAttacks) {
        matchesWithAttacks.push({
          match: matchDesc,
          hasAttacks,
          hasDangerousAttacks
        });
      } else {
        matchesWithoutAttacksButWithTelemetry.push(matchDesc);
      }
    }
    
    console.log("\n--- RESULT BREAKDOWN (30 Matches Sample) ---");
    console.log(`Total checked: 30`);
    console.log(`Matches without Telemetry at all: ${matchesNoTelemetry.length}`);
    console.log(`Matches WITH Telemetry but NO native Attacks/Dangerous Attacks: ${matchesWithoutAttacksButWithTelemetry.length}`);
    console.log(`Matches WITH native Attacks/Dangerous Attacks: ${matchesWithAttacks.length}`);
    
    if (matchesWithAttacks.length > 0) {
      console.log("\nMatches with native Attacks/Dangerous Attacks:");
      console.log(JSON.stringify(matchesWithAttacks, null, 2));
    } else {
      console.log("\nZero matches in the sample have native Attacks/Dangerous Attacks on API-Sports!");
    }
    
  } catch (err) {
    console.error("Error checking all live stats:", err);
  }
}

checkAllLiveStats();
