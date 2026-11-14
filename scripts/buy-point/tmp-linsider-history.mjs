// L_insider 历史全量验证（182 跑，只读）：所有实验 BUY 信号中 cheatCheck.reasons
// 含 L_insider 的票 → 前向收益（+15min max/last vs 信号时刻价）+ 实际成交盈亏。
// 回答：L_insider 拦掉的票里有没有好票（CD379 豁免当初的理由是否成立）。
// 桶划分：A=豁免放行且买入（实际 pnl）/ B=豁免放行未买（fwd）/ C=未豁免直接拒（fwd=拦掉的票）
import { dbManager } from '../../src/services/dbManager.js';
import { buildEpisodes, episodePnlBnb } from './lib.mjs';

const c = await dbManager.getClient();
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

// 1. 实验清单（cheatCheck 开启 或 回测 signalGateReal）
const exps = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await c.from('experiments')
      .select('id,experiment_name,status,created_at,config').order('id', { ascending: true }).range(from, from + 499);
    if (error) throw new Error(error.message);
    exps.push(...data); if (data.length < 500) break; from += 500;
  }
}
const active = exps.filter(e => e.config?.fourmemeWs?.cheatCheck?.enabled
  || e.config?.flapWs?.cheatCheck?.enabled || e.config?.backtest?.signalGateReal);
console.log(`实验 ${exps.length} 个，其中带 cheat 门 ${active.length} 个：${active.map(e => e.experiment_name || e.id.slice(0, 8)).join(', ')}\n`);

// 2. BUY 信号扫描（per (exp,token) 取首命中信号）
const hits = new Map(); // key exp|token
for (const e of active) {
  let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,executed,reason,metadata,created_at')
      .eq('experiment_id', e.id).eq('action', 'buy')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data) {
      const cc = s.metadata?.cheatCheck;
      if (!cc) continue;
      const lins = (cc.reasons || []).filter(r => String(r.code || '').startsWith('L_insider'));
      if (!lins.length) continue;
      const key = `${e.id}|${s.token_address}`;
      if (hits.has(key)) continue; // 首信号
      hits.set(key, {
        exp: e.id, expName: e.experiment_name || e.id.slice(0, 8), token: s.token_address, created: s.created_at,
        grade: cc.grade ?? null, exempt: cc.exempt?.code || null, origGrade: cc.exempt?.originalGrade || null,
        executed: !!s.executed, reason: s.reason, code: lins[0].code,
        pct: Number(lins[0].code.replace('L_insider_sell', '')) || null,
        insiderLv: cc.levels?.insiderSupplySell ?? cc.levels?.insider_supply_sell ?? null,
      });
    }
    if (data.length < 1000) break; from += 1000;
  }
}
const all = [...hits.values()];
console.log(`L_insider 命中（首信号去重）${all.length} 票\n`);

// 3. 前向收益：信号前最后一笔价 P0 → +15min max/last
for (const h of all) {
  const t0 = Date.parse(h.created);
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb')
      .eq('token_address', h.token)
      .gte('block_time', new Date(t0 - 60 * 1000).toISOString())
      .lte('block_time', new Date(t0 + 15 * 60 * 1000).toISOString())
      .order('block_time', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
    if (from > 5000) break; // 防爆
  }
  const ts = (x) => Date.parse(x);
  const rel = rows.filter(r => r.price_bnb > 0).map(r => ({ t: ts(r.block_time), p: r.price_bnb }));
  const pre = rel.filter(r => r.t <= t0);
  const post = rel.filter(r => r.t > t0);
  const p0 = pre.length ? pre[pre.length - 1].p : null;
  if (p0) {
    const fwd5 = post.filter(r => r.t <= t0 + 5 * 60 * 1000);
    const fwd15max = post.length ? Math.max(...post.map(r => r.p)) : null;
    const fwd15last = post.length ? post[post.length - 1].p : null;
    h.p0 = p0;
    h.fwd5MaxPct = fwd5.length ? (Math.max(...fwd5.map(r => r.p)) / p0 - 1) * 100 : null;
    h.fwd15MaxPct = fwd15max ? (fwd15max / p0 - 1) * 100 : null;
    h.fwd15LastPct = fwd15last ? (fwd15last / p0 - 1) * 100 : null;
    h.tickN = post.length;
  }
}

// 4. 实际成交盈亏（executed 票）：pnl=Σ卖 output−Σ买 input（lib.mjs episode 口径，只计 success）
for (const h of all.filter(x => x.executed)) {
  let from = 0; const ts = [];
  while (true) {
    const { data, error } = await c.from('trades')
      .select('id,trade_direction,success,input_amount,output_amount,created_at,executed_at')
      .eq('experiment_id', h.exp).eq('token_address', h.token)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    ts.push(...data); if (data.length < 1000) break; from += 1000;
  }
  const ok = ts.filter(t => t.success);
  const eps = buildEpisodes(ok);
  let pnl = 0, hasPnl = false;
  for (const ep of eps) {
    const r = episodePnlBnb(ep);
    if (r && r.pnlBnb != null) { pnl += r.pnlBnb; hasPnl = true; }
    else if (r && r.pnlBnb == null) hasPnl = true; // open episode 无 mark → 记 open 不计
  }
  h.pnl = ok.length ? (hasPnl ? pnl : null) : null; h.tradesN = ok.length;
}

// 5. 分桶输出
const A = all.filter(x => x.exempt && x.executed);      // 豁免放行且买入
const B = all.filter(x => x.exempt && !x.executed);     // 豁免放行未买（后续门拒/未执行）
const C = all.filter(x => !x.exempt && !x.executed);    // 未豁免直接拒（L_insider 生效拦截）
const D = all.filter(x => !x.exempt && x.executed);     // 异常：未豁免却执行（理论不该有）
const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
const row = (x) => `${x.expName} ${x.token.slice(0, 10)} 纯卖${x.pct ?? '?'}% insider=${x.insiderLv ?? '?'} grade=${x.grade}${x.origGrade ? `←${x.origGrade}` : ''} fwd5max=${fmt(x.fwd5MaxPct, 1)} fwd15max=${fmt(x.fwd15MaxPct, 1)} fwd15last=${fmt(x.fwd15LastPct, 1)}${x.pnl != null ? ` pnl=${fmt(x.pnl, 4)}(${x.tradesN}笔)` : ''}`;

console.log(`═ A 桶：豁免放行且买入 ${A.length} 票，实际 pnl 合计 ${fmt(sum(A, 'pnl'), 4)}（有 trade ${A.filter(x => x.pnl != null).length}）═`);
for (const x of A.sort((a, b) => (b.pnl || 0) - (a.pnl || 0))) console.log(`  ${row(x)}`);
console.log(`\n═ B 桶：豁免放行未买 ${B.length} 票（fwd 口径=如果买了）═`);
for (const x of B.sort((a, b) => (b.fwd15LastPct || 0) - (a.fwd15LastPct || 0))) console.log(`  ${row(x)}`);
console.log(`\n═ C 桶：L_insider 直接拒（拦掉的票，fwd=拦错没有）${C.length} 票 ═`);
for (const x of C.sort((a, b) => (b.fwd15LastPct || 0) - (a.fwd15LastPct || 0))) console.log(`  ${row(x)}`);
const cw = C.filter(x => (x.fwd15MaxPct || 0) > 20);
console.log(`  → C 桶 fwd15max>20%（拦掉后 15min 内曾有 20%+ 拉升）${cw.length} 票`);
if (D.length) { console.log(`\n═ D 桶：未豁免却执行（异常，须查）${D.length} 票 ═`); for (const x of D) console.log(`  ${row(x)}`); }

// 6. 汇总口径：若 L_insider 加入 CD380 不豁免臂（C 桶不变已拒 + A 桶转拒 + B 桶转拒）
const aPnl = sum(A, 'pnl');
const aFwd = sum(A.filter(x => x.pnl == null), 'fwd15LastPct');
console.log(`\n═ 汇总 ═`);
console.log(`A 豁免买入实际 pnl=${fmt(aPnl, 4)}${A.some(x => x.pnl == null) ? `（另 ${A.filter(x => x.pnl == null).length} 票无 trade，fwd15last 合计 ${fmt(aFwd, 1)}%）` : ''}`);
console.log(`B 豁免未买 fwd15last 合计=${fmt(sum(B, 'fwd15LastPct'), 1)}%`);
console.log(`C 直接拒 fwd15last 合计=${fmt(sum(C, 'fwd15LastPct'), 1)}% / fwd15max>20% ${cw.length} 票 / fwd15last>0 ${C.filter(x => (x.fwd15LastPct || 0) > 0).length} 票`);
process.exit(0);
