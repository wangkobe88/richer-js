// G2-only 拦截面重放：ladder v28 十四腿逐 tick 重放（引擎口径），找「仅被大户推迟门拦下」的时刻，
// 评估「庄已收工」豁免（60s 内大户∪零买单钱包卖出÷大户买入 ≥ 阈值）提前开门后的前向结局。
// 对照：60s 后自然触发（系统本来就会买）+ btv140/btv143 实际成交。182 跑。
'use strict';
const { dbManager } = require('../src/services/dbManager.js');

const FROM = process.argv[2] || '2026-11-04T00:00:00Z';
const TO = process.argv[3] || '2026-11-18T00:00:00Z';
const DUST = 0.001, HOLD_DUST = 0.015, BIG_LINE = 0.19, BIG_SUM = 1.0;
const ACT_WIN = 10000, WAVE_MS = 2000, REPLAY_MS = 60 * 1000, PULL_MS = 16 * 60 * 1000;
const FL_CONST = 6.14 / (107036752 + 1e9), FM_CONST = 4496173469e-18;
const THS = [0.2, 0.5, 0.8];
// 腿表（bt-v143 config 抄录；NL 三臂同形去重）
const LEGS = [
  { tag: 't0', tc: 6, bv: 1.0, hd: 4, pc: 28.5, age: true },
  { tag: 't1', tc: 9, bv: 1.0, hd: 6, pc: 28.5, age: true },
  { tag: 't2', tc: 12, bv: 1.0, hd: 6, pc: 28.5 },
  { tag: 't3', tc: 16, bv: 1.0, hd: 9, pc: 28.5 },
  { tag: 't4', tc: 20, bv: 1.2, hd: 12, pc: 28.5 },
  { tag: 't5', tc: 24, bv: 1.5, hd: 12, pc: 28.5 },
  { tag: 't6', tc: 30, bv: 1.5, hd: 12, pc: 28.5 },
  { tag: 't7', tc: 36, bv: 1.5, hd: 12, pc: 28.5 },
  { tag: 't8', tc: 45, bv: 1.5, hd: 12, pc: 28.5 },
  { tag: 'NL', tc: 15, bv: 2.5, hd: null, pc: 28.5 },
  { tag: 'RL15', tc: 15, bv: 2.5, hd: null, pc: 20 },
  { tag: 'RL10', tc: 15, bv: 2.5, hd: null, pc: 10 },
];
const EXPS = ['6e75ed6d-807a-4164-9551-d3b95d1fc37b', 'e5941591-df22-4434-ae29-1a93ced0f841']; // bt-v140 / bt-v143
const CONC = 10;

(async () => {
  const c = await dbManager.getClient();
  // 票池
  const tokens = []; let cursor = FROM;
  while (true) {
    const q = await c.from('wss_events').select('block_time,payload')
      .eq('kind', 'token_create').gte('block_time', cursor).lt('block_time', TO)
      .order('block_time', { ascending: true }).limit(500);
    if (q.error) throw q.error;
    for (const r of (q.data || [])) tokens.push({ create: r.block_time, addr: ((r.payload || {}).token || '').toLowerCase() });
    if ((q.data || []).length < 500) break;
    const nc = q.data[q.data.length - 1].block_time;
    if (nc === cursor) break; cursor = nc;
  }
  const byAddr = new Map();
  for (const t of tokens) if (t.addr && !byAddr.has(t.addr)) byAddr.set(t.addr, t);
  const pool = [...byAddr.values()];
  console.log(`票池=${pool.length}`);

  const hits = []; let done = 0;
  const work = async (t) => {
    const createMs = new Date(t.create).getTime();
    const q = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,sender_address,price_bnb,price_outlier,platform')
      .eq('token_address', t.addr)
      .gte('block_time', new Date(createMs - 1500).toISOString())
      .lte('block_time', new Date(createMs + PULL_MS).toISOString())
      .order('block_time', { ascending: true }).limit(8000);
    if (q.error) throw q.error;
    const rows = (q.data || []).filter(r => { const ms = new Date(r.block_time).getTime(); return ms >= createMs - 1 && r.bnb_amount != null; })
      .sort((a, b) => (a.block_time < b.block_time ? -1 : a.block_time > b.block_time ? 1 : (a.log_index || 0) - (b.log_index || 0)));
    if (!rows.length) return;
    let platform = rows.find(r => r.platform)?.platform;
    const CONST = platform === 'flap' ? FL_CONST : platform === 'fourmeme' ? FM_CONST : null;
    if (!CONST) return;

    // 状态
    let tc = 0, bv = 0, firstTradeMs = null, firstBuyRel = null, rollMin = null, lastRel = null, firstBlk = null;
    const buys = new Map(), netTok = new Map(), blkFirstTs = new Map(), firstBuyBlk = new Map(), blkCnt = new Map();
    let bigSold = 0, noBuySold = 0;
    const act = []; // [ms, bnb]
    const res = { addr: t.addr, platform, capped: rows.length >= 8000, g2only: null, entry: {}, natFire: null, fwd: {} };
    for (const th of THS) res.entry[th] = null;

    for (const r of rows) {
      const ms = new Date(r.block_time).getTime();
      const bnb = Number(r.bnb_amount);
      if (bnb < DUST) continue; // 尘 tick 不进因子
      const w = (r.sender_address || '').toLowerCase();
      const isBuy = r.trade_type === 'buy';
      if (firstTradeMs === null) { firstTradeMs = ms; firstBlk = r.block_number; }
      tc++; act.push([ms, bnb]);
      if (isBuy) { bv += bnb; buys.set(w, (buys.get(w) || 0) + bnb); netTok.set(w, (netTok.get(w) || 0) + Number(r.token_amount || 0)); }
      else {
        netTok.set(w, (netTok.get(w) || 0) - Number(r.token_amount || 0));
        if (!(buys.get(w) > 0)) noBuySold += bnb; else if (buys.get(w) >= BIG_LINE) bigSold += bnb;
      }
      if (blkFirstTs.get(r.block_number) === undefined) blkFirstTs.set(r.block_number, ms);
      // 首买块归属（T162 尘线：累计 ≥0.015 才计）
      if (isBuy && buys.get(w) >= HOLD_DUST && !firstBuyBlk.has(w)) {
        firstBuyBlk.set(w, r.block_number); blkCnt.set(r.block_number, (blkCnt.get(r.block_number) || 0) + 1);
      }
      // 可靠价链
      const rel = r.price_outlier === false && r.price_bnb != null;
      if (rel) {
        const p = Number(r.price_bnb);
        if (isBuy && firstBuyRel === null) firstBuyRel = p;
        rollMin = rollMin === null ? p : Math.min(rollMin, p);
        lastRel = p;
      }
      if (ms - createMs > REPLAY_MS + 1500) continue; // 60s 后不再找提前开门点，但继续为 natFire/fwd 重放
      // ---- 因子 ----
      const age = (ms - createMs) / 1000, sinceFirst = (ms - firstTradeMs) / 1000;
      while (act.length && act[0][0] < ms - ACT_WIN) act.shift();
      const actTotal = act.reduce((s, e) => s + e[1], 0);
      if (lastRel === null || firstBuyRel === null) continue;
      const floorCur = Math.min(CONST, firstBuyRel, rollMin);          // T134 现行地板（currentVsLaunch 分母）
      const floorT142 = Math.min(CONST, firstBuyRel);                  // launchMinVsFloorPct 分母（不含滚动最低）
      const curVs = (lastRel / floorCur - 1) * 100;
      const minVsFloor = (rollMin / floorT142 - 1) * 100;
      // 大户口径
      let bigSum = 0; for (const v of buys.values()) if (v >= BIG_LINE) bigSum += v;
      const ratioAll = bigSum > 0 ? (bigSold + noBuySold) / bigSum : 0;
      // G1
      let cluster = 0; for (const n of blkCnt.values()) if (n > cluster) cluster = n;
      let f0 = blkCnt.get(firstBlk) || 0;
      const fbTs = blkFirstTs.get(firstBlk);
      let wave = f0;
      if (fbTs !== undefined) for (const [blk, ts] of blkFirstTs) if (blk > firstBlk && ts - fbTs <= WAVE_MS && blkCnt.has(blk)) wave += blkCnt.get(blk);
      const g1 = (cluster < 3 && f0 < 2 && wave < 3) || (age > 60 && sinceFirst > 45) || minVsFloor < 0;
      const g2blocked = bigSum >= BIG_SUM && sinceFirst <= 60 && minVsFloor >= 0;
      // holdersExDust
      const holdLine = HOLD_DUST / firstBuyRel;
      let hd = 0; for (const v of netTok.values()) if (v >= holdLine) hd++;
      for (const leg of LEGS) {
        const base = tc >= leg.tc && bv >= leg.bv && actTotal >= 0.1 && g1 && (!leg.hd || hd >= leg.hd) && (!leg.age || age >= 15) && curVs <= leg.pc;
        if (!base) continue;
        if (!g2blocked) { if (!res.natFire) res.natFire = { ts: ms, iso: r.block_time, leg: leg.tag, price: lastRel, curVs: +curVs.toFixed(1) }; }
        else {
          if (!res.g2only) res.g2only = { ts: ms, iso: r.block_time, leg: leg.tag, price: lastRel, curVs: +curVs.toFixed(1), tc, bigSum: +bigSum.toFixed(2), ratioAll: +ratioAll.toFixed(2) };
          for (const th of THS) if (!res.entry[th] && ratioAll >= th) res.entry[th] = { ts: ms, iso: r.block_time, leg: leg.tag, price: lastRel, curVs: +curVs.toFixed(1), tc, ratioAll: +ratioAll.toFixed(2) };
        }
      }
    }
    // natFire 60s 后补扫（上面 continue 跳过了 60s 后的评估——重跑一遍简版）
    // 为省 IO：60s 后只在已有行内重放核心条件（重算）
    if (!res.natFire) {
      // 简版二扫：重置状态重放全窗，仅找 natFire
      let tc2 = 0, bv2 = 0, firstTradeMs2 = null, firstBuyRel2 = null, rollMin2 = null, lastRel2 = null, firstBlk2 = null;
      const buys2 = new Map(), netTok2 = new Map(), blkFirstTs2 = new Map(), firstBuyBlk2 = new Map(), blkCnt2 = new Map();
      const act2 = [];
      for (const r of rows) {
        const ms = new Date(r.block_time).getTime(); const bnb = Number(r.bnb_amount);
        if (bnb < DUST) continue;
        const w = (r.sender_address || '').toLowerCase(); const isBuy = r.trade_type === 'buy';
        if (firstTradeMs2 === null) { firstTradeMs2 = ms; firstBlk2 = r.block_number; }
        tc2++; act2.push([ms, bnb]);
        if (isBuy) { bv2 += bnb; buys2.set(w, (buys2.get(w) || 0) + bnb); netTok2.set(w, (netTok2.get(w) || 0) + Number(r.token_amount || 0)); }
        else netTok2.set(w, (netTok2.get(w) || 0) - Number(r.token_amount || 0));
        if (blkFirstTs2.get(r.block_number) === undefined) blkFirstTs2.set(r.block_number, ms);
        if (isBuy && buys2.get(w) >= HOLD_DUST && !firstBuyBlk2.has(w)) { firstBuyBlk2.set(w, r.block_number); blkCnt2.set(r.block_number, (blkCnt2.get(r.block_number) || 0) + 1); }
        const rel = r.price_outlier === false && r.price_bnb != null;
        if (rel) { const p = Number(r.price_bnb); if (isBuy && firstBuyRel2 === null) firstBuyRel2 = p; rollMin2 = rollMin2 === null ? p : Math.min(rollMin2, p); lastRel2 = p; }
        const age = (ms - createMs) / 1000, sinceFirst = (ms - (firstTradeMs2 ?? ms)) / 1000;
        if (sinceFirst <= 60.15) continue; // 只看 60s 后（60s 内上面已扫）
        if (lastRel2 === null || firstBuyRel2 === null) continue;
        while (act2.length && act2[0][0] < ms - ACT_WIN) act2.shift();
        const actTotal = act2.reduce((s, e) => s + e[1], 0);
        const floorCur = Math.min(CONST, firstBuyRel2, rollMin2);
        const floorT142 = Math.min(CONST, firstBuyRel2);
        const curVs = (lastRel2 / floorCur - 1) * 100;
        const minVsFloor = (rollMin2 / floorT142 - 1) * 100;
        let bigSum2 = 0; for (const v of buys2.values()) if (v >= BIG_LINE) bigSum2 += v;
        let cluster2 = 0; for (const n of blkCnt2.values()) if (n > cluster2) cluster2 = n;
        const f02 = blkCnt2.get(firstBlk2) || 0;
        const fbTs2 = blkFirstTs2.get(firstBlk2);
        let wave2 = f02;
        if (fbTs2 !== undefined) for (const [blk, ts] of blkFirstTs2) if (blk > firstBlk2 && ts - fbTs2 <= WAVE_MS && blkCnt2.has(blk)) wave2 += blkCnt2.get(blk);
        const g1 = (cluster2 < 3 && f02 < 2 && wave2 < 3) || (age > 60 && sinceFirst > 45) || minVsFloor < 0;
        const holdLine = HOLD_DUST / firstBuyRel2;
        let hd2 = 0; for (const v of netTok2.values()) if (v >= holdLine) hd2++;
        for (const leg of LEGS) {
          if (!(tc2 >= leg.tc && bv2 >= leg.bv && actTotal >= 0.1 && g1 && (!leg.hd || hd2 >= leg.hd) && (!leg.age || age >= 15) && curVs <= leg.pc)) continue;
          res.natFire = { ts: ms, iso: r.block_time, leg: leg.tag, price: lastRel2, curVs: +curVs.toFixed(1) }; break;
        }
        if (res.natFire) break;
      }
    }
    if (!res.g2only) return;
    // 前向（用同一批 rows）
    for (const th of THS) {
      const e = res.entry[th]; if (!e) continue;
      let max = e.price, last = e.price, min = e.price, l1 = null, l5 = null;
      for (const r of rows) {
        const ms = new Date(r.block_time).getTime();
        if (ms < e.ts || ms > e.ts + 15 * 60 * 1000) continue;
        if (r.price_outlier !== false || r.price_bnb == null) continue;
        const p = Number(r.price_bnb);
        if (p > max) max = p; if (p < min) min = p; last = p;
        if (l1 === null && ms - e.ts >= 60 * 1000) l1 = p;
        if (l5 === null && ms - e.ts >= 5 * 60 * 1000) l5 = p;
      }
      res.fwd[th] = { r1: l1 ? (l1 / e.price - 1) * 100 : null, r5: l5 ? (l5 / e.price - 1) * 100 : null, r15: (last / e.price - 1) * 100, max: (max / e.price - 1) * 100, min: (min / e.price - 1) * 100 };
    }
    hits.push(res);
  };
  const queue = [...pool];
  await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const t = queue.shift(); try { await work(t); } catch (e) { console.error('work err', t.addr, e.message); } done++; if (done % 1000 === 0) console.log(`重放 ${done}/${pool.length} G2-only=${hits.length}`); } }));
  console.log(`\nG2-only 拦截票=${hits.length}`);

  // 实验成交对照（btv140/143）
  const addrSet = new Set(hits.map(h => h.addr));
  const traded = new Map(); // addr -> {exp, iso, price}
  for (const exp of EXPS) {
    const list = [...addrSet];
    for (let i = 0; i < list.length; i += 100) {
      const q = await c.from('trades').select('token_address,created_at,trade_direction,executed_at,metadata')
        .eq('experiment_id', exp).in('token_address', list.slice(i, i + 100)).eq('trade_direction', 'buy')
        .order('created_at', { ascending: true }).limit(400);
      if (q.error) throw q.error;
      for (const r of (q.data || [])) { const k = r.token_address; if (!traded.has(k)) traded.set(k, { exp: exp.slice(0, 8), iso: r.created_at }); }
    }
  }
  for (const h of hits) h.traded = traded.get(h.addr) || null;

  require('fs').writeFileSync('/tmp/tmp-g2only-replay.json', JSON.stringify(hits, null, 1));
  console.log('已落 /tmp/tmp-g2only-replay.json');

  // 汇总
  const med = (a) => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const pct = (a, f) => { const s = a.filter(f); return a.length ? (s.length / a.length * 100).toFixed(0) : '0'; };
  for (const th of THS) {
    const es = hits.filter(h => h.entry[th]);
    const fw = es.map(h => h.fwd[th]);
    console.log(`\n== 豁免线 ${th * 100}%：可提前入场 ${es.length}/${hits.length} ==`);
    if (es.length) {
      console.log(`  +1min 中位 ${Number(med(fw.map(f => f.r1))).toFixed(1)}% / +5min ${Number(med(fw.map(f => f.r5))).toFixed(1)}% / +15min ${Number(med(fw.map(f => f.r15))).toFixed(1)}% / max15 中位 +${Number(med(fw.map(f => f.max))).toFixed(0)}%`);
      console.log(`  胜率: +5min>0 ${pct(fw, f => f.r5 > 0)}% / +15min>0 ${pct(fw, f => f.r15 > 0)}% / max15≥+50% ${pct(fw, f => f.max >= 50)}%`);
      const nat = es.filter(h => h.natFire).length, tr = es.filter(h => h.traded).length;
      console.log(`  其中: 60s 后自然触发 ${nat}（系统本来就会买）/ btv140/143 实际成交 ${tr}`);
    }
  }
  console.log('\nG2-only 票 top（按 80% 线 max15 排序）:');
  hits.filter(h => h.entry[0.8] && h.fwd[0.8]).sort((a, b) => b.fwd[0.8].max - a.fwd[0.8].max).slice(0, 12).forEach(h => {
    const e = h.entry[0.8], f = h.fwd[0.8];
    console.log(`  ${h.addr} ${h.platform} 拦截@${e.iso.slice(11, 19)} leg=${e.leg} tc=${e.tc} curVs=+${e.curVs} 出比=${e.ratioAll} → max+${f.max.toFixed(0)}% r5${f.r5 >= 0 ? '+' : ''}${f.r5?.toFixed(0) ?? '-'}% r15${f.r15 >= 0 ? '+' : ''}${f.r15.toFixed(0)}% natFire=${h.natFire ? h.natFire.iso.slice(11, 19) : '无'} traded=${h.traded ? h.traded.iso.slice(11, 19) : '无'}`);
  });
  console.log('\n80% 线 bottom8:');
  hits.filter(h => h.entry[0.8] && h.fwd[0.8]).sort((a, b) => a.fwd[0.8].max - b.fwd[0.8].max).slice(0, 8).forEach(h => {
    const e = h.entry[0.8], f = h.fwd[0.8];
    console.log(`  ${h.addr} ${h.platform} 拦截@${e.iso.slice(11, 19)} leg=${e.leg} tc=${e.tc} curVs=+${e.curVs} 出比=${e.ratioAll} → max+${f.max.toFixed(0)}% r15${f.r15.toFixed(0)}% natFire=${h.natFire ? '有' : '无'}`);
  });
  // 吉祥 sanity
  const jx = hits.find(h => h.addr === '0xea7886d590ba1d7d6d4e7761148ba26405c67777');
  console.log('\n吉祥 sanity:', jx ? JSON.stringify({ g2only: jx.g2only, entry80: jx.entry[0.8], fwd80: jx.fwd[0.8], natFire: jx.natFire, traded: jx.traded }) : '不在 G2-only 集');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
