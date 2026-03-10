/**
 * 分析被过滤掉的代币
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeFilteredTokens() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  // 获取旧实验的交易收益
  const { data: oldTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('experiment_id', oldExpId)
    .eq('trade_direction', 'sell');

  const oldTokenProfits = {};
  oldTrades.forEach(t => {
    oldTokenProfits[t.token_address] = t.metadata?.profitPercent;
  });

  // 获取旧实验的信号
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', oldExpId);

  const oldExecutedTokens = new Set();
  oldSignals.forEach(s => {
    if (s.metadata?.execution_status === 'executed') {
      oldExecutedTokens.add(s.token_address);
    }
  });

  // 获取新实验的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', newExpId);

  const newExecutedTokens = new Set();
  newSignals.forEach(s => {
    if (s.metadata?.execution_status === 'executed') {
      newExecutedTokens.add(s.token_address);
    }
  });

  // 找出被过滤的代币
  const filteredTokens = Array.from(oldExecutedTokens).filter(token => !newExecutedTokens.has(token));

  console.log('=== 被过滤掉的代币分析 ===\n');
  console.log('旧实验执行但新实验未执行的代币数量:', filteredTokens.length);
  console.log('');

  const filteredWithProfit = filteredTokens.map(token => ({
    token,
    profit: oldTokenProfits[token]
  })).filter(t => t.profit !== undefined);

  // 按收益排序
  filteredWithProfit.sort((a, b) => b.profit - a.profit);

  const profitCount = filteredWithProfit.filter(t => t.profit > 0).length;
  const lossCount = filteredWithProfit.filter(t => t.profit <= 0).length;
  const totalProfit = filteredWithProfit.reduce((a, b) => a + b.profit, 0);

  console.log('统计:');
  console.log('  盈利代币:', profitCount, '个');
  console.log('  亏损代币:', lossCount, '个');
  console.log('  总收益:', totalProfit.toFixed(1) + '%');
  console.log('');

  console.log('=== 被过滤掉的盈利代币（误杀）===');
  const falsePositives = filteredWithProfit.filter(t => t.profit > 0);
  if (falsePositives.length > 0) {
    const fpTotalProfit = falsePositives.reduce((a, b) => a + b.profit, 0);
    console.log('数量:', falsePositives.length, '个');
    console.log('总收益:', fpTotalProfit.toFixed(1) + '%');
    console.log('平均收益:', (fpTotalProfit / falsePositives.length).toFixed(1) + '%');
    console.log('');
    console.log('代币列表:');
    falsePositives.forEach(t => {
      console.log(`  ${t.token}: +${t.profit.toFixed(1)}%`);
    });
  } else {
    console.log('无');
  }

  console.log('');
  console.log('=== 被过滤掉的亏损代币（正确过滤）===');
  const truePositives = filteredWithProfit.filter(t => t.profit <= 0);
  if (truePositives.length > 0) {
    const tpTotalLoss = truePositives.reduce((a, b) => a + b.profit, 0);
    console.log('数量:', truePositives.length, '个');
    console.log('总亏损:', tpTotalLoss.toFixed(1) + '%');
    console.log('平均亏损:', (tpTotalLoss / truePositives.length).toFixed(1) + '%');
    console.log('');
    console.log('代币列表:');
    truePositives.forEach(t => {
      console.log(`  ${t.token}: ${t.profit.toFixed(1)}%`);
    });
  } else {
    console.log('无');
  }

  console.log('');
  console.log('=== 结论 ===');
  if (falsePositives.length > 0 && truePositives.length > 0) {
    const ratio = falsePositives.length / (falsePositives.length + truePositives.length);
    console.log('误杀率:', (ratio * 100).toFixed(1) + '%');
    console.log('');
    if (ratio > 0.5) {
      console.log('⚠️  过滤条件误杀了较多盈利代币，需要优化');
    } else {
      console.log('✓ 过滤条件正确过滤了更多亏损代币');
    }
  }
}

analyzeFilteredTokens().catch(console.error);
