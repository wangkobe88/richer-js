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

async function analyzeMaxFollowerLogic() {
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
      // 计算最大粉丝数
      const maxFollowers = keepTweets.length > 0
        ? Math.max(...keepTweets.map(t => t.user?.followers_count || 0))
        : 0;

      // 找到最大粉丝数的推文
      const maxFollowerTweet = keepTweets.find(t => (t.user?.followers_count || 0) === maxFollowers);

      tokenBestSignal.set(s.token_address, {
        tokenSymbol: s.token_symbol,
        tweetCount: keepTweets.length,
        maxFollowers,
        maxFollowerTweet,
        allTweets: keepTweets
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
  console.log('验证过滤逻辑："至少有一条大V推文"');
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

  console.log('按质量分组统计 (最大粉丝数):');
  console.log('-'.repeat(120));
  for (const [quality, items] of Object.entries(byQuality)) {
    if (items.length === 0) continue;

    const avgMax = items.reduce((sum, t) => sum + t.maxFollowers, 0) / items.length;
    const maxOfMax = Math.max(...items.map(t => t.maxFollowers));
    const minOfMax = Math.min(...items.map(t => t.maxFollowers));

    console.log(`\n【${quality}】`);
    console.log(`  代币数: ${items.length}`);
    console.log(`  平均最大粉丝数: ${avgMax.toFixed(0)}`);
    console.log(`  最大粉丝数范围: ${minOfMax} - ${maxOfMax}`);
  }

  // 测试不同阈值的效果
  console.log('\n' + '='.repeat(120));
  console.log('测试不同阈值的效果: "至少有一条推文来自粉丝数>=阈值的用户"');
  console.log('='.repeat(120));

  const thresholds = [500, 1000, 2000, 3000, 4000, 5000, 10000, 20000];

  for (const threshold of thresholds) {
    let lowCorrect = 0;
    let midHighCorrect = 0;
    let lowMissed = 0;
    let midHighMissed = 0;

    const lowItems = byQuality.low_quality || [];
    const midHighItems = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])];

    // 低质量：没有大V推文（最大粉丝数 < 阈值）
    for (const item of lowItems) {
      if (item.maxFollowers < threshold) {
        lowCorrect++;
      } else {
        lowMissed++;
      }
    }

    // 中高质量：至少有一条大V推文（最大粉丝数 >= 阈值）
    for (const item of midHighItems) {
      if (item.maxFollowers >= threshold) {
        midHighCorrect++;
      } else {
        midHighMissed++;
      }
    }

    const total = lowItems.length + midHighItems.length;
    const accuracy = total > 0 ? (lowCorrect + midHighCorrect) / total * 100 : 0;
    const lowRecall = lowItems.length > 0 ? lowCorrect / lowItems.length * 100 : 0;
    const midHighRecall = midHighItems.length > 0 ? midHighCorrect / midHighItems.length * 100 : 0;

    console.log(`\n阈值: ${threshold} 粉丝`);
    console.log(`  准确率: ${accuracy.toFixed(1)}%`);
    console.log(`  低质量召回率: ${lowRecall.toFixed(1)}% (${lowCorrect}/${lowItems.length})`);
    console.log(`  中高召回率: ${midHighRecall.toFixed(1)}% (${midHighCorrect}/${midHighItems.length})`);
    console.log(`  误判:`);
    console.log(`    低质量有大V: ${lowMissed} 个`);
    console.log(`    中高无大V: ${midHighMissed} 个`);
  }

  // 找出最优阈值
  console.log('\n' + '='.repeat(120));
  console.log('最优阈值分析');
  console.log('='.repeat(120));

  let bestThreshold = 0;
  let bestAccuracy = 0;
  let bestStats = null;

  for (const threshold of [500, 800, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 8000, 10000, 15000, 20000]) {
    const lowItems = byQuality.low_quality || [];
    const midHighItems = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])];

    let lowCorrect = 0;
    let midHighCorrect = 0;

    for (const item of lowItems) {
      if (item.maxFollowers < threshold) lowCorrect++;
    }
    for (const item of midHighItems) {
      if (item.maxFollowers >= threshold) midHighCorrect++;
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

  console.log('\n【低质量但有大V】（最大粉丝数>=阈值）');
  const lowMissed = (byQuality.low_quality || []).filter(t => t.maxFollowers >= bestThreshold);
  lowMissed.sort((a, b) => b.maxFollowers - a.maxFollowers);
  lowMissed.forEach(t => {
    const username = t.maxFollowerTweet?.user?.screen_name || 'unknown';
    const followers = t.maxFollowerTweet?.user?.followers_count || 0;
    console.log(`  ${t.symbol}: 最大粉丝 ${t.maxFollowers} (来自 @${username}, ${followers}粉丝)`);
  });

  console.log('\n【中高质量但无大V】（最大粉丝数<阈值）');
  const midHighMissed = [...(byQuality.mid_quality || []), ...(byQuality.high_quality || [])]
    .filter(t => t.maxFollowers < bestThreshold);
  midHighMissed.sort((a, b) => b.maxFollowers - a.maxFollowers);
  midHighMissed.forEach(t => {
    const username = t.maxFollowerTweet?.user?.screen_name || 'unknown';
    const followers = t.maxFollowerTweet?.user?.followers_count || 0;
    console.log(`  ${t.symbol}: 最大粉丝 ${t.maxFollowers} (来自 @${username}, ${followers}粉丝)`);
  });

  // 对比两种逻辑
  console.log('\n' + '='.repeat(120));
  console.log('两种过滤逻辑对比');
  console.log('='.repeat(120));

  console.log(`
逻辑1: "总粉丝数 < 阈值"
  - 计算所有推文的粉丝总和
  - 可能被大量小号推文拉高
  - 无法体现单个大V的价值

逻辑2: "最大粉丝数 < 阈值" (本次验证)
  - 只看是否至少有一条大V推文
  - 更符合"质量>数量"的理念
  - 一个大V的关注胜过100个小号

实际效果:
  - 最优阈值: ${bestThreshold} 粉丝
  - 准确率: ${bestAccuracy.toFixed(1)}%
  - 使用场景: "如果没有任何大V关注，可能是低质量代币"
`);

  // 实际应用建议
  console.log('='.repeat(120));
  console.log('实际应用建议');
  console.log('='.repeat(120));

  console.log(`
核心逻辑:
  if (有推文 && 最大粉丝数 < ${bestThreshold}) {
    // "有推文但没有大V关注" → 疑似低质量
    return 'WARNING: No influential Twitter users mentioned';
  }

解释:
  - "有推文": 有人讨论这个代币
  - "最大粉丝数<${bestThreshold}": 但都是小号，没有大V/KOL
  - 说明：缺乏有影响力的人关注，可能是低质量项目

优势:
  1. 避免被大量小号推文误导
  2. 突出单个大V的价值
  3. 更符合社交传播的逻辑

代码示例:
  const maxFollowers = Math.max(...tweets.map(t => t.user.followers_count));
  if (maxFollowers < ${bestThreshold}) {
    // 疑似低质量
  }
`);
}

analyzeMaxFollowerLogic().catch(console.error);
