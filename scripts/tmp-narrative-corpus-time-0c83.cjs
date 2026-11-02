// 单票语料时间排查：0x0c83 CZ/何一借壳票，看各语料源时间 vs 代币创建锚，及时效门审计
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x0c83d9de98d583a1f14accc1910c77dad0647777';

const fmtLag = (lagSec) => {
  if (lagSec === null) return 'null';
  const s = Math.round(lagSec);
  if (Math.abs(s) < 3600) return `${s}s`;
  if (Math.abs(s) < 86400) return `${(s / 3600).toFixed(2)}h`;
  return `${(s / 86400).toFixed(2)}d`;
};
const lagOf = (createdAt, anchorMs) => {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (anchorMs - t) / 1000; // 正=推文早于创建锚（旧语料）
};

(async () => {
  const db = dbManager.getClient();

  const { data: tn, error: e1 } = await db
    .from('token_narrative')
    .select('id,token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,final_result,event_score_result,relation_result,classified_urls,twitter_info,raw_api_data')
    .eq('token_address', ADDR);
  if (e1) throw e1;
  console.log('=== token_narrative 行数:', tn.length);

  for (const row of tn) {
    console.log(`\n##### 行 id=${row.id} symbol=${row.token_symbol} analyzed_at=${row.analyzed_at} is_valid=${row.is_valid} prompt_version=${row.prompt_version}`);
    const rad = row.raw_api_data || {};
    const anchorMs = rad.created_at ? rad.created_at * 1000 : null;
    console.log('代币创建锚 raw_api_data.created_at:', rad.created_at, anchorMs ? new Date(anchorMs).toISOString() : '(缺失)', '| name:', rad.name, '| symbol:', rad.symbol);

    // ── 语料各槽位时间 ──
    const ti = row.twitter_info;
    if (!ti) {
      console.log('twitter_info: NULL');
    } else {
      console.log(`\n-- twitter_info: type=${ti.type} handle=@${ti.handle ?? ti.screen_name} 作者粉=${ti.author_followers_count ?? ti.followers_count ?? '?'}`);
      const slots = [
        ['主推', ti],
        ['website_tweet', ti.website_tweet],
        ['quoted_status', ti.quoted_status],
        ['retweeted_status', ti.retweeted_status],
      ];
      for (const [label, t] of slots) {
        if (!t) { console.log(`  [${label}] 不在场`); continue; }
        const lag = lagOf(t.created_at, anchorMs);
        console.log(`  [${label}] created_at=${t.created_at} lag=${fmtLag(lag)}${lag !== null && lag > 0 ? '（旧）' : lag !== null ? '（新于锚!）' : ''} 赞=${t.favorite_count ?? '?'} 转=${t.retweet_count ?? '?'} 作者=@${t.author_screen_name ?? t.handle ?? '?'}`);
        const txt = (t.full_text || t.text || '').replace(/\n/g, ' ').slice(0, 160);
        console.log(`      text: ${txt}`);
      }
      // 父推（C102 借壳语料父推源头窗判据）
      const irp = ti.in_reply_to || (ti.tweets && ti.tweets[0] && ti.tweets[0].in_reply_to);
      if (irp) {
        const lag = lagOf(irp.created_at, anchorMs);
        console.log(`  [父推 in_reply_to] created_at=${irp.created_at} lag=${fmtLag(lag)} 作者=@${irp.author_screen_name ?? irp.handle ?? '?'} 粉=${irp.author_followers_count ?? '?'}`);
        console.log(`      text: ${(irp.full_text || irp.text || '').replace(/\n/g, ' ').slice(0, 160)}`);
      } else {
        console.log('  [父推 in_reply_to] 不在场');
      }
      // 账号内其余推文（语料 freshness 多推文判定源）
      const tw = ti.tweets || [];
      console.log(`  tweets 列表 ${tw.length} 条:`);
      for (const t of tw.slice(0, 8)) {
        const lag = lagOf(t.created_at, anchorMs);
        console.log(`    created=${t.created_at} lag=${fmtLag(lag)} 赞=${t.favorite_count ?? '?'} 转=${t.retweet_count ?? '?'} | ${(t.full_text || t.text || '').replace(/\n/g, ' ').slice(0, 100)}`);
      }
      console.log(`  账号注册时间 author_created_at=${ti.author_created_at ?? '?'} lag=${fmtLag(lagOf(ti.author_created_at, anchorMs))}`);
    }

    // ── precheck 审计 ──
    const pcr = row.pre_check_result;
    console.log(`\n-- pre_check_result: pass=${pcr?.pass} rating=${pcr?.rating} ruleName=${pcr?.details?.ruleName ?? pcr?.ruleName}`);
    if (pcr?.reason) console.log('   reason:', pcr.reason);
    if (pcr?.details) {
      const { tweetType, freshWindowSec, staleDirectLagSec, searchEvidence, ...rest } = pcr.details;
      console.log('   details: tweetType=', tweetType, 'freshWindowSec=', freshWindowSec, 'staleDirectLagSec=', staleDirectLagSec);
      if (searchEvidence) console.log('   searchEvidence:', JSON.stringify(searchEvidence).slice(0, 400));
      const restS = JSON.stringify(rest);
      if (restS !== '{}') console.log('   其余 details:', restS.slice(0, 600));
    }

    // ── 评分/终态里的时效字段 ──
    for (const [label, obj] of [['final_result', row.final_result], ['event_score_result', row.event_score_result]]) {
      if (!obj) { console.log(`\n-- ${label}: NULL`); continue; }
      const d = obj.details || {};
      console.log(`\n-- ${label}: rating=${obj.rating}`);
      console.log(`   timingScore=${d.timingScore} timing_bucket=${d.timingBucket ?? d.timing ?? '?'} shellCorpusStale=${JSON.stringify(d.shellCorpusStale)}`);
      if (d.jev) {
        const j = d.jev;
        // timing 相关审计键粗筛
        const timingKeys = Object.entries(j).filter(([k, v]) => /timing|Timing|fresh|Fresh|stale|Stale|lag|Lag|parent|Parent|shell/.test(k));
        if (timingKeys.length) console.log('   jev timing 相关键:', JSON.stringify(Object.fromEntries(timingKeys)).slice(0, 1200));
        const et = j.event_timing ?? j.answers?.event_timing;
        if (et) console.log('   jev event_timing 答案:', JSON.stringify(et).slice(0, 400));
        const pr = j.parent_relationship ?? j.answers?.parent_relationship;
        if (pr) console.log('   jev parent_relationship 答案:', JSON.stringify(pr).slice(0, 300));
      }
      if (obj.reason) console.log('   reason:', obj.reason.slice(0, 400));
    }

    console.log('\n-- classified_urls:', JSON.stringify(row.classified_urls).slice(0, 500));
    if (row.prestage_result) console.log('-- prestage(截断):', JSON.stringify(row.prestage_result).slice(0, 250));
  }

  // ── 链上创建时间（wss_events token_create 单行；blockNumber 在 payload 内）──
  const { data: ev, error: e2 } = await db
    .from('wss_events')
    .select('kind,platform,block_time,created_at,payload')
    .eq('token_address', ADDR)
    .eq('kind', 'token_create')
    .order('created_at', { ascending: true })
    .limit(3);
  if (e2) console.log('\nwss_events error:', e2.message);
  else {
    console.log('\n=== wss_events token_create:', ev.length, '行');
    for (const e of ev) {
      const p = e.payload || {};
      console.log(`  platform=${e.platform} block=${p.blockNumber ?? '?'} block_time=${e.block_time} ingested_at=${e.created_at}`);
    }
    if (ev.length && ev[0].block_time) {
      const chainMs = new Date(ev[0].block_time).getTime();
      const mainCreated = tn[0]?.twitter_info?.created_at;
      console.log(`  ⚠ 叙事行 raw_api_data.created_at 缺失（时效 precheck 2.1 跳过 + Jev state 退墙钟）`);
      console.log(`  链上创建锚=${ev[0].block_time}；主推(${mainCreated}) 对链上锚 lag=${fmtLag(lagOf(mainCreated, chainMs))}`);
    }
  }

  // ── 分析轮次 ──
  const { data: rounds, error: e3 } = await db
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e3) console.log('rounds error:', e3.message);
  else {
    console.log('\n=== narrative_analysis_rounds:', rounds.length, '行');
    for (const r of rounds) {
      console.log(`  exp=${r.experiment_id} reason=${r.reason} rating=${r.rating} created=${r.created_at}`);
      if (r.details) console.log('    details:', JSON.stringify(r.details).slice(0, 300));
    }
  }

  // ── 信号留痕 ──
  const { data: sigs, error: e4 } = await db
    .from('strategy_signals')
    .select('id,experiment_id,strategy_id,signal_type,action,reason,created_at,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e4) console.log('signals error:', e4.message);
  else {
    console.log('\n=== strategy_signals:', sigs.length, '行');
    for (const s of sigs) {
      console.log(`  exp=${s.experiment_id} type=${s.signal_type} action=${s.action} created=${s.created_at} | ${(s.reason || '').slice(0, 200)}`);
    }
  }

  // ── 成交留痕 ──
  const { data: trades, error: e5 } = await db
    .from('trades')
    .select('id,experiment_id,side,amount_bnb,price_bnb,created_at,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e5) console.log('trades error:', e5.message);
  else {
    console.log('\n=== trades:', trades.length, '行');
    for (const t of trades) {
      console.log(`  exp=${t.experiment_id} ${t.side} ${t.amount_bnb} BNB @${t.price_bnb} created=${t.created_at}`);
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
