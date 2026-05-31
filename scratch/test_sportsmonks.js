async function testSportsmonks() {
  const token = 'I2JnAHeFNSdX7f1I77MgPAd6ev79fCFnLj6hRLJsPlNWpWTxDC2Ns4WN707J';
  const url = `https://api.sportmonks.com/v3/football/livescores/inplay?api_token=${token}&include=statistics;participants;league;state`;
  
  console.log("Fetching live scores from Sportsmonks...");
  try {
    const res = await fetch(url, {
      method: 'GET',
    });
    
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log("API Keys: ", Object.keys(data));
    
    if (data.data) {
      console.log(`Success! Found ${data.data.length} live matches on Sportsmonks.`);
      if (data.data.length > 0) {
        const item = data.data[0];
        console.log("Sample Match:", item.name);
        console.log("Sample Stats count:", item.statistics ? item.statistics.length : 0);
      }
    } else {
      console.log("Error response:", data);
    }
  } catch (err) {
    console.error("Error during Sportsmonks query:", err);
  }
}

testSportsmonks();
