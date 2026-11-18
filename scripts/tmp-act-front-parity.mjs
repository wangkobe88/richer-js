// ============================================================================
// 临时工具（182 跑）：T175/AF1 前置活跃度门静态分流对拍
//   bt-v141/142/143 三窗 BUY 信号 per (exp|token) 首判行，按现行门链决策
//   vs AF1 分流模拟决策逐票对照——预期行为差异=0：
//   · reject_* 提案拒 vs 现行 cheat 拒（同向）
//   · burst_exempt/high_skip 跳 cheat vs 现行 cheat 放行（同向）
//     ——唯一预期差异=现行 cheat 拒∧提案跳过（high/burst 拒票），
//       由 FP14 N 升格臂闭合（reasons N_no_retail_entry → FP14 同拦）
//   · mid_full 照走=现行决策原样
// 输出：总体决策一致率 + 差异票归因清单
// ============================================================================
import { dbManager } from '../src/services/dbManager.js';
import { actFrontRoute } from '../src/market-analysis/CheatCheckService.js';

const EXPS = [
  { id: '3916fb15-66a1-45f0-bde1-1c145513817a', name: 'bt-v141' },
  { id: '8a7b6b09-e2bc-4773-8393-a696821ff531', name: 'bt-v142' },
  { id: 'e5941591-df22-4434-ae29-1a93ced0f841', name: 'bt-v143' },
];
const ACT = ['low', 'mid', 'high', 'ultra'];
const LV4 = ['none', 'weak', 'moderate', 'strong'];

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

const rows = [];
for (const e of EXPS) {
  const sigs = await page('strategy_signals', e.id, 'id,signal_type,token_address,token_symbol,created_at,executed,metadata');
  for (const s of sigs) {
    if (s.signal_type !== 'BUY' && s.signal_type !== 'buy') continue;
    rows.push({ exp: e.name, token: (s.token_address || '').toLowerCase(), symbol: s.token_symbol,
      at: s.created_at, executed: s.executed, cc: s.metadata?.cheatCheck || null, bp: s.metadata?.buyPoint || null });
  }
}
const withCheat = rows.filter(r => r.cc && r.cc.grade);
const first = new Map();
for (const r of withCheat) { const k = `${r.exp}|${r.token}`; if (!first.has(k)) first.set(k, r); }
const toks = [...first.values()];
console.log(`首判 token 行 n=${toks.length}（信号行 ${withCheat.length}）`);

// ── 现行决策重构 ──
// cheat 拒=grade∈{cheat,unhealthy}；过→BP 决定（assessment=neutral 过/poor 拒；
//   bp 段缺席（cheat 拒票不跑 BP）=cheat 决策即最终）
function currentDecision(r) {
  const cheatRejected = r.cc.grade === 'cheat' || r.cc.grade === 'unhealthy';
  if (cheatRejected) return { pass: false, at: 'cheat', grade: r.cc.grade };
  const bucket = r.bp?.assessment?.bucket ?? null;
  if (bucket === null) return { pass: true, at: 'cheat_pass_no_bp' };
  return { pass: bucket === 'neutral' || bucket === 'good', at: 'bp', bucket };
}

// ── AF1 分流模拟（actFrontRoute 同款语义本地重演，独立实现防同源盲）──
function afDecision(r) {
  const lv = r.cc.levels || {};
  const act = ACT[lv.activityLevel] ?? null;
  const burst = lv.stallBurstWave === 1;
  const wash = LV4[lv.washPair] ?? (r.cc.buckets?.wash_pair ?? null);
  if (!act) return { pass: currentDecision(r).pass, at: 'af_fail_open' };
  const path = actFrontRoute(act, burst, wash);
  if (path.startsWith('reject_')) return { pass: false, at: `af_${path}` };
  if (path === 'mid_full') { const d = currentDecision(r); return { pass: d.pass, at: 'mid_' + d.at }; }
  // burst_exempt / high_skip：跳 cheat → FP14 N 臂模拟（cheat reasons 带
  // N_no_retail_entry → FP14 也拦）→ BP 照搬
  const nHit = (r.cc.reasons || []).some(x => String(x.code || '').startsWith('N_no_retail_entry'));
  if (nHit) return { pass: false, at: 'fp14_n_no_retail' };
  const d = currentDecision(r);
  return { pass: d.at === 'cheat' ? true : d.pass, at: 'skip_' + d.at }; // cheat 拒被跳过=放行（预期差异面，nHit 已先拦）
}

let agree = 0; const diffs = [];
const pathCnt = {};
for (const r of toks) {
  const cur = currentDecision(r);
  const sim = afDecision(r);
  const lv = r.cc.levels || {};
  const path = ACT[lv.activityLevel] ? actFrontRoute(ACT[lv.activityLevel], lv.stallBurstWave === 1, LV4[lv.washPair] ?? null) : 'fail_open';
  pathCnt[path] = (pathCnt[path] || 0) + 1;
  if (cur.pass === sim.pass) agree++;
  else diffs.push({ r, cur, sim, path });
}
console.log(`决策一致 ${agree}/${toks.length}（${(100 * agree / toks.length).toFixed(1)}%）`);
console.log('分流路径分布:', JSON.stringify(pathCnt));
console.log(`\n差异票 ${diffs.length} 张：`);
for (const d of diffs.slice(0, 30)) {
  console.log(`  [${d.r.exp}] ${d.r.symbol} ${d.r.token.slice(0, 10)} 现行=${JSON.stringify(d.cur)} 模拟=${JSON.stringify(d.sim)} path=${d.path} reasons=${JSON.stringify((d.r.cc.reasons || []).map(x => x.code))}`);
}
process.exit(0);
