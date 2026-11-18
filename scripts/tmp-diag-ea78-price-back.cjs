// ea78：平台确认 + 60s 后价格首次回到 ≤+28.5% 的时刻
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';
const FL = 6.14 / (107036752 + 1e9);

(async () => {
  const c = await dbManager.getClient();

  // 平台
  const ev = await c.from('wss_events').select('kind,payload')
    .eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
  const p = (ev.data && ev.data[0] && ev.data[0].payload) || {};
  console.log(`platform=${p.platform} symbol=${p.symbol} quote_token=${p.quote_token || p.quoteToken || '-'}`);

  // 回测窗口
  const ex = await c.from('experiments').select('config').eq('id', EXP).limit(1);
  const bt = (ex.data[0].config || {}).backtest || {};
  console.log(`backtest: source=${bt.sourceExperimentId || '-'} start=${bt.startTime} end=${bt.endTime} maxTickRows=${bt.maxTickRows} signalGateReal=${bt.signalGateReal}`);

  // 05:49:05 之后价格首次 ≤ +28.5%（7.127e-9）——分桶拉 4 小时
  const q = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T05:49:05Z')
    .lte('block_time', '2026-11-05T10:05:00Z')
    .order('block_time', { ascending: true })
    .limit(1000);
  const rows = q.data || [];
  console.log(`\n05:49:05~10:05 ticks=${rows.length}（上限 1000，如打满说明窗口内行数超限）`);
  let minP = Infinity, minT = null;
  let firstBack = null;
  for (const r of rows) {
    if (r.price_bnb == null) continue;
    if (r.price_bnb < minP) { minP = r.price_bnb; minT = r.block_time; }
    if (!firstBack && r.price_bnb <= FL * 1.285) firstBack = r;
  }
  console.log(`FL=${FL.toExponential(4)} +28.5%线=${(FL * 1.285).toExponential(4)}`);
  console.log(`窗口内最低价=${minP.toExponential(4)} @ ${minT}（vs FL ${(((minP / FL) - 1) * 100).toFixed(1)}%）`);
  console.log(`首次回到 ≤+28.5%: ${firstBack ? firstBack.block_time + ' px=' + firstBack.price_bnb.toExponential(3) + ' (' + (((firstBack.price_bnb / FL) - 1) * 100).toFixed(1) + '%)' : '窗口内未回到'}`);
  // 价格轮廓（每 15 分钟采样）
  console.log('\n价格轮廓（每 ~15min 首个 tick）:');
  let lastSlot = '';
  for (const r of rows) {
    if (r.price_bnb == null) continue;
    const slot = r.block_time.slice(0, 16);
    if (slot !== lastSlot && (parseInt(slot.slice(11, 13)) * 60 + parseInt(slot.slice(14, 16))) % 15 === 0) {
      console.log(`  ${r.block_time} px=${r.price_bnb.toExponential(3)} (${(((r.price_bnb / FL) - 1) * 100).toFixed(1)}%)`);
      lastSlot = slot;
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
