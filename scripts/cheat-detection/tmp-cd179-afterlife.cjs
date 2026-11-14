// 一次性探针：CD179 MFD 锚后前向形态——用户判据「前期钱包买入后活跃度尽失」量化（182 跑）
const { dbManager } = require('../../src/services/dbManager.js');

const TOKEN = '0x040b6766346b465b2a8403ecfd2bdfb9ffe07777';
const ANCHOR = 20; // CD179 生产首析锚

function short(a) { return a ? a.slice(0, 8) + '…' + a.slice(-4) : '-'; }

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3001);
  if (error) throw error;
  console.log(`全量行=${rows.length}${rows.length > 3000 ? '（超帽截断，锚后尾部可能缺）' : ''}`);

  const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
  const ts = (r) => new Date(r.block_time).getTime();
  const pre = rows.slice(0, ANCHOR);
  const post = rows.slice(ANCHOR);
  const anchorMs = ts(pre[pre.length - 1]);

  // ---- 锚窗概况 ----
  const preBuy = pre.filter((r) => r.trade_type === 'buy');
  const preSell = pre.filter((r) => r.trade_type === 'sell');
  const preWallets = new Set(pre.map(wallet));
  const preBuyWallets = new Map(); // w -> bnb
  for (const r of preBuy) preBuyWallets.set(wallet(r), (preBuyWallets.get(wallet(r)) || 0) + Number(r.bnb_amount));
  const sum = (a) => a.reduce((s, r) => s + Number(r.bnb_amount), 0);
  console.log(`\n== 锚窗（前 ${ANCHOR} 行）==`);
  console.log(`时刻 ${pre[0].block_time} → ${pre[pre.length - 1].block_time}（span ${(anchorMs - ts(pre[0])) / 1000}s）`);
  console.log(`买 ${preBuy.length} 笔/${sum(preBuy).toFixed(3)} BNB（${preBuyWallets.size} 钱包）；卖 ${preSell.length} 笔/${sum(preSell).toFixed(3)} BNB；钱包 ${preWallets.size}`);

  // ---- 锚后概况 ----
  const postBuy = post.filter((r) => r.trade_type === 'buy');
  const postSell = post.filter((r) => r.trade_type === 'sell');
  const lastMs = post.length ? ts(post[post.length - 1]) : anchorMs;
  console.log(`\n== 锚后（${post.length} 行）==`);
  console.log(`末 tick ${post.length ? post[post.length - 1].block_time : '-'}（锚后存活 ${(lastMs - anchorMs) / 1000}s）`);
  console.log(`买 ${postBuy.length} 笔/${sum(postBuy).toFixed(3)} BNB；卖 ${postSell.length} 笔/${sum(postSell).toFixed(3)} BNB`);

  // ---- 锚后 60s 桶时间线 ----
  console.log(`\n== 锚后 60s 桶时间线（相对锚 +s | 笔 | 买 BNB | 卖 BNB | 末价）==`);
  const buckets = new Map();
  for (const r of post) {
    const b = Math.floor((ts(r) - anchorMs) / 60000);
    if (!buckets.has(b)) buckets.set(b, { n: 0, buy: 0, sell: 0, lastPrice: null, t: r.block_time });
    const o = buckets.get(b);
    o.n += 1;
    if (r.trade_type === 'buy') o.buy += Number(r.bnb_amount); else o.sell += Number(r.bnb_amount);
    o.lastPrice = r.price_bnb; o.t = r.block_time;
  }
  for (const [b, o] of [...buckets].sort((x, y) => x[0] - y[0])) {
    console.log(`+${String(b * 60).padStart(5)}s | ${String(o.n).padStart(3)} 笔 | 买 ${o.buy.toFixed(3)} | 卖 ${o.sell.toFixed(3)} | 价 ${o.lastPrice} | ${o.t.slice(11, 19)}`);
  }

  // ---- 锚窗钱包的锚后活跃（「前期钱包买入后活跃度尽失」主证据）----
  console.log(`\n== 锚窗 ${preWallets.size} 钱包的锚后活跃 ==`);
  console.log(`钱包（锚窗角色）| 锚后买笔 | 锚后卖笔 | 锚后首笔距锚(s)`);
  let anyPost = 0;
  for (const [w, bnb] of [...preBuyWallets].sort((x, y) => y[1] - x[1])) {
    const mine = post.filter((r) => wallet(r) === w);
    const mb = mine.filter((r) => r.trade_type === 'buy').length;
    const ms = mine.filter((r) => r.trade_type === 'sell').length;
    if (mine.length) anyPost += 1;
    console.log(`${short(w)}（买 ${bnb.toFixed(3)}）| ${mb} | ${ms} | ${mine.length ? ((ts(mine[0]) - anchorMs) / 1000).toFixed(0) : '-'}`);
  }
  const preOnlySell = [...preWallets].filter((w) => !preBuyWallets.has(w));
  for (const w of preOnlySell) {
    const mine = post.filter((r) => wallet(r) === w);
    if (mine.length) anyPost += 1;
    console.log(`${short(w)}（纯卖/其他）| ${mine.filter((r) => r.trade_type === 'buy').length} | ${mine.filter((r) => r.trade_type === 'sell').length} | ${mine.length ? ((ts(mine[0]) - anchorMs) / 1000).toFixed(0) : '-'}`);
  }
  console.log(`→ 锚窗钱包锚后仍活跃者=${anyPost}/${preWallets.size}`);

  // ---- 新钱包 vs 锚窗钱包的锚后买 ----
  const postBuyNew = postBuy.filter((r) => !preWallets.has(wallet(r)));
  console.log(`\n锚后买 ${postBuy.length} 笔中新钱包 ${postBuyNew.length} 笔（${new Set(postBuyNew.map(wallet)).size} 钱包，合计 ${sum(postBuyNew).toFixed(3)} BNB）`);

  // ---- 价格轨迹 ----
  const rel = post.filter((r) => r.price_bnb != null && !r.price_outlier);
  if (rel.length) {
    const last = rel[rel.length - 1];
    const minP = rel.reduce((m, r) => Math.min(m, Number(r.price_bnb)), Infinity);
    const anchorPrice = Number(pre.filter((r) => r.price_bnb != null && !r.price_outlier).slice(-1)[0]?.price_bnb);
    console.log(`\n价格：锚末 ${anchorPrice} → 锚后最低 ${minP} → 末 ${last.price_bnb}（${last.block_time}）`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
