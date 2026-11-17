#!/usr/bin/env node
/**
 * tmp-tpa-price-study — 课题：代币持仓钱包画像（TPA 口径）× 前向价格走势 关联分析
 * （2026-11-15，基于 bt-v134 窗口；182 专用重查询脚本）
 *
 * 样本：窗口 [2026-11-02T06:00Z → 2026-11-03T15:00Z]（bt-v134 = 19ef6433-0c92-47ff-a6fd-9f6bea745b8d）
 *   内全部 token_create token（fourmeme/flap/gang），通过 TPA 生产触发门
 *   （blocks:1, tradeCount>10, buyBnb>6, minHolders≥4，PROD_TRIGGER_GATE）的子集。
 *
 * 锚点 = 每票首次满足触发门的 tick 时刻（TPA 生产语义 write-once）：
 *   - 净持仓 top20（wallet=sender||trader，尘 tick <0.001 BNB 滤除，FA 因子口径）
 *   - 画像 = wallet_offline_profiles（data_through 至 11-05 ≥ 窗口 asOf → fresh 近似，
 *     与 TPA 生产 fresh 路径同款；miss 钱包 = 新钱包近似 tokenCount=0 + BSC 2.2 中性分豁免）
 *   - 聚合 = scoreTokenFromHolders + computeZhuangRetail（wallet-scorer v1 单一真相源）
 *
 * 前向指标（锚后可靠价 price_outlier=false）：5/15/60min last/maxRise + 60min maxDrop。
 *
 * 输出：控制台分组统计 + 明细 JSON（--out，缺省 data/tmp-tpa-price-study.json）。
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const WINDOW_START = '2026-11-02T06:00:00Z';
const WINDOW_END = '2026-11-03T15:00:00Z';
const EXPERIMENT_ID = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
const FWD_MS = 70 * 60 * 1000;          // 前向数据多拉 70min（60min 窗 + 10min 缓冲）
const DUST_BNB = 0.001;                  // FA 尘 tick 门（minTickBnb）
const TRIGGER = { blocks: 1, tradeCount: 10, buyBnb: 6, minHolders: 4 }; // PROD_TRIGGER_GATE
const TOP_N = 20;                        // maxHoldersToAnalyze
const TICK_COLS = 'id,token_address,trade_type,trader_address,sender_address,bnb_amount,token_amount,price_bnb,price_outlier,block_number,log_index,block_time';

const { dbManager } = require('../src/services/dbManager.js');
const {
  scoreTokenFromHolders, computeZhuangRetail, computeZhuangRetailRatio,
  classifyHolder, isSniperLikeProfile,
} = require('../src/services/wallet-scorer.js');

const OUT_FILE = (process.argv.indexOf('--out') >= 0 && process.argv[process.argv.indexOf('--out') + 1]) ||
  path.join(process.cwd(), 'data', 'tmp-tpa-price-study.json');

function ms(iso) { return Date.parse(iso); }
function pct(a, b) { return b > 0 ? ((a / b) - 1) * 100 : null; }
function fmt(x, d = 2) { return (x == null || !Number.isFinite(x)) ? 'null' : x.toFixed(d); }

async function main() {
  const sb = await dbManager.getClient();
  const startMs = ms(WINDOW_START);
  const endMs = ms(WINDOW_END);
  const fwdEndMs = endMs + FWD_MS;

  // ── 0. 实验买入集合（bt-v134 trades；token 级盈亏 = Σsell(得 BNB) − Σbuy(花 BNB)）──
  const bought = new Set();
  const expPnl = new Map();
  {
    const { data, error } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount')
      .eq('experiment_id', EXPERIMENT_ID).limit(2000);
    if (error) throw new Error(error.message);
    for (const t of (data || [])) {
      const ta = (t.token_address || '').toLowerCase();
      if (t.trade_direction === 'buy') { bought.add(ta); expPnl.set(ta, (expPnl.get(ta) || 0) - Number(t.input_amount || 0)); }
      if (t.trade_direction === 'sell') expPnl.set(ta, (expPnl.get(ta) || 0) + Number(t.output_amount || 0));
    }
    console.log(`[0] 实验买 token=${bought.size}（bt-v134）`);
  }

  // ── 1. token 宇宙（wss_events keyset 分页绕 1000 帽）──
  const tokens = new Map(); // addr -> {platform, creator, totalSupply, createMs}
  {
    let lastId = null;
    for (;;) {
      let q = sb.from('wss_events').select('id,payload,platform,block_time')
        .eq('kind', 'token_create')
        .gte('block_time', WINDOW_START).lte('block_time', WINDOW_END)
        .order('id', { ascending: true }).limit(1000);
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      lastId = data[data.length - 1].id;
      for (const e of data) {
        const p = e.payload || {};
        const addr = (p.token || '').toLowerCase();
        if (!addr) continue;
        if (!tokens.has(addr)) tokens.set(addr, {
          platform: e.platform || 'fourmeme',
          creator: (p.creator || '').toLowerCase() || null,
          totalSupply: Number(p.totalSupply) > 0 ? Number(p.totalSupply) : 1e9,
          createMs: ms(e.block_time),
        });
      }
      if (data.length < 1000) break;
    }
    const byPlat = {};
    for (const t of tokens.values()) byPlat[t.platform] = (byPlat[t.platform] || 0) + 1;
    console.log(`[1] 窗口 token 宇宙=${tokens.size} ${JSON.stringify(byPlat)}`);
  }

  // ── 2. 窗口 ticks（锚定 id 区间 + 无序 limit 分页，tick-cache 装载形状）──
  // 头尾锚用纯 PK 二分定位（ORDER BY 组合形状 planner 超时，红线 11；二分每步=索引 seek）。
  // 不变式修复：探测行落在当前边界上（区间内无行）时收缩对侧端，保证每步区间严格减半不死循环。
  async function idAtOrBefore(tsMs) {
    const { data: hm, error: e0 } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: false }).limit(1);
    if (e0 || !hm || !hm.length) throw new Error('表空');
    let lo = 0, hi = hm[0].id + 1; // 答案 ∈ [lo, hi)
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const { data, error } = await sb.from('wss_price_ticks').select('id,block_time')
        .lte('id', mid).order('id', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (!data || !data.length || data[0].id <= lo) { hi = mid; continue; }
      if (Date.parse(data[0].block_time) <= tsMs) lo = data[0].id; else hi = data[0].id;
    }
    return lo;
  }
  async function idAtOrAfter(tsMs) {
    // P = block_time < tsMs 的最大行（id≈block_time 单调近似，乱序窗口秒级容差）；返回 P 后首行。
    const { data: lm, error: e0 } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: true }).limit(1);
    if (e0 || !lm || !lm.length) throw new Error('表空');
    const { data: hm } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: false }).limit(1);
    let lo = lm[0].id - 1, hi = hm[0].id + 1; // P ∈ [lo, hi)
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const { data, error } = await sb.from('wss_price_ticks').select('id,block_time')
        .lte('id', mid).order('id', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (!data || !data.length || data[0].id <= lo) { hi = mid; continue; }
      if (Date.parse(data[0].block_time) < tsMs) lo = data[0].id; else hi = data[0].id;
    }
    const { data: nx, error: e2 } = await sb.from('wss_price_ticks').select('id')
      .gt('id', lo).order('id', { ascending: true }).limit(1);
    if (e2) throw new Error(e2.message);
    return (nx && nx.length) ? nx[0].id : hm[0].id + 1;
  }
  const rawTicks = [];
  {
    const t0 = Date.now();
    const firstId = await idAtOrAfter(startMs);
    const lastId = await idAtOrBefore(fwdEndMs);
    if (lastId < firstId) throw new Error(`窗口锚异常 first=${firstId} last=${lastId}`);
    const tailId = firstId - 1;
    const headId = lastId;
    console.log(`[2] id 区间 [${tailId + 1}, ${headId}] 拉取中...`);
    let cursor = tailId;
    let pages = 0;
    for (;;) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS)
        .gt('id', cursor).lte('id', headId).limit(1000);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      pages++;
      let mx = cursor;
      for (const r of data) {
        if (r.id > mx) mx = r.id;
        const bt = ms(r.block_time);
        if (bt < startMs || bt > fwdEndMs) continue;
        const ta = (r.token_address || '').toLowerCase();
        if (!tokens.has(ta)) continue;
        r._bt = bt; r._ta = ta;
        rawTicks.push(r);
      }
      cursor = mx;
      if (data.length < 1000) break;
      if (pages % 500 === 0) console.log(`    ... ${pages} 页 / kept ${rawTicks.length}`);
    }
    console.log(`[2] ticks 拉取完成：${pages} 页 / ${rawTicks.length} 行（窗口 token）/${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // 按 token 分组 + 链上真序
  const byToken = new Map();
  for (const r of rawTicks) {
    let arr = byToken.get(r._ta);
    if (!arr) { arr = []; byToken.set(r._ta, arr); }
    arr.push(r);
  }
  rawTicks.length = 0;
  for (const arr of byToken.values()) arr.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));

  // ── 3. per-token 重放：触发门 + 净持仓 top20 + 前向指标 ──
  const triggered = [];
  let nDustOnly = 0;
  for (const [addr, ticks] of byToken) {
    const meta = tokens.get(addr);
    const net = new Map();          // wallet -> net token qty
    let tradeCount = 0, buyBnb = 0;
    let firstBlock = null, firstTickMs = null;
    let anchorPrice = null, anchorMsT = null, anchorIdx = -1;
    let anchorTop = null, anchorAgeSec = null, anchorTc = 0, anchorBuyBnb = 0, anchorHolders = 0;
    let firstRelPrice = null;

    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i];
      const wallet = (t.sender_address || t.trader_address || '').toLowerCase();
      const isBuy = t.trade_type === 'buy';
      const dust = Number(t.bnb_amount) < DUST_BNB;
      if (firstBlock == null && t.block_number != null) firstBlock = Number(t.block_number);
      if (firstTickMs == null) firstTickMs = t._bt;
      if (!dust) {
        tradeCount++;
        if (isBuy) buyBnb += Number(t.bnb_amount);
        if (wallet) net.set(wallet, (net.get(wallet) || 0) + (isBuy ? Number(t.token_amount || 0) : -Number(t.token_amount || 0)));
        if (!t.price_outlier && t.price_bnb != null) {
          if (firstRelPrice == null) firstRelPrice = Number(t.price_bnb);
          anchorPrice = Number(t.price_bnb); // 滚动最新可靠价
        }
      }
      // 触发门（write-once）
      if (anchorIdx < 0 && firstBlock != null && t.block_number != null
        && Number(t.block_number) - firstBlock >= TRIGGER.blocks
        && tradeCount > TRIGGER.tradeCount && buyBnb > TRIGGER.buyBnb) {
        let holders = 0;
        for (const v of net.values()) if (v > 0) holders++;
        if (holders >= TRIGGER.minHolders) {
          anchorIdx = i; anchorMsT = t._bt; anchorTop = [...net.entries()].filter(([w, v]) => v > 0)
            .sort((a, b) => b[1] - a[1]).slice(0, TOP_N);
          anchorAgeSec = (t._bt - firstTickMs) / 1000;
          anchorTc = tradeCount; anchorBuyBnb = buyBnb; anchorHolders = holders;
        }
      }
    }
    if (anchorIdx < 0 || !anchorPrice) { if (ticks.length && tradeCount === 0) nDustOnly++; continue; }
    if (!anchorTop || !anchorTop.length) continue;

    // 前向指标（锚后可靠价）
    const fwd = { r5: [], r15: [], r60: [] };
    let nTicks60 = 0;
    for (let i = anchorIdx + 1; i < ticks.length; i++) {
      const t = ticks[i];
      if (t._bt > anchorMsT + 3600000) break;
      if (Number(t.bnb_amount) < DUST_BNB || t.price_outlier || t.price_bnb == null) continue;
      const dt = t._bt - anchorMsT;
      const pr = Number(t.price_bnb);
      if (dt <= 300000) fwd.r5.push(pr);
      if (dt <= 900000) fwd.r15.push(pr);
      if (dt <= 3600000) { fwd.r60.push(pr); nTicks60++; }
    }
    const lastOf = (arr) => arr.length ? pct(arr[arr.length - 1], anchorPrice) : 0;
    const maxOf = (arr) => arr.length ? pct(Math.max(...arr), anchorPrice) : 0;
    const minOf = (arr) => arr.length ? pct(Math.min(...arr), anchorPrice) : 0;

    const floatTotal = anchorTop.reduce((s, [, v]) => s + v, 0);
    const totalSupply = meta.totalSupply || 1e9;
    const posNetAll = [...net.values()].reduce((s, v) => s + (v > 0 ? v : 0), 0);

    triggered.push({
      token: addr, platform: meta.platform, creator: meta.creator,
      bought: bought.has(addr), expPnl: expPnl.has(addr) ? Number((expPnl.get(addr)).toFixed(4)) : null,
      anchorMs: anchorMsT, anchorAgeSec: Number(anchorAgeSec.toFixed(1)),
      tradeCount: anchorTc, buyBnb: Number(anchorBuyBnb.toFixed(2)), holders: anchorHolders,
      anchorVsLaunchPct: firstRelPrice ? Number(pct(anchorPrice, firstRelPrice).toFixed(2)) : null,
      walletHoldingPct: Number(((posNetAll / totalSupply) * 100).toFixed(3)),
      anchorPrice,
      top: anchorTop, floatTotal,
      fwd5mLast: lastOf(fwd.r5), fwd15mLast: lastOf(fwd.r15), fwd60mLast: lastOf(fwd.r60),
      fwd5mMaxRise: maxOf(fwd.r5), fwd15mMaxRise: maxOf(fwd.r15), fwd60mMaxRise: maxOf(fwd.r60),
      fwd60mMaxDrop: minOf(fwd.r60), nTicks60,
    });
  }
  console.log(`[3] 触发 TPA 门的 token=${triggered.length}（宇宙 ${byToken.size}，纯尘票 ${nDustOnly}）`);

  // ── 4. top20 钱包 offline 画像批查 ──
  const walletSet = new Set();
  for (const tg of triggered) for (const [w] of tg.top) walletSet.add(w);
  const offline = new Map(); // addr -> profile
  {
    const addrs = [...walletSet];
    const t0 = Date.now();
    for (let i = 0; i < addrs.length; i += 100) {
      const chunk = addrs.slice(i, i + 100);
      const { data, error } = await sb.from('wallet_offline_profiles')
        .select('address,data_through,profile').in('address', chunk);
      if (error) throw new Error(error.message);
      for (const r of (data || [])) offline.set((r.address || '').toLowerCase(), r.profile || null);
    }
    let miss = 0, stale = 0;
    for (const tg of triggered) for (const [w] of tg.top) {
      if (!offline.has(w)) miss++;
    }
    // stale 估计：data_through < 锚时刻（仅统计，画像仍用 offline 近似）
    console.log(`[4] 钱包去重=${addrs.length} offline 命中=${offline.size} miss=${addrs.length - offline.size}（miss→新钱包近似）/${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // ── 5. 画像聚合（wallet-scorer v1 单一真相源）──
  const missProfile = () => ({
    address: null, source: 'realtime', tokenCount: 0, rawTotal: 0,
    buckets: null, dustRatio: 0, lowRatio: 0, lowTinyRatio: 0, badAction: false,
    totalBnb: 0, tickCount: 0, avgBnb: 0, buyCount: 0, sellCount: 0,
    largeTradeCount: 0, effectiveTradeCount: 0, tier2CrashBlockSellCount: 0, tier2Ratio: null,
    badCount14d: 0, badRatio: 0, earlyLargeBuyCount: 0, crashLargeSellCount: 0,
    badBuyCount: 0, badSellCount: 0, avgHoldSeconds: 0, medianHoldSeconds: null, firstSeenMs: null,
  });
  let totMissHolders = 0, totHolders = 0;
  for (const tg of triggered) {
    const profiles = [];
    for (const [w, v] of tg.top) {
      const off = offline.get(w);
      const p = off ? { ...off, address: w, source: 'offline' } : Object.assign(missProfile(), { address: w });
      p.netTokens = v;
      p.floatPct = tg.floatTotal > 0 ? Number(((v / tg.floatTotal) * 100).toFixed(2)) : 0;
      p.isCreator = !!(tg.creator && tg.creator === w);
      totHolders++;
      if (!off) totMissHolders++;
      profiles.push(p);
    }
    const holdingFactors = { TPAPre_walletHoldingPct: tg.walletHoldingPct };
    const summary = scoreTokenFromHolders(profiles, holdingFactors, { enabled: true, strategy: 'v1', topN: TOP_N, topNMode: 'all' });
    const zr = computeZhuangRetail(profiles);
    const ratio = computeZhuangRetailRatio(zr);
    tg.tokenScore = summary?.totalScore ?? null;
    tg.zhuangPct = zr?.zhuangPct ?? null; tg.newWalletPct = zr?.newWalletPct ?? null;
    tg.retailPct = zr?.retailPct ?? null; tg.neutralPct = zr?.neutralPct ?? null;
    tg.ratio = Number.isFinite(ratio) ? Number(ratio.toFixed(3)) : (ratio === Infinity ? 999 : null);
    tg.minZR = zr?.minZR ?? null; tg.gapZR = zr?.gapZR ?? null;
    tg.top1FloatPct = profiles.length ? profiles[0].floatPct : null;
    tg.top2FloatPct = profiles.length > 1 ? Number(((profiles[0].floatPct + profiles[1].floatPct)).toFixed(2)) : tg.top1FloatPct;
    const cnt = { new_wallet: 0, zhuang: 0, retail: 0, neutral: 0 };
    let badActionN = 0, sniperN = 0, bad14d = 0;
    const holds = [];
    for (const p of profiles) {
      cnt[classifyHolder(p)]++;
      if (p.badAction) badActionN++;
      if (isSniperLikeProfile(p) && !p.isCreator) sniperN++;
      bad14d += (p.badCount14d || 0);
      if (p.medianHoldSeconds != null) holds.push(p.medianHoldSeconds);
    }
    holds.sort((a, b) => a - b);
    tg.newWalletCount = cnt.new_wallet; tg.zhuangCount = cnt.zhuang; tg.retailCount = cnt.retail; tg.neutralCount = cnt.neutral;
    tg.badActionCount = badActionN; tg.sniperCount = sniperN; tg.bad14dSum = bad14d;
    tg.medianHoldMed = holds.length ? holds[Math.floor(holds.length / 2)] : null;
    tg.holderAnalyzedN = profiles.length;
    delete tg.top; delete tg.floatTotal; // 明细瘦身
  }
  console.log(`[5] 画像聚合完成（holder 级 miss 率 ${(totMissHolders / Math.max(totHolders, 1) * 100).toFixed(1)}%）`);

  // ── 6. 统计输出 ──
  const rows = triggered;
  const q = (arr, p) => arr.filter(x => x[p] != null && Number.isFinite(x[p])).map(x => x[p]);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const spearman = (xs, ys) => {
    const pts = rows.filter(r => r[xs] != null && Number.isFinite(r[xs]) && r[ys] != null && Number.isFinite(r[ys]));
    if (pts.length < 10) return { n: pts.length, rho: null };
    const rank = (vals) => {
      const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(vals.length);
      let i = 0;
      while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
        const rk = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[idx[k][1]] = rk;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(pts.map(p => p[xs])), ry = rank(pts.map(p => p[ys]));
    const n = pts.length;
    const mx = mean(rx), my = mean(ry);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
    return { n, rho: dx && dy ? Number((num / Math.sqrt(dx * dy)).toFixed(3)) : null };
  };

  const bucketTable = (title, keyFn, buckets) => {
    console.log(`\n═══ ${title} ═══`);
    console.log('bucket'.padEnd(18) + 'n'.padStart(5) + 'buy'.padStart(5) + '  15mLast_med  15mLast_mean  win15%   60mLast_med  60mRise_med  60mDrop_med  nT60_med');
    for (const [label, lo, hi] of buckets) {
      const sub = rows.filter(r => { const v = keyFn(r); return v != null && Number.isFinite(v) && v >= lo && (hi == null || v < hi); });
      if (!sub.length) { console.log(String(label).padEnd(18) + '0'); continue; }
      const l15 = q(sub, 'fwd15mLast'), l60 = q(sub, 'fwd60mLast'), mr60 = q(sub, 'fwd60mMaxRise'), md60 = q(sub, 'fwd60mMaxDrop'), nt = q(sub, 'nTicks60');
      const win15 = l15.filter(v => v > 0).length / Math.max(l15.length, 1) * 100;
      console.log(String(label).padEnd(18) + String(sub.length).padStart(5) + String(sub.filter(r => r.bought).length).padStart(5)
        + fmt(med(l15)).padStart(13) + fmt(mean(l15)).padStart(13) + fmt(win15, 1).padStart(7)
        + fmt(med(l60)).padStart(13) + fmt(med(mr60)).padStart(13) + fmt(med(md60)).padStart(13) + fmt(med(nt), 0).padStart(10));
    }
  };

  console.log(`\n═══ 总览（n=${rows.length}，实验买入 ${rows.filter(r => r.bought).length}）═══`);
  console.log(`fwd15mLast med=${fmt(med(q(rows, 'fwd15mLast')))} mean=${fmt(mean(q(rows, 'fwd15mLast')))}  fwd60mLast med=${fmt(med(q(rows, 'fwd60mLast')))} mean=${fmt(mean(q(rows, 'fwd60mLast')))}`);
  console.log(`fwd60mMaxRise med=${fmt(med(q(rows, 'fwd60mMaxRise')))}  fwd60mMaxDrop med=${fmt(med(q(rows, 'fwd60mMaxDrop')))}  tokenScore med=${fmt(med(q(rows, 'tokenScore')))}  zhuangPct med=${fmt(med(q(rows, 'zhuangPct')), 1)}`);
  console.log(`newWalletPct med=${fmt(med(q(rows, 'newWalletPct')), 1)}  retailPct med=${fmt(med(q(rows, 'retailPct')), 1)}  badAction 票占比=${fmt(rows.filter(r => (r.badActionCount || 0) > 0).length / Math.max(rows.length, 1) * 100, 1)}%`);
  const plat = {};
  for (const r of rows) plat[r.platform] = (plat[r.platform] || 0) + 1;
  console.log(`platform: ${JSON.stringify(plat)}`);

  bucketTable('按 tokenScore（钱包质量分 0-5）', r => r.tokenScore, [
    ['[0,1)', 0, 1], ['[1,2)', 1, 2], ['[2,3)', 2, 3], ['[3,4)', 3, 4], ['[4,5]', 4, null],
  ]);
  bucketTable('按 zhuangPct（庄型持仓占比%）', r => r.zhuangPct, [
    ['[0,20)', 0, 20], ['[20,40)', 20, 40], ['[40,60)', 40, 60], ['[60,80)', 60, 80], ['[80,100]', 80, null],
  ]);
  bucketTable('按 newWalletPct（新钱包持仓占比%）', r => r.newWalletPct, [
    ['[0,20)', 0, 20], ['[20,40)', 20, 40], ['[40,60)', 40, 60], ['[60,80)', 60, 80], ['[80,100]', 80, null],
  ]);
  bucketTable('按 retailPct（散户型持仓占比%）', r => r.retailPct, [
    ['[0,20)', 0, 20], ['[20,40)', 20, 40], ['[40,60)', 40, 60], ['[60,80)', 60, 80], ['[80,100]', 80, null],
  ]);
  bucketTable('按 badActionCount（top20 恶意行为钱包数）', r => r.badActionCount, [
    ['0', 0, 1], ['1', 1, 2], ['2', 2, 3], ['>=3', 3, null],
  ]);
  bucketTable('按 top1FloatPct（第一大持仓占 top20 流通%）', r => r.top1FloatPct, [
    ['[0,10)', 0, 10], ['[10,20)', 10, 20], ['[20,35)', 20, 35], ['[35,50)', 35, 50], ['>=50', 50, null],
  ]);

  console.log(`\n═══ Spearman 秩相关（画像特征 × 前向收益）═══`);
  for (const f of ['tokenScore', 'zhuangPct', 'newWalletPct', 'retailPct', 'neutralPct', 'ratio', 'minZR', 'gapZR', 'badActionCount', 'top1FloatPct', 'sniperCount', 'bad14dSum']) {
    const a = spearman(f, 'fwd15mLast'), b = spearman(f, 'fwd60mLast'), c = spearman(f, 'fwd60mMaxRise');
    console.log(`${f.padEnd(16)} 15mLast rho=${fmt(a.rho, 3)}(n=${a.n})  60mLast rho=${fmt(b.rho, 3)}  60mMaxRise rho=${fmt(c.rho, 3)}`);
  }

  console.log(`\n═══ 反向：按 fwd60mLast 分桶 → 画像特征均值 ═══`);
  console.log('bucket'.padEnd(12) + 'n'.padStart(5) + '  score   zhuang%  newW%   retail%  badAct  top1%   age(s)  anchorVs%');
  for (const [label, lo, hi] of [['<-50', null, -50], ['-50~-20', -50, -20], ['-20~0', -20, 0], ['0~+20', 0, 20], ['+20~+50', 20, 50], ['>+50', 50, null]]) {
    const sub = rows.filter(r => { const v = r.fwd60mLast; return v != null && Number.isFinite(v) && (lo == null || v >= lo) && (hi == null || v < hi); });
    if (!sub.length) { console.log(String(label).padEnd(12) + '0'); continue; }
    console.log(String(label).padEnd(12) + String(sub.length).padStart(5)
      + fmt(mean(q(sub, 'tokenScore'))).padStart(8) + fmt(mean(q(sub, 'zhuangPct')), 1).padStart(8)
      + fmt(mean(q(sub, 'newWalletPct')), 1).padStart(7) + fmt(mean(q(sub, 'retailPct')), 1).padStart(8)
      + fmt(mean(q(sub, 'badActionCount')), 2).padStart(7) + fmt(mean(q(sub, 'top1FloatPct')), 1).padStart(7)
      + fmt(mean(q(sub, 'anchorAgeSec')), 0).padStart(8) + fmt(mean(q(sub, 'anchorVsLaunchPct')), 1).padStart(9));
  }

  console.log(`\n═══ 实验买入票 vs 未买票 画像对照 ═══`);
  for (const [label, sub] of [['买入', rows.filter(r => r.bought)], ['未买', rows.filter(r => !r.bought)]]) {
    console.log(`${label}: n=${sub.length} score=${fmt(mean(q(sub, 'tokenScore')))} zhuang%=${fmt(mean(q(sub, 'zhuangPct')), 1)} newW%=${fmt(mean(q(sub, 'newWalletPct')), 1)} retail%=${fmt(mean(q(sub, 'retailPct')), 1)} badAct=${fmt(mean(q(sub, 'badActionCount')), 2)} top1%=${fmt(mean(q(sub, 'top1FloatPct')), 1)} anchorVs%=${fmt(mean(q(sub, 'anchorVsLaunchPct')), 1)}`);
  }

  // ── 7. 明细落盘 ──
  const fs = require('fs');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    window: { start: WINDOW_START, end: WINDOW_END }, experimentId: EXPERIMENT_ID,
    trigger: TRIGGER, nUniverse: byToken.size, nTriggered: rows.length,
    holderMissRate: Number((totMissHolders / Math.max(totHolders, 1)).toFixed(4)),
    rows,
  }));
  console.log(`\n[7] 明细已落盘 ${OUT_FILE}（${rows.length} 行）`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
