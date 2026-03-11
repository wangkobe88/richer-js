#!/usr/bin/env node

/**
 * Twitter数据与代币质量关联分析
 *
 * 分析目标：
 * 1. 获取实验中已人工标注的代币
 * 2. 获取每个代币的首次已执行BUY信号时间
 * 3. 对代币地址进行Twitter搜索
 * 4. 过滤获取购买前的推文数据
 * 5. 统计各质量组的Twitter特征差异
 */

const twitterValidation = require('../../src/utils/twitter-validation');

// API配置
const API_BASE = 'http://localhost:3010';
const EXPERIMENT_ID = process.argv[2] || '25493408-98b3-4342-a1ac-036ba49f97ee';

// 缓存和限流配置
const REQUEST_DELAY = 1000; // 请求间隔1秒
let requestCount = 0;
const MAX_REQUESTS_PER_HOUR = 500;

/**
 * HTTP请求辅助函数
 */
async function fetchAPI(endpoint) {
  // 限流检查
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
 * 分析单个代币的Twitter数据（购买前）
 */
async function analyzeTokenTwitterBeforeBuy(token, firstBuyTime) {
  const tokenAddress = token.token_address;
  console.log(`\n   🔍 分析代币 ${token.token_symbol} (${tokenAddress.substring(0, 10)}...)`);

  try {
    // Twitter搜索代币地址
    const validationResult = await twitterValidation.validateTokenOnTwitter(tokenAddress, {
      minTweetCount: 0,  // 不限制最小数量
      maxRetries: 2,
      timeout: 30000
    });

    if (!validationResult.relevant_tweets || validationResult.relevant_tweets.length === 0) {
      return {
        token_address: tokenAddress,
        token_symbol: token.token_symbol,
        quality_category: token.human_judges.category,
        first_buy_time: firstBuyTime.created_at,
        twitter_before_buy: {
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
        }
      };
    }

    // 过滤购买前的推文
    const buyTime = new Date(firstBuyTime.created_at);
    const tweetsBeforeBuy = validationResult.relevant_tweets.filter(tweet => {
      const tweetTime = new Date(tweet.created_at);
      return tweetTime < buyTime;
    });

    // 计算统计特征
    const stats = calculateTweetStats(tweetsBeforeBuy);

    console.log(`      ✅ 找到 ${tweetsBeforeBuy.length} 条购买前推文 (总计 ${validationResult.relevant_tweets.length} 条)`);
    console.log(`      📊 总互动: ${stats.total_engagement}, 认证用户: ${stats.verified_users}`);

    return {
      token_address: tokenAddress,
      token_symbol: token.token_symbol,
      quality_category: token.human_judges.category,
      first_buy_time: firstBuyTime.created_at,
      twitter_before_buy: stats
    };

  } catch (error) {
    console.error(`   ❌ Twitter分析失败 ${tokenAddress}:`, error.message);
    return {
      token_address: tokenAddress,
      token_symbol: token.token_symbol,
      quality_category: token.human_judges.category,
      first_buy_time: firstBuyTime.created_at,
      twitter_before_buy: null,
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
    if (token.twitter_before_buy) {
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

    // 计算中位数和平均值
    const metrics = [
      'tweets_count',
      'total_engagement',
      'avg_engagement',
      'verified_users',
      'total_followers',
      'unique_users',
      'time_span_hours'
    ];

    const stats = {};

    metrics.forEach(metric => {
      const values = tokens.map(t => t.twitter_before_buy[metric] || 0);
      values.sort((a, b) => a - b);

      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const median = values[Math.floor(values.length / 2)];
      const max = values[values.length - 1];
      const min = values[0];

      stats[metric] = { avg, median, min, max };
    });

    summary[quality] = {
      count: tokens.length,
      stats
    };
  }

  return summary;
}

/**
 * 打印分析报告
 */
function printReport(analyzedTokens, summary) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 Twitter数据与代币质量关联分析报告');
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
    console.log(`   推文数量:      平均 ${s.tweets_count.avg.toFixed(1)}, 中位数 ${s.tweets_count.median}`);
    console.log(`   总互动数:      平均 ${s.total_engagement.avg.toFixed(0)}, 中位数 ${s.total_engagement.median}`);
    console.log(`   平均互动:      平均 ${s.avg_engagement.avg.toFixed(1)}, 中位数 ${s.avg_engagement.median}`);
    console.log(`   认证用户数:    平均 ${s.verified_users.avg.toFixed(1)}, 中位数 ${s.verified_users.median}`);
    console.log(`   粉丝总数:      平均 ${s.total_followers.avg.toFixed(0)}, 中位数 ${s.total_followers.median}`);
    console.log(`   独立用户数:    平均 ${s.unique_users.avg.toFixed(1)}, 中位数 ${s.unique_users.median}`);
  });

  // 特征区分度分析
  console.log('\n\n📊 特征区分度分析:');
  console.log('-'.repeat(70));

  if (summary.high_quality.count > 0 && summary.low_quality.count > 0) {
    const high = summary.high_quality.stats;
    const low = summary.low_quality.stats;

    console.log('\n高质量 vs 低质量 (倍数关系):');

    const metrics = [
      { name: '推文数量', key: 'tweets_count' },
      { name: '总互动数', key: 'total_engagement' },
      { name: '平均互动', key: 'avg_engagement' },
      { name: '认证用户', key: 'verified_users' },
      { name: '粉丝总数', key: 'total_followers' }
    ];

    metrics.forEach(m => {
      const highMedian = high[m.key].median;
      const lowMedian = low[m.key].median;
      const ratio = lowMedian > 0 ? (highMedian / lowMedian).toFixed(2) : '∞';
      console.log(`   ${m.name.padEnd(12)}: 高 ${highMedian} vs 低 ${lowMedian} (倍数: ${ratio})`);
    });
  } else {
    console.log('   样本不足，无法对比');
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🐦 Twitter数据与代币质量关联分析');
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

    // 3. Twitter搜索和分析
    console.log('\n🔍 正在进行Twitter搜索和分析...');
    const analyzedTokens = [];

    for (let i = 0; i < tokensWithBuyTime.length; i++) {
      const token = tokensWithBuyTime[i];

      const result = await analyzeTokenTwitterBeforeBuy(token, token.first_buy_time);
      analyzedTokens.push(result);

      if (i < tokensWithBuyTime.length - 1) {
        await sleep(REQUEST_DELAY * 2); // Twitter API需要更长延时
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
      total_judged_tokens: judgedTokens.length,
      tokens_with_buy_signal: tokensWithBuyTime.length,
      tokens_analyzed: analyzedTokens.length,
      summary_by_quality: summary,
      detailed_results: analyzedTokens
    };

    const outputFile = `twitter_quality_analysis_${EXPERIMENT_ID.substring(0, 8)}_${Date.now()}.json`;
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
