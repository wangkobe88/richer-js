// T172 影响面扫描（182 跑）：bt-v143 全部 BUY 信号票重放出生窗
// —— 同块等额合并口径（新）vs 单钱包累计口径（旧）launchBigBuyBnb 对照，
//    跨线票（旧<1∧新≥1）分「豁免臂在场（minVsFloor<0，推迟仍被短路）」与
//    「豁免臂不在场（合并即推迟生效）」两桶，带盈亏方向。
const { dbManager } = require('../src/services/dbManager.js');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');

const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';

(async () => {
  const c = await dbManager.getClient();

  // 1) 全部 BUY 信号票（首个成功 fire 的行——fire 时刻+metadata）
  const { data: sigs, error: sErr } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
    .order('created_at', { ascending: true });
  if (sErr) throw new Error(sErr.message);
  const firstFire = new Map();
  for (const s of sigs) if (!firstFire.has(s.token_address)) firstFire.set(s.token_address, s);
  console.log(`BUY 成功票数=${firstFire.size}`);

  // 2) 盈亏（tmp-v140-diff 口径：success=true，buy 计 input/sell 计 output）
  const tRows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount')
      .eq('experiment_id', EXP).eq('success', true).range(from, from + 999);
    if (error) throw new Error(error.message);
    tRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const pnl = new Map();
  for (const t of tRows) {
    const e = pnl.get(t.token_address) || { symbol: t.token_symbol, buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') e.buy += t.input_amount; else e.sell += t.output_amount;
    pnl.set(t.token_address, e);
  }
  for (const e of pnl.values()) e.pnl = e.sell - e.buy;

  // 3) 逐票重放
  const COLS = 'id,block_time,block_number,log_index,trade_type,price_bnb,bnb_amount,sender_address,trader_address,price_outlier,platform';
  const out = [];
  for (const [addr, sig] of firstFire) {
    const fireTs = new Date(sig.created_at).getTime();
    const rows = [];
    let cursor = 0;
    for (;;) {
      const { data } = await c.from('wss_price_ticks').select(COLS)
        .eq('token_address', addr).gt('id', cursor)
        .order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      cursor = data[data.length - 1].id;
    }
    // fire 前行（含 fire 时刻），链上真序
    const upto = rows
      .filter(r => new Date(r.block_time).getTime() <= fireTs)
      .sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    if (!upto.length) { out.push({ addr, skip: 'no-ticks' }); continue; }
    const firstTs = new Date(upto[0].block_time).getTime();
    const win = upto.filter(r => new Date(r.block_time).getTime() - firstTs <= 90_000);

    // 3a) 旧口径手算（单钱包累计 ≥0.19 各计）
    const walletBuys = new Map();
    for (const r of win) {
      if (r.trade_type !== 'buy') continue;
      const w = (r.sender_address || r.trader_address || '').toLowerCase();
      if (!w) continue;
      walletBuys.set(w, (walletBuys.get(w) || 0) + (r.bnb_amount || 0));
    }
    let oldBig = 0;
    for (const v of walletBuys.values()) if (v >= 0.19) oldBig += v;

    // 3b) 新口径 FA 重放
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken(addr, { createdAtMs: firstTs, totalSupply: 1e9, symbol: 'T', platform: upto[0].platform || 'fourmeme', creatorAddress: null });
    for (const r of win) {
      fa.processTick({
        token_address: addr, trade_type: r.trade_type,
        trader_address: r.trader_address, sender_address: r.sender_address,
        price_bnb: r.price_bnb, price_usd: (r.price_bnb || 0) * 745,
        bnb_amount: r.bnb_amount, token_amount: null,
        block_number: r.block_number, log_index: r.log_index,
        timestamp: new Date(r.block_time).getTime(),
        tx_hash: '0x' + String(r.id), price_outlier: r.price_outlier,
      }, {});
    }
    const fm = fa.buildFactorMap(addr, fireTs);
    const tf = (sig.metadata || {}).trendFactors || {};
    out.push({
      addr, oldBig, newBig: fm.launchBigBuyBnb,
      minVsFloor: fm.launchMinVsFloorPct, sinceFirst: fm.sinceFirstTradeSec,
      sigMinVsFloor: tf.launchMinVsFloorPct, sigSince: tf.sinceFirstTradeSec,
      pnl: pnl.has(addr) ? pnl.get(addr).pnl : null,
      symbol: pnl.has(addr) ? pnl.get(addr).symbol : (tf.tokenSymbol || '?'),
    });
  }

  // 4) 汇总
  const ok = out.filter(o => !o.skip);
  const crossed = ok.filter(o => o.oldBig < 1 && o.newBig >= 1);
  const sum = (arr) => arr.reduce((a, o) => a + (o.pnl || 0), 0);
  console.log(`\n重放成功=${ok.length} 跳过=${out.length - ok.length}`);
  console.log(`跨线票（旧<1 ∧ 新≥1）=${crossed.length}，Σpnl=${sum(crossed).toFixed(4)}`);
  const exShort = crossed.filter(o => (o.sigMinVsFloor ?? o.minVsFloor) < 0);
  const exLive = crossed.filter(o => !((o.sigMinVsFloor ?? o.minVsFloor) < 0));
  console.log(`  其中豁免臂在场（minVsFloor<0，推迟被短路、维持早买）=${exShort.length} Σpnl=${sum(exShort).toFixed(4)}`);
  console.log(`  其中豁免臂不在场（合并即推迟生效）=${exLive.length} Σpnl=${sum(exLive).toFixed(4)}`);
  for (const o of [...exLive, ...exShort].sort((a, b) => (a.pnl || 0) - (b.pnl || 0))) {
    console.log(`  ${o.pnl != null && o.pnl < 0 ? '［止血］' : '［误伤/中性］'} ${o.symbol} ${o.addr.slice(0, 10)}` +
      ` old=${o.oldBig.toFixed(4)} new=${o.newBig.toFixed(4)} minVsFloor=${o.sigMinVsFloor ?? o.minVsFloor}` +
      ` sinceFirst=${o.sigSince ?? o.sinceFirst} pnl=${o.pnl != null ? o.pnl.toFixed(4) : '无成交'}`);
  }
  // 已推迟票翻动（旧≥1 新≥1 无变化；旧<1 新<1 无变化）——计数即可
  const wasHeavy = ok.filter(o => o.oldBig >= 1);
  console.log(`\n旧口径已 ≥1（推迟域，无变化）=${wasHeavy.length}`);
  // 大额变化但未跨线（合并改变数值不改门判定）计数
  const chg = ok.filter(o => Math.abs(o.newBig - o.oldBig) > 1e-9 && !(o.oldBig < 1 && o.newBig >= 1));
  console.log(`数值变化但未跨线=${chg.length}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
