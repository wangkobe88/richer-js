const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 检查特定回测实验的交易数据
  const experimentId = '9ff66c4e-3d95-4486-85fb-2c4a587ebcbc';

  console.log(`=== 检查实验 ${experimentId} ===\n`);

  // 检查实验信息
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (exp) {
    console.log('实验信息:');
    console.log(`名称: ${exp.experiment_name}`);
    console.log(`模式: ${exp.trading_mode}`);
    console.log(`状态: ${exp.status}`);
  }

  // 检查交易数据
  const { data: trades, count } = await supabase
    .from('trades')
    .select('*', { count: 'exact' })
    .eq('experiment_id', experimentId);

  console.log(`\n交易数量: ${count || 0}`);

  if (trades && trades.length > 0) {
    console.log('\n交易字段:', Object.keys(trades[0]).join(', '));

    console.log('\n前5条交易:');
    for (const t of trades.slice(0, 5)) {
      console.log(`\n  ${t.token_symbol} ${t.trade_direction}`);
      console.log(`    ${t.input_currency} ${t.input_amount} → ${t.output_currency} ${t.output_amount}`);
      console.log(`    单价: ${t.unit_price}`);
      console.log(`    创建时间: ${t.created_at}`);
      console.log(`    成功: ${t.success} | 状态: ${t.trade_status}`);
      if (t.metadata && Object.keys(t.metadata).length > 0) {
        console.log(`    metadata keys: ${Object.keys(t.metadata).join(', ')}`);
      }
    }
  }

  // 检查信号数据
  const { data: signals, count: sigCount } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact' })
    .eq('experiment_id', experimentId);

  console.log(`\n\n信号数量: ${sigCount || 0}`);

  if (signals && signals.length > 0) {
    console.log('\n信号字段:', Object.keys(signals[0]).join(', '));

    console.log('\n前3条信号:');
    for (const s of signals.slice(0, 3)) {
      console.log(`\n  ${s.token_symbol} ${s.action}`);
      console.log(`    执行: ${s.executed}`);
      console.log(`    创建时间: ${s.created_at}`);
      if (s.metadata && s.metadata.tradeResult) {
        console.log(`    tradeResult.success: ${s.metadata.tradeResult.success}`);
        console.log(`    tradeResult.tradeId: ${s.metadata.tradeResult.tradeId}`);
      }
    }
  }
})();
