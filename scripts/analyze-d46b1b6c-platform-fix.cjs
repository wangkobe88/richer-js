#!/usr/bin/env node
/**
 * d46b1b6c 补充分析 v2：平台归属改用 wss_events token_create（experiment_tokens.platform 大多 null 不可用）
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
function auc(wv, lv) {
  let u = 0;
  for (const w of wv) for (const l of lv) u += w > l ? 1 : (w < l ? 0 : 0.5);
  return wv.length && lv.length ? u / (wv.length * lv.length) : null;
}

(async () => {
  const c = dbManager.getClient();
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), 'utf8'));

  // 平台归属：wss_events token_create 批查
  const addrs = detail.map(t => t.addr);
  const plat = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const { data } = await c.from('wss_events').select('token_address,platform').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 100));
    (data || []).forEach(r => plat.set(r.token_address, r.platform));
  }
  for (const t of detail) t.platform = plat.get(t.addr) || 'no-create-event';

  console.log('===== 平台分解（wss_events token_create 归属） =====');
  for (const pf of ['fourmeme', 'flap', 'no-create-event']) {
    const arr = detail.filter(t => t.platform === pf);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`${pf}: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)} 中位=${fmt(quantile(arr.map(t=>t.netBnb).sort((a,b)=>a-b),0.5),4)}`);
  }

  // strictSameNameTokenCount 平台内分箱（防平台代理混杂）
  console.log('\n===== strictSameNameTokenCount 分箱 × 平台 =====');
  for (const pf of ['fourmeme', 'flap']) {
    for (const [lo, hi] of [[0, 4], [5, 9], [10, 19], [20, 999]]) {
      const arr = detail.filter(t => t.platform === pf && t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount >= lo && t.pbc.strictSameNameTokenCount <= hi);
      if (!arr.length) continue;
      const w = arr.filter(t => t.outcome === 'win').length;
      console.log(`[${pf}] sameName [${lo},${hi}]: n=${arr.length} win=${w}(${arr.length ? (100 * w / arr.length).toFixed(0) : 0}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
    }
  }

  // uniqueWallets 分箱 × 平台
  console.log('\n===== uniqueWallets 分箱 × 平台 =====');
  for (const pf of ['fourmeme', 'flap']) {
    for (const [lo, hi] of [[0, 9], [10, 14], [15, 19], [20, 29], [30, 999]]) {
      const arr = detail.filter(t => t.platform === pf && t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets >= lo && t.pbc.earlyTradesUniqueWallets <= hi);
      if (!arr.length) continue;
      const w = arr.filter(t => t.outcome === 'win').length;
      console.log(`[${pf}] uw [${lo},${hi}]: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
    }
  }

  // 热度族平台内 AUC（fourmeme 单独）
  console.log('\n===== 热度族 fourmeme 平台内 AUC =====');
  const fm = detail.filter(t => t.platform === 'fourmeme');
  const fmW = fm.filter(t => t.outcome === 'win'), fmL = fm.filter(t => t.outcome === 'loss');
  console.log(`fourmeme: n=${fm.length} w=${fmW.length} l=${fmL.length}`);
  for (const k of ['earlyTradesUniqueWallets', 'earlyTradesSniperHolders', 'earlyTradesTotalCount', 'earlyTradesUniformBuyWallets', 'strictSameNameTokenCount', 'walletTop3TradeRatio', 'earlyTradesRouterPct', 'earlyTradesTop1BuySharePct']) {
    const a = auc(fmW.map(t => t.pbc[k]).filter(v => v != null), fmL.map(t => t.pbc[k]).filter(v => v != null));
    console.log(`${k}: AUC=${a == null ? 'n/a' : a.toFixed(3)}`);
  }

  // 热度族相关矩阵（fourmeme 内）
  console.log('\n===== 热度族相关矩阵（fourmeme 内 Pearson） =====');
  const keys = ['earlyTradesUniqueWallets', 'earlyTradesSniperHolders', 'earlyTradesTotalCount', 'earlyTradesUniformBuyWallets', 'strictSameNameTokenCount', 'walletTop3TradeRatio'];
  function corr(k1, k2) {
    const rows = fm.filter(t => t.pbc[k1] != null && t.pbc[k2] != null);
    if (rows.length < 30) return null;
    const x = rows.map(t => t.pbc[k1]), y = rows.map(t => t.pbc[k2]);
    const mx = sum(x) / x.length, my = sum(y) / y.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy);
  }
  for (let i = 0; i < keys.length; i++) {
    const parts = keys.map((k2, j) => i === j ? '  1  ' : (corr(keys[i], k2) == null ? '  ·  ' : corr(keys[i], k2).toFixed(2).padStart(5)));
    console.log(`${keys[i].padEnd(28)} ${parts.join(' ')}`);
  }

  // fourmeme 内候选门效果
  console.log('\n===== 候选门效果（fourmeme 内 / 全票集） =====');
  const gates = [
    ['strictSameNameTokenCount <= 4', t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 4],
    ['strictSameNameTokenCount <= 7', t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 7],
    ['uniqueWallets <= 14', t => t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14],
    ['sniperHolders <= 10', t => t.pbc.earlyTradesSniperHolders != null && t.pbc.earlyTradesSniperHolders <= 10],
    ['sameName<=4 ∪ uw<=14', t => (t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 4) || (t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14)],
    ['tpaScore <= 2.5', t => t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.5],
    ['routerPct >= 75', t => t.pbc.earlyTradesRouterPct != null && t.pbc.earlyTradesRouterPct >= 75],
  ];
  for (const [name, fn] of gates) {
    for (const [label, pool] of [['fourmeme', fm], ['全部', detail]]) {
      const blocked = pool.filter(fn);
      if (!blocked.length) { console.log(`${name} [${label}]: 拦 0`); continue; }
      const w = blocked.filter(t => t.outcome === 'win').length;
      const net = sum(blocked.map(t => t.netBnb));
      console.log(`${name} [${label}]: 拦 ${blocked.length}（亏 ${blocked.length - w}/赢 ${w}）净效应 ${net.toFixed(3)} | 池净额 ${sum(pool.map(t=>t.netBnb)).toFixed(3)} → 拦后 ${(sum(pool.map(t=>t.netBnb)) - net).toFixed(3)}`);
    }
  }

  // 卖侧快查：亏损票里有多少是被止损腿卖出的（-50% 硬扛 vs 其他）
  console.log('\n===== 亏损票退出方式速览（最后一笔卖信号的 strategyId） =====');
  const { data: sellSigs } = await c.from('strategy_signals').select('token_address,metadata->>strategyId,created_at').eq('experiment_id', EXP_ID).eq('action', 'sell').order('created_at', { ascending: true }).limit(1000);
  const lastSellByToken = new Map();
  (sellSigs || []).forEach(s => lastSellByToken.set(s.token_address, s.metadata?.strategyId || '?'));
  const exitDist = {};
  for (const t of detail) {
    const sid = lastSellByToken.get(t.addr) || (t.netBnb < 0 ? 'no-sell(强平?)' : 'no-sell');
    exitDist[sid] = (exitDist[sid] || 0) + 1;
  }
  console.log(JSON.stringify(exitDist));

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
