/**
 * 分析时间线
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTimeline() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 分析时间线 ===\n');

  // 获取三个实验
  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', sourceExpId)
    .single();

  const { data: oldExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', oldExpId)
    .single();

  const { data: newExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', newExpId)
    .single();

  console.log('1. 实验创建时间:');
  console.log(`   源实验: ${sourceExp?.created_at || '未知'}`);
  console.log(`   旧回测: ${oldExp?.created_at || '未知'}`);
  console.log(`   新回测: ${newExp?.created_at || '未知'}`);

  // 检查源实验的状态
  console.log('\n2. 源实验状态:');
  console.log(`   状态: ${sourceExp?.status || '未知'}`);
  console.log(`   开始时间: ${sourceExp?.started_at || '未知'}`);
  console.log(`   结束时间: ${sourceExp?.ended_at || '未知'}`);

  // 检查源实验的数据
  const { data: sourceTimeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp')
    .eq('experiment_id', sourceExpId)
    .order('timestamp', { ascending: true })
    .range(0, 999);

  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', sourceExpId);

  console.log('\n3. 源实验数据:');
  console.log(`   time_series_data 记录数（查询限制1000）: ${sourceTimeSeries?.length || 0}`);
  console.log(`   time_series_data 实际总数: ${count || '未知'}`);

  if (sourceTimeSeries && sourceTimeSeries.length > 0) {
    console.log(`   第一条数据时间: ${sourceTimeSeries[0].timestamp}`);
    console.log(`   第1000条数据时间: ${sourceTimeSeries[sourceTimeSeries.length - 1].timestamp}`);
  }

  console.log('\n4. 结论:');
  if ((sourceTimeSeries?.length || 0) === 1000 && (count || 0) > 1000) {
    console.log('   ⚠️  源实验数据超过1000条，但查询只返回前1000条');
    console.log('   这导致旧回测只处理了前1000条数据对应的代币');
    console.log('   新回测可能因为某种原因加载了更多数据');
  }
}

analyzeTimeline().catch(console.error);
