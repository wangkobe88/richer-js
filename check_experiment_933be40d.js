/**
 * 检查实验 933be40d-1056-463f-b629-aa226a2ea064
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExperiment() {
  const experimentId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 检查实验 ' + experimentId + ' ===\n');

  // 获取所有信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, action')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');
  const rejectedSignals = buySignals.filter(s => s.metadata?.execution_status !== 'executed');

  console.log('总信号数:', buySignals.length);
  console.log('执行信号数:', executedSignals.length);
  console.log('拒绝信号数:', rejectedSignals.length);
  console.log('');

  // 检查执行信号的聚簇因子
  console.log('【执行信号的聚簇因子】\n');
  console.log('代币        | 簇数 | Top2% | Mega% | 首区块% | 是否应该拒绝');
  console.log('------------|------|-------|-------|---------|-------------');

  executedSignals.forEach(signal => {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (factors) {
      const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
      const clusterCount = factors.walletClusterCount || 0;
      const top2Ratio = ((factors.walletClusterTop2Ratio || 0) * 100).toFixed(1);
      const megaRatio = ((factors.walletClusterMegaRatio || 0) * 100).toFixed(1);
      const maxBlockBuyRatio = ((factors.walletClusterMaxBlockBuyRatio || 0) * 100).toFixed(1);

      // 检查是否应该被拒绝
      const shouldReject = clusterCount >= 4 && parseFloat(top2Ratio) > 85;

      console.log(`${symbol.substring(0, 11).padEnd(11)} | ${clusterCount.toString().padStart(4)} | ${top2Ratio.padStart(5)}% | ${megaRatio.padStart(5)}% | ${maxBlockBuyRatio.padStart(5)}% | ${shouldReject ? '❌ 应该拒绝' : ''}`);
    }
  });

  // 检查拒绝信号
  console.log('\n【拒绝信号】\n');

  if (rejectedSignals.length > 0) {
    rejectedSignals.forEach(signal => {
      const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
      const reason = signal.metadata?.preBuyCheckFactors?.checkReason || signal.metadata?.execution_reason || '未知原因';
      console.log(`${symbol}: ${reason}`);
    });
  } else {
    console.log('无拒绝信号');
  }
}

checkExperiment().catch(console.error);
