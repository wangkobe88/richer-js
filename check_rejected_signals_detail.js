/**
 * 检查拒绝信号的详细聚簇因子
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkRejectedSignals() {
  const experimentId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 检查拒绝信号的聚簇因子 ===\n');

  // 获取所有信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, created_at')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: false });

  const rejectedSignals = buySignals.filter(s => s.metadata?.execution_status !== 'executed');

  console.log('拒绝信号数:', rejectedSignals.length);
  console.log('');

  console.log('代币        | 簇数 | Top2% | Mega% | 首区块% | 拒绝原因分析');
  console.log('------------|------|-------|-------|---------|-------------');

  rejectedSignals.forEach(signal => {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (factors) {
      const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
      const clusterCount = factors.walletClusterCount || 0;
      const top2Ratio = ((factors.walletClusterTop2Ratio || 0) * 100).toFixed(1);
      const megaRatio = ((factors.walletClusterMegaRatio || 0) * 100).toFixed(1);
      const maxBlockBuyRatio = ((factors.walletClusterMaxBlockBuyRatio || 0) * 100).toFixed(1);

      // 分析拒绝原因
      let rejectReason = [];
      if (clusterCount >= 4 && parseFloat(top2Ratio) > 85) {
        rejectReason.push('聚簇条件');
      }
      if (parseFloat(megaRatio) > 70) {
        rejectReason.push('Mega条件');
      }
      if (parseFloat(maxBlockBuyRatio) >= 15) {
        rejectReason.push('首区块条件');
      }

      console.log(`${symbol.substring(0, 11).padEnd(11)} | ${clusterCount.toString().padStart(4)} | ${top2Ratio.padStart(5)}% | ${megaRatio.padStart(5)}% | ${maxBlockBuyRatio.padStart(5)}% | ${rejectReason.join(', ') || '其他'}`);
    }
  });
}

checkRejectedSignals().catch(console.error);
