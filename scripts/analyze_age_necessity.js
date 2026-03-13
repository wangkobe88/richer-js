/**
 * 分析加入 age 条件是否有额外价值
 * 对比三个组合：
 * 1. earlyReturn < 300% AND earlyTradesCountPerMin < 300
 * 2. 上述条件 AND age > 1.5
 * 3. 上述条件 AND age > 2.0
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

async function main() {
  console.log('=== 分析 age 条件的必要性 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取数据
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', expId);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true);

  // 计算收益
  const tokenProfits = {};
  for (const trade of trades || []) {
    const addr = trade.token_address;
    if (!tokenProfits[addr]) {
      tokenProfits[addr] = { symbol: trade.token_symbol, spent: 0, received: 0 };
    }
    if (trade.trade_direction === 'buy') {
      tokenProfits[addr].spent += parseFloat(trade.input_amount || 0);
    } else {
      tokenProfits[addr].received += parseFloat(trade.output_amount || 0);
    }
  }

  const data = (signals || []).map(s => {
    const p = tokenProfits[s.token_address] || { spent: 0, received: 0 };
    const profit = p.spent > 0 ? ((p.received - p.spent) / p.spent * 100) : 0;
    return {
      address: s.token_address,
      symbol: s.token_symbol,
      profit,
      trendFactors: s.metadata?.trendFactors || {},
      preBuyCheckFactors: s.metadata?.preBuyCheckFactors || {}
    };
  });

  const allProfits = data.map(d => d.profit);
  const allWinRate = (allProfits.filter(p => p > 0).length / data.length * 100);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【不同条件组合对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('条件'.padEnd(60) + '数量'.padEnd(8) + '胜率'.padEnd(10) + '平均收益');
  console.log('─'.repeat(95));

  // 基础条件
  const baseFilter = (d) => {
    const ear = d.trendFactors.earlyReturn || 0;
    const count = d.preBuyCheckFactors.earlyTradesCountPerMin || 0;
    return ear < 300 && count < 300;
  };

  const base = data.filter(baseFilter);
  const baseProfits = base.map(d => d.profit);
  const baseWinRate = (baseProfits.filter(p => p > 0).length / base.length * 100);

  console.log(
    'A: EAR<300 AND Count<300'.padEnd(60) +
    base.length.toString().padEnd(8) +
    `${baseWinRate.toFixed(1)}%`.padEnd(10) +
    `${avg(baseProfits).toFixed(2)}%`
  );

  // 加入 age > 1.5
  const age15 = data.filter(d => baseFilter(d) && (d.trendFactors.age || 0) > 1.5);
  const age15Profits = age15.map(d => d.profit);
  const age15WinRate = (age15Profits.filter(p => p > 0).length / age15.length * 100);

  console.log(
    'B: A AND age>1.5'.padEnd(60) +
    age15.length.toString().padEnd(8) +
    `${age15WinRate.toFixed(1)}%`.padEnd(10) +
    `${avg(age15Profits).toFixed(2)}%`
  );

  // 加入 age > 2.0
  const age20 = data.filter(d => baseFilter(d) && (d.trendFactors.age || 0) > 2.0);
  const age20Profits = age20.map(d => d.profit);
  const age20WinRate = (age20Profits.filter(p => p > 0).length / age20.length * 100);

  console.log(
    'C: A AND age>2.0'.padEnd(60) +
    age20.length.toString().padEnd(8) +
    `${age20WinRate.toFixed(1)}%`.padEnd(10) +
    `${avg(age20Profits).toFixed(2)}%`
  );

  // 原始数据
  console.log(
    '原始（无过滤）'.padEnd(60) +
    data.length.toString().padEnd(8) +
    `${allWinRate.toFixed(1)}%`.padEnd(10) +
    `${avg(allProfits).toFixed(2)}%`
  );

  // 分析 age 条件是否必要
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 条件A中被 age<=1.5 过滤掉的代币
  const youngInA = base.filter(d => (d.trendFactors.age || 0) <= 1.5);
  const youngInAProfits = youngInA.map(d => d.profit);
  const youngInAWinRate = (youngInAProfits.filter(p => p > 0).length / youngInA.length * 100);

  console.log(`在条件A中，age <= 1.5 的代币:`);
  console.log(`  数量: ${youngInA.length} 个 (占条件A的 ${(youngInA.length/base.length*100).toFixed(1)}%)`);
  console.log(`  胜率: ${youngInAWinRate.toFixed(1)}%`);
  console.log(`  平均收益: ${avg(youngInAProfits).toFixed(2)}%`);

  if (youngInA.length > 0) {
    console.log(`\n  这些"年轻"代币详情:`);
    youngInA.sort((a, b) => b.profit - a.profit).forEach(d => {
      const age = d.trendFactors.age || 0;
      const ear = d.trendFactors.earlyReturn || 0;
      const count = d.preBuyCheckFactors.earlyTradesCountPerMin || 0;
      console.log(`    ${d.symbol.padEnd(20)} 收益:${d.profit.toFixed(2).padStart(7)}%  age:${age.toFixed(2)}min  EAR:${ear.toFixed(0)}%  Cnt:${count.toFixed(0)}`);
    });
  }

  // 条件A中被 age<=2.0 过滤掉的代币
  const youngInA2 = base.filter(d => (d.trendFactors.age || 0) <= 2.0);
  const youngInA2Profits = youngInA2.map(d => d.profit);
  const youngInA2WinRate = (youngInA2Profits.filter(p => p > 0).length / youngInA2.length * 100);

  console.log(`\n在条件A中，age <= 2.0 的代币:`);
  console.log(`  数量: ${youngInA2.length} 个 (占条件A的 ${(youngInA2.length/base.length*100).toFixed(1)}%)`);
  console.log(`  胜率: ${youngInA2WinRate.toFixed(1)}%`);
  console.log(`  平均收益: ${avg(youngInA2Profits).toFixed(2)}%`);

  // 总结
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【结论】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const aToB_improvement = avg(age15Profits) - avg(baseProfits);
  const aToC_improvement = avg(age20Profits) - avg(baseProfits);

  console.log(`加入 age>1.5 条件后:`);
  console.log(`  数量减少: ${base.length} → ${age15.length} (-${base.length - age15.length})`);
  console.log(`  收益变化: ${avg(baseProfits).toFixed(2)}% → ${avg(age15Profits).toFixed(2)}% (${aToB_improvement >= 0 ? '+' : ''}${aToB_improvement.toFixed(2)}%)`);

  console.log(`\n加入 age>2.0 条件后:`);
  console.log(`  数量减少: ${base.length} → ${age20.length} (-${base.length - age20.length})`);
  console.log(`  收益变化: ${avg(baseProfits).toFixed(2)}% → ${avg(age20Profits).toFixed(2)}% (${aToC_improvement >= 0 ? '+' : ''}${aToC_improvement.toFixed(2)}%)`);

  console.log(`\n建议:`);
  if (aToC_improvement > 2) {
    console.log(`  ✅ 加入 age>2.0 条件有明显改善，建议采用。`);
  } else if (aToB_improvement > 1) {
    console.log(`  ⚠️ 加入 age>1.5 条件有轻微改善，可以考虑。`);
  } else if (aToC_improvement < -2) {
    console.log(`  ❌ 加入 age 条件会降低收益，不建议采用。`);
  } else {
    console.log(`  ➤ age 条件影响不大，可以不加。`);
  }
}

main().catch(console.error);
