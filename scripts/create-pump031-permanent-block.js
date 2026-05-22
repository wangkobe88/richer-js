/**
 * 基于实验 a0e05bd4 (Pump030-副本) 创建带永久阻断条件的回测实验
 * 唯一改动：strategiesConfig 中增加 permanentBlockCondition
 */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function main() {
  const sourceId = 'a0e05bd4-1c31-4bfb-9d18-a465d458bc79';

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

  newConfig.name = 'Pump031-永久阻断(btc>4)-回测';
  newConfig.description = '基于Pump030副本, 增加permanentBlockCondition: earlyTraderBlacklistCount > 4, 触发后代币永久不可交易';

  // 唯一改动：增加永久阻断条件
  newConfig.strategiesConfig.permanentBlockCondition = 'earlyTraderBlacklistCount > 4';

  console.log('\n=== 新实验配置 ===');
  console.log('permanentBlockCondition:', newConfig.strategiesConfig.permanentBlockCondition);
  console.log('preBuyCheckCondition:', newConfig.strategiesConfig.buyStrategies[0].preBuyCheckCondition);

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
