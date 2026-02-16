/**
 * Price Refresh Service
 *
 * 负责批量获取代币实时价格并更新数据库
 */

const { AveTokenAPI } = require('../../core/ave-api');

class PriceRefreshService {
    constructor(logger, db, config) {
        this.logger = logger;
        this.db = db;
        this.config = config;

        // 初始化 AVE TokenAPI（用于获取价格数据）
        const apiKey = process.env.AVE_API_KEY;
        this.aveTokenApi = new AveTokenAPI(
            config.ave?.apiUrl || 'https://api.ave.ai',
            config.ave?.timeout || 30000,
            apiKey
        );
    }

    /**
     * 批量刷新代币价格
     * @param {string} experimentId - 实验 ID
     * @returns {Promise<Object>} 更新结果
     */
    async refreshTokenPrices(experimentId) {
        const startTime = Date.now();
        this.logger.log(`开始刷新实验 ${experimentId} 的代币价格`);

        try {
            // 1. 获取实验中的所有代币
            const { data: tokens, error } = await this.db
                .from('experiment_tokens')
                .select('token_address, blockchain')
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

            // 2. 构建 tokenId 列表（格式：{address}-{chain}）
            const tokenIds = tokens.map(t => `${t.token_address}-${t.blockchain || 'bsc'}`);
            const prices = await this._fetchBatchPrices(tokenIds);

            if (!prices || Object.keys(prices).length === 0) {
                this.logger.log(`AVE API 未返回任何价格数据`);
                return {
                    success: true,
                    updated: 0,
                    failed: 0,
                    duration: Date.now() - startTime,
                    message: '未获取到价格数据'
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
     * 批量获取代币价格
     * @param {Array<string>} tokenIds - 代币ID数组（格式：{address}-{chain}）
     * @returns {Promise<Object>} 价格数据对象 { tokenId: { current_price_usd, ... } }
     * @private
     */
    async _fetchBatchPrices(tokenIds) {
        try {
            // AVE API 批量获取价格
            const response = await this.aveTokenApi.getTokenPrices(tokenIds);
            return response || {};
        } catch (error) {
            this.logger.log(`获取价格失败: ${error.message}`);
            return {};
        }
    }

    /**
     * 批量更新数据库中的价格
     * @param {string} experimentId - 实验 ID
     * @param {Object} prices - 价格数据对象 { tokenId: { current_price_usd, ... } }
     * @returns {Promise<Object>} 更新结果
     * @private
     */
    async _batchUpdatePrices(experimentId, prices) {
        let updated = 0;
        let failed = 0;

        for (const [tokenId, priceData] of Object.entries(prices)) {
            try {
                // 从 tokenId 中提取 token_address（格式：{address}-{chain}）
                const tokenAddress = tokenId.split('-')[0];
                if (!tokenAddress) continue;

                const currentPrice = parseFloat(priceData.current_price_usd);
                if (isNaN(currentPrice)) continue;

                // 更新数据库
                const { error } = await this.db
                    .from('experiment_tokens')
                    .update({
                        current_price_usd: currentPrice,
                        price_updated_at: new Date().toISOString(),
                        // 同时更新 raw_api_data 中的价格
                        raw_api_data: this.db.raw(`jsonb_set(
                            coalesce(raw_api_data, '{}'::jsonb),
                            '{current_price_usd}',
                            '${currentPrice}'::jsonb
                        )`)
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
