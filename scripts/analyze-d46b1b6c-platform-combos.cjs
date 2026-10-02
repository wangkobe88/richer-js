#!/usr/bin/env node
/**
 * d46b1b6c 补充分析：平台分解（排除 flap 冷清混杂）+ 热度族相关性 + 组合拦截 + 买点细分
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'd46b1b6c-7752-4d89-a5ad-309b06312bab';
const fmt = (v, d = 3) => v == null || (typeof v === 'number' && !isFinite(v)) ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);
const sum = a => a.reduce((x, y) => x + y, 0);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function auc(winVals, lossVals) {
  let u = 0;
  for (const w of winVals) for (const l of lossVals) u += w > l ? 1 : (w < l ? 0 : 0.5);
  const n1 = winVals.length, n2 = lossVals.length, N = n1 * n2;
  if (!N) return null;
  return u / N;
}

(async () => {
  const c = dbManager.getClient();
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), 'utf8'));

  // 平台归属
  const { data: ets } = await c.from('experiment_tokens').select('token_address,platform').eq('experiment_id', EXP_ID).limit(1000);
  const platformByAddr = new Map((ets || []).map(e => [e.token_address, e.platform]));
  for (const t of detail) t.platform = platformByAddr.get(t.addr) || 'unknown';

  console.log('===== 平台分解 =====');
  for (const pf of ['fourmeme', 'flap', 'unknown']) {
    const arr = detail.filter(t => t.platform === pf);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`${pf}: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)} 中位=${fmt(quantile(arr.map(t=>t.netBnb).sort((a,b)=>a-b),0.5),4)}`);
  }

  // 平台内热度因子区分度（fourmeme 单独 + flap 单独）
  const heatKeys = ['earlyTradesUniqueWallets', 'earlyTradesSniperHolders', 'earlyTradesTotalCount', 'earlyTradesUniformBuyWallets', 'earlyTradesFilteredCount', 'strictSameNameTokenCount', 'walletTop3TradeRatio'];
  console.log('\n===== 热度族因子：平台内 AUC（win vs loss） =====');
  for (const pf of ['fourmeme', 'flap']) {
    const arr = detail.filter(t => t.platform === pf);
    const wins = arr.filter(t => t.outcome === 'win'), losses = arr.filter(t => t.outcome === 'loss');
    if (wins.length < 5 || losses.length < 5) continue;
    const line = heatKeys.map(k => {
      const wv = wins.map(t => t.pbc[k]).filter(v => v != null);
      const lv = losses.map(t => t.pbc[k]).filter(v => v != null);
      const a = auc(wv, lv);
      return `${k}=${a ? a.toFixed(3) : 'n/a'}`;
    });
    console.log(`[${pf} n=${arr.length} w=${wins.length} l=${losses.length}] ${line.join(' ')}`);
  }

  // 热度族相关矩阵（fourmeme 内，Pearson）
  console.log('\n===== 热度族相关性（fourmeme 内 Pearson） =====');
  const fm = detail.filter(t => t.platform === 'fourmeme');
  function corr(k1, k2) {
    const rows = fm.filter(t => t.pbc[k1] != null && t.pbc[k2] != null);
    if (rows.length < 30) return null;
    const x = rows.map(t => t.pbc[k1]), y = rows.map(t => t.pbc[k2]);
    const mx = sum(x) / x.length, my = sum(y) / y.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy);
  }
  for (let i = 0; i < heatKeys.length; i++) {
    const parts = [];
    for (let j = 0; j < heatKeys.length; j++) {
      if (i === j) { parts.push('  1  '); continue; }
      const r = corr(heatKeys[i], heatKeys[j]);
      parts.push(r == null ? '  ·  ' : r.toFixed(2).padStart(5));
    }
    console.log(`${heatKeys[i].padEnd(28)} ${parts.join(' ')}`);
  }

  // 组合拦截分析
  console.log('\n===== 组合拦截（净效应=被拦票净盈亏合计，负=避亏） =====');
  const filters = [
    ['A: uniqueWallets<=14.5', t => t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14.5],
    ['B: routerPct>=76', t => t.pbc.earlyTradesRouterPct != null && t.pbc.earlyTradesRouterPct >= 76],
    ['C: tpaScore<=2.54', t => t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.54],
    ['D: strictSameName<=5', t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 5],
    ['E: sniperHolders<=10.85', t => t.pbc.earlyTradesSniperHolders != null && t.pbc.earlyTradesSniperHolders <= 10.85],
    ['A∪B∪C（热度+router+tpa 三族各取最优）', t => (t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14.5) || (t.pbc.earlyTradesRouterPct != null && t.pbc.earlyTradesRouterPct >= 76) || (t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.54)],
    ['A∪B∪C∪D∪E（五候选全并）', t => (t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14.5) || (t.pbc.earlyTradesRouterPct != null && t.pbc.earlyTradesRouterPct >= 76) || (t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.54) || (t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 5) || (t.pbc.earlyTradesSniperHolders != null && t.pbc.earlyTradesSniperHolders <= 10.85)],
  ];
  for (const [name, fn] of filters) {
    const blocked = detail.filter(fn);
    const w = blocked.filter(t => t.outcome === 'win').length;
    const net = sum(blocked.map(t => t.netBnb));
    const fmBlocked = blocked.filter(t => t.platform === 'fourmeme').length;
    console.log(`${name}: 拦 ${blocked.length} 票（亏 ${blocked.length - w} / 赢 ${w}；fourmeme ${fmBlocked}/flap ${blocked.length - fmBlocked}）净效应 ${net.toFixed(3)} → 全局净额 ${7.536 - net >= 0 ? '+' : ''}${(7.536 - net).toFixed(3)}`);
  }

  // 买点 tokenAgeSec 细分
  console.log('\n===== tokenAgeSec 买点细分（fire 时刻） =====');
  const bins = [[0, 30], [30, 50], [50, 70], [70, 90], [90, 999]];
  for (const [lo, hi] of bins) {
    const arr = detail.filter(t => t.tf.tokenAgeSec != null && t.tf.tokenAgeSec >= lo && t.tf.tokenAgeSec < hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`ageSec [${lo},${hi}): n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // strictSameNameTokenCount 分箱
  console.log('\n===== strictSameNameTokenCount 分箱 =====');
  const sb = [[0, 4], [5, 9], [10, 19], [20, 999]];
  for (const [lo, hi] of sb) {
    const arr = detail.filter(t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount >= lo && t.pbc.strictSameNameTokenCount <= hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`sameName [${lo},${hi}]: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // uniqueWallets 分箱（fourmeme 内，剔除平台混杂后的纯效应）
  console.log('\n===== uniqueWallets 分箱（fourmeme 内） =====');
  const ub = [[0, 9], [10, 14], [15, 19], [20, 29], [30, 999]];
  for (const [lo, hi] of ub) {
    const arr = fm.filter(t => t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets >= lo && t.pbc.earlyTradesUniqueWallets <= hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`uw [${lo},${hi}]: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // routerPct 分箱（细看区间门）
  console.log('\n===== routerPct 分箱（区间门 [50,80) 细看） =====');
  const rb = [[50, 55], [55, 60], [60, 65], [65, 70], [70, 75], [75, 78], [78, 80]];
  for (const [lo, hi] of rb) {
    const arr = detail.filter(t => t.pbc.earlyTradesRouterPct != null && t.pbc.earlyTradesRouterPct >= lo && t.pbc.earlyTradesRouterPct < hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`router [${lo},${hi}): n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
