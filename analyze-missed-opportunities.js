require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function analyzeMissedOpportunities() {
    const supabase = dbManager.getClient();
    const experimentId = 'b64fce6a-503c-4c1e-bee1-c6031cb9194b';

    console.log('分析实验 ' + experimentId + ' 的错失机会\n');
    console.log('=== 获取代币和交易数据 ===\n');

    // 1. 获取所有代币（使用分页）
    const tokenPageSize = 1000;
    let tokenOffset = 0;
    let tokenHasMore = true;
    let allTokens = [];

    while (tokenHasMore) {
        const { data: tokens, error: tokensError } = await supabase
            .from('experiment_tokens')
            .select('*')
            .eq('experiment_id', experimentId)
            .range(tokenOffset, tokenOffset + tokenPageSize - 1);

        if (tokensError) {
            console.error('获取代币失败:', tokensError);
            process.exit(1);
        }

        if (tokens && tokens.length > 0) {
            allTokens = allTokens.concat(tokens);
            tokenOffset += tokenPageSize;
            tokenHasMore = tokens.length === tokenPageSize;
        } else {
            tokenHasMore = false;
        }
    }

    const tokens = allTokens;
    console.log(`共 ${tokens.length} 个代币\n`);

    // 2. 获取所有交易
    const tradePageSize = 1000;
    let tradeOffset = 0;
    let tradeHasMore = true;
    let allTrades = [];

    while (tradeHasMore) {
        const { data: trades } = await supabase
            .from('trades')
            .select('*')
            .eq('experiment_id', experimentId)
            .range(tradeOffset, tradeOffset + tradePageSize - 1);

        if (trades && trades.length > 0) {
            allTrades = allTrades.concat(trades);
            tradeOffset += tradePageSize;
            tradeHasMore = trades.length === tradePageSize;
        } else {
            tradeHasMore = false;
        }
    }

    console.log(`共 ${allTrades.length} 条交易记录\n`);

    // 3. 计算每个代币的价格变化
    const tokenPrices = new Map(); // tokenAddress -> { symbol, initialPrice, currentPrice, changePercent }

    tokens.forEach(token => {
        const initialPrice = parseFloat(token.raw_api_data?.launch_price || token.raw_api_data?.current_price_usd || 0);
        const currentPrice = parseFloat(token.raw_api_data?.current_price_usd || 0);

        if (initialPrice > 0) {
            const changePercent = ((currentPrice - initialPrice) / initialPrice) * 100;
            tokenPrices.set(token.token_address, {
                symbol: token.token_symbol,
                initialPrice,
                currentPrice,
                changePercent
            });
        }
    });

    // 4. 找出有交易的代币
    const tradedTokens = new Set();
    allTrades.forEach(trade => {
        if (trade.token_address) {
            tradedTokens.add(trade.token_address);
        }
    });

    console.log(`有交易行为的代币: ${tradedTokens.size} 个\n`);

    // 5. 找出没有交易但价格上涨的代币
    const missedOpportunities = [];

    tokens.forEach(token => {
        const tokenAddress = token.token_address;

        // 跳过有交易的代币
        if (tradedTokens.has(tokenAddress)) {
            return;
        }

        const priceInfo = tokenPrices.get(tokenAddress);
        if (!priceInfo) {
            return;
        }

        // 涨幅超过50%的
        if (priceInfo.changePercent > 50) {
            missedOpportunities.push({
                address: tokenAddress,
                symbol: priceInfo.symbol,
                initialPrice: priceInfo.initialPrice,
                currentPrice: priceInfo.currentPrice,
                changePercent: priceInfo.changePercent,
                status: token.status,
                platform: token.platform
            });
        }
    });

    // 按涨幅排序
    missedOpportunities.sort((a, b) => b.changePercent - a.changePercent);

    console.log('=== 错失机会（无交易但涨幅>50%）===');
    console.log(`共 ${missedOpportunities.length} 个代币\n`);

    missedOpportunities.forEach((opp, idx) => {
        console.log(`${idx + 1}. ${opp.symbol}`);
        console.log(`   地址: ${opp.address}`);
        console.log(`   初始价格: $${opp.initialPrice.toFixed(8)}`);
        console.log(`   当前价格: $${opp.currentPrice.toFixed(8)}`);
        console.log(`   涨幅: +${opp.changePercent.toFixed(2)}%`);
        console.log(`   状态: ${opp.status}`);
        console.log(`   平台: ${opp.platform}`);
        console.log('');
    });

    // 6. 统计分析
    const totalTokens = tokens.length;
    const tradedCount = tradedTokens.size;
    const notTradedCount = totalTokens - tradedCount;
    const missedCount = missedOpportunities.length;
    const missedRate = notTradedCount > 0 ? (missedCount / notTradedCount * 100) : 0;

    console.log('=== 统计汇总 ===');
    console.log(`总代币数: ${totalTokens}`);
    console.log(`有交易代币: ${tradedCount}`);
    console.log(`无交易代币: ${notTradedCount}`);
    console.log(`错失机会(>50%涨幅): ${missedCount}`);
    console.log(`错失率: ${missedRate.toFixed(2)}%`);

    // 7. 按平台统计
    const byPlatform = {};
    missedOpportunities.forEach(opp => {
        byPlatform[opp.platform] = (byPlatform[opp.platform] || 0) + 1;
    });
    console.log('\n按平台统计:');
    Object.entries(byPlatform).forEach(([platform, count]) => {
        console.log(`  ${platform}: ${count} 个`);
    });

    process.exit(0);
}

analyzeMissedOpportunities().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
