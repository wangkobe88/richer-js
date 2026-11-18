// 一次性诊断：e5941591 票 0x683165bf…7777 出生段结构（G1 首两波门 / G2 大户推迟门贴线归因）
// + 用户提案预演：同块等额买入视为单用户 → launchBigBuyBnb 合并口径重算
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = process.argv[2] || '0x683165bf8c05ced9392b1628c1433bc9799f7777';
const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';
const LAUNCH_WIN_MS = 90_000;   // launchBundleWinMs 默认（出生窗）
const DUST = 0.001;             // earlyUniformDustBnb 默认（等额尘门）
const HOLDER_DUST = 0.015;      // holderDustBnb 默认（f0/wave/clu 尘线）

(async () => {
  const c = await dbManager.getClient();

  // 0) 实验
  const { data: exp } = await c.from('experiments')
    .select('experiment_name,trading_mode,created_at,config').eq('id', EXP).limit(1);
  const e0 = exp[0];
  const cfg = e0.config || {};
  const fp = (cfg.fourmemeWs || {}).factorParams || {};
  console.log(`实验=${e0.experiment_name} mode=${e0.trading_mode} 创建=${e0.created_at}`);
  console.log(`factorParams=${JSON.stringify(fp)}`);
  const winMs = fp.launchBundleWinMs ?? LAUNCH_WIN_MS;
  const eqDust = fp.earlyUniformDustBnb ?? DUST;
  const holdDust = fp.holderDustBnb ?? HOLDER_DUST;

  // 1) 信号行
  const { data: sigs, error: sErr } = await c.from('strategy_signals')
    .select('id,signal_type,action,executed,created_at,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (sErr) { console.error('signals 查询失败:', sErr); process.exit(1); }
  console.log(`\n信号行数=${(sigs || []).length}`);
  for (const s of (sigs || [])) {
    const tf = (s.metadata || {}).trendFactors || {};
    const sg = (s.metadata || {}).signalGate || {};
    console.log(`  ${s.created_at} ${s.signal_type}/${s.action} exec=${s.executed} reason=${(s.reason || '').slice(0, 60)}`);
    if (s.signal_type === 'BUY') {
      console.log(`    launch: clu=${tf.launchBundleClusterSize} f0=${tf.launchFirstBlockWallets} wave=${tf.launchFirstWaveWallets}` +
        ` bigBuy=${tf.launchBigBuyBnb} minVsFloor=${tf.launchMinVsFloorPct} curVs=${tf.currentVsLaunchPct}` +
        ` age=${tf.tokenAgeSec} sinceFirst=${tf.sinceFirstTradeSec} eqW=${tf.launchEqualClusterWallets} eqBnb=${tf.launchEqualClusterBnb}`);
      if (sg.legId) console.log(`    signalGate: leg=${sg.legId} triggerNo=${sg.triggerNo} gate=${sg.gateBlocked ?? ''}`);
    }
  }

  // 2) 成交与盈亏
  const { data: trades } = await c.from('trades')
    .select('trade_type,price,quantity,trade_amount,executed_at,trade_status,profit_loss')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('executed_at', { ascending: true });
  console.log(`\n成交=${(trades || []).length}`);
  for (const t of (trades || [])) console.log(`  ${t.executed_at} ${t.trade_type} qty=${t.quantity} amt=${t.trade_amount} status=${t.trade_status} pnl=${t.profit_loss ?? ''}`);

  // 3) ticks 单票拉全
  const COLS = 'id,block_time,block_number,log_index,trade_type,price_bnb,bnb_amount,sender_address,trader_address,price_outlier,platform';
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
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const firstTs = rows.length ? new Date(rows[0].block_time).getTime() : 0;
  const winRows = rows.filter(r => new Date(r.block_time).getTime() - firstTs <= winMs);
  console.log(`\nticks=${rows.length} 出生窗(90s)行数=${winRows.length} 首行=${rows[0]?.block_time} 平台=${rows[0]?.platform}`);

  // 4) 出生窗 buy 明细（wallet=sender||trader）
  const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
  const buys = winRows.filter(r => r.trade_type === 'buy');
  const firstBuy = new Map();   // w -> {blk, bnb, ts}
  const walletBuys = new Map(); // w -> 累计 bnb（含分单）
  const blkFirstTs = new Map(); // blk -> 首行 ts
  for (const r of winRows) {
    const ts = new Date(r.block_time).getTime();
    if (!blkFirstTs.has(r.block_number)) blkFirstTs.set(r.block_number, ts);
  }
  for (const r of buys) {
    const w = wallet(r);
    const bnb = r.bnb_amount || 0;
    walletBuys.set(w, (walletBuys.get(w) || 0) + bnb);
    if (!firstBuy.has(w)) firstBuy.set(w, { blk: r.block_number, bnb, ts: new Date(r.block_time).getTime() });
  }
  console.log(`\n出生窗买入笔数=${buys.length} 首买钱包数=${firstBuy.size}`);
  console.log('首买明细（按块排序）:');
  const fbArr = [...firstBuy.entries()].map(([w, e]) => ({ w: w.slice(0, 10), full: w, ...e }));
  fbArr.sort((a, b) => a.ts - b.ts || a.blk - b.blk);
  for (const e of fbArr) {
    console.log(`  blk=${e.blk} ${new Date(e.ts).toISOString()} w=${e.w}… 首买=${e.bnb.toFixed(8)} 累计=${(walletBuys.get(e.full) || 0).toFixed(8)}`);
  }

  // 5) 现行口径复算
  const fb = rows.length ? rows[0].block_number : null;
  const sized = fbArr.filter(e => (walletBuys.get(e.full) || 0) >= holdDust);
  let f0 = 0; for (const e of sized) if (e.blk === fb) f0++;
  const fbTs = blkFirstTs.get(fb);
  const waveBlks = new Set();
  if (fbTs !== undefined) for (const [blk, ts] of blkFirstTs) if (blk > fb && ts - fbTs <= 2000) waveBlks.add(blk);
  let fNext = 0; for (const e of sized) if (waveBlks.has(e.blk)) fNext++;
  let bigBuySum = 0;
  const bigs = [];
  for (const [w, v] of walletBuys) if (v >= 0.19) { bigBuySum += v; bigs.push(`${w.slice(0, 10)}:${v.toFixed(4)}`); }
  console.log(`\n复算（现行口径）: f0=${f0} wave=${f0 + fNext} bigBuy=${bigBuySum.toFixed(4)} [${bigs.join(' ')}]`);

  // 6) 用户提案预演：同块等额首买 → 视为单用户，合并累计买入过 0.19 大户线
  //    等额判据=同块首买金额相对差 <1e-5（现有 eq 簇口径）；尘门 earlyUniformDustBnb
  const byBlkBnb = new Map(); // blk -> [{w, bnb}]
  for (const e of fbArr) {
    if (e.bnb < eqDust) continue;
    if (!byBlkBnb.has(e.blk)) byBlkBnb.set(e.blk, []);
    byBlkBnb.get(e.blk).push(e);
  }
  const groups = []; // 视为单用户的钱包组
  const grouped = new Set();
  const eqKey = x => x.bnb.toFixed(4); // T147 同款 toFixed(4) 口径（0.0001 BNB 精度全等）
  for (const [blk, list] of byBlkBnb) {
    const byAmt = new Map(); // toFixed(4) 金额 -> 钱包组
    for (const x of list) {
      const k = eqKey(x);
      if (!byAmt.has(k)) byAmt.set(k, []);
      byAmt.get(k).push(x);
    }
    for (const [k, g] of byAmt) {
      if (g.length >= 2) {
        groups.push({ blk, amt: k, wallets: g.map(x => x.full), firstBuys: g.map(x => x.bnb) });
        for (const x of g) grouped.add(x.full);
      }
    }
  }
  console.log(`\n提案预演——同块等额首买组（toFixed(4) 全等，≥2 钱包，尘门 ${eqDust}）:`);
  for (const g of groups) {
    const merged = g.wallets.reduce((s, w) => s + (walletBuys.get(w) || 0), 0);
    console.log(`  blk=${g.blk} 钱包数=${g.wallets.length} 首买=[${g.firstBuys.map(x => x.toFixed(8)).join(', ')}] 合并累计=${merged.toFixed(4)}`);
  }
  // 合并口径 bigBuy 重算：非组钱包逐个 ≥0.19 计入；组钱包合并累计 ≥0.19 全组计入
  let bigBuyMerged = 0;
  const bigsM = [];
  for (const [w, v] of walletBuys) {
    if (grouped.has(w)) continue;
    if (v >= 0.19) { bigBuyMerged += v; bigsM.push(`${w.slice(0, 10)}:${v.toFixed(4)}`); }
  }
  for (const g of groups) {
    const merged = g.wallets.reduce((s, w) => s + (walletBuys.get(w) || 0), 0);
    if (merged >= 0.19) { bigBuyMerged += merged; bigsM.push(`[组${g.blk}×${g.wallets.length}]:${merged.toFixed(4)}`); }
  }
  console.log(`合并口径 bigBuy=${bigBuyMerged.toFixed(4)} [${bigsM.join(' ')}]  vs 现行 ${bigBuySum.toFixed(4)}`);
  console.log(`推迟门（≥1 触发推迟）: 现行=${bigBuySum >= 1 ? '推迟' : '放行(' + bigBuySum.toFixed(2) + ')'} → 合并=${bigBuyMerged >= 1 ? '推迟' : '放行(' + bigBuyMerged.toFixed(2) + ')'}`);

  // 7) 改动后 FA 真实重放（14 条 ticks 直喂 → launchBigBuyBnb 对拍）
  const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: firstTs, totalSupply: 1e9, symbol: 'T', platform: rows[0]?.platform || 'flap', creatorAddress: null });
  for (const r of rows) {
    fa.processTick({
      token_address: ADDR, trade_type: r.trade_type,
      trader_address: r.trader_address, sender_address: r.sender_address,
      price_bnb: r.price_bnb, price_usd: (r.price_bnb || 0) * 745,
      bnb_amount: r.bnb_amount, token_amount: null,
      block_number: r.block_number, log_index: r.log_index,
      timestamp: new Date(r.block_time).getTime(),
      tx_hash: '0x' + String(r.id), price_outlier: r.price_outlier,
    }, {});
  }
  const fire = new Date(sigs.find(s => s.signal_type === 'BUY').created_at).getTime();
  const fm = fa.buildFactorMap(ADDR, fire);
  console.log(`\nFA 重放（fire 时刻 ${new Date(fire).toISOString()}）:`);
  console.log(`  launchBigBuyBnb=${fm.launchBigBuyBnb}（信号行旧值 0.846；手算合并 1.1177）`);
  console.log(`  f0=${fm.launchFirstBlockWallets} wave=${fm.launchFirstWaveWallets} clu=${fm.launchBundleClusterSize}` +
    ` minVsFloor=${fm.launchMinVsFloorPct} sinceFirst=${fm.sinceFirstTradeSec} age=${fm.tokenAgeSec}`);
  const gatePass = (fm.launchBigBuyBnb < 1) || (fm.sinceFirstTradeSec > 60) || (fm.launchMinVsFloorPct < 0);
  console.log(`  G2 推迟门放行=${gatePass}（bigBuy≥1=${fm.launchBigBuyBnb >= 1} ∧ 60s 内=${fm.sinceFirstTradeSec <= 60} ∧ 豁免臂<0=${fm.launchMinVsFloorPct < 0}）`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
