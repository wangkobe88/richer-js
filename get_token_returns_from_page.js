/**
 * 从页面获取代币收益率并测试洗单检测
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function getTokenReturns() {
  // 获取所有买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', '123481dc-2961-4ba1-aeea-aea80cc59bf2')
    .eq('action', 'buy')
    .order('created_at', { ascending: false });

  const executedSignals = signals.filter(s => s.metadata?.execution_status === 'executed');

  // 去重
  const uniqueTokens = [];
  const seenAddresses = new Set();
  for (const signal of executedSignals) {
    if (!seenAddresses.has(signal.token_address)) {
      seenAddresses.add(signal.token_address);
      uniqueTokens.push(signal);
    }
  }

  console.log('代币地址,代币名称,总买入额,总卖出额,收益率%');

  for (const token of uniqueTokens) {
    const symbol = token.metadata?.symbol || token.token_address.substring(0, 8);
    const factors = token.metadata?.preBuyCheckFactors;

    console.log(`${token.token_address},${symbol},${factors?.earlyTradesVolume || 0},0,0`);
  }
}

getTokenReturns().catch(console.error);
