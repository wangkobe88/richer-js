/**
 * 检查新增代币的时间序列数据在源实验中的位置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDataOrder() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 新增代币
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444', // 1$
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  console.log('=== 检查新增代币数据在源实验中的位置 ===\n');

  // 1. 获取前 1000 条数据
  const { data: first1000Data } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, timestamp')
    .eq('experiment_id', sourceExpId)
    .order('timestamp', { ascending: true })
    .range(0, 999);

  console.log('1. 前 1000 条数据统计');
  console.log('  返回记录数:', first1000Data?.length || 0);

  const tokensInFirst1000 = new Set();
  first1000Data?.forEach(d => tokensInFirst1000.add(d.token_address));
  console.log('  唯一代币数:', tokensInFirst1000.size);

  // 2. 检查新增代币是否在前 1000 条中
  console.log('\n2. 新增代币是否在前 1000 条数据中:');
  for (const token of addedTokens) {
    const inFirst1000 = tokensInFirst1000.has(token);
    console.log(`  ${token.substring(0, 10)}... : ${inFirst1000 ? '是' : '否'}`);
  }

  // 3. 如果不在前 1000 条，检查它们的数据位置
  console.log('\n3. 检查新增代币数据的位置:');

  for (const token of addedTokens) {
    // 获取该代币的第一条数据
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .range(0, 0);

    if (tokenData && tokenData.length > 0) {
      const firstTimestamp = tokenData[0].timestamp;

      // 查询有多少条数据比这个时间戳更早
      const { data: earlierData } = await supabase
        .from('experiment_time_series_data')
        .select('id')
        .eq('experiment_id', sourceExpId)
        .lt('timestamp', firstTimestamp);

      const position = earlierData?.length || 0;
      console.log(`  ${token.substring(0, 10)}... : 第 ${position + 1} 条数据开始 (${new Date(firstTimestamp * 1000).toLocaleString()})`);
    }
  }

  // 4. 统计总共有多少代币
  console.log('\n4. 检查源实验总共有多少代币');

  // 由于 Supabase 限制，我们用分组统计
  const { data: allData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId);

  const allTokens = new Set();
  allData?.forEach(d => allTokens.add(d.token_address));
  console.log('  前 1000 条数据中的代币数:', tokensInFirst1000.size);
  console.log('  注意: 由于查询限制，可能无法获取所有代币');
}

checkDataOrder().catch(console.error);
