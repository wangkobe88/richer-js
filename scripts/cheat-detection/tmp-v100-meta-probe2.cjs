// 一次性探针（182 跑）：bt-v100 首 BUY 信号 metadata 顶层键 + buyPoint.anchors 键集 + 价格键位置。
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,created_at,metadata').eq('experiment_id', EXP).eq('signal_type', 'BUY')
    .order('id').limit(1);
  if (error) throw new Error(error.message);
  const m = typeof data[0].metadata === 'string' ? JSON.parse(data[0].metadata) : data[0].metadata;
  console.log('top keys:', Object.keys(m).join(','));
  console.log('price-ish:', ['price', 'currentPriceBnb', 'firePriceBnb', 'tokenPrice', 'priceBnb'].map((k) => k + '=' + m[k]).join(' | '));
  const fr = m.factorResults || m.factors || {};
  console.log('factorResults price keys:', ['currentPriceBnb', 'priceBnb', 'relPriceBnb'].map((k) => k + '=' + fr[k]).join(' | '));
  const bp = m.buyPoint || {};
  console.log('buyPoint keys:', Object.keys(bp).join(','));
  console.log('anchors:', JSON.stringify(bp.anchors || {}).slice(0, 600));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
