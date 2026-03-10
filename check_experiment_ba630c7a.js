/**
 * 检查实验 ba630c7a-73dd-4ff8-8923-3a8d36735699
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExperiment() {
  const experimentId = 'ba630c7a-73dd-4ff8-8923-3a8d36735699';

  console.log('=== 检查实验 ' + experimentId + ' ===\n');

  // 获取所有信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, action, created_at')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: false });

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');
  const rejectedSignals = buySignals.filter(s => s.metadata?.execution_status !== 'executed');

  console.log('总信号数:', buySignals.length);
  console.log('执行信号数:', executedSignals.length);
  console.log('拒绝信号数:', rejectedSignals.length);
  console.log('');

  // 检查交易
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, trade_direction, metadata')
    .eq('experiment_id', experimentId);

  const buyTrades = trades?.filter(t => t.trade_direction === 'buy') || [];
  const sellTrades = trades?.filter(t => t.trade_direction === 'sell') || [];

  console.log('买入交易数:', buyTrades.length);
  console.log('卖出交易数:', sellTrades.length);
  console.log('');

  // 检查拒绝信号的详细原因
  if (rejectedSignals.length > 0) {
    console.log('【拒绝信号分析】\n');
    console.log('代币        | 簇数 | Top2% | Mega% | 首区块% | 拒绝原因');
    console.log('------------|------|-------|-------|---------|----------');

    rejectedSignals.slice(0, 20).forEach(signal => {
      const factors = signal.metadata?.preBuyCheckFactors;
      const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
      const clusterCount = factors?.walletClusterCount || 0;
      const top2Ratio = ((factors?.walletClusterTop2Ratio || 0) * 100).toFixed(1);
      const megaRatio = ((factors?.walletClusterMegaRatio || 0) * 100).toFixed(1);
      const maxBlockBuyRatio = ((factors?.walletClusterMaxBlockBuyRatio || 0) * 100).toFixed(1);

      // 分析拒绝原因
      let rejectReason = [];
      if (clusterCount >= 4 && parseFloat(top2Ratio) > 85) {
        rejectReason.push('聚簇');
      }
      if (parseFloat(megaRatio) > 70) {
        rejectReason.push('Mega');
      }
      if (parseFloat(maxBlockBuyRatio) >= 15) {
        rejectReason.push('首区块');
      }

      const checkReason = factors?.checkReason || signal.metadata?.execution_reason || '';

      console.log(`${symbol.substring(0, 11).padEnd(11)} | ${clusterCount.toString().padStart(4)} | ${top2Ratio.padStart(5)}% | ${megaRatio.padStart(5)}% | ${maxBlockBuyRatio.padStart(5)}% | ${rejectReason.join(',') || checkReason.substring(0, 20)}`);
    });

    if (rejectedSignals.length > 20) {
      console.log(`... 还有 ${rejectedSignals.length - 20} 个拒绝信号`);
    }
  }

  // 检查早期参与者因子
  console.log('\n【早期参与者因子分析】\n');
  console.log('代币        | HighValue | CountPerMin | VolumePerMin | 实际跨度');
  console.log('------------|-----------|-------------|--------------|----------');

  const signalsWithFactors = buySignals.filter(s => s.metadata?.preBuyCheckFactors).slice(0, 10);

  signalsWithFactors.forEach(signal => {
    const factors = signal.metadata?.preBuyCheckFactors;
    const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
    const highValueCount = factors?.earlyTradesHighValueCount || 0;
    const countPerMin = factors?.earlyTradesCountPerMin || 0;
    const volumePerMin = factors?.earlyTradesVolumePerMin || 0;
    const actualSpan = factors?.earlyTradesActualSpan || 0;

    console.log(`${symbol.substring(0, 11).padEnd(11)} | ${highValueCount.toString().padStart(9)} | ${countPerMin.toString().padStart(11)} | ${volumePerMin.toString().padStart(12)} | ${actualSpan.toString().padStart(8)}`);
  });
}

checkExperiment().catch(console.error);
