#!/usr/bin/env node
// 尾部低位研究 第四段：混合模拟 = 负票端早出臂（N 秒内 maxRise<barrier → 时点价卖，否则维持现状 ep）
// 需要重拉 fwd 序列算 maxRiseIn[T] 与 r(T)
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];
const T_CANDS = [45, 60, 90, 120, 180];
const BARRIERS = [2, 3, 5];
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));

  // 现状 ep（同前）
  const ep = new Map();
  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,output_currency')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(error.message);
    for (const t of tr) {
      if (t.trade_status !== 'success') continue;
      const k = nm + '|' + t.token_address;
      if (!ep.has(k)) ep.set(k, { inBnb: 0, outBnb: 0 });
      const e = ep.get(k);
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e.inBnb += Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e.outBnb += Number(t.output_amount);
    }
  }

  // 重建买点（token+buyTs）——从 json 里取
  const pts = [...new Map(results.map(r => [r.exp + '|' + r.token + '|' + r.buyTs, r])).keys()];
  void pts;

  // 需要重拉 fwd：按 token 批量（每 token 拉 [minBuyTs, maxBuyTs+1800s]）
  const byToken = new Map();
  for (const r of results) {
    if (!byToken.has(r.token)) byToken.set(r.token, []);
    byToken.get(r.token).push(r);
  }
  const tickCache = new Map();
  const toks = [...byToken.keys()];
  let done = 0;
  async function pull(tok) {
    const bl = byToken.get(tok);
    const t0 = Math.min(...bl.map(b => b.buyTs)) - 1000;
    const t1 = Math.max(...bl.map(b => b.buyTs)) + 1860000;
    const rows = [];
    let from = new Date(t0).toISOString();
    for (let pg = 0; pg < 30; pg++) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('block_time,price_usd,price_outlier')
        .eq('token_address', tok)
        .gte('block_time', from).lt('block_time', new Date(t1).toISOString())
        .order('block_time', { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (!data || data.length < 1000) break;
      from = data[data.length - 1].block_time;
    }
    const clean = [];
    for (const r of rows) {
      if (r.price_outlier) continue;
      const p = Number(r.price_usd);
      if (!p || !isFinite(p)) continue;
      clean.push({ ts: new Date(r.block_time).getTime(), p });
    }
    clean.sort((a, b) => a.ts - b.ts);
    tickCache.set(tok, clean);
    if (++done % 60 === 0) console.log(`  pull ${done}/${toks.length}`);
  }
  const q = [...toks];
  async function w() { while (q.length) { const t = q.shift(); try { await pull(t); } catch (e) { console.log('pull fail', t.slice(0, 8), e.message); } } }
  await Promise.all([w(), w(), w(), w()]);

  // per 买点：maxRiseIn[T] 与 r(T)
  for (const r of results) {
    const ticks = tickCache.get(r.token) || [];
    let P0 = null;
    for (const t of ticks) { if (t.ts <= r.buyTs + 3000) P0 = t.p; else break; }
    if (!P0) { r.maxIn = null; continue; }
    const fwd = ticks.filter(t => t.ts >= r.buyTs);
    r.maxIn = {}; r.rAt = {};
    for (const T of T_CANDS) {
      const cut = r.buyTs + T * 1000;
      let m = -1e9, last = null;
      for (const t of fwd) {
        if (t.ts <= cut) { const ret = (t.p / P0 - 1) * 100; if (ret > m) m = ret; last = ret; } else break;
      }
      r.maxIn[T] = m === -1e9 ? null : m;
      r.rAt[T] = last;
    }
    // 现状 ep
    const e = ep.get(r.exp + '|' + r.token);
    r.epPnl = e && e.inBnb > 0 ? (e.outBnb - e.inBnb) / e.inBnb * 100 : null;
  }

  // 混合模拟：sim(T,B) = maxIn[T]<B ? rAt[T] : epPnl（epPnl null 的票跳过）
  for (const g of ['A_tail_deep', 'B_tail_low', 'C_tail_mid', 'E_early_thin']) {
    const rs = results.filter(r => r.grp === g && r.epPnl != null && r.maxIn);
    if (!rs.length) continue;
    console.log(`\n[${g}] n=${rs.length} 现状mean=${mean(rs.map(r=>r.epPnl))?.toFixed(2)}`);
    for (const B of BARRIERS) {
      let line = `  barrier<${B}%: `;
      for (const T of T_CANDS) {
        const arr = rs.map(r => (r.maxIn[T] != null && r.maxIn[T] < B && r.rAt[T] != null) ? r.rAt[T] : r.epPnl);
        const trig = rs.filter(r => r.maxIn[T] != null && r.maxIn[T] < B).length;
        line += ` T${T}=${mean(arr)?.toFixed(2)}(触${trig}) |`;
      }
      console.log(line);
    }
    // 触发票的明细（T=60 B=3）：触发票的现状 ep vs 早出价——正票误伤检查
    const hurt = rs.filter(r => r.maxIn[60] != null && r.maxIn[60] < 3 && r.epPnl > 10);
    if (hurt.length) {
      console.log(`  ⚠ T60/B3 会误伤的现状正票（ep>10%）：`);
      for (const r of hurt) console.log(`    ${r.token.slice(0,10)} ep=${r.epPnl.toFixed(1)} r60=${r.rAt[60]?.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s mx60=${r.maxIn[60]?.toFixed(1)}`);
    }
  }

  // 存回
  const slim = results.map(r => ({ exp: r.exp, token: r.token, grp: r.grp, curVs: r.curVs, mx: r.mx, mxT: r.mxT, epPnl: r.epPnl, maxIn: r.maxIn, rAt: r.rAt, sim: r.sim }));
  fs.writeFileSync('/tmp/tail-entry-study2.json', JSON.stringify(slim));
  console.log('\nsaved /tmp/tail-entry-study2.json');
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
