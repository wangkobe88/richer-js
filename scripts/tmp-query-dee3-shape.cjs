// 一次性查询：0xdee305bc…7777 锚窗 54 笔形态归因——同块买入聚合（间隔大 slot？）+等额簇+锚后+盈亏
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xdee305bcd072340779c7d30978c4bcdbd2367777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';
const TICK_COLS = 'id,block_number,log_index,block_time,trader_address,sender_address,bnb_amount,trade_type,price_bnb';

async function main() {
  const client = await dbManager.getClient();

  // trades 列名探测
  const { data: tr0 } = await client.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', ADDR).limit(1);
  if (tr0 && tr0[0]) {
    console.log(`trades 列: ${Object.keys(tr0[0]).join(',')}`);
    const { data: trs } = await client.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true }).limit(20);
    for (const t of trs || []) {
      const pnlKey = Object.keys(t).find(k => /profit|pnl/i.test(k));
      const amtKey = Object.keys(t).find(k => /amount|bnb/i.test(k) && !/profit/.test(k));
      const dirKey = Object.keys(t).find(k => /direction|side|type/i.test(k));
      console.log(`  ${t.created_at} ${t[dirKey]} ${t[amtKey]} pnl=${pnlKey ? t[pnlKey] : '-'}`);
    }
  }

  const { data: rows, error } = await client
    .from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  console.log(`\n全史（≤3000）共 ${rows.length} 行`);
  const t0 = new Date(rows[0].block_time).getTime();

  // 1) 锚窗 54 笔逐笔
  console.log('\n=== 锚窗 54 笔时间线（锚=首析 anchor_tick_count=54）===');
  for (let i = 0; i < Math.min(54, rows.length); i++) {
    const r = rows[i];
    const sec = ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1);
    const w = (r.sender_address || r.trader_address || '').slice(2, 8);
    console.log(`${String(i + 1).padStart(3)} t+${sec.padStart(7)}s blk${r.block_number}.${r.log_index} ${r.trade_type === 'buy' ? 'BUY ' : 'SELL'} ${Number(r.bnb_amount).toFixed(4)} ${w}${i === 53 ? '  ←—— 锚' : ''}`);
  }

  // 2) 同块买入聚合（间隔大 slot 形状验证）
  const win = rows.slice(0, 54);
  const blkBuy = new Map();
  for (const r of win) {
    if (r.trade_type !== 'buy') continue;
    const k = r.block_number;
    if (!blkBuy.has(k)) blkBuy.set(k, { n: 0, bnb: 0, wallets: new Set() });
    const e = blkBuy.get(k);
    e.n++; e.bnb += Number(r.bnb_amount);
    e.wallets.add((r.sender_address || r.trader_address || '').toLowerCase());
  }
  console.log('\n=== 锚窗内每块买入聚合（≥2 笔的块）===');
  const sorted = [...blkBuy.entries()].sort((a, b) => b[1].n - a[1].n);
  let prevBlk = null;
  for (const [blk, e] of sorted) {
    if (e.n < 2) continue;
    const row_ = win.find(r => r.block_number === blk);
    const sec = row_ ? ((new Date(row_.block_time).getTime() - t0) / 1000).toFixed(1) : '?';
    const gap = prevBlk ? (blk - prevBlk) : null;
    console.log(`blk${blk} t+${sec}s buy=${e.n} 笔 ${e.bnb.toFixed(4)} BNB 钱包数=${e.wallets.size}${gap !== null ? ` 距上一多笔块=${gap} 块` : ''}`);
    prevBlk = blk;
  }
  const single = [...blkBuy.entries()].filter(([, e]) => e.n === 1).length;
  console.log(`（单笔块 ${single} 个；≥3 笔的脉冲块 ${sorted.filter(([, e]) => e.n >= 3).length} 个 → CD161 单脉冲=null 判据${sorted.filter(([, e]) => e.n >= 3).length < 2 ? '【命中：节拍不成】' : ''}）`);

  // 3) 精确等额同块簇（toFixed(4) 全等、≥2 钱包）
  console.log('\n=== 精确等额同块簇（CD160 口径复算）===');
  for (const [blk, e] of sorted) {
    if (e.n < 2) continue;
    const buys = win.filter(r => r.block_number === blk && r.trade_type === 'buy');
    const amtGroups = new Map();
    for (const b of buys) {
      const k = Number(b.bnb_amount).toFixed(4);
      if (!amtGroups.has(k)) amtGroups.set(k, []);
      amtGroups.get(k).push((b.sender_address || b.trader_address || '').slice(2, 10));
    }
    for (const [amt, ws] of amtGroups) {
      if (ws.length >= 2) console.log(`blk${blk}: ${ws.length} 钱包等额 ${amt} BNB → ${ws.join(' / ')}`);
    }
  }

  // 4) 锚后形态（到卖出 09:52/09:55 之后一段）
  const after = rows.slice(54);
  if (after.length) {
    const tA = new Date(rows[53].block_time).getTime();
    console.log(`\n=== 锚后 ${after.length} 行概览 ===`);
    for (let i = 0; i < Math.min(after.length, 40); i++) {
      const r = after[i];
      const sec = ((new Date(r.block_time).getTime() - tA) / 1000).toFixed(1);
      const w = (r.sender_address || r.trader_address || '').slice(2, 8);
      console.log(`${String(54 + i + 1).padStart(3)} t+${sec.padStart(7)}s blk${r.block_number} ${r.trade_type === 'buy' ? 'BUY ' : 'SELL'} ${Number(r.bnb_amount).toFixed(4)} ${w} px=${Number(r.price_bnb).toExponential(3)}`);
    }
    const tLast = new Date(rows[rows.length - 1].block_time).getTime();
    const pFirst = Number(rows[0].price_bnb), pAnchor = Number(rows[53].price_bnb), pLast = Number(rows[rows.length - 1].price_bnb);
    console.log(`首价=${pFirst.toExponential(3)} 锚价=${pAnchor.toExponential(3)}（${((pAnchor / pFirst - 1) * 100).toFixed(1)}%） 末价=${pLast.toExponential(3)}（锚后 ${((pLast / pAnchor - 1) * 100).toFixed(1)}%） 锚→末 ${(tLast - tA) / 1000 / 60} 分钟`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
