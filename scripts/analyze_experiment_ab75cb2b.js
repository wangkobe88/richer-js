/**
 * 分析实验 ab75cb2b-4930-4049-a3bd-f96e3de6af47
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeExperiment() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    实验分析报告                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 1. 获取实验基本信息
  const { data: experiment, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (expError) {
    console.error('获取实验失败:', expError);
    return;
  }

  console.log('【实验基本信息】');
  console.log(`  ID: ${experiment.id}`);
  console.log(`  名称: ${experiment.experiment_name}`);
  console.log(`  模式: ${experiment.trading_mode}`);
  console.log(`  状态: ${experiment.status}`);
  console.log(`  区块链: ${experiment.blockchain}`);
  console.log(`  开始时间: ${experiment.started_at}`);
  console.log(`  结束时间: ${experiment.stopped_at || '运行中'}`);
  console.log('');

  // 2. 获取交易记录
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (tradesError) {
    console.error('获取交易失败:', tradesError);
    return;
  }

  console.log('【交易概况】');
  console.log(`  总交易数: ${trades?.length || 0}`);
  if (trades && trades.length > 0) {
    const buyTrades = trades.filter(t => t.action === 'buy');
    const sellTrades = trades.filter(t => t.action === 'sell');
    console.log(`  买入交易: ${buyTrades.length}`);
    console.log(`  卖出交易: ${sellTrades.length}`);
    console.log(`  当前持仓: ${buyTrades.length - sellTrades.length} 个代币`);
  }
  console.log('');

  // 3. 获取代币数据
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('discovered_at', { ascending: false });

  if (tokensError) {
    console.error('获取代币失败:', tokensError);
    return;
  }

  console.log('【代币概况】');
  console.log(`  监控代币数: ${tokens?.length || 0}`);
  console.log('');

  // 4. 分析代币收益
  if (tokens && tokens.length > 0) {
    // 计算每个代币的收益
    const tokenReturns = tokens.map(token => {
      const tokenTrades = trades?.filter(t => t.token_address === token.token_address) || [];
      const buyTrades = tokenTrades.filter(t => t.action === 'buy');
      const sellTrades = tokenTrades.filter(t => t.action === 'sell');

      let totalBuyAmount = 0;
      let totalSellAmount = 0;
      let totalBought = 0;
      let totalSold = 0;

      buyTrades.forEach(t => {
        totalBuyAmount += t.amount || 0;
        totalBought += t.token_amount || 0;
      });

      sellTrades.forEach(t => {
        totalSellAmount += t.amount || 0;
        totalSold += t.token_amount || 0;
      });

      const currentHolding = totalBought - totalSold;
      const investedAmount = totalBuyAmount;
      const returnedAmount = totalSellAmount;

      // 计算收益率
      let profitPercent = 0;
      let maxReturnPercent = 0;
      let status = '未购买';

      if (buyTrades.length > 0) {
        if (sellTrades.length > 0) {
          // 已卖出
          profitPercent = ((returnedAmount - investedAmount) / investedAmount) * 100;
          status = '已卖出';
        } else {
          // 持仓中
          // 使用当前价格计算
          const currentPrice = token.current_price_usd || token.raw_api_data?.current_price_usd || 0;
          if (currentPrice > 0 && totalBought > 0) {
            const currentValue = currentHolding * currentPrice;
            const unrealizedProfit = currentValue - investedAmount;
            profitPercent = (unrealizedProfit / investedAmount) * 100;
          }
          status = '持仓中';
        }

        // 计算最高收益率（使用代币的最高价格）
        if (token.max_price_usd || token.raw_api_data?.highest_price) {
          const highestPrice = token.max_price_usd || token.raw_api_data?.highest_price || 0;
          const maxReturnValue = totalBought * highestPrice;
          maxReturnPercent = ((maxReturnValue - investedAmount) / investedAmount) * 100;
        }
      }

      return {
        token_address: token.token_address,
        token_symbol: token.token_symbol,
        token_name: token.raw_api_data?.name || token.token_symbol,
        status,
        buyTrades: buyTrades.length,
        sellTrades: sellTrades.length,
        investedAmount,
        returnedAmount,
        profitPercent,
        maxReturnPercent,
        discovered_at: token.discovered_at,
        current_price_usd: token.current_price_usd,
        raw_api_data: token.raw_api_data
      };
    });

    // 排序：按收益率降序
    tokenReturns.sort((a, b) => b.profitPercent - a.profitPercent);

    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    代币收益分析                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    // 统计
    const profitableTokens = tokenReturns.filter(t => t.profitPercent > 0);
    const lossTokens = tokenReturns.filter(t => t.profitPercent < 0);
    const boughtTokens = tokenReturns.filter(t => t.buyTrades > 0);

    console.log('【收益统计】');
    console.log(`  已购买代币: ${boughtTokens.length}`);
    console.log(`  盈利代币: ${profitableTokens.length} (${profitableTokens.length > 0 ? (profitableTokens.length / boughtTokens.length * 100).toFixed(1) : 0}%)`);
    console.log(`  亏损代币: ${lossTokens.length} (${lossTokens.length > 0 ? (lossTokens.length / boughtTokens.length * 100).toFixed(1) : 0}%)`);
    console.log('');

    if (boughtTokens.length > 0) {
      const avgReturn = boughtTokens.reduce((sum, t) => sum + t.profitPercent, 0) / boughtTokens.length;
      const maxReturn = Math.max(...boughtTokens.map(t => t.maxReturnPercent));
      const minReturn = Math.min(...boughtTokens.map(t => t.profitPercent));

      console.log(`  平均收益率: ${avgReturn.toFixed(2)}%`);
      console.log(`  最高收益率: ${maxReturn.toFixed(2)}%`);
      console.log(`  最低收益率: ${minReturn.toFixed(2)}%`);
      console.log('');
    }

    // 收益分布
    console.log('【收益分布】');
    const ranges = [
      { min: 100, label: '> 100%' },
      { min: 50, max: 100, label: '50% - 100%' },
      { min: 20, max: 50, label: '20% - 50%' },
      { min: 0, max: 20, label: '0% - 20%' },
      { min: -20, max: 0, label: '-20% - 0%' },
      { max: -20, label: '< -20%' }
    ];

    ranges.forEach(range => {
      const count = boughtTokens.filter(t => {
        if (range.max === undefined) return t.profitPercent >= range.min;
        if (range.min === undefined) return t.profitPercent < range.max;
        return t.profitPercent >= range.min && t.profitPercent < range.max;
      }).length;

      const pct = boughtTokens.length > 0 ? (count / boughtTokens.length * 100).toFixed(1) : 0;
      console.log(`  ${range.label.padEnd(15)} ${count} 个 (${pct}%)`);
    });
    console.log('');

    // 详细代币列表
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    代币详细列表                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    console.log('序号  代币                      状态      收益率%   最高收益%  投入额      返回额');
    console.log('─'.repeat(92));

    tokenReturns.forEach((t, index) => {
      if (t.buyTrades > 0) {
        const statusIcon = t.status === '已卖出' ? '✓' : t.status === '持仓中' ? '○' : '—';
        const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
        const resetColor = '\x1b[0m';

        console.log(
          String(index + 1).padStart(4) + '. ' +
          (t.token_symbol || t.token_address.substring(0, 8)).padEnd(24) +
          statusIcon.padEnd(8) +
          profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
          t.maxReturnPercent.toFixed(2).padStart(10) + '%' +
          t.investedAmount.toFixed(4).padStart(10) +
          t.returnedAmount.toFixed(4).padStart(10)
        );
      }
    });
    console.log('');

    // 分析盈利和亏损的代币特征
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    盈亏代币特征分析                                          ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    // 查看这些代币的购买信号数据
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('token_address, metadata, created_at')
      .eq('experiment_id', experimentId)
      .eq('action', 'buy');

    const signalDataMap = new Map();
    signals?.forEach(signal => {
      try {
        let metadata = signal.metadata;
        if (typeof metadata === 'string') {
          metadata = JSON.parse(metadata);
        }
        signalDataMap.set(signal.token_address, metadata);
      } catch (e) {}
    });

    // 分析盈利代币的共同特征
    const topTokens = tokenReturns.filter(t => t.buyTrades > 0 && t.profitPercent > 20).slice(0, 5);
    const worstTokens = tokenReturns.filter(t => t.buyTrades > 0 && t.profitPercent < 0).slice(0, 5);

    if (topTokens.length > 0) {
      console.log('【盈利代币 Top 5 特征】\n');
      topTokens.forEach((t, i) => {
        const signal = signalDataMap.get(t.token_address);
        console.log(`${i + 1}. ${t.token_symbol || t.token_address.substring(0, 8)} - 收益: ${t.profitPercent.toFixed(2)}%`);

        if (signal) {
          const preBuy = signal.preBuyCheckFactors || {};
          const trend = signal.trendFactors || {};

          console.log(`   购买前检查:`);
          console.log(`     黑名单: ${preBuy.holderBlacklistCount || 'N/A'}, 白名单: ${preBuy.holderWhitelistCount || 'N/A'}`);
          console.log(`     交易数/分: ${preBuy.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${preBuy.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
          console.log(`     独立钱包: ${preBuy.earlyTradesUniqueWallets || 'N/A'}`);

          console.log(`   趋势因子:`);
          console.log(`     早期收益率: ${trend.earlyReturn?.toFixed(2) || 'N/A'}%`);
          console.log(`     TVL: ${trend.tvl?.toFixed(2) || 'N/A'}`);
          console.log(`     FDV: ${trend.fdv?.toFixed(2) || 'N/A'}`);
          console.log(`     持币地址: ${trend.holders || 'N/A'}`);
        }
        console.log('');
      });
    }

    if (worstTokens.length > 0) {
      console.log('【亏损代币特征】\n');
      worstTokens.forEach((t, i) => {
        const signal = signalDataMap.get(t.token_address);
        console.log(`${i + 1}. ${t.token_symbol || t.token_address.substring(0, 8)} - 收益: ${t.profitPercent.toFixed(2)}%`);

        if (signal) {
          const preBuy = signal.preBuyCheckFactors || {};
          const trend = signal.trendFactors || {};

          console.log(`   购买前检查:`);
          console.log(`     黑名单: ${preBuy.holderBlacklistCount || 'N/A'}, 白名单: ${preBuy.holderWhitelistCount || 'N/A'}`);
          console.log(`     交易数/分: ${preBuy.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${preBuy.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
          console.log(`     独立钱包: ${preBuy.earlyTradesUniqueWallets || 'N/A'}`);

          console.log(`   趋势因子:`);
          console.log(`     早期收益率: ${trend.earlyReturn?.toFixed(2) || 'N/A'}%`);
          console.log(`     TVL: ${trend.tvl?.toFixed(2) || 'N/A'}`);
          console.log(`     FDV: ${trend.fdv?.toFixed(2) || 'N/A'}`);
          console.log(`     持币地址: ${trend.holders || 'N/A'}`);
        }
        console.log('');
      });
    }

    // 分析策略配置
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    策略配置分析                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    const config = experiment.config;
    if (config && config.strategiesConfig) {
      console.log('【买入策略】\n');
      config.strategiesConfig.buyStrategies?.forEach((strategy, index) => {
        console.log(`策略 ${index + 1}:`);
        console.log(`  条件: ${strategy.condition}`);
        console.log(`  购买前检查: ${strategy.preBuyCheckCondition || '未设置'}`);
        console.log(`  卡牌: ${strategy.cards}`);
        console.log(`  优先级: ${strategy.priority}`);
        console.log('');
      });

      console.log('【卖出策略】\n');
      config.strategiesConfig.sellStrategies?.forEach((strategy, index) => {
        console.log(`策略 ${index + 1}:`);
        console.log(`  条件: ${strategy.condition}`);
        console.log(`  卡牌: ${strategy.cards}`);
        console.log(`  优先级: ${strategy.priority}`);
        console.log('');
      });
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('分析完成');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeExperiment().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
