#!/usr/bin/env node
/**
 * d46b1b6c 回测（buy-v2 v5 双窗并集）交易效果全面分析——买信号因子过滤挖掘
 *
 * 目标：254 token（75 赢/178 亏，净 +7.64 BNB）中找出能区分赢/亏票的因子阈值候选。
 * 方法：
 *   1. trades 按 token 配对净盈亏（Σsell.output − Σbuy.input，BNB）
 *   2. 每 token 取实际成交的首笔 buy trades → signal_id 关联买信号因子快照
 *   3. 全数值因子 AUC 区分度排序（Mann-Whitney U 正态近似 p 值）
 *   4. top 因子分位阈值扫描：拦截净效应 = 被拦票净盈亏合计（负=避亏）
 * 注意：单实验扫描结果属候选假设，须配对回测验证（多重比较过拟合风险）。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = 'd46b1b6c-7752-4d89-a5ad-309b06312bab';

// ---------- 统计工具 ----------
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function auc(winVals, lossVals) {
  // win 值大于 loss 值的概率；>0.5 = 因子大→赢
  let u = 0;
  for (const w of winVals) for (const l of lossVals) u += w > l ? 1 : (w < l ? 0 : 0.5);
  const n1 = winVals.length, n2 = lossVals.length, N = n1 * n2;
  if (!N) return { auc: null, p: null };
  const auc = u / N;
  const mu = 0.5, sigma = Math.sqrt((n1 + n2 + 1) / (12 * n1 * n2));
  const z = (auc - mu) / sigma;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { auc, p, z };
}
function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const fmt = (v, d = 3) => v == null || (typeof v === 'number' && !isFinite(v)) ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);
const sum = a => a.reduce((x, y) => x + y, 0);

(async () => {
  const c = dbManager.getClient();

  // ---------- 1. 拉数据 ----------
  const { data: exp } = await c.from('experiments').select('config,stats,experiment_name,started_at,stopped_at').eq('id', EXP_ID).single();
  const { data: trades } = await c.from('trades').select('id,token_address,token_symbol,trade_direction,trade_status,input_amount,output_amount,unit_price,success,signal_id,sold_cards,created_at').eq('experiment_id', EXP_ID).limit(5000);
  // 分页拉全 buy 信号（postgrest 默认 1000 行截断坑，936 只是前 1000 条里的）
  const signals = [];
  {
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      let q = c.from('strategy_signals').select('id,token_address,token_symbol,action,metadata,created_at,executed').eq('experiment_id', EXP_ID).eq('action', 'buy').order('id', { ascending: true }).limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data: chunk } = await q;
      if (!chunk || !chunk.length) break;
      signals.push(...chunk);
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < 1000) break;
    }
  }
  console.log(`trades=${trades.length} buySignals=${signals.length} platform=${(exp.config || {}).platform || 'fourmeme(default)'}`);

  // ---------- 2. per-token 账本 ----------
  const tokens = new Map();
  for (const t of trades) {
    if (!tokens.has(t.token_address)) tokens.set(t.token_address, { addr: t.token_address, symbol: t.token_symbol, buys: [], sells: [], firstBuyTrade: null });
    const tk = tokens.get(t.token_address);
    if (t.trade_direction === 'buy') {
      tk.buys.push(t);
      if (!tk.firstBuyTrade || t.created_at < tk.firstBuyTrade.created_at) tk.firstBuyTrade = t;
    } else if (t.trade_direction === 'sell') tk.sells.push(t);
  }
  for (const tk of tokens.values()) {
    tk.spentBnb = sum(tk.buys.map(t => Number(t.input_amount) || 0));
    tk.receivedBnb = sum(tk.sells.map(t => Number(t.output_amount) || 0));
    tk.netBnb = tk.receivedBnb - tk.spentBnb;
    tk.outcome = tk.netBnb > 0.001 ? 'win' : (tk.netBnb < -0.001 ? 'loss' : 'flat');
    tk.maxRunupPct = null; // 由 signal 因子补
  }

  // ---------- 3. 关联首买信号因子 ----------
  const sigById = new Map(signals.map(s => [s.id, s]));
  let linkedByTrade = 0, linkedByTokenFirst = 0;
  for (const tk of tokens.values()) {
    let sig = null;
    if (tk.firstBuyTrade && tk.firstBuyTrade.signal_id && sigById.has(tk.firstBuyTrade.signal_id)) { sig = sigById.get(tk.firstBuyTrade.signal_id); linkedByTrade++; }
    else {
      const cand = signals.filter(s => s.token_address === tk.addr).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
      if (cand.length) { sig = cand[0]; linkedByTokenFirst++; }
    }
    tk.signal = sig;
    const m = (sig && sig.metadata) || {};
    tk.tf = m.trendFactors || {};
    tk.pbc = m.preBuyCheckFactors || {};
    tk.tpa = m.tpaFactors || {};
    tk.nc = m.narrativeCall || {};
    tk.rating = tk.pbc.narrativeRating != null ? tk.pbc.narrativeRating : (tk.nc.numericRating != null ? tk.nc.numericRating : null);
  }
  console.log(`因子关联: trade.signal_id 命中 ${linkedByTrade} + token 首信号兜底 ${linkedByTokenFirst} / ${tokens.size}`);

  // ---------- 4. 总览 ----------
  const all = [...tokens.values()];
  const wins = all.filter(t => t.outcome === 'win'), losses = all.filter(t => t.outcome === 'loss'), flats = all.filter(t => t.outcome === 'flat');
  const totalNet = sum(all.map(t => t.netBnb));
  console.log('\n===== 总览 =====');
  console.log(`tokens=${all.length} win=${wins.length} loss=${losses.length} flat=${flats.length} | 净额 ${totalNet.toFixed(3)} BNB`);
  console.log(`赢票合计 +${sum(wins.map(t => t.netBnb)).toFixed(3)} | 亏票合计 ${sum(losses.map(t => t.netBnb)).toFixed(3)} | 中位 win ${fmt(quantile(wins.map(t=>t.netBnb).sort((a,b)=>a-b), 0.5),4)} / 中位 loss ${fmt(quantile(losses.map(t=>t.netBnb).sort((a,b)=>a-b), 0.5),4)}`);

  const byNet = [...all].sort((a, b) => b.netBnb - a.netBnb);
  console.log('\n--- Top 10 赢票 ---');
  byNet.slice(0, 10).forEach(t => console.log(`+${t.netBnb.toFixed(3)}  ${t.symbol || '?'} ${t.addr} rating=${t.rating} earlyRet=${fmt(t.tf.earlyReturn,0)} buyBnb=${fmt(t.tf.buyVolumeBnb,1)} router=${fmt(t.pbc.earlyTradesRouterPct,1)} tpa=${fmt(t.tpa.TPAPre_tokenScore,2)}`));
  console.log('--- Top 10 亏票 ---');
  byNet.slice(-10).reverse().forEach(t => console.log(`${t.netBnb.toFixed(3)}  ${t.symbol || '?'} ${t.addr} rating=${t.rating} earlyRet=${fmt(t.tf.earlyReturn,0)} buyBnb=${fmt(t.tf.buyVolumeBnb,1)} router=${fmt(t.pbc.earlyTradesRouterPct,1)} tpa=${fmt(t.tpa.TPAPre_tokenScore,2)}`));

  // ---------- 5. 叙事评级细分 ----------
  console.log('\n===== 叙事评级细分（买时快照） =====');
  const byRating = {};
  for (const t of all) {
    const r = t.rating == null ? 'null' : String(t.rating);
    (byRating[r] = byRating[r] || []).push(t);
  }
  for (const [r, arr] of Object.entries(byRating).sort((a, b) => a[0].localeCompare(b[0]))) {
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`rating=${r}: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // ---------- 6. 全因子 AUC 区分度 ----------
  // 收集因子键（三个桶里的数值键）
  const factorRows = all.map(t => ({
    outcome: t.outcome, netBnb: t.netBnb, addr: t.addr,
    ...flatten('tf', t.tf), ...flatten('pbc', t.pbc), ...flatten('tpa', t.tpa),
  }));
  function flatten(prefix, obj) {
    const o = {};
    for (const [k, v] of Object.entries(obj || {})) if (typeof v === 'number' && isFinite(v)) o[`${prefix}.${k}`] = v;
    return o;
  }
  const keySet = new Set();
  factorRows.forEach(r => Object.keys(r).forEach(k => { if (k.includes('.')) keySet.add(k); }));
  const winRows = factorRows.filter(r => r.outcome === 'win'), lossRows = factorRows.filter(r => r.outcome === 'loss');

  const aucResults = [];
  for (const k of keySet) {
    const wv = winRows.map(r => r[k]).filter(v => v != null);
    const lv = lossRows.map(r => r[k]).filter(v => v != null);
    if (wv.length < 20 || lv.length < 40) continue; // 覆盖不足跳过
    const stat = auc(wv, lv);
    if (stat.auc == null) continue;
    aucResults.push({
      key: k, auc: stat.auc, p: stat.p,
      winMed: quantile([...wv].sort((a, b) => a - b), 0.5), lossMed: quantile([...lv].sort((a, b) => a - b), 0.5),
      cover: wv.length + lv.length,
    });
  }
  aucResults.sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5));
  console.log('\n===== 因子区分度 Top 30（|AUC-0.5| 排序；AUC>0.5=值大→赢，<0.5=值大→亏） =====');
  console.log('factor | AUC | p | winMed | lossMed | cover');
  aucResults.slice(0, 30).forEach(r => console.log(`${r.key} | ${r.auc.toFixed(3)} | ${r.p < 1e-4 ? '<1e-4' : r.p.toExponential(1)} | ${fmt(r.winMed, 3)} | ${fmt(r.lossMed, 3)} | ${r.cover}`));

  // ---------- 7. 阈值扫描（top 12 因子，双向） ----------
  console.log('\n===== 阈值扫描（拦截净效应=被拦票净盈亏合计；负=避亏为正收益；须防过拟合，候选须配对回测验证） =====');
  const scanKeys = [...new Set([...aucResults.slice(0, 12).map(r => r.key),
    'pbc.earlyTradesRouterPct', 'pbc.earlyTradesTop1BuySharePct', 'tf.earlyReturn', 'tf.buyVolumeBnb', 'tpa.TPAPre_tokenScore', 'pbc.narrativeRating'])];
  for (const k of scanKeys) {
    const rows = factorRows.filter(r => r[k] != null);
    if (rows.length < 50) continue;
    const sortedVals = [...new Set(rows.map(r => r[k]))].sort((a, b) => a - b);
    const best = [];
    for (const dir of ['blockLow', 'blockHigh']) { // blockLow: 值<=t 拦截；blockHigh: 值>=t 拦截
      let bestT = null, bestNet = 0, bestN = 0, bestW = 0, bestL = 0;
      for (let qi = 0.05; qi <= 0.95; qi += 0.05) {
        const t = quantile(sortedVals, qi);
        const blocked = rows.filter(r => dir === 'blockLow' ? r[k] <= t : r[k] >= t);
        if (blocked.length < 5 || blocked.length > rows.length * 0.6) continue;
        const net = sum(blocked.map(r => r.netBnb));
        const w = blocked.filter(r => r.outcome === 'win').length;
        if (net < bestNet) { bestNet = net; bestT = t; bestN = blocked.length; bestW = w; bestL = blocked.length - w; }
      }
      if (bestT != null) best.push({ dir, t: bestT, net: bestNet, n: bestN, w: bestW, l: bestL });
    }
    if (best.length) {
      const parts = best.map(b => `${b.dir === 'blockLow' ? '值≤' : '值≥'}${fmt(b.t, 2)} → 拦${b.n}票(亏${b.l}/赢${b.w}) 净效应 ${b.net.toFixed(2)}`);
      console.log(`${k}: ${parts.join(' ; ')}`);
    }
  }

  // ---------- 8. 组合快筛（最优单因子 + 已知门的组合示例） ----------
  console.log('\n===== 组合快筛示例（净效应叠加展示，非正式建议） =====');
  const combos = [
    ['routerPct<60（已上线门，回测内未启用于此实验? 核对）', r => (r['pbc.earlyTradesRouterPct'] == null ? false : r['pbc.earlyTradesRouterPct'] < 60)],
    ['rating==3 only', r => r['pbc.narrativeRating'] === 3],
    ['AUC top1 单因子', null], // 运行时填充
  ];
  const top1 = aucResults[0];
  if (top1) {
    const med = quantile(factorRows.map(r => r[top1.key]).filter(v => v != null).sort((a, b) => a - b), 0.5);
    const dir = top1.auc >= 0.5 ? '>=' : '<=';
    combos[2] = [`${top1.key} ${dir} ${fmt(med, 3)}(中位)`, r => r[top1.key] != null && (dir === '>=' ? r[top1.key] >= med : r[top1.key] <= med)];
  }
  for (const [name, fn] of combos) {
    if (!fn) continue;
    const blocked = factorRows.filter(fn);
    const w = blocked.filter(r => r.outcome === 'win').length;
    console.log(`${name}: 拦 ${blocked.length} 票（亏 ${blocked.length - w} / 赢 ${w}）净效应 ${sum(blocked.map(r => r.netBnb)).toFixed(3)} BNB`);
  }

  // ---------- 9. 存明细 ----------
  const fs = require('fs');
  const detail = all.map(t => ({
    addr: t.addr, symbol: t.symbol, netBnb: +t.netBnb.toFixed(4), outcome: t.outcome, rating: t.rating,
    spent: +t.spentBnb.toFixed(4), received: +t.receivedBnb.toFixed(4), nBuys: t.buys.length, nSells: t.sells.length,
    tf: t.tf, pbc: t.pbc, tpa: t.tpa, nc: { rating: t.nc.rating, numericRating: t.nc.numericRating, precheckStage: t.nc.precheckStage },
  }));
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), JSON.stringify(detail));
  console.log('\n明细已存 data/analysis-d46b1b6c-per-token.json');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
