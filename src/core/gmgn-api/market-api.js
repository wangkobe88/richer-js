/**
 * GMGN Market API
 *
 * 市场数据查询：K线数据、热门代币排行、战壕新币、代币信号
 * 所有方法使用 Normal Auth（仅需 API Key）
 *
 * API端点:
 *   GET  /v1/market/token_kline
 *   GET  /v1/market/rank
 *   POST /v1/trenches
 *   POST /v1/market/token_signal
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNMarketAPI extends BaseGMGNAPI {
    /**
     * 获取代币 K 线数据 (OHLCV)
     *
     * @param {string} chain - 链标识: sol / bsc / base / eth
     * @param {string} address - 代币合约地址
     * @param {string} resolution - K线粒度: 1m / 5m / 15m / 1h / 4h / 1d
     * @param {number} [from] - 起始时间 (Unix毫秒)
     * @param {number} [to] - 结束时间 (Unix毫秒)
     * @returns {Promise<Object>} K线数据，包含 list 数组
     *   每条记录: { time(毫秒), open, close, high, low, volume(USD), amount(代币数量) }
     */
    async getTokenKline(chain, address, resolution, from, to) {
        const query = { chain, address, resolution };
        if (from != null) query.from = from;
        if (to != null) query.to = to;
        return this._normalRequest('GET', '/v1/market/token_kline', query);
    }

    /**
     * 获取热门代币排行榜
     *
     * @param {string} chain - 链标识: sol / bsc / base / eth
     * @param {string} interval - 时间窗口: 1m / 5m / 1h / 6h / 24h
     * @param {Object} [extra] - 可选参数
     * @param {number} [extra.limit=100] - 返回数量，最大100
     * @param {string} [extra.order_by] - 排序字段: default / swaps / marketcap / volume / holder_count / smart_degen_count / renowned_count / change1m / change5m / change1h 等
     * @param {string} [extra.direction='desc'] - 排序方向
     * @param {string[]} [extra.filters] - 安全过滤标签数组。SOL默认: renounced/frozen; EVM默认: not_honeypot/verified/renounced
     * @param {string[]} [extra.platforms] - Launchpad平台过滤数组。SOL: Pump.fun/letsbonk/...; BSC: fourmeme/flap/...; Base: clanker/zora/...
     * @returns {Promise<Object>} 热门代币列表
     */
    async getTrendingSwaps(chain, interval, extra = {}) {
        return this._normalRequest('GET', '/v1/market/rank', { chain, interval, ...extra });
    }

    /**
     * 获取战壕(Trenches)新币列表
     * 三个生命周期阶段: new_creation(刚创建) / near_completion(即将毕业) / completed(已毕业到DEX)
     *
     * @param {string} chain - 链标识: sol / bsc / base
     * @param {string[]} [types] - 类别过滤: new_creation / near_completion / completed（默认全部）
     * @param {string[]} [platforms] - Launchpad平台过滤（默认全部）
     * @param {number} [limit=80] - 每类最大返回数
     * @param {Object} [filters] - 服务端过滤条件
     * @param {number} [filters.max_rug_ratio] - 最大 rug pull 风险评分 (0-1)
     * @param {number} [filters.min_smart_degen_count] - 最小聪明钱持有人数
     * @param {number} [filters.min_volume_24h] - 最小24h交易量(USD)
     * @param {number} [filters.max_bundler_rate] - 最大捆绑机器人比例 (0-1)
     * @param {number} [filters.min_holder_count] - 最小持有人数
     * @param {string} [filters.min_created] - 最小代币年龄 (如 '1m', '30s')
     * @returns {Promise<Object>} 战壕代币数据，按类别分组
     */
    async getTrenches(chain, types, platforms, limit, filters) {
        const body = this._buildTrenchesBody(chain, types, platforms, limit, filters);
        return this._normalRequest('POST', '/v1/trenches', { chain }, body);
    }

    /**
     * 获取代币信号 (价格异动、聪明钱买入、大额买入等)
     * 仅支持 sol / bsc
     *
     * @param {string} chain - 链标识: sol / bsc
     * @param {Object[]} groups - 信号查询组数组
     * @param {number[]} [groups[].signal_type] - 信号类型数组 (1-18)
     * @param {number} [groups[].mc_min] - 最小市值(USD)
     * @param {number} [groups[].mc_max] - 最大市值(USD)
     * @param {number} [groups[].trigger_mc_min] - 最小触发时市值
     * @param {number} [groups[].trigger_mc_max] - 最大触发时市值
     * @returns {Promise<Object>} 信号数据
     */
    async getTokenSignalV2(chain, groups) {
        return this._normalRequest('POST', '/v1/market/token_signal', {}, { chain, groups });
    }
}

module.exports = { GMGNMarketAPI };
