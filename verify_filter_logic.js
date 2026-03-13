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
    return { filtered: true, reason: 'blacklist_user' };
  }

  for (const pattern of FILTER_RULES.trackingBotPatterns) {
    if (pattern.test(text)) {
      return { filtered: true, reason: 'tracking_bot' };
    }
  }

  return { filtered: false };
}

async function verifyFilterLogic() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取所有有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const tokenMap = new Map(tokens.map(t => [t.token_address, t]));
  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, twitter_search_result')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  // 找到每个代币推文最多的信号
  const tokenBestSignal = new Map();

  signals.forEach(s => {
    const twitterData = s.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) return;

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const tweets = [...qualityTweets, ...lowQualityTweets];

    // 去重并过滤黑名单
    const seenTexts = new Set();
    const keepTweets = [];

    for (const tweet of tweets) {
      if (!shouldFilterTweet(tweet).filtered) {
        const normalizedText = tweet.text.toLowerCase().trim();
        if (!seenTexts.has(normalizedText)) {
          seenTexts.add(normalizedText);
          keepTweets.push(tweet);
        }
      }
    }

    const existing = tokenBestSignal.get(s.token_address);
    if (!existing || keepTweets.length > existing.tweetCount) {
      // 计算总粉丝数
      const totalFollowers = keepTweets.reduce((sum, t) => sum + (t.user?.followers_count || 0), 0);

      tokenBestSignal.set(s.token_address, {
        tokenSymbol: s.token_symbol,
        tweetCount: keepTweets.length,
        totalFollowers,
        avgFollowers: keepTweets.length > 0 ? totalFollowers / keepTweets.length : 0,
        tweets: keepTweets
      });
    }
  });

  // 收集有推文的代币数据
  const tokensWithTweets = [];
  for (const token of tokens) {
    const data = tokenBestSignal.get(token.token_address);
    if (data && data.tweetCount > 0) {
      tokensWithTweets.push({
        symbol: token.token_symbol,
        quality: token.human_judges?.category,
        ...data
      });
    }
  }

  console.log('='.repeat(120));
  console.log('验证过滤逻辑："有推文但粉丝量小" → 疑似低质量');
  console.log('='.repeat(120));
  console.log('');
  console.log(`总代币数: ${tokens.length}`);
  console.log(`有推文的代币数: ${tokensWithTweets.length}`);
  console.log('');

  // 按质量分组统计
  const byQuality = {
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  tokensWithTweets.forEach(t => {
    if (byQuality[t.quality]) {
      byQuality[t.quality].push(t);
    }
  });

  console.log('按质量分组统计:');
  console.log('-'.repeat(120));
  for (const [quality, items] of Object.entries(byQuality)) {
    if (items.length === 0) continue;

    const avgFollowers = items.reduce((sum, t) => sum + t.totalFollowers, 0) / items.length;
    const avgPerTweet = items.reduce((sum, t) => sum + t.avgFollowers, 0) / items.length;

    console.log(`\n【${quality}】`);
    console.log(`  代币数: ${items.length}`);
    console.log(`  平均总粉丝数: ${avgFollowers.toFixed(0)}`);
    console.log(`  平均每推粉丝数: ${avgPerTweet.toFixed(0)}`);
  }

  // 测试不同阈值的效果
  console.log('\n' + '='.repeat(120));
  console.log('测试不同粉丝数阈值的过滤效果');
  console.log('='.repeat(120));

  const thresholds = [500, 1000, 2000, 3000, 4000, 5000];

  for (const threshold of thresholds) {
    let lowCorrect = 0; // 低质量被正确识别（粉丝数<阈值）
    let midHighCorrect = 0; // 中高被正确识别（粉丝数>=阈值）
    let lowMissed = 0; // 低质量被误判为中高（粉丝数>=阈值）
    let midHighMissed = 0; // 中高被误判为低（粉丝数<阈值）

    const lowItems = byQuality.low_quality || [];
    const midHighItems = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])];

    for (const item of lowItems) {
      if (item.totalFollowers < threshold) {
        lowCorrect++;
      } else {
        lowMissed++;
      }
    }

    for (const item of midHighItems) {
      if (item.totalFollowers >= threshold) {
        midHighCorrect++;
      } else {
        midHighMissed++;
      }
    }

    const total = lowItems.length + midHighItems.length;
    const accuracy = (lowCorrect + midHighCorrect) / total * 100;
    const lowRecall = lowItems.length > 0 ? lowCorrect / lowItems.length * 100 : 0;
    const midHighRecall = midHighItems.length > 0 ? midHighCorrect / midHighItems.length * 100 : 0;

    console.log(`\n阈值: ${threshold} 粉丝`);
    console.log(`  准确率: ${accuracy.toFixed(1)}%`);
    console.log(`  低质量召回率: ${lowRecall.toFixed(1)}% (${lowCorrect}/${lowItems.length})`);
    console.log(`  中高召回率: ${midHighRecall.toFixed(1)}% (${midHighCorrect}/${midHighItems.length})`);
    console.log(`  误判:`);
    console.log(`    低质量判为中高: ${lowMissed} 个`);
    console.log(`    中高判为低: ${midHighMissed} 个`);
  }

  // 找出最优阈值
  console.log('\n' + '='.repeat(120));
  console.log('最优阈值分析');
  console.log('='.repeat(120));

  let bestThreshold = 0;
  let bestAccuracy = 0;
  let bestStats = null;

  for (const threshold of [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000]) {
    const lowItems = byQuality.low_quality || [];
    const midHighItems = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])];

    let lowCorrect = 0;
    let midHighCorrect = 0;

    for (const item of lowItems) {
      if (item.totalFollowers < threshold) lowCorrect++;
    }
    for (const item of midHighItems) {
      if (item.totalFollowers >= threshold) midHighCorrect++;
    }

    const accuracy = (lowCorrect + midHighCorrect) / (lowItems.length + midHighItems.length) * 100;

    if (accuracy > bestAccuracy) {
      bestAccuracy = accuracy;
      bestThreshold = threshold;
      bestStats = { lowCorrect, midHighCorrect, lowItems: lowItems.length, midHighItems: midHighItems.length };
    }
  }

  console.log(`\n最优阈值: ${bestThreshold} 粉丝`);
  console.log(`  准确率: ${bestAccuracy.toFixed(1)}%`);
  console.log(`  低质量识别: ${bestStats.lowCorrect}/${bestStats.lowItems} (${(bestStats.lowCorrect/bestStats.lowItems*100).toFixed(1)}%)`);
  console.log(`  中高识别: ${bestStats.midHighCorrect}/${bestStats.midHighItems} (${(bestStats.midHighCorrect/bestStats.midHighItems*100).toFixed(1)}%)`);

  // 列出被误判的代币
  console.log('\n' + '='.repeat(120));
  console.log(`使用阈值 ${bestThreshold} 时的误判案例`);
  console.log('='.repeat(120));

  console.log('\n【低质量但粉丝数>=阈值】（应该过滤但没过滤到）');
  const lowMissed = (byQuality.low_quality || []).filter(t => t.totalFollowers >= bestThreshold);
  lowMissed.sort((a, b) => b.totalFollowers - a.totalFollowers);
  lowMissed.forEach(t => {
    console.log(`  ${t.symbol}: ${t.totalFollowers.toFixed(0)} 粉丝 (${t.tweetCount}条推文)`);
  });

  console.log('\n【中高质量但粉丝数<阈值】（不应该过滤但被过滤了）');
  const midHighMissed = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])]
    .filter(t => t.totalFollowers < bestThreshold);
  midHighMissed.sort((a, b) => a.totalFollowers - b.totalFollowers);
  midHighMissed.forEach(t => {
    console.log(`  ${t.symbol}: ${t.totalFollowers.toFixed(0)} 粉丝 (${t.tweetCount}条推文)`);
  });

  // 实际应用建议
  console.log('\n' + '='.repeat(120));
  console.log('实际应用建议');
  console.log('='.repeat(120));

  console.log(`
核心逻辑:
  if (有推文 && 总粉丝数 < ${bestThreshold}) {
    // "有推文但粉丝量小" → 疑似低质量
    return 'WARNING: Low Twitter engagement';
  }

解释:
  - "有推文": 说明有人在讨论这个代币
  - "粉丝量小": 说明讨论的都是小号，没有大V/KOL关注
  - 这种组合通常意味着：社区小、影响力弱、可能是低质量代币

使用场景:
  1. 作为买入前的风险检查
  2. 优先过滤掉这类代币
  3. 对于粉丝数>=${bestThreshold}的代币，再进行更详细的分析
`);
}

verifyFilterLogic().catch(console.error);
