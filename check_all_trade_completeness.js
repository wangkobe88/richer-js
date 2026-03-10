/**
 * 检查所有代币的早期交易数据完整性
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkAllTradeCompleteness() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  console.log('=== 检查所有代币的早期交易数据完整性 ===\n');

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
        });
      }
    }
  });

  const allTokens = Array.from(tokenFirstSignal.values());

  console.log(`有早期交易数据的代币总数: ${allTokens.length}个\n`);

  let completeCount = 0;
  let incompleteCount = 0;
  let noDataCount = 0;

  const incompleteTokens = [];

  allTokens.forEach(t => {
    const hasData = t.dataFirst !== null && t.dataLast !== null;
    const isComplete = hasData && t.dataFirst <= t.expectedFirst;

    if (!hasData) {
      noDataCount++;
    } else if (isComplete) {
      completeCount++;
    } else {
      incompleteCount++;
      const gap = t.dataFirst - t.expectedFirst;
      incompleteTokens.push({ ...t, gap });
    }
  });

  console.log('=== 统计 ===');
  console.log(`数据完整: ${completeCount}个`);
  console.log(`数据不完整: ${incompleteCount}个`);
  console.log(`无数据: ${noDataCount}个`);

  if (incompleteCount > 0) {
    console.log('\n=== 数据不完整的代币详情 ===');
    console.log('代币          | 缺失秒数 | 实际跨度 | 交易数');
    console.log('-------------|----------|----------|--------');

    incompleteTokens.sort((a, b) => b.gap - a.gap).slice(0, 20).forEach(t => {
      console.log(`  ${t.symbol.padEnd(13)} | ${t.gap.toFixed(1).padStart(8)}s | ${t.actualSpan.toFixed(1).padStart(8)}s | ${t.totalCount}`);
    });

    if (incompleteTokens.length > 20) {
      console.log(`  ... 还有 ${incompleteTokens.length - 20} 个代币`);
    }

    console.log('\n⚠️  警告: 这些代币的早期交易数据不完整！');
    console.log('可能原因: API单次返回限制(300条)，高频交易时无法获取完整时间窗口');
  }

  // 检查 earlyTradesTotalCount=300 且不完整的情况
  console.log('\n=== earlyTradesTotalCount=300 且数据不完整 ===');
  const totalCount300Incomplete = incompleteTokens.filter(t => t.totalCount === 300);
  if (totalCount300Incomplete.length > 0) {
    console.log('这类代币数量:', totalCount300Incomplete.length);
    totalCount300Incomplete.forEach(t => {
      console.log(`  ${t.symbol}: 缺失 ${t.gap.toFixed(1)}s`);
    });
  } else {
    console.log('无');
  }
}

checkAllTradeCompleteness().catch(console.error);
