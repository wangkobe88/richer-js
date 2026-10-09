#!/usr/bin/env node
// ============================================================================
// J1.29 形象载体门——bddd3578 窗口答案注入回填（2026-10-09）
//
// 用户裁定「可以回测验证，我的建议是，叙事如果重新跑了就不必再跑一遍了」：
// 236 张标准路径票已在 dry-run（_carrier-dryrun-bddd.mjs）中真跑过 subject_carrier
// 题（checkpoint data/carrier-dryrun-bddd.json 存答案）。回测门臂不必再跑一遍
// Jev 重析（省钱 + 规避 C60 教训的换题集重析方差单窗口 −0.72）。
//
// 机制：把 dry-run 的 subject_carrier 答案合并进 J1.28 缓存行 answers →
// J1.29 mapper 重映射（calib 全键 ctx 复刻）→ update token_narrative 行（按行 id
// 锚定）→ 门臂回测 analyze() 缓存命中零 Jev 调用 → diff vs bddd3578 = 纯 M2 门
// 净效应（单变量对照，其余 16 题答案 bit-identical）。
//
// 对拍自验（fail-loud）：J1.28 answers 过 J1.29 mapper **不注入** → carrier 门无
// 答案 fail-open → resolveFinalRating 应与原行一致。对拍相等 = context 复刻正确性
// 的机器证明；MISMATCH = 非干净 J1.28 标准路径行 → skip 不回填保单变量对照。
//
// dry-run ctx vs 回填 ctx 分层（182 实证）：dry-run 只需 M2 门判定用极简 ctx；回填
// 重写整行全部 stage，ctx 敏感门（punExempt 的 credibleEventAnchor / igDim2Anchor /
// detectPlatformOfficial/detectBinanceCorpus）必须用 calib 全键 ctx 复现。
//
// 写回形状与生产链 bit 一致：stage1_prompt/stage1_raw_output 是 mapper 内部
// JSON.stringify 的字符串；stage*_result 是 jsonb 对象；stage3 __clear → 三列显式
// null（repository save 同语义）；直接 .update().eq('id', row.id) 不走
// NarrativeRepository.save（upsert 按 token_address 会碰同地址多行）。
//
// 用法（182）：node scripts/narrative/backfill-carrier-bddd.mjs [--commit]
//   默认 dry-run 打印 skip 统计 + rating 迁移矩阵 + M2 命中清单；--commit 逐票回填。
// ============================================================================
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectSuperIP } = await import('../../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
const { detectIssuerSelfLaunch } = await import('../../src/narrative/analyzer/utils/narrative-utils.mjs');
const { classifyTweetType } = await import('../../src/narrative/analyzer/services/tweet-type-classifier.mjs');
const { resolveFinalRating } = await import('../../src/narrative/utils/rating-utils.mjs');

if (JEV_QUESTIONS_VERSION !== 'J1.29') {
  throw new Error(`题集版本漂移：期望 J1.29 实得 ${JEV_QUESTIONS_VERSION}——回填产物 prompt_type 会与代码不一致，拒绝执行`);
}

const CHECKPOINT_FILE = 'data/carrier-dryrun-bddd.json';
const COMMIT = process.argv.includes('--commit');
const CHUNK = 50;

// 查询列（stage 全套 + ctx 复刻原料）
const SELECT_COLS = [
  'id', 'token_address', 'token_symbol', 'is_valid', 'analyzed_at',
  'raw_api_data', 'twitter_info', 'classified_urls', 'extracted_info',
  'stage1_prompt', 'stage1_raw_output', 'stage1_result',
  'stage2_result', 'stage3_result', 'stage_final_result',
  'pre_check_result', 'prestage_result',
  'prompt_version', 'prompt_type', 'analysis_stage',
].join(', ');

// ── buildStageSaveData 复刻（NarrativeAnalyzer 72-104；生产链四处调用零 overrides）──
function stageSave(stageName, stageData) {
  if (!stageData || stageData.__clear) {
    // repository save 的 __clear 语义：result/prompt/raw_output 三列全置 null
    return { [`${stageName}_result`]: null, [`${stageName}_prompt`]: null, [`${stageName}_raw_output`]: null };
  }
  const po = stageData.parsed_output;
  const extractedScore = po?.raw?.scoringResult?.totalScore ?? po?.scoringResult?.totalScore ?? po?.total_score ?? null;
  const result = {
    rating: stageData.rating ?? null,
    pass: stageData.pass ?? po?.pass ?? po?.raw?.pass ?? null,
    reason: po?.reason ?? po?.blockReason ?? po?.raw?.blockReason ?? null,
    category: stageData.category ?? null,
    score: extractedScore,
    model: stageData.model || null,
    startedAt: stageData.started_at || null,
    finishedAt: stageData.finished_at || null,
    success: stageData.success ?? null,
    error: stageData.error || null,
    details: po ?? null,
  };
  return {
    [`${stageName}_result`]: result,
    [`${stageName}_prompt`]: stageData.prompt || null,
    [`${stageName}_raw_output`]: stageData.raw_output || null,
  };
}

// mapper 七键输出 → update payload（stage_final_result 按 NarrativeAnalyzer 732-748 精确形状）
function buildUpdatePayload(m) {
  const s1 = stageSave('stage1', m.stage1DataToSave);
  const s2 = stageSave('stage2', m.stage2DataToSave);
  const s3 = stageSave('stage3', m.stage3DataToSave);
  const fin = m.stageFinalData;
  return {
    ...s1, ...s2, ...s3,
    stage_final_result: {
      rating: fin.category,
      pass: true,
      reason: null,
      category: fin.category,
      score: fin.totalScore,
      details: {
        eventScore: fin.eventScore,
        eventWeight: fin.eventWeight,
        relevanceScore: fin.relevanceScore,
        qualityScore: fin.qualityScore,
        stage2TotalScore: fin.stage2TotalScore,
        blockReason: fin.blockReason,
      },
    },
    prompt_type: m.promptType,
    prompt_version: 'jev-J1.29',
    analysis_stage: m.llmResult.analysis_stage,
  };
}

// sim record（resolveFinalRating 入参形状：六 stage result 键；stage3 __clear → null）
function simRecord(row, payload) {
  return {
    pre_check_result: row.pre_check_result ?? null,
    prestage_result: row.prestage_result ?? null,
    stage1_result: payload.stage1_result ?? null,
    stage2_result: payload.stage2_result ?? null,
    stage3_result: payload.stage3_result ?? null,
    stage_final_result: payload.stage_final_result ?? null,
  };
}

// calib 全键 ctx 复刻（_calib-product-entity.mjs 94-131 + callInfo 回填口径）
function buildCtx(row, state, stateStats, usage, s1res) {
  const raw = row.raw_api_data;
  const classified = row.classified_urls;
  const tokenData = { address: row.token_address, symbol: row.token_symbol, name: raw?.name || '', raw_api_data: raw };
  const fetchResults = {
    twitterInfo: row.twitter_info, websiteInfo: null, githubInfo: null, backgroundInfo: null,
    youtubeInfo: null, douyinInfo: null, tiktokInfo: null, bilibiliInfo: null, weixinInfo: null,
    amazonInfo: null, xiaohongshuInfo: null, instagramInfo: null, binanceSquareInfo: null,
    extractedInfo: row.extracted_info || null, classifiedUrls: classified || null,
    relatedAccounts: null, accountSummary: null,
  };
  const includeBrandHijack = shouldIncludeBrandHijackCheck(row.token_symbol, raw?.name || '');
  const superIPInfo = detectSuperIP(row.extracted_info?.twitterUrl || classified?.twitter?.[0]?.url, row.twitter_info);
  const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, fetchResults);
  const squareVerified = /【币安广场内容】[\s\S]*?作者认证:\s*官方认证账号/.test(state);
  const credibleEventAnchor = !!(superIPInfo || issuerSelfLaunch || squareVerified);
  const igLinked = !!(classified?.instagram?.length > 0);
  const igFetched = igLinked && /instagram/i.test(state);
  const tweetClassification = classifyTweetType(row.twitter_info);
  const callInfo = {
    model: s1res?.model || null,
    questions: buildStandardQuestions({ includeBrandHijack }), // J1.29 17 题 per-token 构建
    state, stateStats, usage: usage ?? {},
    startedAt: s1res?.started_at || null,
    finishedAt: s1res?.finished_at || null,
  };
  return {
    tokenData, includeBrandHijack, twitterInfo: row.twitter_info,
    credibleEventAnchor, instagramLinked: igLinked, instagramInfoFetched: igFetched,
    tweetClassification, callInfo,
  };
}

const parseJsonCol = (v) => {
  if (v == null) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
};

async function main() {
  // 1) checkpoint 载入（顶层纯数组；只收成功票 carrier!=null）
  const checkpoint = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
  const recs = checkpoint.filter(r => r && r.carrier != null && r.addr);
  const recByAddr = new Map(recs.map(r => [r.addr.toLowerCase(), r]));
  console.log(`checkpoint: ${checkpoint.length} 条 → 成功票 ${recs.length}（carrier 分布 `
    + ['existing_entity', 'improvised_entity', 'no_visual_entity']
      .map(k => `${k.split('_')[0]}=${recs.filter(r => r.carrier === k).length}`).join(' / ') + '）');

  // 2) token_narrative 行（批 50 .in；同地址多行去重与线上 analyze() 缓存命中同口径）
  const addrs = [...recByAddr.keys()];
  const rows = [];
  const supabase = NarrativeRepository.getSupabase();
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const { data, error } = await supabase.from('token_narrative')
      .select(SELECT_COLS).in('token_address', addrs.slice(i, i + CHUNK));
    if (error) throw new Error('token_narrative: ' + error.message);
    rows.push(...(data || []));
  }
  const dedup = new Map();
  for (const r of rows) {
    const prev = dedup.get(r.token_address);
    if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) {
      dedup.set(r.token_address.toLowerCase(), r);
    }
  }

  // 3) 逐票：对拍自验（不注入）→ 注入 → J1.29 mapper 重映射
  const skips = { no_row: 0, no_state: 0, no_answers: 0, already: 0, mismatch: 0 };
  const mismatchList = [];
  const migration = new Map();     // `${old}→${new}` → count
  const m2Hits = [];               // M2 门命中清单（subjectCarrierBlock != null）
  const toWrite = [];              // { id, payload, addr, symbol }

  for (const [addr, rec] of recByAddr) {
    const row = dedup.get(addr);
    if (!row) { skips.no_row++; continue; }

    const promptParsed = parseJsonCol(row.stage1_prompt);
    const state = promptParsed?.state || null;
    if (!state) { skips.no_state++; continue; }

    const rawParsed = parseJsonCol(row.stage1_raw_output);
    const answers = rawParsed?.answers;
    if (!answers) { skips.no_answers++; continue; }
    if (answers.subject_carrier != null) { skips.already++; continue; }

    const s1res = row.stage1_result;
    const ctx = buildCtx(row, state, promptParsed?.stateStats, rawParsed?.usage, s1res);

    // 对拍自验：不注入重放 → carrier 门 fail-open → rating 应与原行一致
    const r0 = mapStandardAnswers(answers, ctx);
    const payload0 = buildUpdatePayload(r0);
    const oldRating = resolveFinalRating({
      pre_check_result: row.pre_check_result ?? null, prestage_result: row.prestage_result ?? null,
      stage1_result: row.stage1_result ?? null, stage2_result: row.stage2_result ?? null,
      stage3_result: row.stage3_result ?? null, stage_final_result: row.stage_final_result ?? null,
    });
    const replayRating = resolveFinalRating(simRecord(row, payload0));
    if (replayRating !== oldRating) {
      skips.mismatch++;
      mismatchList.push({ addr, symbol: row.token_symbol, old: oldRating, replay: replayRating, pv: row.prompt_version });
      continue;
    }

    // 注入 dry-run 答案 → J1.29 重映射
    const answers2 = { ...answers, subject_carrier: { choice: rec.carrier, probabilities: rec.probs || {} } };
    const r1 = mapStandardAnswers(answers2, ctx);
    const payload = buildUpdatePayload(r1);
    const newRating = resolveFinalRating(simRecord(row, payload));

    const key = `${oldRating ?? 'null'}→${newRating ?? 'null'}`;
    migration.set(key, (migration.get(key) || 0) + 1);
    if (r1.stage2DataToSave?.parsed_output?.jev?.subjectCarrierBlock != null) {
      m2Hits.push({ addr, symbol: rec.symbol ?? row.token_symbol, cat: rec.cat, carrier: rec.carrier,
        old: oldRating, new: newRating, net: rec.net });
    }
    toWrite.push({ id: row.id, payload, addr, symbol: rec.symbol ?? row.token_symbol });
  }

  // ── 预览 ──
  console.log(`\n===== 处理结果（成功票 ${recs.length} / 行命中 ${dedup.size}）=====`);
  console.log('skip:', JSON.stringify(skips));
  if (mismatchList.length) {
    console.log('mismatch 清单（不回填，保单变量对照）:');
    for (const m of mismatchList) console.log(`  ${m.addr} ${m.symbol} ${m.old}→replay:${m.replay} (pv=${m.pv})`);
  }
  console.log('\nrating 迁移矩阵:');
  for (const [k, n] of [...migration.entries()].sort()) console.log(`  ${k}: ${n}`);
  console.log(`\nM2 载体门命中 ${m2Hits.length} 张（subjectCarrierBlock != null）:`);
  for (const h of m2Hits) {
    console.log(`  ${h.addr} ${String(h.symbol).padEnd(12)} ${h.cat}类+${h.carrier === 'improvised_entity' ? 'improvised' : 'no_visual'} `
      + `${h.old}→${h.new}  net=${h.net != null ? h.net.toFixed(3) : 'null'}`);
  }
  const changed = [...migration.entries()].filter(([k]) => !/^(\w+)→\1$/.test(k) && k !== 'null→null')
    .reduce((s, [, n]) => s + n, 0);
  console.log(`\nrating 变更票数: ${changed}（回填后门臂回测叙事全缓存命中零 Jev 调用）`);

  if (!COMMIT) {
    console.log('\n[dry-run] 未回填；加 --commit 逐票 update（按行 id 锚定 + analyzed_at=now + is_valid=true）');
    process.exit(0);
  }

  let done = 0;
  const now = new Date().toISOString();
  for (const w of toWrite) {
    const { error } = await supabase.from('token_narrative')
      .update({ ...w.payload, analyzed_at: now, is_valid: true })
      .eq('id', w.id);
    if (error) throw new Error(`update ${w.addr}: ${error.message}`);
    if (++done % 25 === 0) console.log(`  ${done}/${toWrite.length}`);
  }
  console.log(`\n完成：回填 ${toWrite.length} 行（skip ${Object.values(skips).reduce((a, b) => a + b, 0)}）`);
  console.log('下一步：node scripts/create-carrier-gate-arm.cjs --commit 建门臂 → 跑回测 → diff vs bddd3578');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
