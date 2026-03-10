/**
 * 检查 earlyTradesTotalCount=300 的代币，数据是否完整
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTradeCompleteness() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  console.log('=== 检查 earlyTradesTotalCount=300 的代币数据完整性 ===\n');

  const tokenFirstSignal = new Map();

  signals.forEach(s => {
    if (!tokenFirstSignal.has(s.token_address)) {
      const factors = s.metadata?.preBuyCheckFactors;
      if (factors && factors.earlyTradesTotalCount !== undefined) {
        tokenFirstSignal.set(s.token_address, {
          symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
          totalCount: factors.earlyTradesTotalCount,
          expectedFirst: factors.earlyTradesExpectedFirstTime,
          expectedLast: factors.earlyTradesExpectedLastTime,
          dataFirst: factors.earlyTradesDataFirstTime,
          dataLast: factors.earlyTradesDataLastTime,
          actualSpan: factors.earlyTradesActualSpan,
          coverage: factors.earlyTradesDataCoverage,
          whaleCount: factors.earlyWhaleCount,
          whaleMethod: factors.earlyWhaleMethod,
          whaleTotalTrades: factors.earlyWhaleTotalTrades,
          whaleThreshold: factors.earlyWhaleEarlyThreshold
        });
      }
    }
  });

  const totalCount300 = Array.from(tokenFirstSignal.values()).filter(t => t.totalCount === 300);

  console.log(`earlyTradesTotalCount=300 的代币: ${totalCount300.length}个\n`);

  let completeCount = 0;
  let incompleteCount = 0;

  totalCount300.forEach(t => {
    const expectedWindow = t.expectedLast - t.expectedFirst;
    const actualWindow = t.dataLast - t.dataFirst;
    const isComplete = t.dataFirst !== null && t.dataFirst <= t.expectedFirst;
    const gap = t.dataFirst !== null ? (t.dataFirst - t.expectedFirst).toFixed(1) : 'N/A';

    if (isComplete) {
      completeCount++;
    } else {
      incompleteCount++;
    }

    console.log(`${t.symbol}:`);
    console.log(`  预期窗口: ${t.expectedFirst} - ${t.expectedLast} (${expectedWindow}s)`);
    console.log(`  实际窗口: ${t.dataFirst} - ${t.dataLast} (${actualWindow?.toFixed(1)}s)`);
    console.log(`  实际跨度: ${t.actualSpan}s`);
    console.log(`  覆盖完整: ${isComplete ? '是 ✓' : '否 ✗ (差距: ' + gap + 's)'}`);
    console.log(`  早期大户: ${t.whaleCount}个, 方法: ${t.whaleMethod}, 总交易: ${t.whaleTotalTrades}, 阈值: ${t.whaleThreshold}`);
    console.log('');
  });

  console.log('=== 统计 ===');
  console.log(`数据完整: ${completeCount}个`);
  console.log(`数据不完整: ${incompleteCount}个`);

  if (incompleteCount > 0) {
    console.log('\n⚠️  警告: 有代币的早期交易数据可能不完整！');
    console.log('可能原因: API返回达到300条上限，但还未覆盖完整90秒窗口');
  }
}

checkTradeCompleteness().catch(console.error);
