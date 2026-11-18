// 一次性诊断：bt-v140 票 0x1ac0…7777 currentVsLaunchPct 对拍
// 页面 chip 值（signal metadata.trendFactors）vs 从 wss_price_ticks 重放（T134/T139 口径）
const { dbManager } = require('../src/services/dbManager.js');
const { resolveLaunchPriceBnb, floorLaunchPriceBnb } = require('../src/market-analysis/launch-price.js');

const ADDR = '0x1ac062679ebfc9716db31acd79099f8a5c647777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';
const MIN_PRICE_UPDATE_BNB = 0.002; // FA _fp 默认（实验无 factorParams 覆盖时）

(async () => {
  const c = await dbManager.getClient();

  // 0) 实验
  const { data: exp, error: eErr } = await c.from('experiments')
    .select('experiment_name,trading_mode,config').eq('id', EXP).limit(1);
  if (eErr || !exp || !exp.length) { console.error('experiments 查询失败:', eErr, exp); process.exit(1); }
  const e0 = exp[0];
  const fpOverride = (((e0.config || {}).fourmemeWs || {}).factorParams || {}).minPriceUpdateBnb;
  console.log(`实验=${e0.experiment_name} mode=${e0.trading_mode} minPriceUpdateBnb(覆盖)=${fpOverride ?? '无'}`);
  const minRelBnb = Number.isFinite(fpOverride) ? fpOverride : MIN_PRICE_UPDATE_BNB;

  // 1) 信号行
  const { data: sigs, error: sErr } = await c.from('strategy_signals')
    .select('id,signal_type,action,executed,created_at,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (sErr) { console.error('signals 查询失败:', sErr); process.exit(1); }
  console.log(`\n信号行数=${sigs.length}`);
  for (const s of sigs) {
    const tf = (s.metadata || {}).trendFactors || {};
    console.log(`  ${s.created_at} ${s.signal_type}/${s.action}/${s.executed} reason=${(s.reason||'').slice(0,40)}` +
      ` | currentVsLaunchPct=${tf.currentVsLaunchPct} launchConstVsPct=${tf.launchConstVsPct}` +
      ` launchMinVsFloorPct=${tf.launchMinVsFloorPct} currentPrice=${tf.currentPrice}`);
  }

  // 2) ticks keyset 分页拉全（单票小结果）
  const COLS = 'id,block_time,block_number,log_index,trade_type,price_bnb,bnb_amount,price_outlier,platform';
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data } = await c.from('wss_price_ticks').select(COLS)
      .eq('token_address', ADDR).gt('id', cursor)
      .order('id', { ascending: true }).limit(1000);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    cursor = data[data.length - 1].id;
  }
  // 链上真序
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const platforms = [...new Set(rows.map(r => r.platform))];
  console.log(`\nticks=${rows.length} 平台=${platforms.join(',')} 时间范围=${rows[0]?.block_time} ~ ${rows[rows.length - 1]?.block_time}`);

  const launchConst = resolveLaunchPriceBnb(platforms[0], null);
  console.log(`常量锚(${platforms[0]})=${launchConst}`);

  // 3) 逐 BUY 信号 as-of 重放
  for (const s of sigs.filter(x => x.signal_type === 'BUY')) {
    const tMs = new Date(s.created_at).getTime();
    const upto = rows.filter(r => new Date(r.block_time).getTime() <= tMs);
    const rel = upto.filter(r => !r.price_outlier && r.price_bnb > 0 && r.bnb_amount >= minRelBnb);
    if (!rel.length) { console.log(`\n=== ${s.created_at} 无可靠价行（<=信号时刻）`); continue; }
    const lastRel = rel[rel.length - 1];
    let minPrice = Infinity, minRow = null;
    for (const r of rel) if (r.price_bnb < minPrice) { minPrice = r.price_bnb; minRow = r; }
    const firstBuy = rel.find(r => r.trade_type === 'buy');
    const launch = launchConst !== null
      ? floorLaunchPriceBnb(launchConst, minPrice)
      : rel[0].price_bnb; // 旧口径（无常量平台）
    const pct = parseFloat((100 * (lastRel.price_bnb / launch - 1)).toFixed(2));
    const tf = (s.metadata || {}).trendFactors || {};
    const match = Math.abs(pct - (tf.currentVsLaunchPct ?? NaN)) < 0.02;
    console.log(`\n=== signal ${s.created_at} reason=${(s.reason||'').slice(0,40)}`);
    console.log(`  信号行值  currentVsLaunchPct=${tf.currentVsLaunchPct}`);
    console.log(`  重放重算  =${pct}  ${match ? '✅ 一致' : '❌ 不一致'}`);
    console.log(`  原料: lastRel=${lastRel.price_bnb.toExponential(6)}(${lastRel.block_time},${lastRel.trade_type},bnb=${lastRel.bnb_amount})`);
    console.log(`        minRel=${minPrice.toExponential(6)}(${minRow.block_time},${minRow.trade_type}) firstBuy=${firstBuy ? firstBuy.price_bnb.toExponential(6) : '无'}`);
    console.log(`        launch=min(常量,滚动最低)=${launch.toExponential(6)}  rel行数=${rel.length}/${upto.length}`);
    if (launchConst !== null) {
      console.log(`        纯常量口径=${(100 * (lastRel.price_bnb / launchConst - 1)).toFixed(2)}%（对照）`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
