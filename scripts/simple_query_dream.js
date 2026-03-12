/**
 * 简单查询 DREAM 的 time_series_data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 查询 DREAM 的 time_series_data ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 方法1: 使用 like 匹配（避免大小写问题）
  const { data: data1, count: count1 } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact' })
    .eq('experiment_id', sourceId)
    .ilike('token_symbol', '%DREAM%')
    .limit(10);

  console.log(`方法1 (ilike): ${count1 || 0} 条`);
  if (data1 && data1.length > 0) {
    console.log('示例数据:');
    data1.forEach(d => {
      console.log(`  ${d.token_symbol} - ${d.timestamp}`);
    });
  }

  // 方法2: 精确匹配
  const { data: data2, count: count2 } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact' })
    .eq('experiment_id', sourceId)
    .eq('token_symbol', 'DREAM')
    .limit(10);

  console.log(`\n方法2 (精确匹配): ${count2 || 0} 条`);

  // 方法3: 查询包含 DREAM 的所有记录
  const { data: data3, count: count3 } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact' })
    .eq('experiment_id', sourceId)
    .filter('token_symbol', 'cs', '*DREAM*')  // cs = contains, case-sensitive
    .limit(10);

  console.log(`\n方法3 (contains): ${count3 || 0} 条`);

  // 检查源实验中是否有任何以 D 开头的 token_symbol
  const { data: data4 } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol')
    .eq('experiment_id', sourceId)
    .ilike('token_symbol', 'D%')
    .limit(20);

  console.log(`\n源实验中以 D 开头的 token_symbol:`);
  const uniqueSymbols = [...new Set(data4?.map(d => d.token_symbol) || [])];
  uniqueSymbols.forEach(s => console.log(`  - ${s}`));
}

main().catch(console.error);
