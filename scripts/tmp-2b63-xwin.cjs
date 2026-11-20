// 跨窗扫描：捆绑砸盘尾声形状（BP77/BP82 砸块锚口径的纯代码重放）
// 用法: node scripts/tmp-2b63-xwin.cjs <expId8> [expId8 ...]
const { dbManager } = require('../src/services/dbManager');

const ROUTERS = new Set([
  '0x1de460be8452e26d41bfbe1b0013e4d8e9335364', // GMGN（按需补 9 址全集）
].map(a => a.toLowerCase()));

function walletOf(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }

// 砸块检测：锚前 60s 内，单块 & 相邻双块合并
function detectDumpBlocks(ts, anchorMs) {
  // ts: 已按时间序 ticks
  const win = ts.filter(t => {
    const ms = new Date(t.block_time).getTime();
    return ms <= anchorMs && ms >= anchorMs - 60000;
  });
  const byBlock = new Map();
  for (const t of win) {
    if (!byBlock.has(t.block_number)) byBlock.set(t.block_number, []);
    byBlock.get(t.block_number).push(t);
  }
  const blocks = [...byBlock.entries()].sort((a, b) => a[0] - b[0]);
  const cands = [];
  for (let i = 0; i < blocks.length; i++) {
    for (const span of [[blocks[i]], i + 1 < blocks.length && blocks[i + 1][0] === blocks[i][0] + 1 ? [blocks[i], blocks[i + 1]] : null]) {
      if (!span) continue;
      const rows = span.flatMap(s => s[1]);
      const sells = rows.filter(r => String(r.trade_type).toUpperCase() !== 'BUY');
      const relSells = sells.filter(r => !ROUTERS.has(walletOf(r)));
      const sellers = new Set(relSells.map(walletOf));
      const sellBnb = relSells.reduce((a, r) => a + Number(r.bnb_amount), 0);
      if (sellers.size < 4 || sellBnb < 0.5) continue;
      // 跌幅：块内首末卖价（可靠价）
      const px = relSells.filter(r => Number(r.price_bnb) > 0).map(r => Number(r.price_bnb));
      const dropPct = px.length >= 2 ? (px[px.length - 1] / px[0] - 1) * 100 : null;
      const lastSellMs = Math.max(...relSells.map(r => new Date(r.block_time).getTime()));
      const secToAnchor = (anchorMs - lastSellMs) / 1000;
      // 承接：砸块后（block 严格更大）到锚的买入
      const maxBlock = Math.max(...span.map(s => s[0]));
      const followBuy = win.filter(r => String(r.trade_type).toUpperCase() === 'BUY' && r.block_number > maxBlock)
        .reduce((a, r) => a + Number(r.bnb_amount), 0);
      cands.push({
        blocks: span.map(s => s[0]).join('+'), nSellers: sellers.size, sellBnb,
        dropPct, secToAnchor, followBuy,
        followRatio: followBuy / sellBnb,
        single: span.length === 1,
      });
    }
  }
  return cands;
}

async function main() {
  const expIds = process.argv.slice(2);
  if (!expIds.length) { console.error('usage: node tmp-2b63-xwin.cjs <expId8...>'); process.exit(1); }
  const sb = dbManager.getClient();
  const { data: allExps } = await sb.from('experiments').select('id,experiment_name,config').order('created_at', { ascending: false }).limit(200);
  for (const id8 of expIds) {
    const exp = (allExps || []).find(e => e.id.startsWith(id8));
    if (!exp) { console.log('EXP NOT FOUND', id8); continue; }
    const expId = exp.id;
    // 成交 BUY trades
    const { data: trades } = await sb.from('trades').select('token_address,created_at,trade_direction,input_amount,output_amount,unit_price,metadata')
      .eq('experiment_id', expId).order('created_at');
    const buyTrades = (trades || []).filter(t => t.trade_direction === 'BUY');
    const sellByToken = new Map();
    for (const t of (trades || []).filter(x => x.trade_direction === 'SELL')) {
      if (!sellByToken.has(t.token_address)) sellByToken.set(t.token_address, []);
      sellByToken.get(t.token_address).push(t);
    }
    console.log(`\n########## ${id8} ${exp.experiment_name} | 成交买=${buyTrades.length}`);

    // 首买 per token（buyPhase first 语义近似：每 token 首笔成交买）
    const firstBuy = new Map();
    for (const t of buyTrades) if (!firstBuy.has(t.token_address)) firstBuy.set(t.token_address, t);

    const hits = [], noHits = [];
    const tokenTicksCache = new Map();
    for (const [token, bt] of firstBuy) {
      const { data: ticks } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,price_bnb,bnb_amount,trade_type,price_outlier,sender_address,trader_address')
        .eq('token_address', token).order('block_time').limit(5000);
      const ts = ticks || [];
      if (ts.length) tokenTicksCache.set(token, ts);
      const anchorMs = new Date(bt.created_at).getTime();
      const cands = detectDumpBlocks(ts, anchorMs);
      // 命中判据（BP 线 variant A）：卖方≥4∧卖额≥0.5∧跌幅≥10%（跌幅缺失容缺不过线不拦）∧承接线
      const hitA = cands.filter(c =>
        c.dropPct !== null && c.dropPct <= -10 &&
        (c.secToAnchor < 10 ? c.followRatio < 0.3 : c.followRatio < 0.5));
      // variant B（CD403 线）：卖方≥8 ∧ 承接比<0.3
      const hitB = cands.filter(c => c.nSellers >= 8 && c.followRatio < 0.3);
      // pnl：卖出净额 - 买入（含后续再买卖简化：Σsell.out - Σbuy.in）
      const sells = sellByToken.get(token) || [];
      const pnl = sells.reduce((a, s) => a + Number(s.output_amount || 0), 0) - buyTrades.filter(b => b.token_address === token)
        .reduce((a, b) => a + Number(b.input_amount || 0), 0);
      const totalVol = ts.reduce((a, t) => a + Number(t.bnb_amount || 0), 0);
      const rec = { token, buyAt: bt.created_at, pnl, nBuys: buyTrades.filter(b => b.token_address === token).length, totalVol, hitA, hitB };
      if (rec.hitA.length) hits.push(rec); else noHits.push(rec);
    }
    const sum = arr => arr.reduce((a, r) => a + r.pnl, 0);
    console.log(`variantA(BP线) 命中 ${hits.length}/${firstBuy.size} | 命中票 pnlΣ=${sum(hits).toFixed(4)} | 未命中 pnlΣ=${sum(noHits).toFixed(4)}`);
    for (const h of hits) {
      const c = h.hitA[0];
      console.log(`  HIT ${h.token.slice(0, 10)} buy@${String(h.buyAt).slice(11, 19)} pnl=${h.pnl.toFixed(4)} | 砸块=${c.blocks} 卖方=${c.nSellers} 卖额=${c.sellBnb.toFixed(3)} 跌幅=${c.dropPct.toFixed(1)}% 距锚=${c.secToAnchor.toFixed(0)}s 承接比=${(c.followRatio * 100).toFixed(1)}% 总额=${h.totalVol.toFixed(1)}`);
    }
    // variant B 单独统计
    const hitsB = [...noHits, ...hits].map(r => ({ ...r, onlyB: r.hitB.filter(b => !r.hitA.some(a => a.blocks === b.blocks)) })).filter(r => r.onlyB.length);
    if (hitsB.length) {
      console.log(`variantB 追加命中（A 未中 B 中）: ${hitsB.length}`);
      for (const h of hitsB.slice(0, 10)) console.log(`  +B ${h.token.slice(0, 10)} pnl=${h.pnl.toFixed(4)} | ${h.onlyB.map(b => `卖方${b.nSellers} 卖额${b.sellBnb.toFixed(2)} 承接${(b.followRatio * 100).toFixed(0)}%`).join('; ')}`);
    }
    // 对照：未命中票的最差 5（看看形状多近）
    noHits.sort((a, b) => a.pnl - b.pnl);
    console.log('未命中票 pnl 最差 5（形状复查用）:');
    for (const r of noHits.slice(0, 5)) console.log(`   ${r.token.slice(0, 10)} pnl=${r.pnl.toFixed(4)} 总额=${r.totalVol.toFixed(1)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
