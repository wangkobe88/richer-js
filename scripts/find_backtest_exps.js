const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 查找所有回测实验
  const { data: exps } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode, status, created_at')
    .eq('trading_mode', 'backtest')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('=== 所有回测实验 ===\n');
  for (const exp of exps || []) {
    // 检查每个实验的交易和信号数量
    const [trades, signals] = await Promise.all([
      supabase.from('trades').select('*', { count: 'exact', head: true }).eq('experiment_id', exp.id),
      supabase.from('strategy_signals').select('*', { count: 'exact', head: true }).eq('experiment_id', exp.id)
    ]);

    console.log(`${exp.id.substring(0, 8)}... | ${exp.experiment_name.substring(0, 30)}`);
    console.log(`  状态: ${exp.status} | 时间: ${exp.created_at}`);
    console.log(`  交易: ${trades.count || 0} | 信号: ${signals.count || 0}`);
    console.log('');
  }
})();
