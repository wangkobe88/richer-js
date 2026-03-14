const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeFiltered() {
  // 获取回测实验的所有信号（包括未执行的）
  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata, executed, execution_reason')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .order('created_at', { ascending: false });

  console.log('回测实验 a2ee5c27 信号总数:', allSignals?.length);
  const executed = allSignals?.filter(s => s.executed).length || 0;
  const notExecuted = allSignals?.filter(s => !s.executed).length || 0;
  console.log(`  执行: ${executed}`);
  console.log(`  未执行: ${notExecuted}`);

  // 获取原始虚拟实验买入的代币
  const { data: origSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
    .eq('executed', true);

  const origTokens = new Set(origSignals?.map(s => s.token_address?.toLowerCase()) || []);

  console.log('\n原始虚拟实验 015db965 买入代币数:', origTokens.size);

  // 找出被过滤的代币（在原始实验买入但回测未执行）
  const filteredTokens = [];
  const origNotInBacktest = [];

  origTokens.forEach(addr => {
    // 检查这个代币在回测实验中的状态
    const backtestSignals = allSignals?.filter(s =>
      (s.token_address?.toLowerCase() === addr || s.token_address === addr)
    ) || [];

    if (backtestSignals.length === 0) {
      // 回测实验根本没有这个代币的信号
      origNotInBacktest.push(addr);
    } else {
      // 检查是否执行
      const executed = backtestSignals.some(s => s.executed);
      if (!executed) {
        // 找到第一个未执行的信号
        const signal = backtestSignals.find(s => !s.executed);
        filteredTokens.push({
          address: addr,
          symbol: signal?.token_symbol,
          reason: signal?.execution_reason || 'unknown'
        });
      }
    }
  });

  console.log('\n=== 分析结果 ===');
  console.log(`在原始实验买入但回测未执行的代币: ${filteredTokens.length}`);
  console.log(`回测实验没有的代币: ${origNotInBacktest.length}`);
  console.log(`总差异: ${origTokens.size - 60} (原始买入 ${origTokens.size} - 回测执行 60)`);

  if (filteredTokens.length > 0) {
    console.log('\n被过滤的代币及其执行原因:');
    filteredTokens.forEach(t => {
      console.log(`  ${t.symbol}: ${t.reason}`);
    });
  }

  // 统计执行原因
  console.log('\n=== 执行原因统计 ===');
  const reasonCount = {};
  allSignals?.filter(s => !s.executed).forEach(s => {
    const reason = s.execution_reason || 'unknown';
    reasonCount[reason] = (reasonCount[reason] || 0) + 1;
  });

  Object.entries(reasonCount).sort((a,b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  // 由于回测实验的信号没有保存 preBuyCheckFactors
  // 我们无法直接获取 strongTraderNetPositionRatio 的值
  console.log('\n=== 强势交易者因子分析 ===');
  console.log('注意: 回测实验的信号中没有保存 preBuyCheckFactors 数据');
  console.log('因此无法直接查看被过滤代币的 strongTraderNetPositionRatio 值');
  console.log('\n要获取这些数据，需要:');
  console.log('1. 重新运行回测并保存完整因子数据');
  console.log('2. 或者分析代币的早期交易数据来计算 strongTraderNetPositionRatio');
}

analyzeFiltered().catch(console.error);
