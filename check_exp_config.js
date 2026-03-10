/**
 * 检查两个回测实验的配置差异
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExpConfig() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  console.log('=== 检查回测实验配置 ===\n');

  const { data: oldExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', oldExpId)
    .single();

  const { data: newExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', newExpId)
    .single();

  console.log('旧实验配置:');
  console.log('  backtest:', JSON.stringify(oldExp.config?.backtest || {}, null, 2));

  console.log('\n新实验配置:');
  console.log('  backtest:', JSON.stringify(newExp.config?.backtest || {}, null, 2));

  // 检查是否有涨幅筛选
  const oldFilter = oldExp.config?.backtest?.minMaxChangePercent;
  const newFilter = newExp.config?.backtest?.minMaxChangePercent;

  console.log('\n涨幅筛选:');
  console.log(`  旧实验: ${oldFilter || '无'}`);
  console.log(`  新实验: ${newFilter || '无'}`);

  // 检查策略配置
  console.log('\n买入策略条件:');
  const oldBuyStrategies = oldExp.config?.strategiesConfig?.buyStrategies || [];
  const newBuyStrategies = newExp.config?.strategiesConfig?.buyStrategies || [];

  oldBuyStrategies.forEach((s, i) => {
    console.log(`  旧实验 #${i + 1}:`);
    console.log(`    condition: ${s.condition?.substring(0, 100)}...`);
    console.log(`    preBuyCheckCondition: ${s.preBuyCheckCondition?.substring(0, 100)}...`);
  });

  newBuyStrategies.forEach((s, i) => {
    console.log(`  新实验 #${i + 1}:`);
    console.log(`    condition: ${s.condition?.substring(0, 100)}...`);
    console.log(`    preBuyCheckCondition: ${s.preBuyCheckCondition?.substring(0, 100)}...`);
  });
}

checkExpConfig().catch(console.error);
