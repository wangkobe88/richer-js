// bt-v148 价格门 0 对照报告（182 跑）。口径（用户裁定 2026-11-18）：
// 只统计 12 条 0 门臂（P1~P12）成交；RL15(buy_12_13)/RL10(buy_13_14) 触发成交全剔除；
// v147 同口径剔除同两臂作对照。净盈亏=per token Σ卖(BNB out)−Σ买(BNB in)，仅 success 行。
const { dbManager } = require('../src/services/dbManager.js');
const EXPS = {
  v147: '9b31baf4-bdd3-4ebb-9031-2a1603f34633',
  v148: '6d335514-4319-4c40-a068-b97de509bcbd',
};
const RL_IDS = new Set(['buy_12_13', 'buy_13_14']);

async function pullAll(table, expId) {
  const c = await dbManager.getClient();
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from(table).select('*').eq('experiment_id', expId).order('id').range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function legOf(t, sigMap) {
  const m = t.metadata || {};
  if (m.strategyId) return m.strategyId;
  if (m.signal && m.signal.strategyId) return m.signal.strategyId;
  return sigMap.get(t.signal_id) || null;
}

// 递归找因子值（signal metadata 里 currentVsLaunchPct 的落点形状不硬编码）
function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

async function load(name) {
  const trades = await pullAll('trades', EXPS[name]);
  const sigs = await pullAll('strategy_signals', EXPS[name]);
  const sigMap = new Map();
  const buySigs = [];
  for (const s of sigs) {
    if (s.signal_type !== 'BUY') continue;
    const leg = (s.metadata || {}).strategyId || null;
    sigMap.set(s.id, leg);
    buySigs.push({ id: s.id, token: s.token_address, leg, at: s.created_at, md: s.metadata || {} });
  }
  const byToken = new Map();
  for (const t of trades) {
    if (!t.success) continue;
    const addr = t.token_address;
    let st = byToken.get(addr);
    if (!st) { st = { symbol: t.token_symbol || '', buys: [], sells: [], netBnb: 0 }; byToken.set(addr, st); }
    const isBuy = t.trade_direction === 'buy';
    const bnb = isBuy ? Number(t.input_amount) : Number(t.output_amount);
    if (!isFinite(bnb)) continue;
    st.netBnb += isBuy ? -bnb : bnb;
    const at = t.executed_at || t.created_at;
    if (isBuy) st.buys.push({ bnb, leg: legOf(t, sigMap), at });
    else st.sells.push({ bnb, at });
  }
  for (const st of byToken.values()) {
    st.buys.sort((a, b) => new Date(a.at) - new Date(b.at));
    st.firstLeg = st.buys.length ? st.buys[0].leg : null;
  }
  return { name, byToken, buySigs };
}

function agg(byToken, filter) {
  let n = 0, net = 0, wins = 0;
  const rows = [];
  for (const [addr, st] of byToken) {
    if (st.buys.length === 0) continue;
    if (filter && !filter(st)) continue;
    n++; net += st.netBnb;
    if (st.netBnb > 0) wins++;
    rows.push({ addr, symbol: st.symbol, net: st.netBnb, firstLeg: st.firstLeg });
  }
  return { n, net, wins, rows };
}

function fmt(x) { return (x >= 0 ? '+' : '') + x.toFixed(4); }

(async () => {
  const A = await load('v147');
  const B = await load('v148');
  console.log('=== 信号量（BUY 信号行，按腿） ===');
  for (const D of [A, B]) {
    const byLeg = new Map();
    for (const s of D.buySigs) {
      const k = s.leg || 'unknown';
      byLeg.set(k, (byLeg.get(k) || 0) + 1);
    }
    const rl = (byLeg.get('buy_12_13') || 0) + (byLeg.get('buy_13_14') || 0);
    const zero = D.buySigs.length - rl;
    console.log(D.name + ': BUY 信号总数=' + D.buySigs.length + ' | 0门12臂=' + zero + ' | RL两臂=' + rl + ' | 分腿=' + JSON.stringify([...byLeg]));
  }

  console.log('\n=== 成交与盈亏（token 级，首买腿归属） ===');
  const zeroFilter = (st) => st.firstLeg && !RL_IDS.has(st.firstLeg);
  const rlFilter = (st) => st.firstLeg && RL_IDS.has(st.firstLeg);
  for (const D of [A, B]) {
    const all = agg(D.byToken);
    const z = agg(D.byToken, zeroFilter);
    const r = agg(D.byToken, rlFilter);
    console.log(D.name + ':');
    console.log('  全量      : ' + all.n + ' 票 | 净 ' + fmt(all.net) + ' | 胜 ' + all.wins + '/' + all.n);
    console.log('  0门臂口径 : ' + z.n + ' 票 | 净 ' + fmt(z.net) + ' | 胜 ' + z.wins + '/' + z.n + '  ← 主对照');
    console.log('  RL臂(剔除): ' + r.n + ' 票 | 净 ' + fmt(r.net) + ' | 胜 ' + r.wins + '/' + r.n);
  }

  console.log('\n=== 差集：v147 0门臂成交 vs v148 0门臂成交（token 级） ===');
  const aMap = new Map(agg(A.byToken, zeroFilter).rows.map((r) => [r.addr, r]));
  const bMap = new Map(agg(B.byToken, zeroFilter).rows.map((r) => [r.addr, r]));
  const dropped = [...aMap.values()].filter((r) => !bMap.has(r.addr));
  const gained = [...bMap.values()].filter((r) => !aMap.has(r.addr));
  const both = [...aMap.values()].filter((r) => bMap.has(r.addr));
  const dNet = dropped.reduce((s, r) => s + r.net, 0);
  const gNet = gained.reduce((s, r) => s + r.net, 0);
  const bothDrift = both.reduce((s, r) => s + (bMap.get(r.addr).net - r.net), 0);
  console.log('被 0 门拦掉（v147 买 v148 未买）: ' + dropped.length + ' 票, v147 净 ' + fmt(dNet) + '（放弃的机会成本）');
  console.log('v148 新买（v147 未买）          : ' + gained.length + ' 票, v148 净 ' + fmt(gNet));
  console.log('两版同买                       : ' + both.length + ' 票, 净差漂移 ' + fmt(bothDrift) + '（门链 Jev 方差）');

  // 被拦票的买点 curVs（取 v147 首个 BUY 信号 metadata 里的因子值）
  const sigByToken = new Map();
  for (const s of A.buySigs) {
    if (!sigByToken.has(s.token)) sigByToken.set(s.token, s);
  }
  const droppedSorted = dropped.slice().sort((x, y) => y.net - x.net);
  console.log('\n=== 被拦票明细（v147 盈亏降序，curVs=买腿触发时因子） ===');
  for (const r of droppedSorted) {
    const sig = sigByToken.get(r.addr);
    const cv = sig ? findKey(sig.md, 'currentVsLaunchPct') : undefined;
    console.log('  ' + (r.symbol || '').padEnd(14) + r.addr.slice(0, 10) + '… | net ' + fmt(r.net).padStart(9) + ' | leg ' + r.firstLeg + ' | curVs ' + (cv === undefined ? '?' : (typeof cv === 'number' ? cv.toFixed(2) : String(cv))) + '%');
  }
  const dPos = dropped.filter((r) => r.net > 0).length;
  console.log('被拦票正负: ' + dPos + ' 正 / ' + (dropped.length - dPos) + ' 负');

  console.log('\n=== v148 新买明细（若有） ===');
  for (const r of gained.sort((x, y) => y.net - x.net)) {
    console.log('  ' + (r.symbol || '').padEnd(14) + r.addr.slice(0, 10) + '… | net ' + fmt(r.net).padStart(9) + ' | leg ' + r.firstLeg);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
