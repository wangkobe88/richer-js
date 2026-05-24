/**
 * 基于实验 d3fc76af 复制，去掉所有策略冷却期
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

  newConfig.name = '回测-无冷却期 (复制 d3fc76af)';
  newConfig.description = '基于 d3fc76af 去掉所有策略冷却期';

  // 买入策略：cooldown 设为 0
  for (const s of newConfig.strategiesConfig.buyStrategies) {
    console.log(`  买入策略 ${s.priority}: cooldown ${s.cooldown} -> 0`);
    s.cooldown = 0;
  }

  // 卖出策略：cooldown 设为 0
  for (const s of newConfig.strategiesConfig.sellStrategies) {
    console.log(`  卖出策略 ${s.priority}: cooldown ${s.cooldown} -> 0`);
    s.cooldown = 0;
  }

  const { data: newExp, error: createError } = await supabase
    .from('experiments')
    .insert({
      experiment_name: newConfig.name,
      experiment_description: newConfig.description,
      status: 'initializing',
      trading_mode: source.trading_mode,
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
