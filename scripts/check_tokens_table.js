/**
 * 检查 experiment_tokens 表结构
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkTableStructure() {
  // 查询一个代币数据看看有什么字段
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .limit(1);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  if (tokens && tokens.length > 0) {
    console.log('experiment_tokens 表的字段:');
    console.log(Object.keys(tokens[0]));
    console.log('\n示例数据:');
    console.log(JSON.stringify(tokens[0], null, 2));
  }
}

checkTableStructure().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
