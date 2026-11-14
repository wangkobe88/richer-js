// 一次性验证：0xdee305bc…7777 「断流后段单独窗口」vs 全窗口径的锚强度对比
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xdee305bcd072340779c7d30978c4bcdbd2367777';

function blockBuyAgg(win) {
  const m = new Map();
  for (const r of win) {
    if (r.trade_type !== 'buy') continue;
    if (!m.has(r.block_number)) m.set(r.block_number, { n: 0, bnb: 0, wallets: new Set(), rows: [] });
    const e = m.get(r.block_number);
    e.n++; e.bnb += Number(r.bnb_amount);
    e.wallets.add((r.sender_address || r.trader_address || '').toLowerCase());
    e.rows.push(r);
  }
  return m;
}

function exactEqualClusters(m) {
  const out = [];
  for (const [blk, e] of m) {
    const g = new Map();
    for (const b of e.rows) {
      const k = Number(b.bnb_amount).toFixed(4);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push((b.sender_address || b.trader_address || ''));
    }
    for (const [amt, ws] of g) if (ws.length >= 2) out.push({ blk, wallets: ws.length, amt });
  }
  return out;
}

function profile(name, win, t0) {
  const buys = win.filter(r => r.trade_type === 'buy');
  const buyBnb = buys.reduce((s, r) => s + Number(r.bnb_amount), 0);
  const spanSec = win.length >= 2 ? (new Date(win[win.length - 1].block_time) - new Date(win[0].block_time)) / 1000 : 0;
  const m = blockBuyAgg(win);
  const blocks = [...m.entries()].sort((a, b) => b[1].bnb - a[1].bnb);
  const maxBlk = blocks[0];
  const clusters = exactEqualClusters(m);
  const clusterBnb = clusters.reduce((s, c) => s + Number(c.amt) * c.wallets, 0);
  const ticksPerMin = spanSec > 0 ? (win.length / (spanSec / 60)) : 0;
  console.log(`\n=== ${name} ===`);
  console.log(`tick 数=${win.length}（买 ${buys.length}）span=${spanSec.toFixed(0)}s ticksPerMin=${ticksPerMin.toFixed(2)} buyBnb=${buyBnb.toFixed(4)}`);
  if (maxBlk) console.log(`最大单块买入：blk${maxBlk[0]} ${maxBlk[1].n} 笔 ${maxBlk[1].bnb.toFixed(4)} BNB → 占窗口买入 ${(maxBlk[1].bnb / buyBnb * 100).toFixed(1)}%（全窗口径 8.8%）`);
  if (clusters.length) {
    console.log(`精确等额同块簇：${clusters.length} 个（${clusters.map(c => `${c.wallets}钱包×${c.amt}`).join('、')}）`);
    console.log(`等额簇买入占比：${(clusterBnb / buyBnb * 100).toFixed(1)}%（全窗口径 17.5%）`);
  } else {
    console.log(`精确等额同块簇：无`);
  }
  const pulse = [...m.values()].filter(e => e.n >= 3).length;
  console.log(`≥3 笔脉冲块：${pulse} 个 → pulse 键${pulse >= 2 ? '非 null' : '= null（节拍不成）'}`);
  return { win, buys, m };
}

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client
    .from('wss_price_ticks')
    .select('id,block_number,log_index,block_time,trader_address,sender_address,bnb_amount,trade_type,price_bnb')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);

  const win = rows.slice(0, 54); // 锚窗
  const t0 = new Date(win[0].block_time).getTime();

  // 找最大间隙（断流点）
  let gapIdx = -1, gapMax = 0;
  for (let i = 1; i < win.length; i++) {
    const g = (new Date(win[i].block_time) - new Date(win[i - 1].block_time)) / 1000;
    if (g > gapMax) { gapMax = g; gapIdx = i; }
  }
  console.log(`最大断流：t+${((new Date(win[gapIdx - 1].block_time) - t0) / 1000).toFixed(0)}s → t+${((new Date(win[gapIdx].block_time) - t0) / 1000).toFixed(0)}s，${gapMax.toFixed(0)}s，断流后 ${win.length - gapIdx} 笔`);

  // 修正 clusters 钱包集合引用（重算一次带 ws）
  profile('A. 全窗口径（现行生产锚）', win);
  const post = win.slice(gapIdx);
  profile(`B. 断流后段单独窗口（t+断流重启→锚，${post.length} 笔）`, post);

  // C. 断流后段钱包 vs 前期钱包的重叠（新钱包占比）
  const preW = new Set(win.slice(0, gapIdx).map(r => (r.sender_address || r.trader_address || '').toLowerCase()));
  const postBuys = post.filter(r => r.trade_type === 'buy');
  let fresh = 0;
  for (const b of postBuys) if (!preW.has((b.sender_address || b.trader_address || '').toLowerCase())) fresh++;
  console.log(`\n断流后买家 ${postBuys.length} 个钱包中 ${fresh} 个是断流前从未出现过的新钱包（${(fresh / postBuys.length * 100).toFixed(0)}%）`);

  // D. D3.56 现行临近段口径（锚前 120s）圈到几波
  const tAnchor = new Date(win[win.length - 1].block_time).getTime();
  const near = win.filter(r => new Date(r.block_time).getTime() >= tAnchor - 120000);
  const nearBuys = near.filter(r => r.trade_type === 'buy');
  console.log(`\nD3.56 锚前 120s 临近段：${near.length} 笔（买 ${nearBuys.length}）——漏掉 t+928/962 两波（${gapIdx < win.length - near.length ? '在窗外' : ''}）`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
