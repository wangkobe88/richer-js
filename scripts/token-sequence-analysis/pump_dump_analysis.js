/**
 * "短拉快砸"代币模式分析
 * 识别短时间内暴涨后暴跌的操纵模式
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'raw');
const PROCESSED_DIR = path.join(__dirname, 'data', 'processed');

/**
 * 加载具体代币的数据
 */
function loadSpecificTokens() {
  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444'
  ];

  // 加载原始数据
  const rawFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));

  const targetTokens = [];

  for (const file of rawFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(content);

      if (data.tokens) {
        data.tokens.forEach(token => {
          if (targetAddresses.includes(token.token_address)) {
            targetTokens.push(token);
          }
        });
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 加载序列数据
  const sequencesPath = path.join(PROCESSED_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const seqData = JSON.parse(content);

  const targetSequences = seqData.sequences.filter(s =>
    targetAddresses.includes(s.token_address)
  );

  return { targetTokens, targetSequences };
}

/**
 * 深度分析单个代币的交易序列
 */
function analyzeSingleToken(sequence) {
  const trades = sequence.sequence;

  // 基础统计
  const totalTrades = trades.length;
  const buys = trades.filter(([, a]) => a > 0);
  const sells = trades.filter(([, a]) => a < 0);

  const totalBuy = buys.reduce((sum, [, a]) => sum + a, 0);
  const totalSell = sells.reduce((sum, [, a]) => sum + Math.abs(a), 0);
  const netFlow = totalBuy - totalSell;

  // 时间分析（每笔交易假设3秒间隔）
  const intervals = [
    { name: '0-30s', start: 0, end: 10 },
    { name: '30-60s', start: 10, end: 20 },
    { name: '60-90s', start: 20, end: 30 },
    { name: '90-120s', start: 30, end: 40 },
    { name: '120-180s', start: 40, end: 60 }
  ];

  const timeSegmentStats = intervals.map(seg => {
    const segmentTrades = trades.slice(seg.start, seg.end);
    const segBuys = segmentTrades.filter(([, a]) => a > 0).length;
    const segSells = segmentTrades.filter(([, a]) => a < 0).length;
    const segNetFlow = segmentTrades.reduce((sum, [, a]) => sum + a, 0);

    return {
      name: seg.name,
      trades: segmentTrades.length,
      buys: segBuys,
      sells: segSells,
      buy_ratio: segmentTrades.length > 0 ? segBuys / segmentTrades.length : 0,
      net_flow: segNetFlow
    };
  });

  // 分析"拉高"模式
  // 检测：前期快速买入，然后开始卖出
  let maxRise = 0;
  let maxRiseEnd = 0;
  let currentRise = 0;

  for (let i = 0; i < trades.length; i++) {
    if (trades[i][1] > 0) {
      currentRise += trades[i][1];
    } else {
      currentRise -= Math.abs(trades[i][1]);
    }

    if (currentRise > maxRise) {
      maxRise = currentRise;
      maxRiseEnd = i;
    }
  }

  // 分析"砸盘"模式
  // 检测：拉高后的卖出
  const afterRiseTrades = trades.slice(maxRiseEnd + 1, Math.min(maxRiseEnd + 20, trades.length));
  const afterRiseSell = afterRiseTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
  const afterRiseBuy = afterRiseTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);

  // 计算峰值后的下降速度
  let peakNetFlow = netFlow;
  let minNetFlowAfterPeak = netFlow;

  for (let i = maxRiseEnd; i < Math.min(maxRiseEnd + 30, trades.length); i++) {
    const runningFlow = trades.slice(0, i + 1).reduce((sum, [, a]) => sum + a, 0);
    if (runningFlow < minNetFlowAfterPeak) {
      minNetFlowAfterPeak = runningFlow;
    }
  }

  const peakDrop = peakNetFlow - minNetFlowAfterPeak;
  const peakDropRatio = peakNetFlow > 0 ? peakDrop / peakNetFlow : 0;

  // 检测"急剧转折"
  // 前N笔主要是买入，后N笔开始大量卖出
  const pivotPoint = Math.floor(trades.length / 3); // 前1/3作为"拉盘期"

  const prePivot = trades.slice(0, pivotPoint);
  const postPivot = trades.slice(pivotPoint, Math.min(pivotPoint * 2, trades.length));

  const prePivotBuy = prePivot.filter(([, a]) => a > 0).length;
  const prePivotSell = prePivot.filter(([, a]) => a < 0).length;
  const prePivotRatio = prePivotBuy / prePivot.length;

  const postPivotBuy = postPivot.filter(([, a]) => a > 0).length;
  const postPivotSell = postPivot.filter(([, a]) => a < 0).length;
  const postPivotRatio = postPivotSell / postPivot.length;

  return {
    symbol: sequence.token_symbol,
    address: sequence.token_address,
    max_change: sequence.max_change_percent,

    // 基础
    total_trades: totalTrades,
    total_buy: totalBuy,
    total_sell: totalSell,
    net_flow: netFlow,

    // 时间段
    time_segments: timeSegmentStats,

    // 拉高砸盘特征
    max_rise: maxRise,
    max_rise_end: maxRiseEnd,
    max_rise_time: maxRiseEnd * 3, // 秒

    after_rise_sell: afterRiseSell,
    after_rise_buy: afterRiseBuy,
    after_rise_net: afterRiseBuy - afterRiseSell,

    peak_drop: peakDrop,
    peak_drop_ratio: peakDropRatio,

    // 转折特征
    pivot_buy_ratio: prePivotRatio,
    pivot_sell_ratio: postPivotRatio,
    pivot_drop: prePivotRatio - postPivotRatio,

    // 异常检测
    is_suspicious: peakDropRatio > 0.5 && maxRiseEnd < 30 // 峰值后30秒内下跌50%+
  };
}

/**
 * 与正常代币对比
 */
function compareWithNormal(sequences) {
  // 过滤出正常代币（涨幅不是极端的）
  const normalTokens = sequences.filter(s =>
    s.max_change_percent >= 50 &&
    s.max_change_percent <= 500 &&
    s.sequence.length >= 20
  ).slice(0, 100); // 取100个对比

  const normalAnalysis = normalTokens.map(analyzeSingleToken);

  return { normalAnalysis };
}

/**
 * 寻找"短拉快砸"的特征模式
 */
function findPumpAndDumpPatterns(targetSequences, normalAnalysis) {
  console.log('========================================');
  console.log('寻找"短拉快砸"特征模式');
  console.log('========================================\n');

  const targetAnalysis = targetSequences.map(analyzeSingleToken);

  console.log('【目标代币详细分析】\n');

  targetAnalysis.forEach(token => {
    console.log(`📊 ${token.symbol} (${token.address.slice(0, 10)}...)`);
    console.log(`   最终涨幅: +${token.max_change.toFixed(1)}%`);
    console.log(`   总交易: ${token.total_trades}笔`);
    console.log(`   净流入: $${token.net_flow.toFixed(0)}`);
    console.log('');

    console.log('   时间段分析:');
    token.time_segments.forEach(seg => {
      if (seg.trades === 0) return;
      console.log(`     ${seg.name}: ${seg.trades}笔, 买入${seg.buys}, 卖出${seg.sells}, 净流入$${seg.net_flow.toFixed(0)}`);
    });
    console.log('');

    console.log('   拉高砸盘特征:');
    console.log(`     最大峰值: $${token.max_rise.toFixed(0)} (出现在${token.max_rise_time}秒)`);
    console.log(`     峰值后卖出: $${token.after_rise_sell.toFixed(0)}`);
    console.log(`     峰值后买入: $${token.after_rise_buy.toFixed(0)}`);
    console.log(`     峰值后净流出: $${token.after_rise_net.toFixed(0)}`);
    console.log(`     峰值下跌: $${token.peak_drop.toFixed(0)} (${(token.peak_drop_ratio * 100).toFixed(1)}%)`);
    console.log('');

    console.log('   转折特征:');
    console.log(`     前1/3买入占比: ${(token.pivot_buy_ratio * 100).toFixed(1)}%`);
    console.log(`     后1/3卖出占比: ${(token.pivot_sell_ratio * 100).toFixed(1)}%`);
    console.log(`     转折幅度: ${(token.pivot_drop * 100).toFixed(1)}个百分点`);
    console.log(`     可疑: ${token.is_suspicious ? '⚠️ 是' : '否'}`);
    console.log('');
  });

  // 统计特征
  console.log('\n【共同特征统计】\n');

  const avgMaxChange = targetAnalysis.reduce((sum, t) => sum + t.max_change, 0) / targetAnalysis.length;
  const avgTrades = targetAnalysis.reduce((sum, t) => sum + t.total_trades, 0) / targetAnalysis.length;
  const avgNetFlow = targetAnalysis.reduce((sum, t) => sum + t.net_flow, 0) / targetAnalysis.length;
  const avgPeakDropRatio = targetAnalysis.reduce((sum, t) => sum + t.peak_drop_ratio, 0) / targetAnalysis.length;
  const avgPivotBuyRatio = targetAnalysis.reduce((sum, t) => sum + t.pivot_buy_ratio, 0) / targetAnalysis.length;

  console.log(`平均最终涨幅: ${avgMaxChange.toFixed(1)}%`);
  console.log(`平均交易数: ${avgTrades.toFixed(1)}笔`);
  console.log(`平均净流入: $${avgNetFlow.toFixed(0)}`);
  console.log(`平均峰值下跌比例: ${(avgPeakDropRatio * 100).toFixed(1)}%`);
  console.log(`平均前1/3买入占比: ${(avgPivotBuyRatio * 100).toFixed(1)}%`);

  // 与正常代币对比
  console.log('\n【与正常代币对比】\n');

  const normalAvgPeakDrop = normalAnalysis.reduce((sum, t) => sum + t.peak_drop_ratio, 0) / normalAnalysis.length;
  const normalAvgPivotBuy = normalAnalysis.reduce((sum, t) => sum + t.pivot_buy_ratio, 0) / normalAnalysis.length;

  console.log('特征对比:');
  console.log(`  峰值下跌比例:`);
  console.log(`    目标代币: ${(avgPeakDropRatio * 100).toFixed(1)}%`);
  console.log(`    正常代币: ${(normalAvgPeakDrop * 100).toFixed(1)}%`);
  console.log(`    差异: ${((avgPeakDropRatio - normalAvgPeakDrop) * 100).toFixed(1)}个百分点`);

  console.log(`\n  前1/3买入占比:`);
  console.log(`    目标代币: ${(avgPivotBuyRatio * 100).toFixed(1)}%`);
  console.log(`    正常代币: ${(normalAvgPivotBuy * 100).toFixed(1)}%`);
  console.log(`    差异: ${((avgPivotBuyRatio - normalAvgPivotBuy) * 100).toFixed(1)}个百分点`);

  return { targetAnalysis, normalAnalysis };
}

/**
 * 设计检测规则
 */
function designDetectionRules(targetAnalysis, allSequences) {
  console.log('\n========================================');
  console.log('设计"短拉快砸"检测规则');
  console.log('========================================\n');

  // 从目标代币中提取关键特征阈值
  const avgPeakDropRatio = targetAnalysis.reduce((sum, t) => sum + t.peak_drop_ratio, 0) / targetAnalysis.length;
  const avgPivotBuy = targetAnalysis.reduce((sum, t) => sum + t.pivot_buy_ratio, 0) / targetAnalysis.length;
  const avgPivotSell = targetAnalysis.reduce((sum, t) => sum + t.pivot_sell_ratio, 0) / targetAnalysis.length;

  console.log('【检测规则】\n');

  console.log('规则1: 峰值后快速下跌');
  console.log(`  条件: 峰值后30秒内净流入下跌超过峰值的50%`);
  console.log(`  目标代币平均: ${(avgPeakDropRatio * 100).toFixed(1)}%`);
  console.log(`  阈值: peak_drop_ratio > 0.3`);

  console.log('\n规则2: 前期买入后期卖出');
  console.log(`  条件: 前1/3买入占比 > 70% AND 后1/3卖出占比 > 40%`);
  console.log(`  目标代币平均买入: ${(avgPivotBuy * 100).toFixed(1)}%`);
  console.log(`  目标代币平均卖出: ${(avgPivotSell * 100).toFixed(1)}%`);

  console.log('\n规则3: 早期密集买入后停滞');
  console.log(`  条件: 前30秒买入占比 > 80% AND 30-60秒净流入 < 前30秒的30%`);

  // 在所有代币上测试这些规则
  console.log('\n【规则验证】\n');

  const testSequence = (seq, ruleName, checkFn) => {
    const analysis = analyzeSingleToken(seq);
    const passed = checkFn(analysis);
    return { address: seq.token_address, symbol: seq.token_symbol, passed, rule: ruleName, analysis };
  };

  // 规则1测试
  const rule1Results = allSequences.map(s =>
    testSequence(s, '峰值后快速下跌', a => a.peak_drop_ratio > 0.3)
  );

  // 规则2测试
  const rule2Results = allSequences.map(s =>
    testSequence(s, '前期买入后期卖出', a => a.pivot_buy_ratio > 0.7 && a.pivot_sell_ratio > 0.4)
  );

  // 规则3测试
  const rule3Results = allSequences.map(s => {
    const analysis = analyzeSingleToken(s);
    const first30sBuy = s.sequence.slice(0, 10).filter(([, a]) => a > 0).length;
    const first30sRatio = first30sBuy / Math.min(10, s.sequence.length);

    const second30sBuy = s.sequence.slice(10, 20).filter(([, a]) => a > 0).length;
    const second30sNet = s.sequence.slice(10, 20).reduce((sum, [, a]) => sum + a, 0);
    const first30sNet = s.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);

    const passed = first30sRatio > 0.8 && Math.abs(second30sNet) < Math.abs(first30sNet) * 0.3;

    return {
      address: s.token_address,
      symbol: s.token_symbol,
      passed,
      rule: '早期密集买入后停滞',
      analysis
    };
  });

  // 统计结果
  const printRuleStats = (results, name) => {
    const passed = results.filter(r => r.passed);
    console.log(`\n${name}:`);
    console.log(`  符合条件: ${passed.length}个代币 (${(passed.length / results.length * 100).toFixed(1)}%)`);

    if (passed.length > 0) {
      const avgChange = passed.reduce((sum, t) => sum + t.analysis.max_change, 0) / passed.length;
      const highReturn = passed.filter(t => t.analysis.max_change >= 100).length;
      console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
      console.log(`  高涨幅占比: ${(highReturn / passed.length * 100).toFixed(1)}%`);

      // 检查目标代币是否被识别
      const targetFound = passed.filter(t => targetAddresses.includes(t.address));
      console.log(`  目标代币识别: ${targetFound.length}/${targetAddresses.length}`);
    }
  };

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444'
  ];

  printRuleStats(rule1Results, '规则1: 峰值后快速下跌');
  printRuleStats(rule2Results, '规则2: 前期买入后期卖出');
  printRuleStats(rule3Results, '规则3: 早期密集买入后停滞');

  return { rule1Results, rule2Results, rule3Results };
}

async function main() {
  console.log('========================================');
  console.log('"短拉快砸"代币模式深度分析');
  console.log('========================================\n');

  // 加载所有序列数据
  const sequencesPath = path.join(PROCESSED_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const seqData = JSON.parse(content);

  console.log(`✓ 读取 ${seqData.sequences.length} 个代币序列\n`);

  // 加载目标代币
  const { targetTokens, targetSequences } = loadSpecificTokens();
  console.log(`✓ 找到 ${targetSequences.length} 个目标代币\n`);

  if (targetSequences.length === 0) {
    console.log('❌ 未找到目标代币，请检查地址是否正确');
    return;
  }

  // 显示目标代币基本信息
  console.log('【目标代币基本信息】\n');
  targetSequences.forEach(s => {
    console.log(`${s.token_symbol}: +${s.max_change_percent.toFixed(1)}%, ${s.sequence.length}笔交易`);
  });
  console.log('');

  // 分析模式
  const { normalAnalysis } = compareWithNormal(seqData.sequences);
  const { targetAnalysis } = findPumpAndDumpPatterns(targetSequences, normalAnalysis);

  // 设计并测试检测规则
  designDetectionRules(targetAnalysis, seqData.sequences);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
