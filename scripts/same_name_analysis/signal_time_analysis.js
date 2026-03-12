#!/usr/bin/env node

/**
 * 购买时刻同名代币分析
 *
 * 分析目标：
 * 1. 获取实验中已人工标注的代币
 * 2. 获取每个代币的首次已执行BUY信号时间
 * 3. 在购买时刻搜索同名代币
 * 4. 统计各质量组的同名代币特征差异
 *
 * 时间基准：使用 earlyTradesCheckTime（虚拟历史时间）
 * 过滤条件：只统计 launch_at < earlyTradesCheckTime 的代币
 */

const path = require('path');
const projectRoot = path.resolve(__dirname, '../..');

require('dotenv').config({ path: path.join(projectRoot, 'config/.env') });
const { AveTokenAPI } = require(path.join(projectRoot, 'src/core/ave-api/token-api'));

// API配置
const API_BASE = 'http://localhost:3010';
const EXPERIMENT_ID = process.argv[2] || '25493408-98b3-4342-a1ac-036ba49f97ee';

// AVE API配置
const config = require(path.join(projectRoot, 'config/default.json'));
const baseURL = config.ave?.apiUrl || 'https://prod.ave-api.com';
const aveAPI = new AveTokenAPI(baseURL, 30000, process.env.AVE_API_KEY);

// 配置
const REQUEST_DELAY = 1000;  // API调用延迟（毫秒）
const MAX_VALID_FDV = 20000000;  // 20M以上认为是虚假数据

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
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 严格名称匹配判断
 */
function isSameName(name1, symbol1, name2, symbol2) {
  if (!name1 || !name2) return false;

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  // 规则1: name 完全相同
  if (n1 === n2) return true;

  // 规则2: name 互相包含（处理 "Leo" vs "Leo Token"）
  const shorter = n1.length < n2.length ? n1 : n2;
  const longer = n1.length < n2.length ? n2 : n1;

  if (longer.includes(shorter) && shorter.length >= 3) return true;

  return false;
}

/**
 * 解析FDV
 */
function parseFDV(fdvStr) {
  if (!fdvStr || fdvStr === '' || fdvStr === '0') return 0;
  const cleaned = String(fdvStr).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 获取最大FDV（过滤20M以上异常值）
 */
function getMaxFDV(tokens) {
  if (!tokens || tokens.length === 0) return 0;

  const fdvs = tokens
    .map(t => parseFDV(t.fdv))
    .filter(v => v > 0 && v <= MAX_VALID_FDV);

  return fdvs.length > 0 ? Math.max(...fdvs) : 0;
}

/**
 * 获取实验中已标注的代币列表
 */
async function getJudgedTokens(experimentId) {
  console.log(`\n📊 正在获取实验 ${experimentId} 中已标注的代币...`);

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

  // 筛选已标注的代币
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
 * 获取代币的首次已执行BUY信号时间
 */
async function getFirstExecutedBuyTime(experimentId, tokenAddress) {
  try {
    const result = await fetchAPI(`/api/experiment/${experimentId}/signals?tokenAddress=${tokenAddress}`);

    if (!result.success || !result.signals) {
      return null;
    }

    // 筛选已执行的BUY信号
    const executedBuySignals = result.signals
      .filter(s =>
        (s.signal_type === 'BUY' || s.action === 'buy') &&
        s.metadata?.execution_status === 'executed'
      )
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (executedBuySignals.length === 0) {
      return null;
    }

    const signal = executedBuySignals[0];
    return {
      signal_id: signal.id || null,
      created_at: signal.created_at,
      executed_at: signal.metadata?.executed_at || null,
      earlyTradesCheckTime: signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime || null
    };
  } catch (error) {
    console.error(`   ❌ 获取信号失败 ${tokenAddress}:`, error.message);
    return null;
  }
}

/**
 * 分析单个代币的同名代币情况（在购买时刻）
 */
async function analyzeSameNameTokensAtSignalTime(token, firstBuyTime) {
  const tokenAddress = token.token_address;
  const tokenSymbol = token.token_symbol;
  const tokenName = token.raw_api_data?.name || null;
  const signalTime = firstBuyTime.earlyTradesCheckTime;

  console.log(`\n   🔍 分析代币 ${tokenSymbol} (${tokenAddress.substring(0, 10)}...)`);
  console.log(`      购买时刻: ${new Date(signalTime * 1000).toLocaleString('zh-CN')}`);

  try {
    // 搜索同名代币
    const results = await aveAPI.searchTokens(tokenSymbol, 'bsc', 300, 'fdv');

    // 只保留在信号执行时间之前创建的
    const beforeSignal = results.filter(t => {
      const tLaunchAt = t.launch_at || t.created_at || 0;
      return tLaunchAt > 0 && tLaunchAt < signalTime;
    });

    // 排除自己
    const notSelf = beforeSignal.filter(t => t.token !== tokenAddress);

    // 严格名称匹配
    const strictSameName = notSelf.filter(t =>
      isSameName(tokenName, tokenSymbol, t.name, t.symbol)
    );

    console.log(`      ✅ 同名代币: ${strictSameName.length} 个 (搜索结果: ${results.length}, 购买前: ${beforeSignal.length})`);

    return {
      token_address: tokenAddress,
      token_symbol: tokenSymbol,
      quality_category: token.human_judges.category,
      signal_time: signalTime,
      signal_created_at: firstBuyTime.created_at,
      search_result_count: results.length,
      before_signal_count: beforeSignal.length,
      strict_same_name_count: strictSameName.length,
      max_fdv: getMaxFDV(strictSameName),
      same_name_tokens: strictSameName.map(t => ({
        token: t.token,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain,
        fdv: t.fdv,
        launch_at: t.launch_at || t.created_at
      }))
    };

  } catch (error) {
    console.error(`   ❌ 同名代币分析失败 ${tokenAddress}:`, error.message);
    return {
      token_address: tokenAddress,
      token_symbol: tokenSymbol,
      quality_category: token.human_judges.category,
      signal_time: signalTime,
      signal_created_at: firstBuyTime.created_at,
      search_result_count: 0,
      before_signal_count: 0,
      strict_same_name_count: -1,
      max_fdv: 0,
      error: error.message
    };
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
    if (token.strict_same_name_count >= 0) {
      byQuality[token.quality_category].push(token);
    }
  });

  // 计算每组统计
  const summary = {};

  for (const [quality, tokens] of Object.entries(byQuality)) {
    if (tokens.length === 0) {
      summary[quality] = {
        count: 0,
        stats: null
      };
      continue;
    }

    // 计算统计
    const sameNameCounts = tokens.map(t => t.strict_same_name_count || 0);
    const maxFDVs = tokens.map(t => t.max_fdv || 0);

    sameNameCounts.sort((a, b) => a - b);
    maxFDVs.sort((a, b) => a - b);

    const avgSameName = sameNameCounts.reduce((a, b) => a + b, 0) / sameNameCounts.length;
    const medianSameName = sameNameCounts[Math.floor(sameNameCounts.length / 2)];

    const avgMaxFDV = maxFDVs.reduce((a, b) => a + b, 0) / maxFDVs.length;
    const medianMaxFDV = maxFDVs[Math.floor(maxFDVs.length / 2)];

    const above50K = maxFDVs.filter(v => v >= 50000).length;
    const above100K = maxFDVs.filter(v => v >= 100000).length;
    const above1M = maxFDVs.filter(v => v >= 1000000).length;

    summary[quality] = {
      count: tokens.length,
      stats: {
        same_name_count: { avg: avgSameName, median: medianSameName, min: sameNameCounts[0], max: sameNameCounts[sameNameCounts.length - 1] },
        max_fdv: { avg: avgMaxFDV, median: medianMaxFDV, min: maxFDVs[0], max: maxFDVs[maxFDVs.length - 1] },
        above_50k_count: above50K,
        above_50k_percent: (above50K / tokens.length * 100).toFixed(1),
        above_100k_count: above100K,
        above_100k_percent: (above100K / tokens.length * 100).toFixed(1),
        above_1m_count: above1M,
        above_1m_percent: (above1M / tokens.length * 100).toFixed(1)
      }
    };
  }

  return summary;
}

/**
 * 打印分析报告
 */
function printReport(analyzedTokens, summary) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 购买时刻同名代币分析报告');
  console.log('='.repeat(70));

  console.log('\n📈 按质量分组统计:');
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
    console.log(`\n${qualityLabels[quality]} (样本数: ${data.count})`);

    if (data.count === 0) {
      console.log('   无数据');
      return;
    }

    const s = data.stats;
    console.log(`   同名代币数:    平均 ${s.same_name_count.avg.toFixed(1)}, 中位数 ${s.same_name_count.median}`);
    console.log(`   Max FDV:       平均 $${(s.max_fdv.avg / 1e6).toFixed(2)}M, 中位数 $${(s.max_fdv.median / 1e6).toFixed(2)}M`);
    console.log(`   >50K:          ${s.above_50k_count}个 (${s.above_50k_percent}%)`);
    console.log(`   >100K:         ${s.above_100k_count}个 (${s.above_100k_percent}%)`);
    console.log(`   >1M:           ${s.above_1m_count}个 (${s.above_1m_percent}%)`);
  });

  // 特征区分度分析
  console.log('\n\n📊 特征区分度分析:');
  console.log('-'.repeat(70));

  if (summary.high_quality.count > 0 && summary.low_quality.count > 0) {
    const high = summary.high_quality.stats;
    const low = summary.low_quality.stats;

    console.log('\n高质量 vs 低质量:');

    console.log(`   同名代币数:    高 ${high.same_name_count.median.toFixed(1)} vs 低 ${low.same_name_count.median.toFixed(1)}`);
    console.log(`   Max FDV:       高 $${(high.max_fdv.median / 1e6).toFixed(2)}M vs 低 $${(low.max_fdv.median / 1e6).toFixed(2)}M`);
    console.log(`   >50K比例:      高 ${high.above_50k_percent}% vs 低 ${low.above_50k_percent}%`);
  } else {
    console.log('   样本不足，无法对比');
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 购买时刻同名代币分析');
  console.log(`实验ID: ${EXPERIMENT_ID}`);
  console.log(`API地址: ${API_BASE}`);

  try {
    // 1. 获取已标注的代币
    const judgedTokens = await getJudgedTokens(EXPERIMENT_ID);

    if (judgedTokens.length === 0) {
      console.log('❌ 没有找到已标注的代币');
      return;
    }

    // 2. 获取每个代币的首次已执行BUY信号时间
    console.log('\n⏰ 正在获取首次购买时间...');
    const tokensWithBuyTime = [];

    for (let i = 0; i < judgedTokens.length; i++) {
      const token = judgedTokens[i];
      process.stdout.write(`   处理中... ${i + 1}/${judgedTokens.length}\r`);

      const firstBuyTime = await getFirstExecutedBuyTime(EXPERIMENT_ID, token.token_address);

      if (firstBuyTime && firstBuyTime.earlyTradesCheckTime) {
        tokensWithBuyTime.push({
          ...token,
          first_buy_time: firstBuyTime
        });
      }

      if (i < judgedTokens.length - 1) {
        await sleep(REQUEST_DELAY);
      }
    }

    console.log(`\n   ✅ 有已执行购买信号的代币: ${tokensWithBuyTime.length}/${judgedTokens.length}`);

    if (tokensWithBuyTime.length === 0) {
      console.log('❌ 没有找到已执行的购买信号');
      return;
    }

    // 3. 同名代币搜索和分析
    console.log('\n🔍 正在进行同名代币搜索和分析...');
    const analyzedTokens = [];

    for (let i = 0; i < tokensWithBuyTime.length; i++) {
      const token = tokensWithBuyTime[i];

      const result = await analyzeSameNameTokensAtSignalTime(token, token.first_buy_time);
      analyzedTokens.push(result);

      if (i < tokensWithBuyTime.length - 1) {
        await sleep(REQUEST_DELAY);
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
      analysis_type: 'signal_time_analysis',
      analysis_timestamp: new Date().toISOString(),
      total_judged_tokens: judgedTokens.length,
      tokens_with_executed_signal: tokensWithBuyTime.length,
      tokens_analyzed: analyzedTokens.length,
      summary_by_quality: summary,
      detailed_results: analyzedTokens
    };

    const outputFile = path.join(__dirname, `signal_time_analysis_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`);
    require('fs').writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
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
