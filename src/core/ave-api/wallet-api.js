/**
 * AVE.ai 钱包类API JavaScript版本
 *
 * 提供钱包分析、盈亏查询、持仓分析等功能
 * 文档: https://ave-cloud.gitbook.io/data-api/rest/wallets
 */

const { BaseAveAPI } = require('./token-api');

class AveWalletAPI extends BaseAveAPI {
    constructor(baseURL = 'https://prod.ave-api.com', timeout = 30000, apiKey = null) {
        super(baseURL, timeout, apiKey);
    }

    /**
     * 获取钱包指定代币的盈亏数据
     *
     * 获取指定钱包对特定代币的详细盈亏分析，包括已实现和未实现盈亏。
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @param {string} tokenAddress - 代币地址
     * @param {number} fromTime - 开始时间（Unix时间戳），默认-1
     * @param {number} toTime - 结束时间（Unix时间戳），默认当前时间
     * @param {number} pageSize - 每页记录数量，默认100
     * @param {string} lastId - 分页游标，用于获取下一页数据
     * @returns {Promise<Object>} 钱包盈亏数据
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getWalletPnL(walletAddress, chain, tokenAddress, fromTime = -1, toTime = -1, pageSize = 100, lastId = null) {
        if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) {
            throw new Error('walletAddress必须是非空字符串');
        }
        if (!chain || typeof chain !== 'string' || !chain.trim()) {
            throw new Error('chain必须是非空字符串');
        }
        if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.trim()) {
            throw new Error('tokenAddress必须是非空字符串');
        }

        const params = {
            wallet_address: walletAddress.trim(),
            chain: chain.trim(),
            token_address: tokenAddress.trim(),
            page_size: pageSize
        };

        if (fromTime !== -1) {
            params.from_time = fromTime;
        }
        if (toTime !== -1) {
            params.to_time = toTime;
        }
        if (lastId) {
            params.last_id = lastId;
        }

        const result = await this._makeRequest('GET', '/v2/address/pnl', { params });
        const data = result.data || {};

        // 安全转换函数
        const safeFloat = (value, defaultValue = 0.0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseFloat(value);
            } catch (error) {
                return defaultValue;
            }
        };

        const safeInt = (value, defaultValue = 0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseInt(value);
            } catch (error) {
                return defaultValue;
            }
        };

        return {
            account_address: data.account_address || data.wallet_address || walletAddress,
            token_address: data.token_address || tokenAddress,
            total_purchased_usd: safeFloat(data.total_purchased_usd),
            total_purchase_amount: safeFloat(data.total_purchase_amount),
            total_purchase: safeInt(data.total_purchase),
            average_purchase_price_usd: safeFloat(data.average_purchase_price_usd),
            max_single_purchase_usd: safeFloat(data.max_single_purchase_usd),
            total_sold_usd: safeFloat(data.total_sold_usd),
            total_sold_amount: safeFloat(data.total_sold_amount),
            total_sold: safeInt(data.total_sold),
            average_sold_price_usd: safeFloat(data.average_sold_price_usd),
            max_single_sold_usd: safeFloat(data.max_single_sold_usd),
            first_purchase_time: data.first_purchase_time || '0001-01-01T00:00:00Z',
            first_sold_time: data.first_sold_time || '0001-01-01T00:00:00Z',
            last_purchase_time: data.last_purchase_time || '0001-01-01T00:00:00Z',
            last_sold_time: data.last_sold_time || '0001-01-01T00:00:00Z',
            profit_realized: safeFloat(data.profit_realized)
        };
    }

    /**
     * 获取钱包在指定链上的综合信息
     *
     * 获取钱包在特定区块链上的综合盈亏数据，包括所有代币的汇总信息。
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @returns {Promise<Object>} 钱包综合信息
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getWalletInfo(walletAddress, chain) {
        if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) {
            throw new Error('walletAddress必须是非空字符串');
        }
        if (!chain || typeof chain !== 'string' || !chain.trim()) {
            throw new Error('chain必须是非空字符串');
        }

        const params = {
            wallet_address: walletAddress.trim(),
            chain: chain.trim()
        };

        const result = await this._makeRequest('GET', '/v2/address/walletinfo', { params });
        const data = result.data || {};

        // 安全转换函数
        const safeFloat = (value, defaultValue = 0.0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseFloat(value);
            } catch (error) {
                return defaultValue;
            }
        };

        const safeInt = (value, defaultValue = 0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseInt(value);
            } catch (error) {
                return defaultValue;
            }
        };

        const walletInfo = {
            total_balance: safeFloat(data.total_balance),
            total_win_ratio: safeFloat(data.total_win_ratio),
            total_profit: safeFloat(data.total_profit),
            total_profit_ratio: safeFloat(data.total_profit_ratio),
            main_token_price: safeFloat(data.main_token_price),
            main_token_symbol: data.main_token_symbol || '',
            total_purchase: safeInt(data.total_purchase),
            total_sold: safeInt(data.total_sold),
            wallet_age: safeInt(data.wallet_age),
            wallet_chain_info: data.wallet_chain_info || [],
            wallet_address: walletAddress,
            chain: chain
        };

        return walletInfo;
    }

    /**
     * 获取钱包在指定链上持有的所有代币
     *
     * 获取钱包在特定区块链上持有的所有代币详细信息，包括持仓量和盈亏。
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @param {string} sort - 排序字段，可选：'profit_usd', 'balance_usd', 'profit_ratio'
     * @param {string} sortDir - 排序方向，'asc'或'desc'，默认'desc'
     * @param {boolean} hideSold - 是否隐藏已全部售出的代币，默认false
     * @param {boolean} hideSmall - 是否隐藏小额持仓，默认false
     * @param {number} pageSize - 每页记录数量，默认100
     * @param {number} pageNo - 页码，从1开始
     * @returns {Promise<Array>} 钱包代币持仓列表
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getWalletTokens(walletAddress, chain, sort = 'profit_usd', sortDir = 'desc', hideSold = false, hideSmall = false, pageSize = 100, pageNo = 1) {
        if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) {
            throw new Error('walletAddress必须是非空字符串');
        }
        if (!chain || typeof chain !== 'string' || !chain.trim()) {
            throw new Error('chain必须是非空字符串');
        }

        const params = {
            wallet_address: walletAddress.trim(),
            chain: chain.trim(),
            sort: sort,
            sort_dir: sortDir,
            hide_sold: hideSold,
            hide_small: hideSmall,
            pageSize: pageSize,
            pageNO: pageNo
        };

        const result = await this._makeRequest('GET', '/v2/address/walletinfo/tokens', { params });
        const data = result.data || [];

        // 安全转换函数
        const safeFloat = (value, defaultValue = 0.0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseFloat(value);
            } catch (error) {
                return defaultValue;
            }
        };

        const safeInt = (value, defaultValue = 0) => {
            if (value === null || value === '' || value === '--') {
                return defaultValue;
            }
            try {
                return parseInt(value);
            } catch (error) {
                return defaultValue;
            }
        };

        const tokens = [];
        for (const tokenData of data) {
            try {
                const token = {
                    token: tokenData.token || '',
                    chain: tokenData.chain || '',
                    logo_url: tokenData.logo_url || '',
                    symbol: tokenData.symbol || '',
                    risk_level: safeInt(tokenData.risk_level),
                    risk_score: safeInt(tokenData.risk_score),
                    last_txn_time: safeInt(tokenData.last_txn_time),
                    total_profit: safeFloat(tokenData.total_profit),
                    total_profit_ratio: safeFloat(tokenData.total_profit_ratio),
                    unrealized_profit: safeFloat(tokenData.unrealized_profit),
                    realized_profit: safeFloat(tokenData.realized_profit),
                    balance_amount: safeFloat(tokenData.balance_amount),
                    balance_usd: safeFloat(tokenData.balance_usd),
                    total_purchase_usd: safeFloat(tokenData.total_purchase_usd),
                    average_purchase_price_usd: safeFloat(tokenData.average_purchase_price_usd),
                    total_sold_usd: safeFloat(tokenData.total_sold_usd),
                    average_sold_price_usd: safeFloat(tokenData.average_sold_price_usd),
                    total_transfer_in_amount: safeFloat(tokenData.total_transfer_in_amount),
                    total_transfer_out_amount: safeFloat(tokenData.total_transfer_out_amount),
                    total_purchase: safeInt(tokenData.total_purchase),
                    total_sold: safeInt(tokenData.total_sold),
                    main_token_price: safeFloat(tokenData.main_token_price),
                    main_token_symbol: tokenData.main_token_symbol || '',
                    current_price_usd: safeFloat(tokenData.current_price_usd)
                };
                tokens.push(token);
            } catch (error) {
                console.warn(`解析钱包代币数据失败: ${error.message}`);
                continue;
            }
        }

        return tokens;
    }

    /**
     * 获取指定链上的智能钱包列表
     *
     * 获取在指定区块链上表现优秀的智能钱包列表，按盈利能力排序。
     *
     * @param {string} chain - 区块链名称
     * @param {string} sort - 排序字段，可选：'total_profit', 'win_rate', 'total_volume'
     * @param {string} sortDir - 排序方向，'asc'或'desc'，默认'desc'
     * @returns {Promise<Array>} 智能钱包列表
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getSmartWallets(chain, sort = 'total_profit', sortDir = 'desc') {
        if (!chain || typeof chain !== 'string' || !chain.trim()) {
            throw new Error('chain必须是非空字符串');
        }

        const params = {
            chain: chain.trim(),
            sort: sort,
            sort_dir: sortDir
        };

        const result = await this._makeRequest('GET', '/v2/address/smart_wallet/list', { params });
        const data = result.data || [];

        const wallets = [];
        for (const walletData of data) {
            try {
                const wallet = {
                    wallet_address: walletData.wallet_address || '',
                    tag: walletData.tag || '',
                    extra_info: walletData.extra_info || '',
                    tag_items: walletData.tag_items || [],
                    chain: walletData.chain || '',
                    total_trades: walletData.total_trades || 0,
                    buy_trades: walletData.buy_trades || 0,
                    sell_trades: walletData.sell_trades || 0,
                    token_profit_rate: walletData.token_profit_rate || '',
                    total_profit: walletData.total_profit || '',
                    total_profit_rate: walletData.total_profit_rate || '',
                    total_volume: walletData.total_volume || '',
                    total_purchase: walletData.total_purchase || '',
                    total_sold: walletData.total_sold || '',
                    profit_above_900_percent_num: walletData.profit_above_900_percent_num || 0,
                    profit_300_500_percent_num: walletData.profit_300_500_percent_num || 0,
                    profit_500_900_percent_num: walletData.profit_500_900_percent_num || 0,
                    profit_300_900_percent_num: walletData.profit_300_900_percent_num || 0,
                    profit_100_300_percent_num: walletData.profit_100_300_percent_num || 0,
                    profit_10_100_percent_num: walletData.profit_10_100_percent_num || 0,
                    profit_neg10_10_percent_num: walletData.profit_neg10_10_percent_num || 0,
                    profit_neg50_neg10_percent_num: walletData.profit_neg50_neg10_percent_num || 0,
                    profit_neg100_neg50_percent_num: walletData.profit_neg100_neg50_percent_num || 0,
                    last_trade_time: walletData.last_trade_time || '',
                    remark: walletData.remark || ''
                };
                wallets.push(wallet);
            } catch (error) {
                console.warn(`解析智能钱包数据失败: ${error.message}`);
                continue;
            }
        }

        return wallets;
    }

    /**
     * 获取钱包盈亏分析摘要
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @returns {Promise<Object>} 盈亏分析摘要
     */
    async getWalletPnLSummary(walletAddress, chain) {
        const walletInfo = await this.getWalletInfo(walletAddress, chain);
        const tokens = await this.getWalletTokens(walletAddress, chain, 'balance_usd', 'desc');

        let totalUnrealizedProfit = 0;
        let totalRealizedProfit = 0;
        let totalValue = 0;
        let profitableTokens = 0;
        let losingTokens = 0;

        tokens.forEach(token => {
            totalValue += token.balance_usd;
            totalUnrealizedProfit += token.unrealized_profit;
            totalRealizedProfit += token.realized_profit;

            if (token.total_profit > 0) {
                profitableTokens++;
            } else if (token.total_profit < 0) {
                losingTokens++;
            }
        });

        return {
            wallet_address: walletAddress,
            chain: chain,
            total_balance: totalValue,
            total_unrealized_profit: totalUnrealizedProfit,
            total_realized_profit: totalRealizedProfit,
            total_all_profit: totalUnrealizedProfit + totalRealizedProfit,
            total_tokens: tokens.length,
            profitable_tokens: profitableTokens,
            losing_tokens: losingTokens,
            win_rate: tokens.length > 0 ? (profitableTokens / tokens.length * 100).toFixed(2) + '%' : '0%',
            profit_loss_ratio: totalValue > 0 ? ((totalUnrealizedProfit + totalRealizedProfit) / totalValue * 100).toFixed(2) + '%' : '0%',
            wallet_age: walletInfo.wallet_age,
            total_trades: walletInfo.total_purchase + walletInfo.total_sold
        };
    }

    /**
     * 获取钱包持仓最多的代币
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @param {number} limit - 返回数量限制
     * @returns {Promise<Array>} 持仓最多的代币列表
     */
    async getWalletTopHoldings(walletAddress, chain, limit = 10) {
        const tokens = await this.getWalletTokens(walletAddress, chain, 'balance_usd', 'desc', false, false, limit, 1);

        return tokens.slice(0, limit).map(token => ({
            token: token.token,
            symbol: token.symbol,
            logo_url: token.logo_url,
            balance_amount: token.balance_amount,
            balance_usd: token.balance_usd,
            current_price_usd: token.current_price_usd,
            total_profit: token.total_profit,
            total_profit_ratio: token.total_profit_ratio,
            risk_level: token.risk_level
        }));
    }

    /**
     * 获取钱包表现最好的代币
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @param {number} limit - 返回数量限制
     * @returns {Promise<Array>} 表现最好的代币列表
     */
    async getWalletBestPerformers(walletAddress, chain, limit = 10) {
        const tokens = await this.getWalletTokens(walletAddress, chain, 'total_profit_ratio', 'desc', false, false, limit, 1);

        return tokens.slice(0, limit).map(token => ({
            token: token.token,
            symbol: token.symbol,
            logo_url: token.logo_url,
            total_profit: token.total_profit,
            total_profit_ratio: token.total_profit_ratio,
            balance_usd: token.balance_usd,
            total_purchase_usd: token.total_purchase_usd,
            total_sold_usd: token.total_sold_usd,
            risk_level: token.risk_level
        }));
    }
}

module.exports = {
    AveWalletAPI
};