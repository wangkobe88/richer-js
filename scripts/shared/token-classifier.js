/**
 * token 分类器（pumpfun scripts/shared/token-classifier.js 的 BSC 改造版，回迁批 3.1）
 *
 * 直接从 tick 数据计算分类指标，不依赖 FactorAggregator：
 *   - wash:          流水盘（peak 后窗口内 peak rel 急跌[≤-50%，统一阈值] + 急跌谷底后起不来[反弹<1.3]，且 4K ≤ 峰值市值 < 15K）
 *   - high_mcap_wash:高市值流水盘（闪崩同 wash，但峰值市值 ≥ 15K + 扣前9秒 ratio≥2.2 + 砸盘窗口无单 block 暴跌≤-40%）
 *                    ——独立中性分类，不惩罚（盈利存疑但不好定性为负面）
 *   - pump_dump:  拉高出货——(a) graduation 断流收割盘（maxMC>$25K + tickCount<50 断流 + 末价≈峰值[dd≥-6] +
 *                 无闪崩：开盘极速拉到接近毕业市值后 graduation 出内盘，砸盘在 PancakeSwap 不可见，
 *                 WSS 只订阅 four.meme TokenManager 故看不到下跌段）；
 *                 (b) 内盘可见砸盘（最高价出现在前 N 秒，从高点回撤 ≥M%，且峰值市值 ≥ 9K）
 *   - quality:    高质量（峰值市值 ≥ 8K 且 < 15K，且非 wash/pump_dump；$8K-9K 且 peak ≤15s 归 normal）
 *   - high_mcap:  高市值（峰值市值 ≥ 15K，且非 wash/pump_dump）
 *   - normal:     普通（峰值市值在 6K-8K 之间）
 *   - low_quality:低质量（峰值市值 < 6K）
 *   - low_activity:低活跃度（tick 数 < MIN_TICKS，数据不足以做市值/操纵分类）
 *
 * BSC 适配口径（与 pumpfun 母版的差异，全部显式声明）：
 *   1. 价格双链：比率族判定（闪崩/暴力 block 跌幅/dd/peak/afterFirst9s ratio/priceChange）用 priceBnb
 *      ——BNB 链内自洽（同 tick 的 priceBnb 与 priceUsd 同源换算，分钟级 BNB/USD 波动 ≪ 崩盘幅度，
 *      比率几乎等价）；市值族（maxMarketCap/市值门槛）用 priceUsd（可 null）。
 *   2. maxMarketCap = highestPriceUsd × totalSupply（每 token 真实发行量，TokenCreate 事件），
 *      非母版常数 1.073B reserves。totalSupply 缺失(≤0) → maxMarketCap=0 → low_quality（保守方向，
 *      与母版"无达标 tick → 0 → low_quality"同语义）。
 *   3. drawdownFromHighestPct 弃 floor-relative，用 BNB 简单百分比 (last-peak)/peak×100：
 *      floor 换算需 USD 锚且判定门（dd≥-6 / |dd|≥60）在两式差异方向一致（简单式更保守），影响微小。
 *   4. slot→block（block_number，BSC ~3s/块）；sol_amount lamports → bnbAmount 十进制 BNB（无 ×1e9）。
 *   5. 尘 tick 门：priceReliable 布尔（在线=FA _acceptPrice+尘门已含；离线=DB price_outlier），
 *      分类器内部再 AND 金额门（bnbAmount ≥ MIN_PRICE_UPDATE_BNB）保证两路径绝对一致。
 *
 * 统一 slim tick 输入 shape（离线 DB 行 / 在线 FA state._clsTicks 都是此形状，零适配）：
 *   { ts: number(ms), isBuy: boolean, bnbAmount: number(BNB), priceBnb: number>0,
 *     priceUsd: number|null, blockNumber: number|null, priceReliable: boolean }
 *
 * 此文件是 token 分类的单一真相来源，其他模块不得重复实现分类逻辑。
 */

const {
  MIN_TICKS, MIN_PRICE_UPDATE_BNB,
  FLASH_CRASH_WINDOW_MS, FLASH_CRASH_DROP_THRESHOLD, FLASH_CRASH_REBOUND_K,
  VIOLENT_BLOCK_PRE_MS, VIOLENT_BLOCK_POST_MS, VIOLENT_BLOCK_TOP_K, VIOLENT_BLOCK_DROP_THRESHOLD,
  DEFAULT_SCORING_PARAMS, OPB_DEFAULTS,
} = require('./classifier-constants');

const CLASSIFIER_VERSION = 'bsc-v2'; // BSC 分叉从 v1 起（母版 v7 口径已按上述适配变更，不沿用版本号）
// v2 = v1 分类判定逐字不变，仅 profile 新增涨幅指标（max/final_change_percent；bsc-v1 行无涨幅列，重跑后升 v2）

// afterFirst9s 基准窗（母版扣前3秒=7.5 slot；BSC 9s=3 block）
const FIRST_WINDOW_MS = 9000;

// 价格追踪过滤：可靠价（映射方标志）AND 尘门金额（双保险，在线/离线两路径绝对一致）
function _priceUsable(tk) {
  return tk.priceReliable && (Number(tk.bnbAmount) || 0) >= MIN_PRICE_UPDATE_BNB && Number(tk.priceBnb) > 0;
}

// ── 闪崩检测 ──

/**
 * 检测 tick 序列中是否存在流水盘闪崩（急跌 + 起不来），返回首个成立的急跌段时段。
 *
 * 判据（母版逐字保留）：peak 之后，价格视作 step function（tick 间无交易时保持前值），存在某个谷底 j 满足：
 * j 前 ≤ FLASH_CRASH_WINDOW_MS 窗口内 step 最高价 high 使 (pj-high)/high ≤ FLASH_CRASH_DROP_THRESHOLD，
 * 且 j 之后最高价 ≤ FLASH_CRASH_REBOUND_K × pj（起不来=死亡）。high 含「窗口外紧邻 tick 的继承价」
 * （静默期保持的前值）——修复静默期撑大墙钟窗口导致瞬间砸盘漏判。
 *
 * @param {Array} ticks slim tick 序列（按 ts 升序）
 * @param {Object} [options={}]
 * @param {number} [options.peakTimeMs=null] 最高价时间戳（毫秒）。急跌段必须在 peak 之后
 * @returns {{peakTime,peakPrice,floorTime,floorPrice}|null} 急跌起点(局部高点)→谷底 时段；无则 null
 */
function findFlashCrashPeriod(ticks, options = {}) {
  const { peakTimeMs = null } = options;
  // 紧凑化：仅保留可用价 tick（尘/离群价不构成价格变化点）
  const pts = [];
  for (const tk of ticks) {
    if (!_priceUsable(tk)) continue;
    pts.push({ t: tk.ts, p: Number(tk.priceBnb) });
  }
  const n = pts.length;
  if (n < 2) return null;
  // suffixMax[k] = max(pts[k..n-1].p)：O(1) 查询急跌谷底 j 之后的最高价（判断起不来）
  const suffixMax = new Array(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k--) suffixMax[k] = pts[k].p > suffixMax[k + 1] ? pts[k].p : suffixMax[k + 1];
  // 价格视作 step function：tick 间无交易时价格保持前值。
  // 闪崩 = 存在谷底 j，其价相对「j 前 ≤W 窗口内 step 最高价 high」跌幅 ≥ DROP，且 j 后起不来。
  // high(j) = max( 窗口外紧邻继承价 pts[left-1].p, 窗口 [left,j] 内最高价 windowMax )。
  const W = FLASH_CRASH_WINDOW_MS;
  let start = 0;
  if (peakTimeMs !== null) while (start < n && pts[start].t < peakTimeMs) start++;
  let left = 0;
  const deque = []; // 索引队列，pts[].p 单调递减，队首 = [left,j] 最高价
  for (let j = 0; j < n; j++) {
    const tj = pts[j].t, pj = pts[j].p;
    while (left < j && pts[left].t < tj - W) left++;          // 推进窗口左界
    while (deque.length && deque[0] < left) deque.shift();    // 清队首越界
    while (deque.length && pts[deque[deque.length - 1]].p <= pj) deque.pop();
    deque.push(j);
    if (j < start) continue;                                   // peak 之前不作谷底
    const windowMax = pts[deque[0]].p;
    const inherit = left > 0 ? pts[left - 1].p : 0;           // 窗口外紧邻 step 继承价
    const high = inherit > windowMax ? inherit : windowMax;
    if ((pj - high) / high * 100 <= FLASH_CRASH_DROP_THRESHOLD && suffixMax[j + 1] <= FLASH_CRASH_REBOUND_K * pj) {
      // 急跌 + 谷底后起不来 → wash。急跌段 [high 来源(局部高点), j(谷底)] 即砸盘窗口。
      const hiIdx = inherit > windowMax && left > 0 ? left - 1 : deque[0];
      return { peakTime: pts[hiIdx].t, peakPrice: pts[hiIdx].p, floorTime: tj, floorPrice: pj };
    }
  }
  return null;
}

function hasFlashCrash(ticks, options = {}) {
  return findFlashCrashPeriod(ticks, options) !== null;
}

/**
 * 识别 Tier2 暴力砸盘 block（bad_sell 分片抛售绕过修复）。
 *
 * 暴力 block = 砸盘高度集中的 block：流水盘砸盘通常 1-2 个 block 内 price 从首到尾暴跌（单 block 跌幅 ≥30%），
 *   区别于「失败盘」（数秒逐步下跌，单 block 跌幅小）。DROP_THRESHOLD=-30% 过滤失败盘避免误伤其散户。
 *
 * ★用 Map<blockNumber,{firstPr,lastPr}>（数字 key），不用 Object.entries——后者把数字 block_number
 *   强转字符串 key，致 Set 存储比较时类型不一致（母版分析脚本踩过的 String() 强转坑）。
 *   返回 number[]，全链路 number 流通。
 *
 * @param {Array} ticks slim tick 序列（按 ts 升序）
 * @param {Object} flashCrashPeriod findFlashCrashPeriod 返回 {peakTime,peakPrice,floorTime,floorPrice}
 * @returns {number[]} 暴力砸盘 block 的 block_number 数组（按 block 内跌幅最负排序，仅保留 drop≤-30% 的前 K 个）；无则 []
 */
function computeViolentCrashBlocks(ticks, flashCrashPeriod) {
  return _topViolentBlocks(_computeBlockDrops(ticks, flashCrashPeriod));
}

// 砸盘窗口内逐 block 首价→末价跌幅（共享核心，computeViolentCrashBlocks / computeMaxBlockDropPct 复用）。
// 窗口 [peakTime - VIOLENT_BLOCK_PRE_MS, floorTime + VIOLENT_BLOCK_POST_MS]；per-block firstPr/lastPr
// （Map 数字 key 避字符串坑；ticks 升序时 firstPr=block 首笔=开盘，lastPr=末笔=收盘）。drop 为百分数（负）。
// 按 drop 升序返回（最负/跌幅最大在前）；flashCrashPeriod 为空或无窗口 tick → []。
function _computeBlockDrops(ticks, flashCrashPeriod) {
  if (!flashCrashPeriod) return [];
  const winStart = flashCrashPeriod.peakTime - VIOLENT_BLOCK_PRE_MS;
  const winEnd = flashCrashPeriod.floorTime + VIOLENT_BLOCK_POST_MS;
  const blockPrice = new Map();
  for (const tk of ticks) {
    if (!_priceUsable(tk)) continue;                        // 尘 tick 假价跳过
    if (tk.ts < winStart || tk.ts > winEnd) continue;
    const bn = tk.blockNumber;
    if (bn == null) continue;
    let v = blockPrice.get(bn);
    if (!v) { v = { firstPr: Number(tk.priceBnb), lastPr: Number(tk.priceBnb) }; blockPrice.set(bn, v); }
    v.lastPr = Number(tk.priceBnb);
  }
  const drops = [];
  for (const [bn, v] of blockPrice) {
    if (v.firstPr > 0) drops.push({ bn, drop: (v.lastPr - v.firstPr) / v.firstPr * 100 });
  }
  drops.sort((a, b) => a.drop - b.drop); // 最负（跌幅最大）在前
  return drops;
}

// top-K 降幅 block 且单 block 跌幅 ≤ -30%（暴力 block；过滤逐步下跌的失败盘）。返回 number[]，全链路 number 流通。
function _topViolentBlocks(drops) {
  return drops.slice(0, VIOLENT_BLOCK_TOP_K).filter(d => d.drop <= VIOLENT_BLOCK_DROP_THRESHOLD).map(d => d.bn);
}

/**
 * 砸盘窗口内单 block 最大跌幅（百分数，负；flashCrashPeriod 为空或无窗口 tick → 0）。
 * 供 high_mcap_wash「暴力 block」降级门（highMcapWashSlotDropThreshold）判定：maxBlockDropPct ≤ 阈值 → 砸盘够暴力 → 降级 wash。
 */
function computeMaxBlockDropPct(ticks, flashCrashPeriod) {
  const drops = _computeBlockDrops(ticks, flashCrashPeriod);
  return drops.length ? drops[0].drop : 0;
}

// ── 从 ticks 直接计算分类所需指标 ──

/**
 * 从 slim tick 序列直接计算分类所需的核心指标（不依赖 FactorAggregator）
 *
 * @param {Array} ticks slim tick 序列（按 ts 升序）
 * @param {number} [totalSupply=0] 代币发行量（TokenCreate；≤0 → maxMarketCap=0 归 low_quality 保守方向）
 */
function computeTickMetrics(ticks, totalSupply = 0) {
  let highestPriceBnb = 0;
  let highestPriceUsd = 0;
  let peakIdx = 0;
  let lastPriceBnb = 0;
  let firstUsablePriceBnb = 0;
  const uniqueTraders = new Set();
  let totalBuyBnb = 0;
  let totalSellBnb = 0;
  let buyCount = 0;
  let sellCount = 0;

  // ── high_mcap_wash 收紧 ratio 门：扣除前9秒后 afterFirst9s 区间的 peak + 峰值前 min ──
  // 分子 afterFirst9sPeakPrice、分母 beforeFirst9sPeakMin（[firstTime+9s, peakTime] 最低价，砸盘地板价在峰值后不计入）。
  // 单次遍历 running min + 创新高锁定（母版范式），与 FA running 标量同口径。BNB 链（比率无量纲）。
  const firstTime = ticks.length ? ticks[0].ts : 0;
  let afterFirst9sPeakPrice = 0;
  let runningMinAfterFirst9s = Infinity;
  let beforeFirst9sPeakMin = Infinity;
  let afterFirst9sReliableCount = 0;

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];

    if (tick.traderAddress) uniqueTraders.add(tick.traderAddress);

    // 可靠价（尘门+离群）才用于价格追踪（在线=FA priceReliable 已含；离线=映射方 outlier 标志 + 此处金额门）
    if (_priceUsable(tick)) {
      const priceBnb = Number(tick.priceBnb);
      const priceUsd = Number(tick.priceUsd) || 0;
      if (firstUsablePriceBnb === 0) firstUsablePriceBnb = priceBnb; // 涨幅基准价：可用价链首值（priceBnb>0 由 _priceUsable 保证，0 哨兵安全）
      if (priceBnb > highestPriceBnb) {
        highestPriceBnb = priceBnb;
        highestPriceUsd = priceUsd; // USD 峰与 BNB 峰同 tick 快照（母版同构：peak 时点的 USD 价）
        peakIdx = i;
      }
      lastPriceBnb = priceBnb;

      // high_mcap_wash 收紧：afterFirst9s（ts >= firstTime+9s）达标 tick 的 peak + 峰值前 min
      // （砸盘地板价在峰值后不计入 min）。与 FA running 标量同口径（尘门过滤 + firstTickAt+9s 基准）。
      if (tick.ts >= firstTime + FIRST_WINDOW_MS) {
        afterFirst9sReliableCount++;
        if (priceBnb < runningMinAfterFirst9s) runningMinAfterFirst9s = priceBnb;
        if (priceBnb > afterFirst9sPeakPrice) {
          afterFirst9sPeakPrice = priceBnb;
          beforeFirst9sPeakMin = runningMinAfterFirst9s; // 锁定到此 peak 为止的 min（含本 tick，但它非 min 不影响）
        }
      }
    }

    const bnb = Number(tick.bnbAmount) || 0;
    if (tick.isBuy) {
      buyCount++;
      totalBuyBnb += bnb;
    } else {
      sellCount++;
      totalSellBnb += bnb;
    }
  }

  const peakTimeSeconds = (ticks[peakIdx].ts - firstTime) / 1000;
  const lastTime = ticks[ticks.length - 1].ts;
  const ageSeconds = (lastTime - firstTime) / 1000;

  // drawdownFromHighestPct：BNB 简单百分比（BSC 适配：弃 floor-relative——floor 换算需 USD 锚，
  // 判定门在两式差异方向一致（简单式更保守），见文件头注释 3）
  const drawdownFromHighestPct = highestPriceBnb > 0
    ? ((lastPriceBnb - highestPriceBnb) / highestPriceBnb) * 100
    : 0;

  // maxMarketCap：由可靠价 tick 的 USD 最高价 × totalSupply 决定。
  // 若无任何达标 tick 或 totalSupply 缺失(≤0)（Create 事件丢失），maxMarketCap = 0，代币归 low_quality（保守方向）。
  // 不做含尘 tick 的 fallback：极小额小单算出的单价可虚高数万倍（母版 case），价格不可用时给 0
  // 远好过用脏数据编造荒谬市值。
  const maxMarketCap = highestPriceUsd * (totalSupply > 0 ? totalSupply : 0);

  // priceChangePct（BNB 首末）
  const firstPriceBnb = ticks.length ? (Number(ticks[0].priceBnb) || 0) : 0;
  const priceChangePct = firstPriceBnb > 0
    ? ((lastPriceBnb - firstPriceBnb) / firstPriceBnb) * 100
    : 0;

  // 涨幅指标（退役页面涨幅分析的替代口径，BNB 计价与比率族原则一致）：
  // base = 首个可用价 tick，peak/final = 可用价链最大/末值。无可用价 tick → null（尘票/离群全滤）。
  const maxChangePercent = firstUsablePriceBnb > 0
    ? ((highestPriceBnb - firstUsablePriceBnb) / firstUsablePriceBnb) * 100
    : null;
  const finalChangePercent = firstUsablePriceBnb > 0
    ? ((lastPriceBnb - firstUsablePriceBnb) / firstUsablePriceBnb) * 100
    : null;

  return {
    highestPriceBnb,
    highestPriceUsd,
    peakIdx,
    peakTimeSeconds,
    firstTickTime: firstTime, // token 首笔 tick 时间（ms），与 lastTickTime 成对 = 分类所用 ticks 的时间范围
    lastTickTime: lastTime,
    lastPriceBnb,
    uniqueTraders: uniqueTraders.size,
    totalBuyBnb,
    totalSellBnb,
    buyCount,
    sellCount,
    tickCount: ticks.length,
    ageSeconds,
    drawdownFromHighestPct,
    maxMarketCap,
    priceChangePct,
    firstUsablePriceBnb,
    maxChangePercent,   // (可用价峰-基准)/基准*100，BNB 计价；null = 无可用价 tick
    finalChangePercent, // (可用价末-基准)/基准*100，BNB 计价；null = 无可用价 tick
    // high_mcap_wash 收紧 ratio：afterFirst9s peak / 峰值前 min（[firstTickTime+9s, peakTime] 最低价，砸盘地板价不计入）。
    // null = afterFirst9s 达标 tick <2 或 peak 在前9秒内（数据不足以证明真实拉升）→ 判定时不归 high_mcap_wash → 落 wash。
    beforePeakMaxMinRatio:
      afterFirst9sReliableCount >= 2 && beforeFirst9sPeakMin > 0 && beforeFirst9sPeakMin !== Infinity
        ? afterFirst9sPeakPrice / beforeFirst9sPeakMin
        : null,
  };
}

// ── 拉高出货检测 ──

/**
 * graduation 断流收割盘检测（出内盘收割 / 极速拉高出货）
 *
 * 开盘极速拉到接近毕业的高市值后 graduation（LiquidityAdded 出内盘），WSS 在峰值处断流——砸盘发生在
 * PancakeSwap（外盘），WSS 只订阅 four.meme TokenManager 内盘事件故看不到下跌段。用"断流签名"判定：
 *   - maxMarketCap > $25K   极速拉到的市值（断流盘上 = 前段最高价；阈值 BSC 先沿用待重校）
 *   - tickCount < 50        低 tick = graduation 后 WSS 无新达标 tick（断流）
 *   - !hasFlashCrash        看不到内盘砸盘（graduation 定义性特征）
 *   - drawdownFromHighestPct >= -6   末价≈峰值 = 断流于峰（最后一个达标 tick 接近最高价也合理）
 *
 * 注：到达 isPumpAndDump 的盘已由 classifyFromMetrics 前置的 high_mcap_wash/wash 截走 flash=true 者，
 *   故 mc>$25K 时 hasFlashCrash 必然 false；此处仍显式判 !hasFlashCrash 作语义自解释。与 crash 分支互斥。
 */
function isGraduationDump(metrics, config = {}) {
  const gradMinMc    = config.pumpDumpGraduationMinMarketCap   ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinMarketCap;
  const gradMaxTicks = config.pumpDumpGraduationMaxTicks       ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMaxTicks;
  const gradMinDd    = config.pumpDumpGraduationMinDrawdownPct ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinDrawdownPct;
  return metrics.maxMarketCap > gradMinMc
    && metrics.tickCount < gradMaxTicks
    && !metrics.hasFlashCrash
    && metrics.drawdownFromHighestPct >= gradMinDd;
}

/**
 * 拉高出货检测：两分支任一命中即 pump_dump
 *   (a) graduation 断流收割盘（isGraduationDump）：极速拉到接近毕业市值后出内盘，砸盘在 PancakeSwap 不可见
 *   (b) 内盘可见砸盘：最高价出现在前 N 秒内，且从高点回撤 ≥ M%（既有逻辑）
 */
function isPumpAndDump(metrics, config = {}) {
  // (a) graduation 断流收割盘
  if (isGraduationDump(metrics, config)) return true;

  // (b) 内盘可见砸盘型拉高出货
  const peakSeconds = config.pumpDumpPeakSeconds ?? DEFAULT_SCORING_PARAMS.pumpDumpPeakSeconds;
  const drawdownPct = config.pumpDumpDrawdownPct ?? DEFAULT_SCORING_PARAMS.pumpDumpDrawdownPct;
  const minMarketCap = config.pumpDumpMinMarketCap ?? DEFAULT_SCORING_PARAMS.pumpDumpMinMarketCap;

  // 最高价必须出现在前 N 秒
  if (metrics.peakTimeSeconds > peakSeconds) return false;

  // 从最高点回撤必须足够大
  if (Math.abs(metrics.drawdownFromHighestPct) < drawdownPct) return false;

  // 峰值市值必须达到阈值（"拉高"意味着确实有显著涨幅）
  if (metrics.maxMarketCap < minMarketCap) return false;

  return true;
}

// ── 代币分类 ──

/**
 * 从已计算的 metrics 做分类阈值判定（不依赖 ticks，纯阈值逻辑）。
 *
 * 代币分类的"单一真相"判定核心：离线 classifyToken 与实时 OnlineProfileBuilder 共用此函数，
 * 确保 wash/pump_dump/high_mcap/quality/low_quality/normal 的阈值判定唯一，不再两处手抄漂移。
 * 区别仅在 metrics 来源——离线由 computeTickMetrics(ticks) + findFlashCrashPeriod(ticks) 计算，
 * 实时由 FA state 标量 + _clsTicks 构造。
 *
 * @param {Object} metrics 必须含 { maxMarketCap, peakTimeSeconds, drawdownFromHighestPct, hasFlashCrash }；
 *   high_mcap_wash 判定另需 { maxBlockDropPct }（砸盘窗口单 block 最大跌幅%；hasFlashCrash=true 时生产路径必算好，缺省 0=无暴力 block）
 * @param {Object} [config] 分类配置（见 DEFAULT_SCORING_PARAMS）
 * @param {Object} [options] { diagnostic: boolean } diagnostic 时返回 reason 字段
 * @returns {{ category: string, reason?: string }}
 */
function classifyFromMetrics(metrics, config = {}, options = {}) {
  const { diagnostic = false } = options;
  const qualityThreshold = config.qualityMarketCapThreshold ?? DEFAULT_SCORING_PARAMS.qualityMarketCapThreshold;
  const highMcapThreshold = config.highMcapMarketCapThreshold ?? DEFAULT_SCORING_PARAMS.highMcapMarketCapThreshold;
  const washMinMcap = config.washMinMarketCap ?? DEFAULT_SCORING_PARAMS.washMinMarketCap;
  const highMcapWashThreshold = config.highMcapWashMarketCapThreshold ?? DEFAULT_SCORING_PARAMS.highMcapWashMarketCapThreshold;
  const highMcapWashRatioThreshold = config.highMcapWashMaxMinRatio ?? DEFAULT_SCORING_PARAMS.highMcapWashMaxMinRatio;
  const highMcapWashBlockDropThreshold = config.highMcapWashBlockDropThreshold ?? DEFAULT_SCORING_PARAMS.highMcapWashBlockDropThreshold;

  // ── 高市值流水盘（≥15K + 闪崩 + 扣前9秒峰值前涨幅≥2.2 + 无暴力砸盘block）：独立中性分类，不惩罚 ──
  // 必须在普通 wash 之前判定，否则高市值闪崩票会被 wash 抢走。
  // ★ratio 收紧：扣除前9秒后 peak/峰值前min <2.2 = 开盘即高位、涨幅小的假拉升诱多盘 → 不归此类 → 落 wash。
  //   ratio!=null && ratio>=2.2 才保留中性（有真实拉升）；null（peak在前9秒/样本<2，数据不足）也落 wash。
  // ★暴力 block 降级门：砸盘窗口内单 block 最大跌幅 ≤ highMcapWashBlockDropThreshold(-40%) = 砸盘够暴力，
  //   损害难避免 → 不归此类 → 落 wash。与 ratio 门同形式（ratio 管"有没有真实拉升"，block 跌幅管"砸得够不够暴力"，正交）。
  //   maxBlockDropPct 缺省 0（无暴力 block）→ 0 > -40 → 保留中性；hasFlashCrash=true 时生产路径必算好该字段。
  if (metrics.hasFlashCrash
      && metrics.maxMarketCap >= highMcapWashThreshold
      && metrics.beforePeakMaxMinRatio != null
      && metrics.beforePeakMaxMinRatio >= highMcapWashRatioThreshold
      && (metrics.maxBlockDropPct ?? 0) > highMcapWashBlockDropThreshold) {
    const reason = diagnostic
      ? `high_mcap_wash: flashCrash(peak rel急跌≤${FLASH_CRASH_DROP_THRESHOLD}% + 谷底后起不来[反弹<${FLASH_CRASH_REBOUND_K}]) + mcap=$${metrics.maxMarketCap.toFixed(0)} >= $${highMcapWashThreshold} + 扣前9秒ratio=${metrics.beforePeakMaxMinRatio.toFixed(2)} >= ${highMcapWashRatioThreshold} + maxBlockDrop=${(metrics.maxBlockDropPct ?? 0).toFixed(1)}% > ${highMcapWashBlockDropThreshold}%`
      : undefined;
    return { category: 'high_mcap_wash', reason };
  }

  // ── 流水盘检测（急跌 + 起不来），4K ≤ 峰值市值 < 15K 即判 wash ──
  // （≥15K 的高市值闪崩已在上面判 high_mcap_wash，不进 wash 惩罚池）
  if (metrics.hasFlashCrash && metrics.maxMarketCap >= washMinMcap) {
    const reason = diagnostic
      ? `flashCrash(peak rel急跌≤${FLASH_CRASH_DROP_THRESHOLD}% + 谷底后起不来[反弹<${FLASH_CRASH_REBOUND_K}], mcap=$${metrics.maxMarketCap.toFixed(0)})`
      : undefined;
    return { category: 'wash', reason };
  }

  // ── 拉高出货检测（graduation 断流 / 内盘砸盘 两分支）──
  if (isPumpAndDump(metrics, config)) {
    const reason = diagnostic
      ? (isGraduationDump(metrics, config)
        ? `pump_dump[graduation断流]: maxMC=$${metrics.maxMarketCap.toFixed(0)}>$${(config.pumpDumpGraduationMinMarketCap ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinMarketCap).toLocaleString()}, tickCount=${metrics.tickCount}<${config.pumpDumpGraduationMaxTicks ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMaxTicks}断流, dd=${metrics.drawdownFromHighestPct.toFixed(1)}≥${config.pumpDumpGraduationMinDrawdownPct ?? DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinDrawdownPct}末价≈峰, 砸盘在PancakeSwap不可见`
        : `pump_dump[内盘砸盘]: peak≤${config.pumpDumpPeakSeconds ?? DEFAULT_SCORING_PARAMS.pumpDumpPeakSeconds}s, drawdown≥${config.pumpDumpDrawdownPct ?? DEFAULT_SCORING_PARAMS.pumpDumpDrawdownPct}%, maxMC≥$${config.pumpDumpMinMarketCap ?? DEFAULT_SCORING_PARAMS.pumpDumpMinMarketCap}`)
      : undefined;
    return { category: 'pump_dump', reason };
  }

  // ── 高市值代币检测（≥ $15K） ──
  if (metrics.maxMarketCap >= highMcapThreshold) {
    const reason = diagnostic
      ? `high_mcap: maxMarketCap=$${metrics.maxMarketCap.toFixed(0)} >= $${highMcapThreshold}`
      : undefined;
    return { category: 'high_mcap', reason };
  }

  // ── 高质量代币检测（$8K ~ $15K） ──
  // 注意：$8K-$9K 且 peak 在前 15 秒的代币归为 normal（昙花一现，不算 quality）
  if (metrics.maxMarketCap >= qualityThreshold) {
    const peakSeconds = config.pumpDumpPeakSeconds ?? DEFAULT_SCORING_PARAMS.pumpDumpPeakSeconds;
    if (metrics.maxMarketCap < 9000 && metrics.peakTimeSeconds <= peakSeconds) {
      const reason = diagnostic
        ? `$8K-$9K early peak (${metrics.peakTimeSeconds.toFixed(1)}s) → normal`
        : undefined;
      return { category: 'normal', reason };
    }
    const reason = diagnostic
      ? `maxMarketCap=$${metrics.maxMarketCap.toFixed(0)} >= $${qualityThreshold}`
      : undefined;
    return { category: 'quality', reason };
  }

  // ── 低质量 vs 普通 ──
  if (metrics.maxMarketCap < 6000) {
    return { category: 'low_quality', reason: undefined };
  }

  const reason = diagnostic
    ? `noWash(flash=false) noPumpDump, maxMarketCap=$${metrics.maxMarketCap.toFixed(0)} < $${qualityThreshold}`
    : undefined;
  return { category: 'normal', reason };
}

/**
 * 对单个代币的 tick 数据进行分类（不依赖 FactorAggregator）。
 * 直接从 ticks 计算指标，内存友好，适合批量处理（挖掘脚本内嵌现算 / 离线 daily）。
 *
 * 阈值判定委托给 classifyFromMetrics（与实时 OnlineProfileBuilder 共用的单一真相）。
 *
 * @param {Array} ticks slim tick 序列（按 ts 升序）
 * @param {Object} [config] 分类配置（除 DEFAULT_SCORING_PARAMS 键外另含 totalSupply：TokenCreate 发行量）
 * @param {Object} [options] { diagnostic: boolean }
 * @returns {{ category, maxMarketCap, classInfo, flashCrashPeriod, violentCrashBlocks, firstTickTime, lastTickTime, maxChangePercent, finalChangePercent, reason? }}
 */
function classifyToken(ticks, config = {}, options = {}) {
  const { diagnostic = false } = options;
  const totalSupply = Number(config.totalSupply) || 0;

  if (ticks.length < MIN_TICKS) {
    // low_activity 也补算涨幅（数据可得性指标而非分类质量门——时序压缩/清理对尘票也需要涨幅信号）。
    // computeTickMetrics 对空数组有前置契约（ticks[peakIdx] 解引用），ticks.length 为 0 时不调。
    const metrics = ticks.length ? computeTickMetrics(ticks, totalSupply) : null;
    return {
      category: 'low_activity',
      maxMarketCap: 0,
      classInfo: null,
      flashCrashPeriod: null,
      violentCrashBlocks: [],
      firstTickTime: ticks.length ? ticks[0].ts : null,
      lastTickTime: ticks.length ? ticks[ticks.length - 1].ts : null,
      maxChangePercent: metrics?.maxChangePercent ?? null,
      finalChangePercent: metrics?.finalChangePercent ?? null,
      reason: diagnostic ? `low_activity: ticks=${ticks.length} < MIN_TICKS=${MIN_TICKS}` : undefined,
    };
  }

  // 直接从 ticks 计算指标（无需 FactorAggregator）
  const metrics = computeTickMetrics(ticks, totalSupply);

  // 计算 peak 时间戳，用于限制闪崩检测窗口（闪崩必须在 peak 之后）
  const peakTimeMs = ticks[metrics.peakIdx].ts;

  // 闪崩检测（peak 之后窗口内 peak rel 急跌 + 谷底后起不来），结果注入 metrics 供 classifyFromMetrics 使用。
  // 用 findFlashCrashPeriod 拿急跌段 {peakTime,floorTime,...}（不只 boolean），随 token_profiles 落库，
  // 供砸盘窗口定位（挖掘脚本 Tier2 bad_sell）。hasFlashCrash = 段非 null。
  const flashCrashPeriod = findFlashCrashPeriod(ticks, { peakTimeMs });
  metrics.flashCrashPeriod = flashCrashPeriod;
  metrics.hasFlashCrash = flashCrashPeriod !== null;
  // Tier2 暴力砸盘 block + high_mcap_wash 暴力 block 降级门：同 flashCrashPeriod 用这批 ticks 一次算 per-block drops
  // （零额外 IO），派生 violentCrashBlocks（落 token_profiles 供 Tier2 bad_sell）+ maxBlockDropPct（供降级门）。
  const blockDrops = _computeBlockDrops(ticks, flashCrashPeriod);
  metrics.violentCrashBlocks = _topViolentBlocks(blockDrops);
  metrics.maxBlockDropPct = blockDrops.length ? blockDrops[0].drop : 0;

  // 阈值判定委托给 classifyFromMetrics（与实时路径共用，避免两处手抄）
  const { category, reason } = classifyFromMetrics(metrics, config, options);

  // 构建 classInfo（母版同构，BNB 计价字段）
  const classInfo = {
    maxMarketCap: metrics.maxMarketCap,
    uniqueTraders: metrics.uniqueTraders,
    totalBuyBnb: metrics.totalBuyBnb,
    totalSellBnb: metrics.totalSellBnb,
    priceChangePct: metrics.priceChangePct,
    drawdownFromHighestPct: metrics.drawdownFromHighestPct,
    highestPriceBnb: metrics.highestPriceBnb,
    highestPriceUsd: metrics.highestPriceUsd,
    buyCount: metrics.buyCount,
    sellCount: metrics.sellCount,
    tickCount: metrics.tickCount,
    peakTimeSeconds: metrics.peakTimeSeconds,
    hasFlashCrash: metrics.hasFlashCrash,
  };

  return { category, maxMarketCap: metrics.maxMarketCap, classInfo, reason,
    flashCrashPeriod: metrics.flashCrashPeriod || null,   // {peakTime,peakPrice,floorTime,floorPrice} | null
    violentCrashBlocks: metrics.violentCrashBlocks || [], // Tier2 暴力砸盘 block_number[]（number[]；仅 flashCrashPeriod 非空 token 有）
    firstTickTime: metrics.firstTickTime,                 // token 首 tick 时间（ms）
    lastTickTime: metrics.lastTickTime,                   // token 末 tick 时间（ms），与 firstTickTime 成对=分类数据时间范围
    maxChangePercent: metrics.maxChangePercent,           // (可用价峰-基准)/基准*100；null = 无可用价 tick
    finalChangePercent: metrics.finalChangePercent };     // (可用价末-基准)/基准*100；null = 无可用价 tick
}

// ── firstIdle 可见时刻（category_visible_at 的计算口径，单一真相源）──
// 分类信息对决策时刻(asOf)的可见性以【实时 OPB 首次触发分类的时间点】为准，而非离线 classified_at
// （daily 事后重写普遍晚于实验 asOf → 实盘早已在线分类可见的 token 被回测防前视误拦）。
// 本函数供离线批量构建在分类时落库 category_visible_at；在线 OPB 路径直接用写入时刻（更晚、诚实）。
// 逐 token 全量交易流判定（勿按 holder 子集），复刻 OPB 双触发：
//   触发1 idle:    首个 ≥idleSeconds(60s) 的全 tick 空窗 → vis = 空窗前最后 tick + 60s
//                  （空窗前 tick 数须 ≥ minTicks：OPB 触发时刻判 tradeCount，空窗出现在第 minTicks 个
//                   tick 之前实盘不分类，须等后续 tick 攒够后的下一个空窗）
//   触发2 bigIdle: 大额(≥bigTickBnb) tick 断流 ≥bigIdleSeconds(600s) → vis = 该大额 tick + 600s。
//                  ★证据触发：须存在 ≥600s 边界之后到达的 tick（OPB 正是在该 tick 到达时判 lastBigTick
//                  超时才分类——"最后一口气很久才断"的死 token 靠小额涓流见证）。不许从数据末端外推
//                  （scope 边界处 token 可能仍活着，外推=对持久化字段引入前视）。
// 可见时刻 = 两触发较早者。无空窗（token 活着）/ tick<minTicks → null（回退 classified_at，保守）。
function computeFirstIdleVisibleAt(ticks, cfg = {}) {
  const minTicks = cfg.minTicks || MIN_TICKS;
  const idleMs = (cfg.idleSeconds || OPB_DEFAULTS.idleSeconds) * 1000;
  const bigIdleMs = (cfg.bigIdleSeconds || OPB_DEFAULTS.bigIdleSeconds) * 1000;
  const BIG_BNB = cfg.bigTickBnb ?? OPB_DEFAULTS.bigTickBnb;

  const pts = [];
  for (const t of ticks || []) {
    if (t.ts == null) continue;
    pts.push([t.ts, (Number(t.bnbAmount) || 0) >= BIG_BNB]);
  }
  if (pts.length < minTicks) return null;
  pts.sort((a, b) => a[0] - b[0]);

  let vis1 = null;
  for (let i = 1; i < pts.length; i++) {
    if (i >= minTicks && pts[i][0] - pts[i - 1][0] >= idleMs) { vis1 = pts[i - 1][0] + idleMs; break; }
  }
  let vis2 = null;
  // 见证人指针 j：首个 time ≥ 候选大额 tick + bigIdleMs 的 tick（任意大小；含下一个大额自身）
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i][1]) continue; // 只看大额 tick
    const fireAt = pts[i][0] + bigIdleMs;
    // ★OPB 判 lastBigTick=最近大额：若 600s 边界内有下一个大额到达 → 该大额的断流被打破，不触发
    let k = i + 1;
    while (k < pts.length && !pts[k][1]) k++;
    if (k < pts.length && pts[k][0] < fireAt) continue;
    while (j < pts.length && pts[j][0] < fireAt) j++;
    // 无见证 tick（数据末端）→ 后续大额更晚更无见证，停
    if (j >= pts.length) break;
    // minTicks 门：见证 tick 到达时刻的 tradeCount = j+1 须 ≥ minTicks
    if (j + 1 >= minTicks) { vis2 = fireAt; break; }
  }
  if (vis1 == null) return vis2;
  if (vis2 == null) return vis1;
  return Math.min(vis1, vis2);
}

module.exports = {
  CLASSIFIER_VERSION,
  isWashTradingToken: () => false, // 母版保留接口兼容（真 wash 检测由 findFlashCrashPeriod 完成）
  hasFlashCrash,
  findFlashCrashPeriod,
  computeViolentCrashBlocks,
  computeMaxBlockDropPct,
  isPumpAndDump,
  isGraduationDump,
  classifyFromMetrics,
  classifyToken,
  computeTickMetrics,
  computeFirstIdleVisibleAt,
};
