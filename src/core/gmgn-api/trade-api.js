/**
 * GMGN Trade API
 *
 * 交易执行接口：代币兑换、多钱包批量交易、订单管理、策略单
 * ⚠️ 所有方法需要 Critical Auth（API Key + 私钥签名）
 *
 * API端点:
 *   POST /v1/trade/swap
 *   POST /v1/trade/multi_swap
 *   GET  /v1/trade/quote
 *   GET  /v1/trade/query_order
 *   POST /v1/trade/strategy/create
 *   GET  /v1/trade/strategy/orders
 *   POST /v1/trade/strategy/cancel
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNTradeAPI extends BaseGMGNAPI {
    /**
     * 代币兑换 (单钱包)
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {Object} params
     * @param {string} params.chain - 链标识: sol / bsc / base / eth
     * @param {string} params.from_address - 钱包地址
     * @param {string} params.input_token - 输入代币合约地址
     * @param {string} params.output_token - 输出代币合约地址
     * @param {string} params.input_amount - 输入数量(最小单位)，百分比模式时为 '0'
     * @param {string} [params.input_amount_bps] - 百分比(基点)，如 '5000' = 50%
     * @param {number} [params.slippage] - 滑点容忍度(小数)，如 0.01 = 1%
     * @param {boolean} [params.auto_slippage] - 自动滑点
     * @param {string} [params.min_output_amount] - 最小输出数量
     * @param {boolean} [params.is_anti_mev] - 启用反MEV保护
     * @param {string} [params.priority_fee] - 优先费(SOL)
     * @param {string} [params.tip_fee] - 小费
     * @param {Object[]} [params.condition_orders] - 止盈止损条件数组
     * @param {string} [params.sell_ratio_type] - 卖出基准: buy_amount / hold_amount
     * @returns {Promise<Object>} 包含 order_id, status, hash 等
     */
    async swap(params) {
        return this._criticalRequest('POST', '/v1/trade/swap', {}, params);
    }

    /**
     * 多钱包批量代币兑换 (最多100个钱包)
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {Object} params
     * @param {string} params.chain - 链标识
     * @param {string[]} params.accounts - 钱包地址数组
     * @param {string} params.input_token - 输入代币地址
     * @param {string} params.output_token - 输出代币地址
     * @param {Object} [params.input_amount] - 钱包→数量 映射 (最小单位)
     * @param {Object} [params.input_amount_bps] - 钱包→百分比(基点) 映射
     * @param {Object} [params.output_amount] - 钱包→目标输出量 映射
     * @param {number} [params.slippage] - 滑点容忍度
     * @param {Object[]} [params.condition_orders] - 止盈止损条件数组
     * @returns {Promise<Object[]>} 每个钱包的执行结果数组
     */
    async multiSwap(params) {
        return this._criticalRequest('POST', '/v1/trade/multi_swap', {}, params);
    }

    /**
     * 获取报价 (不执行交易)
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {string} chain - 链标识
     * @param {string} fromAddress - 钱包地址
     * @param {string} inputToken - 输入代币地址
     * @param {string} outputToken - 输出代币地址
     * @param {string} amount - 输入数量(最小单位)
     * @param {number} slippage - 滑点容忍度
     * @returns {Promise<Object>} 包含 input_amount, output_amount, min_output_amount 等
     */
    async quoteOrder(chain, fromAddress, inputToken, outputToken, amount, slippage) {
        return this._criticalRequest('GET', '/v1/trade/quote', {
            chain,
            from_address: fromAddress,
            input_token: inputToken,
            output_token: outputToken,
            input_amount: amount,
            slippage,
        }, null);
    }

    /**
     * 查询订单状态
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {string} orderId - 订单ID
     * @param {string} chain - 链标识
     * @returns {Promise<Object>} 包含 order_id, status, hash, report 等
     */
    async queryOrder(orderId, chain) {
        return this._criticalRequest('GET', '/v1/trade/query_order', {
            order_id: orderId,
            chain,
        }, null);
    }

    /**
     * 创建策略订单 (限价/止盈止损)
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {Object} params
     * @param {string} params.chain - 链标识
     * @param {string} params.from_address - 钱包地址
     * @param {string} params.base_token - 基础代币地址
     * @param {string} params.quote_token - 报价代币地址
     * @param {string} params.order_type - 订单类型: limit_order
     * @param {string} params.sub_order_type - 子类型: buy_low / buy_high / stop_loss / take_profit
     * @param {string} params.check_price - 触发检查价格
     * @param {string} [params.amount_in] - 输入数量(最小单位)
     * @param {string} [params.amount_in_percent] - 输入百分比
     * @param {number} [params.slippage] - 滑点容忍度
     * @returns {Promise<Object>} 包含 order_id, is_update
     */
    async createStrategyOrder(params) {
        return this._criticalRequest('POST', '/v1/trade/strategy/create', {}, params);
    }

    /**
     * 查询策略订单列表
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {string} chain - 链标识
     * @param {Object} [extra] - 可选参数
     * @param {string} [extra.type] - open / history
     * @param {string} [extra.from_address] - 过滤钱包地址
     * @param {string} [extra.group_tag] - 订单组: LimitOrder / STMix
     * @param {string} [extra.base_token] - 过滤代币地址
     * @param {string} [extra.page_token] - 分页游标
     * @param {number} [extra.limit] - 每页数量
     * @returns {Promise<Object>} 包含 list 数组和 next_page_token
     */
    async getStrategyOrders(chain, extra = {}) {
        return this._criticalRequest('GET', '/v1/trade/strategy/orders', { chain, ...extra }, null);
    }

    /**
     * 取消策略订单
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {Object} params
     * @param {string} params.chain - 链标识
     * @param {string} params.from_address - 钱包地址
     * @param {string} params.order_id - 订单ID
     * @param {string} [params.order_type] - limit_order / smart_trade
     * @param {string} [params.close_sell_model] - 平仓卖出模式
     * @returns {Promise<Object>}
     */
    async cancelStrategyOrder(params) {
        return this._criticalRequest('POST', '/v1/trade/strategy/cancel', {}, params);
    }
}

module.exports = { GMGNTradeAPI };
