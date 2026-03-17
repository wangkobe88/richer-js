/**
 * 严谨验证检测策略的准确性和召回率
 *
 * 核心问题：
 * 1. 5个正样本是否足够？能否代表所有"短拉快砸"代币？
 * 2. 66.5%的召回率太高，是否误伤了好代币？
 * 3. 如何定义"好的持续涨的代币"（负样本）？
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

function getWindowStats(sequence) {
  const trades = sequence.sequence;
  const windows = [
    { name: '0-30s', start: 0, end: 10 },
    { name: '30-60s', start: 10, end: 20 },
    { name: '60-90s', start: 20, end: 30 },
    { name: '90-120s', start: 30, end: 40 },
    { name: '120-150s', start: 40, end: 50 },
  ];

  return windows.map(win => {
    const windowTrades = trades.slice(win.start, Math.min(win.end, trades.length));
    const netFlow = windowTrades.reduce((sum, [, a]) => sum + a, 0);
    const buys = windowTrades.filter(([, a]) => a > 0).length;
    const buyRatio = windowTrades.length > 0 ? buys / windowTrades.length : 0;

    return { netFlow, buyRatio };
  });
}

/**
 * 原检测规则（宽松版）
 */
function detectDumpLoose(sequence) {
  const stats = getWindowStats(sequence);
  if (stats.length < 4) return { isDump: false };

  const [s0, s1, s2, s3] = stats;
  const maxEarly = Math.max(s0.netFlow, s1.netFlow);

  const rule1 = maxEarly > 500 && s2.netFlow < 0 && (maxEarly - s2.netFlow) / maxEarly > 0.5;
  const rule2 = maxEarly > 500 && s1.netFlow > 0 && s2.netFlow > 0 && s3.netFlow < 0 && (maxEarly - s3.netFlow) / maxEarly > 0.6;
  const earlyBuyRatio = Math.max(s0.buyRatio, s1.buyRatio);
  const lateBuyRatio = Math.min(s2.buyRatio, s3.buyRatio);
  const rule3 = earlyBuyRatio > 0.7 && (earlyBuyRatio - lateBuyRatio) > 0.3;
  const rule4 = maxEarly > 200 && s0.netFlow >= s1.netFlow && s1.netFlow >= s2.netFlow && s2.netFlow >= s3.netFlow && s3.netFlow < 0;
  const rule5 = s2.netFlow < 0 && earlyBuyRatio > 0.6 && maxEarly > 300;

  return { isDump: rule1 || rule2 || rule3 || rule4 || rule5 };
}

/**
 * 严格版检测规则
 * 提高阈值，减少误召回
 */
function detectDumpStrict(sequence) {
  const stats = getWindowStats(sequence);
  if (stats.length < 4) return { isDump: false, reason: '数据不足' };

  const [s0, s1, s2, s3] = stats;
  const maxEarly = Math.max(s0.netFlow, s1.netFlow);

  // 规则1: 60-90秒急剧转折（提高阈值）
  const rule1 = maxEarly > 800 && // 提高到$800
                s2.netFlow < 0 &&
                (maxEarly - s2.netFlow) / maxEarly > 0.7; // 提高到70%

  // 规则2: 90-120秒延迟转折（提高阈值）
  const rule2 = maxEarly > 800 &&
                s1.netFlow > 0 && s2.netFlow > 0 &&
                s3.netFlow < 0 &&
                (maxEarly - s3.netFlow) / maxEarly > 0.8; // 提高到80%

  // 规则3: 买入占比崩溃（更严格）
  const earlyBuyRatio = Math.max(s0.buyRatio, s1.buyRatio);
  const lateBuyRatio = Math.min(s2.buyRatio, s3.buyRatio);
  const rule3 = earlyBuyRatio > 0.8 && // 提高到80%
                (earlyBuyRatio - lateBuyRatio) > 0.4; // 提高到40个百分点

  // 规则4: 小额持续下降（保持原阈值）
  const rule4 = maxEarly > 200 &&
                s0.netFlow >= s1.netFlow &&
                s1.netFlow >= s2.netFlow &&
                s2.netFlow >= s3.netFlow &&
                s3.netFlow < 0;

  // 规则5: 早期强势后转负（提高阈值）
  const rule5 = s2.netFlow < -100 && // 明显负流入
                earlyBuyRatio > 0.7 &&
                maxEarly > 500;

  return {
    isDump: rule1 || rule2 || rule3 || rule4 || rule5,
    ruleMatches: { rule1, rule2, rule3, rule4, rule5 }
  };
}

/**
 * 分析问题：为什么66.5%的召回率太高？
 */
function analyzeHighRecallProblem(sequences) {
  console.log('========================================');
  console.log('问题分析：为什么召回率这么高？');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'
  ];

  // 使用宽松规则检测
  const results = sequences.map(seq => ({
    ...seq,
    isDump: detectDumpLoose(seq).isDump,
    isTarget: targetAddresses.includes(seq.token_address)
  }));

  const dumpTokens = results.filter(r => r.isDump);
  const normalTokens = results.filter(r => !r.isDump);

  console.log('【宽松规则统计】');
  console.log(`被标记为"短拉快砸": ${dumpTokens.length}个 (${(dumpTokens.length / results.length * 100).toFixed(1)}%)`);
  console.log(`未被标记: ${normalTokens.length}个 (${(normalTokens.length / results.length * 100).toFixed(1)}%)`);

  // 问题1: 高涨幅代币中有多少被标记？
  console.log('\n【问题1: 高涨幅代币的误召回情况】\n');

  const highReturnTokens = results.filter(r => r.max_change_percent >= 100);
  const highReturnDump = highReturnTokens.filter(r => r.isDump);
  const highReturnNormal = highReturnTokens.filter(r => !r.isDump);

  console.log(`高涨幅代币 (≥100%): ${highReturnTokens.length}个`);
  console.log(`  被标记: ${highReturnDump.length}个 (${(highReturnDump.length / highReturnTokens.length * 100).toFixed(1)}%)`);
  console.log(`  未被标记: ${highReturnNormal.length}个 (${(highReturnNormal.length / highReturnTokens.length * 100).toFixed(1)}%)`);

  // 分析未被标记但高涨幅的代币特征
  console.log('\n未被标记但高涨幅的代币（前20个）:');
  highReturnNormal
    .sort((a, b) => b.max_change_percent - a.max_change_percent)
    .slice(0, 20)
    .forEach(t => {
      const stats = getWindowStats(t);
      console.log(`  ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}% | 净流入: ${stats.map(s => `$${s.netFlow.toFixed(0)}`).join(', ')}`);
    });

  // 问题2: 被标记但涨幅一般的代币
  console.log('\n【问题2: 被标记但涨幅一般的代币】\n');

  const mediumReturnDump = dumpTokens.filter(r => r.max_change_percent >= 50 && r.max_change_percent < 100);

  console.log(`被标记但涨幅一般(50-100%): ${mediumReturnDump.length}个`);
  console.log('这些可能是误召回的"短拉快砸":');
  mediumReturnDump
    .sort((a, b) => b.max_change_percent - a.max_change_percent)
    .slice(0, 15)
    .forEach(t => {
      const stats = getWindowStats(t);
      console.log(`  ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}% | 净流入: ${stats.map(s => `$${s.netFlow.toFixed(0)}`).join(', ')}`);
    });

  // 问题3: 正样本和负样本的特征差异
  console.log('\n【问题3: 正样本 vs 负样本的特征对比】\n');

  const targetTokens = results.filter(r => r.isTarget);
  const normalHighReturn = highReturnNormal.filter(r => !r.isTarget);

  console.log('正样本（用户提供的"短拉快砸"）:');
  targetTokens.forEach(t => {
    const stats = getWindowStats(t);
    console.log(`  ${t.token_symbol} (+${t.max_change_percent.toFixed(1)}%):`);
    console.log(`    净流入: ${stats.map(s => `$${s.netFlow.toFixed(0)}`).join(', ')}`);
    console.log(`    买入占比: ${stats.map(s => `${(s.buyRatio * 100).toFixed(0)}%`).join(', ')}`);
  });

  console.log('\n负样本（未被标记的高涨幅代币）- 前10个:');
  normalHighReturn
    .sort((a, b) => b.max_change_percent - a.max_change_percent)
    .slice(0, 10)
    .forEach(t => {
      const stats = getWindowStats(t);
      console.log(`  ${t.token_symbol} (+${t.max_change_percent.toFixed(1)}%):`);
      console.log(`    净流入: ${stats.map(s => `$${s.netFlow.toFixed(0)}`).join(', ')}`);
      console.log(`    买入占比: ${stats.map(s => `${(s.buyRatio * 100).toFixed(0)}%`).join(', ')}`);
    });

  return { dumpTokens, normalTokens, highReturnDump, highReturnNormal };
}

/**
 * 测试严格规则
 */
function testStrictRule(sequences) {
  console.log('\n========================================');
  console.log('测试严格规则（降低误召回）');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'
  ];

  const results = sequences.map(seq => ({
    ...seq,
    detection: detectDumpStrict(seq),
    isTarget: targetAddresses.includes(seq.token_address)
  }));

  const dumpTokens = results.filter(r => r.detection.isDump);
  const normalTokens = results.filter(r => !r.detection.isDump);
  const dumpTargets = dumpTokens.filter(r => r.isTarget);

  console.log('【严格规则统计】');
  console.log(`被标记为"短拉快砸": ${dumpTokens.length}个 (${(dumpTokens.length / results.length * 100).toFixed(1)}%)`);
  console.log(`目标代币覆盖: ${dumpTargets.length}/${targetAddresses.length}`);

  const avgDumpChange = dumpTokens.reduce((sum, r) => sum + r.max_change_percent, 0) / dumpTokens.length;
  const avgNormalChange = normalTokens.reduce((sum, r) => sum + r.max_change_percent, 0) / normalTokens.length;

  console.log(`\n被标记代币平均涨幅: ${avgDumpChange.toFixed(1)}%`);
  console.log(`未被标记代币平均涨幅: ${avgNormalChange.toFixed(1)}%`);

  // 显示目标代币检测情况
  console.log('\n【目标代币检测情况】\n');
  results.filter(r => r.isTarget).forEach(r => {
    console.log(`${r.token_symbol} (+${r.max_change_percent.toFixed(1)}%): ${r.detection.isDump ? '✓ 识别' : '✗ 漏检'}`);
  });

  // 分析高涨幅代币的召回
  const highReturnTokens = results.filter(r => r.max_change_percent >= 100);
  const highReturnDump = highReturnTokens.filter(r => r.detection.isDump);

  console.log(`\n高涨幅代币误召回率: ${highReturnDump.length}/${highReturnTokens.length} (${(highReturnDump.length / highReturnTokens.length * 100).toFixed(1)}%)`);

  return { dumpTokens, normalTokens, dumpTargets };
}

/**
 * 寻找更好的区分特征
 */
function findBetterDiscriminators(sequences) {
  console.log('\n========================================');
  console.log('寻找更好的区分特征');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'
  ];

  const positive = sequences.filter(s => targetAddresses.includes(s.token_address));
  const negative = sequences.filter(s => !targetAddresses.includes(s.token_address) && s.max_change_percent >= 200);

  console.log(`正样本（用户确认的短拉快砸）: ${positive.length}个`);
  console.log(`负样本（高涨幅持续涨的代币）: ${negative.length}个\n`);

  // 计算各种特征的区分能力
  const features = [
    {
      name: '0-30s净流入',
      calc: s => s.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0)
    },
    {
      name: '30-60s净流入',
      calc: s => s.sequence.slice(10, 20).reduce((sum, [, a]) => sum + a, 0)
    },
    {
      name: '60-90s净流入',
      calc: s => s.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0)
    },
    {
      name: '90-120s净流入',
      calc: s => s.sequence.slice(30, 40).reduce((sum, [, a]) => sum + a, 0)
    },
    {
      name: '60-90s/0-30s比例',
      calc: s => {
        const s0 = s.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);
        const s2 = s.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0);
        return s0 > 0 ? s2 / s0 : 0;
      }
    },
    {
      name: '90-120s/0-30s比例',
      calc: s => {
        const s0 = s.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);
        const s3 = s.sequence.slice(30, 40).reduce((sum, [, a]) => sum + a, 0);
        return s0 > 0 ? s3 / s0 : 0;
      }
    },
    {
      name: '0-30s买入占比',
      calc: s => {
        const buys = s.sequence.slice(0, 10).filter(([, a]) => a > 0).length;
        return buys / Math.min(10, s.sequence.length);
      }
    },
    {
      name: '60-90s买入占比',
      calc: s => {
        const buys = s.sequence.slice(20, 30).filter(([, a]) => a > 0).length;
        return buys / Math.min(10, s.sequence.length);
      }
    },
    {
      name: '买入占比下降幅度',
      calc: s => {
        const r0 = s.sequence.slice(0, 10).filter(([, a]) => a > 0).length / 10;
        const r2 = s.sequence.slice(20, 30).filter(([, a]) => a > 0).length / 10;
        return r0 - r2;
      }
    },
    {
      name: '波动率（前30s买卖切换次数）',
      calc: s => {
        let transitions = 0;
        let lastWasBuy = null;
        s.sequence.slice(0, 10).forEach(([, a]) => {
          const isBuy = a > 0;
          if (lastWasBuy !== null && lastWasBuy !== isBuy) transitions++;
          lastWasBuy = isBuy;
        });
        return transitions;
      }
    }
  ];

  console.log('【特征对比：正样本 vs 负样本】\n');

  features.forEach(feature => {
    const posValues = positive.map(feature.calc);
    const negValues = negative.map(feature.calc);

    const posMean = posValues.reduce((a, b) => a + b, 0) / posValues.length;
    const negMean = negValues.reduce((a, b) => a + b, 0) / negValues.length;

    // 计算区分度
    const posStd = Math.sqrt(posValues.reduce((sum, v) => sum + (v - posMean) ** 2, 0) / posValues.length);
    const negStd = Math.sqrt(negValues.reduce((sum, v) => sum + (v - negMean) ** 2, 0) / negValues.length);
    const discrimination = Math.abs(posMean - negMean) / Math.sqrt(posStd ** 2 + negStd ** 2);

    console.log(`${feature.name}:`);
    console.log(`  正样本: ${posMean.toFixed(2)} (±${posStd.toFixed(2)})`);
    console.log(`  负样本: ${negMean.toFixed(2)} (±${negStd.toFixed(2)})`);
    console.log(`  区分度: ${discrimination.toFixed(3)} ${discrimination > 0.5 ? '⭐' : ''}`);
    console.log('');
  });

  // 找出最显著的特征组合
  console.log('【关键发现】\n');

  const target60_90 = positive.map(s => s.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0));
  const normal60_90 = negative.map(s => s.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0));

  const targetNegative60_90 = target60_90.filter(v => v < 0).length;
  const normalNegative60_90 = normal60_90.filter(v => v < 0).length;

  console.log(`60-90秒负流入占比:`);
  console.log(`  正样本: ${targetNegative60_90}/${positive.length} (${(targetNegative60_90 / positive.length * 100).toFixed(1)}%)`);
  console.log(`  负样本: ${normalNegative60_90}/${negative.length} (${(normalNegative60_90 / negative.length * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('========================================');
  console.log('检测策略准确性验证');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 分析问题
  analyzeHighRecallProblem(sequences);

  // 测试严格规则
  testStrictRule(sequences);

  // 寻找更好的区分特征
  findBetterDiscriminators(sequences);

  console.log('\n========================================');
  console.log('结论');
  console.log('========================================\n');

  console.log('当前问题:');
  console.log('1. 只有5个正样本，不足以代表所有"短拉快砸"代币');
  console.log('2. 66.5%的召回率太高，误召回了很多好代币');
  console.log('3. "短拉快砸"的定义和特征还不够明确');
  console.log('');
  console.log('建议改进方向:');
  console.log('1. 收集更多用户确认的"短拉快砸"代币（需要30-50个样本）');
  console.log('2. 明确定义"好的持续涨的代币"作为负样本');
  console.log('3. 使用机器学习方法（如随机森林）训练分类器');
  console.log('4. 建议使用严格规则，降低误召回率');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
