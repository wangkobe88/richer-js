import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import { getTweetDetail } from './src/utils/twitter-validation/new-apis.js';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 统计各类别数量
const judgedData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));

const categoryCount = {
  high_quality: 0,
  mid_quality: 0,
  low_quality: 0,
  fake_pump: 0
};

judgedData.forEach(t => {
  if (t.human_judges && t.human_judges.category) {
    categoryCount[t.human_judges.category]++;
  }
});

console.log('=== 人工标注统计 ===');
console.log('高质量:', categoryCount.high_quality);
console.log('中质量:', categoryCount.mid_quality);
console.log('低质量:', categoryCount.low_quality);
console.log('假拉盘:', categoryCount.fake_pump);

// 获取推文内容
const tweetsData = JSON.parse(fs.readFileSync('narrative_analysis/tweets_from_appendix.json', 'utf-8'));

console.log('\n=== 获取推文内容 ===');
console.log('总推文数:', tweetsData.length);

// 为每个代币获取推文内容
const tweetsWithContent = [];
const batchSize = 10;

for (let i = 0; i < Math.min(tweetsData.length, 100); i++) {
  const tweet = tweetsData[i];

  try {
    console.log(`[${i + 1}/${Math.min(tweetsData.length, 100)}] 获取 ${tweet.token} 的推文...`);

    const detail = await getTweetDetail(tweet.tweet_id);

    tweetsWithContent.push({
      token: tweet.token,
      tweet_id: tweet.tweet_id,
      twitter_url: tweet.twitter_url,
      text: detail.text,
      created_at: detail.created_at,
      user: detail.user?.name,
      user_screen_name: detail.user?.screen_name,
      favorite_count: detail.favorite_count,
      retweet_count: detail.retweet_count
    });

    // 每获取10条就保存一次
    if ((i + 1) % batchSize === 0) {
      fs.writeFileSync(
        'narrative_analysis/tweets_with_content.json',
        JSON.stringify(tweetsWithContent, null, 2)
      );
      console.log(`  已保存 ${tweetsWithContent.length} 条推文`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.log(`  获取失败: ${e.message}`);
  }
}

// 最终保存
fs.writeFileSync(
  'narrative_analysis/tweets_with_content.json',
  JSON.stringify(tweetsWithContent, null, 2)
);

console.log('\n完成！已保存', tweetsWithContent.length, '条推文内容');

// 显示一些示例
console.log('\n=== 推文内容示例 ===');
tweetsWithContent.slice(0, 5).forEach(t => {
  console.log(`\n代币: ${t.token}`);
  console.log(`作者: ${t.user} (@${t.user_screen_name})`);
  console.log(`内容: ${t.text.substring(0, 100)}...`);
  console.log(`互动: ${t.favorite_count} 赞, ${t.retweet_count} 转发`);
});
