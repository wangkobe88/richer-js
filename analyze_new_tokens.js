/**
 * 分析新实验中新增的代币
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeNewTokens() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  // 获取新实验的交易收益
  const { data: newTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('experiment_id', newExpId)
    .eq('trade_direction', 'sell');

  const newTokenProfits = {};
  newTrades.forEach(t => {
    newTokenProfits[t.token_address] = t.metadata?.profitPercent;
  });

  // 获取旧实验执行的代币
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const oldExecutedTokens = new Set();
  oldSignals.forEach(s => {
    // 需要从 trades 表判断是否执行，这里简化处理
  });

  // 获取旧实验的交易
  const { data: oldTrades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', oldExpId)
    .eq('trade_direction', 'sell');

  oldTrades.forEach(t => {
    oldExecutedTokens.add(t.token_address);
  });

  // 新实验执行的代币
  const newExecutedTokens = new Set(Object.keys(newTokenProfits));

  // 找出新增的代币
  const addedTokens = Array.from(newExecutedTokens).filter(token => !oldExecutedTokens.has(token));

  console.log('=== 新实验中新增的代币分析 ===\n');
  console.log('新实验执行但旧实验未执行的代币数量:', addedTokens.length);
  console.log('');

  const addedWithProfit = addedTokens.map(token => ({
    token,
    profit: newTokenProfits[token]
  })).filter(t => t.profit !== undefined);

  // 按收益排序
  addedWithProfit.sort((a, b) => b.profit - a.profit);

  const profitCount = addedWithProfit.filter(t => t.profit > 0).length;
  const lossCount = addedWithProfit.filter(t => t.profit <= 0).length;
  const totalProfit = addedWithProfit.reduce((a, b) => a + b.profit, 0);

  console.log('统计:');
  console.log('  盈利代币:', profitCount, '个');
  console.log('  亏损代币:', lossCount, '个');
  console.log('  总收益:', totalProfit.toFixed(1) + '%');
  console.log('');

  if (profitCount > 0) {
    const avgProfit = addedWithProfit.filter(t => t.profit > 0).reduce((a, b) => a + b.profit, 0) / profitCount;
    console.log('  平均盈利:', avgProfit.toFixed(1) + '%');
  }

  if (lossCount > 0) {
    const avgLoss = addedWithProfit.filter(t => t.profit <= 0).reduce((a, b) => a + b.profit, 0) / lossCount;
    console.log('  平均亏损:', avgLoss.toFixed(1) + '%');
  }

  console.log('');
  console.log('=== 新增的盈利代币 ===');
  addedWithProfit.filter(t => t.profit > 0).forEach(t => {
    console.log(`  ${t.token}: +${t.profit.toFixed(1)}%`);
  });

  console.log('');
  console.log('=== 新增的亏损代币 ===');
  addedWithProfit.filter(t => t.profit <= 0).forEach(t => {
    console.log(`  ${t.token}: ${t.profit.toFixed(1)}%`);
  });
}

analyzeNewTokens().catch(console.error);
