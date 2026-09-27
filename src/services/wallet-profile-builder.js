/**
 * wallet-profile-builder — 钱包画像核心算法（离线构建 / 实时 / 增量合并 共用）
 * （pumpfun 回迁批 4；SOL/lamports → BNB 浮点口径，阈值=母版 ×0.4 换算惯例）
 *
 * 从 TokenPositionAnalyzer._buildProfileFromTicks 抽出的纯函数模块，服务于：
 *   1. 实时 TPA：fetch 某钱包 as-of ticks → buildProfileFromTicks（小钱包全量路径）
 *   2. 离线 build-wallet-profiles.cjs：fetch 高频钱包全历史 ticks → buildProfileFromTicks → 落 wallet_offline_profiles
 *   3. 增量合并：实时 asOf > 离线 data_through 时，fetch [data_through, asOf] 增量 → buildProfileFromTicks
 *      → mergeOfflineProfile(offline, inc) 得截止 asOf 的完整画像
 *
 * 纯函数：ticks（wss_price_ticks 行）+ tokenProfiles（调用方批量预查的 Map）+ opts → 完整 profile 对象。
 *   不持有 supabase client / 不查 DB —— token_profile（category/flashCrashPeriod/firstTickTime）由调用方预查传入。
 *
 * ⚠️字段命名 camelCase（与 TokenPositionAnalyzer._packProfile / wallet-scorer 现有内存对象一致）。
 *   wallet_offline_profiles.profile JSONB 直接存此对象（JSONB key 自由，不强制 snake_case），
 *   落表/读表无需 case 转换层。
 *
 * 单位（BSC 迁移口径）：ticks.bnb_amount 在 DB 层是 BNB 浮点（four.meme/flap 均非 lamports 整数）；
 *   totalBnb/avgBnb 直接累加 BNB，scorer 入口无单位转换。阈值全部=母版 SOL 值 ×0.4 写字面量
 *   （0.5×0.4 等浮点表达式不精确会污染对象 key 与边界比较，故一律写死字面量）。
 *   唯一非 ×0.4 例外：BAD_BUY_EARLY_MS 2000→3000（BSC 3s/块，对齐 FA firstBlockWindowMs=3000，≈1 首块窗）。
 *
 * bad_action 口径（与 build-token-profiles.cjs 分类口径对齐；token 级元数据全读 token_profiles）：
 *   - bad_buy  = holder 在 wash/pump_dump/low_quality token 上 age∈[0,3s)（首笔 buy - token firstTickTime，★age>=0 排除 firstTickTime 滞后致负 age 误判）单买 ≥1.0 BNB
 *   - bad_sell = holder 在 wash token 上单卖 ≥2.0 BNB 且卖出落入 token flashCrash 段 [peakTime, floorTime]
 *   ★high_mcap_wash 中性类（母版 2026-08-05 用户指令）：分子分母都不计（见 BAD_ACTION_NEUTRAL_CATEGORIES）。高市值流水盘
 *     盈利存疑但不定性负面，与 BAD_TOKEN_CATEGORIES 标签层豁免一致——其早期大额买入/集中抛售既不算恶意（分子）也不进
 *     靶向率分母，避免稀释作恶钱包 effBadRatio 致漏判。
 *   ★靶向率口径（修正 largeTradeCount 被跟风交易稀释）：
 *     分母只保留「满足 bad 除恶意类靶向外所有硬条件」的候选交易（★再剔中性类），使 ratio 成为干净的恶意类靶向率：
 *     - earlyLargeBuyCount（badBuy 分母）= age∈[0,3s) + ≥1.0 BNB 的 buy（不分 cat，★剔中性类 high_mcap_wash）
 *     - crashLargeSellCount（badSell 分母）= 闪崩段[peak,floor] + ≥2.0 BNB 的 sell（不分 cat，★剔中性类）
 *     分子 = 同条件 + cat∈恶意类。badBuyRatio/badSellRatio ∈[0,1]，scorer 取 max。
 *
 * isSniper 不在此模块判定（不落表、不存字段）：使用点（wallet-scorer isSniper 内部 tokenCount>=200 现算）
 *   从 profile.tokenCount >= HIGH_FREQ_THRESHOLD(200) 现算，见 scripts/shared/wallet-category.js。
 */
'use strict';

// 金额桶边界（BNB 字面量；母版 SOL 边界 ×0.4：dust 0.001/tiny 0.05/small 上界 0.5/medium 上界 2）
const DUST_BNB = 0.0004;
const TINY_BNB = 0.02;
const LARGE_BNB = 0.2;   // small 桶上界（命名沿用母版 LARGE_LAMPORTS 语义）
const MEDIUM_BNB = 0.8;  // big 桶下界

// bad_action 判定常量（与 build-token-profiles.cjs 分类口径对齐：bad_buy age<3s ≥1.0BNB；bad_sell 闪崩段 ≥2.0BNB）。
const BAD_BUY_BNB = 1.0;   // 早期快速买入单买阈值（母版 2.5 SOL ×0.4）
const BAD_SELL_BNB = 2.0;  // 集中抛售单卖阈值（Tier1 上界；同时是 Tier2 区间 [0.6,2) 的上界）（母版 5 SOL ×0.4）
// ★Tier2 暴力 block 分片抛售下界（母版 Pwease2 式绕过修复）：操纵者用多钱包分片抛 0.6-2BNB 规避 ≥2BNB 的 bad_sell。
//   Tier2 只计「暴力集中抛售 block（token_profile.violentCrashBlocks，单block跌幅≤-30%）内 0.6-2BNB 的 wash 卖」，
//   独立口径（tier2CrashBlockSellCount + tier2Ratio=count/effectiveTradeCount），不计入 badSell/crashLargeSell/badSellRatio（Tier1 零变化）。
//   ratio 高=低频一次性集中抛售分身（目标，该抓）；ratio 低=正常大户偶发（豁免）。low 钱包无分母→ratio=null（保留目标信号）。
const TIER2_SELL_LO_BNB = 0.6;  // （母版 1.5 SOL ×0.4）
const BAD_BUY_EARLY_MS = 3000;  // bad_buy age<3s（首笔 buy - token firstTickTime）。母版 2s→BSC 3s（1 block，对齐 FA firstBlockWindowMs=3000）
const BAD_ACTION_RECENT_MS = 24 * 3600 * 1000;          // 实时 bad_action 24h 布尔窗口（离线全历史累积不用）
const BAD_BUY_CATEGORIES = ['wash', 'pump_dump', 'low_quality', 'low_activity']; // bad_buy 这些类 token（★high_mcap_wash 中性类见下；low_activity 死盘开盘大额早期买入=操纵失败/批量打新早期快速买入信号，与 low_quality 同属差盘）
const BAD_SELL_CATEGORIES = ['wash'];                  // bad_sell wash 类 token（★high_mcap_wash 中性类见下）
// ★bad action 中性类（母版 2026-08-05 用户指令）：分子分母都不计。high_mcap_wash 高市值流水盘盈利存疑但不定性负面，
//   与 BAD_TOKEN_CATEGORIES 标签层豁免一致——其早期大额买入/闪崩集中抛售
//   既不算恶意（分子）也不进靶向率分母，避免稀释作恶钱包 effBadRatio 致漏判。low-level-bad-action 同口径（import 本常量）。
const BAD_ACTION_NEUTRAL_CATEGORIES = ['high_mcap_wash'];
// good_action 早期集中建仓大买的 good 类 token（镜像 BAD_BUY_CATEGORIES；high_mcap/quality，由 token 分类落 token_profiles.category）
const GOOD_BUY_CATEGORIES = ['high_mcap', 'quality'];
const HOLD_PAIR_MIN_BNB = 0.4; // hold FIFO 配对阈值：仅 ≥0.4BNB 较大额参与（母版 1 SOL ×0.4；过滤 dust/tiny/small 噪音与 medium 下半段）。与金额桶分界 LARGE_BNB(0.2) 解耦——桶定义不变，仅 hold 配对收紧
// ★avg 维度聚合口径（母版 2026-08-06）：分批扫单（同 token 同方向连续多笔，典型亚秒级早期快速买入）本质=1 个交易意图被拆成多笔。
//   逐笔口径 avg=totalBnb/tickCount 把这类真实大户误判成 dust-bot（单笔小）。改：同 token 内同方向（buy/buy 或 sell/sell）
//   且相邻事件 block_time 间隔 < AVG_AGG_GAP_MS 的连续交易合并为 1 笔意图，avg 分母从 tickCount 改为聚合后意图数 aggregatedTradeCount。
//   每 token 内部独立按 bt 排序判连续（跨 token 不合并）。wash 对敲买卖交替→方向不连续→不合并（不被帮）。
//   已知妥协：批量型对敲（连买 N 再连卖 N，间隔<5s）会被部分合并（连买段合 1+连卖段合 1）——靠恶意 cap 截断传导 + 上线后观察。
const AVG_AGG_GAP_MS = 5000; // 连续同向聚合间隔阈值（<5s 合并；亚秒级扫单典型 <1s。母版用户 2026-08-06 定）

/**
 * 单笔 max bnb_amount（BNB）→ 金额桶（五档分桶，母版 build.js v5 口径 ×0.4）。
 * dust<0.0004 / tiny∈[0.0004,0.02) / small∈[0.02,0.2) / medium∈[0.2,0.8) / big>=0.8 BNB。
 */
function amountBucket(maxBnb) {
  if (maxBnb < DUST_BNB) return 'dust';
  if (maxBnb < TINY_BNB) return 'tiny';
  if (maxBnb < LARGE_BNB) return 'small';
  if (maxBnb < MEDIUM_BNB) return 'medium';
  return 'big';
}

/** 取多个值中最小者，忽略 null/undefined（用于 firstBt/firstSeenMs 合并）。 */
function minIgnoreNull(...vals) {
  let m = null;
  for (const v of vals) {
    if (v == null) continue;
    if (m === null || v < m) m = v;
  }
  return m;
}

/**
 * 从钱包 ticks 算完整 profile：基础统计 + 持仓时间 + bad_action + 金额桶。
 *
 * @param {Array} ticks wss_price_ticks 行（{token_address, bnb_amount, price_usd, trade_type, block_time}）
 * @param {Map} [tokenProfiles] token → {category, flashCrashPeriod:{peakTime,floorTime}, firstTickTime, violentCrashBlocks}（调用方批量预查）
 * @param {Object} [opts]
 * @param {number} [opts.largeTradeBnb=1.0] 大额笔数阈值(BNB)，默认对齐 BAD_BUY（保证 badCount ⊆ largeCount）
 * @param {number} [opts.asOfMs] 评估时间戳(ms)。badAction24h 用 asOfMs - recentMs 作 recentSince；
 *     传 null/undefined → 不算 badAction24h（离线全历史累积无需 24h 布尔；badCount/badRatio 仍算）。
 * @param {number} [opts.recentMs=86400000] badAction24h 窗口（默认 24h）
 * @returns {Object} profile（camelCase；统计量 + 持仓时间；不含 perToken —— 体积过大不落表，mergeOfflineProfile 改标量累加）
 */
function buildProfileFromTicks(ticks, tokenProfiles, opts = {}) {
  const largeTradeBnb = opts.largeTradeBnb != null ? opts.largeTradeBnb : 1.0;
  const LARGE_TRADE_BNB = largeTradeBnb;
  // ≥0.4BNB 有效交易阈值（大户偶发豁免的整体脏度分母 effectiveTradeCount 用；比 LARGE_TRADE_BNB[1.0BNB] 宽，含 0.4-1.0BNB，排除 dust）
  const effectiveTradeBnb = opts.effectiveTradeBnb != null ? opts.effectiveTradeBnb : 0.4;
  const EFFECTIVE_TRADE_BNB = effectiveTradeBnb;
  const tpMap = tokenProfiles instanceof Map ? tokenProfiles : new Map();
  const asOfMs = opts.asOfMs != null ? opts.asOfMs : null;
  const recentMs = opts.recentMs != null ? opts.recentMs : BAD_ACTION_RECENT_MS;
  const recentSince = asOfMs != null ? asOfMs - recentMs : null;

  // 按 token 聚合：maxBnb(金额桶) + maxPrice + firstBt/lastBt(持仓时间) + buys/sells(bad_action)
  // 同循环零成本累加钱包级评分 raw 统计量（totalBnb/tickCount/largeTradeCount）。
  const byToken = new Map();
  let totalBnb = 0, tickCount = 0, buyCount = 0, sellCount = 0, largeTradeCount = 0, effectiveTradeCount = 0;
  let firstSeenMs = null;
  for (const t of ticks) {
    const tok = t.token_address;
    if (!tok) continue;
    const bnb = Number(t.bnb_amount) || 0;
    const price = Number(t.price_usd) || 0;
    const bt = new Date(t.block_time).getTime();
    // 钱包级累加（评分维度 raw）
    totalBnb += bnb;
    tickCount++;
    if (t.trade_type === 'buy') buyCount++;
    else if (t.trade_type === 'sell') sellCount++;
    if (bnb >= LARGE_TRADE_BNB) largeTradeCount++;
    if (bnb >= EFFECTIVE_TRADE_BNB) effectiveTradeCount++;
    if (firstSeenMs === null || bt < firstSeenMs) firstSeenMs = bt;
    let e = byToken.get(tok);
    if (!e) { e = { maxBnb: 0, maxPrice: 0, firstBt: bt, lastBt: bt, buys: [], sells: [] }; byToken.set(tok, e); }
    if (bnb > e.maxBnb) e.maxBnb = bnb;
    if (price > e.maxPrice) e.maxPrice = price;
    if (bt < e.firstBt) e.firstBt = bt;
    if (bt > e.lastBt) e.lastBt = bt;
    if (t.trade_type === 'buy') e.buys.push({ bt, bnb });
    else if (t.trade_type === 'sell') e.sells.push({ bt, bnb, price, block: t.block_number }); // block: Tier2 暴力block匹配用（number）
  }

  // 金额桶（per wallet-token 单笔 max bnb_amount 归档；与离线构建口径一致）
  const buckets = { total: byToken.size, dust: 0, tiny: 0, small: 0, medium: 0, big: 0 };
  for (const e of byToken.values()) buckets[amountBucket(e.maxBnb)]++;

  // 持仓时间（per-token 大额交易 FIFO 配对：按时间顺序逐笔 buy↔sell 配对，每对 hold=sell.bt−buy.bt）。
  //   ★仅较大额(bnb>=HOLD_PAIR_MIN_BNB=0.4BNB)参与配对：过滤 dust/tiny/small 噪音与 medium 下半段；大额快进快出才是 hold 维度要抓的恶意。
  //   旧口径 avg卖−avg买 对多轮买卖跨轮混算失真（如 21 buys 均值 vs 2 sells 均值=无意义差值；先卖后买致负值被 max(0) 截断）；
  //     FIFO 逐笔配对消除失真：先卖后买的 sell 无对应 buy→跳过（不产生负值不截断），未平仓 buy→不配对。
  const holdSecs = [];
  for (const e of byToken.values()) {
    const evs = [];
    for (const b of e.buys) if (b.bnb >= HOLD_PAIR_MIN_BNB) evs.push({ t: b.bt, buy: true });
    for (const s of e.sells) if (s.bnb >= HOLD_PAIR_MIN_BNB) evs.push({ t: s.bt, buy: false });
    if (!evs.length) continue;
    evs.sort((a, b) => a.t - b.t);
    const buyQ = []; let head = 0;   // FIFO：最早 buy 配当前 sell（先进先出，反映真实持仓周期）
    for (const ev of evs) {
      if (ev.buy) buyQ.push(ev.t);
      else if (head < buyQ.length) { holdSecs.push(Math.max(0, Math.round((ev.t - buyQ[head]) / 1000))); head++; }
    }
  }
  holdSecs.sort((a, b) => a - b);
  const avgHoldSeconds = holdSecs.length ? Math.round(holdSecs.reduce((acc, x) => acc + x, 0) / holdSecs.length) : 0;
  // medianHoldSeconds：holdSecs 空（无已平仓 token）= null（scorer 豁免口径失效）；非空含 0（极速 <0.5s 平仓，合法重罚值）
  const medianHoldSeconds = holdSecs.length ? holdSecs[Math.floor(holdSecs.length / 2)] : null;

  // ★avg 维度聚合（连续同向 <AVG_AGG_GAP_MS 合并为 1 个交易意图）：totalBnb 不变（逐笔之和=聚合后各组之和），仅改 avg 分母。
  //   每 token 内 buys+sells 合并按 bt 排序后线性扫描：相邻同向且间隔 < AVG_AGG_GAP_MS → 同一意图；否则新意图。
  //   与 hold 段同款 per-token sort（byToken 已存 buys:[{bt,bnb}]/sells:[{bt,bnb}]，无需补字段）。
  let aggregatedTradeCount = 0;
  for (const e of byToken.values()) {
    const evs = [];
    for (const b of e.buys) evs.push({ t: b.bt, buy: true });
    for (const s of e.sells) evs.push({ t: s.bt, buy: false });
    if (!evs.length) continue;
    evs.sort((a, b) => a.t - b.t);
    let prevT = null, prevBuy = null;
    for (const ev of evs) {
      if (prevT == null || !(prevBuy === ev.buy && ev.t - prevT < AVG_AGG_GAP_MS)) aggregatedTradeCount++; // 新意图
      prevT = ev.t; prevBuy = ev.buy;
    }
  }

  // bad_action：token_profile 提供 category/flashCrashPeriod/firstTickTime
  let badAction24h = false;
  let badCount14d = 0; // 字段名保留兼容 scorer；语义=本批 ticks 内的 bad 计数（离线全历史 / 实时 14d 窗口）
  let badBuyCount = 0, badSellCount = 0;
  let earlyLargeBuyCount = 0, crashLargeSellCount = 0;
  let tier2CrashBlockSellCount = 0; // Tier2 暴力block内 0.6-2BNB wash 卖次数（独立口径，不进 badSell 体系）
  for (const [tok, e] of byToken) {
    const prof = tpMap.get(tok);
    if (!prof) continue; // token 无 profile（未分类新 token）→ 不计 bad_action
    if (BAD_ACTION_NEUTRAL_CATEGORIES.includes(prof.category)) continue; // ★中性类（high_mcap_wash）分子分母都不计
    // bad_buy 候选分母（age∈[0,3s) + ≥1.0BNB，不分 cat，需 firstTickTime）+ 分子（cat∈BAD_BUY_CATEGORIES）
    // ★age>=0 下界（母版 2026-08-04）：firstTickTime 可能滞后（token 分类 scope 未回看历史 ticks），
    //   致 buy 早于记录的 firstTickTime → age 为负 → 负数<3s 被误判早期快速买入（母版 ZRKYz 案：age=-20h 被当 2s 内买入→靶向率100%→cap0.5）。
    //   age<0 = firstTickTime 不可靠，该笔 early 判定不成立，排除。合法 early（age∈[0,3s)）不受影响。
    if (prof.firstTickTime) {
      const isBuyCat = BAD_BUY_CATEGORIES.includes(prof.category);
      for (const b of e.buys) {
        const age = b.bt - prof.firstTickTime;
        if (age >= 0 && age < BAD_BUY_EARLY_MS) {
          if (b.bnb >= BAD_BUY_BNB) {
            earlyLargeBuyCount++;            // 分母（靶向率候选，不分 cat）
            if (isBuyCat) {                  // 分子（恶意类）
              badBuyCount++; badCount14d++;
              if (recentSince !== null && b.bt >= recentSince) badAction24h = true;
            }
          }
        }
      }
    }
    // bad_sell 候选分母（闪崩段 + ≥2.0BNB，不分 cat，需 flashCrashPeriod）+ 分子（cat∈BAD_SELL_CATEGORIES=wash）
    if (prof.flashCrashPeriod) {
      const isSellCat = BAD_SELL_CATEGORIES.includes(prof.category);
      const { peakTime, floorTime } = prof.flashCrashPeriod;
      for (const s of e.sells) {
        if ((s.bt >= peakTime) && (s.bt <= floorTime)) {
          if (s.bnb >= BAD_SELL_BNB) {
            crashLargeSellCount++;          // 分母（靶向率候选，不分 cat）
            if (isSellCat) {                // 分子（wash）
              badSellCount++; badCount14d++;
              if (recentSince !== null && s.bt >= recentSince) badAction24h = true;
            }
          }
        }
      }
      // Tier2 暴力 block 内 0.6-2BNB wash 卖（独立口径，不计 badSell/crashLargeSell/badSellRatio — Tier1 零变化）。
      // violentCrashBlocks(number[]) 由 token 分类时算好落 token_profiles.profile（snake_case violent_crash_blocks，调用方映射 camelCase）；
      // isSellCat=wash（中性类已 continue）。s.block 全 number（sells push 的 t.block_number），Set<number>.has(number) 无字符串坑。
      if (isSellCat && prof.violentCrashBlocks && prof.violentCrashBlocks.length) {
        const vSet = new Set(prof.violentCrashBlocks);
        for (const s of e.sells) {
          if (s.block != null && vSet.has(s.block) && s.bnb >= TIER2_SELL_LO_BNB && s.bnb < BAD_SELL_BNB) {
            tier2CrashBlockSellCount++;
          }
        }
      }
    }
  }

  const total = buckets.total || 0;
  // ★effectiveTokenCount：≥EFFECTIVE_TRADE_BNB(0.4BNB) 的去重代币数（effectiveTradeCount 的去重版）。
  //   与 effectiveTradeCount 同 0.4BNB 口径，但按 token 去重（该 token maxBnb≥0.4BNB 即计 1）；
  //   意在替代 tokenCount 作"大户认证"广度指标（tokenCount 含 dust-only 代币易被广撒网刷量拉高）。
  //   ⚠️暂未启用：scorer isLargeTrader 仍用 tokenCount，本字段仅预计算落库，待 offline 自然重跑后离线验证再决定是否接入。
  let effectiveTokenCount = 0;
  for (const e of byToken.values()) if (e.maxBnb >= EFFECTIVE_TRADE_BNB) effectiveTokenCount++;
  return {
    // 基础统计（BNB 浮点；scorer 直读无转换）
    rawTotal: total,                 // distinct token 数（= tokenCount；rawTotal 名保留兼容现有 scorer/TPA 代码）
    tokenCount: total,               // distinct token 数（★isSniper 使用点从 tokenCount>=200 现算，不落 is_sniper 字段）
    tickCount,                       // 保留：展示用，不进评分（vol 用 totalBnb；avg 用 aggregatedTradeCount）
    totalBnb,
    aggregatedTradeCount,            // ★连续同向聚合后的交易意图数（avg 分母；见 AVG_AGG_GAP_MS）
    avgBnb: aggregatedTradeCount > 0 ? totalBnb / aggregatedTradeCount : 0,  // ★聚合口径（旧 totalBnb/tickCount 已废）
    buyCount,
    sellCount,
    largeTradeCount,
    effectiveTradeCount,           // ≥0.4BNB 有效交易笔数（大户偶发豁免整体脏度分母；比 largeTradeCount[≥1.0BNB] 宽，含 0.4-1.0BNB）
    effectiveTokenCount,           // ≥0.4BNB 的去重代币数（effectiveTradeCount 去重版；★暂未启用，预计算落库备用）
    // 金额分桶（holding factors 的 dustRatio/lowRatio 用）
    buckets,
    dustRatio: total > 0 ? buckets.dust / total : 0,
    lowRatio: total > 0 ? (buckets.dust + buckets.tiny + buckets.small) / total : 0,
    lowTinyRatio: total > 0 ? (buckets.dust + buckets.tiny) / total : 0,
    // 持仓时间（per-token FIFO 配对，仅已平仓较大额）
    avgHoldSeconds,
    medianHoldSeconds,
    firstSeenMs,
    // bad_action（全历史累积；靶向率口径）
    badAction: badAction24h,         // 24h 布尔（喂 verdict；离线 asOfMs=null → 恒 false）
    badCount14d,                     // 字段名保留兼容；语义=本批 bad 计数
    badBuyCount,
    badSellCount,
    earlyLargeBuyCount,              // badBuyRatio 分母
    crashLargeSellCount,             // badSellRatio 分母
    badBuyRatio: earlyLargeBuyCount > 0 ? badBuyCount / earlyLargeBuyCount : 0,
    badSellRatio: crashLargeSellCount > 0 ? badSellCount / crashLargeSellCount : 0,
    badRatio: largeTradeCount > 0 ? badCount14d / largeTradeCount : 0, // 旧口径（所有大额分母），仅参考
    // Tier2 暴力block 独立口径（观察字段，不进 scorer；回测定阈值后接惩罚）
    tier2CrashBlockSellCount,
    tier2Ratio: effectiveTradeCount > 0 ? tier2CrashBlockSellCount / effectiveTradeCount : null, // null=低频钱包无有效交易分母（目标信号，非 0）
  };
}

/**
 * 合并离线 profile（截止 data_through 全历史累积）+ 增量 profile（[data_through, asOf]）。
 *
 * ⚠️ 无 perToken（落表体积过大已移除）：buckets / 持仓 / tokenCount 用 offline 全历史值，不去重合并 inc。
 *   失真 = 漏 inc（data_through→asOf，几小时-1天）新 token 的桶分类与持仓。
 *   核心维度 bad_action 靶向率 / totalBnb / tickCount / aggregatedTradeCount 是 per-tick/per-意图 标量累加（不涉 token 去重），实时性保留。
 *   aggregatedTradeCount 边界失真：offline 末笔与 inc 首笔若同向 <AVG_AGG_GAP_MS 本应合并却分属两段 → 漏合并 ≤1 组（avg 略偏低）。
 *   离线全量重跑每次推进 data_through，buckets/aggregatedTradeCount 失真只到下次重跑自然修正。
 *
 * @param {Object} offline 离线 profile（wallet_offline_profiles.profile JSONB，camelCase；buildProfileFromTicks 完整产出）
 * @param {Object} inc 增量 profile（buildProfileFromTicks 产出，[data_through, asOf] 窗口）
 * @returns {Object} 完整 profile（截止 asOf；camelCase；标量累加 + offline buckets/hold）
 */
function mergeOfflineProfile(offline, inc) {
  const o = offline || {};
  const i = inc || {};

  // 标量累加（核心维度：bad_action / 资金 / 笔数 — per-tick 计数不涉 token 去重，实时性必需）
  // ★迁移哨兵：旧 wallet_offline_profiles.profile JSONB 缺 aggregatedTradeCount（母版 2026-08-06 新增字段）→ fail-loud。
  //   不静默兜底（fallback 0 致 avg=totalBnb/inc.count 爆炸；fallback tickCount 致半新半旧）。部署须先全量重跑 offline 再上线读侧，此 throw 永不触发；保留作永久哨兵。
  if ((o.tickCount || 0) > 0 && o.aggregatedTradeCount == null) {
    throw new Error('stale offline profile: missing aggregatedTradeCount (rerun build-wallet-profiles)');
  }
  // ★Tier2 降级（母版 2026-08-08）：threshold=3 全覆盖设计下 offline 不该缺 tier2；历史 profile 缺失时降级当 0，
  //   不 fail-loud 阻断（用户定；threshold=3 全量重跑后根治）。merge 累加 0 不影响增量段 tier2。
  //   注：上方 aggregatedTradeCount 哨兵仍 fail-loud（avg 分母爆炸，不可当 0）。
  if (o.tier2CrashBlockSellCount == null) o.tier2CrashBlockSellCount = 0;
  const totalBnb = (o.totalBnb || 0) + (i.totalBnb || 0);
  const tickCount = (o.tickCount || 0) + (i.tickCount || 0);
  const aggregatedTradeCount = (o.aggregatedTradeCount || 0) + (i.aggregatedTradeCount || 0);
  const buyCount = (o.buyCount || 0) + (i.buyCount || 0);
  const sellCount = (o.sellCount || 0) + (i.sellCount || 0);
  const largeTradeCount = (o.largeTradeCount || 0) + (i.largeTradeCount || 0);
  const effectiveTradeCount = (o.effectiveTradeCount || 0) + (i.effectiveTradeCount || 0);
  const badCount14d = (o.badCount14d || 0) + (i.badCount14d || 0);
  const earlyLargeBuyCount = (o.earlyLargeBuyCount || 0) + (i.earlyLargeBuyCount || 0);
  const crashLargeSellCount = (o.crashLargeSellCount || 0) + (i.crashLargeSellCount || 0);
  const badBuyCount = (o.badBuyCount || 0) + (i.badBuyCount || 0);
  const badSellCount = (o.badSellCount || 0) + (i.badSellCount || 0);
  const tier2CrashBlockSellCount = (o.tier2CrashBlockSellCount || 0) + (i.tier2CrashBlockSellCount || 0);

  return {
    rawTotal: o.tokenCount,
    tokenCount: o.tokenCount,
    effectiveTokenCount: o.effectiveTokenCount, // ★去重代币数不可跨窗口标量累加，用 offline 全历史值（同 tokenCount 口径；旧 profile 缺=undefined，暂未启用无害）
    tickCount,
    totalBnb,
    aggregatedTradeCount,
    avgBnb: aggregatedTradeCount > 0 ? totalBnb / aggregatedTradeCount : 0,
    buyCount,
    sellCount,
    largeTradeCount,
    effectiveTradeCount,
    buckets: o.buckets,            // offline 全历史桶（不合并 inc；漏 inc 新 token 的桶分类）
    dustRatio: o.dustRatio,        // offline 全历史比例（dust/low 桶口径，inc 新 token 影响小）
    lowRatio: o.lowRatio,
    lowTinyRatio: o.lowTinyRatio,
    avgHoldSeconds: o.avgHoldSeconds,
    medianHoldSeconds: o.medianHoldSeconds,
    firstSeenMs: minIgnoreNull(o.firstSeenMs, i.firstSeenMs),
    badAction: !!(o.badAction || i.badAction),
    badCount14d,
    badBuyCount,
    badSellCount,
    earlyLargeBuyCount,
    crashLargeSellCount,
    badBuyRatio: earlyLargeBuyCount > 0 ? badBuyCount / earlyLargeBuyCount : 0,
    badSellRatio: crashLargeSellCount > 0 ? badSellCount / crashLargeSellCount : 0,
    badRatio: largeTradeCount > 0 ? badCount14d / largeTradeCount : 0,
    tier2CrashBlockSellCount,
    tier2Ratio: effectiveTradeCount > 0 ? tier2CrashBlockSellCount / effectiveTradeCount : null,
  };
}

module.exports = {
  buildProfileFromTicks,
  mergeOfflineProfile,
  amountBucket,
  minIgnoreNull,
  BAD_BUY_BNB,
  BAD_SELL_BNB,
  TIER2_SELL_LO_BNB,
  BAD_BUY_EARLY_MS,
  BAD_ACTION_RECENT_MS,
  BAD_BUY_CATEGORIES,
  BAD_SELL_CATEGORIES,
  BAD_ACTION_NEUTRAL_CATEGORIES,
  GOOD_BUY_CATEGORIES,
  AVG_AGG_GAP_MS,
};
