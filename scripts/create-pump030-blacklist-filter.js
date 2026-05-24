/**
 * 基于实验 444ef572 创建回测实验
 * 唯一改动：preBuyCheckCondition 中加入 earlyTraderBlacklistCount <= 3
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

  newConfig.name = 'Pump030-黑名单过滤(btc<=3)-回测';
  newConfig.description = '基于Pump028, preBuyCheckCondition加入earlyTraderBlacklistCount<=3, 挡住btc>=4的代币';

  // 唯一改动：在 preBuyCheckCondition 追加 earlyTraderBlacklistCount <= 3
  newConfig.strategiesConfig.buyStrategies = [
    {
      cards: "2",
      cooldown: 60,
      priority: 1,
      condition: "trendDataPoints >= 8 AND trendCV > 0.05 AND earlyReturn > 10 AND trendSlope > 0.02 AND trendPriceUp >= 1 AND trendMedianUp >= 1 AND trendStrengthScore >= 30 AND trendRecentDownRatio < 0.6 AND trendRiseRatio >= 0.6",
      maxExecutions: 3,
      preBuyCheckCondition: "earlyTradesTotalCount >= 18 AND earlyTradesDrawdownFromHighest > -5 AND earlyTradesVolume > 50 AND earlyTradesCountPerMin < 100 AND earlyTraderBlacklistCount <= 3",
      repeatBuyCheckCondition: ""
    }
  ];

  // 回测配置不变
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
