// 一次性（182 跑）：两票锚时刻末行价 vs launch（D3.66 提案判据源取证）
const { dbManager } = require('../../src/services/dbManager.js');
const FM_LAUNCH = 4496173469e-18;
const T = [
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', '2026-11-05T07:52:18'],
  ['ad80', '0xad80fb7a03686a9a12952efa17312cf10e86ffff', '2026-11-05T07:28:50'],
];
(async () => {
  const c = dbManager.getClient();
  for (const [tag, addr, iso] of T) {
    const { data } = await c.from('wss_price_ticks').select('block_time,price_bnb,price_outlier,trade_type')
      .eq('token_address', addr).lte('block_time', iso)
      .order('block_number', { ascending: false }).order('log_index', { ascending: false }).limit(1);
    const r = (data || [])[0] || {};
    const pct = r.price_bnb > 0 ? `+${((r.price_bnb / FM_LAUNCH - 1) * 100).toFixed(1)}%` : '-';
    console.log(`${tag} 锚末行 ${r.block_time} ${r.price_bnb?.toExponential(3)} outlier=${r.price_outlier} type=${r.trade_type} → vs launch ${pct}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
