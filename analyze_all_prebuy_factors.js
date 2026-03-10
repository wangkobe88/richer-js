/**
 * 全面分析所有购买前检查因子与盈亏的关系
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeAllPreBuyFactors() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 计算每个代币的盈亏
  const tokenProfits = new Map();

  trades.forEach(trade => {
    if (!tokenProfits.has(trade.token_address)) {
      tokenProfits.set(trade.token_address, {
        profits: []
      });
    }
    if (trade.trade_direction === 'sell') {
      const profit = trade.metadata?.profitPercent || 0;
      tokenProfits.get(trade.token_address).profits.push(profit);
    }
  });

  // 计算平均盈亏
  tokenProfits.forEach((value, key) => {
    value.avgProfit = value.profits.reduce((a, b) => a + b, 0) / value.profits.length;
    value.isProfit = value.avgProfit > 0;
  });

  // 从信号获取因子
  const tokenFactors = new Map();

  signals.forEach(s => {
    if (!tokenFactors.has(s.token_address) && s.metadata?.trendFactors) {
      tokenFactors.set(s.token_address, {
        symbol: s.metadata?.symbol || s.token_address.substring(0, 8),
        trendFactors: s.metadata?.trendFactors || {},
        preBuyFactors: s.metadata?.preBuyCheckFactors || {}
      });
    }
  });

  // 合并数据
  const allData = [];
  tokenFactors.forEach((factors, address) => {
    const profit = tokenProfits.get(address);
    if (profit) {
      allData.push({
        address,
        symbol: factors.symbol,
        avgProfit: profit.avgProfit,
        isProfit: profit.isProfit,
        ...factors
      });
    }
  });

  console.log('=== 全面购买前检查因子分析 ===\n');
  console.log('总代币数:', allData.length);
  console.log('盈利:', allData.filter(d => d.isProfit).length);
  console.log('亏损:', allData.filter(d => !d.isProfit).length);
  console.log('');

  // 获取所有预检查因子名称
  const samplePreBuyFactors = allData[0]?.preBuyFactors || {};
  const factorNames = Object.keys(samplePreBuyFactors).filter(k => k !== 'earlyTradesDataFirstTime' && k !== 'earlyTradesDataLastTime' && k !== 'earlyTradesCheckTime' && k !== 'earlyTradesCheckTimestamp');

  console.log(`预检查因子数量: ${factorNames.length}`);
  console.log('');

  // 对每个因子进行详细分析
  console.log('='.repeat(80));
  console.log('逐个因子分析');
  console.log('='.repeat(80));
  console.log('');

  const factorAnalysis = [];

  for (const factorName of factorNames) {
    const analysis = analyzeFactor(allData, factorName);
    if (analysis) {
      factorAnalysis.push({ name: factorName, ...analysis });
    }
  }

  // 按预测力排序（区分度）
  factorAnalysis.sort((a, b) => b.discriminationScore - a.discriminationScore);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('因子预测力排名（按区分度从高到低）');
  console.log('='.repeat(80));
  console.log('');

  factorAnalysis.forEach((fa, i) => {
    console.log(`${i + 1}. ${fa.name}`);
    console.log(`   类型: ${fa.type}`);
    console.log(`   区分度: ${fa.discriminationScore.toFixed(3)} (${fa.interpretation})`);
    if (fa.bestThreshold) {
      console.log(`   最佳阈值: ${fa.bestThreshold.threshold} (胜率: ${(fa.bestThreshold.winRate*100).toFixed(1)}%, 样本: ${fa.bestThreshold.count})`);
    }
    if (fa.keyFinding) {
      console.log(`   关键发现: ${fa.keyFinding}`);
    }
    console.log('');
  });

  // 找出最有效的过滤条件
  console.log('='.repeat(80));
  console.log('推荐的优化条件（基于胜率提升）');
  console.log('='.repeat(80));
  console.log('');

  const recommendedFilters = generateRecommendedFilters(factorAnalysis, allData);
  recommendedFilters.forEach((filter, i) => {
    console.log(`${i + 1}. [${filter.priority}] ${filter.condition}`);
    console.log(`   当前胜率: ${(filter.currentWinRate*100).toFixed(1)}% (${filter.currentCount}个)`);
    console.log(`   过滤后胜率: ${(filter.newWinRate*100).toFixed(1)}% (${filter.newCount}个)`);
    console.log(`   提升: ${((filter.newWinRate - filter.currentWinRate)*100).toFixed(1)}个百分点`);
    console.log(`   副作用: 会过滤 ${filter.filteredProfit} 个盈利案例`);
    console.log('');
  });
}

function analyzeFactor(data, factorName) {
  // 获取该因子的所有值
  const values = data.map(d => d.preBuyFactors[factorName]).filter(v => v !== undefined && v !== null);

  if (values.length < 10) {
    return null; // 样本太少，跳过
  }

  // 判断因子类型
  const uniqueValues = new Set(values);
  const isBinary = uniqueValues.size <= 2 && [...uniqueValues].every(v => v === 0 || v === 1 || v === true || v === false);
  const isNumeric = !isBinary && [...uniqueValues].every(v => typeof v === 'number');

  // 分组统计
  const profitValues = data.filter(d => d.isProfit).map(d => d.preBuyFactors[factorName]).filter(v => v !== undefined && v !== null);
  const lossValues = data.filter(d => !d.isProfit).map(d => d.preBuyFactors[factorName]).filter(v => v !== undefined && v !== null);

  const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
  const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
  const profitMin = Math.min(...profitValues);
  const profitMax = Math.max(...profitValues);
  const lossMin = Math.min(...lossValues);
  const lossMax = Math.max(...lossValues);

  // 计算区分度（用Cohen's d）
  const profitStd = Math.sqrt(profitValues.reduce((sum, v) => sum + Math.pow(v - profitAvg, 2), 0) / profitValues.length);
  const lossStd = Math.sqrt(lossValues.reduce((sum, v) => sum + Math.pow(v - lossAvg, 2), 0) / lossValues.length);
  const pooledStd = Math.sqrt((profitStd * profitStd + lossStd * lossStd) / 2);
  const cohensD = pooledStd > 0 ? Math.abs(profitAvg - lossAvg) / pooledStd : 0;

  // 解释区分度
  let interpretation = '无区分度';
  if (cohensD >= 0.8) interpretation = '强区分度';
  else if (cohensD >= 0.5) interpretation = '中等区分度';
  else if (cohensD >= 0.2) interpretation = '弱区分度';

  console.log(`--- ${factorName} ---`);
  console.log(`类型: ${isBinary ? '二元' : isNumeric ? '数值' : '其他'}`);
  console.log(`盈利 (n=${profitValues.length}): 平均=${profitAvg.toFixed(3)}, 范围=[${profitMin.toFixed(3)}, ${profitMax.toFixed(3)}]`);
  console.log(`亏损 (n=${lossValues.length}): 平均=${lossAvg.toFixed(3)}, 范围=[${lossMin.toFixed(3)}, ${lossMax.toFixed(3)}]`);
  console.log(`差异: ${(profitAvg - lossAvg).toFixed(3)} (Cohen's d: ${cohensD.toFixed(3)}, ${interpretation})`);

  // 数值型因子：尝试不同阈值
  let bestThreshold = null;
  let keyFinding = '';

  if (isNumeric && uniqueValues.size > 5) {
    console.log(`阈值分析:`);

    // 生成候选阈值
    const allSortedValues = [...values].sort((a, b) => a - b);
    const percentiles = [0.1, 0.25, 0.5, 0.75, 0.9];
    const thresholds = percentiles.map(p => allSortedValues[Math.floor(p * allSortedValues.length)]);

    // 去重并添加一些常用值
    const uniqueThresholds = [...new Set(thresholds)];

    for (const threshold of uniqueThresholds) {
      const below = data.filter(d => (d.preBuyFactors[factorName] || 0) < threshold);
      const above = data.filter(d => (d.preBuyFactors[factorName] || 0) >= threshold);

      if (below.length >= 5 && above.length >= 5) {
        const belowWinRate = below.filter(d => d.isProfit).length / below.length;
        const aboveWinRate = above.filter(d => d.isProfit).length / above.length;

        if (belowWinRate > 0.55 || aboveWinRate > 0.55) {
          const betterSide = belowWinRate > aboveWinRate ? 'below' : 'above';
          const betterRate = betterSide === 'below' ? belowWinRate : aboveWinRate;
          const betterCount = betterSide === 'below' ? below.length : above.length;
          const condition = betterSide === 'below' ? `< ${threshold.toFixed(3)}` : `>= ${threshold.toFixed(3)}`;
          console.log(`  ${condition}: 胜率 ${(betterRate*100).toFixed(1)}% (${betterCount}个)`);

          if (!bestThreshold || betterRate > (bestThreshold.winRate || 0)) {
            bestThreshold = { threshold, condition: betterSide, winRate: betterRate, count: betterCount };
          }
        }
      }
    }
  } else if (isBinary || uniqueValues.size <= 5) {
    // 分类因子：直接统计每个值的胜率
    console.log(`分类统计:`);
    const valueStats = new Map();

    data.forEach(d => {
      const val = d.preBuyFactors[factorName];
      if (!valueStats.has(val)) {
        valueStats.set(val, { total: 0, profit: 0 });
      }
      valueStats.get(val).total++;
      if (d.isProfit) {
        valueStats.get(val).profit++;
      }
    });

    valueStats.forEach((stats, val) => {
      const winRate = stats.profit / stats.total;
      console.log(`  值=${val}: 胜率 ${(winRate*100).toFixed(1)}% (${stats.profit}/${stats.total})`);
      if (stats.total >= 5 && (winRate > 0.6 || winRate < 0.3)) {
        if (!bestThreshold || winRate > (bestThreshold.winRate || 0)) {
          bestThreshold = { threshold: val, condition: 'equals', winRate, count: stats.total };
        }
      }
    });
  }

  // 生成关键发现
  if (bestThreshold && bestThreshold.winRate > 0.6) {
    keyFinding = `该因子在特定值/范围下胜率达 ${(bestThreshold.winRate*100).toFixed(1)}%`;
  } else if (cohensD >= 0.5) {
    keyFinding = `盈利与亏损组有显著差异`;
  } else if (Math.abs(profitAvg - lossAvg) < 0.01) {
    keyFinding = `盈利与亏损组几乎没有差异，预测力弱`;
  }

  console.log('');
  console.log('');

  return {
    type: isBinary ? '二元' : isNumeric ? '数值' : '其他',
    profitAvg,
    lossAvg,
    difference: profitAvg - lossAvg,
    cohensD,
    discriminationScore: cohensD,
    interpretation,
    bestThreshold,
    keyFinding
  };
}

function generateRecommendedFilters(factorAnalysis, allData) {
  const currentWinRate = allData.filter(d => d.isProfit).length / allData.length;
  const recommendations = [];

  // 遍历所有高区分度因子，生成过滤建议
  factorAnalysis.filter(fa => fa.cohensD >= 0.3 || (fa.bestThreshold && fa.bestThreshold.winRate >= 0.6)).forEach(fa => {
    if (fa.bestThreshold && fa.bestThreshold.count >= 5) {
      // 生成过滤条件
      let condition = '';
      let filterFunc = null;

      if (fa.bestThreshold.condition === 'below') {
        condition = `${fa.name} < ${fa.bestThreshold.threshold.toFixed(3)}`;
        filterFunc = (d) => (d.preBuyFactors[fa.name] || 0) < fa.bestThreshold.threshold;
      } else if (fa.bestThreshold.condition === 'above') {
        condition = `${fa.name} >= ${fa.bestThreshold.threshold.toFixed(3)}`;
        filterFunc = (d) => (d.preBuyFactors[fa.name] || 0) >= fa.bestThreshold.threshold;
      } else if (fa.bestThreshold.condition === 'equals') {
        const val = fa.bestThreshold.threshold;
        if (val === 0) {
          condition = `${fa.name} = 0`;
          filterFunc = (d) => d.preBuyFactors[fa.name] === 0;
        } else if (val === 1) {
          condition = `${fa.name} = 1`;
          filterFunc = (d) => d.preBuyFactors[fa.name] === 1;
        } else {
          condition = `${fa.name} = ${val}`;
          filterFunc = (d) => d.preBuyFactors[fa.name] === val;
        }
      }

      if (condition && filterFunc) {
        const filtered = allData.filter(filterFunc);
        const newWinRate = filtered.filter(d => d.isProfit).length / filtered.length;
        const filteredProfit = allData.filter(d => d.isProfit && !filterFunc(d)).length;

        recommendations.push({
          priority: fa.cohensD >= 0.5 ? 'HIGH' : fa.cohensD >= 0.3 ? 'MEDIUM' : 'LOW',
          condition,
          currentWinRate,
          currentCount: allData.length,
          newWinRate,
          newCount: filtered.length,
          filteredProfit,
          winRateImprovement: newWinRate - currentWinRate
        });
      }
    }
  });

  // 按胜率提升幅度排序
  recommendations.sort((a, b) => b.winRateImprovement - a.winRateImprovement);

  return recommendations;
}

analyzeAllPreBuyFactors().catch(console.error);
