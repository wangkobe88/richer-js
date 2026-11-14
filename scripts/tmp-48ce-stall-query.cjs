// 一次性查询：v72 票 0x48ce...7777 信号+成交时间线（为何没走断流卖出臂）
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const TOKEN = '0x48ce79731e040194fcfa71496a94090a28f57777';

async function main() {
  const client = await dbManager.getClient();

  const { data: sigs, error: sigErr } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,action,executed,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  if (sigErr) throw sigErr;
  console.log('=== 信号 ===');
  for (const s of sigs) {
    const m = s.metadata || {};
    const tf = m.trendFactors || {};
    console.log(`${s.created_at} | ${s.signal_type} ${s.action} | executed=${s.executed}` +
      ` | strat=${m.strategyId ?? m.strategyName ?? (m.observeReason ?? '')}` +
      ` | price=${m.price ?? tf.currentPrice ?? '?'}` +
      ` | profit%=${tf.profitPercent ?? '?'} hold=${tf.holdDuration ?? '?'} realHold=${tf.realHoldDuration ?? '?'}` +
      ` | lastTickAt=${tf.lastTickAt ?? '?'}`);
  }

  const { data: trades, error: tErr } = await client.from('trades')
    .select('id,created_at,trade_direction,trade_status,success,unit_price,input_amount,output_amount,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (tErr) throw tErr;
  console.log('\n=== 成交 ===');
  for (const t of trades) {
    const m = t.metadata || {};
    console.log(`${t.created_at} | ${t.trade_direction} ${t.trade_status} | ok=${t.success} | unit=${t.unit_price}` +
      ` | in=${t.input_amount} out=${t.output_amount}` +
      `${m.cardTrade ? ' | card=' + JSON.stringify(m.cardTrade) : ''}`);
  }

  // 买信号 fire 快照关键域（tokenAgeSec/首tick 时间线）
  const buys = sigs.filter(s => s.action === 'buy');
  for (const b of buys.slice(-1)) {
    const tf = b.metadata?.trendFactors || {};
    console.log('\n=== 最后买信号 fire 快照 ===');
    for (const k of ['tokenAgeSec', 'age', 'firstPrice', 'currentPrice', 'marketCap', 'buyPriceBnb',
      'buySignalAt', 'buyExecutedAt', 'cheatGrade', 'narrativeRating']) {
      if (tf[k] !== undefined || b.metadata?.[k] !== undefined) console.log(`  ${k}=${JSON.stringify(tf[k] ?? b.metadata[k])}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
