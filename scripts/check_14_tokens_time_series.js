/**
 * 检查那14个代币在源实验中的 time_series_data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查14个代币的 time_series_data ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币的 time_series_data 详情】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2Symbols) {
    // 使用 count 获取总数
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('id', { count: 'exact' })
      .eq('experiment_id', sourceId)
      .eq('token_symbol', symbol);

    // 获取第一条数据（如果有的话）
    const { data: firstData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp, loop_count')
      .eq('experiment_id', sourceId)
      .eq('token_symbol', symbol)
      .order('timestamp', { ascending: true })
      .limit(1);

    // 获取最后一条数据（如果有的话）
    const { data: lastData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp, loop_count')
      .eq('experiment_id', sourceId)
      .eq('token_symbol', symbol)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (count > 0) {
      const firstTime = firstData?.[0]?.timestamp ? new Date(firstData[0].timestamp).toLocaleString('zh-CN') : 'N/A';
      const lastTime = lastData?.[0]?.timestamp ? new Date(lastData[0].timestamp).toLocaleString('zh-CN') : 'N/A';
      console.log(`${symbol}: ${count} 条, 时间: ${firstTime} - ${lastTime}`);
    } else {
      console.log(`${symbol}: 无 time_series_data`);
    }
  }

  // 检查实验1和实验2的创建时间
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【时间对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp1 } = await supabase
    .from('experiments')
    .select('created_at')
    .eq('id', '209a7796-f955-4d7a-ae21-0902fef3d7cc')
    .single();

  const { data: exp2 } = await supabase
    .from('experiments')
    .select('created_at')
    .eq('id', '2522cab9-721f-4922-86f9-7484d644e7cc')
    .single();

  console.log(`实验1创建时间: ${exp1?.created_at ? new Date(exp1.created_at).toLocaleString('zh-CN') : 'N/A'}`);
  console.log(`实验2创建时间: ${exp2?.created_at ? new Date(exp2.created_at).toLocaleString('zh-CN') : 'N/A'}`);
}

main().catch(console.error);
