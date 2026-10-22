#!/usr/bin/env node
/**
 * C160 强情感冲击/动物救助路径——**J1.102/C171 退役反证单测**（零 DB 零网络，
 * 2026-10-22 改写）
 *
 * 案史：C160（2026-10-21 秦思雨案，用户裁定「对 web3 用户能造成强情感冲击的
 * 事件，算是另一条能打动用户的路径」「尤其是 web3 用户，喜欢猫猫狗狗」）立
 * emotionalImpactCarrierExempt 臂：E 类 ∧ fit≥0.5 ∧ 文本事实锚（动物救助词 ∧
 * 纪念词）→ 豁免载体门。臂的宿主是 J1.29 载体门——C171 形象轴整轴退役后无
 * 宿主随门删除：ANIMAL_RESCUE_STORY_RE/MEMORIAL_STORY_RE/isAnimalRescue-
 * MemorialStory 辅助与审计键 subjectCarrierEmotionalImpactExempt 整链退役。
 *
 * 案票终态变化：秦思雨（救助纪念票）与 C79 偷窥狂（泛 E 热点）C160 时行为
 * 分叉（前者豁免放行、后者照拦），C171 后**行为一致放行**——载体门不存在，
 * 两类票的差异回到 fit 分/其他门承担（动物救助票 fit 高事件分高自然放行，
 * 泛 E 热点票同过 fit 门=已知的避亏弱化面，回归观察）。
 *
 * 覆盖：
 *   A. 秦思雨形状（救助文本+fit 0.8）→ 放行；C79 偷窥狂形状同放行（行为一致）
 *   B. 源码口径：mapper 无 emotionalImpactCarrierExempt/ANIMAL_RESCUE_STORY_RE/
 *      isAnimalRescueMemorialStory（防复活）
 *   C. 审计键：subjectCarrierEmotionalImpactExempt 不再产出（历史行保留展示）
 *   D. 版本：J1.102+（C171）
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

  // ═══ A. 案票终态（C160 分叉 → C171 一致放行）═══
  console.log('\n── A. 案票终态 ──');
  const rRescue = mapStandardAnswers(answers(), ctx(RESCUE_TEXT));
  check('A1 秦思雨形状（救助纪念+fit 0.8）→ 放行（E 类 fit 0.8 事件分 80，无需豁免臂）',
    rRescue.llmResult.rating !== 'low', rRescue.llmResult.reason);
  const rC79 = mapStandardAnswers(answers(), ctx(C79_TEXT));
  check('A2 C79 偷窥狂形状（泛 E 热点）→ 同放行（载体门不存在，C160 分叉消失——已知的避亏弱化面，回归观察）',
    rC79.llmResult.rating !== 'low' && !(rC79.llmResult.reason || '').includes('形象载体'),
    rC79.llmResult.reason);
  check('A3 两票行为一致（豁免臂退役后无差分路径）',
    (rRescue.llmResult.rating !== 'low') === (rC79.llmResult.rating !== 'low'), null);

  // ═══ B. 源码口径（防复活）═══
  console.log('\n── B. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  check('B1 mapper 无 emotionalImpactCarrierExempt 活代码（留档注释外零引用）',
    !/const emotionalImpactCarrierExempt/.test(mapperSrc)
    && !/emotionalImpactCarrierExempt,/.test(mapperSrc)
    && !/emotionalImpactCarrierExempt\s*:/.test(mapperSrc), null);
  check('B2 mapper 无 ANIMAL_RESCUE_STORY_RE/MEMORIAL_STORY_RE/isAnimalRescueMemorialStory（正则事实锚整链删除）',
    !/ANIMAL_RESCUE_STORY_RE/.test(mapperSrc) && !/MEMORIAL_STORY_RE/.test(mapperSrc)
    && !/isAnimalRescueMemorialStory/.test(mapperSrc), null);

  // ═══ C. 审计键 ═══
  console.log('\n── C. 审计键 ──');
  check('C1 stage2 段 subjectCarrierEmotionalImpactExempt 不产出（历史行保留展示）',
    !('subjectCarrierEmotionalImpactExempt' in s2jev(rRescue)), s2jev(rRescue).subjectCarrierEmotionalImpactExempt);

  // ═══ D. 版本 ═══
  console.log('\n── D. 版本 ──');
  const { JEV_QUESTIONS_VERSION } = await import(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'));
  check('D1 JEV_QUESTIONS_VERSION ≥ J1.102（C171 形象轴整退役，情感豁免臂随删）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
