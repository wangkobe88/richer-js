#!/usr/bin/env node
/**
 * 82093ca3「回测-v6四改-平台分门+P9-100+uw15+TPA2.5」分析（vs v5 基线 d46b1b6c 同窗）
 *
 * 四改动：① TPA 门 2.2→2.5 ② uw>=15 ③ router 区间门改平台分门（fourmeme 放行）
 * ④ P9 卖腿浮盈门槛 30→100（dae1000）
 *
 * 分析：per-token 账本 + 平台归属 + v5/v6 集合 diff（门净效应分解）+ 同票净额变化
 * （P9 卖腿效应）+ v6 票集上新一轮因子 AUC。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = '82093ca3-ea73-4f26-9aef-cb9a1acee842';
const V5_ID = 'd46b1b6c-7752-4d89-a5ad-309b06312bab';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 3) => v == null || (typeof v === 'number' && !isFinite(v)) ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);
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
function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

(async () => {
  const c = dbManager.getClient();

  // ---------- 1. 数据 ----------
  const { data: trades } = await c.from('trades').select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at,unit_price').eq('experiment_id', EXP_ID).limit(5000);
  const signals = [];
  {
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      let q = c.from('strategy_signals').select('id,token_address,metadata,created_at').eq('experiment_id', EXP_ID).eq('action', 'buy').order('id', { ascending: true }).limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data: chunk } = await q;
      if (!chunk || !chunk.length) break;
      signals.push(...chunk);
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < 1000) break;
    }
  }
  console.log(`trades=${trades.length} buySignals=${signals.length}`);

  // per-token 账本
  const tokens = new Map();
  for (const t of trades) {
    if (!tokens.has(t.token_address)) tokens.set(t.token_address, { addr: t.token_address, symbol: t.token_symbol, buys: [], sells: [] });
    const tk = tokens.get(t.token_address);
    (t.trade_direction === 'buy' ? tk.buys : tk.sells).push(t);
  }
  const sigById = new Map(signals.map(s => [s.id, s]));
  for (const tk of tokens.values()) {
    tk.buys.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    tk.sells.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    tk.spentBnb = sum(tk.buys.map(t => Number(t.input_amount) || 0));
    tk.receivedBnb = sum(tk.sells.map(t => Number(t.output_amount) || 0));
    tk.netBnb = tk.receivedBnb - tk.spentBnb;
    tk.outcome = tk.netBnb > 0.001 ? 'win' : (tk.netBnb < -0.001 ? 'loss' : 'flat');
    tk.firstBuyAt = tk.buys[0].created_at;
    tk.buyPrice = Number(tk.buys[0].unit_price);
    const sig = tk.buys[0].signal_id ? sigById.get(tk.buys[0].signal_id) : null;
    const m = (sig && sig.metadata) || {};
    tk.tf = m.trendFactors || {}; tk.pbc = m.preBuyCheckFactors || {}; tk.tpa = m.tpaFactors || {};
    tk.rating = tk.pbc.narrativeRating != null ? tk.pbc.narrativeRating : null;
  }
  const all = [...tokens.values()];
  const wins = all.filter(t => t.outcome === 'win'), losses = all.filter(t => t.outcome === 'loss');

  // 平台归属
  const addrs = all.map(t => t.addr);
  const plat = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const { data } = await c.from('wss_events').select('token_address,platform').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 100));
    (data || []).forEach(r => plat.set(r.token_address, r.platform));
  }
  for (const t of all) t.platform = plat.get(t.addr) || 'no-create-event';

  console.log('\n===== v6 总览 =====');
  console.log(`tokens=${all.length} win=${wins.length} loss=${losses.length} flat=${all.length - wins.length - losses.length} | 净额 ${sum(all.map(t => t.netBnb)).toFixed(3)} BNB`);
  console.log(`赢票 +${sum(wins.map(t => t.netBnb)).toFixed(3)} / 亏票 ${sum(losses.map(t => t.netBnb)).toFixed(3)}`);
  for (const pf of ['fourmeme', 'flap', 'no-create-event']) {
    const arr = all.filter(t => t.platform === pf);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`${pf}: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // ---------- 2. v5/v6 集合 diff ----------
  console.log('\n===== v5(d46b1b6c) vs v6 集合 diff =====');
  const v5 = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), 'utf8'));
  const v5ByAddr = new Map(v5.map(t => [t.addr, t]));
  const v6Addrs = new Set(all.map(t => t.addr));
  const dropped = v5.filter(t => !v6Addrs.has(t.addr));       // v5 买 v6 没买（被新门拦 or 挤出）
  const added = all.filter(t => !v5ByAddr.has(t.addr));        // v6 新买（平台分门放行的 fourmeme 等）
  const dw = dropped.filter(t => t.outcome === 'win').length;
  const aw = added.filter(t => t.outcome === 'win').length;
  console.log(`v5 独有（被拦/未买）: ${dropped.length} 票，其 v5 净额合计 ${sum(dropped.map(t => t.netBnb)).toFixed(3)}（亏 ${dropped.length - dw}/赢 ${dw}）`);
  console.log(`v6 新增: ${added.length} 票，v6 净额合计 ${sum(added.map(t => t.netBnb)).toFixed(3)}（亏 ${added.length - aw}/赢 ${aw}）`);
  const addedByPf = {};
  added.forEach(t => { const k = t.platform; (addedByPf[k] = addedByPf[k] || []).push(t.netBnb); });
  for (const [k, arr] of Object.entries(addedByPf)) console.log(`  新增[${k}]: n=${arr.length} 净额=${sum(arr).toFixed(3)}`);
  // 被拦票是哪个门拦的：TPA<=2.5 / uw<15（信号因子来自 v5 明细）
  console.log('--- v5 独有票的拦截原因（v5 信号因子） ---');
  const reason = { tpa: 0, uw: 0, tpaUw: 0, other: 0 };
  let tpaNet = 0, uwNet = 0;
  dropped.forEach(t => {
    const tpaHit = t.tpa && t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.5;
    const uwHit = t.pbc && t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets < 15;
    if (tpaHit && uwHit) { reason.tpaUw++; tpaNet += t.netBnb; }
    else if (tpaHit) { reason.tpa++; tpaNet += t.netBnb; }
    else if (uwHit) { reason.uw++; uwNet += t.netBnb; }
    else { reason.other++; }
  });
  console.log(`TPA<=2.5 命中: ${reason.tpa + reason.tpaUw} 票（v5 净额 ${tpaNet.toFixed(3)}）；uw<15 命中: ${reason.uw + reason.tpaUw} 票（v5 净额 ${uwNet.toFixed(3)}）；两门都不命中（挤出/其他）: ${reason.other}`);

  // ---------- 3. 同票净额变化（P9-100 卖腿效应） ----------
  console.log('\n===== 同票净额变化（两实验都买的票） =====');
  const both = all.filter(t => v5ByAddr.has(t.addr));
  const deltas = both.map(t => ({ addr: t.addr, sym: t.symbol, d: t.netBnb - v5ByAddr.get(t.addr).netBnb, v5: v5ByAddr.get(t.addr).netBnb, v6: t.netBnb, buySame: v5ByAddr.get(t.addr).tf && t.tf ? Math.abs((v5ByAddr.get(t.addr).tf.buyPrice || 0) - (t.tf.buyPrice || 0)) < 1e-15 : null }));
  const pos = deltas.filter(x => x.d > 0.001), neg = deltas.filter(x => x.d < -0.001), same = deltas.filter(x => Math.abs(x.d) <= 0.001);
  console.log(`共 ${both.length} 票：改善 ${pos.length}（+${sum(pos.map(x => x.d)).toFixed(3)}）/ 恶化 ${neg.length}（${sum(neg.map(x => x.d)).toFixed(3)}）/ 不变 ${same.length}`);
  console.log(`同票净额总变化: ${sum(deltas.map(x => x.d)).toFixed(3)} BNB`);
  if (neg.length) {
    console.log('--- 恶化 Top 5（P9-100 推迟止盈的代价候选） ---');
    neg.sort((a, b) => a.d - b.d).slice(0, 5).forEach(x => console.log(`${x.d.toFixed(3)} ${x.sym} ${x.addr} (v5 ${x.v5.toFixed(3)} → v6 ${x.v6.toFixed(3)})`));
  }
  if (pos.length) {
    console.log('--- 改善 Top 5 ---');
    pos.sort((a, b) => b.d - a.d).slice(0, 5).forEach(x => console.log(`+${x.d.toFixed(3)} ${x.sym} ${x.addr} (v5 ${x.v5.toFixed(3)} → v6 ${x.v6.toFixed(3)})`));
  }

  // ---------- 4. v6 票集因子 AUC（还有什么可过滤） ----------
  console.log('\n===== v6 票集因子 AUC Top 20（找下一轮过滤器） =====');
  const factorRows = all.map(t => ({ outcome: t.outcome, netBnb: t.netBnb, ...flatten('tf', t.tf), ...flatten('pbc', t.pbc), ...flatten('tpa', t.tpa) }));
  function flatten(prefix, obj) {
    const o = {};
    for (const [k, v] of Object.entries(obj || {})) if (typeof v === 'number' && isFinite(v)) o[`${prefix}.${k}`] = v;
    return o;
  }
  const keySet = new Set();
  factorRows.forEach(r => Object.keys(r).forEach(k => { if (k.includes('.')) keySet.add(k); }));
  const winRows = factorRows.filter(r => r.outcome === 'win'), lossRows = factorRows.filter(r => r.outcome === 'loss');
  const res = [];
  for (const k of keySet) {
    const wv = winRows.map(r => r[k]).filter(v => v != null), lv = lossRows.map(r => r[k]).filter(v => v != null);
    if (wv.length < 15 || lv.length < 30) continue;
    const a = auc(wv, lv);
    if (a == null) continue;
    // 外部 API 快照型因子标注泄漏嫌疑
    const leaky = /strictSameName|gmgn/.test(k);
    res.push({ key: k, auc: a, leaky, winMed: quantile([...wv].sort((x, y) => x - y), 0.5), lossMed: quantile([...lv].sort((x, y) => x - y), 0.5) });
  }
  res.sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5));
  res.slice(0, 20).forEach(r => console.log(`${r.key}${r.leaky ? '[泄漏嫌疑]' : ''} | AUC=${r.auc.toFixed(3)} | winMed=${fmt(r.winMed)} lossMed=${fmt(r.lossMed)}`));

  // ---------- 5. 存档 ----------
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-82093ca3-per-token.json'), JSON.stringify(all.map(t => ({
    addr: t.addr, symbol: t.symbol, platform: t.platform, netBnb: +t.netBnb.toFixed(4), outcome: t.outcome, rating: t.rating,
    firstBuyAt: t.firstBuyAt, nBuys: t.buys.length, nSells: t.sells.length, tf: t.tf, pbc: t.pbc, tpa: t.tpa,
  }))));
  console.log('\n存档 data/analysis-82093ca3-per-token.json');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
