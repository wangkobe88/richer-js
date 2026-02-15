/**
 * Four.meme API 模块
 *
 * 用于从 four.meme 平台获取代币信息和创建者地址
 */

const { FourMemeAPIError, BaseFourMemeAPI } = require('./base-api');
const { FourMemeTokenAPI } = require('./token-api');

module.exports = {
    FourMemeAPIError,
    BaseFourMemeAPI,
    FourMemeTokenAPI
};
