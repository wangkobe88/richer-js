/**
 * GMGN API 模块
 *
 * 提供对 GMGN OpenAPI 的完整访问，包括：
 * - Token 信息查询（基础信息、安全审计、流动性池、持有人、交易者）
 * - 市场数据（K线、热门排行、战壕新币、信号）
 * - 交易执行（swap、多钱包批量、策略单）
 * - Cooking（发币统计、创建代币）
 * - 用户资产（钱包持仓、活动、统计）
 * - 追踪（KOL、聪明钱、关注钱包）
 *
 * 使用示例:
 *   const { GMGNTokenAPI } = require('./gmgn-api');
 *   const tokenApi = new GMGNTokenAPI({ apiKey: 'your_key' });
 *   const info = await tokenApi.getTokenInfo('sol', 'So11111111111111111111111111111111111111112');
 */

const { GMGNAPIError, BaseGMGNAPI, preResolveGMGNHost } = require('./base-api');
const { GMGNTokenAPI } = require('./token-api');
const { GMGNMarketAPI } = require('./market-api');
const { GMGNTradeAPI } = require('./trade-api');
const { GMGNCookingAPI } = require('./cooking-api');
const { GMGNPortfolioAPI } = require('./portfolio-api');
const { GMGNTrackAPI } = require('./track-api');

module.exports = {
    GMGNAPIError,
    BaseGMGNAPI,
    preResolveGMGNHost,
    GMGNTokenAPI,
    GMGNMarketAPI,
    GMGNTradeAPI,
    GMGNCookingAPI,
    GMGNPortfolioAPI,
    GMGNTrackAPI,
};
