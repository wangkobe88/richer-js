import fs from 'fs';

/**
 * 综合叙事评分 (Twitter + Intro)
 */
class CombinedNarrativeScorer {
  constructor() {
    this.highImpactAccounts = [
      'cz_binance', 'binance', 'elonmusk', 'vitalikbuterin',
      'balajis', 'saylor', 'michael_saylor', 'justinsuntron'
    ];
  }

  isHighImpact(tweet) {
    if (!tweet) return false;
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();
    return this.highImpactAccounts.some(acc =>
      userName.includes(acc) || screenName.includes(acc)
    );
  }

  /**
   * 综合评分 - 结合Twitter和Intro
   */
  scoreToken(narrative) {
    const scores = {
      content: this.scoreContent(narrative),
      credibility: this.scoreCredibility(narrative),
      virality: this.scoreVirality(narrative),
      completeness: this.scoreCompleteness(narrative)
    };

    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    let category;
    if (total >= 60) category = 'high';
    else if (total >= 40) category = 'mid';
    else category = 'low';

    return { scores, total, category };
  }

  /**
   * 内容质量 - 结合Twitter文本和Intro
   */
  scoreContent(narrative) {
    let score = 0;

    // 合并所有文本内容
    const twitterText = narrative.twitterText || '';
    const introText = narrative.introEn || narrative.introCn || '';
    const combinedText = `${twitterText} ${introText}`;

    const wordCount = combinedText.split(/\s+/).length;

    // 主题明确度 (15分)
    const hasTheme = /推出|发布|上线|launch|new|next|版|v\d|猫|狗|meme|ai|web3|爆|火|热搜|效应|大学|平台|代币|token|币安/i.test(combinedText);
    if (hasTheme) score += 15;

    // 信息量 (10分)
    const hasInfo = /https?:\/\/[^\s]+/.test(combinedText) ||
                    /\d+/.test(combinedText) ||
                    /@[\w]+/.test(combinedText);
    if (hasInfo) score += 10;

    // 文本长度 (10分)
    if (wordCount >= 10) score += 10;
    else if (wordCount >= 5) score += 5;

    return Math.min(score, 35);
  }

  /**
   * 可信度
   */
  scoreCredibility(narrative) {
    let score = 0;

    // 官方账号 (20分)
    if (narrative.twitterText && this.isHighImpact({
      user: narrative.user,
      user_screen_name: narrative.user_screen_name
    })) {
      score += 20;
    }

    // 有外部链接 (10分)
    if (narrative.twitterText && /https?:\/\/[^\s]+/.test(narrative.twitterText)) {
      score += 5;
    }
    if (narrative.website) {
      score += 5;
    }

    return Math.min(score, 30);
  }

  /**
   * 传播力
   */
  scoreVirality(narrative) {
    let score = 0;

    // Twitter互动数据
    if (narrative.twitterText) {
      const engagement = (narrative.favorite_count || 0) + (narrative.retweet_count || 0);
      if (engagement >= 100) score += 15;
      else if (engagement >= 10) score += 8;
      else if (engagement > 0) score += 3;
    }

    // 高影响力账号加分
    if (this.isHighImpact(narrative)) {
      score += 5;
    }

    // 提到热点平台 (TikTok, 抖音, 微博等)
    const hasHotPlatform = (narrative.introCn || narrative.introEn || '') +
                          (narrative.tiktok || '');
    if (/tiktok|抖音|微博|热搜|爆火/i.test(hasHotPlatform)) {
      score += 5;
    }

    return Math.min(score, 20);
  }

  /**
   * 完整性
   */
  scoreCompleteness(narrative) {
    let score = 0;

    // 有Twitter内容
    if (narrative.twitterText) score += 5;

    // 有Intro
    if (narrative.introCn || narrative.introEn) score += 5;

    // 有外部链接
    if (narrative.website || narrative.tiktok) score += 3;
    if (narrative.twitterText && /https?:\/\/[^\s]+/.test(narrative.twitterText)) score += 2;

    return Math.min(score, 15);
  }

  analyze() {
    const data = JSON.parse(fs.readFileSync('../../narrative_analysis/all_narratives_combined.json', 'utf-8'));

    const results = {};
    const lowQualityTokens = new Set();

    console.log('=== 综合叙事评分 (Twitter + Intro) ===\n');

    for (const [expId, expData] of Object.entries(data)) {
      results[expId] = {
        expId: expData.expId,
        tokens: []
      };

      for (const token of expData.tokens) {
        const scoring = this.scoreToken(token);

        results[expId].tokens.push({
          address: token.address,
          symbol: token.symbol,
          twitterText: token.twitterText,
          introEn: token.introEn,
          introCn: token.introCn,
          narrative_score: scoring.total,
          narrative_category: scoring.category,
          scores: scoring.scores
        });

        if (scoring.category === 'low') {
          lowQualityTokens.add(token.address);
        }
      }

      results[expId].tokens.sort((a, b) => b.narrative_score - a.narrative_score);
    }

    this.printStats(results, lowQualityTokens);

    fs.writeFileSync(
      '../../narrative_analysis/combined_narrative_scores.json',
      JSON.stringify(results, null, 2)
    );

    fs.writeFileSync(
      '../../narrative_analysis/low_quality_tokens_combined.json',
      JSON.stringify([...lowQualityTokens], null, 2)
    );

    console.log('\n结果已保存');
    return { results, lowQualityTokens };
  }

  printStats(results, lowQualityTokens) {
    console.log('\n=== 综合叙事评分统计 ===\n');

    let totalTokens = 0;
    let highCount = 0, midCount = 0, lowCount = 0;

    for (const [expId, expData] of Object.entries(results)) {
      console.log(`实验 ${expId}:`);
      console.log(`  总代币数: ${expData.tokens.length}`);

      const high = expData.tokens.filter(t => t.narrative_category === 'high').length;
      const mid = expData.tokens.filter(t => t.narrative_category === 'mid').length;
      const low = expData.tokens.filter(t => t.narrative_category === 'low').length;

      highCount += high;
      midCount += mid;
      lowCount += low;
      totalTokens += expData.tokens.length;

      console.log(`  高质量: ${high}, 中质量: ${mid}, 低质量: ${low}`);
    }

    console.log(`\n=== 总计 ===`);
    console.log(`总代币数: ${totalTokens}`);
    console.log(`高质量: ${highCount} (${(highCount/totalTokens*100).toFixed(1)}%)`);
    console.log(`中质量: ${midCount} (${(midCount/totalTokens*100).toFixed(1)}%)`);
    console.log(`低质量: ${lowCount} (${(lowCount/totalTokens*100).toFixed(1)}%)`);
    console.log(`\n需要过滤: ${lowQualityTokens.size} 个代币`);
  }
}

// 执行
try {
  new CombinedNarrativeScorer().analyze();
  process.exit(0);
} catch (err) {
  console.error('错误:', err);
  process.exit(1);
}
