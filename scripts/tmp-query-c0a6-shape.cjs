// 一次性查询：0xc0a6…7777 锚窗 86 笔时间线+波位置+锚后真实活跃度（单票小结果，182 跑）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xc0a62abacfbe8b80f1650e14f5b0c092347b7777';
const TICK_COLS = 'id,block_number,log_index,block_time,trader_address,sender_address,bnb_amount,trade_type,price_bnb';

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client
    .from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  console.log(`全史（≤3000）共 ${rows.length} 行`);
  const t0 = new Date(rows[0].block_time).getTime();

  // 1) 锚窗 86 笔时间线（秒偏移/方向/金额/钱包缩写/块）
  console.log('\n=== 锚窗 86 笔时间线 ===');
  for (let i = 0; i < Math.min(86, rows.length); i++) {
    const r = rows[i];
    const sec = ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1);
    const w = (r.sender_address || r.trader_address || '').slice(2, 8);
    console.log(`${String(i + 1).padStart(3)} t+${sec.padStart(7)}s blk${r.block_number} ${r.trade_type === "buy" ? "BUY " : "SELL"} ${Number(r.bnb_amount).toFixed(4)} ${w}${i >= 85 ? '  ←—— 锚' : ''}`);
  }

  // 2) 最密 5s 滑窗位置（buy 口径同 burst 波锚）
  const buys = rows.slice(0, 86).map((r, i) => ({ i, ts: new Date(r.block_time).getTime(), bnb: Number(r.bnb_amount), isBuy: r.trade_type === "buy" }))
    .filter((x) => x.isBuy);
  let best = null;
  for (let a = 0; a < buys.length; a++) {
    let b = a;
    while (b + 1 < buys.length && buys[b + 1].ts - buys[a].ts <= 5000) b++;
    const win = { start: a, end: b, n: b - a + 1, bnb: buys.slice(a, b + 1).reduce((s, x) => s + x.bnb, 0) };
    if (!best || win.n > best.n) best = win;
    if (b === a) continue;
  }
  console.log(`\n最密 5s 买波：${best.n} 笔 ${best.bnb.toFixed(4)} BNB，位置=tick#${buys[best.start].i + 1}~#${buys[best.end].i + 1}（锚窗 86 笔内）`);

  // 3) 锚后真实活跃度：86 笔之后的 tick 分布（每分钟笔数概览+首尾）
  const after = rows.slice(86);
  if (after.length) {
    const tAnchor = new Date(rows[85].block_time).getTime();
    const tLast = new Date(rows[rows.length - 1].block_time).getTime();
    console.log(`\n=== 锚后（真实盘面）===`);
    console.log(`锚后 ${after.length} 行，锚→末笔 ${(tLast - tAnchor) / 1000 / 60} 分钟，末笔 ${new Date(tLast).toISOString()}`);
    const perMin = {};
    for (const r of after) {
      const m = Math.floor((new Date(r.block_time).getTime() - tAnchor) / 60000);
      perMin[m] = (perMin[m] || 0) + 1;
    }
    const minutes = Object.keys(perMin).map(Number).sort((a, b) => a - b);
    console.log('分钟→笔数直方图（锚后）:');
    for (const m of minutes.slice(0, 40)) console.log(`  +${m}min: ${perMin[m]} 笔`);
  }

  await dbManager.close?.();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
