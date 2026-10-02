#!/usr/bin/env node
/**
 * 82093ca3 补充：fourmeme 票零成交死因 + 干净因子阈值扫描（v6 票集）
 * 时间戳族因子（regime 效应）从候选中排除。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = '82093ca3-ea73-4f26-9aef-cb9a1acee842';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 3) => v == null ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

(async () => {
  const c = dbManager.getClient();

  // 1. 窗口内两平台创建量（背景）
  const { data: creates } = await c.from('wss_events').select('platform,token_address,block_time').eq('kind', 'token_create')
    .gte('block_time', '2026-09-30T11:00:00Z').lte('block_time', '2026-10-02T02:18:19Z').limit(60000);
  const byPf = {};
  (creates || []).forEach(r => { (byPf[r.platform] = byPf[r.platform] || new Set()).add(r.token_address); });
  for (const [pf, s] of Object.entries(byPf)) console.log(`窗口内 ${pf} 新建 token: ${s.size}`);

  // 2. fire 信号的 token 平台归属 + 死因
  const sigs = [];
  {
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      let q = c.from('strategy_signals').select('id,token_address,metadata->preBuyCheckFactors->>narrativeRating,metadata->preBuyCheckFactors->>earlyTradesTop1BuySharePct,metadata->preBuyCheckFactors->>earlyTradesTop1BuyCovered,metadata->preBuyCheckFactors->>earlyTradesUniqueWallets,metadata->narrativeCall->>numericRating,metadata->tpaFactors->>TPAPre_tokenScore')
        .eq('experiment_id', EXP_ID).eq('action', 'buy').order('id', { ascending: true }).limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data: chunk } = await q;
      if (!chunk || !chunk.length) break;
      sigs.push(...chunk);
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < 1000) break;
    }
  }
  // 成交 token（区分被拦信号）
  const { data: trades } = await c.from('trades').select('token_address').eq('experiment_id', EXP_ID).eq('trade_direction', 'buy').limit(500);
  const bought = new Set(trades.map(t => t.token_address));
  // token 平台
  const sigAddrs = [...new Set(sigs.map(s => s.token_address))];
  const plat = new Map();
  for (let i = 0; i < sigAddrs.length; i += 100) {
    const { data } = await c.from('wss_events').select('token_address,platform').eq('kind', 'token_create').in('token_address', sigAddrs.slice(i, i + 100));
    (data || []).forEach(r => plat.set(r.token_address, r.platform));
  }
  const fmSigs = sigs.filter(s => plat.get(s.token_address) === 'fourmeme');
  console.log(`\nfire 买信号 ${sigs.length} 条（token ${sigAddrs.length} 个）：fourmeme ${fmSigs.length} 条（token ${new Set(fmSigs.map(s => s.token_address)).size} 个）`);
  if (fmSigs.length) {
    const death = { narrative: 0, top1: 0, uw: 0, passed: 0, other: 0 };
    fmSigs.forEach(s => {
      if (bought.has(s.token_address)) { death.passed++; return; }
      const nr = s.narrativeRating != null ? Number(s.narrativeRating) : null;
      const top1 = s.earlyTradesTop1BuySharePct != null ? Number(s.earlyTradesTop1BuySharePct) : null;
      const cov = s.earlyTradesTop1BuyCovered != null ? Number(s.earlyTradesTop1BuyCovered) : null;
      const uw = s.earlyTradesUniqueWallets != null ? Number(s.earlyTradesUniqueWallets) : null;
      if (nr == null || (nr != 2 && nr != 3)) death.narrative++;
      else if (top1 != null && (top1 >= 60 || cov !== 1)) death.top1++;
      else if (uw != null && uw < 15) death.uw++;
      else death.other++;
    });
    console.log(`fourmeme fire 信号死因: 叙事门(≠2/3 或未评) ${death.narrative} / top1 门 ${death.top1} / uw<15 ${death.uw} / 通过(实际买入) ${death.passed} / 其他 ${death.other}`);
    const nrDist = {};
    fmSigs.forEach(s => { const k = s.narrativeRating == null ? 'null' : String(s.narrativeRating); nrDist[k] = (nrDist[k] || 0) + 1; });
    console.log(`fourmeme 信号 narrativeRating 分布: ${JSON.stringify(nrDist)}`);
    const tpDist = {};
    fmSigs.forEach(s => { if (s.TPAPre_tokenScore != null) { const v = Number(s.TPAPre_tokenScore); const k = v <= 2.5 ? '<=2.5' : '>2.5'; tpDist[k] = (tpDist[k] || 0) + 1; } });
    console.log(`fourmeme 信号 TPA tokenScore 分布: ${JSON.stringify(tpDist)}`);
  }

  // 3. v6 票集干净因子阈值扫描
  console.log('\n===== 干净因子阈值扫描（tick 衍生买前信息；净效应=被拦票净盈亏合计，负=避亏） =====');
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-82093ca3-per-token.json'), 'utf8'));
  const scan = [
    ['pbc.earlyTradesNetBuyRatio', t => t.pbc.earlyTradesNetBuyRatio],
    ['pbc.walletTop3TradeRatio', t => t.pbc.walletTop3TradeRatio],
    ['pbc.walletTop1TradeRatio', t => t.pbc.walletTop1TradeRatio],
    ['tf.holderTrendCV', t => t.tf.holderTrendCV],
    ['tpa.TPAPre_zhuangScore', t => t.tpa.TPAPre_zhuangScore],
    ['tpa.TPAPre_minZR', t => t.tpa.TPAPre_minZR],
    ['pbc.walletDiversityIndex', t => t.pbc.walletDiversityIndex],
    ['pbc.earlyTradesUniqueWallets', t => t.pbc.earlyTradesUniqueWallets],
  ];
  for (const [name, get] of scan) {
    const rows = detail.filter(t => get(t) != null);
    if (rows.length < 50) continue;
    const sortedVals = [...new Set(rows.map(get))].sort((a, b) => a - b);
    const out = [];
    for (const dir of ['blockLow', 'blockHigh']) {
      let bestT = null, bestNet = 0, bestN = 0, bestW = 0;
      for (let qi = 0.05; qi <= 0.95; qi += 0.05) {
        const th = quantile(sortedVals, qi);
        const blocked = rows.filter(t => dir === 'blockLow' ? get(t) <= th : get(t) >= th);
        if (blocked.length < 5 || blocked.length > rows.length * 0.6) continue;
        const net = sum(blocked.map(t => t.netBnb));
        const w = blocked.filter(t => t.outcome === 'win').length;
        if (net < bestNet) { bestNet = net; bestT = th; bestN = blocked.length; bestW = w; }
      }
      if (bestT != null) out.push(`${dir === 'blockLow' ? '≤' : '≥'}${fmt(bestT, 2)} → 拦${bestN}(亏${bestN - bestW}/赢${bestW}) 净效应 ${bestNet.toFixed(2)}`);
    }
    if (out.length) console.log(`${name}: ${out.join(' ; ')}`);
  }

  // 4. NetBuyRatio 分箱（时间稳定性）
  console.log('\n===== earlyTradesNetBuyRatio 分箱 =====');
  for (const [lo, hi] of [[0, 40], [40, 55], [55, 65], [65, 75], [75, 101]]) {
    const arr = detail.filter(t => t.pbc.earlyTradesNetBuyRatio != null && t.pbc.earlyTradesNetBuyRatio >= lo && t.pbc.earlyTradesNetBuyRatio < hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`netBuy [${lo},${hi}): n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }
  // 时间半分
  const withT = detail.filter(t => t.firstBuyAt).sort((a, b) => a.firstBuyAt < b.firstBuyAt ? -1 : 1);
  const mid = withT[Math.floor(withT.length / 2)].firstBuyAt;
  for (const [label, pool] of [['前半', withT.filter(t => t.firstBuyAt <= mid)], ['后半', withT.filter(t => t.firstBuyAt > mid)]]) {
    const blocked = pool.filter(t => t.pbc.earlyTradesNetBuyRatio != null && t.pbc.earlyTradesNetBuyRatio < 55);
    const w = blocked.filter(t => t.outcome === 'win').length;
    console.log(`${label} netBuy<55: n=${blocked.length} 赢${w}/亏${blocked.length - w} 净额=${sum(blocked.map(t => t.netBnb)).toFixed(3)}`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
