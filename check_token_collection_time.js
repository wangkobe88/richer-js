/**
 * 检查源实验收集这些代币数据的时间
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTokenCollectionTime() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  console.log('=== 检查代币数据收集时间 ===\n');

  // 获取实验创建时间
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, created_at')
    .in('id', [sourceExpId, oldExpId, newExpId]);

  const createTime = {};
  experiments.forEach(e => {
    const type = e.id === sourceExpId ? '源实验' : (e.id === oldExpId ? '旧回测' : '新回测');
    createTime[type] = new Date(e.created_at).getTime();
    console.log(`${type} 创建时间: ${e.created_at}`);
  });

  console.log('');

  // 检查这些代币在源实验中的数据时间范围
  for (const token of addedTokens) {
    console.log(`代币: ${token}`);
    
    // 获取该代币在源实验中的数据
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true);

    if (tokenData && tokenData.length > 0) {
      const firstData = tokenData[0];
      const lastData = tokenData[tokenData.length - 1];
      
      const firstTime = new Date(firstData.timestamp).getTime();
      const lastTime = new Date(lastData.timestamp).getTime();
      
      console.log(`  第一条数据时间: ${firstData.timestamp}`);
      console.log(`  最后一条数据时间: ${lastData.timestamp}`);
      console.log(`  数据点数: ${tokenData.length}`);
      
      // 检查旧回测创建时，这些代币是否已经有数据
      if (firstTime > createTime['旧回测']) {
        console.log(`  ⚠️  第一条数据在旧回测创建之后！`);
        console.log(`     旧回测运行时，这些代币还没有被源实验收集`);
      } else {
        console.log(`  ✓ 第一条数据在旧回测创建之前`);
      }
      
      // 检查 earlyReturn
      console.log(`  第一条数据的 earlyReturn: ${firstData.factor_values?.early_return || firstData.early_return || 'N/A'}%`);
      
    } else {
      console.log(`  无数据`);
    }
    console.log('');
  }

  // 对比：检查旧实验处理的代币的数据时间
  console.log('=== 对比：旧实验处理的代币 ===\n');
  
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const oldProcessedTokens = new Set();
  oldSignals.forEach(s => oldProcessedTokens.add(s.token_address));

  // 随机取几个旧实验处理的代币
  const sampleTokens = Array.from(oldProcessedTokens).slice(0, 3);
  
  for (const token of sampleTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .limit(1);

    if (tokenData && tokenData.length > 0) {
      console.log(`${token.substring(0, 10)}... 第一条数据: ${tokenData[0].timestamp}`);
    }
  }
}

checkTokenCollectionTime().catch(console.error);
