const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyze() {
  // 获取回测实验 a2ee5c27 的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  console.log('=== 回测实验 a2ee5c27 的 strongTraderNetPositionRatio 分布 ===');
  const ratios = newSignals?.map(s => s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio).filter(r => r != null) || [];
  ratios.sort((a, b) => a - b);

  console.log(`样本数: ${ratios.length}`);
  console.log(`最小值: ${ratios[0]?.toFixed(2)}`);
  console.log(`最大值: ${ratios[ratios.length-1]?.toFixed(2)}`);
  console.log(`平均值: ${(ratios.reduce((a,b) => a+b, 0) / ratios.length).toFixed(2)}`);
  console.log(`中位数: ${ratios[Math.floor(ratios.length/2)]?.toFixed(2)}`);

  console.log('\n分位数:');
  [0, 10, 25, 50, 75, 90, 95, 100].forEach(p => {
    const idx = Math.floor(ratios.length * p / 100);
    console.log(`  ${p}%: ${ratios[idx]?.toFixed(2)}`);
  });

  // 获取原始虚拟实验买入的代币列表
  const { data: origSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
    .eq('executed', true);

  const origTokens = new Set(origSignals?.map(s => s.token_address?.toLowerCase()) || []);

  // 获取回测实验的所有信号
  const { data: allBacktestSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata, execution_reason, executed')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad');

  console.log(`\n回测实验总信号数: ${allBacktestSignals?.length || 0}`);
  console.log(`执行的信号数: ${newSignals?.length || 0}`);
  console.log(`原始虚拟实验买入数: ${origSignals?.length || 0}`);

  // 分析未执行的原因
  const notExecuted = allBacktestSignals?.filter(s => !s.executed) || [];
  console.log(`未执行的信号数: ${notExecuted.length}`);

  // 统计执行原因
  const reasonCount = {};
  notExecuted.forEach(s => {
    const reason = s.execution_reason || 'unknown';
    reasonCount[reason] = (reasonCount[reason] || 0) + 1;
  });

  console.log('\n未执行原因统计:');
  Object.entries(reasonCount).sort((a,b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  // 分析被 strongTraderNetPositionRatio >= 5 过滤掉的信号
  console.log('\n=== 分析 strongTraderNetPositionRatio 过滤 ===');
  const filteredByStrongTrader = allBacktestSignals?.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
    return ratio != null && ratio >= 5 && !s.executed;
  }) || [];

  console.log(`被 strongTraderNetPositionRatio >= 5 过滤: ${filteredByStrongTrader.length} 个`);

  if (filteredByStrongTrader.length > 0) {
    console.log('\n被过滤的代币 (前10):');
    filteredByStrongTrader.slice(0, 10).forEach(s => {
      const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
      console.log(`  ${s.token_symbol}: strongTraderNetPositionRatio=${ratio?.toFixed(2)}`);
    });

    // 检查这些被过滤的代币在原始实验中的表现
    console.log('\n检查被过滤代币在原始虚拟实验中是否买入:');
    let boughtInOrig = 0;
    filteredByStrongTrader.forEach(s => {
      const wasBought = origTokens.has(s.token_address?.toLowerCase());
      if (wasBought) boughtInOrig++;
    });
    console.log(`  在原始实验中被买入: ${boughtInOrig}/${filteredByStrongTrader.length}`);
  }

  // 分析不同阈值下的影响
  console.log('\n=== 不同阈值下的信号数 ===');
  const thresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
  thresholds.forEach(th => {
    const count = allBacktestSignals?.filter(s => {
      const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
      return ratio != null && ratio < th;
    }).length || 0;
    console.log(`  strongTraderNetPositionRatio < ${th}: ${count} 个信号`);
  });
}

analyze().catch(console.error);
