import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkAppendix() {
  // 获取更多样本，检查 appendix 内容
  const { data: tokens } = await client
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data')
    .not('raw_api_data', 'is', null)
    .limit(200);

  console.log('有 raw_api_data 的代币:', tokens?.length || 0);

  let tweetCount = 0;
  let websiteCount = 0;
  let telegramCount = 0;
  const tweetExamples = [];
  const websiteExamples = [];
  const telegramExamples = [];
  const allTweets = [];

  if (tokens) {
    for (const t of tokens) {
      if (t.raw_api_data) {
        try {
          const parsed = typeof t.raw_api_data === 'string' ? JSON.parse(t.raw_api_data) : t.raw_api_data;

          if (parsed.appendix) {
            const appendix = typeof parsed.appendix === 'string' ? JSON.parse(parsed.appendix) : parsed.appendex;

            // 检查推文信息
            if (appendix.tweetId || appendix.tweet_id || appendix.tweetUrl || appendix.tweet_url) {
              tweetCount++;
              allTweets.push({
                token: t.token_symbol,
                tweetId: appendix.tweetId || appendix.tweet_id,
                tweetUrl: appendix.tweetUrl || appendix.tweet_url,
                tweetText: appendix.tweetText || appendix.tweet_text
              });

              if (tweetExamples.length < 10) {
                tweetExamples.push({ token: t.token_symbol, appendix });
              }
            }

            // 检查网站
            if (appendix.website || appendix.webUrl || appendix.web_url) {
              websiteCount++;
              if (websiteExamples.length < 5) {
                websiteExamples.push({ token: t.token_symbol, appendix });
              }
            }

            // 检查 telegram
            if (appendix.telegram || appendix.telegramUrl || appendix.telegram_url) {
              telegramCount++;
              if (telegramExamples.length < 5) {
                telegramExamples.push({ token: t.token_symbol, appendix });
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }

      if (tweetExamples.length >= 10 && websiteExamples.length >= 5 && telegramExamples.length >= 5) {
        break;
      }
    }
  }

  console.log('\n=== 统计结果 ===');
  console.log('有推文信息:', tweetCount);
  console.log('有网站信息:', websiteCount);
  console.log('有Telegram信息:', telegramCount);

  if (tweetExamples.length > 0) {
    console.log('\n=== 推文示例 ===');
    tweetExamples.forEach(e => {
      console.log(`\n代币: ${e.token}`);
      console.log(JSON.stringify(e.appendix, null, 2));
    });
  }

  // 保存所有推文数据
  if (allTweets.length > 0) {
    const outputDir = 'narrative_analysis';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      `${outputDir}/all_tweets.json`,
      JSON.stringify(allTweets, null, 2)
    );

    console.log(`\n已保存 ${allTweets.length} 条推文数据到 narrative_analysis/all_tweets.json`);
  }

  return { tweetCount, websiteCount, telegramCount, allTweets };
}

checkAppendix().then(() => {
  console.log('\n完成');
  process.exit(0);
}).catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
