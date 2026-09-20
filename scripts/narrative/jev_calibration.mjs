#!/usr/bin/env node
/**
 * P2 校准对比：历史 token 旧 3 阶段评级 vs Jev 单次判定评级
 *
 * 抽样：按旧 prompt_type 分层（8 类各 2-5 条 + super_ip_fast 若干），
 * 排除已是 jev-* 的行。语料优先 twitter_info 列快照（时间基准=analyzed_at，
 * 时效项与旧评级同基准可比），不重新抓取。
 *
 * 输出：逐条明细 + 汇总（一致率 / 混淆矩阵 / 分歧归因）。
 * 注意：superIP 样本的时效分由 calculatePreScores 内部 Date.now() 计算
 * （旧评级是当时算的），归因时需考虑该偏移。
 *
 * 用法：node scripts/narrative/jev_calibration.mjs [--limit-peq-class N]
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { ExternalResourceCache } = await import('../../src/narrative/db/ExternalResourceCache.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');
const { buildJevState } = await import('../../src/narrative/analyzer/llm/jev-state-builder.mjs');
const { mapStandardAnswers, mapSuperIPAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectSuperIP, calculatePreScores } = await import('../../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');

/** 各旧类别的抽样上限（总数 ≈ 26-30） */
const QUOTA = { 'A': 3, 'W': 3, 'B': 3, 'F': 3, 'C': 5, 'D': 4, 'G': 2, 'E': 4, super_ip_fast: 4 };

async function main() {
  const supabase = NarrativeRepository.getSupabase();

  // 拉一批候选（近期优先），本地分层
  const { data: rows, error } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, prompt_type, stage1_result, stage2_result, stage_final_result, analyzed_at')
    .eq('is_valid', true)
    .not('twitter_info', 'is', null)
    .not('stage_final_result', 'is', null)
    .order('analyzed_at', { ascending: false })
    .limit(400);
  if (error) throw new Error(`查询失败: ${error.message}`);

  const picked = [];
  const counts = {};
  for (const row of rows) {
    const pt = row.prompt_type || '';
    if (pt.startsWith('jev')) continue; // 已是 Jev 行（端到端验证产生的）
    const cls = pt.startsWith('super_ip_fast') ? 'super_ip_fast' : (pt.match(/stage1\+stage2\(([A-H])类\)/)?.[1]);
    if (!cls || !QUOTA[cls]) continue;
    if ((counts[cls] || 0) >= QUOTA[cls]) continue;
    counts[cls] = (counts[cls] || 0) + 1;
    picked.push({ ...row, oldClass: cls });
  }
  console.log(`=== Jev 校准对比（${picked.length} 样本，问题集 ${JEV_QUESTIONS_VERSION}）===\n`);

  const ORDER = { high: 3, mid: 2, low: 1 };
  const details = [];
  const matrix = {}; // [old][new] = n
  let same = 0, adjacent = 0, flipped = 0;

  for (const row of picked) {
    const tokenData = {
      address: row.token_address,
      symbol: row.token_symbol,
      name: row.raw_api_data?.name || '',
      raw_api_data: row.raw_api_data,
    };

    let twitterInfo = row.twitter_info || null;
    if (!twitterInfo) {
      twitterInfo = await ExternalResourceCache.reassembleTwitterInfo(row.classified_urls?.twitter);
    }
    const fetchResults = {
      twitterInfo: twitterInfo || null,
      websiteInfo: null, githubInfo: null, backgroundInfo: null,
      youtubeInfo: null, douyinInfo: null, tiktokInfo: null, bilibiliInfo: null,
      weixinInfo: null, amazonInfo: null, xiaohongshuInfo: null, instagramInfo: null,
      binanceSquareInfo: null,
      extractedInfo: row.extracted_info || null,
      classifiedUrls: row.classified_urls || null,
      relatedAccounts: null, accountSummary: null,
    };

    const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
    const analyzedAtMs = row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined;

    const oldRating = row.stage_final_result?.rating || row.stage2_result?.rating || '?';
    const oldScore = row.stage_final_result?.score ?? row.stage2_result?.score ?? null;
    const oldBlock = row.stage_final_result?.details?.blockReason || row.stage2_result?.reason || null;

    // superIP 样本：从语料重新命中注册表（旧 prompt_type 已带名字，重算一致即命中）
    const superIPInfo = row.oldClass === 'super_ip_fast'
      ? detectSuperIP(row.extracted_info?.twitterUrl || row.classified_urls?.twitter?.[0]?.url, twitterInfo)
      : null;

    const isSuperIP = !!superIPInfo;
    const { state, stats } = buildJevState(tokenData, fetchResults, isSuperIP ? {
      superIPInfo,
      preScores: calculatePreScores(superIPInfo, twitterInfo?.created_at),
      now: analyzedAtMs,
    } : { now: analyzedAtMs });
    const questions = buildStandardQuestions({ includeBrandHijack });

    const t0 = Date.now();
    const result = await JevClient.ask(state, questions, { label: `calib:${row.token_symbol}` });
    const elapsed = Date.now() - t0;

    const callInfo = {
      model: result.model, questions, stateStats: stats,
      usage: result.usage,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    };
    const mapped = isSuperIP
      ? mapSuperIPAnswers(result.answers, { superIPInfo, preScores: calculatePreScores(superIPInfo, twitterInfo?.created_at), symbol: tokenData.symbol, includeBrandHijack, callInfo })
      : mapStandardAnswers(result.answers, { tokenData, includeBrandHijack, callInfo });

    const newRating = mapped.llmResult.rating;
    const newScore = mapped.llmResult.score ?? null;
    const a = result.answers;

    // 一致性判定
    const d = (ORDER[newRating] || 0) - (ORDER[oldRating] || 0);
    const verdict = d === 0 ? '一致' : Math.abs(d) === 1 ? '相邻档' : '翻转';
    if (d === 0) same++; else if (Math.abs(d) === 1) adjacent++; else flipped++;
    matrix[oldRating] = matrix[oldRating] || {};
    matrix[oldRating][newRating] = (matrix[oldRating][newRating] || 0) + 1;

    // 分歧归因（对比旧 stage 数据与新 answers 的关键差异）
    let attributions = [];
    if (verdict !== '一致') {
      const oldCat = isSuperIP ? 'superIP' : (row.stage1_result?.details?.eventClassification?.primaryCategory || row.stage1_result?.category || '?');
      const newCat = isSuperIP ? 'superIP' : a.event_category?.choice;
      const newTier = mapped.jevDetails?.tier || a.event_magnitude?.score?.toFixed(1);
      if (!isSuperIP && oldCat !== newCat) attributions.push(`分类 ${oldCat}→${newCat}(conf=${a.event_category?.confidence})`);
      const blockC = a.block_reason?.choice;
      if (blockC !== 'none' && !(oldBlock)) attributions.push(`新阻断:${blockC}(noneP=${a.block_reason?.probabilities?.none?.toFixed(2)})`);
      if (oldBlock && blockC === 'none') attributions.push(`旧阻断消失:${String(oldBlock).slice(0, 20)}`);
      if (!isSuperIP) attributions.push(`tier=${newTier} timing=${a.event_timing?.choice} dim2=${a.dimension2?.score?.toFixed(1)}`);
      else attributions.push(`dim2=${a.dimension2?.score?.toFixed(1)}(时效按当前时间算)`);
      attributions.push(`rel=${a.relevance_type?.choice}/lv${a.relevance_level?.score?.toFixed(1)}`);
    }

    details.push({
      symbol: row.token_symbol, cls: row.oldClass, isSuperIP,
      oldRating, oldScore, newRating, newScore, verdict, elapsed,
      reason: mapped.llmResult.reason, attributions,
    });

    console.log(`[${verdict}] ${row.oldClass}${isSuperIP ? '(superIP)' : ''} ${row.token_symbol}: ${oldRating}(${oldScore ?? '-'}) → ${newRating}(${newScore ?? '-'}) [${elapsed}ms]`);
    if (attributions.length) console.log(`      └ ${attributions.join(' | ')}`);
  }

  // ── 汇总 ──
  console.log('\n=== 汇总 ===');
  const total = details.length;
  console.log(`一致 ${same}/${total} (${(same / total * 100).toFixed(0)}%)｜相邻档 ${adjacent}｜翻转 ${flipped}`);

  console.log('\n混淆矩阵 (行=旧, 列=新):');
  const cols = ['high', 'mid', 'low'];
  console.log('       ' + cols.map(c => c.padStart(6)).join(''));
  for (const r of ['high', 'mid', 'low']) {
    console.log((r + ':').padEnd(7) + cols.map(c => String(matrix[r]?.[c] || 0).padStart(6)).join(''));
  }

  const byCls = {};
  for (const d of details) {
    byCls[d.cls] = byCls[d.cls] || { n: 0, same: 0 };
    byCls[d.cls].n++;
    if (d.verdict === '一致') byCls[d.cls].same++;
  }
  console.log('\n分类别一致率:');
  for (const [cls, v] of Object.entries(byCls)) {
    console.log(`  ${cls.padEnd(14)} ${v.same}/${v.n}`);
  }
}

main().catch(err => {
  console.error('❌ 校准失败:', err.message);
  process.exit(1);
});
