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
    /tracking\s+addresses?.*\s+bought/i
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

async function exportDetailedData() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null)
    .order('token_symbol');

  const tokenMap = new Map(tokens.map(t => [t.token_address, t]));
  const tokenAddresses = tokens.map(t => t.token_address);

  // 获取信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, twitter_search_result, created_at')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses)
    .order('created_at', { ascending: false });

  // 处理数据（修正版：按代币去重，而不是全局去重）
  const results = [];

  for (const signal of signals || []) {
    const twitterData = signal.twitter_search_result;
    if (!twitterData || !twitterData.analysis_details) continue;

    const token = tokenMap.get(signal.token_address);
    if (!token) continue;

    const category = token.human_judges?.category || 'unknown';

    const qualityTweets = twitterData.analysis_details.quality_tweets || [];
    const lowQualityTweets = twitterData.analysis_details.low_quality_tweets || [];
    const allTweets = [...qualityTweets, ...lowQualityTweets];

    // 按代币去重（每个代币独立去重）
    const seenTexts = new Set();
    const keepTweets = [];
    const filteredTweets = [];

    for (const tweet of allTweets) {
      const result = shouldFilterTweet(tweet);

      if (result.filtered) {
        filteredTweets.push({ tweet, reason: result.reason });
      } else {
        // 按代币去重：同一条推文内容在同一代币下只保留一次
        const normalizedText = tweet.text.toLowerCase().trim();
        if (!seenTexts.has(normalizedText)) {
          seenTexts.add(normalizedText);
          keepTweets.push(tweet);
        } else {
          filteredTweets.push({ tweet, reason: 'duplicate' });
        }
      }
    }

    // 计算因子
    let totalLikes = 0, totalRetweets = 0, totalReplies = 0;
    let totalFollowers = 0;
    const verifiedUsers = new Set();
    const uniqueUsers = new Set();

    for (const tweet of keepTweets) {
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
    }

    results.push({
      tokenSymbol: signal.token_symbol,
      tokenAddress: signal.token_address,
      quality: category,
      signalCreatedAt: signal.created_at,
      totalTweets: allTweets.length,
      keepTweets: keepTweets.length,
      filteredTweets: filteredTweets.length,
      totalLikes,
      totalRetweets,
      totalReplies,
      totalEngagement: totalLikes + totalRetweets + totalReplies,
      totalFollowers,
      verifiedUsers: verifiedUsers.size,
      uniqueUsers: uniqueUsers.size,
      tweets: keepTweets,
      filteredTweetsList: filteredTweets
    });
  }

  // 生成报告
  let report = '';
  report += '='.repeat(120) + '\n';
  report += '推特因子分析详细报告（修正版）\n';
  report += '='.repeat(120) + '\n';
  report += `实验ID: ${experimentId}\n`;
  report += `导出时间: ${new Date().toISOString()}\n`;
  report += `总标注代币: ${tokens.length}\n`;
  report += `有推特数据: ${results.length}\n`;
  report += `过滤规则: 只过滤追踪机器人（"2 tracking addresses bought..."）\n`;
  report += `去重方式: 按代币独立去重（而非全局去重）\n`;
  report += '\n';

  // 按质量分组统计
  report += '='.repeat(120) + '\n';
  report += '按质量分组统计\n';
  report += '='.repeat(120) + '\n';

  const byQuality = { low_quality: [], mid_quality: [], high_quality: [] };
  for (const r of results) {
    if (byQuality[r.quality]) byQuality[r.quality].push(r);
  }

  for (const [quality, items] of Object.entries(byQuality)) {
    const totalTweets = items.reduce((sum, i) => sum + i.keepTweets, 0);
    const totalLikes = items.reduce((sum, i) => sum + i.totalLikes, 0);
    const totalFollowers = items.reduce((sum, i) => sum + i.totalFollowers, 0);

    report += `\n【${quality}】\n`;
    report += `  代币数: ${items.length}\n`;
    report += `  有效推文数: ${totalTweets}\n`;
    report += `  总点赞数: ${totalLikes}\n`;
    report += `  总粉丝数: ${totalFollowers}\n`;
  }

  // 详细数据
  report += '\n' + '='.repeat(120) + '\n';
  report += '详细数据（按质量分组）\n';
  report += '='.repeat(120) + '\n';

  const qualityOrder = { 'low_quality': 1, 'mid_quality': 2, 'high_quality': 3 };
  results.sort((a, b) => {
    const qa = qualityOrder[a.quality] || 0;
    const qb = qualityOrder[b.quality] || 0;
    if (qa !== qb) return qa - qb;
    return b.totalFollowers - a.totalFollowers;
  });

  let currentQuality = '';
  for (const r of results) {
    if (r.quality !== currentQuality) {
      currentQuality = r.quality;
      report += '\n' + '-'.repeat(120) + '\n';
      report += `【${currentQuality}】\n`;
      report += '-'.repeat(120) + '\n';
    }

    report += `\n代币: ${r.tokenSymbol} (${r.tokenAddress.substring(0, 10)}...)\n`;
    report += `  质量评级: ${r.quality}\n`;
    report += `  信号创建: ${r.signalCreatedAt}\n`;
    report += `  推文统计: 总${r.totalTweets}条, 有效${r.keepTweets}条, 过滤${r.filteredTweets}条\n`;
    report += `  互动数据: 点赞${r.totalLikes}, 转发${r.totalRetweets}, 评论${r.totalReplies}, 总互动${r.totalEngagement}\n`;
    report += `  用户数据: 粉丝${r.totalFollowers}, 认证${r.verifiedUsers}, 独立${r.uniqueUsers}\n`;

    if (r.tweets.length > 0) {
      report += `\n  有效推文 (${r.tweets.length}条):\n`;
      r.tweets.forEach((tweet, i) => {
        const verified = tweet.user?.verified ? '[✓]' : '[ ]';
        report += `    ${i + 1}. ${verified} [@${tweet.user?.screen_name || 'unknown'}] (${tweet.user?.followers_count || 0}粉丝)\n`;
        report += `       ${tweet.text}\n`;
        report += `       互动: 👍${tweet.metrics?.favorite_count || 0} 🔄${tweet.metrics?.retweet_count || 0} 💬${tweet.metrics?.reply_count || 0}\n`;
      });
    }

    if (r.filteredTweetsList.length > 0) {
      report += `\n  已过滤推文 (${r.filteredTweetsList.length}条):\n`;
      const byReason = {};
      for (const item of r.filteredTweetsList) {
        if (!byReason[item.reason]) byReason[item.reason] = [];
        byReason[item.reason].push(item.tweet);
      }

      for (const [reason, tweets] of Object.entries(byReason)) {
        report += `    ${reason}: ${tweets.length}条\n`;
        tweets.slice(0, 3).forEach((tweet) => {
          report += `      - [@${tweet.user?.screen_name || 'unknown'}] ${tweet.text.substring(0, 80)}${tweet.text.length > 80 ? '...' : ''}\n`;
        });
        if (tweets.length > 3) {
          report += `      ... 还有 ${tweets.length - 3} 条\n`;
        }
      }
    }
  }

  // 统计汇总
  report += '\n' + '='.repeat(120) + '\n';
  report += '统计汇总\n';
  report += '='.repeat(120) + '\n';

  report += '\n1. 样本分布:\n';
  report += `   低质量: ${byQuality.low_quality.length} 个代币\n`;
  report += `   中质量: ${byQuality.mid_quality.length} 个代币\n`;
  report += `   高质量: ${byQuality.high_quality.length} 个代币\n`;

  report += '\n2. 过滤原因统计:\n';
  const allFiltered = results.flatMap(r => r.filteredTweetsList);
  const byReason = {};
  for (const item of allFiltered) {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(byReason)) {
    report += `   ${reason}: ${count} 条\n`;
  }

  report += '\n3. 各质量组均值:\n';
  const factors = [
    { key: 'keepTweets', name: '推文数' },
    { key: 'totalLikes', name: '总点赞' },
    { key: 'totalFollowers', name: '总粉丝' },
    { key: 'verifiedUsers', name: '认证用户' },
    { key: 'uniqueUsers', name: '独立用户' }
  ];

  for (const factor of factors) {
    report += `\n   ${factor.name}:\n`;
    for (const [quality, items] of Object.entries(byQuality)) {
      if (items.length === 0) continue;
      const values = items.map(i => i[factor.key]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      report += `     ${quality}: ${avg.toFixed(2)}\n`;
    }
  }

  // 写入文件
  const filename = 'twitter_analysis_detailed_v2.txt';
  const fs = require('fs');
  fs.writeFileSync(filename, report, 'utf8');

  console.log(`报告已导出到: ${filename}`);
  console.log(`总字数: ${report.length}`);
}

exportDetailedData().catch(console.error);
