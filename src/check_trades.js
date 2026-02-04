const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkTradeMetadata() {
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '325b8cd5-c1a9-4f28-95ac-3eabd16b6eaa')
    .order('created_at', { ascending: true });

  console.log('=== 交易元数据分析 ===');

  const uniqueTokens = new Set();
  trades?.forEach((t, i) => {
    if (!uniqueTokens.has(t.token_address)) {
      uniqueTokens.add(t.token_address);
      console.log(`${i + 1}. ${t.token_symbol} | direction=${t.trade_direction} | success=${t.success}`);
      console.log(`   metadata:`, JSON.stringify(t.metadata, null, 2));
      console.log('---');
    }
  });

  // 统计每个代币的交易次数
  const tokenTradeCount = {};
  trades?.forEach(t => {
    tokenTradeCount[t.token_symbol] = (tokenTradeCount[t.token_symbol] || 0) + 1;
  });

  console.log('\n=== 每个代币的交易次数 ===');
  for (const [symbol, count] of Object.entries(tokenTradeCount)) {
    console.log(`${symbol}: ${count}次`);
  }
}

checkTradeMetadata();
