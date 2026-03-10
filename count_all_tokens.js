/**
 * 统计源实验中的所有代币
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function countAllTokens() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 统计源实验中的代币 ===\n');

  // 检查源实验到底有多少个代币
  // 由于有165162条数据，我们需要用分组查询来获取唯一代币数

  const { data: sampleData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId)
    .range(0, 1000);

  const tokensInFirst1000 = new Set();
  sampleData?.forEach(d => tokensInFirst1000.add(d.token_address));

  console.log('前1000条数据中的唯一代币数:', tokensInFirst1000.size);

  // 尝试获取1000-2000条数据
  const { data: sampleData2 } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId)
    .range(1000, 1999);

  const tokensIn1000_2000 = new Set();
  sampleData2?.forEach(d => tokensIn1000_2000.add(d.token_address));

  console.log('1000-2000条数据中的唯一代币数:', tokensIn1000_2000.size);

  // 合并
  const totalTokens = new Set([...tokensInFirst1000, ...tokensIn1000_2000]);
  console.log('前2000条数据中的唯一代币总数:', totalTokens.size);

  // 新增代币
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  console.log('\n新增代币在前2000条数据中的位置:');
  for (const token of addedTokens) {
    const inFirst1000 = tokensInFirst1000.has(token);
    const in1000_2000 = tokensIn1000_2000.has(token);
    console.log(`  ${token.substring(0, 10)}... : 前1000条=${inFirst1000}, 1000-2000条=${in1000_2000}`);
  }

  // 旧实验处理的代币数
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const oldProcessedTokens = new Set();
  oldSignals.forEach(s => oldProcessedTokens.add(s.token_address));

  console.log('\n旧实验处理的代币数:', oldProcessedTokens.size);
}

countAllTokens().catch(console.error);
