// 组 4 侦查（本地不跑重查询——此脚本在 182 上执行）：
// 1) CD13 creator 形状：token_create creator 地址 + creator 首买位置/金额 + 老鼠仓卖出 tx 0x8b26 形状
// 2) CD17 捆绑钱包离场时间线：等额带/同块簇钱包的净持仓与卖出点（相对锚窗末端）
import { dbManager } from '../../src/services/dbManager.js';

const CD13 = '0x8a182a38668979d8c0a77f3f4d49bf297b937777';
const CD17 = '0xb3566fd337409e09bb39fd7f3b4e75b783007777';
const RAT_TX = '0x8b264757706ea11b8936a0ce0637186dc68575ff723f944ccc27470afe5773df';

const c = dbManager.getClient();

async function allTicks(addr) {
  const rows = [];
  let from = 0;
  for (;;) {
    const r = await c.from('wss_price_ticks')
      .select('id,block_number,log_index,trade_type,bnb_amount,trader_address,sender_address,tx_hash,price_bnb,block_time')
      .eq('token_address', addr).gt('id', from)
      .order('id', { ascending: true }).limit(500);
    if (r.error) throw new Error(r.error.message);
    rows.push(...r.data);
    if (r.data.length < 500) break;
    from = r.data[r.data.length - 1].id;
  }
  return rows;
}

// ---- CD13 ----
{
  const ev = await c.from('wss_events').select('kind,block_number,payload,sender_address,tx_hash')
    .eq('token_address', CD13).eq('kind', 'token_create').limit(1);
  console.log('== CD13 token_create ==');
  console.log(JSON.stringify(ev.data, null, 1));

  const ticks = await allTicks(CD13);
  console.log('CD13 全量 ticks:', ticks.length);

  const rat = ticks.filter(t => t.tx_hash === RAT_TX);
  console.log('== 老鼠仓 tx 0x8b26 行 ==');
  for (const t of rat) console.log(t.block_number, t.trade_type, Number(t.bnb_amount).toFixed(4), 'w=' + (t.sender_address || t.trader_address), 'blk_time=' + t.block_time);

  // creator（token_create sender/payload.creator）在该票的全程交易
  const tc = ev.data?.[0];
  const creator = tc?.sender_address || tc?.payload?.creator || null;
  console.log('creator 地址(from token_create):', creator);
  if (creator) {
    const mine = ticks.filter(t => (t.sender_address || t.trader_address) === creator);
    console.log('== creator 全程交易 ==');
    for (const t of mine) console.log('#ord' + (ticks.findIndex(x => x === t) + 1), t.trade_type, Number(t.bnb_amount).toFixed(4), '@' + Number(t.price_bnb).toExponential(3), 'blk=' + t.block_number, t.block_time);
  }

  // 前 12 笔买入（看「开头买太多」形状）
  console.log('== 前 12 笔 ticks（链上真序） ==');
  const sorted = [...ticks].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  for (const t of sorted.slice(0, 12)) {
    const w = t.sender_address || t.trader_address;
    console.log(t.trade_type, Number(t.bnb_amount).toFixed(4), 'w=' + w.slice(0, 10), 'blk=' + t.block_number, 'tx=' + t.tx_hash.slice(0, 10), 'creator?', w === creator ? 'YES' : '');
  }

  // per-wallet 净持仓 + 老鼠仓钱包全程
  const wallets = new Map();
  for (const t of sorted) {
    const w = t.sender_address || t.trader_address;
    const o = wallets.get(w) || { buy: 0, sell: 0, n: 0 };
    if (t.trade_type === 'buy') o.buy += Number(t.bnb_amount); else o.sell += Number(t.bnb_amount);
    o.n++; wallets.set(w, o);
  }
  console.log('== 钱包数 ==', wallets.size);
  const ratW = rat[0] ? (rat[0].sender_address || rat[0].trader_address) : null;
  if (ratW) {
    const o = wallets.get(ratW);
    console.log('老鼠仓钱包', ratW, '全程:', JSON.stringify(o), '净=', (o.buy - o.sell).toFixed(4), 'BNB');
  }
}

// ---- CD17 ----
{
  const ticks = await allTicks(CD17);
  console.log('\n== CD17 全量 ticks ==', ticks.length);
  const sorted = [...ticks].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  const anchorCount = 31; // fixtures 锚 tick 数
  const anchorEnd = sorted[anchorCount - 1]; // 锚窗末端 tick（run 的锚=tickCount）
  console.log('锚窗末端 tick: blk=' + anchorEnd?.block_number, 'time=' + anchorEnd?.block_time);

  // per-wallet 时间线：买入点、卖出点、锚窗末净持仓、全量末净持仓
  const wm = new Map();
  for (const t of sorted) {
    const w = t.sender_address || t.trader_address;
    const o = wm.get(w) || { buy: 0, sell: 0, buys: [], sells: [] };
    if (t.trade_type === 'buy') { o.buy += Number(t.bnb_amount); o.buys.push(t.block_number); }
    else { o.sell += Number(t.bnb_amount); o.sells.push(t.block_number); }
    wm.set(w, o);
  }
  // 锚窗内切片重算
  const inWin = sorted.slice(0, anchorCount);
  const wmWin = new Map();
  for (const t of inWin) {
    const w = t.sender_address || t.trader_address;
    const o = wmWin.get(w) || { buy: 0, sell: 0 };
    if (t.trade_type === 'buy') o.buy += Number(t.bnb_amount); else o.sell += Number(t.bnb_amount);
    wmWin.set(w, o);
  }
  console.log('钱包数: 全量', wm.size, '/ 锚窗内', wmWin.size);
  console.log('== 每钱包 买入/卖出(BNB) | 锚窗末净持仓 | 全量末净持仓 | 卖出块（锚窗后=标 *） ==');
  const rows = [...wm.entries()].sort((a, b) => (b[1].buy + b[1].sell) - (a[1].buy + a[1].sell));
  for (const [w, o] of rows.slice(0, 25)) {
    const win = wmWin.get(w) || { buy: 0, sell: 0 };
    const sellsAfter = o.sells.filter(b => b > anchorEnd.block_number).length;
    console.log(w.slice(0, 10), 'buy=' + o.buy.toFixed(3), 'sell=' + o.sell.toFixed(3),
      '| 窗内净=' + (win.buy - win.sell).toFixed(3),
      '| 全量净=' + (o.buy - o.sell).toFixed(3),
      '| 卖出块数=' + o.sells.length + (sellsAfter ? `(锚后${sellsAfter})` : ''));
  }
  // 同 tx 打包行（bd 最硬信号）
  const txMap = new Map();
  for (const t of inWin) {
    if (t.trade_type !== 'buy') continue;
    txMap.set(t.tx_hash, (txMap.get(t.tx_hash) || 0) + 1);
  }
  const bundled = [...txMap.entries()].filter(([tx, n]) => n >= 2);
  console.log('== 锚窗内同 tx 多行买入（打包信号） ==', bundled.length ? '' : '无');
  for (const [tx, n] of bundled) console.log('tx=' + tx.slice(0, 10), '行数=' + n);
}
process.exit(0);
