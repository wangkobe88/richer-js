#!/usr/bin/env node
/**
 * 临时终验（2026-10-03，state 缺口 × J1.27 净效应交互检查）：r2-vs-ctrl 净效应集里
 * 线上 state 含非持久化语料节的 13 票（10 净降 + 3 净升）——用线上 stage1_prompt.state
 * 原文（bit-identical）+ J1.27 题面 + context 全键重跑双轮，验证净效应结论是否被
 * state 缺口夸大/伪造。纯读不写 DB。
 *
 * 用法（182 项目根）：node scripts/narrative/_verify-netdown-state.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectSuperIP } = await import('../../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
const { detectIssuerSelfLaunch } = await import('../../src/narrative/analyzer/utils/narrative-utils.mjs');
const { classifyTweetType } = await import('../../src/narrative/analyzer/services/tweet-type-classifier.mjs');

const TICKETS = [
  // ── 缺节净降 10（J1.27 净打击面里的 state 缺口嫌疑票）──
  ['0x1c797191fba12bee7326b27341f74455f2da7777', '多多进宝', 'down'],
  ['0x4f325bc57df152a9c517ac8d05999f8a99c87777', '爱中文', 'down'],
  ['0xdfa9971f1aa86fa70913ce592e3bfd4abce37777', '豚豚币', 'down'],
  ['0x0f933e68ff1e5d033f70baa453f2e6016ccd7777', 'MICROCAT', 'down'],
  ['0xfdfd170cbae5388f4014d4e0cd923f711f667777', '地书', 'down'],
  ['0x24480384be0de9f536923baf027318ecc9167777', '霸王花鴨', 'down'],
  ['0x70db4674c85e77cda99dc1154ac2cb7236327777', '狗剩1', 'down'],
  ['0xf0355e9bbc8ae2de06b958237be626c2d6e17777', '狗剩3', 'down'],
  ['0xb51734d55181073aa0edc5c65318884f0e157777', 'GOOGLECHIP', 'down'],
  ['0xeeb7752ee078fe8cff8d19343ef7abe9a3627777', '狗剩4', 'down'],
  // ── 缺节净升 3（净升 artifact 嫌疑票）──
  ['0x7485a4d39e5bc31419d544190d67c793f84a7777', '人民的阿祖', 'up'],
  ['0x01e898fa1308b00e4e9f9b5f88dde1aab3967777', '波兰球', 'up'],
  ['0xdbb4c6c9ccf112057ae21500b1e1f66df0f57777', '火腿肠笔', 'up'],
];

// r2/ctrl 评级对照（本地 json 在 182 /tmp 同路径）
const r2By = new Map(JSON.parse(readFileSync('/tmp/calib-j127-r2.json', 'utf8')).results.filter(r => !r.skip).map(r => [r.addr, r]));
const ctrlBy = new Map(JSON.parse(readFileSync('/tmp/calib-j125-ctrl.json', 'utf8')).results.filter(r => !r.skip).map(r => [r.addr, r]));

const supabase = NarrativeRepository.getSupabase();
const { data: rows, error } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage1_prompt, stage_final_result')
  .in('token_address', TICKETS.map(t => t[0]));
if (error) throw new Error(error.message);
console.log(`J1.27 净效应集缺节 13 票 · 线上 state 原文重跑（${JEV_QUESTIONS_VERSION}）\n`);

let downHold = 0, downFlip = 0, upHold = 0, upFlip = 0;
for (const row of rows) {
  const info = TICKETS.find(t => t[0] === row.token_address);
  const label = info[1], dir = info[2];
  let state = null;
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    state = p?.state || null;
  } catch { }
  if (!state) { console.log(`${label} ${row.token_address} —— 无 stage1_prompt，跳过`); continue; }
  const tokenData = { address: row.token_address, symbol: row.token_symbol, name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data };
  const fetchResults = { twitterInfo: row.twitter_info, extractedInfo: row.extracted_info || null, classifiedUrls: row.classified_urls || null };
  const superIPInfo = detectSuperIP(row.extracted_info?.twitterUrl || row.classified_urls?.twitter?.[0]?.url, row.twitter_info);
  const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, fetchResults);
  const squareVerified = /【币安广场内容】[\s\S]*?作者认证:\s*官方认证账号/.test(state);
  const credibleEventAnchor = !!(superIPInfo || issuerSelfLaunch || squareVerified);
  const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
  const igLinked = !!(row.classified_urls?.instagram?.length > 0);
  const igFetched = igLinked && /instagram/i.test(state);

  const r2r = r2By.get(row.token_address), ctr = ctrlBy.get(row.token_address);
  const outs = [];
  for (let round = 1; round <= 2; round++) {
    const q = buildStandardQuestions({ includeBrandHijack });
    const r = await JevClient.ask(state, q, { label: `vnd:${row.token_symbol}#${round}` });
    const m = mapStandardAnswers(r.answers, {
      tokenData, includeBrandHijack, twitterInfo: row.twitter_info,
      credibleEventAnchor, instagramLinked: igLinked, instagramInfoFetched: igFetched,
      tweetClassification: classifyTweetType(row.twitter_info),
      callInfo: { model: r.model, questions: q, stateStats: null, state, usage: r.usage, startedAt: '', finishedAt: '' },
    });
    const a = r.answers;
    const jev2 = m.stage2DataToSave?.parsed_output?.jev ?? {};
    const fitP = a.web3_fit?.probabilities ?? {};
    const fitMass = Math.round(((fitP.strong_fit ?? 0) + (fitP.fit ?? 0)) * 100);
    outs.push({ cat: a.event_category?.choice, mag: a.event_magnitude?.score?.toFixed(2), dim2: a.dimension2?.score?.toFixed(2), se: a.subject_entity?.choice, fitMass, rating: m.llmResult.rating, score: m.llmResult.score, blk: m.stage2DataToSave?.parsed_output?.blockReason ?? m.stage3DataToSave?.parsed_output?.blockReason ?? '无', pe: jev2.productEntityBlock ?? null });
  }
  const hold = dir === 'down'
    ? outs.every(o => o.rating === 'low') ? (downHold++, '✅仍low（净降成立）') : (downFlip++, `⚠️翻${outs.map(o => o.rating).join('/')}（净降存疑）`)
    : outs.every(o => o.rating !== 'low') ? (upHold++, '✅仍放行（净升成立）') : (upFlip++, `⚠️翻${outs.map(o => o.rating).join('/')}（净升存疑）`);
  console.log(`[${dir}] ${label} ${row.token_address}`);
  console.log(`   线上=${row.stage_final_result?.rating}/${row.stage_final_result?.score} ctrl=${ctr?.newRating}/${ctr?.newScore} r2重建state=${r2r?.newRating}/${r2r?.newScore}（se=${r2r?.se} fit=${r2r?.fitMass}%）`);
  for (const o of outs) console.log(`   →真state: cat=${o.cat} mag=${o.mag} dim2=${o.dim2} se=${o.se} fit=${o.fitMass}% ${o.pe ? `🚫产品门(fit=${o.pe.fitMass}) ` : ''}=> ${o.rating}/${o.score} blk=${o.blk}`);
  console.log(`   ${hold}\n`);
}
console.log(`\n══ 汇总：净降 10 票中 ${downHold} 仍 low / ${downFlip} 翻案；净升 3 票中 ${upHold} 仍放行 / ${upFlip} 翻案 ══`);
process.exit(0);
