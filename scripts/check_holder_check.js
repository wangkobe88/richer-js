/**
 * 检查持有者检查是否正常
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查实验 6499eec8 的持有者检查 ===\n');

  const expId = '6499eec8-a067-489e-935a-d663d859a18f';

  // 1. 获取实验信息
  const { data: exp } = await supabase
    .from('experiments')
    .select('id, name, mode, source_experiment_id, created_at')
    .eq('id', expId)
    .single();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验信息】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(JSON.stringify(exp, null, 2));

  // 2. 检查信号的持有者检查因子
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【持有者检查因子统计】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .limit(20);

  if (signals && signals.length > 0) {
    const stats = {
      totalSignals: signals.length,
      zeroHoldersCount: 0,
      zeroWhitelistCount: 0,
      zeroBlacklistCount: 0,
      hasHolderData: 0
    };

    for (const signal of signals) {
      const factors = signal.metadata?.preBuyCheckFactors || {};
      if (factors.holdersCount === 0) stats.zeroHoldersCount++;
      if (factors.holderWhitelistCount === 0) stats.zeroWhitelistCount++;
      if (factors.holderBlacklistCount === 0) stats.zeroBlacklistCount++;
      if (factors.holdersCount > 0) stats.hasHolderData++;
    }

    console.log(`总信号数: ${stats.totalSignals}`);
    console.log(`holdersCount = 0: ${stats.zeroHoldersCount}`);
    console.log(`holderWhitelistCount = 0: ${stats.zeroWhitelistCount}`);
    console.log(`holderBlacklistCount = 0: ${stats.zeroBlacklistCount}`);
    console.log(`有持有者数据 (holdersCount > 0): ${stats.hasHolderData}`);

    // 3. 显示一个信号的详细信息
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【第一个信号的持有者检查因子】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const firstFactors = signals[0].metadata?.preBuyCheckFactors || {};
    const holderFactors = {
      holdersCount: firstFactors.holdersCount,
      holderWhitelistCount: firstFactors.holderWhitelistCount,
      holderBlacklistCount: firstFactors.holderBlacklistCount,
      devHoldingRatio: firstFactors.devHoldingRatio,
      maxHoldingRatio: firstFactors.maxHoldingRatio,
      holderCanBuy: firstFactors.holderCanBuy
    };
    console.log(JSON.stringify(holderFactors, null, 2));
  }

  // 4. 检查这是否是回测实验
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (exp?.mode === 'backtest' || exp?.source_experiment_id) {
    console.log('这是一个回测实验！');
    console.log('回测实验不会调用 AVE API 获取实时持有者数据。');
    console.log('回测引擎使用的是 experiment_time_series_data 中的历史数据，');
    console.log('而该表只包含价格和趋势因子，不包含持有者黑癓名单数据。');
    console.log('');
    console.log('所以 preBuyCheckFactors 中所有持有者相关因子都是 0：');
    console.log('  - holdersCount: 0');
    console.log('  - holderWhitelistCount: 0');
    console.log('  - holderBlacklistCount: 0');
    console.log('  - devHoldingRatio: 0');
    console.log('  - maxHoldingRatio: 0');
    console.log('');
    console.log('这是正常的回测行为！如果需要在回测中使用持有者检查，');
    console.log('需要在 experiment_time_series_data 中存储持有者历史数据。');
  }
}

main().catch(console.error);
