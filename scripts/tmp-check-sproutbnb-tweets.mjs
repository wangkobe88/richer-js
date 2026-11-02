import { getAccountWithFullTweets } from '../src/narrative/analyzer/prompts/account/account-community-rules.mjs';

const info = await getAccountWithFullTweets('sproutbnb', 40, {});
const u = info.userInfo || info;
console.log('### 账号:', u.screen_name, '| followers:', u.followers_count, '| created:', u.created_at, '| tweets:', u.statuses_count);
console.log('desc:', String(u.description || '').slice(0, 200));
const tweets = info.tweets || [];
console.log('### 推文数:', tweets.length);
for (const t of tweets.slice(0, 40)) {
  const d = t.created_at ? new Date(t.created_at).toISOString().slice(0, 16) : '?';
  const txt = String(t.full_text || t.text || '').replace(/\n/g, ' ').slice(0, 110);
  console.log(d, '|', txt);
}
process.exit(0);
