// 一次性诊断 v3（182 跑）：cd#3666 锚窗 24 笔明细 + 完整 digest 锚 + ④单向死水数值事实
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const ADDR = '0x15583fde3b3ca9260556556a995e6967471d7777';
const ms = (iso) => new Date(iso).getTime();

(async () => {
  const c = await dbManager.getClient();

  // 1) cheat_detection 完整 digest
  const { data: cd } = await c.from('cheat_detection')
    .select('id,anchor_tick_count,analyzed_at,snapshot_digest')
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(5);
  const r = cd[0];
  const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
  console.log('== snapshot_digest 顶层键:', Object.keys(d).join(', '));
  for (const [k, v] of Object.entries(d)) {
    if (k === 'levels' || k === 'activity') console.log(`  ${k}=${JSON.stringify(v)}`);
    else if (typeof v === 'object' && v) console.log(`  ${k}=${JSON.stringify(v).slice(0, 2000)}`);
    else console.log(`  ${k}=${v}`);
  }

  // 2) 锚窗 24 笔明细
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(24);
  const t0 = ms(rows[0].block_time);
  console.log('\n== 锚窗 24 笔明细 ==');
  let buyN = 0, sellN = 0, buyBnb = 0, sellBnb = 0;
  for (const r2 of rows) {
    const isBuy = /buy/i.test(r2.trade_type || '');
    if (isBuy) { buyN++; buyBnb += r2.bnb_amount || 0; } else { sellN++; sellBnb += r2.bnb_amount || 0; }
    const p = (typeof r2.price_bnb === 'number' && !r2.price_outlier) ? r2.price_bnb.toPrecision(3) : (r2.price_outlier ? 'OUTLIER' : 'null');
    console.log(`  t+${String(Math.round((ms(r2.block_time) - t0) / 1000)).padStart(3)}s blk=${r2.block_number} ${isBuy ? 'BUY ' : 'SELL'} ${String(r2.bnb_amount).padStart(8)} p=${p}`);
  }
  console.log(`  买卖笔比 ${buyN}:${sellN}  额比 ${buyBnb.toFixed(3)}:${sellBnb.toFixed(3)}`);

  // 3) 可靠价回撤轮廓（锚窗内）
  const rel = rows.filter((r3) => typeof r3.price_bnb === 'number' && !r3.price_outlier).map((r3) => r3.price_bnb);
  if (rel.length) {
    let peak = rel[0], maxDD = 0;
    for (const p of rel) {
      if (p > peak) peak = p;
      maxDD = Math.max(maxDD, (peak - p) / peak);
    }
    console.log(`  可靠价 ${rel.length} 点：首=${rel[0].toPrecision(3)} 末=${rel[rel.length - 1].toPrecision(3)} 窗内最大回撤=${(maxDD * 100).toFixed(2)}% 涨幅=${((rel[rel.length - 1] / rel[0] - 1) * 100).toFixed(1)}%`);
  }

  // 4) 锚前 72s 内每 12s 分段密度（看「临近锚点是否衰减」）
  const anchorMs = ms(r.analyzed_at) - 4000; // settle 4s → 信号时刻
  console.log(`\n== 信号时刻约 ${new Date(anchorMs).toISOString()}（analyzed_at-4s）==`);
  const segN = (from, to) => rows.filter((r4) => { const t = ms(r4.block_time); return t >= anchorMs - from * 1000 && t < anchorMs - to * 1000; }).length;
  console.log(`  锚前 0-12s=${segN(0, 12)} 12-24s=${segN(12, 24)} 24-36s=${segN(24, 36)} 36-48s=${segN(36, 48)} 48-60s=${segN(48, 60)} 60-72s=${segN(60, 72)}`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
