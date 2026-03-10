const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTokensInOldExp() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  // 获取新实验中 70%-85% 区间的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', newExpId);

  const signalsIn70to85 = newSignals.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return ratio >= 0.7 && ratio <= 0.85;
  });

  const tokenAddresses = signalsIn70to85.map(s => s.token_address);

  console.log('=== 70%-85% 区间的代币在旧实验中的情况 ===\n');
  console.log('代币数量:', tokenAddresses.length);
  console.log('');

  // 检查这些代币在旧实验中的信号
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata, executed')
    .eq('experiment_id', oldExpId)
    .in('token_address', tokenAddresses);

  console.log('旧实验中的信号数:', oldSignals?.length || 0);
  console.log('');

  if (oldSignals && oldSignals.length > 0) {
    console.log('详细数据:');
    oldSignals.forEach(s => {
      const symbol = s.token_symbol || s.token_address?.substring(0, 10);
      const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
      const executed = s.executed;
      
      console.log(`  ${symbol}:`);
      console.log(`    SellRatio: ${ratio ? (ratio * 100).toFixed(1) + '%' : '未知'}`);
      console.log(`    Executed: ${executed ? '✅ 是' : '❌ 否'}`);
      console.log('');
    });

    // 检查是否有被执行的
    const executedInOld = oldSignals.filter(s => s.executed === true);
    console.log('旧实验中执行数:', executedInOld.length);
    console.log('');

    // 如果有执行，查询交易结果
    if (executedInOld.length > 0) {
      const executedAddresses = executedInOld.map(s => s.token_address);
      
      const { data: trades } = await supabase
        .from('trades')
        .select('token_address, pnl, pnl_percent, sell_price, buy_price')
        .eq('experiment_id', oldExpId)
        .in('token_address', executedAddresses);

      console.log('=== 旧实验中这些代币的交易结果 ===\n');
      if (trades && trades.length > 0) {
        let totalPnL = 0;
        let winCount = 0;
        let lossCount = 0;

        trades.forEach(t => {
          const pnl = t.pnl || 0;
          const pnlPercent = t.pnl_percent || 0;
          totalPnL += pnl;
          
          if (pnl > 0) winCount++;
          else if (pnl < 0) lossCount++;

          // 查找符号
          const signal = oldSignals.find(s => s.token_address === t.token_address);
          const symbol = signal?.token_symbol || t.token_address?.substring(0, 10);

          console.log(`  ${symbol}:`);
          console.log(`    PnL: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(1)}%)`);
        });

        console.log('');
        console.log('汇总:');
        console.log(`  总盈亏: ${totalPnL.toFixed(2)} USDT`);
        console.log(`  盈利: ${winCount} 个`);
        console.log(`  亏损: ${lossCount} 个`);
        console.log(`  胜率: ${((winCount / trades.length) * 100).toFixed(1)}%`);
      }
    }
  } else {
    console.log('❌ 旧实验中没有这些代币的信号');
    console.log('这说明这些代币在旧实验中被其他条件过滤掉了，或者没有触发买入信号');
  }

  // 分析旧实验中被拒绝的原因
  console.log('\n=== 分析旧实验为什么没有购买这些代币 ===\n');

  // 检查这些代币在旧实验中的所有因子数据
  const { data: oldAllSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', oldExpId)
    .in('token_address', tokenAddresses);

  if (oldAllSignals && oldAllSignals.length > 0) {
    console.log('旧实验中有', oldAllSignals.length, '个信号');

    // 分析被拒绝的原因
    oldAllSignals.forEach(s => {
      const symbol = s.token_symbol || s.token_address?.substring(0, 10);
      const preBuyResult = s.metadata?.preBuyCheckResult;
      
      console.log(`  ${symbol}:`);
      if (preBuyResult) {
        console.log(`    原因: ${preBuyResult.reason || '未知'}`);
      } else {
        console.log(`    没有预检查结果`);
      }
    });
  }
}

analyzeTokensInOldExp().catch(console.error);
