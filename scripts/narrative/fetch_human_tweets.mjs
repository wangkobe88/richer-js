import { getTweetDetail } from '../../src/utils/twitter-validation/new-apis.js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '../../config/.env' });

/**
 * 从人工标注代币中获取推文内容
 */
async function fetchHumanJudgedTweets() {
  const humanData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));

  console.log('=== 从人工标注代币获取推文内容 ===\n');
  console.log(`总代币数: ${humanData.length}`);

  const results = [];
  const failed = [];

  for (let i = 0; i < humanData.length; i++) {
    const token = humanData[i];
    const symbol = token.token_symbol;

    // 检查是否有 raw_api_data 和 appendix
    if (!token.raw_api_data?.appendix) {
      continue;
    }

    let appendix = token.raw_api_data.appendix;
    if (typeof appendix === 'string') {
      try {
        appendix = JSON.parse(appendix);
      } catch (e) {
        continue;
      }
    }

    if (!appendix?.twitter) {
      continue;
    }

    const twitterUrl = appendix.twitter;
    const match = twitterUrl.match(/status\/(\d+)/);
    if (!match) continue;

    const tweetId = match[1];

    console.log(`[${i + 1}/${humanData.length}] ${symbol} - ${tweetId}`);

    try {
      const detail = await getTweetDetail(tweetId);

      results.push({
        token: symbol,
        token_address: token.token_address,
        tweet_id: tweetId,
        twitter_url: twitterUrl,
        text: detail.text,
        created_at: detail.created_at,
        user: detail.user?.name,
        user_screen_name: detail.user?.screen_name,
        favorite_count: detail.favorite_count || 0,
        retweet_count: detail.retweet_count || 0,
        reply_count: detail.reply_count || 0,
        quote_count: detail.quote_count || 0,
        human_category: token.human_judges?.category
      });

      console.log(`  ✅ 成功: ${detail.text.substring(0, 50)}...`);

    } catch (e) {
      console.log(`  ❌ 失败: ${e.message}`);
      failed.push({
        token: symbol,
        tweet_id: tweetId,
        url: twitterUrl,
        error: e.message,
        human_category: token.human_judges?.category
      });
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 保存结果
  fs.writeFileSync(
    'narrative_analysis/human_tweets_with_content.json',
    JSON.stringify(results, null, 2)
  );

  fs.writeFileSync(
    'narrative_analysis/human_tweets_failed.json',
    JSON.stringify(failed, null, 2)
  );

  console.log('\n=== 完成 ===');
  console.log(`成功获取: ${results.length}`);
  console.log(`获取失败: ${failed.length}`);
  console.log(`成功率: ${(results.length / (results.length + failed.length) * 100).toFixed(1)}%`);
}

fetchHumanJudgedTweets().catch(console.error);
