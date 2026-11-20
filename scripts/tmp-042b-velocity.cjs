const { dbManager } = require('../src/services/dbManager');
const EXPS = {
  'd345': 'd3453504-03d5-480c-89e0-483db930361c',
  'd345b': 'c73b62be-bb1d-4acf-8002-652e5fb8a507',
  'bt-v150': '8ebaccce-62c6-4209-a2a0-40f361c49bf9',
  'bt-v156': 'b8ae9f2e-832f-42db-bbda-8d8701aecb63',
};
(async () => {
  const c = dbManager.getClient();
  const fires = new Map();
  for (const [name, id] of Object.entries(EXPS)) {
    const { data: sigs } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at,metadata')
      .eq('experiment_id', id).eq('signal_type', 'SELL')
      .eq('metadata->>strategyId', 'sell_2_5')
      .order('created_at', { ascending: true }).limit(100);
    for (const s of sigs || []) {
      const key = s.token_address + '|' + Math.floor(new Date(s.created_at).getTime() / 60000);
      if (!fires.has(key)) fires.set(key, { exp: name, token: s.token_address, sym: s.token_symbol, t: s.created_at, status: s.metadata?.execution_status ?? 'executed' });
      else { const f = fires.get(key); if (name === 'bt-v156') { f.exp = name; f.t = s.created_at; f.status = s.metadata?.execution_status; } }
    }
  }
  console.log('组 | token | 触发 | chg5% | 触发时较发行价% | 距首tick秒 | 均速pp/min | 前60s涨% | 前120s最大5s段%');
  const rows = [];
  for (const f of fires.values()) {
    const tFire = new Date(f.t).getTime();
    const { data: first } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', f.token).eq('price_outlier', false)
      .gt('price_bnb', 0).order('block_time', { ascending: true }).limit(1);
    if (!first?.length) { console.log(`${f.exp} | ${f.sym} | 无首tick`); continue; }
    const t0 = new Date(first[0].block_time).getTime(), p0 = first[0].price_bnb;
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', f.token).eq('price_outlier', false)
      .gt('price_bnb', 0)
      .gte('block_time', new Date(tFire - 130000).toISOString())
      .lte('block_time', new Date(tFire + 5000).toISOString())
      .order('block_time', { ascending: true }).limit(600);
    const rel = ticks || [];
    const atFire = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire);
    const pF = atFire?.price_bnb;
    if (!pF) { console.log(`${f.exp} | ${f.sym} | 触发点无可靠价`); continue; }
    const ageSec = (new Date(atFire.block_time).getTime() - t0) / 1000;
    const gainLaunch = (pF / p0 - 1) * 100;
    const vel = ageSec > 0 ? gainLaunch / ageSec * 60 : null;
    const p60 = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - 60000);
    const gain60 = p60 ? (pF / p60.price_bnb - 1) * 100 : null;
    // 前120s最大5s段涨幅（相邻可靠价，间隔≤5s）
    let max5 = null;
    for (let i = rel.length - 1; i >= 0; i--) {
      const ti = new Date(rel[i].block_time).getTime();
      if (ti > tFire) continue;
      for (let j = i - 1; j >= 0; j--) {
        const tj = new Date(rel[j].block_time).getTime();
        if (ti - tj > 5000) break;
        const g = (rel[i].price_bnb / rel[j].price_bnb - 1) * 100;
        if (max5 === null || g > max5) max5 = g;
        break; // 只取紧邻前一笔
      }
    }
    rows.push({ exp: f.exp, sym: f.sym, t: f.t, status: f.status, token: f.token, tFire,
      chg5: p60 ? null : null, gainLaunch, ageSec, vel, gain60, max5 });
    console.log(`${f.exp}${f.status === 'blocked' ? '·拦' : ''} | ${f.sym} | ${f.t.slice(5, 16)} | age=${ageSec.toFixed(0)}s | 触发较发行=${gainLaunch.toFixed(1)}% | 均速=${vel === null ? '-' : vel.toFixed(1)}pp/min | 前60s=${gain60 === null ? '-' : gain60.toFixed(1)}% | max5s=${max5 === null ? '-' : max5.toFixed(1)}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
