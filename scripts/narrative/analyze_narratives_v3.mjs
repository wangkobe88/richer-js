import fs from 'fs';

/**
 * 叙事质量分析器 V3 - 最终版
 * 核心改进：
 * 1. 考虑作者影响力，对知名人物降低时效性要求
 * 2. 简化评分维度，提高可解释性
 */
class NarrativeAnalyzerV3 {
  constructor() {
    // 高影响力账号列表（时效性要求降低）
    this.highImpactAccounts = [
      'cz_binance', 'binance', 'elonmusk', 'vitalikbuterin',
      'balajis', 'saylor', 'michael_saylor', 'justinsuntron',
      'rogerkver', 'aantonop', 'naval', 'peter Schiff'
    ];
  }

  /**
   * 分析单条推文
   */
  analyzeTweet(tweet) {
    const score = {
      token: tweet.token,
      tweet_id: tweet.tweet_id,
      text: tweet.text,
      user: tweet.user,
      user_screen_name: tweet.user_screen_name,
      scores: {},
      total_score: 0,
      category: null
    };

    // 判断是否为高影响力账号
    const isHighImpact = this.isHighImpact(tweet);

    // 1. 内容质量 (35分) - 合并清晰度和完整性
    score.scores.content = this.analyzeContent(tweet);
    score.total_score += score.scores.content;

    // 2. 可信度 (30分) - 提高权重
    score.scores.credibility = this.analyzeCredibility(tweet);
    score.total_score += score.scores.credibility;

    // 3. 传播力 (20分) - 合并吸引力和时效性
    score.scores.virality = this.analyzeVirality(tweet, isHighImpact);
    score.total_score += score.scores.virality;

    // 4. 完整性 (15分)
    score.scores.completeness = this.analyzeCompleteness(tweet);
    score.total_score += score.scores.completeness;

    score.category = this.categorize(score.total_score);
    return score;
  }

  /**
   * 判断是否为高影响力账号
   */
  isHighImpact(tweet) {
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();
    return this.highImpactAccounts.some(acc =>
      userName.includes(acc) || screenName.includes(acc)
    );
  }

  /**
   * 分析内容质量
   */
  analyzeContent(tweet) {
    let score = 0;
    const text = tweet.text || '';

    // 主题明确度 (15分)
    const hasTheme = /推出|发布|上线|launch|new|next|版|v\d|猫|狗|meme|ai|web3/i.test(text);
    if (hasTheme) score += 15;

    // 信息量 (10分)
    const hasInfo = /https?:\/\/[^\s]+/.test(text) || /\d+/.test(text) || /@[\w]+/.test(text);
    if (hasInfo) score += 10;

    // 简洁有力或故事完整 (10分)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 30 && /[^\x00-\x7F]/.test(text)) {
      score += 10; // 简短中文（如CZ的推文）
    } else if (wordCount >= 20) {
      score += 10; // 足够长度
    }

    return Math.min(score, 35);
  }

  /**
   * 分析可信度
   */
  analyzeCredibility(tweet) {
    let score = 0;
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();

    // 官方/知名机构 (20分)
    const official = ['binance', 'coinbase', 'cz_binance', 'pancakeswap',
                      'fourmeme', 'gate.io', 'okx', 'kucoin'];
    if (official.some(o => userName.includes(o) || screenName.includes(o))) {
      score += 20;
    }

    // 知名媒体 (15分)
    const media = ['reuters', 'bloomberg', 'coindesk', 'theblock', 'cointelegraph'];
    if (media.some(m => userName.includes(m))) {
      score += 15;
    }

    // 引用来源 (10分)
    if (/according|report|announces|official/i.test(tweet.text)) {
      score += 10;
    }

    // 有外部链接 (10分)
    if (/https?:\/\/[^\s]+/.test(tweet.text)) {
      score += 10;
    }

    return Math.min(score, 30);
  }

  /**
   * 分析传播力
   */
  analyzeVirality(tweet, isHighImpact) {
    let score = 0;

    // 互动数据 (15分) - 降低门槛
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);
    if (engagement >= 100) score += 15;
    else if (engagement >= 10) score += 8;
    else if (engagement > 0) score += 3;

    // 高影响力账号加分 (5分)
    if (isHighImpact) score += 5;

    // 时效性 (对于高影响力账号降低要求)
    if (tweet.created_at) {
      const daysDiff = (new Date() - new Date(tweet.created_at)) / (1000 * 60 * 60 * 24);
      if (isHighImpact) {
        // 高影响力账号：180天内即可
        if (daysDiff <= 180) score += 5;
      } else {
        // 普通账号：30天内
        if (daysDiff <= 30) score += 5;
      }
    }

    return Math.min(score, 20);
  }

  /**
   * 分析完整性
   */
  analyzeCompleteness(tweet) {
    let score = 0;
    if (/https?:\/\/[^\s]+/.test(tweet.text)) score += 8;
    if (tweet.media || tweet.entities?.media) score += 7;
    return Math.min(score, 15);
  }

  /**
   * 分类
   */
  categorize(totalScore) {
    if (totalScore >= 60) return 'high';
    if (totalScore >= 40) return 'mid';
    return 'low';
  }

  /**
   * 分析所有推文
   */
  async analyzeAll() {
    console.log('=== 叙事分析 V3 (最终版) ===\n');

    const tweets = JSON.parse(fs.readFileSync('narrative_analysis/tweets_with_content.json', 'utf-8'));
    const results = tweets.map(t => this.analyzeTweet(t));

    fs.writeFileSync(
      'narrative_analysis/narrative_scores_v3.json',
      JSON.stringify(results, null, 2)
    );

    const stats = {
      high: results.filter(r => r.category === 'high').length,
      mid: results.filter(r => r.category === 'mid').length,
      low: results.filter(r => r.category === 'low').length
    };

    console.log('=== 评分统计 ===');
    console.log('高质量:', stats.high, `(${(stats.high/results.length*100).toFixed(1)}%)`);
    console.log('中质量:', stats.mid, `(${(stats.mid/results.length*100).toFixed(1)}%)`);
    console.log('低质量:', stats.low, `(${(stats.low/results.length*100).toFixed(1)}%)`);

    // 高质量示例
    console.log('\n=== 高质量示例 ===');
    results.filter(r => r.category === 'high')
      .sort((a, b) => b.total_score - a.total_score)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`\n${i + 1}. ${r.token} (${r.total_score}分)`);
        console.log(`   作者: ${r.user || 'N/A'} (@${r.user_screen_name || 'N/A'})`);
        console.log(`   内容: ${r.text.substring(0, 80)}...`);
      });

    return results;
  }
}

// 执行
try {
  new NarrativeAnalyzerV3().analyzeAll();
  console.log('\n完成！结果已保存到 narrative_analysis/narrative_scores_v3.json');
  process.exit(0);
} catch (err) {
  console.error('错误:', err);
  process.exit(1);
}
