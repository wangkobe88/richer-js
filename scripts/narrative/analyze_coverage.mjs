import fs from 'fs';

/**
 * 分析人工标注代币的推文数据覆盖率低的原因
 */
class AnalyzeCoverage {
  constructor() {
    this.humanData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));
    this.tweetsWithContent = JSON.parse(fs.readFileSync('narrative_analysis/tweets_with_content.json', 'utf-8'));
    this.tweetsFromAppendix = JSON.parse(fs.readFileSync('narrative_analysis/tweets_from_appendix.json', 'utf-8'));

    // 创建已获取内容的推文ID映射
    this.tweetContentMap = new Map(
      this.tweetsWithContent.map(t => [t.tweet_id, t])
    );
  }

  analyze() {
    console.log('=== 人工标注代币推文覆盖率分析 ===\n');

    // 统计各类情况
    const stats = {
      totalTokens: this.humanData.length,
      hasAppendix: 0,           // 有 appendix 字段
      hasTwitterUrl: 0,         // appendix 中有 twitter URL
      noAppendix: 0,            // 没有 appendix 字段
      emptyAppendix: 0,         // appendix 为空/null
      hasOtherLinks: 0,         // 有其他链接（网站/tiktok等）
      tweetFetched: 0,          // 成功获取推文
      tweetNotFetched: 0,       // 有 URL 但未获取到内容
      noTwitterAtAll: 0         // 完全没有 Twitter 相关信息
    };

    const details = {
      noAppendix: [],
      emptyAppendix: [],
      onlyOtherLinks: [],
      hasTwitterButNoContent: [],
      successfullyFetched: []
    };

    this.humanData.forEach(token => {
      const rawApiData = token.raw_api_data;

      // 1. 检查是否有 raw_api_data
      if (!rawApiData) {
        stats.noAppendix++;
        details.noAppendix.push(token.token_symbol);
        return;
      }

      // 2. 检查是否有 appendix
      let appendix = null;
      try {
        // appendix 可能是 JSON 字符串或对象
        if (typeof rawApiData.appendix === 'string') {
          appendix = JSON.parse(rawApiData.appendix);
        } else if (typeof rawApiData.appendix === 'object') {
          appendix = rawApiData.appendix;
        }
      } catch (e) {
        stats.emptyAppendix++;
        details.emptyAppendix.push(token.token_symbol);
        return;
      }

      if (!appendix || Object.keys(appendix).length === 0) {
        stats.emptyAppendix++;
        details.emptyAppendix.push(token.token_symbol);
        return;
      }

      stats.hasAppendix++;

      // 3. 检查是否有 Twitter URL
      const hasTwitter = appendix.twitter || (appendix.twitter_url);
      const hasOther = appendix.website || appendix.tiktok || appendix.telegram || appendix.discord;

      if (!hasTwitter && !hasOther) {
        stats.emptyAppendix++;
        return;
      }

      if (!hasTwitter && hasOther) {
        stats.hasOtherLinks++;
        details.onlyOtherLinks.push({
          token: token.token_symbol,
          links: Object.keys(appendix).join(', ')
        });
        return;
      }

      if (hasTwitter) {
        stats.hasTwitterUrl++;

        // 提取 tweet_id
        const twitterUrl = hasTwitter;
        let tweetId = null;

        // 尝试从 URL 中提取 tweet_id
        const match = twitterUrl.match(/status\/(\d+)/);
        if (match) {
          tweetId = match[1];
        }

        if (tweetId && this.tweetContentMap.has(tweetId)) {
          stats.tweetFetched++;
          details.successfullyFetched.push({
            token: token.token_symbol,
            tweet_id: tweetId,
            category: token.human_judges?.category
          });
        } else {
          stats.tweetNotFetched++;
          details.hasTwitterButNoContent.push({
            token: token.token_symbol,
            tweet_id: tweetId,
            url: twitterUrl,
            category: token.human_judges?.category
          });
        }
      }
    });

    // 打印统计结果
    console.log('=== 统计结果 ===');
    console.log(`总人工标注代币数: ${stats.totalTokens}\n`);

    console.log('【数据结构分析】');
    console.log(`  有 appendix 字段: ${stats.hasAppendix} (${(stats.hasAppendix/stats.totalTokens*100).toFixed(1)}%)`);
    console.log(`  无 appendix 字段: ${stats.noAppendix} (${(stats.noAppendix/stats.totalTokens*100).toFixed(1)}%)`);
    console.log(`  appendix 为空: ${stats.emptyAppendix} (${(stats.emptyAppendix/stats.totalTokens*100).toFixed(1)}%)`);

    console.log('\n【链接类型分析】');
    console.log(`  有 Twitter URL: ${stats.hasTwitterUrl} (${(stats.hasTwitterUrl/stats.totalTokens*100).toFixed(1)}%)`);
    console.log(`  只有其他链接(网站/TikTok等): ${stats.hasOtherLinks} (${(stats.hasOtherLinks/stats.totalTokens*100).toFixed(1)}%)`);

    console.log('\n【推文获取情况】');
    console.log(`  成功获取推文内容: ${stats.tweetFetched} (${(stats.tweetFetched/stats.totalTokens*100).toFixed(1)}%)`);
    console.log(`  有 Twitter URL 但未获取到内容: ${stats.tweetNotFetched} (${(stats.tweetNotFetched/stats.totalTokens*100).toFixed(1)}%)`);

    // 详细示例
    if (details.onlyOtherLinks.length > 0) {
      console.log('\n=== 只有其他链接的代币示例 (前10个) ===');
      details.onlyOtherLinks.slice(0, 10).forEach(d => {
        console.log(`  ${d.token}: ${d.links}`);
      });
      if (details.onlyOtherLinks.length > 10) {
        console.log(`  ... 还有 ${details.onlyOtherLinks.length - 10} 个`);
      }
    }

    if (details.hasTwitterButNoContent.length > 0) {
      console.log('\n=== 有 Twitter URL 但未获取到内容的代币 (前10个) ===');
      details.hasTwitterButNoContent.slice(0, 10).forEach(d => {
        console.log(`  ${d.token} [${d.category}]: ${d.url}`);
      });
      if (details.hasTwitterButNoContent.length > 10) {
        console.log(`  ... 还有 ${details.hasTwitterButNoContent.length - 10} 个`);
      }
    }

    if (details.successfullyFetched.length > 0) {
      console.log('\n=== 成功获取推文内容的代币 (全部) ===');
      details.successfullyFetched.forEach(d => {
        console.log(`  ${d.token} [${d.category}]`);
      });
    }

    // 保存详细结果
    fs.writeFileSync(
      'narrative_analysis/coverage_analysis.json',
      JSON.stringify({ stats, details }, null, 2)
    );

    console.log('\n详细分析已保存到 narrative_analysis/coverage_analysis.json');
  }
}

// 执行分析
new AnalyzeCoverage().analyze();
