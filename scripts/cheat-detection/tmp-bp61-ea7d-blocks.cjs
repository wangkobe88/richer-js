// 一次性探针（182 跑）：ea7d 案 0xffbd 买入/卖出同区块的全部行——「famous 同区块跟单」现场取证。
const { dbManager } = require('../../src/services/dbManager.js');

const ADDR = '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777';

async function main() {
  const client = await dbManager.getClient();
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,trader_address,sender_address')
      .eq('token_address', ADDR).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  const sorted = rows.slice().sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const t0 = Date.parse(sorted[0].block_time);
  console.log(`ea7d 全部 ${rows.length} 行，块范围 ${sorted[0].block_number}~${sorted[sorted.length - 1].block_number}`);
  // 0xffbd 的行所在块
  const FF = '0xffbd5a03e1e936bfae82c567f8b41e0a95296dcc';
  const ffBlocks = new Set(sorted.filter((r) => String(r.sender_address || r.trader_address || '').toLowerCase() === FF).map((r) => r.block_number));
  console.log(`0xffbd 所在块: ${[...ffBlocks].join(', ')}`);
  console.log('\n---- 0xffbd 行及其同块全部行 ----');
  for (const b of ffBlocks) {
    const blk = sorted.filter((r) => r.block_number === b);
    console.log(`\n[block ${b}] ${blk.length} 行:`);
    for (const r of blk) {
      const w = String(r.sender_address || r.trader_address || '').toLowerCase();
      const isFf = w === FF;
      const tRel = ((Date.parse(r.block_time) - t0) / 1000).toFixed(0);
      console.log(`  t+${tRel}s log${r.log_index} ${String(r.trade_type).toUpperCase()} ${Number(r.bnb_amount).toFixed(4)} ${isFf ? '★0xffbd' : w.slice(0, 10) + '…'}`);
    }
  }
  console.log('\n---- 前 25 行全明细（锚窗头部） ----');
  for (const r of sorted.slice(0, 25)) {
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    const tRel = ((Date.parse(r.block_time) - t0) / 1000).toFixed(0);
    console.log(`  t+${tRel}s blk${r.block_number} log${r.log_index} ${String(r.trade_type).toUpperCase()} ${Number(r.bnb_amount).toFixed(4)} ${w === FF ? '★0xffbd' : w.slice(0, 10) + '…'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
