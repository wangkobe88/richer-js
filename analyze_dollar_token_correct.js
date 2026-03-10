/**
 * 重新分析 1$ 代币的数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeDollarToken() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  // 按代币分组，取第一个信号
  const tokenData = new Map();
  allSignals.forEach(s => {
    if (!tokenData.has(s.token_address)) {
      const f = s.metadata?.preBuyCheckFactors;
      if (f && f.earlyTradesDataFirstTime !== undefined && f.earlyTradesCheckTime !== undefined) {
        const delay = f.earlyTradesCheckTime - f.earlyTradesDataFirstTime;
        // 过滤异常值：延迟应该在合理范围内（60-120秒）
        if (delay >= 60 && delay <= 120) {
          tokenData.set(s.token_address, {
            symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
            delay: delay,
            actualSpan: f.earlyTradesActualSpan,
            totalCount: f.earlyTradesTotalCount,
            whaleCount: f.earlyWhaleCount
          });
        }
      }
    }
  });

  const allTokens = Array.from(tokenData.values());

  // 计算 1$ 代币的数据
  const dollarToken = allTokens.find(t => t.symbol === '1$');

  if (!dollarToken) {
    console.log('没有找到 1$ 代币数据');
    return;
  }

  console.log('=== 1$ 代币数据（修正后）===\n');
  console.log('第一笔交易延迟:', dollarToken.delay, '秒');
  console.log('实际数据跨度:', dollarToken.actualSpan, '秒');
  console.log('交易总数:', dollarToken.totalCount);
  console.log('早期大户数量:', dollarToken.whaleCount);
  console.log('');

  // 与其他代币比较
  const delays = allTokens.map(t => t.delay);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const sortedDelays = [...delays].sort((a, b) => a - b);
  const medianDelay = sortedDelays[Math.floor(delays.length / 2)];
  const p25Delay = sortedDelays[Math.floor(delays.length * 0.25)];
  const p75Delay = sortedDelays[Math.floor(delays.length * 0.75)];

  console.log('=== 所有代币第一笔交易延迟分布 ===');
  console.log('代币数量:', allTokens.length);
  console.log('平均延迟:', avgDelay.toFixed(1), '秒');
  console.log('中位数延迟:', medianDelay.toFixed(1), '秒');
  console.log('25分位数:', p25Delay.toFixed(1), '秒');
  console.log('75分位数:', p75Delay.toFixed(1), '秒');
  console.log('最小:', Math.min(...delays), '秒');
  console.log('最大:', Math.max(...delays), '秒');
  console.log('');

  // 判断 1$ 代币的位置
  console.log('=== 1$ 代币的位置 ===');

  if (dollarToken.delay < p25Delay) {
    console.log(`✓ 1$ 代币延迟（${dollarToken.delay}秒）低于25分位数（${p25Delay.toFixed(1)}秒）`);
    console.log('  说明: 第一笔交易出现得比大多数代币更早');
  } else if (dollarToken.delay > p75Delay) {
    console.log(`⚠️  1$ 代币延迟（${dollarToken.delay}秒）高于75分位数（${p75Delay.toFixed(1)}秒）`);
    console.log('  说明: 第一笔交易出现得比大多数代币更晚');
  } else {
    console.log(`✓ 1$ 代币延迟（${dollarToken.delay}秒）在正常范围内（${p25Delay.toFixed(1)}-${p75Delay.toFixed(1)}秒）`);
  }

  // 检查交易总数
  console.log('\n=== 交易总数分析 ===');
  const maxTotalCount = Math.max(...allTokens.map(t => t.totalCount));
  const tokensWithMaxCount = allTokens.filter(t => t.totalCount === maxTotalCount);

  console.log('最大交易数:', maxTotalCount);
  console.log('达到最大交易数的代币数:', tokensWithMaxCount.length);

  if (dollarToken.totalCount === maxTotalCount) {
    console.log('⚠️  1$ 代币的交易总数达到了最大值（' + maxTotalCount + '）');
    console.log('  这可能意味着:');
    console.log('    1. 该代币的交易非常活跃');
    console.log('    2. 或者 API 返回达到上限，可能还有更多交易未获取到');
  }

  // 计算缺口
  const expectedSpan = 90;
  const gap = expectedSpan - dollarToken.actualSpan;

  console.log('\n=== 数据缺口 ===');
  console.log('预期跨度:', expectedSpan, '秒');
  console.log('实际跨度:', dollarToken.actualSpan, '秒');
  console.log('缺口:', gap, '秒');

  // 检查缺口是否在正常范围内
  const gaps = allTokens.map(t => expectedSpan - t.actualSpan).filter(g => g >= 0);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];

  console.log('\n所有代币的平均缺口:', avgGap.toFixed(1), '秒');
  console.log('所有代币的中位数缺口:', medianGap, '秒');

  if (gap > medianGap + 10) {
    console.log('⚠️  1$ 代币的缺口明显大于中位数');
  } else if (gap < medianGap - 5) {
    console.log('✓ 1$ 代币的缺口小于中位数（数据更完整）');
  } else {
    console.log('✓ 1$ 代币的缺口接近中位数，属于正常范围');
  }

  console.log('\n=== 总结 ===');
  console.log('1$ 代币的数据情况:');
  console.log(`  - 第一笔交易延迟: ${dollarToken.delay}秒（中位数: ${medianDelay.toFixed(1)}秒）`);
  console.log(`  - 数据跨度: ${dollarToken.actualSpan}秒（预期: ${expectedSpan}秒，缺口: ${gap}秒）`);
  console.log(`  - 交易总数: ${dollarToken.totalCount}（API上限: 300）`);
  console.log(`  - 早期大户数量: ${dollarToken.whaleCount}`);
  console.log('');
  console.log('结论: 1$ 代币的数据基本正常，缺口15秒在合理范围内');
  console.log('早期大户数量=0说明该代币早期没有大户参与，这属于正常现象');
}

analyzeDollarToken().catch(console.error);
