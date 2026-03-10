const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareSignals() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96'; // 修复前
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384'; // 修复后
  const targetToken = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444'; // 1$ 代币

  console.log('=== 对比 1$ 代币的信号数据 ===\n');

  // 获取旧实验的信号
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId)
    .eq('token_address', targetToken);

  // 获取新实验的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId)
    .eq('token_address', targetToken);

  console.log('旧实验 (修复前):', oldSignals?.length || 0, '个信号');
  console.log('新实验 (修复后):', newSignals?.length || 0, '个信号');
  console.log('');

  // 对比 first signal 的 preBuyCheckFactors
  const oldSignal = oldSignals && oldSignals.length > 0 ? oldSignals[0] : null;
  const newSignal = newSignals && newSignals.length > 0 ? newSignals[0] : null;

  if (oldSignal) {
    console.log('=== 旧实验信号数据 ===\n');
    const oldMetadata = oldSignal.metadata || {};
    console.log('tokenCreateTime:', oldMetadata.tokenCreateTime ?? '不存在');
    if (oldMetadata.preBuyCheckFactors) {
      console.log('earlyWhaleCount:', oldMetadata.preBuyCheckFactors.earlyWhaleCount);
      console.log('earlyWhaleSellRatio:', oldMetadata.preBuyCheckFactors.earlyWhaleSellRatio);
      console.log('earlyWhaleMethod:', oldMetadata.preBuyCheckFactors.earlyWhaleMethod);
    }
    console.log('');
  }

  if (newSignal) {
    console.log('=== 新实验信号数据 ===\n');
    const newMetadata = newSignal.metadata || {};
    console.log('tokenCreateTime:', newMetadata.tokenCreateTime ?? '不存在');
    if (newMetadata.preBuyCheckFactors) {
      console.log('earlyWhaleCount:', newMetadata.preBuyCheckFactors.earlyWhaleCount);
      console.log('earlyWhaleSellRatio:', newMetadata.preBuyCheckFactors.earlyWhaleSellRatio);
      console.log('earlyWhaleMethod:', newMetadata.preBuyCheckFactors.earlyWhaleMethod);
    }
    console.log('');
  }

  // 统计两个实验的信号数量
  const { count: oldCount } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', oldExpId);

  const { count: newCount } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', newExpId);

  console.log('=== 总信号数对比 ===\n');
  console.log('旧实验总信号数:', oldCount || 0);
  console.log('新实验总信号数:', newCount || 0);
  console.log('差异:', (newCount || 0) - (oldCount || 0));
}

compareSignals().catch(console.error);
