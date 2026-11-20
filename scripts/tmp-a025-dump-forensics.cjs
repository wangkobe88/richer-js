#!/usr/bin/env node
// 0xa025b8d8fb396890c0b469d8f056727e99577777 捆绑砸盘取证（bt-v147）v2
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0xa025b8d8fb396890c0b469d8f056727e99577777';
const LAUNCH_WIN_MS = 90000;
const DUST = 0.015;

async function main() {
  const sb = dbManager.getClient();
  const { data: exp, error: eerr } = await sb.from('experiments').select('*').eq('id', EXP).limit(1);
  if (eerr) console.log('exp err:', eerr.message);
  const x = exp && exp[0];
  console.log('=== 实验 ===');
  console.log(`title=${x?.title} mode=${x?.trading_mode} status=${x?.status}`);
  const cfg = (x && x.config) || {};
  const fw = cfg.fourmemeWs || {};
  console.log('灰度键:', JSON.stringify({
    factorCheck: fw.buyPointCheck?.factorCheck?.enabled,
    actFrontGate: fw.cheatCheck?.actFrontGate?.enabled,
    cheatCheck: fw.cheatCheck?.enabled,
    buyPointCheck: fw.buyPointCheck?.enabled,
    signalGateReal: cfg.backtest?.signalGateReal,
    platform: cfg.platform,
  }));
  const buyLegs = (cfg.strategies || []).filter(s => (s.legs || []).some(l => l.side === 'buy')).flatMap(s => s.legs.filter(l => l.side === 'buy'));
  console.log('买腿数:', buyLegs.length, '| 带 G3(launchSellBundleClusterSize):', buyLegs.filter(l => (l.condition || '').includes('launchSellBundleClusterSize')).length);

  const { data: evs, error: everr } = await sb.from('wss_events').select('kind,block_time')
    .eq('token_address', TOKEN).eq('kind', 'token_create').limit(2);
  if (everr) console.log('wss_events err:', everr.message);
  const created = evs && evs[0];
  console.log('\n=== token_create ===', created?.block_time);

  const { data: sigs } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  console.log('\n=== 信号行 ===', sigs?.length, '行');
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log(`\n--- signal ${s.id} ${s.created_at} action=${s.action} strat=${s.strategy_id} status=${s.execution_status} reason=${s.execution_reason} fail=${s.failure_reason} price=${s.price}`);
    console.log('metadata gates:', JSON.stringify({
      signalGate: m.signalGate ? { leg: m.signalGate.legId || m.signalGate.leg, triggerNo: m.signalGate.triggerNo, trigKeys: m.signalGate.trigger ? Object.keys(m.signalGate.trigger) : null } : null,
      factorCheck: m.factorCheck || null,
      actFrontGate: m.actFrontGate || null,
      cheatCheck: m.cheatCheck ? { grade: m.cheatCheck.grade, reason: m.cheatCheck.reason, infoGrade: m.cheatCheck.info && m.cheatCheck.info.grade, reasons: m.cheatCheck.info && m.cheatCheck.info.reasons, levels: m.cheatCheck.info && m.cheatCheck.info.levels, exempt: m.cheatCheck.info && m.cheatCheck.info.exempt } : null,
      buyPoint: m.buyPoint ? { bucket: m.buyPoint.bucket || (m.buyPoint.info && m.buyPoint.info.bucket), rule: m.buyPoint.rule || (m.buyPoint.info && m.buyPoint.info.rule), entry: m.buyPoint.info && m.buyPoint.info.entryShape, levels: m.buyPoint.info && m.buyPoint.info.levels } : null,
      sellWhy: m.why || m.sellReason || null,
    }, null, 1));
  }

  const { data: tr } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(20);
  console.log('\n=== trades ===', tr?.length, '行');
  for (const t of tr || []) {
    const k = Object.keys(t);
    console.log(JSON.stringify(Object.fromEntries(k.filter(c => t[c] !== null && c !== 'metadata').map(c => [c, t[c]]))));
  }

  // ticks：创建 → +12min
  const from = created?.block_time || '2000-01-01';
  const to = new Date(new Date(from).getTime() + 12 * 60 * 1000).toISOString();
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,trader_address,sender_address,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', TOKEN).gte('block_time', from).lte('block_time', to)
    .order('block_number', { ascending: true }).limit(20000);
  console.log('\n=== ticks ===', ticks?.length, '行 (', from, '→', to, ')');
  if (!ticks || !ticks.length) return;

  const t0 = new Date(ticks[0].block_time).getTime();
  const rel = r => ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1);
  const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
  const isBuy = r => r.trade_type === 'buy';

  const win = ticks.filter(r => new Date(r.block_time).getTime() - t0 <= LAUNCH_WIN_MS);
  const wSells = new Map(), wBuys = new Map();
  const blkSellWallets = new Map();
  const blkSellBnb = new Map(), blkBuyBnb = new Map(), blkSellN = new Map(), blkBuyN = new Map();
  for (const r of win) {
    const w = wallet(r);
    if (isBuy(r)) {
      wBuys.set(w, (wBuys.get(w) || 0) + r.bnb_amount);
      blkBuyBnb.set(r.block_number, (blkBuyBnb.get(r.block_number) || 0) + r.bnb_amount);
      blkBuyN.set(r.block_number, (blkBuyN.get(r.block_number) || 0) + 1);
    } else {
      if (w) { wSells.set(w, (wSells.get(w) || 0) + r.bnb_amount); let s = blkSellWallets.get(r.block_number); if (!s) { s = new Set(); blkSellWallets.set(r.block_number, s); } s.add(w); }
      blkSellBnb.set(r.block_number, (blkSellBnb.get(r.block_number) || 0) + r.bnb_amount);
      blkSellN.set(r.block_number, (blkSellN.get(r.block_number) || 0) + 1);
    }
  }
  let sellClu = 0, sellCluBlk = null;
  for (const [blk, ws] of blkSellWallets) {
    let n = 0; for (const w of ws) if ((wSells.get(w) || 0) >= DUST) n++;
    if (n > sellClu) { sellClu = n; sellCluBlk = blk; }
  }
  const blkBuyWallets = new Map();
  const firstBuy = new Map();
  for (const r of win) if (isBuy(r)) { const w = wallet(r); if (w && !firstBuy.has(w)) firstBuy.set(w, r.block_number); }
  for (const [w, blk] of firstBuy) {
    if ((wBuys.get(w) || 0) < DUST) continue;
    let s = blkBuyWallets.get(blk); if (!s) { s = new Set(); blkBuyWallets.set(blk, s); } s.add(w);
  }
  let buyClu = 0, buyCluBlk = null;
  for (const [blk, ws] of blkBuyWallets) if (ws.size > buyClu) { buyClu = ws.size; buyCluBlk = blk; }
  console.log(`\nT177 键复刻（出生窗 90s）：launchSellBundleClusterSize=${sellClu} (blk=${sellCluBlk}) launchBundleClusterSize≈${buyClu} (blk=${buyCluBlk})`);

  const allBlkSell = new Map();
  const allBlkBuy = new Map();
  let cumBuy = 0, cumSell = 0;
  const cumAtBlk = new Map();
  for (const r of ticks) {
    if (isBuy(r)) {
      cumBuy += r.bnb_amount;
      let c = allBlkBuy.get(r.block_number);
      if (!c) { c = { bnb: 0, n: 0, wallets: new Set(), ts: r.block_time, amounts: [] }; allBlkBuy.set(r.block_number, c); }
      c.bnb += r.bnb_amount; c.n++; const w = wallet(r); if (w) { c.wallets.add(w); c.amounts.push([w, r.bnb_amount]); }
    } else {
      cumSell += r.bnb_amount;
      let c = allBlkSell.get(r.block_number);
      if (!c) { c = { bnb: 0, n: 0, wallets: new Set(), ts: r.block_time }; allBlkSell.set(r.block_number, c); }
      c.bnb += r.bnb_amount; c.n++; const w = wallet(r); if (w) c.wallets.add(w);
    }
    cumAtBlk.set(r.block_number, { buy: cumBuy, sell: cumSell });
  }
  // 同块买入簇排行（全 12min 窗：按钱包数排序前 12）
  const buyRank = [...allBlkBuy.entries()].sort((a, b) => b[1].wallets.size - a[1].wallets.size || b[1].bnb - a[1].bnb).slice(0, 12);
  console.log('\n=== 同块买入簇排行（按 distinct 买钱包数：块 | t | 买BNB | 笔数 | 钱包数 | 块前累计买 | 本块/块前累计买% | 金额分布）===');
  for (const [blk, c] of buyRank) {
    const cum = cumAtBlk.get(blk) || { buy: 0 };
    const amts = c.amounts.map(([, v]) => v).sort((a, b) => b - a);
    const eqKey = Math.round(amts[0] * 1e4) / 1e4;
    const nEq = amts.filter(v => Math.round(v * 1e4) / 1e4 === eqKey).length;
    console.log(`blk=${blk} t=+${rel(c)}s 买=${c.bnb.toFixed(4)}B n=${c.n} wallets=${c.wallets.size} 块前累计买=${cum.buy.toFixed(2)}B 占比=${(c.bnb / Math.max(cum.buy, 1e-9) * 100).toFixed(1)}% maxAmt=${amts[0]?.toFixed(4)} 四位等额笔数=${nEq}`);
  }
  const sellRank = [...allBlkSell.entries()].sort((a, b) => b[1].bnb - a[1].bnb).slice(0, 10);
  console.log('\n=== 同块卖出簇排行（12min 窗：块 | t | 卖BNB | 卖笔数 | distinct钱包 | 块前累计买 | 卖/块前累计买%）===');
  for (const [blk, c] of sellRank) {
    const cum = cumAtBlk.get(blk) || { buy: 0 };
    console.log(`blk=${blk} t=+${rel(c)}s 卖=${c.bnb.toFixed(4)}B n=${c.n} wallets=${c.wallets.size} 块前累计买=${cum.buy.toFixed(2)}B 占比=${(c.bnb / Math.max(cum.buy, 1e-9) * 100).toFixed(1)}%`);
  }

  const rels = ticks.filter(r => r.price_bnb > 0 && !r.price_outlier);
  let peak = 0, peakT = 0; const p0 = rels.length ? rels[0].price_bnb : 0;
  for (const r of rels) { if (r.price_bnb > peak) { peak = r.price_bnb; peakT = new Date(r.block_time).getTime(); } }
  console.log(`\n价格: 首价=${p0.toExponential(3)} 峰=${peak.toExponential(3)} (t+${((peakT - t0) / 1000).toFixed(1)}s) 末=${rels.length ? rels[rels.length - 1].price_bnb.toExponential(3) : '-'} 12min总买=${cumBuy.toFixed(2)}B 总卖=${cumSell.toFixed(2)}B`);

  const sigAt = sigs && sigs.length ? new Date(sigs[0].created_at).getTime() : null;
  if (sigAt) {
    console.log('\n=== 首信号 ±90s 时间线（5s 桶，t 相对首 tick）===');
    const win2 = ticks.filter(r => Math.abs(new Date(r.block_time).getTime() - sigAt) <= 90 * 1000);
    const bucket = new Map();
    for (const r of win2) {
      const k = Math.floor((new Date(r.block_time).getTime() - t0) / 5000) * 5;
      let b = bucket.get(k); if (!b) { b = { bb: 0, sb: 0, bn: 0, sn: 0 }; bucket.set(k, b); }
      if (isBuy(r)) { b.bb += r.bnb_amount; b.bn++; } else { b.sb += r.bnb_amount; b.sn++; }
    }
    for (const [k, b] of [...bucket.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`t+${String(k).padStart(4)}s 买=${b.bb.toFixed(3)}B/${b.bn}笔 卖=${b.sb.toFixed(3)}B/${b.sn}笔`);
    }
    console.log('(首信号时刻 t+' + ((sigAt - t0) / 1000).toFixed(1) + 's)');
  }

  // 大卖钱包明细（12min 内累计卖 ≥0.05，按累计卖排序）
  const bigSellers = new Map();
  for (const r of ticks) if (!isBuy(r)) { const w = wallet(r); bigSellers.set(w, (bigSellers.get(w) || 0) + r.bnb_amount); }
  const top = [...bigSellers.entries()].filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('\n=== 大卖钱包（12min 累计卖 ≥0.05B）===');
  for (const [w, v] of top) console.log(`${w} 卖=${v.toFixed(4)}B`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
