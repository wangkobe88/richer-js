/**
 * 创建 Pump019 实验 - 基于 Helius transactionSubscribe 的新架构
 */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function main() {
  // 查询 Pump018 配置作为基础
  const { data: prev, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', 'a431c4b1-2b15-4dee-8868-adf61c305142')  // Pump019
    .single();

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('基于实验:', prev.experiment_name, '(' + prev.id + ')');

  // 基于 Pump018 配置创建新实验
  const newConfig = { ...prev.config, name: 'Pump020-helius-fixed-filter' };

  const { data: newExp, error: createError } = await supabase
    .from('experiments')
    .insert({
      experiment_name: 'Pump020-helius-fixed-filter',
      experiment_description: 'Helius transactionSubscribe + CreateV2+pump后缀双重过滤，纯净数据',
      status: 'initializing',
      trading_mode: 'virtual',
      config: newConfig
    })
    .select()
    .single();

  if (createError) {
    console.error('创建失败:', createError);
    return;
  }

  console.log('\n新实验已创建:');
  console.log('ID:', newExp.id);
  console.log('名称:', newExp.experiment_name);
}

main().catch(console.error);
