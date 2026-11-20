const { dbManager } = require('../src/services/dbManager');
const EXPS = {
  'd345': 'd3453504-03d5-480c-89e0-483db930361c',
  'bt-v150': '8ebaccce-62c6-4209-a2a0-40f361c49bf9',
  'bt-v156': 'b8ae9f2e-832f-42db-bbda-8d8701aecb63',
};
(async () => {
  const c = dbManager.getClient();
  const fires = [];
  for (const [name, id] of Object.entries(EXPS)) {
    const { data: sigs } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at,metadata')
      .eq('experiment_id', id).eq('signal_type', 'SELL')
      .eq('metadata->>strategyId', 'sell_2_5')
      .order('created_at', { ascending: true }).limit(100);
    for (const s of sigs || []) fires.push({ exp: name, token: s.token_address, sym: s.token_symbol, t: s.created_at, fsfChg5: s.metadata?.factorSellFilter?.chg5Pct, status: s.metadata?.execution_status ?? 'executed' });
  }
  console.log('exp | token | 触发时刻 | 状态 | tick重算chg5% | FSF快照chg5');
  for (const f of fires) {
    const tFire = new Date(f.t).getTime();
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier')
      .eq('token_address', f.token)
      .gte('block_time', new Date(tFire - 70000).toISOString())
      .lte('block_time', new Date(tFire + 5000).toISOString())
      .order('block_time', { ascending: true }).limit(400);
    const rel = (ticks || []).filter(x => !x.price_outlier);
    const atFire = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire);
    const fiveBefore = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - 5000);
    const tenBefore = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - 10000);
    let chg5 = null, chg10 = null;
    if (atFire && fiveBefore) chg5 = (atFire.price_bnb / fiveBefore.price_bnb - 1) * 100;
    if (atFire && tenBefore) chg10 = (atFire.price_bnb / tenBefore.price_bnb - 1) * 100;
    console.log(`${f.exp} | ${f.sym} | ${f.t.slice(5, 19)} | ${f.status} | chg5=${chg5 === null ? 'null' : chg5.toFixed(2)}% chg10=${chg10 === null ? 'null' : chg10.toFixed(2)}% | ${f.fsfChg5 ?? '-'}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
