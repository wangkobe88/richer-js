/**
 * FourMeme FactorAggregator（事件驱动增量因子器）
 *
 * 输入：FourMemeAnkrWsCollector 解码的 tick 流（或 BacktestEngine 从 wss_price_ticks 回放的 tick 流），
 * 每 tick O(1) 增量维护 per-token 状态，实时构建策略因子。
 *
 * ★ 因子键契约：与现役 VirtualTradingEngine._buildFactors 的键名/单位逐字对齐
 *   （age=分钟、holdDuration=秒、earlyReturn/profitPercent=百分比），
 *   StrategyEngine/ConditionEvaluator/既有策略配置零改动。
 *   原 AVE 轮询因子在 WSS 事件流下的口径替代：
 *   - holders       → 内盘净持仓 wallet 计数（sender||trader，GMGN 案 B 2026-10-01；曲线内每笔持仓变化都发事件，毕业前精确）
 *   - txVolumeU24h  → 累计成交额（totalBuyBnb+totalSellBnb）× BNB/USD（观察窗内代币全生命周期）
 *   - tvl           → 最近一笔事件的 curve funds × BNB/USD
 *   - fdv/marketCap → currentPrice × totalSupply（TokenCreate 事件）
 *   - trend 族 → 10s 时间桶价格序列（8 点窗，TrendDetector 消费）
 *   - holderTrend 族 → blockNumber 桶持有者序列（8 块窗 ≈4s，HolderTrendDetector 消费；
 *     2026-10-14 改造：适配新盘秒级节奏，旧 10s 桶 80s 窗对新 meme 币出值太慢）
 *
 * 价格以 BNB 为原生单位追踪（决策因子均为比值，免汇率漂移）；USD 值在 buildFactorMap
 * 时用最近 tick 的隐含 BNB/USD（price_usd/price_bnb）换算。
 *
 * ═══════════════ pumpfun 回迁批 1（2026-09，68 新键）═══════════════
 *
 * 母版：pumpfun-wss-trader FactorAggregator（2799 行）。口径纪律=结构/语义逐字对齐母版，
 * 窗宽/阈值按 BSC 节奏定初值（slot≈400ms → block≈3s，~7.5×；FACTOR_PARAM_DEFAULTS
 * 逐项注明母版值，全部待 wss_price_ticks 回测校准；config fourmemeWs.factorParams 可覆盖）。
 *
 * 命名规则（键名承载口径）：
 *   - 单位替换必改名：Sol→Bnb、slot→block
 *   - 窗宽类跟窗改名：firstSecBuyShare→firstBlockBuyShare
 *   - 纯结构类逐字保留：counterpartyOverlap*、top3/top5HolderShare、bigHolder*、rsi*
 *
 * ★ priceReliable（新链专用可靠价门，母版 sol>=minTickSol 的 BSC 适配）：
 *   priceBnb > 0 && !priceOutlier && bnbAmount >= minPriceUpdateBnb。
 *   既有价格行为（任意非离群接受价更新 currentPriceBnb/firstPrice/highestPriceBnb/series/
 *   per-pos SinceBuy 峰值）零改动——新链全部挂在可靠价链 _relPriceBnb/_relHighestPriceBnb
 *   （与既有 highestPriceBnb 双轨并行：旧键 drawdownFromHighest 等保持任意接受价口径）。
 *   crashSpeed 因此用 _relPriceBnb（母版 currentPriceUsd 本身就是可靠价链产物，
 *   此为对齐而非偏离）。
 *
 * 与母版的已裁定偏离（其余逐字对齐）：
 *   1. shares 族分母 = totalSupply（TokenCreate），缺失(=0) → null fail-closed；
 *      母版用常数 1e9 分母（BSC 有真实 totalSupply，不用近似常数）
 *   2. _recentTicks 保留 richer-js 5min 摊销窗（母版 60s 硬窗）；新链扫描一律按各自
 *      cutoff 过滤，窗内语义等价
 *   3. USD 输出经 state.lastImpliedBnbUsd，其余新链全程 BNB 原生
 *
 * 不迁（母版特定装置）：zz25、w0ShareB/_w0bWin、k0 latch、maxEarlyBuySol、afterFirst3s、
 * _cumulativeBuy/SellTokens、preFilter、ML/GMGN、smartBot/sniper（批 3.3）。
 * TPA 注入装置 + _walletMaxNetTokens（retention 峰值基准）已随回迁批 4 落地：
 * TokenPositionAnalyzer 触发点 as-of 画像 → setHoldingFactors/setRetentionBasis 回填
 * → buildFactorMap 直读注入（TPAPre_* 17 键 + TPAAnalyzed/retention/asofRelFirst，
 * 键集见 tpa-factor-keys.js；触发前 null → ConditionEvaluator 恒 false fail-closed）。
 *
 * ═══════════════ 买腿重构 C84（2026-10-17）═══════════════
 *
 * 新链路：腿带 narrativeTriggerCondition（叙事分析发起条件，因子表达式）→ 引擎按
 * tick 因子评估发起/重试后台叙事分析 → 回填 setNarrativeFactors → buildFactorMap 注入
 * narrativeRating/narrativeRounds/narrativeRetryDue → 单一买条件（含
 * `narrativeRating == 2 OR == 3`）→ GMGN 第二层。earlyTrades* 族同批迁入：
 * EarlyParticipantCheckService 的 DB trailing 90s 窗查询改为 FA 出生锚定（firstTickAt）
 * 累计窗，fire/预检查两阶段因子漂移由此消除。legacy 腿（无 narrativeTriggerCondition）
 * 整链原样保留——earlyTrades* 双宿主并存（legacy 腿 preBuy 语境仍走 DB 版）。
 * 与 legacy DB 版的口径 delta（有意，台账 C84）：
 *   delta① 照计语义：无 price_outlier=false / price_usd 非空过滤（与 tradeCount/
 *     _recentTicks/activityEvents 同口径）——毒价行/零 USD 行照样入窗；
 *   delta② 出生锚=firstTickAt（首 tick 到达序 write-once）而非 launchAt（TokenCreate
 *     块时间）；两锚正常相差 <1s，late-discovered 票本就被 tokenAgeSec<90 门拦；
 *   delta③ 出窗冻结=完整首窗终值（观测友好），legacy uncovered=0 值放行——新链路
 *     条件自带 tokenAgeSec<90，出窗票不产生信号，两语义无行为交集。
 * 叙事注入与 earlyTrades* 键均为 buildFactorMap 无条件字面量（getFactorKeys 探针
 * 自动收录；未回填 rating=null → 条件恒 false fail-closed）。
 */

const EventEmitter = require('events');
const TrendDetector = require('../trading-engine/TrendDetector');
const HolderTrendDetector = require('../trading-engine/HolderTrendDetector');
const { HOLDING_FACTOR_KEYS, FA_TPA_KEYS } = require('./tpa-factor-keys');
// 公共聚合路由地址集（GMGN 等）——_walletRoutedBuyBnb（GMGN 用户判定）的写入判据，
// 与 EarlyParticipantCheckService routerPct 因子同层同源（trader=msg.sender 层）
const { AGGREGATOR_ROUTER_ADDRS } = require('../trading-engine/pre-check/aggregator-routers');
// 协议地址集（four.meme 内盘官方）——earlyTrades* top1 因子的双地址层剔除判据，
// 与 EarlyParticipantCheckService 同源（sniper-detector 单一真相源）
const { PROTOCOL_ADDRS } = require('../trading-engine/pre-check/sniper-detector');

// 趋势序列时间桶宽度（价格臂）：8 点 × 10s ≈ 旧轮询时代（10s 采样 × 8 点）窗口语义
const SERIES_BUCKET_SEC = 10;
const SERIES_MAX_POINTS = 8;
// 持有者趋势序列窗口（holderTrend 族，2026-10-14 用户裁定）：blockNumber 桶 × 8 块
// ≈ 4s 窗（BSC 出块 0.5s 中位；48h 全量 6000 盘数据定长：区分度 23.1pp 最高点、翻转率
// 较 4 块窗减半）。★与 HolderTrendDetector._confirmDirection/_calculateTrendStrength 内部
// maxPoints=8 保持一致——改一处必须同改另一处。
const HOLDER_SERIES_MAX_POINTS = 8;

// 滑窗速率窗口（分钟）
const RATE_WINDOW_MS = 5 * 60 * 1000;

// 局部离群价剔除：偏离最近 5 笔已接受价中位 >1000× 判为毒价
//（真实轨迹逐笔 <2×；打包 tx 尘量 token_amount 会产生 e7 倍假价——Phase 0 母版同款阈值）
const OUTLIER_RATIO = 1000;

/**
 * 回迁批 1 因子参数默认值（BSC 初值；逐项注明母版值，待回测校准）。
 * config fourmemeWs.factorParams 子对象可覆盖（实验级经 _mergedWsConfig 浅合并后，
 * 此处 Object.assign 再垫默认值——部分覆盖有效）。
 */
const FACTOR_PARAM_DEFAULTS = {
    minPriceUpdateBnb: 0.002,    // 可靠价尘门（母版 minTickSol 0.005 SOL；BSC tradeAmount 0.1 的 1/50）
    firstBlockWindowMs: 3000,    // 首块脉冲窗（母版首秒 1000ms；BSC 1 block≈3s）
    trendWindowMs: 30000,        // 趋势窗（母版 5000ms）
    trendMinReliableTicks: 5,    // 主窗最少 reliable tick（母版同）
    trendAbsMinTicks: 3,         // widened fallback 最少总数（母版同）
    crashSpeedWindowMs: 10000,   // 砸速窗（母版 2500ms）
    crashSpeedMinDtMs: 3000,     // 砸速分母下限（母版 500ms≈1 slot；BSC≈1 block）
    bigHolderMinCumBuyBnb: 1.0,  // 大户门槛=累计买入（母版 2.9 SOL；BSC tradeAmount 0.1 的 10×）
    secRsiMaxBars: 60,           // 秒收盘环形窗（母版同）
    // ── 市场截面 cohort 三参数（回迁批 2.6；母版 config 顶层级，此处并入 factorParams 统一覆盖）──
    marketCohortWinMs: 40 * 60 * 1000,  // cohort 出生窗上沿：birth∈[t−40m, t−10m] 计分母
    marketMatureMs: 10 * 60 * 1000,     // cohort 成熟下沿：出生后 ≥10m 才计分母（<10m 未成熟）
    marketMinCohort: 30,                // 分母 < 此数 → 三个 cohort 率全 null fail-closed
    // ── 分类器轨迹参数（回迁批 3.1；与 classifier-constants OPB_DEFAULTS 对齐，供 FA state 维护用）──
    clsFirstWindowMs: 9000,       // afterFirst9s 基准窗（母版扣前3s=7.5 slot；BSC 3 block）
    clsBigTickBnb: 0.05,          // 大额 tick 门槛（母版 SIGNIFICANT_SOL 0.1≈$15；0.05 BNB 同量级待校准）
    clsTicksWindowMs: 60 * 1000,  // 分类器轨迹最小窗（母版 recentTicksWindowMs 同值）
    clsTicksMaxPerToken: 1500,    // 分类器轨迹上限（母版 maxRecentTicksPerToken 同值）
    // ── 名单因子（回迁批 3.3；smartBotMinBuyBnb=母版 smartBotMinBuySol 0.05 SOL 的 BSC 重校，
    //    对齐挖掘参与门 0.02 BNB；sniper 阈值是口径常量 SNIPER_TOKEN_COUNT_THR 不在此）──
    smartBotMinBuyBnb: 0.02,
    // ── E5 卖侧参数（2026-09-24）──
    graduationAnchorBnb: 72,     // 毕业市值锚（BNB 口径）：four.meme 毕业市值 $50,585；0x47da 实测断流前
                                 // max 7.21e-8×1e9=72.1 BNB 吻合。progress=priceBnb*totalSupply/此值
    graduationAnchorRatio: 12.5, // flap per-token 毕业锚（2026-09-28 王之蔑视案）：毕业市值/首市值 R 恒比
                                 //   （182 实测 4/5 样本 12.10~12.63 ±2%；断流市值/funds≈4.50、初始/funds≈0.36
                                 //   两条恒比合成）。flap 池 funds 10.9~17.3 跨 1.6 倍 → 固定 72 锚对非标准盘
                                 //   失真（9/77 盘断流 progress<90% 毕业臂够不着）
    graduationAnchorFirstTickMaxMs: 60 * 1000, // 首市值锚有效性门：首 tick 距 token 创建超此窗 = 首 tick≠开盘
                                 //   （watcher 起采晚/开盘抢拉，脏样本 0x84439e 首价 5.8 倍于开盘 R=2.17）
                                 //   → 退 72 默认锚（口径有效性判定，非行为兜底）
    bar5mRsiMaxBars: 30,         // 5m bar 收盘环形窗（30 根=2.5h；rsi9Bar5mRt 原料）
    riseMinTicks: 8,             // 针臂稀疏窗门（5min 窗内可靠 tick 数 < 此数 → null fail-closed；
                                 //   rich-js minTicks=窗口分钟数，tick 秒级更密故起步 8）
    riseMinElapsedMin: 0.1,      // 针臂速度分母下限（分钟；rich-js 钳 1min 是 1m bar 粒度，tick 秒级可小；
                                 //   谷=最新 tick 时防除零）
    // ── 交易活跃度滑窗（2026-10-15，取代同日删除的 cycle 分桶路由）──
    activityWinMs: 10000,        // act* 8 键窗口（用户裁定：新发布 Meme，10s 已不小）；
                                 //   原料 _activityEvents 事件环，读点 _activityFactors 单趟派生
    // ── 同 block 首买簇捆绑检测（2026-10-16 BITCAT 案）──
    bundleWinMs: 10000,          // bundle* 6 键窗口（对齐 act*；扫描 Phase 2 对比 10s/30s/60s
                                 //   后再定默认值）；原料 _bundleEvents/_blockBuyAgg/_circTokens
    // ── earlyTrades* 首窗累计（2026-10-17 买腿重构 C84：迁自 EarlyParticipantCheckService
    //    DB trailing 90s 窗 → FA 出生锚定累计窗，单一买条件消除两阶段因子漂移）──
    earlyTradesWindowMs: 90000,  // 首窗宽（对齐 legacy fixedWindowSeconds=90）
    earlyUniformDustBnb: 0.01,   // uniform 簇尘埃门（对齐 legacy uniformDustThresholdBnb）
    // ── launch* 出生锚定捆绑簇（2026-10-17 Agentum 案方向 C：10s 滑窗在 fire+61s 时
    //    创建块捆绑簇已滑出（Konasu 时序洗白同根因），出生锚定窗让出生期指纹在任意
    //    迟到 fire 时刻可见；对齐 earlyTradesWindowMs）──
    launchBundleWinMs: 90000,    // 出生窗宽（首买簇累计+冻结）
};

// earlyTrades* 防御帽：窗内参与钱包数上限（对倒作业票 90s 内 <1 千钱包；超帽只停
// 新钱包入册，已入册钱包照常更新——尾部批发钱包丢粒度，保内存上限）
const _EARLY_MAX_WALLETS = 5000;

// ── 市场截面 regime 观测（market* 5 键，回迁批 2.6；pumpfun 08-30 观察版口径）──
// 既有因子全部 per-token，市场整体状态=真实盲区；本组把市场状态做成截面因子（同快照同值
// 注入所有 token）。★红线：观察版——任何交易策略 condition 不得引用 market* 键
// （audit-strategy-factor-keys.js 对引用报错；null 过 ConditionEvaluator 恒 false 是二道保险）。
// 模块级单例（跨 FA 实例共享，pruneStaleTokens 不清）。
// ⚠写路径显式 opt-in：仅两引擎（Wss/Backtest）构 FA 后调 setMarketFeedEnabled(true)——web 侧
//   裸 FA 实例不 feed → 读恒 null，零污染零误计；引擎 stop 关 feed 清单例（防同进程下一实验继承）。
// 出生锚 = state.createdAtMs（live=TokenCreate 块时间 / 回测=experiment_tokens discovered_at，
// 与 age 同基准；母版 firstTickAt 本身是墓碑/DB discovered_at 证据链≈创建时间，语义对齐）。
// 距出生已 >40m 的老票不入册（防引擎中途启动把存量票当 newborn 灌满截面；richer-js FA 无 DB
// 证据链，未见 TokenCreate 的存量票无法识别——视作新生，≈40m 内自愈出 cohort 窗，此残留存案）。
// registry 只进 newborn：断流死票【保留在册】（death 率口径含死亡票=无幸存者偏差），仅按 birth
// 龄写时裁剪（TTL=65m ≥ newborn 1h 窗 60m + 余量；FIFO 写时裁剪 O(1) 摊销）。
let _marketFeedEnabled = false;
let _marketRegime = null;
// ── 名单因子（回迁批 3.3；母版 smartBotCount/sniperHolderShare 口径）──
// 两份名单=模块级单例（跨 FA 实例共享，prune 不清，引擎 stop 不清——同进程下一实验直接复用；
// 名单是挖掘管线的静态产物，运行中不重载，182 更新名单后重启生效，与母版同款）。
// null 语义方向相反（设计意图，勿"统一"）：
//   _smartBotWallets=null → smartBotCount 恒 0（fail-open 观察：无名单≠无 bot，不拦交易）；
//   _sniperWallets=null  → sniperHolderShare 恒 null（fail-closed：null 过 ConditionEvaluator 恒
//     false=引用键的门不放行——进买腿门的键证据不足必须关，与 smartBot 方向相反）。
let _smartBotWallets = null;
let _smartBotLoadPromise = null;   // 在途去重（并发调用复用同一 promise）
let _sniperWallets = null;
let _sniperLoadPromise = null;
// ── 跟单簇名单（2026-10-16 FLY 案用户正式方案）──
// 来源=config/rosters/copy-wallet-roster.json（scripts/scan-copy-trade-clusters.cjs 离线
// 扫描产物，182 重跑 --commit → git push → 重启进程生效——静态快照语义与 sniper 名单同款）。
// 读文件非 DB：名单与代码同仓库同部署（182 pull 即得，杜绝手动同步），零 RLS 坑。
// null 语义 fail-closed（对齐 _sniperWallets 方向）：maxCopyWalletHolderCircPct 恒 null →
// ConditionEvaluator 恒 false = 引用键的门不放行（名单缺失=证据不足必须拦，宁可错过）。
// 空 Set=有证据零值 0（名单在但无命中钱包=放行）。
let _copyWallets = null;
let _copyLoadPromise = null;
// ── 极著名钱包子集（2026-10-18 币安人生案用户点名）──
// 来源=config/rosters/famous-copy-wallets.json（用户裁定集合，独立文件——scan
// --commit 重写主名单不影响它）。famousCopyWalletCircPct 因子原料：被跟单特别
// 重的钱包（跟单大军放大实际控盘度），单独更紧的门（<15）。null 语义 fail-open
// （刻意与主名单 fail-closed 相反）：文件缺失/空集合 → 因子恒 null → 条件串
// IS NULL 臂放行——famous 是收紧门不是防线，未启用=零影响（存量 bit 一致）；
// 非空集合 → 0 起（有证据零值，与主名单同款）。
let _famousCopyWallets = null;
let _famousCopyLoadPromise = null;
// ── sybil 大簇钱包并集（2026-10-20 乌龟案用户裁定；簇合计口径）──
// 来源=config/rosters/sybil-clusters.json（scripts/build-sybil-clusters.cjs 从
// copy-trade-pairs 缓存建「强边连通分量 size>=3」，182 --commit 生成；独立文件，
// 重扫主名单/重跑 scan 不影响它）。sybilClusterHolderCircPct 因子原料 = **簇内钱包
// 合计**净持仓 ÷ 流通 ×100——补主名单「单钱包最大」口径盲区：多钱包 sybil 簇把仓位
// 分到四五个地址后单钱包过不了 20/15 门，但合计可达 40-70%（乌龟案四钱包 fire 时
// 38.9%，c3 口径 72.9%）。
// null 语义 fail-open（与 famous 同向、与主名单 fail-closed 相反）：文件缺失/空集合
// → 因子恒 null → 条件串 IS NULL 臂放行（新门未启用=存量零影响）；非空 → 0 起
// （有证据零值，簇钱包在场但那票没持仓=0）。
let _sybilClusterWallets = null;
let _sybilClusterLoadPromise = null;
// ── TPA 持仓因子回填缓存（回迁批 4；母版 :56-70 同款装置）──
// _holdingFactorOverrides（tokenAddress → { TPAPre_walletHoldingPct, 庄散派生键, ... 17 键 }）：
//   TokenPositionAnalyzer 触发点 as-of 画像算出持仓因子后 setHoldingFactors 回填，
//   buildFactorMap 直读注入（触发前 null → 不注入，TPAPre_* 因子缺省 fail-closed）。
// _retentionBasis（tokenAddress → { zhuangAddresses:[], netZAtDecision:number }）：TPA 在触发点
//   冻结「哪些钱包是大户」+ Σ 大户建仓峰值净持仓；buildFactorMap 每 tick 用 running
//   _walletNetTokens 对冻结大户集求和得 netZ@T → TPAPre_retention=netZ@T/netZ@D（live 因子）。
//   ★netZ@D=Σ 大户 maxNetTokens（建仓峰值，含触发前已清仓的）——旧口径用触发时刻净持仓，
//   清仓大户 floatPct≈0 被漏（retention 恒 1.0 盲区）。
// 模块级是有意设计（对齐 _marketRegime/_smartBotWallets 先例：pruneStaleTokens 不清，跨 FA 实例
//   共享）；由 TPA 侧 write-once 生命周期管理（token 级单次触发后不变）。
let _holdingFactorOverrides = null;
let _retentionBasis = null;
// ── 叙事触发模型因子缓存（2026-10-17 买腿重构 C84）──
// 新链路腿（带 narrativeTriggerCondition）：引擎按触发条件（因子表达式，如
// `buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1`）发起/重试叙事分析，
// NarrativeDirectCaller.getRating 返回后经 setNarrativeFactors 回填，buildFactorMap
// 无条件注入 narrativeRating/narrativeRounds/narrativeRetryDue——单一买条件里的
// `narrativeRating == 2 OR == 3` 对 null（未完成）/1（low）/9（失败超时归一）
// 恒 false =「分析未完成或不通过不参与信号生成」由条件表达式天然保证。
// TPA _holdingFactorOverrides 同款模块级单例先例（web 裸 FA 不回填 → rating 恒
// null fail-closed；引擎 stop 逐 token 清）。★retryDue 的 now 由 buildFactorMap
// 入参传入（FA 周期判定禁 Date.now 红线）。
let _narrativeFactorOverrides = null;
const _NARRATIVE_FACTOR_DEFAULTS = { intervalMs: 10000, maxAnalyses: 3 };
let _narrativeFactorConfig = { ..._NARRATIVE_FACTOR_DEFAULTS };
// sniper 判据：wallets.token_count ≥ 此值（母版 wallet-scorer ZR_SNIPER_TOKENCOUNT_THR=300 的
// BSC 重校——four.meme 历史短参与基数小，计划批 3.3 裁定 50 待校准。定义非调参，改=改口径）。
// token_count 写入方=mine-smart-wallets.cjs --apply（入榜钱包 rawTotalRun）。⚠口径边界：当前
// 名单 ⊆ 挖掘入榜钱包（非全史画像），全量 rawTotal 画像源待后续离线管线；fail-closed 方向下
// 名单偏小=门更保守，安全侧。
const SNIPER_TOKEN_COUNT_THR = 50;
// 窗口常量（定义非调参——改=改口径，须同步 _test_market_regime.cjs；cohort 三参数在
// FACTOR_PARAM_DEFAULTS，可经 factorParams 覆盖）：
const MARKET_NEWBORN_WIN_MS = 60 * 60 * 1000;      // marketNewbornCount1h：trailing 60m 出生数
const MARKET_REGISTRY_TTL_MS = 65 * 60 * 1000;     // registry 出生龄上限（≥ newborn 窗 + 余量）
const MARKET_ROCKET_REL_PCT = 100;                 // marketRocketRate30m：峰值相对首可靠价 ≥ +100% 记火箭
const MARKET_DEATH_IDLE_MS = 540 * 1000;           // marketDeathRate30m：now−lastTs ≥ 540s 记断流死（母版 180s；BSC 出块 3s 节奏 ×3）
const MARKET_FLOW_RING_LEN = 11;                   // marketFlowBsRatio10m：分钟环长（10m 窗 + 当前分钟）
const MARKET_FLOW_MIN_SELL_BNB = 1;                // 流向比 Σsell < 1 BNB → null fail-closed（母版 5 SOL，同名义档）
const MARKET_NEWBORN_MAX_AGE_MS = 40 * 60 * 1000;  // 出生注册门：首 tick 距 birth > 此值不入册（老票）

class FourMemeFactorAggregator extends EventEmitter {
    /**
     * @param {Object} config - 全局配置（读取 config.fourmemeWs 段）
     * @param {Object} logger
     */
    constructor(config = {}, logger = null) {
        super();
        this._config = (config.fourmemeWs || {});
        this._logger = logger;
        this._maxTrackedTokens = this._config.maxTrackedTokens || 300;

        // 回迁批 1 因子参数（默认值 ← config.factorParams 覆盖）
        this._fp = Object.assign({}, FACTOR_PARAM_DEFAULTS, this._config.factorParams || {});

        // P2b 死重维护开关（2026-10-12 回测性能案）：默认 true = 存量零变化。
        //   maintainClassifierTracks=false → 跳过 OPB 专用维护（_clsTicks push/prune、
        //     _lastBigTickAt、_relHighestPriceUsd 快照、afterFirst9s 族）——OPB enabled=false
        //     时 start/扫描早退对 cls 字段零读，维护纯死重（BacktestEngine 结构性不嵌 OPB 恒关；
        //     Wss 引擎按 onlineProfile.enabled 判定）。★不在跳过清单：_relHighestPriceBnb/
        //     _relHighestAt（crashSpeed/OPB peakTime 核心因子原料）、
        //     uniqueTraders（因子键 uniqueTraderCount + classifier metrics 契约）
        //   maintainTpaTracks=false → 跳过 TPA 专用双 map 维护（_walletMaxNetTokens retention
        //     基准、_walletRoutedBuyBnb GMGN 用户判定原料）——TPA 不构造（config 无段）时零读。
        //     引擎按「段存在才构造 TPA」同判据注入，FA 先于 TPA 构造故用 config 判定
        this._maintainCls = config.maintainClassifierTracks !== false;
        this._maintainTpa = config.maintainTpaTracks !== false;

        this._states = new Map(); // tokenAddress → state

        // preFilter（pumpfun 回迁，回测专属默认关）：age 区间数组（并集语义），
        // 未持仓 token 的 age 落在全部区间外 → _buildFactorMap 跳过因子构建。
        // null = 不过滤（live/回测未开启时的恒常态，零行为变化）
        this._preFilter = null;
        this._preFilterSkipped = 0;

        // 趋势检测器（与 VirtualTradingEngine 相同的构造参数，保证算法口径一致）
        this._trendDetector = new TrendDetector({
            minDataPoints: 6,
            maxDataPoints: Infinity,
            cvThreshold: 0.005,
            scoreThreshold: 30,
            totalReturnThreshold: 5,
            riseRatioThreshold: 0.5,
        });
        this._holderTrendDetector = new HolderTrendDetector({
            minDataPoints: 6,
            maxDataPoints: Infinity,
            cvThreshold: 0.02,
            scoreThreshold: 30,
            growthRatioThreshold: 3,
            riseRatioThreshold: 0.5,
        });

        this._stats = {
            ticksProcessed: 0,
            pricesAccepted: 0,
            pricesRejectedOutlier: 0,
            factorsEmitted: 0,
            tokensRegistered: 0,
            prunedTokens: 0,
        };
    }

    // ═══════════════ 注册与查询 ═══════════════

    /**
     * TokenCreate 事件注册（代币年龄基准 = 创建事件块时间；totalSupply 供 marketCap）。
     * Buy 先于 Create 到达的乱序场景：迟到注册时若已有 state，仅回填更早的 createdAt
     * （首市值锚有效性门因此自动生效：回填更早 createdAt 后首 tick 距创建变大 → 超 60s 窗退 72 锚）。
     */
    registerToken(tokenAddress, info = {}) {
        if (!tokenAddress) return;
        let state = this._states.get(tokenAddress);
        if (!state) {
            state = this._createEmptyState(tokenAddress, info.createdAtMs || Date.now());
            this._states.set(tokenAddress, state);
        }
        state.registered = true;
        if (info.createdAtMs && info.createdAtMs < state.createdAtMs) {
            state.createdAtMs = info.createdAtMs; // TokenCreate 块时间是权威年龄锚点
        }
        if (info.totalSupply > 0) state.totalSupply = info.totalSupply;
        if (info.name) state.name = info.name;
        if (info.symbol) state.symbol = info.symbol;
        if (info.creatorAddress) state.creatorAddress = info.creatorAddress;
        if (info.platform) state.platform = info.platform; // 平台维度（flap per-token 毕业锚用；write-once 语义，平台不变）
        this._stats.tokensRegistered++;
    }

    /**
     * 毕业市值锚（graduationProgress 分母）。flap 盘 per-token 定锚（2026-09-28 王之蔑视案裁定）：
     * 锚 = 首市值（_relFirstPriceBnb × totalSupply）× graduationAnchorRatio(12.5)，
     * 仅当首 tick 距 token 创建 < graduationAnchorFirstTickMaxMs(60s)（首 tick≈开盘，锚有效）时启用；
     * 其余一切情况（非 flap / platform 未注册 / 首 tick 超窗=首 tick≠开盘 / 首市值缺失）
     * 退 graduationAnchorBnb(72) 默认锚。BacktestEngine 注册不传 platform → 恒 72，回测行为零变化。
     */
    _graduationAnchorBnb(state) {
        if (state.platform !== 'flap') return this._fp.graduationAnchorBnb;
        if (state.firstTickAt === null || state.createdAtMs == null) return this._fp.graduationAnchorBnb;
        if (state.firstTickAt - state.createdAtMs > this._fp.graduationAnchorFirstTickMaxMs) {
            return this._fp.graduationAnchorBnb;
        }
        const firstMcap = state._relFirstPriceBnb * state.totalSupply;
        if (!(firstMcap > 0)) return this._fp.graduationAnchorBnb;
        return firstMcap * this._fp.graduationAnchorRatio;
    }

    getTrackedTokens() {
        return [...this._states.keys()];
    }

    getTokenState(tokenAddress) {
        return this._states.get(tokenAddress) || null;
    }

    /**
     * 首窗 top-N 买家（2026-10-18 GMGN 钱包画像层消费口）：earlyTrades 窗内 per-wallet
     * 累计纯买入（_earlyWalletBuyBnb 原料——C84 出生锚 90s 窗，与 preBuy legacy 同源）
     * 按 BNB 降序取前 N。只读访问器——因子表/键探针/快照白名单零改动（GmgnWalletStats
     * 层在 GMGN 第三层内聚合，不进 FA 因子体系）。
     * 出窗冻结后原料已清（_earlyWindowAdvance 冻结即释放）→ 返回 []：fire 场景
     * 恒在窗内（买腿条件自带 tokenAgeSec < 90），出窗调用=无证据空集（上游落
     * gwpCovered=null 放行形状）。null wallet 行天然不在 Map（无法按钱包归户）。
     * @param {string} tokenAddress
     * @param {Object} [opts] - { limit=5, minBnb=0 }（minBnb=尘埃门，拆单规避由提高门槛应对）
     * @returns {Array<{wallet:string, bnb:number}>}
     */
    getEarlyTopBuyers(tokenAddress, opts = {}) {
        const state = this._states.get(tokenAddress);
        if (!state || state._earlyWindowClosed) return [];
        const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5;
        const minBnb = Number.isFinite(opts.minBnb) ? opts.minBnb : 0;
        const rows = [];
        for (const [wallet, cum] of state._earlyWalletBuyBnb) {
            if (cum >= minBnb) rows.push({ wallet, bnb: cum });
        }
        rows.sort((a, b) => b.bnb - a.bnb);
        return rows.slice(0, limit).map(r => ({ wallet: r.wallet, bnb: parseFloat(r.bnb.toFixed(4)) }));
    }

    getStats() {
        return {
            ...this._stats,
            trackedTokens: this._states.size,
        };
    }

    // ═══════════════ 市场截面 regime（回迁批 2.6，模块级单例）═══════════════

    /**
     * 市场 feed 显式 opt-in（仅两引擎调用；web 裸 FA 不调 → 读恒 null，零污染）。
     * 关 feed 即清单例（防 main.js 同进程起下一实验继承旧截面）。
     * @param {boolean} on
     */
    static setMarketFeedEnabled(on) {
        _marketFeedEnabled = !!on;
        if (_marketFeedEnabled && !_marketRegime) {
            _marketRegime = {
                startedAt: null,        // 首 feed tick ts（fedAgeMs 诊断口径；backtest=回放首 tick）
                registry: new Map(),    // token → {birth, firstPrice, lastPrice, lastRelPct, peakRelPct, lastTs}
                fifo: [],               // 注册序 token 队列（按 birth 龄写时裁剪的游标）
                ringFlow: Array.from({ length: MARKET_FLOW_RING_LEN }, () => ({ k: 0, b: 0, s: 0 })),  // 分钟桶 Σ买/Σ卖 BNB
                snapMinute: null,       // 快照 memo：分钟桶键（同分钟跨 token 恒同值=截面一致性由构造保证）
                snap: null,
            };
        }
        if (!_marketFeedEnabled) _marketRegime = null;
    }

    static isMarketFeedEnabled() { return _marketFeedEnabled; }
    static getMarketRegistrySize() { return _marketRegime ? _marketRegime.registry.size : 0; }

    // ═══════════════ 名单因子（回迁批 3.3，模块级单例）═══════════════

    /**
     * 启动时从 wallets.category 加载聪明Bot名单到模块级单例（id 游标分页 1000/页 4 次重试）。
     * 幂等：已加载直接返回；在途复用同一 promise。失败抛错（不落缓存，下次调用可重试），
     * 调用方（两引擎钩子）自行 try/catch fail-open（名单 null → 因子恒 0）。
     * ★BSC：母版查 wallets 不带链过滤（单链仓库）；本表多链共存，必须 .eq('chain','bsc')。
     */
    static async loadSmartBotWallets(supabase, category = 'smart_bot') {
        if (!supabase) throw new Error('[FourMemeFA] loadSmartBotWallets: 缺少 supabase client');
        if (_smartBotWallets) return _smartBotWallets;
        if (_smartBotLoadPromise) return _smartBotLoadPromise;
        _smartBotLoadPromise = (async () => {
            const pageSize = 1000;
            let lastId = 0;
            const addresses = [];
            while (true) {
                let data = null, error = null;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    ({ data, error } = await supabase
                        .from('wallets')
                        .select('id, address')
                        .eq('chain', 'bsc')
                        .eq('category', category)
                        .gt('id', lastId)
                        .order('id', { ascending: true })
                        .limit(pageSize));
                    if (!error && data) break;
                    if (attempt < 4) {
                        this._logWarn(`smart_bot 名单分页查询失败 ${attempt}/4: ${error?.message || error}，重试...`);
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                    }
                }
                if (error) throw error;
                if (!data || data.length === 0) break;
                for (const row of data) addresses.push(row.address);
                lastId = data[data.length - 1].id;
                if (data.length < pageSize) break;
            }
            _smartBotWallets = new Set(addresses);
            this._logInfo(`加载 smart_bot（聪明Bot）名单: ${_smartBotWallets.size} 个（chain='bsc', category='${category}'）`);
            return _smartBotWallets;
        })();
        try {
            return await _smartBotLoadPromise;
        } finally {
            // 结束（成功/失败）后清引用：成功路径 _smartBotWallets 已落、后续调用首行快返回；失败路径允许重试
            _smartBotLoadPromise = null;
        }
    }

    /**
     * sniper 名单（sniperHolderShare 因子原料）：wallets.token_count ≥ SNIPER_TOKEN_COUNT_THR，
     * 服务端过滤+id 游标（普通 INT 列，母版绕 jsonb 谓词的理由不适用）。失败抛错，调用方决定
     * fail-open/fail-fast（两引擎统一 fail-open，见引擎侧注释）。
     */
    static async loadSniperWallets(supabase) {
        if (!supabase) throw new Error('[FourMemeFA] loadSniperWallets: 缺少 supabase client');
        if (_sniperWallets) return _sniperWallets;
        if (_sniperLoadPromise) return _sniperLoadPromise;
        _sniperLoadPromise = (async () => {
            const pageSize = 1000;
            let lastId = 0;
            const addresses = [];
            while (true) {
                let data = null, error = null;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    ({ data, error } = await supabase
                        .from('wallets')
                        .select('id, address')
                        .eq('chain', 'bsc')
                        .gte('token_count', SNIPER_TOKEN_COUNT_THR)
                        .gt('id', lastId)
                        .order('id', { ascending: true })
                        .limit(pageSize));
                    if (!error && data) break;
                    if (attempt < 4) {
                        this._logWarn(`sniper 名单分页查询失败 ${attempt}/4: ${error?.message || error}，重试...`);
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                    }
                }
                if (error) throw error;
                if (!data || data.length === 0) break;
                for (const row of data) addresses.push(row.address);
                lastId = data[data.length - 1].id;
                if (data.length < pageSize) break;
            }
            _sniperWallets = new Set(addresses);
            this._logInfo(`加载 sniper（早期快速买入类）名单: ${_sniperWallets.size} 个（chain='bsc', token_count≥${SNIPER_TOKEN_COUNT_THR}）`);
            return _sniperWallets;
        })();
        try {
            return await _sniperLoadPromise;
        } finally {
            _sniperLoadPromise = null;
        }
    }

    /** 测试专用：直接注入 smart_bot 名单 Set（绕过 DB；探针零 DB 断言用）。传 null 还原「未加载」态。 */
    static setSmartBotWalletsForTest(setOrNullOrUndefined) {
        _smartBotWallets = setOrNullOrUndefined ?? null;
    }

    /** 测试专用：直接注入 sniper 名单 Set（绕过 DB；探针零 DB 断言用）。传 null 还原「未加载」态（因子恢复恒 null fail-closed）。 */
    static setSniperWalletsForTest(setOrNullOrUndefined) {
        _sniperWallets = setOrNullOrUndefined ?? null;
    }

    /**
     * 跟单簇名单（maxCopyWalletHolderCircPct 因子原料）：读 config/rosters/copy-wallet-roster.json
     * （scan-copy-trade-clusters.cjs 扫描产物）。幂等+在途去重（对齐 loadSniperWallets 模板）。
     * 文件缺失/损坏/解析失败 → 保持 null 抛错（调用方 warn + fail-closed：因子恒 null=门拦）。
     * 无需 supabase 参数——文件读与 DB 无关；幂等返回后名单只增不改（静态快照）。
     */
    static async loadCopyWalletRoster() {
        if (_copyWallets) return _copyWallets;
        if (_copyLoadPromise) return _copyLoadPromise;
        _copyLoadPromise = (async () => {
            const fs = require('fs');
            const path = require('path');
            const rosterPath = path.resolve(__dirname, '..', '..', 'config', 'rosters', 'copy-wallet-roster.json');
            const raw = fs.readFileSync(rosterPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wallets)) {
                throw new Error(`[FourMemeFA] loadCopyWalletRoster: 名单 schema 不符（${rosterPath}）`);
            }
            const addresses = [];
            for (const w of parsed.wallets) {
                if (w && typeof w.address === 'string' && w.address) addresses.push(w.address.toLowerCase());
            }
            _copyWallets = new Set(addresses);
            this._logInfo(`加载跟单簇名单: ${_copyWallets.size} 个（${rosterPath}，generatedAt=${parsed.generatedAt || '?'}）`);
            return _copyWallets;
        })();
        try {
            return await _copyLoadPromise;
        } finally {
            _copyLoadPromise = null;
        }
    }

    /** 测试专用：直接注入跟单簇名单 Set（注入侧统一 toLowerCase 归一——名单唯一规范形=小写，
     * 与 loader 同口径）。传 null 还原「未加载」态（因子恢复恒 null fail-closed）。 */
    static setCopyWalletsForTest(setOrNullOrUndefined) {
        _copyWallets = setOrNullOrUndefined
            ? new Set([...setOrNullOrUndefined].map(a => String(a).toLowerCase()))
            : null;
    }

    /**
     * 极著名钱包子集（famousCopyWalletCircPct 因子原料）：读
     * config/rosters/famous-copy-wallets.json（用户点名集合）。幂等+在途去重
     * （loadCopyWalletRoster 模板）。与主名单两处刻意不同：①文件缺失 → 不抛错，
     * 解析为空 Set（fail-open：收紧门未启用=零影响，非部署异常）②返回的是
     * 「是否启用 + 名单」——空 Set 时因子恒 null（区分「未启用」与「无命中」，
     * 前者 IS NULL 臂放行）。schema 不符（wallets 非数组）才抛错。
     */
    static async loadFamousCopyWallets() {
        if (_famousCopyWallets) return _famousCopyWallets;
        if (_famousCopyLoadPromise) return _famousCopyLoadPromise;
        _famousCopyLoadPromise = (async () => {
            const fs = require('fs');
            const path = require('path');
            const rosterPath = path.resolve(__dirname, '..', '..', 'config', 'rosters', 'famous-copy-wallets.json');
            let parsed = null;
            try {
                parsed = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
            } catch (e) {
                if (e.code === 'ENOENT') {
                    // 文件不存在=功能未启用（用户点名集合尚未建立），非异常
                    this._logInfo(`极著名钱包名单未配置（${rosterPath} 缺失），famousCopyWalletCircPct 恒 null=未启用`);
                    _famousCopyWallets = new Set();
                    return _famousCopyWallets;
                }
                throw e;
            }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wallets)) {
                throw new Error(`[FourMemeFA] loadFamousCopyWallets: 名单 schema 不符（${rosterPath}）`);
            }
            _famousCopyWallets = new Set(parsed.wallets
                .filter(w => typeof w === 'string' && w)
                .map(w => w.toLowerCase()));
            this._logInfo(`加载极著名钱包名单: ${_famousCopyWallets.size} 个（${rosterPath}）`);
            return _famousCopyWallets;
        })();
        try {
            return await _famousCopyLoadPromise;
        } finally {
            _famousCopyLoadPromise = null;
        }
    }

    /** 测试专用：注入极著名钱包集合（loader 同口径小写归一）。传 null 还原「未加载」
     * 态；空 Set=「已加载但未启用」（因子恒 null）。 */
    static setFamousCopyWalletsForTest(setOrNullOrUndefined) {
        _famousCopyWallets = setOrNullOrUndefined === null
            ? null
            : new Set([...setOrNullOrUndefined].map(a => String(a).toLowerCase()));
    }

    /**
     * sybil 大簇钱包并集（sybilClusterHolderCircPct 因子原料）：读
     * config/rosters/sybil-clusters.json（build-sybil-clusters.cjs 产物）。
     * 语义模板=loadFamousCopyWallets：文件缺失 → 空 Set（未启用，因子恒 null，IS NULL
     * 臂放行），schema 不符才抛错。簇明细（clusters 数组）保留在文件里供审计，FA 只
     * 消费 wallets 并集。
     */
    static async loadSybilClusters() {
        if (_sybilClusterWallets) return _sybilClusterWallets;
        if (_sybilClusterLoadPromise) return _sybilClusterLoadPromise;
        _sybilClusterLoadPromise = (async () => {
            const fs = require('fs');
            const path = require('path');
            const rosterPath = path.resolve(__dirname, '..', '..', 'config', 'rosters', 'sybil-clusters.json');
            let parsed = null;
            try {
                parsed = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
            } catch (e) {
                if (e.code === 'ENOENT') {
                    this._logInfo(`sybil 大簇名单未配置（${rosterPath} 缺失），sybilClusterHolderCircPct 恒 null=未启用`);
                    _sybilClusterWallets = new Set();
                    return _sybilClusterWallets;
                }
                throw e;
            }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wallets)) {
                throw new Error(`[FourMemeFA] loadSybilClusters: 名单 schema 不符（${rosterPath}）`);
            }
            _sybilClusterWallets = new Set(parsed.wallets
                .filter(w => typeof w === 'string' && w)
                .map(w => w.toLowerCase()));
            this._logInfo(`加载 sybil 大簇名单: ${_sybilClusterWallets.size} 个（${rosterPath}，generatedAt=${parsed.generatedAt || '?'}）`);
            return _sybilClusterWallets;
        })();
        try {
            return await _sybilClusterLoadPromise;
        } finally {
            _sybilClusterLoadPromise = null;
        }
    }

    /** 测试专用：注入 sybil 大簇钱包集合（loader 同口径小写归一）。null=「未加载」
     * 态；空 Set=「已加载但未启用」（因子恒 null）。 */
    static setSybilClustersForTest(setOrNullOrUndefined) {
        _sybilClusterWallets = setOrNullOrUndefined === null
            ? null
            : new Set([...setOrNullOrUndefined].map(a => String(a).toLowerCase()));
    }

    /** static 上下文的日志出口（无实例 logger 时落 console；与母版 console.log 口径一致） */
    static _logInfo(msg) { console.log(`[FourMemeFactorAggregator] ${msg}`); }
    static _logWarn(msg) { console.warn(`[FourMemeFactorAggregator] ${msg}`); }

    /**
     * 当前因子体系的全量因子 key 集合（权威单一事实源，空 state 产出即全量键）。
     * Phase 3 策略 condition 键审计用：策略引用键 ∉ 此集合 = 会被静默封死买入。
     * 注：trend/holderTrend 明细键需 ≥2/≥4 个序列点才出现（与旧契约一致：数据不足保持 undefined），
     * 此处显式并入全集，避免审计误报；回迁批 1 的 68 新键在 _buildFactorMap 字面量无条件出现，
     * 探针自动收录。
     */
    getFactorKeys() {
        const state = this._createEmptyState('__FACTOR_KEY_PROBE__', Date.now());
        const factors = this._buildFactorMap(state, Date.now());
        const keys = new Set(Object.keys(factors || {}));
        for (const k of [
            // TPA 注入键（回迁批 4）：holdingCache spread 动态键探针收不到（getFactorKeys 用空 state），
            // 手动并入两清单；FA_TPA_KEYS 字面量无条件出键本可探到，显式并入作双保险（Set 去重）
            ...HOLDING_FACTOR_KEYS,
            ...FA_TPA_KEYS,
            'trendTotalReturn', 'trendRiseRatio', 'trendCV', 'trendRecentDownCount', 'trendRecentDownRatio',
            'trendConsecutiveDowns', 'trendDrawdownFromWindowHigh',
            'trendPriceUp', 'trendMedianUp', 'trendSlope', 'trendStrengthScore',
            'holderTrendGrowthRatio', 'holderTrendRiseRatio', 'holderTrendCV',
            'holderTrendRecentDecreaseCount', 'holderTrendRecentDecreaseRatio', 'holderTrendConsecutiveDecreases',
            'holderTrendHolderCountUp', 'holderTrendMedianUp', 'holderTrendSlope', 'holderTrendStrengthScore',
        ]) {
            keys.add(k);
        }
        return keys;
    }

    /**
     * 注入 TPA 审批时刻（TokenPositionAnalyzer verdict=approve 时回调；母版 :1088-1095 同款）。
     * 在此刻冻结 _asofRelFirst = 审批价相对首可靠价的涨幅（静态值，复刻 offline asofRelFirst 语义）。
     * 调用时机保证 processTick 已推进 _relPriceBnb 为本 tick 可靠价（≈审批价）——引擎
     * _onFactorsUpdated 在 factorsUpdated（=processTick 尾部）后触发 checkAndTrigger，
     * TPA verdict approve 在其内。幂等：已冻结则跳过（避免后续重算漂移）。
     */
    setAsofMs(tokenAddress, asOfMs) {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        state._asofMs = asOfMs;
        if (state._asofRelFirst === null && state._relFirstPriceBnb > 0) {
            state._asofRelFirst = ((state._relPriceBnb - state._relFirstPriceBnb) / state._relFirstPriceBnb) * 100;
        }
    }

    // ═══════════════ 核心：tick 增量处理 ═══════════════

    /**
     * 处理一笔 tick（实时或回放共用入口）。
     * @param {Object} tick - { token_address, trade_type, trader_address, sender_address, price_bnb, price_usd,
     *                          bnb_amount, token_amount, offers, funds_bnb, block_number, timestamp(ms), tx_hash, log_index }
     * @param {Object} [opts] - { emitFactors: true } 回放场景可置 false 只累计状态不触发决策；
     *                          { deferWallet: true } 两阶段喂食（2026-10-14 鸡蛋案）：只跑价格/流量段，
     *                          wallet 聚合段由 collector 在 sender 回查完成后经 applyWalletTick 补——
     *                          价格零回查依赖（fire 价失真/lastTickAt 回拨根除），holders 用真 sender 精确计数。
     *                          回放路径（行 sender 已定值）不 defer，行为与旧版 bit 一致。
     * @returns {{factors: Object|null, priceAccepted: boolean, priceOutlier: boolean}|null}
     */
    processTick(tick, opts = {}) {
        const emitFactors = opts.emitFactors !== false;
        const deferWallet = opts.deferWallet === true;
        const tokenAddress = tick.token_address;
        if (!tokenAddress || !tick.timestamp) return null;
        this._stats.ticksProcessed++;

        // 钱包口径单点 COALESCE（2026-10-01 GMGN 案 B + 2026-10-10 二期 TPA 整链同批切换）：
        // 公共聚合路由（GMGN 0x1de460，flap 27.9% 行）把 N 个真实买家在 trader 层合并成
        // 单一地址——holders/K 组/滑窗/名单族全部失真（该票 holders 6 vs 独立钱包 48）。
        // 二期起 TPA 基准（_walletNetTokens/_walletMaxNetTokens）与画像库
        // wallet_offline_profiles 同批切 sender 口径。仍刻意保留 trader 口径的仅剩
        // uniqueTraders（classifier metrics 契约字段，与离线 classifyToken/
        // token-classifier 口径锁定）。
        const walletAddr = tick.sender_address || tick.trader_address || null;

        const ts = tick.timestamp;
        let state = this._states.get(tokenAddress);
        if (!state) {
            state = this._createEmptyState(tokenAddress, ts);
            this._states.set(tokenAddress, state);
        }
        state.tickCount++;
        if (state.firstTickAt === null) {
            state.firstTickAt = ts; // 首 tick 锚点（滑窗 span/trend age/脉冲期口径）
            // 市场截面：新出生注册（write-once；registry 已在册的 prune 复活票不重计，S3 口径）
            this._marketRegisterBirth(tokenAddress, state, ts);
        }
        if (state.firstBlockNumber === null && tick.block_number != null) {
            state.firstBlockNumber = Number(tick.block_number); // bigHolder early 判定基准 s0（write-once）
        }

        const isBuy = tick.trade_type === 'buy';
        const bnbAmount = tick.bnb_amount || 0;
        const priceBnb = tick.price_bnb || 0;
        const tokenAmount = tick.token_amount || 0;
        const blockNumber = tick.block_number != null ? Number(tick.block_number) : null;

        // 隐含 BNB/USD（tick 已带 USD 价时刷新，供 buildFactorMap 换算）
        if (tick.price_usd > 0 && priceBnb > 0) {
            state.lastImpliedBnbUsd = tick.price_usd / priceBnb;
        }
        if (tick.funds_bnb > 0) state.lastFundsBnb = tick.funds_bnb;
        if (tick.offers > 0) state.lastOffers = tick.offers;

        // ── 计数与地址统计（全量 tick，无 skip）──
        state.tradeCount++;
        if (isBuy) state.buyCount++; else state.sellCount++;
        state.totalBuyBnb += isBuy ? bnbAmount : 0;
        state.totalSellBnb += isBuy ? 0 : bnbAmount;
        if (isBuy) state.totalBuyTokens += tokenAmount; else state.totalSellTokens += tokenAmount;

        // ── earlyTrades* trader 层原料（2026-10-17 买腿重构 C84）：出生锚=firstTickAt、
        //    窗=earlyTradesWindowMs（90s），首个出窗 tick 冻结六键快照（_earlyWindowAdvance）
        //    后行照计流量不再入窗。照计语义：无 outlier/price_usd 过滤（旧 SQL 查询侧
        //    price_outlier=false AND price_usd 非空——口径 delta①，台账 C84 记录）；
        //    defer 路径价格段照跑（trader 层不依赖 sender 回查），与 tradeCount 同到达序 ──
        this._earlyWindowAdvance(state, ts);
        if (!state._earlyWindowClosed) {
            state._earlyTickRows++;
            if (isBuy) {
                state._earlyTotalBuyBnb += bnbAmount;
                if (tick.trader_address
                    && AGGREGATOR_ROUTER_ADDRS.has(String(tick.trader_address).toLowerCase())) {
                    state._earlyRouterBuyBnb += bnbAmount;
                }
            } else {
                state._earlyTotalSellBnb += bnbAmount;
            }
        }

        // 首块脉冲（母版首秒脉冲的 BSC 适配：首买 anchor 起 firstBlockWindowMs 窗内买入累计，
        // firstBlockBuyShare 原料；窗口冻结后才出值，防早期读数误导）
        if (isBuy) {
            if (state._firstBuyAt === null) state._firstBuyAt = ts;
            if (ts - state._firstBuyAt < this._fp.firstBlockWindowMs) state._firstBlockBuyBnb += bnbAmount;
        }
        if (tick.trader_address) {
            state.uniqueTraders.add(tick.trader_address);
            // uniqueTraders 是 classifier metrics 契约字段（与离线 classifyToken/
            // token-classifier 口径锁定）——刻意保留 trader 口径，勿混 wallet 聚合
        }
        // ── wallet 聚合段（2026-10-14 鸡蛋案两阶段喂食抽出 → _applyWalletAggregation）：holders/
        //    K 组/TPA 基准/GMGN routedBuy/holderTrend 桶——全部依赖 sender 真值。defer 时整段
        //    推迟到 applyWalletTick 补喂（collector sender 回查完成后），价格段零 wallet 依赖 ──
        if (!deferWallet) {
            this._applyWalletAggregation(state, tick, { isBuy, bnbAmount, tokenAmount, blockNumber });
        }

        // ── 链上序迟到判据（2026-10-14 鸡蛋案）：resolver 回查乱序让 FA 先吃晚块再吃早块，
        //    迟到旧价覆盖 currentPrice=fire 价 61% 低锚的根因。blockNumber+logIndex 复合水位
        //    （同块内 block_time 相同判不出倒挂——li=547 先喂 li=393 后到的 20ms 倒挂实测）；
        //    迟到 tick 计流量/滑窗照旧，跳过 outlier 判定与价格接受链；链证据缺失 fail-open ──
        const logIdx = tick.log_index != null ? Number(tick.log_index) : null;
        let chainLate = false;
        if (blockNumber !== null && logIdx !== null) {
            if (state._lastChainBlock !== null
                && (blockNumber < state._lastChainBlock
                    || (blockNumber === state._lastChainBlock && logIdx <= state._lastChainLogIdx))) {
                chainLate = true;
                this._stats.chainLateTicks = (this._stats.chainLateTicks || 0) + 1;
            } else {
                state._lastChainBlock = blockNumber;
                state._lastChainLogIdx = logIdx;
            }
        }

        // ── 价格追踪（离群剔除；chainLate 时跳过——_acceptPrice 有副作用（recentPrices 窗
        //    push/shift），迟到旧价喂窗会污染离群基线）──
        // pending fire 峰（2026-10-15 双口径）：与持仓峰同门同价流——任意接受价轨在此块、
        // 可靠价轨在下方 priceReliable 块；outlier/chainLate 天然不推进
        const _pend = state._pendingBuyFire;
        const priceOutlier = !chainLate && priceBnb > 0 && !this._acceptPrice(state, priceBnb);
        let priceAccepted = false;
        if (!chainLate && priceBnb > 0 && !priceOutlier) {
            priceAccepted = true;
            this._stats.pricesAccepted++;
            if (!state.firstPriceBnb) {
                state.firstPriceBnb = priceBnb; // 首 tick 价格 = earlyReturn 基准（旧契约 firstPrice 语义）
            }
            state.currentPriceBnb = priceBnb;
            state.lastPriceAt = ts;
            if (priceBnb > state.highestPriceBnb) {
                state.highestPriceBnb = priceBnb;
                state.highestPriceAt = ts;
            }
            // 持仓中的代币：推进 per-position 峰值（SinceLastBuy 族）
            for (const pos of state._positions.values()) {
                if (priceBnb > pos.highestPriceSinceBuyBnb) {
                    pos.highestPriceSinceBuyBnb = priceBnb;
                    pos.highestPriceSinceBuyAt = ts;
                }
                if (state.holderCount > pos.highestHoldersSinceBuy) {
                    pos.highestHoldersSinceBuy = state.holderCount;
                    pos.highestHoldersSinceBuyAt = ts;
                }
            }
            // fire→成交窗冲高（任意接受价轨 → highestPriceSinceBuyBnb 回填原料）
            if (_pend && priceBnb > _pend.peakAnyBnb) {
                _pend.peakAnyBnb = priceBnb;
                _pend.peakAnyAt = ts;
            }
            this._pushPriceSeriesPoint(state, ts);
        } else if (priceOutlier) {
            this._stats.pricesRejectedOutlier++;
        }

        // ── 可靠价链（回迁批 1：priceReliable 驱动秒桶/宽bar/峰值链/dd/ddConfirm/块链；
        //    chainLate 迟到 tick 不进链——秒桶/宽bar/峰值/块链全部只吃链上序递进的新价）──
        const priceReliable = !chainLate && priceBnb > 0 && !priceOutlier && bnbAmount >= this._fp.minPriceUpdateBnb;
        if (priceReliable) {
            state._relPriceBnb = priceBnb;
            if (state._relFirstPriceBnb === 0) state._relFirstPriceBnb = priceBnb; // 涨幅基准：首值冻结（priceBnb>0 由 priceReliable 保证，0 哨兵安全）

            // ── 名单因子（回迁批 3.3）：smart_bot 名单内地址的可靠买额累计
            //   （参与=累计 buyBnb ≥ smartBotMinBuyBnb，对齐挖掘 qualify 口径；母版 _smartBotBuySol→BNB。
            //    只累不减：卖出不清——"参与过"留痕；名单 null（未加载/失败）整段跳过=因子恒 0 fail-open）
            //   defer 时价格段 walletAddr=sender 未知的假值（NULL 回退 trader）——跳过，
            //   由 wallet 段 applyWalletTick 用真 sender + price_accepted 透传补跑
            if (!deferWallet && isBuy && _smartBotWallets && walletAddr && _smartBotWallets.has(walletAddr)) {
                state._smartBotBuyBnb.set(walletAddr,
                    (state._smartBotBuyBnb.get(walletAddr) || 0) + bnbAmount);
            }

            // ── 分类器 running 标量（回迁批 3.1：OPB 专用；与 token-classifier computeTickMetrics 同口径）──
            // USD 峰快照：仅在新 BNB 峰 tick 覆写（对齐离线「highestPriceUsd 在 BNB 峰 tick 处快照」；
            // 峰 tick 缺 USD → 0，其后非峰 tick 不回填——保守方向与离线一致）
            // P2b：该 if 只写 USD 快照不写 Bnb 峰（BNB 峰链在下方可靠价峰值链，因子原料不动）
            if (this._maintainCls && priceBnb > state._relHighestPriceBnb) {
                state._relHighestPriceUsd = Number(tick.price_usd) > 0 ? tick.price_usd : 0;
            }
            // afterFirst9s（ts ≥ firstTickAt+9s；母版扣前3s=7.5 slot 的 BSC 3 block 版）达标 tick 的
            // peak + 峰值前 min（砸盘地板在峰值后不计入 min；创新高时锁定 running min 为分母）
            // P2b：afterFirst9s 族仅 OPB 分类路径消费（high_mcap_wash ratio），零读跳过
            if (this._maintainCls && state.firstTickAt !== null
                && ts - state.firstTickAt >= this._fp.clsFirstWindowMs) {
                state._afterFirst9sReliableCount++;
                if (priceBnb < state._runningMinAfterFirst9sBnb) state._runningMinAfterFirst9sBnb = priceBnb;
                if (priceBnb > state._afterFirst9sPeakPriceBnb) {
                    state._afterFirst9sPeakPriceBnb = priceBnb;
                    state._beforeFirst9sPeakMinBnb = state._runningMinAfterFirst9sBnb;
                }
            }

            // 墙钟秒收盘桶（空秒跳过；已闭合秒序列 = 因果口径 RSI 原料）
            const _sec = Math.floor(ts / 1000);
            if (state._secCurrent === null) {
                state._secCurrent = { sec: _sec, close: priceBnb };
            } else if (_sec > state._secCurrent.sec) {
                state._secCloses.push(state._secCurrent.close);
                if (state._secCloses.length > this._fp.secRsiMaxBars) state._secCloses.shift();
                state._secCurrent = { sec: _sec, close: priceBnb };
            } else if (_sec === state._secCurrent.sec) {
                state._secCurrent.close = priceBnb; // 同秒末笔覆盖
            }

            // 宽 bar（5m）收盘桶（E5 RSI 阶梯：5m=rich-js RSI 卖臂同档节奏。
            // 三段式：开桶/闭桶推 close/同桶末笔覆盖；Rt 实时口径由读取侧拼 _barNmCurrent.close）
            const _bar5m = Math.floor(_sec / 300);
            if (state._bar5mCurrent === null) {
                state._bar5mCurrent = { bar: _bar5m, close: priceBnb };
            } else if (_bar5m > state._bar5mCurrent.bar) {
                state._bar5mCloses.push(state._bar5mCurrent.close);
                if (state._bar5mCloses.length > this._fp.bar5mRsiMaxBars) state._bar5mCloses.shift();
                state._bar5mCurrent = { bar: _bar5m, close: priceBnb };
            } else if (_bar5m === state._bar5mCurrent.bar) {
                state._bar5mCurrent.close = priceBnb;
            }

            // 可靠价峰值链（新链专用；与既有 highestPriceBnb 任意接受价口径双轨并行。
            // _relHighestAt/_relHighestPriceBnb 供 OPB peakTime、cls prune、crashSpeed/秒速回撤族消费）
            if (priceBnb > state._relHighestPriceBnb) {
                state._relHighestPriceBnb = priceBnb;
                state._relHighestAt = ts;
            }
            // fire→成交窗冲高（可靠价轨 → peakProfitPct 回填原料；0 哨兵起算只吃窗内可靠价）
            if (_pend && priceBnb > _pend.peakRelBnb) {
                _pend.peakRelBnb = priceBnb;
            }

            // ── 单块跌幅链（相邻块收盘对 + 块内瞬时；block 单调 guard，迟到/回退 tick 忽略）──
            if (blockNumber !== null) {
                if (state._curBlock === null || blockNumber > state._curBlock) {
                    if (state._curBlock !== null) {
                        // 结算上一对相邻块收盘跌幅（两收盘都在才成立；断链 _prevBlockClose=null 跳过）
                        if (state._curBlockClose !== null && state._prevBlockClose !== null
                            && state._prevBlockClose > 0) {
                            const _blockDrop = (state._prevBlockClose - state._curBlockClose)
                                / state._prevBlockClose * 100;
                            if (_blockDrop > 0
                                && (state._maxBlockDropPct === null || _blockDrop > state._maxBlockDropPct)) {
                                state._maxBlockDropPct = _blockDrop;
                            }
                        }
                        state._prevBlockClose = state._curBlockClose;
                    }
                    state._curBlock = blockNumber;
                    state._curBlockClose = null;
                    state._curBlockHigh = null;
                }
                if (blockNumber === state._curBlock) {
                    state._curBlockClose = priceBnb;
                    if (state._curBlockHigh === null || priceBnb > state._curBlockHigh) {
                        state._curBlockHigh = priceBnb;
                    } else if (state._curBlockHigh > 0) {
                        // 块内瞬时回落（同块高点→当前）
                        const _intraDrop = (state._curBlockHigh - priceBnb) / state._curBlockHigh * 100;
                        if (state._maxBlockDropPct === null || _intraDrop > state._maxBlockDropPct) {
                            state._maxBlockDropPct = _intraDrop;
                        }
                    }
                }
            }
        }

        // ── 滑窗速率原料（附价可靠性/块号，供 trend/crash 窗扫描；既有 5min 摊销窗不变）──
        state._recentTicks.push({ ts, isBuy, bnb: bnbAmount, priceBnb, priceReliable, blockNumber });
        this._pruneRecentTicks(state, ts);

        // ── 分类器轨迹（回迁批 3.1：OPB/离线挖掘共用 slim shape，全量 tick 记录——
        //    大额断流/活跃度判定需全 tick，价格判定由消费方按 priceReliable 过滤。
        //    母版 recentTicks 同构：peak 后动态保留（见 _pruneClsTicks），与速率滑窗分离互不干扰）──
        // P2b：分类器轨迹维护仅 OPB 消费（idle/bigTickIdle 触发 + 分类时刻读 _clsTicks），
        // 关闭时跳过 push/lastBigTickAt/prune（含窗满后 slice(1500) 新数组分配）
        if (this._maintainCls) {
            state._clsTicks.push({
                ts, isBuy, bnbAmount, priceBnb,
                priceUsd: Number(tick.price_usd) > 0 ? tick.price_usd : null,
                blockNumber, priceReliable,
            });
            if (bnbAmount >= this._fp.clsBigTickBnb) state._lastBigTickAt = ts;
            this._pruneClsTicks(state, ts);
        }

        // ── 市场截面：全量 tick 口径累积（流量环 + registry 价格/存活推进 + FIFO 写时裁剪；
        //    市场状态与挂载策略无关。尘 tick 计流量不计价——priceReliable 守卫，S8）──
        this._marketOnTick(tokenAddress, ts, isBuy, bnbAmount, priceBnb, priceReliable);

        // Math.max 防回拨（2026-10-14 鸡蛋案）：迟到旧 tick 的 ts 会把 lastTickAt 拉回
        // （实测 50.0→48.0 → idleSecSinceLastTick 虚高 3.593 假断流触发 P11 全清）
        state.lastTickAt = state.lastTickAt === null ? ts : Math.max(state.lastTickAt, ts);

        // ── 因子构建与事件发射 ──
        let factors = null;
        if (emitFactors) {
            factors = this._buildFactorMap(state, ts);
            if (factors) {
                this._stats.factorsEmitted++;
                this.emit('factorsUpdated', {
                    tokenAddress,
                    factors,
                    tick: {
                        token_address: tokenAddress,
                        trade_type: tick.trade_type,
                        price_bnb: priceBnb,
                        price_usd: tick.price_usd || null,
                        block_number: blockNumber, // TPA blocks 时间门用（回迁批 4；null=本 tick 无块证据）
                        timestamp: ts,
                    },
                    tokenState: state,
                });
            }
        }

        return { factors, priceAccepted, priceOutlier };
    }

    /**
     * wallet 聚合段（2026-10-14 鸡蛋案两阶段喂食自 processTick 抽出，逐行原样迁移）：
     * holders 净持仓/holderCount（P2a 增量维护单写点）/TPA 双 map/GMGN routedBuy/
     * K 组/holderTrend 桶——全部依赖 sender 真值（wallet 口径，sender||trader）。
     * 两个调用方：processTick 非 defer（行序与抽出前 bit 一致——wallet 段先于价格段）；
     * applyWalletTick defer 补喂（blockNumber 归桶，晚到不错桶；holderCount 任意序重放
     * 收敛同终值——P2a 归纳等价性保证）。
     * @param {Object} vars - { isBuy, bnbAmount, tokenAmount, blockNumber, smartBotEligible, deferred }
     *   smartBotEligible：defer 补跑时 true=价格段跳过的 smartBot 累计在此补（priceReliable
     *   由 applyWalletTick 按 price_accepted 透传重算）；非 defer 调用恒 undefined=不跑（价格段原位已跑）。
     *   deferred：true=defer 补喂（holderTrend 走事件缓冲+重放）；缺省=非 defer 正序路径
     */
    _applyWalletAggregation(state, tick, vars) {
        const walletAddr = tick.sender_address || tick.trader_address || null;
        const { isBuy, bnbAmount, tokenAmount, blockNumber } = vars;

        if (walletAddr) {
            if (tokenAmount > 0) {
                const delta = isBuy ? tokenAmount : -tokenAmount;
                const _prev = state._walletNetTokens.get(walletAddr) || 0;
                const _cur = _prev + delta;
                state._walletNetTokens.set(walletAddr, _cur);
                // holderCount 增量维护（P2a 2026-10-12 回测性能案）：跨 0 边界 ±1，
                // 与全 map 重数 #{net>0} 逐 tick 等价（归纳：每步只动一个钱包的净持仓，
                // 正↔正/负↔负 计数不变；holderCount 单写点在此、初值 0）——替代每
                // tick 清零重数 O(map)（130 万 tick 回放 x 万钱包 map 的线性热点）
                if (_prev <= 0 && _cur > 0) state.holderCount++;
                else if (_prev > 0 && _cur <= 0) state.holderCount--;
                // 建仓峰值净持仓（TPA retention 基准分母，回迁批 4 → 二期随键域切 wallet）：
                // 仅 running 上升时更新，单调不减 → 触发前已清仓的大户 maxNet 仍保留。
                // P2b：TPA 不构造时双 map 零读 → 跳过维护
                if (this._maintainTpa) {
                    const _mx = state._walletMaxNetTokens.get(walletAddr) || 0;
                    if (_cur > _mx) state._walletMaxNetTokens.set(walletAddr, _cur);
                }
                if (isBuy) {
                    // GMGN 用户判定原料（2026-10-11 用户裁定）：本盘经聚合路由买入的 BNB 按钱包归集。
                    // trader 层判定与 EarlyParticipantCheckService routerPct 因子同层同源（AGGREGATOR_ROUTER_ADDRS
                    // 单一真相源；Set 条目小写，trader 归一 lower-case 后比对——checksum 形态行不漏记）；
                    // sender NULL 回退行 walletAddr=trader=路由地址 → routedBuy 记到路由地址名下
                    //（TPA 剔除判定天然涵盖路由地址本身的残留合并像）。卖腿不记：「参与者」= 买入者。
                    // TPA 消费：触发门 minHolders 剔除 + top20 评分剔除 + 主导盘豁免（gmgnFilter）
                    // P2b：routed map 仅 TPA gmgnFilter/minHolders 剔除消费，TPA 不构造零读
                    if (this._maintainTpa && tick.trader_address
                        && AGGREGATOR_ROUTER_ADDRS.has(String(tick.trader_address).toLowerCase())) {
                        state._walletRoutedBuyBnb.set(walletAddr,
                            (state._walletRoutedBuyBnb.get(walletAddr) || 0) + bnbAmount);
                    }
                }
            }
        }

        // ── K 组：双边地址/累计量（对敲重叠族原料，全史 Sets/Maps；wallet 口径——
        //    对倒是同一 EOA 自买自卖，trader 口径下经路由的对倒反成「GMGN 买 GMGN 卖」假重叠）──
        if (walletAddr) {
            const addr = walletAddr;
            if (isBuy) {
                state._buyerAddresses.add(addr);
                state._buyerVolume.set(addr, (state._buyerVolume.get(addr) || 0) + bnbAmount);
            } else {
                state._sellerAddresses.add(addr);
                state._sellerVolume.set(addr, (state._sellerVolume.get(addr) || 0) + bnbAmount);
            }
        }

        // ── smartBot 补跑（defer 专属）：价格段 deferWallet 跳过的名单累计在此用真 sender 补。
        //    priceReliable 重算不碰 _acceptPrice（副作用窗）——按价格段已定值的 price_outlier
        //    flag（collector 回写行透传）等价还原：priceBnb>0 && !outlier && bnb≥minPriceUpdateBnb ──
        if (vars.smartBotEligible === true && isBuy
            && _smartBotWallets && walletAddr && _smartBotWallets.has(walletAddr)) {
            state._smartBotBuyBnb.set(walletAddr,
                (state._smartBotBuyBnb.get(walletAddr) || 0) + bnbAmount);
        }

        // ── holderTrend 原料（2026-10-14 slot 化改造）：blockNumber 桶持有者序列——
        //    与价格接受链解耦（离群/零价 tick 照样推进持有者桶）；blockNumber 缺失不推进
        //    （collector null 丢行/回测透传恒非空，不造兜底）。非 defer（正序）走覆盖快照
        //    （链序即喂序）；defer 乱序回推走事件缓冲+读取时重放（覆盖写=未来 holderCount
        //    前视、delta 前缀和的跨 0 事件集也随回放序漂移——重放是唯一序无关解）──
        if (blockNumber !== null) {
            if (vars.deferred === true) {
                this._recordHolderEvent(state, blockNumber, tokenAmount > 0 ? walletAddr : null, isBuy, tokenAmount);
            } else {
                this._pushHolderSeriesPoint(state, blockNumber);
            }
        }

        // ── act* 8 键原料（2026-10-15 交易活跃度滑窗，取代已删的 cycle 分桶路由）：
        //    到达序 push + 首见 min 更新 + 摊销裁剪。照计语义（无 priceReliable/chainLate
        //    过滤，与 tradeCount/_recentTicks 同口径——活跃度看的是「有人动了」）；
        //    wallet null 行照计交易量、不进人数集。本方法每 tick 恰跑一次（直推或 defer
        //    回推），事件不重不漏 ──
        state._activityEvents.push({ ts: tick.timestamp, w: walletAddr, buy: isBuy, bnb: bnbAmount });
        if (walletAddr) {
            const _fs = state._walletFirstSeenTs.get(walletAddr);
            if (_fs === undefined || tick.timestamp < _fs) {
                state._walletFirstSeenTs.set(walletAddr, tick.timestamp);
            }
        }
        this._pruneActivityEvents(state, tick.timestamp);

        // ── earlyTrades* wallet 层原料（2026-10-17 买腿重构 C84，同 trader 层窗/冻结）：
        //    perWallet 双向行数（null wallet 行只进分子——legacy basicStats 同构）；
        //    top1=协议地址双地址层剔除（wallet||trader 任一命中即剔，legacy 同源
        //    PROTOCOL_ADDRS）后纯买入最大单钱包；uniform=全钱包（无协议剔除，legacy
        //    同构）累计买入 toFixed(2) 分簇增量维护——窗内 cum 只增不减 → 桶迁移=旧桶
        //    减新桶加，与 legacy 读取时全量分桶在「买单累计」语义下收敛同值。defer 乱序
        //    晚到的窗内行在冻结后到达=丢弃（边缘：resolver 回查延迟 > 窗尾距离，台账
        //    C84 记录）。防御帽 _EARLY_MAX_WALLETS 只停新钱包入册 ──
        this._earlyWindowAdvance(state, tick.timestamp);
        // launch 窗推进与 early 并列（首买 map 写点/分母累计均在后——触发出窗行不入窗）
        this._launchWindowAdvance(state, tick.timestamp);
        if (!state._earlyWindowClosed && walletAddr) {
            if (state._earlyWallets.size < _EARLY_MAX_WALLETS || state._earlyWallets.has(walletAddr)) {
                state._earlyWallets.add(walletAddr);
                state._earlyWalletTrades.set(walletAddr,
                    (state._earlyWalletTrades.get(walletAddr) || 0) + 1);
                if (isBuy) {
                    const prevCum = state._earlyWalletBuyBnb.get(walletAddr) || 0;
                    const newCum = prevCum + bnbAmount;
                    state._earlyWalletBuyBnb.set(walletAddr, newCum);
                    // top1（协议剔除增量 max）
                    const _wl = String(walletAddr).toLowerCase();
                    if (!(PROTOCOL_ADDRS.has(_wl)
                            || PROTOCOL_ADDRS.has(String(tick.trader_address || '').toLowerCase()))
                        && newCum > state._earlyTop1WalletBuyBnb) {
                        state._earlyTop1WalletBuyBnb = newCum;
                    }
                    // uniform（全钱包；尘埃门跨域计数 + 桶迁移）
                    const dust = this._fp.earlyUniformDustBnb;
                    if (prevCum < dust && newCum >= dust) state._earlyUniformDustWallets++;
                    if (prevCum >= dust) {
                        const k = prevCum.toFixed(2);
                        const c = (state._earlyUniformBuckets.get(k) || 1) - 1;
                        if (c <= 0) state._earlyUniformBuckets.delete(k);
                        else state._earlyUniformBuckets.set(k, c);
                    }
                    if (newCum >= dust) {
                        const k = newCum.toFixed(2);
                        state._earlyUniformBuckets.set(k, (state._earlyUniformBuckets.get(k) || 0) + 1);
                    }
                }
            }
        }

        // ── bundle* 6 键原料（2026-10-16 BITCAT 案：5 bundler 同 block 首买 52.5% 窗内
        //    买盘推价，引擎 fire 峰顶买入后同 block 清仓 -35.8%；gmgnBundlerWalletRatio
        //    个数口径 27.8 未拦）：流通 = Σ买−Σ卖 双腿进出（加减交换律 → defer 乱序收敛）；
        //    block 买量含非首买行；首买事件仅 wallet 非空行入环（null wallet 无法按钱包
        //    聚簇，其买盘照计 sharePct 分母）。首买判定 = 全史 min 替换（不是 Set 到达序
        //    判重——乱序回推下晚到的更早首买要顶掉先记的伪首买，读点再按钱包去重保最早）──
        state._circTokens += isBuy ? tokenAmount : -tokenAmount;
        if (isBuy) {
            if (blockNumber !== null) {
                const _bb = state._blockBuyAgg.get(blockNumber);
                if (_bb) {
                    _bb.b += tokenAmount;
                    if (walletAddr) _bb.wallets.add(walletAddr);
                } else {
                    state._blockBuyAgg.set(blockNumber, {
                        t: tick.timestamp, b: tokenAmount,
                        wallets: new Set(walletAddr ? [walletAddr] : []),
                    });
                }
                // 全史最大单 block 买量（2026-10-20 乌龟案由滚动 10s 窗改为全史）：块聚合
                // 按到达序只增，任一时刻的 _bb.b 都是该块已见累计 → 单调 max 更新即可，
                // 不随窗口滑出遗忘（乌龟 0xb2782a4a…fe7777 同块 4 钱包 0.59BNB/7.70e7 token
                // 在滚动版 +18s 后归零，全史版保留）。
                // ★分子口径修正（2026-10-20 用户二次裁定，가나디 0xa270…7777 120.5% 案）：
                // 因子分子 = 该块**买家钱包集合的当前净持仓**，不是块的毛买入量——毛买入
                // 单调不减，而卖出会把流通分母压缩，导致「买 127.5M 全卖光」的票仍显
                // 120.5%（分子 127.5M > fire 时净流通 105.8M）。改为当前持仓后：该块买家
                // 清仓 → 分子归 0 → 因子归 0（卖掉的筹码不再算控盘）。_maxBuyBlockWallets
                // 与 _blockBuyAgg 里的 Set 同一引用，块内后续买家自动并入；块继续增长时
                // 单调 max 判定不变（B 超过 A → 集合切到 B）。
                const _bbCur = state._blockBuyAgg.get(blockNumber);
                if (_bbCur.b > state._maxBlockBuyTokens) {
                    state._maxBlockBuyTokens = _bbCur.b;
                    state._maxBlockBuyBlk = blockNumber;
                    state._maxBuyBlockWallets = _bbCur.wallets;
                }
            }
            if (walletAddr) {
                const _pb = state._walletFirstBuyTs.get(walletAddr);
                if (_pb === undefined || tick.timestamp < _pb) {
                    state._walletFirstBuyTs.set(walletAddr, tick.timestamp);
                    state._bundleEvents.push({
                        ts: tick.timestamp,
                        blk: blockNumber,
                        li: tick.log_index != null ? Number(tick.log_index) : null,
                        w: walletAddr,
                        bnb: bnbAmount,
                        trader: tick.trader_address || null,
                    });
                    // launch 首买（出生窗内；挂本 min 替换判定点=仅首买行入 map，更早
                    // 首买晚到覆盖 → defer 乱序序无关收敛；_EARLY_MAX_WALLETS 帽同款。
                    // 窗推进已在上文 _earlyWindowAdvance 旁先行——触发出窗行不入 map）
                    if (!state._launchWindowClosed
                        && (state._launchFirstBuys.size < _EARLY_MAX_WALLETS
                            || state._launchFirstBuys.has(walletAddr))) {
                        state._launchFirstBuys.set(walletAddr, {
                            ts: tick.timestamp,
                            blk: blockNumber,
                            li: tick.log_index != null ? Number(tick.log_index) : null,
                            w: walletAddr,
                            bnb: bnbAmount,
                            trader: tick.trader_address || null,
                        });
                    }
                }
            }
        }

        // ── launch* 4 键分母（2026-10-17 Agentum 案方向 C：出生锚定捆绑簇）：出生窗内
        //    总买入 BNB（null wallet 行照计——本方法每 tick 恰跑一次，与 _activityEvents
        //    同到达面；对齐现行 bundleClusterSharePct 分母语义）。窗推进在 early advance
        //    旁已调（early 同构：触发冻结的出窗行不进窗=分子分母对称）──
        if (!state._launchWindowClosed && isBuy) state._launchBuyBnb += bnbAmount;
        this._pruneBundleEvents(state, tick.timestamp);
    }

    /**
     * 两阶段喂食第二段（2026-10-14 鸡蛋案）：collector sender 回查完成后补喂 wallet 聚合段。
     * 价格段已由 processTick({deferWallet:true}) 即时喂过（价格/流量/滑窗/市场截面），
     * 此处只补 wallet 段 + smartBot（price_accepted 透传重算）+ holderTrend 桶，再发一次
     * factorsUpdated（引擎买腿 debounce 天然合并双发，价格版先到先评）。
     * @param {Object} tick - 同 processTick 形状，另带 price_accepted（价格段 faResult 透传，
     *                          smartBot 补跑资格=priceReliable 等价重算的原料；缺省不补跑 smartBot）
     * @returns {Object|null} 补喂后的因子快照
     */
    applyWalletTick(tick, opts = {}) {
        const tokenAddress = tick.token_address;
        if (!tokenAddress || !tick.timestamp) return null;
        // fail-loud：wallet 段先于价格段=调用序错乱（两阶段契约被破坏），绝不静默建裸 state
        // （裸 state 无价格史 → currentPrice null → 消费侧全线失真）
        const state = this._states.get(tokenAddress);
        if (!state) {
            throw new Error(`[FA] applyWalletTick: token ${tokenAddress} 无 state——价格段必须先行（processTick deferWallet）`);
        }
        this._stats.walletDeferredApplied = (this._stats.walletDeferredApplied || 0) + 1;

        const isBuy = tick.trade_type === 'buy';
        const bnbAmount = tick.bnb_amount || 0;
        const tokenAmount = tick.token_amount || 0;
        const blockNumber = tick.block_number != null ? Number(tick.block_number) : null;
        const priceBnb = tick.price_bnb || 0;
        // smartBot 补跑资格 = 价格段 priceReliable 的等价重算。priceReliable = priceAccepted
        // && bnb≥minPriceUpdateBnb（priceAccepted 已含 !chainLate && !outlier && priceBnb>0）——
        // 价格段 faResult.priceAccepted 经 collector 透传，flag 缺省不跑（保守，观察因子）
        const smartBotEligible = tick.price_accepted === true
            && bnbAmount >= this._fp.minPriceUpdateBnb;

        this._applyWalletAggregation(state, tick,
            { isBuy, bnbAmount, tokenAmount, blockNumber, smartBotEligible, deferred: true });

        let factors = null;
        if (opts.emitFactors !== false) {
            factors = this._buildFactorMap(state, tick.timestamp);
            if (factors) {
                this._stats.factorsEmitted++;
                this.emit('factorsUpdated', {
                    tokenAddress,
                    factors,
                    tick: {
                        token_address: tokenAddress,
                        trade_type: tick.trade_type,
                        price_bnb: priceBnb,
                        price_usd: tick.price_usd || null,
                        block_number: blockNumber,
                        timestamp: tick.timestamp,
                    },
                    tokenState: state,
                });
            }
        }
        return factors;
    }

    /**
     * 构建某 token 当前因子快照（不推进状态；引擎 30s 时序快照/卖腿评估用）
     */
    buildFactorMap(tokenAddress, now = Date.now()) {
        const state = this._states.get(tokenAddress);
        if (!state) return null;
        return this._buildFactorMap(state, now);
    }

    /**
     * 注入 buy condition age 区间粗筛（pumpfun 回迁；引擎侧注入——BacktestEngine
     * 2026-10-12 默认开；实时引擎批次 6（2026-10-15）平移同默认开，
     * fourmemeWs.faPreFilter===false / backtest.faPreFilter===false 显式关闭）。
     * 多买策略并行：传区间数组（每策略一个，从各自 buy condition AST 提取），
     * token 落在【任一】区间内即计算（并集）；数组元素字段缺省填 0/Infinity；
     * 传 null/undefined/空数组清除（不过滤）。
     *
     * ⚠语义边界：跳过 = buildFactorMap 返回 null → 引擎侧超龄未持仓 token 的
     * TPA checkAndTrigger 一并跳过（仅观察数据损失——token 已
     * 出买窗永不再买，notpa 消融实测 TPA 机制扰动 −0.80≈0）；买卖零影响由
     * AND 链出 age 区间必 false 保证；双跑对拍臂 pf0（69b43310）验证中
     * @param {Array<{minAgeMinutes?:number, maxAgeMinutes?:number}>|null} ranges
     */
    setPreFilter(ranges) {
        if (!ranges || (Array.isArray(ranges) && ranges.length === 0)) {
            this._preFilter = null;
            return;
        }
        this._preFilter = (Array.isArray(ranges) ? ranges : [ranges]).map(r => ({
            // 无下界子句（如 tokenAgeSec < 90 单上界）缺省 -Infinity 而非 0：age 锚是
            // experiment_tokens.created_at（发现墙钟，晚于链上首 tick）→ 负 age tick 真实
            // 普遍存在且 tokenAgeSec<90 对负值为真——填 0 会误杀出生头几秒的 fire 评估
            // （2026-10-12 perf 臂 17da408e vs v0 5517e3db 信号 2s 漂移事故：SJ 0x0474…7777
            // 锚+1.57s，li225→li719 首真漂移，双版本对拍归因）。-Infinity 时判定
            // age < r.minAgeMinutes 恒 false = 零跳过，语义精确等价「无下界」
            minAgeMinutes: r.minAgeMinutes ?? -Infinity,
            maxAgeMinutes: r.maxAgeMinutes ?? Infinity,
        }));
    }

    /** preFilter 跳过计数（回测收尾探针） */
    getPreFilterSkipped() {
        return this._preFilterSkipped;
    }

    /**
     * preFilter 出窗纯判定（P18 tick 路径 build 条件化配套，2026-10-13 回测性能案）：
     * 逐字复刻 _buildFactorMap 内 preFilter 判定（age 算式 + inAnyRange 同形），skip 时
     * 与 build-null 路径同点累计 _preFilterSkipped（探针口径不变）。引擎侧
     * backtest.tickBuildSkip 开启时，未持仓票先走本谓词——出窗票免掉整次 build 调用
     * （等价性：谓词 true ⇔ buildFactorMap 返回 null，单测对拍锁定）。
     * state 缺失 / preFilter 未注入 / 持仓票 → false（交回 buildFactorMap 的
     * state-null / 内部判定现状路径）。live 引擎不调用（批次 6 平移后 live 出窗票
     * 经 _buildFactorMap 返回 null 不 emit——同族副作用序列，无需本谓词）。
     */
    shouldSkipTickBuild(tokenAddress, now) {
        if (!this._preFilter) return false;
        const state = this._states.get(tokenAddress);
        if (!state || state._positions.size > 0) return false;
        const age = state.createdAtMs ? (now - state.createdAtMs) / 60000 : 0;
        const inAnyRange = this._preFilter.some(r => !(age < r.minAgeMinutes || age > r.maxAgeMinutes));
        if (!inAnyRange) {
            this._preFilterSkipped++;
            return true;
        }
        return false;
    }

    // ═══════════════ 持仓状态（per-position）═══════════════

    /**
     * 买信号 fire 时刻标记（引擎 _runBuyEvaluation fire 价捕获后调用，2026-10-15 双口径
     * 裁定）：开启 fire→成交窗的峰值追踪——preBuy/GMGN 检查窗（live 实测 10-17s）内的
     * 冲高由双轨推进点记账，买入成功 setBuyState 消费回填（信号口径峰值从 fire 起算，
     * 0xc7fe…7777 案：preBuy 窗 +23.6% 冲高漏计致 P11 回撤臂永不具资格）。
     * 覆写式单槽——同 token 再次 fire 自然重置（上次失败窗的残峰不跨 fire）；引擎
     * finally clearBuyFire 兜底清理。peakAny 轨以 fire 价初始化（fire 价=已接受价链
     * 产物）；peakRel 轨 0 哨兵——严格只吃 priceReliable tick，不注入未经尘门的 fire 价。
     */
    markBuyFire(tokenAddress, firePriceBnb) {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        state._pendingBuyFire = {
            peakAnyBnb: Math.max(firePriceBnb || 0, state.currentPriceBnb || 0),
            peakAnyAt: null,
            peakRelBnb: 0,
        };
    }

    /** 清除 pending fire 峰（买路径失败/异常兜底；泄漏本身无害——只被 setBuyState 消费） */
    clearBuyFire(tokenAddress) {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        state._pendingBuyFire = null;
    }

    /**
     * 引擎买入成功后登记持仓（买入价/时间锚点，takeProfit/stopLoss 因子原料）。
     * @param {string} tokenAddress
     * @param {{buyPriceBnb: number, buyPriceUsd: number|null, buyTime: number,
     *          buySignalAt?: number, buyExecutedPriceBnb?: number|null}} buyState
     *   - buySignalAt：信号（fire）时刻 ms——holdDuration 因子起算锚，缺省回落 buyTime
     *     （旧调用形状 bit 一致：手工交易/重启恢复锚点/回测无延迟场景）
     *   - buyExecutedPriceBnb：执行口径 BNB 价（live=余额差法成交价；虚拟/回测执行=信号
     *     价无独立真相 → null）
     * @param {string} [positionKey] - 多仓键（默认 'default'）；最新仓决定顶层 buyPrice 族因子
     */
    setBuyState(tokenAddress, buyState, positionKey = 'default') {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        // pending fire 峰消费：highest（任意接受价轨）吃 peakAny、peakProfitPct（可靠价轨）
        // 吃 peakRel；无标记（回测串行/手工/恢复锚点/旧调用形状）三项逐位退化为旧行为
        // （回测 parity 红线：无 mark 的 setBuyState 与旧版 bit 一致）
        const pend = state._pendingBuyFire || null;
        const anchorBnb = buyState.buyPriceBnb || 0;
        const pos = {
            buyPriceBnb: anchorBnb,
            buyPriceUsd: buyState.buyPriceUsd || null,
            buyTime: buyState.buyTime || Date.now(),
            buySignalAt: buyState.buySignalAt ?? buyState.buyTime ?? null,
            buyExecutedPriceBnb: buyState.buyExecutedPriceBnb ?? null,
            highestPriceSinceBuyBnb: Math.max(anchorBnb, state.currentPriceBnb || 0, pend ? pend.peakAnyBnb : 0),
            highestPriceSinceBuyAt: (pend && pend.peakAnyAt) || buyState.buyTime || Date.now(),
            highestHoldersSinceBuy: state.holderCount || 0,
            highestHoldersSinceBuyAt: buyState.buyTime || Date.now(),
            // 回迁批 1 H 组：峰值利润 running max（新仓归零；fire 窗内有可靠价冲高则
            // 直接以回填值起步——peakProfitPct 语义=信号口径峰值利润，从 fire 起算）
            peakProfitPct: (pend && pend.peakRelBnb > 0 && anchorBnb > 0)
                ? Math.max(0, (Math.max(anchorBnb, pend.peakRelBnb) / anchorBnb - 1) * 100)
                : 0,
        };
        state._positions.set(positionKey, pos);
        state._lastPositionKey = positionKey;
        state._pendingBuyFire = null; // 消费即清（失败重 fire 由引擎 finally clearBuyFire 兜底）
    }

    /**
     * 清除持仓（卖出完成/止损后）
     */
    clearBuyState(tokenAddress, positionKey = 'default') {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        state._positions.delete(positionKey);
        if (state._lastPositionKey === positionKey) {
            const remaining = [...state._positions.keys()];
            state._lastPositionKey = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        }
    }

    /**
     * 取某持仓的持仓期因子子集（卖腿 per-position 评估）
     */
    getHolderFactors(tokenAddress, positionKey = 'default', now = Date.now()) {
        const state = this._states.get(tokenAddress);
        if (!state) return null;
        const pos = state._positions.get(positionKey);
        if (!pos) return null;
        return this._positionFactors(state, pos, now);
    }

    getOpenPositions(tokenAddress) {
        const state = this._states.get(tokenAddress);
        if (!state) return [];
        return [...state._positions.entries()].map(([key, pos]) => ({
            positionKey: key, ...this._positionFactors(state, pos, Date.now()),
        }));
    }

    markGraduated(tokenAddress) {
        const state = this._states.get(tokenAddress);
        if (state) state.graduated = true;
    }

    // ═══════════════ 清理 ═══════════════

    /**
     * 清理陈旧 token 状态（有持仓/受保护集合内的不清理）。
     * @param {number} maxAgeMs - 最后 tick 距今超过此值的清理
     * @param {Set<string>} heldTokens - 引擎持仓地址集合（额外保护）
     * @param {number} [nowMs] - 判定时钟（P17 回测虚拟时钟 prune，2026-10-13）：回放
     *   传入 tick 虚拟时刻，缺省墙钟——实时 setInterval 调用点不传零变化（同
     *   buildFactorMap(state, asOf) 的禁 Date.now 前视红线家族）
     */
    pruneStaleTokens(maxAgeMs, heldTokens = new Set(), nowMs) {
        const now = nowMs != null ? nowMs : Date.now();
        let pruned = 0;
        for (const [addr, state] of this._states) {
            if (state._positions.size > 0) continue;
            if (heldTokens.has(addr)) continue;
            const lastAlive = Math.max(state.lastTickAt || 0, state.createdAtMs || 0);
            if (now - lastAlive > maxAgeMs) {
                this._states.delete(addr);
                pruned++;
            }
        }

        // 容量上限：超限时按最久未动优先清（持仓保护同上）
        if (this._states.size > this._maxTrackedTokens) {
            const candidates = [];
            for (const [addr, state] of this._states) {
                if (state._positions.size > 0 || heldTokens.has(addr)) continue;
                candidates.push([addr, Math.max(state.lastTickAt || 0, state.createdAtMs || 0)]);
            }
            candidates.sort((a, b) => a[1] - b[1]);
            const excess = this._states.size - this._maxTrackedTokens;
            for (let i = 0; i < Math.min(excess, candidates.length); i++) {
                this._states.delete(candidates[i][0]);
                pruned++;
            }
        }

        this._stats.prunedTokens += pruned;
        return pruned;
    }

    // ═══════════════ 内部实现 ═══════════════

    _createEmptyState(tokenAddress, createdAtMs) {
        return {
            tokenAddress,
            registered: false,
            createdAtMs: createdAtMs || Date.now(),
            totalSupply: 0,
            name: null,
            symbol: null,
            creatorAddress: null,
            platform: null,
            graduated: false,

            firstTickAt: null,
            firstBlockNumber: null, // 首 tick 所在块（bigHolder early 判定基准 s0，write-once）
            lastTickAt: null,
            tickCount: 0,

            // 价格（BNB 原生）
            firstPriceBnb: 0,
            currentPriceBnb: 0,
            highestPriceBnb: 0,
            highestPriceAt: null,
            lastPriceAt: null,
            lastImpliedBnbUsd: 0,
            lastFundsBnb: 0,
            lastOffers: 0,

            _recentPrices: [],   // 最近 5 笔已接受价（离群中位基准）
            _priceSeries: [],    // 10s 桶价格序列（trend* 因子，8 点）
            _holderSeries: [],   // blockNumber 桶持有者序列（holderTrend* 因子，8 块 ≈4s，2026-10-14 slot 化）

            // 计数
            tradeCount: 0,
            buyCount: 0,
            sellCount: 0,
            totalBuyBnb: 0,
            totalSellBnb: 0,
            totalBuyTokens: 0,
            totalSellTokens: 0,
            uniqueTraders: new Set(),
            _walletNetTokens: new Map(), // wallet(sender||trader) → 净持仓（holders/holderTrend/P 组集中度原料；GMGN 合并修正）
            _walletMaxNetTokens: new Map(), // wallet → 建仓峰值净持仓（running max 单调不减；TPA retention 基准，二期 2026-10-10 键域随 TPA 整链切 sender）
            _walletRoutedBuyBnb: new Map(), // wallet → 本盘经聚合路由（GMGN 等）买入 BNB（TPA GMGN 用户判定原料，2026-10-11 用户裁定；写入判据=trader 层 AGGREGATOR_ROUTER_ADDRS）
            _smartBotBuyBnb: new Map(), // wallet → 名单内累计可靠买额 BNB（回迁批 3.3；只累不减——参与留痕）
            holderCount: 0,

            _recentTicks: [],    // 滑窗速率原料 {ts, isBuy, bnb, priceBnb, priceReliable, blockNumber}
            _activityEvents: [], // act* 8 键原料 {ts, w, buy, bnb}（到达序 push，读点按 ts 过滤容忍
                                 // defer 乱序回推；摊销裁剪 _pruneActivityEvents，2026-10-15）
            _walletFirstSeenTs: new Map(), // wallet → 首次参与时刻（min 语义保链上真相；actNewTraders 判据）

            // ── bundle* 6 键原料（2026-10-16 BITCAT 案同 block 首买簇捆绑检测）──
            _bundleEvents: [],       // 首买事件环 {ts, blk, li, w, bnb, trader}（到达序 push + min
                                     //   替换：更早首买晚到时追加推送，读点按钱包去重保最早——defer
                                     //   乱序免疫；摊销裁剪 _pruneBundleEvents）
            _walletFirstBuyTs: new Map(), // wallet → 首买时刻（全史 min，永不裁剪——事件环可裁而此
                                     //   Map 不可：裁后同钱包再买会被误判为新首买混进簇）
            _blockBuyAgg: new Map(), // blk → {t, b, wallets}（单 block 买入 token 累计，含非首买行；
                                     //   b = _maxBlockBuyTokens 的增量来源；t = 该 block 行
                                     //   的 block_time，只服务 _pruneBundleEvents 裁剪；
                                     //   wallets = 该块买家钱包集合（maxBlockBuyCircPct 分子原料）
            _maxBlockBuyTokens: 0, // 全史单 block 买入 token 最大值（**块规模判定基准**——哪个块
                                   //   算「最大块」；不再直接进因子分子，2026-10-20 二次裁定；
                                   //   写点同 _blockBuyAgg，单调 max 永不遗忘）
            _maxBlockBuyBlk: null, // 取到全史 max 的 block 号（审计/观察，不进门）
            _maxBuyBlockWallets: null, // 全史最大单 block 的买家钱包集合（Set，与 _blockBuyAgg
                                   //   同块条目同一引用——块内后续买家自动并入）；maxBlockBuyCircPct
                                   //   分子 = 该集合**当前净持仓**之和（用户裁定：分子分母都随
                                   //   卖出/流通变化，毛买入量不再作分子）。prune 删 _blockBuyAgg
                                   //   条目不影响本引用（Set 仍被 state 持有）
            _circTokens: 0,          // 流通 = Σ买入 − Σ卖出 token（净流出池子筹码；全史增量累计
                                     //   永不裁剪，加减法交换律 → defer 乱序收敛；creator 初始持仓
                                     //   未经买入不计入——口径与 BITCAT 重放对拍一致 63.3%）

            // ── earlyTrades* 8 键原料（2026-10-17 买腿重构 C84：迁自
            //    EarlyParticipantCheckService DB 查询 → FA 出生锚定 firstTickAt 累计窗；
            //    首个出窗 tick _earlyWindowAdvance 冻结六键快照并清本组 Map/Set）──
            _earlyWindowClosed: false, // 出窗冻结标记（冻结后行照计流量不再入窗）
            _earlyFrozen: null,        // 出窗冻结的六键输出（_earlyTradesFactors 直读）
            _earlyTickRows: 0,         // 窗内行数（双向；outlier/price_usd 照计=口径 delta①）
            _earlyTotalBuyBnb: 0,      // 窗内纯买入 BNB（netBuy/top1/router 公共分母）
            _earlyTotalSellBnb: 0,     // 窗内纯卖出 BNB（netBuy 臂）
            _earlyRouterBuyBnb: 0,     // 窗内 trader∈AGGREGATOR_ROUTER_ADDRS 买入 BNB
            _earlyWallets: new Set(),  // 窗内参与钱包（buy or sell；perWallet 分母）
            _earlyWalletTrades: new Map(), // wallet → 窗内行数（观察：单钱包最大笔数）
            _earlyWalletBuyBnb: new Map(), // wallet → 窗内累计买入 BNB（uniform 原料，无协议剔除）
            _earlyTop1WalletBuyBnb: 0, // 协议剔除后的最大单钱包买入（增量 max：窗内 cum 单调不减）
            _earlyUniformBuckets: new Map(), // toFixed(2) 金额桶 → 尘埃门以上钱包数（增量维护）
            _earlyUniformDustWallets: 0,     // 尘埃门（≥earlyUniformDustBnb）以上钱包数（uniform 分母）

            // ── launch* 4 键原料（2026-10-17 Agentum 案方向 C：出生锚定捆绑簇——10s 滑窗
            //    在迟到 fire 下结构性漏创建块簇；同块臂+跨块等额臂，出窗冻结 _launchFrozen）──
            _launchWindowClosed: false, // 出窗冻结标记（冻结后首买行照推 _walletFirstBuyTs 但不入 map）
            _launchFrozen: null,        // 出窗冻结的四键输出（_launchBundleFactors 直读）
            _launchFirstBuys: new Map(), // wallet → 首买行 {ts, blk, li, bnb, trader}（窗内；
                                         //   覆盖式 min 替换保最早=defer 乱序收敛；_EARLY_MAX_WALLETS 帽同款）
            _launchBuyBnb: 0,           // 出生窗内总买入 BNB（sharePct 分母，含非首买/null wallet 行）

            // 持仓（positionKey → pos）
            _positions: new Map(),
            _lastPositionKey: null,
            // pending fire 峰（2026-10-15 双口径裁定，0xc7fe 案）：fire→成交窗内的冲高
            // 追踪，setBuyState 消费回填 highest/peakProfitPct 后即清；null=无进行中 fire
            _pendingBuyFire: null,

            // ── 回迁批 1 状态 ──
            _firstBuyAt: null,        // 首笔买 anchor（首块脉冲窗起算）
            _firstBlockBuyBnb: 0,     // 首块脉冲窗内买入累计

            _buyerAddresses: new Set(),   // K 组：全史买方地址
            _sellerAddresses: new Set(),  // K 组：全史卖方地址
            _buyerVolume: new Map(),      // addr → 累计买入 BNB（bigHolder W 门槛）
            _sellerVolume: new Map(),     // addr → 累计卖出 BNB

            _secCurrent: null,          // 当前墙钟秒收盘（未闭合）
            _secCloses: [],             // 已闭合秒收盘（secRsiMaxBars 环形）
            _bar5mCurrent: null,        // 当前 5m bar 收盘（未闭合；E5 RSI 阶梯臂）
            _bar5mCloses: [],           // 已闭合 5m bar 收盘（bar5mRsiMaxBars 环形）

            _relPriceBnb: 0,            // 最近可靠价（新链专用）
            _relFirstPriceBnb: 0,       // 首个可靠价（涨幅基准 base，OPB 与离线 computeTickMetrics.firstUsablePriceBnb 同口径；不能用 firstPriceBnb——那只过离群门没过尘门）
            _relHighestPriceBnb: 0,     // 可靠价全时峰（与 highestPriceBnb 双轨）
            _relHighestAt: 0,

            // TPA 审批时刻冻结（回迁批 4）：setAsofMs 幂等写入。_asofRelFirst=审批价相对首可靠价
            // 涨幅 %（用 _relPriceBnb/_relFirstPriceBnb 可靠价链冻结——母版 currentPriceUsd/firstPriceUsd
            // 本身是可靠价链产物，此为对齐而非偏离）。未审批恒 null → condition 引用 fail-closed
            _asofMs: null,
            _asofRelFirst: null,

            _curBlock: null,            // 单块跌幅链：当前块
            _curBlockClose: null,
            _curBlockHigh: null,
            _prevBlockClose: null,      // 前块收盘（相邻对结算；断链=null）
            _maxBlockDropPct: null,     // 单块最大跌幅 %（null=从无跌幅证据）

            _lastChainBlock: null,      // 链上序迟到水位（2026-10-14 鸡蛋案）：已见的最大
            _lastChainLogIdx: null,     // (blockNumber, log_index)——早于此的 tick 判 chainLate 不进价格链

            _holderEvents: [],          // holderTrend 事件缓冲（defer 乱序回推路径）：{block,wallet,buy,amt}
            _holderSeriesDirty: false,  // 重放脏标记（buildFactorMap 消费前刷新）

            // ── 分类器轨迹与 running 标量（回迁批 3.1：OPB 专用，不进因子键/时序存储。
            //    口径 = scripts/shared/token-classifier.js computeTickMetrics，两处修改须同步）──
            _clsTicks: [],             // 分类器轨迹 {ts,isBuy,bnbAmount,priceBnb,priceUsd,blockNumber,priceReliable}
                                       // （母版 recentTicks 同构：peak 后动态保留，与速率滑窗 _recentTicks 分离）
            _relHighestPriceUsd: 0,    // BNB 峰 tick 的 USD 价快照（离线 computeTickMetrics 同口径；OPB maxMarketCap = ×totalSupply）
            _afterFirst9sPeakPriceBnb: 0,       // afterFirst9s 区间峰（high_mcap_wash ratio 分子；母版 afterFirst3s 的 BSC 9s 版）
            _runningMinAfterFirst9sBnb: Infinity, // afterFirst9s 区间 running min（ratio 分母原料）
            _beforeFirst9sPeakMinBnb: Infinity,  // 到峰为止锁定的 min（ratio 分母；Infinity=未锁定）
            _afterFirst9sReliableCount: 0,       // afterFirst9s 达标 tick 数（<2 → ratio null）
            _lastBigTickAt: null,      // 最近大额（≥clsBigTickBnb）tick 时间（OPB bigTickIdle 触发）

            dataCollectionRound: 1, // 引擎 30s 时序快照轮次
        };
    }

    /**
     * Q 组：creator 前作 registry 推进（processTick 可靠价路径调用，回迁批 2.5）。
     * 新 token 首个可靠价登记 {firstTs, firstPb, maxPb}（首值 write-once）；老 token 只涨 maxPb。
     * 剪枝摊销：仅在该 creator 登记新 token 时扫一遍，弃 firstTs 龄 >26h 的条目（已滑出 24h 前作窗，
     * 无论死活不再可及）；creator 条目清空即删键。因果性由回放顺序保证：决策 t 时 registry 只含 ts<t 的折叠。
     */
    /**
     * 市场截面：新出生注册（processTick 首 tick 分支调用，write-once）。
     * birth=state.createdAtMs（TokenCreate/回测 discovered_at，与 age 同基准）；
     * 老票（ts−birth > 40m）不入册；已在册（prune 复活重建 state）不重计。
     */
    _marketRegisterBirth(tokenAddress, state, ts) {
        if (!_marketFeedEnabled || !_marketRegime) return;
        const M = _marketRegime;
        if (M.startedAt === null) M.startedAt = ts;
        if (M.registry.has(tokenAddress)) return;                       // prune 复活不重计（S3）
        const birth = state.createdAtMs;
        if (!(birth > 0) || ts - birth > MARKET_NEWBORN_MAX_AGE_MS) return;  // 老票不入册
        M.registry.set(tokenAddress, {
            birth, firstPrice: null, lastPrice: null, lastRelPct: null, peakRelPct: null, lastTs: ts,
        });
        M.fifo.push(tokenAddress);
    }

    /**
     * 市场截面：每 tick 累积（processTick 滑窗后调用，全量口径）：
     * 流向环（全 token Σ买/Σ卖 BNB）+ registry 价格/存活推进 + FIFO 按 birth 龄写时裁剪。
     * 死票保留在册（death 口径含死亡票）；尘 tick 计流量不计价（priceReliable 守卫，S8）。
     */
    _marketOnTick(tokenAddress, ts, isBuy, bnbAmount, priceBnb, priceReliable) {
        if (!_marketFeedEnabled || !_marketRegime) return;
        const M = _marketRegime;
        const mk = Math.floor(ts / 60000);
        const fs = M.ringFlow[mk % MARKET_FLOW_RING_LEN];
        if (fs.k !== mk) { fs.k = mk; fs.b = 0; fs.s = 0; }
        if (isBuy) fs.b += bnbAmount; else fs.s += bnbAmount;
        const rec = M.registry.get(tokenAddress);
        if (rec) {
            rec.lastTs = ts;
            if (priceReliable && priceBnb > 0) {
                if (rec.firstPrice === null) rec.firstPrice = priceBnb;
                rec.lastPrice = priceBnb;
                const rel = (priceBnb / rec.firstPrice - 1) * 100;
                rec.lastRelPct = rel;
                if (rel > rec.peakRelPct) rec.peakRelPct = rel;
            }
        }
        // FIFO 按 birth 龄写时裁剪（环残差由 ring k 检查天然过期）
        while (M.fifo.length) {
            const head = M.fifo[0];
            const hr = M.registry.get(head);
            if (hr && ts - hr.birth <= MARKET_REGISTRY_TTL_MS) break;
            M.registry.delete(head);
            M.fifo.shift();
        }
    }

    /**
     * 市场截面快照（分钟桶 memo：同分钟同值，跨 token 一致性由构造保证）。
     * now=决策时钟（回测传回放 tick ts / live 墙钟——冻结时钟纪律；分钟键回退即重算，回测无前视）。
     * @returns {null|{minuteKey,fedAgeMs,newborn1h,cohortN,rocketRate,youngMeanRetPct,deathRate,flowBuyBnb,flowSellBnb,flowBsRatio}}
     */
    _getMarketSnapshot(now) {
        if (!_marketFeedEnabled || !_marketRegime) return null;
        const M = _marketRegime;
        const mk = Math.floor(now / 60000);
        if (M.snapMinute === mk && M.snap) return M.snap;
        const cohortWin = this._fp.marketCohortWinMs;
        const matureMs = this._fp.marketMatureMs;
        const minCohort = this._fp.marketMinCohort;
        let newborn1h = 0, cohortN = 0, rockets = 0, deathN = 0, retSum = 0, retN = 0;
        for (const rec of M.registry.values()) {
            const age = now - rec.birth;
            if (age <= MARKET_NEWBORN_WIN_MS) newborn1h++;
            if (age >= matureMs && age <= cohortWin) {
                cohortN++;
                if (rec.peakRelPct !== null && rec.peakRelPct >= MARKET_ROCKET_REL_PCT) rockets++;
                if (rec.lastRelPct !== null) { retSum += rec.lastRelPct; retN++; }
                if (now - rec.lastTs >= MARKET_DEATH_IDLE_MS) deathN++;
            }
        }
        // 10m 流向环求和：槽距当前分钟 < 环长即在窗内；≥环长的陈槽被 k 差检查排除（写时同槽复用已清零）
        let fb = 0, fsv = 0;
        for (const s of M.ringFlow) {
            if (s.k > 0 && mk - s.k < MARKET_FLOW_RING_LEN) { fb += s.b; fsv += s.s; }
        }
        const snap = {
            minuteKey: mk,
            fedAgeMs: M.startedAt === null ? 0 : now - M.startedAt,
            newborn1h,
            cohortN,
            rocketRate: cohortN >= minCohort ? rockets / cohortN : null,
            youngMeanRetPct: cohortN >= minCohort && retN > 0 ? retSum / retN : null,
            deathRate: cohortN >= minCohort ? deathN / cohortN : null,
            flowBuyBnb: fb,
            flowSellBnb: fsv,
            flowBsRatio: fsv >= MARKET_FLOW_MIN_SELL_BNB ? fb / fsv : null,
        };
        M.snapMinute = mk;
        M.snap = snap;
        return snap;
    }

    /**
     * 公开快照入口（引擎 60s 落表计时器 / web 观察 / 单测用；未 feed 返回 null）。
     * @param {number} [now] 不传用墙钟
     */
    computeMarketSnapshot(now) {
        return this._getMarketSnapshot(now ?? Date.now());
    }

    /**
     * 局部离群价剔除：偏离最近 5 笔已接受价中位 >1000× 判毒。
     * 前几笔（<3 个基准）直接接受。
     */
    _acceptPrice(state, priceBnb) {
        const recent = state._recentPrices;
        if (recent.length >= 3) {
            const sorted = [...recent].sort((a, b) => a - b);
            const mid = sorted[Math.floor(sorted.length / 2)];
            if (mid > 0 && (priceBnb > mid * OUTLIER_RATIO || priceBnb < mid / OUTLIER_RATIO)) {
                return false;
            }
        }
        recent.push(priceBnb);
        if (recent.length > 5) recent.shift();
        return true;
    }

    /** 10s 时间桶推进价格序列（trend* 因子；同桶后写覆盖，新桶追加，8 点封顶） */
    _pushPriceSeriesPoint(state, ts) {
        const bucket = Math.floor(ts / 1000 / SERIES_BUCKET_SEC);
        const lastP = state._priceSeries[state._priceSeries.length - 1];
        if (lastP && lastP.bucket === bucket) {
            lastP.price = state.currentPriceBnb;
        } else {
            state._priceSeries.push({ bucket, price: state.currentPriceBnb });
            if (state._priceSeries.length > SERIES_MAX_POINTS) state._priceSeries.shift();
        }
    }

    /**
     * blockNumber 桶推进持有者序列（holderTrend* 因子；2026-10-14 slot 化改造）：
     * 同块后写覆盖（块内末笔 tick 时刻的 holderCount 快照），新块追加，8 块封顶（≈4s 窗，
     * BSC 出块 0.5s 中位）。与价格臂的 10s 时间桶机制互不相关——本方法只消费 holderCount，
     * 调用方负责 blockNumber 非空守卫（缺失不推进，不造兜底）。
     * ⚠ 仅非 defer（正序喂）路径调用：回测=链上真序、live 无 resolver=WSS 推送序，
     * blockNumber 单调 → 覆盖快照即链序快照。defer 两阶段的 wallet 段按回查完成序
     * 乱序回推——覆盖写会把未来 holderCount 写进旧块桶（前视），由 _recordHolderEvent
     * 事件缓冲 + _rebuildHolderSeries 读取时重放接管（见 _applyWalletAggregation）。
     */
    _pushHolderSeriesPoint(state, blockNumber) {
        const lastH = state._holderSeries[state._holderSeries.length - 1];
        if (lastH && lastH.block === blockNumber) {
            lastH.count = state.holderCount;
        } else {
            state._holderSeries.push({ block: blockNumber, count: state.holderCount });
            if (state._holderSeries.length > HOLDER_SERIES_MAX_POINTS) state._holderSeries.shift();
        }
    }

    /**
     * holderTrend 事件入环形缓冲（defer 两阶段路径，2026-10-14 鸡蛋案）：wallet 段
     * 乱序回推下「覆盖快照」会前视、delta 前缀和的跨 0 事件集也随回放序变化（数学上
     * per-block 净 delta 不收敛）——唯一序无关解=存原始事件、读取时按 block 重放。
     * 事件含无 wallet 变动的占位（wallet=null：该块有 tick 出现过，桶集口径与非 defer
     * 一致）。缓冲按块裁剪（保最近 HOLDER_SERIES_MAX_POINTS+2 块），重放在
     * _rebuildHolderSeries（脏标记驱动，buildFactorMap 消费前刷新）。
     */
    _recordHolderEvent(state, blockNumber, walletAddr, isBuy, tokenAmount) {
        const events = state._holderEvents;
        events.push({ block: blockNumber, wallet: walletAddr, buy: isBuy, amt: tokenAmount });
        // 裁剪：按 block 降序保窗（+2 块余量），一次前缀扫描 O(n) 摊销
        if (events.length > 64) {
            const blocksSeen = new Set();
            let cutAt = events.length;
            for (let i = events.length - 1; i >= 0; i--) {
                blocksSeen.add(events[i].block);
                if (blocksSeen.size > HOLDER_SERIES_MAX_POINTS + 2) { cutAt = i + 1; break; }
            }
            if (cutAt > 0) events.splice(0, cutAt);
        }
        state._holderSeriesDirty = true;
    }

    /**
     * 重放 holderTrend 序列（脏标记驱动）：窗前态 = P2a 收敛的终态 holderCount +
     * _walletNetTokens 逆向撤销窗内事件（只动 touched 钱包，O(窗内事件)），再按 block
     * 正放得每块末快照——与回推序完全无关。块内事件顺序无关（块末快照=块内事件
     * map 终态），排序键 block 单字段即可。
     */
    _rebuildHolderSeries(state) {
        const events = state._holderEvents;
        if (events.length === 0) { state._holderSeriesDirty = false; return; }
        // 稳定排序按 block（同 block 保到达序——块内顺序不影响块末快照）
        events.sort((a, b) => a.block - b.block);
        // 窗=最近 HOLDER_SERIES_MAX_POINTS 个不同 block
        const blocksDesc = [];
        for (let i = events.length - 1; i >= 0; i--) {
            if (blocksDesc.length === 0 || events[i].block !== blocksDesc[blocksDesc.length - 1]) {
                blocksDesc.push(events[i].block);
                if (blocksDesc.length >= HOLDER_SERIES_MAX_POINTS) break;
            }
        }
        const windowMinBlock = blocksDesc[blocksDesc.length - 1];
        // 窗内事件 + touched 钱包
        const winEvents = events.filter(e => e.block >= windowMinBlock && e.wallet);
        const touched = new Map(); // wallet → 窗内事件累计 token（正向）
        for (const e of winEvents) {
            touched.set(e.wallet, (touched.get(e.wallet) || 0) + (e.buy ? e.amt : -e.amt));
        }
        // 窗前态：终态 map 逆向撤销 touched 钱包的窗内事件；起点 count 同步修正
        let startCount = state.holderCount;
        const startNet = new Map();
        for (const [w, deltaWin] of touched) {
            const finalNet = state._walletNetTokens.get(w) || 0;
            const before = finalNet - deltaWin;
            startNet.set(w, before);
            if (finalNet > 0) startCount--;
            if (before > 0) startCount++;
        }
        // 正放：按 block 分组推进
        const series = [];
        const netNow = new Map(startNet);
        let cnt = startCount;
        let curBlock = null;
        const flushBlock = () => {
            if (curBlock !== null) series.push({ block: curBlock, count: cnt });
        };
        for (const e of events) {
            if (e.block < windowMinBlock) continue;
            if (e.block !== curBlock) { flushBlock(); curBlock = e.block; }
            if (!e.wallet) continue;
            const prev = netNow.get(e.wallet) || 0;
            const cur = prev + (e.buy ? e.amt : -e.amt);
            netNow.set(e.wallet, cur);
            if (prev <= 0 && cur > 0) cnt++;
            else if (prev > 0 && cur <= 0) cnt--;
        }
        flushBlock();
        if (series.length > HOLDER_SERIES_MAX_POINTS) series.splice(0, series.length - HOLDER_SERIES_MAX_POINTS);
        state._holderSeries = series;
        state._holderSeriesDirty = false;
    }

    _pruneRecentTicks(state, now) {
        const ticks = state._recentTicks;
        if (ticks.length === 0) return;
        // 摊销：只在尾部越过窗口且长度超阈值时批量裁剪
        if (ticks.length > 64 && now - ticks[0].ts > RATE_WINDOW_MS) {
            while (ticks.length > 0 && now - ticks[0].ts > RATE_WINDOW_MS) ticks.shift();
        }
    }

    /**
     * act* 原料裁剪（2026-10-15 交易活跃度滑窗）：摊销——长度>64 且头部已滑出
     * 2×activityWinMs 才批量 splice。2× 余量：defer 乱序回推行晚到数秒仍落余量带
     * 不误删；到达序≠严格 ts 序（乱序行可停在中间）→ 从头连续判 ts，遇首个未出局
     * 即停（中部老行保守滞留，读点 ts 过滤天然不可见，无损）。
     */
    _pruneActivityEvents(state, now) {
        const evts = state._activityEvents;
        if (evts.length <= 64) return;
        const cutoff = now - 2 * this._fp.activityWinMs;
        let i = 0;
        while (i < evts.length && evts[i].ts < cutoff) i++;
        if (i > 0) evts.splice(0, i);
    }

    /**
     * bundle* 原料裁剪（2026-10-16，_pruneActivityEvents 同款摊销）：
     * - _bundleEvents：长度>64 且头部 ts 已滑出 2×bundleWinMs 才批量 splice（从头连续判，
     *   遇首个未出局即停——min 替换追加的更早事件可停在尾部，滞留无害：读点 ts 过滤
     *   不可见）。_walletFirstBuyTs 全史 Map 不裁（裁=同钱包再买误判新首买混进簇）。
     * - _blockBuyAgg：size>64 时删 t 已滑出 2× 窗的 block 条目（Map 迭代中删除安全；
     *   _circTokens 是全史标量，不在此列）。
     */
    _pruneBundleEvents(state, now) {
        const evts = state._bundleEvents;
        if (evts.length > 64) {
            const cutoff = now - 2 * this._fp.bundleWinMs;
            let i = 0;
            while (i < evts.length && evts[i].ts < cutoff) i++;
            if (i > 0) evts.splice(0, i);
        }
        if (state._blockBuyAgg.size > 64) {
            const cutoff = now - 2 * this._fp.bundleWinMs;
            for (const [blk, agg] of state._blockBuyAgg) {
                if (agg.t < cutoff) state._blockBuyAgg.delete(blk);
            }
        }
    }

    /**
     * _recentTicks 单趟扫描（P2c，2026-10-12 回测性能案）：各读取方原先自行遍历
     * （5min 窗过滤 / crashSpeed 窗高点 / risePct5m 谷 /
     * _computePriceTrendFactors reliable 提取）——百万 tick 回放下每 tick 多趟是固定
     * 成本大头。本方法单趟产出共享中间结构，消费方判定逻辑逐字搬入（对拍等价红线）：
     *
     * - reliable：全数组（非 5min 窗）priceReliable && priceBnb>0 的 {t,p}，原序收集
     *   ——trend 的 widened 全历史分支要用全量 reliable，不可预切窗；sort 留在消费方
     *   （V8 稳定排序，输入序不变 → 与旧「提取后 sort」bit-identical）
     * - csWh/csWhT：crashSpeed 窗（crashSpeedWindowMs，窄于 5min 窗）高点与首达时刻
     * - rise 谷三件：rsCut = max(now-5min, buyTs)；buyTs<=0 → Infinity 哨兵（旧代码
     *   `if (_buyTs > 0)` 整块跳过，等价于不累积任何谷样本）
     * - 窗口全部读取时 now 相关（防前视红线：now 由 buildFactorMap(state, asOf) 传入；
     *   禁 Date.now / 禁移到 processTick 写入侧）
     * - winTicks 已删（2026-10-15 批次 5c）：cycle 分桶 2026-10-15 删除后 FA 内零
     *   消费方，子数组物化=纯死产出；后续若需 5min 窗内序列请自遍 _recentTicks
     *   （同式 now - t.ts <= RATE_WINDOW_MS 保原序），勿复活本产出
     */
    _scanRecentTicks(state, now, buyTs) {
        const rateCut = now - RATE_WINDOW_MS;
        const csCut = now - this._fp.crashSpeedWindowMs;
        const rsCut = buyTs > 0 ? Math.max(rateCut, buyTs) : Infinity;
        const ticks = state._recentTicks;
        const reliable = [];
        let csWh = 0, csWhT = 0;
        let riseTrough = Infinity, riseTroughTs = 0, riseRn = 0;
        for (const tk of ticks) {
            // trend reliable 提取（原 _computePriceTrendFactors 内部循环逐字）
            if (tk.priceReliable && Number(tk.priceBnb) > 0) {
                reliable.push({ t: Number(tk.ts), p: Number(tk.priceBnb) });
            }
            // crashSpeed 窗高点（原：!priceReliable || ts < cut → continue；`>` 严格大于=首达优先）
            if (tk.priceReliable && tk.ts >= csCut) {
                const _p = Number(tk.priceBnb);
                if (_p > csWh) { csWh = _p; csWhT = tk.ts; }
            }
            // rise 谷（原：ts < rsCut → continue；!priceReliable || !(p>0) → continue；
            // `<=` = 最近触及；_rn 计数在谷判定前）
            if (tk.ts >= rsCut && tk.priceReliable && Number(tk.priceBnb) > 0) {
                riseRn++;
                if (Number(tk.priceBnb) <= riseTrough) { riseTrough = Number(tk.priceBnb); riseTroughTs = tk.ts; }
            }
        }
        // trend 升序归一（b24879e0 乱序崩案修复的排序假设）：与旧实现「原序收集 →
        // sort」同式稳定排序，逐元素恒等；共享结构恒以时间升序终态存在（消费方
        // 直接用，无「首个消费方原地 sort 污染」的隐性状态依赖）
        reliable.sort((a, b) => a.t - b.t);
        return { reliable, csWh, csWhT, riseTrough, riseTroughTs, riseRn };
    }

    /**
     * act* 8 键派生（2026-10-15 交易活跃度滑窗，取代同日删除的 cycle 分桶路由）：
     * activityWinMs（默认 10s，factorParams 可覆盖）窗内单趟全扫。
     *   actBuyBnb/actSellBnb/actNetBnb —— 窗内买/卖/净 BNB 量；
     *   actTrades   —— 窗内笔数（含 wallet null 行，照计）；
     *   actTraders/actBuyers/actSellers —— 窗内独立钱包数（sender||trader 口径；
     *     null wallet 行计量不计人）；
     *   actNewTraders —— 窗内钱包中「首次参与时刻也落窗内」者（_walletFirstSeenTs
     *     是全史 min，先于窗参与过的钱包不算新；per-wallet 恰计一次）。
     * 纯函数读取：无 latch/无副作用 → 与 backtest.tickBuildSkip 天然无互斥（写点在
     * _applyWalletAggregation 每 tick 照跑，build 跳过的只是本读点，重建时数据完整）。
     * ★防前视红线：禁 Date.now——now 由 buildFactorMap(state, asOf) 传入。
     * 空/空窗全 0（有证据零值非 null——「窗内无交易」是有效证据）。
     */
    _activityFactors(state, now) {
        const cutoff = now - this._fp.activityWinMs;
        let buyBnb = 0, sellBnb = 0, trades = 0, newTraders = 0;
        const traders = new Set(), buyers = new Set(), sellers = new Set();
        for (const e of state._activityEvents) {
            if (e.ts < cutoff) continue;
            trades++;
            if (e.buy) buyBnb += e.bnb; else sellBnb += e.bnb;
            if (e.w === null) continue;
            // 新钱包 per-wallet 恰计一次（首个窗内事件时判）；firstSeen 缺失（不可达）
            // → undefined >= cutoff 为 false 不计新，保守方向
            if (!traders.has(e.w) && state._walletFirstSeenTs.get(e.w) >= cutoff) newTraders++;
            traders.add(e.w);
            if (e.buy) buyers.add(e.w); else sellers.add(e.w);
        }
        return {
            actBuyBnb: buyBnb,
            actSellBnb: sellBnb,
            actNetBnb: buyBnb - sellBnb,
            actTrades: trades,
            actTraders: traders.size,
            actBuyers: buyers.size,
            actSellers: sellers.size,
            actNewTraders: newTraders,
        };
    }

    /**
     * earlyTrades* 出窗冻结（2026-10-17 买腿重构 C84）：首个 ts 距 firstTickAt 超过
     * earlyTradesWindowMs 的 tick（trader 层与 wallet 层各自调用，幂等——后到调用者见
     * _earlyWindowClosed 直接返回）触发一次冻结：按当前状态算出全键快照存 _earlyFrozen
     * （此后读取恒返回快照），并清 wallet 层 Map/Set 防长尾内存。
     * 冻结语义=「完整首窗终值」而非 legacy uncovered 的 0 值放行——新链路单一买条件
     * 自带 tokenAgeSec < 90 门，出窗票条件恒 false，六族键仅供观测/复盘。
     * defer 边缘：冻结后到达的窗内 wallet 行被丢弃（resolver 回查延迟 > 窗尾残余，
     * 台账 C84 记录）。
     * @param {Object} state
     * @param {number} ts - 本 tick 时间戳（ms）
     */
    _earlyWindowAdvance(state, ts) {
        if (state._earlyWindowClosed || state.firstTickAt === null) return;
        if (ts - state.firstTickAt <= this._fp.earlyTradesWindowMs) return;
        state._earlyFrozen = this._earlyTradesFactors(state);
        state._earlyWindowClosed = true;
        state._earlyWallets = new Set();
        state._earlyWalletTrades = new Map();
        state._earlyWalletBuyBnb = new Map();
        state._earlyUniformBuckets = new Map();
    }

    /**
     * earlyTrades* 键派生（2026-10-17 买腿重构 C84；迁自 EarlyParticipantCheckService，
     * 公式与四舍五入位数逐键对齐 legacy）：
     *   earlyTradesPerWallet        窗内行数/独立钱包数 toFixed(2)（对倒高频拦截：
     *                               猪五花 7.6 笔/钱包 vs 散户 1~2）
     *   earlyTradesMaxWalletTrades  单钱包最大行数（观察）
     *   earlyTradesNetBuyRatio      (Σ买−Σ卖)/Σ买×100 toFixed(2)；无买入 → 全卖 -100/全空 0
     *   earlyTradesTop1BuySharePct  协议双地址层剔除后最大单钱包纯买入/Σ买×100 toFixed(2)
     *   earlyTradesTop1BuyBnb / earlyTradesBuyBnb   toFixed(4)
     *   earlyTradesRouterPct        trader∈聚合路由买入/Σ买×100 toFixed(2)
     *   earlyTradesUniformBuyClusterRatio / UniformBuyWallets / ClusterN
     *                               尘埃门以上钱包 toFixed(2) 金额分簇，最大簇/钱包数×100
     *                               toFixed(1)；钱包<3 → clusterN/ratio 0（legacy 同）
     * 纯读取无副作用（与 backtest.tickBuildSkip 无互斥）；已冻结直读 _earlyFrozen 快照。
     * 与 legacy 的口径 delta（delta①：无 outlier/price_usd 过滤；出生锚 firstTickAt 非
     * launchAt）见文件头 C84 注释与台账。
     */
    _earlyTradesFactors(state) {
        if (state._earlyFrozen) return state._earlyFrozen;
        const totalBuy = state._earlyTotalBuyBnb;
        const totalSell = state._earlyTotalSellBnb;
        const wallets = state._earlyWallets.size;
        let maxWalletTrades = 0;
        for (const c of state._earlyWalletTrades.values()) if (c > maxWalletTrades) maxWalletTrades = c;
        // uniform 最大簇：桶增量维护（窗内 cum 只增不减 → 迁桶不减簇），读取时取 max——
        // 与 legacy 读取时全量分桶在「纯买入累计」语义下收敛同值
        let clusterN = 0;
        for (const c of state._earlyUniformBuckets.values()) if (c > clusterN) clusterN = c;
        const dustWallets = state._earlyUniformDustWallets;
        return {
            earlyTradesPerWallet: wallets > 0
                ? parseFloat((state._earlyTickRows / wallets).toFixed(2)) : 0,
            earlyTradesMaxWalletTrades: maxWalletTrades,
            earlyTradesNetBuyRatio: totalBuy > 0
                ? parseFloat(((totalBuy - totalSell) / totalBuy * 100).toFixed(2))
                : (totalSell > 0 ? -100 : 0),
            earlyTradesTop1BuySharePct: totalBuy > 0
                ? parseFloat((state._earlyTop1WalletBuyBnb / totalBuy * 100).toFixed(2)) : 0,
            earlyTradesTop1BuyBnb: parseFloat(state._earlyTop1WalletBuyBnb.toFixed(4)),
            earlyTradesBuyBnb: parseFloat(totalBuy.toFixed(4)),
            earlyTradesRouterPct: totalBuy > 0
                ? parseFloat((state._earlyRouterBuyBnb / totalBuy * 100).toFixed(2)) : 0,
            earlyTradesUniformBuyClusterRatio: dustWallets >= 3
                ? parseFloat((clusterN / dustWallets * 100).toFixed(1)) : 0,
            earlyTradesUniformBuyWallets: dustWallets,
            earlyTradesUniformBuyClusterN: dustWallets >= 3 ? clusterN : 0,
        };
    }

    /**
     * 同 block 首买簇 6 键（2026-10-16 BITCAT 案捆绑检测）：
     *   bundleClusterSize       —— 窗内最大「同 block 首买簇」钱包数（空窗 0 有证据零值）
     *   bundleClusterSharePct   —— 该簇合计 BNB ÷ 窗内总买入 BNB ×100（分母含非首买买盘，
     *                              扫 _activityEvents；BITCAT 真簇 52.5 vs 散户簇 11.9）
     *   bundleClusterAmountRatio —— 簇内 max/min 首买金额比（等额≈1；观察键不进门——
     *                              用户裁定等额非捆绑必要条件；size<2 或 min≤0 → 0）
     *   bundleClusterEvenGap    —— 簇内 log_index 排序后差分等间隔 0/1（观察键；li 缺失 → 0）
     *   bundleClusterSameTrader —— 簇内模态 trader_address 占比 ×100（BITCAT 5 行全
     *                              GMGN 聚合路由=100；tx 级同 calldata 的 tick 层代理）
     *   maxBlockBuyCircPct      —— 全史最大单 block 的**买家钱包当前净持仓合计** ÷ 读取
     *                              时刻累计流通 ×100（流通=_circTokens Σ买−Σ卖；用户裁定
     *                              新增——修正 pre-check 侧 maxBlockBuyRatio 除总供应 1e9
     *                              被稀释的硬伤；分母含该 block 及其后已喂买入，读取时刻
     *                              口径 defer 乱序收敛；流通≤0 → 0）
     *                              **2026-10-20 口径断代（乌龟案用户裁定）**：分子由「10s
     *                              滚动窗内最大」改为「全史最大」（_maxBlockBuyTokens，
     *                              单调不减）。滚动版在大块滑出窗后立即归零、只能当冷却；
     *                              全史版把「出生期出现过过大单块」作为票的固有属性保留
     *                              （乌龟同块 4 钱包 7.70e7 token：滚动版 +18s 归零，全史版
     *                              持续可见）。本键历史快照/扫描值与新口径不可比。
     *                              **★二次口径修正（同日，가나디 0xa270…7777 120.5% 案）**：
     *                              分子 = 该块买家集合**当前**净持仓（_maxBuyBlockWallets ×
     *                              _walletNetTokens），不再用块毛买入量——毛买入单调不减而
     *                              卖出压缩分母，会出现「买 127.5M 后全卖光仍显 120.5%」的
     *                              虚高（该钱包 7 秒清仓后不该再算控盘）。改为当前持仓后：
     *                              买家清仓 → 分子归 0；分子分母都随持仓/流通变化。
     *                              （块规模判定仍用 _maxBlockBuyTokens——哪个块「最大」）
     *                              本键历史快照/扫描值与新口径不可比。
     * 簇选取（2026-10-16 FLY 案用户裁定改金额优先）：簇 BNB 金额最大者优先，并列取
     * size 大者、再取 blk 小者（确定性）。旧「size 优先」漏等额镜像对——FLY 案
     * 0xbf00+0xd6ab395c 同 block 等额 0.3705×2=0.741 BNB（占窗内买盘 60%）输给
     * size=4 散户簇 0.271 BNB 只显 22%；金额优先下单巨鲸（size=1 大额簇）与多钱包
     * 团伙簇（size≥2）统一为「买盘集中度」一个语义。★历史断代：share/size 键值
     * 与旧口径不可比（v19 起门用新口径）。
     * 纯函数读取：无 latch/无副作用 → 与 backtest.tickBuildSkip 天然无互斥（写点在
     * _applyWalletAggregation 每 tick 照跑，build 跳过的只是本读点，重建时数据完整）。
     * defer 乱序免疫：窗内事件按钱包去重保最早（ts→blk→li 链序真值），min 替换可能在
     * 环里留同钱包双事件，去重是唯一序无关解。★防前视红线：禁 Date.now——now 由
     * buildFactorMap(state, asOf) 传入。空/空窗全 0（有证据零值非 null）。
     */
    _bundleClusterFactors(state, now, out) {
        const cutoff = now - this._fp.bundleWinMs;
        // 窗内首买事件 → 按钱包去重（保链序最早）
        const perWallet = new Map();
        for (const e of state._bundleEvents) {
            if (e.ts < cutoff) continue;
            const prev = perWallet.get(e.w);
            const earlier = prev === undefined
                || e.ts < prev.ts
                || (e.ts === prev.ts && e.blk !== null && prev.blk !== null
                    && (e.blk < prev.blk || (e.blk === prev.blk
                        && e.li !== null && prev.li !== null && e.li < prev.li)));
            if (earlier) perWallet.set(e.w, e);
        }
        // 按 block 聚簇（blk 缺失行无法聚簇——不造兜底）
        const byBlock = new Map();
        for (const e of perWallet.values()) {
            if (e.blk === null) continue;
            let c = byBlock.get(e.blk);
            if (!c) { c = { bnb: 0, rows: [] }; byBlock.set(e.blk, c); }
            c.bnb += e.bnb;
            c.rows.push(e);
        }
        let best = null;
        for (const [blk, c] of byBlock) {
            if (best === null
                || c.bnb > best.c.bnb
                || (c.bnb === best.c.bnb
                    && (c.rows.length > best.c.rows.length
                        || (c.rows.length === best.c.rows.length && blk < best.blk)))) {
                best = { blk, c };
            }
        }
        // sharePct 分母：窗内总买入 BNB（含非首买买盘与 null wallet 行；扫 act* 事件环）
        let winBuyBnb = 0;
        for (const e of state._activityEvents) {
            if (e.ts >= cutoff && e.buy) winBuyBnb += e.bnb;
        }
        const rows = best ? best.c.rows : [];
        const size = rows.length;
        const sharePct = best && winBuyBnb > 0 ? best.c.bnb / winBuyBnb * 100 : 0;
        // 金额比 max/min（size<2 或 min≤0 → 0 无证据零值）
        let amountRatio = 0;
        if (size >= 2) {
            let mn = Infinity, mx = 0;
            for (const r of rows) { if (r.bnb < mn) mn = r.bnb; if (r.bnb > mx) mx = r.bnb; }
            if (mn > 0) amountRatio = mx / mn;
        }
        // log_index 等间隔（排序在读取时做，defer 乱序免疫；任一 li 缺失 → 0）
        let evenGap = 0;
        if (size >= 2) {
            const lis = rows.map(r => r.li);
            if (lis.every(v => v !== null)) {
                lis.sort((a, b) => a - b);
                evenGap = 1;
                for (let i = 2; i < lis.length; i++) {
                    if (lis[i] - lis[i - 1] !== lis[1] - lis[0]) { evenGap = 0; break; }
                }
            }
        }
        // 模态 trader 占比（trader 全 null 时模态计数=行数 → 100；wallet 口径与 trader 层
        // 刻意并存：sameTrader 观察的是「同一执行路由」，null trader 视为同一未知执行者）
        let sameTrader = 0;
        if (size >= 1) {
            const cnt = new Map();
            for (const r of rows) cnt.set(r.trader, (cnt.get(r.trader) || 0) + 1);
            let mode = 0;
            for (const v of cnt.values()) if (v > mode) mode = v;
            sameTrader = mode / size * 100;
        }
        // 单 block 吞噬率：全史最大 block 的**买家钱包当前净持仓合计** ÷ 读取时刻累计流通
        // （2026-10-20 乌龟案用户裁定：由「10s 滚动窗最大」改为「全史最大」——滚动版在
        //  大块滑出窗后立即归零，只能当冷却用；全史版把「出生期出现过过大单块」作为票的
        //  固有属性保留。同日二次修正（가나디 120.5% 案）：分子由块毛买入量改为该块买家
        //  的**当前持仓**——毛买入单调不减、卖出压缩分母会虚高；买家清仓后分子归 0。
        //  口径断代：本键值不可与 2026-10-20 前的快照/扫描结果直接比较）
        let maxBlkHold = 0;
        if (state._maxBuyBlockWallets) {
            for (const w of state._maxBuyBlockWallets) {
                const v = state._walletNetTokens.get(w);
                if (v > 0) maxBlkHold += v;
            }
        }
        const circPct = maxBlkHold > 0 && state._circTokens > 0 ? maxBlkHold / state._circTokens * 100 : 0;
        // 可选簇明细（扫描脚本对拍 B 用：簇钱包名单 → GMGN bundler 地址库 precision/recall）；
        // 引擎路径不传 out，零变化
        if (out) {
            out.blk = best ? best.blk : null;
            out.wallets = rows.map(r => r.w);
            out.windowBuyBnb = winBuyBnb;
            out.circTokens = state._circTokens;
            out.maxBlockBuyTokens = state._maxBlockBuyTokens;   // 块规模（判定用毛买入）
            out.maxBlockBuyBlk = state._maxBlockBuyBlk;
            out.maxBlockBuyHoldTokens = maxBlkHold;             // 因子分子（买家当前净持仓）
        }
        return {
            bundleClusterSize: size,
            bundleClusterSharePct: Math.round(sharePct * 10) / 10,
            bundleClusterAmountRatio: amountRatio,
            bundleClusterEvenGap: evenGap,
            bundleClusterSameTrader: Math.round(sameTrader * 10) / 10,
            maxBlockBuyCircPct: Math.round(circPct * 10) / 10,
        };
    }

    /**
     * launch* 出生窗推进（_earlyWindowAdvance 同构，仅 wallet 层调用——原料全在 wallet 段）：
     * 首个 ts−firstTickAt > launchBundleWinMs 的行触发一次冻结（幂等——后到调用者见
     * _launchWindowClosed 直接返回），按当前状态算出四键快照存 _launchFrozen；触发行自身
     * 不入窗（early 同构）。★防前视红线：ts 由 tick 传入，禁 Date.now。
     */
    _launchWindowAdvance(state, ts) {
        if (state._launchWindowClosed) return;
        if (ts - state.firstTickAt <= this._fp.launchBundleWinMs) return;
        state._launchWindowClosed = true;
        state._launchFrozen = this._launchBundleFactors(state);
    }

    /**
     * launch* 出生锚定捆绑簇 4 键（2026-10-17 Agentum 案方向 C，用户裁定）：
     *   launchBundleClusterSize     —— 出生窗（firstTickAt+launchBundleWinMs）内最大
     *                                  「同 block 首买簇」钱包数（10s 滑窗的出生期结构版）
     *   launchBundleClusterSharePct —— 该簇 BNB ÷ 出生窗总买入 BNB ×100（分母含非首买/
     *                                  null wallet 行，与现行 bundleClusterSharePct 分母
     *                                  同语义；Agentum 现场复算：簇 A 0.7239/2.5283=28.6）
     *   launchEqualClusterWallets   —— 出生窗内最大「等额首买簇」钱包数（★跨块——把同块
     *                                  放宽到出生窗短窗，拦时序洗白；相邻相对差<1e-5 链式
     *                                  聚簇，尘埃门 earlyUniformDustBnb 以下不参与；<3 → 0：
     *                                  2 钱包等额常见巧合且 FLY 形状由现行 10s 臂管）
     *   launchEqualClusterBnb       —— 该等额簇合计 BNB（观察键；wallets<3 → 0）
     * 与现行 bundle* 6 键双臂并存：10s 滑窗管「当下对敲」（FLY 形状），launch* 管「出生期
     * 捆绑指纹」（Konasu/鲸元卷同块等额、Agentum 0.1485×3 跨块等额——迟至 fire 时刻簇
     * 已完成即可见；fire 早于簇完成的快枪形状（Agentum fire+61s 第三笔+70s 才到）天然
     * 拦不住，非本族目标）。出窗后恒返回 _launchFrozen 冻结快照（断流票读现值=终值）。
     * 纯读取无副作用（tickBuildSkip 无互斥）；首买 map 覆盖式 min 替换 → defer 乱序收敛。
     * ★防前视红线：禁 Date.now（本方法无时参依赖——全部累计态，冻结由 write 侧 ts 推进）。
     * 空/空窗全 0（有证据零值非 null）。
     */
    _launchBundleFactors(state) {
        if (state._launchFrozen) return state._launchFrozen;
        const rows = [...state._launchFirstBuys.values()];
        // 同块簇（现行 _bundleClusterFactors 同款选取：金额最大 → size 大 → blk 小）
        const byBlock = new Map();
        for (const e of rows) {
            if (e.blk === null) continue;
            let c = byBlock.get(e.blk);
            if (!c) { c = { bnb: 0, n: 0 }; byBlock.set(e.blk, c); }
            c.bnb += e.bnb;
            c.n++;
        }
        let best = null;
        for (const [blk, c] of byBlock) {
            if (best === null
                || c.bnb > best.c.bnb
                || (c.bnb === best.c.bnb
                    && (c.n > best.c.n || (c.n === best.c.n && blk < best.blk)))) {
                best = { blk, c };
            }
        }
        const size = best ? best.c.n : 0;
        const sharePct = best && state._launchBuyBnb > 0 ? best.c.bnb / state._launchBuyBnb * 100 : 0;
        // 等额簇（跨块短窗臂）：尘埃门以上首买金额排序，相邻相对差<1e-5 链式归簇
        const dust = this._fp.earlyUniformDustBnb;
        const eq = rows.filter(r => r.bnb >= dust).sort((a, b) => a.bnb - b.bnb);
        let eqN = 0, eqBnb = 0;
        let i = 0;
        while (i < eq.length) {
            let j = i + 1, bnb = eq[i].bnb;
            while (j < eq.length
                && Math.abs(eq[j].bnb - eq[j - 1].bnb) / Math.max(eq[j - 1].bnb, 1e-12) < 1e-5) {
                bnb += eq[j].bnb;
                j++;
            }
            if (j - i > eqN || (j - i === eqN && bnb > eqBnb)) { eqN = j - i; eqBnb = bnb; }
            i = j;
        }
        if (eqN < 3) { eqN = 0; eqBnb = 0; } // <3 钱包非簇（2 钱包等额=常见巧合，FLY 由 10s 臂管）
        return {
            launchBundleClusterSize: size,
            launchBundleClusterSharePct: Math.round(sharePct * 10) / 10,
            launchEqualClusterWallets: eqN,
            launchEqualClusterBnb: parseFloat(eqBnb.toFixed(4)),
        };
    }

    /**
     * 分类器轨迹修剪（回迁批 3.1，母版 _pruneRecentTicks 动态窗同构）：
     * 有可靠价峰时从峰起保留全部（供 OPB 闪崩检测看完整 peak→crash 路径——修固定短窗
     * 「crash 不落在分类时刻窗口内就漏判闪崩」），无峰时用最小窗口兜底；超上限截断。
     * 独立于 _recentTicks（速率滑窗原料，固定短窗）——两套窗口语义不同不可复用。
     */
    _pruneClsTicks(state, now) {
        const ticks = state._clsTicks;
        if (ticks.length === 0) return;
        const minCutoff = now - this._fp.clsTicksWindowMs;
        const peakCutoff = state._relHighestAt || 0;
        const cutoff = peakCutoff ? Math.min(minCutoff, peakCutoff) : minCutoff;
        while (ticks.length > 0 && ticks[0].ts < cutoff) ticks.shift();
        if (ticks.length > this._fp.clsTicksMaxPerToken) {
            state._clsTicks = ticks.slice(-this._fp.clsTicksMaxPerToken);
        }
    }

    /** 中位数（排序副本，不改动原数组） */
    _median(arr) {
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    /** 标准 OLS 斜率（m<2 或分母<=0 返回 0——母版同款） */
    _olsSlope(pts) {
        const m = pts.length;
        if (m < 2) return 0;
        let sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (const p of pts) {
            sx += p.t; sy += p.y; sxy += p.t * p.y; sxx += p.t * p.t;
        }
        const den = m * sxx - sx * sx;
        if (den <= 0) return 0;
        return (m * sxy - sx * sy) / den;
    }

    /**
     * Wilder RSI（无状态全量重算；n<=period → null warmup fail-closed；avgLoss=0 → 100）。
     * 首周期简单平均，其后 avg=(avg*(period-1)+d)/period。
     */
    _rsi(closes, period) {
        const n = closes.length;
        if (n <= period) return null;
        let ag = 0, al = 0;
        for (let i = 1; i <= period; i++) {
            const d = closes[i] - closes[i - 1];
            if (d > 0) ag += d; else al -= d;
        }
        let avgG = ag / period;
        let avgL = al / period;
        for (let i = period + 1; i < n; i++) {
            const d = closes[i] - closes[i - 1];
            const g = d > 0 ? d : 0;
            const l = d < 0 ? -d : 0;
            avgG = (avgG * (period - 1) + g) / period;
            avgL = (avgL * (period - 1) + l) / period;
        }
        if (avgL === 0) return 100;
        return 100 - 100 / (1 + avgG / avgL);
    }

    /**
     * 趋势窗 2 因子（母版 _computePriceTrendFactors 同源裁剪，仅窗口/锚点 BSC 化）：
     *   priceTrendSlope                  对数价格 OLS 斜率 %/s（方向速度；n>=8 且非 widened 分桶中位抗毒价）
     *   recentRiseFromWindowLowPct       距窗内低点拉起 %≥0
     * 可靠 tick 不足（<trendAbsMinTicks）→ 全 null（fail-closed）。主窗最近 min(trendWindowMs, age)，
     * 不足 trendMinReliableTicks 且总数 >=trendAbsMinTicks → widened 全历史（新币苗子自适应）。
     */
    _computePriceTrendFactors(reliable, now, firstTickAt) {
        const NULL_RESULT = {
            priceTrendSlope: null,
            recentRiseFromWindowLowPct: null,
        };
        if (!Array.isArray(reliable) || reliable.length === 0) return NULL_RESULT;

        // P2c（2026-10-12）：reliable 提取 + 升序 sort 均上移到 _scanRecentTicks 单趟
        //（判据逐字同式）；本函数只保留窗口/回归计算。
        // 到达序 ≠ 时间序（watcher 双写者 bigserial 分配序≠提交序，迟到的更早 blockTime 行）：
        // 升序假设（t0=window[0]、window[n-1] 当现价、分桶 idx∈[0,B)）在乱序输入下
        // idx 变负 → buckets[-k].push 崩进程（2026-09-28 b24879e0 裸崩实案，QSAFU 盘）——
        // 归一在扫描器内完成，本函数恒收到时间升序输入。

        const age = firstTickAt !== null && firstTickAt > 0
            ? Math.max(0, now - firstTickAt) : this._fp.trendWindowMs;
        const cutoff = now - Math.min(this._fp.trendWindowMs, age);
        let window = reliable.filter(x => x.t >= cutoff);

        let widened = false;
        if (window.length < this._fp.trendMinReliableTicks) {
            if (reliable.length >= this._fp.trendAbsMinTicks) {
                window = reliable;
                widened = true;
            } else {
                return NULL_RESULT;
            }
        }
        const n = window.length;
        if (n < 2) return NULL_RESULT;

        // priceTrendSlope：对 ln(price) OLS，输出 %/s（d lnP ≈ dP/P）
        let slope;
        const t0 = window[0].t;
        if (n >= 8 && !widened) {
            // 分桶取 ln 中位数抗单笔异常，再对桶中心 OLS
            const B = Math.max(3, Math.min(12, Math.floor(n / 4)));
            const span = Math.max(1, window[n - 1].t - t0);
            const buckets = Array.from({ length: B }, () => []);
            for (const x of window) {
                const idx = Math.min(B - 1, Math.floor((x.t - t0) / span * B));
                buckets[idx].push(Math.log(x.p));
            }
            const pts = [];
            for (let i = 0; i < B; i++) {
                if (buckets[i].length === 0) continue;
                pts.push({ t: (i + 0.5) / B * span / 1000, y: this._median(buckets[i]) });
            }
            slope = this._olsSlope(pts);
        } else {
            slope = this._olsSlope(window.map(x => ({ t: (x.t - t0) / 1000, y: Math.log(x.p) })));
        }
        const priceTrendSlope = Number.isFinite(slope) ? slope * 100 : null;

        let low = Infinity;
        for (const x of window) if (x.p < low) low = x.p;
        const recentRiseFromWindowLowPct = (low > 0 && Number.isFinite(low))
            ? (window[n - 1].p - low) / low * 100 : null;

        return {
            priceTrendSlope,
            recentRiseFromWindowLowPct,
        };
    }

    /** per-position 持仓期因子 */
    _positionFactors(state, pos, now) {
        const currentBnb = state.currentPriceBnb || 0;
        // 双时长（2026-10-15 用户裁定）：holdDuration=信号（fire）时刻起算（条件触发口径，
        // 与成本锚 fire 价同一语义）；realHoldDuration=成交时刻起算（物理持有时长）。
        // buySignalAt 缺省（手工/恢复锚点/回测无延迟）回落 buyTime → 两值相等=旧公式 bit 一致
        const holdAnchor = pos.buySignalAt ?? pos.buyTime;
        const holdDuration = holdAnchor ? (now - holdAnchor) / 1000 : 0;
        const realHoldDuration = pos.buyTime ? (now - pos.buyTime) / 1000 : 0;
        let profitPercent = 0;
        if (pos.buyPriceBnb > 0 && currentBnb > 0) {
            profitPercent = ((currentBnb - pos.buyPriceBnb) / pos.buyPriceBnb) * 100;
        }
        let drawdownFromHighestSinceLastBuy = null;
        if (pos.highestPriceSinceBuyBnb > 0 && currentBnb > 0) {
            drawdownFromHighestSinceLastBuy =
                ((currentBnb - pos.highestPriceSinceBuyBnb) / pos.highestPriceSinceBuyBnb) * 100;
        }
        let holderDrawdownFromHighestSinceLastBuy = null;
        if (pos.highestHoldersSinceBuy > 0) {
            holderDrawdownFromHighestSinceLastBuy =
                ((state.holderCount - pos.highestHoldersSinceBuy) / pos.highestHoldersSinceBuy) * 100;
        }
        return {
            buyPrice: pos.buyPriceUsd || pos.buyPriceBnb, // USD 优先（买入时点锁定），缺 USD 时退 BNB（比值因子不受影响）
            buyPriceBnb: pos.buyPriceBnb,
            buyTime: pos.buyTime,
            // 执行口径键（2026-10-15 双口径）：buySignalAt=fire 时刻（holdDuration 起算锚）、
            // buyExecutedAt=成交时刻、buyExecutedPriceBnb=live 余额差法成交价（虚拟/回测 null）
            buySignalAt: pos.buySignalAt ?? pos.buyTime ?? null,
            buyExecutedAt: pos.buyTime ?? null,
            buyExecutedPriceBnb: pos.buyExecutedPriceBnb ?? null,
            holdDuration,
            realHoldDuration,
            profitPercent,
            highestPriceSinceLastBuy: pos.highestPriceSinceBuyBnb * (state.lastImpliedBnbUsd || 0),
            highestPriceSinceLastBuyBnb: pos.highestPriceSinceBuyBnb,
            drawdownFromHighestSinceLastBuy,
            // 拱形止损（2026-10-06）：持仓期峰值市值 USD——峰价与 drawdownFromHighestSinceLastBuy
            // 同源（pos.highestPriceSinceBuyBnb，离群剔除链）；totalSupply/汇率缺失 → null
            // fail-closed（拱形腿引用 null 比较恒 false 不触发，退回 stopLoss 段保护）
            peakMarketCapSinceLastBuy: pos.highestPriceSinceBuyBnb > 0 && state.totalSupply > 0 && (state.lastImpliedBnbUsd || 0) > 0
                ? pos.highestPriceSinceBuyBnb * state.totalSupply * state.lastImpliedBnbUsd
                : null,
            highestHolderCountSinceLastBuy: pos.highestHoldersSinceBuy,
            holderDrawdownFromHighestSinceLastBuy,
            // 回迁批 1 H 组（可靠价链口径）
            peakProfitPct: pos.peakProfitPct || 0,          // running max，_buildFactorMap 先推进后读取
        };
    }

    /**
     * 因子图构建（键契约对齐 VirtualTradingEngine._buildFactors + 回迁批 1 的 68 新键）
     */
    _buildFactorMap(state, now) {
        const bnbUsd = state.lastImpliedBnbUsd || 0;
        const currentPriceBnb = state.currentPriceBnb || 0;
        const firstPriceBnb = state.firstPriceBnb || currentPriceBnb;
        const currentPrice = bnbUsd > 0 ? currentPriceBnb * bnbUsd : 0;
        const firstPrice = bnbUsd > 0 ? firstPriceBnb * bnbUsd : 0;

        // age：分钟（契约口径：创建时间锚点，非收集时间）
        const age = state.createdAtMs ? (now - state.createdAtMs) / 60000 : 0;
        // tokenAgeSec：秒（同一 createdAtMs 锚点；秒级买窗 condition 用）
        const tokenAgeSec = state.createdAtMs ? (now - state.createdAtMs) / 1000 : 0;

        // ── preFilter：未持仓且 age 落在【全部】买策略区间并集外 → 跳过因子构建（纯提效）──
        // 阈值由引擎从各买腿 condition AST 提取注入（setPreFilter）；严格小于下界/严格
        // 大于上界才跳过，对 < 与 <= operator 都不漏买（边界值交回 condition 评估——age
        // 与 condition 里的 age 是同一算式产物，出区间 ⇒ AND 链 condition 必 false）。
        // 持仓 token（_positions 非空）永不跳过——卖腿/止损需实时因子
        if (this._preFilter && state._positions.size === 0) {
            const inAnyRange = this._preFilter.some(r => !(age < r.minAgeMinutes || age > r.maxAgeMinutes));
            if (!inAnyRange) {
                this._preFilterSkipped++;
                return null;
            }
        }

        // earlyReturn / riseSpeed：BNB 比值（=USD 比值，免汇率）
        let earlyReturn = 0;
        if (firstPriceBnb > 0 && currentPriceBnb > 0) {
            earlyReturn = ((currentPriceBnb - firstPriceBnb) / firstPriceBnb) * 100;
        }
        const riseSpeed = age > 0 ? earlyReturn / age : 0;

        let drawdownFromHighest = 0;
        if (state.highestPriceBnb > 0 && currentPriceBnb > 0) {
            drawdownFromHighest = ((currentPriceBnb - state.highestPriceBnb) / state.highestPriceBnb) * 100;
        }

        // ═══ 回迁批 1：H 组推进（先推进后读取，对齐母版顺序）═══
        // peakProfitPct running max（全 positions，可靠价链）
        for (const _pos of state._positions.values()) {
            if (_pos.buyPriceBnb > 0 && state._relPriceBnb > 0) {
                const _profitPct = ((state._relPriceBnb - _pos.buyPriceBnb) / _pos.buyPriceBnb) * 100;
                if (_profitPct > _pos.peakProfitPct) _pos.peakProfitPct = _profitPct;
            }
        }

        // 顶层持仓因子 = 最新仓（契约口径：token.buyPrice 单槽覆写语义）
        let positionFactors = {
            buyPrice: 0,
            buyPriceBnb: 0,
            buyTime: null,
            buySignalAt: null,
            buyExecutedAt: null,
            buyExecutedPriceBnb: null,
            holdDuration: 0,
            realHoldDuration: 0,
            profitPercent: 0,
            highestPriceSinceLastBuy: null,
            highestPriceSinceLastBuyBnb: 0,
            drawdownFromHighestSinceLastBuy: null,
            peakMarketCapSinceLastBuy: null,
            highestHolderCountSinceLastBuy: null,
            holderDrawdownFromHighestSinceLastBuy: null,
            peakProfitPct: null,
        };
        if (state._lastPositionKey && state._positions.has(state._lastPositionKey)) {
            positionFactors = this._positionFactors(
                state, state._positions.get(state._lastPositionKey), now);
        }

        // ═══ 回迁批 2.6：市场截面快照（模块级单例分钟桶 memo；未 feed → null → 5 键全 null）═══
        const _mkt = this._getMarketSnapshot(now);

        // ═══ 回迁批 1：读取时聚合族（pumpfun 模式，避免 per-tick 全遍历）═══

        // 单趟合并（2026-10-15 批次 5b）：P 组 top3/top5 + GMGN 实时占比 + sniper top20
        // 旧实现三趟全遍历 _walletNetTokens——本段合一（bigHolder 遍 _buyerVolume / K 组遍
        // 双边地址集是不同 map 保持独立）。top20 槽无条件构建（P 组 top3/top5 从降序前缀
        // 派生：值多重集合与五变量插入排序恒同——两算法均严格 > 稳定插入，仅消费值求和，
        // 降序左结合同序 → bit 一致）；_posTotal/_gmgnPos/_sum20/_sumSn 累加链次序逐字保持
        // P 组口径：净持仓集中度（v<=0 跳过——净口径免疫拆单；wallet 口径 _walletNetTokens
        // ——trader 口径下 GMGN 盘全员合并成单一巨户，集中度虚高）
        const _top20 = [];
        let _posTotal = 0, _gmgnPos = 0;
        for (const [addr, v] of state._walletNetTokens) {
            if (v <= 0) continue;
            if (this._maintainTpa) {
                _posTotal += v;
                if ((state._walletRoutedBuyBnb.get(addr) || 0) > 0) _gmgnPos += v;
            }
            let i = _top20.length;
            while (i > 0 && _top20[i - 1][1] < v) i--;
            if (i >= 20) continue;
            _top20.splice(i, 0, [addr, v]);
            if (_top20.length > 20) _top20.pop();
        }
        const _nA = _top20[0] ? _top20[0][1] : 0;
        const _nB = _top20[1] ? _top20[1][1] : 0;
        const _nC = _top20[2] ? _top20[2][1] : 0;
        const _nD = _top20[3] ? _top20[3][1] : 0;
        const _nE = _top20[4] ? _top20[4][1] : 0;
        const _holderTop3 = _nA + _nB + _nC;
        const _holderTop5 = _nA + _nB + _nC + _nD + _nE;

        // GMGN 用户实时占比（2026-10-14 小王子案用户裁定，替换 TPAPre_gmgnUserPct 快照口径）：
        // Σ(GMGN 用户 net>0)/Σ(net>0)×100，量加权——公式与 TPA _gmgnShareStats 逐字一致；TPA 消费点
        // 在触发/分析时刻（write-once 快照），对后期 GMGN 流入盲视（好票前期 GMGN 用户少、后面
        // 涨上来快照也不翻案）。此处每 tick 实时重算。_maintainTpa=false（实验无 TPA 段，
        // _walletRoutedBuyBnb 零写入）→ null fail-closed——区别于 0=「有证据零占比」（纯直联盘）
        let _gmgnUserPct = null;
        if (this._maintainTpa) {
            _gmgnUserPct = _posTotal > 0 ? Number(((_gmgnPos / _posTotal) * 100).toFixed(2)) : 0;
        }

        // 名单因子（回迁批 3.3）：sniperHolderShare = top20 净持仓中 sniper 占比×100
        // （分母=_sum20 top20 净和【非 totalSupply】——母版口径；creator 豁免；
        //   名单 null 或 _sum20<=0 → null fail-closed=引用键的门不放行）
        let _sniperHolderShare = null;
        if (_sniperWallets) {
            let _sum20 = 0, _sumSn = 0;
            for (const [addr, v] of _top20) {
                _sum20 += v;
                if (addr !== state.creatorAddress && _sniperWallets.has(addr)) _sumSn += v;
            }
            if (_sum20 > 0) _sniperHolderShare = _sumSn / _sum20 * 100;
        }

        // 大户群体（W = 累计买入 >= bigHolderMinCumBuyBnb）：present=严格净持仓>0
        let _bhTotal = 0, _bhPresent = 0;
        let _bhShareTok = 0;
        {
            for (const [_addr, _vol] of state._buyerVolume) {
                if (_vol < this._fp.bigHolderMinCumBuyBnb) continue;
                _bhTotal++;
                const _net = state._walletNetTokens.get(_addr) || 0;
                if (_net > 0) {
                    _bhPresent++;
                    _bhShareTok += _net;
                }
            }
        }

        // K 组：对敲重叠（双边地址并集上的两栖占比；量口径抗人头稀释）
        // 两趟无分配遍历（2026-10-15 批次 5a）：旧 new Set([...buyers,...sellers]) 物化
        // 并集每 build 一次纯分配浪费。迭代序与旧 Set 迭代序恒同（buyers 插入序 →
        // sellers 中非 buyer 插入序），_v 取值表达式逐字不变 → 浮点加法链 bit 一致；
        // 并集大小=计数。依赖键集不变式 _buyerVolume≡_buyerAddresses /
        // _sellerVolume≡_sellerAddresses（processTick 同点成对写）
        let counterpartyOverlapRate = 0, counterpartyOverlapVolume = 0;
        {
            let _overlap = 0, _unionCount = 0, _unionVol = 0, _interVol = 0;
            for (const _addr of state._buyerAddresses) {
                const _v = (state._buyerVolume.get(_addr) || 0) + (state._sellerVolume.get(_addr) || 0);
                _unionCount++;
                _unionVol += _v;
                if (state._sellerAddresses.has(_addr)) {
                    _overlap++;
                    _interVol += _v;
                }
            }
            for (const _addr of state._sellerAddresses) {
                if (state._buyerAddresses.has(_addr)) continue; // 两栖地址已入第一趟
                const _v = (state._buyerVolume.get(_addr) || 0) + (state._sellerVolume.get(_addr) || 0);
                _unionCount++;
                _unionVol += _v;
            }
            if (_unionCount > 0) {
                counterpartyOverlapRate = _overlap / _unionCount;
                counterpartyOverlapVolume = _unionVol > 0 ? _interVol / _unionVol : 0;
            }
        }

        // 秒级桶 RSI（墙钟秒收盘，空秒跳过；观察层快照键）
        let rsi14Sec = null;
        if (state._secCloses.length >= 2) {
            rsi14Sec = this._rsi(state._secCloses, 14);
        }
        // 宽 bar（5m）RSI Rt 版（E5 卖侧，DB 现役引用）：闭合序列拼当前未闭合 bar close
        // （rich-js 实时触发口径：最后一根进行中、close=最新可靠价，不等收盘）。warmup：RSI9 需
        // 10 根闭合 5m bar≈首 tick 后 50min——正是 fail-closed 的前期窗口
        let rsi9Bar5mRt = null;
        if (state._bar5mCloses.length >= 2 && state._bar5mCurrent !== null) {
            const _rt5 = state._bar5mCloses.concat([state._bar5mCurrent.close]);
            rsi9Bar5mRt = this._rsi(_rt5, 9);
        }

        // P2c 单趟扫描（2026-10-12 回测性能案）：本函数内原先多个消费方各自遍历
        // _recentTicks（5min 窗过滤、crashSpeed 窗高点、risePct5m 谷、trend
        // reliable 提取）合并为一趟；rise 的 buyTs 在此提前解析（纯读 state._positions）
        const _rsPos = state._lastPositionKey ? state._positions.get(state._lastPositionKey) : null;
        const _rsBuyTs = Number(_rsPos?.buyTime) || 0;
        const _scan = this._scanRecentTicks(state, now, _rsBuyTs);

        // 近期砸速 %/s：crashSpeedWindowMs 窗内自「窗内高点」的下跌速度（横盘/反弹收复 → null）。
        // 分母钳 >= crashSpeedMinDtMs/1000 防同块毫秒连砸把速度放大到不可解释量级。
        // 现价用 _relPriceBnb（母版 currentPriceUsd 本身就是可靠价链产物）。
        let crashSpeedPctPerSec = null;
        {
            const _wh = _scan.csWh, _whT = _scan.csWhT;
            if (_wh > 0 && _whT > 0 && now > _whT) {
                const _ddW = ((state._relPriceBnb - _wh) / _wh) * 100;
                if (_ddW < 0) {
                    crashSpeedPctPerSec = _ddW / Math.max((now - _whT) / 1000, this._fp.crashSpeedMinDtMs / 1000);
                }
            }
        }

        // 针臂原料（E5 卖侧，rich-js RiseSpeed tick 模式搬运）：5min 窗谷→现价涨幅+速度。
        // 持仓口径（E5b 修正）：窗下界 = max(now-5min, 买入时间)——谷/tick 计数只取买入后。
        // 市场口径（含买前涨幅）+ 动量买门会在买入瞬间即成立 → 100% 秒卖（E5 实测 4 轮
        // 全部 hold 0-2s 被 P2 猛档全清）；rich-js 原版语义本就是「持仓期间的拉升针」。
        // 买入时间取最新仓（_lastPositionKey，与顶层 buyPrice 族因子同口径）；无仓/
        // 无有效 buyTime → null fail-closed（买腿评估期天然 null，零污染）。
        // 谷用 <=（最近触及——防横盘反复触谷稀释 elapsed）；现价=_relPriceBnb（可靠价，
        // 尘价不触发）；窗内可靠 tick 不足 riseMinTicks → null fail-closed（买入后头几个
        // tick 不构成针）；速度分母钳 riseMinElapsedMin（谷=最新 tick 时防除零）。
        // risePct5m 可为负（现价贴谷）——条件都是 > 阈值，fail-closed 方向安全。
        let risePct5m = null, riseVel5m = null;
        {
            const _buyTs = _rsBuyTs;
            if (_buyTs > 0) {
                const _trough = _scan.riseTrough, _troughTs = _scan.riseTroughTs, _rn = _scan.riseRn;
                if (_rn >= this._fp.riseMinTicks && _trough > 0 && _troughTs > 0
                    && state._relPriceBnb > 0) {
                    risePct5m = (state._relPriceBnb / _trough - 1) * 100;
                    const _elapsedMin = Math.max((now - _troughTs) / 60000, this._fp.riseMinElapsedMin);
                    riseVel5m = risePct5m / _elapsedMin;
                }
            }
        }

        // 趋势窗 2 因子（可靠价切片；P2c reliable 升序数组来自 _scanRecentTicks）
        const trendFactors = this._computePriceTrendFactors(_scan.reliable, now, state.firstTickAt);

        // 交易活跃度滑窗（act* 8 键，2026-10-15；取代已删的 cycle 分桶路由）
        const activity = this._activityFactors(state, now);

        // 首窗累计（earlyTrades* 键，2026-10-17 买腿重构 C84；出窗后恒返回冻结快照）
        const early = this._earlyTradesFactors(state);

        // 同 block 首买簇捆绑检测（bundle* 6 键，2026-10-16 BITCAT 案；Phase 1 纯观察键）
        const bundle = this._bundleClusterFactors(state, now);

        // 出生锚定捆绑簇（launch* 4 键，2026-10-17 Agentum 案方向 C；出窗后恒返回冻结快照）
        const launch = this._launchBundleFactors(state);

        // TOP1 持仓集中度（2026-10-16 用户裁定：门键，单巨鲸/团伙囤筹拦截；
        // maxBlockBuyCircPct 的存量替代——不受「早期流通分母小」的流量假象污染）：
        // 链上买入者最大净持仓 ÷ 流通(_circTokens)×100。口径注意：creator 预 mint 无
        // buy tick 不进 _walletNetTokens（测的是交易者集中度非全持有人）；负净持仓
        // （净卖者）自然出局；单趟扫 max 序无关（_walletNetTokens 任意序收敛前提）
        let _top1Net = 0;
        for (const v of state._walletNetTokens.values()) if (v > _top1Net) _top1Net = v;
        const top1HolderCircPct = state._circTokens > 0 ? _top1Net / state._circTokens * 100 : 0;

        // 最大跟单钱包持仓（2026-10-16 FLY 案用户正式方案）：名单钱包（协同簇：持续有
        // 跟单、同步买/卖）在当前票的**单钱包最大**净持仓 ÷ 流通 ×100。刻意取 max 而非
        // 名单合计——热门票聪明钱都参与，合计误伤；单钱包持仓才反映控盘度（FLY：0xbf00
        // 单持 ~25%+镜像 22%，一砸砸死）。名单 null → 恒 null（fail-closed：门
        // maxCopyWalletHolderCircPct < 20 恒 false=拒买）；空 Set → 0 放行。键域小写
        // （scan 脚本 toLowerCase 落盘；_walletNetTokens 键=wallet=sender||trader 原样，
        // 命中侧 toLowerCase 对齐）。纯读单趟扫 max，序无关（乱序 parity 同 top1 前提）
        let maxCopyWalletHolderCircPct = null;
        if (_copyWallets) {
            let _maxCopyNet = 0;
            for (const [addr, v] of state._walletNetTokens) {
                if (v > _maxCopyNet && v > 0 && _copyWallets.has(addr.toLowerCase())) _maxCopyNet = v;
            }
            maxCopyWalletHolderCircPct = state._circTokens > 0 ? _maxCopyNet / state._circTokens * 100 : 0;
        }

        // 极著名钱包单钱包最大净持仓（2026-10-18 币安人生案用户点名）：与上键同公式
        // 换名单=用户点名集合（被跟单特别重，跟单大军放大控盘度）→ 单独更紧的门
        // （<15，主门 20 不变）。null 语义刻意 fail-open（与上键 fail-closed 相反）：
        // 集合 null（未加载）或空（未启用）→ 恒 null → 条件串 IS NULL 臂放行
        // （收紧门未启用=存量零影响）；非空 → 0 起（有证据零值）。
        let famousCopyWalletCircPct = null;
        if (_famousCopyWallets && _famousCopyWallets.size > 0) {
            let _famousNet = 0;
            for (const [addr, v] of state._walletNetTokens) {
                if (v > _famousNet && v > 0 && _famousCopyWallets.has(addr.toLowerCase())) _famousNet = v;
            }
            famousCopyWalletCircPct = state._circTokens > 0 ? _famousNet / state._circTokens * 100 : 0;
        }

        // sybil 大簇合计净持仓占比（2026-10-20 乌龟案用户裁定）：簇内钱包
        // （sybil-clusters.json 并集）**合计**净持仓 ÷ 流通 ×100——刻意合计非最大：
        // 单钱包口径对「四五个地址分仓的 sybil 簇」天然漏检（乌龟案四钱包 fire 时
        // 单钱包 10.4% 过 famous 15 门，合计 38.9%）。负净持仓（净卖者）不计入；
        // 簇钱包在场但无持仓=0（有证据零值）。null=名单未启用（IS NULL 臂放行）。
        // 回放定档（v22-v24 111 票，2026-10-20）：X=35 拦 26 票（误伤 5 正票 +0.0011），
        // 被拦净 -0.0217 = 总亏损 -0.0373 的 58%，且 v22/23 与 v24 两个子集断崖一致。
        let sybilClusterHolderCircPct = null;
        if (_sybilClusterWallets && _sybilClusterWallets.size > 0) {
            let _clusterNet = 0;
            for (const [addr, v] of state._walletNetTokens) {
                if (v > 0 && _sybilClusterWallets.has(addr.toLowerCase())) _clusterNet += v;
            }
            sybilClusterHolderCircPct = state._circTokens > 0
                ? Math.round(_clusterNet / state._circTokens * 1000) / 10
                : 0;
        }

        // trend*：10s 桶价格序列（8 点窗，与 TrendDetector 固定窗口口径一致）
        const prices = state._priceSeries.map(p => p.price);
        const factors = {
            age,
            tokenAgeSec,
            // 平台标签（'fourmeme'/'flap'；registerToken 传入，未注册路径 null）——
            // 供 condition 字符串等值分门（platform != 'flap'，2026-10-02 router 平台豁免）；
            // 2026-10-17 C84 起进快照白名单（单一买条件分门 + signals 页 chip 直读）
            platform: state.platform || null,
            currentPrice,
            firstPrice,
            collectionPrice: firstPrice,   // 兼容旧前端
            launchPrice: firstPrice,       // 兼容旧前端
            currentPriceBnb,
            firstPriceBnb,
            earlyReturn,
            riseSpeed,

            buyPrice: positionFactors.buyPrice,
            buyPriceBnb: positionFactors.buyPriceBnb, // 成本锚 BNB（fire 价口径；快照审计键，2026-10-15 补映射）
            holdDuration: positionFactors.holdDuration,
            profitPercent: positionFactors.profitPercent,

            highestPrice: bnbUsd > 0 ? state.highestPriceBnb * bnbUsd : 0,
            highestPriceTimestamp: state.highestPriceAt,
            drawdownFromHighest,
            highestPriceSinceLastBuy: positionFactors.highestPriceSinceLastBuy,
            drawdownFromHighestSinceLastBuy: positionFactors.drawdownFromHighestSinceLastBuy,
            peakMarketCapSinceLastBuy: positionFactors.peakMarketCapSinceLastBuy,
            highestHolderCountSinceLastBuy: positionFactors.highestHolderCountSinceLastBuy,
            holderDrawdownFromHighestSinceLastBuy: positionFactors.holderDrawdownFromHighestSinceLastBuy,

            // ── WSS 事件流口径的「AVE 替代」因子 ──
            holders: state.holderCount,
            // GMGN 用户净持仓占比实时值（小写无前缀=FA 实时层；TPAPre_ 前缀=TPA 触发时快照层）
            gmgnUserPct: _gmgnUserPct,
            txVolumeU24h: bnbUsd > 0 ? (state.totalBuyBnb + state.totalSellBnb) * bnbUsd : 0,
            tvl: bnbUsd > 0 ? state.lastFundsBnb * bnbUsd : 0,
            fdv: 0,        // 见下（与 marketCap 同值）
            marketCap: state.totalSupply > 0 && currentPrice > 0 ? currentPrice * state.totalSupply : 0,
            // 毕业进度（E5 卖侧）：可靠价市值 / 毕业锚。锚经 _graduationAnchorBnb per-token 化——
            // flap 盘首 tick 距创建 <60s 时 = 首市值×12.5（funds 浮动 R 恒比），否则 72 默认锚
            // （four.meme 实测 11 token 收敛 72.1）。
            // 用 _relPriceBnb 而非 currentPrice——V1 实证尘价/异常巨量 tick 可把任意价口径推到 >1 假触发
            graduationProgress: (state.totalSupply > 0 && state._relPriceBnb > 0)
                ? (state._relPriceBnb * state.totalSupply) / this._graduationAnchorBnb(state)
                : null,

            tweetAuthorType: 0, // 叙事已解耦，恒 0
            dataCollectionRound: state.dataCollectionRound,

            // ── tick 原生活跃度因子 ──
            tradeCount: state.tradeCount,
            buyCount: state.buyCount,
            sellCount: state.sellCount,
            uniqueTraderCount: state.uniqueTraders.size,
            buyVolumeBnb: state.totalBuyBnb,
            sellVolumeBnb: state.totalSellBnb,

            // ── 交易活跃度滑窗 act* 8 键（2026-10-15；取代已删的 cycle 分桶路由。
            //    全史口径 tradeCount 族之外的短窗维度；0=空窗有证据零值非 null）──
            actBuyBnb: activity.actBuyBnb,
            actSellBnb: activity.actSellBnb,
            actNetBnb: activity.actNetBnb,
            actTrades: activity.actTrades,
            actTraders: activity.actTraders,
            actBuyers: activity.actBuyers,
            actSellers: activity.actSellers,
            actNewTraders: activity.actNewTraders,

            // ── 首窗累计 earlyTrades* 键（2026-10-17 买腿重构 C84：迁自
            //    EarlyParticipantCheckService DB trailing 90s 窗，FA 出生锚定累计窗——
            //    单一买条件消除 fire/预检查两阶段因子漂移；公式/舍入逐键对齐 legacy，
            //    口径 delta 见 _earlyTradesFactors 注释。legacy 腿零消费（preBuy 语境
            //    仍用 EarlyParticipantCheckService DB 版，双宿主并存）；新链路腿的
            //    condition 直接引用（如 earlyTradesRouterPct >= 30）──
            earlyTradesPerWallet: early.earlyTradesPerWallet,
            earlyTradesMaxWalletTrades: early.earlyTradesMaxWalletTrades,
            earlyTradesNetBuyRatio: early.earlyTradesNetBuyRatio,
            earlyTradesTop1BuySharePct: early.earlyTradesTop1BuySharePct,
            earlyTradesTop1BuyBnb: early.earlyTradesTop1BuyBnb,
            earlyTradesBuyBnb: early.earlyTradesBuyBnb,
            earlyTradesRouterPct: early.earlyTradesRouterPct,
            earlyTradesUniformBuyClusterRatio: early.earlyTradesUniformBuyClusterRatio,
            earlyTradesUniformBuyWallets: early.earlyTradesUniformBuyWallets,
            earlyTradesUniformBuyClusterN: early.earlyTradesUniformBuyClusterN,

            // ── 同 block 首买簇捆绑检测 bundle* 6 键（2026-10-16 BITCAT 案：
            //    5 bundler 同 block 首买 52.5% 窗内买盘，fire 峰顶买入后同 block 清仓
            //    -35.8%。Phase 1 纯观察键不进任何条件；0=空窗有证据零值非 null；
            //    语义/口径详见 _bundleClusterFactors 注释）──
            bundleClusterSize: bundle.bundleClusterSize,
            bundleClusterSharePct: bundle.bundleClusterSharePct,
            bundleClusterAmountRatio: bundle.bundleClusterAmountRatio,
            bundleClusterEvenGap: bundle.bundleClusterEvenGap,
            bundleClusterSameTrader: bundle.bundleClusterSameTrader,
            maxBlockBuyCircPct: bundle.maxBlockBuyCircPct,
            // ── 出生锚定捆绑簇 launch* 4 键（2026-10-17 Agentum 案方向 C：10s 滑窗迟到
            //    fire 漏创建块簇；同块臂+跨块等额臂，出窗冻结；口径见 _launchBundleFactors）──
            launchBundleClusterSize: launch.launchBundleClusterSize,
            launchBundleClusterSharePct: launch.launchBundleClusterSharePct,
            launchEqualClusterWallets: launch.launchEqualClusterWallets,
            launchEqualClusterBnb: launch.launchEqualClusterBnb,
            // TOP1 持仓集中度（2026-10-16 用户裁定门键；0=无持仓证据零值非 null；
            // 口径=链上交易者集中度，creator 预 mint 不在分子，见上方注释）
            top1HolderCircPct,
            maxCopyWalletHolderCircPct,
            // 极著名钱包单钱包最大净持仓占比（2026-10-18 用户点名集合；null=未启用
            // IS NULL 臂放行 / 0 起=有证据零值；见上方注释块）
            famousCopyWalletCircPct,
            // sybil 大簇钱包合计净持仓占比（2026-10-20 乌龟案用户裁定；null=未启用
            // IS NULL 臂放行 / 0 起=有证据零值；口径=合计非单钱包最大，见上方注释）
            sybilClusterHolderCircPct,

            trendDataPoints: prices.length,

            // ═══ pumpfun 回迁批 1（全部 BNB 原生口径，null fail-closed 见各注释）═══

            // K 组：对敲重叠（0=无两栖地址；新 state 无双边证据=0）
            counterpartyOverlapRate,
            counterpartyOverlapVolume,

            // P 组：持仓集中度（净持仓口径免疫拆单。
            // 分母=totalSupply（TokenCreate），缺失(=0) → null fail-closed——与母版常数 1e9 分母的裁定偏离）
            top3HolderShare: state.totalSupply > 0 ? _holderTop3 / state.totalSupply : null,
            top5HolderShare: state.totalSupply > 0 ? _holderTop5 / state.totalSupply : null,

            // 名单因子（回迁批 3.3）：
            // smartBotCount=累计买额 ≥ smartBotMinBuyBnb 的名单地址数（观察因子；名单 null 恒 0 fail-open，
            //   与母版同构只累不减——卖光仍计数）；
            // sniperHolderShare=top20 净持仓 sniper 占比%（设计上进买腿门；名单 null 恒 null fail-closed
            //   =null 过 ConditionEvaluator 恒 false 门不放行。分母=top20 净和非 totalSupply）
            smartBotCount: (() => { let n = 0; for (const v of state._smartBotBuyBnb.values()) if (v >= this._fp.smartBotMinBuyBnb) n++; return n; })(),
            sniperHolderShare: _sniperHolderShare,

            // 大户群体（W=累计买入 >= bigHolderMinCumBuyBnb；present=严格净持仓>0）
            bigHolderPresent: _bhPresent,
            bigHolderTotal: _bhTotal,
            bigHolderShare: state.totalSupply > 0 ? _bhShareTok / state.totalSupply : null,

            // P 组防砸盘（maxBlockDropPct null=从无跌幅证据）
            maxBlockDropPct: state._maxBlockDropPct,
            // 首块脉冲占比（母版首秒脉冲防钓鱼票；窗口冻结后才出值，null=窗口未过/无买入）
            firstBlockBuyShare: (state._firstBuyAt !== null
                && (now - state._firstBuyAt) >= this._fp.firstBlockWindowMs
                && state.totalBuyBnb > 0)
                ? state._firstBlockBuyBnb / state.totalBuyBnb
                : null,

            // R 组：RSI 存留键（已闭合桶=因果；warmup null fail-closed）
            rsi14Sec,
            rsi9Bar5mRt,

            // T 组：峰值后形态（可靠价链；样本不足 → null fail-closed）
            crashSpeedPctPerSec,
            // 针臂（E5 卖侧）：5min 稀疏窗谷→现价涨幅/速度；持仓口径（窗下界含买入时间）；
            // 无仓/样本不足或无可靠价 → null fail-closed
            risePct5m,
            riseVel5m,
            priceTrendSlope: trendFactors.priceTrendSlope,
            recentRiseFromWindowLowPct: trendFactors.recentRiseFromWindowLowPct,

            // E 组：断流防御（无 tick 记录 → null）
            idleSecSinceLastTick: state.lastTickAt !== null ? Math.max((now - state.lastTickAt) / 1000, 0) : null,

            // 市场截面 regime（观察版；★红线：不进任何交易策略 condition，audit 报错钉住；
            // 未 feed（web 裸 FA）→ 全 null；fed 下 marketNewbornCount1h 恒数值，率族受 cohort 门槛）
            marketNewbornCount1h: _mkt ? _mkt.newborn1h : null,
            marketRocketRate30m: _mkt ? _mkt.rocketRate : null,
            marketYoungMeanRet30m: _mkt ? _mkt.youngMeanRetPct : null,
            marketDeathRate30m: _mkt ? _mkt.deathRate : null,
            marketFlowBsRatio10m: _mkt ? _mkt.flowBsRatio : null,

            // H 组：持仓后（顶层=最新仓，无仓 null）
            peakProfitPct: positionFactors.peakProfitPct,
            // 双口径执行键（2026-10-15 用户裁定；顶层显式映射=getFactorKeys 探针收录的
            // 必要条件——只进 _positionFactors/无仓字面量不映射则策略 condition 引用会被
            // 未知因子防线拒启）：holdDuration=信号口径起算 / realHoldDuration=物理持有；
            // buySignalAt/buyExecutedAt/buyExecutedPriceBnb=两套时间/价格（无仓 null）
            buySignalAt: positionFactors.buySignalAt,
            buyExecutedAt: positionFactors.buyExecutedAt,
            buyExecutedPriceBnb: positionFactors.buyExecutedPriceBnb,
            realHoldDuration: positionFactors.realHoldDuration,
        };
        factors.fdv = factors.marketCap; // 内盘 fdv = 价格 × 总量

        // 渐进式趋势指标（≥2 点起，与旧契约一致；不足保持 undefined → ConditionEvaluator fail-closed）
        if (prices.length >= 2) {
            const first = prices[0];
            const last = prices[prices.length - 1];
            factors.trendTotalReturn = first > 0 ? ((last - first) / first) * 100 : 0;

            let riseCount = 0;
            for (let i = 1; i < prices.length; i++) {
                if (prices[i] >= prices[i - 1]) riseCount++;
            }
            factors.trendRiseRatio = riseCount / Math.max(1, prices.length - 1);
            factors.trendCV = this._trendDetector._calculateCV(prices);

            const checkSize = Math.min(5, prices.length);
            const recentPrices = prices.slice(-checkSize);
            let downCount = 0;
            for (let i = 1; i < recentPrices.length; i++) {
                if (recentPrices[i] < recentPrices[i - 1]) downCount++;
            }
            factors.trendRecentDownCount = downCount;
            factors.trendRecentDownRatio = downCount / Math.max(1, recentPrices.length - 1);

            let consecutiveDowns = 0;
            for (let i = prices.length - 1; i > 0; i--) {
                if (prices[i] < prices[i - 1]) consecutiveDowns++;
                else break;
            }
            factors.trendConsecutiveDowns = consecutiveDowns;

            const windowMax = Math.max(...prices);
            factors.trendDrawdownFromWindowHigh =
                windowMax > 0 ? ((last - windowMax) / windowMax) * 100 : 0;

            if (prices.length >= 4) {
                const direction = this._trendDetector._confirmDirection(prices);
                factors.trendPriceUp = direction.trendPriceUp;
                factors.trendMedianUp = direction.trendMedianUp;
                factors.trendSlope = direction.relativeSlope || 0;
                factors.trendStrengthScore = this._trendDetector._calculateTrendStrength(prices).score;
            }
        }

        // holderTrend*：blockNumber 桶持有者序列（8 块窗 ≈4s，2026-10-14 slot 化；
        // 门槛不变：growthRatio 族 ≥2 点、slope/direction 族 ≥4 点）。
        // defer 路径序列由事件缓冲重放维护（乱序回推免疫）——消费前脏刷新
        if (state._holderSeriesDirty) this._rebuildHolderSeries(state);
        const holderCounts = state._holderSeries.map(h => h.count);
        factors.holderTrendDataPoints = holderCounts.length;
        if (holderCounts.length >= 2) {
            const firstCount = holderCounts[0];
            const lastCount = holderCounts[holderCounts.length - 1];
            factors.holderTrendGrowthRatio =
                firstCount > 0 ? ((lastCount - firstCount) / firstCount) * 100 : 0;

            let hRiseCount = 0;
            for (let i = 1; i < holderCounts.length; i++) {
                if (holderCounts[i] > holderCounts[i - 1]) hRiseCount++;
            }
            factors.holderTrendRiseRatio = hRiseCount / Math.max(1, holderCounts.length - 1);
            factors.holderTrendCV = this._holderTrendDetector._calculateCV(holderCounts);

            const hCheckSize = Math.min(5, holderCounts.length);
            const hRecent = holderCounts.slice(-hCheckSize);
            let decreaseCount = 0;
            for (let i = 1; i < hRecent.length; i++) {
                if (hRecent[i] < hRecent[i - 1]) decreaseCount++;
            }
            factors.holderTrendRecentDecreaseCount = decreaseCount;
            factors.holderTrendRecentDecreaseRatio = decreaseCount / Math.max(1, hRecent.length - 1);

            let consecutiveDecreases = 0;
            for (let i = holderCounts.length - 1; i > 0; i--) {
                if (holderCounts[i] < holderCounts[i - 1]) consecutiveDecreases++;
                else break;
            }
            factors.holderTrendConsecutiveDecreases = consecutiveDecreases;

            if (holderCounts.length >= 4) {
                const hDirection = this._holderTrendDetector._confirmDirection(holderCounts);
                factors.holderTrendHolderCountUp = hDirection.holderCountUp;
                factors.holderTrendMedianUp = hDirection.holderMedianUp;
                factors.holderTrendSlope = hDirection.relativeSlope || 0;
                factors.holderTrendStrengthScore =
                    this._holderTrendDetector._calculateTrendStrength(holderCounts).score;
            }
        }

        // ── TPA 注入（回迁批 4；母版 :2257-2281 + :2441-2448 同款，BSC 可靠价链版）──
        // holdingCache = TPA 触发点 as-of 画像回填的 17 持仓键（setHoldingFactors）；
        // 触发前 null → 不注入（TPAPre_* 因子缺省 null → ConditionEvaluator 恒 false fail-closed）
        const holdingCache = state.tokenAddress && _holdingFactorOverrides
            ? _holdingFactorOverrides.get(state.tokenAddress) || null
            : null;
        if (holdingCache) Object.assign(factors, holdingCache);
        // TPAAnalyzed（0/1）：是否已完成首次 TPA 检测（holdingCache 存在 ≡ 已 setHoldingFactors ≡
        //   首次检测完成）。去门控化后供策略显式要求"先检测再买"：TPAAnalyzed == 1 AND TPAPre_tokenScore > X
        factors.TPAAnalyzed = holdingCache ? 1 : 0;

        // retention（大户走没走 live 因子）：TPA 在触发点冻结大户集 + netZ@D=Σ 大户建仓峰值净持仓
        //   （setRetentionBasis），每 tick 用 running _walletNetTokens 对冻结集求和得 netZ@T →
        //   retention=netZ@T/netZ@D。★netZ@D 用峰值（含触发前已清仓的）：netZ@T(running)≤netZ@D(峰值)
        //   → 触发刻即反映大户已部分出货。未冻结（TPA 未触发）→ null（fail-closed，与 holdingCache 同语义）。
        //   不 sanitize 负值：大户净卖超买 → retention≤0 = 强"走"信号；Infinity 不可能
        //   （分子 _walletNetTokens 与分母 _walletMaxNetTokens 同批切 wallet 口径——二期 2026-10-10，
        //   键域必须一致防分子分母错位）
        {
            const _retBasis = state.tokenAddress && _retentionBasis
                ? _retentionBasis.get(state.tokenAddress) : null;
            if (_retBasis && _retBasis.netZAtDecision > 0 && Array.isArray(_retBasis.zhuangAddresses)) {
                let _netZNow = 0;
                const _nmap = state._walletNetTokens;
                if (_nmap) {
                    for (const _a of _retBasis.zhuangAddresses) _netZNow += (_nmap.get(_a) || 0);
                }
                factors.TPAPre_retention = _netZNow / _retBasis.netZAtDecision;
            } else {
                factors.TPAPre_retention = null;
            }
        }

        // 审批时刻冻结的相对首可靠价涨幅 %（setAsofMs；未审批 null）
        factors.TPAPre_asofRelFirst = state._asofRelFirst;

        // ── 叙事触发模型注入（2026-10-17 买腿重构 C84）：narrativeRating（null=未完成/
        //    1=low/2=mid/3=high/9=失败超时归一）+ narrativeRounds（已完成分析轮数）+
        //    narrativeRetryDue（=1 当且仅当 rating===1 ∧ accountOnly ∧ !inFlight ∧
        //    rounds<maxAnalyses ∧ now−completedAt≥intervalMs——重试轮并入触发条件的
        //    因子表达 `... OR narrativeRetryDue == 1`）。未回填（legacy 腿/web 裸 FA/
        //    分析未完成）→ rating null → 条件 (narrativeRating == 2 OR == 3) 恒 false
        //    = 不参与信号生成（第二点由条件表达式天然保证）。
        //    ★now 用 build 入参（FA 周期判定禁 Date.now 红线）──
        {
            const _nar = state.tokenAddress && _narrativeFactorOverrides
                ? _narrativeFactorOverrides.get(state.tokenAddress) || null
                : null;
            factors.narrativeRating = _nar ? (_nar.rating ?? null) : null;
            factors.narrativeRounds = _nar ? (_nar.rounds ?? 0) : 0;
            // 叙事类型（2026-10-17 Nightshift 案）：deriveTokenCategory 产物三选一形状
            // （prestage 裸值 / event:X / null）。GMGN 条件层 narrativeCategory 键的
            // 因子源——project/account_based_meme/web3_native_ip_early/event:W 适用
            // issuerTokenCount<=1 门；null（未分析/未分类/legacy 腿）= IS NULL 臂放行
            factors.narrativeCategory = _nar ? (_nar.category ?? null) : null;
            // C88 超级IP两标签（2026-10-18 CZ 出书簇）：触发状态机完成轮投影的
            // superIp/recognizedEntitySlogan（analyzer 零列推导，1/0/null 三态——null=未
            // 分析/旧行无键；条件 ==1 臂对 0/null 天然 false fail-closed）
            factors.narrativeSuperIp = _nar ? (_nar.superIp ?? null) : null;
            factors.narrativeSuperIpSlogan = _nar ? (_nar.recognizedEntitySlogan ?? null) : null;
            factors.narrativeRetryDue = (_nar
                && _nar.rating === 1 && _nar.accountOnly === true && _nar.inFlight !== true
                && _nar.rounds < _narrativeFactorConfig.maxAnalyses
                && Number.isFinite(_nar.completedAt)
                && now - _nar.completedAt >= _narrativeFactorConfig.intervalMs)
                ? 1 : 0;
        }

        return factors;
    }

    // ═══════════════ TPA 回填接口（static，母版 :2746-2780 同款；回迁批 4）═══════════════

    /**
     * 回填某 token 的 as-of 持仓因子到内存缓存（TokenPositionAnalyzer 触发分析后调用）。
     * buildFactorMap 直接读 _holdingFactorOverrides（触发前 null 不注入）。
     */
    static setHoldingFactors(tokenAddress, factors) {
        if (!tokenAddress) return false;
        if (!_holdingFactorOverrides) _holdingFactorOverrides = new Map();
        _holdingFactorOverrides.set(tokenAddress, factors);
        return true;
    }

    /** 取 setHoldingFactors 回填的 as-of 持仓因子（无则 null）。 */
    static getHoldingFactors(tokenAddress) {
        return (_holdingFactorOverrides && _holdingFactorOverrides.get(tokenAddress)) || null;
    }

    /**
     * 冻结某 token 的 retention（大户走没走）基准。TokenPositionAnalyzer._analyze 触发后调用
     * （与 setHoldingFactors 同位点）。buildFactorMap 每 tick 据 state._walletNetTokens 对
     * zhuangAddresses 求和得 netZ@T → retention=netZ@T/netZAtDecision。
     * @param {string} tokenAddress
     * @param {{zhuangAddresses:string[], netZAtDecision:number}} basis
     *   zhuangAddresses = 大户集（独立从 _walletMaxNetTokens 枚举 maxNet>0 + classifyHolder='zhuang'，
     *   含触发前已清仓的；D 冻结）；netZAtDecision = Σ 大户 maxNetTokens（建仓峰值净持仓和，>0 才有 retention）
     */
    static setRetentionBasis(tokenAddress, basis) {
        if (!tokenAddress) return false;
        if (!_retentionBasis) _retentionBasis = new Map();
        _retentionBasis.set(tokenAddress, basis);
        return true;
    }

    /** 取 setRetentionBasis 冻结的 retention 基准（无则 null）。 */
    static getRetentionBasis(tokenAddress) {
        return (_retentionBasis && _retentionBasis.get(tokenAddress)) || null;
    }

    // ═══════════════ 叙事触发模型回填接口（static，2026-10-17 买腿重构 C84）═══════════════

    /**
     * 回填/更新某 token 的叙事分析状态（引擎 _narrativeTriggerStates 单写者；回测
     * preload 后逐 token 注入）。整包替换——调用方持全量状态。
     * @param {string} tokenAddress
     * @param {{rating: number|null, rounds: number, completedAt: number|null,
     *          accountOnly: boolean, inFlight: boolean, category?: string|null}} snapshot
     *   rating ∈ null|1|2|3|9；completedAt=最后一轮完成时刻 ms（retryDue 判据）；
     *   accountOnly=语料只有账号入口（isAccountOnlySource，重试域判据）；
     *   inFlight=引擎分析进行中（抑制重复发起）；
     *   category=叙事类型（token_category 同形状，narrativeCategory 因子源）；
     *   superIp/recognizedEntitySlogan=C88 超级IP两标签（1/0/null 三态，narrativeSuperIp/
     *   narrativeSuperIpSlogan 因子源；回测 preload 由 stage1/stage2 JSON 零列推导注入）
     */
    static setNarrativeFactors(tokenAddress, snapshot) {
        if (!tokenAddress) return false;
        if (!_narrativeFactorOverrides) _narrativeFactorOverrides = new Map();
        _narrativeFactorOverrides.set(tokenAddress, snapshot);
        return true;
    }

    /** 取回填的叙事分析状态（无则 null）。 */
    static getNarrativeFactors(tokenAddress) {
        return (_narrativeFactorOverrides && _narrativeFactorOverrides.get(tokenAddress)) || null;
    }

    /** 清除某 token 的叙事回填（引擎 stop 清单例，防同进程下一实验继承）。 */
    static clearNarrativeFactors(tokenAddress) {
        if (!_narrativeFactorOverrides) return false;
        return _narrativeFactorOverrides.delete(tokenAddress);
    }

    /**
     * 重试轮参数（引擎 ctor 注入 narrativeRetry.intervalMs/maxAnalyses；回测
     * {intervalMs: Infinity, maxAnalyses: 0} → retryDue 恒 0=禁重试）。部分注入——
     * 未带键保持现值（⚠ 引擎侧须两键全传：同进程先跑回测（Infinity/0）再起实时
     * 引擎时，部分注入会继承回测值——实时引擎用 getNarrativeFactorDefaults 补全）。
     */
    static setNarrativeFactorConfig(cfg) {
        if (!cfg) return;
        if (typeof cfg.intervalMs === 'number' && (cfg.intervalMs === Infinity || cfg.intervalMs > 0)) {
            _narrativeFactorConfig.intervalMs = cfg.intervalMs;
        }
        if (Number.isInteger(cfg.maxAnalyses) && cfg.maxAnalyses >= 0) {
            _narrativeFactorConfig.maxAnalyses = cfg.maxAnalyses;
        }
    }

    /** 重试轮参数默认值（单一真相源：引擎侧补全两键时读，防字面量漂移）。 */
    static getNarrativeFactorDefaults() {
        return { ..._NARRATIVE_FACTOR_DEFAULTS };
    }
}

// 静态挂载：单测用（FACTOR_PARAM_DEFAULTS 默认值对拍；实验级覆盖走 fourmemeWs.factorParams）
FourMemeFactorAggregator.FACTOR_PARAM_DEFAULTS = FACTOR_PARAM_DEFAULTS;

module.exports = FourMemeFactorAggregator;
