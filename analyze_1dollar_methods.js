const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyze1DollarMethods() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  console.log('=== 1$ 代币：对比两种方法 ===\n');

  // 旧实验（relative 方法）
  const { data: oldSignal } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', oldExpId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 新实验（real_early 方法）
  const { data: newSignal } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', newExpId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('旧实验（使用 relative 方法 - 前 30% 交易）:');
  if (oldSignal?.metadata?.preBuyCheckFactors) {
    const f = oldSignal.metadata.preBuyCheckFactors;
    console.log('  earlyWhaleMethod:', f.earlyWhaleMethod || '未知');
    console.log('  earlyWhaleCount:', f.earlyWhaleCount);
    console.log('  earlyWhaleSellRatio:', f.earlyWhaleSellRatio);
  }
  console.log('');

  console.log('新实验（使用 real_early 方法 - 前 30 笔交易）:');
  if (newSignal?.metadata?.preBuyCheckFactors) {
    const f = newSignal.metadata.preBuyCheckFactors;
    console.log('  earlyWhaleMethod:', f.earlyWhaleMethod);
    console.log('  earlyWhaleCount:', f.earlyWhaleCount);
    console.log('  earlyWhaleSellRatio:', f.earlyWhaleSellRatio);
  }
  console.log('');

  console.log('=== 分析 ===\n');
  console.log('预检查条件要求: earlyWhaleSellRatio <= 0.7 (70%)');
  console.log('');

  if (oldSignal?.metadata?.preBuyCheckFactors) {
    const oldRatio = oldSignal.metadata.preBuyCheckFactors.earlyWhaleSellRatio;
    const oldPass = oldRatio <= 0.7;
    console.log('旧实验 (relative):');
    console.log('  SellRatio:', (oldRatio * 100).toFixed(1) + '%');
    console.log('  通过预检查:', oldPass ? '✅ 是' : '❌ 否');
  }
  console.log('');

  if (newSignal?.metadata?.preBuyCheckFactors) {
    const newRatio = newSignal.metadata.preBuyCheckFactors.earlyWhaleSellRatio;
    const newPass = newRatio <= 0.7;
    console.log('新实验 (real_early):');
    console.log('  SellRatio:', (newRatio * 100).toFixed(1) + '%');
    console.log('  通过预检查:', newPass ? '✅ 是' : '❌ 否');
  }
}

analyze1DollarMethods().catch(console.error);
