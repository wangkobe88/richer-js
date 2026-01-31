/**
 * AVE API Client Index
 *
 * Exports all AVE API clients
 */

const { AveAPIError, AveTokenAPI } = require('./token-api');
const { AveKlineAPI } = require('./kline-api');

module.exports = {
    AveAPIError,
    AveTokenAPI,
    AveKlineAPI
};
