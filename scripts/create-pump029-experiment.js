/**
 * 基于实验 444ef572 (Pump028) 创建方案 A 回测实验
 * 核心改动：收紧 trendCV/earlyReturn，增加 age 上限，放宽 preBuyCheck，增加 P0 止盈
 */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function main() {
  const sourceId = '444ef572-a936-47bd-aadf-3ce51b77ef2f';

  const { data: source, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('=== 母版实验 ===');
  console.log('名称:', source.experiment_name);
  console.log('ID:', source.id);

  const newConfig = JSON.parse(JSON.stringify(source.config));

  // 更新名称和描述
  newConfig.name = 'Pump029-方案A-核心参数优化-回测';
  newConfig.description = '方案A: trendCV>=0.15且<=0.5, earlyReturn>=25且<=200, age<3, 放宽preBuyCheck, 增加P0止盈, 3卡';

  // 方案 A 买入条件
  newConfig.strategiesConfig.buyStrategies = [
    {
      cards: "2",
      cooldown: 60,
      priority: 1,
      condition: "trendDataPoints >= 6 AND trendCV >= 0.15 AND trendCV <= 0.5 AND earlyReturn >= 25 AND earlyReturn <= 200 AND trendSlope > 0.01 AND trendPriceUp >= 1 AND trendMedianUp >= 1 AND trendStrengthScore >= 25 AND trendRecentDownRatio < 0.6 AND trendRiseRatio >= 0.55 AND age < 3",
      maxExecutions: 3,
      preBuyCheckCondition: "earlyTradesTotalCount >= 12 AND earlyTradesDrawdownFromHighest > -8 AND earlyTradesVolume > 30 AND earlyTradesCountPerMin < 150",
      repeatBuyCheckCondition: ""
    }
  ];

  // 方案 A 卖出策略：增加 P0 止盈，改进 P4 趋势死亡信号
  newConfig.strategiesConfig.sellStrategies = [
    {
      cards: "all",
      cooldown: 0,
      priority: 0,
      condition: "profitPercent >= 100 AND holdDuration > 30",
      maxExecutions: 1
    },
    {
      cards: "all",
      cooldown: 20,
      priority: 1,
      condition: "(holderDrawdownFromHighestSinceLastBuy <= -15 OR drawdownFromHighestSinceLastBuy <= -30) AND holdDuration < 180",
      maxExecutions: 4
    },
    {
      cards: "all",
      cooldown: 30,
      priority: 2,
      condition: "(holderDrawdownFromHighestSinceLastBuy <= -12 OR drawdownFromHighestSinceLastBuy <= -25) AND holdDuration >= 180 AND holdDuration <= 300",
      maxExecutions: 4
    },
    {
      cards: "all",
      cooldown: 30,
      priority: 3,
      condition: "(drawdownFromHighestSinceLastBuy <= -15 OR holderDrawdownFromHighestSinceLastBuy <= -10) AND holdDuration >= 300",
      maxExecutions: 4
    },
    {
      cards: "all",
      cooldown: 30,
      priority: 4,
      condition: "trendCV < 0.01 AND trendRecentDownRatio >= 0.5",
      maxExecutions: 4
    }
  ];

  // 仓位管理：3 卡
  newConfig.positionManagement.totalCards = 3;
  newConfig.positionManagement.initialAllocation.bnbCards = 3;

  // 回测配置保持不变（同源实验）
  newConfig.backtest = {
    initialBalance: 100,
    sourceExperimentId: "7a93ee38-2697-43b9-a7eb-b76195d176b5"
  };

  const { data: newExp, error: createError } = await supabase
    .from('experiments')
    .insert({
      experiment_name: newConfig.name,
      experiment_description: newConfig.description,
      status: 'initializing',
      trading_mode: 'backtest',
      strategy_type: source.strategy_type || 'fourmeme_earlyreturn',
      blockchain: source.blockchain || 'solana',
      kline_type: source.kline_type || '1m',
      config: newConfig
    })
    .select()
    .single();

  if (createError) {
    console.error('创建失败:', createError);
    return;
  }

  console.log('\n=== 新实验已创建 ===');
  console.log('ID:', newExp.id);
  console.log('名称:', newExp.experiment_name);
}

main().catch(console.error);
