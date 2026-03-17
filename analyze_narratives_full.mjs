import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeNarratives() {
  // 1. 获取所有有 human_judges 的代币
  const { data: judgedTokens } = await client
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data, human_judges')
    .not('human_judges', 'is', null);

  console.log('=== 有 human_judges 的代币 ===');
  console.log('数量:', judgedTokens?.length || 0);

  if (judgedTokens && judgedTokens.length > 0) {
    judgedTokens.forEach(t => {
      console.log(`\n代币: ${t.token_symbol}`);
      console.log('评分:', t.human_judges);
    });
  }

  // 2. 提取所有 appendix 中的推文 ID
  const { data: allTokens } = await client
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data')
    .not('raw_api_data', 'is', null)
    .limit(1000);

  console.log('\n=== 提取推文数据 ===');
  console.log('总代币数:', allTokens?.length || 0);

  const tweets = [];
  const websites = [];
  const otherInfo = [];

  if (allTokens) {
    for (const t of allTokens) {
      if (t.raw_api_data && t.raw_api_data.appendix) {
        try {
          const appendix = JSON.parse(t.raw_api_data.appendix);

          // 提取推文链接
          if (appendix.twitter) {
            const match = appendix.twitter.match(/status\/(\d+)/);
            if (match) {
              tweets.push({
                token: t.token_symbol,
                tweet_id: match[1],
                twitter_url: appendix.twitter
              });
            }
          }

          // 提取网站
          if (appendex.website) {
            websites.push({
              token: t.token_symbol,
              website: appendix.website
            });
          }

          // 其他信息
          if (appendex.telegram || appendix.intro_en || appendix.intro_cn) {
            otherInfo.push({
              token: t.token_symbol,
              telegram: appendix.telegram,
              intro_en: appendix.intro_en?.substring(0, 100),
              intro_cn: appendix.intro_cn?.substring(0, 100)
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  console.log('\n推文数据:', tweets.length);
  console.log('网站数据:', websites.length);
  console.log('其他信息:', otherInfo.length);

  // 保存数据
  const outputDir = 'narrative_analysis';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  fs.writeFileSync(
    `${outputDir}/human_judged_tokens.json`,
    JSON.stringify(judgedTokens || [], null, 2)
  );

  fs.writeFileSync(
    `${outputDir}/tweets_from_appendix.json`,
    JSON.stringify(tweets, null, 2)
  );

  fs.writeFileSync(
    `${outputDir}/websites_from_appendix.json`,
    JSON.stringify(websites, null, 2)
  );

  console.log('\n已保存到 narrative_analysis/');

  // 显示推文示例
  if (tweets.length > 0) {
    console.log('\n=== 推文示例（前5个）===');
    tweets.slice(0, 5).forEach(t => {
      console.log(`\n${t.token}: ${t.tweet_id}`);
      console.log(`  ${t.twitter_url}`);
    });
  }

  return { judgedTokens, tweets, websites };
}

analyzeNarratives().then(() => {
  console.log('\n完成！');
  process.exit(0);
}).catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
