const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 查找所有回测实验及其交易/信号数量
  const { data: exps } = await supabase
    .from('experiments')
    .select('id, experiment_name, status, created_at')
    .eq('trading_mode', 'backtest')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('=== 最近5个回测实验的交易数据 ===\n');

  for (const exp of exps || []) {
    // 获取交易和信号数量
    const [tradeRes, signalRes] = await Promise.all([
      supabase.from('trades').select('id', { count: 'exact', head: true }).eq('experiment_id', exp.id),
      supabase.from('strategy_signals').select('id', { count: 'exact', head: true }).eq('experiment_id', exp.id)
    ]);

    console.log(`${exp.id.substring(0, 8)}... | ${exp.status} | 交易: ${tradeRes.count || 0} | 信号: ${signalRes.count || 0}`);
  }

  // 检查日志文件中提到的实验
  const logExperiments = [
    '9ff66c4e-3d95-4486-85fb-2c4a587ebcbc',
    'a99cbb97-4d00-4b65-9282-96f2489b91ce'
  ];

  console.log('\n=== 检查日志中提到的实验 ===\n');
  for (const expId of logExperiments) {
    const { data: exp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', expId)
      .single();

    if (exp) {
      console.log(`实验 ${expId.substring(0, 8)}...:`);
      console.log(`  模式: ${exp.trading_mode} | 状态: ${exp.status}`);

      const [tradeRes, signalRes] = await Promise.all([
        supabase.from('trades').select('id', { count: 'exact', head: true }).eq('experiment_id', expId),
        supabase.from('strategy_signals').select('id', { count: 'exact', head: true }).eq('experiment_id', expId)
      ]);
      console.log(`  交易: ${tradeRes.count || 0} | 信号: ${signalRes.count || 0}`);
    } else {
      console.log(`实验 ${expId.substring(0, 8)}...: 不存在`);
    }
  }
})();
