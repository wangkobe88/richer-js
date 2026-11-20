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
      if (!fires.has(key) || name === 'bt-v156') {
        const md = s.metadata || {};
        fires.set(key, { exp: name, token: s.token_address, sym: s.token_symbol, t: s.created_at,
          status: md.execution_status ?? 'executed', outcome: name === 'bt-v156' ? null : 'fam', pp: md.profitPercent });
      }
    }
  }
  console.log('token | 组/结局 | age | 均速 | r5 | r10 | r30 | r60 | r120 | r300 | 峰值5s(5min) | 减速比 r5/峰');
  for (const f of [...fires.values()].sort((a, b) => (a.exp > b.exp ? 1 : -1))) {
    const tFire = new Date(f.t).getTime();
    const { data: first } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', f.token).eq('price_outlier', false)
      .gt('price_bnb', 0).order('block_time', { ascending: true }).limit(1);
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', f.token).eq('price_outlier', false)
      .gt('price_bnb', 0)
      .gte('block_time', new Date(tFire - 950000).toISOString())
      .lte('block_time', new Date(tFire + 1000).toISOString())
      .order('block_time', { ascending: true }).limit(1500);
    const rel = ticks || [];
    const at = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire);
    if (!at || !first?.length) { console.log(`${f.sym} 数据缺`); continue; }
    const pF = at.price_bnb, tAt = new Date(at.block_time).getTime();
    const rate = W => {
      const p = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - W * 1000);
      if (!p) return null;
      const dt = (tAt - new Date(p.block_time).getTime()) / 60000;
      return dt > 0 ? ((pF / p.price_bnb - 1) * 100) / dt : null;
    };
    // 近5min峰值5s段速度
    let peak = 0;
    for (let i = 1; i < rel.length; i++) {
      const ti = new Date(rel[i].block_time).getTime();
      if (ti > tFire || ti < tFire - 300000) continue;
      const dt = ti - new Date(rel[i - 1].block_time).getTime();
      if (dt > 0 && dt <= 5000) {
        const r = ((rel[i].price_bnb / rel[i - 1].price_bnb - 1) * 100) / (dt / 60000);
        if (r > peak) peak = r;
      }
    }
    const r5 = rate(5), r30 = rate(30), r120 = rate(120), r300 = rate(300);
    const ageSec = (tAt - new Date(first[0].block_time).getTime()) / 1000;
    const life = ageSec > 0 ? ((pF / first[0].price_bnb - 1) * 100) / (ageSec / 60) : 0;
    const dec = peak > 0 && r5 !== null ? r5 / peak : null;
    const fm = v => v === null ? '  - ' : v.toFixed(0).padStart(4);
    console.log(`${f.sym.padEnd(10)} | ${f.exp}${f.status === 'blocked' ? '·拦' : ''} pp=${f.pp?.toFixed(0)} | ${String(Math.round(ageSec)).padStart(5)}s | life=${life.toFixed(0).padStart(4)} | r5=${fm(r5)} r10=${fm(rate(10))} r30=${fm(r30)} r60=${fm(rate(60))} r120=${fm(r120)} r300=${fm(r300)} | peak=${peak.toFixed(0).padStart(4)} | dec=${dec === null ? '-' : dec.toFixed(2)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
