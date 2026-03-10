/**
 * 验证 megaClusterRatio 因子在数据库中的保存情况
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  const experimentId = '123481dc-2961-4ba1-aeea-aea80cc59bf2';

  // 获取几个买入信号，检查 megaClusterRatio 是否保存
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .limit(10);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('=== 验证 megaClusterRatio 因子保存 ===\n');

  let hasMegaClusterRatio = 0;
  let noMegaClusterRatio = 0;

  signals.forEach((signal, idx) => {
    const factors = signal.metadata?.preBuyCheckFactors;
    const megaRatio = factors?.walletClusterMegaRatio;
    const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);

    console.log(`${idx + 1}. ${symbol}`);
    console.log(`   megaClusterRatio: ${megaRatio !== undefined ? megaRatio : '未保存'}`);
    console.log(`   preBuyCheckFactors 存在: ${!!factors}`);

    if (factors) {
      const factorKeys = Object.keys(factors);
      console.log(`   因子数量: ${factorKeys.length}`);
      console.log(`   包含 megaClusterRatio: ${factorKeys.includes('walletClusterMegaRatio')}`);
    }

    console.log('');

    if (megaRatio !== undefined) {
      hasMegaClusterRatio++;
    } else {
      noMegaClusterRatio++;
    }
  });

  console.log(`\n统计:`);
  console.log(`  有 megaClusterRatio: ${hasMegaClusterRatio}`);
  console.log(`  无 megaClusterRatio: ${noMegaClusterRatio}`);
  console.log(`  覆盖率: ${(hasMegaClusterRatio / signals.length * 100).toFixed(1)}%`);

  // 检查是否有信号的 preBuyCheckFactors 完全为空
  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('id, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const emptyFactors = allSignals.filter(s => !s.metadata?.preBuyCheckFactors || Object.keys(s.metadata.preBuyCheckFactors).length === 0);
  console.log(`\n所有买入信号: ${allSignals.length}`);
  console.log(`preBuyCheckFactors 为空: ${emptyFactors.length}`);

  if (emptyFactors.length > 0) {
    console.log('\npreBuyCheckFactors 为空的信号ID:');
    emptyFactors.slice(0, 5).forEach(s => {
      console.log(`  ${s.id}`);
    });
  }
}

main().catch(console.error);
