async function testSofascore() {
  // Let's test the .com endpoint and see if it returns 200 OK
  const domains = [
    'https://api.sofascore.com',
    'https://api.sofascore.app'
  ];
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.sofascore.com',
    'Referer': 'https://www.sofascore.com/'
  };
  
  console.log("Testing Sofascore live endpoints...");
  
  for (const domain of domains) {
    const url = `${domain}/api/v1/sport/football/events/live`;
    console.log(`\nFetching live events from: ${url}`);
    
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: headers
      });
      
      console.log(`Status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        const events = data.events || [];
        console.log(`-> SUCCESS! Found ${events.length} live matches on Sofascore.`);
        
        // Let's find one match with stats and try to fetch its statistics
        const matchWithStats = events.find(e => e.hasEventPlayerStatistics || e.statistics);
        const targetEvent = matchWithStats || events[0];
        
        if (targetEvent) {
          const statsUrl = `${domain}/api/v1/event/${targetEvent.id}/statistics`;
          console.log(`Fetching stats for event ${targetEvent.id} (${targetEvent.homeTeam.name} vs ${targetEvent.awayTeam.name}) at: ${statsUrl}`);
          
          const statsRes = await fetch(statsUrl, {
            method: 'GET',
            headers: headers
          });
          
          console.log(`Stats Status: ${statsRes.status}`);
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            console.log("Stats Structure keys:", Object.keys(statsData));
            if (statsData.statistics && statsData.statistics.length > 0) {
              const period = statsData.statistics[0];
              console.log("Groups:", period.groups.map(g => g.groupName));
              // Let's list some items inside groups
              period.groups.forEach(g => {
                console.log(`  Group: ${g.groupName}`);
                g.statisticsItems.forEach(item => {
                  console.log(`    - ${item.name}: Home=${item.homeValue}, Away=${item.awayValue}`);
                });
              });
            }
          } else {
            console.log(`Failed to fetch stats: ${statsRes.statusText}`);
          }
        }
      } else {
        console.log(`Failed to fetch live events: ${res.statusText}`);
        const bodyText = await res.text();
        console.log(`Body (truncated): ${bodyText.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`Error with ${domain}:`, err);
    }
  }
}

testSofascore();
