/**
 * 检查代币收益
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkProfit() {
  const experimentId = 'c1e8e687-791f-455d-8a57-9f564c0a835f';
  const tokenAddress = '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444';

  // 获取代币信息
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  const symbol = signal?.metadata?.symbol || tokenAddress.substring(0, 8);

  // 获取卖出交易
  const { data: sellTrade } = await supabase
    .from('trades')
    .select('metadata')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .eq('trade_direction', 'sell')
    .maybeSingle();

  const profit = sellTrade?.metadata?.profitPercent;
  console.log(`代币: ${symbol}`);
  console.log(`收益率: ${profit !== null && profit !== undefined ? profit.toFixed(1) + '%' : '无数据'}`);
  console.log(`代币地址: ${tokenAddress}`);
}

checkProfit().catch(console.error);
