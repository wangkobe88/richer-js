// 一次性查询：0x1243…7777 创建事件与 creator（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x12434b4a4e587984c0422929163b58c8a67c7777';

async function main() {
  const client = await dbManager.getClient();

  const { data: ev, error: e1 } = await client
    .from('wss_events')
    .select('kind,block_time,payload')
    .eq('token_address', ADDR)
    .in('kind', ['token_create', 'graduation'])
    .order('block_time', { ascending: true })
    .limit(3);
  if (e1) throw e1;
  for (const r of ev || []) {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? {});
    console.log(`--- ${r.kind} at=${r.block_time} creator=${p.creator ?? p.creatorAddress ?? '-'} meta=${JSON.stringify(p.meta ?? p.metadata ?? {}).slice(0, 400)}`);
  }

  const { data: tok, error: e2 } = await client
    .from('token_narrative')
    .select('twitter_info')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (!e2 && tok?.twitter_info) {
    const t = typeof tok.twitter_info === 'string' ? JSON.parse(tok.twitter_info) : tok.twitter_info;
    console.log('--- twitter_info keys:', Object.keys(t).join(','));
    if (t.main_tweet?.user) console.log('--- main_tweet.user:', JSON.stringify(t.main_tweet.user).slice(0, 400));
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
