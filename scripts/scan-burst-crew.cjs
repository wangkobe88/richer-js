#!/usr/bin/env node
// 批量发现「burst pull 团伙」（0x37d9 案立法 2026-11-18,用户裁定「看看有没有一个办法,能批量的发现」）
// 形状蓝本=0x37d9:静默→同秒/近块多钱包涌入(等额镜像)→分钟级集体清仓→砸落死盘。
//
// 两个模式:
//   --mirror        秒级:读 copy-trade-pairs.json.gz,完美镜像对(even/co≥0.9 ∧ co≥20)连通分量=团伙候选
//   (缺省=全量)     182 跑:wss_price_ticks keyset 全表(DAYS 窗)→ per token 判 burst pull 事件 → 钱包计数/共现聚簇
//   --from-events   复用事件缓存(data/offline-cache/burst-crew-events.json.gz)零网络调参
// 事件判据(全部满足):
//   ①涌入:5s 滑窗内 ≥MIN_WALLETS 个不同非路由钱包买入,单钱包合计 ≥DUST(0.01)
//   ②组织性(其一):等额对(toFixed(3) 相等 ≥2 钱包) ∨ 同块 ≥3 钱包
//   ③非开盘自然涌入(其一):窗前 gap ≥STALL(15s) ∨ 窗首行票龄 ≥TICKET_AGE(120s)——开盘段归 ladder G1~G4
//   ④出货确认(其一):+EXIT(180s) 内参与钱包卖出 ≥2 钱包 ∨ 卖额 ≥60% 涌入额
// 输出:候选团伙(成员/事件数/代表票/等额率/名单对照)——**不自动入库,用户裁定后收录 crew 名单**
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { dbManager } = require('../src/services/dbManager');

const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const argv = process.argv;
const R = p => path.join(__dirname, '..', p);
const lc = s => (s || '').toLowerCase();

// ── 参数(判据全部可调,调参走 --from-events)──
const DAYS = argOf('--days', 45);
const MIN_WALLETS = argOf('--min-wallets', 3);
const DUST = argOf('--dust', 0.01);
const STALL = argOf('--stall', 15);
const TICKET_AGE = argOf('--ticket-age', 120);
const EXIT = argOf('--exit', 180);
const MIN_EVENTS = argOf('--min-events', 3);        // 钱包入候选门槛
const MIN_CO_EVENTS = argOf('--min-co-events', 3);  // 共现连边门槛
const PAGE = 1000;
const MIN_TICK_BNB = 0.001;

const EVENTS_CACHE = R('data/offline-cache/burst-crew-events.json.gz');
const AGG = new Set([...require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS].map(lc));
const crew = JSON.parse(fs.readFileSync(R('config/rosters/cheat-crew-wallets.json'), 'utf8'));
const CREW = new Set(crew.wallets.map(w => lc(typeof w === 'string' ? w : w.address)));
const syb = JSON.parse(fs.readFileSync(R('config/rosters/sybil-clusters.json'), 'utf8'));
const SYBIL = new Map();
for (const c of (syb.clusters || [])) for (const w of (c.wallets || c.members || [])) SYBIL.set(lc(w), 'c' + c.id);
const smartRaw = JSON.parse(fs.readFileSync(R('data/kol-study/smartmoney-accum.json'), 'utf8'));
const SMART = new Set(Object.keys(smartRaw.sources.smartmoney || {}).map(lc));

function tag(w) {
  const t = [];
  if (CREW.has(w)) t.push('🏴crew');
  if (SYBIL.has(w)) t.push('sybil:' + SYBIL.get(w));
  if (SMART.has(w)) t.push('🧠');
  return t.join(' ');
}

// ── 模式 --mirror:pair 缓存完美镜像团伙 ──
function mirrorMode() {
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(R('data/offline-cache/copy-trade-pairs.json.gz'))).toString('utf8'));
  console.log(`[mirror] pair 缓存 co≥20 ∧ even/co≥0.9 的完美镜像对 → 连通分量`);
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const ensure = w => { if (!parent.has(w)) parent.set(w, w); };
  let edgeN = 0;
  for (const p of parsed.pairs) {
    const [a, b] = p.k.split('|');
    if (!a || !b) continue;
    if (p.co >= 20 && p.even / p.co >= 0.9) { ensure(a); ensure(b); uni(a, b); edgeN++; }
  }
  const comps = new Map();
  for (const w of parent.keys()) {
    const r = find(w);
    if (!comps.has(r)) comps.set(r, new Set());
    comps.get(r).add(w);
  }
  const list = [...comps.values()].map(ws => ({ ws: [...ws] })).filter(c => c.ws.length >= 2);
  list.sort((a, b) => b.ws.length - a.ws.length);
  console.log(`[mirror] 镜像边 ${edgeN} 条 → 团伙 ${list.length} 个:\n`);
  for (const c of list.slice(0, 30)) {
    const inCrew = c.ws.filter(w => CREW.has(w)).length;
    console.log(`◆ 团伙 ${c.ws.length} 钱包（crew 已收录 ${inCrew}）`);
    for (const w of c.ws) console.log(`    ${w} ${tag(w)}`);
  }
  console.log('\n[mirror done] 以上为「等额镜像」证据团伙(未验证 burst 事件形状);全量事件验证跑缺省模式');
}

// ── 全表拉取(照抄 scan-copy-trade-clusters 形状)──
async function fetchAll() {
  const sinceMs = Date.now() - DAYS * 86400e3;
  const sinceIso = new Date(sinceMs).toISOString();
  const COLS = 'id, token_address, trade_type, trader_address, sender_address, bnb_amount, block_number, block_time';
  const fetchPage = (lastId, withTime) => {
    let q = dbManager.getClient().from('wss_price_ticks').select(COLS).gt('id', lastId)
      .order('id', { ascending: true }).limit(PAGE);
    if (withTime) q = q.gte('block_time', sinceIso);
    return q;
  };
  let withTime = true;
  try {
    const probe = await Promise.race([fetchPage(0, true), new Promise((_, rej) => setTimeout(() => rej(new Error('shape-probe-timeout')), 30000))]);
    if (probe.error) throw new Error(probe.error.message);
  } catch (e) { console.log(`[形状] gte(block_time) 不可用(${e.message})退全表`); withTime = false; }
  const byToken = new Map();
  let lastId = 0, pages = 0, fetchTotal = 0;
  const t0 = Date.now();
  for (;;) {
    const r = await fetchPage(lastId, withTime);
    if (r.error) throw r.error;
    const data = r.data || [];
    for (const row of data) {
      const bnb = Number(row.bnb_amount);
      if (!(bnb >= MIN_TICK_BNB)) continue;
      if (!withTime && !(new Date(row.block_time).getTime() >= sinceMs)) continue;
      const w = lc(row.sender_address) || lc(row.trader_address);
      if (!w) continue;
      const t = lc(row.token_address);
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push({ w, t, buy: row.trade_type === 'buy', bnb, blk: row.block_number, dt: new Date(row.block_time).getTime(), rted: AGG.has(lc(row.trader_address)) });
    }
    pages++; fetchTotal += data.length;
    lastId = data[data.length - 1].id;
    if (pages % 500 === 0) console.log(`[拉取] ${fetchTotal} 行(${byToken.size} 票),${((Date.now() - t0) / 60000).toFixed(1)}min`);
    if (data.length < PAGE) break;
  }
  console.log(`[拉取] 完成:DB ${fetchTotal} 行 → ${byToken.size} 票(${((Date.now() - t0) / 60000).toFixed(1)}min)`);
  return byToken;
}

// ── per token 事件判定 ──
function detectEvents(rows) {
  rows.sort((a, b) => a.dt - b.dt || a.blk - b.blk);
  const t0 = rows[0].dt;
  const events = [];
  let i = 0;
  while (i < rows.length) {
    if (!rows[i].buy || rows[i].rted) { i++; continue; }
    // 5s 滑窗收集买入
    let j = i;
    const win = [];
    while (j < rows.length && rows[j].dt - rows[i].dt <= 5000) {
      if (rows[j].buy && !rows[j].rted) win.push(rows[j]);
      j++;
    }
    const perW = new Map();
    for (const r of win) {
      if (!perW.has(r.w)) perW.set(r.w, { bnb: 0, n: 0, blk: new Set(), first: r });
      const e = perW.get(r.w);
      e.bnb += r.bnb; e.n++; e.blk.add(r.blk);
    }
    const wallets = [...perW.entries()].filter(([, e]) => e.bnb >= DUST);
    if (wallets.length >= MIN_WALLETS) {
      // ② 组织性
      const byAmt = new Map();
      for (const [w, e] of wallets) { const k = e.bnb.toFixed(3); if (!byAmt.has(k)) byAmt.set(k, []); byAmt.get(k).push(w); }
      const equalPairs = [...byAmt.values()].filter(ws => ws.length >= 2);
      const blocks = new Map();
      for (const [w, e] of wallets) for (const b of e.blk) blocks.set(b, (blocks.get(b) || 0) + 1);
      const sameBlock3 = [...blocks.values()].some(n => n >= 3);
      // ③ 非开盘
      const preGap = i > 0 ? (rows[i].dt - rows[i - 1].dt) / 1000 : Infinity;
      const ticketAge = (rows[i].dt - t0) / 1000;
      const notLaunch = preGap >= STALL || ticketAge >= TICKET_AGE;
      if ((equalPairs.length || sameBlock3) && notLaunch) {
        const ws = wallets.map(([w]) => w);
        const inBnb = wallets.reduce((s, [, e]) => s + e.bnb, 0);
        // ④ 出货确认:+EXIT 内参与钱包卖出
        const exitEnd = rows[i].dt + EXIT * 1000;
        const sellers = new Set();
        let outBnb = 0;
        for (let k = j; k < rows.length && rows[k].dt <= exitEnd; k++) {
          if (!rows[k].buy && ws.includes(rows[k].w)) { sellers.add(rows[k].w); outBnb += rows[k].bnb; }
        }
        if (sellers.size >= 2 || outBnb >= 0.6 * inBnb) {
          events.push({ dt: rows[i].dt, token: rows[0].t, wallets: ws, inBnb: +inBnb.toFixed(3), outBnb: +outBnb.toFixed(3),
            sellers: sellers.size, equal: equalPairs.length > 0, sameBlock3, preGap: +preGap.toFixed(1), ticketAge: +ticketAge.toFixed(0) });
        }
      }
    }
    i = j > i ? j : i + 1; // 跳过已评窗(重叠窗合并;未合格窗也推进——i..j 内无合格起点)
  }
  return events;
}

// ── 聚合:候选钱包+团伙连通分量 ──
function aggregate(events) {
  const wCount = new Map();
  const pairCo = new Map();
  for (const ev of events) {
    for (const w of ev.wallets) wCount.set(w, (wCount.get(w) || 0) + 1);
    for (let a = 0; a < ev.wallets.length; a++) for (let b = a + 1; b < ev.wallets.length; b++) {
      const k = ev.wallets[a] < ev.wallets[b] ? ev.wallets[a] + '|' + ev.wallets[b] : ev.wallets[b] + '|' + ev.wallets[a];
      pairCo.set(k, (pairCo.get(k) || 0) + 1);
    }
  }
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [k, n] of pairCo) {
    if (n < MIN_CO_EVENTS) continue;
    const [a, b] = k.split('|');
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    uni(a, b);
  }
  const comps = new Map();
  for (const w of parent.keys()) {
    const r = find(w);
    if (!comps.has(r)) comps.set(r, new Set());
    comps.get(r).add(w);
  }
  return { wCount, pairCo, comps: [...comps.values()].map(ws => [...ws]) };
}

async function main() {
  if (argv.includes('--mirror')) return mirrorMode();
  let events;
  if (argv.includes('--from-events')) {
    const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(EVENTS_CACHE)).toString('utf8'));
    events = parsed.events;
    console.log(`[events 缓存] ${events.length} 事件(params=${JSON.stringify(parsed.params)})`);
  } else {
    const byToken = await fetchAll();
    events = [];
    for (const [t, rows] of byToken) {
      const evs = detectEvents(rows);
      if (evs.length) events.push(...evs);
    }
    console.log(`[事件] ${events.length} 起(参数 wallets≥${MIN_WALLETS}/dust≥${DUST}/stall≥${STALL}/age≥${TICKET_AGE}/exit≤${EXIT}s)`);
    fs.mkdirSync(path.dirname(EVENTS_CACHE), { recursive: true });
    fs.writeFileSync(EVENTS_CACHE, zlib.gzipSync(JSON.stringify({ params: { days: DAYS, MIN_WALLETS, DUST, STALL, TICKET_AGE, EXIT }, events })));
    console.log(`[dump] ${EVENTS_CACHE}`);
  }
  const { wCount, pairCo, comps } = aggregate(events);
  const cand = [...wCount.entries()].filter(([, n]) => n >= MIN_EVENTS);
  console.log(`\n══ 候选钱包(事件数 ≥${MIN_EVENTS}) ${cand.length} 个 ══`);
  cand.sort((a, b) => b[1] - a[1]);
  for (const [w, n] of cand.slice(0, 60)) {
    const evs = events.filter(e => e.wallets.includes(w));
    const eq = evs.filter(e => e.equal).length;
    console.log(`  ${w} 事件${n}(等额${eq}) ${tag(w)} 近票 ${evs.slice(-2).map(e => e.token.slice(0, 10) + '@' + new Date(e.dt).toISOString().slice(5, 16)).join(' ')}`);
  }
  comps.sort((a, b) => b.length - a.length);
  const candSet = new Set(cand.map(([w]) => w));
  console.log(`\n══ 候选团伙(共现 ≥${MIN_CO_EVENTS} 连边,成员含 ≥1 候选钱包) ${comps.length} 个 ══`);
  for (const c of comps.slice(0, 25)) {
    const hit = c.filter(w => candSet.has(w));
    if (!hit.length) continue;
    const inCrew = c.filter(w => CREW.has(w)).length;
    console.log(`\n◆ 团伙 ${c.length} 钱包(候选 ${hit.length}/crew 已收 ${inCrew})`);
    for (const w of c.slice(0, 15)) {
      const n = wCount.get(w) || 0;
      console.log(`    ${w} 事件${n} ${tag(w)}`);
    }
  }
  console.log('\n[done] 以上候选经用户裁定后收录 cheat-crew-wallets.json(只收 pull 角色)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
