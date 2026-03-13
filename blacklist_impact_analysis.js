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

  // 1. 黑名单用户过滤
  if (TWITTER_USER_BLACKLIST.includes(username)) {
    return { filtered: true, reason: 'blacklist_user', account: username };
  }

  // 2. 追踪机器人过滤
  for (const pattern of FILTER_RULES.trackingBotPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'tracking_bot' };
    }
  }

  return { filtered: false };
}

async function analyzeWithBlacklist() {
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

  // 统计数据
  const stats = {
    low_quality: { tokens: [], tweets: 0, likes: 0, followers: 0, verified: 0, users: 0 },
    mid_quality: { tokens: [], tweets: 0, likes: 0, followers: 0, verified: 0, users: 0 },
    high_quality: { tokens: [], tweets: 0, likes: 0, followers: 0, verified: 0, users: 0 }
  };

  const filteredStats = {
    blacklist_user: 0,
    tracking_bot: 0,
    duplicate: 0,
    byUser: {}
  };

  // 处理数据
  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const allTweets = [...qualityTweets, ...lowQualityTweets];

    // 按代币去重
    const seenTexts = new Set();
    const keepTweets = [];

    for (const tweet of allTweets) {
      const result = shouldFilterTweet(tweet);

      if (result.filtered) {
        filteredStats[result.reason]++;
        if (result.account) {
          filteredStats.byUser[result.account] = (filteredStats.byUser[result.account] || 0) + 1;
        }
      } else {
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

    stats[category].tokens.push(signal.token_symbol);
    stats[category].tweets += keepTweets.length;
    stats[category].likes += totalLikes;
    stats[category].followers += totalFollowers;
    stats[category].verified += verifiedUsers.size;
    stats[category].users += uniqueUsers.size;
  }

  // 生成报告
  console.log('='.repeat(120));
  console.log('应用黑名单后的推特因子分析报告');
  console.log('='.repeat(120));
  console.log(`实验ID: ${experimentId}`);
  console.log(`黑名单用户数: ${TWITTER_USER_BLACKLIST.length}`);
  console.log(`过滤规则: 黑名单用户 + 追踪机器人模式`);
  console.log('');

  // 总体统计
  const totalTokens = tokens.length;
  console.log('总体样本分布:');
  console.log(`  低质量代币: ${stats.low_quality.tokens.length} 个`);
  console.log(`  中质量代币: ${stats.mid_quality.tokens.length} 个`);
  console.log(`  高质量代币: ${stats.high_quality.tokens.length} 个`);
  console.log(`  总计: ${totalTokens} 个`);
  console.log('');

  // 过滤统计
  console.log('='.repeat(120));
  console.log('过滤统计');
  console.log('='.repeat(120));
  console.log(`黑名单用户推文: ${filteredStats.blacklist_user} 条`);
  console.log(`追踪机器人推文: ${filteredStats.tracking_bot} 条`);
  console.log(`总过滤推文: ${filteredStats.blacklist_user + filteredStats.tracking_bot} 条`);
  console.log('');

  // 被过滤最多的黑名单用户
  console.log('被过滤最多的黑名单用户 TOP 10:');
  const topFiltered = Object.entries(filteredStats.byUser)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  topFiltered.forEach(([user, count], i) => {
    console.log(`  ${i + 1}. @${user}: ${count} 条推文被过滤`);
  });
  console.log('');

  // 各质量组详细统计
  console.log('='.repeat(120));
  console.log('各质量组详细统计');
  console.log('='.repeat(120));

  for (const [quality, data] of Object.entries(stats)) {
    if (data.tokens.length === 0) continue;

    const avgTweets = data.tweets / data.tokens.length;
    const avgLikes = data.likes / data.tokens.length;
    const avgFollowers = data.followers / data.tokens.length;
    const avgVerified = data.verified / data.tokens.length;
    const avgUsers = data.users / data.tokens.length;

    console.log(`\n【${quality}】`);
    console.log(`  代币数: ${data.tokens.length}`);
    console.log(`  代币列表: ${data.tokens.join(', ')}`);
    console.log(`  总推文数: ${data.tweets}`);
    console.log(`  平均推文数: ${avgTweets.toFixed(2)}`);
    console.log(`  总点赞数: ${data.likes}`);
    console.log(`  平均点赞数: ${avgLikes.toFixed(2)}`);
    console.log(`  总粉丝数: ${data.followers}`);
    console.log(`  平均粉丝数: ${avgFollowers.toFixed(2)}`);
    console.log(`  认证用户数: ${data.verified}`);
    console.log(`  平均认证用户: ${avgVerified.toFixed(2)}`);
    console.log(`  独立用户数: ${data.users}`);
    console.log(`  平均独立用户: ${avgUsers.toFixed(2)}`);
  }

  // 质量相关性分析
  console.log('\n' + '='.repeat(120));
  console.log('质量区分能力分析');
  console.log('='.repeat(120));

  const qualityMap = { 'low_quality': 1, 'mid_quality': 2, 'high_quality': 3 };
  const metrics = [
    { name: '平均推文数', key: 'tweets', calc: d => d.tweets / d.tokens.length },
    { name: '平均点赞数', key: 'likes', calc: d => d.likes / d.tokens.length },
    { name: '平均粉丝数', key: 'followers', calc: d => d.followers / d.tokens.length },
    { name: '平均认证用户', key: 'verified', calc: d => d.verified / d.tokens.length },
    { name: '平均独立用户', key: 'users', calc: d => d.users / d.tokens.length }
  ];

  console.log('\n各因子在不同质量组的表现:');
  console.log('-'.repeat(120));

  for (const metric of metrics) {
    console.log(`\n${metric.name}:`);
    const values = [];
    for (const [quality, data] of Object.entries(stats)) {
      if (data.tokens.length === 0) continue;
      const value = metric.calc(data);
      values.push({ quality, value });
      console.log(`  ${quality}: ${value.toFixed(2)}`);
    }

    // 计算单调性（是否按质量递增/递减）
    if (values.length >= 2) {
      const sortedByQuality = [...values].sort((a, b) => qualityMap[a.quality] - qualityMap[b.quality]);
      let isIncreasing = true;
      let isDecreasing = true;

      for (let i = 1; i < sortedByQuality.length; i++) {
        if (sortedByQuality[i].value < sortedByQuality[i - 1].value) isIncreasing = false;
        if (sortedByQuality[i].value > sortedByQuality[i - 1].value) isDecreasing = false;
      }

      let trend = '无趋势';
      if (isIncreasing) trend = '递增 (质量越高, 值越大)';
      else if (isDecreasing) trend = '递减 (质量越高, 值越小)';

      console.log(`  趋势: ${trend}`);
    }
  }

  // 关键发现
  console.log('\n' + '='.repeat(120));
  console.log('关键发现');
  console.log('='.repeat(120));

  const lowAvg = stats.low_quality.tokens.length > 0 ? stats.low_quality.followers / stats.low_quality.tokens.length : 0;
  const midAvg = stats.mid_quality.tokens.length > 0 ? stats.mid_quality.followers / stats.mid_quality.tokens.length : 0;
  const highAvg = stats.high_quality.tokens.length > 0 ? stats.high_quality.followers / stats.high_quality.tokens.length : 0;

  console.log('\n1. 粉丝数分析:');
  console.log(`   低质量均值: ${lowAvg.toFixed(2)}`);
  console.log(`   中质量均值: ${midAvg.toFixed(2)} (是低质量的 ${midAvg/lowAvg > 0 ? (midAvg/lowAvg).toFixed(2) : 'N/A'} 倍)`);
  console.log(`   高质量均值: ${highAvg.toFixed(2)} (是低质量的 ${highAvg/lowAvg > 0 ? (highAvg/lowAvg).toFixed(2) : 'N/A'} 倍)`);

  if (midAvg > lowAvg && highAvg < midAvg) {
    console.log(`   结论: 中质量代币有最多推特粉丝数，可能是营销驱动`);
  }

  console.log('\n2. 黑名单效果:');
  console.log(`   成功过滤 ${filteredStats.blacklist_user} 条黑名单用户推文`);
  console.log(`   涉及 ${Object.keys(filteredStats.byUser).length} 个不同账号`);
  console.log(`   这些推文不计入因子统计，避免噪音`);

  console.log('\n3. 样本限制:');
  console.log(`   高质量样本仅 ${stats.high_quality.tokens.length} 个`);
  console.log(`   统计结论需要谨慎解读`);

  // 建议
  console.log('\n' + '='.repeat(120));
  console.log('建议');
  console.log('='.repeat(120));

  console.log('\n1. 关于推特因子的使用:');
  if (midAvg > lowAvg * 2) {
    console.log('   ⚠️  中质量代币的粉丝数远高于低质量，说明存在"营销噪音"');
    console.log('   建议: 对高粉丝数保持警惕，可能是过度营销的信号');
  }

  if (highAvg < midAvg) {
    console.log('   ✓ 高质量代币反而粉丝数较少，符合"好产品不需要过度营销"的逻辑');
    console.log('   建议: 不要过度依赖推特粉丝数作为质量指标');
  }

  console.log('\n2. 关于黑名单:');
  console.log('   ✓ 黑名单已成功过滤跨代币活跃用户的推文');
  console.log('   ✓ 这些用户在不同代币中重复出现，价值较低');

  console.log('\n3. 后续工作:');
  console.log('   - 收集更多高质量样本');
  console.log('   - 分析推特内容语义（不仅仅是数量指标）');
  console.log('   - 考虑"推文独特性"指标（避免重复推广）');
}

analyzeWithBlacklist().catch(console.error);
