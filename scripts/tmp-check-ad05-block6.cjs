const path = require('path');
require('dotenv').config({ path: __dirname + '/../config/.env' });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));
  const client = dbManager.getClient();
  const { data: sigs } = await client.from('strategy_signals')
    .select('metadata').eq('experiment_id', EXP).eq('token_address', TOKEN).eq('signal_type', 'BUY');
  const m = sigs[0].metadata;
  const tf = m.trendFactors;
  const keys = ['tokenAgeSec','marketCap','narrativeRating','holderTrendSlope','holderTrendSlopeExSniper','trendDataPoints',
    'buyVolumeBnb','holdersExDust','holders','tradesNetBuyRatioLongWin','tradesNetBuyRatioShortWin','tradesNetBuyRatio',
    'tradesRouterPct','maxCopyWalletHolderCircPct','famousCopyWalletCircPct','drawdownFromHighest','crashSpeedPctPerSec',
    'tradeCount','firstPrice','currentPrice','highestPrice','entryMarketCap','top1HolderCircPct','top2HolderCircPct'];
  const out = {}; for (const k of keys) out[k] = tf[k];
  console.log(JSON.stringify(out, null, 1));
  console.log('preBuyCheckResult:', JSON.stringify(m.preBuyCheckResult));
  console.log('narrativeLeaderCheck:', JSON.stringify(m.narrativeLeaderCheck));
  console.log('narrativeRoundsSummary:', JSON.stringify(m.narrativeRoundsSummary));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
