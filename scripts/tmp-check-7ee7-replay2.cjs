const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const EXP = '5298b7bd-8374-458d-b9e3-c5fe581e681d';
const TOKEN = '0x7ee7812e8b8de9c0d3411933216ef2004a627777';

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const famous = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  const famousSet = new Set((famous.wallets || []).map((w) => String(w).toLowerCase()));
  const roster = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/copy-wallet-roster.json'), 'utf8'));
  const copySet = new Set((roster.wallets || []).map((e) => String(e.address || e).toLowerCase()));
  console.log('famous wallets:', famousSet.size, '| copy roster:', copySet.size);

  const roundsQ = () => client.from('narrative_analysis_rounds')
    .select('completed_at,rating').eq('experiment_id', EXP).eq('token_address', TOKEN).order('started_at');
  let rounds = null;

  let ticks = null;
  for (let attempt = 0; attempt < 6 && !(ticks && ticks.length); attempt++) {
    const r = await client.from('wss_price_ticks')
      .select('block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount')
      .eq('token_address', TOKEN).order('block_time', { ascending: true }).range(0, 440);
    if (attempt === 0) console.log('raw resp keys:', Object.keys(r), 'status:', r.status, 'count:', r.count, 'dataType:', typeof r.data, Array.isArray(r.data) ? 'arr' : '');
    if (r.error) { console.error('ticks err:', JSON.stringify(r.error).slice(0, 300)); process.exit(1); }
    ticks = r.data || [];
    if (!ticks.length) console.log(`attempt ${attempt + 1}: 0 rows, retry...`);
  }
  if (!ticks || !ticks.length) { console.error('ticks 6 次重试仍空'); process.exit(1); }
  const rq = await roundsQ();
  rounds = rq.data || [];
  console.log('rounds query:', rounds.length, rq.error ? JSON.stringify(rq.error).slice(0, 150) : '');
  const ratingReadyMs = rounds?.length ? new Date(rounds[0].completed_at).getTime() : Infinity;

  // FA firstPrice = 首可靠价（fire 快照 4.1602e-9）；尘门常量 T = 0.015/firstPrice
  const FA_FIRST = 0.000004160183710813846;
  const DUST_T = 0.015 / FA_FIRST;

  const net = new Map();
  let cumBuyBnb = 0, circ = 0;
  const ring = []; // {isBuy, bnb} 最近 N 笔
  const holderBuckets = new Map(); // bucket -> holderCount snapshot
  const t0 = new Date(ticks[0].block_time).getTime();
  let prevTag = null;
  let firstAll = null;

  const slope = (pts) => { // 最小二乘斜率（HolderTrendDetector 近似：>0 即升）
    const n = pts.length; if (n < 4) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += pts[i]; sxy += i * pts[i]; sxx += i * i; }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  };

  for (let i = 0; i < ticks.length; i++) {
    const tk = ticks[i];
    const isBuy = tk.trade_type === 'buy';
    const bnb = tk.bnb_amount;
    const toks = tk.token_amount != null ? Number(tk.token_amount) : bnb / tk.price_bnb;
    const w = (tk.sender_address || tk.trader_address || '').toLowerCase();
    net.set(w, (net.get(w) || 0) + (isBuy ? toks : -toks));
    if (isBuy) { cumBuyBnb += bnb; circ += toks; } else { circ -= toks; }
    ring.push({ isBuy, bnb });
    if (ring.length > 120) ring.shift();

    // holder 桶序列（blockNumber÷8；缺 block_number 退化为时间 6s 桶）
    const bucket = tk.block_number != null ? Math.floor(tk.block_number / 8) : Math.floor((new Date(tk.block_time).getTime() - t0) / 6000);
    let holderCnt = 0, posSum = 0; const arr = [];
    for (const [, v] of net) if (v > 0) { holderCnt++; posSum += v; arr.push([, v]); }
    holderBuckets.set(bucket, holderCnt);
    const series = [...holderBuckets.values()].slice(-8);

    const den = Math.max(circ, posSum);
    arr.sort((a, b) => b[1] - a[1]);
    const top1 = den > 0 ? arr[0][1] / den * 100 : null;
    const top2 = den > 0 ? (arr[0][1] + (arr[1] ? arr[1][1] : 0)) / den * 100 : null;
    let exDust = 0;
    for (const [, v] of net) if (v >= DUST_T) exDust++;
    let famousPct = 0, copyPct = 0;
    for (const [k2, v] of net) {
      if (v <= 0) continue;
      const pct = v / den * 100;
      if (famousSet.has(k2) && pct > famousPct) famousPct = pct;
      if (copySet.has(k2) && pct > copyPct) copyPct = pct;
    }
    // 净买窗
    const win = (n) => {
      const w2 = ring.slice(-n);
      let b = 0, s = 0; for (const e of w2) { if (e.isBuy) b += e.bnb; else s += e.bnb; }
      return (b + s) > 0 ? (b - s) / (b + s) * 100 : null;
    };
    const shortWin = win(20), longWin = win(100);
    const mcap = tk.price_bnb * 1e9;
    const ts = new Date(tk.block_time).getTime();
    const age = (ts - t0) / 1000;
    const hSlope = slope(series);

    const gates = {
      rating: ts >= ratingReadyMs,
      vol: cumBuyBnb >= 1.25,
      holders: exDust >= 10,
      top1: top1 !== null && top1 < 35,
      top2: top2 !== null && top2 < 55,
      famous: famousPct < 15,
      copy: copyPct < 20,
      shortWin: shortWin !== null && shortWin >= 40,
      longWin: longWin !== null && longWin >= 0,
      hSlope: hSlope !== null && hSlope > 0,
      mcap: mcap > 4.7 && mcap < 27,
    };
    const fail = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
    const tag = fail.join(',') || 'ALL-PASS';
    if (tag !== prevTag || age < 45) {
      console.log(`t+${age.toFixed(0).padStart(3)}s ${tk.block_time.slice(11, 19)} ${isBuy ? 'B' : 'S'} ${bnb.toFixed(3)} mcap=${mcap.toFixed(1)} vol=${cumBuyBnb.toFixed(2)} exD=${exDust} top1=${top1.toFixed(1)} fam=${famousPct.toFixed(1)} copy=${copyPct.toFixed(1)} SW=${shortWin === null ? '-' : shortWin.toFixed(0)} LW=${longWin === null ? '-' : longWin.toFixed(0)} sl=${hSlope === null ? '-' : (hSlope > 0 ? '+' : '-')} pts=${series.length} | ${tag}`);
      prevTag = tag;
    }
    if (!fail.length && !firstAll) firstAll = tk.block_time;
    if (age > 75) break;
  }
  console.log('\n全门（含净买窗/famous/slope）首过 tick:', firstAll, '| 实际 BUY fire: 12:58:21.8');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
