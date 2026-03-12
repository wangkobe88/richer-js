/**
 * 修正后的实验2 trades 查询
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 查询实验2的 trades ===\n');

  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取实验2的所有 trades
  const { data: exp2Trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', exp2Id)
    .order('executed_at', { ascending: true });

  console.log(`实验2共有 ${exp2Trades?.length || 0} trades\n`);

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币的首次买入时间】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const tokenFirstBuy = {};

  for (const symbol of onlyInExp2Symbols) {
    const tokenBuyTrades = exp2Trades?.filter(t => t.token_symbol === symbol && t.trade_direction === 'buy') || [];
    if (tokenBuyTrades.length > 0) {
      tokenBuyTrades.sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));
      tokenFirstBuy[symbol] = tokenBuyTrades[0];
      const time = new Date(tokenBuyTrades[0].executed_at);
      console.log(`${symbol}: ${time.toLocaleString('zh-CN')}`);
    } else {
      console.log(`${symbol}: 无买入记录`);
    }
  }

  // 检查实验1的 trades
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验1中是否有这些代币的 trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Id = '209a7796-f955-4d7a-ae21-0902fef3d7cc';

  const { data: exp1Trades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', exp1Id);

  const exp1Addresses = new Set(exp1Trades?.map(t => t.token_address) || []);

  let inExp1Count = 0;
  let notInExp1Count = 0;

  for (const [symbol, trade] of Object.entries(tokenFirstBuy)) {
    const inExp1 = exp1Addresses.has(trade.token_address);
    if (inExp1) {
      inExp1Count++;
      console.log(`${symbol}: 在实验1中`);
    } else {
      notInExp1Count++;
      console.log(`${symbol}: 不在实验1中`);
    }
  }

  console.log(`\n在实验1中: ${inExp1Count} 个，不在实验1中: ${notInExp1Count} 个`);

  // 检查实验1和实验2的 trades 时间范围
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【两个实验的 trades 时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (exp1Trades && exp1Trades.length > 0) {
    const { data: exp1TradesWithTime } = await supabase
      .from('trades')
      .select('executed_at')
      .eq('experiment_id', exp1Id)
      .order('executed_at', { ascending: true });

    const times1 = exp1TradesWithTime?.map(t => new Date(t.executed_at).getTime()) || [];
    console.log(`实验1: ${new Date(Math.min(...times1)).toLocaleString('zh-CN')} - ${new Date(Math.max(...times1)).toLocaleString('zh-CN')}`);
  }

  if (exp2Trades && exp2Trades.length > 0) {
    const times2 = exp2Trades.map(t => new Date(t.executed_at).getTime());
    console.log(`实验2: ${new Date(Math.min(...times2)).toLocaleString('zh-CN')} - ${new Date(Math.max(...times2)).toLocaleString('zh-CN')}`);
  }
}

main().catch(console.error);
