// 多次再入场模拟：触发器 A/B + dd30 止损 + 冷却，最多 3 次
const fs = require('fs');
const path = require('path');
const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp-study-2tok.json')));
const ts = s => new Date(s).getTime();

function run(rec, label, mk) {
  const px = rec.ticks.filter(r => !r.price_outlier && r.price_bnb != null)
    .map(r => ({ t: ts(r.block_time), p: Number(r.price_bnb), bnb: Number(r.bnb_amount) || 0, type: r.trade_type }))
    .sort((a, b) => a.t - b.t);
  const t0 = px[0].t; const S = t => ((t - t0) / 1000).toFixed(0);
  const sells = rec.trades.filter(t => t.trade_direction === 'sell');
  const lastSellAt = ts(sells[sells.length - 1].created_at);
  const lastSellP = px.filter(r => r.t <= lastSellAt).pop().p;

  let cooldownUntil = lastSellAt + 30000, pnl = 0, trades = [];
  for (let n = 0; n < 3; n++) {
    const idx0 = px.findIndex(r => r.t >= cooldownUntil);
    if (idx0 < 0) break;
    const entry = mk(px, lastSellAt, lastSellP, idx0);
    if (!entry) break;
    // dd30 离场
    let peak = entry.p, exit = null;
    for (let i = px.findIndex(r => r.t >= entry.at) + 1; i < px.length; i++) {
      const r = px[i];
      if (r.p > peak) peak = r.p;
      if (r.p <= peak * 0.7) { exit = r; break; }
    }
    const exitP = exit ? exit.p : px[px.length - 1].p;
    const exitT = exit ? exit.t : px[px.length - 1].t;
    const mult = exitP / entry.p;
    pnl += 0.2 * (mult - 1);
    trades.push(`${S(entry.at)}s→${exit ? S(exit.t) + 's' : '窗末'} x${mult.toFixed(2)} (${(0.2 * (mult - 1) >= 0 ? '+' : '')}${(0.2 * (mult - 1)).toFixed(3)})`);
    cooldownUntil = exitT + 120000;
    if (!exit) break;
  }
  console.log(`  [${label}] 总PnL=${pnl.toFixed(3)} BNB | ${trades.length ? trades.join(' | ') : '无交易'}`);
}

const mkA = (px, lastSellAt, lastSellP, idx0) => {
  for (let i = idx0; i < px.length; i++) {
    const r = px[i];
    if (r.p < lastSellP * 1.02) continue;
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy >= 1.5 && buy > sell) return { at: r.t, p: r.p };
  }
  return null;
};
const mkB = (px, lastSellAt, lastSellP, idx0) => {
  for (let i = idx0; i < px.length; i++) {
    const r = px[i];
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy < 2.5 || buy - sell < 1.0) continue;
    const w3 = px.filter(x => x.t > r.t - 180000 && x.t <= r.t);
    const hi3 = Math.max(...w3.map(x => x.p));
    if (r.p >= hi3 * 0.999) return { at: r.t, p: r.p };
  }
  return null;
};
// D：A 的量确认加强版（buy≥2.5 且净≥1.0 且突破清仓价）
const mkD = (px, lastSellAt, lastSellP, idx0) => {
  for (let i = idx0; i < px.length; i++) {
    const r = px[i];
    if (r.p < lastSellP * 1.02) continue;
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy >= 2.5 && buy - sell >= 1.0) return { at: r.t, p: r.p };
  }
  return null;
};

for (const [tok, rec] of Object.entries(J.toks)) {
  const ev = (rec.events || []).find(e => e.kind === 'token_create');
  console.log(`\n==== ${ev && ev.payload.symbol} ====`);
  run(rec, 'A×3 突破清仓价(buy≥1.5,net>0)', mkA);
  run(rec, 'D×3 突破清仓价(buy≥2.5,net≥1)', mkD);
  run(rec, 'B×3 放量破3min高(buy≥2.5,net≥1)', mkB);
}
