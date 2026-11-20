const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];
const OUT = '/tmp/gmgn-wallet-stats.jsonl';

function densest5s(ticks) {
  if (!ticks.length) return new Map();
  const arr = ticks.map(t => ({ ms: new Date(t.block_time).getTime(), w: (t.sender_address || t.trader_address || '').toLowerCase(), bnb: Number(t.bnb_amount), blk: t.block_number })).filter(t => t.w);
  arr.sort((a, b) => a.ms - b.ms);
  let best = { n: 0 };
  for (let i = 0; i < arr.length; i++) {
    let n = 0;
    for (let j = i; j < arr.length && arr[j].ms - arr[i].ms <= 5000; j++) n++;
    if (n > best.n) best = { n, i };
  }
  if (!best.n) return new Map();
  const wallets = new Map();
  for (let j = best.i; j < arr.length && arr[j].ms - arr[best.i].ms <= 5000; j++) {
    if (!wallets.has(arr[j].w)) wallets.set(arr[j].w, { bnb: 0, blocks: new Set() });
    const o = wallets.get(arr[j].w);
    o.bnb += arr[j].bnb;
    if (arr[j].blk) o.blocks.add(arr[j].blk);
  }
  return wallets;
}

async function main() {
  const sb = dbManager.getClient();
  const stats = new Map();
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); stats.set(j.w, j.r); } catch (e) {}
  }
  const rows = [];
  const seen = new Map();
  for (const w of WINS) {
    const sigs = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals').select('*')
        .eq('experiment_id', w.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      sigs.push(...data); from += 1000;
      if (data.length < 1000) break;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    const tmap = new Map();
    let f2 = 0;
    while (true) {
      const { data, error } = await sb.from('trades').select('*')
        .eq('experiment_id', w.id).order('created_at').range(f2, f2 + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const t of data) {
        if (!tmap.has(t.token_address)) tmap.set(t.token_address, { b: 0, s: 0, nBuy: 0 });
        const o = tmap.get(t.token_address);
        if (t.trade_direction === 'buy' && t.success) { o.b += Number(t.input_amount); o.nBuy++; }
        if (t.trade_direction === 'sell' && t.success) o.s += Number(t.output_amount);
      }
      f2 += 1000;
      if (data.length < 1000) break;
    }
    for (const [tok, s] of first) {
      const dedupKey = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dedupKey)) continue;
      seen.set(dedupKey, 1);
      const t = tmap.get(tok);
      if (!t || !t.nBuy) continue;
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dim = bp.dimensions || {};
      const shape = dim.entry_shape && dim.entry_shape.bucket;
      const chg5 = an.chg5Pct;
      if (shape !== 'spike' && !(typeof chg5 === 'number' && chg5 >= 25)) continue;
      rows.push({
        win: w.k, tok, sigT: s.created_at,
        roi: t.b > 0 ? (t.s / t.b - 1) * 100 : null,
        pnl: +(t.s - t.b).toFixed(4),
        shape, chg5, tvm: an.totalVolumeBnb,
      });
    }
  }
  // per 票同构度
  for (const r of rows) {
    const since = new Date(new Date(r.sigT).getTime() - 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,sender_address,trader_address,bnb_amount,trade_type')
      .eq('token_address', r.tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', r.sigT).limit(300);
    const wallets = densest5s(ticks || []);
    r.nW = wallets.size;
    // 有 GMGN 数据的钱包计数同构
    const cnts = [];
    for (const [w] of wallets) {
      const g = stats.get(w);
      if (g && (g.tokNum || 0) > 0) cnts.push({ tokNum: g.tokNum, buy: g.buy || 0 });
    }
    r.nData = cnts.length;
    if (cnts.length >= 3) {
      const tns = cnts.map(c => c.tokNum);
      r.tokRatio = +(Math.max(...tns) / Math.min(...tns)).toFixed(3);
      const buys = cnts.map(c => c.buy);
      r.buyRatio = +(Math.max(...buys) / Math.min(...buys)).toFixed(3);
    } else { r.tokRatio = null; r.buyRatio = null; }
    // 同构集群成员占比（票数两两比值 <1.15 视同集群；取最大簇）
    if (cnts.length >= 3) {
      const sorted = [...cnts].sort((a, b) => a.tokNum - b.tokNum);
      let best = { n: 1 };
      for (let i = 0; i < sorted.length; i++) {
        let n = 1;
        for (let j = i + 1; j < sorted.length && sorted[j].tokNum / sorted[i].tokNum < 1.15; j++) n++;
        if (n > best.n) best = { n, i };
      }
      r.clusterN = best.n;
      r.clusterPct = +(best.n / cnts.length).toFixed(2);
    } else { r.clusterN = 0; r.clusterPct = null; }
    // 波内金额近等带（per-wallet bnb max/min，剔除 0）
    const amts = [...wallets.values()].map(o => o.bnb).filter(x => x > 0);
    r.amtRatio = amts.length >= 3 ? +(Math.max(...amts) / Math.min(...amts)).toFixed(4) : null;
    // 同块占比（钱包所在 block 数 / 钱包数）
    const blockCnt = new Set();
    for (const o of wallets.values()) for (const b of o.blocks) blockCnt.add(b);
    r.blockCnt = blockCnt.size;
  }
  console.log('票数:', rows.length);
  const total = rows.reduce((x, r) => x + r.pnl, 0);
  console.log(`全部 pnlΣ=${total.toFixed(4)}\n`);

  // 过滤能力
  const rules = [
    ['票数同构 tokRatio<1.05', r => r.tokRatio !== null && r.tokRatio < 1.05],
    ['票数同构 tokRatio<1.10', r => r.tokRatio !== null && r.tokRatio < 1.10],
    ['票数同构 tokRatio<1.20', r => r.tokRatio !== null && r.tokRatio < 1.20],
    ['同构簇占比≥60%（两两<1.15）', r => r.clusterPct !== null && r.clusterPct >= 0.6 && r.clusterN >= 3],
    ['同构簇≥4 成员', r => r.clusterN >= 4],
    ['票数同构<1.10 ∧ 金额近等<1.05', r => r.tokRatio !== null && r.tokRatio < 1.10 && r.amtRatio !== null && r.amtRatio < 1.05],
    ['票数同构<1.10 ∧ 波内同块占比>70%', r => r.tokRatio !== null && r.tokRatio < 1.10 && r.nW > 0 && r.blockCnt / r.nW < 0.45],
  ];
  for (const [name, fn] of rules) {
    const hit = rows.filter(fn);
    if (!hit.length) { console.log(`${name}: 0 命中`); continue; }
    const stopped = hit.reduce((x, r) => x + Math.min(r.pnl, 0), 0);
    const killed = hit.reduce((x, r) => x + Math.max(r.pnl, 0), 0);
    console.log(`${name}: 拦 ${String(hit.length).padStart(2)} 票 | 拦面pnlΣ ${(hit.reduce((x, r) => x + r.pnl, 0)).toFixed(4).padStart(8)} | 止血 ${(-stopped).toFixed(4)} / 误杀 +${killed.toFixed(4)} | 拦面赢家: ${[...hit].sort((a, b) => b.pnl - a.pnl).slice(0, 3).map(r => r.tok.slice(0, 8) + (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(3)).join(' ')}`);
  }
  // 主案对照 + 拦面明细（最有力的规则）
  console.log('\n== 票数同构<1.10 ∧ 金额近等<1.05 命中票明细 ==');
  for (const r of rows.filter(r => r.tokRatio !== null && r.tokRatio < 1.10 && r.amtRatio !== null && r.amtRatio < 1.05).sort((a, b) => (b.roi || 0) - (a.roi || 0))) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} roi=${r.roi.toFixed(1)}% pnl=${r.pnl} tokR=${r.tokRatio} amtR=${r.amtRatio} nW=${r.nW} 块数=${r.blockCnt} 簇=${r.clusterN}/${r.nData}`);
  }
  console.log('\n== 主案同构度对照 ==');
  for (const p of ['0x577c885d', '0x583a37e3', '0x6bd2cd2e', '0x40efb3d5', '0xba5ed45b', '0xefbd24cf', '0x531ddef1']) {
    const r = rows.find(x => x.tok.startsWith(p));
    if (r) console.log(`  ${r.tok.slice(0, 10)} roi=${r.roi.toFixed(1)}% tokRatio=${r.tokRatio} amtRatio=${r.amtRatio} 簇=${r.clusterN}/${r.nData} 块=${r.blockCnt}/${r.nW}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
