/**
 * GMGN Portfolio API
 *
 * 用户资产/钱包接口：钱包信息、持仓、交易历史、统计、代币余额、开发者代币
 * 所有方法使用 Normal Auth（仅需 API Key）
 *
 * API端点:
 *   GET /v1/user/info
 *   GET /v1/user/wallet_holdings
 *   GET /v1/user/wallet_activity
 *   GET /v1/user/wallet_stats
 *   GET /v1/user/wallet_token_balance
 *   GET /v1/user/created_tokens
 *   GET /v1/user/kol
 *   GET /v1/user/smartmoney
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNPortfolioAPI extends BaseGMGNAPI {
    /**
     * 获取 API Key 绑定的钱包信息及余额
     *
     * @returns {Promise<Object>} 钱包信息
     */
    async getUserInfo() {
        return this._normalRequest('GET', '/v1/user/info', {});
    }

    /**
     * 获取钱包代币持仓及 PnL
     *
     * @param {string} chain - 链标识: sol / bsc / base / eth
     * @param {string} walletAddress - 钱包地址
     * @param {Object} [extra] - 可选参数
     * @param {number} [extra.limit=20] - 每页数量(最大50)
     * @param {string} [extra.cursor] - 分页游标
     * @param {string} [extra.order_by='usd_value'] - 排序字段: usd_value / last_active_timestamp / realized_profit / unrealized_profit / total_profit / history_bought_cost / history_sold_income
     * @param {string} [extra.direction='desc'] - 排序方向
     * @param {string} [extra.hide_abnormal='false'] - 隐藏异常持仓
     * @param {string} [extra.hide_airdrop='true'] - 隐藏空投持仓
     * @param {string} [extra.hide_closed='true'] - 隐藏已平仓
     * @param {string} [extra.hide_open] - 隐藏未平仓 ('true')
     * @param {string} [extra.tx30d] - 仅显示近30天有交易的持仓 ('true')
     * @returns {Promise<Object>} 包含 holdings 数组
     */
    async getWalletHoldings(chain, walletAddress, extra = {}) {
        return this._normalRequest('GET', '/v1/user/wallet_holdings', {
            chain,
            wallet_address: walletAddress,
            ...extra,
        });
    }

    /**
     * 获取钱包交易历史 (分页)
     *
     * @param {string} chain - 链标识
     * @param {string} walletAddress - 钱包地址
     * @param {Object} [extra] - 可选参数
     * @param {string} [extra.token_address] - 按代币过滤
     * @param {number} [extra.limit] - 每页数量
     * @param {string} [extra.cursor] - 分页游标
     * @param {string[]} [extra.type] - 交易类型过滤: buy / sell / add / remove / transfer
     * @returns {Promise<Object>} 包含 activities 数组和 next 游标
     */
    async getWalletActivity(chain, walletAddress, extra = {}) {
        return this._normalRequest('GET', '/v1/user/wallet_activity', {
            chain,
            wallet_address: walletAddress,
            ...extra,
        });
    }

    /**
     * 获取钱包交易统计 (支持批量)
     *
     * @param {string} chain - 链标识
     * @param {string[]} walletAddresses - 钱包地址数组
     * @param {string} [period='7d'] - 统计周期: 7d / 30d
     * @returns {Promise<Object>} 包含 realized_profit, unrealized_profit, winrate, pnl 等
     */
    async getWalletStats(chain, walletAddresses, period = '7d') {
        return this._normalRequest('GET', '/v1/user/wallet_stats', {
            chain,
            wallet_address: walletAddresses,
            period,
        });
    }

    /**
     * 获取钱包中指定代币余额
     *
     * @param {string} chain - 链标识
     * @param {string} walletAddress - 钱包地址
     * @param {string} tokenAddress - 代币合约地址
     * @returns {Promise<Object>} 代币余额信息
     */
    async getWalletTokenBalance(chain, walletAddress, tokenAddress) {
        return this._normalRequest('GET', '/v1/user/wallet_token_balance', {
            chain,
            wallet_address: walletAddress,
            token_address: tokenAddress,
        });
    }

    /**
     * 获取开发者钱包创建的代币列表
     *
     * @param {string} chain - 链标识
     * @param {string} walletAddress - 开发者钱包地址
     * @param {Object} [extra] - 可选参数
     * @param {string} [extra.order_by] - 排序字段: market_cap / token_ath_mc
     * @param {string} [extra.direction='desc'] - 排序方向
     * @param {string} [extra.migrate_state] - 过滤: migrated / non_migrated
     * @returns {Promise<Object>} 包含 tokens 数组、last_create_timestamp、inner_count、open_count 等
     */
    async getCreatedTokens(chain, walletAddress, extra = {}) {
        return this._normalRequest('GET', '/v1/user/created_tokens', {
            chain,
            wallet_address: walletAddress,
            ...extra,
        });
    }

    /**
     * 获取 KOL 列表/交易记录
     *
     * @param {string} [chain] - 链标识(可选)
     * @param {number} [limit] - 返回数量(1-200)
     * @returns {Promise<Object>} KOL 数据
     */
    async getKol(chain, limit) {
        const query = {};
        if (chain) query.chain = chain;
        if (limit != null) query.limit = limit;
        return this._normalRequest('GET', '/v1/user/kol', query);
    }

    /**
     * 获取聪明钱列表/交易记录
     *
     * @param {string} [chain] - 链标识(可选)
     * @param {number} [limit] - 返回数量(1-200)
     * @returns {Promise<Object>} 聪明钱数据
     */
    async getSmartMoney(chain, limit) {
        const query = {};
        if (chain) query.chain = chain;
        if (limit != null) query.limit = limit;
        return this._normalRequest('GET', '/v1/user/smartmoney', query);
    }
}

module.exports = { GMGNPortfolioAPI };
