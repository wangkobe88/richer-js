import { getTweetDetail } from '../../src/utils/twitter-validation/new-apis.js';
import fs from 'fs';

/**
 * 获取三个实验中有交易代币的推文内容
 */
async function fetchExperimentTweets() {
  const expTokens = JSON.parse(fs.readFileSync('narrative_analysis/experiment_tokens.json', 'utf-8'));

  // 从之前的查询结果获取代币详情（包含Twitter URL）
  const tokenDetails = {
    "70fea05f": [
      { address: "0xc14c6045d3bfd296b9c89c0d91fd7c5bd98e4444", symbol: "人前显圣", twitterUrl: "https://x.com/i/communities/2032779203335102479" },
      { address: "0x82a59d36642650314402c72a6a9ba1364b114444", symbol: "遗憾", twitterUrl: "https://x.com/six1xxx/status/2032765210432516107?s=20" },
      { address: "0xba76fdd6bed23057c7c11ebb34dd247b33b34444", symbol: "傻币", twitterUrl: "https://x.com/abrawlerj/status/2032753541341687962" },
      { address: "0xa1795a0f4e65f4842ca9329dc1b62b69f0d04444", symbol: "天使—COCO", twitterUrl: "https://x.com/i/status/2032752367381237880" },
      { address: "0xdd8cfbe605febc8e5fc731e8d2d71620712dffff", symbol: "Clawford", twitterUrl: "https://x.com/Clawford_ai/status/2032537288031482061" }
    ],
    "7855de6d": [
      { address: "0x942a28cf14a4e711882155013d696eecc22a4444", symbol: "ACT: S", twitterUrl: "https://x.com/0xethanwife/status/2032453151987732496" },
      { address: "0xe3db3df131a186b1c075323848e76f5a15da4444", symbol: "羊群效应", twitterUrl: "https://x.com/S93curiB8dp67lv/status/2032454118900687236?s=20" },
      { address: "0x509f1dade2c64246f06f760bfe2ad0871c4c4444", symbol: "relink", twitterUrl: "https://x.com/CDaneliak56999/status/2032438815391207484" },
      { address: "0xd583de96dd227184f7abc2a33ebc6cbead04444", symbol: "simulation", twitterUrl: "https://x.com/elonmusk/status/2032438458199990624" },
      { address: "0x110dc457610c2354de260c171134667c77dc4444", symbol: "MEME", twitterUrl: "https://x.com/0xethanwife/status/2032435428763332714" },
      { address: "0x47be48b1c3cc8d4d11257759e87a484051d84444", symbol: "我们一起学猫叫", twitterUrl: "https://x.com/vitalikbuterin/status/1752339575358558261?s=46" }
    ],
    "e3c37811": [
      { address: "0x8c647898fef0ac142db4c20135abdc125de94444", symbol: "Trump", twitterUrl: "https://x.com/i/status/2032065836446539779" },
      { address: "0x777387902c78c47e0463ac4a92f4b680e6534444", symbol: "未来已来", twitterUrl: "https://x.com/i/status/2032053759812272411" }
    ]
  };

  const results = {};
  const failed = [];

  for (const [shortId, tokens] of Object.entries(tokenDetails)) {
    results[shortId] = {
      expId: expTokens[shortId].expId,
      tokens: []
    };

    console.log(`\n=== 实验 ${shortId} ===`);

    for (const token of tokens) {
      // 提取 tweet_id
      const match = token.twitterUrl?.match(/status\/(\d+)/);
      if (!match) {
        console.log(`  ${token.symbol}: 无法提取推文ID`);
        failed.push({ ...token, reason: '无法提取推文ID' });
        continue;
      }

      const tweetId = match[1];
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

        console.log(`    ✅: ${detail.text.substring(0, 50)}...`);

      } catch (e) {
        console.log(`    ❌: ${e.message}`);
        failed.push({ ...token, tweetId, reason: e.message });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 保存结果
  fs.writeFileSync(
    'narrative_analysis/experiment_tweets_with_content.json',
    JSON.stringify(results, null, 2)
  );

  fs.writeFileSync(
    'narrative_analysis/experiment_tweets_failed.json',
    JSON.stringify(failed, null, 2)
  );

  console.log('\n=== 完成 ===');
  console.log(`成功: ${Object.values(results).reduce((sum, exp) => sum + exp.tokens.length, 0)}`);
  console.log(`失败: ${failed.length}`);
}

fetchExperimentTweets().catch(console.error);
