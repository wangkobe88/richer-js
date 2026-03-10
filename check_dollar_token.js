/**
 * 检查 1$ 代币的详细数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDollarToken() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  if (signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const firstSignal = signals[0];

  console.log('=== 1$ 代币详细分析 ===\n');
  console.log('代币地址:', tokenAddress);
  console.log('符号:', firstSignal.metadata?.symbol || '1$');
  console.log('链:', firstSignal.metadata?.chain || 'bsc');
  console.log('信号时间:', new Date(firstSignal.created_at).toLocaleString());
  console.log('执行状态:', firstSignal.metadata?.execution_status);
  console.log('执行原因:', firstSignal.metadata?.execution_reason);
  console.log('');

  const factors = firstSignal.metadata?.preBuyCheckFactors;

  if (!factors) {
    console.log('❌ 没有 preBuyCheckFactors 数据');
    return;
  }

  console.log('=== 早期交易数据 ===');
  console.log('检查时间:', factors.earlyTradesCheckTime, '(' + new Date((factors.earlyTradesCheckTime || 0) * 1000).toLocaleString() + ')');
  console.log('预期窗口:', factors.earlyTradesExpectedFirstTime, '-', factors.earlyTradesExpectedLastTime, '(90秒)');
  console.log('实际窗口:', factors.earlyTradesDataFirstTime, '-', factors.earlyTradesDataLastTime, `(${factors.earlyTradesActualSpan}秒)`);
  console.log('交易总数:', factors.earlyTradesTotalCount);
  console.log('');

  // 计算缺口
  const gap = factors.earlyTradesDataFirstTime - factors.earlyTradesExpectedFirstTime;
  const delay = factors.earlyTradesCheckTime - factors.earlyTradesDataFirstTime;

  console.log('=== 数据完整性分析 ===');
  console.log('预期起始时间:', factors.earlyTradesExpectedFirstTime);
  console.log('实际起始时间:', factors.earlyTradesDataFirstTime);
  console.log('缺口:', gap.toFixed(1), '秒');
  console.log('第一笔交易延迟:', delay.toFixed(1), '秒（相对于检查时间）');
  console.log('');

  // 判断数据是否正常
  console.log('=== 判断 ===');

  if (gap <= 0) {
    console.log('✓ 数据覆盖完整（缺口=0秒）');
  } else if (gap <= 10) {
    console.log('✓ 数据基本正常（缺口≤10秒，可能是代币创建后正常延迟）');
  } else if (gap <= 20) {
    console.log('⚠️  缺口较大（10-20秒），需要关注');
  } else {
    console.log('❌ 缺口很大（>20秒），数据可能有问题');
  }

  // 与其他代币比较
  console.log('\n=== 与其他代币比较 ===');

  // 获取所有代币的第一笔交易延迟
  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  const tokenFirstSignal = new Map();
  allSignals.forEach(s => {
    if (!tokenFirstSignal.has(s.token_address)) {
      const f = s.metadata?.preBuyCheckFactors;
      if (f && f.earlyTradesDataFirstTime !== undefined) {
        tokenFirstSignal.set(s.token_address, {
          symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
          delay: f.earlyTradesCheckTime - f.earlyTradesDataFirstTime
        });
      }
    }
  });

  const allDelays = Array.from(tokenFirstSignal.values()).map(t => t.delay).filter(d => d > 0);
  const avgDelay = allDelays.reduce((a, b) => a + b, 0) / allDelays.length;
  const maxDelay = Math.max(...allDelays);
  const minDelay = Math.min(...allDelays);
  const medianDelay = [...allDelays].sort((a, b) => a - b)[Math.floor(allDelays.length / 2)];

  console.log('所有代币的第一笔交易延迟:');
  console.log('  平均:', avgDelay.toFixed(1), '秒');
  console.log('  中位数:', medianDelay.toFixed(1), '秒');
  console.log('  最小:', minDelay.toFixed(1), '秒');
  console.log('  最大:', maxDelay.toFixed(1), '秒');
  console.log('');

  // 判断 1$ 代币的位置
  if (delay > avgDelay + 10) {
    console.log('❌ 1$ 代币的延迟远高于平均值，可能存在问题');
  } else if (delay > avgDelay + 5) {
    console.log('⚠️  1$ 代币的延迟略高于平均值');
  } else if (delay < avgDelay - 10) {
    console.log('✓ 1$ 代币的延迟远低于平均值（数据更完整）');
  } else {
    console.log('✓ 1$ 代币的延迟接近平均值，属于正常范围');
  }

  console.log('');
  console.log('=== 早期大户数据 ===');
  console.log('早期大户数量:', factors.earlyWhaleCount);
  console.log('早期大户方法:', factors.earlyWhaleMethod);
  console.log('早期大户持有率:', (factors.earlyWhaleHoldRatio * 100).toFixed(1) + '%');
  console.log('早期大户卖出率:', (factors.earlyWhaleSellRatio * 100).toFixed(1) + '%');
  console.log('总交易数:', factors.earlyWhaleTotalTrades);
  console.log('早期阈值:', factors.earlyWhaleEarlyThreshold);
  console.log('');

  if (factors.earlyWhaleCount === 0) {
    console.log('⚠️  早期大户数量=0');
    console.log('  说明: 在前30%交易中（90笔），没有钱包买入金额>$200');
    console.log('  这可能是因为:');
    console.log('    1. 早期交易金额都比较小');
    console.log('    2. 早期参与者分散，没有大户');
  }
}

checkDollarToken().catch(console.error);
