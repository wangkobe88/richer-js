const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function countSignals() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  console.log('=== 信号统计 ===\n');

  // 获取所有信号然后计数
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('id, executed, metadata')
    .eq('experiment_id', oldExpId);

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('id, executed, metadata')
    .eq('experiment_id', newExpId);

  console.log('旧实验:');
  console.log('  总信号:', oldSignals?.length || 0);
  const oldExecuted = oldSignals?.filter(s => s.executed === true).length || 0;
  console.log('  已执行:', oldExecuted);
  console.log('');

  console.log('新实验:');
  console.log('  总信号:', newSignals?.length || 0);
  const newExecuted = newSignals?.filter(s => s.executed === true).length || 0;
  console.log('  已执行:', newExecuted);
  console.log('');

  // 分析新实验中被过滤掉的信号
  if (newSignals) {
    const executedSignals = newSignals.filter(s => s.executed === true);
    const notExecutedSignals = newSignals.filter(s => s.executed !== true);
    
    console.log('=== 新实验信号分析 ===\n');
    console.log('已执行:', executedSignals.length);
    console.log('未执行:', notExecutedSignals.length);
    console.log('');

    // 检查未执行信号的 metadata
    console.log('=== 未执行信号的 metadata 分析 ===\n');
    notExecutedSignals.slice(0, 5).forEach((s, i) => {
      const metadata = s.metadata || {};
      console.log(`信号 ${i + 1}:`);
      console.log('  preBuyCheckResult:', metadata.preBuyCheckResult ? '存在' : '不存在');
      if (metadata.preBuyCheckResult) {
        console.log('  reason:', metadata.preBuyCheckResult.reason);
      }
      console.log('  earlyWhaleCount:', metadata.preBuyCheckFactors?.earlyWhaleCount);
      console.log('');
    });
  }
}

countSignals().catch(console.error);
