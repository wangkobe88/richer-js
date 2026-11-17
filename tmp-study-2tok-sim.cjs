// 两票「再买回」触发器模拟——清仓后二次启动的可判定性与收益
const fs = require('fs');
const path = require('path');
const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp-study-2tok.json')));
const ts = s => new Date(s).getTime();

function sim(rec, label, trig) {
  const px = rec.ticks.filter(r => !r.price_outlier && r.price_bnb != null)
    .map(r => ({ t: ts(r.block_time), p: Number(r.price_bnb), bnb: Number(r.bnb_amount) || 0, type: r.trade_type }))
    .sort((a, b) => a.t - b.t);
  const t0 = px[0].t;
  const S = t => ((t - t0) / 1000).toFixed(0);
  const sells = rec.trades.filter(t => t.trade_direction === 'sell');
  const lastSellAt = ts(sells[sells.length - 1].created_at);
  const lastSellP = px.filter(r => r.t <= lastSellAt).pop().p;

  const r2 = trig(px, lastSellAt, lastSellP);
  if (!r2) { console.log(`  [${label}] 未触发`); return null; }
  // 买回后 dd30 卖出模拟
  const after = px.filter(r => r.t >= r2.at);
  let peak = r2.px, exit = null;
  for (const r of after) {
    if (r.p > peak) peak = r.p;
    if (r.p <= peak * 0.7) { exit = { at: r.t, p: r.p, peak }; break; }
  }
  const STAKE = 0.2;
  const exitP = exit ? exit.p : px[px.length - 1].p; // 窗末未触发=按末价估算（保守标注）
  const mult = exitP / r2.px;
  const pnl = STAKE * (mult - 1);
  console.log(`  [${label}] 买回@${S(r2.at)}s x${(r2.px / lastSellP).toFixed(2)}(清仓价=1) → 卖@${exit ? S(exit.at) + 's' : '窗末'} x${mult.toFixed(2)} (${exit ? 'dd30' : '未平仓·末价口径'}) PnL=${pnl.toFixed(3)} BNB | 触发时近60s: buy=${r2.win.buy.toFixed(2)} net=${(r2.win.buy - r2.win.sell).toFixed(2)}`);
  return pnl;
}

// 触发器 A：突破清仓价 1.02x ∧ 近60s 买量≥1.5 ∧ 净买>0
const trigA = (px, lastSellAt, lastSellP) => {
  for (const r of px) {
    if (r.t <= lastSellAt + 30000) continue; // 清仓后至少 30s
    if (r.p < lastSellP * 1.02) continue;
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy >= 1.5 && buy > sell) return { at: r.t, px: r.p, win: { buy, sell } };
  }
  return null;
};
// 触发器 B：放量+突破近180s高（不依赖清仓价）∧ 近60s 买量≥2.5 ∧ 净买比≥30%
const trigB = (px, lastSellAt, lastSellP) => {
  for (const r of px) {
    if (r.t <= lastSellAt + 60000) continue;
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy < 2.5 || buy / (buy + sell || 1) < 0.6) continue;
    const w3 = px.filter(x => x.t > r.t - 180000 && x.t <= r.t);
    const hi3 = Math.max(...w3.map(x => x.p));
    if (r.p >= hi3 * 0.999) return { at: r.t, px: r.p, win: { buy, sell } };
  }
  return null;
};
// 触发器 C（更严）：B 基础上要求近60s 买量≥3.5 且净买额≥1.5
const trigC = (px, lastSellAt) => {
  for (const r of px) {
    if (r.t <= lastSellAt + 60000) continue;
    const w = px.filter(x => x.t > r.t - 60000 && x.t <= r.t);
    const buy = w.filter(x => x.type === 'buy').reduce((a, x) => a + x.bnb, 0);
    const sell = w.filter(x => x.type === 'sell').reduce((a, x) => a + x.bnb, 0);
    if (buy < 3.5 || buy - sell < 1.5) continue;
    const w3 = px.filter(x => x.t > r.t - 180000 && x.t <= r.t);
    const hi3 = Math.max(...w3.map(x => x.p));
    if (r.p >= hi3 * 0.999) return { at: r.t, px: r.p, win: { buy, sell } };
  }
  return null;
};

for (const [tok, rec] of Object.entries(J.toks)) {
  const ev = (rec.events || []).find(e => e.kind === 'token_create');
  console.log(`\n==== ${ev && ev.payload.symbol} ${tok} ====`);
  sim(rec, 'A 突破清仓价+量确认', trigA);
  sim(rec, 'B 放量+破3min高', trigB);
  sim(rec, 'C 强放量(≥3.5B/60s,净≥1.5)', trigC);
}

// 另一组对照：第一波「延迟卖出」——P11 -25 全清腿若改为 -40，两票各卡实际会在哪卖
console.log('\n==== 延迟卖出对照（回撤线 -25→-40，逐卡从 fire 峰跟踪）====');
for (const [tok, rec] of Object.entries(J.toks)) {
  const ev = (rec.events || []).find(e => e.kind === 'token_create');
  const px = rec.ticks.filter(r => !r.price_outlier && r.price_bnb != null)
    .map(r => ({ t: ts(r.block_time), p: Number(r.price_bnb), bnb: Number(r.bnb_amount) || 0, type: r.trade_type }))
    .sort((a, b) => a.t - b.t);
  const t0 = px[0].t; const S = t => ((t - t0) / 1000).toFixed(0);
  const buys = rec.trades.filter(t => t.trade_direction === 'buy');
  const perCardTok = Number(buys[0].output_amount) / 4;
  const k = Number(buys[0].unit_price) / px[0].p; // unit→tick 近似桥（用各自口径比例）
  console.log(`\n-- ${ev && ev.payload.symbol} --`);
  for (const dd of [25, 40, 50]) {
    let out = 0; const cells = [];
    // 每卡跟踪从「首 +100% 止盈点」起（P7 同款起点），dd 触发卖
    const entryAt = ts(rec.trades.find(t => t.trade_direction === 'buy').created_at);
    for (let c = 0; c < 4; c++) {
      const start = px.findIndex(r => r.t >= entryAt);
      let peak = px[start].p, exitP = px[px.length - 1].p, exitT = '窗末';
      for (let i = start + 1; i < px.length; i++) {
        const r = px[i];
        if (r.p > peak) peak = r.p;
        if (r.p <= peak * (1 - dd / 100)) { exitP = r.p; exitT = S(r.t) + 's'; break; }
      }
      out += perCardTok * exitP * k;
      cells.push(`${exitT}@+${((exitP * k / Number(buys[0].unit_price) - 1) * 100).toFixed(0)}%`);
    }
    const realOut = rec.trades.filter(t => t.trade_direction === 'sell').reduce((a, t) => a + Number(t.output_amount), 0);
    console.log(`  单一dd${dd}%全程跟踪: out=${out.toFixed(4)} vs 实际逐卡=${realOut.toFixed(4)} Δ${(out - realOut).toFixed(4)} [${cells.join(' ')}]`);
  }
}
