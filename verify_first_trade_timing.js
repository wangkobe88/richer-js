/**
 * 验证第一笔交易的时间
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verifyFirstTradeTiming() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组，取第一个信号的第一个检查时间
  const tokenFirstSignal = new Map();

  signals.forEach(s => {
    if (!tokenFirstSignal.has(s.token_address)) {
      const factors = s.metadata?.preBuyCheckFactors;
      if (factors && factors.earlyTradesDataFirstTime !== undefined) {
        tokenFirstSignal.set(s.token_address, {
          symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
          dataFirstTime: factors.earlyTradesDataFirstTime,
          checkTime: factors.earlyTradesCheckTime,
          dataLastTime: factors.earlyTradesDataLastTime,
          totalCount: factors.earlyTradesTotalCount
        });
      }
    }
  });

  const allTokens = Array.from(tokenFirstSignal.values());

  console.log('=== 验证第一笔交易时间 ===\n');
  console.log('总代币数:', allTokens.length);

  // 计算第一笔交易相对于检查时间的延迟
  const delays = allTokens.map(t => {
    if (t.dataFirstTime !== null && t.checkTime !== null) {
      return {
        symbol: t.symbol,
        delay: t.checkTime - t.dataFirstTime,
        dataFirstTime: t.dataFirstTime,
        checkTime: t.checkTime,
        span: t.dataLastTime - t.dataFirstTime
      };
    }
    return null;
  }).filter(t => t !== null);

  // 统计第一笔交易延迟的分布
  console.log('\n=== 第一笔交易延迟分布 ===');
  console.log('延迟 = 检查时间 - 第一笔交易时间\n');

  const delayBuckets = {
    '0-10秒': 0,
    '11-30秒': 0,
    '31-60秒': 0,
    '61-75秒': 0,
    '76-89秒': 0,
    '90秒': 0
  };

  delays.forEach(d => {
    if (d.delay >= 90) delayBuckets['90秒']++;
    else if (d.delay >= 76) delayBuckets['76-89秒']++;
    else if (d.delay >= 61) delayBuckets['61-75秒']++;
    else if (d.delay >= 31) delayBuckets['31-60秒']++;
    else if (d.delay >= 11) delayBuckets['11-30秒']++;
    else delayBuckets['0-10秒']++;
  });

  Object.entries(delayBuckets).forEach(([bucket, count]) => {
    const pct = (count / delays.length * 100).toFixed(1);
    console.log(`  ${bucket}: ${count}个 (${pct}%)`);
  });

  // 计算平均延迟
  const avgDelay = delays.reduce((sum, d) => sum + d.delay, 0) / delays.length;
  console.log(`\n平均延迟: ${avgDelay.toFixed(1)}秒`);

  // 分析：如果平均延迟接近 90 秒，说明数据窗口是完整的
  // 如果平均远小于 90 秒，说明第一笔交易确实有延迟
  console.log('\n=== 结论 ===');

  if (avgDelay >= 85) {
    console.log('✓ 大多数代币的数据窗口覆盖接近90秒');
    console.log('  说明数据基本完整，第一笔交易就在检查时间前90秒左右');
  } else if (avgDelay >= 60) {
    console.log('⚠️  大多数代币的数据窗口覆盖60-85秒');
    console.log('  说明第一笔交易通常在检查时间前 ' + avgDelay.toFixed(1) + ' 秒');
    console.log('  这可能是正常的：代币创建后需要一些时间才有第一笔交易');
  } else {
    console.log('⚠️  大多数代币的数据窗口明显小于90秒');
    console.log('  说明第一笔交易通常在检查时间前 ' + avgDelay.toFixed(1) + ' 秒');
    console.log('  可能原因:');
    console.log('    1. 代币创建后需要时间才有第一笔交易（正常）');
    console.log('    2. AVE API 数据延迟（需要确认）');
  }

  // 显示样本数据
  console.log('\n=== 样本数据（前10个）===');
  console.log('代币          | 数据跨度 | 第一笔延迟');
  console.log('-------------|----------|----------');
  delays.slice(0, 10).forEach(d => {
    console.log(`  ${d.symbol.padEnd(13)} | ${d.span.toFixed(1).padStart(8)}s | ${d.delay.toFixed(1).padStart(8)}s`);
  });
}

verifyFirstTradeTiming().catch(console.error);
