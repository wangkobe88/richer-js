// 单票宣告推验证：重拉 MessariCrypto 推文（绕缓存），看 4 条里有没有带这票 CA 的宣告推
import { getAccountWithFullTweets } from '../src/narrative/analyzer/prompts/account/account-community-rules.mjs';

const ADDR = '0x35c4680cf97ccc6d6d85dd0e5ed9d4faa8907777';
const TOKEN_CREATED = 1793153684; // raw_api_data.eventTs

const data = await getAccountWithFullTweets('MessariCrypto', 20, {
  invalidateCache: true,
  tokenAddress: ADDR,
});
console.log('=== 拉取结果 ===');
if (!data) { console.log('NULL'); process.exit(1); }
console.log('screen_name:', data.screen_name, '| name:', data.name, '| 粉丝:', data.followers_count, '| statuses_count:', data.statuses_count);
console.log('created_at:', data.created_at, '| description:', data.description);
const tweets = data.tweets || [];
console.log('推文数:', tweets.length);
for (const t of tweets) {
  console.log('--- created:', t.created_at, '| 赞:', t.favorite_count, '转:', t.retweet_count);
  console.log('   ', (t.full_text || t.text || '').slice(0, 300));
  const hasCa = (t.full_text || t.text || '').toLowerCase().includes(ADDR.slice(2, 10));
  console.log('    含本票 CA:', hasCa, '| ts:', t.ts ?? t.created_at_sec ?? '?');
}
// 推文时间 vs token 创建时间
console.log('\ntoken 创建 ts:', TOKEN_CREATED, '=', new Date(TOKEN_CREATED * 1000).toISOString());
process.exit(0);
