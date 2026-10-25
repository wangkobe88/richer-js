#!/usr/bin/env node
/**
 * 实体-事件影响力脱节门（J1.124/C194）——零 DB 零网络单测
 *
 * 2026-10-25 用户裁定（齐天大圣 0x4a6a6c8b3c15eb8422ad7b95c5c6280ed68d7777）：
 * 「齐天大圣是中国非常著名的超级 IP，但是这个事件影响力明显不大。这样就是代币
 * IP 很大，事件本身影响力极小，两者脱节，事件明显支撑不起这个代币，这种情况
 * 需要拒掉。」→ bsc_meme_user_name_entity_acceptance 新增第 5 桶
 * entity_event_mismatch（概率 ≥0.5 全域拦，pubProxy 豁免同类型门）。
 *
 * 覆盖：
 *   A. 题面：版本 J1.124 / 实体题五桶 / C194 锚段（双轴、反向边界、与类型轴正交）
 *   B. mapper 集成：0.6 拦 / 0.49 不拦 / 旧行 fail-open / 有分量事件不拦 /
 *      全域（E/W/B 都拦）/ 审计键
 *   C. 源码口径：门链 ne → em → we 顺序 / 函数私有 / pubProxy 豁免接线
 *
 * 用法：node scripts/_test_entity_event_mismatch.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function baseAnswers(cat, entity) {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    bsc_meme_user_event_impact: { choice: 'none', probabilities: { none: 0.9 } },
    bsc_meme_user_name_entity_acceptance: entity,
    bsc_meme_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.8, none: 0.02 } },
    bsc_meme_user_phrase_acceptability: { choice: 'acceptable', probabilities: { acceptable: 0.8 } },
    token_name_quality: { score: 3, probabilities: {} },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
  };
}

function makeContext(extra = {}) {
  return {
    tokenData: { symbol: '齐天大圣', name: '齐天大圣', raw_api_data: { name: '齐天大圣' } },
    twitterInfo: { text: '抖音博主用树枝搭了一个齐天大圣主题游乐园', in_reply_to: null },
    includeBrandHijack: false,
    credibleEventAnchor: true,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

const stage2Of = (m) => m?.stage2DataToSave?.parsed_output || {};

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const qsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');

  console.log('\n── A. 题面（J1.124/C194）──');
  check('A1 版本 ≥ J1.124（J1.124=C194 实体-事件脱节桶；当前 J1.125=C196）', parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 124, qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const entQ = q.bsc_meme_user_name_entity_acceptance;
  check('A2 实体题五桶（accepted/unacceptable_type/wrong_entity/not_entity/entity_event_mismatch）',
    ['accepted', 'unacceptable_type', 'wrong_entity', 'not_entity', 'entity_event_mismatch'].every(k => entQ.criteria[k])
    && Object.keys(entQ.criteria).length === 5, Object.keys(entQ.criteria));
  check('A3 instructions 含 C194 锚段（大 IP + 小事件 / 齐天大圣 / 双轴判据 / 反向边界 / 与类型轴正交）',
    entQ.instructions.includes('实体-事件影响力脱节（J1.124/C194')
    && entQ.instructions.includes('齐天大圣是中国非常著名的超级 IP')
    && entQ.instructions.includes('事件明显支撑不起这个代币')
    && entQ.instructions.includes('实体量级与事件量级是否匹配')
    && entQ.instructions.includes('事件本身有足够分量（官方发布/多方参与/大范围传播/全民讨论/持续发酵形成社会现象）=不脱节')
    && entQ.instructions.includes('实体量级本身不大（普通词/小 IP/自创角色）=不适用本项'));
  check('A4 桶文本含双轴判据与边界（实体大∧事件小 / 事件有分量不脱节 / 实体不大不适用 / 与类型轴正交）',
    entQ.criteria.entity_event_mismatch.includes('实体量级')
    && entQ.criteria.entity_event_mismatch.includes('事件量级')
    && entQ.criteria.entity_event_mismatch.includes('事件有足够分量=不脱节')
    && entQ.criteria.entity_event_mismatch.includes('实体本身不大（普通词/小 IP/自创角色）=不适用本项')
    && entQ.criteria.entity_event_mismatch.includes('类型不可接纳（可乐/银行/犬种学名）→unacceptable_type'));

  console.log('\n── B. mapper 集成（概率 ≥0.5 全域拦）──');
  const mHit = mapper.mapStandardAnswers(baseAnswers('E', { choice: 'entity_event_mismatch', probabilities: { accepted: 0.2, entity_event_mismatch: 0.6 } }), makeContext());
  const blkHit = stage2Of(mHit).blockReason || '';
  check('B1 E 类 + entity_event_mismatch 0.6 → low + label 命中',
    mHit.llmResult.rating === 'low' && blkHit.includes('事件与代币实体影响力脱节'), { rating: mHit.llmResult.rating, blkHit });
  check('B2 审计键 nameEntityEventMismatchMass=0.6（命中才落）',
    stage2Of(mHit).jev?.nameEntityEventMismatchMass === 0.6, stage2Of(mHit).jev?.nameEntityEventMismatchMass);

  const mMiss = mapper.mapStandardAnswers(baseAnswers('E', { choice: 'accepted', probabilities: { accepted: 0.45, entity_event_mismatch: 0.49 } }), makeContext());
  check('B3 0.49 <0.5 → 不拦（阈值边界）',
    !(stage2Of(mMiss).blockReason || '').includes('事件与代币实体影响力脱节'),
    stage2Of(mMiss).blockReason);

  const legacyEntity = { choice: 'accepted', probabilities: { accepted: 0.8 } };
  const mLegacy = mapper.mapStandardAnswers(baseAnswers('E', legacyEntity), makeContext());
  check('B4 旧缓存行无该桶 → fail-open 不拦、审计 null（历史行零翻转）',
    !(stage2Of(mLegacy).blockReason || '').includes('事件与代币实体影响力脱节')
    && stage2Of(mLegacy).jev?.nameEntityEventMismatchMass === null,
    { blk: stage2Of(mLegacy).blockReason, mass: stage2Of(mLegacy).jev?.nameEntityEventMismatchMass });

  // 全域：E/W/B 三类都拦（脱节与事件分类正交）
  for (const cat of ['E', 'W', 'B']) {
    const m = mapper.mapStandardAnswers(baseAnswers(cat, { choice: 'entity_event_mismatch', probabilities: { entity_event_mismatch: 0.7 } }), makeContext());
    check(`B5.${cat} 全域拦截（category=${cat}）`,
      m.llmResult.rating === 'low' && (stage2Of(m).blockReason || '').includes('事件与代币实体影响力脱节'),
      stage2Of(m).blockReason);
  }

  // 有分量事件形状：Jev 判 accepted（不选脱节桶）→ 不拦
  const mAccepted = mapper.mapStandardAnswers(baseAnswers('E', { choice: 'accepted', probabilities: { accepted: 0.8, entity_event_mismatch: 0.1 } }), makeContext());
  check('B6 事件有分量（accepted 0.8）→ 不拦',
    !(stage2Of(mAccepted).blockReason || '').includes('事件与代币实体影响力脱节'),
    stage2Of(mAccepted).blockReason);

  console.log('\n── C. 源码口径 ──');
  const cpIdx = mapperSrc.indexOf('} else if ((cpBlock = chinaPoliticsBlock(answers))) {');
  const emIdx = mapperSrc.indexOf('} else if (!pubProxyActive && emBlock != null) {');
  const w3Idx = mapperSrc.indexOf('} else if ((w3Block = web3UnfitBlock(answers))) {');
  const neIdx = mapperSrc.indexOf('} else if (!pubProxyActive && neBlock != null) {');
  const weIdx = mapperSrc.indexOf('} else if ((weBlock = wrongEntityBlock(answers))) {');
  check('C1 门链顺序：中国政治 cp → 实体-事件脱节 em → fit 概率门 w3（2026-10-25 用户裁定「可以挪」——资格层脱节先于口味概率门，label 归属更准）',
    cpIdx > 0 && emIdx > cpIdx && w3Idx > emIdx, { cpIdx, emIdx, w3Idx });
  check('C2b 实体题内部顺序：类型门 ne → 指歪门 we 仍相邻（em 已迁出实体段）',
    neIdx > 0 && weIdx > neIdx && emIdx !== neIdx, { neIdx, weIdx, emIdx });
  check('C2 entityEventMismatchBlock 私有（不导出，经集成测锁定）',
    mapper.entityEventMismatchBlock === undefined && mapper.__entityEventMismatchBlock === undefined);
  check('C3 版本注释含 C194 归因（bump 纪律可追溯）',
    qsSrc.includes('J1.124（C194，2026-10-25）'));
  check('C4 审计键接线（jev 段 nameEntityEventMismatchMass）',
    mapperSrc.includes('nameEntityEventMismatchMass: emBlock?.mass ?? null'));

  console.log(`\n═══ _test_entity_event_mismatch: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
