const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 过滤规则配置
const FILTER_RULES = {
  // 1. 包含 "alert", "ALERT" 等报警关键词
  alertKeywords: [
    /alert/i, /pump/i, /pumping/i, /popped/i,
    /just.*popped/i, /is.*up/i, /🚀/, /⚠️/, /📈/
  ],

  // 2. 重复的推广模板
  templatePatterns: [
    /💥\s*Chain/i, /🎯\s*Symbol/i, /💰\s*MarketCap/i,
    /Quick Swap/i, /Just Popped/i, /New Listing/i,
    /🔥\s*🔥\s*🔥/  // 连续多个火emoji
  ],

  // 3. 特定的推广账号（可以后续添加）
  spamAccounts: [],

  // 4. 推文长度过短且包含多个emoji
  shortEmojiTweet: {
    minLength: 30,
    minEmojiCount: 3
  }
};

/**
 * 检查推文是否应该被过滤
 */
function shouldFilterTweet(tweet) {
  const text = tweet.text || '';

  // 规则1: 检查报警关键词
  for (const pattern of FILTER_RULES.alertKeywords) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'alert_keyword', pattern: pattern.source };
    }
  }

  // 规则2: 检查推广模板
  for (const pattern of FILTER_RULES.templatePatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'template_pattern', pattern: pattern.source };
    }
  }

  // 规则3: 检查垃圾账号
  const username = tweet.user?.screen_name || '';
  if (FILTER_RULES.spamAccounts.includes(username)) {
    return { filtered: true, reason: 'spam_account', account: username };
  }

  // 规则4: 检查短emoji推文
  if (text.length < FILTER_RULES.shortEmojiTweet.minLength) {
    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount >= FILTER_RULES.shortEmojiTweet.minEmojiCount) {
      return { filtered: true, reason: 'short_emoji', emojiCount };
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

  // 获取这些代币的信号（包含 twitter_search_result）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, twitter_search_result, metadata')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  console.log(`找到相关信号: ${signals?.length || 0} 条\n`);

  // 分析数据
  const results = [];
  let totalTweets = 0;
  let filteredTweets = 0;

  const filterStats = {
    alert_keyword: 0,
    template_pattern: 0,
    spam_account: 0,
    short_emoji: 0
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
      const filterResult = shouldFilterTweet(tweet);
      if (filterResult.filtered) {
        filteredTweetsList.push({ tweet, reason: filterResult.reason });
        if (filterStats[filterResult.reason] !== undefined) {
          filterStats[filterResult.reason]++;
        }
      } else {
        keepTweetsList.push(tweet);
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

  // 显示被过滤的推文样本
  console.log('\n' + '='.repeat(100));
  console.log('被过滤的推文样本（按质量分组）');
  console.log('='.repeat(100));

  for (const [quality, items] of Object.entries(byQuality)) {
    if (items.length === 0) continue;

    const allFiltered = items.flatMap(r => r.filteredTweetsList);
    if (allFiltered.length === 0) {
      console.log(`\n【${quality}】: 无被过滤的推文`);
      continue;
    }

    console.log(`\n【${quality}】(${allFiltered.length} 条被过滤)`);

    // 按原因分组
    const byReason = {};
    for (const item of allFiltered) {
      if (!byReason[item.reason]) byReason[item.reason] = [];
      byReason[item.reason].push(item.tweet);
    }

    for (const [reason, tweets] of Object.entries(byReason)) {
      console.log(`  ${reason} (${tweets.length} 条):`);
      tweets.slice(0, 5).forEach(tweet => {
        const preview = tweet.text?.substring(0, 80) || '(无text)';
        console.log(`    - ${preview}${tweet.text?.length > 80 ? '...' : ''}`);
      });
      if (tweets.length > 5) {
        console.log(`    ... 还有 ${tweets.length - 5} 条`);
      }
    }
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

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = yOriginal.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * yOriginal[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = yOriginal.reduce((sum, yi) => sum + yi * yi, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const corrOriginal = den !== 0 ? num / den : 0;

    // 过滤后
    const yFiltered = results.map(r => r.filteredFactors[factor]);
    const sumYF = yFiltered.reduce((a, b) => a + b, 0);
    const sumXYF = x.reduce((sum, xi, i) => sum + xi * yFiltered[i], 0);
    const sumY2F = yFiltered.reduce((sum, yi) => sum + yi * yi, 0);

    const numF = n * sumXYF - sumX * sumYF;
    const denF = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2F - sumYF * sumYF));
    const corrFiltered = denF !== 0 ? numF / denF : 0;

    console.log(`\n${factor}:`);
    console.log(`  过滤前相关系数: ${corrOriginal.toFixed(4)}`);
    console.log(`  过滤后相关系数: ${corrFiltered.toFixed(4)}`);
    console.log(`  变化: ${(corrFiltered - corrOriginal > 0 ? '+' : '')}${(corrFiltered - corrOriginal).toFixed(4)}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('结论');
  console.log('='.repeat(100));
  console.log('1. 当前过滤规则过滤了约 ' + (filteredTweets/totalTweets*100).toFixed(1) + '% 的推文');
  console.log('2. 主要过滤原因是: ' + Object.entries(filterStats).sort((a,b) => b[1] - a[1])[0][0]);
  console.log('3. 过滤后的相关性变化:');
  console.log('   - 需要观察相关系数是否向预期方向变化');
}

analyzeAndFilter().catch(console.error);
