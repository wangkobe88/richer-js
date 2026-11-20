#!/usr/bin/env node
// 0x17b0 第二块 8 户挤入案 对照分布：wave（T150 口径 f0+首块后2s全部块首买钱包，尘线）
// + 同秒相邻块合并簇 + 等额带 + 单波 dom vs PnL——候选线分离度扫描（bt-v147 203 成交票）
const { dbManager } = require('../src/services/dbManager');

const EXP = process.argv[2] || '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const CASE = '0x17b09420d03be61401cdfaf57160b3e6f8737777';
const WIN_MS = 90000;
const DUST = 0.015;
const WAVE_MS = 2000;

function metrics(ticks) {
  const t0 = new Date(ticks[0].block_time).getTime();
  const win = ticks.filter(r => new Date(r.block_time).getTime() - t0 <= WIN_MS);
  const wBuy = new Map();
  const firstBlk = new Map(), firstTs = new Map();
  const blkBuyMap = new Map(); // blk -> Map(w->bnb)
  for (const r of win) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (r.trade_type !== 'buy' || !w) continue;
    wBuy.set(w, (wBuy.get(w) || 0) + r.bnb_amount);
    if (!firstBlk.has(w)) { firstBlk.set(w, r.block_number); firstTs.set(w, new Date(r.block_time).getTime()); }
    let m = blkBuyMap.get(r.block_number); if (!m) { m = new Map(); blkBuyMap.set(r.block_number, m); }
    m.set(w, (m.get(w) || 0) + r.bnb_amount);
  }
  let winBuyBnb = 0; for (const v of wBuy.values()) winBuyBnb += v;
  const pass = w => (wBuy.get(w) || 0) >= DUST;
  // T150 wave 复刻：首块（firstBlockNumber）+ 首块后 ≤2s 全部块的首买钱包数（尘线）
  const fb = ticks[0].block_number;
  const fbTs = t0;
  const waveBlks = new Set([fb]);
  for (const [w, blk] of firstBlk) {
    if (blk !== null && blk !== fb && firstTs.get(w) - fbTs <= WAVE_MS) waveBlks.add(blk);
  }
  const fbBlkSet = new Set(); // 所有首块时间 ≤2s 的块（用行时间近似：块首行 ts）
  const blkFirstTs = new Map();
  for (const r of win) { const k = r.block_number; if (!blkFirstTs.has(k)) blkFirstTs.set(k, new Date(r.block_time).getTime()); }
  for (const [blk, ts] of blkFirstTs) if (ts - fbTs <= WAVE_MS) fbBlkSet.add(blk);
  let f0 = 0, wave = 0;
  for (const [w, blk] of firstBlk) {
    if (!pass(w)) continue;
    if (blk === fb) { f0++; wave++; }
    else if (fbBlkSet.has(blk)) wave++;
  }
  // maxBlockBuyers（单块尘线买钱包 max）
  let maxB = 0;
  for (const [, m] of blkBuyMap) { let n = 0; for (const w of m.keys()) if (pass(w)) n++; if (n > maxB) maxB = n; }
  // 相邻块合并（block diff ≤1 链式合并）后的最大合并簇钱包数（同秒挤入形状）
  const blks = [...blkBuyMap.keys()].sort((a, b) => a - b);
  let adjMax = 0;
  for (let i = 0; i < blks.length; i++) {
    const grp = new Set(); let j = i;
    while (j < blks.length && (j === i || blks[j] - blks[j - 1] <= 1)) {
      for (const w of blkBuyMap.get(blks[j]).keys()) if (pass(w)) grp.add(w);
      j++;
    }
    if (grp.size > adjMax) adjMax = grp.size;
  }
  // 2s 时间窗合并（任意 2s 窗内尘线买钱包 max——跨多块同秒/连续秒挤入）
  const evts = [];
  for (const [w, blk] of firstBlk) if (pass(w)) evts.push({ w, ts: firstTs.get(w) });
  evts.sort((a, b) => a.ts - b.ts);
  let win2sMax = 0;
  for (let i = 0; i < evts.length; i++) {
    const s = new Set(); let j = i;
    while (j < evts.length && evts[j].ts - evts[i].ts <= WAVE_MS) { s.add(evts[j].w); j++; }
    if (s.size > win2sMax) win2sMax = s.size;
  }
  // 单波 dom（≥5 户块合计买 ÷ 窗买）
  let waveBnb = 0;
  for (const [, m] of blkBuyMap) {
    let n = 0, bnb = 0;
    for (const [w, v] of m) if (pass(w)) { n++; bnb += v; }
    if (n >= 5) waveBnb += bnb;
  }
  const dom5 = winBuyBnb > 0 ? waveBnb / winBuyBnb * 100 : 0;
  // 等额带：首买金额四舍五入到 0.05 档后的最大同档钱包数（0.19 带/0.099 带形状）
  const band = new Map();
  for (const [w, blk] of firstBlk) {
    if (!pass(w)) continue;
    const total = wBuy.get(w);
    const b = Math.round(total / 0.05) * 0.05;
    band.set(b, (band.get(b) || 0) + 1);
  }
  let bandMax = 0, bandVal = 0;
  for (const [b, n] of band) if (n > bandMax) { bandMax = n; bandVal = b; }
  return { winBuyBnb, f0, wave, maxB, adjMax, win2sMax, dom5, bandMax, bandVal };
}

async function main() {
  const sb = dbManager.getClient();
  const { data: trs } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(1000);
  const info = new Map();
  for (const t of trs || []) {
    let e = info.get(t.token_address); if (!e) { e = { buy: 0, sell: 0, firstBuyAt: null }; info.set(t.token_address, e); }
    if (t.trade_direction === 'buy') { e.buy += t.input_amount; if (!e.firstBuyAt) e.firstBuyAt = t.created_at; }
    else e.sell += t.output_amount;
  }
  const tokens = [...info.keys()];
  const createAt = new Map();
  for (let i = 0; i < tokens.length; i += 100) {
    const { data: evs } = await sb.from('wss_events').select('token_address,block_time').eq('kind', 'token_create').in('token_address', tokens.slice(i, i + 100));
    for (const e of evs || []) if (!createAt.has(e.token_address)) createAt.set(e.token_address, e.block_time);
  }
  const rows = [];
  for (const tok of tokens) {
    const from = createAt.get(tok); if (!from) continue;
    const to = new Date(new Date(from).getTime() + WIN_MS + 1000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,trade_type,trader_address,sender_address,bnb_amount')
      .eq('token_address', tok).gte('block_time', from).lte('block_time', to)
      .order('block_number', { ascending: true }).limit(3000);
    if (!ticks || ticks.length < 5) continue;
    const e = info.get(tok);
    const full = metrics(ticks);
    let asof = null;
    if (e.firstBuyAt) {
      const cut = ticks.filter(r => r.block_time <= e.firstBuyAt);
      if (cut.length >= 3) asof = metrics(cut);
    }
    rows.push({ tok, pnl: e.sell - e.buy, f: full, a: asof });
  }
  console.log('有效票:', rows.length);
  const dist = (name, fn) => {
    const th = [3, 5, 6, 7, 8, 9, 10]; const c = th.map(() => 0);
    for (const r of rows) { const v = fn(r); if (v == null) continue; th.forEach((t, i) => { if (v >= t) c[i]++; }); }
    console.log(`${name}: ` + th.map((t, i) => `≥${t}:${c[i]}`).join(' '));
  };
  console.log('\n=== 分布（full 窗；a=as-of 首买）===');
  dist('wave(f0+2s 首买钱包)', r => r.f.wave);
  dist('wave@a', r => r.a ? r.a.wave : null);
  dist('adjMax(相邻块合并簇)', r => r.f.adjMax);
  dist('win2sMax(任意2s窗首买钱包)', r => r.f.win2sMax);
  dist('maxB(单块)', r => r.f.maxB);
  dist('bandMax(0.05档等额带)', r => r.f.bandMax);

  const hit = (name, fn) => {
    const m = rows.filter(fn);
    const pnl = m.reduce((s, r) => s + r.pnl, 0);
    console.log(`\n${name}: 命中 ${m.length}/${rows.length} 合计PnL=${pnl.toFixed(4)}B`);
    for (const r of m) console.log(`  ${r.tok.slice(0, 10)} wave=${r.f.wave} adj=${r.f.adjMax} w2s=${r.f.win2sMax} maxB=${r.f.maxB} dom=${r.f.dom5.toFixed(1)}% band=${r.f.bandMax}@${r.f.bandVal} f0=${r.f.f0} pnl=${r.pnl.toFixed(4)}`);
  };
  hit('wave≥8（全列，看 dom 轴分离）', r => r.f.wave >= 8);
  hit('候选线 wave≥8 ∧ dom≥30', r => r.f.wave >= 8 && r.f.dom5 >= 30);
  console.log('\ncase:', JSON.stringify(rows.find(r => r.tok === CASE), (k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
