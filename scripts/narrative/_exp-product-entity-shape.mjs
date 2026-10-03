#!/usr/bin/env node
/**
 * 临时实验（2026-10-03，C55 华为麒麟案族）：
 *  - 第一阶段（wording 实验，已完成）：同 state 两轮 ask——原题面 vs 形状③追加题面，
 *    证明语义修正类题面能移动 Jev（麒麟 mag 4.58→2.97、fit sf44→mg62）。
 *  - 第二阶段（当前，J1.27 落地后端到端验证）：buildStandardQuestions 已原生含
 *    形状③ + 第 15 题 subject_entity + 币安豁免句——单轮 ask 走全链，
 *    验证麒麟被产品实体接纳门拦翻 low、币安票（BI 案）豁免不拦、对照赢票不误伤。
 *
 * 用法：node scripts/narrative/_exp-product-entity-shape.mjs
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

// ── 验证票：2 产品簇 + 1 币安豁免（BI 案）+ 2 对照赢 ──
const TICKETS = [
  { addr: '0x967e4a528c264529fe8d6d9773665a6357787777', tag: '麒麟·应被门拦翻low' },
  { addr: '0x70db4674c85e77cda99dc1154ac2cb7236327777', tag: '狗剩·应翻low' },
  { addr: '0xcaf66eb2c00d206d741a654face34768cf2a7777', tag: 'BI·币安豁免·不应被本门拦' },
  { addr: '0xec16bb6976fdf303de24e9b0669e928f04a17777', tag: '中国猪能飞·对照赢·零误伤' },
  { addr: '0xde3e6c39a304b69c606c67885bbff390ca427777', tag: '小八·对照赢·零误伤' },
];

const supabase = NarrativeRepository.getSupabase();
const { data: rows, error } = await supabase
  .from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage_final_result')
  .in('token_address', TICKETS.map(t => t.addr));
if (error) throw new Error(error.message);
const byAddr = new Map(rows.map(r => [r.token_address, r]));

console.log(`J1.27 端到端验证（版本 ${JEV_QUESTIONS_VERSION}，题面含形状③+subject_entity+币安豁免）\n`);

for (const t of TICKETS) {
  const row = byAddr.get(t.addr);
  if (!row || !row.twitter_info) { console.log(`\n### ${t.tag} —— 无语料行，跳过`); continue; }
  const tokenData = {
    address: row.token_address, symbol: row.token_symbol,
    name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data,
  };
  const twitterInfo = row.twitter_info;
  const fetchResults = {
    twitterInfo, websiteInfo: null, githubInfo: null, backgroundInfo: null,
    youtubeInfo: null, douyinInfo: null, tiktokInfo: null, bilibiliInfo: null,
    weixinInfo: null, amazonInfo: null, xiaohongshuInfo: null, instagramInfo: null,
    binanceSquareInfo: null, extractedInfo: row.extracted_info || null,
    classifiedUrls: row.classified_urls || null, relatedAccounts: null, accountSummary: null,
  };
  const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
  const now = row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined;
  const { state, stats } = buildJevState(tokenData, fetchResults, { now });

  const q = buildStandardQuestions({ includeBrandHijack });
  const r = await JevClient.ask(state, q, { label: `j127:${row.token_symbol}` });
  const m = mapStandardAnswers(r.answers, {
    tokenData, includeBrandHijack, twitterInfo,
    callInfo: { model: r.model, questions: q, stateStats: stats, usage: r.usage, startedAt: '', finishedAt: '' },
  });
  const a = r.answers;
  const se = a.subject_entity?.choice;
  const fitP = a.web3_fit?.probabilities ?? {};
  const fitMass = Math.round(((fitP.strong_fit ?? 0) + (fitP.fit ?? 0)) * 100);
  const audit = m.stage2DataToSave?.parsed_output?.jev ?? {};
  console.log(`### ${row.token_symbol} ${t.tag}`);
  console.log(`  ${row.token_address}`);
  console.log(`  cat=${a.event_category?.choice} mag=${a.event_magnitude?.score?.toFixed(2)} dim2=${a.dimension2?.score?.toFixed(2)} se=${se}(p${Math.round((a.subject_entity?.probabilities?.[se] ?? 0) * 100)}%) fitMass=${fitMass}%`);
  console.log(`  线上=${row.stage_final_result?.rating}/${row.stage_final_result?.score} → J1.27=${m.llmResult.rating}/${m.llmResult.score}`);
  if (audit.productEntityBlock) console.log(`  🚫 产品门命中: subject=${audit.productEntityBlock.subject} fitMass=${audit.productEntityBlock.fitMass}`);
  if (audit.productEntityBinanceExempt) console.log(`  🏦 币安豁免命中`);
  console.log(`  reason: ${m.llmResult.reason.slice(0, 160)}\n`);
}
process.exit(0);
