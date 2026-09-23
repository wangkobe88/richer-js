#!/usr/bin/env node
// ============================================================================
// 聪明钱钱包挖掘（smart-wallet-mining）——pumpfun-wss-trader 同名脚本 BSC 移植（批 3.2）
//
// ⚠️⚠️ 红线：重查询脚本，只能在 182 远程服务器上跑（本地走 VPN 连 Supabase 必超时）。
//   本地仅允许 --self-test（零 DB 合成数据单测）与 --no-db（验管线，需先从 182 scp 小源缓存）。
//
// 目标：挖出两类有持续盈利能力的钱包——
//   批1 活跃持续盈利：参与票数多(≥20)、时间对半两半均盈利、mean净PnL为排序主指标
//   批2 稳准狠：低频(5-20票)高胜率(≥0.8)高均值(≥0.08 BNB/票)、realized 占比门防断流票纸面富贵
// 同时内置 A/B 带量验证（审视"聪明钱参与→散户跟单→带量→票存活"假设）与 带头/被带标注（跟单 bot 识别）。
//
// 核心口径（详见 README.md；与母版差异全部标注 ★BSC）：
//   - 多源合并：wss_price_ticks 有 UNIQUE(tx_hash, log_index)——并发 virtual 实验对同一笔链上
//     交易首写者拥有该行，合并=并集、天然无重复；单源视图不完整，故必须多源合并。
//   - 每票净 PnL 无配对公式：netPnL = sellBnb + (buyTok−sellTok)×markPrice − buyBnb（与成本分配法无关的恒等式）。
//   - 一切次序用 (block_time, block_number) 复合键（★BSC：block_number 替代 block_slot；null→0；
//     BSC ~3s/块）。★BSC 无 mayhem 盘（pumpfun 专属），mayhem 剔除与 --keep-insider 簇排除均不迁。
//   - ★BSC bnb_amount/price_bnb 已是十进制 BNB（无 lamports /1e9 换算）。
//   - price_outlier 过滤是消费端责任；尘价(偏 e7 倍)对 mark 价做右端 ±邻 1000× 中位剔除。
//   - graduated/断流票 markPrice=断流前最后有效 tick 价（与虚拟引擎清算口径一致）。
//   - ★BSC token 分类：主路 token_profiles 全局表（批 3.1，OnlineProfileBuilder 写入）；行缺失的
//     token 用折叠期攒的 cls 缓冲内嵌现算（scripts/shared/token-classifier.js 同一代码，离线口径）。
//
// 管线（6 阶段）：
//   0 源计划（virtual+bsc 实验枚举+tick 存在性探测；★BSC 排除 platform=flap 实验）
//   1 逐源流式折叠（pairs/tokenState 全内存 + 落寂token增量剪枝 + --max-pairs 护栏 + cls 分类缓冲）
//   2 配对 PnL 归约（carry-in 三桶剔除 + qualify；★BSC creator 比较大小写不敏感——EVM 语义）
//   3 两批门槛（funnel 全打印）
//   4 画像 enrich（★BSC wallets 表仅 {address,chain,name,category}：只做人工标注冲突检查，
//     母版的 tags/clusters insider-coords 簇重叠与 token_participation 均无此列，不迁）
//   5 第三趟受限重扫（A/B 带量验证 + 随机钱包零假设校准 + 带头/被带 lead-lag 标注 + 协作环）
//   6 产出（data/smart-wallets-{ts}.csv/.json + 控制台中文报告；--apply 写 wallets.category）
//
// ★BSC 锚点钱包：母版写死 CCCCQ/9999huSC/AbuGAb9M（Solana 地址，BSC 无效）——改为默认空 +
//   --anchor-wallets 0xAAA,0xBBB 传入（应入榜的已知聪明钱，跑完输出指标表辅助判断）。
//
// 用法（182，重分析一律远程跑）：
//   node --max-old-space-size=12288 scripts/smart-wallet-mining/mine-smart-wallets.cjs --days 7
//   node scripts/smart-wallet-mining/mine-smart-wallets.cjs --self-test            # 本地纯函数单测(零DB)
//   常用旗标：--experiments id,id | --no-db | --skip-ab | --skip-leadlag | --apply(默认关)
//           | --anchor-wallets 0xAAA,0xBBB
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });
const TickDataCache = require('./lib/tick-data-cache');
const { fetchTicksForExperiment } = require('./lib/data-fetcher');
const { classifyToken } = require('../shared/token-classifier');

// ── 锚点钱包（★BSC 默认空，--anchor-wallets 传入） ──
const ANCHORS = [];

const BAD_CATS_DEFAULT = ['wash', 'pump_dump'];
const RAW_TOKEN_CAP = 200;          // 钱包参与 token 数计数上限（≥200 视为 sniper/bot 池，find-pioneers 惯例）
const PRUNE_EVERY_N_SRC = 6;        // 每折 N 个源做一次增量剪枝
const PRUNE_AGE_SOURCES = 6;        // token 落寂 ≥N 源才允许剪尘配对——活跃期误剪=丢真买额
const HEAT_EDGES_DEFAULT = [10, 30, 60, 120, 300, 1000]; // uniqueTraders 热度桶边界
const CLS_TICKS_CAP = 20000;        // fallback 分类的 per-token slim tick 缓冲上限（超出截断，首段优先）

let _sb = null;
function sb() { if (!_sb) { const { dbManager } = require('../../src/services/dbManager'); _sb = dbManager.getClient(); } return _sb; }
const logger = { info: () => {}, error: console.error };

// ── 小工具 ──
const now = () => Date.now();
const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1048576);
function q(arr, p) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
const id8 = u => String(u).slice(0, 8);
const csvEsc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const pct = x => (x >= 0 ? '+' : '') + (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a');

// ══════════════════════════ CLI 参数 ══════════════════════════
function parseArgs(argv) {
  const a = argv || process.argv.slice(2);
  const o = {
    days: 7, experiments: null, noDb: false, selfTest: false, apply: false, // 窗口=7天（母版同值）
    skipAb: false, skipLeadlag: false, outDir: path.join(__dirname, '../..', 'data'),
    anchorWallets: '',              // ★BSC：已知聪明钱地址（逗号分隔），校验用
    // tick 过滤（★BSC 金额初值按 four.meme 节奏，全部标"待回测校准"）
    minTickBnb: 0.002,              // 与 FA/classifier 可靠价下限同口径（MIN_PRICE_UPDATE_BNB）
    pass1PairMinBnb: 0.02,          // 折叠期尘配对阈（仅在 token 落寂≥PRUNE_AGE_SOURCES 后剪，防活跃期误删）
    maxPairs: 25_000_000,           // 配对总数护栏（超限中止，不静默降级）
    minTicksPerToken: 10,           // 同 token-classifier MIN_TICKS；终剪时 nTicks<10 且无分类的 token 整树剪掉
    // PnL / qualify
    pairMinBuyBnb: 0.02,            // 每票参与资格：该钱包在该票买入总额下限（★BSC 0.02 BNB≈$12，GMGN 可见度口径降档）
    winEpsBnb: 0.001,               // 胜判定阈值（净利 > +0.001 BNB 才算赢，防 ±ε 噪声）
    costPerSide: 0.03,              // 成本稳健列的每腿 haircut（four.meme 1% 协议费+gas+滑点 ~3%/腿；不改主口径）
    carryinTol: 0.01,               // 超卖容差：sellTok > buyTok×(1+tol) 判 carry-in（链下转账置换所得，成本不可知）
    carryinWarnShare: 0.2,          // 钱包 carry-in 占比 > 此值标"覆盖不全"
    // 公共门
    badCats: BAD_CATS_DEFAULT.join(','),
    maxBadShare: 0.5,               // wash+pump_dump 合格配对占比上限（find-pioneers WASH_THRESHOLD 同值）
    halvesMinN: 5,                  // 对半切每半最少配对数（防同秒扎堆把一半切成0）
    // 批1 活跃持续盈利
    activeMinTokens: 20, activeMinWinrate: 0.40, activeMinMean: 0.03, activeStability: true,
    activeMinRealizedShare: 0.25,  // 批1防断流票纸面富贵（囤到断流的 mark 浮盈不可跟随）
    // 批2 稳准狠
    sharpMinTokens: 5, sharpMaxTokens: 20, sharpMinWinrate: 0.80, sharpMinMean: 0.08,
    sharpMinMedianBuy: 0.04, sharpMinRealizedShare: 0.5, sharpMaxSingleShare: 0.6,
    sharpMinDays: 2, sharpMaxRawTotal: RAW_TOKEN_CAP,
    // A/B
    abEntryWindowS: 30, abControls: 3, abCaliperH: 48, abHeatEdges: HEAT_EDGES_DEFAULT.join(','),
    abMinSurvivalLift: 0.20, abMinBuyerLift: 0.30, abMinATokens: 30, abMaxTokens: 250_000,
    nullSampleWallets: 300, nullSeed: 42,   // 随机钱包零假设校准（匹配偏差检测）
    ringJaccard: 0.6,                        // 协作环检测：入榜钱包合格票集对更高排名者的 Jaccard 阈值
    // lead-lag（★BSC：Δblock≤1 ≈ 母版 Δslot≤2 的墙钟跨度——3s 块 vs 400ms slot）
    leadLagBlocks: 1, leadlagBotRate: 0.7,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--days') o.days = parseInt(a[++i], 10);
    else if (k === '--experiments') o.experiments = a[++i];
    else if (k === '--no-db') o.noDb = true;
    else if (k === '--self-test') o.selfTest = true;
    else if (k === '--apply') o.apply = true;
    else if (k === '--skip-ab') o.skipAb = true;
    else if (k === '--skip-leadlag') o.skipLeadlag = true;
    else if (k === '--out-dir') o.outDir = a[++i];
    else if (k === '--anchor-wallets') o.anchorWallets = a[++i];
    else if (k === '--min-tick-bnb') o.minTickBnb = parseFloat(a[++i]);
    else if (k === '--pass1-pair-min-bnb') o.pass1PairMinBnb = parseFloat(a[++i]);
    else if (k === '--max-pairs') o.maxPairs = parseInt(a[++i], 10);
    else if (k === '--min-ticks-per-token') o.minTicksPerToken = parseInt(a[++i], 10);
    else if (k === '--pair-min-buy-bnb') o.pairMinBuyBnb = parseFloat(a[++i]);
    else if (k === '--win-eps-bnb') o.winEpsBnb = parseFloat(a[++i]);
    else if (k === '--cost-per-side') o.costPerSide = parseFloat(a[++i]);
    else if (k === '--carryin-tol') o.carryinTol = parseFloat(a[++i]);
    else if (k === '--carryin-warn-share') o.carryinWarnShare = parseFloat(a[++i]);
    else if (k === '--bad-cats') o.badCats = a[++i];
    else if (k === '--max-bad-share') o.maxBadShare = parseFloat(a[++i]);
    else if (k === '--halves-min-n') o.halvesMinN = parseInt(a[++i], 10);
    else if (k === '--active-min-tokens') o.activeMinTokens = parseInt(a[++i], 10);
    else if (k === '--active-min-winrate') o.activeMinWinrate = parseFloat(a[++i]);
    else if (k === '--active-min-realized-share') o.activeMinRealizedShare = parseFloat(a[++i]);
    else if (k === '--active-min-mean') o.activeMinMean = parseFloat(a[++i]);
    else if (k === '--no-active-stability') o.activeStability = false;
    else if (k === '--sharp-min-tokens') o.sharpMinTokens = parseInt(a[++i], 10);
    else if (k === '--sharp-max-tokens') o.sharpMaxTokens = parseInt(a[++i], 10);
    else if (k === '--sharp-min-winrate') o.sharpMinWinrate = parseFloat(a[++i]);
    else if (k === '--sharp-min-mean') o.sharpMinMean = parseFloat(a[++i]);
    else if (k === '--sharp-min-median-buy') o.sharpMinMedianBuy = parseFloat(a[++i]);
    else if (k === '--sharp-min-realized-share') o.sharpMinRealizedShare = parseFloat(a[++i]);
    else if (k === '--sharp-max-single-share') o.sharpMaxSingleShare = parseFloat(a[++i]);
    else if (k === '--sharp-min-days') o.sharpMinDays = parseInt(a[++i], 10);
    else if (k === '--sharp-max-raw-total') o.sharpMaxRawTotal = parseInt(a[++i], 10);
    else if (k === '--ab-entry-window-s') o.abEntryWindowS = parseFloat(a[++i]);
    else if (k === '--ab-controls') o.abControls = parseInt(a[++i], 10);
    else if (k === '--ab-caliper-h') o.abCaliperH = parseFloat(a[++i]);
    else if (k === '--ab-heat-edges') o.abHeatEdges = a[++i];
    else if (k === '--ab-min-survival-lift') o.abMinSurvivalLift = parseFloat(a[++i]);
    else if (k === '--ab-min-buyer-lift') o.abMinBuyerLift = parseFloat(a[++i]);
    else if (k === '--ab-min-a-tokens') o.abMinATokens = parseInt(a[++i], 10);
    else if (k === '--ab-max-tokens') o.abMaxTokens = parseInt(a[++i], 10);
    else if (k === '--null-sample-wallets') o.nullSampleWallets = parseInt(a[++i], 10);
    else if (k === '--null-seed') o.nullSeed = parseInt(a[++i], 10);
    else if (k === '--ring-jaccard') o.ringJaccard = parseFloat(a[++i]);
    else if (k === '--lead-lag-blocks') o.leadLagBlocks = parseInt(a[++i], 10);
    else if (k === '--leadlag-bot-rate') o.leadlagBotRate = parseFloat(a[++i]);
    else { console.error(`未知参数: ${k}`); process.exit(1); }
  }
  o._badCats = new Set(o.badCats.split(',').map(s => s.trim()).filter(Boolean));
  o._heatEdges = o.abHeatEdges.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
  o._caliperMs = o.abCaliperH * 3600000;
  o._anchors = o.anchorWallets.split(',').map(s => s.trim()).filter(Boolean);
  return o;
}

// ══════════════════════════ 纯函数（供 verify 脚本同一代码路径对账） ══════════════════════════

// mark 价选择：prices = 有效价时序 [{t,k,p}...]（已过滤 outlier/尘额），取末位价与前 ≤10 条的中位比对，
// 偏离 >1000×（尘 tick 单笔价偏 e7 倍特征）则向前回退到最近不偏离者。返回 {mark, replaced, checked}。
function selectMark(prices) {
  if (!prices || !prices.length) return { mark: null, replaced: false, checked: 0 };
  const n = prices.length;
  const last = prices[n - 1];
  const prev = prices.slice(Math.max(0, n - 11), n - 1);
  if (!prev.length) return { mark: last.p, replaced: false, checked: n };
  const s = [...prev].sort((a, b) => a.p - b.p);
  const m = s[s.length >> 1].p;
  if (m > 0 && (last.p < m / 1000 || last.p > m * 1000)) {
    for (let i = n - 2; i >= 0; i--) { const pi = prices[i].p; if (!(pi < m / 1000 || pi > m * 1000)) return { mark: pi, replaced: true, checked: n }; }
    return { mark: m, replaced: true, checked: n }; // 全窗皆偏（极端），退中位
  }
  return { mark: last.p, replaced: false, checked: n };
}

// carry-in 判定：合并全源后该 (钱包,票) 配对的窗口边界问题。
// p = {bs,bt,ss,st,fbt,fbk,fst,fsk,ft,fk,ftp}（fbt=首买 ts, fbk=首买 block, Infinity 表无）
// 返回 null（干净）| 'sellFirst'（首笔为卖=窗口前已有仓位）| 'overSell'（卖出量>买入量=链下置换）| 'ambig'（首买首卖同 (ts,block) 歧义）
function classifyCarryIn(p, tol) {
  if (p.fbt === Infinity) return 'sellFirst';                 // 全窗无买入（纯卖=carry-in 卖方）
  if (p.fst !== Infinity && p.fst === p.fbt && p.fsk === p.fbk) return 'ambig';
  if (p.ftp === 's' && !(p.fst === p.fbt && p.fsk === p.fbk)) return 'sellFirst';
  if (p.bt > 0 && p.st > p.bt * (1 + tol)) return 'overSell';
  return null;
}

// 每票净 PnL（无配对恒等式）+ 平均成本分解 + 成本稳健列。
// p 含 bs/bt/ss/st（BNB 与 token UI 单位累计），mark=该票清算 mark 价。
function computePairPnL(p, mark, opt) {
  const invTok = p.bt - p.st;
  const net = p.ss + invTok * mark - p.bs;
  const avgBuyPx = p.bt > 0 ? p.bs / p.bt : 0;
  const realized = p.ss - p.st * avgBuyPx;
  const unreal = invTok * (mark - avgBuyPx);                   // 剩余持仓浮盈（非市值）；realized+unreal ≡ net（恒等）
  const c = opt.costPerSide;
  const netAfterCost = p.ss * (1 - c) + Math.max(invTok, 0) * mark * (1 - c) - p.bs * (1 + c);
  return { net, realized, unreal, invTok, roi: p.bs > 0 ? net / p.bs : NaN, netAfterCost };
}

// 两批门槛（纯函数）。summaries 元素见 buildSummaries。
// 返回 {batch1:[], batch2:[], funnel:{...}}；双达标归批2（更稀缺）。
function gateWallets(summaries, opt) {
  const f = { total: summaries.length, hasQualified: 0, minTokens: 0, active: 0, activeRealizedCut: 0, sharp: 0, badCatCut: 0 };
  const b1 = [], b2 = [];
  for (const s of summaries) {
    if (s.n < 1) continue;
    f.hasQualified++;
    const winRate = s.wins / s.n;
    const meanNet = s.sumNet / s.n;
    // 批2 稳准狠（先判，双达标归批2）
    const realizedShare = s.sumNet > 0 ? s.sumReal / s.sumNet : NaN;
    const singleShare = s.posNetSum > 0 ? s.maxPosNet / s.posNetSum : 1;
    let isSharp = false;
    if (s.n >= opt.sharpMinTokens && s.n <= opt.sharpMaxTokens
      && winRate >= opt.sharpMinWinrate && meanNet >= opt.sharpMinMean
      && s.medianBuyBnb >= opt.sharpMinMedianBuy
      && Number.isFinite(realizedShare) && realizedShare >= opt.sharpMinRealizedShare
      && singleShare <= opt.sharpMaxSingleShare
      && s.days.size >= opt.sharpMinDays
      && s.rawTotalRun < opt.sharpMaxRawTotal) { isSharp = true; f.sharp++; }
    // 批1 活跃持续盈利（realizedShare 门防断流票纸面富贵——囤到断流的 mark 浮盈不可跟随）
    let isActive = false;
    if (s.n >= opt.activeMinTokens && winRate >= opt.activeMinWinrate && meanNet >= opt.activeMinMean) {
      if (!Number.isFinite(realizedShare) || realizedShare < opt.activeMinRealizedShare) f.activeRealizedCut++;
      else if (!opt.activeStability || (s.halves.h1.mean > 0 && s.halves.h2.mean > 0
        && s.halves.h1.n >= opt.halvesMinN && s.halves.h2.n >= opt.halvesMinN)) { isActive = true; f.active++; }
    }
    if (s.n >= Math.min(opt.sharpMinTokens, opt.activeMinTokens)) f.minTokens++;
    if (!isActive && !isSharp) continue;
    // 公共门：bad 类目占比
    if (s.badShare > opt.maxBadShare) { f.badCatCut++; continue; }
    s.winRate = winRate; s.meanNet = meanNet; s.medianNet = q(s.nets, 0.5);
    s.realizedShare = Number.isFinite(realizedShare) ? realizedShare : null;
    s.singleShare = singleShare;
    if (isSharp) b2.push(s); else b1.push(s);
  }
  b1.sort((x, y) => (y.meanNet - x.meanNet) || (y.sumNet - x.sumNet));
  b2.sort((x, y) => (y.meanNet - x.meanNet) || (y.sumNet - x.sumNet));
  return { batch1: b1, batch2: b2, funnel: f };
}

// A/B 对照匹配（纯函数）。aToks/pool 元素 = {token, cat, heat, firstTs}；cat=null 的项不可作对照/不可作 A。
// 同 category + 同 uniqueTraders 热度桶 + firstTs 差 ≤ _caliperMs，不放回，每 A 最多 abControls 张。
function heatBucket(heat, edges) { let i = 0; while (i < edges.length && heat > edges[i]) i++; return i; }
function matchABControls(aToks, pool, opt) {
  const aSet = new Set(aToks.map(t => t.token));
  const groups = new Map(); // (cat,bucket) → 按 firstTs 升序数组
  for (const t of pool) {
    if (aSet.has(t.token) || !t.cat || t.heat == null || t.firstTs == null) continue;
    const key = t.cat + '|' + heatBucket(t.heat, opt._heatEdges);
    let g = groups.get(key); if (!g) groups.set(key, g = []);
    g.push(t);
  }
  for (const g of groups.values()) g.sort((a, b) => a.firstTs - b.firstTs);
  const used = new Set();
  const out = new Map(); let unmatched = 0;
  for (const at of aToks) {
    const g = (at.cat && at.heat != null && at.firstTs != null) ? groups.get(at.cat + '|' + heatBucket(at.heat, opt._heatEdges)) : null;
    const ctrls = [];
    if (g) {
      // 二分找 firstTs 位置，向两侧扩展取时间最近的未用对照
      let lo = 0, hi = g.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid].firstTs < at.firstTs) lo = mid + 1; else hi = mid; }
      let i = lo - 1, j = lo;
      while (ctrls.length < opt.abControls && (i >= 0 || j < g.length)) {
        let cand;
        if (i >= 0 && j < g.length) cand = (at.firstTs - g[i].firstTs <= g[j].firstTs - at.firstTs) ? g[i--] : g[j++];
        else if (i >= 0) cand = g[i--]; else cand = g[j++];
        if (used.has(cand.token) || Math.abs(cand.firstTs - at.firstTs) > opt._caliperMs) continue;
        used.add(cand.token); ctrls.push(cand);
      }
    }
    if (!ctrls.length) unmatched++;
    out.set(at.token, ctrls);
  }
  return { controlsByToken: out, unmatched };
}

// lead-lag（纯函数）：timeline = 该票全部首买 [{ts,block,w,bnb}] 已按 (ts,block) 升序；self = 目标钱包地址。
// selfKey = self 首买 (ts,block)。follow = 存在他人首买严格早于 self 且 block 差 ≤ maxBlockDiff（跟单 bot 特征：恰好下一 block）；
// lead = 存在他人首买严格晚于 self 且 block 差 ≤ maxBlockDiff。leader = 最近先行者。
function leadLagOnToken(timeline, self, selfKey, maxBlockDiff) {
  let follow = false, lead = false, leader = null, leaderKey = null;
  for (const e of timeline) {
    if (e.w === self) continue;
    const before = (e.ts < selfKey.ts) || (e.ts === selfKey.ts && e.block < selfKey.block);
    const after = (e.ts > selfKey.ts) || (e.ts === selfKey.ts && e.block > selfKey.block);
    const sd = e.block - selfKey.block;
    if (before && sd <= 0 && sd >= -maxBlockDiff) {
      follow = true;
      if (!leaderKey || (e.ts > leaderKey.ts) || (e.ts === leaderKey.ts && e.block > leaderKey.block)) { leader = e.w; leaderKey = { ts: e.ts, block: e.block }; }
    }
    if (after && sd >= 0 && sd <= maxBlockDiff) lead = true;
  }
  return { follow, lead, leader };
}

// 协作环检测（纯）：listed 已按 meanNet 排序；对每个钱包在合格票集上找"排名更靠前者的最大 Jaccard"，
// ≥ringJaccard 标"疑似同组@rank"。环内纸面盈利互为镜像，名单须标注去重解读。
function detectRings(listed, tokenSets, opt) {
  const inv = new Map(); // token → 已遍历钱包 idx 列表（排名靠前）
  let ringCount = 0;
  for (let i = 0; i < listed.length; i++) {
    const si = tokenSets[i];
    let best = -1, bestJ = 0;
    if (si && si.size) {
      const cnt = new Map();
      for (const tk of si) {
        const lst = inv.get(tk);
        if (!lst) continue;
        for (const j of lst) cnt.set(j, (cnt.get(j) || 0) + 1);
      }
      for (const [j, c] of cnt) {
        const sj = tokenSets[j];
        const un = si.size + sj.size - c;
        const J = un > 0 ? c / un : 0;
        if (J > bestJ) { bestJ = J; best = j; }
      }
    }
    if (best >= 0 && bestJ >= opt.ringJaccard) {
      listed[i].ringWith = best; listed[i].ringJ = bestJ; ringCount++;
    }
    if (si) for (const tk of si) { let l = inv.get(tk); if (!l) inv.set(tk, l = []); l.push(i); }
  }
  return ringCount;
}

// lead-lag 时间线窗口（纯）：焦点钱包在票上的首买 (fbt,fbk)；follow/lead 只用 block∈[fbk-1,fbk+1] 的事件，
// 窗口取 ±1200ms/±(maxBlockDiff+1) block 的并集边界（过包含=安全，判序仍用复合键）。
function buildFocusWindows(pairLists, maxBlockDiff) {
  const win = new Map(); // token → {minTs,maxTs,minBlock,maxBlock}
  const upd = (tk, fbt, fbk) => {
    let w = win.get(tk);
    if (!w) win.set(tk, w = { minTs: Infinity, maxTs: -Infinity, minBlock: Infinity, maxBlock: -Infinity });
    if (fbt - 1200 < w.minTs) w.minTs = fbt - 1200;
    if (fbt + 1200 > w.maxTs) w.maxTs = fbt + 1200;
    const s0 = Number.isFinite(fbk) ? fbk : 0;
    if (s0 - maxBlockDiff - 1 < w.minBlock) w.minBlock = s0 - maxBlockDiff - 1;
    if (s0 + maxBlockDiff + 1 > w.maxBlock) w.maxBlock = s0 + maxBlockDiff + 1;
  };
  for (const arr of pairLists) for (const x of arr) upd(x.token, x.fbt, x.fbk != null ? x.fbk : 0);
  return win;
}

// 可复现随机（LCG，与 verify 同式）：零假设抽样可复查
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

// ══════════════════════════ 阶段 0：源计划 ══════════════════════════
// ★BSC：virtual + blockchain='bsc'，客户端再滤掉 config.platform==='flap'（flap 实验与 four.meme
// 共享 wss_price_ticks，platform='flap' 的 tick 混入会污染口径）。显式 --experiments 时不滤（用户自担）。
async function pickSources(opt, client) {
  let exps;
  if (opt.experiments) {
    const ids = opt.experiments.split(',').map(s => s.trim()).filter(Boolean);
    const { data, error } = await client.from('experiments').select('id,experiment_name,status,created_at').in('id', ids);
    if (error) throw new Error(`实验查询失败: ${error.message}`);
    exps = data || [];
  } else {
    const since = new Date(now() - opt.days * 86400000).toISOString();
    const { data, error } = await client.from('experiments')
      .select('id,experiment_name,status,created_at,config')
      .eq('trading_mode', 'virtual').eq('blockchain', 'bsc').gte('created_at', since)
      .order('created_at', { ascending: true }).limit(500);
    if (error) throw new Error(`实验查询失败: ${error.message}`);
    exps = (data || []).filter(e => !(e.config && e.config.platform === 'flap'));
  }
  const BAD_STATUS = new Set(['failed', 'pending', 'initializing']);
  const dropped = exps.filter(e => BAD_STATUS.has(e.status));
  const cands = exps.filter(e => !BAD_STATUS.has(e.status));   // 不排 running（daily 铁律）
  const out = [];
  for (const e of cands) {
    const { data } = await client.from('wss_price_ticks').select('received_at')
      .eq('experiment_id', e.id).order('received_at', { ascending: false }).limit(1);
    if (data && data.length) out.push({ id: e.id, name: e.experiment_name || '', status: e.status, created: e.created_at });
  }
  console.log(`[阶段0] virtual+bsc 实验 ${exps.length} 个（丢状态 ${dropped.length}: ${dropped.map(d => id8(d.id)).join(',') || '无'}），有 ticks ${out.length} 个`);
  return out;
}

// ══════════════════════════ token 元数据（★BSC 双路） ══════════════════════════
// 路1 分类：token_profiles 全局表（批 3.1；token_address 主键）→ category/first_tick/unique_traders/
//   peakTimeS/maxMcapUsd。页式 .in()（500/页，PostgREST URL 长度护栏）。
// 路2 链上静态：experiment_tokens（(experiment_id,token_address) 多行）→ creator_address + raw_api_data.totalSupply。
//   按实验逐个 token_address keyset 分页（OFFSET 深分页在大源上每页重复扫描，母版实证超时）。
// 返回 meta: Map(token → {category, firstTick, lastTick, uniqueTraders, peakTimeS, maxMcapUsd,
//   creator, totalSupply})；无分类行的 token 也在（category=null），留给 applyFallbackClassification 现算。
async function fetchTokenMeta(expIds, tokenSet, client) {
  const toks = [...tokenSet];
  const meta = new Map();
  for (let i = 0; i < toks.length; i++) meta.set(toks[i], { category: null, firstTick: null, lastTick: null, uniqueTraders: null, peakTimeS: null, maxMcapUsd: null, creator: null, totalSupply: 0 });

  // 路1：token_profiles（全局表，与实验无关）
  const PAGE_TP = 500;
  let tpRows = 0;
  for (let i = 0; i < toks.length; i += PAGE_TP) {
    const page = toks.slice(i, i + PAGE_TP);
    const { data, error } = await client.from('token_profiles')
      .select('token_address,category,peak_mcap_usd,profile')
      .in('token_address', page);
    if (error) throw new Error(`token_profiles 查询失败: ${error.message}`);
    for (const r of (data || [])) {
      const m = meta.get(r.token_address);
      if (!m) continue;
      const prof = r.profile || {};
      const ci = prof.class_info || {};
      const num = x => Number.isFinite(+x) ? +x : null;
      m.category = r.category ?? null;
      m.firstTick = num(prof.first_tick_time); m.lastTick = num(prof.last_tick_time);
      m.uniqueTraders = num(ci.uniqueTraders); m.peakTimeS = num(ci.peakTimeSeconds);
      m.maxMcapUsd = num(r.peak_mcap_usd != null ? r.peak_mcap_usd : ci.maxMarketCap);
      tpRows++;
    }
    if ((i / PAGE_TP) % 40 === 39) console.log(`  [元数据] token_profiles 已 ${Math.min(i + PAGE_TP, toks.length)}/${toks.length}，命中 ${tpRows}`);
  }

  // 路2：experiment_tokens（creator + totalSupply；按实验 keyset 翻页，本地按 created_at 去重取最新行）
  const raw = new Map(); // addr → { ca, row }
  const PAGE = 1000;
  let pages = 0, rows = 0;
  for (let ei = 0; ei < expIds.length; ei++) {
    const eid = expIds[ei];
    // 翻页键=token_address：对齐 (experiment_id,token_address) 唯一性，eq+gt+order 是索引范围扫描零排序
    let lastAddr = null;
    while (true) {
      let data = null, lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        let qq = client.from('experiment_tokens')
          .select('token_address,creator_address,raw_api_data,created_at')
          .eq('experiment_id', eid)
          .order('token_address', { ascending: true })
          .limit(PAGE);
        if (lastAddr != null) qq = qq.gt('token_address', lastAddr);
        const res = await qq;
        if (!res.error) { data = res.data; lastErr = null; break; }
        lastErr = res.error;
        console.warn(`  [元数据] src${ei + 1}/${expIds.length} addr>${lastAddr ?? '(首页)'} 第${attempt}次失败: ${lastErr.message}${attempt < 3 ? `，${5 * attempt}s 后重试` : '，放弃'}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt));
      }
      if (lastErr) throw new Error(`token 元数据查询失败(src ${eid.slice(0, 8)} addr>${String(lastAddr).slice(0, 8)}): ${lastErr.message}`);
      if (!data || !data.length) break;
      rows += data.length;
      for (const r of data) {
        if (!tokenSet.has(r.token_address)) continue;
        const ca = r.created_at ? new Date(r.created_at).getTime() : 0;
        const cur = raw.get(r.token_address);
        if (cur && cur.ca >= ca) continue; // 已有更新行
        raw.set(r.token_address, { ca, row: r });
      }
      lastAddr = data[data.length - 1].token_address;
      pages++;
      if (pages % 40 === 0) console.log(`  [元数据] experiment_tokens 已 ${pages} 页 ${rows} 行，命中 ${raw.size}/${tokenSet.size}`);
      if (data.length < PAGE) break;
    }
  }
  for (const [tk, v] of raw) {
    const m = meta.get(tk);
    if (!m) continue;
    m.creator = v.row.creator_address || null;
    const ts = Number(v.row.raw_api_data && v.row.raw_api_data.totalSupply);
    m.totalSupply = Number.isFinite(ts) && ts > 0 ? ts : 0;
  }
  let known = 0;
  for (const v of meta.values()) if (v.category != null) known++;
  console.log(`  元数据: token_profiles 命中 ${tpRows} / experiment_tokens ${pages} 页 ${rows} 行命中 ${raw.size} → 分类已知 ${known}/${toks.length}`);
  return meta;
}

// ══════════════════════════ 阶段 1：折叠 ══════════════════════════
function newGlobal() {
  return {
    internTok: new Map(), internWal: new Map(),
    pairs: new Map(),            // token → Map(wallet → pairAgg)
    tokenState: new Map(),       // token → {n, ft, lt, ls, pr:[{t,k,p}], mark, cls, traders}
    walletTokens: new Map(),     // wallet → {n, capped, set:Set|null}（RAW_TOKEN_CAP 截断）
    nPairs: 0,
    stats: { ticks: 0, outlier: 0, dust: 0, identityMismatch: 0, identityChecked: 0, prunedPairs: 0, deadTokens: 0 },
    srcStats: [],                // 每源 {idx, id8, name, ticks, kept, minT, maxT, ms}
  };
}

// 单源折叠（热循环，保持紧凑）。srcStat.idx = 当前源序号（1 起），用于 tokenState.ls 落寂追踪。
// ★BSC：bnb_amount/price_bnb 十进制直用；次序键 (block_time, block_number)；cls=分类 slim tick 缓冲
// （含尘/outlier，priceReliable=!outlier&&px>0&&bnb≥minTickBnb——落库 price_outlier 即 FA 写时判定，
// 离线近似在线 _acceptPrice 口径），cap CLS_TICKS_CAP 后停推（traders 继续累计）。
function foldTicks(ticks, G, opt, srcStat) {
  const minBnb = opt.minTickBnb;
  const srcIdx = srcStat ? srcStat.idx : 0;
  for (const t of ticks) {
    if (!t.token_address || !t.trader_address) continue;
    const isBuy = String(t.trade_type).toLowerCase() === 'buy';
    const ts = new Date(t.block_time).getTime();
    if (!Number.isFinite(ts)) continue;
    const slot = t.block_number != null ? Number(t.block_number) : 0;
    const bnb = +t.bnb_amount || 0;
    const px = +t.price_bnb;

    // token 驻留（先于过滤：尘/outlier tick 也进 cls 缓冲供 fallback 分类，与在线 OPB 全量口径一致）
    let tk = G.internTok.get(t.token_address);
    if (tk === undefined) { tk = t.token_address; G.internTok.set(tk, tk); }
    let tSt = G.tokenState.get(tk);
    if (!tSt) G.tokenState.set(tk, tSt = { n: 0, ft: Infinity, lt: -Infinity, ls: srcIdx, pr: [], mark: null, cls: [], traders: new Set() });
    if (tSt.cls) {
      if (tSt.cls.length < CLS_TICKS_CAP) {
        tSt.cls.push({
          ts, isBuy, bnbAmount: bnb, priceBnb: px > 0 ? px : 0,
          priceUsd: t.price_usd != null ? +t.price_usd : null,
          traderAddress: t.trader_address,
          blockNumber: slot, priceReliable: !t.price_outlier && px > 0 && bnb >= minBnb,
        });
      }
      tSt.traders.add(t.trader_address);
    }

    if (t.price_outlier) { G.stats.outlier++; continue; }
    if (bnb < minBnb) { G.stats.dust++; continue; }
    if (ts < tSt.ft) tSt.ft = ts; if (ts > tSt.lt) tSt.lt = ts; tSt.ls = srcIdx;   // kept 才更新（母版口径）
    tSt.n++;
    if (srcStat) { srcStat.kept++; if (ts < srcStat.minT) srcStat.minT = ts; if (ts > srcStat.maxT) srcStat.maxT = ts; }
    G.stats.ticks++;

    if (px > 0) { tSt.pr.push({ t: ts, k: slot, p: px }); if (tSt.pr.length > 11) tSt.pr.shift(); }

    // 价量恒等式抽样自检（price_bnb×token_amount≈bnb_amount，每 8192 条抽 1）
    if ((G.stats.ticks & 8191) === 0 && px > 0 && +t.token_amount > 0) {
      G.stats.identityChecked++;
      const rel = Math.abs(px * (+t.token_amount) - bnb) / Math.max(bnb, 1e-12);
      if (rel > 0.02) G.stats.identityMismatch++;
    }

    // 钱包参与计数（cap）
    let w = G.internWal.get(t.trader_address);
    if (w === undefined) { w = t.trader_address; G.internWal.set(w, w); }
    let wt = G.walletTokens.get(w);
    if (!wt) G.walletTokens.set(w, wt = { n: 0, capped: false, set: new Set() });
    if (!wt.capped) {
      wt.set.add(tk);
      if (wt.set.size >= RAW_TOKEN_CAP) { wt.capped = true; wt.n = RAW_TOKEN_CAP; wt.set = null; }
      else wt.n = wt.set.size;
    }

    // 配对
    let tm = G.pairs.get(tk);
    if (!tm) G.pairs.set(tk, tm = new Map());
    let p = tm.get(w);
    if (!p) { tm.set(w, p = { bs: 0, ss: 0, bt: 0, st: 0, nb: 0, ns: 0, fbt: Infinity, fbk: Infinity, fst: Infinity, fsk: Infinity, ft: Infinity, fk: Infinity, ftp: '' }); G.nPairs++; }
    if (isBuy) { p.bs += bnb; p.bt += (+t.token_amount || 0); p.nb++; if (ts < p.fbt || (ts === p.fbt && slot < p.fbk)) { p.fbt = ts; p.fbk = slot; } }
    else { p.ss += bnb; p.st += (+t.token_amount || 0); p.ns++; if (ts < p.fst || (ts === p.fst && slot < p.fsk)) { p.fst = ts; p.fsk = slot; } }
    if (ts < p.ft || (ts === p.ft && slot < p.fk)) { p.ft = ts; p.fk = slot; p.ftp = isBuy ? 'b' : 's'; }
  }
}

// 增量剪枝。curSrc=当前源序号（折叠期）或 Infinity（终剪）。
//   尘配对（buyBnb+sellBnb<阈）：仅当 token 落寂 ≥PRUNE_AGE_SOURCES（折叠期）或终剪（无回魂可能）才删——
//   活跃期删尘会丢"先 0.01 后 0.5 BNB"钱包的前段买额，PnL 被高估。
//   整树剪（nTicks<minTicks 且无分类）：只在终剪做（meta 到手后；fallback 分类后几乎不触发=口径内）。
function prunePairs(G, opt, meta, curSrc) {
  let prunedP = 0, deadTokens = 0;
  const dead = [];
  for (const [tk, tm] of G.pairs) {
    const st = G.tokenState.get(tk);
    // 终剪：微小 token 整树剪（无分类 → 无判读价值）
    if (meta && st && st.n < opt.minTicksPerToken && !(meta.has(tk) && meta.get(tk).category != null)) {
      prunedP += tm.size; G.nPairs -= tm.size; dead.push(tk); continue;
    }
    // 尘配对：token 落寂门（终剪 curSrc=Infinity 恒过）
    const dormant = !st || curSrc === Infinity || st.ls <= curSrc - PRUNE_AGE_SOURCES;
    if (dormant) {
      for (const [w, p] of tm) {
        if (p.bs + p.ss < opt.pass1PairMinBnb) { tm.delete(w); G.nPairs--; prunedP++; }
      }
    }
    if (tm.size === 0) dead.push(tk);  // 无配对存活：pairs 删掉（tokenState 保留供对照池用）
  }
  for (const tk of dead) { G.pairs.delete(tk); deadTokens++; }
  G.stats.prunedPairs += prunedP; G.stats.deadTokens += deadTokens;
  return prunedP;
}

// ══════════════════════════ fallback 分类（★BSC 新增，纯函数） ══════════════════════════
// token_profiles 无行的 token：用折叠期攒的 cls slim tick 缓冲 + experiment_tokens 的 totalSupply
// 内嵌现算（与在线分类器同一 classifyToken 代码）。窗口截断注意：挖掘窗=实验覆盖窗，晚于 token 生命
// 开始的 tick 不在窗内，分类口径与在线全窗有偏（多数 token 全生命周期 < 挖掘窗，偏差有限，README 注明）。
// 处理完（无论命中与否）清空 cls/traders 释放内存。返回 fallback 数。
function applyFallbackClassification(G, meta) {
  let n = 0;
  for (const [tk, st] of G.tokenState) {
    const m = meta.get(tk);
    if (m && m.category != null) { st.cls = null; st.traders = null; continue; }
    const r = classifyToken(st.cls || [], { totalSupply: m ? m.totalSupply : 0 });
    const ci = r.classInfo || {};
    if (m) {
      m.category = r.category;
      m.firstTick = r.firstTickTime != null ? r.firstTickTime : m.firstTick;
      m.lastTick = r.lastTickTime != null ? r.lastTickTime : m.lastTick;
      m.uniqueTraders = ci.uniqueTraders != null ? ci.uniqueTraders : (st.traders ? st.traders.size : null);
      m.peakTimeS = ci.peakTimeSeconds != null ? ci.peakTimeSeconds : null;
      m.maxMcapUsd = r.maxMarketCap > 0 ? r.maxMarketCap : null;
    }
    n++;
    st.cls = null; st.traders = null;
  }
  return n;
}

// ══════════════════════════ 阶段 2：配对 PnL 归约 ══════════════════════════
// byWallet: Map<w,{n,wins,sumNet,sumReal,sumUnreal,sumNAC,sumBuy,sumSell,posNetSum,maxPosNet,
//                  nets[],buys[],fbts[],days:Set,rawPairs,carry{...},catCount:Map<cid,_cnt>}]
function reducePairs(G, meta, opt) {
  const byWallet = new Map();
  const buckets = { sellFirst: 0, overSell: 0, ambig: 0, belowMin: 0, creatorSkip: 0, noMark: 0, qualified: 0 };
  const catId = new Map(); let nextCatId = 1;
  const getCid = c => { const k = c == null ? '~null' : c; if (!catId.has(k)) catId.set(k, nextCatId++); return catId.get(k); };
  for (const c of ['wash', 'pump_dump', 'high_mcap_wash', 'high_mcap', 'quality', 'normal', 'low_quality', 'low_activity', '~null']) getCid(c);
  const catById = new Map([...catId.entries()].map(([k, v]) => [v, k === '~null' ? null : k]));
  for (const [tk, tm] of G.pairs) {
    const m = meta ? meta.get(tk) : null;
    const st = G.tokenState.get(tk);
    const mark = st ? st.mark : null;
    const cid = getCid(m ? m.category : null);
    // ★BSC creator 比较大小写不敏感（EVM 同一地址 mixed-case checksum 两种存法都算自买）
    const creatorLc = m && m.creator ? String(m.creator).toLowerCase() : null;
    for (const [w, p] of tm) {
      let e = byWallet.get(w);
      if (!e) byWallet.set(w, e = { n: 0, wins: 0, sumNet: 0, sumReal: 0, sumUnreal: 0, sumNAC: 0, sumBuy: 0, sumSell: 0, posNetSum: 0, maxPosNet: 0, nets: [], buys: [], fbts: [], days: new Set(), rawPairs: 0, carry: { sellFirst: 0, overSell: 0, ambig: 0 }, catCount: new Map() });
      e.rawPairs++;
      const carry = classifyCarryIn(p, opt.carryinTol);
      if (carry) { buckets[carry]++; e.carry[carry]++; continue; }
      if (p.bs < opt.pairMinBuyBnb) { buckets.belowMin++; continue; }
      if (creatorLc && creatorLc === w.toLowerCase()) { buckets.creatorSkip++; continue; }
      if (mark == null) { buckets.noMark++; continue; }
      const pnl = computePairPnL(p, mark, opt);
      const win = pnl.net > opt.winEpsBnb ? 1 : 0;
      e.n++; e.wins += win; e.sumNet += pnl.net; e.sumReal += pnl.realized; e.sumUnreal += pnl.unreal; e.sumNAC += pnl.netAfterCost;
      e.sumBuy += p.bs; e.sumSell += p.ss;
      if (pnl.net > 0) { e.posNetSum += pnl.net; if (pnl.net > e.maxPosNet) e.maxPosNet = pnl.net; }
      e.nets.push(pnl.net); e.buys.push(p.bs); e.fbts.push(p.fbt); e.days.add(utcDay(p.fbt));
      e.catCount.set(cid, (e.catCount.get(cid) || 0) + 1);
      buckets.qualified++;
    }
  }
  return { byWallet, buckets, catById };
}

// 钱包 summary 组装（含 halves 稳定性=按该钱包自身合格配对首买时间中位对半切）
function buildSummaries(byWallet, G) {
  const out = [];
  for (const [w, e] of byWallet) {
    if (e.n < 1) continue;
    const med = q(e.fbts, 0.5);
    let h1n = 0, h1sum = 0, h2n = 0, h2sum = 0;
    for (let i = 0; i < e.n; i++) { if (e.fbts[i] <= med) { h1n++; h1sum += e.nets[i]; } else { h2n++; h2sum += e.nets[i]; } }
    const wt = G.walletTokens.get(w);
    out.push({
      address: w, n: e.n, wins: e.wins, sumNet: e.sumNet, sumReal: e.sumReal, sumUnreal: e.sumUnreal, sumNAC: e.sumNAC,
      sumBuy: e.sumBuy, sumSell: e.sumSell, posNetSum: e.posNetSum, maxPosNet: e.maxPosNet,
      nets: e.nets, buys: e.buys, fbts: e.fbts, days: e.days, rawPairs: e.rawPairs, carry: e.carry, catCount: e.catCount,
      medianBuyBnb: q(e.buys, 0.5),
      halves: { h1: { n: h1n, mean: h1n ? h1sum / h1n : NaN }, h2: { n: h2n, mean: h2n ? h2sum / h2n : NaN } },
      rawTotalRun: wt ? wt.n : 0,
      carryInShare: e.rawPairs ? (e.carry.sellFirst + e.carry.overSell + e.carry.ambig) / e.rawPairs : 0,
      _e: e,
    });
  }
  return out;
}

// bad/unknown 类目占比（catById 反查）
function fillCatShares(summaries, catById, badCats) {
  for (const s of summaries) {
    let bad = 0, unk = 0;
    for (const [cid, cnt] of s.catCount) {
      const c = catById.get(cid);
      if (c == null) unk += cnt; else if (badCats.has(c)) bad += cnt;
    }
    s.badShare = s.n ? bad / s.n : 0; s.unknownShare = s.n ? unk / s.n : 0;
  }
}

// ══════════════════════════ 阶段 4：画像 enrich（★BSC 缩减版） ══════════════════════════
// richer-js wallets 表只有 {id,address,chain,name,category}——无 tags/clusters/token_participation，
// insider/coords 簇重叠与 flatPart 均不迁。仅取现有 category 做 --apply 冲突预检
// （非空且非 smart_bot/smart_money = 人工标注，--apply 跳过并告警，挖掘产出仍列出+标注）。
async function enrichWallets(addrs, client) {
  const rows = [];
  for (let i = 0; i < addrs.length; i += 300) {
    const { data, error } = await client.from('wallets').select('address,category').in('address', addrs.slice(i, i + 300));
    if (error) throw new Error(`wallets 查询失败: ${error.message}`);
    if (data) rows.push(...data);
  }
  return new Map(rows.map(r => [r.address, r]));
}

// ══════════════════════════ 阶段 5：受限重扫（首买时间线） ══════════════════════════
// tokenSet 限定 → 每源缓存重扫一遍，产出 token → [{ts,block,w,bnb}]（该票全部买家首买，含小额）。
// focusWin（可选）：token→窗口边界——仅 lead-lag 侧票使用；lead-lag 判序只用首买 ±1 block 的事件，
// 窗口过滤后每票仅存几条~几十条（全量时间线大票数会爆内存，母版实证截断丢票漏标）。
async function pass3Timelines(sources, tokenSet, opt, tickCache, focusWin) {
  const timeline = new Map();
  for (const tk of tokenSet) timeline.set(tk, new Map());
  let scanned = 0;
  for (const s of sources) {
    if (!tickCache.has(s.id)) continue;  // 阶段1 刚拉过，必命中；不命中=异常，靠 scanned 计数暴露
    const ticks = await tickCache.load(s.id);
    scanned++;
    for (const t of ticks) {
      if (t.price_outlier) continue;
      const tk = t.token_address;
      if (!tk || !timeline.has(tk)) continue;
      if (String(t.trade_type).toLowerCase() !== 'buy' || !t.trader_address) continue;
      const bnb = +t.bnb_amount || 0;
      if (bnb < opt.minTickBnb) continue;
      const ts = new Date(t.block_time).getTime();
      const slot = t.block_number != null ? Number(t.block_number) : 0;
      const w = focusWin ? focusWin.get(tk) : null;
      if (w && (ts < w.minTs || ts > w.maxTs || slot < w.minBlock || slot > w.maxBlock)) continue;
      const m = timeline.get(tk);
      const prev = m.get(t.trader_address);
      if (prev === undefined || ts < prev.ts || (ts === prev.ts && slot < prev.block)) m.set(t.trader_address, { ts, block: slot, bnb });
    }
  }
  const arr = new Map();
  for (const [tk, m] of timeline) arr.set(tk, [...m.values()].sort((a, b) => (a.ts - b.ts) || ((a.block || 0) - (b.block || 0))));
  return { timelines: arr, sourcesScanned: scanned };
}

// A/B 指标计算（纯）。aEntries=[{token,t0,delta,ctrls:[{token}]}]；tokenStateOf/peakOf/timelines 供查询。
// 对照窗 = 对照票首 tick + delta（同票龄平移）。
function computeABMetrics(aEntries, timelines, tokenStateOf, peakOf) {
  const surv = { A: [], B: [] }, b60 = { A: [], B: [] }, b300 = { A: [], B: [] }, peak = { A: [], B: [] };
  for (const at of aEntries) {
    const stA = tokenStateOf(at.token); if (!stA) continue;
    surv.A.push(stA.lt - stA.ft);
    const pA = peakOf ? peakOf(at.token) : null; if (pA != null) peak.A.push(pA);
    const tlA = timelines.get(at.token) || [];
    let c60 = 0, c300 = 0;
    for (const e of tlA) { if (e.ts >= at.t0 && e.ts <= at.t0 + 60000) c60++; if (e.ts >= at.t0 && e.ts <= at.t0 + 300000) c300++; }
    b60.A.push(c60); b300.A.push(c300);
    for (const ct of at.ctrls) {
      const stC = tokenStateOf(ct.token); if (!stC) continue;
      const t0c = stC.ft + at.delta;
      surv.B.push(stC.lt - stC.ft);
      const pC = peakOf ? peakOf(ct.token) : null; if (pC != null) peak.B.push(pC);
      const tlC = timelines.get(ct.token) || [];
      let d60 = 0, d300 = 0;
      for (const e of tlC) { if (e.ts >= t0c && e.ts <= t0c + 60000) d60++; if (e.ts >= t0c && e.ts <= t0c + 300000) d300++; }
      b60.B.push(d60); b300.B.push(d300);
    }
  }
  const med = o => q(o, 0.5);
  const lift = (a, b) => (b > 0 ? (a - b) / b : (a > 0 ? Infinity : 0));
  const ge = (arr, ms) => arr.length ? arr.filter(x => x >= ms).length / arr.length : NaN;
  return {
    nA: surv.A.length, nB: surv.B.length,
    survivalMedA: med(surv.A), survivalMedB: med(surv.B), survivalLift: lift(med(surv.A), med(surv.B)),
    survivalGe60A: ge(surv.A, 60000), survivalGe60B: ge(surv.B, 60000),
    survivalGe300A: ge(surv.A, 300000), survivalGe300B: ge(surv.B, 300000),
    buyers60MedA: med(b60.A), buyers60MedB: med(b60.B), buyers60Lift: lift(med(b60.A), med(b60.B)),
    buyers300MedA: med(b300.A), buyers300MedB: med(b300.B), buyers300Lift: lift(med(b300.A), med(b300.B)),
    peakMedA: peak.A.length ? med(peak.A) : null, peakMedB: peak.B.length ? med(peak.B) : null,
  };
}

// ══════════════════════════ --self-test（合成数据单测，零 DB） ══════════════════════════
function runSelfTest() {
  const assert = require('assert');
  const opt = parseArgs(['--self-test']);
  console.log('── self-test 1: computePairPnL / carry-in 边界 ──');
  {
    const mk = (bs, bt, ss, st, o = {}) => ({ bs, bt, ss, st, nb: 1, ns: 1, fbt: 1, fbk: 1, fst: o.fst ?? Infinity, fsk: o.fsk ?? Infinity, ft: 1, fk: 1, ftp: 'b', ...o });
    const p = mk(1.0, 100, 0.9, 60); // 买1BNB/100tok，卖0.9BNB/60tok，剩40tok @mark
    const r = computePairPnL(p, 0.02, opt);
    assert.ok(Math.abs(r.net - (0.9 + 40 * 0.02 - 1.0)) < 1e-12, 'net 公式');
    assert.ok(Math.abs(r.realized + r.unreal - r.net) < 1e-9, 'realized+unreal≡net');
    assert.ok(r.netAfterCost < r.net, '成本稳健列更保守');
    assert.ok(Math.abs(computePairPnL(mk(1, 100, 0, 0), 0.03, opt).net - (100 * 0.03 - 1)) < 1e-12, '纯持仓未卖 net=inv×mark−buy');
    assert.strictEqual(classifyCarryIn(mk(0, 0, 1, 10, { fbt: Infinity, fbk: Infinity, ftp: 's' }), opt.carryinTol), 'sellFirst', '纯卖=sellFirst');
    assert.strictEqual(classifyCarryIn(mk(1, 100, 1, 101.5), opt.carryinTol), 'overSell', '超卖=overSell');
    assert.strictEqual(classifyCarryIn(mk(1, 100, 1, 50, { fst: 1, fsk: 1 }), opt.carryinTol), 'ambig', '同(ts,block)买卖=ambig');
    assert.strictEqual(classifyCarryIn(mk(1, 100, 1, 50), opt.carryinTol), null, '干净配对');
    assert.strictEqual(classifyCarryIn(mk(1, 100, 0.5, 60), opt.carryinTol), null, '部分平仓干净');
    assert.strictEqual(classifyCarryIn(mk(1, 100, 0.6, 100, { fst: 0, fsk: 0, ft: 0, fk: 0, ftp: 's' }), opt.carryinTol), 'sellFirst', '首笔为卖(先卖后买)');
  }
  console.log('── self-test 2: selectMark 尘价剔除 ──');
  {
    const px = (p, t = 0) => ({ t, k: t, p });
    const okPx = [px(0.01, 1), px(0.0102, 2), px(0.0098, 3), px(0.0101, 4), px(0.01, 5)];
    let r = selectMark(okPx);
    assert.strictEqual(r.mark, 0.01, '正常末位价');
    assert.strictEqual(r.replaced, false, '不误剔正常价');
    r = selectMark([...okPx, px(1e-7, 6)]);
    assert.strictEqual(r.mark, 0.01, '尘价(e7倍压低)被回退到前位');
    assert.strictEqual(r.replaced, true, '标记替换');
    r = selectMark([px(0.01), px(0.012), px(0.02)]);
    assert.strictEqual(r.mark, 0.02, '合理涨势末位保留');
    assert.strictEqual(selectMark([]).mark, null, '无价 null');
  }
  console.log('── self-test 3: gateWallets 批次归属 ──');
  {
    const mkS = (over = {}) => Object.assign({
      address: 'W' + Math.random().toString(36).slice(2, 8), n: 25, wins: 20, sumNet: 10, sumReal: 8, sumBuy: 50, sumSell: 55,
      posNetSum: 12, maxPosNet: 3, days: new Set(['2026-08-01', '2026-08-02']), rawTotalRun: 30, medianBuyBnb: 2,
      nets: Array(25).fill(0.4), buys: Array(25).fill(2), badShare: 0.1, unknownShare: 0,
      halves: { h1: { n: 13, mean: 0.3 }, h2: { n: 12, mean: 0.5 } },
    }, over);
    const g = gateWallets([
      mkS(),                                                    // 批1 达标（n=25 超批2上限）
      mkS({ n: 10, wins: 9, sumNet: 5, nets: Array(10).fill(0.5), maxPosNet: 2, days: new Set(['a', 'b', 'c']) }), // 双达标→批2
      mkS({ wins: 5 }),                                         // 胜率 0.2 不够
      mkS({ sumNet: -1, wins: 20, nets: Array(25).fill(-0.04) }), // mean<0 出局
      mkS({ badShare: 0.9 }),                                   // bad 类目门剔除
      mkS({ rawTotalRun: 500, n: 10, wins: 9, sumNet: 5 }),      // rawTotal≥200 不进批2；n=10 不够批1 → 出局
      mkS({ halves: { h1: { n: 25, mean: 0.4 }, h2: { n: 0, mean: NaN } } }), // 对半切失败(全挤一半)
      mkS({ sumReal: 1 }),                                     // realizedShare=0.1<0.25 → 批1纸面富贵门剔
    ], opt);
    assert.strictEqual(g.batch1.length, 1, '批1 1人');
    assert.strictEqual(g.batch2.length, 1, '批2 1人');
    assert.strictEqual(g.funnel.badCatCut, 1, 'bad 门计数');
    assert.strictEqual(g.funnel.activeRealizedCut, 1, '批1 realized 门计数');
  }
  console.log('── self-test 4: matchABControls 匹配 ──');
  {
    const T0 = 1755000000000;
    const mkT = (token, cat, heat, dtH) => ({ token, cat, heat, firstTs: T0 + dtH * 3600000 });
    const aToks = [mkT('A1', 'normal', 50, 10)];
    const pool = [
      mkT('C1', 'normal', 50, 11),   // 同桶同卡钳 → 命中
      mkT('C2', 'normal', 55, 10),   // 同桶 → 命中
      mkT('C3', 'wash', 50, 10),     // 类目不同 → 不命中
      mkT('C4', 'normal', 50, 200),  // 超出 48h 卡钳 → 不命中
      mkT('A1', 'normal', 50, 10),   // A 自身排除
    ];
    const { controlsByToken, unmatched } = matchABControls(aToks, pool, opt);
    const ctrls = controlsByToken.get('A1').map(c => c.token);
    assert.ok(ctrls.includes('C1') && ctrls.includes('C2'), '命中两个对照');
    assert.ok(!ctrls.includes('C3') && !ctrls.includes('C4') && !ctrls.includes('A1'), '排除异类目/超卡钳/自身');
    assert.strictEqual(unmatched, 0);
    const { unmatched: um2 } = matchABControls([mkT('A2', 'quality', 999, 0)], pool, opt);
    assert.strictEqual(um2, 1, '无匹配计数');
    assert.strictEqual(heatBucket(10, opt._heatEdges), 0, 'heat=10 落桶0');
    assert.strictEqual(heatBucket(31, opt._heatEdges), 2, 'heat=31 落桶2');
  }
  console.log('── self-test 5: leadLagOnToken 跟单判定（block 语义） ──');
  {
    const tl = [
      { ts: 100, block: 10, w: 'LEAD', bnb: 1 },
      { ts: 100, block: 11, w: 'BOT', bnb: 0.2 },
      { ts: 100, block: 20, w: 'LATER', bnb: 1 },
    ];
    const rBot = leadLagOnToken(tl, 'BOT', { ts: 100, block: 11 }, opt.leadLagBlocks);
    assert.strictEqual(rBot.follow, true, 'BOT 被带（差 1 block）');
    assert.strictEqual(rBot.leader, 'LEAD', 'leader 是 LEAD');
    assert.strictEqual(rBot.lead, false, 'BOT 未带 LATER(差9block)');
    const rLead = leadLagOnToken(tl, 'LEAD', { ts: 100, block: 10 }, opt.leadLagBlocks);
    assert.strictEqual(rLead.follow, false, 'LEAD 无先行者');
    assert.strictEqual(rLead.lead, true, 'LEAD 带了 BOT');
    assert.strictEqual(leadLagOnToken(tl, 'BOT', { ts: 100, block: 11 }, 0).follow, false, 'maxBlockDiff=0 时差 1 block 不算被带');
  }
  console.log('── self-test 7: detectRings 协作环 ──');
  {
    const listed = [
      { address: 'W0' }, { address: 'W1' }, { address: 'W2' }, { address: 'W3' },
    ];
    const sets = [
      new Set(['A', 'B', 'C', 'D']),
      new Set(['A', 'B', 'C', 'E']),   // 与 W0 J=3/5=0.6 → 环
      new Set(['X', 'Y']),              // 独立
      new Set(['A', 'B', 'C', 'D']),   // 与 W0 J=1.0 → 环
    ];
    const rc = detectRings(listed, sets, opt);
    assert.strictEqual(rc, 2, '环计数 2');
    assert.strictEqual(listed[1].ringWith, 0, 'W1 指向 W0');
    assert.strictEqual(r2(listed[1].ringJ), 0.6, 'J=0.6');
    assert.strictEqual(listed[3].ringWith, 0, 'W3 指向 W0');
    assert.ok(listed[2].ringWith == null, 'W2 独立无标注');
  }
  console.log('── self-test 8: buildFocusWindows lead-lag 窗口 ──');
  {
    const win = buildFocusWindows([[{ token: 'T', fbt: 100000, fbk: 500 }, { token: 'T', fbt: 90000, fbk: 400 }]], 2);
    const w = win.get('T');
    assert.strictEqual(w.minTs, 90000 - 1200, 'minTs=最早首买-1200ms');
    assert.strictEqual(w.maxTs, 101200, 'maxTs=最晚首买+1200ms');
    assert.strictEqual(w.minBlock, 397, 'minBlock=最早block-3');
    assert.strictEqual(w.maxBlock, 503, 'maxBlock=最晚block+3');
  }
  console.log('── self-test 6: fold/reduce/prune 小闭环（BNB 十进制） ──');
  {
    const G = newGlobal();
    const ticks = [
      { token_address: 'TK1', trader_address: 'W1', trade_type: 'buy', bnb_amount: 1, token_amount: 100, price_bnb: 0.01, price_usd: 6, block_time: new Date(1000).toISOString(), block_number: 1 },
      { token_address: 'TK1', trader_address: 'W1', trade_type: 'sell', bnb_amount: 1.5, token_amount: 100, price_bnb: 0.015, price_usd: 9, block_time: new Date(5000).toISOString(), block_number: 10 },
      { token_address: 'TK1', trader_address: 'W2', trade_type: 'buy', bnb_amount: 0.001, token_amount: 1, price_bnb: 0.001, price_usd: 0.6, block_time: new Date(2000).toISOString(), block_number: 3 }, // 尘被滤（<0.002）
      { token_address: 'TK1', trader_address: 'W3', trade_type: 'buy', bnb_amount: 2, token_amount: 200, price_bnb: 0.01, price_usd: 6, block_time: new Date(1500).toISOString(), block_number: 2, price_outlier: true }, // outlier 被滤
    ];
    const st = { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity };
    foldTicks(ticks, G, opt, st);
    assert.strictEqual(G.stats.ticks, 2, '尘/outlier 过滤');
    assert.strictEqual(st.kept, 2);
    const tSt = G.tokenState.get('TK1');
    assert.strictEqual(tSt.pr.length, 2, '价缓冲');
    assert.strictEqual(tSt.ls, 1, '落寂源=1');
    assert.strictEqual(tSt.n, 2, 'kept 计数不含尘/outlier');
    assert.strictEqual(tSt.cls.length, 4, 'cls 缓冲含全量 4 tick（尘+outlier 在内）');
    assert.strictEqual(tSt.traders.size, 3, 'traders 含尘/outlier 参与者');
    assert.strictEqual(tSt.cls[2].priceReliable, false, '尘 tick priceReliable=false');
    assert.strictEqual(tSt.cls[3].priceReliable, false, 'outlier tick priceReliable=false');
    const mk = selectMark(tSt.pr);
    assert.strictEqual(mk.mark, 0.015);
    tSt.mark = mk.mark;
    const { byWallet, buckets } = reducePairs(G, null, opt);
    assert.strictEqual(buckets.belowMin, 0);
    assert.ok(Math.abs(byWallet.get('W1').sumNet - 0.5) < 1e-9, 'W1 净利 0.5 BNB');
    assert.strictEqual(byWallet.get('W1').wins, 1);
    // 剪枝：活跃 token 尘配对保留；落寂 token 剪除；终剪全删
    const G2 = newGlobal();
    const mkTick = (tk, w, bnb, ts) => ({ token_address: tk, trader_address: w, trade_type: 'buy', bnb_amount: bnb, token_amount: 100, price_bnb: 0.01, price_usd: 6, block_time: new Date(ts).toISOString(), block_number: 1 });
    foldTicks([mkTick('ALIVE', 'D1', 0.01, 1000), mkTick('DEAD', 'D2', 0.01, 1000)], G2, opt, { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity });
    foldTicks([mkTick('ALIVE', 'X', 1, 2000)], G2, opt, { idx: 10, kept: 0, minT: Infinity, maxT: -Infinity }); // ALIVE 落寂=10；DEAD 落寂=1
    prunePairs(G2, opt, null, 10);
    assert.ok(G2.pairs.get('ALIVE') && G2.pairs.get('ALIVE').has('D1'), '活跃 token(ls=10=curSrc) 尘配对保留');
    assert.ok(!G2.pairs.get('DEAD'), '落寂 token(ls=1≤10-6) 尘配对剪除');
    prunePairs(G2, opt, null, Infinity);
    assert.ok(!G2.pairs.get('ALIVE').has('D1'), '终剪把尘配对全删');
  }
  console.log('── self-test 9: reducePairs creator 大小写不敏感 ──');
  {
    const G = newGlobal();
    const mkTick = (w, ts, o = {}) => ({ token_address: 'TKC', trader_address: w, trade_type: 'buy', bnb_amount: 1, token_amount: 100, price_bnb: 0.01, price_usd: 6, block_time: new Date(ts).toISOString(), block_number: 1, ...o });
    foldTicks([mkTick('0xABCdef1234567890', 1000)], G, opt, { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity });
    G.tokenState.get('TKC').mark = 0.01;
    const meta = new Map([['TKC', { category: 'normal', creator: '0xabcdef1234567890', totalSupply: 1e9 }]]); // 大小写不同的同地址
    const { buckets } = reducePairs(G, meta, opt);
    assert.strictEqual(buckets.creatorSkip, 1, 'checksum 大小写不同也算 creator 自买');
  }
  console.log('── self-test 10: applyFallbackClassification ──');
  {
    const G = newGlobal();
    // HIT：token_profiles 已有分类 → 不现算，缓冲清空
    // MISS：无分类 → cls 现算（慢拉横盘 → normal），uniqueTraders 从 classInfo
    const mkTick = (tk, w, sec, o = {}) => ({ token_address: tk, trader_address: w, trade_type: 'buy', bnb_amount: o.bnb ?? 0.01, token_amount: 100, price_bnb: o.px ?? 1e-8, price_usd: (o.px ?? 1e-8) * 600, block_time: new Date(sec * 1000).toISOString(), block_number: Math.floor(sec / 3), ...o });
    const hitTicks = [], missTicks = [];
    for (let i = 0; i < 12; i++) { hitTicks.push(mkTick('TK_HIT', '0xh' + i, i * 5)); missTicks.push(mkTick('TK_MISS', '0xm' + i, i * 5, { px: 1e-8 + i * 2e-10 })); }
    foldTicks(hitTicks, G, opt, { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity });
    foldTicks(missTicks, G, opt, { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity });
    const meta = new Map([
      ['TK_HIT', { category: 'wash', firstTick: null, lastTick: null, uniqueTraders: 7, peakTimeS: 3, maxMcapUsd: 123, creator: null, totalSupply: 1e9 }],
      ['TK_MISS', { category: null, firstTick: null, lastTick: null, uniqueTraders: null, peakTimeS: null, maxMcapUsd: null, creator: null, totalSupply: 1e9 }],
    ]);
    const n = applyFallbackClassification(G, meta);
    assert.strictEqual(n, 1, '仅 MISS token 现算');
    assert.strictEqual(meta.get('TK_HIT').category, 'wash', 'HIT 分类不被覆盖');
    assert.strictEqual(meta.get('TK_MISS').category, 'normal', 'MISS 慢拉横盘 → normal');
    assert.strictEqual(meta.get('TK_MISS').uniqueTraders, 12, 'uniqueTraders 从分类结果取');
    assert.ok(meta.get('TK_MISS').maxMcapUsd > 0, 'maxMcapUsd=USD峰值×supply');
    assert.strictEqual(G.tokenState.get('TK_HIT').cls, null, 'HIT 缓冲清空');
    assert.strictEqual(G.tokenState.get('TK_MISS').cls, null, 'MISS 缓冲清空');
    assert.strictEqual(G.tokenState.get('TK_MISS').traders, null, 'traders 集清空');
    // 尘/outlier-only token：cls 全不可靠 → low_quality（totalSupply 在也不编市值）
    const G3 = newGlobal();
    const dust = mkTick('TK_DUSTONLY', '0xd1', 1, { bnb: 0.0005, px: 1e-8 });
    foldTicks([dust, dust, dust, dust, dust, dust, dust, dust, dust, dust, dust, dust], G3, opt, { idx: 1, kept: 0, minT: Infinity, maxT: -Infinity });
    const meta3 = new Map([['TK_DUSTONLY', { category: null, firstTick: null, lastTick: null, uniqueTraders: null, peakTimeS: null, maxMcapUsd: null, creator: null, totalSupply: 1e9 }]]);
    applyFallbackClassification(G3, meta3);
    assert.strictEqual(meta3.get('TK_DUSTONLY').category, 'low_quality', '尘-only token 无可靠价 → low_quality（保守）');
  }
  console.log('✅ self-test 全部通过');
}

// ══════════════════════════ main ══════════════════════════
async function main() {
  const opt = parseArgs();
  if (opt.selfTest) { runSelfTest(); return; }
  const t0 = now();
  const tickCache = new TickDataCache(logger);
  const client = opt.noDb ? null : sb();

  // ── 阶段 0：源计划 ──
  let sources;
  if (opt.noDb) {
    const cacheDir = path.join(__dirname, '../..', 'data/tick-cache');
    const ids = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => /\.(jsonl|json)\.gz$/.test(f)).map(f => f.replace(/\.(jsonl|json)\.gz$/, '')) : [];
    sources = ids.map(id => ({ id, name: '(本地缓存)', status: 'cached', created: null }));
    console.log(`[阶段0] --no-db 本地缓存 ${sources.length} 个实验（仅验管线，类目/判读无意义）`);
    if (!sources.length) { console.error('本地 data/tick-cache/ 无缓存；--no-db 需先从 182 scp 小源缓存'); process.exit(1); }
  } else {
    sources = await pickSources(opt, client);
    if (!sources.length) { console.error('无可用数据源'); process.exit(1); }
    const warm = sources.filter(s => tickCache.has(s.id)).length;
    console.log(`[阶段0] 缓存预热: ${warm}/${sources.length} 命中（未命中源首跑约 2min/源 拉取）`);
  }

  // ── 阶段 1：逐源折叠 ──
  const G = newGlobal();
  let srcDone = 0; const fetchFail = [];
  for (const s of sources) {
    const t1 = now();
    let ticks = null;
    try {
      ticks = opt.noDb ? await tickCache.load(s.id) : await fetchTicksForExperiment(client, s.id, tickCache);
    } catch (e) { fetchFail.push(s.id); console.error(`  ✗ ${id8(s.id)} 拉取失败: ${e.message}`); continue; }
    srcDone++;
    const st = { idx: srcDone, id: s.id, id8: id8(s.id), name: s.name, ticks: ticks ? ticks.length : 0, kept: 0, minT: Infinity, maxT: -Infinity, ms: now() - t1 };
    if (ticks && ticks.length) foldTicks(ticks, G, opt, st);
    G.srcStats.push(st);
    console.log(`[阶段1] ${srcDone}/${sources.length} ${id8(s.id)} ticks=${st.ticks}(有效${st.kept}) 用时=${(st.ms / 1000).toFixed(0)}s heap=${heapMB()}MB pairs=${G.nPairs}`);
    ticks = null;
    if (srcDone % PRUNE_EVERY_N_SRC === 0) {
      const p = prunePairs(G, opt, null, srcDone);
      if (G.nPairs > opt.maxPairs) {
        console.error(`\n⛔ 护栏触发：配对数 ${G.nPairs} > --max-pairs ${opt.maxPairs}。` +
          `建议：--pass1-pair-min-bnb 提到 0.05 / 缩小 --days / 见 README 降级方案。不静默降级，中止。`);
        process.exit(2);
      }
      console.log(`  [剪枝] -${p} 尘配对（余 ${G.nPairs}）`);
    }
  }
  if (fetchFail.length >= 3 || srcDone === 0) {
    console.error(`⛔ 拉取失败源 ${fetchFail.length} 个（${fetchFail.map(id8).join(',')}）≥3 或全部失败——数据不完整，中止。`);
    process.exit(2);
  }
  const keptStats = G.srcStats.filter(s => s.kept > 0);
  if (!keptStats.length) { console.error('⛔ 全部源有效 tick 为 0——中止（检查 price_outlier/尘过滤参数）'); process.exit(2); }
  const gMin = Math.min(...keptStats.map(s => s.minT));
  const gMax = Math.max(...keptStats.map(s => s.maxT));
  console.log(`\n[阶段1] 完成：源 ${srcDone} 个 / 有效ticks=${G.stats.ticks} (outlier=${G.stats.outlier} 尘=${G.stats.dust}) / 配对=${G.nPairs} / token=${G.tokenState.size} / 钱包=${G.walletTokens.size}`);
  console.log(`  全局覆盖窗: ${new Date(gMin).toISOString()} → ${new Date(gMax).toISOString()}（${((gMax - gMin) / 3600000).toFixed(1)}h；并发源重叠期=互补分片，UNIQUE(tx_hash,log_index) 保证无重复）`);
  console.log(`  恒等式抽样: ${G.stats.identityChecked} 检 ${G.stats.identityMismatch} 不符（>2% 相对偏差）`);

  // ── token 元数据（折叠后取 token 全集）+ fallback 分类 ──
  let meta = new Map();
  if (!opt.noDb) {
    const t2 = now();
    console.log(`\n[元数据] 拉取 ${G.tokenState.size} 个 token 的分类/creator/totalSupply …`);
    meta = await fetchTokenMeta(sources.map(s => s.id), new Set(G.tokenState.keys()), client);
    const fbN = applyFallbackClassification(G, meta);
    console.log(`  fallback 现算分类 ${fbN} 个（token_profiles 无行）；用时 ${((now() - t2) / 1000).toFixed(0)}s`);
  } else {
    console.log('\n[元数据] --no-db 跳过（全部 unknown；applyFallbackClassification 仍跑——cls 现算口径验管线）');
    meta = new Map([...G.tokenState.keys()].map(tk => [tk, { category: null, firstTick: null, lastTick: null, uniqueTraders: null, peakTimeS: null, maxMcapUsd: null, creator: null, totalSupply: 0 }]));
    const fbN = applyFallbackClassification(G, meta);
    console.log(`  fallback 现算分类 ${fbN} 个（无 totalSupply → 市值族保守 0）`);
  }

  // ── 终剪 + mark 价 ──
  prunePairs(G, opt, meta, Infinity);
  let markReplaced = 0, noMark = 0;
  for (const st of G.tokenState.values()) {
    const mk = selectMark(st.pr);
    st.mark = mk.mark; if (mk.mark == null) noMark++;
    if (mk.replaced) markReplaced++;
  }
  console.log(`\n[剪枝/mark] 终剪后配对=${G.nPairs}；mark 替换率=${(markReplaced / Math.max(1, G.tokenState.size) * 100).toFixed(2)}%（尘价右端剔除）、无价 token=${noMark}`);

  // ── 阶段 2：归约 ──
  const t3 = now();
  const { byWallet, buckets, catById } = reducePairs(G, meta, opt);
  console.log(`[阶段2] 配对归约：合格=${buckets.qualified} | carry-in(sellFirst=${buckets.sellFirst}/overSell=${buckets.overSell}/ambig=${buckets.ambig}) | 低于${opt.pairMinBuyBnb}BNB=${buckets.belowMin} | creator自买=${buckets.creatorSkip} | 无mark=${buckets.noMark}；用时 ${((now() - t3) / 1000).toFixed(0)}s`);

  // ── 阶段 3：门槛 ──
  const summaries = buildSummaries(byWallet, G);
  fillCatShares(summaries, catById, opt._badCats);
  const { batch1, batch2, funnel } = gateWallets(summaries, opt);
  console.log(`[阶段3] 漏斗: 总钱包=${funnel.total} 有合格配对=${funnel.hasQualified} 达最低票数=${funnel.minTokens} 批1门过=${funnel.active}(realized门剔${funnel.activeRealizedCut}) 批2门过=${funnel.sharp} bad类目门剔=${funnel.badCatCut} → 批1=${batch1.length} 批2=${batch2.length}`);

  // ── 锚点校验（★BSC --anchor-wallets 传入；无锚点输出 ⚠️ 提示） ──
  const anchorRows = [];
  for (const a of opt._anchors) {
    const s = summaries.find(x => x.address.toLowerCase() === a.toLowerCase());
    anchorRows.push({
      address: a, found: !!s,
      n: s ? s.n : 0, winRate: s ? r3(s.wins / s.n) : null, meanNet: s ? r3(s.sumNet / s.n) : null,
      sumNet: s ? r2(s.sumNet) : null, rawTotalRun: s ? s.rawTotalRun : null,
      batch: batch1.includes(s || {}) ? '批1' : (batch2.includes(s || {}) ? '批2' : '未入榜'),
      gates: s ? `tokens ${s.n}/${opt.activeMinTokens}+ win ${r3(s.wins / s.n)}/${opt.activeMinWinrate} mean ${r3(s.sumNet / s.n)}/${opt.activeMinMean} realized ${r3(s.sumReal / Math.max(1e-9, s.sumNet))}/${opt.activeMinRealizedShare} bad ${r3(s.badShare)}/${opt.maxBadShare}` : null,
    });
  }
  const anchorOk = opt._anchors.length > 0 && anchorRows.every(r => r.found && r.batch !== '未入榜');
  console.log(`\n[锚点] ${opt._anchors.length === 0 ? '⚠️ 未提供 --anchor-wallets——名单置信靠 A/B + verify 对账' : (anchorOk ? '✅' : '⚠️ 锚点未全命中——先核对下表再信名单')}`);
  for (const r of anchorRows) console.log(`  ${id8(r.address)}: ${r.batch} found=${r.found} n=${r.n} rawTotal=${r.rawTotalRun} 胜率=${r.winRate} mean=${r.meanNet} 总=${r.sumNet}${r.gates ? ` | 门(值/阈): ${r.gates}` : ''}`);

  // ── 阶段 4：enrich（★BSC 缩减：仅人工标注冲突预检） ──
  const listed = [...batch1, ...batch2];
  let walletRows = new Map(); let manualCatConflicts = 0;
  if (!opt.noDb && listed.length) {
    walletRows = await enrichWallets([...listed.map(s => s.address)], client);
    for (const s of listed) {
      const r = walletRows.get(s.address) || {};
      const cat = r.category || null;
      s.manualCategoryConflict = !!(cat && cat !== 'smart_bot' && cat !== 'smart_money');
      if (s.manualCategoryConflict) manualCatConflicts++;
    }
    if (manualCatConflicts) console.log(`[阶段4] wallets 人工标注冲突 ${manualCatConflicts} 个（--apply 将跳过；产出仍列出+notes 标注）`);
  }
  const finalListed = [...listed];

  // ── 阶段 5：A/B 带量验证 + 随机钱包零假设 + lead-lag ──
  let abReport = null;
  if (!opt.skipAb && !opt.noDb) {
    const t5 = now();
    // 入榜钱包（∪ 锚点，若有）的合格配对 token 明细（重扫一遍 pairs）
    // 零假设抽样（随机钱包）：匹配无偏时其 A/B 提升应≈0；显著为正=散户到达提升含机械成分（早买≈早到散户的相关性）。
    const listedAddr = new Set(finalListed.map(s => s.address));
    const rand = lcg(opt.nullSeed);
    const nullEligible = [...byWallet.entries()].filter(([w, e]) => e.n >= 5 && !listedAddr.has(w) && !opt._anchors.includes(w)).map(([w]) => w);
    const nullWallets = [];
    if (nullEligible.length) {
      const idx = new Set();
      while (idx.size < Math.min(opt.nullSampleWallets, nullEligible.length)) idx.add(Math.floor(rand() * nullEligible.length));
      for (const i of idx) nullWallets.push(nullEligible[i]);
    }
    const focusSet = new Set([...finalListed.map(s => s.address), ...opt._anchors, ...nullWallets]);
    const pairTokenByWallet = new Map(); // wallet → [{token, fbt, fbk, net, buyBnb, cat, firstTs}]
    for (const [tk, tm] of G.pairs) {
      const m = meta.get(tk); const st = G.tokenState.get(tk);
      if (!st) continue;
      const cat = m ? m.category : null;
      const creatorLc = m && m.creator ? String(m.creator).toLowerCase() : null;
      for (const [w, p] of tm) {
        if (!focusSet.has(w)) continue;
        if (classifyCarryIn(p, opt.carryinTol)) continue;
        if (p.bs < opt.pairMinBuyBnb) continue;
        if (creatorLc && creatorLc === w.toLowerCase()) continue;
        const pnl = computePairPnL(p, st.mark, opt);
        let arr = pairTokenByWallet.get(w); if (!arr) pairTokenByWallet.set(w, arr = []);
        arr.push({ token: tk, fbt: p.fbt, fbk: p.fbk, net: pnl.net, buyBnb: p.bs, cat, firstTs: st.ft });
      }
    }
    // A 组票构造：首买落在票首 tick 后 abEntryWindowS 内
    const heatOf = tk => { const m = meta.get(tk); if (m && m.uniqueTraders != null) return m.uniqueTraders; const tm = G.pairs.get(tk); return tm ? tm.size : null; };
    const firstTsOf = tk => { const m = meta.get(tk); const st = G.tokenState.get(tk); return (m && m.firstTick != null) ? m.firstTick : (st ? st.ft : null); };
    const buildAToks = (wallets) => {
      const aTokMap = new Map(); // token → {t0, delta}
      for (const waddr of wallets) {
        for (const x of (pairTokenByWallet.get(waddr) || [])) {
          if (x.fbt - x.firstTs < 0 || x.fbt - x.firstTs > opt.abEntryWindowS * 1000) continue;
          const cur = aTokMap.get(x.token);
          if (!cur || x.fbt < cur.t0) aTokMap.set(x.token, { t0: x.fbt, delta: x.fbt - x.firstTs });
        }
      }
      return [...aTokMap.entries()].map(([token, v]) => ({
        token, t0: v.t0, delta: v.delta,
        cat: (meta.get(token) || {}).category ?? null, heat: heatOf(token), firstTs: firstTsOf(token),
      }));
    };
    // 对照池：全宇宙类目已知 token
    const pool = [];
    for (const [tk, st] of G.tokenState) {
      const m = meta.get(tk); if (!m || m.category == null) continue;
      pool.push({ token: tk, cat: m.category, heat: heatOf(tk), firstTs: firstTsOf(tk) });
    }
    const groupAToks = buildAToks(finalListed.map(s => s.address));
    const matchRes = matchABControls(groupAToks, pool, opt);
    const groupAEntries = groupAToks.filter(t => (matchRes.controlsByToken.get(t.token) || []).length > 0)
      .map(t => ({ token: t.token, t0: t.t0, delta: t.delta, ctrls: matchRes.controlsByToken.get(t.token) }));
    // 锚点参照（★BSC：--anchor-wallets 传入的单钱包 A/B——正偏态早选能力参照，期望正向；零假设看随机钱包行）
    const calib = {};
    for (const a of opt._anchors) {
      const aToks = buildAToks([a]);
      const mm = matchABControls(aToks, pool, opt);
      calib[a] = { aToks: aToks.length, entries: aToks.filter(t => (mm.controlsByToken.get(t.token) || []).length > 0).map(t => ({ token: t.token, t0: t.t0, delta: t.delta, ctrls: mm.controlsByToken.get(t.token) })) };
    }
    // 零假设（随机钱包）A 组与匹配
    let nullEntries = [];
    if (nullWallets.length) {
      const aToks = buildAToks(nullWallets);
      const mm = matchABControls(aToks, pool, opt);
      nullEntries = aToks.filter(t => (mm.controlsByToken.get(t.token) || []).length > 0).map(t => ({ token: t.token, t0: t.t0, delta: t.delta, ctrls: mm.controlsByToken.get(t.token) }));
    }
    // T 集：A票∪对照（组+参照+零假设）为核（全量时间线，A/B +60s/+300s 到达需要）；lead-lag 侧=入榜钱包其余合格票，
    // 只保留焦点首买 ±1 block 窗内事件（全量时间线大票数会爆内存，母版实证截断丢票漏标）
    const T = new Set();
    for (const at of groupAEntries) { T.add(at.token); for (const c of at.ctrls) T.add(c.token); }
    for (const a of Object.values(calib)) for (const at of a.entries) { T.add(at.token); for (const c of at.ctrls) T.add(c.token); }
    for (const at of nullEntries) { T.add(at.token); for (const c of at.ctrls) T.add(c.token); }
    const coreSet = new Set(T);
    const Tcore = T.size;
    for (const s of finalListed) s._pairsAll = pairTokenByWallet.get(s.address) || [];
    const focusWin = buildFocusWindows(finalListed.map(s => s._pairsAll), opt.leadLagBlocks);
    for (const tk of coreSet) focusWin.delete(tk); // 核心票保留全量时间线（A/B 到达计数需要）
    let llDropped = 0, llWindowed = 0;
    for (const s of finalListed) for (const x of s._pairsAll) {
      if (T.size >= opt.abMaxTokens) { llDropped++; continue; }
      if (!T.has(x.token)) { T.add(x.token); llWindowed++; }
    }
    // 协作环检测（合格票集 Jaccard，对更高排名者）
    const tokenSets = finalListed.map(s => new Set(s._pairsAll.map(x => x.token)));
    const ringCount = detectRings(finalListed, tokenSets, opt);
    for (const s of finalListed) s._earlyTokens = s._pairsAll.filter(x => x.fbt - x.firstTs >= 0 && x.fbt - x.firstTs <= opt.abEntryWindowS * 1000);
    console.log(`[阶段5] 组A票=${groupAEntries.length}（无对照丢弃 ${matchRes.unmatched}）/ 对照池=${pool.length} / T集=${T.size}（核心${Tcore}全量 + lead-lag窗选${llWindowed}${llDropped ? `，截断丢${llDropped}票` : ''}，上限${opt.abMaxTokens}）；受限重扫…`);
    const { timelines, sourcesScanned } = await pass3Timelines(sources, T, opt, tickCache, focusWin);
    console.log(`  重扫 ${sourcesScanned}/${sources.length} 源完成，用时 ${((now() - t5) / 1000).toFixed(0)}s`);
    const tokenStateOf = tk => G.tokenState.get(tk);
    const peakOf = tk => { const m = meta.get(tk); return m ? m.peakTimeS : null; };
    const abm = computeABMetrics(groupAEntries, timelines, tokenStateOf, peakOf);
    let verdict;
    if (abm.nA < opt.abMinATokens) verdict = `不确定：A 组票 ${abm.nA} < ${opt.abMinATokens}`;
    else if (abm.survivalLift <= 0 || abm.buyers60Lift <= 0 || abm.buyers300Lift <= 0) verdict = `证伪：聪明钱参与≈热度基线（存活Δ${pct(abm.survivalLift)} / +60s散户Δ${pct(abm.buyers60Lift)} / +300sΔ${pct(abm.buyers300Lift)}）。名单本身有效（其自身盈利为真），但作"选票信号源/带量"证据不足`;
    else if (abm.survivalLift >= opt.abMinSurvivalLift && abm.buyers60Lift >= opt.abMinBuyerLift && abm.buyers300Lift >= opt.abMinBuyerLift) verdict = `支持：存活Δ${pct(abm.survivalLift)} / +60s散户Δ${pct(abm.buyers60Lift)} / +300sΔ${pct(abm.buyers300Lift)}（阈值 ${pct(opt.abMinSurvivalLift)}/${pct(opt.abMinBuyerLift)}）`;
    else verdict = `部分支持：存活Δ${pct(abm.survivalLift)} / +60sΔ${pct(abm.buyers60Lift)} / +300sΔ${pct(abm.buyers300Lift)}——未全达阈值但方向一致`;
    const calibMetrics = {};
    for (const [a, v] of Object.entries(calib)) calibMetrics[id8(a)] = { aToks: v.aToks, metrics: computeABMetrics(v.entries, timelines, tokenStateOf, peakOf) };
    const nullMetrics = nullEntries.length ? computeABMetrics(nullEntries, timelines, tokenStateOf, peakOf) : null;
    // 零假设修正：随机钱包亦显著为正 → 散户到达提升含机械成分（早买与散户早到本就相关），匹配有偏嫌疑
    if (nullMetrics && (nullMetrics.survivalLift > 0.3 || nullMetrics.buyers60Lift > 0.3)) {
      verdict += `；⚠️零假设(随机${nullWallets.length}钱包)亦存活Δ${pct(nullMetrics.survivalLift)} / +60sΔ${pct(nullMetrics.buyers60Lift)}——提升含机械成分，解读须扣减零假设`;
    }
    abReport = { metrics: abm, verdict, truncated: llDropped > 0, calibration: calibMetrics, nullMetrics: nullMetrics ? { wallets: nullWallets.length, metrics: nullMetrics } : null, ringCount };
    console.log(`  [A/B] A=${abm.nA} B=${abm.nB} | 存活中位 A=${(abm.survivalMedA / 1000).toFixed(0)}s vs B=${(abm.survivalMedB / 1000).toFixed(0)}s (Δ${pct(abm.survivalLift)}) | +60s散户 A=${r2(abm.buyers60MedA)} vs B=${r2(abm.buyers60MedB)} (Δ${pct(abm.buyers60Lift)}) | +300s A=${r2(abm.buyers300MedA)} vs B=${r2(abm.buyers300MedB)} (Δ${pct(abm.buyers300Lift)}) | peak中位 A=${abm.peakMedA != null ? r2(abm.peakMedA) : '-'}s vs B=${abm.peakMedB != null ? r2(abm.peakMedB) : '-'}s`);
    if (nullMetrics) console.log(`  [零假设 随机${nullWallets.length}钱包] A=${nullMetrics.nA} B=${nullMetrics.nB} 存活Δ${pct(nullMetrics.survivalLift)} +60sΔ${pct(nullMetrics.buyers60Lift)}（应≈0；显著为正=提升含机械成分）`);
    console.log(`  [A/B verdict] ${verdict}`);
    for (const [k, v] of Object.entries(calibMetrics)) console.log(`  [锚点参照 ${k}] A=${v.metrics.nA} B=${v.metrics.nB} 存活Δ${pct(v.metrics.survivalLift)} +60sΔ${pct(v.metrics.buyers60Lift)}`);
    if (ringCount) console.log(`  [协作环] 检出 ${ringCount} 个同组钱包（合格票集 Jaccard≥${opt.ringJaccard}，notes 标注"疑似同组@rank"——环内盈利互为镜像，解读须整环去重）`);

    // ── lead-lag 标注（timelines 覆盖 T 集；被截断的票跳过并计数） ──
    if (!opt.skipLeadlag) {
      for (const s of finalListed) {
        let followN = 0, leadN = 0, n = 0, miss = 0; const leaderCnt = new Map();
        for (const x of s._pairsAll) {
          const tl = timelines.get(x.token);
          if (!tl) { miss++; continue; }
          const selfEntry = tl.find(e => e.w === s.address);
          if (!selfEntry) continue;
          const r = leadLagOnToken(tl, s.address, { ts: selfEntry.ts, block: selfEntry.block }, opt.leadLagBlocks);
          n++; if (r.follow) { followN++; if (r.leader) leaderCnt.set(r.leader, (leaderCnt.get(r.leader) || 0) + 1); }
          if (r.lead) leadN++;
        }
        s.followRate = n ? followN / n : 0; s.leadRate = n ? leadN / n : 0; s._llMiss = miss;
        const topLeader = [...leaderCnt.entries()].sort((a, b) => b[1] - a[1])[0];
        s.topLeader = topLeader ? `${topLeader[0]}×${topLeader[1]}` : '';
      }
      const bot = finalListed.filter(s => s.followRate >= opt.leadlagBotRate).length;
      const missTotal = finalListed.reduce((x, s) => x + (s._llMiss || 0), 0);
      console.log(`  [lead-lag] 标注完成：疑似跟单(被带) ${bot} 个（followRate≥${opt.leadlagBotRate}）${missTotal ? `；截断漏标 ${missTotal} 票` : ''}`);
    }
  } else if (opt.noDb) {
    console.log('[阶段5] --no-db 跳过 A/B（类目口径=cls 现算，仍可跑但对照池语义弱化；正式跑用 DB）');
  } else if (opt.skipAb) {
    console.log('[阶段5] --skip-ab 跳过');
  }

  // ── 注释列组装 ──
  for (const s of finalListed) {
    const notes = [];
    if (s.ringWith != null) notes.push(`疑似同组@${s.ringWith + 1}(J=${r2(s.ringJ)})`);
    if (s.followRate != null && s.followRate >= opt.leadlagBotRate) notes.push(`疑似跟单(被带)@${s.topLeader || '?'}`);
    else if (s.leadRate != null && s.leadRate >= 0.5 && s.followRate < 0.3) notes.push('带头');
    if (s.carryInShare > opt.carryinWarnShare) notes.push('覆盖不全');
    if (s.rawTotalRun >= RAW_TOKEN_CAP) notes.push('高频bot样');
    if (s.sumNet > 0 && s.sumUnreal / s.sumNet > 0.5) notes.push('未实现主导');
    if (s.manualCategoryConflict) notes.push('人工标注冲突');
    s.notes = notes.join(';');
  }

  // ── 阶段 6：产出 ──
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  fs.mkdirSync(opt.outDir, { recursive: true });
  const csvPath = path.join(opt.outDir, `smart-wallets-${ts}.csv`);
  const jsonPath = path.join(opt.outDir, `smart-wallets-${ts}.json`);
  const COLS = ['address', 'batch', 'qualifiedPairs', 'rawPairs', 'winRate', 'meanPnlPerToken', 'medianPnlPerToken', 'totalNetPnL', 'meanPnlAfterCost', 'realizedShare', 'unrealizedBnb', 'medianBuyBnbPerPair', 'distinctDays', 'badCatShare', 'unknownCatShare', 'carryInShare', 'half1Mean', 'half2Mean', 'rawTotalRun', 'followRate', 'topLeader', 'leadRate', 'notes'];
  const rows = finalListed.map(s => [
    s.address, batch2.includes(s) ? 'sharp' : 'active',
    s.n, s.rawPairs, r3(s.winRate), r3(s.meanNet), r3(s.medianNet), r2(s.sumNet), r3(s.sumNAC / s.n),
    s.realizedShare == null ? '' : r3(s.realizedShare), r2(s.sumUnreal), r3(s.medianBuyBnb), s.days.size, r3(s.badShare), r3(s.unknownShare), r3(s.carryInShare),
    r3(s.halves.h1.mean), r3(s.halves.h2.mean), s.rawTotalRun,
    s.followRate != null ? r3(s.followRate) : '', s.topLeader || '', s.leadRate != null ? r3(s.leadRate) : '', s.notes || '',
  ]);
  for (const a of anchorRows) if (a.found && !finalListed.find(s => s.address === a.address)) rows.push([a.address, 'anchor_ref(未入榜)', '', '', a.winRate, a.meanNet, '', a.sumNet, '', '', '', '', '', '', '', '', '', '', a.rawTotalRun, '', '', '', a.batch]);
  fs.writeFileSync(csvPath, [COLS.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\n'));
  const detail = {};
  for (const s of finalListed.slice(0, 300)) {
    detail[s.address] = {
      batch: batch2.includes(s) ? 'sharp' : 'active',
      summary: { n: s.n, winRate: r3(s.winRate), meanNet: r3(s.meanNet), sumNet: r2(s.sumNet), notes: s.notes || '' },
      pairs: (s._pairsAll || []).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 100)
        .map(x => ({ token: x.token, cat: x.cat, net: r3(x.net), buyBnb: r2(x.buyBnb), entryDelayS: r2((x.fbt - x.firstTs) / 1000) })),
    };
  }
  const slim = s => ({ address: s.address, n: s.n, winRate: r3(s.winRate), meanNet: r3(s.meanNet), medianNet: r3(s.medianNet), sumNet: r2(s.sumNet), sumBuy: r2(s.sumBuy), medianBuyBnb: r3(s.medianBuyBnb), badShare: r3(s.badShare), unknownShare: r3(s.unknownShare), days: s.days.size, rawTotalRun: s.rawTotalRun, ringWith: s.ringWith != null ? s.ringWith + 1 : null, ringJ: s.ringJ != null ? r2(s.ringJ) : null, followRate: s.followRate != null ? r3(s.followRate) : null, leadRate: s.leadRate != null ? r3(s.leadRate) : null, topLeader: s.topLeader || null, notes: s.notes || '' });
  fs.writeFileSync(jsonPath, JSON.stringify({
    _meta: { generatedAt: new Date().toISOString(), params: Object.fromEntries(Object.entries(opt).filter(([k]) => !k.startsWith('_'))), elapsedMs: now() - t0 },
    sources: G.srcStats, globalWindow: { min: gMin, max: gMax }, tickFilters: G.stats,
    buckets, funnel, anchors: anchorRows, manualCatConflicts,
    batch1: batch1.map(slim), batch2: batch2.map(slim), detail, ab: abReport,
  }, null, 2));

  // ── 控制台报告 ──
  console.log(`\n════════ 聪明钱挖掘报告（${((now() - t0) / 60000).toFixed(1)} 分钟）════════`);
  console.log(`产出: ${csvPath}\n      ${jsonPath}`);
  const show = (arr, label) => {
    if (!arr.length) { console.log(`\n── ${label}: 无 ──`); return; }
    console.log(`\n── ${label} Top ${Math.min(10, arr.length)} / ${arr.length} ──`);
    for (let i = 0; i < Math.min(10, arr.length); i++) {
      const s = arr[i];
      console.log(`  [${i + 1}] ${s.address} n=${s.n} 胜率=${r3(s.winRate)} mean=${r3(s.meanNet)}BNB 总=${r2(s.sumNet)} 中位买=${r3(s.medianBuyBnb)} bad=${r3(s.badShare)} follow=${s.followRate != null ? r3(s.followRate) : '-'} ${s.notes || ''}`);
    }
  };
  show(batch1, '批1 活跃持续盈利');
  show(batch2, '批2 稳准狠');

  // ── --apply（默认关；批 3.3 FA.loadSmartBotWallets 消费 wallets.category='smart_bot'） ──
  if (opt.apply) {
    if (opt.noDb) { console.error('--apply 与 --no-db 互斥'); process.exit(1); }
    let updated = 0, skipped = 0;
    for (let i = 0; i < finalListed.length; i += 100) {
      const batchRows = [];
      for (const s of finalListed.slice(i, i + 100)) {
        if (s.manualCategoryConflict) { skipped++; continue; }
        batchRows.push({
          address: s.address, chain: 'bsc',
          // 双值分流：高频bot样 → 'smart_bot'（引擎 smartBotCount 观察因子名单，apply-smart-bots.cjs 同源），
          // 其余 → 'smart_money'。人工标注行冲突已在上行跳过，这里只有 null/smart 族/新行。
          category: (s.notes && s.notes.includes('高频bot样')) ? 'smart_bot' : 'smart_money',
          // 批 3.3 sniper 名单原料：参与 token 数（rawTotalRun，母版 profile.tokenCount≡rawTotal 恒等式）。
          // ⚠口径边界：仅入榜钱包有值 → sniper 名单 ⊆ 挖掘入榜集；全史 rawTotal 全量画像待后续离线管线。
          // PostgREST upsert onConflict 只更新送入列，未入榜的既有行不受影响（token_count 保持 NULL 不命中阈值）。
          token_count: s.rawTotalRun,
        });
      }
      if (batchRows.length) { const { error } = await client.from('wallets').upsert(batchRows, { onConflict: 'address,chain' }); if (error) throw new Error(`--apply 失败: ${error.message}`); updated += batchRows.length; }
    }
    console.log(`[--apply] wallets.category 写入 ${updated} 行（bot→smart_bot / 其余→smart_money），人工标注冲突跳过 ${skipped} 行`);
  }
  console.log('\nALLDONE_SMART_WALLETS');
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
}
module.exports = { computePairPnL, classifyCarryIn, selectMark, gateWallets, matchABControls, leadLagOnToken, heatBucket, parseArgs, applyFallbackClassification };
