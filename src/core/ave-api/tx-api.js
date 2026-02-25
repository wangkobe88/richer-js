/**
 * AVE.ai 交易记录类API JavaScript版本
 *
 * 提供交易记录查询、流动性变化查询、地址交易记录等功能
 * 文档: https://ave-cloud.gitbook.io/data-api/rest/txs
 */

const { BaseAveAPI } = require('./token-api');

class AveTxAPI extends BaseAveAPI {
    constructor(baseURL = 'https://prod.ave-api.com', timeout = 30000, apiKey = null) {
        super(baseURL, timeout, apiKey);
    }

    /**
     * 获取交易对的交换交易记录
     *
     * 获取指定交易对的所有交换交易历史记录。
     *
     * @param {string} pairId - 交易对ID，格式：{pair-address}-{chain}
     * @param {number} limit - 返回记录数量，默认100，最大300
     * @param {number} fromTime - 开始时间（Unix时间戳）
     * @param {number} toTime - 结束时间（Unix时间戳）
     * @param {string} sort - 排序方向，'asc'或'desc'，默认'asc'
     * @returns {Promise<Array>} 交换交易记录列表
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getSwapTransactions(pairId, limit = 100, fromTime = null, toTime = null, sort = 'asc') {
        if (!pairId || typeof pairId !== 'string' || !pairId.trim()) {
            throw new Error('pairId必须是非空字符串');
        }

        if (limit > 300) {
            throw new Error('limit不能超过300');
        }

        if (sort && !['asc', 'desc'].includes(sort)) {
            throw new Error('sort必须是asc或desc');
        }

        const params = {};
        if (limit !== 100) params.limit = limit;
        if (fromTime) params.from_time = fromTime;
        if (toTime) params.to_time = toTime;
        if (sort) params.sort = sort;

        const result = await this._makeRequest('GET', `/v2/txs/swap/${pairId}`, { params });

        // 处理不同的响应格式
        let data = [];
        if (result && result.data) {
            if (result.data.txs && Array.isArray(result.data.txs)) {
                data = result.data.txs;
            } else if (Array.isArray(result.data)) {
                data = result.data;
            }
        }

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

        const transactions = [];
        for (const txData of data) {
            try {
                const transaction = {
                    tx_id: txData.tx_hash || '',
                    time: safeInt(txData.tx_time),
                    chain: txData.chain || '',
                    pair: txData.pair_address || '',
                    from_address: txData.sender_address || '',
                    to_address: txData.to_address || '',
                    from_token: txData.from_token_address || '',
                    to_token: txData.to_token_address || '',
                    from_token_symbol: txData.from_token_symbol || '',
                    to_token_symbol: txData.to_token_symbol || '',
                    from_amount: safeFloat(txData.from_token_amount),
                    to_amount: safeFloat(txData.to_token_amount),
                    from_usd: safeFloat(txData.amount_usd), // 使用总USD价值
                    to_usd: safeFloat(txData.amount_usd),  // 交换交易中两者相等
                    block_number: safeInt(txData.block_number),
                    type: 'swap',
                    // 添加额外有用的字段
                    amm: txData.amm || '',
                    wallet_address: txData.wallet_address || '',
                    pair_liquidity_usd: safeFloat(txData.pair_liquidity_usd),
                    from_token_price_usd: safeFloat(txData.from_token_price_usd),
                    to_token_price_usd: safeFloat(txData.to_token_price_usd),
                    from_token_reserve: safeFloat(txData.from_token_reserve),
                    to_token_reserve: safeFloat(txData.to_token_reserve)
                };
                transactions.push(transaction);
            } catch (error) {
                console.warn(`解析交换交易数据失败: ${error.message}`);
                continue;
            }
        }

        return transactions;
    }

    /**
     * 获取交易对的流动性变化记录
     *
     * 获取指定交易对的流动性添加、移除和创建记录。
     *
     * @param {string} pairId - 交易对ID，格式：{pair-address}-{chain}
     * @param {number} limit - 返回记录数量，默认100，最大300
     * @param {number} fromTime - 开始时间（Unix时间戳）
     * @param {number} toTime - 结束时间（Unix时间戳）
     * @param {string} sort - 排序方向，'asc'或'desc'，默认'asc'
     * @param {string} type - 流动性类型，'all', 'addLiquidity', 'removeLiquidity', 'createPair'，默认'all'
     * @returns {Promise<Array>} 流动性变化记录列表
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getLiquidityTransactions(pairId, limit = 100, fromTime = null, toTime = null, sort = 'asc', type = 'all') {
        if (!pairId || typeof pairId !== 'string' || !pairId.trim()) {
            throw new Error('pairId必须是非空字符串');
        }

        if (limit > 300) {
            throw new Error('limit不能超过300');
        }

        if (sort && !['asc', 'desc'].includes(sort)) {
            throw new Error('sort必须是asc或desc');
        }

        if (type && !['all', 'addLiquidity', 'removeLiquidity', 'createPair'].includes(type)) {
            throw new Error('type必须是all, addLiquidity, removeLiquidity或createPair之一');
        }

        const params = {};
        if (limit !== 100) params.limit = limit;
        if (fromTime) params.from_time = fromTime;
        if (toTime) params.to_time = toTime;
        if (sort) params.sort = sort;
        if (type !== 'all') params.type = type;

        const result = await this._makeRequest('GET', `/v2/txs/liq/${pairId}`, { params });

        // 处理不同的响应格式
        let data = [];
        if (result && result.data) {
            if (result.data.txs && Array.isArray(result.data.txs)) {
                data = result.data.txs;
            } else if (Array.isArray(result.data)) {
                data = result.data;
            }
        }

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

        const transactions = [];
        for (const txData of data) {
            try {
                const transaction = {
                    tx_id: txData.transaction || txData.tx_id || '',
                    time: safeInt(txData.tx_time || txData.time),
                    chain: txData.chain || '',
                    pair: txData.pair_id || txData.pair || '',
                    type: txData.type || 'unknown',
                    from_address: txData.wallet_address || txData.from_address || '',
                    token0_address: txData.token0_address || '',
                    token1_address: txData.token1_address || '',
                    token0_symbol: txData.token0_symbol || '',
                    token1_symbol: txData.token1_symbol || '',
                    token0_amount: safeFloat(txData.amount0 || txData.token0_amount),
                    token1_amount: safeFloat(txData.amount1 || txData.token1_amount),
                    usd_value: safeFloat(txData.amount_usd || txData.usd_value),
                    block_number: safeInt(txData.block_number),
                    amm: txData.amm || '',
                    sender: txData.sender || ''
                };
                transactions.push(transaction);
            } catch (error) {
                console.warn(`解析流动性交易数据失败: ${error.message}`);
                continue;
            }
        }

        return transactions;
    }

    /**
     * 获取地址的代币交易记录
     *
     * 获取指定钱包地址对特定代币的所有交易记录，包括买卖和转账。
     *
     * @param {string} walletAddress - 钱包地址
     * @param {string} chain - 区块链名称
     * @param {string} tokenAddress - 代币地址
     * @param {number} fromTime - 开始时间（Unix时间戳），最早15天前
     * @param {number} toTime - 结束时间（Unix时间戳）
     * @param {number} pageSize - 每页记录数量，默认100，最大100
     * @param {string} lastId - 分页游标，用于获取下一页数据
     * @returns {Promise<Object>} 包含交易记录列表和分页信息的对象
     * @throws {AveAPIError} API调用失败时抛出
     * @throws {Error} 参数无效时抛出
     */
    async getAddressTransactions(walletAddress, chain, tokenAddress, fromTime = null, toTime = null, pageSize = 100, lastId = null) {
        if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) {
            throw new Error('walletAddress必须是非空字符串');
        }
        if (!chain || typeof chain !== 'string' || !chain.trim()) {
            throw new Error('chain必须是非空字符串');
        }
        if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.trim()) {
            throw new Error('tokenAddress必须是非空字符串');
        }

        if (pageSize > 100) {
            throw new Error('pageSize不能超过100');
        }

        const params = {
            wallet_address: walletAddress.trim(),
            chain: chain.trim(),
            token_address: tokenAddress.trim(),
            page_size: pageSize
        };

        if (fromTime) params.from_time = fromTime;
        if (toTime) params.to_time = toTime;
        if (lastId) params.last_id = lastId;

        const result = await this._makeRequest('GET', '/v2/address/tx', { params });
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

        const transactions = [];
        for (const txData of data) {
            try {
                const transaction = {
                    tx_id: txData.tx_id || '',
                    time: safeInt(txData.time),
                    chain: txData.chain || '',
                    from_address: txData.from_address || '',
                    to_address: txData.to_address || '',
                    token_address: txData.token_address || '',
                    token_symbol: txData.token_symbol || '',
                    amount: safeFloat(txData.amount),
                    usd_value: safeFloat(txData.usd_value),
                    block_number: safeInt(txData.block_number),
                    type: txData.type || 'transfer',
                    gas_used: safeFloat(txData.gas_used),
                    gas_price: safeFloat(txData.gas_price)
                };
                transactions.push(transaction);
            } catch (error) {
                console.warn(`解析地址交易数据失败: ${error.message}`);
                continue;
            }
        }

        return {
            transactions: transactions,
            has_more: result.has_more || false,
            next_cursor: result.next_cursor || null
        };
    }
}

module.exports = {
    AveTxAPI
};
