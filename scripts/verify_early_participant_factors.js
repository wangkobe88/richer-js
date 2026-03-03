/**
 * 验证早期参与者特征有效性
 * 分析实验 e3adb56a-2d36-46b2-9d54-d6a6639e51a5 的人工标注数据
 */

const EXPERIMENT_ID = 'e3adb56a-2d36-46b2-9d54-d6a6639e51a5';
const BASE_URL = 'http://localhost:3010';

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

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
  console.log('=== 早期参与者特征验证分析 ===\n');
  console.log(`实验ID: ${EXPERIMENT_ID}\n`);

  // 1. 获取所有有人工标注的代币（分页获取）
  console.log('1. 获取人工标注代币...');
  let tokens = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchWithRetry(
      `${BASE_URL}/api/experiment/${EXPERIMENT_ID}/tokens?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    );

    if (!data.success || !data.tokens) {
      break;
    }

    tokens.push(...data.tokens);
    console.log(`  获取了 ${tokens.length} 个代币...`);

    if (data.tokens.length < limit) {
      break;
    }
    offset += limit;
  }

  // 筛选有人工标注的代币
  const judgedTokens = tokens.filter(t => t.human_judges);
  console.log(`找到 ${judgedTokens.length} 个有人工标注的代币\n`);

  // 2. 获取所有信号（包含早期参与者因子）
  console.log('2. 获取交易信号...');
  let signals = [];
  offset = 0;

  while (true) {
    const data = await fetchWithRetry(
      `${BASE_URL}/api/experiment/${EXPERIMENT_ID}/signals?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    );

    if (!data.success || !data.signals) {
      break;
    }

    signals.push(...data.signals);
    console.log(`  获取了 ${signals.length} 个信号...`);

    if (data.signals.length < limit) {
      break;
    }
    offset += limit;
  }

  // 只取买入信号
  signals = signals.filter(s => s.action === 'buy');
  console.log(`找到 ${signals.length} 个买入信号\n`);

  // 3. 统计有早期参与者数据的信号数量
  const signalsWithEarlyData = signals.filter(s =>
    s.metadata && s.metadata.earlyTradesChecked === 1
  );
  console.log(`有早期参与者数据的信号: ${signalsWithEarlyData.length} 个`);
  console.log(`无早期参与者数据的信号: ${signals.length - signalsWithEarlyData.length} 个\n`);

  if (signalsWithEarlyData.length === 0) {
    console.log('❌ 没有早期参与者数据，无法验证');
    return;
  }

  // 4. 按类别分组统计
  console.log('3. 按类别统计早期参与者指标...\n');

  const categoryStats = {
    fake_pump: [],
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  // 建立代币到类别的映射
  const tokenCategoryMap = {};
  judgedTokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      tokenCategoryMap[t.token_address] = judges.category;
    }
  });

  // 将信号按类别分组
  signalsWithEarlyData.forEach(signal => {
    const category = tokenCategoryMap[signal.token_address];
    if (category && categoryStats[category]) {
      categoryStats[category].push({
        tokenAddress: signal.token_address,
        tokenSymbol: signal.token_symbol,
        metadata: signal.metadata
      });
    }
  });

  // 5. 计算各类别的统计指标
  const summaryData = {};

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const data = categoryStats[catKey];
    if (!data || data.length === 0) {
      console.log(`${catLabel.emoji} ${catLabel.label}: 无数据\n`);
      continue;
    }

    // 提取指标
    const metrics = {
      earlyTradesCheckTime: [],
      earlyTradesWindow: [],
      earlyTradesDataCoverage: [],
      earlyTradesVolumePerMin: [],
      earlyTradesCountPerMin: [],
      earlyTradesWalletsPerMin: [],
      earlyTradesHighValuePerMin: [],
      earlyTradesTotalCount: [],
      earlyTradesVolume: [],
      earlyTradesUniqueWallets: [],
      earlyTradesHighValueCount: [],
      earlyTradesAcceleration: [],
      earlyTradesGrowthTrend: []
    };

    data.forEach(d => {
      const m = d.metadata;
      if (m.earlyTradesCheckTime !== null) metrics.earlyTradesCheckTime.push(m.earlyTradesCheckTime);
      if (m.earlyTradesWindow !== null) metrics.earlyTradesWindow.push(m.earlyTradesWindow);
      if (m.earlyTradesDataCoverage !== null) metrics.earlyTradesDataCoverage.push(m.earlyTradesDataCoverage);
      if (m.earlyTradesVolumePerMin !== null) metrics.earlyTradesVolumePerMin.push(m.earlyTradesVolumePerMin);
      if (m.earlyTradesCountPerMin !== null) metrics.earlyTradesCountPerMin.push(m.earlyTradesCountPerMin);
      if (m.earlyTradesWalletsPerMin !== null) metrics.earlyTradesWalletsPerMin.push(m.earlyTradesWalletsPerMin);
      if (m.earlyTradesHighValuePerMin !== null) metrics.earlyTradesHighValuePerMin.push(m.earlyTradesHighValuePerMin);
      if (m.earlyTradesTotalCount !== null) metrics.earlyTradesTotalCount.push(m.earlyTradesTotalCount);
      if (m.earlyTradesVolume !== null) metrics.earlyTradesVolume.push(m.earlyTradesVolume);
      if (m.earlyTradesUniqueWallets !== null) metrics.earlyTradesUniqueWallets.push(m.earlyTradesUniqueWallets);
      if (m.earlyTradesHighValueCount !== null) metrics.earlyTradesHighValueCount.push(m.earlyTradesHighValueCount);
      if (m.earlyTradesAcceleration !== null) metrics.earlyTradesAcceleration.push(m.earlyTradesAcceleration);
      if (m.earlyTradesGrowthTrend) metrics.earlyTradesGrowthTrend.push(m.earlyTradesGrowthTrend);
    });

    // 计算平均值
    const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const count = (arr, value) => arr.filter(v => v === value).length;

    summaryData[catKey] = {
      count: data.length,
      avgCheckTime: avg(metrics.earlyTradesCheckTime).toFixed(1),
      avgCoverage: avg(metrics.earlyTradesDataCoverage).toFixed(3),
      avgVolumePerMin: avg(metrics.earlyTradesVolumePerMin).toFixed(0),
      avgCountPerMin: avg(metrics.earlyTradesCountPerMin).toFixed(1),
      avgWalletsPerMin: avg(metrics.earlyTradesWalletsPerMin).toFixed(1),
      avgHighValuePerMin: avg(metrics.earlyTradesHighValuePerMin).toFixed(1),
      avgTotalCount: avg(metrics.earlyTradesTotalCount).toFixed(0),
      avgVolume: avg(metrics.earlyTradesVolume).toFixed(0),
      avgUniqueWallets: avg(metrics.earlyTradesUniqueWallets).toFixed(0),
      avgHighValueCount: avg(metrics.earlyTradesHighValueCount).toFixed(1),
      avgAcceleration: avg(metrics.earlyTradesAcceleration).toFixed(1),
      acceleratingCount: count(metrics.earlyTradesGrowthTrend, 'accelerating'),
      stableCount: count(metrics.earlyTradesGrowthTrend, 'stable'),
      deceleratingCount: count(metrics.earlyTradesGrowthTrend, 'decelerating')
    };
  }

  // 6. 输出统计结果
  console.log('========================================');
  console.log('早期参与者指标统计（按类别）');
  console.log('========================================\n');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const stats = summaryData[catKey];
    if (!stats) continue;

    console.log(`${catLabel.emoji} ${catLabel.label} (${stats.count}个代币):`);
    console.log(`  检查时间点: 平均 ${stats.avgCheckTime} 秒`);
    console.log(`  数据覆盖度: 平均 ${stats.avgCoverage}`);
    console.log(`  交易额/分钟: 平均 $${stats.avgVolumePerMin}`);
    console.log(`  交易次数/分钟: 平均 ${stats.avgCountPerMin} 次`);
    console.log(`  钱包数/分钟: 平均 ${stats.avgWalletsPerMin} 个`);
    console.log(`  高价值交易/分钟: 平均 ${stats.avgHighValuePerMin} 次`);
    console.log(`  增长趋势: 加速${stats.acceleratingCount} | 稳定${stats.stableCount} | 减速${stats.deceleratingCount}`);
    console.log('');
  }

  // 7. 生成对比表格（速率指标）
  console.log('========================================');
  console.log('速率指标对比表（时间标准化）');
  console.log('========================================\n');

  console.log('类别 | 样本数 | 交易额/分 | 交易次/分 | 钱包数/分 | 高价值/分');
  console.log('------|--------|-----------|-----------|-----------|----------');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const stats = summaryData[catKey];
    if (!stats) continue;
    console.log(`${catLabel.label.padEnd(6)} | ${String(stats.count).padStart(6)} | $${String(stats.avgVolumePerMin).padStart(8)} | ${String(stats.avgCountPerMin).padStart(8)} | ${String(stats.avgWalletsPerMin).padStart(8)} | ${String(stats.avgHighValuePerMin).padStart(8)}`);
  }

  // 8. 计算倍数关系（以流水盘为基准）
  console.log('\n倍数关系（以流水盘为基准）:');
  console.log('---------------------------');

  const fakeStats = summaryData.fake_pump;
  if (fakeStats && parseFloat(fakeStats.avgVolumePerMin) > 0) {
    console.log('类别 | 交易额/分 | 交易次/分 | 钱包数/分 | 高价值/分');
    console.log('------|-----------|-----------|-----------|----------');

    for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
      if (catKey === 'fake_pump') continue;
      const stats = summaryData[catKey];
      if (!stats) continue;

      const volRatio = (parseFloat(stats.avgVolumePerMin) / parseFloat(fakeStats.avgVolumePerMin) || 0).toFixed(2);
      const countRatio = (parseFloat(stats.avgCountPerMin) / parseFloat(fakeStats.avgCountPerMin) || 0).toFixed(2);
      const walletRatio = (parseFloat(stats.avgWalletsPerMin) / parseFloat(fakeStats.avgWalletsPerMin) || 0).toFixed(2);
      const highValueRatio = (parseFloat(stats.avgHighValuePerMin) / parseFloat(fakeStats.avgHighValuePerMin) || 0).toFixed(2);

      console.log(`${catLabel.label.padEnd(6)} | ${volRatio}x | ${countRatio}x | ${walletRatio}x | ${highValueRatio}x`);
    }
  } else {
    console.log('⚠️  流水盘数据不可用，无法计算倍数关系');
  }

  // 9. 增长趋势分布
  console.log('\n========================================');
  console.log('增长趋势分布');
  console.log('========================================\n');

  console.log('类别 | 加速增长 | 稳定增长 | 减速增长');
  console.log('------|----------|----------|----------');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const stats = summaryData[catKey];
    if (!stats) continue;

    const total = stats.acceleratingCount + stats.stableCount + stats.deceleratingCount;
    const accPct = total > 0 ? ((stats.acceleratingCount / total) * 100).toFixed(1) : '0';
    const stabPct = total > 0 ? ((stats.stableCount / total) * 100).toFixed(1) : '0';
    const decPct = total > 0 ? ((stats.deceleratingCount / total) * 100).toFixed(1) : '0';

    console.log(`${catLabel.label.padEnd(6)} | ${stats.acceleratingCount} (${accPct}%) | ${stats.stableCount} (${stabPct}%) | ${stats.deceleratingCount} (${decPct}%)`);
  }
}

main().catch(console.error);
