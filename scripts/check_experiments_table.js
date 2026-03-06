/**
 * 检查 experiments 表结构
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkTableStructure() {
  // 查询一个实验数据看看有什么字段
  const { data: experiments, error } = await supabase
    .from('experiments')
    .select('*')
    .limit(1);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  if (experiments && experiments.length > 0) {
    console.log('experiments 表的字段:');
    console.log(Object.keys(experiments[0]));
    console.log('\n示例数据:');
    console.log(JSON.stringify(experiments[0], null, 2));
  }
}

checkTableStructure().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
