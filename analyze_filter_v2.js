const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 更精确的过滤规则
const FILTER_RULES = {
  // 1. 自动追踪机器人（完全匹配或高度相似）
  trackingBotPatterns: [
    /2\s+tracking\s+addresses?\s+bought\s+this\s+token/i,
    /2\s+个追踪地址\s+已购买/i,
    /2\s+个追踪地址已购买/i,
    /tracking\s+addresses?\s+bought/i
  ],

  // 2. ⚠️诈骗警告（同一账号大量重复）
  scamWarningPatterns: [
    /⚠️诈骗.*他们拥有工具.*实时看到.*外部钱包/i,
    /诈骗.*拥有工具.*实时.*外部钱包.*买入/i
  ],

  // 3. 格式化推广推文（Quick Swap, Check Chart等）
  formattedPromoPatterns: [
    /🔗\s*Quick\s+Swap|Quick\s+Swap.*🔗/i,
    /Check\s+Chart\s*-\s*Signal/i,
    /⚡️\s*Quick\s+Buy|Quick\s+Buy.*⚡️/i,
    /Progress.*Holders.*FDV/i
  ],

  // 4. 推广账号黑名单
  spamAccounts: [
    'BscPulseAlerts',
    'LAOWAI6654088'
  ],

  // 5. 重复推文检测（后续在代码中实现）
  enableDeduplication: true
};

/**
 * 检查推文是否应该被过滤
 */
function shouldFilterTweet(tweet, tweetTextSet = new Set()) {
  const text = tweet.text || '';
  const username = tweet.user?.screen_name || '';

  // 规则1: 推广账号黑名单
  if (FILTER_RULES.spamAccounts.includes(username)) {
    return { filtered: true, reason: 'spam_account', account: username };
  }

  // 规则2: 自动追踪机器人
  for (const pattern of FILTER_RULES.trackingBotPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'tracking_bot', pattern: pattern.source };
    }
  }

  // 规则3: 诈骗警告
  for (const pattern of FILTER_RULES.scamWarningPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'scam_warning', pattern: pattern.source };
    }
  }

  // 规则4: 格式化推广推文
  for (const pattern of FILTER_RULES.formattedPromoPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'formatted_promo', pattern: pattern.source };
    }
  }

  // 规则5: 重复推文检测（跨代币去重）
  if (FILTER_RULES.enableDeduplication) {
    const normalizedText = text.toLowerCase().trim();
    if (tweetTextSet.has(normalizedText)) {
      return { filtered: true, reason: 'duplicate', text: text.substring(0, 50) };
    }
  }

  return { filtered: false };
}

/**
 * 从推文中提取因子
 */
function extractFactors(tweets) {
  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  let totalFollowers = 0;
  const verifiedUsers = new Set();
  const uniqueUsers = new Set();

  tweets.forEach(tweet => {
    totalLikes += tweet.metrics?.favorite_count || 0;
    totalRetweets += tweet.metrics?.retweet_count || 0;
    totalReplies += tweet.metrics?.reply_count || 0;

    if (tweet.user) {
      totalFollowers += tweet.user.followers_count || 0;
      uniqueUsers.add(tweet.user.screen_name);
      if (tweet.user.verified) {
        verifiedUsers.add(tweet.user.screen_name);
      }
    }
  });

  const totalEngagement = totalLikes + totalRetweets + totalReplies;
  const avgEngagement = tweets.length > 0 ? totalEngagement / tweets.length : 0;
  const qualityTweetsCount = tweets.filter(t => (t.metrics?.total_engagement || 0) > 4).length;

  return {
    totalResults: tweets.length,
    qualityTweets: qualityTweetsCount,
    likes: totalLikes,
    retweets: totalRetweets,
    comments: totalReplies,
    totalEngagement: totalEngagement,
    avgEngagement: Math.round(avgEngagement),
    verifiedUsers: verifiedUsers.size,
    followers: totalFollowers,
    uniqueUsers: uniqueUsers.size
  };
}

/**
 * 计算相关系数
 */
function calculateCorrelation(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den !== 0 ? num / den : 0;
}

async function analyzeAndFilter() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  console.log(`找到有人工标注的代币: ${tokens.length} 个\n`);

  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取这些代币的信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  console.log(`找到相关信号: ${signals?.length || 0} 条\n`);

  // 用于跨代币去重的全局推文集合
  const globalTweetTextSet = new Set();

  // 分析数据
  const results = [];
  let totalTweets = 0;
  let filteredTweets = 0;

  const filterStats = {
    spam_account: 0,
    tracking_bot: 0,
    scam_warning: 0,
    formatted_promo: 0,
    duplicate: 0
  };

  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokens.find(t => t.token_address === signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    // 获取所有推文
    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const allTweets = [...qualityTweets, ...lowQualityTweets];

    if (allTweets.length === 0) continue;

    totalTweets += allTweets.length;

    // 过滤推文
    const filteredTweetsList = [];
    const keepTweetsList = [];

    for (const tweet of allTweets) {
      const filterResult = shouldFilterTweet(tweet, globalTweetTextSet);

      // 如果没有被过滤，添加到全局集合（用于后续去重）
      if (!filterResult.filtered) {
        globalTweetTextSet.add(tweet.text.toLowerCase().trim());
        keepTweetsList.push(tweet);
      } else {
        filteredTweetsList.push({ tweet, reason: filterResult.reason });
        if (filterStats[filterResult.reason] !== undefined) {
          filterStats[filterResult.reason]++;
        }
      }
    }

    filteredTweets += filteredTweetsList.length;

    // 计算过滤前后的因子
    const originalFactors = extractFactors(allTweets);
    const filteredFactors = extractFactors(keepTweetsList);

    results.push({
      tokenSymbol: signal.token_symbol,
      quality: category,
      totalTweets: allTweets.length,
      filteredCount: filteredTweetsList.length,
      keepCount: keepTweetsList.length,
      originalFactors,
      filteredFactors,
      filteredTweetsList
    });
  }

  console.log('='.repeat(100));
  console.log('过滤统计');
  console.log('='.repeat(100));
  console.log(`总推文数: ${totalTweets}`);
  console.log(`过滤推文数: ${filteredTweets} (${(filteredTweets/totalTweets*100).toFixed(1)}%)`);
  console.log(`保留推文数: ${totalTweets - filteredTweets} (${((totalTweets-filteredTweets)/totalTweets*100).toFixed(1)}%)`);
  console.log('\n过滤原因分布:');
  for (const [reason, count] of Object.entries(filterStats)) {
    console.log(`  ${reason}: ${count} (${(count/filteredTweets*100).toFixed(1)}%)`);
  }

  // 按质量分组统计
  console.log('\n' + '='.repeat(100));
  console.log('按质量分组的过滤效果');
  console.log('='.repeat(100));

  const byQuality = { low_quality: [], mid_quality: [], high_quality: [] };
  for (const r of results) {
    if (byQuality[r.quality]) {
      byQuality[r.quality].push(r);
    }
  }

  for (const [quality, items] of Object.entries(byQuality)) {
    if (items.length === 0) continue;

    const totalTweetsByQuality = items.reduce((sum, r) => sum + r.totalTweets, 0);
    const filteredByQuality = items.reduce((sum, r) => sum + r.filteredCount, 0);
    const originalFollowers = items.reduce((sum, r) => sum + r.originalFactors.followers, 0);
    const filteredFollowers = items.reduce((sum, r) => sum + r.filteredFactors.followers, 0);
    const originalLikes = items.reduce((sum, r) => sum + r.originalFactors.likes, 0);
    const filteredLikes = items.reduce((sum, r) => sum + r.filteredFactors.likes, 0);

    console.log(`\n【${quality}】(${items.length} 个代币, ${totalTweetsByQuality} 条推文)`);
    console.log(`  过滤前: 总粉丝=${originalFollowers}, 总点赞=${originalLikes}`);
    console.log(`  过滤后: 总粉丝=${filteredFollowers}, 总点赞=${filteredLikes}`);
    console.log(`  过滤率: ${(filteredByQuality/totalTweetsByQuality*100).toFixed(1)}%`);
  }

  // 相关性分析
  console.log('\n' + '='.repeat(100));
  console.log('相关性分析（过滤前 vs 过滤后）');
  console.log('='.repeat(100));

  const qualityNumeric = { 'low_quality': 1, 'mid_quality': 2, 'high_quality': 3 };

  const factors = ['followers', 'likes', 'totalResults'];

  for (const factor of factors) {
    // 过滤前
    const x = results.map(r => qualityNumeric[r.quality] || 0);
    const yOriginal = results.map(r => r.originalFactors[factor]);
    const corrOriginal = calculateCorrelation(x, yOriginal);

    // 过滤后
    const yFiltered = results.map(r => r.filteredFactors[factor]);
    const corrFiltered = calculateCorrelation(x, yFiltered);

    console.log(`\n${factor}:`);
    console.log(`  过滤前相关系数: ${corrOriginal.toFixed(4)}`);
    console.log(`  过滤后相关系数: ${corrFiltered.toFixed(4)}`);
    console.log(`  变化: ${(corrFiltered - corrOriginal > 0 ? '+' : '')}${(corrFiltered - corrOriginal).toFixed(4)}`);
  }

  // 显示被过滤的推文样本
  console.log('\n' + '='.repeat(100));
  console.log('被过滤的推文样本（按原因分组）');
  console.log('='.repeat(100));

  const allFilteredByReason = {};
  for (const r of results) {
    for (const item of r.filteredTweetsList) {
      if (!allFilteredByReason[item.reason]) allFilteredByReason[item.reason] = [];
      allFilteredByReason[item.reason].push(item.tweet);
    }
  }

  for (const [reason, tweets] of Object.entries(allFilteredByReason)) {
    console.log(`\n${reason} (${tweets.length} 条):`);
    tweets.slice(0, 5).forEach(tweet => {
      const preview = tweet.text?.substring(0, 80) || '(无text)';
      console.log(`  - ${preview}${tweet.text?.length > 80 ? '...' : ''}`);
    });
    if (tweets.length > 5) {
      console.log(`  ... 还有 ${tweets.length - 5} 条`);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('结论');
  console.log('='.repeat(100));
  console.log('1. 过滤了约 ' + (filteredTweets/totalTweets*100).toFixed(1) + '% 的推文');
  console.log('2. 主要过滤原因: ' + Object.entries(filterStats).sort((a,b) => b[1] - a[1])[0][0]);
  console.log('3. 过滤后样本量: ' + (totalTweets - filteredTweets) + ' 条推文');
  console.log('4. 建议: 样本量仍然较小（<100），需要收集更多数据以提高统计显著性');
}

analyzeAndFilter().catch(console.error);
