/**
 * 检查trades数据的完整性
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查实验 4c265a5b 的 trades 数据 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 1. 获取所有trades
  const { data: trades, count } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .order('executed_at', { ascending: true });

  console.log(`总 trades 数: ${count}`);
  console.log(`buy trades: ${trades?.filter(t => t.trade_direction === 'buy').length}`);
  console.log(`sell trades: ${trades?.filter(t => t.trade_direction === 'sell').length}`);

  // 2. 按代币统计
  const tokenStats = {};
  for (const t of trades || []) {
    if (!tokenStats[t.token_address]) {
      tokenStats[t.token_address] = { symbol: t.token_symbol, buys: 0, sells: 0 };
    }
    if (t.trade_direction === 'buy') tokenStats[t.token_address].buys++;
    else tokenStats[t.token_address].sells++;
  }

  const noSells = Object.entries(tokenStats).filter(([_, s]) => s.sells === 0);
  const withSells = Object.entries(tokenStats).filter(([_, s]) => s.sells > 0);

  console.log(`\n有卖出的代币: ${withSells.length}`);
  console.log(`没有卖出的代币: ${noSells.length}`);

  // 3. 查看有卖出的代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【有卖出的代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const [addr, stat] of withSells.slice(0, 15)) {
    const tokenTrades = trades.filter(t => t.token_address === addr);
    const buys = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sells = tokenTrades.filter(t => t.trade_direction === 'sell');

    const totalIn = buys.reduce((sum, t) => sum + parseFloat(t.output_amount || 0), 0);
    const totalOut = sells.reduce((sum, t) => sum + parseFloat(t.output_amount || 0), 0);
    const profit = totalIn > 0 ? ((totalOut - totalIn) / totalIn * 100) : 0;

    console.log(`${stat.symbol}: ${stat.buys} buys, ${stat.sells} sells, 收益: ${profit.toFixed(2)}%`);
  }

  // 4. 使用 stats 表的统计数据
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【从 experiments 表获取统计数据】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp } = await supabase
    .from('experiments')
    .select('stats')
    .eq('id', expId)
    .single();

  console.log(JSON.stringify(exp?.stats, null, 2));
}

main().catch(console.error);
