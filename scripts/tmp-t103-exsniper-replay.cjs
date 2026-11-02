/**
 * T103 验证 v2：holderTrendSlopeExSniper（剔前 4 个有交易 slot）对 v60 损失票的拦截力。
 * 双口径：
 *  A) live 火点口径——火点快照 dp（落库真值）：dp≤7 ⟹ 序列未滑出出生段（窗 ≤8 点），
 *     dpEx=max(0,dp−4) 精确；dp=8 用链上真序重放的 ExSniper 判（wallet 段滞后数秒后
 *     必然追平，即引擎持续 per-tick 评估下的实际放行形状）
 *  B) 链上真序重放（回测口径）——真身 FA 逐 tick 喂（尘门 0.001、wallet=sender||trader、
 *     createdAtMs=token_create、narrativeRating 火点快照静态注入），换键全条件重评，
 *     火点后找换门首放行点（晚进场成本）
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

const EXP = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8';
const MIN_TICK_BNB = 0.001;
const EXTEND_SEC = 300;

const COND_BUYV2 = '(tokenAgeSec < 90 OR tradeCount >= 25) AND marketCap > 4.7 AND marketCap < 27 AND (narrativeRating == 2 OR narrativeRating == 3) AND holderTrendSlope > 0 AND top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20 AND famousCopyWalletCircPct < 15 AND (buyVolumeBnb >= 1.25 AND holdersExDust >= 10) AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40) AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10';
const COND_EARLY = '(narrativeRating == 2 OR narrativeRating == 3) AND tokenAgeSec < 600 AND marketCap > 6.0 AND marketCap < 6.7 AND (buyVolumeBnb >= 0.25 AND holdersExDust >= 5) AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40) AND top2HolderCircPct < 75 AND top1HolderCircPct < 45 AND maxCopyWalletHolderCircPct < 20 AND famousCopyWalletCircPct < 15 AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10';

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: trades } = await client.from('trades').select('*')
    .eq('experiment_id', EXP).order('created_at', { ascending: true });
  // 腿名：每票首条 buy signal 的 metadata.strategyName
  const { data: sigs } = await client.from('strategy_signals').select('token_address,action,metadata,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true });
  const legOf = new Map();
  for (const s of (sigs || [])) {
    if (s.action === 'buy' && !legOf.has(s.token_address)) legOf.set(s.token_address, s.metadata?.strategyName);
  }
  const perToken = new Map();
  for (const t of (trades || [])) {
    if (!perToken.has(t.token_address)) perToken.set(t.token_address, { buys: [], sells: [] });
    const e = perToken.get(t.token_address);
    (t.trade_direction === 'buy' ? e.buys : e.sells).push(t);
  }
  const evaluator = new ConditionEvaluator();
  const logger = { info() {}, warn() {}, error() {} };
  const CONDS = { '买入策略 P1·首买': COND_BUYV2, '买入策略 P2': COND_EARLY };
  // roster 异步 loader（重放校准坑：不 await 则 maxCopyWalletHolderCircPct 恒 null 拦死）
  await FourMemeFactorAggregator.loadCopyWalletRoster();
  await FourMemeFactorAggregator.loadFamousCopyWallets();

  const targets = [];
  for (const [tok, e] of perToken) {
    const buyBnb = e.buys.reduce((a, t) => a + Number(t.input_amount || 0), 0);
    const sellBnb = e.sells.reduce((a, t) => a + (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0), 0);
    const fb = e.buys[0];
    const f = fb.metadata?.factors?.trendFactors || {};
    targets.push({
      token: tok, sym: fb.token_symbol, leg: legOf.get(tok), pnl: +(sellBnb - buyBnb).toFixed(6),
      execAt: Date.parse(fb.executed_at),
      snap: { age: f.tokenAgeSec, dp: f.holderTrendDataPoints, slope: f.holderTrendSlope, rating: f.narrativeRating, price: f.currentPrice },
    });
  }

  for (const tg of targets) {
    const baseCond = CONDS[tg.leg];
    const exCond = baseCond ? baseCond.replace('holderTrendSlope > 0', 'holderTrendSlopeExSniper > 0') : null;
    const { data: ev } = await client.from('wss_events').select('block_time')
      .eq('token_address', tg.token).eq('kind', 'token_create').limit(1);
    const createMs = ev && ev[0] ? Date.parse(ev[0].block_time) : null;
    const until = new Date(tg.execAt + EXTEND_SEC * 1000).toISOString();
    const { data: ticks } = await client.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,price_bnb,price_usd,bnb_amount,token_amount,block_number,log_index,block_time,platform,quote_token')
      .eq('token_address', tg.token).lte('block_time', until)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true });
    const rows = (ticks || []).filter(r => (Number(r.bnb_amount) || 0) >= MIN_TICK_BNB);

    const fa = new FourMemeFactorAggregator({}, logger);
    // totalSupply 必传（flap 恒 1e9；缺 0 → marketCap/fdv 恒 0 拦死）；live collector 从 Created 事件带真值
    fa.registerToken(tg.token, { platform: 'flap', createdAtMs: createMs, totalSupply: 1e9 });
    FourMemeFactorAggregator.setNarrativeFactors(tg.token, { rating: tg.snap.rating });

    const trace = [];
    let distinctBlocks = 0, lastBlk = null;
    for (const r of rows) {
      const ts = Date.parse(r.block_time);
      fa.processTick({
        token_address: tg.token, trade_type: r.trade_type, trader_address: r.trader_address,
        sender_address: r.sender_address, price_bnb: r.price_bnb, price_usd: r.price_usd,
        bnb_amount: r.bnb_amount, token_amount: r.token_amount, block_number: r.block_number,
        log_index: r.log_index, timestamp: ts, platform: r.platform, quote_token: r.quote_token,
      }, { emitFactors: false });
      if (r.block_number !== lastBlk) { distinctBlocks++; lastBlk = r.block_number; }
      const f = fa.buildFactorMap(tg.token, ts);
      trace.push({
        ts, age: f.tokenAgeSec, dp: f.holderTrendDataPoints, slope: f.holderTrendSlope,
        dpEx: f.holderTrendDataPointsExSniper, slopeEx: f.holderTrendSlopeExSniper,
        price: f.currentPriceBnb,
        oldOk: baseCond ? evaluator.evaluate(baseCond, f) : null,
        exOk: exCond ? evaluator.evaluate(exCond, f) : null,
        blocks: distinctBlocks,
      });
    }
    // 火点=exec 前最后一 tick（链上真序态）
    let fi = -1;
    for (let i = 0; i < trace.length; i++) { if (trace[i].ts <= tg.execAt) fi = i; else break; }
    const fire = trace[fi];
    const calib = fire ? (fire.dp === tg.snap.dp && Math.abs((fire.slope ?? 0) - (tg.snap.slope ?? 0)) < 1e-9 ? 'CHAIN==LIVE'
      : `lag(live dp ${tg.snap.dp}/slope ${(+tg.snap.slope).toFixed(4)} vs chain dp ${fire.dp}/slope ${(+fire.slope).toFixed(4)})`) : 'NO_FIRE';
    // A) live 火点口径判定
    const dpExLive = Math.max(0, (tg.snap.dp ?? 0) - 4);
    const liveBlocked = tg.snap.dp <= 7 ? dpExLive < 4 : null; // dp=8 待链上口径
    // B) 换门后首放行（火点后，链上真序）
    let later = null;
    if (fire && exCond && !fire.exOk) {
      const j = trace.findIndex((p, k) => k > fi && p.exOk === true);
      if (j > 0) later = trace[j];
    }
    console.log(JSON.stringify({
      sym: tg.sym, tok: tg.token.slice(0, 10), leg: tg.leg, pnl: tg.pnl,
      snap: { age: tg.snap.age, dp: tg.snap.dp, slope: +(tg.snap.slope ?? 0).toFixed(4) }, calib,
      chainAtFire: fire && { age: +fire.age.toFixed(1), blocks: fire.blocks, dp: fire.dp, dpEx: fire.dpEx,
        slopeEx: fire.slopeEx === undefined ? null : +fire.slopeEx.toFixed(4), oldOk: fire.oldOk, exOk: fire.exOk },
      liveVerdict: tg.snap.dp <= 7 ? `拦(dpEx=${dpExLive}<4)` : (fire ? (fire.exOk ? '不拦(链上口径已可放行)' : '拦(链上口径)') : '?'),
      laterEntry: later && { delaySec: +((later.ts - fire.ts) / 1000).toFixed(1), age: +later.age.toFixed(1),
        priceChgPct: fire.price ? +(((later.price - fire.price) / fire.price) * 100).toFixed(1) : null },
      ticks: rows.length,
    }));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
