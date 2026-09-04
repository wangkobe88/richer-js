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
 * 模式参考 pumpfun-wss-trader 的 FactorAggregator（processTick/setBuyState/pruneStaleTokens/_acceptPrice）。
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

        this._states = new Map(); // tokenAddress → state

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

    /**
     * 当前因子体系的全量因子 key 集合（权威单一事实源，空 state 产出即全量键）。
     * Phase 3 策略 condition 键审计用：策略引用键 ∉ 此集合 = 会被静默封死买入。
     * 注：trend/holderTrend 明细键需 ≥2/≥4 个序列点才出现（与旧契约一致：数据不足保持 undefined），
     * 此处显式并入全集，避免审计误报。
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

        const isBuy = tick.trade_type === 'buy';
        const bnbAmount = tick.bnb_amount || 0;
        const priceBnb = tick.price_bnb || 0;
        const tokenAmount = tick.token_amount || 0;

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
            }
        }

        // ── 滑窗速率原料 ──
        state._recentTicks.push({ ts, isBuy, bnb: bnbAmount });
        this._pruneRecentTicks(state, ts);

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

            _recentTicks: [],    // 滑窗速率原料 {ts, isBuy, bnb}

            // 持仓（positionKey → pos）
            _positions: new Map(),
            _lastPositionKey: null,

            dataCollectionRound: 1, // 引擎 30s 时序快照轮次
        };
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
        };
    }

    /**
     * 因子图构建（键契约对齐 VirtualTradingEngine._buildFactors）
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
        };
        if (state._lastPositionKey && state._positions.has(state._lastPositionKey)) {
            positionFactors = this._positionFactors(
                state, state._positions.get(state._lastPositionKey), now);
        }

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
