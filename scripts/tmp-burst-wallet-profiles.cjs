const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];
const FAMOUS = new Set((require('../config/rosters/famous-copy-wallets.json').wallets || []).map(w => (typeof w === 'string' ? w : w.address).toLowerCase()));
let SMART = new Set();
try {
  const j = JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8'));
  const arr = j.sources && j.sources.smartmoney ? j.sources.smartmoney : (Array.isArray(j) ? j : []);
  SMART = new Set(arr.map(w => String(w).toLowerCase()));
} catch (e) { console.log('(smartmoney 名单读取失败，跳过)'); }

async function main() {
  const sb = dbManager.getClient();
  // 1) 目标票：spike ∪ 锚chg5>=25 的成交票
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
        shape, chg5, tvm: an.totalVolumeBnb,
      });
    }
  }
  console.log('目标票（spike ∪ chg5>=25 成交）:', rows.length, '| famous 名单', FAMOUS.size, '址 | smart 名单', SMART.size, '址');

  // 2) per token：fire 前 60s 买入钱包 + token_create 时间
  const allWallets = new Set();
  for (const r of rows) {
    const since = new Date(new Date(r.sigT).getTime() - 60000).toISOString();
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,sender_address,trader_address,bnb_amount,trade_type')
      .eq('token_address', r.tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', r.sigT).limit(200);
    if (error) throw error;
    const ws = new Set();
    for (const tk of (ticks || [])) {
      const w = (tk.sender_address || tk.trader_address || '').toLowerCase();
      if (w) { ws.add(w); allWallets.add(w); }
    }
    r.wallets = [...ws];
    const { data: ev } = await sb.from('wss_events').select('block_time')
      .eq('token_address', r.tok).eq('kind', 'token_create').limit(1);
    r.createT = ev && ev[0] ? ev[0].block_time : null;
  }
  // 3) 批量画像
  const prof = new Map();
  const wlist = [...allWallets];
  for (let i = 0; i < wlist.length; i += 50) {
    const { data, error } = await sb.from('wallet_offline_profiles').select('address,profile')
      .in('address', wlist.slice(i, i + 50));
    if (error) throw error;
    for (const row of (data || [])) prof.set(row.address.toLowerCase(), row.profile || {});
  }
  console.log('波内钱包总数(去重):', wlist.length, '| 有画像:', prof.size);

  // 4) per 票聚合
  const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  for (const r of rows) {
    const createMs = r.createT ? new Date(r.createT).getTime() : null;
    const stat = { n: r.wallets.length, noProfile: 0, fresh7d: 0, fresh30d: 0, oneShot: 0, badBuy: 0, famous: 0, smart: 0, tokenCounts: [], firstAges: [], hold: [] };
    for (const w of r.wallets) {
      if (FAMOUS.has(w)) stat.famous++;
      if (SMART.has(w)) stat.smart++;
      const p = prof.get(w);
      if (!p) { stat.noProfile++; continue; }
      stat.tokenCounts.push(p.tokenCount || 0);
      if ((p.tokenCount || 0) <= 2) stat.oneShot++;
      if ((p.badBuyRatio || 0) > 0) stat.badBuy++;
      if (createMs && p.firstSeenMs) {
        const ageD = (createMs - p.firstSeenMs) / 86400000;
        stat.firstAges.push(+ageD.toFixed(1));
        if (ageD < 7) stat.fresh7d++;
        if (ageD < 30) stat.fresh30d++;
      }
      if (typeof p.avgHoldSeconds === 'number') stat.hold.push(p.avgHoldSeconds);
    }
    r.stat = stat;
  }
  console.log('\n== per 票（按 roi 排序） ==');
  console.log('token           | roi%   | 钱包 画像缺 新<7d 新<30d 一次票 badBuy fam/sm tokCnt中位 出场龄中位(d)');
  for (const r of [...rows].sort((a, b) => (b.roi || 0) - (a.roi || 0))) {
    const s = r.stat;
    console.log(`${r.tok.slice(0, 10)} ${r.win} | ${String(r.roi).padStart(6)} | ${String(s.n).padStart(3)} ${String(s.noProfile).padStart(5)} ${String(s.fresh7d).padStart(5)} ${String(s.fresh30d).padStart(5)} ${String(s.oneShot).padStart(4)} ${String(s.badBuy).padStart(5)} ${s.famous}/${s.smart} ${String(med(s.tokenCounts) ?? '-').padStart(7)} ${String(med(s.firstAges) ?? '-').padStart(8)}`);
  }
  // 5) 赢家 vs 输家汇总
  const agg = (g) => {
    const tot = g.reduce((x, r) => x + r.stat.n, 0);
    const sum = k => g.reduce((x, r) => x + r.stat[k], 0);
    const ages = g.flatMap(r => r.stat.firstAges), tcs = g.flatMap(r => r.stat.tokenCounts);
    return `票${g.length} 钱包${tot} | 无画像${(sum('noProfile') / tot * 100).toFixed(0)}% 新<7d${(sum('fresh7d') / tot * 100).toFixed(0)}% 新<30d${(sum('fresh30d') / tot * 100).toFixed(0)}% 一次票${(sum('oneShot') / tot * 100).toFixed(0)}% badBuy${(sum('badBuy') / tot * 100).toFixed(0)}% 名单${sum('famous')}f/${sum('smart')}s | tokCnt中位${med(tcs)} 出场龄中位${med(ages)}d`;
  };
  const winners = rows.filter(r => r.roi > 0), losers = rows.filter(r => r.roi <= 0);
  console.log('\n== 赢家组（roi>0） ==\n' + agg(winners));
  console.log('\n== 输家组（roi<=0） ==\n' + agg(losers));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
