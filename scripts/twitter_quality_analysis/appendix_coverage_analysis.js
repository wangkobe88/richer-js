#!/usr/bin/env node

/**
 * Appendix 覆盖率分析
 *
 * 分析目标：
 * 1. 统计有交易代币的 appendix 覆盖率
 * 2. 按质量分组分析覆盖率差异
 * 3. 与 Twitter 搜索结果对比
 * 4. 评估 appendix 是否可以作为快速筛选指标
 */

// API配置
const API_BASE = 'http://localhost:3010';
const EXPERIMENT_ID = process.argv[2] || '25493408-98b3-4342-a1ac-036ba49f97ee';

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
 * 分析代币的 appendix 信息
 */
function analyzeTokenAppendix(token) {
  const rawData = token.raw_api_data || {};
  const appendixStr = rawData.appendix;

  // 基础信息
  const result = {
    token_address: token.token_address,
    token_symbol: token.token_symbol,
    quality_category: token.human_judges.category,
    has_appendix: false,
    has_twitter_in_appendix: false,
    twitter_url: null,
    appendix_parse_error: null
  };

  // 检查 appendix 是否存在且不为空
  if (!appendixStr || appendixStr.trim() === '' || appendixStr === 'null' || appendixStr === '[]') {
    return result;
  }

  result.has_appendix = true;

  // 尝试解析 appendix
  try {
    const appendix = typeof appendixStr === 'string'
      ? JSON.parse(appendixStr)
      : appendixStr;

    // 检查 twitter 字段
    if (appendix.twitter && appendix.twitter.trim() !== '') {
      result.has_twitter_in_appendix = true;
      result.twitter_url = appendix.twitter.trim();
    }

  } catch (error) {
    result.appendix_parse_error = error.message;
  }

  return result;
}

/**
 * 检查备用的 Twitter 来源
 */
function checkAlternativeTwitterSources(token) {
  const rawData = token.raw_api_data || {};
  const sources = {
    description: false,
    fourmeme_creator: false
  };

  // 检查 description 中的 Twitter 链接
  if (rawData.description) {
    const twitterRegex = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]{1,15}/gi;
    sources.description = twitterRegex.test(rawData.description);
  }

  // 检查 fourmeme_creator_info 中的 Twitter
  if (rawData.fourmeme_creator_info?.full_info?.raw?.twitterUrl) {
    sources.fourmeme_creator = true;
  }

  return sources;
}

/**
 * 加载之前的 Twitter 搜索结果
 */
async function loadTwitterSearchResults() {
  const fs = require('fs');
  const path = require('path');

  // 查找最新的 Twitter 分析结果文件
  const files = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('twitter_quality_analysis_compare_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('   ⚠️  未找到之前的 Twitter 分析结果文件');
    return null;
  }

  const filePath = path.join(__dirname, files[0]);
  console.log(`   📂 加载之前的分析结果: ${files[0]}`);

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data;
  } catch (error) {
    console.error(`   ❌ 加载文件失败: ${error.message}`);
    return null;
  }
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
    const total = tokens.length;
    const hasAppendix = tokens.filter(t => t.has_appendix).length;
    const hasTwitter = tokens.filter(t => t.has_twitter_in_appendix).length;

    summary[quality] = {
      total,
      has_appendix: hasAppendix,
      has_twitter_in_appendix: hasTwitter,
      appendix_coverage: total > 0 ? (hasAppendix / total * 100).toFixed(1) : '0.0',
      twitter_coverage: total > 0 ? (hasTwitter / total * 100).toFixed(1) : '0.0'
    };
  }

  return summary;
}

/**
 * 与 Twitter 搜索结果对比
 */
function compareWithTwitterSearch(appendixSummary, twitterData) {
  if (!twitterData || !twitterData.summary_by_quality) {
    return null;
  }

  const comparison = {};

  const qualityLabels = {
    high_quality: '🚀 高质量',
    mid_quality: '📊 中质量',
    low_quality: '📉 低质量'
  };

  for (const [quality, label] of Object.entries(qualityLabels)) {
    const appendixData = appendixSummary[quality];
    const twitterDataQuality = twitterData.summary_by_quality[quality];

    if (!appendixData || !twitterDataQuality) {
      continue;
    }

    // Twitter搜索覆盖率（全部模式）
    // 从之前的分析结果中获取有Twitter搜索结果的代币数
    const twitterAllCount = twitterData.detailed_results
      ? twitterData.detailed_results.filter(t =>
          t.quality_category === quality &&
          t.twitter_all &&
          t.twitter_all.tweets_count > 0
        ).length
      : 0;

    comparison[quality] = {
      label,
      appendix_total: appendixData.total,
      appendix_has_twitter: appendixData.has_twitter_in_appendix,
      appendix_coverage: appendixData.twitter_coverage,
      twitter_total: twitterDataQuality.count,
      twitter_has_results: twitterAllCount,
      twitter_coverage: twitterDataQuality.count > 0
        ? (twitterAllCount / twitterDataQuality.count * 100).toFixed(1)
        : '0.0'
    };
  }

  return comparison;
}

/**
 * 打印分析报告
 */
function printReport(analyzedTokens, summary, comparison) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 Appendix 覆盖率分析报告');
  console.log('='.repeat(70));

  const totalTokens = analyzedTokens.length;
  const totalHasAppendix = analyzedTokens.filter(t => t.has_appendix).length;
  const totalHasTwitter = analyzedTokens.filter(t => t.has_twitter_in_appendix).length;

  console.log('\n📈 总体覆盖率:');
  console.log('-'.repeat(70));
  console.log(`   总代币数: ${totalTokens}`);
  console.log(`   有附录: ${totalHasAppendix} (${(totalHasAppendix/totalTokens*100).toFixed(1)}%)`);
  console.log(`   附录中有Twitter: ${totalHasTwitter} (${(totalHasTwitter/totalTokens*100).toFixed(1)}%)`);
  console.log(`   无附录: ${totalTokens - totalHasAppendix} (${((totalTokens - totalHasAppendix)/totalTokens*100).toFixed(1)}%)`);

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
    if (!data || data.total === 0) return;

    console.log(`\n${qualityLabels[quality]} (样本数: ${data.total})`);
    console.log(`   有附录: ${data.has_appendix}/${data.total} (${data.appendix_coverage}%)`);
    console.log(`   附录中有Twitter: ${data.has_twitter_in_appendix}/${data.total} (${data.twitter_coverage}%)`);
  });

  // 区分度分析
  console.log('\n\n📊 区分度分析 (高质量 vs 低质量):');
  console.log('-'.repeat(70));

  if (summary.high_quality && summary.low_quality) {
    const high = summary.high_quality;
    const low = summary.low_quality;

    console.log('\n附录覆盖率:');
    const highRate = parseFloat(high.appendix_coverage) || 0;
    const lowRate = parseFloat(low.appendix_coverage) || 0;
    const ratio = lowRate > 0 ? (highRate / lowRate).toFixed(2) : '∞';
    console.log(`   高质量: ${high.appendix_coverage}% (${high.has_appendix}/${high.total})`);
    console.log(`   低质量: ${low.appendix_coverage}% (${low.has_appendix}/${low.total})`);
    console.log(`   倍数关系: ${ratio}x`);

    console.log('\nTwitter字段覆盖率:');
    const highTwitterRate = parseFloat(high.twitter_coverage) || 0;
    const lowTwitterRate = parseFloat(low.twitter_coverage) || 0;
    const twitterRatio = lowTwitterRate > 0 ? (highTwitterRate / lowTwitterRate).toFixed(2) : '∞';
    console.log(`   高质量: ${high.twitter_coverage}% (${high.has_twitter_in_appendix}/${high.total})`);
    console.log(`   低质量: ${low.twitter_coverage}% (${low.has_twitter_in_appendix}/${low.total})`);
    console.log(`   倍数关系: ${twitterRatio}x`);

    const hasDistinction = Math.abs(highRate - lowRate) > 20;
    console.log(`\n   结论: ${hasDistinction ? '✅ 有明显区分度' : '❌ 区分度不明显'}`);
  } else {
    console.log('   样本不足，无法对比');
  }

  // 与 Twitter 搜索结果对比
  if (comparison) {
    console.log('\n\n🔗 与 Twitter 搜索结果对比:');
    console.log('-'.repeat(70));
    console.log('\n   质量等级       附录覆盖率    Twitter搜索覆盖率');
    console.log('   ' + '-'.repeat(50));

    Object.values(comparison).forEach(comp => {
      if (!comp) return;
      console.log(`   ${comp.label.padEnd(14)} ${comp.appendix_coverage.padEnd(12)} ${comp.twitter_coverage.padEnd(15)}`);
    });

    console.log('\n   说明:');
    console.log('   - 附录覆盖率: raw_api_data.appendix 中有 twitter 字段的占比');
    console.log('   - Twitter搜索覆盖率: 通过地址搜索Twitter找到结果的占比');
  }

  // 备用 Twitter 来源分析
  console.log('\n\n🔍 备用 Twitter 来源分析:');
  console.log('-'.repeat(70));

  const withAltSources = analyzedTokens.filter(t => {
    const sources = checkAlternativeTwitterSources(t);
    return sources.description || sources.fourmeme_creator;
  });

  const descOnly = withAltSources.filter(t => {
    const sources = checkAlternativeTwitterSources(t);
    return sources.description && !sources.fourmeme_creator && !t.has_twitter_in_appendix;
  }).length;

  const creatorOnly = withAltSources.filter(t => {
    const sources = checkAlternativeTwitterSources(t);
    return sources.fourmeme_creator && !sources.description && !t.has_twitter_in_appendix;
  }).length;

  console.log(`   有备用Twitter来源的代币: ${withAltSources.length}/${totalTokens} (${(withAltSources.length/totalTokens*100).toFixed(1)}%)`);
  console.log(`   - 仅在description中: ${descOnly}`);
  console.log(`   - 仅在fourmeme_creator中: ${creatorOnly}`);

  // 最终结论
  console.log('\n\n💡 结论与建议:');
  console.log('-'.repeat(70));

  const highAppendixRate = summary.high_quality ? parseFloat(summary.high_quality.appendix_coverage) : 0;
  const lowAppendixRate = summary.low_quality ? parseFloat(summary.low_quality.appendix_coverage) : 0;
  const hasDistinction = Math.abs(highAppendixRate - lowAppendixRate) > 20;

  if (hasDistinction) {
    console.log('   ✅ Appendix 覆盖率在不同质量组有明显差异');
    console.log(`   ✅ 高质量代币的 Appendix 覆盖率 (${highAppendixRate}%) 明显${highAppendixRate > lowAppendixRate ? '高于' : '低于'}低质量代币 (${lowAppendixRate}%)`);
  } else {
    console.log('   ❌ Appendix 覆盖率在不同质量组差异不明显');
  }

  const totalRate = (totalHasTwitter / totalTokens * 100).toFixed(1);
  console.log(`\n   📊 总体 Twitter 信息可用性: ${totalRate}% (通过附录字段)`);
  console.log(`   📌 建议结合多种来源获取 Twitter 信息`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 Appendix 覆盖率分析');
  console.log(`实验ID: ${EXPERIMENT_ID}`);
  console.log(`API地址: ${API_BASE}`);

  try {
    // 1. 获取有交易的代币
    const tokens = await getTradedTokens(EXPERIMENT_ID);

    if (tokens.length === 0) {
      console.log('❌ 没有找到有交易的代币');
      return;
    }

    // 2. 分析每个代币的 appendix
    console.log('\n🔍 正在分析代币的 appendix 信息...');
    const analyzedTokens = tokens.map(analyzeTokenAppendix);

    // 3. 统计分析
    console.log('\n📊 正在进行统计分析...');
    const summary = summarizeByQuality(analyzedTokens);

    // 4. 加载之前的 Twitter 搜索结果
    console.log('\n📂 正在加载之前的 Twitter 搜索结果...');
    const twitterData = await loadTwitterSearchResults();
    const comparison = compareWithTwitterSearch(summary, twitterData);

    // 5. 打印报告
    printReport(analyzedTokens, summary, comparison);

    // 6. 保存结果
    const outputData = {
      experiment_id: EXPERIMENT_ID,
      analysis_timestamp: new Date().toISOString(),
      total_tokens: tokens.length,
      analyzed_tokens: analyzedTokens.length,
      summary_by_quality: summary,
      comparison: comparison,
      detailed_results: analyzedTokens
    };

    const fs = require('fs');
    const outputFile = `appendix_coverage_analysis_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`;
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
