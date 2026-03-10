/**
 * 检查代币数据收集时间
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkCollectionTime() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 检查代币数据收集时间 ===\n');

  // 获取旧回测创建时间
  const { data: oldExp } = await supabase
    .from('experiments')
    .select('created_at')
    .eq('id', oldExpId)
    .single();

  const oldExpTime = new Date(oldExp.created_at).getTime();
  console.log('旧回测创建时间:', oldExp.created_at);
  console.log('');

  // 检查新增代币的第一条数据时间
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444'
  ];

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp, early_return, factor_values')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .limit(1);

    if (tokenData && tokenData.length > 0) {
      const first = tokenData[0];
      const firstTime = new Date(first.timestamp).getTime();
      
      console.log(`代币: ${token.substring(0, 10)}...`);
      console.log(`  第一条数据时间: ${first.timestamp}`);
      console.log(`  earlyReturn: ${first.early_return || first.factor_values?.early_return || 'N/A'}%`);
      
      if (firstTime > oldExpTime) {
        console.log(`  ⚠️  数据在旧回测创建之后！旧回测时还没收集到`);
      } else {
        console.log(`  ✓ 数据在旧回测创建之前`);
      }
    } else {
      console.log(`代币: ${token.substring(0, 10)}...`);
      console.log(`  无数据`);
    }
    console.log('');
  }

  // 检查旧实验处理的代币
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId)
    .limit(3);

  console.log('旧实验处理的代币（样本）:');
  for (const signal of oldSignals) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', signal.token_address)
      .order('timestamp', { ascending: true })
      .limit(1);

    if (tokenData && tokenData.length > 0) {
      console.log(`  ${signal.token_address.substring(0, 10)}... : ${tokenData[0].timestamp}`);
    }
  }
}

checkCollectionTime().catch(console.error);
