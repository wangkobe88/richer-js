// 一次性对拍：CD183 立项票 0xdee305bc…7777 锚窗 54 行 → D3.58 postStall 六键生产值
// 期望（tmp-query-dee3-window.cjs 手工算）：152s / 1.3897 / 11 / 100 / 42.6 / 21.3
const { dbManager } = require('../src/services/dbManager.js');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const ADDR = '0xdee305bcd072340779c7d30978c4bcdbd2367777';

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client
    .from('wss_price_ticks')
    .select('id,block_number,log_index,block_time,trader_address,sender_address,bnb_amount,trade_type,price_bnb,token_amount,quote_token,price_outlier')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);

  const win = rows.slice(0, 54); // 锚窗（首析 anchorCountAt=54）
  const meta = {
    address: ADDR, symbol: 'DEE3', name: 'DEE3', platform: 'fourmeme',
    quoteToken: null, createdAt: win[0].block_time, creatorAddress: null,
  };
  const d = buildSnapshotFromRows(win, meta).derived;
  console.log('== D3.58 postStall 六键（生产 snapshot 口径）==');
  console.log(`postStallSpanSec        = ${d.postStallSpanSec}        （期望 152）`);
  console.log(`postStallBuyBnb         = ${d.postStallBuyBnb}      （期望 ≈1.3897）`);
  console.log(`postStallBuyerCount     = ${d.postStallBuyerCount}          （期望 11）`);
  console.log(`postStallFreshBuyerPct  = ${d.postStallFreshBuyerPct}        （期望 100）`);
  console.log(`postStallEqualClusterPct= ${d.postStallEqualClusterPct}      （期望 42.6）`);
  console.log(`postStallMaxBlockBuyPct = ${d.postStallMaxBlockBuyPct}       （期望 ≈21.3）`);
  console.log(`\nmaxGapSec=${d.maxGapSec} / 全窗 exactEqualBlockBuyPct=${d.exactEqualBlockBuyPct}（应≈17.5——并存不覆盖）`);
  const hit = d.postStallSpanSec === 152 && d.postStallBuyerCount === 11
    && d.postStallFreshBuyerPct === 100 && d.postStallEqualClusterPct === 42.6
    && Math.abs(d.postStallBuyBnb - 1.3897) < 0.001 && Math.abs(d.postStallMaxBlockBuyPct - 21.3) < 0.15;
  console.log(hit ? '\n✅ 六键全中（与手工窗口分析一致）' : '\n❌ 有偏差——逐键核对');
  process.exit(hit ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
