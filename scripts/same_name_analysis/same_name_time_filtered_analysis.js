#!/usr/bin/env node

/**
 * 严格同名代币分析（修正版 - 时间过滤）
 *
 * 分析目标：
 * 1. 统计每个代币的"真正"同名代币数量（创建时间在目标代币之前）
 * 2. 分析同名代币的最大市值
 * 3. 按质量分组分析同名代币情况
 * 4. 评估同名代币是否可以作为风险指标
 *
 * 核心逻辑：
 * - 只统计创建时间 <= 目标代币创建时间的同名代币
 * - 创建之后的同名代币视为"跟风"，不计入同名数量
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
 * 获取代币创建时间
 */
function getTokenLaunchAt(token) {
  // 优先级: raw_api_data.token.launch_at > raw_api_data.launch_at > launchAt > createdAt
  if (token.raw_api_data) {
    try {
      const rawData = typeof token.raw_api_data === 'string'
        ? JSON.parse(token.raw_api_data)
        : token.raw_api_data;

      if (rawData.token?.launch_at) {
        return rawData.token.launch_at;
      }
      if (rawData.launch_at) {
        return rawData.launch_at;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  if (token.launchAt) {
    return token.launchAt;
  }

  if (token.createdAt) {
    return Math.floor(new Date(token.createdAt).getTime() / 1000);
  }

  return null;
}

/**
 * 判断两个代币是否真正同名
 */
function isSameName(name1, symbol1, name2, symbol2) {
  if (!name1 || !name2) {
    return false;
  }

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  const s1 = symbol1.toLowerCase().trim();
  const s2 = symbol2.toLowerCase().trim();

  // 规则1: name 完全相同
  if (n1 === n2) {
    return true;
  }

  // 规则2: symbol 完全相同且其中一个 name 包含另一个 symbol
  if (s1 === s2) {
    // 检查 name 是否相关（包含相同的核心词）
    const core1 = extractCoreName(n1);
    const core2 = extractCoreName(n2);

    if (core1 && core2 && core1 === core2) {
      return true;
    }

    // 检查 name 是否包含 symbol（允许变体）
    if (n1.includes(s2) || n2.includes(s1)) {
      return true;
    }
  }

  // 规则3: name 互相包含（处理 "Leo" vs "Leo Token" 的情况）
  const shorter = n1.length < n2.length ? n1 : n2;
  const longer = n1.length < n2.length ? n2 : n1;

  if (longer.includes(shorter) && shorter.length >= 3) {
    return true;
  }

  return false;
}

/**
 * 提取名称的核心部分
 */
function extractCoreName(name) {
  const suffixes = [' token', ' coin', ' finance', ' dao', ' protocol', ' swap', ''];
  let coreName = name.toLowerCase().trim();

  for (const suffix of suffixes) {
    if (coreName.endsWith(suffix)) {
      coreName = coreName.slice(0, -suffix.length).trim();
      break;
    }
  }

  return coreName || name;
}

/**
 * 分析代币的严格同名代币（修正版）
 */
async function analyzeSameNameTokens(token, aveAPI) {
  const symbol = token.token_symbol;
  const tokenName = token.raw_api_data?.name || token.name || '';
  const tokenAddress = token.token_address;
  const tokenLaunchAt = getTokenLaunchAt(token);

  console.log(`\n   🔍 分析 ${symbol} (${tokenName}) (${tokenAddress.substring(0, 10)}...)`);
  console.log(`      📅 创建时间: ${tokenLaunchAt ? new Date(tokenLaunchAt * 1000).toISOString() : '未知'}`);

  if (!tokenLaunchAt) {
    console.log(`      ⚠️  创建时间未知，跳过分析`);
    return {
      token_address: tokenAddress,
      token_symbol: symbol,
      token_name: tokenName,
      token_launch_at: null,
      quality_category: token.human_judges.category,
      search_result_count: 0,
      strict_same_name_before_count: 0,
      strict_same_name_after_count: 0,
      exclude_self_count: 0,
      max_fdv: 0,
      max_market_cap: 0,
      has_high_fdv_same_name: false,
      has_very_high_fdv_same_name: false,
      chains: [],
      same_name_tokens: [],
      filtered_out_count: 0,
      error: 'missing_launch_time'
    };
  }

  try {
    // 搜索同名代币
    const results = await aveAPI.searchTokens(symbol, 'bsc', 300, 'fdv');

    if (!results || results.length === 0) {
      return {
        token_address: tokenAddress,
        token_symbol: symbol,
        token_name: tokenName,
        token_launch_at: tokenLaunchAt,
        quality_category: token.human_judges.category,
        search_result_count: 0,
        strict_same_name_before_count: 0,
        strict_same_name_after_count: 0,
        exclude_self_count: 0,
        max_fdv: 0,
        max_market_cap: 0,
        has_high_fdv_same_name: false,
        has_very_high_fdv_same_name: false,
        chains: [],
        same_name_tokens: [],
        filtered_out_count: 0
      };
    }

    // 严格名称匹配 + 时间过滤
    const beforeLaunch = [];
    const afterOrSameLaunch = [];

    for (const t of results) {
      const tLaunchAt = t.launch_at || t.created_at || 0;

      if (tLaunchAt === 0) {
        // 创建时间未知，不计入
        continue;
      }

      // 严格名称匹配
      const nameMatched = isSameName(tokenName, symbol, t.name, t.symbol);

      if (!nameMatched) {
        continue;
      }

      // 排除自己
      if (t.token === tokenAddress) {
        continue;
      }

      // 按创建时间分组
      if (tLaunchAt < tokenLaunchAt) {
        beforeLaunch.push(t);
      } else if (tLaunchAt > tokenLaunchAt) {
        afterOrSameLaunch.push(t);
      }
      // 相同时间不计入（无法判断先后）
    }

    // 统计链
    const chains = [...new Set(beforeLaunch.map(t => t.chain))];

    // 找到最大FDV（只看创建之前的）
    const fdvList = beforeLaunch.map(t => parseFDV(t.fdv)).filter(v => v > 0);
    const marketCapList = beforeLaunch.map(t => parseFDV(t.market_cap)).filter(v => v > 0);

    const maxFDV = fdvList.length > 0 ? Math.max(...fdvList) : 0;
    const maxMarketCap = marketCapList.length > 0 ? Math.max(...marketCapList) : 0;

    const result = {
      token_address: tokenAddress,
      token_symbol: symbol,
      token_name: tokenName,
      token_launch_at: tokenLaunchAt,
      quality_category: token.human_judges.category,
      search_result_count: results.length,
      strict_same_name_before_count: beforeLaunch.length,      // 主因子：创建之前的同名数量
      strict_same_name_after_count: afterOrSameLaunch.length,   // 创建之后的同名数量（跟风）
      exclude_self_count: beforeLaunch.length + afterOrSameLaunch.length,
      max_fdv: maxFDV,
      max_market_cap: maxMarketCap,
      has_high_fdv_same_name: maxFDV >= HIGH_FDV_THRESHOLD,
      has_very_high_fdv_same_name: maxFDV >= VERY_HIGH_FDV_THRESHOLD,
      chains: chains,
      same_name_tokens: [
        ...beforeLaunch.map(t => ({
          token: t.token,
          symbol: t.symbol,
          name: t.name,
          chain: t.chain,
          fdv: parseFDV(t.fdv),
          market_cap: parseFDV(t.market_cap),
          launch_at: t.launch_at || t.created_at,
          type: 'before'
        })),
        ...afterOrSameLaunch.slice(0, 10).map(t => ({  // 只保存前10个跟风的
          token: t.token,
          symbol: t.symbol,
          name: t.name,
          chain: t.chain,
          fdv: parseFDV(t.fdv),
          market_cap: parseFDV(t.market_cap),
          launch_at: t.launch_at || t.created_at,
          type: 'after'
        }))
      ],
      filtered_out_count: results.length - (beforeLaunch.length + afterOrSameLaunch.length.length)
    };

    console.log(`      ✅ 搜索 ${results.length} 个, 严格匹配 ${beforeLaunch.length + afterOrSameLaunch.length.length} 个 (之前: ${beforeLaunch.length}, 之后: ${afterOrSameLaunch.length.length}, 过滤: ${result.filtered_out_count})`);
    console.log(`      📊 最大FDV: $${formatNumber(maxFDV)}, 最大市值: $${formatNumber(maxMarketCap)}`);

    return result;

  } catch (error) {
    console.error(`   ❌ 搜索失败 ${symbol}:`, error.message);
    return {
      token_address: tokenAddress,
      token_symbol: symbol,
      token_name: tokenName,
      token_launch_at: tokenLaunchAt,
      quality_category: token.human_judges.category,
      search_result_count: 0,
      strict_same_name_before_count: 0,
      strict_same_name_after_count: 0,
      exclude_self_count: 0,
      max_fdv: 0,
      max_market_cap: 0,
      has_high_fdv_same_name: false,
      has_very_high_fdv_same_name: false,
      chains: [],
      same_name_tokens: [],
      filtered_out_count: 0,
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
 * 格式化时间
 */
function formatTime(timestamp) {
  if (!timestamp) return '未知';
  return new Date(timestamp * 1000).toISOString().substring(0, 10);
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
        avg_before_count: 0,
        median_before_count: 0,
        avg_after_count: 0,
        median_after_count: 0,
        avg_max_fdv: 0,
        median_max_fdv: 0,
        has_high_fdv_count: 0,
        has_very_high_fdv_count: 0
      };
      continue;
    }

    const beforeCounts = tokens.map(t => t.strict_same_name_before_count);
    const afterCounts = tokens.map(t => t.strict_same_name_after_count);
    const maxFDVs = tokens.map(t => t.max_fdv);
    const hasHighFDV = tokens.filter(t => t.has_high_fdv_same_name).length;
    const hasVeryHighFDV = tokens.filter(t => t.has_very_high_fdv_same_name).length;

    beforeCounts.sort((a, b) => a - b);
    afterCounts.sort((a, b) => a - b);
    maxFDVs.sort((a, b) => a - b);

    const sumBefore = beforeCounts.reduce((a, b) => a + b, 0);
    const sumAfter = afterCounts.reduce((a, b) => a + b, 0);
    const sumFDV = maxFDVs.reduce((a, b) => a + b, 0);

    summary[quality] = {
      count: tokens.length,
      avg_before_count: sumBefore / tokens.length,
      median_before_count: beforeCounts[Math.floor(beforeCounts.length / 2)],
      avg_after_count: sumAfter / tokens.length,
      median_after_count: afterCounts[Math.floor(afterCounts.length / 2)],
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
  console.log('📊 严格同名代币分析报告（修正版 - 时间过滤）');
  console.log('='.repeat(70));

  console.log('\n📈 总体统计:');
  console.log('-'.repeat(70));

  const totalCount = analyzedTokens.length;
  const totalHasBefore = analyzedTokens.filter(t => t.strict_same_name_before_count > 0).length;
  const hasHighFDV = analyzedTokens.filter(t => t.has_high_fdv_same_name).length;
  const hasVeryHighFDV = analyzedTokens.filter(t => t.has_very_high_fdv_same_name).length;
  const totalFiltered = analyzedTokens.reduce((sum, t) => sum + t.filtered_out_count, 0);
  const totalAfter = analyzedTokens.reduce((sum, t) => sum + t.strict_same_name_after_count, 0);

  console.log(`   总代币数: ${totalCount}`);
  console.log(`   有同名代币(创建前): ${totalHasBefore} (${(totalHasBefore/totalCount*100).toFixed(1)}%)`);
  console.log(`   总过滤掉: ${totalFiltered} 个不匹配的代币`);
  console.log(`   跟风代币总数(创建后): ${totalAfter}`);
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
    console.log(`   平均同名(创建前): ${data.avg_before_count.toFixed(1)}, 中位数: ${data.median_before_count}`);
    console.log(`   平均跟风(创建后): ${data.avg_after_count.toFixed(1)}, 中位数: ${data.median_after_count}`);
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

    console.log('\n同名代币数量(创建前):');
    const countRatio = low.avg_before_count > 0 ? (high.avg_before_count / low.avg_before_count).toFixed(2) : '∞';
    console.log(`   高质量: 平均 ${high.avg_before_count.toFixed(1)} 个, 中位数 ${high.median_before_count}`);
    console.log(`   低质量: 平均 ${low.avg_before_count.toFixed(1)} 个, 中位数 ${low.median_before_count}`);
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
    console.log(`   高质量: ${high.has_high_fdv_count}/${high.count} (${high.high_fdv_ratio}%)`);
    console.log(`   低质量: ${low.has_high_fdv_count}/${low.count} (${low.high_fdv_ratio}%)`);
    console.log(`   差异: ${ratioDiff > 0 ? '+' : ''}${ratioDiff.toFixed(1)}%`);

    const hasDistinction = Math.abs(ratioDiff) > 20;
    console.log(`   结论: ${hasDistinction ? '✅ 有明显区分度' : '❌ 区分度不明显'}`);

  } else {
    console.log('   样本不足，无法对比');
  }

  // 同名代币数量分布
  console.log('\n\n📊 同名代币数量分布(创建前):');
  console.log('-'.repeat(70));

  const distribution = {
    '0个同名': 0,
    '1-5个': 0,
    '6-10个': 0,
    '11-20个': 0,
    '20+个': 0
  };

  analyzedTokens.forEach(t => {
    const count = t.strict_same_name_before_count;
    if (count === 0) distribution['0个同名']++;
    else if (count <= 5) distribution['1-5个']++;
    else if (count <= 10) distribution['6-10个']++;
    else if (count <= 20) distribution['11-20个']++;
    else distribution['20+个']++;
  });

  Object.entries(distribution).forEach(([range, count]) => {
    console.log(`   ${range.padEnd(12)}: ${count} (${(count/totalCount*100).toFixed(1)}%)`);
  });

  // 跟风代币统计
  console.log('\n\n📊 跟风代币统计(创建后的同名):');
  console.log('-'.repeat(70));

  const hasFollowers = analyzedTokens.filter(t => t.strict_same_name_after_count > 0).length;
  const avgFollowers = analyzedTokens.reduce((sum, t) => sum + t.strict_same_name_after_count, 0) / totalCount;

  console.log(`   有跟风代币: ${hasFollowers}/${totalCount} (${(hasFollowers/totalCount*100).toFixed(1)}%)`);
  console.log(`   平均跟风数量: ${avgFollowers.toFixed(1)}`);

  // 按质量分组的同名代币数量分布
  console.log('\n\n📊 按质量分组的同名代币数量分布(创建前):');
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
      const count = t.strict_same_name_before_count;
      if (count === 0) dist['0个']++;
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
  const mostSameName = [...analyzedTokens].sort((a, b) => b.strict_same_name_before_count - a.strict_same_name_before_count)[0];
  if (mostSameName && mostSameName.strict_same_name_before_count > 0) {
    console.log(`\n   同名代币最多(创建前): ${mostSameName.token_symbol}`);
    console.log(`   创建时间: ${formatTime(mostSameName.token_launch_at)}`);
    console.log(`   同名数量: ${mostSameName.strict_same_name_before_count} 个`);
    console.log(`   跟风数量: ${mostSameName.strict_same_name_after_count} 个`);
    console.log(`   质量: ${mostSameName.quality_category}`);
    console.log(`   最大FDV: $${formatNumber(mostSameName.max_fdv)}`);
  }

  // 找出最大FDV的案例
  const maxFDV = [...analyzedTokens].sort((a, b) => b.max_fdv - a.max_fdv)[0];
  if (maxFDV && maxFDV.max_fdv > 0) {
    console.log(`\n   最大同名代币FDV: ${maxFDV.token_symbol}`);
    console.log(`   创建时间: ${formatTime(maxFDV.token_launch_at)}`);
    console.log(`   最大FDV: $${formatNumber(maxFDV.max_fdv)}`);
    console.log(`   质量: ${maxFDV.quality_category}`);
    console.log(`   同名数量: ${maxFDV.strict_same_name_before_count} 个`);
  }

  // 找出跟风最多的案例
  const mostFollowed = [...analyzedTokens].sort((a, b) => b.strict_same_name_after_count - a.strict_same_name_after_count)[0];
  if (mostFollowed && mostFollowed.strict_same_name_after_count > 0) {
    console.log(`\n   跟风代币最多: ${mostFollowed.token_symbol}`);
    console.log(`   创建时间: ${formatTime(mostFollowed.token_launch_at)}`);
    console.log(`   跟风数量: ${mostFollowed.strict_same_name_after_count} 个`);
    console.log(`   质量: ${mostFollowed.quality_category}`);
    console.log(`   同名数量(创建前): ${mostFollowed.strict_same_name_before_count} 个`);
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

  const highAvgCount = summary.high_quality ? summary.high_quality.avg_before_count : 0;
  const lowAvgCount = summary.low_quality ? summary.low_quality.avg_before_count : 0;

  if (Math.abs(highAvgCount - lowAvgCount) > 2) {
    console.log(`\n   ✅ 同名代币数量(创建前)也有区分度 (高质量平均${highAvgCount.toFixed(1)} vs 低质量${lowAvgCount.toFixed(1)})`);
  } else {
    console.log(`   ❌ 同名代币数量(创建前)区分度不明显 (高质量平均${highAvgCount.toFixed(1)} vs 低质量${lowAvgCount.toFixed(1)})`);
  }

  const totalFollowers = analyzedTokens.reduce((sum, t) => sum + t.strict_same_name_after_count, 0);
  console.log(`\n   📊 总跟风代币数: ${totalFollowers}`);
  console.log(`   💡 时间过滤能有效去除"跟风代币"的干扰`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 严格同名代币分析（修正版 - 时间过滤）');
  console.log(`实验ID: ${EXPERIMENT_ID}`);
  console.log(`API地址: ${API_BASE}`);
  console.log(`核心逻辑: 只统计创建时间 <= 目标代币创建时间的同名代币`);

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
    console.log('\n🔍 正在搜索严格同名代币（时间过滤）...');
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
      analysis_type: 'strict_with_time_filter',
      total_tokens: tokens.length,
      analyzed_tokens: analyzedTokens.length,
      summary_by_quality: summary,
      detailed_results: analyzedTokens,
      thresholds: {
        high_fdv_threshold: HIGH_FDV_THRESHOLD,
        very_high_fdv_threshold: VERY_HIGH_FDV_THRESHOLD
      },
      matching_rules: {
        description: '严格名称匹配 + 时间过滤',
        rules: [
          'name 完全相同（忽略大小写和空格）',
          'name 互相包含（处理 "Leo" vs "Leo Token"）',
          '只统计创建时间 < 目标代币创建时间的同名代币',
          '排除创建时间未知的数据'
        ]
      }
    };

    const fs = require('fs');
    const outputFile = `same_name_time_filtered_analysis_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`;
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
