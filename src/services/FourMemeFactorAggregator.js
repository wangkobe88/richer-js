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
 *   - holders       → 内盘净持仓 trader 计数（曲线内每笔持仓变化都发事件，毕业前精确）
 *   - txVolumeU24h  → 累计成交额（totalBuyBnb+totalSellBnb）× BNB/USD（观察窗内代币全生命周期）
 *   - tvl           → 最近一笔事件的 curve funds × BNB/USD
 *   - fdv/marketCap → currentPrice × totalSupply（TokenCreate 事件）
 *   - trend 族 / holderTrend 族 → 10s 时间桶价格/持有者序列（8 点窗，TrendDetector/HolderTrendDetector 复用）
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
 *   - 单位替换必改名：Sol→Bnb、slot→block、bar3s→bar15s（rsi14Bar15s）
 *   - 窗宽类跟窗改名：firstSecBuyShare→firstBlockBuyShare、riseFromLow2s→riseFromLow6s
 *   - 纯结构类逐字保留：counterpartyOverlap*、top3/top5HolderShare、bigHolder*、rsi*、kline*
 *
 * ★ priceReliable（新链专用可靠价门，母版 sol>=minTickSol 的 BSC 适配）：
 *   priceBnb > 0 && !priceOutlier && bnbAmount >= minPriceUpdateBnb。
 *   既有价格行为（任意非离群接受价更新 currentPriceBnb/firstPrice/highestPriceBnb/series/
 *   per-pos SinceBuy 峰值）零改动——新链全部挂在可靠价链 _relPriceBnb/_relHighestPriceBnb
 *   （与既有 highestPriceBnb 双轨并行：旧键 drawdownFromHighest 等保持任意接受价口径）。
 *   crashSpeed/peakFallSpeed/riseFromBlockLowPct 因此用 _relPriceBnb（母版 currentPriceUsd
 *   本身就是可靠价链产物，此为对齐而非偏离）。
 *
 * 与母版的已裁定偏离（其余逐字对齐）：
 *   1. shares 族分母 = totalSupply（TokenCreate），缺失(=0) → null fail-closed；
 *      母版用常数 1e9 分母（BSC 有真实 totalSupply，不用近似常数）
 *   2. OHLCV 价写入加 priceBnb>0 守卫（母版 priceUsd 可为 0，会以 log(0) 毒化 K 线因子）
 *   3. _recentTicks 保留 richer-js 5min 摊销窗（母版 60s 硬窗）；新链扫描一律按各自
 *      cutoff 过滤，窗内语义等价
 *   4. USD 输出仅 blockLowMcapUsd（经 state.lastImpliedBnbUsd），其余新链全程 BNB 原生
 *
 * 不迁（母版特定装置）：zz25、w0ShareB/_w0bWin、k0 latch、_traderMaxNetTokens、
 * maxEarlyBuySol、afterFirst3s、_cumulativeBuy/SellTokens、preFilter、ML/GMGN/TPA、
 * smartBot/sniper（批 3.3）。
 */

const EventEmitter = require('events');
const TrendDetector = require('../trading-engine/TrendDetector');
const HolderTrendDetector = require('../trading-engine/HolderTrendDetector');

// 趋势序列时间桶宽度：8 点 × 10s ≈ 旧轮询时代（10s 采样 × 8 点）窗口语义
const SERIES_BUCKET_SEC = 10;
const SERIES_MAX_POINTS = 8;

// 滑窗速率窗口（分钟）
const RATE_WINDOW_MS = 5 * 60 * 1000;

// 局部离群价剔除：偏离最近 5 笔已接受价中位 >1000× 判为毒价
//（真实轨迹逐笔 <2×；打包 tx 尘量 token_amount 会产生 e7 倍假价——Phase 0 母版同款阈值）
const OUTLIER_RATIO = 1000;

// 针曲线锚点（BSC）：(3s, 35%) ↔ (6s, 100%) 线性（母版 (1s,35%)↔(2s,100%)，窗宽按 BSC 节奏×3）
const SPIKE_CURVE_WINDOWS_S = [3, 6];
const spikeCurveThresholdPct = (wSec) =>
    35 + (100 - 35) * ((wSec - SPIKE_CURVE_WINDOWS_S[0])
        / (SPIKE_CURVE_WINDOWS_S[SPIKE_CURVE_WINDOWS_S.length - 1] - SPIKE_CURVE_WINDOWS_S[0]));

/**
 * 回迁批 1 因子参数默认值（BSC 初值；逐项注明母版值，待回测校准）。
 * config fourmemeWs.factorParams 子对象可覆盖（实验级经 _mergedWsConfig 浅合并后，
 * 此处 Object.assign 再垫默认值——部分覆盖有效）。
 */
const FACTOR_PARAM_DEFAULTS = {
    minPriceUpdateBnb: 0.002,    // 可靠价尘门（母版 minTickSol 0.005 SOL；BSC tradeAmount 0.1 的 1/50）
    firstBlockWindowMs: 3000,    // 首块脉冲窗（母版首秒 1000ms；BSC 1 block≈3s）
    slideWinMs: 30000,           // 滑窗速率窗（母版 6000ms）
    trendWindowMs: 30000,        // 趋势窗（母版 5000ms）
    trendMinReliableTicks: 5,    // 主窗最少 reliable tick（母版同）
    trendAbsMinTicks: 3,         // widened fallback 最少总数（母版同）
    crashSpeedWindowMs: 10000,   // 砸速窗（母版 2500ms）
    crashSpeedMinDtMs: 3000,     // 砸速分母下限（母版 500ms≈1 slot；BSC≈1 block）
    bigHolderMinCumBuyBnb: 1.0,  // 大户门槛=累计买入（母版 2.9 SOL；BSC tradeAmount 0.1 的 10×）
    bhSellKeepMs: 12000,         // 大户卖出事件留存（母版 4000ms；覆盖 dump 长窗+余量）
    bhDumpShortMs: 3000,         // 大户短窗出货聚合（母版 Dump1s=1000ms）
    bhDumpLongMs: 9000,          // 大户长窗出货聚合（母版 Dump3s=3000ms）
    ohlcvMaxCandles: 60,         // block K 线短窗容量（60 根≈3min；母版 slot 桶 60 根同数）
    ohlcvLongMaxCandles: 300,    // block K 线长窗容量（底背离原料；母版同数）
    ohlcvMinCandles: 5,          // klineTrendSlope 最少根数（母版同）
    secRsiMaxBars: 60,           // 秒收盘环形窗（母版同）
    bar15RsiMaxBars: 60,         // 15s bar 收盘环形窗（母版 bar3RsiMaxBars 60 同数）
    postPeakTailMaxBlocks: 32,   // 峰后 block 尾巴容量（母版 postPeakTailMaxSlots 32 同数）
    postPeakSlopeWindow: 5,      // 峰后斜率 OLS 窗根数（母版同）
    divSwingL: 2,                // 底背离 swing 确认半径（根；母版同）
    divRsiPeriod: 14,            // 底背离 RSI 周期（母版同）
    postPulseCutMs: 10000,       // 脉冲期停计线：首 tick 后（母版 2000ms；与首块脉冲窗对齐）
    rsiProtectSeconds: 60,       // RSI 保护期（母版 10s；BSC 1.33min 买入节奏）
    rsiPostProtectMinSpanPct: 5, // 保护期外 RSI 最小价幅门（母版同）
    ddConfirmWindowMs: 10000,    // ddConfirm arm→确认窗（母版 3000ms；阈值 -20/-15/2% 不动）
    tickFlowYoungAgeSec: 90,     // tickFlowOk 年龄分档（母版 ≤30s；BSC×3）
    tickFlowMidAgeSec: 180,      // tickFlowOk 年龄分档（母版 ≤60s）
    tickFlowIdleYoungSec: 9,     // 断流阈值：年轻档（母版 3s）
    tickFlowIdleMidSec: 12,      // 断流阈值：中档（母版 4s）
    tickFlowIdleOldSec: 24,      // 断流阈值：老档（母版 8s，闭区间 <=）
    // ── 市场截面 cohort 三参数（回迁批 2.6；母版 config 顶层级，此处并入 factorParams 统一覆盖）──
    marketCohortWinMs: 40 * 60 * 1000,  // cohort 出生窗上沿：birth∈[t−40m, t−10m] 计分母
    marketMatureMs: 10 * 60 * 1000,     // cohort 成熟下沿：出生后 ≥10m 才计分母（<10m 未成熟）
    marketMinCohort: 30,                // 分母 < 此数 → 三个 cohort 率全 null fail-closed
};

// ── Q 组：creator 前作 registry 常量（pumpfun 逐字沿用——跨票日级口径与链节奏无关）──
const CREATOR_PRIOR_WINDOW_MS = 24 * 3600 * 1000;  // 前作首可靠价窗口 [t−24h, t−10min]
const CREATOR_PRIOR_UNFOLD_MS = 10 * 60 * 1000;    // 展开 10min（排除刚出生未展开票；本 token 另行排除）
const CREATOR_PRIOR_MIN_N = 2;                     // 分母 <2 → 命中率 null fail-closed（null=放行方向）
const CREATOR_PRIOR_TTL_MS = 26 * 3600 * 1000;     // registry 条目自剪枝：firstTs 龄超窗（24h+余量）即弃

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

        this._states = new Map(); // tokenAddress → state

        // Q 组：creator → token → {firstTs, firstPb, maxPb}（回迁批 2.5；BNB 口径免汇率）。
        // pruneStaleTokens 删 state 不清此表——前作死票的峰值必须留痕到滑出 24h 窗（自剪枝见 _updateCreatorPrior）
        this._creatorPriors = new Map();

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
     * Buy 先于 Create 到达的乱序场景：迟到注册时若已有 state，仅回填更早的 createdAt。
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
        this._stats.tokensRegistered++;
    }

    getTrackedTokens() {
        return [...this._states.keys()];
    }

    getTokenState(tokenAddress) {
        return this._states.get(tokenAddress) || null;
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

    // ═══════════════ 核心：tick 增量处理 ═══════════════

    /**
     * 处理一笔 tick（实时或回放共用入口）。
     * @param {Object} tick - { token_address, trade_type, trader_address, price_bnb, price_usd,
     *                          bnb_amount, token_amount, offers, funds_bnb, block_number, timestamp(ms), tx_hash, log_index }
     * @param {Object} [opts] - { emitFactors: true } 回放场景可置 false 只累计状态不触发决策
     * @returns {{factors: Object|null, priceAccepted: boolean, priceOutlier: boolean}|null}
     */
    processTick(tick, opts = {}) {
        const emitFactors = opts.emitFactors !== false;
        const tokenAddress = tick.token_address;
        if (!tokenAddress || !tick.timestamp) return null;
        this._stats.ticksProcessed++;

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

        // 首块脉冲（母版首秒脉冲的 BSC 适配：首买 anchor 起 firstBlockWindowMs 窗内买入累计，
        // firstBlockBuyShare 原料；窗口冻结后才出值，防早期读数误导）
        if (isBuy) {
            if (state._firstBuyAt === null) state._firstBuyAt = ts;
            if (ts - state._firstBuyAt < this._fp.firstBlockWindowMs) state._firstBlockBuyBnb += bnbAmount;
        }
        // 单笔最大买/卖（防砸盘：钓鱼票的巨单脉冲）
        if (isBuy) {
            if (bnbAmount > 0 && (state._maxSingleBuyBnb === null || bnbAmount > state._maxSingleBuyBnb)) {
                state._maxSingleBuyBnb = bnbAmount;
            }
        } else {
            if (bnbAmount > 0 && (state._maxSingleSellBnb === null || bnbAmount > state._maxSingleSellBnb)) {
                state._maxSingleSellBnb = bnbAmount;
            }
        }

        if (tick.trader_address) {
            state.uniqueTraders.add(tick.trader_address);
            // 按 trader 维护净持仓（内盘持有者计数与 holderTrend 原料）
            if (tokenAmount > 0) {
                const delta = isBuy ? tokenAmount : -tokenAmount;
                state._traderNetTokens.set(tick.trader_address,
                    (state._traderNetTokens.get(tick.trader_address) || 0) + delta);
                state.holderCount = 0;
                for (const net of state._traderNetTokens.values()) {
                    if (net > 0) state.holderCount++;
                }
                // 累计买入（单调不减，cumBuy 集中度原料——出货后留痕）
                if (isBuy) {
                    state._traderBoughtTokens.set(tick.trader_address,
                        (state._traderBoughtTokens.get(tick.trader_address) || 0) + tokenAmount);
                }
            }
        }

        // ── K 组：双边地址/累计量（对敲重叠族原料，全史 Sets/Maps）──
        if (tick.trader_address) {
            const addr = tick.trader_address;
            if (isBuy) {
                state._buyerAddresses.add(addr);
                state._buyerVolume.set(addr, (state._buyerVolume.get(addr) || 0) + bnbAmount);
                if (blockNumber !== null && !state._walletFirstBuyBlock.has(addr)) {
                    state._walletFirstBuyBlock.set(addr, blockNumber); // write-once 首买块（early 判定）
                }
            } else {
                state._sellerAddresses.add(addr);
                state._sellerVolume.set(addr, (state._sellerVolume.get(addr) || 0) + bnbAmount);
                // 大户卖出事件流（写时裁剪；读取时按 dump 窗聚合）
                if (bnbAmount > 0 && (state._buyerVolume.get(addr) || 0) >= this._fp.bigHolderMinCumBuyBnb) {
                    state._bhSellEvents.push([ts, bnbAmount]);
                    while (state._bhSellEvents.length && ts - state._bhSellEvents[0][0] > this._fp.bhSellKeepMs) {
                        state._bhSellEvents.shift();
                    }
                }
            }
        }

        // ── K 线 block 桶推进（block 变更先闭旧桶；母版同款无回退 guard——迟到 block 也会闭当前桶）──
        if (blockNumber !== null) {
            if (state._candleCurrent === null || blockNumber !== state._candleCurrent.block) {
                if (state._candleCurrent !== null) this._commitCandle(state);
                state._candleCurrent = {
                    block: blockNumber, open: null, high: null, low: null, close: null,
                    volBnb: 0, buyBnb: 0, sellBnb: 0, nTicks: 0, nBuys: 0, firstTs: ts,
                };
            }
        }

        // ── 价格追踪（离群剔除）──
        const priceOutlier = priceBnb > 0 && !this._acceptPrice(state, priceBnb);
        let priceAccepted = false;
        if (priceBnb > 0 && !priceOutlier) {
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
            this._pushSeriesPoint(state, ts);
        } else if (priceOutlier) {
            this._stats.pricesRejectedOutlier++;
        }

        // ── 可靠价链（回迁批 1：priceReliable 驱动秒桶/宽bar/峰值链/dd/ddConfirm/块链）──
        const priceReliable = priceBnb > 0 && !priceOutlier && bnbAmount >= this._fp.minPriceUpdateBnb;
        if (priceReliable) {
            state._relPriceBnb = priceBnb;

            // ── Q 组：creator 前作 registry 推进（回迁批 2.5；母版已接受价路径 = 尘门+离群后的可靠价）──
            //   新 token 首个可靠价 = 前作 firstTs/firstPb；此后只涨 maxPb（首值冻结=票属性锚点）。
            //   creator 来自 registerToken（live=TokenCreate / 回测=experiment_tokens，tick 无 creator 列）
            this._updateCreatorPrior(state.creatorAddress, tokenAddress, ts, priceBnb);

            // 墙钟秒收盘桶（空秒跳过；已闭合秒序列 = 因果口径 RSI 原料）
            const _sec = Math.floor(ts / 1000);
            if (state._secCurrent === null) {
                state._secCurrent = { sec: _sec, close: priceBnb };
            } else if (_sec > state._secCurrent.sec) {
                state._secCloses.push(state._secCurrent.close);
                const _c = state._secCurrent.close;
                if (state._secRsiLong === null) {
                    state._secRsiLong = { prevClose: _c, m: 0, g30: 0, l30: 0, g60: 0, l60: 0 };
                } else {
                    // 增量全史 Wilder（rsi30Sec/rsi60Sec；首个已闭合秒只 init 不计差分）
                    const L = state._secRsiLong;
                    const d = _c - L.prevClose;
                    L.prevClose = _c;
                    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
                    L.m++;
                    if (L.m <= 30) { L.g30 += g; L.l30 += l; if (L.m === 30) { L.g30 /= 30; L.l30 /= 30; } }
                    else { L.g30 = (L.g30 * 29 + g) / 30; L.l30 = (L.l30 * 29 + l) / 30; }
                    if (L.m <= 60) { L.g60 += g; L.l60 += l; if (L.m === 60) { L.g60 /= 60; L.l60 /= 60; } }
                    else { L.g60 = (L.g60 * 59 + g) / 60; L.l60 = (L.l60 * 59 + l) / 60; }
                }
                if (state._secCloses.length > this._fp.secRsiMaxBars) state._secCloses.shift();
                state._secCurrent = { sec: _sec, close: priceBnb };
            } else if (_sec === state._secCurrent.sec) {
                state._secCurrent.close = priceBnb; // 同秒末笔覆盖
            }

            // 宽 bar（15s）收盘桶（母版 3s bar 的 BSC 适配：15s≈5 block 波段节奏档）
            const _bar15 = Math.floor(_sec / 15);
            if (state._bar15Current === null) {
                state._bar15Current = { bar: _bar15, close: priceBnb };
            } else if (_bar15 > state._bar15Current.bar) {
                state._bar15Closes.push(state._bar15Current.close);
                if (state._bar15Closes.length > this._fp.bar15RsiMaxBars) state._bar15Closes.shift();
                state._bar15Current = { bar: _bar15, close: priceBnb };
            } else if (_bar15 === state._bar15Current.bar) {
                state._bar15Current.close = priceBnb;
            }

            // 可靠价峰值链（新链专用；与既有 highestPriceBnb 任意接受价口径双轨并行）
            if (priceBnb > state._relHighestPriceBnb) {
                state._relHighestPriceBnb = priceBnb;
                state._relHighestAt = ts;
                state._relHighestBlock = blockNumber;
                state._postPeakBlockTail.clear();
                state._minDdSinceHighestPct = 0;
                state.deepDrop70At = null; // 新高重置深跌 latch
            } else if (blockNumber !== null && state._relHighestBlock !== null && blockNumber > state._relHighestBlock) {
                state._postPeakBlockTail.set(blockNumber, priceBnb); // 峰后逐 block 尾巴（postPeakSlope 原料）
                if (state._postPeakBlockTail.size > this._fp.postPeakTailMaxBlocks) {
                    let _minBlock = null;
                    for (const _b of state._postPeakBlockTail.keys()) {
                        if (_minBlock === null || _b < _minBlock) _minBlock = _b;
                    }
                    state._postPeakBlockTail.delete(_minBlock);
                }
            }

            // 峰值后回撤 / 深跌 latch（≤-70% 首触时刻；母版阈值不动）
            if (state._relHighestPriceBnb > 0) {
                const _dd = ((state._relPriceBnb - state._relHighestPriceBnb) / state._relHighestPriceBnb) * 100;
                if (_dd <= -70 && state.deepDrop70At === null) state.deepDrop70At = ts;
                if (_dd < state._minDdSinceHighestPct) state._minDdSinceHighestPct = _dd;
            }

            // per-position：可靠价峰值推进 + ddConfirm 状态机
            //（-20% arm → 再跌 2% 确认 sell(latch) → -15% 收复 disarm → 窗超时冷却防反复 arm）
            for (const pos of state._positions.values()) {
                if (priceBnb > pos._relHighestSinceBuyBnb) pos._relHighestSinceBuyBnb = priceBnb;
                if (pos._relHighestSinceBuyBnb > 0) {
                    const _ddc = ((priceBnb - pos._relHighestSinceBuyBnb) / pos._relHighestSinceBuyBnb) * 100;
                    if (_ddc > -15) pos.ddcwCooldown = false;
                    if (!pos.ddcwArmed) {
                        if (!pos.ddcwCooldown && _ddc <= -20) {
                            pos.ddcwArmed = true;
                            pos.ddcwArmMs = ts;
                            pos.ddcwRefBnb = priceBnb;
                        }
                    } else if (priceBnb <= pos.ddcwRefBnb * 0.98) {
                        pos.ddcwSell = true; // latch：确认后保持至清仓
                    } else if (_ddc > -15) {
                        pos.ddcwArmed = false;
                    } else if (ts - pos.ddcwArmMs > this._fp.ddConfirmWindowMs) {
                        pos.ddcwArmed = false;
                        pos.ddcwCooldown = true;
                    }
                }
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

                // ── 块低点链（当前块最低可靠价；更高块到达即重置）──
                if (state._blockLowBlock === null || blockNumber > state._blockLowBlock) {
                    state._blockLowBlock = blockNumber;
                    state._blockLowPriceBnb = priceBnb;
                } else if (blockNumber === state._blockLowBlock && priceBnb < state._blockLowPriceBnb) {
                    state._blockLowPriceBnb = priceBnb;
                }

                // ── m3：连续 4 块收盘最大跌幅（FIFO≤4；同块后写覆盖收盘）──
                if (state._m3Block === null || blockNumber > state._m3Block) {
                    if (state._m3Close !== null) {
                        state._m3Closes.push(state._m3Close);
                        if (state._m3Closes.length > 4) state._m3Closes.shift();
                        if (state._m3Closes.length === 4 && state._m3Closes[0] > 0) {
                            const _d3 = 1 - state._m3Closes[3] / state._m3Closes[0];
                            if (_d3 > 0 && (state._max3BlockDrop === null || _d3 > state._max3BlockDrop)) {
                                state._max3BlockDrop = _d3;
                            }
                        }
                    }
                    state._m3Block = blockNumber;
                    state._m3Close = priceBnb;
                } else if (blockNumber === state._m3Block) {
                    state._m3Close = priceBnb;
                }
            }
        }

        // ── OHLCV 累计（block 桶；价写入加 priceBnb>0 守卫——偏离母版，防 log(0) 毒化 K 线因子）──
        if (blockNumber !== null && bnbAmount >= this._fp.minPriceUpdateBnb && state._candleCurrent) {
            const c = state._candleCurrent;
            c.volBnb += bnbAmount;
            if (isBuy) c.buyBnb += bnbAmount; else c.sellBnb += bnbAmount;
            c.nTicks++;
            if (isBuy) c.nBuys++;
            if (!priceOutlier && priceBnb > 0) {
                if (c.open === null) {
                    c.open = priceBnb; c.high = priceBnb; c.low = priceBnb;
                } else {
                    if (priceBnb > c.high) c.high = priceBnb;
                    if (priceBnb < c.low) c.low = priceBnb;
                }
                c.close = priceBnb;
            }
        }

        // ── 滑窗速率原料（附价可靠性/块号，供 trend/crash 窗扫描；既有 5min 摊销窗不变）──
        state._recentTicks.push({ ts, isBuy, bnb: bnbAmount, priceBnb, priceReliable, blockNumber });
        this._pruneRecentTicks(state, ts);
        this._updateSlideWin(state, ts, isBuy, bnbAmount, tick.trader_address);

        // ── 市场截面：全量 tick 口径累积（流量环 + registry 价格/存活推进 + FIFO 写时裁剪；
        //    市场状态与挂载策略无关。尘 tick 计流量不计价——priceReliable 守卫，S8）──
        this._marketOnTick(tokenAddress, ts, isBuy, bnbAmount, priceBnb, priceReliable);

        state.lastTickAt = ts;

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
                        timestamp: ts,
                    },
                    tokenState: state,
                });
            }
        }

        return { factors, priceAccepted, priceOutlier };
    }

    /**
     * 构建某 token 当前因子快照（不推进状态；引擎 30s 时序快照/卖腿评估用）
     */
    buildFactorMap(tokenAddress, now = Date.now()) {
        const state = this._states.get(tokenAddress);
        if (!state) return null;
        return this._buildFactorMap(state, now);
    }

    // ═══════════════ 持仓状态（per-position）═══════════════

    /**
     * 引擎买入成功后登记持仓（买入价/时间锚点，takeProfit/stopLoss 因子原料）。
     * @param {string} tokenAddress
     * @param {{buyPriceBnb: number, buyPriceUsd: number|null, buyTime: number}} buyState
     * @param {string} [positionKey] - 多仓键（默认 'default'）；最新仓决定顶层 buyPrice 族因子
     */
    setBuyState(tokenAddress, buyState, positionKey = 'default') {
        const state = this._states.get(tokenAddress);
        if (!state) return;
        const pos = {
            buyPriceBnb: buyState.buyPriceBnb || 0,
            buyPriceUsd: buyState.buyPriceUsd || null,
            buyTime: buyState.buyTime || Date.now(),
            highestPriceSinceBuyBnb: Math.max(buyState.buyPriceBnb || 0, state.currentPriceBnb || 0),
            highestPriceSinceBuyAt: buyState.buyTime || Date.now(),
            highestHoldersSinceBuy: state.holderCount || 0,
            highestHoldersSinceBuyAt: buyState.buyTime || Date.now(),
            // 回迁批 1 H 组：可靠价峰值锚点 + ddConfirm 状态机 + 峰值利润（新仓归零）
            _relHighestSinceBuyBnb: Math.max(buyState.buyPriceBnb || 0, state._relPriceBnb || 0),
            peakProfitPct: 0,
            ddcwArmed: false,
            ddcwCooldown: false,
            ddcwSell: false,
            ddcwArmMs: 0,
            ddcwRefBnb: 0,
        };
        state._positions.set(positionKey, pos);
        state._lastPositionKey = positionKey;
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
     */
    pruneStaleTokens(maxAgeMs, heldTokens = new Set()) {
        const now = Date.now();
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
            _holderSeries: [],   // 10s 桶持有者序列（holderTrend* 因子，8 点）

            // 计数
            tradeCount: 0,
            buyCount: 0,
            sellCount: 0,
            totalBuyBnb: 0,
            totalSellBnb: 0,
            totalBuyTokens: 0,
            totalSellTokens: 0,
            uniqueTraders: new Set(),
            _traderNetTokens: new Map(), // trader → 净持仓（内盘精确）
            holderCount: 0,

            _recentTicks: [],    // 滑窗速率原料 {ts, isBuy, bnb, priceBnb, priceReliable, blockNumber}

            // 持仓（positionKey → pos）
            _positions: new Map(),
            _lastPositionKey: null,

            // ── 回迁批 1 状态 ──
            _firstBuyAt: null,        // 首笔买 anchor（首块脉冲窗起算）
            _firstBlockBuyBnb: 0,     // 首块脉冲窗内买入累计
            _maxSingleBuyBnb: null,   // 单笔最大买（null=从无 >0 证据）
            _maxSingleSellBnb: null,

            _buyerAddresses: new Set(),   // K 组：全史买方地址
            _sellerAddresses: new Set(),  // K 组：全史卖方地址
            _buyerVolume: new Map(),      // addr → 累计买入 BNB（bigHolder W 门槛）
            _sellerVolume: new Map(),     // addr → 累计卖出 BNB
            _walletFirstBuyBlock: new Map(), // addr → 首买块号（write-once，early 判定）
            _bhSellEvents: [],            // 大户卖出事件 [ts, bnb]（写时裁剪）
            _traderBoughtTokens: new Map(), // addr → 累计买入 token 数（单调不减）

            _candleCurrent: null,       // 当前 block K 线（未闭合）
            _candlesClosed: [],         // 已闭合 block K 线（短窗 ohlcvMaxCandles）
            _candlesClosedLong: [],     // 已闭合 block K 线（长窗 ohlcvLongMaxCandles，底背离原料）

            _secCurrent: null,          // 当前墙钟秒收盘（未闭合）
            _secCloses: [],             // 已闭合秒收盘（secRsiMaxBars 环形）
            _secRsiLong: null,          // 增量全史 Wilder {prevClose, m, g30, l30, g60, l60}
            _bar15Current: null,        // 当前 15s bar 收盘（未闭合）
            _bar15Closes: [],           // 已闭合 15s bar 收盘（bar15RsiMaxBars 环形）

            _relPriceBnb: 0,            // 最近可靠价（新链专用）
            _relHighestPriceBnb: 0,     // 可靠价全时峰（与 highestPriceBnb 双轨）
            _relHighestAt: 0,
            _relHighestBlock: null,
            _postPeakBlockTail: new Map(), // 峰后 block → 价（postPeakSlope/blocksSinceHighest 原料）
            _minDdSinceHighestPct: 0,   // 峰后最深回撤 %
            deepDrop70At: null,         // 首触 -70% 时刻（新高重置）

            _curBlock: null,            // 单块跌幅链：当前块
            _curBlockClose: null,
            _curBlockHigh: null,
            _prevBlockClose: null,      // 前块收盘（相邻对结算；断链=null）
            _maxBlockDropPct: null,     // 单块最大跌幅 %（null=从无跌幅证据）
            _blockLowBlock: null,       // 块低点链
            _blockLowPriceBnb: null,
            _m3Block: null,             // m3 连续块收盘链
            _m3Close: null,
            _m3Closes: [],              // FIFO ≤4
            _max3BlockDrop: null,       // 4 块最大跌幅（小数，读时 ×100）

            _slideTicks: [],            // 30s 滑窗 {ts, isBuy, bnb, trader}
            _slideBuyBnb: 0,
            _slideSellBnb: 0,
            _slideTraderCounts: new Map(), // addr → 窗内笔数（计数映射，出窗减一）
            _walletFirstTs: new Map(),    // addr → 全史首现 ts（write-once，newWalletsSlide 原料）

            dataCollectionRound: 1, // 引擎 30s 时序快照轮次
        };
    }

    /**
     * Q 组：creator 前作 registry 推进（processTick 可靠价路径调用，回迁批 2.5）。
     * 新 token 首个可靠价登记 {firstTs, firstPb, maxPb}（首值 write-once）；老 token 只涨 maxPb。
     * 剪枝摊销：仅在该 creator 登记新 token 时扫一遍，弃 firstTs 龄 >26h 的条目（已滑出 24h 前作窗，
     * 无论死活不再可及）；creator 条目清空即删键。因果性由回放顺序保证：决策 t 时 registry 只含 ts<t 的折叠。
     */
    _updateCreatorPrior(creatorAddress, tokenAddress, ts, priceBnb) {
        if (!creatorAddress) return;
        let toks = this._creatorPriors.get(creatorAddress);
        if (!toks) { toks = new Map(); this._creatorPriors.set(creatorAddress, toks); }
        let e = toks.get(tokenAddress);
        if (e) {
            if (priceBnb > e.maxPb) e.maxPb = priceBnb;
            return;
        }
        for (const [pt, pe] of toks) {
            if (ts - pe.firstTs > CREATOR_PRIOR_TTL_MS) toks.delete(pt);
        }
        toks.set(tokenAddress, { firstTs: ts, firstPb: priceBnb, maxPb: priceBnb });
    }

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

    /** 10s 时间桶推进价格/持有者序列（同桶后写覆盖，新桶追加，8 点封顶） */
    _pushSeriesPoint(state, ts) {
        const bucket = Math.floor(ts / 1000 / SERIES_BUCKET_SEC);
        const lastP = state._priceSeries[state._priceSeries.length - 1];
        if (lastP && lastP.bucket === bucket) {
            lastP.price = state.currentPriceBnb;
        } else {
            state._priceSeries.push({ bucket, price: state.currentPriceBnb });
            if (state._priceSeries.length > SERIES_MAX_POINTS) state._priceSeries.shift();
        }

        const lastH = state._holderSeries[state._holderSeries.length - 1];
        if (lastH && lastH.bucket === bucket) {
            lastH.count = state.holderCount;
        } else {
            state._holderSeries.push({ bucket, count: state.holderCount });
            if (state._holderSeries.length > SERIES_MAX_POINTS) state._holderSeries.shift();
        }
    }

    _pruneRecentTicks(state, now) {
        const ticks = state._recentTicks;
        if (ticks.length === 0) return;
        // 摊销：只在尾部越过窗口且长度超阈值时批量裁剪
        if (ticks.length > 64 && now - ticks[0].ts > RATE_WINDOW_MS) {
            while (ticks.length > 0 && now - ticks[0].ts > RATE_WINDOW_MS) ticks.shift();
        }
    }

    /** 30s 滑窗增量维护（回迁批 1：写时进出窗，读取 O(1)） */
    _updateSlideWin(state, now, isBuy, bnb, trader) {
        state._slideTicks.push({ ts: now, isBuy, bnb, trader });
        if (isBuy) state._slideBuyBnb += bnb; else state._slideSellBnb += bnb;
        if (trader) {
            state._slideTraderCounts.set(trader, (state._slideTraderCounts.get(trader) || 0) + 1);
            if (!state._walletFirstTs.has(trader)) state._walletFirstTs.set(trader, now); // write-once
        }
        const cutoff = now - this._fp.slideWinMs;
        while (state._slideTicks.length > 0 && state._slideTicks[0].ts < cutoff) {
            const old = state._slideTicks.shift();
            if (old.isBuy) state._slideBuyBnb -= old.bnb; else state._slideSellBnb -= old.bnb;
            if (old.trader) {
                const cnt = state._slideTraderCounts.get(old.trader);
                if (cnt !== undefined) {
                    if (cnt <= 1) state._slideTraderCounts.delete(old.trader);
                    else state._slideTraderCounts.set(old.trader, cnt - 1);
                }
            }
        }
    }

    /** 滑窗速率族（spanSec = min(tokenAge, winSpan)，新币自适应；首 tick 缺失回退窗宽） */
    _slideWinFactors(state, now) {
        const winSpanSec = this._fp.slideWinMs / 1000;
        const tokenAgeSec = state.firstTickAt !== null
            ? Math.max((now - state.firstTickAt) / 1000, 0) : winSpanSec;
        const spanSec = Math.max(Math.min(tokenAgeSec, winSpanSec), 1);
        return {
            tradesPerSecondSlide: state._slideTicks.length / spanSec,
            bnbPerSecondSlide: (state._slideBuyBnb + state._slideSellBnb) / spanSec,
            newTradersPerSecondSlide: state._slideTraderCounts.size / spanSec,
            newWalletsSlide: (() => {
                const cutoff = now - this._fp.slideWinMs;
                let n = 0;
                for (const w of state._slideTraderCounts.keys()) {
                    const ft = state._walletFirstTs.get(w);
                    if (ft !== undefined && ft >= cutoff) n++;
                }
                return n;
            })(),
        };
    }

    /** K 线闭合：双缓冲落盘（短窗+长窗同一快照；全窗无有效价不开 K 线） */
    _commitCandle(state) {
        const c = state._candleCurrent;
        if (c.open === null) return;
        const lit = {
            block: c.block, open: c.open, high: c.high, low: c.low, close: c.close,
            volBnb: c.volBnb, buyBnb: c.buyBnb, sellBnb: c.sellBnb,
            nTicks: c.nTicks, nBuys: c.nBuys, firstTs: c.firstTs,
        };
        state._candlesClosed.push(lit);
        if (state._candlesClosed.length > this._fp.ohlcvMaxCandles) state._candlesClosed.shift();
        state._candlesClosedLong.push(lit);
        if (state._candlesClosedLong.length > this._fp.ohlcvLongMaxCandles) state._candlesClosedLong.shift();
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
     * 短窗 %/bar 斜率（窗口 20 根 K 线收盘；n<window 或均价=0 → null fail-closed）。
     * tbar=(w-1)/2，denom=w(w²-1)/12 的化简式，与离线 indicators.js:slopePct 同口径。
     */
    _slopePct(ys, window) {
        const n = ys.length;
        if (n < window) return null;
        const w = ys.slice(-window);
        const tbar = (window - 1) / 2;
        let sy = 0;
        for (const v of w) sy += v;
        const ybar = sy / window;
        let num = 0;
        for (let i = 0; i < window; i++) {
            num += (i - tbar) * (w[i] - ybar);
        }
        if (ybar === 0) return null;
        return (num / ((window * (window * window - 1)) / 12)) * 100; // %/bar
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
     * 保护期外 RSI（rsi9/rsi14PostProtect）：只用 buyTime+rsiProtectSeconds 之后的已闭合 K 线，
     * 尾扫到界即停（因果）；样本 <=period 或价幅 < rsiPostProtectMinSpanPct → null（RSI 噪声不读）。
     */
    _rsiPostProtect(state, pos, now, period = 9) {
        const cutMs = pos.buyTime + this._fp.rsiProtectSeconds * 1000;
        const cdl = state._candlesClosed;
        const closes = [];
        for (let i = cdl.length - 1; i >= 0; i--) {
            if (cdl[i].firstTs < cutMs) break;
            closes.push(cdl[i].close);
        }
        closes.reverse(); // 时间升序
        if (closes.length <= period) return null;
        const spanPct = closes[0] > 0
            ? Math.abs(closes[closes.length - 1] - closes[0]) / closes[0] * 100 : 0;
        if (!(spanPct >= this._fp.rsiPostProtectMinSpanPct)) return null;
        return this._rsi(closes, period);
    }

    /**
     * 脉冲期外连阳根数：从末根已闭合 K 线向前数，遇阴线（close<open）或根起始
     * firstTs < firstTickAt+postPulseCutMs（脉冲期内）即停；无已闭合根=0（自然 fail-closed）。
     */
    _postPulseConsecUp(cdl, firstTickAt) {
        if (firstTickAt === null || cdl.length === 0) return 0;
        const cutMs = firstTickAt + this._fp.postPulseCutMs;
        let up = 0;
        for (let i = cdl.length - 1; i >= 0; i--) {
            if (cdl[i].close < cdl[i].open) break;
            if (cdl[i].firstTs < cutMs) break;
            up++;
        }
        return up;
    }

    /**
     * 趋势窗 5 因子（母版 _computePriceTrendFactors 逐字对齐，仅窗口/锚点 BSC 化）：
     *   priceTrendSlope                  对数价格 OLS 斜率 %/s（方向速度；n>=8 且非 widened 分桶中位抗毒价）
     *   recentDrawdownFromWindowHighPct  距窗内高点回撤 %≤0（位置）
     *   recentRiseFromWindowLowPct       距窗内低点拉起 %≥0
     *   spikeCurveRatio                  针曲线达标比值（3s35%↔6s100% 线性；≥1=针）
     *   riseFromLow6s                    近 6s 自最低可靠价反弹 %（深跌反弹门原料）
     * 可靠 tick 不足（<trendAbsMinTicks）→ 全 null（fail-closed）。主窗最近 min(trendWindowMs, age)，
     * 不足 trendMinReliableTicks 且总数 >=trendAbsMinTicks → widened 全历史（新币苗子自适应）。
     */
    _computePriceTrendFactors(recentTicks, now, firstTickAt) {
        const NULL_RESULT = {
            priceTrendSlope: null,
            recentDrawdownFromWindowHighPct: null,
            recentRiseFromWindowLowPct: null,
            spikeCurveRatio: null,
            riseFromLow6s: null,
        };
        if (!Array.isArray(recentTicks) || recentTicks.length === 0) return NULL_RESULT;

        const reliable = [];
        for (const tk of recentTicks) {
            if (tk.priceReliable && Number(tk.priceBnb) > 0) {
                reliable.push({ t: Number(tk.ts), p: Number(tk.priceBnb) });
            }
        }
        if (reliable.length === 0) return NULL_RESULT;

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

        let high = 0;
        for (const x of window) if (x.p > high) high = x.p;
        const recentDrawdownFromWindowHighPct = high > 0
            ? (window[n - 1].p - high) / high * 100 : null;

        let low = Infinity;
        for (const x of window) if (x.p < low) low = x.p;
        const recentRiseFromWindowLowPct = (low > 0 && Number.isFinite(low))
            ? (window[n - 1].p - low) / low * 100 : null;

        // 针曲线 + 近 6s 反弹（同一遍历同一低点；窗内 reliable tick <2 的窗口跳过，全跳过 → null）
        let spikeCurveRatio = null;
        let riseFromLow6s = null;
        {
            const cur = window[n - 1].p;
            for (const wSec of SPIKE_CURVE_WINDOWS_S) {
                const cut = now - wSec * 1000;
                let lo = Infinity, cnt = 0;
                for (const x of window) {
                    if (x.t < cut) continue;
                    if (x.p < lo) lo = x.p;
                    cnt++;
                }
                if (cnt < 2 || !(lo > 0)) continue;
                const risePct = (cur - lo) / lo * 100;
                if (wSec === 6) riseFromLow6s = risePct;
                const ratio = risePct / spikeCurveThresholdPct(wSec);
                if (spikeCurveRatio === null || ratio > spikeCurveRatio) spikeCurveRatio = ratio;
            }
        }

        return {
            priceTrendSlope,
            recentDrawdownFromWindowHighPct,
            recentRiseFromWindowLowPct,
            spikeCurveRatio,
            riseFromLow6s,
        };
    }

    /** 滑窗速率与量能因子 */
    _rateFactors(state, now) {
        const inWindow = state._recentTicks.filter(t => now - t.ts <= RATE_WINDOW_MS);
        const spanMin = Math.max(
            (now - (inWindow.length > 0 ? inWindow[0].ts : now)) / 60000,
            0.2 // 避免除零：窗口过短时按 12s 折算
        );
        let buyBnb = 0, sellBnb = 0, buys = 0, sells = 0;
        for (const t of inWindow) {
            if (t.isBuy) { buys++; buyBnb += t.bnb; } else { sells++; sellBnb += t.bnb; }
        }
        return {
            tradesPerMin: (buys + sells) / spanMin,
            buysPerMin: buys / spanMin,
            sellsPerMin: sells / spanMin,
            buyVolumeBnb5m: buyBnb,
            sellVolumeBnb5m: sellBnb,
            buySellVolumeRatio5m: sellBnb > 0 ? buyBnb / sellBnb : (buyBnb > 0 ? Infinity : 0),
        };
    }

    /** per-position 持仓期因子 */
    _positionFactors(state, pos, now) {
        const currentBnb = state.currentPriceBnb || 0;
        const holdDuration = pos.buyTime ? (now - pos.buyTime) / 1000 : 0;
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
            holdDuration,
            profitPercent,
            highestPriceSinceLastBuy: pos.highestPriceSinceBuyBnb * (state.lastImpliedBnbUsd || 0),
            highestPriceSinceLastBuyBnb: pos.highestPriceSinceBuyBnb,
            drawdownFromHighestSinceLastBuy,
            highestHolderCountSinceLastBuy: pos.highestHoldersSinceBuy,
            holderDrawdownFromHighestSinceLastBuy,
            // 回迁批 1 H 组（可靠价链口径）
            peakProfitPct: pos.peakProfitPct || 0,          // running max，_buildFactorMap 先推进后读取
            ddConfirmSellFlag: pos.ddcwSell ? 1 : 0,        // 回撤确认状态机 latch
            rsi9PostProtect: this._rsiPostProtect(state, pos, now),
            rsi14PostProtect: this._rsiPostProtect(state, pos, now, 14),
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
            holdDuration: 0,
            profitPercent: 0,
            highestPriceSinceLastBuy: null,
            highestPriceSinceLastBuyBnb: 0,
            drawdownFromHighestSinceLastBuy: null,
            highestHolderCountSinceLastBuy: null,
            holderDrawdownFromHighestSinceLastBuy: null,
            peakProfitPct: null,
            ddConfirmSellFlag: null,
            rsi9PostProtect: null,
            rsi14PostProtect: null,
        };
        if (state._lastPositionKey && state._positions.has(state._lastPositionKey)) {
            positionFactors = this._positionFactors(
                state, state._positions.get(state._lastPositionKey), now);
        }

        // ═══ 回迁批 2.6：市场截面快照（模块级单例分钟桶 memo；未 feed → null → 5 键全 null）═══
        const _mkt = this._getMarketSnapshot(now);

        // ═══ 回迁批 2.5：Q 组 creator 近期前作命中率（registry 因果性由回放顺序保证）═══
        //   买点 t 前 24h 内该 creator 已展开前作（首可靠价 ∈ [t−24h, t−10min]，排除本 token）
        //   中 3× 拉升（maxPb/firstPb ≥ 3）占比。分母<2 / creator 未知 → 率 null fail-closed
        //   （null=放行方向，门=「只留 null/0」）；creatorPriorCnt24h 为窗内前作计数
        //   （含分母不足的 0/1，供 metadata 观察为什么 null）。
        let creatorRecentHitRate3 = null;
        let creatorPriorCnt24h = null;
        const _cq = state.creatorAddress ? this._creatorPriors.get(state.creatorAddress) : null;
        if (_cq) {
            const _t0 = now - CREATOR_PRIOR_WINDOW_MS, _t1 = now - CREATOR_PRIOR_UNFOLD_MS;
            let _cnt = 0, _hit = 0;
            for (const [pt, pe] of _cq) {
                if (pt === state.tokenAddress) continue;
                if (pe.firstTs >= _t0 && pe.firstTs < _t1) {
                    _cnt++;
                    if (pe.firstPb > 0 && pe.maxPb / pe.firstPb >= 3) _hit++;
                }
            }
            creatorPriorCnt24h = _cnt;
            if (_cnt >= CREATOR_PRIOR_MIN_N) creatorRecentHitRate3 = _hit / _cnt;
        }

        // ═══ 回迁批 1：读取时聚合族（pumpfun 模式，避免 per-tick 全遍历）═══

        // P 组：净持仓集中度 top3/top5（五变量插入排序，v<=0 跳过——净口径免疫拆单）
        let _nA = 0, _nB = 0, _nC = 0, _nD = 0, _nE = 0;
        for (const v of state._traderNetTokens.values()) {
            if (v <= 0) continue;
            if (v > _nA) { _nE = _nD; _nD = _nC; _nC = _nB; _nB = _nA; _nA = v; }
            else if (v > _nB) { _nE = _nD; _nD = _nC; _nC = _nB; _nB = v; }
            else if (v > _nC) { _nE = _nD; _nD = _nC; _nC = v; }
            else if (v > _nD) { _nE = _nD; _nD = v; }
            else if (v > _nE) { _nE = v; }
        }
        const _holderTop3 = _nA + _nB + _nC;
        const _holderTop5 = _nA + _nB + _nC + _nD + _nE;

        // 累计买入集中度 top5 / 最大单户（单调不减，出货后留痕）
        let _cA = 0, _cB = 0, _cC = 0, _cD = 0, _cE = 0;
        for (const v of state._traderBoughtTokens.values()) {
            if (v > _cA) { _cE = _cD; _cD = _cC; _cC = _cB; _cB = _cA; _cA = v; }
            else if (v > _cB) { _cE = _cD; _cD = _cC; _cC = _cB; _cB = v; }
            else if (v > _cC) { _cE = _cD; _cD = _cC; _cC = v; }
            else if (v > _cD) { _cE = _cD; _cD = v; }
            else if (v > _cE) { _cE = v; }
        }
        const _cumBuyTop5 = _cA + _cB + _cC + _cD + _cE;

        // 大户群体（W = 累计买入 >= bigHolderMinCumBuyBnb）：
        // present=严格净持仓>0；early=首买块 <= s0+1（无块证据=晚到，fail-closed 方向）
        let _bhTotal = 0, _bhPresent = 0, _bhEarlyPresent = 0, _bhLatePresent = 0;
        let _bhShareTok = 0, _bhEarlyShareTok = 0, _bhLateShareTok = 0, _bhDump3s = 0, _bhDump9s = 0;
        {
            const _s0 = state.firstBlockNumber;
            for (const [_addr, _vol] of state._buyerVolume) {
                if (_vol < this._fp.bigHolderMinCumBuyBnb) continue;
                _bhTotal++;
                const _net = state._traderNetTokens.get(_addr) || 0;
                if (_net > 0) {
                    _bhPresent++;
                    _bhShareTok += _net;
                    const _fb = state._walletFirstBuyBlock.get(_addr);
                    if (_fb != null && _s0 != null && _fb <= _s0 + 1) {
                        _bhEarlyPresent++;
                        _bhEarlyShareTok += _net;
                    } else {
                        _bhLatePresent++;
                        _bhLateShareTok += _net;
                    }
                }
            }
            for (const [_ets, _ebnb] of state._bhSellEvents) {
                if (now - _ets <= this._fp.bhDumpShortMs) _bhDump3s += _ebnb;
                if (now - _ets <= this._fp.bhDumpLongMs) _bhDump9s += _ebnb;
            }
        }

        // K 组：对敲重叠（双边地址并集上的两栖占比；量口径抗人头稀释）
        let counterpartyOverlapRate = 0, counterpartyOverlapVolume = 0;
        {
            const _all = new Set([...state._buyerAddresses, ...state._sellerAddresses]);
            if (_all.size > 0) {
                let _overlap = 0, _unionVol = 0, _interVol = 0;
                for (const _addr of _all) {
                    const _v = (state._buyerVolume.get(_addr) || 0) + (state._sellerVolume.get(_addr) || 0);
                    _unionVol += _v;
                    if (state._buyerAddresses.has(_addr) && state._sellerAddresses.has(_addr)) {
                        _overlap++;
                        _interVol += _v;
                    }
                }
                counterpartyOverlapRate = _overlap / _all.size;
                counterpartyOverlapVolume = _unionVol > 0 ? _interVol / _unionVol : 0;
            }
        }

        // R 组：K 线趋势（block 桶收盘 ln-OLS；t=根序，单位 ln(price)/根 ≈ %/根）
        const _cdl = state._candlesClosed;
        const _ncdl = _cdl.length;
        const klineTrendSampleSize = _ncdl;
        let klineTrendSlope = null;
        if (_ncdl >= this._fp.ohlcvMinCandles) {
            klineTrendSlope = this._olsSlope(_cdl.map((c, i) => ({ t: i, y: Math.log(c.close) })));
        }

        // R 组：K 线形态（末根已闭合 candle；全因果——闭合瞬间就绪）
        let klineBarReturn = null, klineBodyPct = null, klineConsecUp = null, klineBsRatio = null, klineVolBnb = null;
        if (_ncdl >= 1) {
            const _last = _cdl[_ncdl - 1];
            const _span = _last.high - _last.low;
            klineBodyPct = _span > 0 ? Math.abs(_last.close - _last.open) / _span : null; // 一字线 null
            klineBsRatio = _last.sellBnb > 0 ? _last.buyBnb / _last.sellBnb : null;       // 卖为 0 → null（避 Inf）
            klineVolBnb = _last.volBnb;
            if (_ncdl >= 2 && _cdl[_ncdl - 2].close > 0) {
                klineBarReturn = (_last.close / _cdl[_ncdl - 2].close - 1) * 100;
            }
            // 连阳：末根向前连续 close>=open（含平开）
            let _cu = 0;
            for (let _k = _ncdl - 1; _k >= 0; _k--) {
                if (_cdl[_k].close >= _cdl[_k].open) _cu++; else break;
            }
            klineConsecUp = _cu;
        }

        // 脉冲期外连阳（脉冲期=首 tick 后 postPulseCutMs；「早期快买噪声不计，其后的连阳才是趋势」）
        const postPulseConsecUp = this._postPulseConsecUp(_cdl, state.firstTickAt);

        // RSI（Wilder 全量重算；warmup n<=period → null fail-closed）
        let rsi9 = null, rsi14 = null;
        if (_ncdl >= 2) {
            const _closes = _cdl.map(c => c.close);
            rsi9 = this._rsi(_closes, 9);
            rsi14 = this._rsi(_closes, 14);
        }
        // 秒级桶 RSI（墙钟秒收盘，空秒跳过）
        let rsi9Sec = null, rsi14Sec = null;
        if (state._secCloses.length >= 2) {
            rsi9Sec = this._rsi(state._secCloses, 9);
            rsi14Sec = this._rsi(state._secCloses, 14);
        }
        // 宽 bar（15s≈5 block）RSI：波段节奏档（母版 3s bar 的 BSC 适配）
        let rsi14Bar15s = null;
        if (state._bar15Closes.length > 14) {
            rsi14Bar15s = this._rsi(state._bar15Closes, 14);
        }
        // 长线秒级 RSI（增量全史 Wilder；m<period → null fail-closed）
        let rsi30Sec = null, rsi60Sec = null;
        if (state._secRsiLong && state._secRsiLong.m >= 30) {
            const L = state._secRsiLong;
            rsi30Sec = L.l30 === 0 ? 100 : 100 - 100 / (1 + L.g30 / L.l30);
            if (L.m >= 60) rsi60Sec = L.l60 === 0 ? 100 : 100 - 100 / (1 + L.g60 / L.l60);
        }

        // 短窗 %/bar 斜率（20 根；与 klineTrendSlope 的 ln 口径互补——量纲直接可比阈值）
        const slopePct20 = this._slopePct(_cdl.map(c => c.close), 20);

        // 末 ≤10 根 nBuys 均值
        let nBuysMa10 = null;
        if (_ncdl >= 1) {
            const _w10 = _cdl.slice(-10);
            nBuysMa10 = _w10.reduce((s, c) => s + (c.nBuys || 0), 0) / _w10.length;
        }

        // 末 5 根收盘 (max-min)/mean（平台波动带）
        let klineRange5 = null;
        if (_ncdl >= 5) {
            const _cs5 = _cdl.slice(-5).map(c => c.close);
            const _mx5 = Math.max(..._cs5), _mn5 = Math.min(..._cs5);
            const _mean5 = _cs5.reduce((a, b) => a + b, 0) / 5;
            if (_mean5 > 0) klineRange5 = (_mx5 - _mn5) / _mean5;
        }

        // RSI 底背离原料（长窗缓冲；右侧 divSwingL 根确认的 swing low，因果无 look-ahead；
        // 判定放 condition 层：价格新低 AND RSI 抬高）
        const _cdlL = state._candlesClosedLong;
        const _divL = this._fp.divSwingL;
        const _divP = this._fp.divRsiPeriod;
        let lastSwingLowPrice = null, lastSwingLowRsi = null;
        let prevSwingLowPrice = null, prevSwingLowRsi = null;
        if (_cdlL.length >= 2 * _divL + _divP + 2) {
            const closesL = _cdlL.map(c => c.close);
            const swings = [];
            for (let j = _cdlL.length - 1 - _divL; j >= _divL; j--) {
                const lowJ = _cdlL[j].low;
                let isLow = true;
                for (let k = j - _divL; k <= j + _divL; k++) {
                    if (_cdlL[k].low < lowJ) { isLow = false; break; }
                }
                if (!isLow) continue;
                swings.push({ low: lowJ, rsi: this._rsi(closesL.slice(0, j + 1), _divP) });
                if (swings.length >= 2) break; // 只要最近两个确认低点
            }
            if (swings.length >= 1) { lastSwingLowPrice = swings[0].low; lastSwingLowRsi = swings[0].rsi; }
            if (swings.length >= 2) { prevSwingLowPrice = swings[1].low; prevSwingLowRsi = swings[1].rsi; }
        }

        // T 组：峰值后趋势（接飞刀过滤器原料；峰后 block 数不足窗口 → null fail-closed）
        const _ppW = this._fp.postPeakSlopeWindow;
        const _ppt = state._postPeakBlockTail;
        let postPeakSlope = null;
        if (_ppt.size >= _ppW) {
            const _ppBlocks = [..._ppt.keys()].sort((a, b) => a - b).slice(-_ppW);
            postPeakSlope = this._olsSlope(_ppBlocks.map((b, i) => ({ t: i, y: Math.log(_ppt.get(b)) })));
        }
        const msSinceHighest = state._relHighestAt > 0 ? now - state._relHighestAt : null;
        const blocksSinceHighest = _ppt.size;
        const maxDdSinceHighestPct = state._minDdSinceHighestPct;
        // 深跌浸泡秒数：首触 -70% 起算；未深跌 → null（fail-open 放行，浅跌票不经此门）
        const secondsSinceDeepDrop70 = state.deepDrop70At != null
            ? Math.max((now - state.deepDrop70At) / 1000, 0) : null;

        // 近期砸速 %/s：crashSpeedWindowMs 窗内自「窗内高点」的下跌速度（横盘/反弹收复 → null）。
        // 分母钳 >= crashSpeedMinDtMs/1000 防同块毫秒连砸把速度放大到不可解释量级。
        // 现价用 _relPriceBnb（母版 currentPriceUsd 本身就是可靠价链产物）。
        let crashSpeedPctPerSec = null;
        {
            const _csCut = now - this._fp.crashSpeedWindowMs;
            let _wh = 0, _whT = 0;
            for (const tk of state._recentTicks) {
                if (!tk.priceReliable || tk.ts < _csCut) continue;
                const _p = Number(tk.priceBnb);
                if (_p > _wh) { _wh = _p; _whT = tk.ts; }
            }
            if (_wh > 0 && _whT > 0 && now > _whT) {
                const _ddW = ((state._relPriceBnb - _wh) / _wh) * 100;
                if (_ddW < 0) {
                    crashSpeedPctPerSec = _ddW / Math.max((now - _whT) / 1000, this._fp.crashSpeedMinDtMs / 1000);
                }
            }
        }

        // 峰距跌速 %/s：全程可靠峰 → 现价的下跌全程平均速度（区分峰后秒砸 vs 阴跌多秒）。
        // 无回撤/创新高 → null（fail-open）；分母钳复用 crashSpeedMinDtMs。
        let peakFallSpeedPctPerSec = null;
        if (state._relHighestPriceBnb > 0 && state._relHighestAt > 0 && now > state._relHighestAt) {
            const _ddP = ((state._relPriceBnb - state._relHighestPriceBnb) / state._relHighestPriceBnb) * 100;
            if (_ddP < 0) {
                peakFallSpeedPctPerSec =
                    _ddP / Math.max((now - state._relHighestAt) / 1000, this._fp.crashSpeedMinDtMs / 1000);
            }
        }

        // 趋势窗 5 因子（可靠价切片）
        const trendFactors = this._computePriceTrendFactors(state._recentTicks, now, state.firstTickAt);

        // m3 实时外延：未闭合序列拼出第 4 块收盘（>0 且更深才覆盖存量最大值）
        let max3BlockDropPct = state._max3BlockDrop === null ? null : state._max3BlockDrop * 100;
        if (state._m3Close !== null && state._m3Closes.length >= 3) {
            const _m3Seq = state._m3Closes.concat([state._m3Close]);
            const _m3Live = (1 - _m3Seq[_m3Seq.length - 1] / _m3Seq[_m3Seq.length - 4]) * 100;
            if (_m3Live > 0 && (max3BlockDropPct === null || _m3Live > max3BlockDropPct)) {
                max3BlockDropPct = _m3Live;
            }
        }

        // 块低点市值（BNB 原生 + USD 换算）
        const _blockLowMcapBnb = (state._blockLowPriceBnb !== null && state.totalSupply > 0)
            ? state._blockLowPriceBnb * state.totalSupply : null;
        const _blockLowMcapUsd = (_blockLowMcapBnb !== null && bnbUsd > 0)
            ? _blockLowMcapBnb * bnbUsd : null;

        // E 组年龄基准（首 tick 起；tickFlowOk 分档用）
        const _ageSec = state.firstTickAt !== null ? Math.max((now - state.firstTickAt) / 1000, 0) : 0;

        // trend*：10s 桶价格序列（8 点窗，与 TrendDetector 固定窗口口径一致）
        const prices = state._priceSeries.map(p => p.price);
        const factors = {
            age,
            currentPrice,
            firstPrice,
            collectionPrice: firstPrice,   // 兼容旧前端
            launchPrice: firstPrice,       // 兼容旧前端
            currentPriceBnb,
            firstPriceBnb,
            earlyReturn,
            riseSpeed,

            buyPrice: positionFactors.buyPrice,
            holdDuration: positionFactors.holdDuration,
            profitPercent: positionFactors.profitPercent,

            highestPrice: bnbUsd > 0 ? state.highestPriceBnb * bnbUsd : 0,
            highestPriceTimestamp: state.highestPriceAt,
            drawdownFromHighest,
            highestPriceSinceLastBuy: positionFactors.highestPriceSinceLastBuy,
            drawdownFromHighestSinceLastBuy: positionFactors.drawdownFromHighestSinceLastBuy,
            highestHolderCountSinceLastBuy: positionFactors.highestHolderCountSinceLastBuy,
            holderDrawdownFromHighestSinceLastBuy: positionFactors.holderDrawdownFromHighestSinceLastBuy,

            // ── WSS 事件流口径的「AVE 替代」因子 ──
            holders: state.holderCount,
            txVolumeU24h: bnbUsd > 0 ? (state.totalBuyBnb + state.totalSellBnb) * bnbUsd : 0,
            tvl: bnbUsd > 0 ? state.lastFundsBnb * bnbUsd : 0,
            fdv: 0,        // 见下（与 marketCap 同值）
            marketCap: state.totalSupply > 0 && currentPrice > 0 ? currentPrice * state.totalSupply : 0,

            tweetAuthorType: 0, // 叙事已解耦，恒 0
            dataCollectionRound: state.dataCollectionRound,

            // ── tick 原生活跃度因子 ──
            tradeCount: state.tradeCount,
            buyCount: state.buyCount,
            sellCount: state.sellCount,
            uniqueTraderCount: state.uniqueTraders.size,
            buyVolumeBnb: state.totalBuyBnb,
            sellVolumeBnb: state.totalSellBnb,
            ...this._rateFactors(state, now),

            trendDataPoints: prices.length,

            // ═══ pumpfun 回迁批 1（68 新键；全部 BNB 原生口径，null fail-closed 见各注释）═══

            // 滑窗速率族（30s 窗，spanSec=新币自适应）
            ...this._slideWinFactors(state, now),

            // K 组：对敲重叠（0=无两栖地址；新 state 无双边证据=0）
            counterpartyOverlapRate,
            counterpartyOverlapVolume,

            // P 组：持仓集中度（净持仓口径免疫拆单；累计买入口径单调不减。
            // 分母=totalSupply（TokenCreate），缺失(=0) → null fail-closed——与母版常数 1e9 分母的裁定偏离）
            top3HolderShare: state.totalSupply > 0 ? _holderTop3 / state.totalSupply : null,
            top5HolderShare: state.totalSupply > 0 ? _holderTop5 / state.totalSupply : null,
            cumBuyTop5Share: state.totalSupply > 0 ? _cumBuyTop5 / state.totalSupply : null,
            maxCumBuyShare: state.totalSupply > 0 ? _cA / state.totalSupply : null,

            // 大户群体（W=累计买入 >= bigHolderMinCumBuyBnb；present=严格净持仓>0；
            // early=首买块 <= 首块+1（≈6s），无块证据=late）
            bigHolderPresent: _bhPresent,
            bigHolderEarlyPresent: _bhEarlyPresent,
            bigHolderLatePresent: _bhLatePresent,
            bigHolderTotal: _bhTotal,
            bigHolderPresentRatio: _bhTotal > 0 ? _bhPresent / _bhTotal : null,
            bigHolderShare: state.totalSupply > 0 ? _bhShareTok / state.totalSupply : null,
            bigHolderEarlyShare: state.totalSupply > 0 ? _bhEarlyShareTok / state.totalSupply : null,
            bigHolderLateShare: state.totalSupply > 0 ? _bhLateShareTok / state.totalSupply : null,
            bigHolderDumpBnb3s: _bhDump3s,
            bigHolderDumpBnb9s: _bhDump9s,

            // P 组防砸盘（maxBlockDropPct null=从无跌幅证据；块低点/首块脉冲见下）
            maxBlockDropPct: state._maxBlockDropPct,
            max3BlockDropPct,
            maxSingleBuyBnb: state._maxSingleBuyBnb,
            maxSingleSellBnb: state._maxSingleSellBnb,
            blockLowMcapBnb: _blockLowMcapBnb,
            blockLowMcapUsd: _blockLowMcapUsd,
            riseFromBlockLowPct: (state._relPriceBnb > 0 && state._blockLowPriceBnb !== null
                && state._blockLowPriceBnb > 0)
                ? ((state._relPriceBnb - state._blockLowPriceBnb) / state._blockLowPriceBnb) * 100
                : null,
            // 首块脉冲占比（母版首秒脉冲防钓鱼票；窗口冻结后才出值，null=窗口未过/无买入）
            firstBlockBuyShare: (state._firstBuyAt !== null
                && (now - state._firstBuyAt) >= this._fp.firstBlockWindowMs
                && state.totalBuyBnb > 0)
                ? state._firstBlockBuyBnb / state.totalBuyBnb
                : null,

            // R 组：K 线 / RSI（全部已闭合桶=因果；warmup null fail-closed）
            klineTrendSlope,
            klineTrendSampleSize,
            klineBarReturn,
            klineBodyPct,
            klineConsecUp,
            klineBsRatio,
            klineVolBnb,
            postPulseConsecUp,
            rsi9,
            rsi14,
            rsi9Sec,
            rsi14Sec,
            rsi14Bar15s,
            rsi30Sec,
            rsi60Sec,
            slopePct20,
            nBuysMa10,
            klineRange5,
            lastSwingLowPrice,
            prevSwingLowPrice,
            lastSwingLowRsi,
            prevSwingLowRsi,

            // T 组：峰值后形态（可靠价链；峰后样本不足 → null fail-closed）
            msSinceHighest,
            blocksSinceHighest,
            postPeakSlope,
            maxDdSinceHighestPct,
            crashSpeedPctPerSec,
            peakFallSpeedPctPerSec,
            secondsSinceDeepDrop70,
            riseFromLow6s: trendFactors.riseFromLow6s,
            spikeCurveRatio: trendFactors.spikeCurveRatio,
            priceTrendSlope: trendFactors.priceTrendSlope,
            recentDrawdownFromWindowHighPct: trendFactors.recentDrawdownFromWindowHighPct,
            recentRiseFromWindowLowPct: trendFactors.recentRiseFromWindowLowPct,

            // E 组：断流防御（无 tick 记录 → null；阈值按年龄分档，老档闭区间 <=）
            idleSecSinceLastTick: state.lastTickAt !== null ? Math.max((now - state.lastTickAt) / 1000, 0) : null,
            tickFlowOk: (() => {
                if (state.lastTickAt === null) return null;
                const _idle = Math.max((now - state.lastTickAt) / 1000, 0);
                if (_ageSec <= this._fp.tickFlowYoungAgeSec) return _idle < this._fp.tickFlowIdleYoungSec ? 1 : 0;
                if (_ageSec <= this._fp.tickFlowMidAgeSec) return _idle < this._fp.tickFlowIdleMidSec ? 1 : 0;
                return _idle <= this._fp.tickFlowIdleOldSec ? 1 : 0;
            })(),

            // Q 组：creator 前作命中率（批量发币方画像；null=creator 未知/窗内前作<2）
            creatorRecentHitRate3,
            creatorPriorCnt24h,

            // 市场截面 regime（观察版；★红线：不进任何交易策略 condition，audit 报错钉住；
            // 未 feed（web 裸 FA）→ 全 null；fed 下 marketNewbornCount1h 恒数值，率族受 cohort 门槛）
            marketNewbornCount1h: _mkt ? _mkt.newborn1h : null,
            marketRocketRate30m: _mkt ? _mkt.rocketRate : null,
            marketYoungMeanRet30m: _mkt ? _mkt.youngMeanRetPct : null,
            marketDeathRate30m: _mkt ? _mkt.deathRate : null,
            marketFlowBsRatio10m: _mkt ? _mkt.flowBsRatio : null,

            // H 组：持仓后（顶层=最新仓，无仓 null；ddConfirmSellFlag latch 至清仓）
            peakProfitPct: positionFactors.peakProfitPct,
            ddConfirmSellFlag: positionFactors.ddConfirmSellFlag,
            rsi9PostProtect: positionFactors.rsi9PostProtect,
            rsi14PostProtect: positionFactors.rsi14PostProtect,
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

        // holderTrend*：10s 桶持有者序列
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

        return factors;
    }
}

module.exports = FourMemeFactorAggregator;
