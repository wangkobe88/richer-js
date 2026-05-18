/**
 * RSI Indicator
 *
 * 计算相对强弱指标(RSI)，针对 pump.fun 内盘打新场景优化：
 * - 支持对数价格变换（避免极端波动导致 RSI 饱和）
 * - 支持 RSI 序列计算（用于 slope/divergence 检测）
 * - 支持 RSI 斜率和背离检测
 */

class RSIIndicator {
    /**
     * @param {Object} config - RSI配置
     * @param {number} config.period - RSI周期
     * @param {number} [config.smoothingPeriod=9] - 平滑周期
     * @param {string} [config.smoothingType='EMA'] - 平滑类型 ('EMA' 或 'SMA')
     * @param {boolean} [config.useLogPrices=false] - 是否使用对数价格（pumpfun 场景建议开启）
     */
    constructor(config = {}) {
        this._period = config.period || 14;
        this._smoothingPeriod = config.smoothingPeriod ?? Math.max(1, Math.floor(this._period / 3));
        this._smoothingType = config.smoothingType || 'EMA';
        this._useLogPrices = config.useLogPrices || false;

        if (this._period <= 0 || !Number.isInteger(this._period)) {
            throw new Error('RSI周期必须是正整数');
        }
        if (this._smoothingPeriod <= 0) {
            throw new Error('平滑周期必须是正数');
        }
        if (!['EMA', 'SMA'].includes(this._smoothingType)) {
            throw new Error('平滑类型必须是 EMA 或 SMA');
        }
    }

    /**
     * 获取所需的最小数据点数
     * @returns {number}
     */
    getRequiredDataPoints() {
        return this._period + 1;
    }

    /**
     * 预处理价格数组（对数变换）
     * @private
     * @param {number[]} prices
     * @returns {number[]}
     */
    _preprocessPrices(prices) {
        if (!this._useLogPrices) return prices;
        return prices.map(p => (p > 0 ? Math.log(p) : 0));
    }

    /**
     * 计算RSI值
     * @param {Array<number>} prices - 价格数组
     * @returns {number} RSI值
     */
    calculate(prices) {
        if (!Array.isArray(prices) || prices.length < this._period + 1) {
            return 50;
        }

        const processedPrices = this._preprocessPrices(prices);

        const changes = [];
        for (let i = 1; i < processedPrices.length; i++) {
            changes.push(processedPrices[i] - processedPrices[i - 1]);
        }

        const gains = changes.map(change => change >= 0 ? change : 0);
        const losses = changes.map(change => change < 0 ? -change : 0);

        const smoothedGains = this._smoothValues(gains, this._smoothingPeriod);
        const smoothedLosses = this._smoothValues(losses, this._smoothingPeriod);

        const avgGain = smoothedGains[smoothedGains.length - 1];
        const avgLoss = smoothedLosses[smoothedLosses.length - 1];

        if (avgLoss === 0) {
            return 100;
        } else if (avgGain === 0) {
            return 0;
        } else {
            const rs = avgGain / avgLoss;
            return 100 - (100 / (1 + rs));
        }
    }

    /**
     * 计算RSI序列（每个数据点对应一个RSI值）
     * 从第 (period+1) 个价格点开始，使用滑动窗口逐点计算
     * @param {Array<number>} prices - 价格数组
     * @returns {Array<number>} RSI值数组，长度 = prices.length - period
     */
    calculateSeries(prices) {
        if (!Array.isArray(prices) || prices.length < this._period + 1) {
            return [];
        }

        const processedPrices = this._preprocessPrices(prices);
        const rsiValues = [];

        for (let start = 0; start + this._period + 1 <= processedPrices.length; start++) {
            const window = processedPrices.slice(start, start + this._period + 1);
            const changes = [];
            for (let i = 1; i < window.length; i++) {
                changes.push(window[i] - window[i - 1]);
            }

            const gains = changes.map(c => c >= 0 ? c : 0);
            const losses = changes.map(c => c < 0 ? -c : 0);

            const smoothedGains = this._smoothValues(gains, this._smoothingPeriod);
            const smoothedLosses = this._smoothValues(losses, this._smoothingPeriod);

            const avgGain = smoothedGains[smoothedGains.length - 1];
            const avgLoss = smoothedLosses[smoothedLosses.length - 1];

            let rsi;
            if (avgLoss === 0) {
                rsi = 100;
            } else if (avgGain === 0) {
                rsi = 0;
            } else {
                const rs = avgGain / avgLoss;
                rsi = 100 - (100 / (1 + rs));
            }
            rsiValues.push(rsi);
        }

        return rsiValues;
    }

    /**
     * 计算RSI斜率（最近N个RSI值的线性回归斜率）
     * @param {Array<number>} rsiValues - RSI历史值数组
     * @param {number} [lookback=2] - 回看的RSI值个数
     * @returns {number} 斜率值（正值=RSI上升，负值=RSI下降）
     */
    calculateSlope(rsiValues, lookback = 2) {
        if (!Array.isArray(rsiValues) || rsiValues.length < lookback) {
            return 0;
        }

        const recent = rsiValues.slice(-lookback);
        if (lookback === 2) {
            return recent[1] - recent[0];
        }

        const n = recent.length;
        const sumX = (n - 1) * n / 2;
        const sumY = recent.reduce((a, b) => a + b, 0);
        const sumXY = recent.reduce((a, v, i) => a + i * v, 0);
        const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

        const denominator = n * sumX2 - sumX * sumX;
        if (denominator === 0) return 0;

        return (n * sumXY - sumX * sumY) / denominator;
    }

    /**
     * 检测RSI背离
     * 看跌背离：价格创新高但RSI未创新高 → 返回 -1
     * 看涨背离：价格创新低但RSI未创新低 → 返回 1
     * 无背离 → 返回 0
     * @param {Array<number>} prices - 原始价格数组
     * @param {Array<number>} rsiValues - RSI序列（与 prices 对齐，长度 = prices.length - period）
     * @param {number} [lookback=5] - 检查最近多少个数据点
     * @returns {number} -1 (看跌背离), 0 (无背离), 1 (看涨背离)
     */
    detectDivergence(prices, rsiValues, lookback = 5) {
        if (!Array.isArray(rsiValues) || rsiValues.length < lookback) {
            return 0;
        }

        const period = this._period;
        // RSI 值与价格的对应关系：rsiValues[i] 对应 prices[i + period]
        const recentRsi = rsiValues.slice(-lookback);
        const priceStart = prices.length - lookback;
        const recentPrices = prices.slice(priceStart);

        if (recentPrices.length < lookback) return 0;

        // 分前后两半比较
        const mid = Math.floor(lookback / 2);
        const firstHalfPrices = recentPrices.slice(0, mid);
        const secondHalfPrices = recentPrices.slice(mid);
        const firstHalfRsi = recentRsi.slice(0, mid);
        const secondHalfRsi = recentRsi.slice(mid);

        const priceHigh1 = Math.max(...firstHalfPrices);
        const priceHigh2 = Math.max(...secondHalfPrices);
        const priceLow1 = Math.min(...firstHalfPrices);
        const priceLow2 = Math.min(...secondHalfPrices);

        const rsiHigh1 = Math.max(...firstHalfRsi);
        const rsiHigh2 = Math.max(...secondHalfRsi);
        const rsiLow1 = Math.min(...firstHalfRsi);
        const rsiLow2 = Math.min(...secondHalfRsi);

        // 看跌背离：后半段价格创新高，但RSI没有创新高
        if (priceHigh2 > priceHigh1 && rsiHigh2 < rsiHigh1) {
            return -1;
        }

        // 看涨背离：后半段价格创新低，但RSI没有创新低
        if (priceLow2 < priceLow1 && rsiLow2 > rsiLow1) {
            return 1;
        }

        return 0;
    }

    /**
     * 从K线数据中计算RSI
     * @param {Array<Object>} klineData - K线数据数组
     * @param {string} [priceField='close'] - 价格字段
     * @returns {number} RSI值
     */
    calculateFromKline(klineData, priceField = 'close') {
        if (!Array.isArray(klineData) || klineData.length < this.getRequiredDataPoints()) {
            return 50;
        }

        const prices = klineData.map(k => parseFloat(k[priceField]) || 0);
        return this.calculate(prices);
    }

    /**
     * 对数值数组进行平滑处理
     * @private
     * @param {number[]} values - 待平滑的数值数组
     * @param {number} period - 平滑周期
     * @returns {number[]}
     */
    _smoothValues(values, period) {
        if (this._smoothingType === 'EMA') {
            return this._calculateEMA(values, period);
        } else {
            return this._calculateSMA(values, period);
        }
    }

    /**
     * 计算指数移动平均（EMA）
     * @private
     * @param {number[]} values - 数值数组
     * @param {number} period - 周期
     * @returns {number[]}
     */
    _calculateEMA(values, period) {
        if (values.length === 0) return [];

        const ema = [];
        const multiplier = 2 / (period + 1);

        let emaValue;
        if (values.length >= period) {
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += values[i];
            }
            emaValue = sum / period;
            ema.push(emaValue);

            for (let i = period; i < values.length; i++) {
                emaValue = (values[i] - emaValue) * multiplier + emaValue;
                ema.push(emaValue);
            }
        } else {
            emaValue = values[0];
            ema.push(emaValue);

            for (let i = 1; i < values.length; i++) {
                emaValue = (values[i] - emaValue) * multiplier + emaValue;
                ema.push(emaValue);
            }
        }

        return ema;
    }

    /**
     * 计算简单移动平均（SMA）
     * @private
     * @param {number[]} values - 数值数组
     * @param {number} period - 周期
     * @returns {number[]}
     */
    _calculateSMA(values, period) {
        if (values.length < period) {
            return new Array(values.length).fill(0);
        }

        const sma = [];

        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += values[i];
        }
        sma.push(sum / period);

        for (let i = period; i < values.length; i++) {
            sum = sum - values[i - period] + values[i];
            sma.push(sum / period);
        }

        return sma;
    }

    /**
     * 获取配置摘要
     * @returns {Object}
     */
    getConfigSummary() {
        return {
            period: this._period,
            smoothingPeriod: this._smoothingPeriod,
            smoothingType: this._smoothingType,
            useLogPrices: this._useLogPrices,
            requiredDataPoints: this.getRequiredDataPoints()
        };
    }
}

module.exports = { RSIIndicator };
