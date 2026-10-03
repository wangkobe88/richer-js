#!/usr/bin/env node
/**
 * 临时精查（2026-10-03，C55/J1.27 币安豁免闭环终验）：币安系 5 票单票全链重跑——
 *   ① state 保真：重建 state 与线上 stage1_prompt.state 全等对比（排除保真缺口）
 *   ② context 全键复刻：credibleEventAnchor（三源：superIP/issuer/square.authorVerified）
 *      + instagramLinked/InfoFetched + tweetClassification——与 NarrativeAnalyzer 同参
 *   ③ stage3 拦因定位：brandHijackP / punExempt / effTier / includeBrandHijack 全打
 *   ④ 同题面双轮方差：同 state 连跑 2 轮 ask，量级/劫持分的跨 run 抖动幅度
 * 纯读不写 DB。
 *
 * 用法（182 项目根，需 J1.27 questions+mapper 在工作区）：
 *   node scripts/narrative/_verify-binance-j127.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');
const { buildJevState } = await import('../../src/narrative/analyzer/llm/jev-state-builder.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectSuperIP } = await import('../../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
const { detectIssuerSelfLaunch } = await import('../../src/narrative/analyzer/utils/narrative-utils.mjs');
const { classifyTweetType } = await import('../../src/narrative/analyzer/services/tweet-type-classifier.mjs');

const TICKETS = [
  ['0x4a674ed30cb3000cb53a77f2709a0e3f53e77777', '币安智能1'],
  ['0xb4705a3509c58b8fba42cf8486e4073289277777', '币安智能2'],
  ['0x1e5b6706808441f8b9337daf311c930c47347777', '币智'],
  ['0x7536fa09026a8b19fbe4f672d33b74161d717777', '智安'],
  ['0x5439b53495418c516e86a9307f1e15c6e4877777', 'bIntelligence'],
];

const supabase = NarrativeRepository.getSupabase();
const { data: rows, error } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage1_prompt, stage_final_result')
  .in('token_address', TICKETS.map(t => t[0]));
if (error) throw new Error(error.message);
const tagOf = new Map(TICKETS);

console.log(`J1.27 币安 5 票精查（${JEV_QUESTIONS_VERSION}）\n`);

for (const row of rows) {
  const tag = tagOf.get(row.token_address);
  const tokenData = {
    address: row.token_address, symbol: row.token_symbol,
    name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data,
  };
  const fetchResults = {
    twitterInfo: row.twitter_info, websiteInfo: null, githubInfo: null, backgroundInfo: null,
    youtubeInfo: null, douyinInfo: null, tiktokInfo: null, bilibiliInfo: null,
    weixinInfo: null, amazonInfo: null, xiaohongshuInfo: null, instagramInfo: null,
    binanceSquareInfo: null, extractedInfo: row.extracted_info || null,
    classifiedUrls: row.classified_urls || null, relatedAccounts: null, accountSummary: null,
  };
  // ① state 保真：直接复用线上 stage1_prompt.state 原文（bit-identical）——
  //    binance_square_info/instagram_info 等不持久化为列，重建必缺【币安广场内容】节
  //    （本案实证：线上 675 vs 重建 466 字符，缺官方认证发布会语境 → mag 掉档/劫持分升高）
  let onlineState = null;
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    onlineState = p?.state || null;
  } catch { /* 旧行非 JSON */ }
  const state = onlineState
    || buildJevState(tokenData, fetchResults, { now: row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined }).state;
  const stateSrc = onlineState ? '线上原文' : '重建(fallback)';
  const stats = null;

  // ② context 三源复刻（NarrativeAnalyzer.mjs:602 同参）。广场源：authorVerified 不持久化，
  //    从线上 state 的【币安广场内容】节「作者认证: 官方认证账号」推导
  //    （BinanceSquareFetcher: authorVerified = authorVerificationType>0 的 state 呈现）
  const superIPInfo = detectSuperIP(
    row.extracted_info?.twitterUrl || row.classified_urls?.twitter?.[0]?.url,
    row.twitter_info
  );
  const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, fetchResults);
  const binanceSquareVerified = /【币安广场内容】[\s\S]*?作者认证:\s*官方认证账号/.test(state);
  const credibleEventAnchor = !!(superIPInfo || issuerSelfLaunch || binanceSquareVerified);

  const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
  console.log(`════ ${tag} ${row.token_symbol} ${row.token_address}`);
  console.log(`  state=${stateSrc}（${state.length} 字符）· anchor源: superIP=${!!superIPInfo} issuer=${!!issuerSelfLaunch} square官方认证=${binanceSquareVerified} → credibleEventAnchor=${credibleEventAnchor}`);
  console.log(`  includeBrandHijack=${includeBrandHijack} 线上final=${row.stage_final_result?.rating}/${row.stage_final_result?.score}`);

  // ③④ 双轮 ask（同 state 同题面，量级/劫持跨 run 方差）
  for (let round = 1; round <= 2; round++) {
    const q = buildStandardQuestions({ includeBrandHijack });
    const r = await JevClient.ask(state, q, { label: `vbin:${row.token_symbol}#${round}` });
    const m = mapStandardAnswers(r.answers, {
      tokenData, includeBrandHijack, twitterInfo: row.twitter_info,
      credibleEventAnchor,
      instagramLinked: !!(row.classified_urls?.instagram?.length > 0),
      instagramInfoFetched: !!(row.classified_urls?.instagram?.length > 0) && /instagram/i.test(state),
      tweetClassification: classifyTweetType(row.twitter_info),
      callInfo: { model: r.model, questions: q, stateStats: stats, state, usage: r.usage, startedAt: '', finishedAt: '' },
    });
    const a = r.answers;
    const s3 = m.stage3DataToSave;
    const s3j = s3?.parsed_output?.jev ?? {};
    console.log(`  R${round}: cat=${a.event_category?.choice} mag=${a.event_magnitude?.score?.toFixed(2)} dim2=${a.dimension2?.score?.toFixed(2)} se=${a.subject_entity?.choice} hijackP=${s3j.brandHijackP ?? '-'} punExempt=${JSON.stringify(s3j.punExempt)} → ${m.llmResult.rating}/${m.llmResult.score}`);
    console.log(`      s2blk=${m.stage2DataToSave?.parsed_output?.blockReason ?? '无'} s3blk=${s3?.parsed_output?.blockReason ?? '无'}${s3?.parsed_output?.blockReason ? `（relevance=${s3j.relevanceType}/lv${s3j.relevanceLevelIdx} 拼写P=${s3j.misspellingP}）` : ''}`);
  }
  console.log('');
}
process.exit(0);
