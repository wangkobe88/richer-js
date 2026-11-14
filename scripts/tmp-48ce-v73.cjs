// v73 配置（stallClose 段+卖腿）+ 0x48ce 卖出信号 fire 快照
const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const TOKEN = '0x48ce79731e040194fcfa71496a94090a28f57777';

async function main() {
  const client = await dbManager.getClient();

  const { data: exp } = await client.from('experiments').select('config,started_at').eq('id', EXP).limit(1);
  const cfg = exp[0]?.config || {};
  console.log('started_at=', exp[0]?.started_at);
  console.log('stallClose 段 =', JSON.stringify(cfg.stallClose ?? null));
  console.log('fourmemeWs.stallClose =', JSON.stringify(cfg.fourmemeWs?.stallClose ?? null));
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  sells.forEach((l, i) => {
    console.log(`[${i}] P=${l.priority} cards=${JSON.stringify(l.cards)} cd=${l.cooldownSec ?? '-'} maxEx=${l.maxExecutions ?? '-'} :: ${(l.condition || '').slice(0, 100)}`);
  });
  console.log('买腿数 =', (cfg.strategiesConfig?.buyStrategies || []).length);

  // 卖出信号快照
  const { data: sigs } = await client.from('strategy_signals')
    .select('id,created_at,executed,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  for (const s of (sigs || [])) {
    const m = s.metadata || {};
    if (s.action !== 'sell') continue;
    const tf = m.trendFactors || {};
    console.log(`\n=== SELL ${s.created_at} strat=${m.strategyId}/${m.strategyName} executed=${s.executed}`);
    for (const k of ['profitPercent', 'holdDuration', 'realHoldDuration', 'peakProfitPct', 'drawdownFromHighest',
      'drawdownFromHighestSinceLastBuy', 'secSincePeak', 'secSinceMcapPeak', 'mcapPeakBnb', 'mcapRiseHalfSec',
      'marketCap', 'currentPrice', 'buyPrice', 'tokenAgeSec', 'graduationProgress', 'sinceEntryNetBuyRatio',
      'gmgnEntryChecked', 'gmgnEntryPresent', 'tradeCount', 'lastPriceAt', 'lastTickAt']) {
      if (tf[k] !== undefined) console.log(`  ${k}=${JSON.stringify(tf[k])}`);
    }
    if (m.tradeResult) console.log(`  trade.ok=${m.tradeResult.success} unit=${m.tradeResult.trade?.unitPrice}`);
  }

  // 成交
  const { data: trades } = await client.from('trades')
    .select('created_at,trade_direction,trade_status,success,unit_price,input_amount,output_amount,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  console.log('\n=== 成交 ===');
  for (const t of trades || []) {
    console.log(`${t.created_at} | ${t.trade_direction} | ok=${t.success} | unit=${t.unit_price} | in=${t.input_amount} out=${t.output_amount}` +
      `${t.metadata?.cardTrade ? ' | card=' + JSON.stringify(t.metadata.cardTrade) : ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
