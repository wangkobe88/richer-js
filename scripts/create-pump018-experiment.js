/**
 * 查询最新虚拟实验配置并创建新实验
 */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function main() {
  // 查询最新的虚拟实验
  const { data: experiments, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', 'c88d7745-50e5-440a-9ac7-be3494ea0c6a')  // Pump017
    .single();

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('=== Pump017 配置 ===');
  console.log('名称:', experiments.experiment_name);
  console.log('状态:', experiments.status);
  console.log('配置:', JSON.stringify(experiments.config, null, 2));

  // 基于 Pump017 创建新实验
  const newConfig = { ...experiments.config };

  // 名字自增
  const newName = 'Pump018-ws-collector-test';

  const { data: newExp, error: createError } = await supabase
    .from('experiments')
    .insert({
      experiment_name: newName,
      experiment_description: '测试 PumpFun WebSocket 实时收集器，基于 Pump017 配置',
      status: 'initializing',
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
  console.log('状态:', newExp.status);
}

main().catch(console.error);
