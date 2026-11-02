// 一次性查询：0x90a5…7777 Jev 答案细节（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x90a5ce7ae44132c06990f05cda15ce854ec27777';

async function main() {
  const client = await dbManager.getClient();
  const { data: narr, error } = await client
    .from('token_narrative')
    .select('token_symbol,event_result,jev_raw_output,twitter_info')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (error) throw error;

  console.log(`token_name=${narr.token_name} symbol=${narr.token_symbol}`);

  const ti = typeof narr.twitter_info === 'string' ? JSON.parse(narr.twitter_info) : narr.twitter_info;
  console.log(`\n=== 主推 ===`);
  console.log(`author=@${ti.author_screen_name} (${ti.author_name}) followers=${ti.author_followers_count} verified=${ti.author_verified}`);
  console.log(`created_at=${ti.created_at} metrics=${JSON.stringify(ti.metrics)}`);
  console.log(`text=${String(ti.text).slice(0, 500)}`);
  if (ti.media) console.log(`media=${JSON.stringify(ti.media).slice(0, 200)}`);
  if (ti.in_reply_to) console.log(`in_reply_to=${JSON.stringify(ti.in_reply_to).slice(0, 300)}`);

  const ev = narr.event_result;
  const jev = ev?.parsed_output?.jev;
  console.log(`\n=== event_result.jev 审计键 ===`);
  if (jev) {
    for (const k of ['tweetType', 'blockChoice', 'blockReasonLabel', 'jevImpactTier', 'effectiveImpactTier', 'effectiveTiming', 'nameEntityChoice', 'nameEntityAcceptance', 'phraseAcceptability', 'phraseChoice']) {
      if (jev[k] !== undefined) console.log(`${k}=${JSON.stringify(jev[k])}`);
    }
    console.log(`jev keys=${Object.keys(jev).join(',')}`);
  } else {
    console.log('无 parsed_output.jev');
    console.log(JSON.stringify(ev).slice(0, 1500));
  }

  const raw = narr.jev_raw_output;
  if (raw) {
    const answers = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ans = answers?.answers ?? answers;
    console.log(`\n=== jev_raw_output 相关题答案 ===`);
    const keys = ['bsc_meme_user_name_entity_acceptance', 'bsc_meme_user_phrase_acceptability', 'event_empty_content', 'event_category', 'bsc_meme_user_event_fit'];
    if (ans && typeof ans === 'object') {
      for (const [qid, a] of Object.entries(ans)) {
        if (keys.some(k => qid.includes(k)) || qid.includes('phrase') || qid.includes('entity')) {
          console.log(`${qid}: choice=${a.choice} probs=${JSON.stringify(a.probabilities)}`);
        }
      }
    } else {
      console.log(String(JSON.stringify(raw)).slice(0, 2000));
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
