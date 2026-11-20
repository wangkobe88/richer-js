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
  const arr = ticks.map(t => ({ ms: new Date(t.block_time).getTime(), w: (t.sender_address || t.trader_address || '').toLowerCase(), bnb: Number(t.bnb_amount) })).filter(t => t.w);
  arr.sort((a, b) => a.ms - b.ms);
  let best = { n: 0 };
  for (let i = 0; i < arr.length; i++) {
    let n = 0;
    for (let j = i; j < arr.length && arr[j].ms - arr[i].ms <= 5000; j++) n++;
    if (n > best.n) best = { n, i };
  }
  if (!best.n) return new Map();
  const wallets = new Map();
  for (let j = best.i; j < arr.length && arr[j].ms - arr[best.i].ms <= 5000; j++) wallets.set(arr[j].w, (wallets.get(arr[j].w) || 0) + arr[j].bnb);
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
  for (const r of rows) {
    const since = new Date(new Date(r.sigT).getTime() - 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,sender_address,trader_address,bnb_amount,trade_type')
      .eq('token_address', r.tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', r.sigT).limit(300);
    const wallets = densest5s(ticks || []);
    r.nW = wallets.size;
    let wash = 0, dead = 0, pro5k = 0, pro1k = 0, retail = 0;
    for (const [w] of wallets) {
      const g = stats.get(w);
      if (!g) continue;
      const tags = (g.tags || []).join(',');
      const active = (g.buy || 0) + (g.sell || 0) > 0;
      if (/wash/.test(tags)) wash++;
      if (!active) dead++;
      const rp = Number(g.rp || 0), tokNum = g.tokNum || 0;
      if (rp >= 5000 || tokNum >= 500) pro5k++;
      if (rp >= 1000 || tokNum >= 300) pro1k++;
      else if (rp < 1000 && tokNum < 300) retail++;
    }
    r.wash = wash; r.dead = dead;
    r.pro5kPct = r.nW ? pro5k / r.nW : 0;
    r.pro1kPct = r.nW ? pro1k / r.nW : 0;
  }
  // 过滤能力评估
  const total = rows.reduce((x, r) => x + r.pnl, 0);
  console.log(`全部 98 票 pnlΣ=${total.toFixed(4)}\n`);
  const rules = [
    ['全小散（专业5k定义=0%）', r => r.pro5kPct === 0],
    ['专业≤10%', r => r.pro5kPct <= 0.1],
    ['专业≤20%', r => r.pro5kPct <= 0.2],
    ['专业≥80%（近全专业）', r => r.pro5kPct >= 0.8],
    ['专业≥60%', r => r.pro5kPct >= 0.6],
    ['wash_trader 命中', r => r.wash > 0],
    ['死钱包≥2', r => r.dead >= 2],
    ['全小散 ∧ 薄盘tvm<3', r => r.pro5kPct === 0 && r.tvm < 3],
    ['全小散 ∧ 波≥8钱包', r => r.pro5kPct === 0 && r.nW >= 8],
    ['全小散(1k宽定义=0%)', r => r.pro1kPct === 0],
    ['专业≤20%(1k宽定义)', r => r.pro1kPct <= 0.2],
    ['wash命中 ∨ 全小散', r => r.wash > 0 || r.pro5kPct === 0],
  ];
  for (const [name, fn] of rules) {
    const hit = rows.filter(fn);
    if (!hit.length) { console.log(`${name}: 0 命中`); continue; }
    const stopped = hit.reduce((x, r) => x + Math.min(r.pnl, 0), 0); // 止血=拦掉的负 pnl 绝对值
    const killed = hit.reduce((x, r) => x + Math.max(r.pnl, 0), 0); // 误杀=拦掉的正 pnl
    const net = hit.reduce((x, r) => x + r.pnl, 0);
    console.log(`${name}: 拦 ${String(hit.length).padStart(2)} 票 | 拦面pnlΣ ${net.toFixed(4).padStart(8)} | 止血 ${(-stopped).toFixed(4)} / 误杀 +${killed.toFixed(4)} | 拦面最大赢家: ${[...hit].sort((a, b) => b.pnl - a.pnl).slice(0, 3).map(r => r.tok.slice(0, 8) + (r.pnl > 0 ? '+' + r.pnl.toFixed(3) : r.pnl.toFixed(3))).join(' ')}`);
  }
  // 全小散票明细
  console.log('\n== 全小散（专业5k=0%）票明细 ==');
  for (const r of rows.filter(r => r.pro5kPct === 0).sort((a, b) => b.roi - a.roi)) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} roi=${r.roi.toFixed(1)}% pnl=${r.pnl} nW=${r.nW} tvm=${r.tvm}B chg5=${r.chg5} shape=${r.shape}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
