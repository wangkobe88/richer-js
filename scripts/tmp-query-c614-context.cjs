// 一次性查询：c614…7777 的 token_create 时间锚 + 引擎叙事轮次 + 信号轨迹（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xc614a1399a20d53247ff22792dce0485117b7777';

async function main() {
  const client = await dbManager.getClient();

  // 1. wss_events token_create（创建时间锚）
  const { data: evs, error: e1 } = await client
    .from('wss_events')
    .select('id,kind,platform,payload,created_at')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e1) throw e1;
  for (const e of evs ?? []) {
    let p = e.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch {} }
    console.log(`[wss_event] #${e.id} kind=${e.kind} platform=${e.platform ?? '-'} created_at=${e.created_at}`);
    if (e.kind === 'token_create' && p) {
      console.log(`  payload: name=${p.name ?? '-'} symbol=${p.symbol ?? '-'} creator=${p.creator ?? '-'} url=${String(p.url ?? p.token_url ?? '-').slice(0, 120)}`);
    }
  }

  // 2. narrative_analysis_rounds（引擎发起轨迹）
  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('id,experiment_id,round_no,trigger_reason,started_at,completed_at,rating,from_cache,error')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(20);
  if (e2) console.log(`rounds 查询错误: ${e2.message}`);
  for (const r of rounds ?? []) {
    console.log(`[round] #${r.id} exp=${r.experiment_id} round=${r.round_no} reason=${r.trigger_reason} start=${r.started_at} done=${r.completed_at ?? '-'} rating=${r.rating ?? '-'} cache=${r.from_cache} err=${r.error ?? '-'}`);
  }

  // 3. 该 token 的信号行（是否产生过 BUY 信号/评级轨迹）
  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e3) console.log(`signals 查询错误: ${e3.message}`);
  for (const s of sigs ?? []) {
    const m = s.metadata ?? {};
    console.log(`[signal] #${s.id} exp=${s.experiment_id} ${s.signal_type}/${s.action} ${s.created_at} narrativeRating=${m.narrativeRating ?? '-'} metaKeys=${Object.keys(m).join(',').slice(0, 200)}`);
  }

  // 4. 推文原始数据（external_resource_cache，看作者粉丝/互动判定 direct 豁免）
  const { data: cache, error: e4 } = await client
    .from('external_resource_cache')
    .select('url,resource_type,status,content,expires_at')
    .like('url', '%2117385683686060499%')
    .limit(5);
  if (e4) console.log(`cache 查询错误: ${e4.message}`);
  for (const c of cache ?? []) {
    const d = typeof c.content === 'string' ? JSON.parse(c.content) : c.content;
    const t = Array.isArray(d?.tweets) ? d.tweets[0] : d;
    console.log(`[cache] url=${String(c.url).slice(0, 80)} type=${c.resource_type} status=${c.status} expires=${c.expires_at}`);
    if (t) {
      console.log(`  tweet: created_at=${t.created_at ?? '-'} 作者=@${t.user?.screen_name ?? '-'} 粉=${t.user?.followers_count ?? '-'} 赞=${t.favorite_count ?? '-'} 转=${t.retweet_count ?? '-'} 阅=${t.views ?? '-'}`);
      console.log(`  text=${String(t.full_text ?? t.text ?? '').slice(0, 500)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
