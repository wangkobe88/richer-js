const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeRawTwitterData() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  console.log(`找到有人工标注的代币: ${tokens.length} 个\n`);

  // 获取这些代币的信号
  const tokenAddresses = tokens.map(t => t.token_address);
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  // 提取推特原始数据
  const twitterRawData = [];
  for (const signal of signals || []) {
    if (!signal.metadata) continue;

    const preBuy = signal.metadata.preBuyCheckFactors || {};
    const rawResult = preBuy._twitterRawResult || signal.metadata.twitter_search_result;

    if (rawResult && rawResult.data && rawResult.data.length > 0) {
      const token = tokens.find(t => t.token_address === signal.token_address);
      if (token) {
        const category = token.human_judges?.category || 'unknown';

        rawResult.data.forEach(tweet => {
          twitterRawData.push({
            tokenAddress: signal.token_address,
            tokenSymbol: token.token_symbol,
            quality: category,
            tweetText: tweet.text || '',
            authorUsername: tweet.author_username || '',
            authorFollowers: tweet.author_followers || 0,
            likes: tweet.public_metrics?.like_count || 0,
            retweets: tweet.public_metrics?.retweet_count || 0,
            createdAt: tweet.created_at || ''
          });
        });
      }
    }
  }

  console.log(`找到推特数据: ${twitterRawData.length} 条\n`);

  // 分析推文内容模式
  console.log('='.repeat(120));
  console.log('推文内容分析');
  console.log('='.repeat(120));

  // 统计推文长度分布
  const lengthDistribution = {
    veryShort: 0,  // < 20
    short: 0,      // 20-50
    medium: 0,     // 50-100
    long: 0        // > 100
  };

  // 统计关键词
  const keywordStats = {};
  const commonPatterns = [
    /\$\w+/g,  // 代币符号
    /pump/i,
    /pumping/i,
    /alert/i,
    /⚠️/g,
    /🚀/g,
    /up/i,
    /buy/i,
    /moon/i,
    /gem/i,
    /100x/i,
    /10x/i
  ];

  for (const tweet of twitterRawData) {
    const text = tweet.tweetText;
    const len = text.length;

    if (len < 20) lengthDistribution.veryShort++;
    else if (len < 50) lengthDistribution.short++;
    else if (len < 100) lengthDistribution.medium++;
    else lengthDistribution.long++;

    // 检查模式
    if (text.toLowerCase().includes('alert') && text.toLowerCase().includes('up')) {
      keywordStats['⚠️ 报警类'] = (keywordStats['⚠️ 报警类'] || 0) + 1;
    }
    if (/\$\w+/.test(text)) {
      keywordStats['包含代币符号'] = (keywordStats['包含代币符号'] || 0) + 1;
    }
  }

  console.log('推文长度分布:');
  console.log(`  < 20字符: ${lengthDistribution.veryShort} (${(lengthDistribution.veryShort/twitterRawData.length*100).toFixed(1)}%)`);
  console.log(`  20-50字符: ${lengthDistribution.short} (${(lengthDistribution.short/twitterRawData.length*100).toFixed(1)}%)`);
  console.log(`  50-100字符: ${lengthDistribution.medium} (${(lengthDistribution.medium/twitterRawData.length*100).toFixed(1)}%)`);
  console.log(`  > 100字符: ${lengthDistribution.long} (${(lengthDistribution.long/twitterRawData.length*100).toFixed(1)}%)`);

  console.log('\n关键词统计:');
  for (const [key, count] of Object.entries(keywordStats)) {
    console.log(`  ${key}: ${count} (${(count/twitterRawData.length*100).toFixed(1)}%)`);
  }

  // 查看原始推文样本
  console.log('\n' + '='.repeat(120));
  console.log('原始推文样本（按质量分组）');
  console.log('='.repeat(120));

  const byQuality = {};
  for (const tweet of twitterRawData) {
    if (!byQuality[tweet.quality]) byQuality[tweet.quality] = [];
    byQuality[tweet.quality].push(tweet);
  }

  for (const [quality, tweets] of Object.entries(byQuality)) {
    console.log(`\n【${quality}】(${tweets.length} 条推文)`);
    console.log('-'.repeat(100));

    // 显示前10条
    tweets.slice(0, 10).forEach((tweet, i) => {
      const preview = tweet.tweetText.length > 100 ? tweet.tweetText.substring(0, 100) + '...' : tweet.tweetText;
      console.log(`  ${i+1}. [${tweet.authorUsername}] (${tweet.authorFollowers} followers) ${preview}`);
    });

    if (tweets.length > 10) {
      console.log(`  ... 还有 ${tweets.length - 10} 条`);
    }
  }

  // 查找重复的推文内容
  console.log('\n' + '='.repeat(120));
  console.log('重复推文分析');
  console.log('='.repeat(120));

  const textCounts = {};
  for (const tweet of twitterRawData) {
    const text = tweet.tweetText.toLowerCase().trim();
    textCounts[text] = (textCounts[text] || 0) + 1;
  }

  const duplicateTexts = Object.entries(textCounts)
    .filter(([text, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  console.log(`重复推文数量: ${duplicateTexts.length} 种不同的重复内容\n`);

  if (duplicateTexts.length > 0) {
    console.log('重复最多的推文 TOP 20:');
    duplicateTexts.slice(0, 20).forEach(([text, count], i) => {
      const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
      console.log(`  ${i+1}. [${count}次] ${preview}`);
    });
  }

  // 分析"报警"类推文
  console.log('\n' + '='.repeat(120));
  console.log('报警类推文分析');
  console.log('='.repeat(120));

  const alertTweets = twitterRawData.filter(t =>
    t.tweetText.toLowerCase().includes('alert') ||
    t.tweetText.toLowerCase().includes('pump') ||
    t.tweetText.includes('⚠️') ||
    t.tweetText.includes('🚀')
  );

  console.log(`报警/推广类推文: ${alertTweets.length} 条 (${(alertTweets.length/twitterRawData.length*100).toFixed(1)}%)\n`);

  if (alertTweets.length > 0) {
    console.log('样本:');
    alertTweets.slice(0, 10).forEach((tweet, i) => {
      const preview = tweet.tweetText.length > 100 ? tweet.tweetText.substring(0, 100) + '...' : tweet.tweetText;
      console.log(`  ${i+1}. [${tweet.quality}] ${preview}`);
    });
  }

  // 统计信息
  console.log('\n' + '='.repeat(120));
  console.log('统计总结');
  console.log('='.repeat(120));
  console.log(`总推文数: ${twitterRawData.length}`);
  console.log(`涉及代币数: ${new Set(twitterRawData.map(t => t.tokenAddress)).size}`);
  console.log(`重复推文种类: ${duplicateTexts.length}`);
  console.log(`报警类推文: ${alertTweets.length}`);
}

analyzeRawTwitterData().catch(console.error);
