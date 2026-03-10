/**
 * 检查新回测实验中 1$ 代币的早期大户数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkNewBacktest() {
  const experimentId = '8a4ea415-6df6-499c-a659-b47fda546de5';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  console.log('=== 新回测实验中的 1$ 代币 ===\n');
  console.log('实验ID:', experimentId);
  console.log('总信号数:', signals.length);
  console.log('');

  for (const signal of signals) {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (!factors) continue;

    console.log('信号时间:', new Date(signal.created_at).toLocaleString());
    console.log('');
    console.log('早期大户数据:');
    console.log('  earlyWhaleCount:', factors.earlyWhaleCount);
    console.log('  earlyWhaleSellRatio:', factors.earlyWhaleSellRatio);
    console.log('  earlyWhaleHoldRatio:', factors.earlyWhaleHoldRatio);
    console.log('  earlyWhaleMethod:', factors.earlyWhaleMethod);
    console.log('  earlyWhaleEarlyThreshold:', factors.earlyWhaleEarlyThreshold);
    console.log('');

    console.log('与我的计算对比:');
    console.log('  我的计算: earlyWhaleCount=6, earlyWhaleSellRatio=0.934');
    console.log('  回测结果: earlyWhaleCount=' + factors.earlyWhaleCount + ', earlyWhaleSellRatio=' + factors.earlyWhaleSellRatio);
    console.log('');

    if (factors.earlyWhaleCount !== 6) {
      console.log('⚠️  earlyWhaleCount 不一致！');
      console.log('  可能原因:');
      console.log('    1. 回测引擎使用的时间窗口与我的测试不同');
      console.log('    2. 早期交易数据可能不同');
      console.log('    3. earlyWhaleEarlyThreshold 计算不同');
    }

    if (factors.earlyWhaleSellRatio !== undefined && factors.earlyWhaleSellRatio !== 0.934) {
      console.log('⚠️  earlyWhaleSellRatio 不一致！');
    }

    console.log('');
    console.log('早期交易数据:');
    console.log('  earlyTradesTotalCount:', factors.earlyTradesTotalCount);
    console.log('  earlyTradesDataFirstTime:', factors.earlyTradesDataFirstTime);
    console.log('  earlyTradesDataLastTime:', factors.earlyTradesDataLastTime);
    console.log('  earlyTradesActualSpan:', factors.earlyTradesActualSpan);
    console.log('');

    break; // 只分析第一个信号
  }
}

checkNewBacktest().catch(console.error);
