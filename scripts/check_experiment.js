const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 1. 检查实验
  const { data: exps, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', '9733f934-b263-40e0-a4d3-8639703b0da9');

  if (expError) {
    console.log('实验查询失败:', expError);
  } else if (exps && exps.length > 0) {
    const exp = exps[0];
    console.log('=== 实验信息 ===');
    console.log('ID:', exp.id);
    console.log('状态:', exp.status);
    console.log('源实验ID:', exp.config?.backtest?.sourceExperimentId);
  } else {
    console.log('未找到实验');
  }

  // 2. 检查信号数量
  const { count: signalCount, error: signalError } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', '9733f934-b263-40e0-a4d3-8639703b0da9');

  if (signalError) {
    console.log('\n信号查询失败:', signalError);
  } else {
    console.log('\n=== 信号数据 ===');
    console.log('信号数量:', signalCount);
  }

  // 3. 检查交易数量
  const { count: tradeCount, error: tradeError } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', '9733f934-b263-40e0-a4d3-8639703b0da9');

  if (tradeError) {
    console.log('\n交易查询失败:', tradeError);
  } else {
    console.log('\n=== 交易数据 ===');
    console.log('交易数量:', tradeCount);
  }

  // 4. 检查所有实验
  const { data: allExps, error: allExpError } = await supabase
    .from('experiments')
    .select('id, status, trading_mode')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!allExpError && allExps) {
    console.log('\n=== 最近10个实验 ===');
    allExps.forEach(e => {
      console.log(`  ${e.id.substring(0, 8)}... | status: ${e.status} | mode: ${e.trading_mode}`);
    });
  }
})();
