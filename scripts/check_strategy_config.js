const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const experimentId = 'c8b25316-c9cf-4f5b-a7ba-36dbc99f4148';

  // 获取实验配置
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (!exp) {
    console.log('实验不存在');
    return;
  }

  console.log('=== 实验配置 ===\n');
  console.log('名称:', exp.experiment_name);
  console.log('模式:', exp.trading_mode);
  console.log('状态:', exp.status);

  const config = exp.config || {};
  console.log('\n=== 策略配置 ===\n');
  console.log(JSON.stringify(config, null, 2));

  // 检查是否有自定义策略
  const hasCustomStrategies = config.strategies && (
    config.strategies.buyStrategies || 
    config.strategies.sellStrategies ||
    config.buyStrategies || 
    config.sellStrategies
  );

  console.log('\n=== 策略类型 ===\n');
  if (hasCustomStrategies) {
    const buyStrategies = config.strategies?.buyStrategies || config.buyStrategies || [];
    const sellStrategies = config.strategies?.sellStrategies || config.sellStrategies || [];

    console.log(`买入策略: ${buyStrategies.length} 个`);
    for (const s of buyStrategies) {
      console.log(`  - ${s.name || s.id}`);
      console.log(`    条件: ${s.condition}`);
      console.log(`    优先级: ${s.priority}`);
      console.log(`    冷却时间: ${s.cooldown || 'N/A'}`);
    }

    console.log(`\n卖出策略: ${sellStrategies.length} 个`);
    for (const s of sellStrategies) {
      console.log(`  - ${s.name || s.id}`);
      console.log(`    条件: ${s.condition}`);
      console.log(`    优先级: ${s.priority}`);
    }
  } else {
    console.log('使用默认硬编码策略');
  }

  // 检查 BacktestEngine 的默认策略
  console.log('\n=== 默认硬编码策略 (BacktestEngine._buildDefaultStrategies) ===\n');
  console.log('早止买入: age < buyTimeMinutes AND earlyReturn >= earlyReturnMin AND earlyReturn < earlyReturnMax');
  console.log('止盈1: profitPercent >= takeProfit1');
  console.log('止盈2: profitPercent >= takeProfit2');
  console.log('止损: holdDuration >= stopLossSeconds AND profitPercent <= 0');
})();
