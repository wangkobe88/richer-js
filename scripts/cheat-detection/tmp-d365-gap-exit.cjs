// 一次性（182 跑）：D3.66 提案取证——两票「≥50s 静默段清单+出口价」
// （最后一个 ≥50s 静默段的出口首可靠价=「起来起点价」候选判据源）
const { dbManager } = require('../../src/services/dbManager.js');
const FM_LAUNCH = 4496173469e-18;
const T = [
  ['ba5e-全窗', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', '2026-11-05T07:52:18', null],
  ['ba5e-生产1000帽窗', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', '2026-11-05T07:52:18', 1000],
  ['ad80-全窗', '0xad80fb7a03686a9a12952efa17312cf10e86ffff', '2026-11-05T07:28:50', null],
];

async function pullAll(token, anchorIso) {
  const all = [];
  let lastBlock = -1, lastLog = -1;
  for (let i = 0; i < 10; i++) {
    let q = dbManager.getClient().from('wss_price_ticks').select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier').eq('token_address', token).lte('block_time', anchorIso);
    if (lastBlock >= 0) q = q.or(`block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLog})`);
    const { data, error } = await q.order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    const last = rows[rows.length - 1];
    lastBlock = last.block_number; lastLog = last.log_index;
  }
  return all;
}

(async () => {
  for (const [tag, addr, anchorIso, tailN] of T) {
    let rows = await pullAll(addr, anchorIso);
    if (tailN) rows = rows.slice(-tailN);
    const t0 = new Date(rows[0].block_time).getTime();
    const rel = (r) => r.price_bnb > 0 && !/outlier/i.test(String(r.price_outlier || ''));
    console.log(`\n== ${tag} 行=${rows.length}（${rows[0].block_time.slice(11, 19)} → ${rows[rows.length - 1].block_time.slice(11, 19)}）`);
    // 静默段：相邻行 block_time 差 ≥50s；出口价=段后首笔可靠价
    const gaps = [];
    for (let i = 1; i < rows.length; i++) {
      const dt = (new Date(rows[i].block_time).getTime() - new Date(rows[i - 1].block_time).getTime()) / 1000;
      if (dt >= 50) {
        const exitRow = rows.slice(i).find((r) => rel(r));
        const exitPct = exitRow ? `+${((exitRow.price_bnb / FM_LAUNCH - 1) * 100).toFixed(1)}%` : '(段后无可靠价)';
        gaps.push({ from: rows[i - 1].block_time.slice(11, 19), to: rows[i].block_time.slice(11, 19), dt: dt.toFixed(0), exit: exitPct });
      }
    }
    if (!gaps.length) { console.log('  无 ≥50s 静默段（gap 腿本就不过）'); continue; }
    for (const g of gaps) console.log(`  静默 ${g.from} → ${g.to}（${g.dt}s）出口价=${g.exit}`);
    const lastG = gaps[gaps.length - 1];
    console.log(`  → 最后一个 ≥50s 静默段出口价=${lastG.exit}（D3.66 判据源候选）`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.stack || e); process.exit(1); });
