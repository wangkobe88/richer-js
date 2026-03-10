/**
 * 检查时间序列数据的查询限制问题
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTimeSeriesLimit() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 检查时间序列数据查询限制 ===\n');

  // 1. 检查总记录数和唯一代币数
  const { data: allTimeSeriesData, error } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId);

  console.log('1. 简单查询结果:');
  console.log('  返回记录数:', allTimeSeriesData?.length || 0);
  console.log('  错误:', error?.message || '无');

  const uniqueTokens = new Set();
  allTimeSeriesData?.forEach(d => uniqueTokens.add(d.token_address));
  console.log('  唯一代币数:', uniqueTokens.size);

  // 2. 使用 count 查询实际总数
  const { count, error: countError } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', sourceExpId);

  console.log('\n2. Count 查询结果:');
  console.log('  实际总记录数:', count);
  console.log('  错误:', countError?.message || '无');

  // 3. 检查新增代币是否真的在时间序列数据中
  const addedTokens = [
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444'
  ];

  console.log('\n3. 逐个查询新增代币:');

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token);

    const exists = tokenData && tokenData.length > 0;
    console.log(`  ${token.substring(0, 10)}... : ${exists ? '存在 (' + tokenData.length + '条)' : '不存在'}`);

    // 检查这个代币是否在 allTimeSeriesData 中
    const inBatch = allTimeSeriesData?.some(d => d.token_address === token);
    console.log(`    在批量查询结果中: ${inBatch ? '是' : '否'}`);
  }

  // 4. 检查是否是 Supabase 的分页限制
  console.log('\n4. 检查 Supabase 查询限制');
  console.log('  Supabase 默认返回最多 1000 条记录');
  console.log('  如果数据超过 1000 条，需要分页获取');

  if (allTimeSeriesData && allTimeSeriesData.length === 1000) {
    console.log('  ⚠️  查询返回了正好 1000 条记录，可能存在数据截断');
    console.log('  需要使用分页来获取所有数据');
  }
}

checkTimeSeriesLimit().catch(console.error);
