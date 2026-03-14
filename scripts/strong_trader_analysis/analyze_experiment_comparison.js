const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyze() {
  // 获取两个实验的信号
  const { data: origSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
    .eq('executed', true);

  const { data: backtestSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata, execution_reason, executed')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad');

  const origTokens = new Set(origSignals?.map(s => s.token_address?.toLowerCase()) || []);
  const backtestExecuted = new Set(backtestSignals?.filter(s => s.executed).map(s => s.token_address?.toLowerCase()) || []);

  console.log('=== 实验对比 ===');
  console.log(`原始虚拟实验 015db965 买入: ${origTokens.size} 个代币`);
  console.log(`回测实验 a2ee5c27 执行: ${backtestExecuted.size} 个代币`);

  // 分析重叠和差异
  const intersection = new Set([...origTokens].filter(x => backtestExecuted.has(x)));
  const onlyInOrig = new Set([...origTokens].filter(x => !backtestExecuted.has(x)));
  const onlyInBacktest = new Set([...backtestExecuted].filter(x => !origTokens.has(x)));

  console.log(`\n重叠买入: ${intersection.size} 个代币`);
  console.log(`只在原始实验买入: ${onlyInOrig.size} 个代币`);
  console.log(`只在回测实验买入: ${onlyInBacktest.size} 个代币`);

  // 分析未执行的原因
  const notExecuted = backtestSignals?.filter(s => !s.executed) || [];
  const reasonCount = {};
  notExecuted.forEach(s => {
    const reason = s.execution_reason || 'unknown';
    reasonCount[reason] = (reasonCount[reason] || 0) + 1;
  });

  console.log('\n=== 未执行原因统计 ===');
  Object.entries(reasonCount).sort((a,b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  // 分析被 strongTraderNetPositionRatio 过滤的
  console.log('\n=== strongTraderNetPositionRatio 分析 ===');
  const withRatio = backtestSignals?.filter(s => s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio != null) || [];
  console.log(`有 strongTraderNetPositionRatio 数据的信号: ${withRatio.length} 个`);

  const ratios = withRatio.map(s => ({
    symbol: s.token_symbol,
    ratio: s.metadata.preBuyCheckFactors.strongTraderNetPositionRatio,
    executed: s.executed
  }));

  ratios.sort((a, b) => b.ratio - a.ratio);

  console.log('\nstrongTraderNetPositionRatio 最高 (前20):');
  ratios.slice(0, 20).forEach(r => {
    const status = r.executed ? '✓' : '✗';
    console.log(`  ${status} ${r.symbol}: ${r.ratio.toFixed(2)}`);
  });

  // 分析阈值 < 5 的过滤效果
  const filteredByThreshold = withRatio.filter(r => r.ratio >= 5 && !r.executed);
  console.log(`\n被 strongTraderNetPositionRatio >= 5 过滤: ${filteredByThreshold.length} 个`);

  if (filteredByThreshold.length > 0) {
    console.log('\n被过滤的代币:');
    filteredByThreshold.forEach(r => {
      const wasInOrig = origTokens.has(r.symbol.toLowerCase()) ? '(原始买入)' : '';
      console.log(`  ${r.symbol}: ${r.ratio.toFixed(2)} ${wasInOrig}`);
    });
  }

  // 分析不同阈值下的影响
  console.log('\n=== 不同阈值下的执行信号数 ===');
  const thresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
  thresholds.forEach(th => {
    const wouldExecute = withRatio.filter(r => r.ratio < th).length;
    const actuallyExecuted = withRatio.filter(r => r.ratio < th && r.executed).length;
    console.log(`  strongTraderNetPositionRatio < ${th}: ${actuallyExecuted}/${wouldExecute} (实际有数据/总数)`);
  });

  // 分析只在原始实验买入的代币的 strongTraderNetPositionRatio
  console.log('\n=== 只在原始实验买入的代币分析 ===');
  if (onlyInOrig.size > 0) {
    console.log(`共 ${onlyInOrig.size} 个代币`);

    const onlyInOrigWithRatio = withRatio.filter(r => {
      const addr = r.symbol.toLowerCase(); // 这里简化处理，实际应该用 token_address
      return onlyInOrig.has(addr) && !backtestExecuted.has(addr);
    });

    if (onlyInOrigWithRatio.length > 0) {
      console.log('\n这些代币的 strongTraderNetPositionRatio:');
      onlyInOrigWithRatio.forEach(r => {
        console.log(`  ${r.symbol}: ${r.ratio.toFixed(2)}`);
      });
    }
  }
}

analyze().catch(console.error);
