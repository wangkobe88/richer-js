require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOK = [
  ['CI', '0xf818ac2c5545a3d4b7c643efa18aca7237927777', '2026-10-03T15:46:08Z'],
  ['MOLLY', '0xd657ad14ec75dec1882e5a2a8d019079766a7777', '2026-10-04T07:31:54Z'],
];
const AGG_ROUTERS = require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS;

function wallet(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }
function trader(r) { return (r.trader_address || '').toLowerCase(); }

async function main() {
  const sb = dbManager.getClient();
  const all = new Map();
  for (const [sym, t, buyAt] of TOK) {
    const { data: rows, count, error } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,trader_address,sender_address,price_bnb,bnb_amount,block_number,tx_hash,log_index,price_outlier')
      .eq('token_address', t).order('block_time', { ascending: true }).limit(5000);
    if (error) throw new Error(error.message);
    all.set(sym, { rows, buyAt });
    console.log(`\n===== ${sym} ticks ${rows.length} 行 =====`);

    // 价格轨迹
    let first = null, ath = { p: 0 }, last = null;
    for (const r of rows) {
      if (r.price_outlier) continue;
      const p = Number(r.price_bnb);
      if (!first && p > 0) first = { p, t: r.block_time };
      if (p > ath.p) ath = { p, t: r.block_time };
      last = { p, t: r.block_time };
    }
    // 买点后轨迹
    const after = rows.filter(r => r.block_time > buyAt && !r.price_outlier);
    let postAth = { p: 0 }, postLast = null, postMin = { p: Infinity };
    for (const r of after) {
      const p = Number(r.price_bnb);
      if (p > postAth.p) postAth = { p, t: r.block_time };
      if (p < postMin.p) postMin = { p, t: r.block_time };
      postLast = { p, t: r.block_time, type: r.trade_type };
    }
    const launch = 5.2667566536721975e-9;
    console.log(`首价 ${(first.p/launch-1)*100 > 0 ? '' : ''}${((first.p/launch-1)*100).toFixed(1)}%  ATH@${ath.t?.slice(11,19)} +${((ath.p/launch-1)*100).toFixed(1)}%  末笔@${last.t?.slice(11,19)} ${((last.p/launch-1)*100).toFixed(1)}%`);
    console.log(`买点后: tick ${after.length} 笔 | 买点后ATH +${((postAth.p/launch-1)*100).toFixed(1)}%@${postAth.t?.slice(11,19)} | 买点后最低 +${((postMin.p/launch-1)*100).toFixed(1)}% | 末笔 ${postLast?.t?.slice(11,19)} ${postLast?.type} ${((postLast?.p/launch-1)*100).toFixed(1)}%`);

    // 钱包汇总
    const wmap = new Map();
    for (const r of rows) {
      const w = wallet(r), tr = trader(r);
      const e = wmap.get(w) || { buy: 0, sell: 0, buys: 0, sells: 0, first: r.block_time, last: r.block_time, router: AGG_ROUTERS.has(tr) };
      if (r.trade_type === 'buy') { e.buy += Number(r.bnb_amount); e.buys++; }
      else { e.sell += Number(r.bnb_amount); e.sells++; }
      e.last = r.block_time;
      wmap.set(w, e);
    }
    console.log(`独立钱包 ${wmap.size} 个（含路由行归并 sender）`);
    const sorted = [...wmap.entries()].sort((a, b) => (b[1].buy + b[1].sell) - (a[1].buy + a[1].sell));
    for (const [w, e] of sorted.slice(0, 12)) {
      console.log(`  ${w.slice(0, 12)}… 买${e.buy.toFixed(3)}B/${e.buys}笔 卖${e.sell.toFixed(3)}B/${e.sells}笔 首笔${e.first?.slice(11, 19)} 末笔${e.last?.slice(11, 19)}`);
    }
  }

  // 钱包重叠
  const [a, b] = [...all.values()];
  const sa = new Set(a.rows.map(wallet)), sbSet = new Set(b.rows.map(wallet));
  const inter = [...sa].filter(w => sbSet.has(w));
  console.log(`\n===== 钱包重叠 =====`);
  console.log(`CI ${sa.size} × MOLLY ${sbSet.size} → 交集 ${inter.length}`);
  for (const w of inter) {
    const ea = a.rows.filter(r => wallet(r) === w), eb = b.rows.filter(r => wallet(r) === w);
    const ba = ea.filter(r => r.trade_type === 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
    const bb = eb.filter(r => r.trade_type === 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
    console.log(`  ${w} CI买${ba.toFixed(3)}B MOLLY买${bb.toFixed(3)}B`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
