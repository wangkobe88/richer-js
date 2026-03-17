import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  // 1. 获取所有虚拟实验
  const { data: experiments } = await client
    .from('experiments')
    .select('id')
    .eq('trading_mode', 'virtual');

  console.log('找到虚拟实验:', experiments?.length || 0);

  // 2. 获取所有有 human_judges 的代币
  const { data: tokens } = await client
    .from('experiment_tokens')
    .select('id, token_address, token_name, human_judges, experiment_id')
    .in('experiment_id', experiments?.map(e => e.id) || [])
    .not('human_judges', 'is', null);

  console.log('有 human_judges 的代币:', tokens?.length || 0);

  if (tokens && tokens.length > 0) {
    // 保存到文件
    const outputDir = 'narrative_analysis';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      path.join(outputDir, 'tokens_with_judges.json'),
      JSON.stringify(tokens, null, 2)
    );

    console.log('\n代币列表（前10个）:');
    tokens.slice(0, 10).forEach(t => {
      console.log(`- ${t.token_name} (${t.token_address?.substr(0, 10)}...): ${JSON.stringify(t.human_judges)}`);
    });
  }

  // 3. 获取这些代币的 raw_api_data（包含 appendix）
  const tokenAddresses = tokens?.map(t => t.token_address) || [];

  const { data: rawData } = await client
    .from('raw_api_data')
    .select('token_address, appendix')
    .in('token_address', tokenAddresses);

  console.log('\n找到 raw_api_data:', rawData?.length || 0);

  // 4. 提取推文 ID
  const tweets = [];
  for (const item of rawData || []) {
    if (item.appendix) {
      try {
        const appendix = typeof item.appendix === 'string' ? JSON.parse(item.appendix) : item.appendix;

        // 查找推文链接
        if (appendix.tweetId) {
          tweets.push({
            token_address: item.token_address,
            tweet_id: appendix.tweetId,
            tweet_url: appendix.tweetUrl || null,
            tweet_text: appendix.tweetText || null
          });
        } else if (appendex.tweet_id) {
          tweets.push({
            token_address: item.token_address,
            tweet_id: appendix.tweet_id
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  console.log('\n找到推文 ID:', tweets.length);

  // 保存推文 ID 列表
  const outputDir = 'narrative_analysis';
  fs.writeFileSync(
    path.join(outputDir, 'tweet_ids.json'),
    JSON.stringify(tweets, null, 2)
  );

  console.log('已保存到 narrative_analysis/tweet_ids.json');
  return tweets;
}

main().then(tweets => {
  console.log('\n完成！');
  process.exit(0);
}).catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
