/**
 * 检查人工判断数据和信号表
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkData() {
  const sourceExperimentId = 'c47a8057-9a86-4002-9bfc-103978265d04';
  const backtestExperimentId = '6be58f66-8b75-46b8-8bb5-c3388fa0a195';

  console.log('=== 检查人工判断数据 ===\n');

  // 1. 查看有人工判断标记的代币
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .eq('experiment_id', sourceExperimentId)
    .not('human_judges', 'is', null)
    .limit(5);

  if (tokensError) {
    console.error('获取代币失败:', tokensError);
  } else {
    console.log(`找到 ${tokens.length} 个有人工判断的代币（示例）:\n`);
    tokens.forEach(token => {
      console.log(`代币: ${token.token_symbol}`);
      console.log(`  地址: ${token.token_address}`);
      console.log(`  human_judges: ${JSON.stringify(token.human_judges, null, 2)}`);
      console.log('');
    });
  }

  // 2. 列出所有表名（查找信号表）
  console.log('\n=== 查找信号表 ===\n');

  // PostgreSQL 查询表名
  const { data: tables, error: tablesError } = await supabase.rpc('get_tables');

  if (tablesError) {
    // 如果 RPC 不可用，尝试直接查询 signals 表
    console.log('尝试查询 signals 表...');
    const { data: signals, error: signalsError } = await supabase
      .from('signals')
      .select('token_address, metadata, created_at')
      .eq('experiment_id', backtestExperimentId)
      .eq('action', 'buy')
      .limit(2);

    if (signalsError) {
      console.error('signals 表不存在或查询失败:', signalsError.message);
    } else {
      console.log(`找到 signals 表，有 ${signals.length} 条记录`);
    }
  } else {
    console.log('数据库中的表:', tables);
  }
}

checkData().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
