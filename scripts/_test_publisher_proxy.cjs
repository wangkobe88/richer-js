#!/usr/bin/env node
/**
 * 发布者指代门（publisherProxy）——本地零 DB 单测（J1.18，2026-09-29 用户裁定，C29 Cue/Manus 案）
 *
 * 覆盖：
 *   A. detectPublisherProxy 纯函数四判据：CUE 官方域名命中 / Muse 域名门拒绝 /
 *      Muse 版本指纹词拒绝 / 粉丝门槛 / 互不包含（自发盘排除）/ name 回退 /
 *      父推域名+父推粉丝回退 / 空输入
 *   B. mapStandardAnswers 路由矩阵：CUE 数值复现（argmax gimmick 豁免 + nrBlock
 *      豁免 + effTier A 锚 → 72.4 过线 high + 审计标记）/ 无 twitterInfo 同答案
 *      原路径拦截对照 / Muse 形状不改行为（域名门+指纹词双保险）/ cashtag 改道
 *      优先 / rcp 门不豁免 / 骑乘改道豁免 / S 不降 A 原判不动
 *
 * 用法：node scripts/_test_publisher_proxy.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C29 Cue/Manus 案语料与 answers 快照（DB 实证 + 本轮 dryrun 数值复现）──────────
const cueTokenData = { symbol: 'CUE', name: 'Cue', raw_api_data: { name: 'Cue' } };

const cueTwitter = {
  type: 'tweet',
  text: 'Get Cue: https://t.co/nMpSKSNLrn https://t.co/gzJ0Fl2VZ5',
  author_screen_name: 'ManusAI',
  author_name: 'Manus',
  author_followers_count: 250206,
  expanded_urls: ['https://cue.im/', 'https://twitter.com/ManusAI/photo/1'],
  in_reply_to: {
    text: 'Download Manus Studio: https://t.co/sxJe5gNOUc',
    author_screen_name: 'ManusAI',
    author_name: 'Manus',
    author_followers_count: 250206,
    expanded_urls: ['https://manus.im/'],
  },
};

// 本轮 dryrun 基线：B 0.48 / magnitude 2.88(B档) / dim2 3.08(→23.4) /
// gimmick argmax 0.30-none 0.29 / name_referent 阻断侧 0.84 / within_7d / exact_match lv3.3
const cueAnswers = {
  event_category: { choice: 'B', probabilities: { B: 0.48, C: 0.30, D: 0.15, W: 0.05 } },
  event_magnitude: { score: 2.88, probabilities: { '2': 0.38, '3': 0.42 } },
  event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
  dimension2: { score: 3.08, probabilities: { '3': 0.5, '4': 0.3 } },
  block_reason: {
    choice: 'marketing_gimmick',
    probabilities: { none: 0.29, marketing_gimmick: 0.30, subject_unqualified: 0.15, empty_content: 0.1, institution_routine: 0.16 },
  },
  name_referent: { choice: 'notable_other', probabilities: { notable_other: 0.52, minor_other: 0.18, common_word: 0.14, super_ip: 0.16, subject_self: 0, none_related: 0 } },
  relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.7, semantic: 0.2 } },
  relevance_level: { score: 3.3, probabilities: { '3': 0.4, '4': 0.5 } },
  block_misspelling: { noul: 0.1 },
  quality_spelling: { score: 2.82 },      // → 4.82
  quality_reasonability: { score: 1.69 }, // → 2.69
};

// Muse 案（0xc3136948，C8 v3 版本更新拦截）：alexandr_wang 70.2 万粉推桌面版，
// 语料只有 twitter 视频 URL 无产品域名；阻断侧 minor 0.32+notable 0.31+common 0.03=0.66
const museTokenData = { symbol: 'Muse', name: 'Muse', raw_api_data: { name: 'Muse' } };
const museTwitter = {
  type: 'tweet',
  text: 'MUSE FEATURE ALERT: muse for mac now has computer use! muse loves laptop ♥️ https://t.co/hQwJFBDloA',
  author_screen_name: 'alexandr_wang',
  author_name: 'Alexandr Wang',
  author_followers_count: 702605,
  expanded_urls: ['https://twitter.com/alexandr_wang/status/2104/video/1'],
};
const museAnswers = {
  event_category: { choice: 'B', probabilities: { B: 0.55, C: 0.3, D: 0.1 } },
  event_magnitude: { score: 3.2, probabilities: { '3': 0.6 } },
  event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
  dimension2: { score: 3.5, probabilities: { '3': 0.5, '4': 0.4 } },
  block_reason: { choice: 'none', probabilities: { none: 0.98, institution_routine: 0.02 } },
  name_referent: { choice: 'minor_other', probabilities: { minor_other: 0.32, notable_other: 0.31, common_word: 0.03, super_ip: 0.05, subject_self: 0.29, none_related: 0 } },
  relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
  relevance_level: { score: 4.2, probabilities: { '4': 0.8 } },
  block_misspelling: { noul: 0.05 },
  quality_spelling: { score: 3.1 },
  quality_reasonability: { score: 2.5 },
};

function makeContext(tokenData, answers, twitterInfo) {
  return {
    tokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { detectPublisherProxy } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');

  console.log('\n── A. detectPublisherProxy 四判据矩阵 ──');
  const hit = detectPublisherProxy(cueTokenData, cueTwitter);
  check('A1 CUE 命中：cue.im 域名 stem=币名 + 25.0 万粉 + 互不包含 + 无指纹词', hit?.domain === 'cue.im' && hit?.followers === 250206 && hit?.symbol === 'cue', hit);

  check('A2 Muse 域名门拒绝（只有 twitter 视频 URL，无产品域名）', detectPublisherProxy(museTokenData, museTwitter) === null);

  const museWithDomain = { ...museTwitter, expanded_urls: ['https://muse.im/'] };
  check('A3 Muse 版本指纹词拒绝（即使有 muse.im 域名：for mac now has…）', detectPublisherProxy(museTokenData, museWithDomain) === null);

  check('A4 粉丝门槛拒绝（1 万粉 < 10 万）', detectPublisherProxy(cueTokenData, { ...cueTwitter, author_followers_count: 10000 }) === null);

  check('A5 互不包含拒绝（symbol=Manus ⊂ handle=ManusAI，自发盘域）', detectPublisherProxy({ symbol: 'Manus', name: 'Manus' }, { ...cueTwitter, text: 'Manus launch: https://t.co/x', expanded_urls: ['https://manus.im/'] }) === null);

  check('A6 空输入 null', detectPublisherProxy(cueTokenData, null) === null && detectPublisherProxy({}, cueTwitter) === null);

  check('A7 name 回退（symbol 空，name=Cue 命中 cue.im）', detectPublisherProxy({ symbol: '', name: '', raw_api_data: { name: 'Cue' } }, cueTwitter)?.domain === 'cue.im');

  const parentOnly = {
    type: 'tweet',
    text: 'Get Cue: https://t.co/nMpSKSNLrn',
    author_screen_name: 'someone_small',
    author_followers_count: 500,
    in_reply_to: cueTwitter.in_reply_to,
  };
  const hitParent = detectPublisherProxy(cueTokenData, parentOnly);
  check('A8 主推粉丝有值不回退（500 粉 < 10 万 → 拒绝）', hitParent === null, hitParent);

  // A8 补充：主推粉丝缺失（undefined→0 拒绝），父推 25 万粉 + 父推 cue.im 域名 → 命中
  const parentDomain = {
    type: 'tweet',
    text: 'exciting!',
    in_reply_to: { text: 'Cue is live: https://t.co/a', author_screen_name: 'ManusAI', author_name: 'Manus', author_followers_count: 250206, expanded_urls: ['https://cue.im/'] },
  };
  check('A8b 主推粉丝缺失回退父推（父推 25 万粉 + 父推 cue.im）', detectPublisherProxy(cueTokenData, parentDomain)?.domain === 'cue.im');

  console.log('\n── B. mapStandardAnswers 路由矩阵 ──');

  // B1 CUE 数值复现：proxy 激活 → 三豁免 + effTier A → 过线
  const m1 = mapStandardAnswers(cueAnswers, makeContext(cueTokenData, cueAnswers, cueTwitter));
  const j1 = m1.stage1DataToSave.parsed_output.jev;
  check('B1a stage1 审计：publisherProxy 详情 + active + tierAnchored', j1.publisherProxy?.domain === 'cue.im' && j1.publisherProxyActive === true && j1.tierAnchored === 'A', j1);
  check('B1b Jev 原判审计保真：magnitudeTier 保留 B（不受锚定影响）', j1.magnitudeTier === 'B', j1.magnitudeTier);
  const s1 = m1.stage2DataToSave.parsed_output.scoringResult;
  check('B1c marketing_gimmick argmax 豁免（0.30-none 0.29 不再拦）+ nrBlock 豁免（阻断侧 0.84）', m1.stage2DataToSave.parsed_output.pass === true, m1.stage2DataToSave.parsed_output);
  check('B1d effTier A 锚：34+23.4+15=72.4 过线', s1.category === 'B' && s1.totalScore === 72.4 && s1.tierScore === 34, s1);
  check('B1e reason 标注发布者指代锚（原判 B 档）', m1.stage2DataToSave.parsed_output.reason.includes('发布者指代锚(原判B档)'), m1.stage2DataToSave.parsed_output.reason);
  check('B1f 终评 high：43.44+20+15.51=78.95', m1.llmResult.pass === true && m1.llmResult.rating === 'high' && m1.llmResult.score === 78.95, m1.llmResult);
  check('B1g promptType 保持 B 类标准数学（不改道 W）', m1.promptType.includes('B类') && !m1.promptType.includes('改道'), m1.promptType);

  // B2 同 answers、无 twitterInfo → 原路径：gimmick argmax 先拦（本轮 dryrun 基线拦截路径复现）
  const m2 = mapStandardAnswers(cueAnswers, makeContext(cueTokenData, cueAnswers, null));
  check('B2a 无语料判据不激活：无审计标记', m2.stage1DataToSave.parsed_output.jev.publisherProxyActive === null);
  check('B2b 原路径拦截：marketing_gimmick argmax（noneP 0.29<0.5）', m2.llmResult.rating === 'low' && m2.llmResult.analysis_stage === 2 && m2.llmResult.reason.includes('营销噱头'), m2.llmResult);

  // B3 Muse 形状：域名门不命中 → proxy 永不激活 → nameReferentBlock 维持拦截
  const m3 = mapStandardAnswers(museAnswers, makeContext(museTokenData, museAnswers, museTwitter));
  check('B3a Muse 无域名不改行为：nrBlock 0.66 拦截（J1.18 题面下维持）', m3.llmResult.rating === 'low' && m3.llmResult.reason.includes('名字指向'), m3.llmResult.reason);
  const m3b = mapStandardAnswers(museAnswers, makeContext(museTokenData, museAnswers, museWithDomain));
  check('B3b Muse 指纹词双保险：即使有 muse.im 域名仍拦', m3b.llmResult.rating === 'low' && m3b.stage1DataToSave.parsed_output.jev.publisherProxyActive === null);

  // B4 cashtag 改道优先：语料含 $CUE → cashtagForced → pubProxyActive=false → W 数学
  const cashtagTwitter = { ...cueTwitter, text: 'Get Cue: https://t.co/nMpSKSNLrn $CUE' };
  const m4 = mapStandardAnswers(cueAnswers, makeContext(cueTokenData, cueAnswers, cashtagTwitter));
  check('B4 cashtag 优先：category 强制 W、proxy 不激活、走 W 数学（产品 0 → 拦）',
    m4.stage1DataToSave.category === 'W' && m4.stage1DataToSave.parsed_output.jev.categoryForced === 'cashtag_w'
    && m4.stage1DataToSave.parsed_output.jev.publisherProxyActive === null
    && m4.stage2DataToSave.parsed_output.scoringResult.category === 'W' && m4.llmResult.rating === 'low', m4.promptType);

  // B5 rcp 门不豁免（内容型产品 C12 绣春刀裁定维持）
  const rcpAnswers = { ...cueAnswers, block_reason: { choice: 'routine_content_product', probabilities: { none: 0.2, routine_content_product: 0.6, marketing_gimmick: 0.2 } } };
  const m5 = mapStandardAnswers(rcpAnswers, makeContext(cueTokenData, rcpAnswers, cueTwitter));
  check('B5 rcp 门不豁免：发布者指代不适用于内容型产品', m5.llmResult.rating === 'low' && m5.llmResult.reason.includes('常规内容产品'), m5.llmResult.reason);

  // B6 骑乘改道豁免：ss+sip≥0.5 且 sip<0.5 原本改道 W，pubProxyActive 时不改道走标准数学
  const rideAnswers = { ...cueAnswers, name_referent: { choice: 'subject_self', probabilities: { subject_self: 0.3, super_ip: 0.25, notable_other: 0.2, minor_other: 0.15, common_word: 0.1, none_related: 0 } } };
  const m6 = mapStandardAnswers(rideAnswers, makeContext(cueTokenData, rideAnswers, cueTwitter));
  check('B6 骑乘改道豁免：rideMass=null 走 B 类标准数学（72.4），promptType 无改道后缀',
    m6.stage2DataToSave.parsed_output.scoringResult.category === 'B' && m6.stage2DataToSave.parsed_output.scoringResult.totalScore === 72.4 && !m6.promptType.includes('改道'), m6.promptType);

  // B7 锚定边界：A 原判不动 / S 不降
  const tierA = { ...cueAnswers, event_magnitude: { score: 4.2, probabilities: { '4': 0.6 } } };
  const m7a = mapStandardAnswers(tierA, makeContext(cueTokenData, tierA, cueTwitter));
  check('B7a Jev 原判 A 档：tierAnchored=null（不动）', m7a.stage1DataToSave.parsed_output.jev.tierAnchored === null && m7a.stage2DataToSave.parsed_output.scoringResult.tierScore === 34);
  const tierS = { ...cueAnswers, event_magnitude: { score: 4.8, probabilities: { '5': 0.5, '4': 0.3 } } };
  const m7b = mapStandardAnswers(tierS, makeContext(cueTokenData, tierS, cueTwitter));
  check('B7b Jev 原判 S 档：不降档（39 分保留）', m7b.stage1DataToSave.parsed_output.jev.tierAnchored === null && m7b.stage2DataToSave.parsed_output.scoringResult.tierScore === 39);

  // B8 C 类域同样生效（B/C 边界抖动防护，与 rideDetourBelow 同域）
  const catC = { ...cueAnswers, event_category: { choice: 'C', probabilities: { C: 0.52, B: 0.41 } } };
  const m8 = mapStandardAnswers(catC, makeContext(cueTokenData, catC, cueTwitter));
  check('B8 C 类域生效：pubProxyActive + effTier A 过线', m8.stage1DataToSave.category === 'C' && m8.stage1DataToSave.parsed_output.jev.publisherProxyActive === true && m8.stage2DataToSave.parsed_output.scoringResult.tierScore === 34 && m8.llmResult.pass === true, m8.promptType);

  // B9 原判低档 + 官方域名盘：量级锚只看 proxy 判据不看原档；粉丝不足时 D 档拦截维持
  // （block/nr 改成放行形状，让量级拦截路径可见——gimmick argmax 路径已由 B2b 覆盖）
  const smallPub = {
    ...cueAnswers,
    block_reason: { choice: 'none', probabilities: { none: 0.9, marketing_gimmick: 0.1 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.6, notable_other: 0.2, minor_other: 0.1, common_word: 0.1, subject_self: 0, none_related: 0 } },
    event_magnitude: { score: 1.2, probabilities: { '1': 0.6 } },
  };
  const m9a = mapStandardAnswers(smallPub, makeContext(cueTokenData, smallPub, cueTwitter));
  check('B9a 原判 D 档（粉丝足、原判低）仍被锚到 A 过线——量级锚只看 proxy 判据不看原档', m9a.stage2DataToSave.parsed_output.scoringResult.tierScore === 34 && m9a.llmResult.pass === true);
  const m9b = mapStandardAnswers(smallPub, makeContext(cueTokenData, smallPub, { ...cueTwitter, author_followers_count: 10000 }));
  check('B9b 粉丝不足 + D 档原判：proxy 不激活 → D 档量级拦截维持', m9b.llmResult.rating === 'low' && m9b.llmResult.reason.includes('量级不足'), m9b.llmResult.reason);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
