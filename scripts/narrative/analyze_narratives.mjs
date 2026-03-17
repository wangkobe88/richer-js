import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '../../config/.env' });

/**
 * 叙事质量分析器
 */
class NarrativeAnalyzer {
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

    // 2. 可信度 (25分)
    score.scores.credibility = this.analyzeCredibility(tweet);
    score.total_score += score.scores.credibility;

    // 3. 吸引力 (20分)
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
   * 分析叙事清晰度
   */
  analyzeClarity(tweet) {
    let score = 0;
    const reasons = [];

    const text = tweet.text || '';
    const wordCount = text.split(/\s+/).length;

    // 基础长度检查 (5分)
    if (wordCount >= 10 && wordCount <= 200) {
      score += 5;
    } else if (wordCount > 200) {
      score += 3; // 太长可能冗余
    }

    // 是否有明确主题 (10分)
    const hasTheme = /推出|发布|上线|launch|unveil|introduce/i.test(text) ||
                      /新增|新功能|new|feature/i.test(text) ||
                      /第|版本|V\d+|No\.|第\d+/i.test(text);
    if (hasTheme) {
      score += 10;
      reasons.push('有明确主题');
    }

    // 是否有具体信息 (10分)
    const hasDetails = /https?:\/\/[^\s]+/.test(text) || // 有链接
                      /\d+[美元万亿]/i.test(text) || // 有数字
                      /@[\w]+/.test(text); // 有提及
    if (hasDetails) {
      score += 10;
      reasons.push('有具体信息');
    }

    // 是否有故事性 (5分)
    const hasStory = /关于|关于|故事|story|背景|background/i.test(text) ||
                    /由来|历史|history|origin/i.test(text) ||
                    /因为|所以|thus|therefore/i.test(text);
    if (hasStory) {
      score += 5;
      reasons.push('有故事线');
    }

    this.scores.push({ ...score, reasons, dimension: 'clarity' });
    return score;
  }

  /**
   * 分析可信度
   */
  analyzeCredibility(tweet) {
    let score = 0;
    const reasons = [];

    // 官方账号 (15分)
    const officialAccounts = /binance|coinbase|pancakeswap|fourmeme|gate\.io|okx/i;
    if (officialAccounts.test(tweet.user || '') || officialAccounts.test(tweet.user_screen_name || '')) {
      score += 15;
      reasons.push('官方账号');
    }

    // 知名媒体/机构 (10分)
    const media = /reuters|bloomberg|wsj|ft|cnn|bbc|techcrunch|coindesk|theblock/i;
    if (media.test(tweet.user || '')) {
      score += 10;
      reasons.push('知名媒体');
    }

    // 引用官方来源 (5分)
    const hasOfficialSource = /according|report|says|announces/i.test(tweet.text);
    if (hasOfficialSource) {
      score += 5;
      reasons.push('引用来源');
    }

    this.scores.push({ ...score, reasons, dimension: 'credibility' });
    return score;
  }

  /**
   * 分析吸引力
   */
  analyzeAppeal(tweet) {
    let score = 0;
    const reasons = [];

    // 互动数据 (15分)
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);
    if (engagement >= 1000) {
      score += 15;
      reasons.push('高互动');
    } else if (engagement >= 100) {
      score += 10;
      reasons.push('中等互动');
    } else if (engagement >= 10) {
      score += 5;
    }

    // 积极情感 (5分)
    const positive = /good|great|amazing|awesome|exciting|revolutionary|breakthrough/i;
    if (positive.test(tweet.text)) {
      score += 5;
      reasons.push('积极情感');
    }

    this.scores.push({ ...score, reasons, dimension: 'appeal' });
    return score;
  }

  /**
   * 分析时效性
   */
  analyzeTimeliness(tweet) {
    let score = 0;
    const reasons = [];

    // 检查推文时间
    if (tweet.created_at) {
      const tweetDate = new Date(tweet.created_at);
      const now = new Date();
      const daysDiff = (now - tweetDate) / (1000 * 60 * 60 * 24);

      // 7天内的推文 (15分)
      if (daysDiff <= 7) {
        score += 15;
        reasons.push('最新消息');
      }
      // 30天内 (10分)
      else if (daysDiff <= 30) {
        score += 10;
        reasons.push('近期消息');
      }
      // 90天内 (5分)
      else if (daysDiff <= 90) {
        score += 5;
      }
    }

    // 是否有"最新"、"刚刚"等词 (额外5分)
    if (/just|now|latest|breaking|newly/i.test(tweet.text)) {
      score = Math.min(score + 5, 15);
      reasons.push('时效性关键词');
    }

    this.scores.push({ ...score, reasons, dimension: 'timeliness' });
    return score;
  }

  /**
   * 分析完整性
   */
  analyzeCompleteness(tweet) {
    let score = 0;
    const reasons = [];

    // 有链接 (5分)
    if (/https?:\/\/[^\s]+/.test(tweet.text)) {
      score += 5;
      reasons.push('有链接');
    }

    // 有图片/视频 (5分)
    if (tweet.media || tweet.entities?.media) {
      score += 5;
      reasons.push('有媒体');
    }

    this.scores.push({ ...score, reasons, dimension: 'completeness' });
    return score;
  }

  /**
   * 根据总分分类
   */
  categorize(totalScore) {
    if (totalScore >= 75) return 'high';
    if (totalScore >= 50) return 'mid';
    return 'low';
  }

  /**
   * 生成分类说明
   */
  getCategoryExplanation(category) {
    const explanations = {
      high: '【高质量】叙事清晰、可信度高、有较强吸引力',
      mid: '【中质量】叙事有一定内容，但不够完整或吸引力一般',
      low: '【低质量】叙事模糊、缺乏实质内容或可信度低'
    };
    return explanations[category];
  }

  /**
   * 分析所有推文
   */
  async analyzeAll() {
    console.log('=== 开始叙事分析 ===\n');

    // 读取推文内容
    const tweets = JSON.parse(fs.readFileSync('narrative_analysis/tweets_with_content.json', 'utf-8'));
    console.log('推文数量:', tweets.length);

    // 分析每条推文
    const results = tweets.map(tweet => this.analyzeTweet(tweet));

    // 保存结果
    fs.writeFileSync(
      'narrative_analysis/narrative_scores.json',
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
      .slice(0, 3);

    highScores.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.token} (${r.total_score}分)`);
      console.log(`   ${r.text.substring(0, 80)}...`);
      console.log(`   分类: ${this.getCategoryExplanation(r.category)}`);
    });

    console.log('\n=== 低质量示例 ===');
    const lowScores = results.filter(r => r.category === 'low')
      .sort((a, b) => a.total_score - b.total_score)
      .slice(0, 3);

    lowScores.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.token} (${r.total_score}分)`);
      console.log(`   ${r.text.substring(0, 80)}...`);
      console.log(`   问题: ${Object.entries(r.scores)
        .filter(([k, v]) => v < (k === 'timeliness' ? 10 : 5))
        .map(([k]) => k)
        .join(', ')}`);
    });

    return results;
  }
}

// 执行分析
const analyzer = new NarrativeAnalyzer();
analyzer.analyzeAll()
  .then(() => {
    console.log('\n分析完成！');
    console.log('结果已保存到 narrative_analysis/narrative_scores.json');
    process.exit(0);
  })
  .catch(err => {
    console.error('错误:', err);
    process.exit(1);
  });
