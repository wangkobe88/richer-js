const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function inspectAllTweets() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const tokenAddresses = tokens.map(t => t.token_address);
  const tokenMap = new Map(tokens.map(t => [t.token_address, t]));

  // 获取信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  console.log(`找到 ${signals?.length || 0} 条信号\n`);

  // 收集所有推文
  const allTweets = [];
  const tweetTextCounts = {}; // 用于统计重复推文

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
      const key = text.toLowerCase().trim();

      // 统计重复推文
      tweetTextCounts[key] = (tweetTextCounts[key] || 0) + 1;

      allTweets.push({
        tokenSymbol: signal.token_symbol,
        quality: category,
        text: text,
        user: tweet.user?.screen_name || '',
        followers: tweet.user?.followers_count || 0,
        verified: tweet.user?.verified || false,
        engagement: tweet.metrics?.total_engagement || 0,
        isQuality: tweet.is_quality || false
      });
    }
  }

  console.log(`总推文数: ${allTweets.length}`);
  console.log(`涉及代币: ${new Set(allTweets.map(t => t.tokenSymbol)).size}\n`);

  // 1. 显示所有推文内容
  console.log('='.repeat(120));
  console.log('所有推文内容（按质量分组）');
  console.log('='.repeat(120));

  const byQuality = {};
  for (const tweet of allTweets) {
    if (!byQuality[tweet.quality]) byQuality[tweet.quality] = [];
    byQuality[tweet.quality].push(tweet);
  }

  for (const [quality, tweets] of Object.entries(byQuality)) {
    console.log(`\n【${quality}】(${tweets.length} 条)`);
    console.log('-'.repeat(100));

    tweets.forEach((tweet, i) => {
      const v = tweet.verified ? '✓' : ' ';
      console.log(`  ${i+1}. [${tweet.tokenSymbol}] ${v} [${tweet.user}] (${tweet.followers}粉丝) 互动:${tweet.engagement}`);
      console.log(`     ${tweet.text.substring(0, 150)}${tweet.text.length > 150 ? '...' : ''}`);
    });
  }

  // 2. 找出重复的推文
  console.log('\n' + '='.repeat(120));
  console.log('重复推文分析');
  console.log('='.repeat(120));

  const duplicates = Object.entries(tweetTextCounts)
    .filter(([text, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\n重复推文: ${duplicates.length} 种\n`);

  if (duplicates.length > 0) {
    console.log('重复最多的推文 TOP 20:');
    duplicates.slice(0, 20).forEach(([text, count], i) => {
      const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
      console.log(`  ${i+1}. [${count}次] ${preview}`);
    });
  }

  // 3. 分析推文模式
  console.log('\n' + '='.repeat(120));
  console.log('推文模式分析');
  console.log('='.repeat(120));

  // 统计各种模式
  const patterns = {
    hasDollarSign: 0,        // 包含$符号
    hasMultipleEmoji: 0,     // 包含3个以上emoji
    hasUrl: 0,               // 包含链接
    hasQuickSwap: 0,         // 包含Quick Swap
    hasChainBsc: 0,          // 包含Chain: bsc
    hasMarketCap: 0,         // 包含MarketCap
    hasPumpAlert: 0,         // 包含pump/alert关键词
    isVeryShort: 0,          // 极短推文(<30字符)
    isLongPromotion: 0       // 长推广推文
  };

  const textSample = {
    hasDollarSign: [],
    hasMultipleEmoji: [],
    hasQuickSwap: [],
    hasChainBsc: [],
    hasMarketCap: [],
    hasPumpAlert: []
  };

  for (const tweet of allTweets) {
    const text = tweet.text;

    // 检查$符号（代币符号）
    if (/\$[\w]+/.test(text)) {
      patterns.hasDollarSign++;
      if (textSample.hasDollarSign.length < 3) {
        textSample.hasDollarSign.push(text);
      }
    }

    // 检查多个emoji
    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount >= 3) {
      patterns.hasMultipleEmoji++;
      if (textSample.hasMultipleEmoji.length < 3) {
        textSample.hasMultipleEmoji.push(text);
      }
    }

    // 检查链接
    if (/https?:\/\/\S+/.test(text)) {
      patterns.hasUrl++;
    }

    // 检查Quick Swap
    if (/quick swap|quickswap/i.test(text)) {
      patterns.hasQuickSwap++;
      if (textSample.hasQuickSwap.length < 3) {
        textSample.hasQuickSwap.push(text);
      }
    }

    // 检查Chain: bsc
    if (/chain\s*[:：]\s*bsc|💥.*chain/i.test(text)) {
      patterns.hasChainBsc++;
      if (textSample.hasChainBsc.length < 3) {
        textSample.hasChainBsc.push(text);
      }
    }

    // 检查MarketCap
    if (/marketcap|market\s*cap|市值/i.test(text)) {
      patterns.hasMarketCap++;
      if (textSample.hasMarketCap.length < 3) {
        textSample.hasMarketCap.push(text);
      }
    }

    // 检查pump/alert
    if (/pump|alert|popped|just.*up/i.test(text)) {
      patterns.hasPumpAlert++;
      if (textSample.hasPumpAlert.length < 3) {
        textSample.hasPumpAlert.push(text);
      }
    }

    // 极短推文
    if (text.length < 30) {
      patterns.isVeryShort++;
    }

    // 长推广推文（>100字符且包含多个关键词）
    if (text.length > 100 &&
        (/chain|market|quick|swap|pump|alert|🚀|🔥|💥/i.test(text))) {
      patterns.isLongPromotion++;
    }
  }

  console.log('\n模式统计:');
  for (const [key, count] of Object.entries(patterns)) {
    const pct = (count / allTweets.length * 100).toFixed(1);
    console.log(`  ${key}: ${count} (${pct}%)`);
  }

  console.log('\n样本推文:');
  for (const [key, samples] of Object.entries(textSample)) {
    if (samples.length === 0) continue;
    console.log(`\n${key} 样本:`);
    samples.forEach(s => {
      console.log(`  - ${s.substring(0, 100)}${s.length > 100 ? '...' : ''}`);
    });
  }

  // 4. 统计认证账号和非认证账号的推文
  console.log('\n' + '='.repeat(120));
  console.log('账号类型分析');
  console.log('='.repeat(120));

  const verifiedTweets = allTweets.filter(t => t.verified);
  const unverifiedTweets = allTweets.filter(t => !t.verified);

  console.log(`\n认证账号推文: ${verifiedTweets.length} 条`);
  console.log(`非认证账号推文: ${unverifiedTweets.length} 条`);

  if (verifiedTweets.length > 0) {
    console.log('\n认证账号样本:');
    verifiedTweets.slice(0, 5).forEach(t => {
      console.log(`  [${t.user}] ${t.text.substring(0, 80)}...`);
    });
  }

  if (unverifiedTweets.length > 0) {
    console.log('\n非认证账号样本:');
    unverifiedTweets.slice(0, 10).forEach(t => {
      console.log(`  [${t.user}] ${t.text.substring(0, 80)}...`);
    });
  }
}

inspectAllTweets().catch(console.error);
