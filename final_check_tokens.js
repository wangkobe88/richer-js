/**
 * 最终检查：这些代币在源实验中是否有数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function finalCheck() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  console.log('=== 最终检查 ===\n');

  // 1. 重新检查这些代币在源实验中的数据
  console.log('1. 这些代币在源实验 time_series_data 中的情况:\n');

  for (const token of addedTokens) {
    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact' })
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token);

    const count = data ? data.length : 0;
    const exactCount = data ? (data[0]?.count || 0) : 0;
    
    console.log(`${token.substring(0, 10)}... : ${count} 条数据, exactCount=${exactCount}, error=${error?.message || '无'}`);
  }

  // 2. 检查这些代币在新实验信号中的 preBuyCheckFactors
  console.log('\n2. 这些代币在新实验信号中的 preBuyCheckFactors:\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId);

  for (const token of addedTokens) {
    const tokenSignals = newSignals.filter(s => s.token_address === token);
    if (tokenSignals.length > 0) {
      const first = tokenSignals[0];
      const factors = first.metadata?.preBuyCheckFactors;
      const trend = first.metadata?.trendFactors;

      console.log(`${token.substring(0, 10)}... :`);
      console.log(`  有 preBuyCheckFactors: ${factors ? '是' : '否'}`);
      console.log(`  有 trendFactors: ${trend ? '是' : '否'}`);
      
      if (trend) {
        console.log(`  age: ${trend.age} 分钟`);
        console.log(`  earlyReturn: ${trend.earlyReturn}%`);
      }
      
      if (factors) {
        console.log(`  earlyTradesTotalCount: ${factors.earlyTradesTotalCount}`);
      }
    }
    console.log('');
  }

  // 3. 关键问题：新实验的信号是从哪里来的？
  console.log('\n3. 关键问题\n');
  console.log('如果这些代币在源实验中没有 time_series_data，');
  console.log('那新实验的信号中的 trendFactors 是从哪里来的？');
  console.log('');
  console.log('可能的原因：');
  console.log('A. BacktestEngine 在回测时实时计算了 trendFactors');
  console.log('B. 或者从其他表获取了数据');
  console.log('C. 或者我之前的查询有误');
}

finalCheck().catch(console.error);
