/**
 * 从数据库获取两个实验的原始配置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 获取两个实验的原始配置 ===\n');

  const { data: exp1, error: error1 } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', '209a7796-f955-4d7a-ae21-0902fef3d7cc')
    .single();

  const { data: exp2, error: error2 } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', '2522cab9-721f-4922-86f9-7484d644e7cc')
    .single();

  if (error1) console.error('实验1错误:', error1);
  if (error2) console.error('实验2错误:', error2);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验1】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('config:');
  console.log(JSON.stringify(exp1?.config, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('config:');
  console.log(JSON.stringify(exp2?.config, null, 2));

  // 对比差异
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【关键差异】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const config1 = exp1?.config || {};
  const config2 = exp2?.config || {};

  // buyStrategies
  console.log(`buyStrategies 数量: ${config1.buyStrategies?.length || 0} vs ${config2.buyStrategies?.length || 0}\n`);

  if (config1.buyStrategies?.[0]) {
    console.log('实验1 buyStrategy[0]:');
    console.log(`  preBuyCheckCondition: ${config1.buyStrategies[0].preBuyCheckCondition || '无'}`);
    console.log(`  buyCondition: ${config1.buyStrategies[0].buyCondition || '无'}`);
  }

  if (config2.buyStrategies?.[0]) {
    console.log('\n实验2 buyStrategy[0]:');
    console.log(`  preBuyCheckCondition: ${config2.buyStrategies[0].preBuyCheckCondition || '无'}`);
    console.log(`  buyCondition: ${config2.buyStrategies[0].buyCondition || '无'}`);
  }

  // maxExecutions
  console.log(`\nmaxExecutions: ${config1.maxExecutions || '未设置'} vs ${config2.maxExecutions || '未设置'}`);

  // source_experiment_id
  console.log(`\nsource_experiment_id: ${exp1?.source_experiment_id || '无'} vs ${exp2?.source_experiment_id || '无'}`);
}

main().catch(console.error);
