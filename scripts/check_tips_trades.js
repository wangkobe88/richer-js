require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';
  const tipsAddress = '0xca7de526b6215ae769f564430b52987ee9824444';

  // 检查交易记录
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tipsAddress);

  console.log('Tips 交易记录:', trades?.length || 0);
  if (trades && trades.length > 0) {
    trades.forEach(t => {
      console.log(`  方向: ${t.direction}, 金额: ${t.amount}, 状态: ${t.status}`);
    });
  }

  // 检查信号记录
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tipsAddress);

  console.log('Tips 信号记录:', signals?.length || 0);
  if (signals && signals.length > 0) {
    signals.forEach(s => {
      console.log(`  信号类型: ${s.signal_type}, 执行: ${s.signal_executed}, 原因: ${s.execution_reason || '无'}`);
    });
  }

  // 检查所有信号记录
  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId);

  console.log('\n所有信号记录:', allSignals?.length || 0);
})();
