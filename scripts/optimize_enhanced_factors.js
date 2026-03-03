/**
 * 增强因子组合优化脚本
 * 分析核心三因子 + 可选增强因子的最佳组合
 */

const fs = require('fs');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

/**
 * 加载数据
 */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('数据文件不存在，请先运行: node scripts/reanalyze_early_participants.js');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`加载 ${data.samples.length} 个样本\n`);
  return data.samples;
}

/**
 * 评估预测结果
 */
function evaluate(samples, predictFn) {
  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (const s of samples) {
    const predicted = predictFn(s);
    const actual = s.isPositive;

    if (predicted && actual) tp++;
    else if (!predicted && !actual) tn++;
    else if (predicted && !actual) fp++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp > 0 ? tp / (tp + fp) : 0;
  const recall = tp > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const passRate = (tp + fp) / (tp + tn + fp + fn);

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, passRate };
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('增强因子组合优化');
  console.log('========================================\n');

  const samples = loadData();
  const positiveSamples = samples.filter(s => s.isPositive);

  console.log(`正样本: ${positiveSamples.length}`);
  console.log(`负样本: ${samples.length - positiveSamples.length}`);
  console.log(`总计: ${samples.length}\n`);

  // 计算正样本的分位数阈值
  const thresholds = {};
  const features = ['countPerMin', 'volumePerMin', 'highValuePerMin', 'walletsPerMin', 'dataCoverage', 'totalCount'];

  for (const feat of features) {
    const posValues = positiveSamples.map(s => s[feat]).filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
    thresholds[feat] = {
      p25: posValues[Math.floor(posValues.length * 0.25)] || 0,
      p40: posValues[Math.floor(posValues.length * 0.40)] || 0,
      p50: posValues[Math.floor(posValues.length * 0.50)] || 0,
      p60: posValues[Math.floor(posValues.length * 0.60)] || 0,
      p70: posValues[Math.floor(posValues.length * 0.70)] || 0
    };
  }

  console.log('正样本分位数阈值:');
  for (const feat of features) {
    console.log(`  ${feat}: P25=${thresholds[feat].p25}, P50=${thresholds[feat].p50}, P70=${thresholds[feat].p70}`);
  }
  console.log('');

  // 定义策略组合
  const strategies = [];
  const pctOptions = ['p25', 'p40', 'p50'];

  // 核心三因子 + 各种增强因子组合
  for (const pct of pctOptions) {
    // 无增强因子
    strategies.push({
      name: `核心三因子-${pct}`,
      config: {
        countPct: pct,
        volumePct: pct,
        highValuePct: pct,
        useWallets: false,
        useCoverage: false,
        useTotal: false
      }
    });

    // + 钱包数
    for (const walletPct of ['p25', 'p40']) {
      strategies.push({
        name: `核心三因子-${pct}+钱包-${walletPct}`,
        config: {
          countPct: pct,
          volumePct: pct,
          highValuePct: pct,
          useWallets: true,
          walletPct: walletPct,
          useCoverage: false,
          useTotal: false
        }
      });
    }

    // + 数据覆盖度
    for (const covPct of ['p25', 'p40']) {
      strategies.push({
        name: `核心三因子-${pct}+覆盖度-${covPct}`,
        config: {
          countPct: pct,
          volumePct: pct,
          highValuePct: pct,
          useWallets: false,
          useCoverage: true,
          coveragePct: covPct,
          useTotal: false
        }
      });
    }

    // + 总交易数
    for (const totalPct of ['p25', 'p40']) {
      strategies.push({
        name: `核心三因子-${pct}+总交易-${totalPct}`,
        config: {
          countPct: pct,
          volumePct: pct,
          highValuePct: pct,
          useWallets: false,
          useCoverage: false,
          useTotal: true,
          totalPct: totalPct
        }
      });
    }

    // + 钱包 + 覆盖度
    strategies.push({
      name: `核心三因子-${pct}+钱包+覆盖度`,
      config: {
        countPct: pct,
        volumePct: pct,
        highValuePct: pct,
        useWallets: true,
        walletPct: 'p25',
        useCoverage: true,
        coveragePct: 'p25',
        useTotal: false
      }
    });

    // + 钱包 + 总交易
    strategies.push({
      name: `核心三因子-${pct}+钱包+总交易`,
      config: {
        countPct: pct,
        volumePct: pct,
        highValuePct: pct,
        useWallets: true,
        walletPct: 'p25',
        useCoverage: false,
        useTotal: true,
        totalPct: 'p25'
      }
    });

    // + 覆盖度 + 总交易
    strategies.push({
      name: `核心三因子-${pct}+覆盖度+总交易`,
      config: {
        countPct: pct,
        volumePct: pct,
        highValuePct: pct,
        useWallets: false,
        useCoverage: true,
        coveragePct: 'p25',
        useTotal: true,
        totalPct: 'p25'
      }
    });

    // + 所有增强因子
    strategies.push({
      name: `核心三因子-${pct}+全增强`,
      config: {
        countPct: pct,
        volumePct: pct,
        highValuePct: pct,
        useWallets: true,
        walletPct: 'p25',
        useCoverage: true,
        coveragePct: 'p25',
        useTotal: true,
        totalPct: 'p25'
      }
    });
  }

  console.log(`定义了 ${strategies.length} 个策略组合\n`);

  // 评估所有策略
  const results = [];
  for (const strategy of strategies) {
    const cfg = strategy.config;

    const predictFn = (s) => {
      const countOk = s.countPerMin >= thresholds.countPerMin[cfg.countPct];
      const volumeOk = s.volumePerMin >= thresholds.volumePerMin[cfg.volumePct];
      const highValueOk = s.highValuePerMin >= thresholds.highValuePerMin[cfg.highValuePct];

      let pass = countOk && volumeOk && highValueOk;

      if (pass && cfg.useWallets) {
        pass = s.walletsPerMin >= thresholds.walletsPerMin[cfg.walletPct];
      }
      if (pass && cfg.useCoverage) {
        pass = s.dataCoverage >= thresholds.dataCoverage[cfg.coveragePct];
      }
      if (pass && cfg.useTotal) {
        pass = s.totalCount >= thresholds.totalCount[cfg.totalPct];
      }

      return pass;
    };

    const result = evaluate(samples, predictFn);
    results.push({ ...result, name: strategy.name, config: strategy.config });
  }

  // 排序：按 F1 分数降序
  results.sort((a, b) => b.f1 - a.f1);

  console.log('========================================');
  console.log('策略性能排名（Top 30）');
  console.log('========================================\n');
  console.log('策略                              | 准确率 | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('----------------------------------|--------|--------|--------|-----|----|----|----|----|--------');

  for (const r of results.slice(0, 30)) {
    console.log(
      `${r.name.padEnd(34)} | ${(r.accuracy*100).toFixed(1).padStart(6)}% | ${(r.precision*100).toFixed(1).padStart(6)}% | ${(r.recall*100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn} | ${(r.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 分析增强因子的价值
  console.log('\n========================================');
  console.log('增强因子价值分析');
  console.log('========================================\n');

  const baseP25 = results.find(r => r.name === '核心三因子-p25');
  const withWallets = results.find(r => r.name === '核心三因子-p25+钱包-p25');
  const withCoverage = results.find(r => r.name === '核心三因子-p25+覆盖度-p25');
  const withTotal = results.find(r => r.name === '核心三因子-p25+总交易-p25');
  const withAll = results.find(r => r.name === '核心三因子-p25+全增强');

  console.log('基础（核心三因子-p25）:');
  console.log(`  F1: ${baseP25.f1.toFixed(2)}, 精确率: ${(baseP25.precision*100).toFixed(1)}%, 召回率: ${(baseP25.recall*100).toFixed(1)}%, 通过率: ${(baseP25.passRate*100).toFixed(1)}%`);

  if (withWallets) {
    console.log('\n+ 钱包数/分:');
    console.log(`  F1: ${withWallets.f1.toFixed(2)}, 精确率: ${(withWallets.precision*100).toFixed(1)}%, 召回率: ${(withWallets.recall*100).toFixed(1)}%, 通过率: ${(withWallets.passRate*100).toFixed(1)}%`);
    console.log(`  F1变化: ${(withWallets.f1 - baseP25.f1).toFixed(3)}, 精确率变化: ${((withWallets.precision - baseP25.precision)*100).toFixed(1)}pp`);
  }

  if (withCoverage) {
    console.log('\n+ 数据覆盖度:');
    console.log(`  F1: ${withCoverage.f1.toFixed(2)}, 精确率: ${(withCoverage.precision*100).toFixed(1)}%, 召回率: ${(withCoverage.recall*100).toFixed(1)}%, 通过率: ${(withCoverage.passRate*100).toFixed(1)}%`);
    console.log(`  F1变化: ${(withCoverage.f1 - baseP25.f1).toFixed(3)}, 精确率变化: ${((withCoverage.precision - baseP25.precision)*100).toFixed(1)}pp`);
  }

  if (withTotal) {
    console.log('\n+ 总交易数:');
    console.log(`  F1: ${withTotal.f1.toFixed(2)}, 精确率: ${(withTotal.precision*100).toFixed(1)}%, 召回率: ${(withTotal.recall*100).toFixed(1)}%, 通过率: ${(withTotal.passRate*100).toFixed(1)}%`);
    console.log(`  F1变化: ${(withTotal.f1 - baseP25.f1).toFixed(3)}, 精确率变化: ${((withTotal.precision - baseP25.precision)*100).toFixed(1)}pp`);
  }

  if (withAll) {
    console.log('\n+ 所有增强因子:');
    console.log(`  F1: ${withAll.f1.toFixed(2)}, 精确率: ${(withAll.precision*100).toFixed(1)}%, 召回率: ${(withAll.recall*100).toFixed(1)}%, 通过率: ${(withAll.passRate*100).toFixed(1)}%`);
    console.log(`  F1变化: ${(withAll.f1 - baseP25.f1).toFixed(3)}, 精确率变化: ${((withAll.precision - baseP25.precision)*100).toFixed(1)}pp`);
  }

  // 找出最优配置
  console.log('\n========================================');
  console.log('最优配置推荐');
  console.log('========================================\n');

  const best = results[0];
  console.log(`最佳策略: ${best.name}`);
  console.log(`  F1: ${best.f1.toFixed(2)}, 精确率: ${(best.precision*100).toFixed(1)}%, 召回率: ${(best.recall*100).toFixed(1)}%, 通过率: ${(best.passRate*100).toFixed(1)}%`);

  // 找出精确率>=60%且召回率最高的
  const goodPrecision = results.filter(r => r.precision >= 0.6).sort((a, b) => b.recall - a.recall)[0];
  if (goodPrecision) {
    console.log(`\n高精确率召回最优: ${goodPrecision.name}`);
    console.log(`  F1: ${goodPrecision.f1.toFixed(2)}, 精确率: ${(goodPrecision.precision*100).toFixed(1)}%, 召回率: ${(goodPrecision.recall*100).toFixed(1)}%, 通过率: ${(goodPrecision.passRate*100).toFixed(1)}%`);
  }

  // 找出通过率15-25%中F1最高的
  const balancedPass = results.filter(r => r.passRate >= 0.15 && r.passRate <= 0.25).sort((a, b) => b.f1 - a.f1)[0];
  if (balancedPass) {
    console.log(`\n平衡通过率最优: ${balancedPass.name}`);
    console.log(`  F1: ${balancedPass.f1.toFixed(2)}, 精确率: ${(balancedPass.precision*100).toFixed(1)}%, 召回率: ${(balancedPass.recall*100).toFixed(1)}%, 通过率: ${(balancedPass.passRate*100).toFixed(1)}%`);
  }

  // 导出结果
  const outputFile = '/Users/nobody1/Desktop/Codes/richer-js/scripts/enhanced_factors_optimization.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    exportTime: new Date().toISOString(),
    sampleCount: samples.length,
    positiveCount: positiveSamples.length,
    thresholds,
    results: results.slice(0, 50),
    recommendation: {
      best: best.name,
      bestConfig: results[0].config
    }
  }, null, 2));
  console.log(`\n结果已保存到: ${outputFile}`);

  console.log('\n========================================');
  console.log('✅ 增强因子优化完成！');
  console.log('========================================');
}

main().catch(console.error);
