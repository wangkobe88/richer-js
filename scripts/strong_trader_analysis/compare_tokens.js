const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compare() {
  // 获取原始虚拟实验执行的买入信号
  const { data: origSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
    .eq('executed', true);

  // 获取回测实验执行的买入信号
  const { data: backtestSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  console.log('=== 买入代币对比 ===');
  console.log(`原始虚拟实验 015db965: ${origSignals?.length || 0} 个买入`);
  console.log(`回测实验 a2ee5c27: ${backtestSignals?.length || 0} 个买入`);
  console.log(`差异: ${(origSignals?.length || 0) - (backtestSignals?.length || 0)} 个代币`);

  const origTokens = new Map();
  origSignals?.forEach(s => {
    origTokens.set(s.token_address?.toLowerCase(), {
      symbol: s.token_symbol,
      factors: s.metadata?.preBuyCheckFactors || {}
    });
  });

  const backtestTokens = new Set();
  backtestSignals?.forEach(s => {
    backtestTokens.add(s.token_address?.toLowerCase());
  });

  // 找出只在原始实验买入的代币
  const onlyInOrig = [];
  origTokens.forEach((data, addr) => {
    if (!backtestTokens.has(addr)) {
      onlyInOrig.push({ address: addr, ...data });
    }
  });

  console.log(`\n只在原始实验买入的代币 (${onlyInOrig.length} 个):`);
  onlyInOrig.forEach(t => {
    console.log(`  ${t.symbol}`);
  });

  // 分析这些被过滤的代币的因子特征
  console.log('\n=== 被过滤代币的因子特征 ===');
  const factorsToAnalyze = [
    'earlyTradesCountPerMin',
    'earlyTradesVolumePerMin',
    'earlyTradesHighValuePerMin',
    'walletClusterCount',
    'walletClusterTop2Ratio',
    'walletClusterMaxBlockBuyRatio',
    'holderBlacklistCount',
    'holderWhitelistCount',
    'devHoldingRatio'
  ];

  factorsToAnalyze.forEach(factor => {
    const values = onlyInOrig.map(t => t.factors[factor]).filter(v => v != null);
    if (values.length > 0) {
      const avg = values.reduce((a,b) => a+b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      console.log(`\n${factor}:`);
      console.log(`  平均: ${avg.toFixed(2)}, 范围: [${min.toFixed(2)}, ${max.toFixed(2)}]`);
    }
  });

  // 对比买入代币的因子平均值
  console.log('\n=== 因子对比: 原始买入 vs 被过滤 ===');

  const boughtTokens = [];
  origTokens.forEach((data, addr) => {
    if (backtestTokens.has(addr)) {
      boughtTokens.push({ address: addr, ...data });
    }
  });

  factorsToAnalyze.forEach(factor => {
    const boughtValues = boughtTokens.map(t => t.factors[factor]).filter(v => v != null);
    const filteredValues = onlyInOrig.map(t => t.factors[factor]).filter(v => v != null);

    if (boughtValues.length > 0 && filteredValues.length > 0) {
      const boughtAvg = boughtValues.reduce((a,b) => a+b, 0) / boughtValues.length;
      const filteredAvg = filteredValues.reduce((a,b) => a+b, 0) / filteredValues.length;

      const diff = ((filteredAvg - boughtAvg) / boughtAvg * 100).toFixed(1);
      const arrow = filteredAvg > boughtAvg ? '>' : '<';
      console.log(`\n${factor}:`);
      console.log(`  买入: ${boughtAvg.toFixed(2)}`);
      console.log(`  被过滤: ${filteredAvg.toFixed(2)} ${arrow} (${diff}%)`);
    }
  });

  // 分析当前条件中 strongTraderNetPositionRatio < 5 的合理性
  console.log('\n=== strongTraderNetPositionRatio 条件分析 ===');
  console.log('当前条件: strongTraderNetPositionRatio < 5');
  console.log('\n建议:');
  console.log('1. 由于原始实验没有 strongTrader 数据，无法直接分析');
  console.log('2. 需要重新运行回测以获取完整因子数据');
  console.log('3. 或者分析其他实验来推断合适的阈值');
}

compare().catch(console.error);
