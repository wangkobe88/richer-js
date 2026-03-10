/**
 * 统计早期大户数量=0的代币
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeZeroWhaleTokens() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'sell');

  const profitMap = {};
  trades.forEach(t => {
    profitMap[t.token_address] = t.metadata?.profitPercent;
  });

  console.log('=== 早期大户数量=0的代币统计 ===\n');

  // 按代币分组，取第一个信号的因子
  const tokenFactors = new Map();
  signals.forEach(s => {
    if (!tokenFactors.has(s.token_address)) {
      const factors = s.metadata?.preBuyCheckFactors;
      if (factors && factors.earlyWhaleCount !== undefined) {
        tokenFactors.set(s.token_address, {
          symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
          whaleCount: factors.earlyWhaleCount,
          sellRatio: factors.earlyWhaleSellRatio,
          holdRatio: factors.earlyWhaleHoldRatio,
          status: s.metadata?.execution_status,
          profit: profitMap[s.token_address]
        });
      }
    }
  });

  const allWithWhaleData = Array.from(tokenFactors.values());

  // 分类
  const zeroWhaleTokens = allWithWhaleData.filter(t => t.whaleCount === 0);
  const hasWhaleTokens = allWithWhaleData.filter(t => t.whaleCount > 0);

  console.log('有早期大户数据的代币:', allWithWhaleData.length);
  console.log('早期大户数量=0:', zeroWhaleTokens.length);
  console.log('早期大户数量>0:', hasWhaleTokens.length);
  console.log('');

  // 收益分析
  const zeroWhaleProfit = zeroWhaleTokens.filter(t => t.profit !== undefined && t.profit > 0);
  const zeroWhaleLoss = zeroWhaleTokens.filter(t => t.profit !== undefined && t.profit <= 0);
  const zeroWhaleUnknown = zeroWhaleTokens.filter(t => t.profit === undefined);

  const hasWhaleProfit = hasWhaleTokens.filter(t => t.profit !== undefined && t.profit > 0);
  const hasWhaleLoss = hasWhaleTokens.filter(t => t.profit !== undefined && t.profit <= 0);

  console.log('=== 收益分析 ===\n');

  console.log('早期大户数量=0的代币:');
  console.log(`  总数: ${zeroWhaleTokens.length}个`);
  console.log(`  盈利: ${zeroWhaleProfit.length}个`);
  console.log(`  亏损: ${zeroWhaleLoss.length}个`);
  console.log(`  未知: ${zeroWhaleUnknown.length}个`);

  if (zeroWhaleProfit.length > 0) {
    const avgProfit = zeroWhaleProfit.reduce((sum, t) => sum + t.profit, 0) / zeroWhaleProfit.length;
    console.log(`  平均收益: ${avgProfit.toFixed(1)}%`);
  }

  if (zeroWhaleLoss.length > 0) {
    const avgLoss = zeroWhaleLoss.reduce((sum, t) => sum + t.profit, 0) / zeroWhaleLoss.length;
    console.log(`  平均收益: ${avgLoss.toFixed(1)}%`);
  }

  console.log('');
  console.log('早期大户数量>0的代币:');
  console.log(`  总数: ${hasWhaleTokens.length}个`);
  console.log(`  盈利: ${hasWhaleProfit.length}个`);
  console.log(`  亏损: ${hasWhaleLoss.length}个}`);

  if (hasWhaleProfit.length > 0) {
    const avgProfit = hasWhaleProfit.reduce((sum, t) => sum + t.profit, 0) / hasWhaleProfit.length;
    console.log(`  平均收益: ${avgProfit.toFixed(1)}%`);
  }

  if (hasWhaleLoss.length > 0) {
    const avgLoss = hasWhaleLoss.reduce((sum, t) => sum + t.profit, 0) / hasWhaleLoss.length;
    console.log(`  平均收益: ${avgLoss.toFixed(1)}%`);
  }

  // 显示早期大户数量=0的代币详情
  console.log('\n=== 早期大户数量=0的代币详情 ===');
  console.log('代币          | 收益    | 卖出率');
  console.log('-------------|---------|--------');

  zeroWhaleTokens.slice(0, 20).forEach(t => {
    const profitStr = t.profit !== undefined ? (t.profit > 0 ? '+' + t.profit.toFixed(1) + '%' : t.profit.toFixed(1) + '%') : 'N/A';
    const sellRatioStr = (t.sellRatio * 100).toFixed(0) + '%';
    console.log(`  ${t.symbol.padEnd(13)} | ${profitStr.padStart(7)} | ${sellRatioStr.padStart(6)}`);
  });

  if (zeroWhaleTokens.length > 20) {
    console.log(`  ... 还有 ${zeroWhaleTokens.length - 20} 个代币`);
  }

  // 统计整个实验的情况
  console.log('\n=== 整个实验统计 ===');

  const totalExecuted = signals.filter(s => s.metadata?.execution_status === 'executed');
  const uniqueExecutedTokens = new Set();
  totalExecuted.forEach(s => uniqueExecutedTokens.add(s.token_address));

  const executedWithZeroWhale = [];
  const executedWithHasWhale = [];

  uniqueExecutedTokens.forEach(tokenAddr => {
    const factors = tokenFactors.get(tokenAddr);
    if (factors) {
      if (factors.whaleCount === 0) {
        executedWithZeroWhale.push(factors);
      } else if (factors.whaleCount > 0) {
        executedWithHasWhale.push(factors);
      }
    }
  });

  console.log(`执行的代币总数: ${uniqueExecutedTokens.size}`);
  console.log(`早期大户数量=0: ${executedWithZeroWhale.length}个 (${(executedWithZeroWhale.length / uniqueExecutedTokens.size * 100).toFixed(1)}%)`);
  console.log(`早期大户数量>0: ${executedWithHasWhale.length}个 (${(executedWithHasWhale.length / uniqueExecutedTokens.size * 100).toFixed(1)}%)`);

  // 计算早期大户数量=0的代币的平均收益
  const profitZero = executedWithZeroWhale.filter(t => t.profit !== undefined && t.profit > 0);
  const lossZero = executedWithZeroWhale.filter(t => t.profit !== undefined && t.profit <= 0);

  if (profitZero.length > 0 && lossZero.length > 0) {
    const avgProfit = profitZero.reduce((sum, t) => sum + t.profit, 0) / profitZero.length;
    const avgLoss = lossZero.reduce((sum, t) => sum + t.profit, 0) / lossZero.length;

    console.log('\n早期大户数量=0的代币收益:');
    console.log(`  盈利代币平均: ${avgProfit.toFixed(1)}% (${profitZero.length}个)`);
    console.log(`  亏损代币平均: ${avgLoss.toFixed(1)}% (${lossZero.length}个)`);
  }
}

analyzeZeroWhaleTokens().catch(console.error);
