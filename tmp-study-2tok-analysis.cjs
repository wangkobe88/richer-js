// 两票「吃到更大涨幅」研究——v2 分析（tick 量纲统一，路径+第二波微观结构）
const fs = require('fs');
const path = require('path');
const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp-study-2tok.json')));
const ts = s => new Date(s).getTime();

for (const [tok, rec] of Object.entries(J.toks)) {
  console.log('\n====================', tok, '====================');
  const evCreate = (rec.events || []).find(e => e.kind === 'token_create');
  const px = rec.ticks.filter(r => !r.price_outlier && r.price_bnb != null)
    .map(r => ({ t: ts(r.block_time), p: Number(r.price_bnb), bnb: Number(r.bnb_amount) || 0, type: r.trade_type }))
    .sort((a, b) => a.t - b.t);
  const t0 = px[0].t;
  const S = t => ((t - t0) / 1000).toFixed(0);

  const tradeRows = rec.trades.map(t => {
    const at = ts(t.created_at);
    const md = t.metadata || {};
    return t.trade_direction === 'buy'
      ? { at, dir: 'BUY', bnb: Number(t.input_amount), unit: Number(t.unit_price), cards: '0->4' }
      : { at, dir: 'SELL', bnb: Number(t.output_amount), unit: Number(t.unit_price), cards: md.cardTrade ? `${md.cardTrade.before}->${md.cardTrade.after}` : '', why: md.why || '' };
  });
  const entry = tradeRows[0];
  const buys = rec.trades.filter(t => t.trade_direction === 'buy');
  const perCardTok = Number(buys[0].output_amount) / 4;
  // 量纲桥：unit→tick 比（用首卖行的 tick 价对齐）
  const sells = tradeRows.filter(r => r.dir === 'SELL');

  // 用 tick 价重构「我的持仓市值曲线」（每卡剩余数量×tick价×桥）
  const k = entry.unit / (px.find(r => r.t >= entry.at - 3000).p); // unit per tick-unit
  console.log(`symbol=${evCreate && evCreate.payload.symbol} | 量纲桥 k=${k.toFixed(1)} | ticks=${px.length} span=${((px[px.length-1].t-t0)/1000).toFixed(0)}s`);

  console.log('\n-- 成交链 --');
  let buyBnb = 0, sellBnb = 0;
  for (const r of tradeRows) {
    if (r.dir === 'BUY') buyBnb += r.bnb; else sellBnb += r.bnb;
    console.log(`  ${S(r.at)}s ${r.dir} ${r.bnb.toFixed(4)}BNB +${((r.unit / entry.unit - 1) * 100).toFixed(0)}% cards=${r.cards} ${r.why || ''}`);
  }
  console.log(`  PnL=${(sellBnb - buyBnb).toFixed(4)} BNB (x${(sellBnb / buyBnb).toFixed(2)})`);

  // 逐卡卖出的 tick 价收益 + 卖后轨迹
  console.log('\n-- 每卡卖后轨迹（tick 口径，卖价为 1.00）--');
  for (const s of sells) {
    const w = px.filter(r => r.t > s.at);
    const mx = (mins) => { const seg = w.filter(r => r.t - s.at <= mins * 60000); return seg.length ? Math.max(...seg.map(r => r.p)) : null; };
    const m1 = mx(1), m3 = mx(3), m10 = mx(10), mAll = w.length ? Math.max(...w.map(r => r.p)) : null;
    console.log(`  ${S(s.at)}s +${((s.unit / entry.unit - 1) * 100).toFixed(0)}% → 后1m x${m1 ? (m1 / (s.unit / k)).toFixed(2) : '-'} 后3m x${m3 ? (m3 / (s.unit / k)).toFixed(2) : '-'} 后10m x${m10 ? (m10 / (s.unit / k)).toFixed(2) : '-'} 至末尾 x${mAll ? (mAll / (s.unit / k)).toFixed(2) : '-'}`);
  }

  // 清仓后完整路径：每 30s 采样价（相对清仓价）+ 买卖量
  const lastSell = sells[sells.length - 1];
  const lastSellTickP = px.filter(r => r.t <= lastSell.at).pop().p;
  console.log(`\n-- 清仓后路径（清仓 @${S(lastSell.at)}s tickP=${lastSellTickP.toExponential(3)}）--`);
  for (let m = 0; m <= (px[px.length - 1].t - lastSell.at) / 60000; m++) {
    const seg = px.filter(r => r.t > lastSell.at + m * 60000 && r.t <= lastSell.at + (m + 1) * 60000);
    if (!seg.length) continue;
    const hi = Math.max(...seg.map(r => r.p)), lo = Math.min(...seg.map(r => r.p)), lastP = seg[seg.length - 1].p;
    const buyB = seg.filter(r => r.type === 'buy').reduce((a, r) => a + r.bnb, 0);
    const sellB = seg.filter(r => r.type === 'sell').reduce((a, r) => a + r.bnb, 0);
    const wallets = new Set(seg.filter(r => r.type === 'buy').map(r => (r.sender_address || r.trader_address || '').toLowerCase()));
    console.log(`  +${m + 1}min: hi x${(hi / lastSellTickP).toFixed(2)} lo x${(lo / lastSellTickP).toFixed(2)} end x${(lastP / lastSellTickP).toFixed(2)} | vol buy=${buyB.toFixed(2)} sell=${sellB.toFixed(2)} BNB buyWallets=${wallets.size} ticks=${seg.length}`);
  }

  // 第二波起涨点：清仓后第一个「局部低点→新高确认」的时点
  console.log('\n-- 第二波结构 --');
  const after = px.filter(r => r.t > lastSell.at);
  // 累计 max 曲线，找「距清仓后峰值回撤最深点」和「其后创新高时点」
  let runMax = 0, runMaxT = 0, ddLow = Infinity, ddLowT = 0, ddFromT = 0, runMax2 = 0;
  for (const r of after) {
    if (r.p > runMax) { runMax = r.p; runMaxT = r.t; }
    if (r.p < runMax * 0.7 && r.p < ddLow) { /*深回撤>30% 才记录*/ }
  }
  // 简化：清仓后全局 low（前 3 分钟内）与其后 ATH
  const first3 = after.filter(r => r.t - lastSell.at <= 180000);
  let lowR = null; for (const r of first3) if (!lowR || r.p < lowR.p) lowR = r;
  const afterLow = after.filter(r => r.t > lowR.t);
  let hiR = null; for (const r of afterLow) if (!hiR || r.p > hiR.p) hiR = r;
  // low→hi 之间用时 & 突破清仓价时点
  const breakEven = afterLow.find(r => r.p > lastSellTickP);
  console.log(`  清仓后低点: ${S(lowR.t)}s x${(lowR.p / lastSellTickP).toFixed(2)} | 其后峰: ${S(hiR.t)}s x${(hiR.p / lastSellTickP).toFixed(2)} (低点→峰 +${((hiR.p / lowR.p - 1) * 100).toFixed(0)}%, 用时 ${((hiR.t - lowR.t) / 1000).toFixed(0)}s)`);
  console.log(`  重新突破清仓价: ${breakEven ? S(breakEven.t) + 's (清仓后 ' + ((breakEven.t - lastSell.at) / 1000).toFixed(0) + 's)' : '窗内未突破'}`);
  // 低点前后 60s 买量对比（判断「企稳放量」）
  for (const [lbl, win] of [['低点前60s', [lowR.t - 60000, lowR.t]], ['低点后60s', [lowR.t, lowR.t + 60000]], ['突破清仓价后60s', breakEven ? [breakEven.t, breakEven.t + 60000] : null]]) {
    if (!win) continue;
    const seg = px.filter(r => r.t >= win[0] && r.t <= win[1]);
    const bb = seg.filter(r => r.type === 'buy').reduce((a, r) => a + r.bnb, 0);
    const sb = seg.filter(r => r.type === 'sell').reduce((a, r) => a + r.bnb, 0);
    console.log(`  ${lbl}: buy=${bb.toFixed(2)} sell=${sb.toFixed(2)} BNB ticks=${seg.length}`);
  }
}
console.log('\n== 卖腿定义（P7/P10/P11）==');
for (const l of J.legs || []) {
  console.log(`P${l.priority} [${l.side}] ${l.name} cards=${l.cards} bypass=${l.bypass}\n   cond: ${String(l.condition).slice(0, 300)}`);
}
