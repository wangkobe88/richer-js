const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 导入黑名单
const { TWITTER_USER_BLACKLIST } = require('./src/utils/twitter-validation');

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
    return { filtered: true, reason: 'blacklist_user' };
  }

  for (const pattern of FILTER_RULES.trackingBotPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'tracking_bot' };
    }
  }

  return { filtered: false };
}

async function findCrossTokenUsers() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取所有有推特数据的信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .not('twitter_search_result', 'is', null);

  console.log(`分析 ${signals?.length || 0} 条信号的推特数据\n`);

  // 统计每个用户出现在哪些代币中
  const userToTokens = new Map(); // username -> Set of token symbols
  const userInfo = new Map();   // username -> { followers, verified, tweets }

  // 推文样本
  const userTweetSamples = new Map(); // username -> array of {token, text}

  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const tokenSymbol = signal.token_symbol;

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const tweets = [...qualityTweets, ...lowQualityTweets];

    for (const tweet of tweets) {
      const username = tweet.user?.screen_name;
      if (!username) continue;

      const filterResult = shouldFilterTweet(tweet);
      if (filterResult.filtered) continue;

      // 记录用户涉及的代币
      if (!userToTokens.has(username)) {
        userToTokens.set(username, new Set());
        userInfo.set(username, {
          followers: tweet.user?.followers_count || 0,
          verified: tweet.user?.verified || false,
          totalTweets: 0
        });
        userTweetSamples.set(username, []);
      }

      userToTokens.get(username).add(tokenSymbol);
      userInfo.get(username).totalTweets++;

      // 保存推文样本（每个用户最多保存5个代币的样本）
      const samples = userTweetSamples.get(username);
      if (samples.length < 10 || samples.some(s => s.token === tokenSymbol)) {
        samples.push({
          token: tokenSymbol,
          text: tweet.text?.substring(0, 100) || ''
        });
      }
    }
  }

  // 转换为数组并排序
  const crossTokenUsers = [];
  for (const [username, tokenSet] of userToTokens.entries()) {
    const info = userInfo.get(username);
    crossTokenUsers.push({
      username,
      tokenCount: tokenSet.size,
      tokens: Array.from(tokenSet),
      ...info,
      samples: userTweetSamples.get(username) || []
    });
  }

  // 按涉及的代币数量排序
  crossTokenUsers.sort((a, b) => b.tokenCount - a.tokenCount);

  console.log('='.repeat(120));
  console.log('跨代币用户分析');
  console.log('='.repeat(120));

  const totalUsers = crossTokenUsers.length;
  const multiTokenUsers = crossTokenUsers.filter(u => u.tokenCount >= 2);
  const multiTokenUsers3Plus = crossTokenUsers.filter(u => u.tokenCount >= 3);
  const multiTokenUsers5Plus = crossTokenUsers.filter(u => u.tokenCount >= 5);
  const multiTokenUsers10Plus = crossTokenUsers.filter(u => u.tokenCount >= 10);

  console.log(`总用户数: ${totalUsers}`);
  console.log(`涉及2+个代币的用户: ${multiTokenUsers.length} (${(multiTokenUsers.length/totalUsers*100).toFixed(1)}%)`);
  console.log(`涉及3+个代币的用户: ${multiTokenUsers3Plus.length} (${(multiTokenUsers3Plus.length/totalUsers*100).toFixed(1)}%)`);
  console.log(`涉及5+个代币的用户: ${multiTokenUsers5Plus.length} (${(multiTokenUsers5Plus.length/totalUsers*100).toFixed(1)}%)`);
  console.log(`涉及10+个代币的用户: ${multiTokenUsers10Plus.length} (${(multiTokenUsers10Plus.length/totalUsers*100).toFixed(1)}%)`);

  // 显示跨多个代币的用户
  console.log('\n' + '='.repeat(120));
  console.log('涉及3个或更多代币的用户');
  console.log('='.repeat(120));

  for (const user of multiTokenUsers3Plus) {
    const verified = user.verified ? '[✓]' : '[ ]';
    const qualityTag = user.followers > 10000 ? '大V' : user.followers > 1000 ? '中V' : '普通';

    console.log(`\n@${user.username} ${verified}`);
    console.log(`  粉丝: ${user.followers} (${qualityTag}) | 总推文: ${user.totalTweets} | 涉及代币: ${user.tokenCount}`);
    console.log(`  代币列表: ${user.tokens.join(', ')}`);

    if (user.samples.length > 0) {
      console.log(`  推文样本:`);
      user.samples.slice(0, 5).forEach(sample => {
        console.log(`    [${sample.token}] ${sample.text}${sample.text.length >= 100 ? '' : '...'}`);
      });
    }
  }

  // 用户类型分析
  console.log('\n' + '='.repeat(120));
  console.log('用户类型分析');
  console.log('='.repeat(120));

  // 按粉丝数分类
  const megaInfluencers = multiTokenUsers.filter(u => u.followers >= 100000);
  const influencers = multiTokenUsers.filter(u => u.followers >= 10000 && u.followers < 100000);
  const microInfluencers = multiTokenUsers.filter(u => u.followers >= 1000 && u.followers < 10000);
  const normalUsers = multiTokenUsers.filter(u => u.followers < 1000);

  console.log(`\n按粉丝数分类 (涉及2+代币的用户):`);
  console.log(`  超级大V (10万+粉丝): ${megaInfluencers.length} 人`);
  console.log(`  大V (1-10万粉丝): ${influencers.length} 人`);
  console.log(`  中V (1千-1万粉丝): ${microInfluencers.length} 人`);
  console.log(`  普通用户 (<1千粉丝): ${normalUsers.length} 人`);

  // 显示大V
  if (influencers.length > 0) {
    console.log(`\n大V列表 (涉及多个代币):`);
    influencers.forEach(user => {
      const verified = user.verified ? '[✓]' : '[ ]';
      console.log(`  @${user.username} ${verified} - ${user.followers}粉丝, ${user.tokenCount}个代币`);
    });
  }

  // 按代币数分类
  console.log(`\n按涉及代币数分类:`);
  console.log(`  涉及10+代币: ${multiTokenUsers10Plus.length} 人`);
  console.log(`  涉及7-9代币: ${multiTokenUsers.filter(u => u.tokenCount >= 7 && u.tokenCount < 10).length} 人`);
  console.log(`  涉及5-6代币: ${multiTokenUsers.filter(u => u.tokenCount >= 5 && u.tokenCount < 7).length} 人`);
  console.log(`  涉及3-4代币: ${multiTokenUsers.filter(u => u.tokenCount >= 3 && u.tokenCount < 5).length} 人`);
  console.log(`  涉及2代币: ${multiTokenUsers.filter(u => u.tokenCount === 2).length} 人`);

  // 找出"币圈活跃用户"（高频发推且涉及多个代币）
  console.log('\n' + '='.repeat(120));
  console.log('"币圈活跃用户"（涉及3+代币且总推文>=5）');
  console.log('='.repeat(120));

  const activeUsers = multiTokenUsers3Plus.filter(u => u.totalTweets >= 5);
  activeUsers.sort((a, b) => b.tokenCount - a.tokenCount || b.totalTweets - a.totalTweets);

  if (activeUsers.length > 0) {
    console.log(`找到 ${activeUsers.length} 个币圈活跃用户:\n`);

    for (const user of activeUsers) {
      const verified = user.verified ? '[✓]' : '[ ]';
      console.log(`  @${user.username} ${verified}`);
      console.log(`    粉丝: ${user.followers} | 涉及: ${user.tokenCount}个代币 | 总推文: ${user.totalTweets}`);
      console.log(`    代币: ${user.tokens.join(', ')}`);
    }
  }

  // 统计：这些跨代币用户是否集中于某些代币
  console.log('\n' + '='.repeat(120));
  console.log('代币被跨代币用户提及的次数');
  console.log('='.repeat(120));

  const tokenMentionCount = {};
  for (const user of multiTokenUsers) {
    for (const token of user.tokens) {
      tokenMentionCount[token] = (tokenMentionCount[token] || 0) + 1;
    }
  }

  const sortedTokens = Object.entries(tokenMentionCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\nTOP 20 代币（被跨代币用户提及次数）:');
  sortedTokens.forEach(([token, count], i) => {
    console.log(`  ${i + 1}. ${token.padEnd(15)} ${count}次`);
  });

  // 建议：是否需要将这些跨代币用户加入黑名单？
  console.log('\n' + '='.repeat(120));
  console.log('黑名单建议');
  console.log('='.repeat(120));

  const extremeUsers = multiTokenUsers.filter(u => u.tokenCount >= 10);
  if (extremeUsers.length > 0) {
    console.log(`\n涉及10+个代币的用户 (${extremeUsers.length}个), 可能需要加入黑名单:`);
    console.log('(这些用户可能在大量代币下发推，价值较低)');

    extremeUsers.forEach(user => {
      console.log(`  - @${user.username}: ${user.tokenCount}个代币, ${user.followers}粉丝, ${user.totalTweets}条推文`);
    });
  } else {
    console.log('\n没有发现极端的跨代币用户（10+代币）');
  }

  // 导出数据供后续分析
  console.log('\n' + '='.repeat(120));
  console.log('数据导出');
  console.log('='.repeat(120));

  const fs = require('fs');
  const exportData = {
    totalUsers,
    multiTokenUsers: multiTokenUsers.length,
    multiTokenUsers3Plus: multiTokenUsers3Plus.length,
    activeUsers: activeUsers.length,
    users: multiTokenUsers3Plus.map(u => ({
      username: u.username,
      followers: u.followers,
      verified: u.verified,
      tokenCount: u.tokenCount,
      tokens: u.tokens,
      totalTweets: u.totalTweets
    }))
  };

  fs.writeFileSync('cross_token_users.json', JSON.stringify(exportData, null, 2), 'utf8');
  console.log('\n数据已导出到: cross_token_users.json');
}

findCrossTokenUsers().catch(console.error);
