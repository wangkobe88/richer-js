/**
 * 全面检测"短拉快砸"代币
 * 多维度分析，识别不同形态的操纵模式
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'raw');
const PROCESSED_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(PROCESSED_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

function loadRawData() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const allData = [];

  files.forEach(file => {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.tokens) {
        allData.push(...data.tokens);
      }
    } catch (e) {}
  });

  return allData;
}

/**
 * 分析所有可能的转折点（扩展到180秒）
 */
function analyzeAllTurningPoints(sequence) {
  const trades = sequence.sequence;

  // 每10笔约30秒，分析6个时间窗口
  const windows = [
    { name: '0-30s', start: 0, end: 10 },
    { name: '30-60s', start: 10, end: 20 },
    { name: '60-90s', start: 20, end: 30 },
    { name: '90-120s', start: 30, end: 40 },
    { name: '120-150s', start: 40, end: 50 },
    { name: '150-180s', start: 50, end: 60 }
  ];

  const windowStats = windows.map(win => {
    const windowTrades = trades.slice(win.start, Math.min(win.end, trades.length));
    const netFlow = windowTrades.reduce((sum, [, a]) => sum + a, 0);
    const buys = windowTrades.filter(([, a]) => a > 0).length;
    const sells = windowTrades.filter(([, a]) => a < 0).length;
    const buyRatio = windowTrades.length > 0 ? buys / windowTrades.length : 0;

    return {
      name: win.name,
      netFlow,
      buys,
      sells,
      buyRatio,
      tradeCount: windowTrades.length
    };
  });

  // 计算所有可能的转折点
  const turningPoints = [];

  for (let i = 1; i < windowStats.length - 1; i++) {
    const prev = windowStats[i - 1];
    const curr = windowStats[i];
    const next = windowStats[i + 1];

    const maxPrev = Math.max(prev.netFlow, curr.netFlow);
    const dropRatio = maxPrev > 0 ? (maxPrev - next.netFlow) / maxPrev : 0;
    const turnedNegative = prev.netFlow > 0 && curr.netFlow > 0 && next.netFlow < 0;
    const buyRatioDrop = (prev.buyRatio + curr.buyRatio) / 2 - next.buyRatio;

    turningPoints.push({
      window: next.name, // 转折发生的窗口
      maxPrev,
      currNetFlow: curr.netFlow,
      nextNetFlow: next.netFlow,
      dropRatio,
      turnedNegative,
      buyRatioDrop,
      severity: dropRatio + (turnedNegative ? 1 : 0) + buyRatioDrop * 2
    });
  }

  return { windowStats, turningPoints };
}

/**
 * 定义多种"短拉快砸"检测规则
 */
const dumpPatterns = {
  // 模式1: 60-90秒急剧转折（经典型）
  classic_60_90: (stats, points) => {
    const net30s = stats[0].netFlow;
    const net30_60 = stats[1].netFlow;
    const net60_90 = stats[2].netFlow;

    const maxEarly = Math.max(net30s, net30_60);
    const midDrop = maxEarly - net60_90;
    const midDropRatio = maxEarly > 0 ? midDrop / maxEarly : 0;

    return {
      match: maxEarly > 500 && midDropRatio > 0.5,
      score: midDropRatio,
      reason: `60-90秒急剧下降${(midDropRatio * 100).toFixed(1)}%`
    };
  },

  // 模式2: 90-120秒转折（延迟型）
  delayed_90_120: (stats, points) => {
    const net60_90 = stats[2].netFlow;
    const net90_120 = stats[3].netFlow;

    const maxEarly = Math.max(stats[0].netFlow, stats[1].netFlow, stats[2].netFlow);
    const lateDrop = maxEarly - net90_120;
    const lateDropRatio = maxEarly > 0 ? lateDrop / maxEarly : 0;
    const turnedNegative = net60_90 > 0 && net90_120 < 0;

    return {
      match: maxEarly > 500 && lateDropRatio > 0.6 && turnedNegative,
      score: lateDropRatio,
      reason: `90-120秒转负并下降${(lateDropRatio * 100).toFixed(1)}%`
    };
  },

  // 模式3: 买入占比急剧下降
  buy_ratio_collapse: (stats, points) => {
    const earlyBuyRatio = Math.max(stats[0].buyRatio, stats[1].buyRatio);
    const lateBuyRatio = Math.min(stats[2].buyRatio, stats[3].buyRatio);
    const buyRatioDrop = earlyBuyRatio - lateBuyRatio;

    // 早期买入占比高（>70%），后期急剧下降（>30个百分点）
    return {
      match: earlyBuyRatio > 0.7 && buyRatioDrop > 0.3,
      score: buyRatioDrop,
      reason: `买入占比从${(earlyBuyRatio * 100).toFixed(0)}%降至${(lateBuyRatio * 100).toFixed(0)}%`
    };
  },

  // 模式4: 净流入峰值后持续下降
  peak_decline: (stats, points) => {
    // 找到净流入峰值
    let maxNetFlow = -Infinity;
    let maxIndex = -1;

    stats.forEach((s, i) => {
      if (s.netFlow > maxNetFlow) {
        maxNetFlow = s.netFlow;
        maxIndex = i;
      }
    });

    // 峰值后的每个窗口都在下降
    let declining = true;
    for (let i = maxIndex + 1; i < stats.length; i++) {
      if (stats[i].netFlow > stats[i - 1].netFlow) {
        declining = false;
        break;
      }
    }

    // 峰值后的最后窗口是负的或接近0
    const lastSignificantDecline = stats[Math.min(maxIndex + 2, stats.length - 1)].netFlow < maxNetFlow * 0.3;

    return {
      match: maxNetFlow > 500 && declining && lastSignificantDecline,
      score: maxNetFlow,
      reason: `峰值$${maxNetFlow.toFixed(0)}后持续下降`
    };
  },

  // 模式5: 小额拉盘后快速砸盘（针对Duck you类型）
  small_pump_quick_dump: (stats, points) => {
    const net30s = stats[0].netFlow;
    const net30_60 = stats[1].netFlow;
    const net60_90 = stats[2].netFlow;
    const net90_120 = stats[3].netFlow;

    const maxEarly = Math.max(net30s, net30_60);
    const gradualDecline = net30s > net30_60 && net30_60 > net60_90 && net60_90 > net90_120;

    // 每个窗口都在下降，即使金额不大
    return {
      match: maxEarly > 200 && gradualDecline && net90_120 < 0,
      score: maxEarly,
      reason: `小额拉盘后持续下降至负值`
    };
  },

  // 模式6: 早期高买入占比后转变为高卖出占比
  buy_to_sell_shift: (stats, points) => {
    const earlyBuyRatio = Math.max(stats[0].buyRatio, stats[1].buyRatio);
    const earlySellRatio = 1 - Math.min(stats[0].buyRatio, stats[1].buyRatio);
    const lateBuyRatio = Math.min(stats[2].buyRatio, stats[3].buyRatio);
    const lateSellRatio = 1 - Math.max(stats[2].buyRatio, stats[3].buyRatio);

    const shift = (earlyBuyRatio - lateBuyRatio) + (lateSellRatio - earlySellRatio);

    return {
      match: earlyBuyRatio > 0.6 && lateSellRatio > 0.5 && shift > 0.5,
      score: shift,
      reason: `从买入主导转为卖出主导`
    };
  }
};

/**
 * 综合检测函数
 */
function detectDumpPatterns(sequences) {
  console.log('========================================');
  console.log('多维度"短拉快砸"检测');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'
  ];

  const results = sequences.map(seq => {
    const { windowStats, turningPoints } = analyzeAllTurningPoints(seq);

    // 测试所有模式
    const patternMatches = {};
    let matchCount = 0;
    let totalScore = 0;

    Object.entries(dumpPatterns).forEach(([patternName, patternFn]) => {
      const result = patternFn(windowStats, turningPoints);
      patternMatches[patternName] = result;
      if (result.match) {
        matchCount++;
        totalScore += result.score;
      }
    });

    return {
      symbol: seq.token_symbol,
      address: seq.token_address,
      change: seq.max_change_percent,
      windowStats,
      turningPoints,
      patternMatches,
      matchCount,
      totalScore,
      isTarget: targetAddresses.includes(seq.token_address)
    };
  });

  // 按匹配数量排序
  results.sort((a, b) => b.matchCount - a.matchCount || b.totalScore - a.totalScore);

  // 分析目标代币
  console.log('【目标代币的匹配情况】\\n');

  const targetResults = results.filter(r => r.isTarget);

  targetResults.forEach(r => {
    console.log(`📊 ${r.symbol} (+${r.change.toFixed(1)}%)`);
    console.log(`   匹配模式: ${r.matchCount}个，总得分: ${r.totalScore.toFixed(2)}`);
    console.log('   净流入序列:');
    r.windowStats.forEach(s => {
      console.log(`     ${s.name}: $${s.netFlow.toFixed(0)} (买入${(s.buyRatio * 100).toFixed(0)}%)`);
    });
    console.log('   匹配的模式:');
    Object.entries(r.patternMatches).forEach(([name, result]) => {
      if (result.match) {
        console.log(`     ✓ ${name}: ${result.reason}`);
      }
    });
    if (r.matchCount === 0) {
      console.log('   ✗ 未匹配任何模式');
    }
    console.log('');
  });

  // 统计各模式的覆盖情况
  console.log('\\n【各模式的检测统计】\\n');

  Object.keys(dumpPatterns).forEach(patternName => {
    const matched = results.filter(r => r.patternMatches[patternName].match);
    const avgChange = matched.reduce((sum, r) => sum + r.change, 0) / matched.length;
    const targetCaught = matched.filter(r => r.isTarget).length;

    console.log(`${patternName}:`);
    console.log(`  检测到: ${matched.length}个代币 (${(matched.length / results.length * 100).toFixed(1)}%)`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  目标代币: ${targetCaught}/${targetAddresses.length}`);
    console.log('');
  });

  // 设计综合检测规则
  console.log('\\n【综合检测规则建议】\\n');

  // 分析哪些模式组合能覆盖所有目标代币
  const targetPatterns = {};
  targetResults.forEach(r => {
    targetPatterns[r.symbol] = Object.keys(r.patternMatches).filter(
      name => r.patternMatches[name].match
    );
  });

  console.log('目标代币各自匹配的模式:');
  Object.entries(targetPatterns).forEach(([symbol, patterns]) => {
    console.log(`  ${symbol}: ${patterns.length > 0 ? patterns.join(', ') : '无'}`);
  });

  // 找出能覆盖最多目标代币的模式组合
  const findBestCombination = () => {
    const patternNames = Object.keys(dumpPatterns);
    let bestCombo = [];
    let bestCoverage = 0;

    // 尝试所有组合（最多3个模式）
    for (let i = 0; i < patternNames.length; i++) {
      for (let j = i; j < patternNames.length; j++) {
        for (let k = j; k < patternNames.length; k++) {
          const tempCombo = [patternNames[i], patternNames[j], patternNames[k]];
          const combo = [...new Set(tempCombo)]; // 去重

          const coverage = targetResults.filter(r => {
            return combo.some(name => r.patternMatches[name].match);
          }).length;

          if (coverage > bestCoverage) {
            bestCoverage = coverage;
            bestCombo = combo;
          }
        }
      }
    }

    return { combo: bestCombo, coverage: bestCoverage };
  };

  const { combo, coverage } = findBestCombination();

  console.log(`\\n最佳模式组合 (${coverage}/${targetAddresses.length}个目标):`);
  combo.forEach(name => {
    console.log(`  - ${name}`);
  });

  // 测试综合规则
  const comprehensiveRule = (r) => {
    // 至少匹配2个模式，或匹配关键模式
    const criticalMatches = ['classic_60_90', 'delayed_90_120'].some(
      name => r.patternMatches[name].match
    );
    return r.matchCount >= 2 || criticalMatches;
  };

  const comprehensiveMatched = results.filter(comprehensiveRule);
  const comprehensiveTargets = comprehensiveMatched.filter(r => r.isTarget);

  console.log('\\n【综合规则验证】');
  console.log('规则: 匹配≥2个模式 OR 匹配关键模式');
  console.log(`  检测到: ${comprehensiveMatched.length}个代币 (${(comprehensiveMatched.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  目标覆盖: ${comprehensiveTargets.length}/${targetAddresses.length}`);

  if (comprehensiveMatched.length > 0) {
    const avgChange = comprehensiveMatched.reduce((sum, r) => sum + r.change, 0) / comprehensiveMatched.length;
    const highReturn = comprehensiveMatched.filter(r => r.change >= 100).length;
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturn / comprehensiveMatched.length * 100).toFixed(1)}%`);
  }

  return results;
}

async function main() {
  console.log('========================================');
  console.log('全面检测"短拉快砸"代币');
  console.log('========================================\\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\\n`);

  const rawData = loadRawData();
  console.log(`✓ 读取 ${rawData.length} 个原始代币数据\\n`);

  // 执行检测
  const results = detectDumpPatterns(sequences);

  console.log('\\n========================================');
  console.log('分析完成!');
  console.log('========================================\\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
