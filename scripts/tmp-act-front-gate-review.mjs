// ============================================================================
// 临时工具（182 跑）：活跃度前置门提案数据验证
//   提案：cheat 题集拆前置小门（activity_level + wash_pair 对倒 [+sbw]），
//         high→跳过 cheat 直接 BP / low|ultra→直接拒 / mid→照跑全链
//   验证口径（bt-v141/142/143，现行 D3.77/G22 + FP13 题集）：
//   1) cheat 门 activityLevel 档位分布（信号行级 / token 首判级 / 真调行级）→ mid 比例
//   2) act × 最终 grade 交叉表 + high 档被拒票全量分解（提案唯一丢的拦截面）
//   3) low/ultra ∧ sbw=burst 豁免放行面（前置直接拒的误杀面）
//   4) mid 档 cheat 拒率（提案照跑不变的验证）
//   5) FP2 机械 act 臂（factorCheck.arms act_low/act_ultra）与 cheat Jev 档重叠度
//   6) 盈亏配对（trades 净额）+ 差异面票锚后 10min 前向最大涨幅
// 输出 /tmp/act-front-gate-review.json + 控制台表格
// ============================================================================
import { dbManager } from '../src/services/dbManager.js';

const EXPS = [
  { id: '3916fb15-66a1-45f0-bde1-1c145513817a', name: 'bt-v141' },
  { id: '8a7b6b09-e2bc-4773-8393-a696821ff531', name: 'bt-v142' },
  { id: 'e5941591-df22-4434-ae29-1a93ced0f841', name: 'bt-v143' },
];
const FWD_SEC = 600;

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

// ---- 1) BUY 信号全量 ----
const rows = [];
for (const e of EXPS) {
  const sigs = await page('strategy_signals', e.id,
    'id,signal_type,token_address,token_symbol,created_at,executed,metadata');
  for (const s of sigs) {
    if (s.signal_type !== 'BUY' && s.signal_type !== 'buy') continue;
    const cc = s.metadata?.cheatCheck || null;
    rows.push({
      exp: e.name, expId: e.id, id: s.id,
      token: (s.token_address || '').toLowerCase(), symbol: s.token_symbol,
      at: s.created_at, executed: s.executed,
      failMsg: null,
      cc,
      fc: s.metadata?.factorCheck || null,
      bp: s.metadata?.buyPoint || null,
    });
  }
  console.log(`${e.name}: BUY 累计 ${rows.length}`);
}

// ---- 2) 解析档位/grade ----
// levels=数值档（CHEAT_LEVEL_SCORES：activity low/mid/high/ultra=0/1/2/3、
// sbw none/burst=0/1、washPair none/weak/moderate/strong=0/1/2/3）
const ACT = ['low', 'mid', 'high', 'ultra'];
const LV4 = ['none', 'weak', 'moderate', 'strong'];
const lv = (r) => r.cc?.levels || {};
const pick = (r) => ({
  act: ACT[lv(r).activityLevel] ?? null,
  actNum: lv(r).activityLevel ?? null,
  sbw: lv(r).stallBurstWave === 1,
  wash: LV4[lv(r).washPair] ?? (r.cc?.buckets?.wash_pair ?? null),
  grade: r.cc?.grade ?? null,
  exempt: r.cc?.exempt ?? null,
  exemptDenied: r.cc?.exemptDenied ?? null,
  reasons: (r.cc?.reasons || []).map(x => x.code),
  cached: r.cc?.cached === true,
  status: r.cc?.status ?? null,
});
for (const r of rows) Object.assign(r, pick(r));
// wash 档位兜底：buckets.wash_pair（字符串原值）
for (const r of rows) {
  if (r.wash === null && r.cc?.buckets?.wash_pair) r.wash = r.cc.buckets.wash_pair;
}

// 同 token 后续信号档位漂移统计（拉黑语义差异面：low 首判票后续是否漂到 high）
const drift = { lowToHigh: [], lowToMid: 0 };
const byTokAll = new Map(); // token（跨 exp）→ 全部行
for (const r of withCheatArr()) byTokAll.set(r.token, [...(byTokAll.get(r.token) || []), r]);
function withCheatArr() { return rows.filter(r => r.cc && r.grade); }

const cnt = (arr, fn) => arr.filter(fn).length;
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';

// ---- 3) 分布统计 ----
const withCheat = rows.filter(r => r.cc && r.grade); // 有 cheat 门结果的行
const firstPerToken = new Map(); // (exp|token) 首判行
for (const r of withCheat) {
  const k = `${r.exp}|${r.token}`;
  if (!firstPerToken.has(k)) firstPerToken.set(k, r);
}
const tokFirst = [...firstPerToken.values()];
const realCalls = tokFirst.filter(r => !r.cached); // 首判即真调

console.log('\n===== A. activityLevel 档位分布 =====');
function dist(label, arr) {
  const g = {}; for (const r of arr) g[r.act] = (g[r.act] || 0) + 1;
  const tot = arr.length;
  console.log(`${label} (n=${tot}): ` + Object.entries(g).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k ?? 'null'}=${v}(${pct(v, tot)})`).join(' / '));
  return g;
}
dist('信号行级 ', withCheat);
dist('token 首判 ', tokFirst);
dist('真调行级 ', realCalls);

console.log('\n===== B. act × 最终 grade 交叉（token 首判） =====');
const cross = {};
for (const r of tokFirst) {
  const k = `${r.act ?? 'null'}|${r.grade}`;
  cross[k] = (cross[k] || 0) + 1;
}
for (const k of Object.keys(cross).sort()) console.log(`  act=${k.split('|')[0].padEnd(5)} grade=${k.split('|')[1].padEnd(9)} ${cross[k]}`);

console.log('\n===== C. 提案差异面 1：high 档被 cheat 拒的票（跳过 cheat 唯一丢的拦截） =====');
const highRejected = tokFirst.filter(r => r.act === 'high' && (r.grade === 'cheat' || r.grade === 'unhealthy'));
console.log(`  high∧拒 = ${highRejected.length} / high 总 ${cnt(tokFirst, r => r.act === 'high')}`);
for (const r of highRejected) {
  console.log(`  [${r.exp}] ${r.symbol} ${r.token.slice(0, 10)} grade=${r.grade} reasons=[${r.reasons}] denied=${r.exemptDenied ?? '-'} exempt=${JSON.stringify(r.exempt ?? null)}`);
}

console.log('\n===== D. 提案差异面 2：low/ultra ∧ sbw=burst（前置直接拒的误杀面） =====');
const lowUltra = tokFirst.filter(r => r.act === 'low' || r.act === 'ultra');
const lowUltraBurst = lowUltra.filter(r => r.sbw);
console.log(`  low/ultra=${lowUltra.length}，其中 sbw=burst=${lowUltraBurst.length}（现行豁免放行/进 BP）`);
for (const r of lowUltraBurst) {
  console.log(`  [${r.exp}] ${r.symbol} ${r.token.slice(0, 10)} act=${r.act} grade=${r.grade} exec=${r.executed} reasons=[${r.reasons}]`);
}

console.log('\n===== E. mid 档照跑验证：mid 的 cheat 拒率 =====');
const mid = tokFirst.filter(r => r.act === 'mid');
const midRej = mid.filter(r => r.grade === 'cheat' || r.grade === 'unhealthy');
console.log(`  mid 总=${mid.length}，cheat 拒=${midRej.length}（${pct(midRej.length, mid.length)}）`);
const midRejReasons = {};
for (const r of midRej) for (const x of r.reasons) midRejReasons[x] = (midRejReasons[x] || 0) + 1;
console.log('  mid 拒票 reasons 汇总:', JSON.stringify(midRejReasons));

console.log('\n===== E2. high 档 wash（对倒）档位分布——对倒前置的覆盖面 =====');
const highs = tokFirst.filter(r => r.act === 'high');
const washG = {};
for (const r of highs) washG[r.wash ?? 'null'] = (washG[r.wash ?? 'null'] || 0) + 1;
console.log(`  high 总=${highs.length}，wash 分布: ${JSON.stringify(washG)}`);
const midWash = {};
for (const r of mid) midWash[r.wash ?? 'null'] = (midWash[r.wash ?? 'null'] || 0) + 1;
console.log(`  mid  总=${mid.length}，wash 分布: ${JSON.stringify(midWash)}`);

console.log('\n===== E3. 档位漂移（拉黑语义差异面：low∧cheat 拉黑票后续信号是否漂到 high/mid） =====');
let lowCheat = 0, drifted = 0; const driftRows = [];
for (const r of tokFirst) {
  if (r.act !== 'low' || r.grade !== 'cheat') continue;
  lowCheat++;
  const later = (byTokAll.get(r.token) || []).filter(x => new Date(x.at) > new Date(r.at));
  const toHigh = later.some(x => x.act === 'high');
  const toMid = later.some(x => x.act === 'mid');
  if (toHigh || toMid) { drifted++; driftRows.push({ r, toHigh, toMid, laterActs: later.map(x => x.act) }); }
}
console.log(`  low∧cheat 拉黑票=${lowCheat}，后续信号漂到 mid/high=${drifted}`);
for (const d of driftRows.slice(0, 15)) {
  console.log(`  [${d.r.exp}] ${d.r.symbol} ${d.r.token.slice(0, 10)} reasons=[${d.r.reasons}] 轨迹=${d.laterActs.join('→')}${d.toHigh ? ' ⚠漂到high' : ''}`);
}

console.log('\n===== F. FP2 机械 act 臂 vs cheat Jev 档重叠（token 首判） =====');
const fcAssessed = tokFirst.filter(r => r.fc?.status === 'assessed');
console.log(`  factorCheck assessed=${fcAssessed.length}/${tokFirst.length}`);
const overlap = { fpAct_jevLow: 0, fpAct_jevMid: 0, fpAct_jevHigh: 0, fpAct_jevUltra: 0, fpPass_jevLow: 0, fpPass_jevHigh: 0, fpPass_jevUltra: 0 };
for (const r of fcAssessed) {
  const fpAct = (r.fc.arms || []).some(a => a === 'act_low' || a === 'act_ultra');
  if (fpAct) { const k = { low: 'fpAct_jevLow', mid: 'fpAct_jevMid', high: 'fpAct_jevHigh', ultra: 'fpAct_jevUltra' }[r.act]; if (k) overlap[k]++; }
  else { const k = { low: 'fpPass_jevLow', high: 'fpPass_jevHigh', ultra: 'fpPass_jevUltra' }[r.act]; if (k) overlap[k]++; }
}
console.log('  ', JSON.stringify(overlap));
console.log('  （fpAct_jevLow/High/Ultra = FP 机械臂拦 ∧ Jev 判该档；fpPass_jevLow/High/Ultra = FP 机械臂未拦但 Jev 判该档）');

// ---- 4) 盈亏配对 ----
const pnl = new Map();
for (const e of EXPS) {
  const trs = await page('trades', e.id, 'id,token_address,trade_direction,input_amount,output_amount');
  for (const t of trs) {
    const k = `${e.name}|${(t.token_address || '').toLowerCase()}`;
    const o = pnl.get(k) || { buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') o.buy += Number(t.input_amount) || 0;
    else o.sell += Number(t.output_amount) || 0;
    pnl.set(k, o);
  }
}
const netOf = (r) => { const o = pnl.get(`${r.exp}|${r.token}`); return o ? o.sell - o.buy : null; };

// ---- 5) 差异面票前向 10min ----
async function forward(token, atIso) {
  const anchor = new Date(atIso).getTime();
  const { data: ticks, error } = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,price_outlier')
    .eq('token_address', token)
    .gte('block_time', atIso).lte('block_time', new Date(anchor + FWD_SEC * 1000).toISOString())
    .order('block_time', { ascending: true }).limit(1500);
  if (error || !ticks || ticks.length === 0) return null;
  const rel = ticks.filter(t => t.price_bnb && !t.price_outlier).map(t => Number(t.price_bnb));
  if (rel.length === 0) return null;
  const p0 = rel[0];
  return { maxPct: (Math.max(...rel) / p0 - 1) * 100, lastPct: (rel[rel.length - 1] / p0 - 1) * 100 };
}

console.log('\n===== G. 差异面票盈亏/前向 =====');
console.log('-- C 面（high∧cheat 拒，提案会放行）:');
for (const r of highRejected) {
  const net = netOf(r);
  const fwd = net === null ? await forward(r.token, r.at) : null;
  console.log(`  [${r.exp}] ${r.symbol} net=${net === null ? '未成交→' + (fwd ? `fwd10max=${fwd.maxPct.toFixed(1)}%` : '无tick') : net.toFixed(4)}`);
}
console.log('-- D 面（low/ultra∧sbw=burst，提案直接拒会误杀）:');
for (const r of lowUltraBurst) {
  const net = netOf(r);
  const fwd = net === null ? await forward(r.token, r.at) : null;
  console.log(`  [${r.exp}] ${r.symbol} act=${r.act} net=${net === null ? '未成交→' + (fwd ? `fwd10max=${fwd.maxPct.toFixed(1)}%` : '无tick') : net.toFixed(4)}`);
}
console.log('-- 对照：low/ultra∧sbw≠burst（提案与现行同向拒）里实际成交的票净额:');
const lowUltraNonBurst = lowUltra.filter(r => !r.sbw);
let lbN = 0, lbNet = 0, lbPos = 0;
for (const r of lowUltraNonBurst) { const net = netOf(r); if (net !== null) { lbN++; lbNet += net; if (net > 0) lbPos++; } }
console.log(`  low/ultra∧非burst 首判=${lowUltraNonBurst.length}，有成交=${lbN}，净额合计=${lbNet.toFixed(4)}，正=${lbPos}`);

// ---- 6) Jev 题数账 ----
console.log('\n===== H. Jev 题数账（前置=act+wash+sbw 3 题；cheat 剩 7；BP 3） =====');
const dist2 = {};
for (const r of realCalls) dist2[r.act] = (dist2[r.act] || 0) + 1;
let nowQ = 0, propQ = 0;
for (const [a, n] of Object.entries(dist2)) {
  nowQ += n * 13; // cheat 10 + BP 3
  if (a === 'mid') propQ += n * 13;             // 3+7+3
  else if (a === 'low' || a === 'ultra') propQ += n * 3; // 直接拒
  else propQ += n * 6;                            // high: 3+3
}
console.log(`  真调 token 首判分布: ${JSON.stringify(dist2)}`);
console.log(`  现行题数=${nowQ} vs 提案题数=${propQ}（省 ${pct(nowQ - propQ, nowQ)}）`);
console.log('  （BP 门对 cheat 拒票不跑：现行账已按 cheat 拒则省 BP——上面 13 题是上界近似，实际省略多）');

// 信号行级细账：cached 行 cheat 0 题；cheat 拒行 BP 0 题
let sigNow = 0, sigProp = 0, sigReal = 0;
for (const r of withCheat) {
  const cheatQ = r.cached ? 0 : 10;
  const rejected = r.grade === 'cheat' || r.grade === 'unhealthy';
  sigNow += cheatQ + (rejected ? 0 : 3);
  if (r.act === 'high') sigProp += rejected ? 3 : 6;        // 前置3（不粘滞）+BP3；现行拒的提案也可能被对倒臂拒，近似
  else if (r.act === 'low' || r.act === 'ultra') sigProp += 3;
  else sigProp += (r.cached ? 3 : 3 + 7) + (rejected ? 0 : 3); // mid：前置3（+cheat剩7真调）+BP3
  if (!r.cached) sigReal++;
}
console.log(`  信号行级（n=${withCheat.length}，真调=${sigReal} cached=${withCheat.length - sigReal}）：现行=${sigNow} 题 vs 提案=${sigProp} 题（省 ${pct(sigNow - sigProp, sigNow)}）`);

// ---- 输出 JSON ----
const out = {
  distSignal: dist('json-signal', withCheat), distToken: dist('json-token', tokFirst),
  cross, highRejected: highRejected.map(r => ({ exp: r.exp, token: r.token, symbol: r.symbol, grade: r.grade, reasons: r.reasons, denied: r.exemptDenied, net: netOf(r) })),
  lowUltraBurst: lowUltraBurst.map(r => ({ exp: r.exp, token: r.token, symbol: r.symbol, act: r.act, net: netOf(r) })),
  midStats: { mid: mid.length, midRej: midRej.length, midRejReasons },
  overlap, jevAccount: { nowQ, propQ, dist2 },
};
await import('node:fs').then(fs => fs.writeFileSync('/tmp/act-front-gate-review.json', JSON.stringify(out, null, 2)));
console.log('\nJSON → /tmp/act-front-gate-review.json');
process.exit(0);
