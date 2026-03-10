/**
 * 从trades表获取实际收益率并测试洗单检测
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

async function analyzeWithActualReturns() {
  const experimentId = '123481dc-2961-4ba1-aeea-aea80cc59bf2';

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  console.log(`总交易数: ${trades?.length || 0}`);

  // 按代币统计买入和卖出
  const tokenTrades = {};
  trades?.forEach(t => {
    const addr = t.token_address;
    if (!tokenTrades[addr]) {
      tokenTrades[addr] = { buy: null, sell: [], signals: [] };
    }
    if (t.trade_direction === 'buy') {
      tokenTrades[addr].buy = t;
    } else {
      tokenTrades[addr].sell.push(t);
    }
  });

  // 获取信号信息（获取代币名称）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  signals?.forEach(s => {
    if (tokenTrades[s.token_address]) {
      tokenTrades[s.token_address].symbol = s.metadata?.symbol;
    }
  });

  // 计算每个代币的收益率
  const tokenReturns = [];
  for (const [addr, data] of Object.entries(tokenTrades)) {
    if (!data.buy) continue;

    const symbol = data.symbol || addr.substring(0, 8);

    // 从买入交易中获取买入金额
    const buyTrade = data.buy;
    const buyAmount = buyTrade.metadata?.cardPositionChange?.[0]?.from || 0;

    // 累加所有卖出的金额
    let totalSellAmount = 0;
    data.sell.forEach(sellTrade => {
      const sellAmount = sellTrade.metadata?.cardPositionChange?.[0]?.to || 0;
      totalSellAmount += sellAmount;
    });

    const profitPercent = buyAmount > 0 ? ((totalSellAmount - buyAmount) / buyAmount * 100) : 0;

    tokenReturns.push({
      address: addr,
      symbol: symbol,
      buyAmount,
      totalSellAmount,
      profitPercent,
      hasSell: data.sell.length > 0
    });
  }

  console.log('\n代币收益率（前20个）：');
  tokenReturns.slice(0, 20).forEach(r => {
    const sellStatus = r.hasSell ? '已卖出' : '未卖出';
    console.log(`${r.symbol.padEnd(12)} ${r.profitPercent.toFixed(1).padStart(7)}% ${sellStatus}`);
  });

  // 统计盈利和亏损
  const profitable = tokenReturns.filter(r => r.profitPercent > 0);
  const loss = tokenReturns.filter(r => r.profitPercent <= 0);

  console.log(`\n盈利代币: ${profitable.length}个`);
  console.log(`亏损代币: ${loss.length}个`);

  return tokenReturns;
}

analyzeWithActualReturns().catch(console.error);
