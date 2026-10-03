#!/usr/bin/env node
/**
 * 临时诊断（2026-10-03，C55/J1.27 币安豁免闭环）：dump 币安系 4+1 票的线上形状——
 * 语料作者/认证/粉丝、classified_urls 桶、stage1_prompt 里的 state 章节（币安广场节
 * 是否在线上 state 里）、旧 stage3 jev.brandHijackP / stage2 tier——确定
 * credibleEventAnchor 三源（superIP / issuer / binanceSquare.authorVerified）
 * 哪个在线上成立，以及 r2 校准 state 的保真缺口。纯读不写。
 *
 * 用法（182 项目根）：node scripts/narrative/_dump-binance-rows.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');

const ADDRS = [
  ['0x4a674ed30cb3000cb53a77f2709a0e3f53e77777', '币安智能1'],
  ['0xb4705a3509c58b8fba42cf8486e4073289277777', '币安智能2'],
  ['0x1e5b6706808441f8b9337daf311c930c47347777', '币智'],
  ['0x7536fa09026a8b19fbe4f672d33b74161d717777', '智安'],
];

const supabase = NarrativeRepository.getSupabase();
// bIntelligence 全地址先查出来
const { data: biRows } = await supabase.from('token_narrative')
  .select('token_address, token_symbol')
  .ilike('token_symbol', '%ntelligence%');
for (const r of biRows || []) ADDRS.push([r.token_address, `${r.token_symbol}(模糊命中)`]);

const { data: rows, error } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, prompt_type, analyzed_at, twitter_info, classified_urls, data_fetch_results, stage1_prompt, stage2_result, stage3_result, stage_final_result')
  .in('token_address', ADDRS.map(a => a[0]));
if (error) throw new Error(error.message);
const tagOf = new Map(ADDRS);

for (const row of rows) {
  console.log(`\n════ ${tagOf.get(row.token_address)} ${row.token_symbol} ${row.token_address}`);
  const tw = row.twitter_info;
  console.log(`  prompt_type=${row.prompt_type} analyzed_at=${row.analyzed_at}`);
  if (tw) {
    console.log(`  twitter: type=${tw.type} author=@${tw.author_screen_name ?? tw.screen_name} 粉=${tw.author_followers_count ?? tw.followers_count ?? '?'} 认证=${tw.author_verified ?? tw.verified ?? '?'}`);
    console.log(`    text: ${String(tw.text || '').slice(0, 90).replace(/\n/g, ' ')}`);
    if (tw.in_reply_to?.text) console.log(`    父推: ${String(tw.in_reply_to.text).slice(0, 90).replace(/\n/g, ' ')}`);
  } else {
    console.log('  twitter: 无');
  }
  const cu = row.classified_urls || {};
  const buckets = Object.entries(cu).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`  classified_urls 非空桶: ${buckets || '无'}`);
  const dfr = row.data_fetch_results || {};
  const dfrKeys = Object.entries(dfr).filter(([, v]) => v && v.success).map(([k]) => k).join('/');
  console.log(`  data_fetch_results 成功源: ${dfrKeys || '无'}${dfr.binanceSquare ? `（binanceSquare.success=${dfr.binanceSquare.success}）` : ''}`);
  // state 章节头
  let stateSections = '?';
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    const st = p?.state || '';
    stateSections = [...st.matchAll(/^\[([A-Z_]+)\]/gm)].map(m => m[1]).join('→');
    console.log(`  state 章节: ${stateSections}（${st.length} 字符）`);
    const bs = st.indexOf('BINANCE_SQUARE');
    if (bs >= 0) console.log(`    币安广场节片段: ${st.slice(bs, bs + 200).replace(/\n/g, '⏎')}`);
  } catch (e) { console.log(`  state 解析失败: ${e.message}`); }
  const s2 = row.stage2_result?.details?.scoringResult;
  const s2j = row.stage2_result?.details?.jev || row.stage2_result?.details?.parsed_output?.jev;
  const s3j = row.stage3_result?.details?.parsed_output?.jev || row.stage3_result?.details?.jev;
  console.log(`  线上 stage2: total=${s2?.totalScore} tier=${s2j?.magnitudeTier} cat=${s2?.category} dim2=${s2?.dimension2}`);
  console.log(`  线上 stage3 jev: brandHijackP=${s3j?.brandHijackP} punExempt=${JSON.stringify(s3j?.punExempt)} rel=${s3j?.relevanceType}`);
  console.log(`  线上 final: ${row.stage_final_result?.rating}/${row.stage_final_result?.score} block=${row.stage_final_result?.blockReason}`);
}
process.exit(0);
