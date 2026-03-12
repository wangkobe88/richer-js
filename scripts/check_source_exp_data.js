/**
 * 检查源实验中这13个代币的时间序列数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验中13个代币的时间序列数据 ===\n');

  const sourceExpId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  // 获取这些代币的地址
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol')
    .eq('experiment_id', sourceExpId)
    .in('token_symbol', onlyInExp2);

  console.log(`找到 ${tokens?.length || 0} 个代币\n`);

  if (tokens && tokens.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【代币地址和最早的数据时间】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const token of tokens) {
      const { data: timeSeries } = await supabase
        .from('experiment_time_series_data')
        .select('timestamp')
        .eq('experiment_id', sourceExpId)
        .eq('token_address', token.token_address)
        .order('timestamp', { ascending: true })
        .limit(1);

      if (timeSeries && timeSeries.length > 0) {
        const firstDataTime = new Date(timeSeries[0].timestamp);
        console.log(`${token.token_symbol} (${token.token_address.slice(0, 10)}...)`);
        console.log(`  最早数据时间: ${firstDataTime.toLocaleString('zh-CN')}`);
        console.log('');
      } else {
        console.log(`${token.token_symbol}: 无时间序列数据`);
        console.log('');
      }
    }
  }

  // 检查实验1和实验2的实际回测时间范围
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验的回测时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp1 } = await supabase
    .from('experiments')
    .select('start_time, end_time')
    .eq('id', '209a7796-f955-4d7a-ae21-0902fef3d7cc')
    .single();

  const { data: exp2 } = await supabase
    .from('experiments')
    .select('start_time, end_time')
    .eq('id', '2522cab9-721f-4922-86f9-7484d644e7cc')
    .single();

  console.log(`实验1: ${exp1?.start_time ? new Date(exp1.start_time).toLocaleString('zh-CN') : 'N/A'} - ${exp1?.end_time ? new Date(exp1.end_time).toLocaleString('zh-CN') : 'N/A'}`);
  console.log(`实验2: ${exp2?.start_time ? new Date(exp2.start_time).toLocaleString('zh-CN') : 'N/A'} - ${exp2?.end_time ? new Date(exp2.end_time).toLocaleString('zh-CN') : 'N/A'}`);
}

main().catch(console.error);
