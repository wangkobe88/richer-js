#!/usr/bin/env node
/**
 * C160 强情感冲击 / 动物救助路径载体门豁免单测（2026-10-21 秦思雨案）——零 DB 零网络
 *
 * 用户裁定：「这个币出内盘了，这是属于对 web3 用户能造成强情感冲击的事件，算是
 * 另一条能打动用户的路径」「尤其是 web3 用户，喜欢猫猫狗狗」。
 *
 * 口径：
 *   E 类 + Jev fit 质量（strong_fit+fit）≥0.5 + 文本事实锚（动物救助词 ∧
 *   纪念/离世词）→ 不要求形象载体（故事/人物本身即载体）。
 *   语义是否真实正向仍归 Jev；代码锚只防「泛 E 热点」被误豁（C79 偷窥狂无
 *   救助/纪念词 → 载体门照拦）。
 *
 * 节：
 *   A. 秦思雨形状 → pass + 审计键
 *   B. C79 泛 E 热点 → 载体门照拦 + 审计 null
 *   C. fit 质量 <0.5 → 不豁免（fit 门先拦）
 *   D. 非 E 类 → 不豁免
 *   E. 源码口径（正则/早退/审计键/选项接线）
 *
 * 用法：node scripts/_test_emotional_impact_carrier.cjs
 */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');

function answers(overrides = {}) {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.8, C: 0.14, W: 0.06 } },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 1 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.39, event_negative_hard_news: 0.37, token_ip_reuse: 0.15 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.55, fit: 0.25, marginal: 0.02, unfit: 0.18 } },
    web3_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.92 } },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.95, accepted: 0.01 } },
    web3_user_entity_visuality: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.89, existing_entity: 0.1 } },
    web3_user_phrase_acceptability: { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.71, web3_user_acceptable: 0.26 } },
    token_name_quality: { score: 2.73, probabilities: {} },
    ...overrides,
  };
}

function ctx(text, overrides = {}) {
  return {
    tokenData: { symbol: '秦思雨', name: '秦思雨', raw_api_data: { name: '秦思雨' } },
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: { author_screen_name: 'xiaobudingdev', author_followers_count: 113, text },
    imageEvidence: false,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...overrides,
  };
}

const RESCUE_TEXT = '想不到，真的想不到。中国狗妈，秦思雨，一生救助猫猫狗狗无数，却年纪轻轻就离世了。各大新闻都在报道，称呼她为中国的狗妈。部署这个代币是为了铭记中国狗妈秦思雨，链上永存！';
const C79_TEXT = '抖音热搜meme！！！才刚刚开始发酵阿，名字叫偷窥狂，抖音上一直在二创，在任何地方都可以玩，太魔性了，看视频';

const s2jev = (r) => r.stage2DataToSave?.parsed_output?.jev;

async function main() {
  const { mapStandardAnswers } = await import(mapperPath);

  console.log('── A. 秦思雨形状（动物救助 + 纪念 + E 强 fit）──');
  const rA = mapStandardAnswers(answers(), ctx(RESCUE_TEXT));
  check('A1 载体门豁免 → pass', rA.llmResult.pass === true, rA.llmResult.reason);
  check('A2 审计键 subjectCarrierEmotionalImpactExempt（fitMass 0.80）',
    s2jev(rA).subjectCarrierEmotionalImpactExempt?.carrier === 'no_visual_entity'
      && s2jev(rA).subjectCarrierEmotionalImpactExempt?.fitMass === 0.8,
    s2jev(rA).subjectCarrierEmotionalImpactExempt);
  check('A3 subjectCarrierBlock=null（载体门确实未拦）',
    s2jev(rA).subjectCarrierBlock === null, s2jev(rA).subjectCarrierBlock);

  console.log('── B. C79 泛 E 热点（无救助/纪念词）──');
  const rB = mapStandardAnswers(answers(), ctx(C79_TEXT, {
    tokenData: { symbol: '偷窥狂', name: '偷窥狂', raw_api_data: { name: '偷窥狂' } },
  }));
  check('B1 载体门照拦（叙事主体无形象载体）',
    rB.llmResult.rating === 'low' && (rB.llmResult.reason || '').includes('无形象载体'),
    rB.llmResult.reason);
  check('B2 审计键 null', s2jev(rB).subjectCarrierEmotionalImpactExempt === null,
    s2jev(rB).subjectCarrierEmotionalImpactExempt);

  console.log('── C. fit 质量 <0.5（marginal 占优）──');
  const rC = mapStandardAnswers(answers({
    web3_user_event_fit: { choice: 'marginal', probabilities: { strong_fit: 0.1, fit: 0.1, marginal: 0.7, unfit: 0.1 } },
  }), ctx(RESCUE_TEXT));
  check('C1 不豁免（fit 门先拦，reason 含契合证据不足/偏好不合）',
    rC.llmResult.rating === 'low'
      && (rC.llmResult.reason || '').includes('Web3用户')
      && s2jev(rC).subjectCarrierEmotionalImpactExempt === null,
    { reason: rC.llmResult.reason, audit: s2jev(rC).subjectCarrierEmotionalImpactExempt });

  console.log('── D. 非 E 类（同类文本）──');
  const rD = mapStandardAnswers(answers({
    event_category: { choice: 'D', probabilities: { D: 0.8, E: 0.1 } },
  }), ctx(RESCUE_TEXT));
  check('D1 不豁免（审计 null；D 类另有实体/载体门）',
    s2jev(rD).subjectCarrierEmotionalImpactExempt === null,
    s2jev(rD).subjectCarrierEmotionalImpactExempt);

  console.log('── E. 源码口径 ──');
  const src = readFileSync(mapperPath, 'utf8');
  check('E1 动物救助 + 纪念双词锚', src.includes('ANIMAL_RESCUE_STORY_RE') && src.includes('MEMORIAL_STORY_RE')
    && src.includes('isAnimalRescueMemorialStory(context)'), null);
  check('E2 E 类 + fit 质量 + 文本锚三条件', src.includes("category === 'E' && likedMass >= 0.5 && animalRescueMemorialStory"), null);
  check('E3 载体门早退', src.includes('if (opts?.emotionalImpactCarrierExempt) return null;'), null);
  check('E4 审计键与接线', src.includes('subjectCarrierEmotionalImpactExempt') && src.includes('emotionalImpactCarrierExempt,'), null);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
