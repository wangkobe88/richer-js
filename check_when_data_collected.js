/**
 * 检查代币数据收集时间 vs 回测时间
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkWhenDataCollected() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 时间线分析 ===\n');

  // 获取关键时间点
  const { data: oldExp } = await supabase
    .from('experiments')
    .select('created_at')
    .eq('id', oldExpId)
    .single();

  const oldExpTime = new Date(oldExp.created_at).getTime();
  console.log('旧回测创建时间:', oldExp.created_at, `(${new Date(oldExpTime).getTime()})`);
  console.log('');

  // 检查新增代币的数据时间
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true });

    if (tokenData && tokenData.length > 0) {
      const firstTime = new Date(tokenData[0].timestamp).getTime();
      const lastTime = new Date(tokenData[tokenData.length - 1].timestamp).getTime();

      console.log(`${token.substring(0, 10)}... :`);
      console.log(`  第一条数据: ${tokenData[0].timestamp} (${firstTime < oldExpTime ? '旧回测之前' : '旧回测之后'})`);
      console.log(`  最后一条数据: ${tokenData[tokenData.length - 1].timestamp}`);
      console.log(`  数据点数: ${tokenData.length}`);
      
      // 检查这些代币的第一条数据是否满足买入条件
      const { data: allFirstData } = await supabase
        .from('experiment_time_series_data')
        .select('*')
        .eq('experiment_id', sourceExpId)
        .eq('token_address', token)
        .order('timestamp', { ascending: true })
        .limit(10);

      if (allFirstData && allFirstData.length > 0) {
        console.log(`  前10条数据的earlyReturn:`);
        allFirstData.forEach((d, i) => {
          const er = d.early_return || d.factor_values?.early_return;
          console.log(`    ${i + 1}. ${er ? er.toFixed(1) : 'N/A'}%`);
        });
      }
    }
    console.log('');
  }

  // 检查旧实验处理的代币
  console.log('=== 对比：旧实验处理的代币 ===\n');

  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', oldExpId);

  const oldProcessedTokens = new Set();
  oldSignals.forEach(s => oldProcessedTokens.add(s.token_address));

  console.log('旧实验处理了', oldProcessedTokens.size, '个代币');

  // 随机检查几个旧实验处理的代币的数据时间
  const sampleOldTokens = Array.from(oldProcessedTokens).slice(0, 3);
  
  console.log('\n旧实验处理的代币（样本）的数据时间:');
  for (const token of sampleOldTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .limit(1);

    if (tokenData && tokenData.length > 0) {
      console.log(`  ${token.substring(0, 10)}... : ${tokenData[0].timestamp}`);
    }
  }
}

checkWhenDataCollected().catch(console.error);
