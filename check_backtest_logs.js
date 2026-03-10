/**
 * 检查回测日志，看看分页逻辑是否正常执行
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkBacktestLogs() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取该代币的所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  console.log('=== 1$ 代币的信号分析 ===\n');
  console.log('总信号数:', signals.length);
  console.log('');

  // 查找第一个有 preBuyCheckFactors 的信号
  for (const signal of signals) {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (factors && factors.earlyTradesTotalCount !== undefined) {
      console.log('找到有预检查因子的信号:');
      console.log('信号ID:', signal.id);
      console.log('创建时间:', signal.created_at);
      console.log('');

      console.log('早期交易数据:');
      console.log('  earlyTradesTotalCount:', factors.earlyTradesTotalCount);
      console.log('  earlyTradesCheckTime:', factors.earlyTradesCheckTime);
      console.log('  earlyTradesExpectedFirstTime:', factors.earlyTradesExpectedFirstTime);
      console.log('  earlyTradesExpectedLastTime:', factors.earlyTradesExpectedLastTime);
      console.log('  earlyTradesDataFirstTime:', factors.earlyTradesDataFirstTime);
      console.log('  earlyTradesDataLastTime:', factors.earlyTradesDataLastTime);
      console.log('  earlyTradesActualSpan:', factors.earlyTradesActualSpan);

      if (factors.earlyTradesTotalCount === 300) {
        console.log('\n⚠️  earlyTradesTotalCount = 300，可能数据被截断了！');
        console.log('  这说明分页逻辑可能没有正确执行，或者API在某个时间窗口内真的只有300条交易');
      }

      // 计算理论上的交易频率
      if (factors.earlyTradesActualSpan && factors.earlyTradesTotalCount) {
        const tradesPerMin = (factors.earlyTradesTotalCount / factors.earlyTradesActualSpan) * 60;
        console.log('\n交易频率分析:');
        console.log(`  ${factors.earlyTradesTotalCount} 笔交易 / ${factors.earlyTradesActualSpan} 秒`);
        console.log(`  ≈ ${tradesPerMin.toFixed(1)} 笔/分钟`);

        // 如果交易频率很高，说明可能有数据被截断
        if (tradesPerMin > 200) {
          console.log('  ⚠️  交易频率很高，可能有更多交易未获取到！');
        }
      }
      break;
    }
  }

  // 检查是否这个代币根本没有通过预检查
  console.log('\n=== 检查信号执行状态 ===');
  signals.forEach((signal, i) => {
    console.log(`信号 ${i + 1}:`);
    console.log('  execution_status:', signal.metadata?.execution_status);
    console.log('  execution_reason:', signal.metadata?.execution_reason);
    console.log('  有 preBuyCheckFactors:', !!signal.metadata?.preBuyCheckFactors);
  });
}

checkBacktestLogs().catch(console.error);
