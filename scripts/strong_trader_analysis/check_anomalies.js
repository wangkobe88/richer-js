const data = require('./data/step3_wallet_data.json');

let anomalyCount = 0;
data.forEach(w => {
  if (w.raw_data && w.raw_data.tokens) {
    w.raw_data.tokens.forEach(t => {
      const usd = parseFloat(t.balance_usd) || 0;
      if (usd > 1000000) {
        console.log(`${t.symbol}: ${usd.toFixed(0)} USD, ${t.balance_amount} tokens`);
        anomalyCount++;
      }
    });
  }
});
console.log(`Total anomalies: ${anomalyCount}`);
