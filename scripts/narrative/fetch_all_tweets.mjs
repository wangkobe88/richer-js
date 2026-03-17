import { getTweetDetail } from '../../src/utils/twitter-validation/new-apis.js';
import fs from 'fs';

async function fetchAllTweets() {
  const tweetsData = JSON.parse(fs.readFileSync('narrative_analysis/tweets_from_appendix.json', 'utf-8'));
  const existingData = fs.existsSync('narrative_analysis/tweets_with_content.json')
    ? JSON.parse(fs.readFileSync('narrative_analysis/tweets_with_content.json', 'utf-8'))
    : [];

  console.log('总推文数:', tweetsData.length);
  console.log('已获取:', existingData.length);
  console.log('剩余需获取:', tweetsData.length - existingData.length);

  const tweetsMap = new Map(existingData.map(t => [t.tweet_id, t]));
  const failedTweets = [];

  for (let i = 0; i < tweetsData.length; i++) {
    const tweet = tweetsData[i];

    if (tweetsMap.has(tweet.tweet_id)) {
      continue;
    }

    try {
      console.log(`[${i + 1}/${tweetsData.length}] ${tweet.token} (${tweet.tweet_id})`);

      const detail = await getTweetDetail(tweet.tweet_id);

      tweetsMap.set(tweet.tweet_id, {
        token: tweet.token,
        tweet_id: tweet.tweet_id,
        twitter_url: tweet.twitter_url,
        text: detail.text,
        created_at: detail.created_at,
        user: detail.user?.name,
        user_screen_name: detail.user?.screen_name,
        favorite_count: detail.favorite_count || 0,
        retweet_count: detail.retweet_count || 0,
        reply_count: detail.reply_count || 0,
        quote_count: detail.quote_count || 0
      });

      // 每50条保存一次
      if (tweetsMap.size % 50 === 0) {
        fs.writeFileSync(
          'narrative_analysis/tweets_with_content.json',
          JSON.stringify([...tweetsMap.values()], null, 2)
        );
        console.log(`  保存进度: ${tweetsMap.size}/${tweetsData.length}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      console.log(`  失败: ${e.message}`);
      failedTweets.push({ ...tweet, error: e.message });
    }
  }

  // 最终保存
  const allTweets = [...tweetsMap.values()];
  fs.writeFileSync(
    'narrative_analysis/tweets_with_content.json',
    JSON.stringify(allTweets, null, 2)
  );

  fs.writeFileSync(
    'narrative_analysis/failed_tweets.json',
    JSON.stringify(failedTweets, null, 2)
  );

  console.log('\n完成！');
  console.log('成功获取:', allTweets.length);
  console.log('失败:', failedTweets.length);
}

fetchAllTweets().catch(console.error);
