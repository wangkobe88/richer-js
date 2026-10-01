#!/usr/bin/env node
/**
 * J1.23 Web3 偏好量级锚——存量行离线重放（零 API：用已落库的 Jev answers 快照
 * + 新版 mapper 重映射，隔离「锚」这一增量的影响；题面增量已由久留美/C30/C31/
 * Marky 四票实跑覆盖）。
 *
 * 圈定：prompt_version like 'jev-J1.2%' 且 category=A 且 web3_fit strong_fit≥0.5
 * 且 magnitudeTier∈{C,D,E}（锚条件命中），重放输出新旧 rating 对比 + 翻案明细。
 *
 * 用法：node scripts/narrative/web3fit-anchor-replay.mjs（在 182 跑）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');

async function main() {
  const supabase = NarrativeRepository.getSupabase();
  const { data, error } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, twitter_info, prompt_version, analyzed_at, stage1_raw_output, stage_final_result, stage1_result')
    .like('prompt_version', 'jev-J1.2%')
    .order('analyzed_at', { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);

  const rows = [];
  for (const r of data || []) {
    const j = r.stage1_result?.details?.jev;
    if (!j?.probabilities) continue;
    const cat = r.stage1_result?.details?.eventClassification?.primaryCategory;
    const sf = j.probabilities.web3_fit?.strong_fit ?? 0;
    const tier = j.magnitudeTier;
    const oldRating = r.stage_final_result?.rating;
    if (cat !== 'A' || sf < 0.5 || (tier !== 'C' && tier !== 'D' && tier !== 'E') || oldRating !== 'low') continue;
    let answers = null;
    try { answers = JSON.parse(r.stage1_raw_output || '{}').answers; } catch { /* 跳过 */ }
    if (!answers) { console.log(`[skip] ${r.token_symbol} ${r.token_address} raw_output 缺失`); continue; }
    rows.push({ ...r, answers, oldRating, oldTier: tier, sf });
  }
  console.log(`锚条件命中 ${rows.length} 票，离线重放（mapper J1.23）\n`);

  let flipped = 0, kept = 0;
  const flips = [];
  for (const row of rows) {
    const tokenData = {
      address: row.token_address,
      symbol: row.token_symbol,
      name: row.raw_api_data?.name || '',
      raw_api_data: row.raw_api_data,
    };
    const mapped = mapStandardAnswers(row.answers, {
      tokenData,
      includeBrandHijack: false,
      tweetClassification: null,
      twitterInfo: row.twitter_info || null,
      callInfo: { model: 'replay', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    });
    const newRating = mapped.stageFinalData?.rating ?? mapped.llmResult?.rating;
    const s2 = mapped.stage2DataToSave?.parsed_output || {};
    const anchored = mapped.stage1DataToSave?.parsed_output?.jev?.web3FitAnchored === 'B';
    const evScore = s2.scoringResult?.totalScore;
    const block = s2.blockReason || mapped.stageFinalData?.reason || '';
    if (newRating !== 'low') { flipped++; flips.push({ sym: row.token_symbol, addr: row.token_address, newRating, evScore, block: block.slice(0, 40) }); }
    else kept++;
    console.log(`${newRating === row.oldRating ? '维持' : '翻案'} ${row.token_symbol.padEnd(8)} ${row.token_address} ${row.oldRating}→${newRating} 事件分${evScore ?? '-'} ${anchored ? '锚B' : ''} ${block ? '| ' + block.slice(0, 46) : ''}`);
  }
  console.log(`\n汇总：翻案 ${flipped} / 维持 low ${kept}（翻案≠放行买入：还有 stage3 关联/质量门与买腿条件）`);
}

main().catch(e => { console.error(e); process.exit(1); });
