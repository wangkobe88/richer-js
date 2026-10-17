#!/usr/bin/env node
/**
 * Agentum 案跟进分析（182 跑，重查询红线）
 * Part A：同宣告多盘（creator / IPFS meta cid 聚类）× 我们买入盈亏——判别力验证
 * Part B：project 类市值地板 5500 回放——「正常项目不可能太便宜」假设验证
 * 零写库，纯读。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const FLOOR_MC = 5500;

async function pageAll(db, table, cols, extra, pageSize = 1000) {
  // keyset 分页（order id + gt cursor），防 max-rows 静默截断
  const out = [];
  let cursor = 0, round = 0;
  for (;;) {
    let q = db.from(table).select(cols).order('id', { ascending: true }).gt('id', cursor).limit(pageSize);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} page ${round}: ${error.message}`);
    if (!data.length) break;
    out.push(...data);
    cursor = data[data.length - 1].id;
    round++;
    if (round % 50 === 0) console.log(`  [page] ${table} ${out.length} rows...`);
    if (data.length < pageSize) break;
  }
  return out;
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }
function sum(a) { return a.reduce((x, y) => x + y, 0); }
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function bucketStats(rows, label) {
  const rets = rows.map(r => r.ret).filter(v => Number.isFinite(v));
  if (!rets.length) { console.log(`${label}: 0 票`); return; }
  const win = rets.filter(r => r > 0).length;
  console.log(`${label}: n=${rets.length} 平均=${pct(sum(rets) / rets.length)} 中位=${pct(median(rets))} 胜率=${win}/${rets.length}(${pct(win / rets.length)}) 净BNB=${rows.filter(r => Number.isFinite(r.ret)).reduce((x, r) => x + r.pnl, 0).toFixed(3)}`);
}

async function main() {
  const db = dbManager.getClient();
  const t0 = Date.now();

  // ===== 1. 我们买过的票 + 盈亏（全实验，成功行）=====
  console.log('== 拉取 trades ==');
  const trades = await pageAll(db, 'trades', 'id,experiment_id,token_address,token_symbol,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,executed_at', q => q.eq('trade_status', 'success'));
  console.log('trades rows:', trades.length);
  const byToken = new Map(); // token -> {buyBnb, sellBnb, symbol, firstBuyAt}
  for (const t of trades) {
    const e = byToken.get(t.token_address) || { buyBnb: 0, sellBnb: 0, symbol: t.token_symbol, firstBuyAt: t.executed_at };
    const inCur = t.input_currency, outCur = t.output_currency;
    if (t.trade_direction === 'buy' && inCur === 'BNB') e.buyBnb += Number(t.input_amount) || 0;
    if (t.trade_direction === 'sell' && outCur === 'BNB') e.sellBnb += Number(t.output_amount) || 0;
    if (t.executed_at && (!e.firstBuyAt || t.executed_at < e.firstBuyAt)) e.firstBuyAt = t.executed_at;
    byToken.set(t.token_address, e);
  }
  const bought = [...byToken.entries()].filter(([, e]) => e.buyBnb > 0).map(([addr, e]) => ({
    addr, ...e, ret: e.buyBnb > 0 ? e.sellBnb / e.buyBnb - 1 : NaN, pnl: e.sellBnb - e.buyBnb,
  }));
  console.log('买过的 token:', bought.length);
  const boughtSet = new Set(bought.map(b => b.addr));
  const boughtMap = new Map(bought.map(b => [b.addr, b]));

  // ===== 2. token_create 全史聚类 =====
  console.log('== 拉取 token_create（keyset 分页）==');
  const creatorGroups = new Map(); // creator -> {n, times:[]}
  const metaGroups = new Map();    // meta cid -> {n, times:[], tokens:[]}(只记少量)
  const tokenCreator = new Map();  // token -> creator
  const tokenMeta = new Map();     // token -> meta
  let total = 0, nullCreator = 0;
  {
    let cursor = 0;
    for (;;) {
      const { data, error } = await db.from('wss_events')
        .select('id,token_address,block_time,payload->>creator,payload->>meta')
        .order('id', { ascending: true }).gt('id', cursor).limit(1000)
        .eq('kind', 'token_create');
      if (error) throw new Error('token_create: ' + error.message);
      if (!data.length) break;
      for (const r of data) {
        total++;
        const ts = new Date(r.block_time).getTime();
        const c = r.creator;
        if (!c) { nullCreator++; continue; }
        const g = creatorGroups.get(c) || { n: 0, times: [] };
        g.n++; g.times.push(ts);
        creatorGroups.set(c, g);
        if (boughtSet.has(r.token_address)) {
          tokenCreator.set(r.token_address, c);
          const bg = creatorGroups.get('__bought__' + c) || { n: 0, times: [] };
          bg.n++; bg.times.push(ts);
          creatorGroups.set('__bought__' + c, bg);
        }
        const m = r.meta;
        if (m) {
          const mg = metaGroups.get(m) || { n: 0, times: [], tokens: [] };
          mg.n++; mg.times.push(ts);
          if (mg.tokens.length < 8) mg.tokens.push(r.token_address);
          metaGroups.set(m, mg);
          if (boughtSet.has(r.token_address)) tokenMeta.set(r.token_address, m);
        }
      }
      cursor = data[data.length - 1].id;
      if (total % 50000 < 1000) console.log(`  token_create ${total} rows... (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      if (data.length < 1000) break;
    }
  }
  console.log(`token_create 总数=${total}（null creator=${nullCreator}），不同 creator=${[...creatorGroups.keys()].filter(k => !k.startsWith('__bought__')).length}，不同 meta cid=${metaGroups.size}`);
  const creatorsN = [...creatorGroups.entries()].filter(([k]) => !k.startsWith('__bought__'));
  const dist = {};
  for (const [, g] of creatorsN) { const b = g.n === 1 ? '1' : g.n <= 3 ? '2-3' : g.n <= 10 ? '4-10' : '10+'; dist[b] = (dist[b] || 0) + 1; }
  console.log('creator 发盘数分布:', JSON.stringify(dist));
  const multiCreatorGroups = creatorsN.filter(([, g]) => g.n >= 2);
  const tokensInMulti = new Set();
  for (const [c, g] of multiCreatorGroups) {
    for (const t of g.times) tokensInMulti.add(c + t); // 粗略计数占位
  }
  const metaMulti = [...metaGroups.entries()].filter(([, g]) => g.n >= 2);
  console.log(`多盘 creator 组(≥2)=${multiCreatorGroups.length}；共用 meta cid 组(≥2)=${metaMulti.length}（复制盘）`);

  // ===== 3. 我们买过的票按组盘数分桶 =====
  // creator 维度
  const rowsCreator = bought.map(b => {
    const c = tokenCreator.get(b.addr);
    if (!c) return { ...b, grp: 0 };
    const g = creatorGroups.get(c);
    return { ...b, grp: g ? g.n : 1 };
  });
  console.log('\n== Part A1：按 creator 发盘数分桶（我们的买入盈亏）==');
  for (const [label, lo, hi] of [['creator=1 盘', 1, 1], ['creator 2-3 盘', 2, 3], ['creator 4+ 盘', 4, 1e9]]) {
    bucketStats(rowsCreator.filter(r => r.grp >= lo && r.grp <= hi && r.grp > 0), label);
  }
  bucketStats(rowsCreator.filter(r => r.grp === 0), 'creator 未知（早于采集/删除）');

  // meta cid 维度
  const rowsMeta = bought.map(b => {
    const m = tokenMeta.get(b.addr);
    if (!m) return { ...b, grp: 0 };
    const g = metaGroups.get(m);
    return { ...b, grp: g ? g.n : 1 };
  });
  console.log('\n== Part A2：按 IPFS meta cid 共用数分桶（复制盘维度）==');
  bucketStats(rowsMeta.filter(r => r.grp === 1), '独占 cid');
  bucketStats(rowsMeta.filter(r => r.grp >= 2), '共用 cid(≥2 复制盘)');
  bucketStats(rowsMeta.filter(r => r.grp === 0), 'cid 未知');

  // 短窗矩阵：同 creator 且我们买的盘 ±1h 内有另一盘
  console.log('\n== Part A3：同 creator 1h 短窗矩阵（本案形状）==');
  const shortWindowRows = [];
  for (const b of bought) {
    const c = tokenCreator.get(b.addr);
    if (!c) continue;
    const g = creatorGroups.get(c);
    if (!g || g.n < 2) continue;
    // 找与「我们买入 token 创建时刻」同窗的其他盘——times 是该 creator 全部盘
    // 买票的创建时刻未知（只存了组 times），改用 firstBuyAt 近似 ±2h
    const fb = new Date(b.firstBuyAt).getTime();
    const near = g.times.filter(t => Math.abs(t - fb) < 2 * 3600 * 1000).length;
    if (near >= 2) shortWindowRows.push({ ...b, near });
  }
  bucketStats(shortWindowRows, '2h 窗内同 creator ≥2 盘');
  if (shortWindowRows.length) {
    for (const r of shortWindowRows.slice(0, 15)) console.log(`  ${r.symbol} ${r.addr.slice(0, 10)} near=${r.near} ret=${pct(r.ret)} pnl=${r.pnl.toFixed(4)}`);
  }

  // ===== Part B：project 5500 地板回放 =====
  console.log('\n== Part B：project 市值地板回放 ==');
  const tokens = [...boughtSet];
  const catMap = new Map();
  for (let i = 0; i < tokens.length; i += 50) {
    const batch = tokens.slice(i, i + 50);
    const { data, error } = await db.from('token_narrative').select('token_address,token_category,numeric_rating').in('token_address', batch);
    if (error) throw new Error('token_narrative: ' + error.message);
    for (const r of data || []) catMap.set(r.token_address, r);
  }
  const projectTokens = tokens.filter(a => catMap.get(a)?.token_category === 'project');
  console.log('买过的票里有叙事分类的:', catMap.size, '；project:', projectTokens.length);
  // 对照分布：各类 mcap 是否曾破 5500（用买信号 mcap + ticks 最低价近似）
  // 拉 buy signals 的 fire mcap/price（供 supply 推导）
  const sigInfo = new Map();
  for (let i = 0; i < tokens.length; i += 50) {
    const batch = tokens.slice(i, i + 50);
    const { data, error } = await db.from('strategy_signals')
      .select('id,token_address,created_at,metadata->>price,metadata->trendFactors->>marketCap')
      .in('token_address', batch).order('created_at', { ascending: true }).limit(1000);
    if (error) throw new Error('signals: ' + error.message);
    for (const r of data || []) {
      if (!sigInfo.has(r.token_address) && r.marketCap && r.price) sigInfo.set(r.token_address, { mcap0: Number(r.marketCap), price0: Number(r.price), at: r.created_at });
    }
  }
  console.log('有 fire mcap/price 锚的票:', sigInfo.size);

  const results = [];
  for (const addr of projectTokens) {
    const b = boughtMap.get(addr);
    const si = sigInfo.get(addr);
    if (!si || !si.mcap0 || !si.price0) { results.push({ addr, sym: b.symbol, skip: 'no-anchor' }); continue; }
    const supply = si.mcap0 / si.price0;
    // ticks：买入时刻起（id keyset 分页拉该 token 全 ticks）
    let cursor = 0; const ticks = [];
    for (;;) {
      const { data, error } = await db.from('wss_price_ticks')
        .select('id,block_time,price_bnb,price_usd,bnb_amount,trade_type')
        .eq('token_address', addr).order('id', { ascending: true }).gt('id', cursor).limit(1000);
      if (error) throw new Error('ticks: ' + error.message);
      if (!data.length) break;
      ticks.push(...data); cursor = data[data.length - 1].id;
      if (data.length < 1000 || ticks.length > 50000) break;
    }
    const buyTs = new Date(b.firstBuyAt).getTime();
    // 买价锚（USD）：用 supply 反推的口径一致——price_usd 优先，缺则 price_bnb*usd
    const after = ticks.filter(t => new Date(t.block_time).getTime() >= buyTs);
    if (!after.length) { results.push({ addr, sym: b.symbol, skip: 'no-ticks' }); continue; }
    // 实际买价：trade unit_price 无法从聚合推，用首个 tick 后 price 近似——用 buyBnb 锚的 ret 对照
    let breakTick = null;
    for (const t of after) {
      const ts = new Date(t.block_time).getTime();
      if (ts - buyTs < 10000) continue; // realHoldDuration>10
      const usd = Number(t.price_usd) || (Number(t.price_bnb) || 0) * 700;
      if (usd * supply < FLOOR_MC) { breakTick = t; break; }
    }
    results.push({
      addr, sym: b.symbol, mcap0: Math.round(si.mcap0), actualRet: b.ret, pnl: b.pnl,
      brokeAt: breakTick ? breakTick.block_time : null,
      breakUsd: breakTick ? Number(breakTick.price_usd) : null,
      ticksN: after.length,
    });
  }
  const valid = results.filter(r => !r.skip);
  const neverBroke = valid.filter(r => !r.brokeAt);
  const broke = valid.filter(r => r.brokeAt);
  console.log(`\nproject 票回放：有效=${valid.length} 从未破${FLOOR_MC}=${neverBroke.length} 曾破=${broke.length}`);
  for (const r of broke) {
    console.log(`  [破线] ${r.sym} ${r.addr.slice(0, 10)} fireMcap=${r.mcap0} 破于${r.brokeAt} 实际ret=${Number.isFinite(r.actualRet) ? pct(r.actualRet) : '?'} pnl=${r.pnl.toFixed(4)}`);
  }
  for (const r of neverBroke.slice(0, 20)) {
    console.log(`  [未破] ${r.sym} ${r.addr.slice(0, 10)} fireMcap=${r.mcap0} 实际ret=${Number.isFinite(r.actualRet) ? pct(r.actualRet) : '?'} pnl=${r.pnl.toFixed(4)}`);
  }
  const brokeRet = broke.map(r => r.actualRet).filter(Number.isFinite);
  const neverRet = neverBroke.map(r => r.actualRet).filter(Number.isFinite);
  if (brokeRet.length) console.log(`曾破组: n=${brokeRet.length} 平均=${pct(sum(brokeRet) / brokeRet.length)} 胜率=${brokeRet.filter(x => x > 0).length}/${brokeRet.length}`);
  if (neverRet.length) console.log(`未破组: n=${neverRet.length} 平均=${pct(sum(neverRet) / neverRet.length)} 胜率=${neverRet.filter(x => x > 0).length}/${neverRet.length}`);

  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
