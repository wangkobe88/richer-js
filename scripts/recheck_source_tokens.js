/**
 * 重新检查源实验中那14个代币的数据
 * 这次查询 experiment_time_series_data 表
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 重新检查源实验中的代币数据 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 获取源实验中所有有 time_series_data 的代币
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, token_address')
    .eq('experiment_id', sourceId);

  const sourceTokens = [...new Set(timeSeriesData?.map(t => t.token_symbol) || [])];

  console.log(`源实验中有 time_series_data 的代币数量: ${sourceTokens.length}\n`);

  // 那14个代币
  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查这14个代币是否在源实验的 time_series_data 中】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const foundInSource = [];
  const notFoundInSource = [];

  for (const symbol of onlyInExp2Symbols) {
    const inSource = sourceTokens.includes(symbol);
    if (inSource) {
      foundInSource.push(symbol);
      // 获取该代币的地址
      const addresses = [...new Set(timeSeriesData.filter(t => t.token_symbol === symbol).map(t => t.token_address))];
      console.log(`${symbol}: 在 (${addresses.length} 个地址)`);
      addresses.forEach(addr => console.log(`    ${addr}`));
    } else {
      notFoundInSource.push(symbol);
      console.log(`${symbol}: 不在`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【统计】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`在源实验中: ${foundInSource.length} 个`);
  console.log(`不在源实验中: ${notFoundInSource.length} 个`);

  if (notFoundInSource.length > 0) {
    console.log('\n不在源实验中的代币:');
    console.log(notFoundInSource.join(', '));
  }
}

main().catch(console.error);
