#!/usr/bin/env node

/**
 * Twitter数据与代币质量关联分析 - 对比版本
 *
 * 分析目标：
 * 1. 获取实验中已人工标注的代币
 * 2. 获取每个代币的首次已执行BUY信号时间
 * 3. 对代币地址进行Twitter搜索
 * 4. 统计两种模式的Twitter特征差异：
 *    - 模式A: 仅统计购买前的推文
 *    - 模式B: 统计所有推文
 * 5. 对比两种模式的区分度
 */

const twitterValidation = require('../../src/utils/twitter-validation');

// API配置
const API_BASE = 'http://localhost:3010';
const EXPERIMENT_ID = process.argv[2] || '25493408-98b3-4342-a1ac-036ba49f97ee';

// 缓存和限流配置
const REQUEST_DELAY = 1000;
let requestCount = 0;
const MAX_REQUESTS_PER_HOUR = 500;

/**
 * HTTP请求辅助函数
 */
async function fetchAPI(endpoint) {
  if (requestCount >= MAX_REQUESTS_PER_HOUR) {
    throw new Error('达到API请求限制，请稍后重试');
  }

  requestCount++;
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
 * 获取实验中已标注的代币列表
 */
async function getJudgedTokens(experimentId) {
  console.log(`\n📊 正在获取实验 ${experimentId} 中已标注的代币...`);

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

  const judgedTokens = allTokens.filter(t => t.human_judges != null);

  console.log(`   总代币数: ${allTokens.length}`);
  console.log(`   已标注数: ${judgedTokens.length}`);

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

    const executedBuySignals = result.signals
      .filter(s =>
        (s.signal_type === 'BUY' || s.action === 'buy') &&
        s.metadata?.execution_status === 'executed'
      )
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (executedBuySignals.length === 0) {
      return null;
    }

    return {
      signal_id: executedBuySignals[0].id || null,
      created_at: executedBuySignals[0].created_at,
      executed_at: executedBuySignals[0].metadata?.executed_at || null
    };
  } catch (error) {
    console.error(`   ❌ 获取信号失败 ${tokenAddress}:`, error.message);
    return null;
  }
}

/**
 * 分析单个代币的Twitter数据（双模式对比）
 */
async function analyzeTokenTwitterCompare(token, firstBuyTime) {
  const tokenAddress = token.token_address;
  console.log(`\n   🔍 分析代币 ${token.token_symbol} (${tokenAddress.substring(0, 10)}...)`);

  try {
    // Twitter搜索代币地址
    const validationResult = await twitterValidation.validateTokenOnTwitter(tokenAddress, {
      minTweetCount: 0,
      maxRetries: 2,
      timeout: 30000
    });

    const emptyStats = {
      tweets_count: 0,
      total_likes: 0,
      total_retweets: 0,
      total_replies: 0,
      total_engagement: 0,
      avg_engagement: 0,
      verified_users: 0,
      total_followers: 0,
      unique_users: 0,
      first_tweet_at: null,
      last_tweet_at: null,
      time_span_hours: 0
    };

    // 获取所有推文（包括高质量和低质量）
    const qualityTweets = validationResult.analysis_details?.quality_tweets || [];
    const lowQualityTweets = validationResult.analysis_details?.low_quality_tweets || [];
    const allTweetsFromSearch = [...qualityTweets, ...lowQualityTweets];

    if (allTweetsFromSearch.length === 0) {
      return {
        token_address: tokenAddress,
        token_symbol: token.token_symbol,
        quality_category: token.human_judges.category,
        first_buy_time: firstBuyTime.created_at,
        twitter_before_buy: emptyStats,
        twitter_all: emptyStats
      };
    }

    // 模式A: 过滤购买前的推文
    const buyTime = new Date(firstBuyTime.created_at);
    const tweetsBeforeBuy = allTweetsFromSearch.filter(tweet => {
      const tweetTime = new Date(tweet.created_at);
      return tweetTime < buyTime;
    });

    // 模式B: 所有推文
    const allTweets = allTweetsFromSearch;

    // 计算两种模式的统计特征
    const statsBeforeBuy = calculateTweetStats(tweetsBeforeBuy);
    const statsAll = calculateTweetStats(allTweets);

    console.log(`      ✅ 购买前: ${tweetsBeforeBuy.length} 条推文 | 全部: ${allTweets.length} 条推文`);
    console.log(`      📊 购买前互动: ${statsBeforeBuy.total_engagement} | 全部互动: ${statsAll.total_engagement}`);

    return {
      token_address: tokenAddress,
      token_symbol: token.token_symbol,
      quality_category: token.human_judges.category,
      first_buy_time: firstBuyTime.created_at,
      twitter_before_buy: statsBeforeBuy,
      twitter_all: statsAll
    };

  } catch (error) {
    console.error(`   ❌ Twitter分析失败 ${tokenAddress}:`, error.message);
    return {
      token_address: tokenAddress,
      token_symbol: token.token_symbol,
      quality_category: token.human_judges.category,
      first_buy_time: firstBuyTime.created_at,
      twitter_before_buy: null,
      twitter_all: null,
      error: error.message
    };
  }
}

/**
 * 计算推文统计特征
 */
function calculateTweetStats(tweets) {
  if (!tweets || tweets.length === 0) {
    return {
      tweets_count: 0,
      total_likes: 0,
      total_retweets: 0,
      total_replies: 0,
      total_engagement: 0,
      avg_engagement: 0,
      verified_users: 0,
      total_followers: 0,
      unique_users: 0,
      first_tweet_at: null,
      last_tweet_at: null,
      time_span_hours: 0
    };
  }

  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  let totalFollowers = 0;
  const verifiedUsers = new Set();
  const uniqueUsers = new Set();
  let firstTweetTime = null;
  let lastTweetTime = null;

  tweets.forEach(tweet => {
    totalLikes += tweet.metrics?.favorite_count || 0;
    totalRetweets += tweet.metrics?.retweet_count || 0;
    totalReplies += tweet.metrics?.reply_count || 0;

    if (tweet.user) {
      totalFollowers += tweet.user.followers_count || 0;
      if (tweet.user.verified) {
        verifiedUsers.add(tweet.user.screen_name);
      }
      uniqueUsers.add(tweet.user.screen_name);
    }

    const tweetTime = new Date(tweet.created_at);
    if (!firstTweetTime || tweetTime < firstTweetTime) {
      firstTweetTime = tweetTime;
    }
    if (!lastTweetTime || tweetTime > lastTweetTime) {
      lastTweetTime = tweetTime;
    }
  });

  const totalEngagement = totalLikes + totalRetweets + totalReplies;
  const timeSpanHours = firstTweetTime && lastTweetTime
    ? (lastTweetTime - firstTweetTime) / (1000 * 60 * 60)
    : 0;

  return {
    tweets_count: tweets.length,
    total_likes: totalLikes,
    total_retweets: totalRetweets,
    total_replies: totalReplies,
    total_engagement: totalEngagement,
    avg_engagement: tweets.length > 0 ? Math.round(totalEngagement / tweets.length) : 0,
    verified_users: verifiedUsers.size,
    total_followers: totalFollowers,
    unique_users: uniqueUsers.size,
    first_tweet_at: firstTweetTime ? firstTweetTime.toISOString() : null,
    last_tweet_at: lastTweetTime ? lastTweetTime.toISOString() : null,
    time_span_hours: Math.round(timeSpanHours * 100) / 100
  };
}

/**
 * 按质量和模式分组统计
 */
function summarizeByQualityAndMode(analyzedTokens) {
  const byQuality = {
    fake_pump: [],
    no_user: [],
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  // 分组
  analyzedTokens.forEach(token => {
    if (token.twitter_before_buy !== null) {
      byQuality[token.quality_category].push(token);
    }
  });

  // 计算每组统计（两种模式）
  const summary = {};

  for (const [quality, tokens] of Object.entries(byQuality)) {
    if (tokens.length === 0) {
      summary[quality] = {
        count: 0,
        before_buy: null,
        all: null
      };
      continue;
    }

    // 计算中位数和平均值
    const metrics = [
      'tweets_count',
      'total_engagement',
      'avg_engagement',
      'verified_users',
      'total_followers',
      'unique_users'
    ];

    const beforeBuyStats = {};
    const allStats = {};

    metrics.forEach(metric => {
      const beforeValues = tokens.map(t => t.twitter_before_buy[metric] || 0);
      const allValues = tokens.map(t => t.twitter_all[metric] || 0);

      beforeValues.sort((a, b) => a - b);
      allValues.sort((a, b) => a - b);

      const beforeSum = beforeValues.reduce((a, b) => a + b, 0);
      const allSum = allValues.reduce((a, b) => a + b, 0);

      beforeBuyStats[metric] = {
        avg: beforeSum / beforeValues.length,
        median: beforeValues[Math.floor(beforeValues.length / 2)],
        max: beforeValues[beforeValues.length - 1],
        min: beforeValues[0]
      };

      allStats[metric] = {
        avg: allSum / allValues.length,
        median: allValues[Math.floor(allValues.length / 2)],
        max: allValues[allValues.length - 1],
        min: allValues[0]
      };
    });

    summary[quality] = {
      count: tokens.length,
      before_buy: beforeBuyStats,
      all: allStats
    };
  }

  return summary;
}

/**
 * 打印对比分析报告
 */
function printComparisonReport(analyzedTokens, summary) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 Twitter数据与代币质量关联分析 - 双模式对比报告');
  console.log('='.repeat(80));

  console.log('\n模式说明:');
  console.log('  [模式A: 购买前] 仅统计首次已执行BUY信号之前的推文');
  console.log('  [模式B: 全部]   统计所有相关推文');

  const qualityLabels = {
    fake_pump: '🎭 流水盘 (fake_pump)',
    no_user: '👻 无人玩 (no_user)',
    low_quality: '📉 低质量 (low_quality)',
    mid_quality: '📊 中质量 (mid_quality)',
    high_quality: '🚀 高质量 (high_quality)'
  };

  const qualityOrder = ['high_quality', 'mid_quality', 'low_quality', 'no_user', 'fake_pump'];

  // 1. 各质量组数据对比
  console.log('\n\n📈 各质量组数据对比:');
  console.log('-'.repeat(80));

  qualityOrder.forEach(quality => {
    const data = summary[quality];
    console.log(`\n${qualityLabels[quality]} (样本数: ${data.count})`);

    if (data.count === 0) {
      console.log('   无数据');
      return;
    }

    const b = data.before_buy;
    const a = data.all;

    const headerA = '购买前(A)';
    const headerB = '全部(B)';
    const headerDiff = '差异(B-A)';
    const headerGrowth = '增长%';
    console.log(`   ${'指标'.padEnd(14)} ${headerA.padEnd(18)} ${headerB.padEnd(18)} ${headerDiff.padEnd(15)} ${headerGrowth.padEnd(10)}`);
    console.log('   '.padEnd(14, '-') + ' '.padEnd(18, '-') + ' '.padEnd(18, '-') + ' '.padEnd(15, '-') + ' '.padEnd(10, '-'));

    const metrics = [
      { name: '推文数量', key: 'tweets_count', isFloat: false },
      { name: '总互动数', key: 'total_engagement', isFloat: false },
      { name: '平均互动', key: 'avg_engagement', isFloat: true },
      { name: '认证用户', key: 'verified_users', isFloat: false },
      { name: '粉丝总数', key: 'total_followers', isFloat: false },
      { name: '独立用户', key: 'unique_users', isFloat: false }
    ];

    metrics.forEach(m => {
      const beforeVal = b[m.key].median;
      const allVal = a[m.key].median;
      const diff = allVal - beforeVal;
      const growth = beforeVal > 0 ? ((allVal - beforeVal) / beforeVal * 100).toFixed(0) + '%' : '∞';

      const beforeStr = m.isFloat ? beforeVal.toFixed(1) : beforeVal.toString();
      const allStr = m.isFloat ? allVal.toFixed(1) : allVal.toString();
      const diffStr = (diff >= 0 ? '+' : '') + (m.isFloat ? diff.toFixed(1) : diff.toString());

      console.log(`   ${m.name.padEnd(14)} ${beforeStr.padEnd(18)} ${allStr.padEnd(18)} ${diffStr.padEnd(15)} ${growth.padEnd(10)}`);
    });
  });

  // 2. 两种模式的区分度对比
  console.log('\n\n📊 区分度对比 (高质量 vs 低质量):');
  console.log('-'.repeat(80));

  if (summary.high_quality.count > 0 && summary.low_quality.count > 0) {
    const high = summary.high_quality;
    const low = summary.low_quality;
    const highB = high.before_buy;
    const lowB = low.before_buy;
    const highA = high.all;
    const lowA = low.all;

    console.log('\n' + '   '.padEnd(14) + '购买前模式'.padEnd(40) + '全部模式'.padEnd(30));
    console.log('   '.padEnd(14, '-') + ' '.padEnd(40, '-') + ' '.padEnd(30, '-'));

    const metrics = [
      { name: '推文数量', key: 'tweets_count' },
      { name: '总互动数', key: 'total_engagement' },
      { name: '平均互动', key: 'avg_engagement' },
      { name: '认证用户', key: 'verified_users' },
      { name: '粉丝总数', key: 'total_followers' }
    ];

    metrics.forEach(m => {
      const beforeHigh = highB[m.key].median;
      const beforeLow = lowB[m.key].median;
      const beforeRatio = beforeLow > 0 ? (beforeHigh / beforeLow).toFixed(2) : '∞';

      const allHigh = highA[m.key].median;
      const allLow = lowA[m.key].median;
      const allRatio = allLow > 0 ? (allHigh / allLow).toFixed(2) : '∞';

      const beforeStr = `高${beforeHigh} vs 低${beforeLow} (倍数: ${beforeRatio})`;
      const allStr = `高${allHigh} vs 低${allLow} (倍数: ${allRatio})`;

      console.log(`   ${m.name.padEnd(14)} ${beforeStr.padEnd(40)} ${allStr.padEnd(30)}`);
    });

    // 区分度改善判断
    console.log('\n   区分度改善分析:');
    metrics.forEach(m => {
      const beforeHigh = highB[m.key].median;
      const beforeLow = lowB[m.key].median;
      const beforeGap = beforeLow > 0 ? Math.abs(beforeHigh - beforeLow) / beforeLow : 0;

      const allHigh = highA[m.key].median;
      const allLow = lowA[m.key].median;
      const allGap = allLow > 0 ? Math.abs(allHigh - allLow) / allLow : 0;

      const improvement = allGap - beforeGap;
      const status = improvement > 0.1 ? '✅ 改善' : (improvement < -0.1 ? '❌ 下降' : '➡️ 持平');

      console.log(`   ${m.name.padEnd(14)} ${status} (${improvement > 0 ? '+' : ''}${(improvement * 100).toFixed(1)}%)`);
    });

  } else {
    console.log('   样本不足，无法对比');
  }

  // 3. 推文覆盖率对比
  console.log('\n\n📊 推文覆盖率对比:');
  console.log('-'.repeat(80));

  qualityOrder.forEach(quality => {
    const tokens = analyzedTokens.filter(t => t.quality_category === quality && t.twitter_before_buy !== null);
    if (tokens.length === 0) return;

    const withTweetsBeforeBuy = tokens.filter(t => t.twitter_before_buy.tweets_count > 0).length;
    const withTweetsAll = tokens.filter(t => t.twitter_all.tweets_count > 0).length;

    const beforeBuyRate = (withTweetsBeforeBuy / tokens.length * 100).toFixed(0);
    const allRate = (withTweetsAll / tokens.length * 100).toFixed(0);

    console.log(`   ${qualityLabels[quality].padEnd(30)} 购买前: ${withTweetsBeforeBuy}/${tokens.length} (${beforeBuyRate}%) | 全部: ${withTweetsAll}/${tokens.length} (${allRate}%)`);
  });
}

/**
 * 主函数
 */
async function main() {
  console.log('🐦 Twitter数据与代币质量关联分析 - 双模式对比');
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

      if (firstBuyTime) {
        tokensWithBuyTime.push({
          ...token,
          first_buy_time: firstBuyTime
        });
      }

      if (i < judgedTokens.length - 1) {
        await sleep(REQUEST_DELAY);
      }
    }

    console.log(`\n   ✅ 有购买信号的代币: ${tokensWithBuyTime.length}/${judgedTokens.length}`);

    // 3. Twitter搜索和分析（双模式）
    console.log('\n🔍 正在进行Twitter搜索和分析...');
    const analyzedTokens = [];

    for (let i = 0; i < tokensWithBuyTime.length; i++) {
      const token = tokensWithBuyTime[i];

      const result = await analyzeTokenTwitterCompare(token, token.first_buy_time);
      analyzedTokens.push(result);

      if (i < tokensWithBuyTime.length - 1) {
        await sleep(REQUEST_DELAY * 2);
      }
    }

    // 4. 统计分析
    console.log('\n📊 正在进行统计分析...');
    const summary = summarizeByQualityAndMode(analyzedTokens);

    // 5. 打印报告
    printComparisonReport(analyzedTokens, summary);

    // 6. 保存结果
    const outputData = {
      experiment_id: EXPERIMENT_ID,
      analysis_timestamp: new Date().toISOString(),
      total_judged_tokens: judgedTokens.length,
      tokens_with_buy_signal: tokensWithBuyTime.length,
      tokens_analyzed: analyzedTokens.length,
      summary_by_quality: summary,
      detailed_results: analyzedTokens,
      analysis_mode: 'comparison'
    };

    const outputFile = `twitter_quality_analysis_compare_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`;
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
