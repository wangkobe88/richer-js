import fs from 'fs';

/**
 * 对实验中的交易代币进行叙事评分
 */
class ExperimentNarrativeScorer {
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

  scoreTweet(tweet) {
    const scores = {
      content: this.scoreContent(tweet),
      credibility: this.scoreCredibility(tweet),
      virality: this.scoreVirality(tweet),
      completeness: this.scoreCompleteness(tweet)
    };

    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    let category;
    if (total >= 60) category = 'high';
    else if (total >= 40) category = 'mid';
    else category = 'low';

    return { scores, total, category };
  }

  scoreContent(tweet) {
    let score = 0;
    const text = tweet.text || '';
    const hasTheme = /推出|发布|上线|launch|new|next|版|v\d|猫|狗|meme|ai|web3|爆|火|热搜|效应|大学|平台/i.test(text);
    if (hasTheme) score += 15;
    const hasInfo = /https?:\/\/[^\s]+/.test(text) || /\d+/.test(text) || /@[\w]+/.test(text);
    if (hasInfo) score += 10;
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 30 && /[^\x00-\x7F]/.test(text)) score += 10;
    else if (wordCount >= 20) score += 10;
    return Math.min(score, 35);
  }

  scoreCredibility(tweet) {
    let score = 0;
    const userName = (tweet.user || '').toLowerCase();
    const screenName = (tweet.user_screen_name || '').toLowerCase();
    const official = ['binance', 'coinbase', 'cz_binance', 'pancakeswap', 'fourmeme', 'gate.io', 'okx', 'kucoin'];
    if (official.some(o => userName.includes(o) || screenName.includes(o))) score += 20;
    if (/https?:\/\/[^\s]+/.test(tweet.text)) score += 10;
    return Math.min(score, 30);
  }

  scoreVirality(tweet) {
    let score = 0;
    const isHighImpact = this.isHighImpact(tweet);
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);
    if (engagement >= 100) score += 15;
    else if (engagement >= 10) score += 8;
    else if (engagement > 0) score += 3;
    if (isHighImpact) score += 5;
    return Math.min(score, 20);
  }

  scoreCompleteness(tweet) {
    let score = 0;
    if (/https?:\/\/[^\s]+/.test(tweet.text)) score += 8;
    if (tweet.media || tweet.entities?.media) score += 7;
    return Math.min(score, 15);
  }

  analyze() {
    const data = JSON.parse(fs.readFileSync('narrative_analysis/experiment_tweets_with_content.json', 'utf-8'));

    const results = {};

    for (const [expId, expData] of Object.entries(data)) {
      results[expId] = {
        expId: expData.expId,
        tokens: []
      };

      for (const token of expData.tokens) {
        const scoring = this.scoreTweet(token);

        results[expId].tokens.push({
          address: token.address,
          symbol: token.symbol,
          tweet_id: token.tweet_id,
          text: token.text,
          user: token.user,
          user_screen_name: token.user_screen_name,
          narrative_score: scoring.total,
          narrative_category: scoring.category,
          scores: scoring.scores
        });
      }

      // 排序：按评分从高到低
      results[expId].tokens.sort((a, b) => b.narrative_score - a.narrative_score);
    }

    // 打印统计
    this.printStats(results);

    // 保存结果
    fs.writeFileSync(
      'narrative_analysis/experiment_narrative_scores.json',
      JSON.stringify(results, null, 2)
    );

    console.log('\n结果已保存到 narrative_analysis/experiment_narrative_scores.json');

    return results;
  }

  printStats(results) {
    console.log('\n=== 叙事评分统计 ===\n');

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

      // 显示每个代币的评分
      console.log('  代币评分:');
      expData.tokens.forEach(t => {
        console.log(`    ${t.symbol}: ${t.narrative_score}分 (${t.narrative_category}) - ${t.text.substring(0, 40)}...`);
      });
      console.log('');
    }

    console.log(`=== 总计 ===`);
    console.log(`总代币数: ${totalTokens}`);
    console.log(`高质量: ${highCount} (${(highCount/totalTokens*100).toFixed(1)}%)`);
    console.log(`中质量: ${midCount} (${(midCount/totalTokens*100).toFixed(1)}%)`);
    console.log(`低质量: ${lowCount} (${(lowCount/totalTokens*100).toFixed(1)}%)`);

    // 列出低质量代币
    console.log('\n=== 低质量叙事代币（将被过滤）===');
    for (const [expId, expData] of Object.entries(results)) {
      const lowTokens = expData.tokens.filter(t => t.narrative_category === 'low');
      if (lowTokens.length > 0) {
        console.log(`\n实验 ${expId}:`);
        lowTokens.forEach(t => {
          console.log(`  ${t.symbol} (${t.address}): ${t.narrative_score}分`);
        });
      }
    }
  }
}

// 执行
new ExperimentNarrativeScorer().analyze();
