// 一次性：CD183 脉冲节拍臂为何没接住——pulse 三键值+重启段三波逐笔分解
const { dbManager } = require('../src/services/dbManager.js');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const ADDR = '0xdee305bcd072340779c7d30978c4bcdbd2367777';

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client.from('wss_price_ticks')
    .select('id,block_number,log_index,block_time,trader_address,sender_address,bnb_amount,trade_type,price_bnb')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  const win = rows.slice(0, 54);
  const meta = { address: ADDR, symbol: 'mini-drama', name: 'mini-drama', platform: 'flap', quoteToken: null, createdAt: win[0].block_time, creatorAddress: null };
  const d = buildSnapshotFromRows(win, meta).derived;
  console.log('== pulse 三键（CD161 节拍臂）==');
  console.log('pulseBlockCount   =', d.pulseBlockCount, '   （脉冲块=≥3 笔 buy 同块；单脉冲=null）');
  console.log('pulseBlockBuyPct  =', d.pulseBlockBuyPct);
  console.log('pulseMaxGapBlocks =', d.pulseMaxGapBlocks);
  console.log('\n== burst/等额 对照 ==');
  console.log('burstMaxGapSec =', d.burstMaxGapSec, ' burstWaveBuyBnb =', d.burstWaveBuyBnb, ' burstWaveWallets =', d.burstWaveWallets);
  console.log('exactEqualBlockClusterCount =', d.exactEqualBlockClusterCount, ' exactEqualBlockBuyPct(全窗) =', d.exactEqualBlockBuyPct);

  console.log('\n== 重启段（静默后全部行）逐笔 ==');
  // 复算段起点：找最大 gap
  let maxGap = 0, gapAt = -1;
  for (let i = 1; i < win.length; i++) {
    const a = new Date(win[i - 1].block_time).getTime(), b = new Date(win[i].block_time).getTime();
    const g = (b - a) / 1000;
    if (g > maxGap) { maxGap = g; gapAt = i; }
  }
  const seg = win.slice(gapAt);
  const t0 = new Date(seg[0].block_time).getTime();
  for (const r of seg) {
    const t = ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(0);
    const w = (r.sender_address || r.trader_address || '').slice(0, 10);
    console.log(`t+${t}s block=${r.block_number} ${r.trade_type === 'BUY' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} BNB ${w}…`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
