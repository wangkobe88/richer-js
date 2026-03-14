const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 查看实验列表
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, trading_mode, status, config')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('最近的实验:');
  experiments?.forEach(e => {
    const name = e.config?.name || 'N/A';
    console.log('  ' + e.id.slice(0, 8) + '... | ' + e.trading_mode + ' | ' + e.status + ' | ' + name);
  });

  // 检查 a2ee5c27 信号的 row_count
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad');

  console.log('\na2ee5c27 信号数:', signals?.length || 0);

  // 检查不同 executed 状态的数量
  const { count: executedCount } = await supabase
    .from('strategy_signals')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  const { count: notExecutedCount } = await supabase
    .from('strategy_signals')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', false);

  const { count: nullExecutedCount } = await supabase
    .from('strategy_signals')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .is('executed', null);

  console.log('  executed = true:', executedCount || 0);
  console.log('  executed = false:', notExecutedCount || 0);
  console.log('  executed = null:', nullExecutedCount || 0);

  // 获取一些样本信号
  const { data: samples } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, executed, execution_reason')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .limit(5);

  console.log('\n样本信号:');
  samples?.forEach(s => {
    console.log('  ' + s.token_symbol + ': executed=' + s.executed + ', reason=' + (s.execution_reason || 'none'));
  });
})();
