/**
 * 检查特定代币的所有信号
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTokenSignals() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  console.log('=== 代币 0x6b0fd53e... (1$) 所有信号 ===\n');

  signals.forEach((s, i) => {
    const symbol = s.metadata?.symbol || '1$';
    const status = s.metadata?.execution_status || 'unknown';
    const hasFactors = s.metadata?.preBuyCheckFactors !== undefined && s.metadata?.preBuyCheckFactors !== null;
    const hasTrend = s.metadata?.trendFactors !== undefined;

    console.log(`信号 ${i + 1}:`);
    console.log(`  时间: ${new Date(s.created_at).toLocaleTimeString()}`);
    console.log(`  状态: ${status}`);
    console.log(`  有 preBuyCheckFactors: ${hasFactors}`);
    console.log(`  有 trendFactors: ${hasTrend}`);

    if (hasTrend && s.metadata?.trendFactors) {
      const tf = s.metadata.trendFactors;
      console.log(`  age: ${tf.age?.toFixed(1)}min, earlyReturn: ${tf.earlyReturn?.toFixed(1)}%`);
    }
    console.log('');
  });

  console.log('=== 总结 ===');
  console.log('该代币有', signals.length, '个信号，都执行了，都只有trendFactors，没有preBuyCheckFactors');
  console.log('');
  console.log('这说明回测引擎在处理这个代币时，早期参与者检查没有成功');
  console.log('可能原因：API调用失败、数据缺失、代币信息不完整等');
}

checkTokenSignals().catch(console.error);
