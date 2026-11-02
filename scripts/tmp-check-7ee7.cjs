const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '5298b7bd-8374-458d-b9e3-c5fe581e681d';
const TOKEN = '0x7ee7812e8b8de9c0d3411933216ef2004a627777';
const DUST_BNB = 0.015;

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  const { data: trades } = await client.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  console.log('trades:', (trades || []).length);
  for (const t of (trades || [])) {
    console.log(' ', t.created_at, t.trade_direction, 'in:', t.input_amount, 'out:', t.output_amount, 'success:', t.success);
  }
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,signal_type,action,executed,reason,metadata').eq('experiment_id', EXP)
    .eq('token_address', TOKEN).order('created_at');
  console.log('\nsignals:', (sigs || []).length);
  for (const s of (sigs || [])) {
    console.log(' ', s.created_at, s.signal_type, s.action, 'exec:', s.executed, '| reason:', (s.reason || '').slice(0, 120),
      '| gmgn:', s.metadata?.gmgnCheck ? JSON.stringify(s.metadata.gmgnCheck).slice(0, 200) : '');
  }
  const { data: rounds } = await client.from('narrative_analysis_rounds')
    .select('round_no,trigger_reason,rating,started_at,completed_at,from_cache,error')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('started_at');
  console.log('\nnarrative rounds:', (rounds || []).length);
  for (const r of (rounds || [])) console.log(' ', r.started_at, '→', r.completed_at, 'r', r.round_no, r.trigger_reason, 'rating:', r.rating, 'cached:', r.from_cache, 'err:', r.error);

  const { data: create } = await client.from('wss_events')
    .select('block_time,payload').eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  const payload = create?.[0]?.payload || {};
  console.log('\ntoken_create:', create?.[0]?.block_time, JSON.stringify({ name: payload.name, symbol: payload.symbol, creator: payload.creator, totalSupply: payload.totalSupply, taxToken: payload.taxToken, platform: payload.platform }));

  // ── 逐 tick 门重建（P1·首买 + P2 early 双门并行走查）──
  const { data: ticks, error } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount')
    .eq('token_address', TOKEN).order('block_time', { ascending: true });
  if (error) { console.error('ticks err:', error.message); process.exit(1); }
  console.log('\nticks:', ticks.length);
  const SUPPLY = Number(payload.totalSupply) > 0 ? Number(payload.totalSupply) : 1e9;

  const firstPrice = ticks[0].price_bnb;
  const net = new Map();
  let cumBuyBnb = 0, circ = 0;
  const t0 = new Date(ticks[0].block_time).getTime();
  let prevTag = null, firstP1 = null, firstP2 = null;
  const narrativeReadyMs = rounds?.length ? new Date(rounds[0].completed_at).getTime() : t0;

  for (let i = 0; i < ticks.length; i++) {
    const tk = ticks[i];
    const isBuy = tk.trade_type === 'buy';
    const toks = tk.token_amount != null ? Number(tk.token_amount) : tk.bnb_amount / tk.price_bnb;
    const w = (tk.sender_address || tk.trader_address || '').toLowerCase();
    net.set(w, (net.get(w) || 0) + (isBuy ? toks : -toks));
    if (isBuy) { cumBuyBnb += tk.bnb_amount; circ += toks; } else { circ -= toks; }
    let posSum = 0, arr = [];
    for (const [, v] of net) if (v > 0) { posSum += v; arr.push(v); }
    arr.sort((a, b) => b - a);
    const den = Math.max(circ, posSum);
    const top1 = den > 0 ? arr[0] / den * 100 : null;
    const top2 = den > 0 ? (arr[0] + (arr[1] || 0)) / den * 100 : null;
    let exDust = 0;
    for (const [, v] of net) if (v * firstPrice >= DUST_BNB) exDust++;
    const mcap = tk.price_bnb * SUPPLY;
    const ts = new Date(tk.block_time).getTime();
    const age = (ts - t0) / 1000;
    const ratingOk = ts >= narrativeReadyMs;

    // P1·首买：narrativeRating 2|3 用 ratingOk 代替（round1 rating 见上）
    const p1 = {
      ageOrTrades: age < 90 || (i + 1) >= 25,
      mcapLo: mcap > 4.7, mcapHi: mcap < 27,
      rating: ratingOk, vol: cumBuyBnb >= 1.25, holders: exDust >= 10,
      top2: top2 !== null && top2 < 55, top1: top1 !== null && top1 < 35,
    };
    // P2 early（buyPhase null）：mcap 带 (6.0,6.7) + vol>=0.25 + exDust>=5 + top1<45/top2<75
    const p2 = {
      mcapLo: mcap > 6.0, mcapHi: mcap < 6.7, rating: ratingOk,
      vol: cumBuyBnb >= 0.25, holders: exDust >= 5,
      top1: top1 !== null && top1 < 45, top2: top2 !== null && top2 < 75,
    };
    const p1Fail = Object.entries(p1).filter(([, v]) => !v).map(([k]) => k);
    const p2Fail = Object.entries(p2).filter(([, v]) => !v).map(([k]) => k);
    const tag = `P1:[${p1Fail.join(',') || 'PASS'}] P2:[${p2Fail.join(',') || 'PASS'}]`;
    if (tag !== prevTag || age < 30 || age % 60 < 2) {
      console.log(`t+${age.toFixed(0).padStart(3)}s ${tk.block_time.slice(11, 19)} ${isBuy ? 'B' : 'S'} px=${(tk.price_bnb * 1e9).toFixed(2)}e-9 mcap=${(mcap).toFixed(2)} vol=${cumBuyBnb.toFixed(3)} exDust=${exDust} top1=${top1 === null ? '-' : top1.toFixed(1)} top2=${top2 === null ? '-' : top2.toFixed(1)} | ${tag}`);
      prevTag = tag;
    }
    if (!p1Fail.length && !firstP1) firstP1 = tk.block_time;
    if (!p2Fail.length && !firstP2) firstP2 = tk.block_time;
    if (age > 600) break;
  }
  console.log('\nP1·首买 全门首过:', firstP1, '| P2 early 全门首过:', firstP2);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
