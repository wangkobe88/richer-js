import fs from 'fs';

/**
 * 叙事质量分析器 V2 - 改进版
 * 基于人工标注对比分析调整评分标准
 */
class NarrativeAnalyzerV2 {
  constructor() {
    this.scores = [];
  }

  /**
   * 分析单条推文的叙事质量
   */
  analyzeTweet(tweet) {
    const score = {
      token: tweet.token,
      tweet_id: tweet.tweet_id,
      text: tweet.text,
      scores: {},
      total_score: 0,
      category: null,
      reasons: []
    };

    // 1. 叙事清晰度 (30分)
    score.scores.clarity = this.analyzeClarity(tweet);
    score.total_score += score.scores.clarity;

    // 2. 可信度 (25分) - 放宽标准
    score.scores.credibility = this.analyzeCredibility(tweet);
    score.total_score += score.scores.credibility;

    // 3. 吸引力 (20分) - 降低互动要求
    score.scores.appeal = this.analyzeAppeal(tweet);
    score.total_score += score.scores.appeal;

    // 4. 时效性 (15分)
    score.scores.timeliness = this.analyzeTimeliness(tweet);
    score.total_score += score.scores.timeliness;

    // 5. 完整性 (10分)
    score.scores.completeness = this.analyzeCompleteness(tweet);
    score.total_score += score.scores.completeness;

    // 分类
    score.category = this.categorize(score.total_score);

    return score;
  }

  /**
   * 分析叙事清晰度 - V2改进
   */
  analyzeClarity(tweet) {
    let score = 0;
    const reasons = [];
    const text = tweet.text || '';
    const wordCount = text.split(/\s+/).length;

    // 基础长度检查 (5分) - 更宽松
    if (wordCount >= 5) {
      score += 5;
    }

    // 是否有明确主题或概念 (15分) - 大幅提高权重
    const themePatterns = [
      // 产品/功能类
      /推出|发布|上线|launch|unveil|introduce|new/i,
      // 对比/比较类
      /下一个|next|类似|like|版|version/i,
      // 成就/数据类
      /万|千|\d+k|\d+m/i,
      // 概念/故事类
      /猫|狗|动物|meme|ai|web3|crypto/i
    ];

    const hasTheme = themePatterns.some(p => p.test(text));
    if (hasTheme) {
      score += 15;
      reasons.push('有明确主题/概念');
    }

    // 是否有具体信息 (8分)
    const hasDetails = /https?:\/\/[^\s]+/.test(text) || // 有链接
                      /\d+/.test(text) || // 有数字
                      /@[\w]+/.test(text); // 有提及
    if (hasDetails) {
      score += 8;
      reasons.push('有具体信息');
    }

    // 简洁但有力 (2分) - 修复对CZ类推文的误判
    if (wordCount < 20 && /[^\x00-\x7F]/.test(text)) { // 简短中文
      score += 2;
      reasons.push('简洁有力');
    }

    return score;
  }

  /**
   * 分析可信度 - V2改进
   */
  analyzeCredibility(tweet) {
    let score = 0;
    const reasons = [];
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();

    // 官方账号/交易所 (15分)
    const officialAccounts = [
      'binance', 'coinbase', 'cz_binance', 'pancakeswap', 'fourmeme',
      'gate\\.io', 'okx', 'kucoin', 'bybit'
    ];
    if (officialAccounts.some(acc => new RegExp(acc, 'i').test(userName + ' ' + screenName))) {
      score += 15;
      reasons.push('官方/交易所账号');
    }

    // 知名媒体/机构 (10分)
    const media = ['reuters', 'bloomberg', 'wsj', 'ft', 'cnn', 'bbc',
                   'techcrunch', 'coindesk', 'theblock', 'coinmarketcap'];
    if (media.some(m => new RegExp(m, 'i').test(userName))) {
      score += 10;
      reasons.push('知名媒体');
    }

    // 引用数据/来源 (5分)
    const hasSource = /according|report|says|announces|based on/i.test(tweet.text);
    if (hasSource) {
      score += 5;
      reasons.push('引用来源');
    }

    // 有链接到外部来源 (5分) - 降低门槛
    if (/https?:\/\/[^\s]+/.test(tweet.text)) {
      score += 5;
      reasons.push('有来源链接');
    }

    return Math.min(score, 25);
  }

  /**
   * 分析吸引力 - V2改进
   */
  analyzeAppeal(tweet) {
    let score = 0;
    const reasons = [];

    // 互动数据 (10分) - 降低要求
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);
    if (engagement >= 500) {
      score += 10;
      reasons.push('高互动');
    } else if (engagement >= 50) {
      score += 6;
      reasons.push('中等互动');
    } else if (engagement >= 5) {
      score += 3;
    }

    // 积极情感 (5分)
    const positive = /good|great|amazing|awesome|exciting|revolutionary|breakthrough|blow|moon/i;
    if (positive.test(tweet.text)) {
      score += 5;
      reasons.push('积极情感');
    }

    // 话题性/热点 (5分)
    const hotTopic = /next|new|latest|breaking|trend|viral|b|blowing|爆/i;
    if (hotTopic.test(tweet.text)) {
      score += 5;
      reasons.push('话题性');
    }

    return Math.min(score, 20);
  }

  /**
   * 分析时效性 - V2改进
   */
  analyzeTimeliness(tweet) {
    let score = 0;
    const reasons = [];

    // 检查推文时间
    if (tweet.created_at) {
      const tweetDate = new Date(tweet.created_at);
      const now = new Date();
      const daysDiff = (now - tweetDate) / (1000 * 60 * 60 * 24);

      // 30天内的推文 (15分) - 放宽到30天
      if (daysDiff <= 30) {
        score += 15;
        reasons.push('近期消息');
      }
      // 90天内 (10分)
      else if (daysDiff <= 90) {
        score += 10;
      }
      // 180天内 (5分)
      else if (daysDiff <= 180) {
        score += 5;
      }
    }

    return score;
  }

  /**
   * 分析完整性
   */
  analyzeCompleteness(tweet) {
    let score = 0;

    // 有链接 (5分)
    if (/https?:\/\/[^\s]+/.test(tweet.text)) {
      score += 5;
    }

    // 有图片/视频 (5分)
    if (tweet.media || tweet.entities?.media) {
      score += 5;
    }

    return score;
  }

  /**
   * 根据总分分类 - V2调整阈值
   */
  categorize(totalScore) {
    if (totalScore >= 60) return 'high';  // 降低从75到60
    if (totalScore >= 40) return 'mid';   // 降低从50到40
    return 'low';
  }

  /**
   * 分析所有推文
   */
  async analyzeAll() {
    console.log('=== 开始叙事分析 V2 ===\n');

    const tweets = JSON.parse(fs.readFileSync('narrative_analysis/tweets_with_content.json', 'utf-8'));
    console.log('推文数量:', tweets.length);

    const results = tweets.map(tweet => this.analyzeTweet(tweet));

    // 保存结果
    fs.writeFileSync(
      'narrative_analysis/narrative_scores_v2.json',
      JSON.stringify(results, null, 2)
    );

    // 统计
    const stats = {
      high: results.filter(r => r.category === 'high').length,
      mid: results.filter(r => r.category === 'mid').length,
      low: results.filter(r => r.category === 'low').length
    };

    console.log('\n=== 评分统计 ===');
    console.log('高质量:', stats.high);
    console.log('中质量:', stats.mid);
    console.log('低质量:', stats.low);

    // 显示示例
    console.log('\n=== 高质量示例 ===');
    const highScores = results.filter(r => r.category === 'high')
      .sort((a, b) => b.total_score - a.total_score)
      .slice(0, 5);

    highScores.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.token} (${r.total_score}分)`);
      console.log(`   作者: ${r.user} (@${r.user_screen_name})`);
      console.log(`   内容: ${r.text.substring(0, 100)}...`);
    });

    return results;
  }
}

// 执行分析
const analyzer = new NarrativeAnalyzerV2();
try {
  analyzer.analyzeAll();
  console.log('\n分析完成！');
  console.log('结果已保存到 narrative_analysis/narrative_scores_v2.json');
  process.exit(0);
} catch (err) {
  console.error('错误:', err);
  process.exit(1);
}
