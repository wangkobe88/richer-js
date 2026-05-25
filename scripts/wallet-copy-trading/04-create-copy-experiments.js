/**
 * 创建模拟钱包 CCCCQCrL6z 交易行为的回测实验
 * 基于当前运行实验配置，分别用方案 A/B/C 的预检查条件
 *
 * 方案 A：保守调整 - 去掉黑名单限制，放宽交易速率和跌幅
 * 方案 B：激进调整 - 只保留基本流动性检查
 * 方案 C：只保留防骗检查
 *
 * 三个方案统一使用匹配钱包行为的卖出策略
 *
 * 用法: node scripts/wallet-copy-trading/04-create-copy-experiments.js
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SOURCE_EXPERIMENT_ID = '609c9d93-c37f-4bd8-90e4-c300971f4711';
const BACKTEST_SOURCE_EXPERIMENT_ID = '609c9d93-c37f-4bd8-90e4-c300971f4711';

// 基于回撤止盈 + 快速止损的卖出策略
// 回撤止盈：不设固定止盈天花板，让利润奔跑，只在回撤时卖出（匹配钱包无固定止盈的行为）
// 快速止损：钱包亏损交易持仓中位数33秒、ROI中位数-12%，需要比原策略更快的止损
const WALLET_STYLE_SELL_STRATEGIES = [
  {
    priority: 1,
    condition: "profitPercent <= -12 AND holdDuration > 15 AND holdDuration < 60",
    maxExecutions: 1,
  },
  {
    priority: 2,
    condition: "(holderDrawdownFromHighestSinceLastBuy <= -15 OR drawdownFromHighestSinceLastBuy <= -30) AND holdDuration < 180",
    maxExecutions: 1,
  },
  {
    priority: 3,
    condition: "(holderDrawdownFromHighestSinceLastBuy <= -12 OR drawdownFromHighestSinceLastBuy <= -25) AND holdDuration >= 180 AND holdDuration <= 300",
    maxExecutions: 1,
  },
  {
    priority: 4,
    condition: "(holderDrawdownFromHighestSinceLastBuy <= -10 OR drawdownFromHighestSinceLastBuy <= -20) AND holdDuration >= 300",
    maxExecutions: 1,
  },
  {
    priority: 5,
    condition: "trendCV < 0.005",
    maxExecutions: 1,
  },
];

// 三个预检查方案
const PLANS = {
  A: {
    name: '钱包跟单-A保守',
    description: '去掉黑名单限制，放宽交易速率(<500)和跌幅(>-15)，保留基本流动性检查',
    preBuyCheckCondition: 'earlyTradesTotalCount >= 10 AND earlyTradesCountPerMin < 500 AND earlyTradesDrawdownFromHighest > -15',
    permanentBlockCondition: null,
  },
  B: {
    name: '钱包跟单-B激进',
    description: '只保留最小流动性(>=5笔)和极端跌幅保护(>-30)，接近无预检查',
    preBuyCheckCondition: 'earlyTradesTotalCount >= 5 AND earlyTradesDrawdownFromHighest > -30',
    permanentBlockCondition: null,
  },
  C: {
    name: '钱包跟单-C防骗',
    description: '只排除bad dev钱包创建的代币，去掉所有早期交易者检查',
    preBuyCheckCondition: 'creatorIsNotBadDevWallet === 1',
    permanentBlockCondition: null,
  },
};

async function main() {
  console.log('=== 创建钱包跟单回测实验 ===\n');

  // 获取源实验配置
  const { data: source, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', SOURCE_EXPERIMENT_ID)
    .single();

  if (error) {
    console.error('查询源实验失败:', error.message);
    return;
  }

  console.log('源实验:', source.experiment_name, `(${source.id})`);

  const created = [];

  for (const [planKey, plan] of Object.entries(PLANS)) {
    console.log(`\n--- 创建方案 ${planKey}: ${plan.name} ---`);

    const newConfig = JSON.parse(JSON.stringify(source.config));

    // 更新名称和描述
    newConfig.name = plan.name;
    newConfig.description = plan.description;

    // 修改预检查条件
    newConfig.strategiesConfig.buyStrategies[0].preBuyCheckCondition = plan.preBuyCheckCondition;
    newConfig.strategiesConfig.buyStrategies[0].repeatBuyCheckCondition = plan.preBuyCheckCondition;

    // 修改永久阻断条件
    if (plan.permanentBlockCondition) {
      newConfig.strategiesConfig.permanentBlockCondition = plan.permanentBlockCondition;
    } else {
      delete newConfig.strategiesConfig.permanentBlockCondition;
    }

    // 使用钱包风格的卖出策略
    newConfig.strategiesConfig.sellStrategies = WALLET_STYLE_SELL_STRATEGIES;

    // 回测配置
    newConfig.backtest = {
      initialBalance: 100,
      sourceExperimentId: BACKTEST_SOURCE_EXPERIMENT_ID,
    };

    console.log(`  preBuyCheckCondition: ${plan.preBuyCheckCondition}`);
    console.log(`  卖出策略: ${WALLET_STYLE_SELL_STRATEGIES.length} 个`);
    console.log(`  permanentBlockCondition: ${plan.permanentBlockCondition || '(无)'}`);

    const { data: newExp, error: createError } = await supabase
      .from('experiments')
      .insert({
        experiment_name: newConfig.name,
        experiment_description: newConfig.description,
        status: 'initializing',
        trading_mode: 'backtest',
        strategy_type: source.strategy_type || 'pumpfun_earlyreturn',
        blockchain: source.blockchain || 'solana',
        kline_type: source.kline_type || '1m',
        config: newConfig,
      })
      .select()
      .single();

    if (createError) {
      console.error(`  创建失败:`, createError.message);
      continue;
    }

    console.log(`  创建成功: ID=${newExp.id}`);
    created.push({ plan: planKey, name: plan.name, id: newExp.id });
  }

  console.log('\n=== 创建完成 ===');
  for (const { plan, name, id } of created) {
    console.log(`  方案 ${plan}: ${name} (${id})`);
  }
  console.log('\n回测引擎改进完成后运行这些实验进行对比');
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
