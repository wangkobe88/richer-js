/**
 * 分析数据缺失的原因
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeDataGap() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  // 按代币分组，取第一个信号
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
          checkTime: factors.earlyTradesCheckTime,
          signalTime: Math.floor(new Date(s.created_at).getTime() / 1000)
        });
      }
    }
  });

  const allTokens = Array.from(tokenFirstSignal.values());

  // 分析数据缺口
  console.log('=== 数据缺口分析 ===\n');

  // 计算缺口分布
  const gapRanges = {
    '0秒': 0,
    '1-5秒': 0,
    '6-10秒': 0,
    '11-15秒': 0,
    '16-20秒': 0,
    '20+秒': 0
  };

  allTokens.forEach(t => {
    if (t.dataFirst !== null) {
      const gap = t.dataFirst - t.expectedFirst;
      if (gap <= 0) gapRanges['0秒']++;
      else if (gap <= 5) gapRanges['1-5秒']++;
      else if (gap <= 10) gapRanges['6-10秒']++;
      else if (gap <= 15) gapRanges['11-15秒']++;
      else if (gap <= 20) gapRanges['16-20秒']++;
      else gapRanges['20+秒']++;
    }
  });

  console.log('缺口分布:');
  Object.entries(gapRanges).forEach(([range, count]) => {
    console.log(`  ${range}: ${count}个`);
  });

  // 检查信号时间与检查时间的关系
  console.log('\n=== 信号时间 vs 检查时间 ===');
  const timeDiffSamples = allTokens.slice(0, 10).map(t => {
    const diff = t.signalTime - t.checkTime;
    return {
      symbol: t.symbol,
      checkTime: t.checkTime,
      signalTime: t.signalTime,
      diff: diff
    };
  });

  console.log('前10个代币的时间差（信号时间 - 检查时间）:');
  timeDiffSamples.forEach(t => {
    console.log(`  ${t.symbol.padEnd(12)} | 信号:${t.signalTime} 检查:${t.checkTime} 差:${t.diff}秒`);
  });

  // 检查是否所有代币的检查时间都相同
  const uniqueCheckTimes = new Set(allTokens.map(t => t.checkTime));
  console.log('\n唯一的检查时间数量:', uniqueCheckTimes.size);

  // 分析：如果 checkTime 是固定的历史时间戳，而 dataFirst 总是晚于 expectedFirst
  // 说明 AVE API 在那个历史时间点可能没有完整的数据
  console.log('\n=== 可能的原因分析 ===');

  const incompleteTokens = allTokens.filter(t => t.dataFirst !== null && t.dataFirst > t.expectedFirst);

  if (incompleteTokens.length > 0) {
    // 检查缺口是否一致
    const gaps = incompleteTokens.map(t => t.dataFirst - t.expectedFirst);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);

    console.log(`数据不完整的代币: ${incompleteTokens.length}个`);
    console.log(`缺口范围: ${minGap.toFixed(1)}秒 - ${maxGap.toFixed(1)}秒`);
    console.log(`平均缺口: ${avgGap.toFixed(1)}秒`);

    if (maxGap - minGap < 5) {
      console.log('\n⚠️  缺口大小非常接近！');
      console.log('这说明: AVE API 在回测时使用的历史数据有固定的起始延迟');
      console.log('可能原因:');
      console.log('  1. AVE API 只存储了最近 N 秒的数据');
      console.log('  2. 回测时使用的是实时快照，而不是完整历史数据');
      console.log('  3. 代币创建后确实需要几秒钟才会有第一笔交易');
    }
  }
}

analyzeDataGap().catch(console.error);
