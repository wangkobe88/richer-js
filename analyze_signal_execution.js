const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeSignalExecution() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  console.log('=== 分析信号执行情况 ===\n');

  // 获取所有信号（包括 status）
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, metadata, status, executed')
    .eq('experiment_id', oldExpId);

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, metadata, status, executed')
    .eq('experiment_id', newExpId);

  // 统计执行情况
  const oldExecuted = oldSignals?.filter(s => s.executed === true).length || 0;
  const newExecuted = newSignals?.filter(s => s.executed === true).length || 0;

  const oldNotExecuted = oldSignals?.filter(s => s.executed === false).length || 0;
  const newNotExecuted = newSignals?.filter(s => s.executed === false).length || 0;

  console.log('=== 信号执行统计 ===\n');
  console.log('旧实验:');
  console.log('  已执行:', oldExecuted);
  console.log('  未执行:', oldNotExecuted);
  console.log('  总信号:', oldSignals?.length || 0);
  console.log('');
  console.log('新实验:');
  console.log('  已执行:', newExecuted);
  console.log('  未执行:', newNotExecuted);
  console.log('  总信号:', newSignals?.length || 0);
  console.log('');

  // 分析未执行的原因
  if (newNotExecuted > 0) {
    console.log('=== 新实验未执行信号的原因 ===\n');
    const notExecuted = newSignals?.filter(s => s.executed === false) || [];
    
    // 分析原因
    const reasons = {
      '预检查失败': 0,
      '其他原因': 0
    };

    notExecuted.forEach(s => {
      const metadata = s.metadata || {};
      const preBuyResult = metadata.preBuyCheckResult;
      
      if (preBuyResult) {
        if (preBuyResult.reason && preBuyResult.reason.includes('预检查失败')) {
          reasons['预检查失败']++;
        } else {
          reasons['其他原因']++;
        }
      } else {
        reasons['其他原因']++;
      }
    });

    Object.entries(reasons).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });
  }

  // 检查是否有因为 earlyWhale 被拒绝的信号
  console.log('\n=== 检查 earlyWhale 相关的拒绝 ===\n');
  const newSignalsWithEarlyWhale = newSignals?.filter(s => {
    const factors = s.metadata?.preBuyCheckFactors;
    return factors && factors.earlyWhaleMethod === 'real_early';
  }) || [];

  console.log('使用 real_early 方法的信号数:', newSignalsWithEarlyWhale.length);
  
  if (newSignalsWithEarlyWhale.length > 0) {
    let highSellRatioCount = 0;
    newSignalsWithEarlyWhale.forEach(s => {
      const factors = s.metadata?.preBuyCheckFactors;
      if (factors && factors.earlyWhaleSellRatio > 0.8) {
        highSellRatioCount++;
      }
    });
    console.log('其中 sellRatio > 80% 的:', highSellRatioCount);
  }
}

analyzeSignalExecution().catch(console.error);
