/**
 * 分析两个实验的 trades 时间
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 分析两个实验的 trades 时间 ===\n');

  const exp1Id = '209a7796-f955-4d7a-ae21-0902fef3d7cc';
  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';
  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 获取两个实验的 trades（包括 created_at 和 executed_at）
  const { data: exp1Trades } = await supabase
    .from('trades')
    .select('token_symbol, created_at, executed_at')
    .eq('experiment_id', exp1Id)
    .eq('trade_direction', 'buy')
    .order('executed_at', { ascending: true });

  const { data: exp2Trades } = await supabase
    .from('trades')
    .select('token_symbol, created_at, executed_at')
    .eq('experiment_id', exp2Id)
    .eq('trade_direction', 'buy')
    .order('executed_at', { ascending: true });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【时间对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (exp1Trades && exp1Trades.length > 0) {
    const times1 = exp1Trades.map(t => new Date(t.executed_at).getTime());
    console.log(`实验1 trades executed_at: ${new Date(Math.min(...times1)).toLocaleString('zh-CN')} - ${new Date(Math.max(...times1)).toLocaleString('zh-CN')}`);
  }

  if (exp2Trades && exp2Trades.length > 0) {
    const times2 = exp2Trades.map(t => new Date(t.executed_at).getTime());
    console.log(`实验2 trades executed_at: ${new Date(Math.min(...times2)).toLocaleString('zh-CN')} - ${new Date(Math.max(...times2)).toLocaleString('zh-CN')}`);
  }

  // 检查那14个代币的 trades executed_at 时间
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币在实验2中的 trades executed_at】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  for (const symbol of onlyInExp2Symbols.slice(0, 5)) {
    const tokenTrades = exp2Trades?.filter(t => t.token_symbol === symbol) || [];
    if (tokenTrades.length > 0) {
      const time = new Date(tokenTrades[0].executed_at);
      console.log(`${symbol}: ${time.toLocaleString('zh-CN')}`);
    }
  }

  // 关键检查：trades 的 executed_at 是否等于源实验 time_series_data 的 timestamp
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【关键检查】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 检查实验1的第一个 trade 和源实验 time_series_data 的关系
  if (exp1Trades && exp1Trades.length > 0) {
    const firstTradeTime = new Date(exp1Trades[0].executed_at);
    console.log(`实验1第一个 trade executed_at: ${firstTradeTime.toLocaleString('zh-CN')}`);

    // 查找源实验 time_series_data 中最接近这个时间的数据
    const { data: nearbyData } = await supabase
      .from('experiment_time_series_data')
      .select('token_symbol, timestamp')
      .eq('experiment_id', sourceId)
      .gte('timestamp', new Date(firstTradeTime.getTime() - 60000).toISOString())
      .lte('timestamp', new Date(firstTradeTime.getTime() + 60000).toISOString())
      .limit(5);

    console.log(`源实验 time_series_data 中附近的数据:`);
    if (nearbyData && nearbyData.length > 0) {
      nearbyData.forEach(d => {
        console.log(`  ${d.token_symbol} - ${new Date(d.timestamp).toLocaleString('zh-CN')}`);
      });
    } else {
      console.log('  无附近数据');
    }
  }
}

main().catch(console.error);
