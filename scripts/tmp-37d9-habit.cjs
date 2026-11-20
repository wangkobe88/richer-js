#!/usr/bin/env node
// 0x37d9 团伙习惯性验证(182 跑,纯本地文件分析)
// 1) pair 缓存:burst 簇钱包两两共现边 + sybil cluster 2/3/18 内部边
// 2) 扫 win-20261012(36h)fourmeme tick 缓存:目标钱包窗口内全部行为 → 团伙作案清单
// 3) 同款形状判定:首买前 ≥30s 静默 ∧ 团伙首买聚集 ≤10s
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const R = p => path.join(__dirname, '..', p);
const lc = s => (s || '').toLowerCase();

// 本票(burst 案发现场)钱包
const BURST_WALLETS = [
  '0x9d41e99374e4bceebb4c0bd070e814e72b7e7ace', '0xd80bf2b4d8158b21da727c3a510284a5f73747c3',
  '0xf7a934528d38e2f2865a7cd30c335c6d115928b8', '0xf90026d86fb41f02a2be73345a8904d0b003ff6d',
  '0x9a213971f8749e087c6f8d5f5d1daabef0e14191', '0xc8c2c361142fda8a8ee5a807972fbfa9eb4f5a51',
  '0xa44039d10d4883a7353ee729a48fda88fa5d2333', '0xfe8e1feec2a91ab2f33f6798049a9ebadb222938',
];
const SMART_W = ['0xbca42062068ee20056bae8534d78afc4ddcaefa9'];           // PrettifunLOVE
const FLASH_W = ['0xdfb69be14b', '0xabd85574e2'];                          // 开盘快闪(短前缀,前缀匹配)
const TOKEN_CASE = '0x37d93f71fde73ce25aff86bdfb63c8b56f957777';

const syb = JSON.parse(fs.readFileSync(R('config/rosters/sybil-clusters.json'), 'utf8'));
const CL = {};
for (const c of (syb.clusters || [])) CL['c' + (c.id ?? '?')] = (c.wallets || c.members || []).map(lc);
const clusterOf = new Map();
for (const [cid, ws] of Object.entries(CL)) for (const w of ws) clusterOf.set(w, cid);

const TARGETS = new Set(BURST_WALLETS.map(lc).concat(SMART_W.map(lc)));
for (const w of clusterOf.keys()) if ([2, 3, 18].includes(Number((clusterOf.get(w) || '').slice(1)))) TARGETS.add(w);

function short(w) { return w.slice(0, 10); }
function tagOf(w) {
  const t = [];
  if (clusterOf.has(w)) t.push(clusterOf.get(w));
  if (SMART_W.includes(w)) t.push('🧠smart');
  if (BURST_WALLETS.map(lc).includes(w)) t.push('BURST');
  return t.join('/');
}

// ── 1) pair 缓存 ──
function pairAnalysis() {
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(R('data/offline-cache/copy-trade-pairs.json.gz'))).toString('utf8'));
  console.log(`[pair 缓存] meta.days=${parsed.meta.days} pairs=${parsed.pairs.length} 生成=${parsed.meta.generatedAt || '?'}`);
  const wstat = parsed.meta.wallets || {};
  console.log('\n== 目标钱包活跃度(meta.wallets,days 窗口) ==');
  for (const w of TARGETS) {
    const s = wstat[w];
    console.log(`  ${w} ${tagOf(w)} tokens=${s ? s.tokens : 0} buys=${s ? s.buys : 0} sells=${s ? s.sells : 0}`);
  }
  const pm = new Map();
  for (const p of parsed.pairs) pm.set(p.k, p);
  console.log('\n== 目标钱包两两 pair 边(co=共同首买票数 sellSync=同步清仓 even=等额镜像) ==');
  const tl = [...TARGETS];
  for (let i = 0; i < tl.length; i++) for (let j = i + 1; j < tl.length; j++) {
    const k = tl[i] < tl[j] ? tl[i] + '|' + tl[j] : tl[j] + '|' + tl[i];
    const e = pm.get(k);
    if (e && e.co >= 3) console.log(`  ${short(tl[i])}(${tagOf(tl[i])}) × ${short(tl[j])}(${tagOf(tl[j])}) co=${e.co} sellSync=${e.sellSync} even=${e.even} laterA=${e.laterA} laterB=${e.laterB}`);
  }
  // cluster 2 内部全员 top 边
  console.log('\n== sybil cluster 2 内部最强 pair 边 top15 ==');
  const c2 = CL['c2'] || [];
  const edges = [];
  for (let i = 0; i < c2.length; i++) for (let j = i + 1; j < c2.length; j++) {
    const k = c2[i] < c2[j] ? c2[i] + '|' + c2[j] : c2[j] + '|' + c2[i];
    const e = pm.get(k);
    if (e) edges.push({ a: c2[i], b: c2[j], ...e });
  }
  edges.sort((x, y) => y.co - x.co);
  for (const e of edges.slice(0, 15)) console.log(`  ${short(e.a)}×${short(e.b)} co=${e.co} sellSync=${e.sellSync} even=${e.even}`);
}

// ── 2) 窗口缓存扫描 ──
async function scanCache() {
  const files = [['fourmeme.jsonl.gz'], ['flap.jsonl.gz']];
  const perToken = new Map(); // token -> {rows: [], targetBuys: [{w,dt,blk,bnb}], targetSells: [...]}
  for (const [f] of files) {
    const fp = R('data/tick-cache/backtest/win-20261012t000000000z_20261013t120000000z/' + f);
    if (!fs.existsSync(fp)) { console.log('skip', f); continue; }
    const rl = readline.createInterface({ input: fs.createReadStream(fp).pipe(zlib.createGunzip()) });
    let n = 0;
    for await (const line of rl) {
      n++;
      if (n % 500000 === 0) console.log(`  [scan] ${f} ${n} 行`);
      let r; try { r = JSON.parse(line); } catch { continue; }
      const w = lc(r.sender_address) || lc(r.trader_address);
      const isTarget = TARGETS.has(w) || FLASH_W.some(p => w.startsWith(p));
      if (!isTarget) continue;
      const t = lc(r.token_address);
      if (!perToken.has(t)) perToken.set(t, { rows: [], tgt: [] });
      const e = perToken.get(t);
      e.rows.push(r); // 该票上目标钱包的行(买卖都收)
    }
    console.log(`[scan] ${f} 完成 ${n} 行`);
  }
  // 第二遍:需要全票行来判静默 → 只对目标票再扫一次收集上下文
  const hitTokens = [...perToken.entries()].filter(([, e]) => e.rows.some(r => r.trade_type === 'buy')).map(([t]) => t);
  console.log(`\n[hit] 目标钱包买入过的 token ${hitTokens.length} 个(含本票)`);
  // 对这些票拉全行判形状
  const allRows = new Map(); // token -> all rows(只有 hit 票)
  const hitSet = new Set(hitTokens);
  for (const [f] of files) {
    const fp = R('data/tick-cache/backtest/win-20261012t000000000z_20261013t120000000z/' + f);
    if (!fs.existsSync(fp)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp).pipe(zlib.createGunzip()) });
    for await (const line of rl) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      const t = lc(r.token_address);
      if (!hitSet.has(t)) continue;
      if (!allRows.has(t)) allRows.set(t, []);
      allRows.get(t).push(r);
    }
  }
  for (const t of hitTokens) {
    const rows = allRows.get(t) || [];
    rows.sort((a, b) => (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
    rows.forEach(r => { r.dt = Date.parse(r.block_time); r.wallet = lc(r.sender_address) || lc(r.trader_address); });
  }
  // 报告
  const fmt = ms => new Date(ms).toISOString().slice(5, 19);
  console.log('\n== 团伙窗口作案清单(win 10-12 00:00→10-13 12:00) ==');
  const out = [];
  for (const t of hitTokens) {
    const rows = allRows.get(t) || [];
    const tBuys = rows.filter(r => r.trade_type === 'buy' && (TARGETS.has(r.wallet) || FLASH_W.some(p => r.wallet.startsWith(p))));
    const uniqW = [...new Set(tBuys.map(r => r.wallet))];
    if (!uniqW.length) continue;
    const firsts = uniqW.map(w => tBuys.find(r => r.wallet === w)).sort((a, b) => a.dt - b.dt);
    const span = (firsts[firsts.length - 1].dt - firsts[0].dt) / 1000;
    const buyBnb = tBuys.reduce((s, r) => s + +r.bnb_amount, 0);
    // 首买前静默
    const i0 = rows.findIndex(r => r === firsts[0]);
    let preGap = i0 > 0 ? (firsts[0].dt - rows[i0 - 1].dt) / 1000 : 0;
    // 同步卖:目标钱包卖出块聚集
    const tSells = rows.filter(r => r.trade_type === 'sell' && TARGETS.has(r.wallet));
    const sellBlocks = tSells.map(r => r.block_number);
    const syncSell = sellBlocks.length ? (Math.max(...sellBlocks) - Math.min(...sellBlocks) <= 5) : false;
    const lastDt = rows[rows.length - 1] ? rows[rows.length - 1].dt : 0;
    // 票终价 vs 首买价(砸落形状)
    const firstPrice = +firsts[0].price_bnb, lastPrice = rows[rows.length - 1] ? +rows[rows.length - 1].price_bnb : null;
    const shape = (preGap >= 30 && span <= 10) ? '静默→聚集涌入' : (span <= 10 ? '聚集涌入(无前置静默)' : '散布');
    out.push({ t, nW: uniqW.length, span, preGap, buyBnb, shape, syncSell, firsts, rows, lastDt, firstPrice, lastPrice });
  }
  out.sort((a, b) => b.nW - a.nW);
  for (const o of out) {
    const isCase = o.t === TOKEN_CASE;
    console.log(`\n${isCase ? '★' : ' '} ${o.t} 目标${o.nW}钱包 首买聚集${o.span.toFixed(1)}s 前置静默${o.preGap.toFixed(0)}s 买入${o.buyBnb.toFixed(3)}B 形状=${o.shape}${o.syncSell ? ' 同步卖✓' : ''}${o.lastPrice && o.firstPrice ? ` 价格 ${(o.lastPrice / o.firstPrice).toFixed(2)}x` : ''}`);
    for (const f of o.firsts.slice(0, 8)) console.log(`    ${fmt(f.dt)} ${f.wallet.slice(0, 12)} ${(+f.bnb_amount).toFixed(4)}B ${tagOf(f.wallet)}`);
    // 后续卖出节奏(首买后 5 分钟内目标钱包卖出)
    const postSells = o.rows.filter(r => r.trade_type === 'sell' && TARGETS.has(r.wallet) && r.dt >= o.firsts[0].dt && r.dt <= o.firsts[0].dt + 300e3);
    if (postSells.length) {
      const sb = postSells.reduce((s, r) => s + +r.bnb_amount, 0);
      console.log(`    → 首买后5min内目标卖 ${postSells.length}笔 ${sb.toFixed(3)}B 首卖+${((postSells[0].dt - o.firsts[0].dt) / 1000).toFixed(0)}s`);
    }
  }
  console.log('\n[done]');
}

(async () => {
  pairAnalysis();
  await scanCache();
})().catch(e => { console.error(e); process.exit(1); });
