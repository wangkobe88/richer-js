const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 直接查询 trades 表，过滤回测实验
  const { data: backtestTrades, error } = await supabase
    .from('trades')
    .select('*')
    .eq('is_virtual_trade', true)  // 回测也是虚拟交易
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log('查询失败:', error.message);
    return;
  }

  console.log('=== trades 表中的数据 ===\n');
  console.log(`总记录数: ${backtestTrades?.length || 0}`);

  if (!backtestTrades || backtestTrades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  // 显示字段
  console.log('\n字段列表:');
  console.log(Object.keys(backtestTrades[0]).join(', '));

  // 按实验分组
  const byExp = new Map();
  for (const t of backtestTrades) {
    if (!byExp.has(t.experiment_id)) {
      byExp.set(t.experiment_id, []);
    }
    byExp.get(t.experiment_id).push(t);
  }

  console.log(`\n共有 ${byExp.size} 个实验有交易数据`);

  // 检查这些实验的类型
  const expIds = Array.from(byExp.keys());
  const { data: exps } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode')
    .in('id', expIds);

  const expMap = new Map(exps?.map(e => [e.id, e]) || []);

  for (const [expId, trades] of byExp) {
    const exp = expMap.get(expId);
    console.log(`\n实验 ${expId.substring(0, 8)}... (${exp?.trading_mode || 'unknown'}) - ${trades.length} 条交易`);

    // 显示前2条
    for (let i = 0; i < Math.min(2, trades.length); i++) {
      const t = trades[i];
      console.log(`  [${i+1}] ${t.token_symbol} ${t.trade_direction}`);
      console.log(`      ${t.input_currency} ${t.input_amount} → ${t.output_currency} ${t.output_amount}`);
      console.log(`      created_at: ${t.created_at}`);
    }
  }

  // 检查是否有非 is_virtual_trade 的数据
  const { count: nonVirtCount } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .is('is_virtual_trade', null);

  console.log(`\n非 is_virtual_trade 的记录数: ${nonVirtCount || 0}`);
})();
