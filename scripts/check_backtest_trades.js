const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 查找有交易数据的回测实验
  const { data: trades, error } = await supabase
    .from('trades')
    .select('experiment_id, experiment_id!inner(experiment_name, trading_mode)')
    .eq('experiment_id.trading_mode', 'backtest')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log('查询失败:', error.message);
    return;
  }

  console.log('=== 回测实验的交易数据 ===\n');

  if (!trades || trades.length === 0) {
    console.log('没有找到回测实验的交易数据');
    return;
  }

  // 按实验分组
  const byExp = new Map();
  for (const t of trades) {
    const expId = t.experiment_id.id;
    if (!byExp.has(expId)) {
      byExp.set(expId, {
        id: expId,
        name: t.experiment_id.experiment_name,
        trades: []
      });
    }
    byExp.get(expId).trades.push(t);
  }

  for (const [expId, data] of byExp) {
    console.log(`\n实验: ${data.name} (${expId.substring(0, 8)}...)`);
    console.log(`交易数量: ${data.trades.length}`);

    // 显示第一条交易的字段
    const firstTrade = data.trades[0];
    console.log(`\n字段列表: ${Object.keys(firstTrade).join(', ')}`);

    // 显示前3条交易
    console.log('\n前3条交易:');
    for (let i = 0; i < Math.min(3, data.trades.length); i++) {
      const t = data.trades[i];
      console.log(`\n  [${i+1}] ${t.token_symbol} - ${t.trade_direction}`);
      console.log(`      输入: ${t.input_currency} ${t.input_amount} → 输出: ${t.output_currency} ${t.output_amount}`);
      console.log(`      单价: ${t.unit_price} | 状态: ${t.trade_status} | 成功: ${t.success}`);
      console.log(`      创建时间: ${t.created_at}`);
      if (t.metadata && Object.keys(t.metadata).length > 0) {
        console.log(`      metadata keys: ${Object.keys(t.metadata).join(', ')}`);
      }
    }
  }

  // 对比虚拟交易的字段
  console.log('\n\n=== 对比虚拟交易数据格式 ===\n');
  
  const { data: virtTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('is_virtual_trade', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (virtTrades && virtTrades.length > 0) {
    const vt = virtTrades[0];
    console.log('虚拟交易字段列表:');
    console.log(Object.keys(vt).join(', '));
    console.log(`\n示例: ${vt.token_symbol} - ${vt.trade_direction}`);
    console.log(`输入: ${vt.input_currency} ${vt.input_amount} → 输出: ${vt.output_currency} ${vt.output_amount}`);
  }
})();
