// 一次性查询 2：dump 最后一笔卖出信号完整 metadata + 卖腿 name 映射 + trades
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const TOKEN = '0xc50a297634f887496988c45cdfcb0a516e2b7777';

async function main() {
  const client = await dbManager.getClient();

  // 1. 卖腿完整键（找 name 映射）
  const { data: exp } = await client.from('experiments').select('config').eq('id', EXP).limit(1);
  const sells = exp[0]?.config?.strategiesConfig?.sellStrategies || [];
  sells.forEach((l, i) => {
    console.log(`[${i}] keys=${Object.keys(l).join(',')}`);
    console.log(`    id=${l.id} name=${l.name} label=${l.label} strategyName=${l.strategyName} cond=${(l.condition || '').slice(0, 80)}`);
  });

  // 2. 四笔卖出信号完整 metadata（挑关键字段打印全量 JSON 的子集）
  const { data: sigs } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,action,executed,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  const sellSigs = (sigs || []).filter(s => s.action === 'sell');
  for (const s of sellSigs) {
    const m = s.metadata || {};
    console.log(`\n--- SELL ${s.created_at} strat=${m.strategyId}/${m.strategyName} executed=${s.executed}`);
    const keys = ['profitPercent', 'holdDuration', 'realHoldDuration', 'peakProfitPct', 'drawdownFromHighestSinceLastBuy',
      'secSincePeak', 'secSinceMcapPeak', 'mcapPeakBnb', 'mcapRiseHalfSec', 'marketCap', 'currentPriceBnb', 'buyPriceBnb',
      'sinceEntryNetBuyRatio', 'graduationProgress', 'sellPercentage', 'cards', 'cardTrade', 'bypassDebounce', 'priority'];
    for (const k of keys) if (m[k] !== undefined) console.log(`    ${k}=${JSON.stringify(m[k])}`);
  }

  // 3. trades
  const { data: trades, error: tErr } = await client.from('trades')
    .select('id,created_at,trade_direction,trade_status,success,unit_price,input_amount,output_amount,metadata,signal_id')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (tErr) throw tErr;
  console.log('\n=== 成交 ===');
  for (const t of trades) {
    const m = t.metadata || {};
    console.log(`${t.created_at} | ${t.trade_direction} ${t.trade_status} | ok=${t.success} | unit=${t.unit_price}` +
      ` | in=${t.input_amount} out=${t.output_amount}`);
    if (m.cardTrade) console.log(`    cardTrade=${JSON.stringify(m.cardTrade)}`);
    if (m.strategyName || m.strategyId) console.log(`    strat=${m.strategyId}/${m.strategyName}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
