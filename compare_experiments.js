/**
 * 比较两个实验的效果
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareExperiments() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  const { data: newTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', newExpId)
    .eq('trade_direction', 'sell');

  const { data: oldTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', oldExpId)
    .eq('trade_direction', 'sell');

  console.log('=== 实验效果对比 ===\n');
  console.log('新实验（有过滤条件）:', newExpId);
  console.log('旧实验（无过滤条件）:', oldExpId);
  console.log('');

  const newProfits = newTrades.map(t => t.metadata?.profitPercent).filter(p => p !== undefined);
  const newProfitCount = newProfits.filter(p => p > 0).length;
  const newLossCount = newProfits.filter(p => p <= 0).length;
  const newAvgProfit = newProfits.filter(p => p > 0).reduce((a, b) => a + b, 0) / (newProfitCount || 1);
  const newAvgLoss = newProfits.filter(p => p <= 0).reduce((a, b) => a + b, 0) / (newLossCount || 1);
  const newTotalProfit = newProfits.reduce((a, b) => a + b, 0);

  console.log('=== 新实验（有过滤条件）===');
  console.log('总交易数:', newTrades.length);
  console.log('盈利:', newProfitCount, '笔');
  console.log('亏损:', newLossCount, '笔');
  console.log('胜率:', (newProfitCount / newTrades.length * 100).toFixed(1) + '%');
  console.log('平均盈利:', newAvgProfit.toFixed(1) + '%');
  console.log('平均亏损:', newAvgLoss.toFixed(1) + '%');
  console.log('总收益:', newTotalProfit.toFixed(1) + '%');
  console.log('');

  const oldProfits = oldTrades.map(t => t.metadata?.profitPercent).filter(p => p !== undefined);
  const oldProfitCount = oldProfits.filter(p => p > 0).length;
  const oldLossCount = oldProfits.filter(p => p <= 0).length;
  const oldAvgProfit = oldProfits.filter(p => p > 0).reduce((a, b) => a + b, 0) / (oldProfitCount || 1);
  const oldAvgLoss = oldProfits.filter(p => p <= 0).reduce((a, b) => a + b, 0) / (oldLossCount || 1);
  const oldTotalProfit = oldProfits.reduce((a, b) => a + b, 0);

  console.log('=== 旧实验（无过滤条件）===');
  console.log('总交易数:', oldTrades.length);
  console.log('盈利:', oldProfitCount, '笔');
  console.log('亏损:', oldLossCount, '笔');
  console.log('胜率:', (oldProfitCount / oldTrades.length * 100).toFixed(1) + '%');
  console.log('平均盈利:', oldAvgProfit.toFixed(1) + '%');
  console.log('平均亏损:', oldAvgLoss.toFixed(1) + '%');
  console.log('总收益:', oldTotalProfit.toFixed(1) + '%');
  console.log('');

  console.log('=== 对比结果 ===');
  const tradeDiff = newTrades.length - oldTrades.length;
  const profitDiff = newTotalProfit - oldTotalProfit;
  const winRateDiff = (newProfitCount / newTrades.length * 100) - (oldProfitCount / oldTrades.length * 100);

  console.log('交易数变化:', tradeDiff);
  console.log('总收益变化:', (profitDiff > 0 ? '+' : '') + profitDiff.toFixed(1) + '%');
  console.log('胜率变化:', (winRateDiff > 0 ? '+' : '') + winRateDiff.toFixed(1) + '%');

  if (newTotalProfit < oldTotalProfit) {
    console.log('\n⚠️  结论: 新实验的总收益更低');
  }
}

compareExperiments().catch(console.error);
