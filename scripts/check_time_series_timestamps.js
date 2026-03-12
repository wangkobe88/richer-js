/**
 * 检查源实验 time_series_data 的时间戳
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验 time_series_data 的时间范围 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 获取源实验 time_series_data 的时间范围
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, timestamp')
    .eq('experiment_id', sourceId)
    .order('timestamp', { ascending: true });

  if (timeSeriesData && timeSeriesData.length > 0) {
    const timestamps = timeSeriesData.map(t => new Date(t.timestamp).getTime());
    console.log(`源实验 time_series_data 时间范围:`);
    console.log(`  最早: ${new Date(Math.min(...timestamps)).toLocaleString('zh-CN')}`);
    console.log(`  最晚: ${new Date(Math.max(...timestamps)).toLocaleString('zh-CN')}`);
    console.log(`  数据点数: ${timeSeriesData.length}\n`);

    // 获取实验1和实验2的创建时间
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

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【实验创建时间对比】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`源实验 time_series_data 最早: ${new Date(Math.min(...timestamps)).toLocaleString('zh-CN')}`);
    console.log(`源实验 time_series_data 最晚: ${new Date(Math.max(...timestamps)).toLocaleString('zh-CN')}`);
    console.log(`实验1创建时间: ${exp1?.created_at ? new Date(exp1.created_at).toLocaleString('zh-CN') : 'N/A'}`);
    console.log(`实验2创建时间: ${exp2?.created_at ? new Date(exp2.created_at).toLocaleString('zh-CN') : 'N/A'}`);

    // 检查那14个代币是否有 time_series_data
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【检查那14个代币的 time_series_data】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const onlyInExp2Symbols = [
      'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
      'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
    ];

    for (const symbol of onlyInExp2Symbols.slice(0, 5)) {
      const tokenData = timeSeriesData.filter(t => t.token_symbol === symbol);
      if (tokenData.length > 0) {
        const tokenTimestamps = tokenData.map(t => new Date(t.timestamp).getTime());
        console.log(`${symbol}: 有 ${tokenData.length} 个数据点, 时间范围: ${new Date(Math.min(...tokenTimestamps)).toLocaleString('zh-CN')} - ${new Date(Math.max(...tokenTimestamps)).toLocaleString('zh-CN')}`);
      } else {
        console.log(`${symbol}: 无 time_series_data`);
      }
    }
  }
}

main().catch(console.error);
