const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '5298b7bd-8374-458d-b9e3-c5fe581e681d';
const TOKEN = '0x7dd2a5251abd97f2059db318a0b9851786617777';
const DUST_BNB = 0.015; // T98 尘门默认

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  // 1) BUY 信号 fire 快照
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .eq('signal_type', 'BUY').order('created_at');
  for (const s of (sigs || [])) {
    const fa = s.metadata?.factorResults || s.metadata?.factors || {};
    console.log('=== BUY fire', s.created_at, '===');
    const keys = ['currentPriceBnb','marketCap','buyVolumeBnb','holdersExDust','holderCount','top1HolderCircPct','top2HolderCircPct','maxCopyWalletHolderCircPct','famousCopyWalletCircPct','tradesNetBuyRatioLongWin','tradesNetBuyRatioShortWin','tradesNetBuyShortWinBnb','holderTrendSlope','drawdownFromHighest','crashSpeedPctPerSec','tokenAgeSec','tradeCount','narrativeRating','buyWallets'];
    for (const k of keys) if (fa[k] !== undefined) console.log(' ', k, '=', fa[k]);
  }

  // 2) 全量 tick 重建
  const { data: ticks, error } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount')
    .eq('token_address', TOKEN).order('block_time', { ascending: true });
  if (error) { console.error('ticks err:', error.message); process.exit(1); }
  console.log('\nticks:', ticks.length);

  const firstPrice = ticks[0].price_bnb;
  const net = new Map(); // wallet -> tokens
  let cumBuyBnb = 0, circ = 0;
  const t0 = new Date(ticks[0].block_time).getTime();
  let prevPass = null;
  let firstAllPass = null;

  const fmt = (v) => v === undefined ? 'undef' : (typeof v === 'number' ? +v.toFixed(2) : v);
  for (let i = 0; i < ticks.length; i++) {
    const tk = ticks[i];
    const isBuy = tk.trade_type === 'buy';
    const toks = tk.token_amount != null ? Number(tk.token_amount)
      : tk.bnb_amount / tk.price_bnb;
    const w = (tk.sender_address || tk.trader_address || '').toLowerCase();
    net.set(w, (net.get(w) || 0) + (isBuy ? toks : -toks));
    if (isBuy) { cumBuyBnb += tk.bnb_amount; circ += toks; } else { circ -= toks; }

    // 因子
    let posSum = 0, arr = [];
    for (const [k2, v2] of net) if (v2 > 0) { posSum += v2; arr.push(v2); }
    arr.sort((a, b) => b - a);
    const den = Math.max(circ, posSum);
    const top1 = den > 0 ? arr[0] / den * 100 : null;
    const top2 = den > 0 ? (arr[0] + (arr[1] || 0)) / den * 100 : null;
    let exDust = 0;
    for (const [, v2] of net) if (v2 * firstPrice >= DUST_BNB) exDust++;
    const mcap = tk.price_bnb * 1e9;
    const age = (new Date(tk.block_time).getTime() - t0) / 1000;

    // P1·首买门（narrativeRating 13:01:46 已=3；GMGN fail-open 放行）
    const gates = {
      ageOrTrades: age < 90 || (i + 1) >= 25,
      mcapLo: mcap > 4.7,
      mcapHi: mcap < 27,
      vol: cumBuyBnb >= 1.25,
      holders: exDust >= 10,
      top2: top2 !== null && top2 < 55,
      top1: top1 !== null && top1 < 35,
    };
    const allPass = Object.values(gates).every(Boolean);
    const failed = Object.entries(gates).filter(([, v]) => !v).map(([k2]) => k2);
    const tag = failed.length ? failed.join(',') : 'ALL-PASS';
    if (tag !== prevPass || allPass) {
      console.log(`t+${age.toFixed(0).padStart(3)}s ${tk.block_time.slice(11,19)} ${isBuy ? 'B' : 'S'} px=${(tk.price_bnb * 1e9).toFixed(2)}e-9 mcap=${mcap.toFixed(2)} vol=${cumBuyBnb.toFixed(3)} exDust=${exDust} top1=${top1 === null ? '-' : top1.toFixed(1)} top2=${top2 === null ? '-' : top2.toFixed(1)} | 未过: ${tag}`);
      prevPass = tag;
    }
    if (allPass && !firstAllPass) firstAllPass = tk.block_time;
    if (allPass && age > 300) break; // 买入在 163s，300s 足够
  }
  console.log('\n首笔全门通过 tick:', firstAllPass, '（实际买入 13:04:26）');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
