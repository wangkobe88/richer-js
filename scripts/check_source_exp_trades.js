/**
 * 检查源实验中那14个代币的 trades
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验中那14个代币的 trades ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币在源实验的 trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2Symbols.slice(0, 5)) {
    const { data: trades } = await supabase
      .from('trades')
      .select('executed_at, trade_direction')
      .eq('experiment_id', sourceId)
      .eq('token_symbol', symbol)
      .order('executed_at', { ascending: true });

    if (trades && trades.length > 0) {
      const buys = trades.filter(t => t.trade_direction === 'buy');
      const firstBuy = buys[0];
      console.log(`${symbol}: ${trades.length} trades (${buys.length} buys), 首次买入: ${firstBuy ? new Date(firstBuy.executed_at).toLocaleString('zh-CN') : 'N/A'}`);
    } else {
      console.log(`${symbol}: 无 trades`);
    }
  }

  // 检查源实验的 trades 时间范围
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【源实验 trades 时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: allTrades } = await supabase
    .from('trades')
    .select('executed_at')
    .eq('experiment_id', sourceId)
    .order('executed_at', { ascending: true });

  if (allTrades && allTrades.length > 0) {
    const times = allTrades.map(t => new Date(t.executed_at).getTime());
    console.log(`源实验 trades: ${new Date(Math.min(...times)).toLocaleString('zh-CN')} - ${new Date(Math.max(...times)).toLocaleString('zh-CN')}`);
  }
}

main().catch(console.error);
