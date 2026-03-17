/**
 * 深度分析"短拉快砸"代币的转折信号
 * 包括新提供的代币
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
 * 深度分析60-90秒转折点
 */
function deepTurnAnalysis(sequences, rawData) {
  console.log('========================================');
  console.log('60-90秒转折点深度分析');
  console.log('========================================\n');

  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444',
    '0xd583de96dd227184f7abc2a33ebc6cbead044444' // 新增
  ];

  // 合并原始数据和序列数据
  const enrichedSequences = sequences.map(seq => {
    const rawToken = rawData.find(t => t.token_address === seq.token_address);
    return {
      ...seq,
      launch_price: rawToken?.ave_api_response?.data?.tokenInfo?.token?.launch_price || 0,
      current_price: rawToken?.ave_api_response?.data?.tokenInfo?.token?.current_price_usd || 0
    };
  });

  const targetSeq = enrichedSequences.filter(s => targetAddresses.includes(s.token_address));

  console.log(`找到 ${targetSeq.length} 个目标代币\n`);

  targetSeq.forEach(seq => {
    console.log(`📊 ${seq.token_symbol} (${seq.token_address.slice(0, 10)}...)`);
    console.log(`   最终涨幅: +${seq.max_change_percent.toFixed(1)}%`);
    console.log(`   交易数: ${seq.sequence.length}笔`);
    console.log(`   启动价格: $${seq.launch_price}`);
    console.log(`   当前价格: $${seq.current_price}`);
    console.log('');

    // 分析前90秒的详细交易
    console.log('   前90秒详细分析:');
    console.log('   时间段 | 交易 | 买入 | 卖出 | 净流入 | 买入占比');
    console.log('   -------|------|------|------|--------|----------');

    for (let i = 0; i < 3; i++) {
      const start = i * 10;
      const end = Math.min((i + 1) * 10, seq.sequence.length);
      const window = seq.sequence.slice(start, end);

      const buys = window.filter(([, a]) => a > 0).length;
      const sells = window.filter(([, a]) => a < 0).length;
      const netFlow = window.reduce((sum, [, a]) => sum + a, 0);
      const buyRatio = window.length > 0 ? buys / window.length : 0;

      const timeRange = `${i * 30}-${(i + 1) * 30}s`;

      console.log(`   ${timeRange.padEnd(7)} | ${window.length.toString().padStart(4)} | ${buys.toString().padStart(4)} | ${sells.toString().padStart(4)} | ${netFlow > 0 ? '+' : ''}${netFlow.toFixed(0).padStart(6)} | ${(buyRatio * 100).toFixed(0)}%`);
    }

    console.log('');
    console.log('   📍 关键发现:');

    // 分析净流入趋势
    const net30s = seq.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);
    const net30_60 = seq.sequence.slice(10, 20).reduce((sum, [, a]) => sum + a, 0);
    const net60_90 = seq.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0);
    const net90_120 = seq.sequence.slice(30, 40).reduce((sum, [, a]) => sum + a, 0);

    // 判断转折点
    const maxEarly = Math.max(net30s, net30_60);
    const midDrop = Math.abs(net60_90 - maxEarly) / Math.abs(maxEarly);
    const lateTrend = net90_120 > 0 ? '恢复' : '继续下跌';

    console.log(`     前30-60秒最大净流入: $${maxEarly.toFixed(0)}`);
    console.log(`     60-90秒相对下降: ${(midDrop * 100).toFixed(1)}%`);
    console.log(`     90-120秒趋势: ${lateTrend}`);

    // 检测"砸盘开始"信号
    const dumpStarted = net30s > 0 && net30_60 > 0 && net60_90 < Math.min(net30s, net30_60) * 0.5;
    const dumpIntensified = net60_90 < 0 && net90_120 < 0;

    if (dumpStarted) {
      console.log(`     ⚠️  60-90秒开始砸盘`);
    }
    if (dumpIntensified) {
      console.log(`     🔴  60-120秒持续砸盘`);
    }

    console.log('');
  });

  // 统计转折点特征
  console.log('\n【60-90秒转折点统计规律】\n');

  const allTurnStats = sequences.map(seq => {
    const net30s = seq.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);
    const net30_60 = seq.sequence.slice(10, 20).reduce((sum, [, a]) => sum + a, 0);
    const net60_90 = seq.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0);

    const maxEarly = Math.max(net30s, net30_60);
    const midDropRatio = maxEarly > 0 ? (maxEarly - net60_90) / maxEarly : 0;

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      maxEarly,
      net60_90,
      midDropRatio
    };
  });

  // 按中段下跌比例分组
  const groups = {
    '急剧下跌 (>50%)': [],
    '中度下跌 (20-50%)': [],
    '小幅下跌 (0-20%)': [],
    '无下跌 (<0)': []
  };

  allTurnStats.forEach(s => {
    if (s.midDropRatio > 0.5) {
      groups['急剧下跌 (>50%)'].push(s);
    } else if (s.midDropRatio > 0.2) {
      groups['中度下跌 (20-50%)'].push(s);
    } else if (s.midDropRatio > 0) {
      groups['小幅下跌 (0-20%)'].push(s);
    } else {
      groups['无下跌 (<0)'].push(s);
    }
  });

  Object.entries(groups).forEach(([name, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const highReturn = tokens.filter(t => t.change >= 100).length / tokens.length;

    console.log(`${name}:`);
    console.log(`  代币数: ${tokens.length}`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturn * 100).toFixed(1)}%`);

    // 检查目标代币分布
    const targetInGroup = tokens.filter(t => targetAddresses.includes(t.address));
    if (targetInGroup.length > 0) {
      console.log(`  目标代币: ${targetInGroup.map(t => t.symbol).join(', ')}`);
    }
    console.log('');
  });

  // 设计早期检测规则
  console.log('\n【基于60-90秒转折的早期检测规则】\n');

  console.log('规则: "暴拉后骤降"');
  console.log('条件:');
  console.log('  1. 前30-60秒净流入 > $500');
  console.log('  2. 60-90秒净流入 < 前30-60秒的50%');
  console.log('  3. 60-90秒净流入为负（可选加强条件）');

  // 测试规则
  const testResults = sequences.map(seq => {
    const net30s = seq.sequence.slice(0, 10).reduce((sum, [, a]) => sum + a, 0);
    const net30_60 = seq.sequence.slice(10, 20).reduce((sum, [, a]) => sum + a, 0);
    const net60_90 = seq.sequence.slice(20, 30).reduce((sum, [, a]) => sum + a, 0);

    const maxEarly = Math.max(net30s, net30_60);
    const midDrop = maxEarly - net60_90;
    const midDropRatio = maxEarly > 0 ? midDrop / maxEarly : 0;

    const passed = maxEarly > 500 && midDropRatio > 0.5;

    return {
      symbol: seq.token_symbol,
      address: seq.token_address,
      change: seq.max_change_percent,
      passed,
      maxEarly,
      net60_90,
      midDropRatio
    };
  });

  const passed = testResults.filter(r => r.passed);
  const targetMatches = passed.filter(r => targetAddresses.includes(r.address));

  console.log(`\n规则验证结果:`);
  console.log(`  符合条件: ${passed.length}个 (${(passed.length / sequences.length * 100).toFixed(1)}%)`);

  if (passed.length > 0) {
    const avgChange = passed.reduce((sum, r) => sum + r.change, 0) / passed.length;
    const highReturn = passed.filter(r => r.change >= 100).length / passed.length;

    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturn * 100).toFixed(1)}%`);
  }

  console.log(`\n目标代币识别: ${targetMatches.length}/${targetAddresses.length}`);
  targetMatches.forEach(t => {
    console.log(`  ${t.symbol}: +${t.change.toFixed(1)}%, 中段下跌${(t.midDropRatio * 100).toFixed(1)}%`);
  });

  return testResults;
}

async function main() {
  console.log('========================================');
  console.log('"短拉快砸"转折信号深度分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列`);

  const rawData = loadRawData();
  console.log(`✓ 读取 ${rawData.length} 个原始代币数据\n`);

  // 深度分析
  deepTurnAnalysis(sequences, rawData);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
