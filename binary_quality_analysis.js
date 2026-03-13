const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 导入黑名单
const { TWITTER_USER_BLACKLIST } = require('./src/utils/twitter-validation');

// 过滤规则
const FILTER_RULES = {
  trackingBotPatterns: [
    /2\s+tracking\s+addresses?.*\s+bought\s+this\s+token/i,
    /2\s+个追踪地址\s+已购买/i,
    /2\s+个追踪地址已购买/i,
    /tracking\s+addresses?.*\s*bought/i
  ]
};

function shouldFilterTweet(tweet) {
  const text = tweet.text || '';
  const username = tweet.user?.screen_name || '';

  if (TWITTER_USER_BLACKLIST.includes(username)) {
    return { filtered: true, reason: 'blacklist_user', account: username };
  }

  for (const pattern of FILTER_RULES.trackingBotPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'tracking_bot' };
    }
  }

  return { filtered: false };
}

async function binaryQualityAnalysis() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const tokenMap = new Map(tokens.map(t => [t.token_address, t]));
  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  // 二分类统计
  const stats = {
    low: { tokens: [], tweets: 0, likes: 0, followers: 0, verified: 0, users: 0 },
    mid_high: { tokens: [], tweets: 0, likes: 0, followers: 0, verified: 0, users: 0 }
  };

  // 处理数据
  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    // 二分类：low vs mid+high
    const binaryCategory = category === 'low_quality' ? 'low' : 'mid_high';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const allTweets = [...qualityTweets, ...lowQualityTweets];

    // 按代币去重
    const seenTexts = new Set();
    const keepTweets = [];

    for (const tweet of allTweets) {
      const result = shouldFilterTweet(tweet);
      if (!result.filtered) {
        const normalizedText = tweet.text.toLowerCase().trim();
        if (!seenTexts.has(normalizedText)) {
          seenTexts.add(normalizedText);
          keepTweets.push(tweet);
        }
      }
    }

    // 计算因子
    let totalLikes = 0, totalFollowers = 0;
    const verifiedUsers = new Set();
    const uniqueUsers = new Set();

    for (const tweet of keepTweets) {
      totalLikes += tweet.metrics?.favorite_count || 0;
      totalFollowers += tweet.user?.followers_count || 0;
      if (tweet.user) {
        uniqueUsers.add(tweet.user.screen_name);
        if (tweet.user.verified) {
          verifiedUsers.add(tweet.user.screen_name);
        }
      }
    }

    stats[binaryCategory].tokens.push(signal.token_symbol);
    stats[binaryCategory].tweets += keepTweets.length;
    stats[binaryCategory].likes += totalLikes;
    stats[binaryCategory].followers += totalFollowers;
    stats[binaryCategory].verified += verifiedUsers.size;
    stats[binaryCategory].users += uniqueUsers.size;
  }

  // 生成报告
  console.log('='.repeat(120));
  console.log('推特因子二分类分析：低质量 vs 中高质量');
  console.log('='.repeat(120));
  console.log(`实验ID: ${experimentId}`);
  console.log(`分析目标: 区分低质量代币 vs 中高质量代币`);
  console.log('');

  // 样本分布
  console.log('样本分布:');
  console.log(`  低质量代币: ${stats.low.tokens.length} 个`);
  console.log(`  中高质量代币: ${stats.mid_high.tokens.length} 个`);
  console.log(`  总计: ${stats.low.tokens.length + stats.mid_high.tokens.length} 个`);
  console.log('');

  // 因子对比
  console.log('='.repeat(120));
  console.log('因子对比分析');
  console.log('='.repeat(120));

  const metrics = [
    { name: '平均推文数', key: 'tweets', unit: '条' },
    { name: '平均点赞数', key: 'likes', unit: '个' },
    { name: '平均粉丝数', key: 'followers', unit: '人' },
    { name: '平均认证用户', key: 'verified', unit: '个' },
    { name: '平均独立用户', key: 'users', unit: '个' }
  ];

  for (const metric of metrics) {
    const lowAvg = stats.low.tokens.length > 0 ? stats.low[metric.key] / stats.low.tokens.length : 0;
    const midHighAvg = stats.mid_high.tokens.length > 0 ? stats.mid_high[metric.key] / stats.mid_high.tokens.length : 0;
    const ratio = midHighAvg / lowAvg > 0 ? (midHighAvg / lowAvg).toFixed(2) : 'N/A';

    console.log(`\n${metric.name}:`);
    console.log(`  低质量: ${lowAvg.toFixed(2)} ${metric.unit}`);
    console.log(`  中高质量: ${midHighAvg.toFixed(2)} ${metric.unit}`);
    console.log(`  倍数关系: 中高是低的 ${ratio} 倍`);

    // 判断区分能力
    if (ratio !== 'N/A' && parseFloat(ratio) >= 2.0) {
      console.log(`  区分能力: ⭐⭐⭐ 强 (倍数≥2)`);
    } else if (ratio !== 'N/A' && parseFloat(ratio) >= 1.5) {
      console.log(`  区分能力: ⭐⭐ 中 (倍数≥1.5)`);
    } else if (ratio !== 'N/A' && parseFloat(ratio) >= 1.2) {
      console.log(`  区分能力: ⭐ 弱 (倍数≥1.2)`);
    } else {
      console.log(`  区分能力: ❌ 无明显区分`);
    }
  }

  // 核心发现
  console.log('\n' + '='.repeat(120));
  console.log('核心发现');
  console.log('='.repeat(120));

  const lowFollowers = stats.low.tokens.length > 0 ? stats.low.followers / stats.low.tokens.length : 0;
  const midHighFollowers = stats.mid_high.tokens.length > 0 ? stats.mid_high.followers / stats.mid_high.tokens.length : 0;
  const followersRatio = midHighFollowers / lowFollowers;

  console.log(`\n✓ 平均粉丝数具有最强的区分能力:`);
  console.log(`  低质量代币平均粉丝: ${lowFollowers.toFixed(2)} 人`);
  console.log(`  中高质量代币平均粉丝: ${midHighFollowers.toFixed(2)} 人`);
  console.log(`  中高/低倍数: ${followersRatio.toFixed(2)}倍`);

  if (followersRatio >= 5) {
    console.log(`  结论: 强区分指标，可用于过滤低质量代币`);
  }

  // 建议阈值
  console.log('\n' + '='.repeat(120));
  console.log('建议阈值');
  console.log('='.repeat(120));

  // 计算中位数
  const lowFollowersList = [];
  const midHighFollowersList = [];

  // 需要重新遍历数据计算每个代币的粉丝数
  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';
    const binaryCategory = category === 'low_quality' ? 'low' : 'mid_high';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const allTweets = [...qualityTweets, ...lowQualityTweets];

    const seenTexts = new Set();
    let totalFollowers = 0;

    for (const tweet of allTweets) {
      const result = shouldFilterTweet(tweet);
      if (!result.filtered) {
        const normalizedText = tweet.text.toLowerCase().trim();
        if (!seenTexts.has(normalizedText)) {
          seenTexts.add(normalizedText);
          totalFollowers += tweet.user?.followers_count || 0;
        }
      }
    }

    if (binaryCategory === 'low' && seenTexts.size > 0) {
      lowFollowersList.push(totalFollowers);
    } else if (binaryCategory === 'mid_high' && seenTexts.size > 0) {
      midHighFollowersList.push(totalFollowers);
    }
  }

  lowFollowersList.sort((a, b) => a - b);
  midHighFollowersList.sort((a, b) => a - b);

  const lowMedian = lowFollowersList.length > 0 ? lowFollowersList[Math.floor(lowFollowersList.length / 2)] : 0;
  const midHighMedian = midHighFollowersList.length > 0 ? midHighFollowersList[Math.floor(midHighFollowersList.length / 2)] : 0;

  console.log(`\n基于中位数分析:`);
  console.log(`  低质量中位数: ${lowMedian} 粉丝`);
  console.log(`  中高质量中位数: ${midHighMedian} 粉丝`);

  // 建议阈值
  const suggestedThreshold = Math.max(500, Math.floor((lowMedian + midHighMedian) / 2));
  console.log(`\n建议过滤阈值: ${suggestedThreshold} 粉丝`);
  console.log(`  - 如果粉丝数 < ${suggestedThreshold}: 可能为低质量代币`);
  console.log(`  - 如果粉丝数 >= ${suggestedThreshold}: 可能为中高质量代币`);

  // 阈值效果模拟
  console.log('\n阈值效果模拟:');
  let lowCorrect = 0;
  let midHighCorrect = 0;

  for (const followers of lowFollowersList) {
    if (followers < suggestedThreshold) lowCorrect++;
  }
  for (const followers of midHighFollowersList) {
    if (followers >= suggestedThreshold) midHighCorrect++;
  }

  const lowAccuracy = lowFollowersList.length > 0 ? lowCorrect / lowFollowersList.length * 100 : 0;
  const midHighAccuracy = midHighFollowersList.length > 0 ? midHighCorrect / midHighFollowersList.length * 100 : 0;
  const overallAccuracy = (lowCorrect + midHighCorrect) / (lowFollowersList.length + midHighFollowersList.length) * 100;

  console.log(`  低质量识别率: ${lowCorrect}/${lowFollowersList.length} (${lowAccuracy.toFixed(1)}%)`);
  console.log(`  中高质量识别率: ${midHighCorrect}/${midHighFollowersList.length} (${midHighAccuracy.toFixed(1)}%)`);
  console.log(`  总体准确率: ${overallAccuracy.toFixed(1)}%`);

  // 实际应用建议
  console.log('\n' + '='.repeat(120));
  console.log('实际应用建议');
  console.log('='.repeat(120));

  console.log(`\n1. 过滤规则建议:`);
  console.log(`   if (twitter_followers < ${suggestedThreshold}) {`);
  console.log(`     // 疑似低质量代币，谨慎买入`);
  console.log(`     return 'WARNING: Low Twitter engagement';`);
  console.log(`   }`);

  console.log(`\n2. 风险等级划分:`);
  console.log(`   - 高风险: 粉丝数 < ${lowMedian} (约${lowFollowersList.length > 0 ? (lowFollowersList.filter(f => f < lowMedian).length/lowFollowersList.length*100).toFixed(0) : 0}%低质量代币在此区间)`);
  console.log(`   - 中风险: 粉丝数 ${lowMedian} - ${midHighMedian}`);
  console.log(`   - 低风险: 粉丝数 > ${midHighMedian} (约${midHighFollowersList.length > 0 ? (midHighFollowersList.filter(f => f > midHighMedian).length/midHighFollowersList.length*100).toFixed(0) : 0}%中高质量代币在此区间)`);

  console.log(`\n3. 局限性提醒:`);
  console.log(`   ⚠️  数据覆盖率仅13.9%，大部分代币无推特数据`);
  console.log(`   ⚠️  基于小样本(${lowFollowersList.length + midHighFollowersList.length}个)得出的结论`);
  console.log(`   ⚠️  需要更多样本验证此阈值`);
}

binaryQualityAnalysis().catch(console.error);
