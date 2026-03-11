/**
 * 资金集中度分析（基尼系数）
 * 分析早期参与者资金分布与代币质量的关系
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

// 加载早期投资数据
const tokenEarlyInvestments = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'),
  'utf8'
));

console.log('='.repeat(80));
console.log('资金集中度分析（基尼系数）');
console.log('='.repeat(80));

// HTTP请求工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

// 计算基尼系数
function calculateGini(values) {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  const n = values.length;
  const sortedValues = [...values].sort((a, b) => a - b);

  // 基尼系数公式: G = (2 * Σ(i * x_i)) / (n * Σ(x_i)) - (n + 1) / n
  // 其中 x_i 是排序后的值，i 从 1 开始
  const sum = sortedValues.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  let weightedSum = 0;
  sortedValues.forEach((v, i) => {
    weightedSum += (i + 1) * v;
  });

  const gini = (2 * weightedSum) / (n * sum) - (n + 1) / n;
  return Math.max(0, Math.min(1, gini)); // 限制在 [0, 1]
}

// 计算HHI指数（赫芬达尔-赫希曼指数）
function calculateHHI(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  // HHI = Σ(份额²)，份额 = 该值 / 总值
  let hhi = 0;
  values.forEach(v => {
    const share = v / total;
    hhi += share * share;
  });

  return hhi;
}

// 计算Top N钱包的集中度指标
function calculateTopConcentration(values, topN) {
  const sortedValues = [...values].sort((a, b) => b - a); // 降序
  const total = values.reduce((a, b) => a + b, 0);

  if (total === 0) return 0;

  const topSum = sortedValues.slice(0, topN).reduce((a, b) => a + b, 0);
  return topSum / total;
}

// 分析单个代币的资金集中度
function analyzeTokenConcentration(tokenData) {
  const walletInvestments = tokenData.wallet_investments || {};
  const investmentValues = Object.values(walletInvestments).filter(v => v > 0);

  if (investmentValues.length === 0) {
    return null;
  }

  const gini = calculateGini(investmentValues);
  const hhi = calculateHHI(investmentValues);
  const top1Ratio = calculateTopConcentration(investmentValues, 1);
  const top3Ratio = calculateTopConcentration(investmentValues, 3);
  const top5Ratio = calculateTopConcentration(investmentValues, 5);
  const top10Ratio = calculateTopConcentration(investmentValues, 10);

  // 计算中位数
  const sortedValues = [...investmentValues].sort((a, b) => a - b);
  const median = sortedValues.length % 2 === 0
    ? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
    : sortedValues[Math.floor(sortedValues.length / 2)];

  // 计算均值
  const mean = investmentValues.reduce((a, b) => a + b, 0) / investmentValues.length;

  return {
    gini: gini,
    hhi: hhi,
    top1_ratio: top1Ratio,
    top3_ratio: top3Ratio,
    top5_ratio: top5Ratio,
    top10_ratio: top10Ratio,
    median_investment: median,
    mean_investment: mean,
    wallet_count: investmentValues.length,
    total_investment: investmentValues.reduce((a, b) => a + b, 0)
  };
}

// 点二列相关系数
function pointBiserialCorrelation(binaryValues, continuousValues) {
  const n = binaryValues.length;
  if (n < 3) return null;

  const group1 = [], group0 = [];
  binaryValues.forEach((b, i) => {
    if (b === 1) group1.push(continuousValues[i]);
    else group0.push(continuousValues[i]);
  });

  if (group1.length === 0 || group0.length === 0) return null;

  const n1 = group1.length, n0 = group0.length;
  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean0 = group0.reduce((a, b) => a + b, 0) / n0;

  const allValues = continuousValues;
  const mean = allValues.reduce((a, b) => a + b, 0) / n;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  return ((mean1 - mean0) / stdDev) * Math.sqrt((n1 * n0) / (n * n));
}

// 主分析
async function main() {
  // 获取标注数据
  console.log('[获取标注数据...]');
  const tokensRes = await get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`);

  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.data) {
    tokensRes.data.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }
  console.log(`  ✓ ${labelsMap.size} 条标注数据`);

  // 分析每个代币的资金集中度
  const analysisResults = [];

  tokenEarlyInvestments.forEach(tokenData => {
    const tokenAddr = tokenData.token_address.toLowerCase();
    const label = labelsMap.get(tokenAddr);

    if (!label || tokenData.wallet_count === 0) {
      return;
    }

    const concentration = analyzeTokenConcentration(tokenData);

    if (concentration) {
      analysisResults.push({
        token_symbol: tokenData.token_symbol,
        token_address: tokenAddr,
        quality: label.category,
        ...concentration
      });
    }
  });

  console.log(`  ✓ ${analysisResults.length} 个代币有资金集中度数据`);

  // 按质量分组
  const qualityGroups = {
    high_quality: analysisResults.filter(r => r.quality === 'high_quality'),
    mid_quality: analysisResults.filter(r => r.quality === 'mid_quality'),
    low_quality: analysisResults.filter(r => r.quality === 'low_quality')
  };

  console.log('\n质量分布:');
  console.log(`  高质量: ${qualityGroups.high_quality.length} 个`);
  console.log(`  中质量: ${qualityGroups.mid_quality.length} 个`);
  console.log(`  低质量: ${qualityGroups.low_quality.length} 个`);

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('资金集中度指标与质量的相关性');
  console.log('='.repeat(80));

  const metrics = [
    { name: '基尼系数', key: 'gini', desc: '0=完全平均, 1=完全集中', format: 'fixed' },
    { name: 'HHI指数', key: 'hhi', desc: '赫芬达尔指数，越大越集中', format: 'fixed' },
    { name: 'Top1钱包占比', key: 'top1_ratio', desc: '最大钱包的投入金额占比', format: 'percent' },
    { name: 'Top3钱包占比', key: 'top3_ratio', desc: '前3大钱包的投入金额占比', format: 'percent' },
    { name: 'Top5钱包占比', key: 'top5_ratio', desc: '前5大钱包的投入金额占比', format: 'percent' },
    { name: 'Top10钱包占比', key: 'top10_ratio', desc: '前10大钱包的投入金额占比', format: 'percent' },
    { name: '中位数投入', key: 'median_investment', desc: '投入金额中位数(USD)', format: 'usd' },
    { name: '平均投入', key: 'mean_investment', desc: '投入金额平均值(USD)', format: 'usd' },
    { name: '钱包总数', key: 'wallet_count', desc: '参与钱包总数', format: 'count' },
    { name: '总投入金额', key: 'total_investment', desc: '总投入金额(USD)', format: 'usd' }
  ];

  const binaryQuality = analysisResults.map(r =>
    (r.quality === 'high_quality' || r.quality === 'mid_quality') ? 1 : 0
  );

  const correlations = {};

  metrics.forEach(metric => {
    const values = analysisResults.map(r => r[metric.key]);
    const pb = pointBiserialCorrelation(binaryQuality, values);

    if (pb !== null) {
      correlations[metric.key] = pb;

      const direction = pb > 0 ? '正相关' : '负相关';
      const strength = Math.abs(pb) > 0.3 ? '强' : Math.abs(pb) > 0.15 ? '中' : '弱';
      const indicator = pb > 0.3 ? '✅ 正向指标' : pb < -0.3 ? '🚩 反向指标' : '⚠️ 弱相关';

      console.log(`\n${metric.name} (${metric.key})`);
      console.log(`  定义: ${metric.desc}`);
      console.log(`  相关性: r=${pb.toFixed(3)} (${strength}${direction}) ${indicator}`);
    }
  });

  // 各质量组的平均值
  console.log('\n' + '='.repeat(80));
  console.log('各质量组的资金集中度特征');
  console.log('='.repeat(80));

  const keyMetrics = ['gini', 'top1_ratio', 'top3_ratio', 'top5_ratio', 'wallet_count', 'mean_investment'];

  ['high_quality', 'mid_quality', 'low_quality'].forEach(quality => {
    const tokens = qualityGroups[quality];
    if (tokens.length === 0) return;

    const label = { high_quality: '高', mid_quality: '中', low_quality: '低' }[quality];
    console.log(`\n${label}质量 (${tokens.length}个代币):`);

    keyMetrics.forEach(metricKey => {
      const metric = metrics.find(m => m.key === metricKey);
      const avg = tokens.reduce((sum, t) => sum + t[metricKey], 0) / tokens.length;

      if (metricKey.includes('ratio') || metricKey === 'gini' || metricKey === 'hhi') {
        console.log(`  ${metric.name}: ${(avg * 100).toFixed(1)}%`);
      } else if (metricKey.includes('investment')) {
        console.log(`  ${metric.name}: $${avg.toFixed(2)}`);
      } else {
        console.log(`  ${metric.name}: ${avg.toFixed(1)}`);
      }
    });
  });

  // 显示典型例子
  console.log('\n' + '='.repeat(80));
  console.log('典型代币示例');
  console.log('='.repeat(80));

  // 找出基尼系数最高和最低的代币
  const sortedByGini = [...analysisResults].sort((a, b) => b.gini - a.gini);
  const mostConcentrated = sortedByGini.slice(0, 3);
  const leastConcentrated = sortedByGini.slice(-3).reverse();

  console.log('\n资金最集中（基尼系数最高）:');
  mostConcentrated.forEach(t => {
    const q = { high_quality: '高', mid_quality: '中', low_quality: '低' }[t.quality];
    console.log(`  ${t.token_symbol} [${q}质量]: 基尼=${(t.gini * 100).toFixed(1)}%, Top1=${(t.top1_ratio * 100).toFixed(1)}%, 钱包数=${t.wallet_count}`);
  });

  console.log('\n资金最分散（基尼系数最低）:');
  leastConcentrated.forEach(t => {
    const q = { high_quality: '高', mid_quality: '中', low_quality: '低' }[t.quality];
    console.log(`  ${t.token_symbol} [${q}质量]: 基尼=${(t.gini * 100).toFixed(1)}%, Top1=${(t.top1_ratio * 100).toFixed(1)}%, 钱包数=${t.wallet_count}`);
  });

  // 保存结果
  const result = {
    metrics: metrics,
    correlations: correlations,
    quality_groups: {
      high_quality: qualityGroups.high_quality.map(r => ({
        symbol: r.token_symbol,
        gini: r.gini,
        top1_ratio: r.top1_ratio,
        wallet_count: r.wallet_count
      })),
      mid_quality: qualityGroups.mid_quality.map(r => ({
        symbol: r.token_symbol,
        gini: r.gini,
        top1_ratio: r.top1_ratio,
        wallet_count: r.wallet_count
      })),
      low_quality: qualityGroups.low_quality.map(r => ({
        symbol: r.token_symbol,
        gini: r.gini,
        top1_ratio: r.top1_ratio,
        wallet_count: r.wallet_count
      }))
    },
    all_results: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/gini_concentration_analysis.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成! 结果已保存到 data/gini_concentration_analysis.json');
}

main().catch(console.error);
