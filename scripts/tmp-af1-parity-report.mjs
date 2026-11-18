// ============================================================================
// 临时工具（182 跑）：bt-v145（AF1 前置门）vs bt-v144（FP13 基线）对照报告
//   · 净收益/成交对照
//   · AF1 分流路径分布（actFrontGate.path 计数）
//   · Jev 配额账：cheat 真调次数对照（省额验证）
//   · 行为差异票：成交差集（v145 独有/ v144 独有）+ AF 拒票在 v144 的对应结果
// ============================================================================
import { dbManager } from '../src/services/dbManager.js';

const V144 = { id: 'a869d119-c389-47e0-89ce-89e86114ad0e', name: 'bt-v144' };
const V145 = { id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d', name: 'bt-v145' };

const c = await dbManager.getClient();
async function page(table, eqExp, cols) {
  const out = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols)
      .eq('experiment_id', eqExp).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

const result = {};
for (const e of [V144, V145]) {
  const sigs = await page('strategy_signals', e.id, 'id,signal_type,token_address,token_symbol,created_at,executed,metadata');
  const buys = sigs.filter(s => s.signal_type === 'BUY');
  let cheatGraded = 0, cheatReal = 0, bpAssessed = 0, afAssessed = 0;
  const paths = {};
  const afFail = {};
  for (const s of buys) {
    const md = s.metadata || {};
    const cc = md.cheatCheck || {};
    if (cc.grade) cheatGraded++;
    if (cc.grade && cc.cached !== true) cheatReal++;
    if (md.buyPoint && md.buyPoint.status === 'assessed') bpAssessed++;
    const af = md.actFrontGate || null;
    if (af && af.status === 'assessed') { afAssessed++; paths[af.path] = (paths[af.path] || 0) + 1; }
    else if (af) afFail[af.status] = (afFail[af.status] || 0) + 1;
  }
  const trs = await page('trades', e.id, 'token_address,trade_direction,input_amount,output_amount');
  let buy = 0, sell = 0;
  const perToken = new Map();
  for (const t of trs) {
    const k = (t.token_address || '').toLowerCase();
    const o = perToken.get(k) || { buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') { buy += Number(t.input_amount) || 0; o.buy += Number(t.input_amount) || 0; }
    else { sell += Number(t.output_amount) || 0; o.sell += Number(t.output_amount) || 0; }
    perToken.set(k, o);
  }
  result[e.name] = {
    buySignals: buys.length, executed: buys.filter(s => s.executed).length,
    cheatGraded, cheatReal, bpAssessed, afAssessed, paths, afFail,
    net: +(sell - buy).toFixed(4),
    tokens: [...perToken.entries()].map(([k, v]) => ({ token: k, net: +(v.sell - v.buy).toFixed(4) })).filter(x => x.net !== 0),
  };
}

console.log('===== 总账对照 =====');
for (const n of ['bt-v144', 'bt-v145']) {
  const r = result[n];
  console.log(`${n}: 净=${r.net} 信号=${r.buySignals} 成交信号=${r.executed} cheat真调=${r.cheatReal} BP评估=${r.bpAssessed}`);
  if (n === 'bt-v145') {
    console.log(`  AF1: assessed=${r.afAssessed} 路径分布=${JSON.stringify(r.paths)} 故障=${JSON.stringify(r.afFail)}`);
  }
}
const saved = result['bt-v144'].cheatReal - result['bt-v145'].cheatReal;
console.log(`\ncheat 真调省额: ${result['bt-v144'].cheatReal} → ${result['bt-v145'].cheatReal}（${saved >= 0 ? '省' : '增'} ${Math.abs(saved)} 次×10 题 = ${Math.abs(saved) * 10} 题）`);

// 成交差集
const net144 = new Map(result['bt-v144'].tokens.map(t => [t.token, t.net]));
const net145 = new Map(result['bt-v145'].tokens.map(t => [t.token, t.net]));
const all = new Set([...net144.keys(), ...net145.keys()]);
console.log('\n===== 净收益差集（per token） =====');
for (const k of all) {
  const a = net144.get(k) ?? null, b = net145.get(k) ?? null;
  if (a === null || b === null || Math.abs((a || 0) - (b || 0)) > 1e-9) {
    console.log(`  ${k.slice(0, 12)} v144=${a === null ? '—' : a.toFixed(4)} v145=${b === null ? '—' : b.toFixed(4)}`);
  }
}
const sumDiff = result['bt-v145'].net - result['bt-v144'].net;
console.log(`\n净差 v145−v144 = ${sumDiff >= 0 ? '+' : ''}${sumDiff.toFixed(4)}`);
process.exit(0);
