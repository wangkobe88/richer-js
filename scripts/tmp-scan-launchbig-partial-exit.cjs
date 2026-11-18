// 实证扫描 v2：开盘大额买入后 60s 内「出一部分」→ 后续强庄 or 砸盘？
// v2 修正：①逐票查询（并发池）消灭批窗口串扰/行数帽丢行 ②0.5 线改「单钱包重仓」语义
// 口径：L019/L03 = 大户(单钱包累计>=线)合计买入 >=1B（T151 语义）；L05 = 单钱包累计 >=0.5B 即命中（重筹码）
// 组 A = 60s 内(大户∪零买单钱包)卖出/大户买入 >= 20%；组 B = 未出。锚=create+60s 末笔可靠价；结局=[锚,+30min]。182 跑。
'use strict';
const { dbManager } = require('../src/services/dbManager.js');

const FROM = process.argv[2] || '2026-11-04T00:00:00Z';
const TO = process.argv[3] || '2026-11-18T00:00:00Z';
const RULES = [
  { tag: 'L019', line: 0.19, hit: 'sum1' },
  { tag: 'L03', line: 0.3, hit: 'sum1' },
  { tag: 'L05', line: 0.5, hit: 'single' },
];
const BIG_SUM = 1.0;
const EXIT_RATIO = 0.20;
const WIN_MS = 90 * 1000, T60 = 60 * 1000, FWD = 30 * 60 * 1000;
const CONC = 10;

(async () => {
  const c = await dbManager.getClient();

  // 1) token_create 票池
  const tokens = [];
  let cursor = FROM;
  while (true) {
    const q = await c.from('wss_events').select('block_time,payload')
      .eq('kind', 'token_create').gte('block_time', cursor).lt('block_time', TO)
      .order('block_time', { ascending: true }).limit(500);
    if (q.error) throw q.error;
    for (const r of (q.data || [])) tokens.push({ create: r.block_time, addr: ((r.payload || {}).token || '').toLowerCase(), creator: ((r.payload || {}).creator || '').toLowerCase() });
    if ((q.data || []).length < 500) break;
    const nc = q.data[q.data.length - 1].block_time;
    if (nc === cursor) break;
    cursor = nc;
  }
  const byAddr = new Map();
  for (const t of tokens) if (t.addr && !byAddr.has(t.addr)) byAddr.set(t.addr, t);
  const pool = [...byAddr.values()];
  console.log(`票池=${pool.length}（${FROM} ~ ${TO}）`);

  // 2) 逐票出生窗重放（并发池）
  const groups = [];
  let done = 0;
  const work = async (t) => {
    const createMs = new Date(t.create).getTime();
    const q = await c.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,sender_address,price_bnb,price_outlier,platform')
      .eq('token_address', t.addr)
      .gte('block_time', new Date(createMs - 1500).toISOString())
      .lte('block_time', new Date(createMs + WIN_MS + 2000).toISOString())
      .limit(3000);
    if (q.error) throw q.error;
    const rows = (q.data || [])
      .filter(r => { const ms = new Date(r.block_time).getTime(); return ms >= createMs - 1 && ms <= createMs + WIN_MS + 2000; })
      .sort((a, b) => (a.block_time < b.block_time ? -1 : 1));
    if (!rows.length) return;
    const buys = new Map(); const sells60 = new Map();
    let noBuySold60 = 0, tickN = 0, buyN = 0, anchorPrice = null, platform = null, maxWallet = 0, capped = (q.data || []).length >= 3000;
    for (const r of rows) {
      tickN++;
      const in60 = new Date(r.block_time).getTime() - createMs <= T60 + 1500;
      const w = (r.sender_address || '').toLowerCase();
      if (r.trade_type === 'buy') {
        const nv = (buys.get(w) || 0) + Number(r.bnb_amount);
        buys.set(w, nv); if (nv > maxWallet) maxWallet = nv;
        if (in60) buyN++;
      } else if (in60) sells60.set(w, (sells60.get(w) || 0) + Number(r.bnb_amount));
      if (r.price_outlier === false && r.price_bnb != null && in60) anchorPrice = Number(r.price_bnb);
      platform = platform || r.platform;
    }
    for (const [w, v] of sells60) if (!buys.has(w)) noBuySold60 += v;
    let anyHit = false;
    const g = { addr: t.addr, createMs, platform, creator: t.creator, tickN, buyN, anchorPrice, maxWallet, capped, noBuySold60 };
    for (const { tag, line, hit } of RULES) {
      let bigSum = 0, bigSold60 = 0, bigN = 0, creatorBig = false;
      for (const [w, v] of buys) if (v >= line) { bigSum += v; bigN++; if (w === t.creator) creatorBig = true; }
      for (const [w, v] of sells60) if ((buys.get(w) || 0) >= line) bigSold60 += v;
      const isHit = hit === 'sum1' ? bigSum >= BIG_SUM : maxWallet >= line;
      const ratioSelf = bigSum > 0 ? bigSold60 / bigSum : 0;
      const ratioAll = bigSum > 0 ? (bigSold60 + noBuySold60) / bigSum : 0;
      g[tag] = { bigSum, bigN, bigSold60, creatorBig, ratioSelf, ratioAll, grp: isHit ? (ratioSelf >= EXIT_RATIO || ratioAll >= EXIT_RATIO ? 'A' : 'B') : null };
      if (isHit) anyHit = true;
    }
    if (anyHit) groups.push(g);
  };
  const queue = [...pool];
  await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const t = queue.shift(); try { await work(t); } catch (e) { console.error('work err', t.addr, e.message); } done++; if (done % 500 === 0) console.log(`筛选 ${done}/${pool.length} 命中 ${groups.length}`); } }));
  console.log(`\n命中=${groups.length}`);
  for (const { tag, line, hit } of RULES) {
    const A = groups.filter(g => g[tag].grp === 'A').length;
    const B = groups.filter(g => g[tag].grp === 'B').length;
    console.log(`  ${tag}(线${line},${hit === 'sum1' ? '合计>=1B' : '单钱包>=线'})：A=${A} B=${B}`);
  }

  // 3) 前向结局（并发池）
  const fq = [...groups]; let fdone = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (fq.length) {
      const g = fq.shift();
      try {
        const q = await c.from('wss_price_ticks')
          .select('block_time,price_bnb,price_outlier')
          .eq('token_address', g.addr)
          .gte('block_time', new Date(g.createMs + T60 - 1500).toISOString())
          .lte('block_time', new Date(g.createMs + T60 + FWD).toISOString())
          .limit(2000);
        if (q.error) throw q.error;
        const rows = (q.data || []).filter(r => r.price_outlier === false && r.price_bnb != null);
        if (!rows.length || !g.anchorPrice) { g.fwd = null; }
        else {
          const anchor = g.anchorPrice; let max = anchor, last = anchor, min = anchor;
          for (const r of rows) { const p = Number(r.price_bnb); if (p > max) max = p; if (p < min) min = p; last = p; }
          g.fwd = { maxRise: (max / anchor - 1) * 100, last: (last / anchor - 1) * 100, min: (min / anchor - 1) * 100, n: rows.length };
        }
      } catch (e) { g.fwd = null; console.error('fwd err', g.addr, e.message); }
      fdone++; if (fdone % 100 === 0) console.log(`前向 ${fdone}/${groups.length}`);
    }
  }));

  // 4) 落盘（先于一切打印）
  require('fs').writeFileSync('/tmp/tmp-launchbig-exit-scan.json', JSON.stringify(groups, null, 1));
  console.log('明细已落 /tmp/tmp-launchbig-exit-scan.json');

  // 5) 汇总
  const bucket = (f) => {
    if (!f) return '无前向数据';
    if (f.maxRise >= 100 && f.last >= 30) return '持续拉升';
    if (f.maxRise >= 100 && f.last <= 0) return '拉高出货';
    if (f.maxRise >= 100) return '拉升回落';
    if (f.last <= -30) return '砸盘阴跌';
    return '温和';
  };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  for (const { tag, line, hit } of RULES) {
    console.log(`\n======== ${tag} 大户线 ${line}B（${hit === 'sum1' ? '合计>=1B' : '单钱包>=0.5B'}）========`);
    for (const name of ['A', 'B']) {
      const set = groups.filter(g => g[tag].grp === name);
      if (!set.length) { console.log(`组 ${name}=0`); continue; }
      const dist = {}; for (const g of set) { const b = bucket(g.fwd); dist[b] = (dist[b] || 0) + 1; }
      const valid = set.filter(g => g.fwd);
      console.log(`组 ${name}（${set.length} 票）: ${JSON.stringify(dist)}`);
      if (valid.length) {
        console.log(`  maxRise30 中位 ${Number(med(valid.map(g => g.fwd.maxRise))).toFixed(0)}% / last30 中位 ${Number(med(valid.map(g => g.fwd.last))).toFixed(0)}% / min30 中位 ${Number(med(valid.map(g => g.fwd.min))).toFixed(0)}% / creator 在大户 ${set.filter(g => g[tag].creatorBig).length} / capped ${set.filter(g => g.capped).length}`);
        // 出比分层（A 组）
        if (name === 'A') for (const th of [0.5, 0.8]) {
          const s = valid.filter(g => g[tag].ratioAll >= th);
          if (s.length) console.log(`  A 组出比>=${th * 100}%（${s.length}）: last30 中位 ${Number(med(s.map(g => g.fwd.last))).toFixed(0)}%, 持续拉升 ${s.filter(g => bucket(g.fwd) === '持续拉升').length}`);
        }
      }
    }
    const Av = groups.filter(g => g[tag].grp === 'A' && g.fwd).sort((a, b) => b.fwd.maxRise - a.fwd.maxRise);
    const show = g => `${g.addr} ${g.platform || '?'} 大户${g[tag].bigN}户=${g[tag].bigSum.toFixed(2)}B${g[tag].creatorBig ? '(含cr)' : ''} 出${(g[tag].ratioSelf * 100).toFixed(0)}/${(g[tag].ratioAll * 100).toFixed(0)}% → max+${g.fwd.maxRise.toFixed(0)} last${g.fwd.last >= 0 ? '+' : ''}${g.fwd.last.toFixed(0)} [${bucket(g.fwd)}]`;
    console.log('组 A top8:'); Av.slice(0, 8).forEach(g => console.log('  ' + show(g)));
    console.log('组 A bottom8:'); Av.slice(-8).forEach(g => console.log('  ' + show(g)));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
