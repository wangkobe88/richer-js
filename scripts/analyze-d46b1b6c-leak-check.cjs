#!/usr/bin/env node
/**
 * d46b1b6c strictSameNameTokenCount label-leak 验证
 *
 * 嫌疑：回测 10-02 运行时才查 AVE，计数=查询时刻快照，含买点之后 0-39h 新增同名票
 * （前视）+ 赢家催生仿盘（反向因果）。实盘语义 = 买前 as-of 快照，两层都不存在。
 *
 * 验证：用 wss_events token_create 全量（watcher 双平台）重建两个版本：
 *   asOfCount  = 首买时刻之前创建的同名票数（无泄漏，实盘语义近似）
 *   totalCnt   = 全时点（≈AVE 10-02 快照，含未来；用于口径交叉校验）
 * 匹配规则与 SameNameTokenService 同源：symbol 归一化相等（搜索域）+ name 严格匹配
 * （归一化相同或互含≥3字符）。
 * 已知口径差：wss_events 只覆盖 fourmeme+flap+watcher 时代，AVE 是全 BSC 存量——
 * totalCnt 会系统性低于 AVE 值，相关性高即口径对齐。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'd46b1b6c-7752-4d89-a5ad-309b06312bab';
const sum = a => a.reduce((x, y) => x + y, 0);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function auc(wv, lv) {
  let u = 0;
  for (const w of wv) for (const l of lv) u += w > l ? 1 : (w < l ? 0 : 0.5);
  return wv.length && lv.length ? u / (wv.length * lv.length) : null;
}
// ==== SameNameTokenService 同源归一化/匹配（抄实现，勿漂移） ====
const INVISIBLE_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\u3164\\uFEFF\\uFE00-\\uFE0F]', 'g');
function normalizeName(str) {
  if (!str) return '';
  return String(str).replace(INVISIBLE_RE, '').toLowerCase().trim();
}
function isSameName(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = normalizeName(name1), n2 = normalizeName(name2);
  if (n1 === n2) return true;
  const shorter = n1.length < n2.length ? n1 : n2, longer = n1.length < n2.length ? n2 : n1;
  return longer.includes(shorter) && shorter.length >= 3;
}

(async () => {
  const c = dbManager.getClient();
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), 'utf8'));

  // 1. 全量 token_create（id 游标分页，窄列）
  const byNormSymbol = new Map(); // normSymbol -> [{addr, name, normName, ts}]
  let cursor = 0, rows = 0;
  const t0 = Date.now();
  for (let page = 0; page < 1000; page++) {
    const { data } = await c.from('wss_events').select('id,token_address,payload,block_time')
      .eq('kind', 'token_create').gt('id', cursor).order('id', { ascending: true }).limit(1000);
    if (!data || !data.length) break;
    for (const r of data) {
      const sym = r.payload && r.payload.symbol, nm = r.payload && r.payload.name;
      if (!sym) continue;
      const ns = normalizeName(sym);
      if (!ns) continue;
      if (!byNormSymbol.has(ns)) byNormSymbol.set(ns, []);
      byNormSymbol.get(ns).push({ addr: r.token_address, name: nm, normName: normalizeName(nm), ts: new Date(r.block_time).getTime() });
    }
    rows += data.length;
    cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  console.log(`token_create 全量 ${rows} 行 / ${byNormSymbol.size} 个归一化 symbol（${((Date.now() - t0) / 1000).toFixed(0)}s）`);

  // 2. 254 票的自身 name/symbol/block_time（wss_events）+ 首买时间（trades）
  const addrs = detail.map(t => t.addr);
  const selfInfo = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const { data } = await c.from('wss_events').select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 100));
    (data || []).forEach(r => selfInfo.set(r.token_address, { name: r.payload?.name, symbol: r.payload?.symbol, createTs: new Date(r.block_time).getTime() }));
  }
  const { data: buys } = await c.from('trades').select('token_address,created_at').eq('experiment_id', EXP_ID).eq('trade_direction', 'buy').limit(500);
  const firstBuy = new Map();
  buys.forEach(b => { const p = firstBuy.get(b.token_address); if (!p || b.created_at < p) firstBuy.set(b.token_address, b.created_at); });

  // 3. 每票计算 asOfCount / totalCnt
  let matched = 0;
  for (const t of detail) {
    const self = selfInfo.get(t.addr);
    if (!self || !self.symbol) { t.asOfCnt = null; t.totCnt = null; continue; }
    matched++;
    const ns = normalizeName(self.symbol);
    const cand = byNormSymbol.get(ns) || [];
    const same = cand.filter(x => x.addr !== t.addr && isSameName(self.name, x.name));
    const buyTs = firstBuy.get(t.addr) ? new Date(firstBuy.get(t.addr)).getTime() : null;
    t.totCnt = same.length;
    t.asOfCnt = buyTs == null ? null : same.filter(x => x.ts < buyTs).length;
    t.futureCnt = t.totCnt - (t.asOfCnt ?? t.totCnt);
    t.aveCnt = t.pbc.strictSameNameTokenCount;
  }
  console.log(`自身信息匹配 ${matched}/${detail.length}`);

  // 4. 口径校验：totCnt vs AVE 计数相关性
  const pairs = detail.filter(t => t.totCnt != null && t.aveCnt != null && t.aveCnt >= 0).map(t => [t.totCnt, t.aveCnt]);
  if (pairs.length > 10) {
    const x = pairs.map(p => p[0]), y = pairs.map(p => p[1]);
    const mx = sum(x) / x.length, my = sum(y) / y.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    console.log(`\n口径校验: totCnt(平台内全时点) vs AVE 快照 Pearson r=${(num / Math.sqrt(dx * dy)).toFixed(3)}（AVE 全 BSC 存量，平台内计数系统性偏低属预期）`);
    console.log(`  totCnt 中位=${quantile([...x].sort((a,b)=>a-b), .5)} AVE 中位=${quantile([...y].sort((a,b)=>a-b), .5)}；AVE=0 的票里 totCnt>0 占比=${(100 * pairs.filter(p => p[1] === 0 && p[0] > 0).length / Math.max(1, pairs.filter(p => p[1] === 0).length)).toFixed(0)}%`);
  }

  // 5. 泄漏量：futureCnt（买后新增）分布
  const fut = detail.filter(t => t.futureCnt != null).map(t => t.futureCnt).sort((a, b) => a - b);
  console.log(`\n买后新增同名票数 futureCnt: 中位=${quantile(fut, .5)} p75=${quantile(fut, .75)} p90=${quantile(fut, .9)} 均值=${(sum(fut) / fut.length).toFixed(1)}`);
  const byOutcome = ['win', 'loss'].map(oc => {
    const f = detail.filter(t => t.outcome === oc && t.futureCnt != null).map(t => t.futureCnt).sort((a, b) => a - b);
    return `${oc}: 中位=${quantile(f, .5)} 均值=${(sum(f) / f.length).toFixed(1)}`;
  });
  console.log(`  按结果: ${byOutcome.join(' | ')}（win 显著更高=赢家催生仿盘泄漏实锤）`);

  // 6. 核心：三个版本的区分度对比
  console.log('\n===== 三版本区分度对比 =====');
  const wins = detail.filter(t => t.outcome === 'win'), losses = detail.filter(t => t.outcome === 'loss');
  for (const [label, key] of [['AVE 快照（有前视+反因果，回测原值）', 'aveCnt'], ['平台内全时点 totCnt（有前视）', 'totCnt'], ['asOf 无泄漏（实盘语义）', 'asOfCnt']]) {
    const wv = wins.map(t => t[key]).filter(v => v != null), lv = losses.map(t => t[key]).filter(v => v != null);
    const a = auc(wv, lv);
    console.log(`${label}: AUC=${a == null ? 'n/a' : a.toFixed(3)} (winMed=${quantile([...wv].sort((x,y)=>x-y), .5)}, lossMed=${quantile([...lv].sort((x,y)=>x-y), .5)})`);
  }

  // 7. asOf 版分箱 + 门效果 + 时间稳定性
  console.log('\n===== asOf 无泄漏版分箱 =====');
  for (const [lo, hi] of [[0, 0], [1, 2], [3, 4], [5, 9], [10, 19], [20, 999]]) {
    const arr = detail.filter(t => t.asOfCnt != null && t.asOfCnt >= lo && t.asOfCnt <= hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`asOf [${lo},${hi}]: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }
  // 门效果：asOf<=1 / asOf<=2（孤本=买前无人发过同名）
  for (const th of [0, 1, 2]) {
    const blocked = detail.filter(t => t.asOfCnt != null && t.asOfCnt <= th);
    const w = blocked.filter(t => t.outcome === 'win').length;
    console.log(`门 asOfCnt<=${th}: 拦 ${blocked.length}（亏 ${blocked.length - w}/赢 ${w}）净效应 ${sum(blocked.map(t => t.netBnb)).toFixed(3)}`);
  }
  // 时间稳定性（asOf<=1）
  const withT = detail.filter(t => firstBuy.get(t.addr)).sort((a, b) => firstBuy.get(a.addr) < firstBuy.get(b.addr) ? -1 : 1);
  const mid = firstBuy.get(withT[Math.floor(withT.length / 2)].addr);
  for (const [label, pool] of [['前半', withT.filter(t => firstBuy.get(t.addr) <= mid)], ['后半', withT.filter(t => firstBuy.get(t.addr) > mid)]]) {
    const blocked = pool.filter(t => t.asOfCnt != null && t.asOfCnt <= 1);
    const w = blocked.filter(t => t.outcome === 'win').length;
    console.log(`${label} asOfCnt<=1: n=${blocked.length} 赢${w}/亏${blocked.length - w} 净额=${sum(blocked.map(t => t.netBnb)).toFixed(3)}`);
  }

  // 8. 存档
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-asof-samename.json'),
    JSON.stringify(detail.map(t => ({ addr: t.addr, symbol: t.symbol, netBnb: t.netBnb, outcome: t.outcome, aveCnt: t.aveCnt, totCnt: t.totCnt, asOfCnt: t.asOfCnt, futureCnt: t.futureCnt }))));
  console.log('\n存档 data/analysis-d46b1b6c-asof-samename.json');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
