const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSignalsTableStructure() {
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  // 获取一个信号样本
  const { data: sampleSignal } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId)
    .limit(1)
    .single();

  if (!sampleSignal) {
    console.log('没有找到信号');
    return;
  }

  console.log('=== Signal 表字段 ===\n');
  Object.keys(sampleSignal).forEach(f => console.log('  -', f));
  console.log('');

  console.log('=== 示例数据 ===\n');
  console.log('ID:', sampleSignal.id);
  console.log('Token:', sampleSignal.token_address?.substring(0, 20) + '...');
  console.log('Status:', sampleSignal.status);
  console.log('Executed:', sampleSignal.executed);
  console.log('');

  // 检查 executed 字段的实际值
  const { data: allSignals, count } = await supabase
    .from('strategy_signals')
    .select('executed, status', { count: 'exact' })
    .eq('experiment_id', newExpId);

  console.log('=== Executed 字段统计 ===\n');
  console.log('总数:', count);
  
  if (allSignals && allSignals.length > 0) {
    const executedTrue = allSignals.filter(s => s.executed === true).length;
    const executedFalse = allSignals.filter(s => s.executed === false).length;
    const executedNull = allSignals.filter(s => s.executed === null).length;
    
    console.log('executed = true:', executedTrue);
    console.log('executed = false:', executedFalse);
    console.log('executed = null:', executedNull);
  }
}

checkSignalsTableStructure().catch(console.error);
