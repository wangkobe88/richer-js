/**
 * 短拉快砸检测规则验证
 * 设计综合规则并验证其预测力和实用性
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

/**
 * 计算窗口统计
 */
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
 * 综合检测规则（基于多模式分析）
 * 使用: OR 逻辑，满足任一子规则即标记为"短拉快砸"
 */
function detectShortPumpQuickDump(sequence) {
  const stats = getWindowStats(sequence);
  if (stats.length < 4) return { isDump: false, reason: '数据不足' };

  const [s0, s1, s2, s3] = stats;
  const maxEarly = Math.max(s0.netFlow, s1.netFlow);

  // 规则1: 经典60-90秒急剧转折
  const rule1 = maxEarly > 500 &&
                s2.netFlow < 0 &&
                (maxEarly - s2.netFlow) / maxEarly > 0.5;

  // 规则2: 延迟90-120秒转折
  const rule2 = maxEarly > 500 &&
                s1.netFlow > 0 && s2.netFlow > 0 &&
                s3.netFlow < 0 &&
                (maxEarly - s3.netFlow) / maxEarly > 0.6;

  // 规则3: 买入占比急剧下降
  const earlyBuyRatio = Math.max(s0.buyRatio, s1.buyRatio);
  const lateBuyRatio = Math.min(s2.buyRatio, s3.buyRatio);
  const rule3 = earlyBuyRatio > 0.7 &&
                (earlyBuyRatio - lateBuyRatio) > 0.3;

  // 规则4: 小额拉盘后持续下降（针对Duck you类型）
  const rule4 = maxEarly > 200 &&
                s0.netFlow >= s1.netFlow &&
                s1.netFlow >= s2.netFlow &&
                s2.netFlow >= s3.netFlow &&
                s3.netFlow < 0;

  // 规则5: 60-90秒负流入且早期有强买入
  const rule5 = s2.netFlow < 0 &&
                earlyBuyRatio > 0.6 &&
                maxEarly > 300;

  const isDump = rule1 || rule2 || rule3 || rule4 || rule5;

  let reason = [];
  if (rule1) reason.push('60-90秒急剧转折');
  if (rule2) reason.push('90-120秒延迟转折');
  if (rule3) reason.push('买入占比崩溃');
  if (rule4) reason.push('小额持续下降');
  if (rule5) reason.push('早期强势后转负');

  return {
    isDump,
    reason: reason.join(', ') || '不符合',
    ruleMatches: { rule1, rule2, rule3, rule4, rule5 },
    stats
  };
}

/**
 * 验证检测规则的效果
 */
function validateDetectionRule(sequences) {
  console.log('========================================');
  console.log('短拉快砸检测规则验证');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'
  ];

  // 检测所有代币
  const results = sequences.map(seq => {
    const detection = detectShortPumpQuickDump(seq);
    return {
      symbol: seq.token_symbol,
      address: seq.token_address,
      change: seq.max_change_percent,
      isTarget: targetAddresses.includes(seq.token_address),
      ...detection
    };
  });

  const dumpTokens = results.filter(r => r.isDump);
  const normalTokens = results.filter(r => !r.isDump);
  const dumpTargets = dumpTokens.filter(r => r.isTarget);

  console.log('【整体统计】');
  console.log(`检测为"短拉快砸": ${dumpTokens.length}个 (${(dumpTokens.length / results.length * 100).toFixed(1)}%)`);
  console.log(`目标代币覆盖: ${dumpTargets.length}/${targetAddresses.length}\n`);

  // 分析被标记代币的表现
  const avgDumpChange = dumpTokens.reduce((sum, r) => sum + r.change, 0) / dumpTokens.length;
  const avgNormalChange = normalTokens.reduce((sum, r) => sum + r.change, 0) / normalTokens.length;
  const dumpHighReturn = dumpTokens.filter(r => r.change >= 100).length / dumpTokens.length;
  const normalHighReturn = normalTokens.filter(r => r.change >= 100).length / normalTokens.length;

  console.log('【收益表现对比】');
  console.log(`被标记代币 (${dumpTokens.length}个):`);
  console.log(`  平均涨幅: ${avgDumpChange.toFixed(1)}%`);
  console.log(`  高涨幅占比: ${(dumpHighReturn * 100).toFixed(1)}%`);

  console.log(`\n未被标记代币 (${normalTokens.length}个):`);
  console.log(`  平均涨幅: ${avgNormalChange.toFixed(1)}%`);
  console.log(`  高涨幅占比: ${(normalHighReturn * 100).toFixed(1)}%`);

  const diff = avgDumpChange - avgNormalChange;
  console.log(`\n差异: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

  // 显示目标代币详情
  console.log('\n【目标代币检测结果】\n');

  const targetResults = results.filter(r => r.isTarget);
  targetResults.forEach(r => {
    console.log(`${r.symbol} (+${r.change.toFixed(1)}%)`);
    console.log(`  检测结果: ${r.isDump ? '⚠️ 短拉快砸' : '✓ 正常'}`);
    console.log(`  匹配规则: ${r.reason}`);
    console.log(`  净流入序列: ${r.stats.map((s, i) => `${i * 30}-${(i + 1) * 30}s:$${s.netFlow.toFixed(0)}`).join(', ')}`);
    console.log('');
  });

  // 分析各规则的贡献
  console.log('\n【各规则的贡献度】\n');

  const rules = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'];
  const ruleNames = {
    rule1: '60-90秒急剧转折',
    rule2: '90-120秒延迟转折',
    rule3: '买入占比崩溃',
    rule4: '小额持续下降',
    rule5: '早期强势后转负'
  };

  rules.forEach(rule => {
    const matched = dumpTokens.filter(r => r.ruleMatches[rule]);
    const targetsCaught = matched.filter(r => r.isTarget).length;
    const avgChange = matched.reduce((sum, r) => sum + r.change, 0) / matched.length;

    console.log(`${ruleNames[rule]}:`);
    console.log(`  触发次数: ${matched.length}个代币`);
    console.log(`  目标覆盖: ${targetsCaught}/${targetAddresses.length}`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log('');
  });

  // 分析不同匹配数量的表现
  console.log('\n【匹配规则数量与涨幅关系】\n');

  const matchCountGroups = {};
  dumpTokens.forEach(r => {
    const count = Object.values(r.ruleMatches).filter(v => v).length;
    if (!matchCountGroups[count]) matchCountGroups[count] = [];
    matchCountGroups[count].push(r);
  });

  Object.entries(matchCountGroups)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([count, tokens]) => {
      const avgChange = tokens.reduce((sum, r) => sum + r.change, 0) / tokens.length;
      const highReturnRate = tokens.filter(r => r.change >= 100).length / tokens.length;
      const targetCount = tokens.filter(r => r.isTarget).length;

      console.log(`匹配${count}个规则 (${tokens.length}个代币):`);
      console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
      console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
      console.log(`  目标代币: ${targetCount}个`);
      console.log('');
    });

  // 投资建议分析
  console.log('\n【投资建议】\n');

  console.log('如果避免"短拉快砸"代币:');
  const avoidDump = normalTokens;
  const avgAvoidChange = avoidDump.reduce((sum, r) => sum + r.change, 0) / avoidDump.length;
  const avoidHighReturn = avoidDump.filter(r => r.change >= 100).length / avoidDump.length;
  console.log(`  平均涨幅: ${avgAvoidChange.toFixed(1)}% (vs 全部 ${avgNormalChange.toFixed(1)}%)`);
  console.log(`  高涨幅占比: ${(avoidHighReturn * 100).toFixed(1)}% (vs 全部 ${(normalHighReturn * 100).toFixed(1)}%)`);
  console.log(`  收益提升: ${((avgAvoidChange - avgNormalChange) / Math.abs(avgNormalChange) * 100).toFixed(1)}%`);

  console.log('\n如果专门投资"短拉快砸"代币:');
  console.log(`  平均涨幅: ${avgDumpChange.toFixed(1)}%`);
  console.log(`  高涨幅占比: ${(dumpHighReturn * 100).toFixed(1)}%`);
  console.log(`  ⚠️ 风险: 这些代币波动极大，可能快速归零`);

  return results;
}

async function main() {
  console.log('========================================');
  console.log('短拉快砸检测规则验证');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  const results = validateDetectionRule(sequences);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
