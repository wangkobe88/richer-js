const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTradesPnL() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96'; // 旧实验（修复前）
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384'; // 新实验（修复后）

  // 获取新实验中 70%-85% 区间的代币地址
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', newExpId);

  const signalsIn70to85 = newSignals.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return ratio >= 0.7 && ratio <= 0.85;
  });

  // 创建一个 map 来查找新实验中的数据
  const newSignalMap = new Map();
  signalsIn70to85.forEach(s => {
    newSignalMap.set(s.token_address, {
      symbol: s.token_symbol,
      sellRatio: s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio,
      whaleCount: s.metadata?.preBuyCheckFactors?.earlyWhaleCount
    });
  });

  const tokenAddresses = Array.from(newSignalMap.keys());

  console.log('=== 旧实验中这些代币的交易结果 ===\n');
  console.log('代币数量:', tokenAddresses.length);
  console.log('');

  // 获取旧实验中这些代币的交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', oldExpId)
    .in('token_address', tokenAddresses);

  if (!trades || trades.length === 0) {
    console.log('❌ 旧实验中没有这些代币的交易记录');
    return;
  }

  console.log('找到', trades.length, '笔交易\n');

  // 统计盈亏
  let totalPnL = 0;
  let totalPnLPercent = 0;
  let winCount = 0;
  let lossCount = 0;
  let avgPnLPercent = 0;

  trades.forEach(t => {
    const pnl = t.pnl || 0;
    const pnlPercent = t.pnl_percent || 0;
    totalPnL += pnl;
    totalPnLPercent += pnlPercent;

    if (pnl > 0) winCount++;
    else if (pnl < 0) lossCount++;

    const newSignalData = newSignalMap.get(t.token_address);
    const symbol = t.token_symbol || newSignalData?.symbol || t.token_address?.substring(0, 10);

    console.log(`${symbol}:`);
    console.log(`  买入价格: ${t.buy_price}`);
    console.log(`  卖出价格: ${t.sell_price || '未卖出'}`);
    console.log(`  盈亏: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(1)}%)`);
    console.log(`  新实验中 SellRatio: ${newSignalData?.sellRatio ? (newSignalData.sellRatio * 100).toFixed(1) + '%' : '未知'}`);
    console.log('');
  });

  avgPnLPercent = totalPnLPercent / trades.length;

  console.log('=== 汇总 ===\n');
  console.log(`总盈亏: ${totalPnL.toFixed(2)} USDT`);
  console.log(`平均回报率: ${avgPnLPercent.toFixed(1)}%`);
  console.log(`盈利: ${winCount} 个`);
  console.log(`亏损: ${lossCount} 个`);
  console.log(`胜率: ${((winCount / trades.length) * 100).toFixed(1)}%`);
  console.log('');

  // 对比：这些代币如果在新实验中会被拒绝，但是旧实验买了它们
  console.log('=== 结论 ===\n');
  console.log(`如果阈值调整为 0.85，这 ${trades.length} 个代币会被新实验购买`);
  console.log(`但它们在旧实验中的总盈亏是 ${totalPnL.toFixed(2)} USDT`);
  console.log(`平均回报率是 ${avgPnLPercent.toFixed(1)}%`);
  console.log('');
  
  if (totalPnL > 0) {
    console.log('⚠️  这些代币在旧实验中是盈利的！');
    console.log('   调整阈值到 0.85 可能会改善回测结果');
  } else {
    console.log('✅ 这些代币在旧实验中是亏损的');
    console.log('   当前阈值 0.7 是合理的，能够过滤掉这些代币');
  }
}

analyzeTradesPnL().catch(console.error);
