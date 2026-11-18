// 一次性诊断：bt-v140 票 0x2e51…7777 famous 买入后为何没立即全部卖出
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x2e51a5455bf55af69f513ad170fb5d8c561f7777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b'; // bt-v140

(async () => {
  const c = await dbManager.getClient();

  // 0) 卖腿配置（famous 相关）
  const { data: exp } = await c.from('experiments')
    .select('config').eq('id', EXP).limit(1);
  const sells = ((exp[0].config || {}).strategiesConfig || {}).sellStrategies || [];
  console.log(`卖腿数=${sells.length}`);
  for (const l of sells) {
    const s = JSON.stringify(l);
    if (/famous|factorSellFilter|trim/i.test(s)) {
      console.log(`\n--- 卖腿 ${l.strategyId || l.name || '?'} ---`);
      console.log(s.slice(0, 1500));
    }
  }
  const fsf = (exp[0].config || {}).fourmemeWs || {};
  console.log(`\nfactorSellFilter 段=${JSON.stringify(fsf.factorSellFilter)}`);

  // 1) 信号行（全量时间线）
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,execution_status,created_at,metadata,strategy_id')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log(`\n信号行数=${sigs.length}`);
  for (const s of sigs) {
    console.log(`\n=== signal ${s.id} ${s.signal_type}/${s.action} ${s.execution_status} ${s.created_at} strategy=${s.strategy_id}`);
    const md = s.metadata || {};
    const findF = (o, path = '', out = []) => {
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          const p = path ? `${path}.${k}` : k;
          if (/famous/i.test(k)) out.push([p, v]);
          if (v && typeof v === 'object') findF(v, p, out);
        }
      }
      return out;
    };
    for (const [p, v] of findF(md)) console.log(`  ${p} = ${JSON.stringify(v)}`);
    const snap = md.factorResults || md.factors || null;
    if (snap) {
      const keys = ['sinceEntryFamousNearLaunchBuyBnb','sinceEntryFamousNearLaunchBuys','sinceEntryFamousLaunchZoneBuyBnb','sinceEntryFamousLaunchZoneNetBnb','sinceEntryEqualBundleWallets','profitPercent','realHoldDuration','currentVsLaunchPct','sinceLastFamousBigBuySec','recentFamousSellBnb'];
      console.log('  -- factor snapshot --');
      for (const k of keys) if (k in snap) console.log(`     ${k} = ${JSON.stringify(snap[k])}`);
    }
  }

  // 2) 成交
  const { data: trades } = await c.from('trades')
    .select('id,side,amount_bnb,token_amount,price_bnb,created_at,metadata,strategy_id')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log(`\n成交行数=${trades.length}`);
  for (const t of trades) console.log(`  ${t.created_at} ${t.side} bnb=${t.amount_bnb} px=${t.price_bnb} strategy=${t.strategy_id}`);

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
