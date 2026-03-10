/**
 * 检查代币第一个信号的详细 preBuyCheckFactors
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkFirstSignalDetails() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  if (signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const firstSignal = signals[0];

  console.log('=== 第一个信号详情 ===\n');
  console.log('时间:', new Date(firstSignal.created_at).toLocaleString());
  console.log('状态:', firstSignal.metadata?.execution_status);
  console.log('');

  console.log('=== preBuyCheckFactors ===');
  const factors = firstSignal.metadata?.preBuyCheckFactors;

  if (factors) {
    console.log('存在 preBuyCheckFactors 对象');
    console.log('内容:', JSON.stringify(factors, null, 2));
  } else {
    console.log('不存在 preBuyCheckFactors 对象');
  }

  console.log('');
  console.log('=== 关键因子值 ===');

  if (factors && factors.earlyWhaleCount !== undefined) {
    console.log('早期大户数量:', factors.earlyWhaleCount);
    console.log('早期大户持有率:', factors.earlyWhaleHoldRatio);
    console.log('早期大户卖出率:', factors.earlyWhaleSellRatio);
  } else {
    console.log('早期大户因子: 无数据');
  }

  if (factors) {
    console.log('');
    console.log('所有可用的因子:');
    Object.keys(factors).forEach(key => {
      const val = factors[key];
      const valStr = typeof val === 'number' ? val.toFixed(2) : JSON.stringify(val);
      console.log(`  ${key}: ${valStr}`);
    });
  }

  console.log('');
  console.log('=== 结论 ===');

  if (factors && factors.earlyWhaleCount !== undefined) {
    console.log('✓ 第一个信号有完整的早期大户因子数据');
    console.log('  早期大户数量:', factors.earlyWhaleCount);
    console.log('  早期大户卖出率:', (factors.earlyWhaleSellRatio * 100).toFixed(1) + '%');
    console.log('  满足条件(<=0.7):', factors.earlyWhaleSellRatio <= 0.7 ? '是 ✓' : '否 ✗');
  } else {
    console.log('✗ 第一个信号没有早期大户因子数据');
    console.log('  但有其他 preBuyCheckFactors 数据');
  }
}

checkFirstSignalDetails().catch(console.error);
