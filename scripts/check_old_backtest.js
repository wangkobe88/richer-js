const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 检查旧回测实验的交易数据
  const { data: btTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '01d0bbbb-c5c2-4c93-970c-5f5b49cf0e74')
    .limit(3);

  // 检查虚拟交易实验的数据
  const { data: vtTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .limit(3);

  console.log('=== 回测交易数据 (01d0bbbb...) ===\n');
  if (btTrades && btTrades.length > 0) {
    console.log('字段:', Object.keys(btTrades[0]).join(', '));
    console.log('\n示例:');
    const t = btTrades[0];
    console.log(`  ${t.token_symbol} ${t.trade_direction}`);
    console.log(`  ${t.input_currency} ${t.input_amount} → ${t.output_currency} ${t.output_amount}`);
    console.log(`  is_virtual_trade: ${t.is_virtual_trade}`);
    console.log(`  created_at: ${t.created_at}`);
    console.log(`  signal_id: ${t.signal_id}`);
  } else {
    console.log('没有数据');
  }

  console.log('\n\n=== 虚拟交易数据 (0c616581...) ===\n');
  if (vtTrades && vtTrades.length > 0) {
    console.log('字段:', Object.keys(vtTrades[0]).join(', '));
    console.log('\n示例:');
    const t = vtTrades[0];
    console.log(`  ${t.token_symbol} ${t.trade_direction}`);
    console.log(`  ${t.input_currency} ${t.input_amount} → ${t.output_currency} ${t.output_amount}`);
    console.log(`  is_virtual_trade: ${t.is_virtual_trade}`);
    console.log(`  created_at: ${t.created_at}`);
    console.log(`  signal_id: ${t.signal_id}`);
  } else {
    console.log('没有数据');
  }

  // 比较字段
  if (btTrades && btTrades.length > 0 && vtTrades && vtTrades.length > 0) {
    const btFields = new Set(Object.keys(btTrades[0]));
    const vtFields = new Set(Object.keys(vtTrades[0]));

    const btOnly = [...btFields].filter(f => !vtFields.has(f));
    const vtOnly = [...vtFields].filter(f => !btFields.has(f));
    const common = [...btFields].filter(f => vtFields.has(f));

    console.log('\n\n=== 字段对比 ===\n');
    console.log('回测独有:', btOnly.length > 0 ? btOnly.join(', ') : '无');
    console.log('虚拟独有:', vtOnly.length > 0 ? vtOnly.join(', ') : '无');
    console.log('共同字段:', common.join(', '));
  }
})();
