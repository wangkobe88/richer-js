import { createClient } from '@supabase/supabase-js';
import { getTweetDetail } from '../../src/utils/twitter-validation/new-apis.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../../config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const experiments = {
  '70fea05f': '70fea05f-2ed5-4b82-86d2-3dcddf27ab11',
  '7855de6d': '7855de6d-5f74-4884-a44e-3c2c2b351259',
  'e3c37811': 'e3c37811-f050-436e-b446-f51f6895bfb8'
};

/**
 * 从数据库获取所有代币的 Twitter URL
 */
async function getAllTokenTwitterUrls() {
  const results = {};

  for (const [shortId, expId] of Object.entries(experiments)) {
    console.log(`\n=== 获取实验 ${shortId} 的代币 Twitter URL ===`);

    // 获取成功交易的代币地址
    const { data: trades } = await client
      .from('trades')
      .select('token_address')
      .eq('experiment_id', expId)
      .eq('success', true);

    const tokenAddresses = [...new Set(trades?.map(t => t.token_address) || [])];

    console.log(`找到 ${tokenAddresses.length} 个代币`);

    // 获取每个代币的详细信息（包含 Twitter URL）
    const tokens = [];

    for (const address of tokenAddresses) {
      const { data: token } = await client
        .from('experiment_tokens')
        .select('token_address, token_symbol, raw_api_data')
        .eq('token_address', address)
        .maybeSingle();

      if (token) {
        let twitterUrl = null;
        try {
          const rawData = token.raw_api_data || {};
          let appendix = rawData.appendix;
          if (typeof appendix === 'string') {
            appendix = JSON.parse(appendix);
          }
          twitterUrl = appendix?.twitter || null;
        } catch (e) {}

        tokens.push({
          address: token.token_address,
          symbol: token.token_symbol || rawData?.symbol || 'Unknown',
          twitterUrl
        });
      }
    }

    results[shortId] = {
      expId,
      tokens
    };

    const withTwitter = tokens.filter(t => t.twitterUrl).length;
    console.log(`有 Twitter URL: ${withTwitter}/${tokens.length}`);
  }

  return results;
}

/**
 * 提取推文ID
 */
function extractTweetId(url) {
  if (!url) return null;
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 获取推文内容
 */
async function fetchTweetContents(tokenData) {
  const results = {};
  const failed = [];

  for (const [shortId, expData] of Object.entries(tokenData)) {
    results[shortId] = {
      expId: expData.expId,
      tokens: []
    };

    console.log(`\n=== 实验 ${shortId} 获取推文内容 ===`);

    for (const token of expData.tokens) {
      if (!token.twitterUrl) {
        console.log(`  ${token.symbol}: 无 Twitter URL`);
        continue;
      }

      const tweetId = extractTweetId(token.twitterUrl);
      if (!tweetId) {
        console.log(`  ${token.symbol}: 无法提取推文ID`);
        failed.push({ ...token, reason: '无法提取推文ID' });
        continue;
      }

      console.log(`  ${token.symbol}: ${tweetId}`);

      try {
        const detail = await getTweetDetail(tweetId);

        results[shortId].tokens.push({
          address: token.address,
          symbol: token.symbol,
          tweet_id: tweetId,
          twitter_url: token.twitterUrl,
          text: detail.text,
          created_at: detail.created_at,
          user: detail.user?.name,
          user_screen_name: detail.user?.screen_name,
          favorite_count: detail.favorite_count || 0,
          retweet_count: detail.retweet_count || 0
        });

        console.log(`    ✅: ${detail.text.substring(0, 40)}...`);

      } catch (e) {
        console.log(`    ❌: ${e.message}`);
        failed.push({ ...token, tweetId, reason: e.message });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { results, failed };
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 获取实验代币推文内容 ===\n');

  // 1. 获取所有代币的 Twitter URL
  const tokenData = await getAllTokenTwitterUrls();

  // 2. 获取推文内容
  const { results, failed } = await fetchTweetContents(tokenData);

  // 3. 保存结果
  fs.writeFileSync(
    '../../narrative_analysis/experiment_tweets_full.json',
    JSON.stringify(results, null, 2)
  );

  fs.writeFileSync(
    '../../narrative_analysis/experiment_tweets_failed.json',
    JSON.stringify(failed, null, 2)
  );

  // 统计
  let totalTokens = 0;
  let withTwitter = 0;
  let fetched = 0;
  for (const [shortId, data] of Object.entries(results)) {
    totalTokens += data.tokens.length;
    fetched += data.tokens.length;
  }
  withTwitter = totalTokens; // all tokens in results have twitter data

  console.log('\n=== 完成 ===');
  console.log(`总代币数: ${Object.entries(tokenData).reduce((sum, [, d]) => sum + d.tokens.length, 0)}`);
  console.log(`有 Twitter URL: ${withTwitter}`);
  console.log(`成功获取推文: ${fetched}`);
  console.log(`获取失败: ${failed.length}`);
  console.log(`成功率: ${(fetched / (fetched + failed.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);
