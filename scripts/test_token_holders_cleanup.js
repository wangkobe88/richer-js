const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  console.log('检查 token_holders 数据...\n');

  // 获取所有 token_holders 记录
  const { data: holders, error } = await supabase
    .from('token_holders')
    .select('id, experiment_id')
    .limit(10);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('前 10 条 token_holders 记录:');
  holders.forEach((h, i) => {
    console.log(`${i+1}. ID: ${h.id?.substring(0,8)}...`);
    console.log(`   experiment_id: "${h.experiment_id}"`);
    console.log(`   类型: ${typeof h.experiment_id}`);
    console.log(`   长度: ${h.experiment_id?.length}`);
    console.log(`   为空: ${h.experiment_id === null || h.experiment_id === undefined || h.experiment_id === ''}`);
    console.log('');
  });

  // 获取所有有效的实验ID
  const { data: exps } = await supabase
    .from('experiments')
    .select('id');

  console.log(`\n有效实验数量: ${exps.length}`);
  console.log('有效实验ID示例:', exps[0]?.id);

  // 检查是否有实验ID匹配
  const validIds = new Set(exps.map(e => e.id));
  const { data: allHolders } = await supabase
    .from('token_holders')
    .select('id, experiment_id');

  let orphaned = 0;
  let valid = 0;
  let nullOrEmpty = 0;

  allHolders.forEach(h => {
    if (!h.experiment_id || h.experiment_id === '') {
      nullOrEmpty++;
    } else if (validIds.has(h.experiment_id)) {
      valid++;
    } else {
      orphaned++;
    }
  });

  console.log('\n统计结果:');
  console.log(`- 总记录数: ${allHolders.length}`);
  console.log(`- experiment_id 为空: ${nullOrEmpty}`);
  console.log(`- 有效实验引用: ${valid}`);
  console.log(`- 孤立记录: ${orphaned}`);
})();
