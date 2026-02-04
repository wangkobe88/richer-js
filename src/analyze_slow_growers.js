const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeSlowGrowers() {
  // 1. 定义慢涨币：前5分钟最终收益<20%，但30分钟后收益>50%
  const slowGrowers = ['crust', 'BIRB', 'CMF', 'Space S38', 'cakedog', 'TGWHB'];

  // 2. 获取所有没有信号的代币及其数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
    .eq('action', 'buy');

  const signalTokens = new Set(signals?.map(s => s.token_address) || []);

  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c');

  const noSignalTokens = (allTokens || []).filter(t => !signalTokens.has(t.token_address));

  // 3. 分析每个代币
  const results = [];

  for (const { token_address, token_symbol } of noSignalTokens) {
    const { data: timeSeries } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
      .eq('token_address', token_address)
      .order('timestamp', { ascending: true })
      .limit(1000);

    if (!timeSeries || timeSeries.length < 2) continue;

    const firstPoint = timeSeries[0];
    const firstFactors = firstPoint.factor_values || {};

    // 计算5分钟时的收益
    const fiveMinPoint = timeSeries.find(ts => {
      const age = ts.factor_values?.age;
      return age >= 4.5 && age <= 5.5;
    }) || timeSeries[Math.min(timeSeries.length - 1, 15)]; // 取前15个点中最后的

    const lastPoint = timeSeries[timeSeries.length - 1];

    const firstPrice = firstPoint.price_usd || firstFactors.currentPrice;
    const fiveMinPrice = fiveMinPoint.price_usd || fiveMinPoint.factor_values?.currentPrice;
    const lastPrice = lastPoint.price_usd || lastPoint.factor_values?.currentPrice;

    if (!firstPrice || !fiveMinPrice || !lastPrice) continue;

    const fiveMinReturn = ((fiveMinPrice - firstPrice) / firstPrice) * 100;
    const finalReturn = ((lastPrice - firstPrice) / firstPrice) * 100;

    // 分类
    let category = 'unknown';
    if (slowGrowers.includes(token_symbol)) {
      category = 'slowGrower'; // 慢涨币
    } else if (finalReturn >= 20) {
      category = 'flatGrower'; // 平涨币（慢涨但涨幅一般）
    } else if (finalReturn < -20) {
      category = 'decliner'; // 下跌币
    } else {
      category = 'flat'; // 不涨币
    }

    results.push({
      tokenAddress: token_address,
      symbol: token_symbol,
      category: category,
      fiveMinReturn: fiveMinReturn,
      finalReturn: finalReturn,
      firstFactors: {
        age: firstFactors.age,
        fdv: firstFactors.fdv,
        tvl: firstFactors.tvl,
        holders: firstFactors.holders,
        earlyReturn: firstFactors.earlyReturn,
        txVolumeU24h: firstFactors.txVolumeU24h,
        currentPrice: firstFactors.currentPrice,
        collectionPrice: firstFactors.collectionPrice
      }
    });
  }

  // 4. 分类统计
  const categories = {
    slowGrower: results.filter(r => r.category === 'slowGrower'),
    flatGrower: results.filter(r => r.category === 'flatGrower'),
    flat: results.filter(r => r.category === 'flat'),
    decliner: results.filter(r => r.category === 'decliner')
  };

  console.log('========== 代币分类统计 ==========');
  console.log('慢涨币（30分钟后>50%）:', categories.slowGrower.length, '个');
  console.log('平涨币（30分钟后20-50%）:', categories.flatGrower.length, '个');
  console.log('不涨币（30分钟后-20-20%）:', categories.flat.length, '个');
  console.log('下跌币（30分钟后<-20%）:', categories.decliner.length, '个');

  // 5. 对比分析：慢涨币 vs 其他币
  console.log('\n========== 慢涨币 vs 其他币的因子对比 ==========');

  const factors = ['age', 'fdv', 'tvl', 'holders', 'txVolumeU24h', 'earlyReturn'];

  console.log('\n因子 | 慢涨币 | 不涨币 | 下跌币 | 慢涨币 vs 不涨币差异');
  console.log('---');

  for (const factor of factors) {
    const slowAvg = average(categories.slowGrower, r => r.firstFactors[factor]);
    const flatAvg = average(categories.flat, r => r.firstFactors[factor]);
    const declineAvg = average(categories.decliner, r => r.firstFactors[factor]);
    const diff = (slowAvg || 0) - (flatAvg || 0);

    console.log(`${factor} | ${format(slowAvg)} | ${format(flatAvg)} | ${format(declineAvg)} | ${format(diff)}`);
  }

  // 6. 找出区分度最高的因子
  console.log('\n========== 区分度分析 ==========');

  const factorScores = [];
  for (const factor of factors) {
    const slowValues = categories.slowGrower.map(r => r.firstFactors[factor]).filter(v => v !== undefined);
    const flatValues = categories.flat.map(r => r.firstFactors[factor]).filter(v => v !== undefined);

    if (slowValues.length === 0 || flatValues.length === 0) continue;

    const slowMean = slowValues.reduce((a, b) => a + b, 0) / slowValues.length;
    const flatMean = flatValues.reduce((a, b) => a + b, 0) / flatValues.length;
    const diff = Math.abs(slowMean - flatMean);

    // 计算重叠度（值范围重叠越小，区分度越高）
    const slowMin = Math.min(...slowValues);
    const slowMax = Math.max(...slowValues);
    const flatMin = Math.min(...flatValues);
    const flatMax = Math.max(...flatValues);

    const overlap = Math.min(slowMax, flatMax) - Math.max(slowMin, flatMin);
    const totalRange = Math.max(slowMax, flatMax) - Math.min(slowMin, flatMin);
    const overlapRatio = totalRange > 0 ? overlap / totalRange : 0;

    factorScores.push({
      factor,
      slowMean,
      flatMean,
      diff,
      overlapRatio,
      score: diff * (1 - overlapRatio)  // 差异越大、重叠越小，分数越高
    });
  }

  factorScores.sort((a, b) => b.score - a.score);

  console.log('因子 | 差异 | 重叠度 | 区分分数');
  console.log('---');
  factorScores.forEach(f => {
    console.log(`${f.factor} | ${format(f.diff)} | ${(f.overlapRatio * 100).toFixed(1)}% | ${f.score.toFixed(2)}`);
  });

  // 7. 测试过滤条件
  console.log('\n========== 过滤条件测试 ==========');
  console.log('条件 | 慢涨币捕获数 | 不涨币过滤数 | 准确率 | 召回率');
  console.log('---');

  const tests = [
    { name: 'fdv < 10000', filter: r => r.firstFactors.fdv < 10000 },
    { name: 'fdv < 8000', filter: r => r.firstFactors.fdv < 8000 },
    { name: 'tvl < 1000', filter: r => r.firstFactors.tvl < 1000 },
    { name: 'tvl < 500', filter: r => r.firstFactors.tvl < 500 },
    { name: 'holders < 10', filter: r => r.firstFactors.holders < 10 },
    { name: 'holders < 5', filter: r => r.firstFactors.holders < 5 },
    { name: 'txVolumeU24h < 1000', filter: r => r.firstFactors.txVolumeU24h < 1000 },
    { name: 'txVolumeU24h < 500', filter: r => r.firstFactors.txVolumeU24h < 500 },
    { name: 'earlyReturn < 10', filter: r => r.firstFactors.earlyReturn < 10 },
    { name: 'earlyReturn >= -5', filter: r => r.firstFactors.earlyReturn >= -5 },
  ];

  for (const test of tests) {
    const slowMatched = categories.slowGrower.filter(test.filter);
    const flatFiltered = categories.flat.filter(r => !test.filter(r));
    const declinerFiltered = categories.decliner.filter(r => !test.filter(r));

    if (slowMatched.length === 0) continue;

    const precision = slowMatched.length / categories.slowGrower.length; // 召回率
    const totalFiltered = flatFiltered.length + declinerFiltered.length;
    const accuracy = totalFiltered > 0 ? totalFiltered / (categories.flat.length + categories.decliner.length) : 0;

    console.log(`${test.name} | ${slowMatched.length}/${categories.slowGrower.length} | ${totalFiltered}/${categories.flat.length + categories.decliner.length} | ${(accuracy * 100).toFixed(1)}% | ${(precision * 100).toFixed(1)}%`);
  }

  // 8. 组合条件测试
  console.log('\n========== 组合条件测试 ==========');

  const combinedTests = [
    { name: 'fdv < 10000 AND tvl < 1000', filter: r => r.firstFactors.fdv < 10000 && r.firstFactors.tvl < 1000 },
    { name: 'fdv < 10000 AND holders < 10', filter: r => r.firstFactors.fdv < 10000 && r.firstFactors.holders < 10 },
    { name: 'fdv < 8000 AND tvl < 500', filter: r => r.firstFactors.fdv < 8000 && r.firstFactors.tvl < 500 },
    { name: 'tvl < 500 AND holders < 5', filter: r => r.firstFactors.tvl < 500 && r.firstFactors.holders < 5 },
    { name: 'fdv < 10000 AND tvl < 1000 AND holders < 10', filter: r => r.firstFactors.fdv < 10000 && r.firstFactors.tvl < 1000 && r.firstFactors.holders < 10 },
  ];

  console.log('条件 | 慢涨币捕获 | 不涨币过滤 | 准确率');
  console.log('---');

  for (const test of combinedTests) {
    const slowMatched = categories.slowGrower.filter(test.filter);
    const flatFiltered = categories.flat.filter(r => !test.filter(r));
    const declinerFiltered = categories.decliner.filter(r => !test.filter(r));

    if (slowMatched.length === 0) continue;

    const totalFiltered = flatFiltered.length + declinerFiltered.length;
    const accuracy = totalFiltered > 0 ? totalFiltered / (categories.flat.length + categories.decliner.length) : 0;

    console.log(`${test.name} | ${slowMatched.length}/${categories.slowGrower.length} | ${totalFiltered} | ${(accuracy * 100).toFixed(1)}%`);
  }

  // 9. 展示慢涨币的详细因子
  console.log('\n========== 慢涨币详细因子 ==========');
  console.log('代币 | 最终收益 | age | fdv | tvl | holders | earlyReturn%');
  console.log('---');

  categories.slowGrower.forEach(r => {
    console.log(`${r.symbol} | ${r.finalReturn.toFixed(2)}% | ${r.firstFactors.age?.toFixed(2)} | ${r.firstFactors.fdv?.toFixed(0)} | ${r.firstFactors.tvl?.toFixed(0)} | ${r.firstFactors.holders} | ${r.firstFactors.earlyReturn?.toFixed(2)}%`);
  });
}

function average(arr, fn) {
  const values = arr.map(fn).filter(v => v !== undefined && v !== null);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function format(val) {
  if (val === undefined || val === null) return 'N/A';
  if (typeof val === 'number') return val.toFixed(2);
  return val;
}

analyzeSlowGrowers();
