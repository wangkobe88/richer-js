#!/usr/bin/env node

/**
 * 同名代币分析
 *
 * 分析目标：
 * 1. 统计每个代币的同名代币数量
 * 2. 分析同名代币的最大市值
 * 3. 按质量分组分析同名代币情况
 * 4. 评估同名代币是否可以作为风险指标
 */

// 加载环境变量（AVE_API_KEY）
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const { AveTokenAPI } = require('../../src/core/ave-api/token-api.js');

// API配置
const API_BASE = 'http://localhost:3010';
const EXPERIMENT_ID = process.argv[2] || '25493408-98b3-4342-a1ac-036ba49f97ee';

// AVE API配置
const AVE_API_KEY = process.env.AVE_API_KEY || null;

// 分析配置
const HIGH_FDV_THRESHOLD = 1000000;      // 100万美元
const VERY_HIGH_FDV_THRESHOLD = 10000000; // 1000万美元

/**
 * HTTP请求辅助函数
 */
async function fetchAPI(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 延时函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取有交易的代币列表
 */
async function getTradedTokens(experimentId) {
  console.log(`\n📊 正在获取实验 ${experimentId} 中有交易的代币...`);

  // 获取所有代币
  let allTokens = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const result = await fetchAPI(`/api/experiment/${experimentId}/tokens?offset=${offset}&limit=${limit}`);

    if (!result.success || !result.data || result.data.length === 0) {
      break;
    }

    allTokens = allTokens.concat(result.data);

    if (result.data.length < limit) {
      break;
    }

    offset += limit;
    await sleep(100);
  }

  // 筛选已标注的代币（与token-returns页面一致）
  const judgedTokens = allTokens.filter(t => t.human_judges != null);

  console.log(`   总代币数: ${allTokens.length}`);
  console.log(`   已标注数: ${judgedTokens.length}`);

  // 按质量分组统计
  const byQuality = {};
  judgedTokens.forEach(t => {
    const category = t.human_judges.category;
    byQuality[category] = (byQuality[category] || 0) + 1;
  });

  console.log(`   质量分布:`, byQuality);

  return judgedTokens;
}

/**
 * 分析代币的同名代币
 */
async function analyzeSameNameTokens(token, aveAPI) {
  const symbol = token.token_symbol;
  const tokenAddress = token.token_address;

  console.log(`\n   🔍 分析 ${symbol} (${tokenAddress.substring(0, 10)}...)`);

  try {
    // 搜索同名代币
    const results = await aveAPI.searchTokens(symbol, null, 300, 'fdv');

    if (!results || results.length === 0) {
      return {
        token_address: tokenAddress,
        token_symbol: symbol,
        quality_category: token.human_judges.category,
        total_count: 0,
        exclude_self_count: 0,
        max_fdv: 0,
        max_market_cap: 0,
        has_high_fdv_same_name: false,
        has_very_high_fdv_same_name: false,
        chains: [],
        same_name_tokens: []
      };
    }

    // 解析FDV和市值
    const fdvList = results.map(t => parseFDV(t.fdv)).filter(v => v > 0);
    const marketCapList = results.map(t => parseFDV(t.market_cap)).filter(v => v > 0);

    // 排除自己
    const excludeSelf = results.filter(t => t.token !== tokenAddress);

    // 统计链
    const chains = [...new Set(results.map(t => t.chain))];

    // 找到最大FDV
    const maxFDV = fdvList.length > 0 ? Math.max(...fdvList) : 0;
    const maxMarketCap = marketCapList.length > 0 ? Math.max(...marketCapList) : 0;

    const result = {
      token_address: tokenAddress,
      token_symbol: symbol,
      quality_category: token.human_judges.category,
      total_count: results.length,
      exclude_self_count: excludeSelf.length,
      max_fdv: maxFDV,
      max_market_cap: maxMarketCap,
      has_high_fdv_same_name: maxFDV >= HIGH_FDV_THRESHOLD,
      has_very_high_fdv_same_name: maxFDV >= VERY_HIGH_FDV_THRESHOLD,
      chains: chains,
      same_name_tokens: results.map(t => ({
        token: t.token,
        symbol: t.symbol,
        chain: t.chain,
        fdv: parseFDV(t.fdv),
        market_cap: parseFDV(t.market_cap),
        is_self: t.token === tokenAddress
      }))
    };

    console.log(`      ✅ 找到 ${results.length} 个同名代币 (排除自己: ${excludeSelf.length})`);
    console.log(`      📊 最大FDV: $${formatNumber(maxFDV)}, 最大市值: $${formatNumber(maxMarketCap)}`);

    return result;

  } catch (error) {
    console.error(`   ❌ 搜索失败 ${symbol}:`, error.message);
    return {
      token_address: tokenAddress,
      token_symbol: symbol,
      quality_category: token.human_judges.category,
      total_count: 0,
      exclude_self_count: 0,
      max_fdv: 0,
      max_market_cap: 0,
      has_high_fdv_same_name: false,
      has_very_high_fdv_same_name: false,
      chains: [],
      same_name_tokens: [],
      error: error.message
    };
  }
}

/**
 * 解析FDV字符串
 */
function parseFDV(fdvStr) {
  if (!fdvStr || fdvStr === '' || fdvStr === '0') {
    return 0;
  }

  // 移除逗号和空格
  const cleaned = fdvStr.replace(/,/g, '').trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * 按质量分组统计
 */
function summarizeByQuality(analyzedTokens) {
  const byQuality = {
    fake_pump: [],
    no_user: [],
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  // 分组
  analyzedTokens.forEach(token => {
    byQuality[token.quality_category].push(token);
  });

  // 计算统计
  const summary = {};

  for (const [quality, tokens] of Object.entries(byQuality)) {
    if (tokens.length === 0) {
      summary[quality] = {
        count: 0,
        avg_count: 0,
        median_count: 0,
        avg_max_fdv: 0,
        median_max_fdv: 0,
        has_high_fdv_count: 0,
        has_very_high_fdv_count: 0
      };
      continue;
    }

    const counts = tokens.map(t => t.total_count);
    const maxFDVs = tokens.map(t => t.max_fdv);
    const hasHighFDV = tokens.filter(t => t.has_high_fdv_same_name).length;
    const hasVeryHighFDV = tokens.filter(t => t.has_very_high_fdv_same_name).length;

    counts.sort((a, b) => a - b);
    maxFDVs.sort((a, b) => a - b);

    const sumCount = counts.reduce((a, b) => a + b, 0);
    const sumFDV = maxFDVs.reduce((a, b) => a + b, 0);

    summary[quality] = {
      count: tokens.length,
      avg_count: sumCount / tokens.length,
      median_count: counts[Math.floor(counts.length / 2)],
      avg_max_fdv: sumFDV / tokens.length,
      median_max_fdv: maxFDVs[Math.floor(maxFDVs.length / 2)],
      has_high_fdv_count: hasHighFDV,
      has_very_high_fdv_count: hasVeryHighFDV,
      high_fdv_ratio: (hasHighFDV / tokens.length * 100).toFixed(1),
      very_high_fdv_ratio: (hasVeryHighFDV / tokens.length * 100).toFixed(1)
    };
  }

  return summary;
}

/**
 * 打印分析报告
 */
function printReport(analyzedTokens, summary) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 同名代币分析报告');
  console.log('='.repeat(70));

  console.log('\n📈 总体统计:');
  console.log('-'.repeat(70));

  const totalCount = analyzedTokens.length;
  const totalSameName = analyzedTokens.filter(t => t.total_count > 1).length;
  const totalSameNameExcludeSelf = analyzedTokens.filter(t => t.exclude_self_count > 0).length;
  const hasHighFDV = analyzedTokens.filter(t => t.has_high_fdv_same_name).length;
  const hasVeryHighFDV = analyzedTokens.filter(t => t.has_very_high_fdv_same_name).length;

  console.log(`   总代币数: ${totalCount}`);
  console.log(`   有同名代币: ${totalSameName} (${(totalSameName/totalCount*100).toFixed(1)}%)`);
  console.log(`   有同名代币(排除自己): ${totalSameNameExcludeSelf} (${(totalSameNameExcludeSelf/totalCount*100).toFixed(1)}%)`);
  console.log(`   有高市值同名(>$${formatNumber(HIGH_FDV_THRESHOLD)}): ${hasHighFDV} (${(hasHighFDV/totalCount*100).toFixed(1)}%)`);
  console.log(`   有超高市值同名(>$${formatNumber(VERY_HIGH_FDV_THRESHOLD)}): ${hasVeryHighFDV} (${(hasVeryHighFDV/totalCount*100).toFixed(1)}%)`);

  console.log('\n📊 按质量分组统计:');
  console.log('-'.repeat(70));

  const qualityLabels = {
    fake_pump: '🎭 流水盘 (fake_pump)',
    no_user: '👻 无人玩 (no_user)',
    low_quality: '📉 低质量 (low_quality)',
    mid_quality: '📊 中质量 (mid_quality)',
    high_quality: '🚀 高质量 (high_quality)'
  };

  const qualityOrder = ['high_quality', 'mid_quality', 'low_quality', 'no_user', 'fake_pump'];

  qualityOrder.forEach(quality => {
    const data = summary[quality];
    if (!data || data.count === 0) return;

    console.log(`\n${qualityLabels[quality]} (样本数: ${data.count})`);
    console.log(`   平均同名代币数: ${data.avg_count.toFixed(1)}, 中位数: ${data.median_count}`);
    console.log(`   平均最大FDV: $${formatNumber(data.avg_max_fdv)}, 中位数: $${formatNumber(data.median_max_fdv)}`);
    console.log(`   有高市值同名: ${data.has_high_fdv_count}/${data.count} (${data.high_fdv_ratio}%)`);
    console.log(`   有超高市值同名: ${data.has_very_high_fdv_count}/${data.count} (${data.very_high_fdv_ratio}%)`);
  });

  // 区分度分析
  console.log('\n\n📊 区分度分析 (高质量 vs 低质量):');
  console.log('-'.repeat(70));

  if (summary.high_quality && summary.low_quality) {
    const high = summary.high_quality;
    const low = summary.low_quality;

    console.log('\n同名代币数量:');
    const countRatio = low.avg_count > 0 ? (high.avg_count / low.avg_count).toFixed(2) : '∞';
    console.log(`   高质量: 平均 ${high.avg_count.toFixed(1)} 个, 中位数 ${high.median_count}`);
    console.log(`   低质量: 平均 ${low.avg_count.toFixed(1)} 个, 中位数 ${low.median_count}`);
    console.log(`   倍数关系: ${countRatio}x`);

    console.log('\n最大FDV:');
    const fdvRatio = low.median_max_fdv > 0 ? (high.median_max_fdv / low.median_max_fdv).toFixed(2) : '∞';
    console.log(`   高质量: 平均 $${formatNumber(high.avg_max_fdv)}, 中位数 $${formatNumber(high.median_max_fdv)}`);
    console.log(`   低质量: 平均 $${formatNumber(low.avg_max_fdv)}, 中位数 $${formatNumber(low.median_max_fdv)}`);
    console.log(`   倍数关系: ${fdvRatio}x`);

    console.log('\n高市值同名代币占比:');
    const highHighRatio = parseFloat(high.high_fdv_ratio);
    const lowHighRatio = parseFloat(low.high_fdv_ratio);
    const ratioDiff = highHighRatio - lowHighRatio;
    console.log(`   高质量: ${high.high_high_fdv_count}/${high.count} (${high.high_fdv_ratio}%)`);
    console.log(`   低质量: ${low.has_high_fdv_count}/${low.count} (${low.high_fdv_ratio}%)`);
    console.log(`   差异: ${ratioDiff > 0 ? '+' : ''}${ratioDiff.toFixed(1)}%`);

    const hasDistinction = Math.abs(ratioDiff) > 20;
    console.log(`   结论: ${hasDistinction ? '✅ 有明显区分度' : '❌ 区分度不明显'}`);

  } else {
    console.log('   样本不足，无法对比');
  }

  // 同名代币数量分布
  console.log('\n\n📊 同名代币数量分布:');
  console.log('-'.repeat(70));

  const distribution = {
    '0个同名': 0,
    '1-5个': 0,
    '6-10个': 0,
    '11-20个': 0,
    '20+个': 0
  };

  analyzedTokens.forEach(t => {
    const count = t.total_count;
    if (count === 1) distribution['0个同名']++;
    else if (count <= 5) distribution['1-5个']++;
    else if (count <= 10) distribution['6-10个']++;
    else if (count <= 20) distribution['11-20个']++;
    else distribution['20+个']++;
  });

  Object.entries(distribution).forEach(([range, count]) => {
    console.log(`   ${range.padEnd(12)}: ${count} (${(count/totalCount*100).toFixed(1)}%)`);
  });

  // 按质量分组的同名代币数量分布
  console.log('\n\n📊 按质量分组的同名代币数量分布:');
  console.log('-'.repeat(70));

  qualityOrder.forEach(quality => {
    const data = summary[quality];
    if (!data || data.count === 0) return;

    const tokens = analyzedTokens.filter(t => t.quality_category === quality);
    const dist = {
      '0个': 0,
      '1-5个': 0,
      '6-10个': 0,
      '11+个': 0
    };

    tokens.forEach(t => {
      const count = t.total_count;
      if (count === 1) dist['0个']++;
      else if (count <= 5) dist['1-5个']++;
      else if (count <= 10) dist['6-10个']++;
      else dist['11+个']++;
    });

    console.log(`\n${qualityLabels[quality]}:`);
    Object.entries(dist).forEach(([range, count]) => {
      console.log(`   ${range.padEnd(10)}: ${count}/${data.count} (${(count/data.count*100).toFixed(1)}%)`);
    });
  });

  // 案例分析
  console.log('\n\n🔍 案例分析:');
  console.log('-'.repeat(70));

  // 找出同名代币最多的案例
  const mostSameName = [...analyzedTokens].sort((a, b) => b.total_count - a.total_count)[0];
  if (mostSameName && mostSameName.total_count > 1) {
    console.log(`\n   同名代币最多: ${mostSameName.token_symbol}`);
    console.log(`   同名数量: ${mostSameName.total_count} 个`);
    console.log(`   质量: ${mostSameName.quality_category}`);
    console.log(`   最大FDV: $${formatNumber(mostSameName.max_fdv)}`);
  }

  // 找出最大FDV的案例
  const maxFDV = [...analyzedTokens].sort((a, b) => b.max_fdv - a.max_fdv)[0];
  if (maxFDV && maxFDV.max_fdv > 0) {
    console.log(`\n   最大同名代币FDV: ${maxFDV.token_symbol}`);
    console.log(`   最大FDV: $${formatNumber(maxFDV.max_fdv)}`);
    console.log(`   质量: ${maxFDV.quality_category}`);
    console.log(`   同名数量: ${maxFDV.total_count} 个`);
  }

  // 最终结论
  console.log('\n\n💡 结论与建议:');
  console.log('-'.repeat(70));

  const highHighRatio = summary.high_quality ? parseFloat(summary.high_quality.high_fdv_ratio) : 0;
  const lowHighRatio = summary.low_quality ? parseFloat(summary.low_quality.high_fdv_ratio) : 0;

  if (Math.abs(highHighRatio - lowHighRatio) > 20) {
    console.log('   ✅ 高市值同名代币占比在不同质量组有明显差异');
    console.log(`   ✅ 可以作为风险判断的参考指标`);
  } else {
    console.log('   ❌ 高市值同名代币占比在不同质量组差异不明显');
    console.log(`   📊 建议结合其他指标使用`);
  }

  const highAvgCount = summary.high_quality ? summary.high_quality.avg_count : 0;
  const lowAvgCount = summary.low_quality ? summary.low_quality.avg_count : 0;

  if (Math.abs(highAvgCount - lowAvgCount) > 2) {
    console.log(`\n   ✅ 同名代币数量也有区分度 (高质量平均${highAvgCount.toFixed(1)} vs 低质量${lowAvgCount.toFixed(1)})`);
  } else {
    console.log(`   ❌ 同名代币数量区分度不明显 (高质量平均${highAvgCount.toFixed(1)} vs 低质量${lowAvgCount.toFixed(1)})`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 同名代币分析');
  console.log(`实验ID: ${EXPERIMENT_ID}`);
  console.log(`API地址: ${API_BASE}`);

  try {
    // 1. 获取有交易的代币
    const tokens = await getTradedTokens(EXPERIMENT_ID);

    if (tokens.length === 0) {
      console.log('❌ 没有找到有交易的代币');
      return;
    }

    // 2. 初始化AVE API
    const aveAPI = new AveTokenAPI('https://prod.ave-api.com', 30000, AVE_API_KEY);

    // 3. 分析每个代币的同名代币
    console.log('\n🔍 正在搜索同名代币...');
    const analyzedTokens = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      const result = await analyzeSameNameTokens(token, aveAPI);
      analyzedTokens.push(result);

      // 延时避免API限流
      if (i < tokens.length - 1) {
        await sleep(200);
      }
    }

    // 4. 统计分析
    console.log('\n📊 正在进行统计分析...');
    const summary = summarizeByQuality(analyzedTokens);

    // 5. 打印报告
    printReport(analyzedTokens, summary);

    // 6. 保存结果
    const outputData = {
      experiment_id: EXPERIMENT_ID,
      analysis_timestamp: new Date().toISOString(),
      total_tokens: tokens.length,
      analyzed_tokens: analyzedTokens.length,
      summary_by_quality: summary,
      detailed_results: analyzedTokens,
      thresholds: {
        high_fdv_threshold: HIGH_FDV_THRESHOLD,
        very_high_fdv_threshold: VERY_HIGH_FDV_THRESHOLD
      }
    };

    const fs = require('fs');
    const outputFile = `same_name_analysis_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`\n💾 结果已保存到: ${outputFile}`);

  } catch (error) {
    console.error('\n❌ 分析失败:', error);
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
