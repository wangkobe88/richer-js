const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 检查最新的回测实验
  const { data: exps, error: expError } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode, status')
    .eq('trading_mode', 'backtest')
    .order('created_at', { ascending: false })
    .limit(3);

  if (expError) {
    console.log('查询实验失败:', expError.message);
    return;
  }

  console.log('=== 最近3个回测实验 ===\n');
  for (const exp of exps) {
    console.log(`ID: ${exp.id.substring(0, 8)}... | 名称: ${exp.experiment_name} | 状态: ${exp.status}`);
  }

  // 检查最新回测实验的交易数据
  const latestBacktest = exps[0];
  if (!latestBacktest) {
    console.log('\n没有回测实验');
    return;
  }

  console.log(`\n=== 检查实验 ${latestBacktest.id.substring(0, 8)}... 的交易数据 ===\n`);

  // 获取交易数量
  const { count: tradeCount, error: countError } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', latestBacktest.id);

  if (countError) {
    console.log('交易数量查询失败:', countError.message);
  } else {
    console.log(`交易数量: ${tradeCount || 0}`);
  }

  // 获取几条示例交易数据
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', latestBacktest.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (tradesError) {
    console.log('\n交易数据查询失败:', tradesError.message);
  } else if (trades && trades.length > 0) {
    console.log('\n示例交易数据:');
    for (const trade of trades) {
      console.log(`\n--- ${trade.id.substring(0, 8)}... ---`);
      console.log(`代币: ${trade.token_symbol} (${trade.token_address})`);
      console.log(`方向: ${trade.trade_direction}`);
      console.log(`输入: ${trade.input_currency} ${trade.input_amount}`);
      console.log(`输出: ${trade.output_currency} ${trade.output_amount}`);
      console.log(`单价: ${trade.unit_price}`);
      console.log(`状态: ${trade.trade_status} | 成功: ${trade.success}`);
      console.log(`创建时间: ${trade.created_at}`);
      console.log(`metadata:`, JSON.stringify(trade.metadata, null, 2).substring(0, 200) + '...');
    }
  } else {
    console.log('\n没有交易数据');
  }

  // 对比虚拟交易的数据格式
  console.log('\n\n=== 对比虚拟交易数据格式 ===\n');
  
  const { data: virtExps, error: virtError } = await supabase
    .from('experiments')
    .select('id')
    .eq('trading_mode', 'virtual')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!virtError && virtExps && virtExps.length > 0) {
    const virtExpId = virtExps[0].id;
    const { data: virtTrades, error: virtTradesError } = await supabase
      .from('trades')
      .select('*')
      .eq('experiment_id', virtExpId)
      .order('created_at', { ascending: false })
      .limit(2);

    if (!virtTradesError && virtTrades && virtTrades.length > 0) {
      console.log('虚拟交易示例:');
      for (const trade of virtTrades) {
        console.log(`\n--- ${trade.id.substring(0, 8)}... ---`);
        console.log(`代币: ${trade.token_symbol}`);
        console.log(`方向: ${trade.trade_direction}`);
        console.log(`输入: ${trade.input_currency} ${trade.input_amount}`);
        console.log(`输出: ${trade.output_currency} ${trade.output_amount}`);
        console.log(`字段:`, Object.keys(trade).join(', '));
      }
    }
  }
})();
