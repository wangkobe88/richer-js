#!/usr/bin/env node
/**
 * P1 dry-run：历史 token 走完整 Jev 链路（state 构建 → 真实调用 → 代码端聚合）
 *
 * 验证目标（计划 P1 判据）：
 *   1. state 字符预算：totalChars ≤ 60000，分区配额/丢弃有统计
 *   2. answers 形状：13 题全部返回且类型正确
 *   3. 聚合数值：与旧 rating 对比打印（校准分析的输入，不要求一致）
 *
 * 用法：node scripts/narrative/jev_dryrun.mjs [limit]
 * 语料来源：token_narrative 缓存行（twitter_info + external_resource_cache 重组），
 * 不重新抓取。本地仅做单条/小结果读取（3-5 条）。
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
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');

async function main() {
  const limit = parseInt(process.argv[2] || '3', 10);
  const supabase = NarrativeRepository.getSupabase();

  const { data: rows, error } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, stage1_result, stage_final_result, analyzed_at')
    .eq('is_valid', true)
    .not('twitter_info', 'is', null)
    .not('stage_final_result', 'is', null)
    .order('analyzed_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`查询 token_narrative 失败: ${error.message}`);
  if (!rows || rows.length === 0) throw new Error('没有可用的历史 token（twitter_info 为空的表）');

  console.log(`=== Jev dry-run（${rows.length} 个历史 token，问题集 ${JEV_QUESTIONS_VERSION}）===\n`);

  let allPass = true;

  for (const row of rows) {
    const tokenData = {
      address: row.token_address,
      symbol: row.token_symbol,
      name: row.raw_api_data?.name || '',
      raw_api_data: row.raw_api_data,
    };

    // 语料：优先 twitter_info 列（含 link_content/expanded_urls，即旧分析时的完整语料快照），
    // 缺失时从 external_resource_cache 重组；其余语料不重新抓取
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

    // 1) state 构建（时间基准=旧分析时刻，保证时效项与旧评级同基准可比）
    const analyzedAtMs = row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined;
    const { state, stats } = buildJevState(tokenData, fetchResults, { now: analyzedAtMs });
    // 2) 问题集
    const questions = buildStandardQuestions({ includeBrandHijack });

    // 3) 真实调用
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const result = await JevClient.ask(state, questions, { label: `dryrun:${row.token_symbol}` });
    const elapsed = Date.now() - t0;
    const finishedAt = new Date().toISOString();

    // 4) 代码端聚合
    const mapped = mapStandardAnswers(result.answers, {
      tokenData,
      includeBrandHijack,
      callInfo: {
        model: result.model, questions, stateStats: stats,
        usage: result.usage, startedAt, finishedAt,
      },
    });

    // ── 打印 ──
    console.log(`──── ${row.token_symbol} (${row.token_address}) ────`);
    console.log(`state: ${stats.totalChars} chars (budget ${stats.budget}) | dropped: ${stats.droppedSections.length ? stats.droppedSections.join(',') : '无'}`);
    const g = stats.groups;
    console.log(`配额: twitter ${g.twitter?.used}/${g.twitter?.quota} wg ${g.websiteGithub?.used}/${g.websiteGithub?.quota} video ${g.video?.used}/${g.video?.quota} others ${g.others?.used}/${g.others?.quota}`);
    console.log(`jev: ${result.model} ${elapsed}ms tokens=${result.usage?.input_tokens ?? '?'} 题数=${Object.keys(questions).length}${includeBrandHijack ? '（含品牌劫持）' : ''}`);

    const a = result.answers;
    console.log(`answers:`);
    console.log(`  event_category=${a.event_category?.choice} conf=${a.event_category?.confidence}`);
    console.log(`  event_magnitude=${a.event_magnitude?.score?.toFixed(2)} timing=${a.event_timing?.choice} dim2=${a.dimension2?.score?.toFixed(2)}`);
    console.log(`  block_reason=${a.block_reason?.choice}(P=${a.block_reason?.probabilities?.[a.block_reason?.choice]?.toFixed?.(2)}, noneP=${a.block_reason?.probabilities?.none?.toFixed?.(2) ?? '-'}) w_product=${a.w_product_score?.score?.toFixed(2)} w_interaction=${a.w_binance_interaction?.score?.toFixed(2)}`);
    console.log(`  relevance=${a.relevance_type?.choice}/lv${a.relevance_level?.score?.toFixed(1)} misspellP=${a.block_misspelling?.noul?.toFixed(2)}${includeBrandHijack ? ` hijackP=${a.brand_hijack?.noul?.toFixed(2)}` : ''}`);
    console.log(`  quality: spelling=${a.quality_spelling?.score?.toFixed(2)} reasonability=${a.quality_reasonability?.score?.toFixed(2)}`);

    console.log(`聚合: ${mapped.llmResult.reason}`);
    const oldFinal = row.stage_final_result;
    console.log(`对比: 旧=${oldFinal?.rating ?? row.stage1_result?.rating ?? '?'}(${oldFinal?.score ?? '?'}) 新=${mapped.llmResult.rating}(${mapped.llmResult.score ?? '?'})`);

    // ── 判据 ──
    const expectedIds = Object.keys(questions);
    const checks = [
      ['state 预算内', stats.totalChars <= stats.budget],
      ['全部问题有答案', expectedIds.every(id => a[id])],
      ['choice 类答案合法', ['event_category', 'event_timing', 'block_reason', 'relevance_type'].every(id => typeof a[id]?.choice === 'string')],
      ['score 类答案合法', ['event_magnitude', 'dimension2', 'relevance_level', 'quality_spelling', 'quality_reasonability'].every(id => typeof a[id]?.score === 'number')],
      ['聚合产出 rating', ['high', 'mid', 'low'].includes(mapped.llmResult.rating)],
    ];
    for (const [name, ok] of checks) {
      if (!ok) { allPass = false; console.log(`❌ ${name}`); }
    }
    console.log('');
  }

  console.log(allPass ? '✅ dry-run 全部判据通过' : '❌ dry-run 存在失败判据');
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('❌ dry-run 失败:', err.message);
  process.exit(1);
});
