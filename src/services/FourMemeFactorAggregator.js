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
 *   - fdv/marketCap → currentPriceBnb × totalSupply（TokenCreate 事件；T84 起 BNB 域，
 *     2026-10-28 全量纲切换裁定）
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
 *   3. USD 输出经 state.lastImpliedBnbUsd（price/tvl/txVolume 族），市值族 T84 起 BNB 域
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
 * `narrativeRating == 2 OR == 3`）→ GMGN 第二层。earlyTrades* 族（C84 同批迁入 FA
 * 出生锚定 90s 冻结窗）**已于 T71（2026-10-26）整族删除**——冻结窗对慢热票结构性
 * 失真（智子/币安1986 案），净买/路由门换全史实时键 tradesNetBuyRatio/tradesRouterPct；
 * legacy 腿 preBuy 语境仍走 EarlyParticipantCheckService DB 版（DB 宿主独立存续）。
 * 与 legacy DB 版的口径 delta（有意，台账 C84）：
 *   delta① 照计语义：无 price_outlier=false / price_usd 非空过滤（与 tradeCount/
 *     _recentTicks/activityEvents 同口径）——毒价行/零 USD 行照样入窗；
 *   delta② 出生锚=firstTickAt（首 tick 到达序 write-once）而非 launchAt（TokenCreate
 *     块时间）；两锚正常相差 <1s，late-discovered 票本就被 tokenAgeSec<90 门拦；
 *   delta③ 出窗冻结=完整首窗终值（观测友好），legacy uncovered=0 值放行——新链路
 *     条件自带 tokenAgeSec<90，出窗票不产生信号，两语义无行为交集。
 * 叙事注入与因子键均为 buildFactorMap 无条件字面量（getFactorKeys 探针
 * 自动收录；未回填 rating=null → 条件恒 false fail-closed）。
 */

const EventEmitter = require('events');
const TrendDetector = require('../trading-engine/TrendDetector');
const HolderTrendDetector = require('../trading-engine/HolderTrendDetector');
const { HOLDING_FACTOR_KEYS, FA_TPA_KEYS } = require('./tpa-factor-keys');
// 公共聚合路由地址集（GMGN 等）——_walletRoutedBuyBnb（GMGN 用户判定）的写入判据，
// 与 EarlyParticipantCheckService routerPct 因子同层同源（trader=msg.sender 层）
const { AGGREGATOR_ROUTER_ADDRS } = require('../trading-engine/pre-check/aggregator-routers');
// PROTOCOL_ADDRS import 已随 earlyTrades* top1 剔除删除（T71 2026-10-26）——FA 内
// 已无消费者；legacy preBuy 层自持引用（sniper-detector 单一真相源不动）

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
    graduationAnchorBnb: 72,     // 毕业市值锚（BNB 口径，four.meme 专用）：four.meme 毕业市值 $50,585；
                                 // 0x47da 实测断流前 max 7.21e-8×1e9=72.1 BNB 吻合。progress=priceBnb*totalSupply/此值
    // flap 资金口径毕业进度（2026-10-24 豆皮/水案裁定，替换旧价格锚）：旧锚=首市值×12.5
    // （R=毕业市值/首市值恒比假设）实证不成立——豆皮/水 R=9.0/9.4，progress 峰值仅
    // 0.716/0.754，0.9/0.98 毕业臂全程够不着（死臂）。资金口径=池净入金
    // Σ(0.98×buy) − Σ(1.0204×sell) ÷ 毕业阈值：BNB 盘四池回归精确（16.3246 买入 →
    // 15.9981 毕业线），quote 盘 BNB 域累积含 ±3% 汇率换算噪声
    graduationFundsBnb: 15.99808481559237, // flap 毕业池资金阈值（BNB 域）：182 wss_events 实测
                                 //   BNB 盘毕业 funds 恒此值（14 位小数内一致）；per-quote 学习值优先
    graduationBuyKeep: 0.98,     // 买腿入池系数：flap 1% 协议费+1% 曲线费 → 池实收 0.98×buy（实测精确）
    graduationSellTake: 1.0204,  // 卖腿出池系数：池实付 1.0204×sell（实测精确，含出池费）
    bar5mRsiMaxBars: 30,         // 5m bar 收盘环形窗（30 根=2.5h；rsi9Bar5mRt 原料）
    riseMinTicks: 8,             // 针臂稀疏窗门（5min 窗内可靠 tick 数 < 此数 → null fail-closed；
                                 //   rich-js minTicks=窗口分钟数，tick 秒级更密故起步 8）
    riseMinElapsedMin: 0.1,      // 针臂速度分母下限（分钟；rich-js 钳 1min 是 1m bar 粒度，tick 秒级可小；
                                 //   谷=最新 tick 时防除零）
    // ── 交易活跃度滑窗（2026-10-15，取代同日删除的 cycle 分桶路由）──
    activityWinMs: 10000,        // act* 8 键窗口（用户裁定：新发布 Meme，10s 已不小）；
                                 //   原料 _activityEvents 事件环，读点 _activityFactors 单趟派生
    netBuyWinTrades: 20,        // tradesNetBuyRatioShortWin 净买短窗笔数（T87 2026-10-28
                                 //   0xdf7a 案用户裁定「10 秒窗口换交易数窗口——慢热票 10s 内
                                 //   无行情」：T77 时间窗的 null fail-closed 对慢热票缺证据；
                                 //   换最近 N 笔尾窗。N=20=两案票决策帧最强（MUSK2028 87.1/
                                 //   0xdf7a 82.0）+全量池 197 活跃票 peak≤0 最低 11%；N=10 含
                                 //   集中卖压形状（0xdf7a fire 帧 -531）排除）；复用
                                 //   _activityEvents 事件环，裁剪须条数保底（见 _pruneActivityEvents）
    holderDustBnb: 0.015,       // holdersExDust 尘埃门 BNB 值（T98 2026-10-29 用户裁定
                                 //   「极小持仓者剔除——这样不会让假活跃票进门」；同日追裁定
                                 //   0.002→0.015——Jenner 0xa3362c21…7777 实查 16 钱包仅 4 个
                                 //   ≥0.2 BNB、$10 以下钱包 7 个，$10.5 档以下不算有效承接）：
                                 //   净持仓按首可靠价折算 < 此值的钱包不算持有人；
                                 //   显式 0=不剔
                                 //   （holdersExDust 恒等 holders）。factorParams 可覆盖
    netBuyWinLongTrades: 100,   // tradesNetBuyRatioLongWin 净买长窗笔数（T88 2026-10-28
                                 //   用户裁定「全量买卖比没必要，检测一个趋势」——全史键
                                 //   tradesNetBuyRatio 断代换最近 M 笔尾窗；M=100 用户拍板
                                 //   （「先定 100 吧」——20:100=5 倍配比平衡「两个窗差异
                                 //   过大」的直觉质疑）。回放三套数据：叙事通过池 234 活跃
                                 //   票 M=50~300 六档买点完全同帧（197/197 满足早 0 晚 0——
                                 //   tN 票龄中位 7 笔，M≥票龄即全史）=买点行为零代价实证；
                                 //   fire 302 决策帧翻车面 50/80/100/150/300=15/5/4/2/0
                                 //   （翻车票全为近期砸盘+长史强净比的第二波大赢家 peak
                                 //   235-487%，n=495~1485 长命票）=已知接受的 1.3% 误拦面；
                                 //   全量池 208 纯新增全档=0（换轨不创造新买点）。语义分工：
                                 //   短窗 20=即时流、长窗 100=主趋势；M>n 时长窗=全史值
                                 //   （中小票 bit 一致最小干预）；重启自愈=M 笔后口径恢复
                                 //   （全史键重启清零后永久「重启后史」）
    // ── 同 block 首买簇捆绑检测（2026-10-16 BITCAT 案）──
    bundleWinMs: 10000,          // bundle* 6 键窗口（对齐 act*；扫描 Phase 2 对比 10s/30s/60s
                                 //   后再定默认值）；原料 _bundleEvents/_blockBuyAgg/_circTokens
    // ── uniform 尘埃门（launch* 复用——earlyTrades* 族已随 T71 2026-10-26 删除）──
    earlyUniformDustBnb: 0.01,   // uniform 簇尘埃门（launch uniform 等额臂唯一消费者）
    // ── launch* 出生锚定捆绑簇（2026-10-17 Agentum 案方向 C：10s 滑窗在 fire+61s 时
    //    创建块捆绑簇已滑出（Konasu 时序洗白同根因），出生锚定窗让出生期指纹在任意
    //    迟到 fire 时刻可见；窗宽 90s）──
    launchBundleWinMs: 90000,    // 出生窗宽（首买簇累计+冻结）
};

// 出生窗首买 map 防御帽（launch 系复用；对倒作业票 90s 内 <1 千钱包；超帽只停
// 新钱包入册，已入册钱包照常更新——尾部批发钱包丢粒度，保内存上限；
// earlyTrades* 族删除〔T71 2026-10-26〕后 launch* 是唯一消费者）
const _LAUNCH_MAX_WALLETS = 5000;

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
// C162 零语料臂（corpusEmpty）节奏键：间隔 10s/上限 10 轮=100s 窗（2026-10-25
// 感染者案用户裁定收紧：60s 固定节奏下宣告推 33s 到位仍要等满 60s，抢跑票买点
// 白丢 ~40s；原 60s×8=8 分钟窗的「宣告推晚 4min」形状不再覆盖，翻正机会收窄）；
// 与 accountOnly 臂（10s×3）互斥分流，实验级 fourmemeWs.narrativeRetry.noCorpus* 可覆盖
const _NARRATIVE_FACTOR_DEFAULTS = { intervalMs: 10000, maxAnalyses: 3, noCorpusIntervalMs: 10000, noCorpusMaxAnalyses: 10 };
let _narrativeFactorConfig = { ..._NARRATIVE_FACTOR_DEFAULTS };
// C166 账号信息复检注入（引擎 AccountHealthMonitor 回填；_narrativeFactorOverrides
// 同款模块级单例——无回填恒 null → 卖臂条件 `issuerAccountState == 'deleted'` 恒
// false = fail-closed 不误卖；引擎 stop 逐 token 清）
let _accountHealthOverrides = null;
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

        // flap 资金口径毕业阈值学习表（2026-10-24）：quoteToken(小写|null=BNB盘) → 毕业时刻
        // fundsBnb 快照，noteGraduation write-once 首次毕业定格（实测同 quote 恒值）。
        // gang 不入此表——阈值由 Created gradAmt 终态携带（state.graduationThresholdBnb）
        this._gradFundsThresholds = new Map();

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
        if (info.platform) state.platform = info.platform; // 平台维度（flap/gang 资金口径毕业进度/阈值学习门用；write-once 语义，平台不变）
        // gang 毕业阈值 BNB 化（2026-10-27 gang 接入）：Created gradAmt 事件硬性携带
        //（WNB 盘=gradAmt/1e18 实测恒 15；非 WNB 盘 collector refPair/三级源换算一次，
        // 失败传 null → _graduationFundsThreshold 侧 ?? 15 兜底）。set-once：重复
        // registerToken（回测 preload/重启恢复）同值幂等，null 不覆盖已有值
        if (state.graduationThresholdBnb == null
            && typeof info.graduationThresholdBnb === 'number'
            && info.graduationThresholdBnb > 0) {
            state.graduationThresholdBnb = info.graduationThresholdBnb;
        }
        this._stats.tokensRegistered++;
    }

    /**
     * flap/gang 资金口径毕业进度分母：
     * - gang（2026-10-27 接入）：state.graduationThresholdBnb（Created gradAmt 事件终态
     *   携带，registerToken set-once）?? 15（WNB 盘 gradAmt 实测恒 15e18；协议常量
     *   字面量非调参）。无需学习——gradAmt 在 Created 硬性携带，非 WNB 盘换算失败才落 null。
     * - flap：per-quote 毕业事件学习值（noteGraduation write-once）?? 全局常量
     *   graduationFundsBnb。quote 盘阈值=毕业时刻换算 BNB 域快照，吸收 per-quote
     *   系统性汇率偏移。
     * four.meme 不用资金口径（72 市值锚原路径）。
     */
    _graduationFundsThreshold(state) {
        if (state.platform === 'gang') {
            return state.graduationThresholdBnb ?? 15;
        }
        const learned = this._gradFundsThresholds.get(state.quoteToken);
        return (learned != null && learned > 0) ? learned : this._fp.graduationFundsBnb;
    }

    /** flap 资金口径毕业进度（2026-10-24）：池净入金 / 毕业阈值。零价格依赖（quote 盘
     *  断价也出值——价格锚路径须 _relPriceBnb>0，断流票读 null）；累积器进程内存态，
     *  重启后从 0 起（跨重启池进度低估 → 毕业臂可能不触发，live 兜底=毕业事件人工/
     *  PCS 处置，virtual/backtest=毕业全清链）。 */
    _graduationFundsProgress(state) {
        const threshold = this._graduationFundsThreshold(state);
        return threshold > 0 ? state.poolInflowBnb / threshold : null;
    }

    getTrackedTokens() {
        return [...this._states.keys()];
    }

    getTokenState(tokenAddress) {
        return this._states.get(tokenAddress) || null;
    }

    // getEarlyTopBuyers（C89 GMGN 钱包画像层数据口）已随 earlyTrades* 族删除（T71
    // 2026-10-26）——early 出生窗原料整族退役，gwp 引擎接线同步删除；将来重启 gwp
    // 层须换全史数据源（台账 T71 记档）

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
     * 「是否启用 + 名单」——空 Set 时因子恒 0（2026-10-22 用户裁定去 NULL：未启用
     * =无著名钱包持仓，最低 0，与放行语义一致）。schema 不符（wallets 非数组）才抛错。
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
            // 人工锚定名单（2026-10-26 0x2fe5 团伙案用户裁定）：铁指纹镜像对——pair 判据
            // 咬得住但 size=2 被 minSize 剪掉 / 新号 pair 数据不足。build --commit 不覆盖
            // 该文件（famous-copy-wallets 同款惯例）；缺失=无人工锚定（常态），schema 错才抛
            const manualPath = path.resolve(__dirname, '..', '..', 'config', 'rosters', 'sybil-clusters-manual.json');
            let manualCount = 0;
            try {
                const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
                if (!manual || typeof manual !== 'object' || !Array.isArray(manual.wallets)) {
                    throw new Error(`[FourMemeFA] loadSybilClusters: manual 名单 schema 不符（${manualPath}）`);
                }
                for (const w of manual.wallets) {
                    if (typeof w === 'string' && w) { _sybilClusterWallets.add(w.toLowerCase()); manualCount++; }
                }
            } catch (e) {
                if (e.code !== 'ENOENT') throw e;
            }
            this._logInfo(`加载 sybil 大簇名单: ${_sybilClusterWallets.size} 个（主名单 ${parsed.wallets.length} + 人工锚定 ${manualCount}，${rosterPath}，generatedAt=${parsed.generatedAt || '?'}）`);
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

        // ── flap/gang 毕业资金口径累积（2026-10-24 豆皮/水案立、2026-10-27 gang 接入）：
        //    每行恰好计一次（processTick 每行单调；chainLate 只跳价格接受链不跳流量）。
        //    platform 回填兜底 registerToken 晚到（tick 平台字段先到）。尘 tick live 侧
        //    collector 门拦（不进 FA），回测侧原样喂 → 回测含尘 ~+0.2% 偏差（方向=回测
        //    略早触臂，接受）。gang 系数恒 1.0：tick 的 bnb_amount 已是事件费后净额
        //   （dw0=净入金/dw3=净收款），与 gradAmt 阈值同净额域，无 flap 0.98/1.0204
        //    经验系数问题──
        if (!state.platform && tick.platform) state.platform = tick.platform;
        if (tick.quote_token && !state.quoteToken) {
            state.quoteToken = String(tick.quote_token).toLowerCase();
        }
        if (state.platform === 'flap' || tick.platform === 'flap') {
            state.poolInflowBnb += isBuy
                ? bnbAmount * this._fp.graduationBuyKeep
                : -bnbAmount * this._fp.graduationSellTake;
        } else if (state.platform === 'gang' || tick.platform === 'gang') {
            state.poolInflowBnb += isBuy ? bnbAmount : -bnbAmount;
        }

        // ── 计数与地址统计（全量 tick，无 skip）──
        state.tradeCount++;
        if (isBuy) state.buyCount++; else state.sellCount++;
        state.totalBuyBnb += isBuy ? bnbAmount : 0;
        state.totalSellBnb += isBuy ? 0 : bnbAmount;
        if (isBuy) state.totalBuyTokens += tokenAmount; else state.totalSellTokens += tokenAmount;
        // 全史路由买入累计（tradesRouterPct 分子，T70）：恒累计无窗无冻结——买点时刻
        // 实时值，慢热票 90s 后散户路由买盘照样抬升占比（与 early 窗冻结版对照）
        if (isBuy && tick.trader_address
            && AGGREGATOR_ROUTER_ADDRS.has(String(tick.trader_address).toLowerCase())) {
            state.totalRouterBuyBnb += bnbAmount;
        }

        // （earlyTrades* trader 层原料已随 T71 2026-10-26 删除——冻结窗慢热票失真，
        //  消费键换 tradesNetBuyRatio/tradesRouterPct 全史实时对）

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
            if (state._relFirstPriceBnb === 0) { // 涨幅基准：首值冻结（priceBnb>0 由 priceReliable 保证，0 哨兵安全）
                state._relFirstPriceBnb = priceBnb;
                // T98 尘埃门固化：holderDustBnb ÷ 首可靠价 = token 域常量（此后不变——增量
                // 维护归纳等价的前提；按首价折算=「投入」口径，价格涨跌不扰动 holder 计数）。
                // 固化前已有钱包按 T=0 计数 → 此刻一次性全 map 重数纠正（每 token 一生恰一次
                // O(map)，P2a 每 tick 重数热点不受影响；_walletNetTokens 全史不裁 map 完整）。
                // holderDustBnb=0 显式关 → 不固化不重扫，恒等 holders
                if (this._fp.holderDustBnb > 0) {
                    state._holderDustTokens = this._fp.holderDustBnb / priceBnb;
                    state.holderCountExDust = 0;
                    for (const _net of state._walletNetTokens.values()) {
                        if (_net > state._holderDustTokens) state.holderCountExDust++;
                    }
                }
            }

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
                // T98 尘埃口径人气：净持仓 > 尘门（token 域常量）才算持有人——刷 holder
                // 的尘埃钱包（单笔刚过 tick 尘门的买入残余）不计入。与跨 0 边界同构：
                // 门常量 → 本钱包变动不影响他钱包跨界，归纳等价成立；T=0（未固化）时
                // _prev<=0&&_cur>0 与上式逐字一致 = 退化 holders fail-open（宁多计不放大
                // 门拦截力）。任意序重放收敛（判定只依赖单钱包净持仓序列）
                const _d = state._holderDustTokens;
                if (_prev <= _d && _cur > _d) state.holderCountExDust++;
                else if (_prev > _d && _cur <= _d) state.holderCountExDust--;
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

        // （earlyTrades* wallet 层原料已随 T71 2026-10-26 删除——perWallet/top1/uniform
        //  冻结窗族整族退役，见文件头注释与台账 T71）
        // launch 窗推进（首买 map 写点/分母累计均在后——触发出窗行不入窗）
        this._launchWindowAdvance(state, tick.timestamp);

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
                // 存量口径原料（2026-10-25 bundleClusterHoldCircPct，A/B 对比用户裁定）：
                // 全史 blk→买家 Set。刻意不与 _blockBuyAgg 的 wallets 共引用——该条目被
                // _pruneBundleEvents 滑窗淘汰后，同块晚到回推行会新建条目新 Set，同引用
                // 语义断裂；本 Map 全史不裁，Set.add 幂等 → 乱序回推收敛
                if (walletAddr) {
                    let _bw = state._blockBuyWalletsAll.get(blockNumber);
                    if (!_bw) {
                        _bw = new Set();
                        state._blockBuyWalletsAll.set(blockNumber, _bw);
                    }
                    _bw.add(walletAddr);
                }
            }
            // ── 等额买簇原料（T74 2026-10-26 0x8c4a…7777 对倒案）：amountKey → 同额买入
            //    钱包 Set，跨块金额维度聚合（不依赖 blockNumber）；含非首买买盘行（分批
            //    分额是团伙形状）；尘埃门 earlyUniformDustBnb 以下不入桶（launch 等额臂
            //    同款参数——0.0001 级等额撞桶纯噪声）；Set.add 幂等 → defer 乱序回推收敛。
            //    ★T78（2026-10-27 历史回放反证）：amountKey=四位舍入（0.0001 BNB 精度），
            //    原 toFixed(6) 严格相等对微差规避形状结构性失效——本案 25 档 distinct 金额
            //    11 个间隔 <0.001（0.16471/0.16474 式刻意微差），6 位键下 fire 时三档簇
            //    (0.1647×6/0.2470×6/0.1314×3) 全部 size<3 不成桶=键对案票恒 0；四位舍入
            //    三档全中（回放 scripts/replay-observation-factors.cjs 实证）。浮点安全：
            //    Math.round(b*1e4)/1e4 数值归一后 toFixed(4)，规避 0.1+0.2 类累加误差形状 ──
            if (walletAddr && bnbAmount >= this._fp.earlyUniformDustBnb) {
                const _ek = (Math.round(bnbAmount * 1e4) / 1e4).toFixed(4);
                let _ew = state._evenBuyBuckets.get(_ek);
                if (!_ew) {
                    _ew = new Set();
                    state._evenBuyBuckets.set(_ek, _ew);
                }
                _ew.add(walletAddr);
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
                    // 首买晚到覆盖 → defer 乱序序无关收敛；_LAUNCH_MAX_WALLETS 帽。
                    // 窗推进已在上文先行——触发出窗行不入 map）
                    if (!state._launchWindowClosed
                        && (state._launchFirstBuys.size < _LAUNCH_MAX_WALLETS
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
        const prevPos = state._positions.get(positionKey) || null;
        const pos = {
            buyPriceBnb: anchorBnb,
            buyPriceUsd: buyState.buyPriceUsd || null,
            buyTime: buyState.buyTime || Date.now(),
            buySignalAt: buyState.buySignalAt ?? buyState.buyTime ?? null,
            buyExecutedPriceBnb: buyState.buyExecutedPriceBnb ?? null,
            // T84 入场市值锚（2026-10-28 早期叙事臂）：本仓**首买** fire 价口径市值
            // （anchorBnb × totalSupply，BNB 域与 marketCap 同批）——卖腿豁免臂
            // `entryMarketCap >= X`（T79 地板/衰竭腿免误杀）与早期臂专属腿
            // `entryMarketCap < X` 域限定的判据源。补买不覆盖（臂身份=首买锚定，
            // clearBuyState 全清后才重置）；锚/总量缺失 → null fail-closed（豁免臂
            // 恒 false=原腿照管、专属臂恒 false=不触发，两侧退回现行卖腿保护）；
            // 重启恢复锚点继承 buyPriceBnb 的「重启后首价近似」语义
            entryMarketCapBnb: (prevPos && prevPos.entryMarketCapBnb != null)
                ? prevPos.entryMarketCapBnb
                : (anchorBnb > 0 && state.totalSupply > 0 ? anchorBnb * state.totalSupply : null),
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

    /**
     * 毕业事件登记（2026-10-24 资金口径，取代旧 markGraduated——生产调用点已全迁）：
     * 置 graduated + 学习 per-quote 毕业资金阈值。
     * 学习门=state.platform==='flap'（four.meme 毕业金额口径不同混学会污染 BNB 键
     * 阈值；gang 也不学——gradAmt 在 Created 事件硬性携带无需学习，混入反而污染
     * 共享阈值表）+ fundsBnb>0（quote 盘换算不可得时 collector 传 null=诚实无值不学）。
     * write-once 首次毕业定格（同 quote 实测恒值；重复毕业事件幂等）。state 缺失
     * no-op（回测「事件先于首 tick」边缘由消费点后补）
     */
    noteGraduation({ token, fundsBnb, quoteToken } = {}) {
        const state = this._states.get(token);
        if (!state) return;
        state.graduated = true;
        if (state.platform !== 'flap' || !(Number(fundsBnb) > 0)) return;
        const key = quoteToken ? String(quoteToken).toLowerCase() : null;
        if (!this._gradFundsThresholds.has(key)) {
            this._gradFundsThresholds.set(key, Number(fundsBnb));
        }
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
            quoteToken: null,      // flap 非 BNB 计价盘 quote（write-once，tick 捕获）：PCS 二跳路由/毕业阈值学习键
            poolInflowBnb: 0,      // flap/gang 毕业资金口径累积器（flap: Σ(0.98×buy)−Σ(1.0204×sell)；gang: Σbuy−Σsell 净额直计，BNB 域）
            graduationThresholdBnb: null, // gang 毕业阈值 BNB 化（registerToken set-once；flap 不用——学习表路径）

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
            totalRouterBuyBnb: 0, // 全史聚合路由买入 BNB（tradesRouterPct 分子；T70 与 early 冻结版对照的实时层）
            uniqueTraders: new Set(),
            _walletNetTokens: new Map(), // wallet(sender||trader) → 净持仓（holders/holderTrend/P 组集中度原料；GMGN 合并修正）
            _walletMaxNetTokens: new Map(), // wallet → 建仓峰值净持仓（running max 单调不减；TPA retention 基准，二期 2026-10-10 键域随 TPA 整链切 sender）
            _walletRoutedBuyBnb: new Map(), // wallet → 本盘经聚合路由（GMGN 等）买入 BNB（TPA GMGN 用户判定原料，2026-10-11 用户裁定；写入判据=trader 层 AGGREGATOR_ROUTER_ADDRS）
            _smartBotBuyBnb: new Map(), // wallet → 名单内累计可靠买额 BNB（回迁批 3.3；只累不减——参与留痕）
            holderCount: 0,
            _holderDustTokens: 0,  // T98 尘埃门 token 域常量：holderDustBnb ÷ 首可靠价，首价
                                   // 冻结时固化（此后不变=增量维护归纳等价前提）；0=未固化
                                   // （无可靠价票/显式关门）→ 口径退回 holders fail-open
            holderCountExDust: 0,  // 净持仓 > _holderDustTokens 的钱包数（T98 跨尘门边界 ±1
                                   // 增量维护，与 holderCount 跨 0 同构同点）

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
            _blockBuyWalletsAll: new Map(), // blk → 该块全部买家钱包 Set（bundleClusterHoldCircPct
                                     //   分子原料，2026-10-25 A/B 对比用户裁定存量口径）；全史
                                     //   不裁、刻意不进 _pruneBundleEvents（_blockBuyAgg 条目被
                                     //   滑窗淘汰后晚到回推行会新建条目，同引用语义断裂——本 Map
                                     //   独立维护，Set.add 幂等 → defer 乱序序无关收敛）；含非首买
                                     //   买盘行，wallet 非空才入 Set（null wallet 无法归簇）
            _evenBuyBuckets: new Map(),  // amountKey(6 位小数) → 同额买入钱包 Set（evenCluster*
                                     //   三键原料，T74 2026-10-26 0x8c4a…7777 对倒案观察键）；
                                     //   跨块金额维度聚合（对 bundle 单块口径的分批稀释免疫）；
                                     //   全史不裁、Set.add 幂等 → defer 乱序序无关收敛
            _circTokens: 0,          // 流通 = Σ买入 − Σ卖出 token（净流出池子筹码；全史增量累计
                                     //   永不裁剪，加减法交换律 → defer 乱序收敛；creator 初始持仓
                                     //   未经买入不计入——口径与 BITCAT 重放对拍一致 63.3%）

            // （earlyTrades* 8 键原料已随 T71 2026-10-26 删除——冻结窗族整族退役）

            // ── launch* 4 键原料（2026-10-17 Agentum 案方向 C：出生锚定捆绑簇——10s 滑窗
            //    在迟到 fire 下结构性漏创建块簇；同块臂+跨块等额臂，出窗冻结 _launchFrozen）──
            _launchWindowClosed: false, // 出窗冻结标记（冻结后首买行照推 _walletFirstBuyTs 但不入 map）
            _launchFrozen: null,        // 出窗冻结的四键输出（_launchBundleFactors 直读）
            _launchFirstBuys: new Map(), // wallet → 首买行 {ts, blk, li, bnb, trader}（窗内；
                                         //   覆盖式 min 替换保最早=defer 乱序收敛；_LAUNCH_MAX_WALLETS 帽）
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
     * act* 原料裁剪（2026-10-15 交易活跃度滑窗）：摊销——长度越过 floor+32
     * （floor=max(netBuyWinTrades, 32)）且头部已滑出 2×activityWinMs 才批量
     * splice，且**环尾 floor 笔永不裁**（maxCut 上限；T87 笔数窗原料无时间界：
     * 稀疏票尾 N 笔可跨数分钟，纯时间界会把慢热票证据裁穿——每 tick 裁头部后
     * 环恒剩 ~2×activityWinMs 内的行）；act* 读点按 ts 过滤，保底滞留的旧行
     * 天然不可见无损。32 余量：defer 乱序回推行晚到数秒仍落余量带不误删。
     */
    _pruneActivityEvents(state, now) {
        // T88 起长窗 100 笔入 floor（max(short, long, 32)）——纯时间界会把稀疏票
        // 尾窗证据裁穿；act* 读点按 ts 过滤对滞留旧行天然不可见，多留无副作用
        const evts = state._activityEvents;
        const floor = Math.max(this._fp.netBuyWinTrades, this._fp.netBuyWinLongTrades, 32);
        if (evts.length <= floor + 32) return;
        const cutoff = now - 2 * this._fp.activityWinMs;
        let i = 0;
        const maxCut = evts.length - floor;
        while (i < maxCut && evts[i].ts < cutoff) i++;
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
     * 净买窗三键（T77 2026-10-27 MUSK2028 案立 10s 时间窗；T87 2026-10-28 换轨「最近
     * N 笔」短窗=netBuyWinTrades 20——慢热票 10s 内常无行情，时间窗 null fail-closed
     * 恰好掐掉目标形状；T88 2026-10-28 全史键 tradesNetBuyRatio 断代换长窗
     * netBuyWinLongTrades 100——用户裁定「全量买卖比没必要，检测一个趋势」，全史被
     * 前期砸盘卖量永久拖低（MUSK2028 砸盘后真恢复票全史 467s 才过线=买局部顶）。
     *   公式同款（Σ买−Σ卖）÷Σ买×100 保留 2 位：ShortWin 取到达序环尾 20 笔、
     *   LongWin 取环尾 100 笔（factorParams 可覆盖）；环空 = null（缺证据
     *   fail-closed，`>= 40` 恒 false）——尾窗全卖 wb=0 = -100 有证据零值（T87 后
     *   三键 null 语义统一）；ShortWinBnb=短窗买量观察键（进场证据量审计，刻意
     *   不进条件串）。M>n 时长窗=全史值（中小票 bit 一致=换轨最小干预）。
     *   复用 _activityEvents 事件环（求和交换律 → defer 乱序回推无害；尾 N 笔按
     *   到达序=GMGN 路由行回推 1-3s 落环尾，竞速缝隙与 famous/act* 同款已知形状）。
     *   与时间无关——读点不消费 now（T87 换轨后零周期判定，天然免 Date.now）。
     */
    _netBuyWinFactors(state) {
        const evts = state._activityEvents;
        if (!evts.length) {
            return { tradesNetBuyRatioShortWin: null, tradesNetBuyShortWinBnb: 0, tradesNetBuyRatioLongWin: null };
        }
        let wb = 0, sellBnb = 0;
        for (let j = Math.max(0, evts.length - this._fp.netBuyWinTrades); j < evts.length; j++) {
            if (evts[j].buy) wb += evts[j].bnb; else sellBnb += evts[j].bnb;
        }
        let lb = 0, lsell = 0;
        for (let j = Math.max(0, evts.length - this._fp.netBuyWinLongTrades); j < evts.length; j++) {
            if (evts[j].buy) lb += evts[j].bnb; else lsell += evts[j].bnb;
        }
        return {
            tradesNetBuyShortWinBnb: +wb.toFixed(4),
            tradesNetBuyRatioShortWin: wb > 0
                ? parseFloat(((wb - sellBnb) / wb * 100).toFixed(2))
                : -100,
            tradesNetBuyRatioLongWin: lb > 0
                ? parseFloat(((lb - lsell) / lb * 100).toFixed(2))
                : -100,
        };
    }

    // _earlyWindowAdvance（出窗冻结）与 _earlyTradesFactors（10 键派生）已随 T71
    // 2026-10-26 删除——冻结窗族整族退役（慢热票失真，消费键换 trades* 实时对；
    // 消费口径历史见台账 C84 立案/T71 退役）

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
     *   bundleClusterHoldCircPct —— 全史 max over 块(该块买家集合**当前正净持仓**合计) ÷
     *                              读取时刻累计流通 ×100（2026-10-25 两口径 A/B 对比用户
     *                              裁定：替换 bundleClusterSharePct 的门位——流量口径拦
     *                              「10s 内簇主导买盘」误伤快进快出交易簇，存量口径拦
     *                              「簇真持仓≥阈值」）。与 maxBlockBuyCircPct 同分子分母
     *                              口径，唯一区别=选块标准：本键按当前净持仓合计最大选块
     *                              （恒 ≥ maxBlockBuyCircPct——后者只扫毛买入最大块）；
     *                              买后清仓的簇本键回落（交易簇放行），真囤簇持续可见
     *                              （对真囤簇更晚放=已知盲区，用户裁定接受）。原料
     *                              _blockBuyWalletsAll 全史不裁（不进 prune）；无买入块/
     *                              流通≤0 → 0（有证据零值非 null）。
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
    _bundleClusterFactors(state, now, circDen, out) {
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
        const circPct = maxBlkHold > 0 && circDen > 0 ? maxBlkHold / circDen * 100 : 0;
        // bundleClusterHoldCircPct（2026-10-25 A/B 对比用户裁定替换流量口径门位）：全史 max
        // over 块(该块买家集合当前正净持仓合计) ÷ 累计流通 ×100。纯函数读取同上——原料
        // _blockBuyWalletsAll（全史不裁）× _walletNetTokens（当前净持仓），任一序收敛；
        // 数学恒 ≥ maxBlockBuyCircPct（后者只扫毛买入最大块，前者扫全部块取 max）
        // top2BundleClusterHoldCircPct（同日 AIFLY 0x0bae…7777 案用户裁定新增第二道门）：
        // 持仓口径最大两块买家集合【并集去重】当前正净持仓合计 ÷ 流通 ×100——同一钱包
        // 在两块复买只计一份筹码（相加口径对重叠钱包双计，可虚超 100%）；不足两块时
        // 并集退化为单块集 = top1 值。tie 任取其二（Map 插入序确定性，边缘形状阈值不敏感）
        // top3BundleClusterHoldCircPct（2026-10-26 同族第三块观察键）：最大三块并集
        // 去重；不足三块退化=top2；恒 ≥ top2 ≥ top1（并集域单调扩）
        let maxAllBlkHold = 0, _top2Sum = -1, _top3Sum = -1;
        let _top1Ws = null, _top2Ws = null, _top3Ws = null;
        for (const _ws of state._blockBuyWalletsAll.values()) {
            let _s = 0;
            for (const _w of _ws) {
                const _v = state._walletNetTokens.get(_w);
                if (_v > 0) _s += _v;
            }
            if (_s > maxAllBlkHold) {
                _top3Sum = _top2Sum; _top3Ws = _top2Ws;
                _top2Sum = maxAllBlkHold; _top2Ws = _top1Ws;
                maxAllBlkHold = _s; _top1Ws = _ws;
            } else if (_top1Ws !== null && _s > _top2Sum) {
                _top3Sum = _top2Sum; _top3Ws = _top2Ws;
                _top2Sum = _s; _top2Ws = _ws;
            } else if (_top1Ws !== null && _s > _top3Sum) {
                _top3Sum = _s; _top3Ws = _ws;
            }
        }
        const holdCircPct = maxAllBlkHold > 0 && circDen > 0
            ? maxAllBlkHold / circDen * 100 : 0;
        let top2UnionHold = maxAllBlkHold;
        if (_top2Ws) {
            for (const _w of _top2Ws) {
                if (_top1Ws.has(_w)) continue;
                const _v = state._walletNetTokens.get(_w);
                if (_v > 0) top2UnionHold += _v;
            }
        }
        let top3UnionHold = top2UnionHold;
        if (_top3Ws) {
            for (const _w of _top3Ws) {
                // 事故修复（2026-10-26 v39 崩溃案）：恰两块票第二块持仓和=0（买家全清仓）时，
                // 级联第三分支 `_s(0) > _top3Sum(-1)` 恒真——零和块抢占 _top3Ws 而 _top2Ws 仍为
                // null（T68 现场堆栈 2400:48 null has 崩进程×2：v38@3914763/v39 首启 TickDebouncer
                // 无 catch 直接 uncaught）。null 安全守卫零语义变化：零和块买家净持仓非正，
                // `_v > 0` 守卫下占哪个槽并集分子贡献都是 0
                if (_top1Ws.has(_w) || (_top2Ws !== null && _top2Ws.has(_w))) continue;
                const _v = state._walletNetTokens.get(_w);
                if (_v > 0) top3UnionHold += _v;
            }
        }
        const top2HoldPct = top2UnionHold > 0 && circDen > 0
            ? top2UnionHold / circDen * 100 : 0;
        const top3HoldPct = top3UnionHold > 0 && circDen > 0
            ? top3UnionHold / circDen * 100 : 0;
        // 等额买簇三键（T74 2026-10-26 0x8c4a…7777 对倒案，纯观察不进条件串——阈值须
        // 票池分布裁定）：bundle 门按块/时间聚合，对「每块 2-3 钱包、跨 5 块 5 档金额」
        // 的分批形状结构性稀释（案发 fire 时 holdCircPct=32.4/top2=52.1/top3=69.7 全部
        // 擦线放行、sybil 名单只盖 8/30 新钱包 → 23.4），等额指纹一把聚合 81.6%。
        // 合格桶 = size≥3 金额桶（<3 钱包等额 = 常见巧合，launch 等额臂同款裁定）；
        // 分子 = 合格桶钱包【并集去重】当前正净持仓合计（复买跨桶只计一份筹码——
        // 与 top2/top3 并集口径同族）；分母 = _circTokens；证据在买入当刻可见，
        // 不受「延迟卖出」节奏化掩护（两栖判据软肋本案实证：fire 时仅 39%）。
        // 0 = 无合格桶 / 流通≤0（有证据零值非 null）
        let _evenUnion = null;
        let _evenGroups = 0;
        for (const _ws of state._evenBuyBuckets.values()) {
            if (_ws.size < 3) continue;
            _evenGroups++;
            if (!_evenUnion) _evenUnion = new Set();
            for (const _w of _ws) _evenUnion.add(_w);
        }
        let _evenHold = 0;
        if (_evenUnion) {
            for (const _w of _evenUnion) {
                const _v = state._walletNetTokens.get(_w);
                if (_v > 0) _evenHold += _v;
            }
        }
        const evenClusterHoldCircPct = _evenHold > 0 && circDen > 0
            ? _evenHold / circDen * 100 : 0;
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
            out.maxAllBlockHoldTokens = maxAllBlkHold;          // 存量口径因子分子（全块 max）
            out.top2UnionHoldTokens = top2UnionHold;            // top2 门分子（最大两块并集去重）
            out.top3UnionHoldTokens = top3UnionHold;            // top3 观察键分子（最大三块并集去重）
            out.evenUnionHoldTokens = _evenHold;                // 等额簇分子（合格桶并集去重正净持仓）
        }
        return {
            bundleClusterSize: size,
            bundleClusterSharePct: Math.round(sharePct * 10) / 10,
            bundleClusterAmountRatio: amountRatio,
            bundleClusterEvenGap: evenGap,
            bundleClusterSameTrader: Math.round(sameTrader * 10) / 10,
            maxBlockBuyCircPct: Math.round(circPct * 10) / 10,
            bundleClusterHoldCircPct: Math.round(holdCircPct * 10) / 10,
            top2BundleClusterHoldCircPct: Math.round(top2HoldPct * 10) / 10,
            top3BundleClusterHoldCircPct: Math.round(top3HoldPct * 10) / 10,
            evenClusterHoldCircPct: Math.round(evenClusterHoldCircPct * 10) / 10,
            evenClusterWallets: _evenUnion ? _evenUnion.size : 0,
            evenClusterGroups: _evenGroups,
        };
    }

    /**
     * launch* 出生窗推进（仅 wallet 层调用——原料全在 wallet 段）：
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
            // T84 入场市值锚（BNB 域）：卖腿条件键（豁免臂 `>= X` / 早期臂专属腿
            // `< X` 域限定）；getHolderFactors 同源输出
            entryMarketCap: pos.entryMarketCapBnb ?? null,
            // 拱形止损（2026-10-06）：持仓期峰值市值——峰价与 drawdownFromHighestSinceLastBuy
            // 同源（pos.highestPriceSinceBuyBnb，离群剔除链）；totalSupply 缺失 → null
            // fail-closed（拱形腿引用 null 比较恒 false 不触发，退回 stopLoss 段保护）。
            // T84 量纲切换（2026-10-28）：USD→BNB 域（×bnbUsd 移除，与 marketCap 同批）
            peakMarketCapSinceLastBuy: pos.highestPriceSinceBuyBnb > 0 && state.totalSupply > 0
                ? pos.highestPriceSinceBuyBnb * state.totalSupply
                : null,
            highestHolderCountSinceLastBuy: pos.highestHoldersSinceBuy,
            holderDrawdownFromHighestSinceLastBuy,
            // 回迁批 1 H 组（可靠价链口径）
            peakProfitPct: pos.peakProfitPct || 0,          // running max，_buildFactorMap 先推进后读取
            // T97 高点停滞减仓臂载体：距持仓期峰值秒数（峰推进在 priceAccepted 块=任意
            // 接受价轨：outlier 不推峰、尘 tick 不卡尘门——与 peakProfitPct 可靠价轨分轨，
            // 尘价新高可重置计时但不可武装；创新高归零重计）；now=buildFactorMap 入参（回测=虚拟时钟）
            secSincePeak: pos.highestPriceSinceBuyAt ? Math.max(0, (now - pos.highestPriceSinceBuyAt) / 1000) : null,
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
            entryMarketCap: null,
            highestHolderCountSinceLastBuy: null,
            holderDrawdownFromHighestSinceLastBuy: null,
            peakProfitPct: null,
            secSincePeak: null,
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

        // 近期砸速 %/s：crashSpeedWindowMs 窗内自「窗内高点」的下跌速度。无暴跌/横盘/
        // 反弹收复 → 0（2026-10-22 用户裁定去 NULL：无暴跌=速度 0，门侧裸比较
        // crashSpeedPctPerSec > -10 放行与原 IS NULL 臂逐输入等价）。
        // 分母钳 >= crashSpeedMinDtMs/1000 防同块毫秒连砸把速度放大到不可解释量级。
        // 现价用 _relPriceBnb（母版 currentPriceUsd 本身就是可靠价链产物）。
        let crashSpeedPctPerSec = 0;
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

        // 滚动净买窗两键（T77 MUSK2028 案 W=10s；OR 臂早进场载体）
        const netBuyWin = this._netBuyWinFactors(state);

        // ── T91a 流通分母口径修复（2026-10-28 孙权 0x3b1b…7777 top3=114% 案用户裁定
        //    「无论如何都要解决大于 100 的问题」）：全部 ÷circ 键的分母统一取
        //    max(_circTokens, Σ正净持仓)。病根：零买入纯卖出钱包（flap 税币接收方/
        //    初始筹码分配——Sell 事件在、Buy 事件永无）把 _circTokens=Σ买−Σ卖 压到
        //    低于真实在外筹码（孙权 40 纯卖钱包 Σ−226M≈22.6% 供给，fire 前拦截窗
        //    top3 虚高 114 拦 163s）。恒等式：所有 ÷circ 键分子只计正净持仓
        //    （top1/名单族/块簇并集/even 并集 ⊆ Σ正净持仓）→ 分母取 max 后恒 ≤100；
        //    正常票（无纯卖钱包）Σnet(买入钱包)=circ ⇒ Σ正 ≤ circ ⇒ max 恒取
        //    circ = 逐输入 bit 不变（four.meme 全量历史键值零扰动）。读取点单趟求和
        //    序无关（_walletNetTokens 任意序收敛前提同 top1），写点零改动 ──
        let _posNetSum = 0;
        for (const _v of state._walletNetTokens.values()) if (_v > 0) _posNetSum += _v;
        const _circDen = Math.max(state._circTokens, _posNetSum);

        // 同 block 首买簇捆绑检测（bundle* 6 键，2026-10-16 BITCAT 案；Phase 1 纯观察键）
        const bundle = this._bundleClusterFactors(state, now, _circDen);

        // 出生锚定捆绑簇（launch* 4 键，2026-10-17 Agentum 案方向 C；出窗后恒返回冻结快照）
        const launch = this._launchBundleFactors(state);

        // TOP1 持仓集中度（2026-10-16 用户裁定：门键，单巨鲸/团伙囤筹拦截；
        // maxBlockBuyCircPct 的存量替代——不受「早期流通分母小」的流量假象污染）：
        // 链上买入者最大净持仓 ÷ 流通(_circTokens)×100。口径注意：creator 预 mint 无
        // buy tick 不进 _walletNetTokens（测的是交易者集中度非全持有人）；负净持仓
        // （净卖者）自然出局；单趟扫 max 序无关（_walletNetTokens 任意序收敛前提）
        let _top1Net = 0;
        for (const v of state._walletNetTokens.values()) if (v > _top1Net) _top1Net = v;
        const top1HolderCircPct = _circDen > 0 ? _top1Net / _circDen * 100 : 0;

        // T92 top2 持有人门（2026-10-29 BI/Meecot 迟买案用户裁定「top2 块簇门改为
        // top2 持有者的门」）：前两大净持仓**合计** ÷ 同一 _circDen ×100——与 top1 同
        // 口径同分母，恒 ≥ top1HolderCircPct、恒 ≤100（T91a 恒等式：分子 ⊆ Σ正净 ⊆
        // 分母）。原料复用上方 top20 降序前缀 _nA/_nB（与 _top1Net 单趟扫 max 的
        // bit 一致性=top20 段注释不变量，仅消费值求和序无关）；<2 个正持仓持有人时
        // _nB=0 退化=top1 值（bundle top2「不足两块退化 top1」同款语义）；0=有证据
        // 零值非 null；负净持仓（净卖者）自然出局（_walletNetTokens 口径同 top1）
        const top2HolderCircPct = _circDen > 0 ? (_nA + _nB) / _circDen * 100 : 0;

        // 前 1/2 大净持仓占**总量**比例（2026-10-29 用户裁定「先新增占总量比例的因子
        // 再观察一段时间」，纯观察键不进条件串，阈值待票池分布裁定——T74/T76 先例）：
        // 与 top1/top2HolderCircPct 同分子（_top1Net / _nA+_nB），分母换 state.totalSupply
        // （TokenCreate 终态；flap/gang 恒 1e9）。动机：早期流通分母小，circ 口径占比
        // 天然虚高（Binancians 0x04c1…7777 早期窗 top1 50-63/top2 79-99 全因流通未铺开），
        // supply 口径度量「买到总量的多大比例」不受流通进度污染。supply 缺失(=0) → null
        // （marketCap/shares 族同惯例 fail-closed）；恒 ≤ 同名 circ 键（supply ≥ _circDen）；
        // 恒 ≤100（正净钱包持仓源自池内买入，Σ正净 ⊆ 池累计流出 ≤ supply）
        const top1HolderSupplyPct = state.totalSupply > 0 ? _top1Net / state.totalSupply * 100 : null;
        const top2HolderSupplyPct = state.totalSupply > 0 ? (_nA + _nB) / state.totalSupply * 100 : null;

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
            maxCopyWalletHolderCircPct = _circDen > 0 ? _maxCopyNet / _circDen * 100 : 0;
        }

        // 极著名钱包单钱包最大净持仓（2026-10-18 币安人生案用户点名）：与上键同公式
        // 换名单=用户点名集合（被跟单特别重，跟单大军放大控盘度）→ 单独更紧的门
        // （<15，主门 20 不变）。名单未加载/未启用（文件缺失或空集合）/无命中 → 0
        // （2026-10-22 用户裁定去 NULL「最低是 0」：0 < 15 放行与原 IS NULL 臂逐输入
        // 等价，条件串裸比较不再带 IS NULL 前置臂）。
        let famousCopyWalletCircPct = 0;
        if (_famousCopyWallets && _famousCopyWallets.size > 0) {
            let _famousNet = 0;
            for (const [addr, v] of state._walletNetTokens) {
                if (v > _famousNet && v > 0 && _famousCopyWallets.has(addr.toLowerCase())) _famousNet = v;
            }
            famousCopyWalletCircPct = _circDen > 0 ? _famousNet / _circDen * 100 : 0;
        }

        // sybil 大簇合计净持仓占比（2026-10-20 乌龟案用户裁定）：簇内钱包
        // （sybil-clusters.json 并集）**合计**净持仓 ÷ 流通 ×100——刻意合计非最大：
        // 单钱包口径对「四五个地址分仓的 sybil 簇」天然漏检（乌龟案四钱包 fire 时
        // 单钱包 10.4% 过 famous 15 门，合计 38.9%）。负净持仓（净卖者）不计入；
        // 名单未启用（文件缺失/空集合）或簇钱包无持仓 → 0（2026-10-22 用户裁定去
        // NULL：0 < 35 放行与原 IS NULL 臂逐输入等价，条件串裸比较）。
        // 回放定档（v22-v24 111 票，2026-10-20）：X=35 拦 26 票（误伤 5 正票 +0.0011），
        // 被拦净 -0.0217 = 总亏损 -0.0373 的 58%，且 v22/23 与 v24 两个子集断崖一致。
        let sybilClusterHolderCircPct = 0;
        const _sybilRosterActive = !!_sybilClusterWallets && _sybilClusterWallets.size > 0;
        let _sybilClusterBuyBnb = 0;   // 簇钱包全史买入 BNB 合计（buyVolumeBnbExSybil 扣除原料）
        let _sybilClusterHolderN = 0;  // 簇钱包正净持仓钱包数（holdersExSybil 扣除原料）
        if (_sybilRosterActive) {
            let _clusterNet = 0;
            for (const [addr, v] of state._walletNetTokens) {
                if (v > 0 && _sybilClusterWallets.has(addr.toLowerCase())) { _clusterNet += v; _sybilClusterHolderN++; }
            }
            sybilClusterHolderCircPct = _circDen > 0
                ? Math.round(_clusterNet / _circDen * 1000) / 10
                : 0;
            for (const [addr, v] of state._buyerVolume) {
                if (_sybilClusterWallets.has(addr.toLowerCase())) _sybilClusterBuyBnb += v;
            }
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
            // T84 入场市值锚（BNB 域）：首买市值（无仓 → null）
            entryMarketCap: positionFactors.entryMarketCap ?? null,
            highestHolderCountSinceLastBuy: positionFactors.highestHolderCountSinceLastBuy,
            holderDrawdownFromHighestSinceLastBuy: positionFactors.holderDrawdownFromHighestSinceLastBuy,
            // T97 高点停滞减仓臂：距持仓期峰值秒数（无持仓 → null，`> N` 恒 false fail-closed）
            secSincePeak: positionFactors.secSincePeak ?? null,

            // ── WSS 事件流口径的「AVE 替代」因子 ──
            holders: state.holderCount,
            // T98 剔尘埃口径人气（2026-10-29 用户裁定「极小持仓者剔除——这样不会让假活跃
            // 票进门」）：净持仓按首可靠价折算 ≥ holderDustBnb（默认 0.002=2× tick 尘门+单卡
            // 仓位）的钱包数；刷 holder 的尘埃钱包不计入。无可靠价票退化=holders fail-open；
            // defer 回推滞后 1-3s 与 holders/holdersExSybil 同窗（fire 就绪度缝隙族内一致）
            holdersExDust: state.holderCountExDust,
            // 人气门去簇口径（2026-10-22 用户裁定：buyVolumeBnb >= 1.25 OR holders >= 10
            // 扣除协同簇钱包）：簇钱包正净持仓者不计入人气持有者数（现状口径，与
            // sybilClusterHolderCircPct 同门同 map）；名单未启用（文件缺失/空集合）→
            // 不扣=原值（fail-open：无 sybil 证据不减人气，与 0 语义同方向）；defer
            // 路径 wallet 段回推滞后 1-3s 与 famous/sybil 族同窗（fire 就绪度缝隙族内一致）
            holdersExSybil: _sybilRosterActive ? state.holderCount - _sybilClusterHolderN : state.holderCount,
            // GMGN 用户净持仓占比实时值（小写无前缀=FA 实时层；TPAPre_ 前缀=TPA 触发时快照层）
            gmgnUserPct: _gmgnUserPct,
            txVolumeU24h: bnbUsd > 0 ? (state.totalBuyBnb + state.totalSellBnb) * bnbUsd : 0,
            tvl: bnbUsd > 0 ? state.lastFundsBnb * bnbUsd : 0,
            fdv: 0,        // 见下（与 marketCap 同值）
            // T84 量纲切换（2026-10-28 用户裁定）：市值全域换 BNB 域 = priceBnb ×
            // totalSupply（原 USD 域 ×lastImpliedBnbUsd 随 BNB 价漂移严重）。条件
            // 阈值全部随批换算——库条目/实验快照须同批更新，旧 USD 数字配新 BNB 域
            // 因子=市值门恒死（上线红线：先改库再换进程）
            marketCap: state.totalSupply > 0 && currentPriceBnb > 0 ? currentPriceBnb * state.totalSupply : 0,
            // 毕业进度（E5 卖侧）：four.meme = 可靠价市值 / 72 锚（实测 11 token 收敛 72.1）；
            // flap/gang = 资金口径 池净入金 / 毕业阈值（flap 2026-10-24 替换价格锚：R 恒比
            // 假设实证不成立，豆皮/水 0.716/0.754 峰值够不着 0.9/0.98 死臂；gang 2026-10-27
            // 同口径——阈值链在 _graduationFundsThreshold 内分平台：flap=per-quote 学习值
            // ?? 常量，gang=graduationThresholdBnb ?? 15）。four.meme 用 _relPriceBnb 而非
            // currentPrice——V1 实证尘价/异常巨量 tick 可把任意价口径推到 >1 假触发
            graduationProgress: state.platform === 'flap' || state.platform === 'gang'
                ? this._graduationFundsProgress(state)
                : (state.totalSupply > 0 && state._relPriceBnb > 0)
                    ? (state._relPriceBnb * state.totalSupply) / this._fp.graduationAnchorBnb
                    : null,

            tweetAuthorType: 0, // 叙事已解耦，恒 0
            dataCollectionRound: state.dataCollectionRound,

            // ── tick 原生活跃度因子 ──
            tradeCount: state.tradeCount,
            buyCount: state.buyCount,
            sellCount: state.sellCount,
            uniqueTraderCount: state.uniqueTraders.size,
            buyVolumeBnb: state.totalBuyBnb,
            // 独立买入钱包数（T76 2026-10-27 注意力空转观测键原料）：K 组对敲族
            // _buyerAddresses 全史 Set 的 size——曾买入即计入（清仓不回退），与
            // buyVolumeBnb 同刻同源；GMGN 层 gmgnVisitorsPerBuyer 比值的分母
            buyWallets: state._buyerAddresses.size,
            // 去簇人气量：totalBuyBnb − 簇钱包全史买入合计（_buyerVolume 钱包段 K 组
            // 原料，sender 真值口径）。买入是历史量只增不减——簇钱包拉过盘再砸盘的量
            // 照扣（对倒垫出的人气假象正是本键要剔除的）；null wallet 买入行无法归集
            // → 留在分子（照计量不冒充归属）；名单未启用 → 不扣=原值
            buyVolumeBnbExSybil: _sybilRosterActive ? state.totalBuyBnb - _sybilClusterBuyBnb : state.totalBuyBnb,
            sellVolumeBnb: state.totalSellBnb,
            // ── T70→T88 路由占比键（2026-10-26 智子/币安1986 案：early 90s 冻结窗
            //    对慢热票结构性失真——币安1986 前 90s 仅 dev 自倒 routerPct 冻结 0、
            //    90-300s 散户蜂拥 110 笔也改不了冻结值）。routerPct=买点时刻全史
            //    实时值，判 trader 层 AGGREGATOR_ROUTER_ADDRS（GMGN 等）只计买腿，
            //    口径对齐 early 同名臂。（同族全史净比键 tradesNetBuyRatio 已随 T88
            //    2026-10-28 断代——换 tradesNetBuyRatioLongWin 尾 100 笔；本键维持
            //    全史：路由占比无「砸盘拖低」形状，分子分母同源无时漂）──
            tradesRouterPct: state.totalBuyBnb > 0
                ? parseFloat((state.totalRouterBuyBnb / state.totalBuyBnb * 100).toFixed(2)) : 0,
            // ── T77→T87→T88 净买窗三键（T77 立短窗；T87 0xdf7a 案换轨最近 N 笔；
            //    T88 全史键断代换长窗 M 笔——用户裁定「全量买卖比没必要，检测一个
            //    趋势」）。ShortWin=尾 20 笔即时流；LongWin=尾 100 笔主趋势（环空
            //    null fail-closed，全卖 -100 有证据零值）；ShortWinBnb=短窗买量
            //    观察键（进场证据量审计，刻意不进条件串）──
            tradesNetBuyRatioShortWin: netBuyWin.tradesNetBuyRatioShortWin,
            tradesNetBuyShortWinBnb: netBuyWin.tradesNetBuyShortWinBnb,
            tradesNetBuyRatioLongWin: netBuyWin.tradesNetBuyRatioLongWin,

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

            // （首窗累计 earlyTrades* 10 键已随 T71 2026-10-26 删除——冻结窗族整族退役，
            //  净买/路由消费键换 tradesNetBuyRatio/tradesRouterPct 全史实时对；legacy
            //  preBuy DB 宿主独立存续）

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
            // 存量口径簇集中度（2026-10-25 A/B 对比用户裁定进条件门，替换
            // bundleClusterSharePct 门位；恒 ≥ maxBlockBuyCircPct；0=无买入块/
            // 流通≤0 有证据零值非 null；口径见 _bundleClusterFactors 注释）
            bundleClusterHoldCircPct: bundle.bundleClusterHoldCircPct,
            // 第二道存量门（同日 AIFLY 0x0bae…7777 案用户裁定）：最大两块买家并集去重
            // 正净持仓 ÷ 流通；恒 ≥ bundleClusterHoldCircPct；口径见 _bundleClusterFactors 注释
            top2BundleClusterHoldCircPct: bundle.top2BundleClusterHoldCircPct,
            // 第三块观察键（2026-10-26 同族扩展）：最大三块并集去重；不足三块退化=top2；
            // 恒 ≥ top2 ≥ top1；纯观察不进条件串（阈值裁定另议）
            top3BundleClusterHoldCircPct: bundle.top3BundleClusterHoldCircPct,
            // 等额买簇三键（T74 0x8c4a…7777 对倒案观察键）：跨块同额买入并集去重正净
            // 持仓 ÷ 流通；对分批跨块形状免疫（bundle 单块口径被稀释、sybil 名单滞后）；
            // 纯观察不进条件串（阈值须票池分布裁定）；0=无合格桶/流通≤0；
            // 口径见 _bundleClusterFactors 注释
            evenClusterHoldCircPct: bundle.evenClusterHoldCircPct,
            evenClusterWallets: bundle.evenClusterWallets,
            evenClusterGroups: bundle.evenClusterGroups,
            // ── 出生锚定捆绑簇 launch* 4 键（2026-10-17 Agentum 案方向 C：10s 滑窗迟到
            //    fire 漏创建块簇；同块臂+跨块等额臂，出窗冻结；口径见 _launchBundleFactors）──
            launchBundleClusterSize: launch.launchBundleClusterSize,
            launchBundleClusterSharePct: launch.launchBundleClusterSharePct,
            launchEqualClusterWallets: launch.launchEqualClusterWallets,
            launchEqualClusterBnb: launch.launchEqualClusterBnb,
            // TOP1 持仓集中度（2026-10-16 用户裁定门键；0=无持仓证据零值非 null；
            // 口径=链上交易者集中度，creator 预 mint 不在分子，见上方注释）
            top1HolderCircPct,
            // T92 top2 持有人门（前两大净持仓合计 ÷ 同 _circDen；0=有证据零值非 null，
            // 口径=链上交易者集中度同 top1，见上方注释块）
            top2HolderCircPct,
            // 前 1/2 大净持仓占总量比例（2026-10-29 观察键，不进条件串）：分母 totalSupply
            // （不受流通进度污染）；supply 缺失 → null fail-closed，见上方注释块
            top1HolderSupplyPct,
            top2HolderSupplyPct,
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
        //    narrativeRetryDue（=1 当且仅当 rating===1 ∧（accountOnly ∨ corpusEmpty
        //    （C162 零自有语料臂，走 noCorpus* 独立节奏键））∧ !inFlight ∧
        //    rounds<maxAnalyses（按臂选参）∧ now−completedAt≥intervalMs——重试轮并入
        //    触发条件的因子表达 `... OR narrativeRetryDue == 1`）。未回填（legacy 腿/
        //    web 裸 FA/分析未完成）→ rating null → 条件 (narrativeRating == 2 OR == 3)
        //    恒 false = 不参与信号生成（第二点由条件表达式天然保证）。
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
                && _nar.rating === 1 && _nar.inFlight !== true
                // C162 补轮第二臂：corpusEmpty（零自有语料=宣告推/GMGN link 晚到竞态）
                // 与 accountOnly 同为「语料晚到可重评」形状；两臂互斥（accountOnly
                // 要求 twitter 桶非空），corpusEmpty 臂走 noCorpus* 独立节奏键——
                // 判据与引擎 _narrativeTriggerCheck 逐字一致（刻意的双侧冗余）
                && (_nar.accountOnly === true || _nar.corpusEmpty === true)
                && _nar.rounds < (_nar.corpusEmpty === true && _nar.accountOnly !== true
                    ? _narrativeFactorConfig.noCorpusMaxAnalyses : _narrativeFactorConfig.maxAnalyses)
                && Number.isFinite(_nar.completedAt)
                && now - _nar.completedAt >= (_nar.corpusEmpty === true && _nar.accountOnly !== true
                    ? _narrativeFactorConfig.noCorpusIntervalMs : _narrativeFactorConfig.intervalMs))
                ? 1 : 0;
        }

        // ── 账号信息复检注入（C166，2026-10-22 一次性专号 rug 家族案）：issuerAccountState
        //    ='active'|'deleted'|'tweets_gone'|null。引擎 AccountHealthMonitor 持仓期
        //    复检宣告账号（删号/宣告推被删/推文清零）回填；null=未检测/无宣告账号/
        //    API 故障（fail-open 不置信号）→ 卖臂条件 == 'deleted' / == 'tweets_gone'
        //    恒 false 不误卖。回测零接线（BacktestEngine 不含复检链路，因子恒 null）
        //    ——动态网络数据对历史 fire 是时序穿越，跳过比穿越诚实（gwp 同款裁定）。
        //    ★本块纯投影无周期判定，不涉及 now（Date.now 红线不适用但保持零调用）──
        {
            const _ah = state.tokenAddress && _accountHealthOverrides
                ? _accountHealthOverrides.get(state.tokenAddress) || null
                : null;
            // unknown（API 故障 fail-open）投影 null——与未检测不可区分是刻意的
            //（故障不该产生任何信号形状）；getAccountHealthFactors 保留原值供审计
            factors.issuerAccountState = _ah && _ah.state !== 'unknown' ? _ah.state : null;
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
     *          accountOnly: boolean, corpusEmpty: boolean, inFlight: boolean, category?: string|null}} snapshot
     *   rating ∈ null|1|2|3|9；completedAt=最后一轮完成时刻 ms（retryDue 判据）；
     *   accountOnly=语料只有账号入口（isAccountOnlySource，重试域判据）；
     *   corpusEmpty=零自有语料（hasNoOwnedCorpus，C162 补轮第二臂——宣告推/GMGN
     *   link 晚到竞态形状，与 accountOnly 互斥，noCorpus* 独立节奏）；
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

    // ═══════════════ 账号信息复检回填接口（static，C166；母版=setNarrativeFactors）═══════════════

    /**
     * 回填某 token 的宣告账号健康状态（引擎 AccountHealthMonitor 单写者；
     * 买入成功点重置、stop 逐 token 清）。整包替换。
     * @param {string} tokenAddress
     * @param {{state: 'active'|'deleted'|'tweets_gone'|'unknown'|null, checkedAt?: number}} snapshot
     *   state='unknown'（API 故障 fail-open）投影为 null——卖臂条件恒 false 不误卖，
     *   与「未检测」不可区分是刻意的（故障不该产生任何信号形状）
     */
    static setAccountHealthFactors(tokenAddress, snapshot) {
        if (!tokenAddress) return false;
        if (!_accountHealthOverrides) _accountHealthOverrides = new Map();
        _accountHealthOverrides.set(tokenAddress, snapshot);
        return true;
    }

    /** 取回填的宣告账号健康状态（无则 null）。 */
    static getAccountHealthFactors(tokenAddress) {
        return (_accountHealthOverrides && _accountHealthOverrides.get(tokenAddress)) || null;
    }

    /** 清除某 token 的账号健康回填（引擎 stop / 再买入重置）。 */
    static clearAccountHealthFactors(tokenAddress) {
        if (!_accountHealthOverrides) return false;
        return _accountHealthOverrides.delete(tokenAddress);
    }

    /**
     * 重试轮参数（引擎 ctor 注入 narrativeRetry.intervalMs/maxAnalyses + C162 零语料臂
     * noCorpusIntervalMs/noCorpusMaxAnalyses；回测全键 {Infinity, 0} → retryDue 恒 0
     * =禁重试）。部分注入——未带键保持现值（⚠ 引擎侧须各键全传：同进程先跑回测
     * （Infinity/0）再起实时引擎时，部分注入会继承回测值——实时引擎用
     * getNarrativeFactorDefaults 补全）。
     */
    static setNarrativeFactorConfig(cfg) {
        if (!cfg) return;
        if (typeof cfg.intervalMs === 'number' && (cfg.intervalMs === Infinity || cfg.intervalMs > 0)) {
            _narrativeFactorConfig.intervalMs = cfg.intervalMs;
        }
        if (Number.isInteger(cfg.maxAnalyses) && cfg.maxAnalyses >= 0) {
            _narrativeFactorConfig.maxAnalyses = cfg.maxAnalyses;
        }
        if (typeof cfg.noCorpusIntervalMs === 'number' && (cfg.noCorpusIntervalMs === Infinity || cfg.noCorpusIntervalMs > 0)) {
            _narrativeFactorConfig.noCorpusIntervalMs = cfg.noCorpusIntervalMs;
        }
        if (Number.isInteger(cfg.noCorpusMaxAnalyses) && cfg.noCorpusMaxAnalyses >= 0) {
            _narrativeFactorConfig.noCorpusMaxAnalyses = cfg.noCorpusMaxAnalyses;
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
