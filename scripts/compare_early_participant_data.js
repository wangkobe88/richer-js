/**
 * 对比分析：历史分析报告 vs 当前实验 e3adb56a-2d36-46b2-9d54-d6a6639e51a5
 * 验证早期参与者特征在不同数据集上的一致性
 */

const EXPERIMENT_ID = 'e3adb56a-2d36-46b2-9d54-d6a6639e51a5';
const BASE_URL = 'http://localhost:3010';

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

// 历史分析报告的数据（3分钟窗口）
const HISTORICAL_DATA = {
  fake_pump: {
    filteredTrades: 79.3,
    uniqueWallets: 27.7,
    highValueTrades: 6.2,
    volumeUsd: 2258
  },
  low_quality: {
    filteredTrades: 81.5,
    uniqueWallets: 31.6,
    highValueTrades: 9.9,
    volumeUsd: 2894
  },
  mid_quality: {
    filteredTrades: 147.3,
    uniqueWallets: 62.7,
    highValueTrades: 32.3,
    volumeUsd: 14064
  },
  high_quality: {
    filteredTrades: 170.5,
    uniqueWallets: 80.6,
    highValueTrades: 63.9,
    volumeUsd: 18877
  }
};

// 转换历史数据为速率指标（假设3分钟窗口）
function convertToRateMetrics(data, windowMinutes = 3) {
  return {
    countPerMin: data.filteredTrades / windowMinutes,
    walletsPerMin: data.uniqueWallets / windowMinutes,
    highValuePerMin: data.highValueTrades / windowMinutes,
    volumePerMin: data.volumeUsd / windowMinutes
  };
}

const HISTORICAL_RATES = {};
for (const [key, data] of Object.entries(HISTORICAL_DATA)) {
  HISTORICAL_RATES[key] = convertToRateMetrics(data, 3);
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Fetch failed after retries');
}

async function main() {
  console.log('========================================');
  console.log('早期参与者特征对比分析');
  console.log('========================================\n');
  console.log(`历史数据: trading_activity_analysis.md (541代币, 3分钟窗口)`);
  console.log(`当前实验: ${EXPERIMENT_ID}\n`);

  // ========== 获取当前实验数据 ==========
  console.log('正在获取当前实验数据...\n');

  // 获取代币
  let tokens = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchWithRetry(
      `${BASE_URL}/api/experiment/${EXPERIMENT_ID}/tokens?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    );

    if (!data.success || !data.tokens) break;
    tokens.push(...data.tokens);

    if (data.tokens.length < limit) break;
    offset += limit;
  }

  // 获取信号
  let signals = [];
  offset = 0;

  while (true) {
    const data = await fetchWithRetry(
      `${BASE_URL}/api/experiment/${EXPERIMENT_ID}/signals?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    );

    if (!data.success || !data.signals) break;
    signals.push(...data.signals);

    if (data.signals.length < limit) break;
    offset += limit;
  }

  signals = signals.filter(s => s.action === 'buy');

  console.log(`当前实验数据: ${tokens.length} 代币, ${signals.length} 买入信号\n`);

  // ========== 处理当前实验数据 ==========

  // 建立代币到类别的映射
  const tokenCategoryMap = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      tokenCategoryMap[t.token_address] = judges.category;
    }
  });

  // 按类别分组统计
  const categoryStats = {
    fake_pump: [],
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  signals.forEach(signal => {
    const category = tokenCategoryMap[signal.token_address];
    if (category && categoryStats[category]) {
      categoryStats[category].push({
        metadata: signal.metadata
      });
    }
  });

  // 计算各类别的平均值
  const currentData = {};

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const data = categoryStats[catKey];
    if (!data || data.length === 0) {
      console.log(`${catLabel.emoji} ${catLabel.label}: 当前实验无数据`);
      currentData[catKey] = null;
      continue;
    }

    // 计算每个类别的平均窗口时间
    const avgWindow = data.reduce((sum, d) => sum + (d.metadata.earlyTradesWindow || 0), 0) / data.length;

    // 提取指标
    const metrics = {
      volumePerMin: [],
      countPerMin: [],
      walletsPerMin: [],
      highValuePerMin: []
    };

    data.forEach(d => {
      const m = d.metadata;
      if (m.earlyTradesVolumePerMin > 0) metrics.volumePerMin.push(m.earlyTradesVolumePerMin);
      if (m.earlyTradesCountPerMin > 0) metrics.countPerMin.push(m.earlyTradesCountPerMin);
      if (m.earlyTradesWalletsPerMin > 0) metrics.walletsPerMin.push(m.earlyTradesWalletsPerMin);
      if (m.earlyTradesHighValuePerMin > 0) metrics.highValuePerMin.push(m.earlyTradesHighValuePerMin);
    });

    currentData[catKey] = {
      count: data.length,
      avgWindowMinutes: (avgWindow / 60).toFixed(2),
      avgVolumePerMin: metrics.volumePerMin.length > 0
        ? (metrics.volumePerMin.reduce((a, b) => a + b, 0) / metrics.volumePerMin.length).toFixed(0)
        : 'N/A',
      avgCountPerMin: metrics.countPerMin.length > 0
        ? (metrics.countPerMin.reduce((a, b) => a + b, 0) / metrics.countPerMin.length).toFixed(1)
        : 'N/A',
      avgWalletsPerMin: metrics.walletsPerMin.length > 0
        ? (metrics.walletsPerMin.reduce((a, b) => a + b, 0) / metrics.walletsPerMin.length).toFixed(1)
        : 'N/A',
      avgHighValuePerMin: metrics.highValuePerMin.length > 0
        ? (metrics.highValuePerMin.reduce((a, b) => a + b, 0) / metrics.highValuePerMin.length).toFixed(1)
        : 'N/A'
    };

    console.log(`${catLabel.emoji} ${catLabel.label} (${data.length}个代币, 平均${currentData[catKey].avgWindowMinutes}分钟):`);
    console.log(`  交易额/分钟: $${currentData[catKey].avgVolumePerMin}`);
    console.log(`  交易次数/分钟: ${currentData[catKey].avgCountPerMin} 次`);
    console.log(`  钱包数/分钟: ${currentData[catKey].avgWalletsPerMin} 个`);
    console.log(`  高价值交易/分钟: ${currentData[catKey].avgHighValuePerMin} 次\n`);
  }

  // ========== 对比分析 ==========
  console.log('========================================');
  console.log('数据对比分析');
  console.log('========================================\n');

  // 表格1: 历史数据 vs 当前实验
  console.log('【表1: 历史报告 vs 当前实验对比】');
  console.log('');
  console.log('类别 | 历史(541代币,3分钟) | 当前实验 | 差异');
  console.log('------|----------------------|----------|------');
  console.log('流水盘 |');
  printCategoryRow('fake_pump', HISTORICAL_RATES, currentData);
  console.log('低质量 |');
  printCategoryRow('low_quality', HISTORICAL_RATES, currentData);
  console.log('中质量 |');
  printCategoryRow('mid_quality', HISTORICAL_RATES, currentData);
  console.log('高质量 |');
  printCategoryRow('high_quality', HISTORICAL_RATES, currentData);

  // 表格2: 倍数关系对比
  console.log('\n【表2: 倍数关系对比（以流水盘为基准）】');
  console.log('');
  console.log('数据源 | 低质量 | 中质量 | 高质量');
  console.log('-------|--------|--------|--------');
  console.log(`历史报告 | 历史倍数 |`);
  printRatioRow(HISTORICAL_RATES, 'low_quality', 'mid_quality', 'high_quality');
  console.log(`当前实验 | 当前倍数 |`);
  printRatioRow(currentData, 'low_quality', 'mid_quality', 'high_quality');

  // 表3: 区分力对比（低质量 vs 中质量）
  console.log('\n【表3: 中/低质量区分力对比】');
  console.log('');
  console.log('指标 | 历史报告 | 当前实验 | 差异评价');
  console.log('-----|----------|----------|--------');

  const histMidLow = {
    volume: (HISTORICAL_RATES.mid_quality.volumePerMin / HISTORICAL_RATES.low_quality.volumePerMin).toFixed(2),
    count: (HISTORICAL_RATES.mid_quality.countPerMin / HISTORICAL_RATES.low_quality.countPerMin).toFixed(2),
    wallet: (HISTORICAL_RATES.mid_quality.walletsPerMin / HISTORICAL_RATES.low_quality.walletsPerMin).toFixed(2),
    highValue: (HISTORICAL_RATES.mid_quality.highValuePerMin / HISTORICAL_RATES.low_quality.highValuePerMin).toFixed(2)
  };

  const currMidLow = {
    volume: (parseFloat(currentData.mid_quality?.avgVolumePerMin || 0) / parseFloat(currentData.low_quality?.avgVolumePerMin || 1)).toFixed(2),
    count: (parseFloat(currentData.mid_quality?.avgCountPerMin || 0) / parseFloat(currentData.low_quality?.avgCountPerMin || 1)).toFixed(2),
    wallet: (parseFloat(currentData.mid_quality?.avgWalletsPerMin || 0) / parseFloat(currentData.low_quality?.avgWalletsPerMin || 1)).toFixed(2),
    highValue: (parseFloat(currentData.mid_quality?.avgHighValuePerMin || 0) / parseFloat(currentData.low_quality?.avgHighValuePerMin || 1)).toFixed(2)
  };

  console.log(`交易额/分钟 | ${histMidLow.volume}x | ${currMidLow.volume}x | ${compareRatio(histMidLow.volume, currMidLow.volume)}`);
  console.log(`交易次数/分钟 | ${histMidLow.count}x | ${currMidLow.count}x | ${compareRatio(histMidLow.count, currMidLow.count)}`);
  console.log(`钱包数/分钟 | ${histMidLow.wallet}x | ${currMidLow.wallet}x | ${compareRatio(histMidLow.wallet, currMidLow.wallet)}`);
  console.log(`高价值/分钟 | ${histMidLow.highValue}x | ${currMidLow.highValue}x | ${compareRatio(histMidLow.highValue, currMidLow.highValue)}`);

  // 表4: 绝对值对比
  console.log('\n【表4: 绝对值详细对比】');
  console.log('');
  console.log('类别 | 数据源 | 交易额/分 | 交易次/分 | 钱包/分 | 高价值/分');
  console.log('-----|--------|-----------|-----------|---------|----------');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    console.log(`${catLabel.label} |`);
    console.log(`  | 历史报告 | $${HISTORICAL_RATES[catKey].volumePerMin.toFixed(0)} | ${HISTORICAL_RATES[catKey].countPerMin.toFixed(1)} | ${HISTORICAL_RATES[catKey].walletsPerMin.toFixed(1)} | ${HISTORICAL_RATES[catKey].highValuePerMin.toFixed(1)}`);

    const curr = currentData[catKey];
    if (curr && curr.avgCountPerMin !== 'N/A') {
      console.log(`  | 当前实验 | $${curr.avgVolumePerMin} | ${curr.avgCountPerMin} | ${curr.avgWalletsPerMin} | ${curr.avgHighValuePerMin}`);
    } else {
      console.log(`  | 当前实验 | 无数据 | 无数据 | 无数据 | 无数据`);
    }
    console.log('');
  }

  // ========== 结论分析 ==========
  console.log('========================================');
  console.log('结论分析');
  console.log('========================================\n');

  analyzeConclusions(currentData, HISTORICAL_RATES);
}

function printCategoryRow(catKey, historicalData, currentData) {
  const hist = historicalData[catKey];
  const curr = currentData[catKey];

  const formatValue = (val) => val || 'N/A';

  console.log(`  交易额/分钟 | ${formatValue(hist?.volumePerMin.toFixed(0))} | ${formatValue(curr?.avgVolumePerMin)} | ${compareChange(hist?.volumePerMin, curr?.avgVolumePerMin)}`);
  console.log(`  交易次数/分钟 | ${formatValue(hist?.countPerMin.toFixed(1))} | ${formatValue(curr?.avgCountPerMin)} | ${compareChange(hist?.countPerMin, curr?.avgCountPerMin)}`);
  console.log(`  钱包数/分钟 | ${formatValue(hist?.walletsPerMin.toFixed(1))} | ${formatValue(curr?.avgWalletsPerMin)} | ${compareChange(hist?.walletsPerMin, curr?.avgWalletsPerMin)}`);
  console.log(`  高价值/分钟 | ${formatValue(hist?.highValuePerMin.toFixed(1))} | ${formatValue(curr?.avgHighValuePerMin)} | ${compareChange(hist?.highValuePerMin, curr?.avgHighValuePerMin)}`);
}

function printRatioRow(data, cat1, cat2, cat3) {
  const base = data[cat1];
  if (!base) return;

  const r1 = data[cat2] ? (data[cat2].volumePerMin / base.volumePerMin).toFixed(2) : '-';
  const r2 = data[cat3] ? (data[cat3].volumePerMin / base.volumePerMin).toFixed(2) : '-';
  const r3 = data[cat2] ? (data[cat2].countPerMin / base.countPerMin).toFixed(2) : '-';
  const r4 = data[cat3] ? (data[cat3].countPerMin / base.countPerMin).toFixed(2) : '-';

  console.log(`交易额/分 | ${r1}x | ${r2}x`);
  console.log(`交易次/分 | ${r3}x | ${r4}x`);
}

function compareRatio(hist, curr) {
  if (!hist || !curr) return '-';
  const h = parseFloat(hist);
  const c = parseFloat(curr);
  const diff = ((c - h) / h * 100).toFixed(1);
  const sign = c > h ? '+' : '';
  return `${sign}${diff}%`;
}

function compareChange(hist, curr) {
  if (!hist || !curr || curr === 'N/A') return '-';
  const h = parseFloat(hist);
  const c = parseFloat(curr);
  const diff = ((c - h) / h * 100).toFixed(1);
  const sign = c > h ? '+' : '';
  return `${sign}${diff}%`;
}

function analyzeConclusions(currentData, historicalData) {
  console.log('1. 数据一致性分析:');
  console.log('   - 如果当前实验与历史报告的倍数关系相似，说明早期参与者指标稳定可靠');
  console.log('   - 如果差异较大，需要分析原因（样本量、时间窗口、市场环境等）\n');

  console.log('2. 区分力稳定性:');
  console.log('   - 对比两份报告中 中/低质量 的区分倍数');
  console.log('   - 如果倍数相似，说明区分力在不同数据集上稳定\n');

  console.log('3. 样本量影响:');
  console.log('   - 历史报告: 541代币');
  console.log('   - 当前实验: 根据实际样本量');
  console.log('   - 样本量差异可能导致统计波动\n');

  console.log('4. 时间窗口影响:');
  console.log('   - 历史报告: 固定3分钟窗口');
  console.log('   - 当前实验: 实际购买时间窗口');
  console.log('   - 不同时间窗口可能影响指标值\n');

  console.log('5. 关键观察:');

  // 计算当前实验的中低倍数
  const currVolRatio = (parseFloat(currentData.mid_quality?.avgVolumePerMin || 0) / parseFloat(currentData.low_quality?.avgVolumePerMin || 1)).toFixed(2);
  const currCountRatio = (parseFloat(currentData.mid_quality?.avgCountPerMin || 0) / parseFloat(currentData.low_quality?.avgCountPerMin || 1)).toFixed(2);
  const currWalletRatio = (parseFloat(currentData.mid_quality?.avgWalletsPerMin || 0) / parseFloat(currentData.low_quality?.avgWalletsPerMin || 1)).toFixed(2);
  const currHighValueRatio = (parseFloat(currentData.mid_quality?.avgHighValuePerMin || 0) / parseFloat(currentData.low_quality?.avgHighValuePerMin || 1)).toFixed(2);

  console.log(`   当前实验中/低倍数:`);
  console.log(`   - 交易额/分钟: ${currVolRatio}x`);
  console.log(`   - 交易次数/分钟: ${currCountRatio}x`);
  console.log(`   - 钱包数/分钟: ${currWalletRatio}x`);
  console.log(`   - 高价值/分钟: ${currHighValueRatio}x\n`);

  console.log(`   历史报告中/低倍数:`);
  console.log(`   - 交易额/分钟: ${(HISTORICAL_RATES.mid_quality.volumePerMin / HISTORICAL_RATES.low_quality.volumePerMin).toFixed(2)}x`);
  console.log(`   - 交易次数/分钟: ${(HISTORICAL_RATES.mid_quality.countPerMin / HISTORICAL_RATES.low_quality.countPerMin).toFixed(2)}x`);
  console.log(`   - 钱包数/分钟: ${(HISTORICAL_RATES.mid_quality.walletsPerMin / HISTORICAL_RATES.low_quality.walletsPerMin).toFixed(2)}x`);
  console.log(`   - 高价值/分钟: ${(HISTORICAL_RATES.mid_quality.highValuePerMin / HISTORICAL_RATES.low_quality.highValuePerMin).toFixed(2)}x\n`);
}

main().catch(console.error);
