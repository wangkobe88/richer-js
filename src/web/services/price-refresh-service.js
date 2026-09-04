/**
 * Price Refresh Service
 *
 * 批量刷新实验代币实时价格（Phase 6：数据源从 AVE API 改为 wss_price_ticks）
 * 每代币取时间最近一条有效 tick 的 price_usd 写回 experiment_tokens.current_price_usd。
 */

const TickKlineService = require('./tick-kline-service');

class PriceRefreshService {
    constructor(logger, db, config) {
        this.logger = logger;
        this.db = db;
        this.config = config;
        this.tickKlineService = new TickKlineService(logger);
    }

    /**
     * 批量刷新代币价格
     * @param {string} experimentId - 实验 ID
     * @returns {Promise<Object>} 更新结果
     */
    async refreshTokenPrices(experimentId) {
        const startTime = Date.now();
        this.logger.log(`开始刷新实验 ${experimentId} 的代币价格（tick 源）`);

        try {
            // 1. 获取实验中的所有代币
            const { data: tokens, error } = await this.db
                .from('experiment_tokens')
                .select('token_address')
                .eq('experiment_id', experimentId);

            if (error) {
                throw new Error(`获取代币列表失败: ${error.message}`);
            }

            if (!tokens || tokens.length === 0) {
                return {
                    success: true,
                    updated: 0,
                    failed: 0,
                    duration: Date.now() - startTime,
                    message: '没有需要更新的代币'
                };
            }

            // 2. tick 源批量取最新价
            const addresses = tokens.map(t => t.token_address);
            const prices = await this.tickKlineService.getLatestPrices(this.db, addresses);

            if (Object.keys(prices).length === 0) {
                return {
                    success: true,
                    updated: 0,
                    failed: 0,
                    duration: Date.now() - startTime,
                    message: '无 tick 数据（代币尚无成交记录）'
                };
            }

            // 3. 批量更新数据库
            const updateResults = await this._batchUpdatePrices(experimentId, prices);

            const duration = Date.now() - startTime;
            this.logger.log(`价格刷新完成: ${updateResults.updated} 个成功, ${updateResults.failed} 个失败, 耗时 ${duration}ms`);

            return {
                success: true,
                updated: updateResults.updated,
                failed: updateResults.failed,
                duration: duration,
                message: `成功更新 ${updateResults.updated} 个代币价格`
            };

        } catch (error) {
            this.logger.log(`刷新价格失败: ${error.message}`);
            return {
                success: false,
                updated: 0,
                failed: 0,
                duration: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * 批量更新数据库中的价格
     * @param {string} experimentId - 实验 ID
     * @param {Object<string, {price:number, blockTime:string}>} prices - tick 最新价
     * @returns {Promise<{updated:number, failed:number}>}
     * @private
     */
    async _batchUpdatePrices(experimentId, prices) {
        let updated = 0;
        let failed = 0;

        for (const [tokenAddress, priceData] of Object.entries(prices)) {
            try {
                const currentPrice = parseFloat(priceData.price);
                if (isNaN(currentPrice)) continue;

                const { error } = await this.db
                    .from('experiment_tokens')
                    .update({
                        current_price_usd: currentPrice,
                        price_updated_at: new Date().toISOString()
                    })
                    .eq('experiment_id', experimentId)
                    .eq('token_address', tokenAddress);

                if (error) {
                    this.logger.log(`更新代币 ${tokenAddress} 价格失败: ${error.message}`);
                    failed++;
                } else {
                    updated++;
                }
            } catch (error) {
                this.logger.log(`处理价格数据失败: ${error.message}`);
                failed++;
            }
        }

        return { updated, failed };
    }
}

module.exports = PriceRefreshService;
