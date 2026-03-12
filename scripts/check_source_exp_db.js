/**
 * 直接从数据库检查源实验
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验 ===\n');

  const { data: exp1 } = await supabase
    .from('experiments')
    .select('config, type, mode')
    .eq('id', '209a7796-f955-4d7a-ae21-0902fef3d7cc')
    .single();

  const { data: exp2 } = await supabase
    .from('experiments')
    .select('config, type, mode')
    .eq('id', '2522cab9-721f-4922-86f9-7484d644e7cc')
    .single();

  const sourceId1 = exp1?.config?.backtest?.sourceExperimentId;
  const sourceId2 = exp2?.config?.backtest?.sourceExperimentId;

  console.log(`实验1 (${exp1?.mode}):`);
  console.log(`  类型: ${exp1?.type}`);
  console.log(`  源实验ID: ${sourceId1 || 'N/A'}`);
  console.log('');

  console.log(`实验2 (${exp2?.mode}):`);
  console.log(`  类型: ${exp2?.type}`);
  console.log(`  源实验ID: ${sourceId2 || 'N/A'}`);
  console.log('');

  if (sourceId1 && sourceId1 === sourceId2) {
    console.log('两个实验使用相同的源实验');

    // 获取源实验的 trades
    const { data: sourceTrades } = await supabase
      .from('trades')
      .select('token_symbol, token_address, timestamp, direction')
      .eq('experiment_id', sourceId1);

    const sourceTokens = [...new Set(sourceTrades?.map(t => t.token_symbol) || [])];
    console.log(`源实验中有 ${sourceTokens.length} 个代币`);

    // 检查那14个只在实验2中的代币
    const onlyInExp2 = [
      'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
      'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
    ];

    console.log('\n检查这14个代币是否在源实验的 trades 中:');
    for (const symbol of onlyInExp2) {
      const trades = sourceTrades?.filter(t => t.token_symbol === symbol) || [];
      if (trades.length > 0) {
        const buys = trades.filter(t => t.direction === 'buy');
        const firstBuy = buys.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];
        console.log(`  ${symbol}: ${trades.length} trades (${buys.length} buys), 首次买入: ${firstBuy ? new Date(firstBuy.timestamp).toLocaleString('zh-CN') : 'N/A'}`);
      } else {
        console.log(`  ${symbol}: 不在源实验中`);
      }
    }
  }
}

main().catch(console.error);
