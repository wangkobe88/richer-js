/**
 * 分析回测实验中被过滤的信号
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeFilteredSignals() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  // 获取交易收益
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'sell');

  const profitMap = {};
  trades.forEach(t => {
    profitMap[t.token_address] = t.metadata?.profitPercent;
  });

  // 分析被过滤的信号
  const filteredSignals = signals.filter(s =>
    s.metadata?.execution_status === 'filtered' || s.metadata?.execution_status === 'failed'
  );

  console.log('=== 被过滤的信号分析 ===\n');
  console.log('总过滤信号:', filteredSignals.length);
  console.log('');

  // 按过滤原因分组
  const filteredByReason = {};
  filteredSignals.forEach(s => {
    const reason = s.metadata?.execution_reason || 'unknown';
    if (!filteredByReason[reason]) {
      filteredByReason[reason] = [];
    }
    filteredByReason[reason].push(s);
  });

  console.log('=== 过滤原因统计 ===');
  Object.keys(filteredByReason).sort((a, b) => filteredByReason[b].length - filteredByReason[a].length).forEach(reason => {
    console.log(`  ${reason}: ${filteredByReason[reason].length}个`);
  });

  // 显示前20个被过滤的信号
  console.log('');
  console.log('=== 被过滤的信号详情（前20个）===');
  filteredSignals.slice(0, 20).forEach(s => {
    const symbol = s.metadata?.symbol || s.token_address.substring(0, 8);
    const reason = s.metadata?.execution_reason || 'unknown';
    const factors = s.metadata?.preBuyCheckFactors;

    let whaleInfo = '无数据';
    if (factors?.earlyWhaleCount !== undefined) {
      whaleInfo = `大户数:${factors.earlyWhaleCount} 卖出率:${(factors.earlyWhaleSellRatio * 100).toFixed(0)}%`;
    }

    console.log(`  ${symbol.padEnd(12)} | ${reason.padEnd(40)} | ${whaleInfo}`);
  });

  // 检查是否有早期大户卖出率>70%的信号
  console.log('');
  console.log('=== 检查是否有早期大户卖出率>70%的信号 ===');

  const highSellRatioSignals = signals.filter(s => {
    const sellRatio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return sellRatio !== undefined && sellRatio > 0.7;
  });

  console.log(`早期大户卖出率>70%的信号: ${highSellRatioSignals.length}个`);

  if (highSellRatioSignals.length > 0) {
    console.log('\n这些信号的状态:');
    highSellRatioSignals.slice(0, 10).forEach(s => {
      const symbol = s.metadata?.symbol || s.token_address.substring(0, 8);
      const status = s.metadata?.execution_status || 'unknown';
      const factors = s.metadata?.preBuyCheckFactors;
      const sellRatio = (factors.earlyWhaleSellRatio * 100).toFixed(0);
      const profit = profitMap[s.token_address];
      const profitStr = profit !== undefined ? (profit > 0 ? '+' + profit.toFixed(1) + '%' : profit.toFixed(1) + '%') : 'N/A';

      console.log(`  ${symbol.padEnd(12)} | ${status.padStart(10)} | 卖出率:${sellRatio}% | ${profitStr}`);
    });
  }

  // 统计分析：早期大户因子的表现
  console.log('');
  console.log('=== 早期大户因子效果分析 ===');

  const executedWithWhale = signals.filter(s =>
    s.metadata?.execution_status === 'executed' &&
    s.metadata?.preBuyCheckFactors?.earlyWhaleCount !== undefined
  );

  const filteredWithWhale = signals.filter(s =>
    (s.metadata?.execution_status === 'filtered' || s.metadata?.execution_status === 'failed') &&
    s.metadata?.preBuyCheckFactors?.earlyWhaleCount !== undefined
  );

  console.log(`有早期大户数据的执行信号: ${executedWithWhale.length}个`);
  console.log(`有早期大户数据的过滤信号: ${filteredWithWhale.length}个`);

  if (executedWithWhale.length > 0) {
    const profitExecuted = executedWithWhale.filter(s => {
      const profit = profitMap[s.token_address];
      return profit !== undefined && profit > 0;
    });

    const lossExecuted = executedWithWhale.filter(s => {
      const profit = profitMap[s.token_address];
      return profit !== undefined && profit <= 0;
    });

    console.log('\n执行信号中:');
    console.log(`  盈利: ${profitExecuted.length}个`);
    console.log(`  亏损: ${lossExecuted.length}个`);

    if (profitExecuted.length > 0) {
      const avgSellRatio = profitExecuted.reduce((sum, s) =>
        sum + s.metadata.preBuyCheckFactors.earlyWhaleSellRatio, 0) / profitExecuted.length;
      console.log(`  盈利代币平均卖出率: ${(avgSellRatio * 100).toFixed(1)}%`);
    }

    if (lossExecuted.length > 0) {
      const avgSellRatio = lossExecuted.reduce((sum, s) =>
        sum + s.metadata.preBuyCheckFactors.earlyWhaleSellRatio, 0) / lossExecuted.length;
      console.log(`  亏损代币平均卖出率: ${(avgSellRatio * 100).toFixed(1)}%`);
    }
  }
}

analyzeFilteredSignals().catch(console.error);
