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
  for (let j = best.i; j < arr.length && arr[j].ms - arr[best.i].ms <= 5000; j++) {
    wallets.set(arr[j].w, (wallets.get(arr[j].w) || 0) + arr[j].bnb);
  }
  return wallets;
}

async function main() {
  const sb = dbManager.getClient();
  // 载入 GMGN 结果
  const stats = new Map();
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); stats.set(j.w, j.r); } catch (e) {}
  }
  console.log('GMGN 钱包数据:', stats.size);

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
        roi: t.b > 0 ? +((t.s / t.b - 1) * 100).toFixed(1) : null,
        shape, chg5,
        burstBnb: an.burst5BuyBnb,
        fp15: m.factorCheck && m.factorCheck.gates && m.factorCheck.gates.find(g => g.id === 'burst_weak'),
      });
    }
  }
  // per 票 burst 窗钱包特征聚合
  for (const r of rows) {
    const since = new Date(new Date(r.sigT).getTime() - 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,sender_address,trader_address,bnb_amount,trade_type')
      .eq('token_address', r.tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', r.sigT).limit(300);
    const wallets = densest5s(ticks || []);
    r.nW = wallets.size;
    const st = { wash: 0, dead: 0, pro: 0, retail: 0, unknown: 0, noData: 0, proRp: 0 };
    for (const [w] of wallets) {
      const g = stats.get(w);
      if (!g) { st.noData++; continue; }
      const tags = (g.tags || []).join(',');
      const active = (g.buy || 0) + (g.sell || 0) > 0;
      if (/wash/.test(tags)) st.wash++;
      if (!active) st.dead++;
      const rp = Number(g.rp || 0), tokNum = g.tokNum || 0;
      if (rp >= 5000 || tokNum >= 500) { st.pro++; st.proRp += rp; }
      else st.retail++;
    }
    r.st = st;
  }
  console.log('票数:', rows.length);
  const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  // per 票输出
  console.log('\ntoken         | roi%   | 波钱包 | wash死 | 专业 | 小散 | 无数据 | 专业占比');
  for (const r of rows.sort((a, b) => (b.roi || 0) - (a.roi || 0))) {
    const s = r.st;
    console.log(`${r.tok.slice(0, 10)} ${r.win} | ${String(r.roi).padStart(6)} | ${String(r.nW).padStart(4)} | ${s.wash}${s.dead ? '/' + s.dead : ''} | ${String(s.pro).padStart(3)} | ${String(s.retail).padStart(3)} | ${String(s.noData).padStart(3)} | ${(r.nW ? (s.pro / r.nW * 100).toFixed(0) : 0)}%`);
  }
  // 分组汇总
  const agg = g => {
    const tot = g.reduce((x, r) => x + r.nW, 0);
    const sum = k => g.reduce((x, r) => x + r.st[k], 0);
    const proShare = g.map(r => r.nW ? r.st.pro / r.nW : 0);
    const washHits = g.filter(r => r.st.wash > 0).length;
    const deadHits = g.filter(r => r.st.dead >= 2).length;
    return `票${g.length} 波内钱包${tot} | wash标记票 ${washHits}/${g.length} | 死钱包≥2票 ${deadHits} | 专业占比均 ${(proShare.reduce((a, b) => a + b, 0) / g.length * 100).toFixed(0)}%（中位 ${(med(proShare) * 100).toFixed(0)}%）`;
  };
  const winners = rows.filter(r => r.roi > 0), losers = rows.filter(r => r.roi <= 0);
  console.log('\n== 赢家组 ==\n' + agg(winners));
  console.log('\n== 输家组 ==\n' + agg(losers));
  // wash 标记票明细
  console.log('\n== wash_trader 命中票 ==');
  for (const r of rows.filter(r => r.st.wash > 0)) console.log(`  ${r.win} ${r.tok.slice(0, 10)} roi=${r.roi}% wash=${r.st.wash} 钱包数=${r.nW}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
