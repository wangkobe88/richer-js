/**
 * GMGN API 测试脚本
 *
 * 用法:
 *   node scripts/test-gmgn-api.js
 *   node scripts/test-gmgn-api.js --test token
 *   node scripts/test-gmgn-api.js --test market
 *   node scripts/test-gmgn-api.js --test portfolio
 *   node scripts/test-gmgn-api.js --test track
 *
 * 需要在 config/.env 中配置 GMGN_API_KEY
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', 'config', '.env') });

const {
    GMGNTokenAPI,
    GMGNMarketAPI,
    GMGNPortfolioAPI,
    GMGNTrackAPI,
    GMGNAPIError,
    preResolveGMGNHost,
} = require('../src/core/gmgn-api');

const apiKey = process.env.GMGN_API_KEY;
if (!apiKey || apiKey === 'your_gmgn_api_key_here') {
    console.error('错误: 请在 config/.env 中设置有效的 GMGN_API_KEY');
    process.exit(1);
}

const testFilter = process.argv.indexOf('--test');
const testName = testFilter !== -1 ? process.argv[testFilter + 1] : 'all';

function createApi(APIClass) {
    return new APIClass({ apiKey });
}

function logResult(title, data) {
    console.log(`\n=== ${title} ===`);
    if (typeof data === 'object' && data !== null) {
        const str = JSON.stringify(data, null, 2);
        const lines = str.split('\n');
        if (lines.length > 50) {
            console.log(lines.slice(0, 50).join('\n'));
            console.log(`... (${lines.length - 50} more lines)`);
        } else {
            console.log(str);
        }
    } else {
        console.log(data);
    }
}

function logError(title, error) {
    console.error(`\n=== ${title} (FAILED) ===`);
    if (error instanceof GMGNAPIError) {
        console.error(`  Error: ${error.message}`);
        console.error(`  Status: ${error.status}, Code: ${error.apiCode}`);
    } else {
        console.error(`  Error: ${error.message}`);
    }
}

async function testTokenAPI() {
    console.log('\n\n========================================');
    console.log('  GMGN Token API Tests');
    console.log('========================================');

    const api = createApi(GMGNTokenAPI);

    try {
        const info = await api.getTokenInfo('sol', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        logResult('getTokenInfo (USDC)', {
            symbol: info?.symbol, name: info?.name, price: info?.price,
            liquidity: info?.liquidity, holder_count: info?.holder_count,
        });
    } catch (error) {
        logError('getTokenInfo', error);
    }

    try {
        const security = await api.getTokenSecurity('sol', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        logResult('getTokenSecurity (USDC)', {
            is_honeypot: security?.is_honeypot, open_source: security?.open_source,
            buy_tax: security?.buy_tax, sell_tax: security?.sell_tax,
            top_10_holder_rate: security?.top_10_holder_rate,
        });
    } catch (error) {
        logError('getTokenSecurity', error);
    }

    try {
        const holders = await api.getTokenTopHolders('sol', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { limit: 3 });
        logResult('getTokenTopHolders (USDC, top 3)', {
            count: Array.isArray(holders) ? holders.length : 'not array',
            first: Array.isArray(holders) && holders[0] ? { address: holders[0].address, amount_percentage: holders[0].amount_percentage } : null,
        });
    } catch (error) {
        logError('getTokenTopHolders', error);
    }
}

async function testMarketAPI() {
    console.log('\n\n========================================');
    console.log('  GMGN Market API Tests');
    console.log('========================================');

    const api = createApi(GMGNMarketAPI);

    try {
        const trending = await api.getTrendingSwaps('sol', '1h', { limit: 3, order_by: 'volume' });
        logResult('getTrendingSwaps (SOL 1h, top 3)', {
            count: Array.isArray(trending) ? trending.length : 'not array',
            first: Array.isArray(trending) && trending[0] ? { symbol: trending[0].symbol, name: trending[0].name } : null,
        });
    } catch (error) {
        logError('getTrendingSwaps', error);
    }

    try {
        const to = Date.now();
        const from = to - 3600000;
        const kline = await api.getTokenKline('sol', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '1m', from, to);
        logResult('getTokenKline (USDC 1m, last hour)', {
            candles: kline?.list?.length,
            last: kline?.list?.slice(-1)?.[0] ? { time: kline.list.slice(-1)[0].time, close: kline.list.slice(-1)[0].close } : null,
        });
    } catch (error) {
        logError('getTokenKline', error);
    }

    try {
        const trenches = await api.getTrenches('bsc', ['new_creation'], ['fourmeme'], 3);
        logResult('getTrenches (BSC fourmeme new_creation, limit 3)', {
            keys: Object.keys(trenches || {}),
            new_creation_count: trenches?.new_creation?.length,
        });
    } catch (error) {
        logError('getTrenches', error);
    }
}

async function testPortfolioAPI() {
    console.log('\n\n========================================');
    console.log('  GMGN Portfolio API Tests');
    console.log('========================================');

    const api = createApi(GMGNPortfolioAPI);

    try {
        const info = await api.getUserInfo();
        logResult('getUserInfo', info);
    } catch (error) {
        logError('getUserInfo', error);
    }
}

async function testTrackAPI() {
    console.log('\n\n========================================');
    console.log('  GMGN Track API Tests');
    console.log('========================================');

    const api = createApi(GMGNTrackAPI);

    try {
        const kolTrades = await api.getKolTrades('sol', 3);
        logResult('getKolTrades (SOL, limit 3)', {
            count: kolTrades?.list?.length,
            first: kolTrades?.list?.[0] ? { maker: kolTrades.list[0].maker, side: kolTrades.list[0].side } : null,
        });
    } catch (error) {
        logError('getKolTrades', error);
    }

    try {
        const smTrades = await api.getSmartMoneyTrades('sol', 3);
        logResult('getSmartMoneyTrades (SOL, limit 3)', {
            count: smTrades?.list?.length,
            first: smTrades?.list?.[0] ? { maker: smTrades.list[0].maker, side: smTrades.list[0].side } : null,
        });
    } catch (error) {
        logError('getSmartMoneyTrades', error);
    }
}

async function main() {
    console.log('GMGN API Test Suite');
    console.log(`API Key: ${apiKey?.substring(0, 8)}...`);
    console.log(`Test filter: ${testName}`);

    try {
        if (testName === 'all' || testName === 'token') await testTokenAPI();
        if (testName === 'all' || testName === 'market') await testMarketAPI();
        if (testName === 'all' || testName === 'portfolio') await testPortfolioAPI();
        if (testName === 'all' || testName === 'track') await testTrackAPI();
    } catch (error) {
        console.error('\nUnexpected error:', error);
    }

    console.log('\n\nTest suite completed.');
}

main();
