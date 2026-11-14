// 一次性深挖（182 跑）：c84a 12:31:38 crash 判定归因 + v101 entry_shape=crash 误伤面扫描。
//   Part1  c84a v101 全部 BUY 信号（生产判读 + metadata anchors 若存）
//   Part2  12:31:38 锚：原始 ticks 还原（120s 逐 10s 买卖结构 + 45s 逐 5s 价格段 +
//          recentDip5 段定位）+ buildBuyPointSnapshot 直调全锚 dump
//   Part3  fresh gateBuyPoint ×3（entry_shape 判读稳定性）
//   Part4  --scan：v101 全部 entry_shape=crash 的 BUY 信号锚 → recentDip5 段深分布
//          （深段 ≤-18 =真暴跌余波 vs 段浅未收复深 =累计阴跌域）+ 前向 3min 最大涨幅
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');

const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc'; // bt-v101
const C84A = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const ANCHOR_AT = process.env.ANCHOR_AT || '12:31:38';
const logger = { info() {}, warn() {}, error() {} };
const SCAN = process.argv.includes('--scan');
const f2 = (n) => (n == null ? '?' : (+n).toFixed(2));
const f4 = (n) => (n == null ? '?' : (+n).toFixed(4));

async function main() {
  const client = await dbManager.getClient();

  // ── Part 1：c84a v101 信号全景 ──
  const { data: sigs } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', V101).eq('signal_type', 'BUY')
    .eq('token_address', C84A).order('created_at', { ascending: true }).limit(60);
  console.log(`== Part1 c84a v101 BUY 信号 ${(sigs || []).length} 行 ==`);
  let anchorRow = null;
  for (const s of sigs || []) {
    const bp = s.metadata && s.metadata.buyPoint;
    const e = (bp && bp.dimensions && bp.dimensions.entry_shape) || {};
    const p = (bp && bp.dimensions && bp.dimensions.market_pattern) || {};
    const a = (bp && bp.assessment) || {};
    const an = (bp && bp.anchors) || null;
    console.log(`${s.created_at.slice(11, 19)} 综=${a.bucket}(${a.rule}) entry=${e.bucket}(${f2(e.prob)}) pat=${p.bucket}` +
      (an ? ` 段=${f2(an.recentDip5Pct)}@${an.recentDip5SecAgo}s 未收复=${f2(an.recentDip5UnrecoveredPct)} chg5=${f2(an.chg5Pct)}` : ' (metadata无anchors)'));
    if (s.created_at.slice(11, 19) === ANCHOR_AT) anchorRow = s;
  }
  if (!anchorRow) anchorRow = (sigs || []).filter((s) => s.metadata && s.metadata.buyPoint).pop() || (sigs || []).pop();
  const anchorMs = Date.parse(anchorRow.created_at);
  console.log(`深挖锚=${anchorRow.created_at}`);

  // tokenMeta（platform 从 experiment_tokens）
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', C84A);
  const p0 = (creates && creates[0] && creates[0].payload) || {};
  const { data: et } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', V101).eq('token_address', C84A);
  const meta = { address: C84A, symbol: p0.symbol || null, name: p0.name || null, platform: (et && et[0] && et[0].platform) || p0.platform || 'fourmeme' };

  const svc = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
  const pull = await svc._pullTicksDb(C84A, anchorMs);
  const rows = pull.rows || [];
  const tEnd = rows.length ? Date.parse(rows[rows.length - 1].block_time) / 1000 : null;
  console.log(`\n== Part2 原始 ticks=${rows.length}（capped=${pull.capped}）==`);
  const rel = () => rows.filter((r) => !r.price_outlier && r.price_bnb > 0)
    .map((r) => ({ t: Date.parse(r.block_time) / 1000, p: r.price_bnb }))
    .sort((a, b) => a.t - b.t);
  const REL = rel();
  const cur = REL.length ? REL[REL.length - 1].p : null;
  const ath = REL.length ? Math.max(...REL.map((x) => x.p)) : null;
  const first = REL.length ? REL[0].p : null;
  if (cur != null) {
    console.log(`可靠价 ${REL.length} 笔：首=${first.toExponential(4)} ATH=${ath.toExponential(4)} 现价=${cur.toExponential(4)}` +
      ` 现价vsATH=${f2((cur / ath - 1) * 100)}% 现价vs首=${f2((cur / first - 1) * 100)}%`);
  }

  // 120s 逐 10s 买卖结构
  console.log(`\n-- 锚前 120s 逐 10s（买笔/买额/卖额/买钱包/最大单笔买 | 段首价→段末价 reliable）--`);
  for (let b = 12; b >= 1; b--) {
    const t0 = tEnd - b * 10, t1 = tEnd - (b - 1) * 10;
    const inSeg = rows.filter((r) => { const t = Date.parse(r.block_time) / 1000; return t >= t0 && t < t1; });
    if (!inSeg.length) { console.log(`[${(-(b - 1) * 10)}s~-${b * 10}s] 无行`); continue; }
    const buys = inSeg.filter((r) => r.trade_type === 'buy');
    const sells = inSeg.filter((r) => r.trade_type !== 'buy');
    const bw = new Set(buys.map((r) => (r.sender_address || r.trader_address || '').toLowerCase()));
    const maxB = buys.reduce((m, r) => Math.max(m, r.bnb_amount || 0), 0);
    const rp = REL.filter((x) => x.t >= t0 && x.t < t1);
    const pS = rp.length ? rp[0].p : null, pE = rp.length ? rp[rp.length - 1].p : null;
    console.log(`[${(-(b - 1) * 10)}s~-${b * 10}s] n=${inSeg.length} 买${buys.length}笔/${f4(buys.reduce((s, r) => s + (r.bnb_amount || 0), 0))}B/${bw.size}w max=${f4(maxB)} 卖${sells.length}笔/${f4(sells.reduce((s, r) => s + (r.bnb_amount || 0), 0))}B` +
      (pS != null ? ` 价${((pE / pS - 1) * 100 >= 0 ? '+' : '') + f2((pE / pS - 1) * 100)}%` : ' 价?'));
  }

  // 45s 逐 5s 价格段（reliable 首尾）+ recentDip5 段定位（复刻 snapshot 单调队列）
  console.log(`\n-- 锚前 45s 逐 5s 价格段 --`);
  for (let b = 9; b >= 1; b--) {
    const t0 = tEnd - b * 5, t1 = tEnd - (b - 1) * 5;
    const rp = REL.filter((x) => x.t >= t0 && x.t < t1);
    if (!rp.length) { console.log(`[${(-(b - 1) * 5)}s~-${b * 5}s] 无reliable`); continue; }
    const chg = (rp[rp.length - 1].p / rp[0].p - 1) * 100;
    console.log(`[${(-(b - 1) * 5)}s~-${b * 5}s] ${rp.length}笔 ${(chg >= 0 ? '+' : '') + f2(chg)}%  ${rp[0].p.toExponential(3)}→${rp[rp.length - 1].p.toExponential(3)}`);
  }
  // recentDip5 定位（与 buy-point-snapshot L180-220 同算法）
  let dPct = null, dSec = null, dStart = null, dEnd = null;
  if (REL.length >= 2) {
    const dqHi = [];
    for (let j = 0; j < REL.length; j++) {
      while (dqHi.length && REL[dqHi[dqHi.length - 1]].p <= REL[j].p) dqHi.pop();
      dqHi.push(j);
      while (dqHi.length && REL[j].t - REL[dqHi[0]].t > 5) dqHi.shift();
      if (REL[j].t >= tEnd - 30 && dqHi.length && dqHi[0] < j) {
        const chg = (REL[j].p / REL[dqHi[0]].p - 1) * 100;
        if (dPct === null || chg < dPct) { dPct = chg; dSec = tEnd - REL[j].t; dStart = REL[dqHi[0]]; dEnd = REL[j]; }
      }
    }
  }
  if (dPct !== null) {
    console.log(`\nrecentDip5 定位：段=${f2(dPct)}%（${dStart.p.toExponential(3)}@-${Math.round(tEnd - dStart.t)}s → ${dEnd.p.toExponential(3)}@-${Math.round(tEnd - dEnd.t)}s，段终点距今 ${Math.round(dSec)}s）` +
      ` 未收复=${f2((cur / dStart.p - 1) * 100)}%（现价 vs 段起点价，段起点距今 ${Math.round(tEnd - dStart.t)}s）`);
  }

  // buildBuyPointSnapshot 直调（全锚）
  const snap = buildBuyPointSnapshot(rows, meta);
  const d = snap.buyDerived;
  const pick = {
    tokenAgeSec: d.tokenAgeSec, currentVsAthPct: d.currentVsAthPct, secSinceAth: d.secSinceAth,
    chg5Pct: d.chg5Pct, chg10Pct: d.chg10Pct, chg30Pct: d.chg30Pct,
    maxDn5Pct: d.maxDn5Pct, nearMaxDn5Pct: d.nearMaxDn5Pct, nearMaxUp5Pct: d.nearMaxUp5Pct,
    recentDip5Pct: d.recentDip5Pct, recentDip5SecAgo: d.recentDip5SecAgo, recentDip5UnrecoveredPct: d.recentDip5UnrecoveredPct,
    currentVsLaunchPct: d.currentVsLaunchPct, athVsLaunchPct: d.athVsLaunchPct, curVsMinGapPct: d.curVsMinGapPct,
    nearTail10BuyN: d.activity && d.activity.nearTail10BuyN, nearTail10BuyBnb: d.activity && d.activity.nearTail10BuyBnb, nearTail10SellBnb: d.activity && d.activity.nearTail10SellBnb, nearTail10SellWallets: d.activity && d.activity.nearTail10SellWallets,
    win30: d.win && d.win[30] && { buyBnb: d.win[30].buyBnb, sellBnb: d.win[30].sellBnb, buyN: d.win[30].buyN, sellN: d.win[30].sellN, buyers: d.win[30].buyers, sellers: d.win[30].sellers, buySharePct: d.win[30].buySharePct },
    win60: d.win[60] && { buyBnb: d.win[60].buyBnb, sellBnb: d.win[60].sellBnb, buyN: d.win[60].buyN, sellN: d.win[60].sellN, buySharePct: d.win[60].buySharePct },
    win120: d.win[120] && { buyBnb: d.win[120].buyBnb, sellBnb: d.win[120].sellBnb, buySharePct: d.win[120].buySharePct },
    bundledBlock: d.bundledBlock, openSeg: d.openSeg && { buyBnb: d.openSeg.buyBnb, bigN: d.openSeg.bigBuyN, buySharePct: d.openSeg.buySharePct },
  };
  console.log(`\n-- buildBuyPointSnapshot 全锚 --\n` + JSON.stringify(pick, null, 1).slice(0, 2600));
  console.log(`[PRICE] 拱（20 桶）：` + (d.priceBuckets || []).map((b) => `${Math.round(b.dt)}s:${b.price.toExponential(2)}`).join(' '));

  // ── Part 3：fresh gateBuyPoint ×3 ──
  console.log(`\n== Part3 fresh ×3 ==`);
  for (let i = 1; i <= 3; i++) {
    const r = await svc.gateBuyPoint(C84A, meta, { experimentId: 'c84a-deep' }, { anchorMs });
    const a = r.assessment || {}, e = (r.dimensions || {}).entry_shape || {}, an = r.anchors || {};
    console.log(`#${i} ${r.status} 综=${a.bucket}(${a.rule}) entry=${e.bucket}(${f2(e.prob)}) 段=${f2(an.recentDip5Pct)}@${an.recentDip5SecAgo}s 未收复=${f2(an.recentDip5UnrecoveredPct)} chg5=${f2(an.chg5Pct)} chg30=${f2(an.chg30Pct)}`);
  }

  if (!SCAN) { process.exit(0); }

  // ── Part 4：v101 entry_shape=crash 误伤面扫描（分页拉全）──
  console.log(`\n== Part4 v101 crash 误伤面扫描 ==`);
  const all = [];
  for (let off = 0; ; off += 1000) {
    const { data: page } = await client.from('strategy_signals')
      .select('token_address,created_at,metadata').eq('experiment_id', V101).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (!page || !page.length) break;
    all.push(...page);
    if (page.length < 1000) break;
  }
  const crashSigs = all.filter((s) => s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.dimensions && s.metadata.buyPoint.dimensions.entry_shape && s.metadata.buyPoint.dimensions.entry_shape.bucket === 'crash');
  console.log(`v101 BUY 总 ${all.length} 行，entry_shape=crash ${crashSigs.length} 行`);
  // 去重：同 token 30s 内只取一锚
  const seen = new Map();
  const anchors = [];
  for (const s of crashSigs) {
    const last = seen.get(s.token_address);
    if (last && Math.abs(Date.parse(s.created_at) - last) < 30000) continue;
    seen.set(s.token_address, Date.parse(s.created_at));
    anchors.push(s);
  }
  console.log(`去重后 ${anchors.length} 锚（同 token 30s 合并）`);
  const cls = { deep: [], mild: [], other: [] };
  for (const s of anchors.slice(0, 90)) {
    const aMs = Date.parse(s.created_at);
    let bd = null, pl = null;
    try { pl = await svc._pullTicksDb(s.token_address, aMs); bd = buildBuyPointSnapshot(pl.rows, { address: s.token_address, platform: 'fourmeme' }).buyDerived; } catch (e) { continue; }
    if (bd == null || bd.recentDip5Pct == null) { cls.other.push({ s, bd, fwd: null }); continue; }
    // 前向 3min 最大涨幅
    let fwd = null;
    try {
      const aIso = new Date(aMs).toISOString();
      const { data: fr } = await client.from('wss_price_ticks')
        .select('block_time,price_bnb,price_outlier').eq('token_address', s.token_address)
        .gte('block_time', aIso).order('block_number', { ascending: true }).limit(150);
      const ok = (fr || []).filter((r) => !r.price_outlier && r.price_bnb > 0);
      const base = ok.length ? ok[0].price_bnb : null;
      if (base != null && bd.chg5Pct !== undefined) {
        let hi = 0;
        for (const r of ok) { if (Date.parse(r.block_time) - aMs > 180000) break; hi = Math.max(hi, (r.price_bnb / base - 1) * 100); }
        fwd = +hi.toFixed(2);
      }
    } catch (e) {}
    const rec = {
      tok: s.token_address.slice(0, 8), at: s.created_at.slice(11, 19),
      seg: bd.recentDip5Pct, sec: bd.recentDip5SecAgo, unrec: bd.recentDip5UnrecoveredPct,
      chg5: bd.chg5Pct, t10b: bd.activity && bd.activity.nearTail10BuyBnb, t10s: bd.activity && bd.activity.nearTail10SellBnb,
      vsAth: bd.currentVsAthPct, fwd,
    };
    (rec.seg <= -18 ? cls.deep : (rec.unrec <= -20 ? cls.mild : cls.other)).push(rec);
    console.log(`${rec.tok} ${rec.at} 段=${f2(rec.seg)}@${rec.sec}s 未收复=${f2(rec.unrec)} chg5=${f2(rec.chg5)} 尾10买=${f4(rec.t10b)}/卖=${f4(rec.t10s)} vsAth=${f2(rec.vsAth)} 前向3mMax=${f2(rec.fwd)}%`);
  }
  const stat = (arr, name) => {
    if (!arr.length) return console.log(`${name}: 0`);
    const fwd = arr.filter((x) => x.fwd != null).map((x) => x.fwd);
    console.log(`${name}: ${arr.length} 锚 前向3mMax（n=${fwd.length}）均值=${fwd.length ? f2(fwd.reduce((a, b) => a + b, 0) / fwd.length) : '?'} 中位=${fwd.length ? f2(fwd.slice().sort((a, b) => a - b)[Math.floor(fwd.length / 2)]) : '?'} ≥+10%数=${fwd.filter((x) => x >= 10).length}`);
  };
  console.log('\n-- 分类汇总（深段≤-18=真暴跌余波 / 段>-18 但未收复≤-20=累计阴跌域）--');
  stat(cls.deep, '深段'); stat(cls.mild, '段浅坑深（阴跌域）'); stat(cls.other, '其他');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
