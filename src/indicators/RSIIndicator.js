/**
 * RSI Indicator
 *
 * 计算相对强弱指标(RSI)
 * 参考 rich-js factors/implementations/RSIFactor.js
 */

class RSIIndicator {
    /**
     * @param {Object} config - RSI配置
     * @param {number} config.period - RSI周期
     * @param {number} [config.smoothingPeriod=9] - 平滑周期
     * @param {string} [config.smoothingType='EMA'] - 平滑类型 ('EMA' 或 'SMA')
     */
    constructor(config = {}) {
        this._period = config.period || 14;
        this._smoothingPeriod = config.smoothingPeriod || 9;
        this._smoothingType = config.smoothingType || 'EMA';

        // 验证参数
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
        return this._period + this._smoothingPeriod + 1;
    }

    /**
     * 计算RSI值
     * @param {Array<number>} prices - 价格数组
     * @returns {number} RSI值
     */
    calculate(prices) {
        if (!Array.isArray(prices) || prices.length < this._period + 1) {
            return 50; // 默认值
        }

        // 计算价格变化
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        // 分离收益和损失
        const gains = changes.map(change => change >= 0 ? change : 0);
        const losses = changes.map(change => change < 0 ? -change : 0);

        // 计算平滑的平均收益和损失
        const smoothedGains = this._smoothValues(gains, this._smoothingPeriod);
        const smoothedLosses = this._smoothValues(losses, this._smoothingPeriod);

        // 获取最新的平滑值
        const avgGain = smoothedGains[smoothedGains.length - 1];
        const avgLoss = smoothedLosses[smoothedLosses.length - 1];

        // 计算RSI
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
     * 从K线数据中计算RSI
     * @param {Array<Object>} klineData - K线数据数组
     * @param {string} [priceField='close'] - 价格字段
     * @returns {number} RSI值
     */
    calculateFromKline(klineData, priceField = 'close') {
        if (!Array.isArray(klineData) || klineData.length < this.getRequiredDataPoints()) {
            return 50; // 默认值
        }

        // 提取价格
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

        // 第一个值使用SMA作为起点
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
            requiredDataPoints: this.getRequiredDataPoints()
        };
    }
}

module.exports = { RSIIndicator };
