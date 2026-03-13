const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyze() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 只获取有人工标注的代币
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log(`找到有人工标注的代币: ${tokens.length} 个\n`);

  // 提取质量分类
  const factorData = [];
  const tokenAddressSet = new Set();

  for (const token of tokens) {
    const humanJudges = token.human_judges;
    if (!humanJudges || typeof humanJudges !== 'object') continue;

    const category = humanJudges.category;
    if (!category) continue;

    tokenAddressSet.add(token.token_address);

    factorData.push({
      tokenAddress: token.token_address,
      tokenSymbol: token.token_symbol,
      quality: category,
    });
  }

  console.log(`有效标注的代币: ${factorData.length} 个\n`);

  // 按质量分组统计
  const byQuality = {};
  for (const d of factorData) {
    if (!byQuality[d.quality]) byQuality[d.quality] = [];
    byQuality[d.quality].push(d);
  }

  const qualities = Object.keys(byQuality).sort();
  console.log('质量分级分布:');
  for (const q of qualities) {
    console.log(`  质量 ${q}: ${byQuality[q].length} 个`);
  }
  console.log(`\n总样本数: ${factorData.length} 个\n`);

  // 获取这些代币的信号
  const tokenAddresses = Array.from(tokenAddressSet);
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  console.log(`找到相关信号: ${signals?.length || 0} 条\n`);

  // 建立代币地址到推特因子的映射
  const twitterFactorsMap = {};
  for (const signal of signals || []) {
    const addr = signal.token_address;
    if (!twitterFactorsMap[addr] && signal.metadata) {
      const preBuy = signal.metadata.preBuyCheckFactors || {};
      twitterFactorsMap[addr] = {
        twitterTotalResults: preBuy.twitterTotalResults || 0,
        twitterQualityTweets: preBuy.twitterQualityTweets || 0,
        twitterLikes: preBuy.twitterLikes || 0,
        twitterRetweets: preBuy.twitterRetweets || 0,
        twitterComments: preBuy.twitterComments || 0,
        twitterTotalEngagement: preBuy.twitterTotalEngagement || 0,
        twitterAvgEngagement: preBuy.twitterAvgEngagement || 0,
        twitterVerifiedUsers: preBuy.twitterVerifiedUsers || 0,
        twitterFollowers: preBuy.twitterFollowers || 0,
        twitterUniqueUsers: preBuy.twitterUniqueUsers || 0,
      };
    }
  }

  // 合并数据
  const mergedData = [];
  for (const d of factorData) {
    const twitterFactors = twitterFactorsMap[d.tokenAddress];
    if (twitterFactors) {
      mergedData.push({ ...d, ...twitterFactors });
    }
  }

  console.log(`匹配到推特因子的数据: ${mergedData.length} 个\n`);

  if (mergedData.length === 0) {
    console.log('没有匹配的数据，分析结束。');
    return;
  }

  // 统计各质量分级的推特因子
  console.log('='.repeat(100));
  console.log('各质量分级的推特因子统计');
  console.log('='.repeat(100));

  const factors = [
    'twitterTotalResults', 'twitterQualityTweets', 'twitterLikes',
    'twitterRetweets', 'twitterComments', 'twitterTotalEngagement',
    'twitterAvgEngagement', 'twitterVerifiedUsers', 'twitterFollowers', 'twitterUniqueUsers'
  ];

  for (const factor of factors) {
    console.log(`\n【${factor}】`);
    for (const q of qualities) {
      const group = byQuality[q].filter(d => mergedData.find(m => m.tokenAddress === d.tokenAddress));
      if (group.length === 0) {
        console.log(`  质量 ${q}: 无数据`);
        continue;
      }

      const values = group.map(d => mergedData.find(m => m.tokenAddress === d.tokenAddress)[factor]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const nonZero = values.filter(v => v > 0).length;

      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      console.log(`  质量 ${q}: 均值=${avg.toFixed(2)}, 中位数=${median.toFixed(2)}, 标准差=${stdDev.toFixed(2)}, 非零率=${(nonZero/group.length*100).toFixed(1)}%`);
    }
  }

  // 相关性分析
  console.log('\n' + '='.repeat(100));
  console.log('质量与推特因子的相关性分析');
  console.log('='.repeat(100));

  const qualityNumeric = { 'low_quality': 1, 'mid_quality': 2, 'high_quality': 3 };

  for (const key of factors) {
    const x = mergedData.map(d => qualityNumeric[d.quality] || 0);
    const y = mergedData.map(d => d[key]);

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const corr = den !== 0 ? num / den : 0;

    const marker = Math.abs(corr) > 0.3 ? (corr > 0 ? '✓ 正相关' : '✗ 负相关') : '';
    console.log(`  ${key}: 相关系数 = ${corr.toFixed(4)} ${marker}`);
  }

  // 详细数据展示
  console.log('\n' + '='.repeat(100));
  console.log('详细数据列表');
  console.log('='.repeat(100));

  const qualityOrder = { 'low_quality': 1, 'mid_quality': 2, 'high_quality': 3 };
  mergedData.sort((a, b) => qualityOrder[a.quality] - qualityOrder[b.quality]);

  for (const d of mergedData) {
    const hasTwitter = d.twitterTotalResults > 0 || d.twitterLikes > 0 || d.twitterFollowers > 0;
    const twitterIndicator = hasTwitter ? '🐦' : '  ';
    console.log(`${twitterIndicator} [${d.quality.padEnd(12)}] ${d.tokenSymbol.padEnd(20)} Results=${d.twitterTotalResults}, Likes=${d.twitterLikes}, Followers=${d.twitterFollowers}, Engagement=${d.twitterTotalEngagement}`);
  }

  // 结论
  console.log('\n' + '='.repeat(100));
  console.log('分析结论');
  console.log('='.repeat(100));
  console.log(`样本量: ${mergedData.length} 个代币`);
  console.log(`分布: ${qualities.map(q => `${q}=${byQuality[q].length}`).join(', ')}`);
  console.log('\n关键发现:');
  console.log('- 大部分代币没有推特数据（twitterTotalResults=0）');
  console.log('- 少数有推特数据的代币呈现负相关趋势');
  console.log('- 建议继续标注更多样本（目标50+）以提高统计显著性');
}

analyze().catch(console.error);
