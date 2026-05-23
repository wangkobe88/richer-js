/**
 * 基于母版实验 d3fc76af 创建回测实验（简化版：无卡牌/冷却器）
 */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function main() {
  const sourceId = 'd3fc76af-adb5-49c5-a05e-ebf214dbbb93';

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

  newConfig.name = '回测-简化版(无卡牌无冷却)';
  newConfig.description = '基于 d3fc76af，移除卡牌管理和冷却器，使用固定 tradeAmount=0.5';

  // 移除 positionManagement
  delete newConfig.positionManagement;

  // 添加 tradeAmount（原来 perCardMaxBNB=0.5，2个卡牌买入用2个，简化后直接用0.5）
  newConfig.tradeAmount = 0.5;

  // 买入策略：移除 cards/cooldown
  newConfig.strategiesConfig.buyStrategies = [
    {
      priority: 1,
      condition: "trendDataPoints >= 8 AND trendCV > 0.05 AND earlyReturn > 10 AND trendSlope > 0.02 AND trendPriceUp >= 1 AND trendMedianUp >= 1 AND trendStrengthScore >= 30 AND trendRecentDownRatio < 0.6 AND trendRiseRatio >= 0.6",
      maxExecutions: 1,
      preBuyCheckCondition: "earlyTradesTotalCount >= 18 AND earlyTradesDrawdownFromHighest > -5 AND earlyTradesVolume > 50 AND earlyTradesCountPerMin < 100 AND earlyTraderBlacklistCount <= 4",
      repeatBuyCheckCondition: "earlyTradesTotalCount >= 18 AND earlyTradesDrawdownFromHighest > -5 AND earlyTradesVolume > 50 AND earlyTradesCountPerMin < 100 AND earlyTraderBlacklistCount <= 4"
    }
  ];

  // 卖出策略：移除 cards/cooldown
  newConfig.strategiesConfig.sellStrategies = [
    {
      priority: 1,
      condition: "(holderDrawdownFromHighestSinceLastBuy <= -15 OR drawdownFromHighestSinceLastBuy <= -30) AND holdDuration < 180",
      maxExecutions: 1
    },
    {
      priority: 2,
      condition: "(holderDrawdownFromHighestSinceLastBuy <= -12 OR drawdownFromHighestSinceLastBuy <= -25) AND holdDuration >= 180 AND holdDuration <= 300",
      maxExecutions: 1
    },
    {
      priority: 3,
      condition: "(holderDrawdownFromHighestSinceLastBuy <= -10 OR drawdownFromHighestSinceLastBuy <= -20) AND holdDuration >= 300",
      maxExecutions: 1
    },
    {
      priority: 4,
      condition: "trendCV < 0.005",
      maxExecutions: 1
    }
  ];

  // 回测配置不变
  newConfig.backtest = source.config.backtest;

  // 创建新实验
  const { data: newExp, error: createError } = await supabase
    .from('experiments')
    .insert({
      experiment_name: newConfig.name,
      experiment_description: newConfig.description,
      trading_mode: 'backtest',
      blockchain: source.blockchain,
      kline_type: source.kline_type,
      config: newConfig,
      status: 'created'
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
  console.log('\n启动命令:');
  console.log(`cd /home/ubuntu/richer-js && sudo bash -c 'nohup node main.js start-experiment -e ${newExp.id} --force > logs/experiment-${newExp.id}.log 2>&1 &'`);
}

main().catch(console.error);
