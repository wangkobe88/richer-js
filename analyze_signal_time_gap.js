/**
 * 分析信号时间和代币创建时间的差距
 * 确定90秒回溯窗口是否足够覆盖早期交易
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const experiments = [
  { id: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '实验1' },
  { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', name: '实验2' }
];

async function analyzeSignalTimeGap() {
  console.log('=== 分析信号时间与代币创建时间的差距 ===\n');

  const results = [];

  for (const exp of experiments) {
    console.log(`处理 ${exp.name}...`);

    // 获取所有买入信号
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    console.log(`  找到 ${executedSignals.length} 个执行的信号`);

    for (const signal of executedSignals) {
      const signalCreatedAt = new Date(signal.created_at).getTime() / 1000;
      const tokenAddress = signal.token_address;
      const symbol = signal.metadata?.symbol || tokenAddress.substring(0, 8);

      // 获取代币创建时间
      const { data: tokens } = await supabase
        .from('experiment_tokens')
        .select('created_at')
        .eq('token_address', tokenAddress)
        .eq('experiment_id', exp.id)
        .limit(1);

      if (!tokens || tokens.length === 0) {
        continue;
      }

      const tokenCreatedAt = new Date(tokens[0].created_at).getTime() / 1000;
      const timeGap = signalCreatedAt - tokenCreatedAt;

      // 获取收益数据
      const { data: sellTrades } = await supabase
        .from('trades')
        .select('metadata')
        .eq('experiment_id', exp.id)
        .eq('token_address', tokenAddress)
        .eq('trade_direction', 'sell')
        .not('metadata->>profitPercent', 'is', null)
        .limit(1);

      const profitPercent = sellTrades && sellTrades.length > 0
        ? sellTrades[0].metadata?.profitPercent
        : null;

      // 获取早期交易检查时间
      const preBuyCheckTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;

      results.push({
        symbol,
        tokenAddress,
        tokenCreatedAt,
        signalCreatedAt,
        timeGap,
        profitPercent,
        preBuyCheckTime,
        within90s: timeGap <= 90,
        within120s: timeGap <= 120,
        within180s: timeGap <= 180
      });
    }
  }

  // 分析结果
  console.log(`\n总共分析 ${results.length} 个代币\n`);

  // 时间差分布
  const gaps = results.map(r => r.timeGap).sort((a, b) => a - b);

  console.log('时间差统计（秒）:');
  console.log(`  最小值: ${gaps[0].toFixed(1)}s`);
  console.log(`  最大值: ${gaps[gaps.length - 1].toFixed(1)}s`);
  console.log(`  中位数: ${gaps[Math.floor(gaps.length / 2)].toFixed(1)}s`);
  console.log(`  平均值: ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)}s`);

  // 覆盖率分析
  const within90s = results.filter(r => r.timeGap <= 90);
  const within120s = results.filter(r => r.timeGap <= 120);
  const within180s = results.filter(r => r.timeGap <= 180);

  console.log('\n回溯窗口覆盖率:');
  console.log(`  90秒窗口: ${within90s.length}/${results.length} (${(within90s.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  120秒窗口: ${within120s.length}/${results.length} (${(within120s.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  180秒窗口: ${within180s.length}/${results.length} (${(within180s.length / results.length * 100).toFixed(1)}%)`);

  // 分区间分析
  const ranges = [
    { max: 60, label: '0-60s' },
    { max: 90, label: '60-90s' },
    { max: 120, label: '90-120s' },
    { max: 180, label: '120-180s' },
    { max: Infinity, label: '>180s' }
  ];

  console.log('\n时间差分布:');
  let prevMax = 0;
  for (const range of ranges) {
    const count = results.filter(r => r.timeGap > prevMax && r.timeGap <= range.max).length;
    const profitCount = results.filter(r => r.timeGap > prevMax && r.timeGap <= range.max && r.profitPercent > 0).length;
    const lossCount = results.filter(r => r.timeGap > prevMax && r.timeGap <= range.max && r.profitPercent !== null && r.profitPercent <= 0).length;
    console.log(`  ${range.label}: ${count}个代币 (盈利:${profitCount}, 亏损:${lossCount})`);
    prevMax = range.max;
  }

  // 分析未覆盖的代币
  const notCovered = results.filter(r => r.timeGap > 90);
  if (notCovered.length > 0) {
    console.log(`\n超出90秒窗口的 ${notCovered.length} 个代币:`);
    console.log('  代币          | 时间差  | 收益率');
    console.log('  --------------|--------|-------');
    notCovered.forEach(r => {
      const profit = r.profitPercent !== null
        ? (r.profitPercent > 0 ? `+${r.profitPercent.toFixed(1)}%` : `${r.profitPercent.toFixed(1)}%`)
        : 'N/A';
      console.log(`  ${r.symbol.padEnd(14)} | ${r.timeGap.toFixed(1).padStart(6)}s | ${profit.padStart(6)}`);
    });
  }

  // 关键结论
  console.log('\n=== 关键结论 ===\n');

  if (within90s.length >= results.length * 0.8) {
    console.log('✓ 90秒窗口覆盖率超过80%，可以使用当前分析方法');
  } else if (within120s.length >= results.length * 0.8) {
    console.log('⚠ 90秒窗口不足，建议扩展到120秒');
  } else if (within180s.length >= results.length * 0.8) {
    console.log('⚠ 90秒窗口严重不足，建议扩展到180秒');
  } else {
    console.log('✗ 即使180秒窗口也无法覆盖大部分代币，需要替代方案');
  }

  console.log('\n=== 替代方案建议 ===\n');

  console.log('如果当前回溯窗口不足，可以考虑以下替代方案：');
  console.log('');
  console.log('方案1: 相对交易位置（推荐）');
  console.log('  - 不依赖绝对时间，而是使用"我们观察到的前30笔交易"');
  console.log('  - 优点: 无需担心是否覆盖代币创建时间');
  console.log('  - 缺点: 如果数据太晚，可能错过真正的早期大户');
  console.log('');
  console.log('方案2: 调整回溯窗口');
  console.log(`  - 当前: 90秒，覆盖率 ${(within90s.length / results.length * 100).toFixed(1)}%`);
  console.log(`  - 120秒: 覆盖率 ${(within120s.length / results.length * 100).toFixed(1)}%`);
  console.log(`  - 180秒: 覆盖率 ${(within180s.length / results.length * 100).toFixed(1)}%`);
  console.log('');
  console.log('方案3: 条件性跳过');
  console.log('  - 只有当 signalTime - tokenCreateTime < 90s 时才计算该因子');
  console.log('  - 优点: 不会使用不完整数据');
  console.log('  - 缺点: 部分代币无法被过滤');
  console.log('');
  console.log('方案4: 多阶段检查');
  console.log('  - 第一次检查: 快速过滤明显的拉砸代币');
  console.log('  - 第二次检查: 等待更多数据后进行大户行为分析');
  console.log('  - 优点: 平衡速度和准确性');
  console.log('');

  return results;
}

analyzeSignalTimeGap().catch(console.error);
