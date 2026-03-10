const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTradeStatus() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  // 获取新实验中 70%-85% 区间的代币地址
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', newExpId);

  const signalsIn70to85 = newSignals.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return ratio >= 0.7 && ratio <= 0.85;
  });

  const tokenAddresses = signalsIn70to85.map(s => s.token_address);

  // 检查旧实验中这些代币的交易详情
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', oldExpId)
    .in('token_address', tokenAddresses);

  if (!trades || trades.length === 0) {
    console.log('没有交易记录');
    return;
  }

  console.log('=== 交易状态详情 ===\n');

  trades.forEach(t => {
    const symbol = t.token_symbol || t.token_address?.substring(0, 10);
    console.log(`${symbol}:`);
    console.log('  status:', t.status);
    console.log('  buy_price:', t.buy_price);
    console.log('  sell_price:', t.sell_price);
    console.log('  pnl:', t.pnl);
    console.log('  pnl_percent:', t.pnl_percent);
    console.log('  bought_at:', t.bought_at);
    console.log('  sold_at:', t.sold_at);
    console.log('');
  });
}

checkTradeStatus().catch(console.error);
