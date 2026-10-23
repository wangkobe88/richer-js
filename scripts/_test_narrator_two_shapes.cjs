#!/usr/bin/env node
/**
 * J1.20 陈述者两形状分流 → J1.79 事件价值题收敛后口径承接——零 DB 零网络单测
 * （2026-09-30 用户裁定，C32 正龟案 0x969c6981…7777：A股新规全国级事件被
 *  criteria「第三方小号→C档」字面锚定陈述者 → 事件分 58.2<60 拦下，实际
 *  7 分钟 ×10.6 毕业。裁定原话「它俩只是陈述者罢了（叙事陈述者），事件的
 *  主体是A股」）。
 *
 * J1.79 变更：web3_user_event_impact 题删除，标准路径事件分改为
 * web3_user_event_fit 单题质量（strong_fit+fit，0-100，60 过线）。陈述者
 * 两形状的题面细则随题删除，但裁定内核仍须锁死：
 *   ①事件主体=事件本身的核心实体，不是陈述者（event_subject_entity 判据承载）；
 *   ②事件分只由主题口味契合度决定——陈述者粉丝数/传播数据不参与（fit 题面锁）；
 *   ③tier 由 fit 质量派生（仅用于既有量级门/豁免审计）。
 *
 * 覆盖：
 *   A. 新标准题面：impact/spread 删题 / fit 为唯一事件价值题 / 主体判定保留 /
 *      传播数据不参与
 *   B. 行为级：事件分=round2(min(1, strong_fit+fit)×100) / 60 过线 / D 档
 *      （fit 派生）量级门先拦
 *   C. 陈述者不参与：同一 fit 答案换陈述者粉丝数（1M vs 10）分数与过线结论不变
 *   D. 版本历史条目保留
 *
 * 用法：node scripts/_test_narrator_two_shapes.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const TOKEN = { symbol: 'TST', name: 'TST', raw_api_data: { name: 'TST' } };

function answers(fitProbs, fitChoice = 'fit') {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.9 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.7 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.6, no_entity: 0.2 } },
    web3_user_event_fit: { choice: fitChoice, probabilities: fitProbs },
    event_subject_entity: { choice: 'event_hotspot', probabilities: { event_hotspot: 0.8 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.6 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
  };
}

function context(twitterInfo = null) {
  return {
    tokenData: TOKEN,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qs = buildStandardQuestions();
  const fit = qs.bsc_meme_user_event_fit;

  // ═══ A. 新标准题面（J1.79）═══
  console.log('\n── A. J1.79 fit 单题事件价值标准 ──');
  check('A1 版本号 = J1.90（J1.102=C171 形象载体轴整轴退役（删 web3_user_entity_visuality/event_influence 题集 12→10）；J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役+门一般化 web3FitMassBlock；J1.82=C140 圈层并入 fit；J1.81=C139 名字三轴重构；J1.80=C138 超IP来源判据；J1.79 impact 删题 + fit 单一事件分）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  check('A2 web3_user_event_spread / event_magnitude / dimension2 均删题；web3_user_event_impact = J1.110/C181 复活为 choice 否决题（J1.79 删除的旧题同键名撞名复活，锁 type=choice 防变回 score 事件分题）',
    qs.bsc_meme_user_event_impact?.type === 'choice' && qs.web3_user_event_spread === undefined
    && qs.event_magnitude === undefined && qs.dimension2 === undefined, Object.keys(qs));
  check('A3 fit 声明标准路径唯一事件价值题 + 60 过线 + 不是影响力题',
    fit.instructions.includes('标准路径的事件价值题') && fit.instructions.includes('事件分=本题 strong_fit+fit 质量（0-100，60 过线）')
    && fit.instructions.includes('不是事件影响力大小'), null);
  check('A4 fit 四档判据（strong_fit/fit/marginal/unfit）',
    ['strong_fit', 'fit', 'marginal', 'unfit'].every(k => typeof fit.criteria?.[k] === 'string' && fit.criteria[k].length > 0),
    Object.keys(fit.criteria || {}));
  check('A5 event_subject_entity 题退役（J1.83/C141）——C32 内核「陈述者不参与」由 fit 题声明+行为级 C 段承载；主体实体分类钩子随题删除，产品实体判据迁 unfit 桶',
    qs.event_subject_entity === undefined
    && fit.criteria.unfit.includes('公司产品实体不被接纳'), null);
  check('A6 传播数据不参与事件分（点赞/播放量大小不是本题判断依据）',
    fit.instructions.includes('传播数据（点赞/播放量）大小不是本题判断依据'), null);

  // ═══ B. 行为级：事件分=fit 质量 ═══
  console.log('\n── B. 事件分 = round2(min(1, strong_fit+fit)×100) ──');
  const r60 = mapStandardAnswers(answers({ strong_fit: 0.3, fit: 0.3, marginal: 0.3, unfit: 0.1 }), context());
  const s60 = r60.stage2DataToSave.parsed_output;
  check('B1 strong 0.3+fit 0.3=0.6 → 事件分 60 压线过（pass 线 60 含等号）',
    s60.scoringResult.eventCompositeScore === 60 && s60.pass === true, { t: s60.scoringResult.eventCompositeScore, pass: s60.pass });

  const r75 = mapStandardAnswers(answers({ strong_fit: 0.55, fit: 0.2, marginal: 0.2, unfit: 0.05 }), context());
  const s75 = r75.stage2DataToSave.parsed_output;
  check('B2 strong 0.55+fit 0.2=0.75 → 事件分 75 / 派生档 A（tier 仅审计与豁免用）',
    s75.scoringResult.eventCompositeScore === 75 && s75.scoringResult.influenceTier === 'A',
    { t: s75.scoringResult.eventCompositeScore, tier: s75.scoringResult.influenceTier });

  const r55 = mapStandardAnswers(answers({ strong_fit: 0.25, fit: 0.3, marginal: 0.4, unfit: 0.05 }), context());
  const s55 = r55.stage2DataToSave.parsed_output;
  check('B3 strong 0.25+fit 0.3=0.55 → 事件分 55 拦「事件分不足（55<60）」',
    s55.scoringResult.eventCompositeScore === 55 && s55.pass === false && /事件分不足（55<60）/.test(s55.blockReason || ''),
    { t: s55.scoringResult.eventCompositeScore, r: s55.blockReason });

  const r100 = mapStandardAnswers(answers({ strong_fit: 0.8, fit: 0.4, marginal: 0.1, unfit: 0 }), context());
  const s100 = r100.stage2DataToSave.parsed_output;
  check('B4 strong 0.8+fit 0.4=1.2 → min(1,·) 封顶 100',
    s100.scoringResult.eventCompositeScore === 100, s100.scoringResult.eventCompositeScore);

  const rD = mapStandardAnswers(answers({ strong_fit: 0.1, fit: 0.1, marginal: 0.7, unfit: 0.1 }), context());
  const sD = rD.stage2DataToSave.parsed_output;
  check('B5 fit 派生 D 档（mass 0.2 → influenceScore 1）：契合证据门先拦（J1.83 同轴遮蔽——D 档域 [0.1,0.3) ⊂ 门域 [0,0.5)，归因=契合证据不足）',
    sD.pass === false && /Web3用户契合证据不足/.test(sD.blockReason || ''), sD.blockReason);

  // ═══ C. 陈述者不参与（C32 裁定内核的行为级反证）═══
  console.log('\n── C. 陈述者粉丝数不影响事件分 ──');
  const fitAnswers = answers({ strong_fit: 0.55, fit: 0.2, marginal: 0.2, unfit: 0.05 });
  const rBig = mapStandardAnswers(fitAnswers, context({ author_screen_name: 'bigaccount', author_followers_count: 1000000, text: 'x' }));
  const rSmall = mapStandardAnswers(fitAnswers, context({ author_screen_name: 'nobody', author_followers_count: 10, text: 'x' }));
  const clue = (r) => {
    const s = r.stage2DataToSave.parsed_output;
    return { t: s.scoringResult.eventCompositeScore, pass: s.pass };
  };
  check('C1 同 fit 答案：百万粉陈述者 vs 10 粉陈述者 → 事件分/过线完全一致（主体=事件本身）',
    JSON.stringify(clue(rBig)) === JSON.stringify(clue(rSmall)) && clue(rBig).t === 75,
    { big: clue(rBig), small: clue(rSmall) });

  // ═══ D. 版本历史 ═══
  console.log('\n── D. 版本历史 ──');
  const fs = await import('fs');
  const path = await import('path');
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  check('D1 头部含 J1.20 历史条目（正龟案 + 两形状裁定）',
    src.includes('* J1.20：') && src.includes('C32 正龟案') && src.includes('只是陈述者罢了'));

  console.log(`\n══ 结果: ${passed} 通过 / ${failed} 失败 ══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('单测执行异常:', err);
  process.exit(1);
});
