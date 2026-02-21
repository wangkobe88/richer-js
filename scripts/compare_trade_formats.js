const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取回测实验的交易数据
  const { data: backtestTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '01d0bbbb-c5c2-4c93-970c-5f5b49cf0e74')
    .order('created_at', { ascending: false })
    .limit(3);

  // 获取虚拟交易实验的交易数据
  const { data: virtTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('=== 回测交易数据格式 (01d0bbbb...) ===\n');
  if (backtestTrades && backtestTrades.length > 0) {
    const t = backtestTrades[0];
    console.log('字段列表:', Object.keys(t).join(', '));
    console.log('\n示例:');
    console.log(`代币: ${t.token_symbol} (${t.token_address})`);
    console.log(`方向: ${t.trade_direction}`);
    console.log(`输入: ${t.input_currency} ${t.input_amount}`);
    console.log(`输出: ${t.output_currency} ${t.output_amount}`);
    console.log(`单价: ${t.unit_price}`);
    console.log(`成功: ${t.success}`);
    console.log(`虚拟交易: ${t.is_virtual_trade}`);
    console.log(`创建时间: ${t.created_at}`);
    console.log(`执行时间: ${t.executed_at}`);
    console.log(`信号ID: ${t.signal_id}`);
    console.log(`metadata:`, JSON.stringify(t.metadata, null, 2).substring(0, 300));
  }

  console.log('\n\n=== 虚拟交易数据格式 (0c616581...) ===\n');
  if (virtTrades && virtTrades.length > 0) {
    const t = virtTrades[0];
    console.log('字段列表:', Object.keys(t).join(', '));
    console.log('\n示例:');
    console.log(`代币: ${t.token_symbol} (${t.token_address})`);
    console.log(`方向: ${t.trade_direction}`);
    console.log(`输入: ${t.input_currency} ${t.input_amount}`);
    console.log(`输出: ${t.output_currency} ${t.output_amount}`);
    console.log(`单价: ${t.unit_price}`);
    console.log(`成功: ${t.success}`);
    console.log(`虚拟交易: ${t.is_virtual_trade}`);
    console.log(`创建时间: ${t.created_at}`);
    console.log(`执行时间: ${t.executed_at}`);
    console.log(`信号ID: ${t.signal_id}`);
    console.log(`metadata:`, JSON.stringify(t.metadata, null, 2).substring(0, 300));
  }

  // 比较字段
  console.log('\n\n=== 字段对比 ===\n');
  if (backtestTrades && backtestTrades.length > 0 && virtTrades && virtTrades.length > 0) {
    const btFields = new Set(Object.keys(backtestTrades[0]));
    const vtFields = new Set(Object.keys(virtTrades[0]));

    console.log('回测独有字段:', [...btFields].filter(f => !vtFields.has(f)).join(', ') || '无');
    console.log('虚拟独有字段:', [...vtFields].filter(f => !btFields.has(f)).join(', ') || '无');
    console.log('共同字段:', [...btFields].filter(f => vtFields.has(f)).join(', '));
  }
})();
