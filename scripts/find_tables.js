/**
 * 查找所有表名
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function findTables() {
  // 使用 PostgreSQL 系统表查询
  const { data, error } = await supabase
    .from('pg_tables')
    .select('tablename')
    .eq('schemaname', 'public');

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('数据库中的所有表:');
  data.forEach(t => {
    console.log(`  - ${t.tablename}`);
  });

  // 查找包含 signal 的表
  const signalTables = data
    .map(t => t.tablename)
    .filter(name => name.toLowerCase().includes('signal'));

  console.log('\n包含 "signal" 的表:');
  signalTables.forEach(t => {
    console.log(`  - ${t}`);
  });
}

findTables().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('查找失败:', error);
  process.exit(1);
});
