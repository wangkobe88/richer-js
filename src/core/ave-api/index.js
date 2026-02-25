/**
 * AVE API Client Index
 *
 * Exports all AVE API clients
 */

const { AveAPIError, BaseAveAPI, AveTokenAPI } = require('./token-api');
const { AveKlineAPI } = require('./kline-api');
const { AveTxAPI } = require('./tx-api');

module.exports = {
    AveAPIError,
    BaseAveAPI,
    AveTokenAPI,
    AveKlineAPI,
    AveTxAPI
};
