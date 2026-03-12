/**
 * 查询源实验的完整 time_series_data 统计
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 查询源实验的完整 time_series_data ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 使用聚合函数获取统计信息
  const { data: stats, error: statsError } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id, token_symbol')
    .eq('experiment_id', sourceId);

  if (statsError) {
    console.error('Error:', statsError);
    return;
  }

  const uniqueTokens = [...new Set(stats?.map(t => t.token_symbol) || [])];
  console.log(`源实验 time_series_data 中有 ${stats?.length || 0} 条数据`);
  console.log(`涉及 ${uniqueTokens.length} 个不同的代币符号\n`);

  // 检查那14个代币
  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币在源实验 time_series_data 中的情况】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2Symbols) {
    const tokenData = stats?.filter(t => t.token_symbol === symbol) || [];
    if (tokenData.length > 0) {
      console.log(`${symbol}: 有 ${tokenData.length} 条 time_series_data`);
    } else {
      console.log(`${symbol}: 无 time_series_data`);
    }
  }

  // 获取源实验 time_series_data 的时间范围
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【源实验 time_series_data 时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 分页查询获取时间范围
  const { data: timeRangeData } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp')
    .eq('experiment_id', sourceId)
    .order('timestamp', { ascending: true })
    .range(0, 0);

  const { data: timeRangeDataEnd } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp')
    .eq('experiment_id', sourceId)
    .order('timestamp', { ascending: false })
    .range(0, 0);

  if (timeRangeData && timeRangeData.length > 0) {
    console.log(`最早数据: ${new Date(timeRangeData[0].timestamp).toLocaleString('zh-CN')}`);
  }
  if (timeRangeDataEnd && timeRangeDataEnd.length > 0) {
    console.log(`最晚数据: ${new Date(timeRangeDataEnd[0].timestamp).toLocaleString('zh-CN')}`);
  }
}

main().catch(console.error);
