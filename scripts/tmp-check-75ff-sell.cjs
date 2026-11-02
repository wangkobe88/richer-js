// 0x75ff 刚买就卖排查：trades + strategy_signals 单条读取
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'aed2091d-f22f-4660-ae62-42f48a9048de';
const ADDR = '0x75ff7483bda6ba5d4cd3c7808f752274af007777';

(async () => {
  const db = dbManager.getClient();

  const { data: trades, error: e1 } = await db
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e1) throw e1;
  console.log('=== trades 行数:', trades.length);
  for (const t of trades) {
    console.log('---', t.created_at, '| side:', t.side, '| status:', t.status,
      '| qty:', t.quantity, '| bnb:', t.bnb_amount, '| price:', t.price_bnb || t.token_price_bnb);
    if (t.metadata) {
      const m = t.metadata;
      console.log('    metadata keys:', Object.keys(m).join(','));
      for (const k of ['tradeResult', 'failReason', 'cardTrade', 'sellReason', 'profitPercent', 'reason']) {
        if (m[k] !== undefined) console.log('   ', k + ':', JSON.stringify(m[k]).slice(0, 2000));
      }
    }
    if (t.transaction_hash) console.log('    tx:', t.transaction_hash);
  }

  const { data: sigs, error: e2 } = await db
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e2) throw e2;
  console.log('\n=== strategy_signals 行数:', sigs.length);
  for (const s of sigs) {
    console.log('---', s.created_at, '| type:', s.signal_type, '| action:', s.action,
      '| status:', s.status, '| leg:', s.strategy_name || s.leg_name || s.strategy_id);
    if (s.signal_type === 'SELL') {
      const m = s.metadata || {};
      const tf = m.trendFactors || {};
      console.log('    strategyId:', m.strategyId, '| strategyName:', m.strategyName);
      console.log('    idleSecSinceLastTick:', tf.idleSecSinceLastTick, '| secSincePeak:', tf.secSincePeak,
        '| actTrades:', tf.actTrades, '| profitPercent:', tf.profitPercent, '| holdDuration:', tf.holdDuration,
        '| realHoldDuration:', tf.realHoldDuration);
    }
  }

  // 后续价格走势（该 token 全部 tick，活跃期短预计量小）
  const { data: ticks, error: e3, count } = await db
    .from('wss_price_ticks')
    .select('price_bnb,block_time', { count: 'exact' })
    .eq('token_address', ADDR)
    .eq('price_outlier', false)
    .order('block_time', { ascending: true })
    .limit(2000);
  if (e3) throw e3;
  console.log('\n=== wss_price_ticks 行数:', count);
  if (ticks && ticks.length) {
    let hi = -Infinity, hiT = null;
    for (const t of ticks) { if (t.price_bnb > hi) { hi = t.price_bnb; hiT = t.block_time; } }
    const last = ticks[ticks.length - 1];
    const first = ticks[0];
    console.log('首 tick:', first.block_time, first.price_bnb);
    console.log('最高:', hiT, hi);
    console.log('末 tick:', last.block_time, last.price_bnb);
    // 卖出执行时刻 15:59:59 后的最高/末价
    const sellExec = '2026-10-29T15:59:59';
    const after = ticks.filter(t => t.block_time >= sellExec);
    if (after.length) {
      let ahi = -Infinity, ahiT = null;
      for (const t of after) { if (t.price_bnb > ahi) { ahi = t.price_bnb; ahiT = t.block_time; } }
      console.log('卖出后最高:', ahiT, ahi, '| 卖出后末价:', after[after.length - 1].block_time, after[after.length - 1].price_bnb);
    } else {
      console.log('卖出执行时刻后无 tick');
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
