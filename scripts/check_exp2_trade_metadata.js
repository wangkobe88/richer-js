/**
 * 检查实验2中那14个代币的 trades metadata
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查实验2 trades 的 metadata ===\n');

  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取那14个代币的第一个 buy trade
  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  for (const symbol of onlyInExp2Symbols.slice(0, 3)) { // 先检查前3个
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('experiment_id', exp2Id)
      .eq('token_symbol', symbol)
      .eq('trade_direction', 'buy')
      .order('executed_at', { ascending: true })
      .limit(1);

    if (trades && trades.length > 0) {
      const trade = trades[0];
      console.log(`${symbol}:`);
      console.log(`  token_address: ${trade.token_address}`);
      console.log(`  executed_at: ${trade.executed_at}`);
      console.log(`  signal_id: ${trade.signal_id}`);

      // 检查 metadata
      if (trade.metadata) {
        console.log(`  metadata keys: ${Object.keys(trade.metadata).join(', ')}`);

        // 检查是否有数据源信息
        if (trade.metadata.data_source) {
          console.log(`  data_source: ${trade.metadata.data_source}`);
        }
        if (trade.metadata.snapshot_id) {
          console.log(`  snapshot_id: ${trade.metadata.snapshot_id}`);
        }
        if (trade.metadata.source_experiment_id) {
          console.log(`  source_experiment_id: ${trade.metadata.source_experiment_id}`);
        }
      }
      console.log('');
    }
  }

  // 检查 signals 表中这些代币的数据
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查 signals 表中的数据】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', exp2Id)
    .eq('token_symbol', onlyInExp2Symbols[0])
    .eq('action', 'buy')
    .eq('executed', true)
    .limit(1);

  if (signals && signals.length > 0) {
    const signal = signals[0];
    console.log(`示例信号 (${signal.token_symbol}):`);
    console.log(`  token_address: ${signal.token_address}`);
    console.log(`  metadata keys: ${Object.keys(signal.metadata || {}).join(', ')}`);

    if (signal.metadata?.sourceData) {
      console.log(`  sourceData keys: ${Object.keys(signal.metadata.sourceData).join(', ')}`);
    }
  }
}

main().catch(console.error);
