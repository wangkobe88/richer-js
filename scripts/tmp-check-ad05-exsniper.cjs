const path = require('path');
require('dotenv').config({ path: __dirname + '/../config/.env' });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));
  const client = dbManager.getClient();
  const { data: sigs } = await client.from('strategy_signals')
    .select('metadata').eq('experiment_id', EXP).eq('token_address', TOKEN).eq('signal_type', 'BUY');
  const tf = sigs[0].metadata.trendFactors;
  console.log(JSON.stringify({
    tokenAgeSec: tf.tokenAgeSec,
    holderTrendSlope: tf.holderTrendSlope,
    holderTrendDataPoints: tf.holderTrendDataPoints,
    holderTrendSlopeExSniper: tf.holderTrendSlopeExSniper,
    holderTrendDataPointsExSniper: tf.holderTrendDataPointsExSniper,
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
