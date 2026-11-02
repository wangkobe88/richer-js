// 0c83 票：本地跑 classifyTweetType（零网络）+ 雪花时间交叉验证 + 信号/成交单票读取
import { dbManager } from '../src/services/dbManager.js';
import { classifyTweetType, THRESHOLDS } from '../src/narrative/analyzer/services/tweet-type-classifier.mjs';

const ADDR = '0x0c83d9de98d583a1f14accc1910c77dad0647777';
const TWEET_ID = '2115594485488886194';

// 雪花时间 = (id >> 22) + Twitter 纪元 1288834974657
const snowMs = (Number(BigInt(TWEET_ID) >> 22n)) + 1288834974657;
console.log('雪花解码推文时间:', new Date(snowMs).toISOString());

const db = dbManager.getClient();
const { data: tn } = await db.from('token_narrative')
  .select('twitter_info, raw_api_data')
  .eq('token_address', ADDR);
const ti = tn?.[0]?.twitter_info;
if (ti) {
  console.log('twitter_info 顶层键:', Object.keys(ti).join(','));
  console.log('metrics:', JSON.stringify(ti.metrics));
  const cls = classifyTweetType(ti);
  console.log('分桶结果:', JSON.stringify(cls));
  const followers = ti.author_followers_count ?? null;
  console.log(`作者粉=${followers} | HIGH_FOLLOWERS(直接依托门)=${THRESHOLDS.HIGH_FOLLOWERS} | MEGA_REACH(高用烂门)=${THRESHOLDS.MEGA_REACH_FOLLOWERS} → 高用烂风险作者=${followers !== null && followers >= THRESHOLDS.MEGA_REACH_FOLLOWERS}`);
  // C104 主从结构门复算：锚=07:04:38
  const anchor = new Date('2026-10-29T07:04:38.855592+00:00').getTime();
  const mainLag = (anchor - new Date(ti.created_at).getTime()) / 1000;
  console.log(`主推 lag=${Math.round(mainLag)}s（24h=${24 * 3600}s）→ ${mainLag > 24 * 3600 ? '超 24h 需主从结构' : '未超 24h 豁免维持'}`);
}

// 信号与成交（select * 看真实列名）
for (const table of ['strategy_signals', 'trades']) {
  const { data, error } = await db.from(table).select('*').eq('token_address', ADDR).limit(5);
  if (error) { console.log(table, 'error:', error.message); continue; }
  console.log(`\n=== ${table}: ${data.length} 行`);
  for (const r of data) {
    if (table === 'strategy_signals') {
      console.log(`  signal type=${r.signal_type} action=${r.action} created=${r.created_at} exp=${r.experiment_id}`);
      console.log('    reason:', (r.reason || '').slice(0, 200));
    } else {
      console.log(`  trade ${r.trade_type ?? r.side ?? '?'} amount=${r.bnb_amount ?? r.amount_bnb ?? '?'} created=${r.created_at} exp=${r.experiment_id}`, Object.keys(r).slice(0, 15).join(','));
    }
  }
}
process.exit(0);
