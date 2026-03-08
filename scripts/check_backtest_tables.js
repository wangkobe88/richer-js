/**
 * 查看回测实验 ab75cb2b 的实际数据
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkBacktestData() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  // 查看回测交易表
  const { data: backtestTrades, error } = await supabase
    .from('backtest_trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true })
    .limit(10);

  console.log('【backtest_trades 表】');
  console.log(`查询结果: ${error ? error.message : '成功'}`);
  console.log(`记录数: ${backtestTrades?.length || 0}`);

  if (backtestTrades && backtestTrades.length > 0) {
    console.log('\n示例记录:');
    console.log(JSON.stringify(backtestTrades[0], null, 2));
  }

  // 查看回测代币表
  const { data: backtestTokens, error: tokensError } = await supabase
    .from('backtest_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('discovered_at', { ascending: false})
    .limit(10);

  console.log('\n【backtest_tokens 表】');
  console.log(`查询结果: ${tokensError ? tokensError.message : '成功'}`);
  console.log(`记录数: ${backtestTokens?.length || 0}`);

  if (backtestTokens && backtestTokens.length > 0) {
    console.log('\n示例记录:');
    console.log(JSON.stringify(backtestTokens[0], null, 2));
  }

  // 列出所有表
  const { data: tables } = await supabase.rpc('get_tables');
  console.log('\n【数据库表列表】');
  if (tables) {
    tables.forEach(t => console.log(`  - ${t}`));
  }
}

checkBacktestData().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('查询失败:', error);
  process.exit(1);
});
