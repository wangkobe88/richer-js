/**
 * 检查实验2中那14个代币是什么时候被添加的
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查实验2中的代币添加时间 ===\n');

  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取实验2的 trades 来找出实际交易的代币地址
  const { data: exp2Trades } = await supabase
    .from('trades')
    .select('token_symbol, token_address, timestamp, direction')
    .eq('experiment_id', exp2Id)
    .eq('direction', 'buy');

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2中这14个代币的首次买入时间】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2Symbols) {
    const tokenTrades = exp2Trades?.filter(t => t.token_symbol === symbol) || [];
    if (tokenTrades.length > 0) {
      tokenTrades.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstTrade = tokenTrades[0];
      console.log(`${symbol} (${firstTrade.token_address.slice(0, 10)}...)`);
      console.log(`  首次买入: ${new Date(firstTrade.timestamp).toLocaleString('zh-CN')}`);
      console.log('');
    }
  }

  // 检查这些代币是否在实验2的 experiment_tokens 表中
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查这些代币是否在实验2的 experiment_tokens 中】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp2Tokens } = await supabase
    .from('experiment_tokens')
    .select('token_symbol, token_address')
    .eq('experiment_id', exp2Id);

  const exp2TokenSymbols = [...new Set(exp2Tokens?.map(t => t.token_symbol) || [])];

  for (const symbol of onlyInExp2Symbols) {
    const inExp2Tokens = exp2TokenSymbols.includes(symbol);
    console.log(`${symbol}: ${inExp2Tokens ? '在 experiment_tokens 中' : '不在 experiment_tokens 中'}`);
  }

  // 检查实验1的 experiment_tokens
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验1的 experiment_tokens】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Id = '209a7796-f955-4d7a-ae21-0902fef3d7cc';

  const { data: exp1Tokens, count: exp1Count } = await supabase
    .from('experiment_tokens')
    .select('token_symbol', { count: 'exact' })
    .eq('experiment_id', exp1Id);

  console.log(`实验1的 experiment_tokens 数量: ${exp1Count || 0}`);

  const { count: exp2Count } = await supabase
    .from('experiment_tokens')
    .select('token_symbol', { count: 'exact' })
    .eq('experiment_id', exp2Id);

  console.log(`实验2的 experiment_tokens 数量: ${exp2Count || 0}`);
}

main().catch(console.error);
