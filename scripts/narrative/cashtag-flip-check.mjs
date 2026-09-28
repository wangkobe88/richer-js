#!/usr/bin/env node
/**
 * J1.17 cashtag 改道——存量行翻转检查（离线 re-map，零 Jev 调用）
 *
 * 用已落库的 stage1_raw_output（内含原始 answers）重放 mapStandardAnswers，
 * 对比新旧 rating，列出被 cashtag 改道翻案的行：
 * - 正向翻转（high/mid → low）：本规则的预期拦截对象（如 C28 iNu）
 * - 反向翻转（low → high/mid）：W 数学反而放行的存量行（需人工过目）
 *
 * 数据面：token_narrative 标准路径行（prompt_type like 'jev(%'），分页 1000/批。
 * 在 182 跑（本地 VPN 拉不动重文本列）。
 *
 * 用法：node scripts/narrative/cashtag-flip-check.mjs
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectCorpusCashtag } = await import('../../src/narrative/analyzer/utils/narrative-utils.mjs');
const { shouldIncludeBrandHijackCheck } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');

const sb = NarrativeRepository.getSupabase();

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('token_narrative')
    .select('token_address, token_symbol, prompt_type, is_valid, analysis_stage, stage_final_result, twitter_info, stage1_raw_output')
    .like('prompt_type', 'jev(%')
    .order('token_address')
    .range(from, from + 999);
  if (error) { console.error('拉取失败:', error.message); process.exit(1); }
  if (!data?.length) break;
  rows.push(...data);
  if (data.length < 1000) break;
}
console.log(`标准路径行：${rows.length}`);

let scanned = 0, noAnswers = 0, noSymbol = 0, cashtagRows = 0;
const flips = [], reverseFlips = [], unchanged = [];

for (const row of rows) {
  let answers;
  try { answers = JSON.parse(row.stage1_raw_output || 'null')?.answers; } catch { /* 旧格式行 */ }
  if (!answers?.event_category) { noAnswers++; continue; }
  scanned++;

  const tokenData = { symbol: row.token_symbol, name: null, raw_api_data: null };
  if (!tokenData.symbol) noSymbol++;
  const hit = detectCorpusCashtag(tokenData, row.twitter_info);
  if (!hit) continue;
  cashtagRows++;

  const mapped = mapStandardAnswers(answers, {
    tokenData,
    includeBrandHijack: shouldIncludeBrandHijackCheck(tokenData.symbol, ''),
    twitterInfo: row.twitter_info,
    callInfo: { model: 'offline', questions: {}, stateStats: {}, state: '', usage: {}, startedAt: '', finishedAt: '' },
  });
  const oldRating = row.stage_final_result?.rating ?? '(null)';
  const newRating = mapped.llmResult.rating;
  const rec = {
    addr: row.token_address, sym: row.token_symbol, cashtag: hit.cashtag, parent: hit.inReplyTo,
    jevCat: answers.event_category.choice, oldRating, oldScore: row.stage_final_result?.totalScore ?? null,
    newRating, newScore: mapped.llmResult.score ?? null,
    stage2: mapped.stage2DataToSave?.parsed_output?.reason ?? mapped.stage2DataToSave?.parsed_output?.blockReason ?? '',
  };
  if (oldRating !== 'low' && newRating === 'low') flips.push(rec);
  else if (oldRating === 'low' && newRating !== 'low') reverseFlips.push(rec);
  else unchanged.push(rec);
}

console.log(`可解析 answers：${scanned}（不可解析 ${noAnswers}，缺 symbol ${noSymbol}）`);
console.log(`cashtag 命中：${cashtagRows}（翻转 ${flips.length} / 反向 ${reverseFlips.length} / 不变 ${unchanged.length}）\n`);

const show = (list, title) => {
  console.log(`── ${title}（${list.length}）──`);
  for (const r of list) {
    console.log(`${r.sym || '?'} ${r.addr} $${r.cashtag}${r.parent ? '(父推)' : ''} jev=${r.jevCat} | ${r.oldRating}${r.oldScore != null ? `(${r.oldScore})` : ''} → ${r.newRating}${r.newScore != null ? `(${r.newScore})` : ''} | ${r.stage2}`);
  }
  console.log('');
};
show(flips, '正向翻转（拦截，预期方向）');
show(reverseFlips, '反向翻转（W 数学放行，需过目）');
show(unchanged, '评级不变');
process.exit(0);
