import fs from 'fs';

/**
 * 使用新获取的人工标注推文数据重新分析
 */
class NarrativeAnalyzerV3 {
  constructor() {
    this.highImpactAccounts = [
      'cz_binance', 'binance', 'elonmusk', 'vitalikbuterin',
      'balajis', 'saylor', 'michael_saylor', 'justinsuntron',
      'rogerkver', 'aantonop', 'naval'
    ];
  }

  isHighImpact(tweet) {
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();
    return this.highImpactAccounts.some(acc =>
      userName.includes(acc) || screenName.includes(acc)
    );
  }

  analyzeTweet(tweet) {
    const score = {
      token: tweet.token,
      tweet_id: tweet.tweet_id,
      text: tweet.text,
      user: tweet.user,
      user_screen_name: tweet.user_screen_name,
      human_category: tweet.human_category,
      scores: {},
      total_score: 0,
      category: null
    };

    const isHighImpact = this.isHighImpact(tweet);

    score.scores.content = this.analyzeContent(tweet);
    score.scores.credibility = this.analyzeCredibility(tweet);
    score.scores.virality = this.analyzeVirality(tweet, isHighImpact);
    score.scores.completeness = this.analyzeCompleteness(tweet);

    score.total_score = Object.values(score.scores).reduce((a, b) => a + b, 0);
    score.category = this.categorize(score.total_score);

    return score;
  }

  analyzeContent(tweet) {
    let score = 0;
    const text = tweet.text || '';
    const hasTheme = /推出|发布|上线|launch|new|next|版|v\d|猫|狗|meme|ai|web3|爆|火|热搜/i.test(text);
    if (hasTheme) score += 15;
    const hasInfo = /https?:\/\/[^\s]+/.test(text) || /\d+/.test(text) || /@[\w]+/.test(text);
    if (hasInfo) score += 10;
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 30 && /[^\x00-\x7F]/.test(text)) score += 10;
    else if (wordCount >= 20) score += 10;
    return Math.min(score, 35);
  }

  analyzeCredibility(tweet) {
    let score = 0;
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();
    const official = ['binance', 'coinbase', 'cz_binance', 'pancakeswap', 'fourmeme', 'gate.io', 'okx', 'kucoin'];
    if (official.some(o => userName.includes(o) || screenName.includes(o))) score += 20;
    if (/https?:\/\/[^\s]+/.test(tweet.text)) score += 10;
    return Math.min(score, 30);
  }

  analyzeVirality(tweet, isHighImpact) {
    let score = 0;
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);
    if (engagement >= 100) score += 15;
    else if (engagement >= 10) score += 8;
    else if (engagement > 0) score += 3;
    if (isHighImpact) score += 5;
    return Math.min(score, 20);
  }

  analyzeCompleteness(tweet) {
    let score = 0;
    if (/https?:\/\/[^\s]+/.test(tweet.text)) score += 8;
    if (tweet.media || tweet.entities?.media) score += 7;
    return Math.min(score, 15);
  }

  categorize(totalScore) {
    if (totalScore >= 60) return 'high';
    if (totalScore >= 40) return 'mid';
    return 'low';
  }

  analyzeAll() {
    console.log('=== 使用人工标注推文数据重新分析 ===\n');

    const tweets = JSON.parse(fs.readFileSync('data/human_tweets_with_content.json', 'utf-8'));
    const results = tweets.map(t => this.analyzeTweet(t));

    fs.writeFileSync(
      'data/human_narrative_scores.json',
      JSON.stringify(results, null, 2)
    );

    // 统计
    const stats = { high: 0, mid: 0, low: 0 };
    results.forEach(r => stats[r.category]++);

    console.log('=== 机器评分分布 ===');
    console.log(`高质量: ${stats.high} (${(stats.high/results.length*100).toFixed(1)}%)`);
    console.log(`中质量: ${stats.mid} (${(stats.mid/results.length*100).toFixed(1)}%)`);
    console.log(`低质量: ${stats.low} (${(stats.low/results.length*100).toFixed(1)}%)`);

    // 与人工标注对比
    this.compare(results);

    return results;
  }

  compare(results) {
    console.log('\n=== 与人工标注对比 ===\n');

    const comparison = {
      high_high: [], high_mid: [], high_low: [],
      mid_high: [], mid_mid: [], mid_low: [],
      low_high: [], low_mid: [], low_low: []
    };

    results.forEach(r => {
      if (!r.human_category) return;
      const key = `${r.human_category.split('_')[0]}_${r.category}`;
      comparison[key].push(r);
    });

    // 打印交叉表
    console.log('         机器高  机器中  机器低');
    console.log(`人工高    ${comparison.high_high.length}      ${comparison.high_mid.length}      ${comparison.high_low.length}`);
    console.log(`人工中    ${comparison.mid_high.length}      ${comparison.mid_mid.length}      ${comparison.mid_low.length}`);
    console.log(`人工低    ${comparison.low_high.length}      ${comparison.low_mid.length}      ${comparison.low_low.length}`);

    const total = Object.values(comparison).reduce((sum, arr) => sum + arr.length, 0);
    const agree = comparison.high_high.length + comparison.mid_mid.length + comparison.low_low.length;
    const directionAgree =
      comparison.high_high.length + comparison.high_mid.length +
      comparison.mid_high.length + comparison.mid_mid.length + comparison.mid_low.length +
      comparison.low_mid.length + comparison.low_low.length;

    console.log(`\n完全一致率: ${agree}/${total} (${(agree/total*100).toFixed(1)}%)`);
    console.log(`方向一致率: ${directionAgree}/${total} (${(directionAgree/total*100).toFixed(1)}%)`);

    // 严重误判
    if (comparison.high_low.length > 0) {
      console.log('\n⚠️ 人工高→机器低 (严重误判):');
      comparison.high_low.forEach(r => {
        console.log(`  ${r.token} (${r.total_score}分): ${r.text.substring(0, 60)}...`);
      });
    }

    if (comparison.low_high.length > 0) {
      console.log('\n⚠️ 人工低→机器高 (过度乐观):');
      comparison.low_high.forEach(r => {
        console.log(`  ${r.token} (${r.total_score}分): ${r.text.substring(0, 60)}...`);
      });
    }

    return comparison;
  }
}

// 执行
new NarrativeAnalyzerV3().analyzeAll();
