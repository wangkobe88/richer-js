/**
 * 对比老回测和新回测的第一阶段购买条件
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareBuyConditions() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  console.log('=== 对比第一阶段购买条件 ===\n');

  // 获取两个实验的配置
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, config')
    .in('id', [oldExpId, newExpId]);

  const oldExp = experiments.find(e => e.id === oldExpId);
  const newExp = experiments.find(e => e.id === newExpId);

  console.log('1. 买入条件对比:\n');

  const oldBuy = oldExp.config?.strategiesConfig?.buyStrategies?.[0];
  const newBuy = newExp.config?.strategiesConfig?.buyStrategies?.[0];

  console.log('老回测:');
  console.log('  condition:', oldBuy?.condition?.substring(0, 200) + '...');
  console.log('  preBuyCheckCondition:', oldBuy?.preBuyCheckCondition?.substring(0, 200) + '...');

  console.log('\n新回测:');
  console.log('  condition:', newBuy?.condition?.substring(0, 200) + '...');
  console.log('  preBuyCheckCondition:', newBuy?.preBuyCheckCondition?.substring(0, 200) + '...');

  // 检查是否完全相同
  const conditionSame = oldBuy?.condition === newBuy?.condition;
  const preBuyConditionSame = oldBuy?.preBuyCheckCondition === newBuy?.preBuyCheckCondition;

  console.log('\n2. 配置是否相同:');
  console.log('  condition 相同:', conditionSame ? '是' : '否');
  console.log('  preBuyCheckCondition 相同:', preBuyConditionSame ? '是' : '否');

  if (!conditionSame || !preBuyConditionSame) {
    console.log('\n⚠️  购买条件不同！');
  } else {
    console.log('\n✓ 购买条件完全相同');
  }
}

compareBuyConditions().catch(console.error);
