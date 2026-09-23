/**
 * token 分类器常量（pumpfun scripts/shared/constants.js 分类子集的 BSC 改造版）
 *
 * 迁移口径（回迁批 3.1）：
 * - 墙钟语义的阈值（闪崩急跌 -50%/反弹 1.3/闪崩窗 8s/暴力砸盘 POST 10s）逐字沿用——
 *   "8 秒内跌 50%"本身是"急"的定义，与出块节奏无关；
 * - 出块节奏相关的窗（pumpDumpPeakSeconds 5s→15s、扣前3秒 3s→9s、暴力窗前扩 2s→3s）
 *   按 BSC ~3s/块放宽（Solana 400ms slot 的 5s≈12 slot → BSC 15s≈5 block）；
 * - 市值门槛（4K/8K/9K/15K/25K USD）先沿用 USD 名义，待批 3.2 用 experiment_tokens +
 *   wss_price_ticks 现算峰值市值分位数重校（计划既定）；
 * - SOL 计价 → BNB 计价（尘门 0.005 SOL≈$0.75 → 0.002 BNB，与 FA minPriceUpdateBnb 同值）。
 * 全部标"待回测校准"。
 */

const MIN_TICKS = 10;                    // 最低 tick 数（不足 = low_activity，数据不足以分类）
const MIN_PRICE_UPDATE_BNB = 0.002;      // 尘门：低于此金额的 tick 单价精度极差，不用于价格追踪
                                        // （pumpfun 0.005 SOL；与 FA FACTOR_PARAM_DEFAULTS.minPriceUpdateBnb 同值）
const FLOOR_MC = 2000;                   // 地板市值 USD（dd 的 floor-relative 归一化分母基准）

// ── 闪崩检测（wash 流水盘核心判据）──
const FLASH_CRASH_WINDOW_MS = 8000;      // 急跌段墙钟窗（谷底 j 前 ≤8s 内的 step 最高价）
const FLASH_CRASH_DROP_THRESHOLD = -50;  // 急跌阈值（peak rel ≤ -50%；统一阈值不分市值档）
const FLASH_CRASH_REBOUND_K = 1.3;       // 起不来约束（谷底后最高价 ≤ 1.3×谷底价 = 死亡）

// ── 暴力砸盘 block（Tier2 定位 / high_mcap_wash 降级门）──
const VIOLENT_BLOCK_PRE_MS = 3000;       // crash 窗口前扩（pumpfun 2s；BSC 1 block）
const VIOLENT_BLOCK_POST_MS = 10000;     // crash 窗口后扩（墙钟语义沿用）
const VIOLENT_BLOCK_TOP_K = 2;           // 取 top-K 降幅 block（砸盘高度集中在 1-2 个 block）
const VIOLENT_BLOCK_DROP_THRESHOLD = -30; // 单 block 跌幅门槛（≤-30% 算暴力；过滤逐步下跌的失败盘）

// ── 分类阈值（DEFAULT_SCORING_PARAMS 的分类子集；USD 名义先沿用）──
const DEFAULT_SCORING_PARAMS = {
  qualityMarketCapThreshold: 8_000,        // quality 下界（≥8K 且 <15K）
  highMcapMarketCapThreshold: 15_000,      // high_mcap 下界
  pumpDumpPeakSeconds: 15,                 // 拉高出货：最高价须出现在前 N 秒（pumpfun 5s；BSC ~5 block）
  pumpDumpDrawdownPct: 60,                 // 拉高出货：从高点回撤 ≥60%
  pumpDumpMinMarketCap: 9_000,             // 拉高出货：最高市值 ≥9K（"拉高"= 确有显著涨幅）
  pumpDumpGraduationMinMarketCap: 25_000,  // graduation 断流收割盘：极速拉到的市值下界
  pumpDumpGraduationMaxTicks: 50,          // 断流 tick 上界（<50 = 毕业后内盘无新 tick）
  pumpDumpGraduationMinDrawdownPct: -6,    // 末价≈峰值下界（断流于峰）
  washMinMarketCap: 4_000,                 // wash 下界（4K ≤ 市值 < 15K 的闪崩）
  highMcapWashMarketCapThreshold: 15_000,  // high_mcap_wash 下界（与 high_mcap 同档）
  highMcapWashMaxMinRatio: 2.2,            // high_mcap_wash：扣前9秒后 peak/峰值前 min ≥2.2（有真实拉升）
  highMcapWashBlockDropThreshold: -40,     // high_mcap_wash：单 block 最大跌幅 ≤-40% = 砸够暴力 → 降级 wash
};

// ── firstIdle 可见时刻（category_visible_at 口径，computeFirstIdleVisibleAt）──
const OPB_DEFAULTS = {
  minTicks: MIN_TICKS,
  idleSeconds: 60,          // 触发1：全 tick 空窗 ≥60s
  bigIdleSeconds: 600,      // 触发2：大额 tick 断流 ≥600s
  bigTickBnb: 0.05,         // 大额 tick 门槛（pumpfun 0.1 SOL≈$15；0.05 BNB 同量级，待校准）
  minAgeSeconds: 10,
};

module.exports = {
  MIN_TICKS,
  MIN_PRICE_UPDATE_BNB,
  FLOOR_MC,
  FLASH_CRASH_WINDOW_MS,
  FLASH_CRASH_DROP_THRESHOLD,
  FLASH_CRASH_REBOUND_K,
  VIOLENT_BLOCK_PRE_MS,
  VIOLENT_BLOCK_POST_MS,
  VIOLENT_BLOCK_TOP_K,
  VIOLENT_BLOCK_DROP_THRESHOLD,
  DEFAULT_SCORING_PARAMS,
  OPB_DEFAULTS,
};
