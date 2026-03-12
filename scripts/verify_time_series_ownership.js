/**
 * 验证 time_series_data 的归属
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 验证 time_series_data 的归属 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';
  const exp1Id = '209a7796-f955-4d7a-ae21-0902fef3d7cc';
  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 检查每个实验的 time_series_data 数量
  const experiments = [
    { id: sourceId, name: '源实验' },
    { id: exp1Id, name: '实验1' },
    { id: exp2Id, name: '实验2' }
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【各实验的 time_series_data 数量】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const exp of experiments) {
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('id', { count: 'exact' })
      .eq('experiment_id', exp.id);

    console.log(`${exp.name} (${exp.id.slice(0, 8)}...): ${count || 0} 条`);
  }

  // 检查源实验的 time_series_data 中是否有那14个代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查那14个代币的 time_series_data】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  for (const symbol of onlyInExp2Symbols.slice(0, 5)) {
    // 检查源实验
    const { data: sourceData } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', sourceId)
      .eq('token_symbol', symbol)
      .limit(1);

    const sourceCount = sourceData?.length || 0;

    // 检查实验1
    const { data: exp1Data } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', exp1Id)
      .eq('token_symbol', symbol)
      .limit(1);

    const exp1Count = exp1Data?.length || 0;

    // 检查实验2
    const { data: exp2Data } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', exp2Id)
      .eq('token_symbol', symbol)
      .limit(1);

    const exp2Count = exp2Data?.length || 0;

    console.log(`${symbol}: 源实验=${sourceCount}, 实验1=${exp1Count}, 实验2=${exp2Count}`);
  }
}

main().catch(console.error);
