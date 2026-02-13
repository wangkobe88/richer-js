/**
 * AVE Token API Client for richer-js
 *
 * Simplified version for fourmeme token trading
 * API: https://prod.ave-api.com
 */

const axios = require('axios');

class AveAPIError extends Error {
    constructor(message, code = null) {
        super(message);
        this.name = 'AveAPIError';
        this.code = code;
    }
}

/**
 * AVE API 基类
 * 包含通用的HTTP请求功能
 */
class BaseAveAPI {
    constructor(baseURL = 'https://prod.ave-api.com', timeout = 30000, apiKey = null) {
        this.baseURL = baseURL;
        this.timeout = timeout;

        const headers = {};
        if (apiKey) {
            headers['X-API-KEY'] = apiKey;
            headers['Accept'] = '*/*';
        }

        this.client = axios.create({
            baseURL,
            timeout,
            headers
        });

        this.client.interceptors.response.use(
            response => response,
            error => {
                if (error.response) {
                    throw new AveAPIError(
                        `API请求失败: ${error.response.status} - ${error.response.data?.message || error.message}`,
                        error.response.status
                    );
                } else if (error.request) {
                    throw new AveAPIError('网络请求失败，请检查网络连接');
                } else {
                    throw new AveAPIError(`请求配置错误: ${error.message}`);
                }
            }
        );
    }

    async _makeRequest(method, endpoint, options = {}) {
        try {
            const config = {
                method: method.toLowerCase(),
                url: endpoint,
                ...options
            };
            const response = await this.client.request(config);
            return response.data;
        } catch (error) {
            if (error instanceof AveAPIError) throw error;
            throw new AveAPIError(`请求失败: ${error.message}`);
        }
    }
}

/**
 * AVE Token API
 * 用于获取代币信息和平台代币列表
 */
class AveTokenAPI extends BaseAveAPI {
    /**
     * 根据标签获取平台发行的代币
     * 用于获取 fourmeme 新代币
     *
     * @param {string} tag - 平台标签 (fourmeme_in_new, pump_in_new, etc.)
     * @param {string} chain - 区块链名称，默认'bsc'
     * @param {number} limit - 返回数量，默认100
     * @param {string} orderby - 排序字段，默认'created_at'
     * @returns {Promise<Array>} 代币列表
     */
    async getPlatformTokens(tag, chain = 'bsc', limit = 100, orderby = 'created_at') {
        if (!tag) {
            throw new Error('tag不能为空');
        }

        const params = { tag };
        if (chain) params.chain = chain;
        if (limit !== 100) params.limit = limit;
        if (orderby && orderby !== 'tx_volume_u_24h') params.orderby = orderby;

        const result = await this._makeRequest('GET', '/v2/tokens/platform', { params });
        const data = result.data || [];

        return data.map(tokenData => {
            // 保留完整的原始数据（包括 twitter、website 等可能存在的字段）
            const result = {
                total: tokenData.total || '',
                launch_price: tokenData.launch_price || '',
                current_price_eth: tokenData.current_price_eth || '',
                current_price_usd: tokenData.current_price_usd || '',
                price_change_1d: tokenData.price_change_1d || '',
                price_change_24h: tokenData.price_change_24h || '',
                lock_amount: tokenData.lock_amount || '',
                burn_amount: tokenData.burn_amount || '',
                other_amount: tokenData.other_amount || '',
                tx_amount_24h: tokenData.tx_amount_24h || '',
                tx_volume_u_24h: tokenData.tx_volume_u_24h || '',
                locked_percent: tokenData.locked_percent || '',
                market_cap: tokenData.market_cap || '',
                fdv: tokenData.fdv || '',
                tvl: tokenData.tvl || '',
                main_pair_tvl: tokenData.main_pair_tvl || '',
                token: tokenData.token || '',
                token_address: tokenData.token || '',
                chain: tokenData.chain || '',
                decimal: tokenData.decimal || 0,
                name: tokenData.name || '',
                symbol: tokenData.symbol || '',
                holders: tokenData.holders || 0,
                appendix: tokenData.appendix || '',
                logo_url: tokenData.logo_url || '',
                risk_score: tokenData.risk_score || '',
                created_at: tokenData.created_at || 0,
                tx_count_24h: tokenData.tx_count_24h || 0,
                lock_platform: tokenData.lock_platform || '',
                is_mintable: tokenData.is_mintable || '',
                updated_at: tokenData.updated_at || 0,
                main_pair: tokenData.main_pair || '',
                has_mint_method: tokenData.has_mint_method || 0,
                is_lp_not_locked: tokenData.is_lp_not_locked || 0,
                has_not_renounced: tokenData.has_not_renounced || 0,
                has_not_audited: tokenData.has_not_audited || 0,
                has_not_open_source: tokenData.has_not_open_source || 0,
                is_in_blacklist: tokenData.is_in_blacklist || 0,
                is_honeypot: tokenData.is_honeypot || 0,
                ave_risk_level: tokenData.ave_risk_level || 0,
                // 新增字段
                issue_platform: tokenData.issue_platform || '',
                intro_cn: tokenData.intro_cn || '',
                intro_en: tokenData.intro_en || '',
                launch_at: tokenData.launch_at || 0
            };

            // 复制所有其他字段（如 twitter、website、telegram 等）
            for (const [key, value] of Object.entries(tokenData)) {
                if (!(key in result)) {
                    result[key] = value;
                }
            }

            return result;
        });
    }

    /**
     * 获取代币详细信息
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @returns {Promise<Object>} 代币详细信息
     */
    async getTokenDetail(tokenId) {
        if (!tokenId) {
            throw new Error('tokenId不能为空');
        }

        const result = await this._makeRequest('GET', `/v2/tokens/${tokenId}`);
        const data = result.data || {};
        const tokenData = data.token || {};

        return {
            token: tokenData.token || '',
            chain: tokenData.chain || '',
            name: tokenData.name || '',
            symbol: tokenData.symbol || '',
            logo_url: tokenData.logo_url || '',
            current_price_usd: String(tokenData.current_price_usd || 0),
            market_cap: String(tokenData.market_cap || 0),
            fdv: String(tokenData.fdv || 0),
            tvl: String(tokenData.tvl || 0),
            created_at: parseInt(tokenData.created_at) || 0,
            launch_at: parseInt(tokenData.launch_at) || 0
        };
    }

    /**
     * 批量获取代币价格信息
     * 包含价格和多个分析因子（交易量、市值、持有者等）
     *
     * API 实际返回字段:
     * - current_price_usd: 当前价格
     * - price_change_1d: 1日价格变化
     * - price_change_24h: 24小时价格变化
     * - tvl: 总锁仓量
     * - fdv: 完全稀释估值
     * - market_cap: 市值
     * - tx_volume_u_24h: 24小时交易量
     * - holders: 持有者数量
     * - token_id: 代币ID
     * - updated_at: 更新时间
     *
     * @param {Array<string>} tokenIds - 代币ID列表，最多200个，格式：{CA}-{chain}
     * @param {number} tvlMin - 代币最小TVL阈值，默认1000，0表示无阈值
     * @param {number} tx24hVolumeMin - 代币最小24小时交易量阈值，默认0
     * @returns {Promise<Object>} 代币价格信息字典，包含多个分析因子
     */
    async getTokenPrices(tokenIds, tvlMin = 1000, tx24hVolumeMin = 0) {
        if (!tokenIds || tokenIds.length === 0) {
            throw new Error('tokenIds不能为空');
        }

        if (tokenIds.length > 200) {
            throw new Error('tokenIds不能超过200个');
        }

        const data = {
            token_ids: tokenIds,
            tvl_min: tvlMin,
            tx_24h_volume_min: tx24hVolumeMin
        };

        const result = await this._makeRequest('POST', '/v2/tokens/price', { data });

        const prices = {};
        const dataSection = result.data || {};

        for (const [tokenId, priceData] of Object.entries(dataSection)) {
            prices[tokenId] = {
                // 价格相关
                current_price_usd: priceData.current_price_usd || '',
                price_change_1d: priceData.price_change_1d || '',
                price_change_24h: priceData.price_change_24h || '',

                // 价值因子
                tvl: priceData.tvl || '',
                fdv: priceData.fdv || '',
                market_cap: priceData.market_cap || '',

                // 交易量因子
                tx_volume_u_24h: priceData.tx_volume_u_24h || '',

                // 持有者因子
                holders: priceData.holders || 0,

                // 时间戳
                token_id: priceData.token_id || tokenId,
                updated_at: priceData.updated_at || 0
            };
        }

        return prices;
    }

    /**
     * 获取代币TOP100持有者
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @param {number} limit - 返回记录数量，默认100，最大100
     * @returns {Promise<Array>} 代币持有者信息
     */
    async getTokenTop100Holders(tokenId, limit = 100) {
        if (!tokenId) {
            throw new Error('tokenId不能为空');
        }

        if (limit > 100) {
            throw new Error('limit不能超过100');
        }

        const params = {};
        if (limit !== 100) params.limit = limit;

        const result = await this._makeRequest('GET', `/v2/tokens/top100/${tokenId}`, { params });
        let data = result.data || [];

        // 兼容性处理：data可能是dict（包含holders字段）或直接是holders列表
        if (Array.isArray(data)) {
            // 直接是holders列表
            return data.map(holder_data => ({
                holder: holder_data.holder || '',
                remark: holder_data.remark || '',
                balance_ratio: holder_data.balance_ratio || '',
                balance_usd: holder_data.balance_usd || '',
                main_coin_balance: holder_data.main_coin_balance || '',
                avg_purchase_price: holder_data.avg_purchase_price || 0,
                avg_sale_price: holder_data.avg_sale_price || 0,
                realized_profit: holder_data.realized_profit || 0,
                unrealized_profit: holder_data.unrealized_profit || 0,
                total_profit: holder_data.total_profit || 0,
                realized_profit_ratio: holder_data.realized_profit_ratio || 0,
                unrealized_profit_ratio: holder_data.unrealized_profit_ratio || 0,
                total_profit_ratio: holder_data.total_profit_ratio || 0,
                transfer_in: holder_data.transfer_in || '',
                transfer_out: holder_data.transfer_out || 0,
                max_single_purchase_usd: holder_data.max_single_purchase_usd || 0,
                max_single_sold_usd: holder_data.max_single_sold_usd || 0,
                max_txn_usd: holder_data.max_txn_usd || 0,
                total_transfer_in: holder_data.total_transfer_in || 0,
                total_transfer_out: holder_data.total_transfer_out || 0,
                total_transfer_in_usd: holder_data.total_transfer_in_usd || 0,
                last_txn_time: holder_data.last_txn_time || '',
                age: holder_data.age || '',
                first_purchase_time: holder_data.first_purchase_time || null,
                token_first_transfer_in_from: holder_data.token_first_transfer_in_from || '',
                token_first_transfer_in_time: holder_data.token_first_transfer_in_time || '',
                sol_first_transfer_in_from: holder_data.sol_first_transfer_in_from || '',
                sol_first_transfer_in_time: holder_data.sol_first_transfer_in_time || null,
                address: holder_data.address || '',
                addr_alias: holder_data.addr_alias || '',
                amount_cur: holder_data.amount_cur || 0,
                cost_cur: holder_data.cost_cur || 0,
                sell_amount_cur: holder_data.sell_amount_cur || 0,
                sell_volume_cur: holder_data.sell_volume_cur || 0,
                buy_amount_cur: holder_data.buy_amount_cur || 0,
                buy_volume_cur: holder_data.buy_volume_cur || 0,
                buy_tx_count_cur: holder_data.buy_tx_count_cur || 0,
                sell_tx_count_cur: holder_data.sell_tx_count_cur || 0,
                trade_first_at: holder_data.trade_first_at || 0,
                trade_last_at: holder_data.trade_last_at || 0
            }));
        } else if (data.holders && Array.isArray(data.holders)) {
            // 是对象，包含holders字段
            return data.holders.map(holder_data => ({
                holder: holder_data.holder || '',
                remark: holder_data.remark || '',
                balance_ratio: holder_data.balance_ratio || '',
                balance_usd: holder_data.balance_usd || '',
                main_coin_balance: holder_data.main_coin_balance || '',
                avg_purchase_price: holder_data.avg_purchase_price || 0,
                avg_sale_price: holder_data.avg_sale_price || 0,
                realized_profit: holder_data.realized_profit || 0,
                unrealized_profit: holder_data.unrealized_profit || 0,
                total_profit: holder_data.total_profit || 0,
                realized_profit_ratio: holder_data.realized_profit_ratio || 0,
                unrealized_profit_ratio: holder_data.unrealized_profit_ratio || 0,
                total_profit_ratio: holder_data.total_profit_ratio || 0,
                transfer_in: holder_data.transfer_in || '',
                transfer_out: holder_data.transfer_out || 0,
                max_single_purchase_usd: holder_data.max_single_purchase_usd || 0,
                max_single_sold_usd: holder_data.max_single_sold_usd || 0,
                max_txn_usd: holder_data.max_txn_usd || 0,
                total_transfer_in: holder_data.total_transfer_in || 0,
                total_transfer_out: holder_data.total_transfer_out || 0,
                total_transfer_in_usd: holder_data.total_transfer_in_usd || 0,
                last_txn_time: holder_data.last_txn_time || '',
                age: holder_data.age || '',
                first_purchase_time: holder_data.first_purchase_time || null,
                token_first_transfer_in_from: holder_data.token_first_transfer_in_from || '',
                token_first_transfer_in_time: holder_data.token_first_transfer_in_time || '',
                sol_first_transfer_in_from: holder_data.sol_first_transfer_in_from || '',
                sol_first_transfer_in_time: holder_data.sol_first_transfer_in_time || null,
                address: holder_data.address || '',
                addr_alias: holder_data.addr_alias || '',
                amount_cur: holder_data.amount_cur || 0,
                cost_cur: holder_data.cost_cur || 0,
                sell_amount_cur: holder_data.sell_amount_cur || 0,
                sell_volume_cur: holder_data.sell_volume_cur || 0,
                buy_amount_cur: holder_data.buy_amount_cur || 0,
                buy_volume_cur: holder_data.buy_volume_cur || 0,
                buy_tx_count_cur: holder_data.buy_tx_count_cur || 0,
                sell_tx_count_cur: holder_data.sell_tx_count_cur || 0,
                trade_first_at: holder_data.trade_first_at || 0,
                trade_last_at: holder_data.trade_last_at || 0
            }));
        } else {
            return [];
        }
    }

    /**
     * 获取合约风险信息
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @returns {Promise<Object>} 合约风险信息
     */
    async getContractRisk(tokenId) {
        if (!tokenId) {
            throw new Error('tokenId不能为空');
        }

        const result = await this._makeRequest('GET', `/v2/contracts/${tokenId}`);
        const data = result.data || {};

        return {
            ai_report: data.ai_report || {},
            analysis_big_wallet: data.analysis_big_wallet || 0,
            analysis_creator_gt_5percent: data.analysis_creator_gt_5percent || 0,
            analysis_risk_score: data.analysis_risk_score || 0,
            analysis_scam_wallet: data.analysis_scam_wallet || 0,
            anti_whale_modifiable: data.anti_whale_modifiable || 0,
            approve_gas: data.approve_gas || '',
            burn_amount: data.burn_amount || 0,
            buy_gas: data.buy_gas || '',
            buy_tax: data.buy_tax || 0,
            can_take_back_ownership: data.can_take_back_ownership || 0,
            cannot_buy: data.cannot_buy || 0,
            cannot_sell_all: data.cannot_sell_all || 0,
            chain: data.chain || '',
            creator_address: data.creator_address || '',
            creator_balance: data.creator_balance || 0,
            creator_percent: data.creator_percent || '',
            decimal: data.decimal || 0,
            dex: data.dex || [],
            err_code: data.err_code || 0,
            err_msg: data.err_msg || '',
            external_call: data.external_call || 0,
            has_black_method: data.has_black_method || 0,
            has_code: data.has_code || 0,
            has_mint_method: data.has_mint_method || 0,
            has_white_method: data.has_white_method || 0,
            hidden_owner: data.hidden_owner || 0,
            holder_analysis: data.holder_analysis || {},
            holders: data.holders || 0,
            honeypot_with_same_creator: data.honeypot_with_same_creator || 0,
            is_anti_whale: data.is_anti_whale || 0,
            is_honeypot: data.is_honeypot || 0,
            is_in_dex: data.is_in_dex || 0,
            is_proxy: data.is_proxy || 0,
            lock_amount: data.lock_amount || 0,
            owner: data.owner || '',
            owner_balance: data.owner_balance || 0,
            owner_change_balance: data.owner_change_balance || 0,
            owner_percent: data.owner_percent || '',
            pair_holders: data.pair_holders || 0,
            pair_holders_rank: data.pair_holders_rank || [],
            pair_lock_percent: data.pair_lock_percent || 0,
            pair_total: data.pair_total || '',
            personal_slippage_modifiable: data.personal_slippage_modifiable || 0,
            previous_owner: data.previous_owner || '',
            query_count: data.query_count || 0,
            risk_score: data.risk_score || 0,
            selfdestruct: data.selfdestruct || 0,
            sell_gas: data.sell_gas || '',
            sell_tax: data.sell_tax || 0,
            slippage_modifiable: data.slippage_modifiable || 0,
            token: data.token || '',
            token_holders_rank: data.token_holders_rank || [],
            token_lock_percent: data.token_lock_percent || 0,
            token_name: data.token_name || '',
            token_symbol: data.token_symbol || '',
            total: data.total || '',
            trading_cooldown: data.trading_cooldown || 0,
            transfer_pausable: data.transfer_pausable || 0,
            transfer_tax: data.transfer_tax || 0,
            version: data.version || '',
            vote_support: data.vote_support || 0
        };
    }
}

module.exports = { AveAPIError, BaseAveAPI, AveTokenAPI };
