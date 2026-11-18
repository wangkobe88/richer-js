const { dbManager } = require('../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
(async () => {
  const c = await dbManager.getClient();
  const ADDR='0x13ccc4b96a0561201211e7d37b1352d03ed37777';
  const { data: sig } = await c.from('strategy_signals')
    .select('id,created_at,metadata').eq('id','f21022c2-3b3a-45e2-9555-4e0336eecb74').single();
  const anchor = new Date(sig.created_at).getTime();
  const { data: ticks } = await c.from('wss_price_ticks')
    .select('block_time,trader_address,sender_address,trade_type,bnb_amount,price_bnb,price_outlier,block_number,log_index,tx_hash,token_amount')
    .eq('token_address', ADDR).order('block_time').limit(5000);
  const rows = ticks.filter(t => new Date(t.block_time).getTime() <= anchor);
  const anchorTickCount = rows.length;
  console.log('SI 买信号锚:', sig.created_at, '锚行数:', anchorTickCount);
  const snap = buildBuyPointSnapshot(rows, { address: ADDR }, { anchorTickCount, capped: false, signalInfo: {} });
  const bd = snap.buyDerived || {};
  const ft = bd.famousTraces;
  console.log(`curVs=${bd.currentVsLaunchPct} ath=${bd.athVsLaunchPct} minVs=${bd.minVsLaunchPct} chg30=${bd.chg30Pct} 总买=${(snap.cheatDerived?.totalBuyBnb||0).toFixed(3)} 总卖=${(snap.cheatDerived?.totalSellBnb||0).toFixed(3)}`);
  if (ft && ft.wallets.length) {
    console.log(`famous: n=${ft.wallets.length} 首买@${Math.min(...ft.wallets.map(e=>e.firstBuyDt).filter(x=>x!=null))}s 买${ft.groupBuyBnb} 卖${ft.groupSellBnb} 自卖比=${(ft.groupSellBnb/ft.groupBuyBnb).toFixed(3)} 在场净=${ft.presenceNetBnb} 在场数=${ft.inCustodyCount}`);
    for (const e of ft.wallets) console.log(`  ${e.w.slice(0,8)} 买${e.buyBnb} 卖${e.sellBnb} 净${e.netBnb} t+${e.firstBuyDt}s hold=${e.holdSec}s entry=${e.entryVsLaunchPct}%`);
  } else console.log('famous: 无');
  console.log('cheat exempt:', JSON.stringify(sig.metadata?.cheatCheck?.exempt||null), 'origGrade:', sig.metadata?.cheatCheck?.originalGrade);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
