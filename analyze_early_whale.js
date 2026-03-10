/**
 * 分析 1$ 代币的早期大户数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeEarlyWhale() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  console.log('=== 1$ 代币早期大户分析 ===\n');

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
    console.log('  earlyWhaleTotalTrades:', factors.earlyWhaleTotalTrades);
    console.log('');

    console.log('早期交易数据:');
    console.log('  earlyTradesTotalCount:', factors.earlyTradesTotalCount);
    console.log('  earlyTradesDataFirstTime:', factors.earlyTradesDataFirstTime);
    console.log('  earlyTradesDataLastTime:', factors.earlyTradesDataLastTime);
    console.log('  earlyTradesActualSpan:', factors.earlyTradesActualSpan);
    console.log('  earlyTradesCountPerMin:', factors.earlyTradesCountPerMin);
    console.log('');

    // 分析原因
    console.log('=== 分析 ===\n');

    if (factors.earlyWhaleCount === 0) {
      console.log('earlyWhaleCount = 0 说明：');
      console.log('  在早期窗口内（前30%交易），没有钱包买入金额 > $200');
      console.log('');

      // 计算早期交易数
      const earlyThreshold = factors.earlyWhaleEarlyThreshold || Math.floor(factors.earlyTradesTotalCount * 0.3);
      console.log('早期交易阈值（前30%）:', earlyThreshold, '笔');

      if (factors.earlyTradesTotalCount === 300) {
        console.log('  总交易数:', factors.earlyTradesTotalCount);
        console.log('  前30% ≈ 90笔交易');
        console.log('');

        // 检查交易金额分布
        console.log('可能的原因：');
        console.log('  1. 前90笔交易的金额都 <= $200');
        console.log('  2. 这个代币的早期参与者都是小额买入');
        console.log('  3. 可能是散户参与，没有大户早期入场');
      }

      console.log('');
      console.log('关于 earlyWhaleSellRatio = 0：');
      console.log('  当 earlyWhaleCount = 0 时，默认 sellRatio = 0');
      console.log('  这意味着：没有早期大户，也就没有大户卖出的数据');
    }

    console.log('');
    break; // 只分析第一个信号
  }

  // 检查代码逻辑
  console.log('=== 检查 EarlyWhaleService 的逻辑 ===\n');
  console.log('当 earlyWhaleCount = 0 时，earlyWhaleSellRatio 应该是多少？\n');
  console.log('让我查看代码...');

  // 读取 EarlyWhaleService 的代码
  const fs = require('fs');
  const code = fs.readFileSync('./src/trading-engine/pre-check/EarlyWhaleService.js', 'utf-8');

  // 查找 _getEmptyResult
  const emptyResultMatch = code.match(/_getEmptyResult[^{]*\{[\s\S]*?\n  \}/);
  if (emptyResultMatch) {
    console.log('\n_getEmptyResult 方法（当没有早期大户时）:');
    console.log(emptyResultMatch[0]);
  }

  // 查找 earlyWhaleSellRatio 的计算逻辑
  const sellRatioMatch = code.match(/earlyWhaleSellRatio[^;]*;?/g);
  if (sellRatioMatch) {
    console.log('\nearlyWhaleSellRatio 相关代码:');
    sellRatioMatch.forEach(line => console.log('  ', line.trim()));
  }
}

analyzeEarlyWhale().catch(console.error);
