const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDescriptionEngagement() {
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

  // 收集有描述性内容的推文
  const descriptiveTweets = [];

  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const tweets = [...qualityTweets, ...lowQualityTweets];

    for (const tweet of tweets) {
      const text = tweet.text || '';

      // 判断是否是描述性内容
      const isDescriptive =
        text.length > 50 && (
          /(?:是|为|基于|powered|driven|introducing)/i.test(text) ||
          /(?:项目|project|platform|protocol|agent|ai|function)/i.test(text) ||
          /(?:功能|可以|无需|只需|持有)/i.test(text) ||
          /(?:turn|convert|allow.*to|enable)/i.test(text)
        );

      if (isDescriptive) {
        descriptiveTweets.push({
          tokenSymbol: signal.token_symbol,
          quality: category,
          text: text,
          user: tweet.user?.screen_name || '',
          followers: tweet.user?.followers_count || 0,
          verified: tweet.user?.verified || false,
          likes: tweet.metrics?.favorite_count || 0,
          retweets: tweet.metrics?.retweet_count || 0,
          replies: tweet.metrics?.reply_count || 0,
          totalEngagement: (tweet.metrics?.favorite_count || 0) +
                          (tweet.metrics?.retweet_count || 0) +
                          (tweet.metrics?.reply_count || 0),
          isQuality: tweet.is_quality || false
        });
      }
    }
  }

  console.log('='.repeat(120));
  console.log('描述性推文的互动分析');
  console.log('='.repeat(120));
  console.log(`找到 ${descriptiveTweets.length} 条描述性推文\n`);

  if (descriptiveTweets.length === 0) {
    console.log('没有找到描述性推文');
    return;
  }

  // 按互动量排序
  const sortedByEngagement = [...descriptiveTweets].sort((a, b) => b.totalEngagement - a.totalEngagement);

  console.log('按互动量排序（从高到低）:');
  console.log('-'.repeat(120));

  for (let i = 0; i < sortedByEngagement.length; i++) {
    const tweet = sortedByEngagement[i];
    const qualityTag = tweet.quality === 'low_quality' ? '[低]' :
                      tweet.quality === 'mid_quality' ? '[中]' :
                      tweet.quality === 'high_quality' ? '[高]' : '[?]';
    const verified = tweet.verified ? '[✓]' : '[ ]';
    const qualityMark = tweet.isQuality ? '[★]' : '[ ]';

    console.log(`\n${i + 1}. ${qualityTag} ${tweet.tokenSymbol} ${qualityMark} ${verified}`);
    console.log(`   [@${tweet.user}] (${tweet.followers} 粉丝)`);
    console.log(`   互动: 👍${tweet.likes} 🔄${tweet.retweets} 💬${tweet.replies} = 总${tweet.totalEngagement}`);
    console.log(`   内容: ${tweet.text.substring(0, 150)}${tweet.text.length > 150 ? '...' : ''}`);
  }

  // 统计分析
  console.log('\n' + '='.repeat(120));
  console.log('统计分析');
  console.log('='.repeat(120));

  const withEngagement = descriptiveTweets.filter(t => t.totalEngagement > 0);
  const zeroEngagement = descriptiveTweets.filter(t => t.totalEngagement === 0);

  console.log(`\n有互动的推文: ${withEngagement.length} 条 (${(withEngagement.length/descriptiveTweets.length*100).toFixed(1)}%)`);
  console.log(`零互动推文: ${zeroEngagement.length} 条 (${(zeroEngagement.length/descriptiveTweets.length*100).toFixed(1)}%)`);

  if (withEngagement.length > 0) {
    const avgEngagement = withEngagement.reduce((sum, t) => sum + t.totalEngagement, 0) / withEngagement.length;
    const maxEngagement = Math.max(...withEngagement.map(t => t.totalEngagement));
    const minEngagement = Math.min(...withEngagement.map(t => t.totalEngagement));

    console.log(`平均互动: ${avgEngagement.toFixed(1)}`);
    console.log(`最高互动: ${maxEngagement}`);
    console.log(`最低互动: ${minEngagement}`);
  }

  // 按质量分组统计
  console.log('\n' + '='.repeat(120));
  console.log('按质量分组统计');
  console.log('='.repeat(120));

  const byQuality = {};
  for (const tweet of descriptiveTweets) {
    if (!byQuality[tweet.quality]) {
      byQuality[tweet.quality] = [];
    }
    byQuality[tweet.quality].push(tweet);
  }

  for (const [quality, tweets] of Object.entries(byQuality)) {
    if (tweets.length === 0) continue;

    const withEng = tweets.filter(t => t.totalEngagement > 0).length;
    const totalEng = tweets.reduce((sum, t) => sum + t.totalEngagement, 0);
    const avgEng = totalEng / tweets.length;

    console.log(`\n【${quality}】`);
    console.log(`  描述性推文: ${tweets.length} 条`);
    console.log(`  有互动: ${withEng} 条 (${(withEng/tweets.length*100).toFixed(1)}%)`);
    console.log(`  总互动: ${totalEng}`);
    console.log(`  平均互动: ${avgEng.toFixed(1)}`);

    // 显示该组有互动的推文
    const withEngagementTweets = tweets.filter(t => t.totalEngagement > 0);
    if (withEngagementTweets.length > 0) {
      console.log(`  有互动的推文:`);
      withEngagementTweets.forEach(t => {
        console.log(`    - ${t.tokenSymbol}: [@${t.user}] 👍${t.likes} 🔄${t.retweets} 💬${t.replies}`);
      });
    }
  }

  // 检查是否有高质量描述+高互动的组合
  console.log('\n' + '='.repeat(120));
  console.log('高质量描述性推文（长内容+有互动）');
  console.log('='.repeat(120));

  const highQuality = descriptiveTweets.filter(t =>
    t.text.length > 100 && t.totalEngagement > 0
  );

  if (highQuality.length > 0) {
    console.log(`找到 ${highQuality.length} 条长描述且有互动的推文:\n`);

    highQuality.sort((a, b) => b.totalEngagement - a.totalEngagement);

    for (const tweet of highQuality) {
      const qualityTag = tweet.quality === 'low_quality' ? '[低]' :
                        tweet.quality === 'mid_quality' ? '[中]' :
                        tweet.quality === 'high_quality' ? '[高]' : '[?]';
      console.log(`${qualityTag} ${tweet.tokenSymbol}`);
      console.log(`  互动: ${tweet.totalEngagement} (👍${tweet.likes} 🔄${tweet.retweets} 💬${tweet.replies})`);
      console.log(`  [@${tweet.user}] (${tweet.followers} 粉丝)`);
      console.log(`  ${tweet.text.substring(0, 200)}...`);
      console.log('');
    }
  } else {
    console.log('没有找到长描述且有互动的推文');
  }

  // 结论
  console.log('='.repeat(120));
  console.log('结论');
  console.log('='.repeat(120));
  console.log(`1. ${descriptiveTweets.length} 条描述性推文中，只有 ${withEngagement.length} 条有互动`);
  console.log(`2. 零互动率: ${(zeroEngagement.length/descriptiveTweets.length*100).toFixed(1)}%`);
  console.log(`3. 大部分描述性推文缺乏社区关注`);

  if (zeroEngagement.length > 0) {
    console.log('\n零互动的描述性推文样本:');
    zeroEngagement.slice(0, 5).forEach(tweet => {
      console.log(`  - ${tweet.tokenSymbol}: ${tweet.text.substring(0, 60)}...`);
    });
  }
}

checkDescriptionEngagement().catch(console.error);
