#!/usr/bin/env node
/**
 * 临时复验（2026-10-03，J1.27 终校准 4 张异常票定性）：RedCoin（C42 豁免在 J1.27
 * 下 newProductP 失配？）/ 金六根（对照赢票 59.08 贴线稳定性）/ BOB（84.92 高分被
 * nameReferent 截词）/ FlapGuy（flap 官方吉祥物=机构日常运营拦截，币安豁免同构边界）。
 * 线上 state 原文 + J1.27 + context 全键，双轮。纯读不写 DB。
 *
 * 用法（182 项目根）：node scripts/narrative/_verify-anomalies-j127.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

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
  ['0x40278f10acf21d0994b64a8bb287b7662a447777', 'RedCoin', 'C42豁免在J1.27下是否失配'],
  ['0x7466248c7ed0d5e42b2f452ddda2bd179f527777', '金六根', '对照赢票 59.08 贴线稳定性'],
  ['0xf2fca4cf09986e97220c2371e3184c91b4637777', 'BOB', '84.92 高分被截词是否稳定'],
  ['0x2fb77ad099f60c0fdb0a8301bf94c4a8d8ac7777', 'FlapGuy', '机构日常运营拦截稳定性'],
];

const supabase = NarrativeRepository.getSupabase();
const { data: rows, error } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage1_prompt, stage_final_result')
  .in('token_address', TICKETS.map(t => t[0]));
if (error) throw new Error(error.message);

console.log(`J1.27 异常 4 票复验（${JEV_QUESTIONS_VERSION}）\n`);
for (const row of rows) {
  const info = TICKETS.find(t => t[0] === row.token_address);
  let state = null;
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    state = p?.state || null;
  } catch { }
  if (!state) { console.log(`${info[1]} —— 无 stage1_prompt，跳过`); continue; }
  const tokenData = { address: row.token_address, symbol: row.token_symbol, name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data };
  const fetchResults = { twitterInfo: row.twitter_info, extractedInfo: row.extracted_info || null, classifiedUrls: row.classified_urls || null };
  const superIPInfo = detectSuperIP(row.extracted_info?.twitterUrl || row.classified_urls?.twitter?.[0]?.url, row.twitter_info);
  const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, fetchResults);
  const squareVerified = /【币安广场内容】[\s\S]*?作者认证:\s*官方认证账号/.test(state);
  const credibleEventAnchor = !!(superIPInfo || issuerSelfLaunch || squareVerified);
  const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
  const igLinked = !!(row.classified_urls?.instagram?.length > 0);
  const igFetched = igLinked && /instagram/i.test(state);

  console.log(`════ ${info[1]} ${row.token_address}（${info[2]}）`);
  console.log(`  线上 J1.26=${row.stage_final_result?.rating}/${row.stage_final_result?.score} anchor=${credibleEventAnchor}`);
  for (let round = 1; round <= 2; round++) {
    const q = buildStandardQuestions({ includeBrandHijack });
    const r = await JevClient.ask(state, q, { label: `van:${row.token_symbol}#${round}` });
    const m = mapStandardAnswers(r.answers, {
      tokenData, includeBrandHijack, twitterInfo: row.twitter_info,
      credibleEventAnchor, instagramLinked: igLinked, instagramInfoFetched: igFetched,
      tweetClassification: classifyTweetType(row.twitter_info),
      callInfo: { model: r.model, questions: q, stateStats: null, state, usage: r.usage, startedAt: '', finishedAt: '' },
    });
    const a = r.answers;
    const jev2 = m.stage2DataToSave?.parsed_output?.jev ?? {};
    const jev3 = m.stage3DataToSave?.parsed_output?.jev ?? {};
    console.log(`  R${round}: cat=${a.event_category?.choice} mag=${a.event_magnitude?.score?.toFixed(2)}（P分布=${JSON.stringify(a.event_magnitude?.probabilities)}）dim2=${a.dimension2?.score?.toFixed(2)} se=${a.subject_entity?.choice} nr=${JSON.stringify(a.name_referent?.probabilities)} => ${m.llmResult.rating}/${m.llmResult.score}`);
    console.log(`      wInt=${jev3.wInteraction ?? jev2.wInteraction ?? '-'} wProd=${jev3.wProduct ?? '-'} time=${jev3.timeliness ?? '-'} wExempt=${JSON.stringify(jev3.wInteractionExempt ?? null)} blk=${m.stage3DataToSave?.parsed_output?.blockReason ?? m.stage2DataToSave?.parsed_output?.blockReason ?? '无'}`);
  }
  console.log('');
}
process.exit(0);
