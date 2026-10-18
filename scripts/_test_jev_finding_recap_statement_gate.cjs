#!/usr/bin/env node
/**
 * C96 / J1.37 双门单测——F→E 改道（finding_vs_recap）+ 陈述句门（name_form）
 * ——本地零 DB 零网络单测（2026-10-18 用户裁定双立项：「修分类逃逸」+
 * 「陈述句门我认为也对，也加吧」）
 *
 * 案发（0xc6d089d749409f7646de440d637ac9db0e047777「币安上电视」）：CZ 转发
 * 「BNB 上越南国家电视」1 秒后快枪发币，J1.32 判 F 类（Discovery「author-
 * discovered」被 spotted 目击语气满足）A 档 77 分 high 放行，买入 22 秒 -33.4%。
 * 分类逃逸是过关钥匙：no_visual_entity 0.97 若按语义判 E/D 会被 J1.29 载体门
 * 当场拦死，逃进 F 不吃载体门不吃折损。三借壳（量级/mem/web3_fit）全是事件
 * 成分属性，无一轴衡量名字本身作为 meme 载体。
 *
 * 覆盖：
 *   A. 问卷形状：J1.37 版本 / 两新题恒带三态 / F 档澄清 / 题面判别锚
 *   B. F→E 改道真值表：F+news_recap→categoryForced='f_recap_e'+category=E；
 *      finding/unclear/缺失→维持 F；非 F+news_recap→不消费（观察键照落）
 *   C. 陈述句门全域真值表：statement 全类别拦；entity/unclear/缺失→不拦
 *   D. 事故现场反证（币安上电视 J1.32 快照实测值）：双门命中→拦；
 *      name_form=entity→改道 E+载体门接住（改道的意义）；
 *      finding→维持 F+陈述句门仍拦（门与改道独立）；
 *      mem≥2+五腿全中（J1.34 后形状）→陈述句门=唯一拦截位反证
 *   E. 审计字段：stage1 categoryForced/nameForm/findingVsRecap 恒落；
 *      stage2 findingVsRecap 双写/statementBlock 命中才落；probabilities
 *   F. 源码口径：门链序（rm→st→memFloor→sc）/ 五腿刻意不豁 /
 *      cashtag 改道优先 / 旧缓存行 fail-open（无失效脚本需求）
 *
 * 用法：node scripts/_test_jev_finding_recap_statement_gate.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const ST_LABEL = '币名是事件陈述非实体指代（陈述句门）';
const CARRIER_LABEL = '叙事主体无形象载体';

/**
 * 通过型基础形状（全部前置门不命中，A 档量级，Stage3 不拦）——专测两新门。
 * 与 _test_subject_carrier 的 baseAnswers 同族但 J1.37 起带两新题。
 */
function baseAnswers(cat, overrides = {}) {
  const answers = {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.9, notable_other: 0.08 } },
    referent_memeability: { score: 3, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.7 } },
    // probabilities 带 none 低占位：relNoneMass = none ?? 1，缺键默认 1 会让
    // C88 五腿 miss（relNone<0.5 腿）——C-专项五腿全中形状依赖此键
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.8, none: 0.05 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    // J1.37 两新题默认值（不触发两门）
    finding_vs_recap: { choice: 'narrative_finding', probabilities: { narrative_finding: 0.8, news_recap: 0.15 } },
    name_form: { choice: 'entity_phrase', probabilities: { entity_phrase: 0.85, statement: 0.1 } },
  };
  return Object.assign(answers, overrides);
}

const stdCtx = (symbol, name) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

function blockedBy(r, label) {
  return r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes(label);
}

/**
 * 事故快照形状（0xc6d0…7777「币安上电视」token_narrative J1.32 行实测值）：
 * F 类 / super_ip 0.6 / mem 1.72 / strong_fit 0.93 / no_visual_entity 0.97 /
 * product_functional 0.61 / exact 0.44+translation 0.3 / within_7d / A 档
 * （34+28+15=77）。J1.37 两新题答案由参数注入（线上 J1.32 行无此两题）。
 */
function incidentAnswers({ recap = 'news_recap', nameForm = 'statement', mem = 1.72 } = {}) {
  return {
    event_category: { choice: 'F', probabilities: { F: 0.55, E: 0.25, D: 0.12 } },
    event_magnitude: { score: 8.2, probabilities: { '5': 0.62, '4': 0.25 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 28, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.6, notable_other: 0.2 } },
    referent_memeability: { score: mem, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.93, fit: 0.04 } },
    subject_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.97, improvised_entity: 0.02 } },
    subject_entity: { choice: 'product_functional', probabilities: { product_functional: 0.61 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.44, translation_match: 0.3, none: 0.08 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    finding_vs_recap: { choice: recap, probabilities: { [recap]: 0.8 } },
    name_form: { choice: nameForm, probabilities: { [nameForm]: 0.85 } },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.37 两新题恒带）──');
  check('A1 版本号 = J1.38（C96 起两新题；C98 negative_hard_news 题面扩政治暴力边界）', JEV_QUESTIONS_VERSION === 'J1.38', JEV_QUESTIONS_VERSION);
  const qs = buildStandardQuestions();
  check('A2 finding_vs_recap 恒带（默认题集）', 'finding_vs_recap' in qs, Object.keys(qs).length);
  check('A3 name_form 恒带（默认题集）', 'name_form' in qs, null);
  const fvr = qs.finding_vs_recap;
  check('A4 finding_vs_recap type=choice 三态', fvr.type === 'choice'
    && ['narrative_finding', 'news_recap', 'unclear'].every(k => k in fvr.criteria), null);
  check('A5 finding_vs_recap 关键判别锚：发现语气不构成发现（大V报道→news_recap）',
    fvr.instructions.includes('不构成发现') && fvr.instructions.includes('目击动作'), null);
  const nf = qs.name_form;
  check('A6 name_form type=choice 三态', nf.type === 'choice'
    && ['entity_phrase', 'statement', 'unclear'].every(k => k in nf.criteria), null);
  check('A7 name_form 判名字语言结构不判指向对象影响力', nf.instructions.includes('判名字本身的语言结构') && nf.instructions.includes('不判名字指向对象的影响力'), null);
  check('A8 name_form 口号/宣言不算陈述（entity phrase）', nf.instructions.includes('不是陈述'), null);
  check('A9 name_form 中英文名取更完整的一个判', nf.instructions.includes('取更完整的一个判'), null);
  check('A10 event_category F 档澄清（目击/报道新闻≠发现→判 E/D，spotted 语气不满足 F）',
    /F:\s*'Discovery:[^']*NOT a news event the author merely witnessed\/reported/.test(
      (await readQuestionsSrc()).replace(/\n/g, ' ')), null);
  check('A11 两新题不受条件开关影响（includeBrandHijack 臂同带）',
    'finding_vs_recap' in buildStandardQuestions({ includeBrandHijack: true })
    && 'name_form' in buildStandardQuestions({ includeBrandHijack: true }), null);

  // ═══ B. F→E 改道真值表 ═══
  console.log('\n── B. F→E 改道真值表（event_category × finding_vs_recap）──');
  // B1 F+news_recap → 改道 E（categoryForced='f_recap_e'，category=E）
  const rB1 = mapStandardAnswers(baseAnswers('F', {
    finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
  }), stdCtx('TST', 'TST'));
  check('B1 F+news_recap → category=E', rB1.stage1DataToSave.category === 'E', rB1.stage1DataToSave.category);
  check('B1b categoryForced=f_recap_e（改道来源可追溯）',
    rB1.stage1DataToSave.parsed_output.jev.categoryForced === 'f_recap_e',
    rB1.stage1DataToSave.parsed_output.jev.categoryForced);
  check('B1c Jev 原 choice=F 在 probabilities 可追溯',
    rB1.stage1DataToSave.parsed_output.jev.probabilities.event_category.F === 0.7, null);
  // B2 维持 F 臂
  const keepFArms = [['narrative_finding', '发现（真 F 内容）'], ['unclear', 'unclear（fail-open）'], [null, '缺失（旧缓存行 fail-open）']];
  for (const [recap, note] of keepFArms) {
    const a = baseAnswers('F');
    if (recap) a.finding_vs_recap = { choice: recap, probabilities: { [recap]: 0.7 } };
    else delete a.finding_vs_recap;
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`B2 ${note} → 维持 F 零变化（categoryForced=null）`,
      r.stage1DataToSave.category === 'F' && r.stage1DataToSave.parsed_output.jev.categoryForced === null,
      { category: r.stage1DataToSave.category, forced: r.stage1DataToSave.parsed_output.jev.categoryForced });
  }
  // B3 非 F+news_recap → 不消费（观察键照落）
  const rB3 = mapStandardAnswers(baseAnswers('C', {
    finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
  }), stdCtx('TST', 'TST'));
  check('B3 非 F+news_recap → 不改道（category=C，findingVsRecap 观察键照落）',
    rB3.stage1DataToSave.category === 'C'
    && rB3.stage1DataToSave.parsed_output.jev.categoryForced === null
    && rB3.stage1DataToSave.parsed_output.jev.findingVsRecap === 'news_recap',
    rB3.stage1DataToSave.parsed_output.jev.findingVsRecap);
  // B4 改道后 E 类既有门接管（no_visual → 载体门拦）：改道不是放行是换考官。
  // fixture 用 mem 2.5（过 mem 地板）+super_ip 0.3（破五腿 sipProb 臂——五腿
  // 命中会豁载体门）隔离出载体门单一变量
  const rB4 = mapStandardAnswers(baseAnswers('F', {
    finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
    subject_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.9 } },
    referent_memeability: { score: 2.5, probabilities: {} },
    name_referent: { choice: 'notable_other', probabilities: { notable_other: 0.5, super_ip: 0.3 } },
  }), stdCtx('TST', 'TST'));
  check('B4 F+news_recap+no_visual（mem≥2 破五腿）→ E 载体门接管拦（改道的意义）',
    blockedBy(rB4, CARRIER_LABEL), rB4.llmResult.reason);

  // ═══ C. 陈述句门全域真值表 ═══
  console.log('\n── C. 陈述句门全域真值表（name_form=statement 不限类别）──');
  for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W']) {
    const r = mapStandardAnswers(baseAnswers(cat, {
      name_form: { choice: 'statement', probabilities: { statement: 0.9 } },
    }), stdCtx('TST', 'TST'));
    check(`C ${cat} 类+statement → 拦`, blockedBy(r, ST_LABEL), r.llmResult.reason);
  }
  // 放行臂
  const passArms = [['entity_phrase', '实体指代'], ['unclear', 'unclear（fail-open）'], [null, '缺失（旧缓存行 fail-open）']];
  for (const [form, note] of passArms) {
    const a = baseAnswers('D');
    if (form) a.name_form = { choice: form, probabilities: { [form]: 0.8 } };
    else delete a.name_form;
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`C ${note} → 不拦（rating 非 low 或 reason 无陈述句门）`, !blockedBy(r, ST_LABEL), r.llmResult.reason);
  }
  // C 专项：五腿全中（superIpSlogan=true）也不豁——mem 3≥2 五腿命中，statement 仍拦
  const rFive = mapStandardAnswers(baseAnswers('C', {
    name_form: { choice: 'statement', probabilities: { statement: 0.9 } },
    // baseAnswers 默认形状五腿天然全中：super_ip 0.9≥0.5 / relPositive 0.8≥0.3 /
    // relNone 0<0.5 / mem 3≥2 / within_7d / strong_fit 0.85≥0.5
  }), stdCtx('TST', 'TST'));
  check('C 专项 五腿全中（superIpSlogan hit）→ statement 仍拦（刻意不豁）',
    blockedBy(rFive, ST_LABEL)
    && rFive.stage2DataToSave.parsed_output.jev.superIpSlogan.hit === true,
    rFive.stage2DataToSave.parsed_output.jev.superIpSlogan);

  // ═══ D. 事故现场反证 ═══
  console.log('\n── D. 事故现场反证（币安上电视 0xc6d0…7777 J1.32 快照）──');
  const ctxBnbTv = stdCtx('币安上电视', '币安上电视');
  // D1 双门命中：news_recap 改道 E + statement 陈述句门 → 拦（label 归属陈述句门=链上先手）
  const rD1 = mapStandardAnswers(incidentAnswers(), ctxBnbTv);
  check('D1 双门命中（news_recap+statement）→ 拦，label 归属陈述句门',
    blockedBy(rD1, ST_LABEL) && !blockedBy(rD1, CARRIER_LABEL), rD1.llmResult.reason);
  check('D1b 改道同时生效（categoryForced=f_recap_e）',
    rD1.stage1DataToSave.parsed_output.jev.categoryForced === 'f_recap_e'
    && rD1.stage1DataToSave.category === 'E', rD1.stage1DataToSave.category);
  // D2 name_form=entity → 陈述句门不拦，改道 E 后载体门接住。fixture 同 B4 变体：
  // mem 2.5（案值 1.72<2 会先被 C88 mem 地板拦——链上先手，改道语义被遮蔽）+
  // super_ip 0.4 破五腿（否则载体门被豁）。no_visual 0.97 案值保留
  const d2Answers = incidentAnswers({ nameForm: 'entity_phrase', mem: 2.5 });
  d2Answers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.45, super_ip: 0.4 } };
  const rD2b = mapStandardAnswers(d2Answers, ctxBnbTv);
  check('D2 name_form=entity+破五腿 → 改道 E+载体门拦（no_visual 0.97 案值接上）',
    blockedBy(rD2b, CARRIER_LABEL) && !blockedBy(rD2b, ST_LABEL), rD2b.llmResult.reason);
  // D2b 对照：案值原样（mem 1.72）+entity → C88 mem 地板拦（1.72∈(1,2) 死区，
  // 线上 J1.32 漏放位——C88 上线后该形状已被地板收）
  const rD2c = mapStandardAnswers(incidentAnswers({ nameForm: 'entity_phrase' }), ctxBnbTv);
  check('D2b 案值原样 mem 1.72+entity → C88 mem 地板拦（1.72<2，J1.32 线上漏放位今已被地板收）',
    rD2c.llmResult.rating === 'low' && (rD2c.llmResult.reason || '').includes('mem 1.72<2'), rD2c.llmResult.reason);
  // D3 finding=narrative_finding → 维持 F（不改道），但 statement 全域仍拦（门与改道独立）
  const rD3 = mapStandardAnswers(incidentAnswers({ recap: 'narrative_finding' }), ctxBnbTv);
  check('D3 finding（维持 F）+ statement → 陈述句门仍拦（F 类全域覆盖）',
    blockedBy(rD3, ST_LABEL) && rD3.stage1DataToSave.category === 'F'
    && rD3.stage1DataToSave.parsed_output.jev.categoryForced === null, rD3.llmResult.reason);
  // D4 唯一拦截位反证：mem≥2（J1.34 后币安指代按对象 web3 影响力评）+五腿全中
  //    → mem 地板放行（≥2）+ 载体门被五腿豁免 → 陈述句门是唯一拦截位
  const rD4 = mapStandardAnswers(incidentAnswers({ mem: 2.5 }), ctxBnbTv);
  check('D4 mem 2.5+五腿全中 → 陈述句门仍拦（唯一拦截位反证）',
    blockedBy(rD4, ST_LABEL)
    && rD4.stage2DataToSave.parsed_output.jev.superIpSlogan.hit === true, rD4.llmResult.reason);
  // D5 对照：同 D4 形状但 name_form=entity → 陈述句门/载体门/mem 地板全放
  //    （该形状在 J1.34 语义下真实可过——陈述句门必要性正证）
  const rD5 = mapStandardAnswers(incidentAnswers({ mem: 2.5, nameForm: 'entity_phrase' }), ctxBnbTv);
  check('D5 对照 mem 2.5+五腿全中+entity → 三门全放行（pass=true，陈述句门必要性正证）',
    rD5.llmResult.pass === true && !blockedBy(rD5, ST_LABEL) && !blockedBy(rD5, CARRIER_LABEL),
    { pass: rD5.llmResult.pass, reason: rD5.llmResult.reason });

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计字段（恒落/命中才落/双写/probabilities）──');
  const rE = mapStandardAnswers(incidentAnswers(), ctxBnbTv);
  const s1 = rE.stage1DataToSave.parsed_output.jev;
  check('E1 stage1 nameForm 恒落（statement）', s1.nameForm === 'statement', s1.nameForm);
  check('E2 stage1 findingVsRecap 恒落（news_recap）', s1.findingVsRecap === 'news_recap', s1.findingVsRecap);
  const s2 = rE.stage2DataToSave.parsed_output.jev;
  check('E3 stage2 findingVsRecap 双写（信号页/校准脚本消费位）', s2.findingVsRecap === 'news_recap', s2.findingVsRecap);
  check('E4 stage2 statementBlock 命中才落 {form:statement}',
    JSON.stringify(s2.statementBlock) === '{"form":"statement"}', s2.statementBlock);
  check('E5 stage2 probabilities.name_form / finding_vs_recap 落库',
    s2.probabilities.name_form != null && s2.probabilities.finding_vs_recap != null, null);
  // 未命中臂：entity/finding → statementBlock=null + 恒落键照落
  const rEm = mapStandardAnswers(baseAnswers('D'), stdCtx('TST', 'TST'));
  check('E6 未命中 statementBlock=null（门形状事后校准免重跑）',
    rEm.stage2DataToSave.parsed_output.jev.statementBlock === null, null);
  check('E7 旧缓存行（两题缺失）恒落键=null 可识别',
    (() => {
      const a = baseAnswers('D'); delete a.finding_vs_recap; delete a.name_form;
      const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
      const j1 = r.stage1DataToSave.parsed_output.jev;
      return j1.nameForm === null && j1.findingVsRecap === null
        && r.stage2DataToSave.parsed_output.jev.findingVsRecap === null
        && r.llmResult.pass === true; // fail-open 不拦
    })(), null);

  // ═══ F. 源码口径 ═══
  console.log('\n── F. 源码口径（门链序/不豁/优先级/失效语义）──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('F1 门函数 statementNameBlock（choice!==statement 短路 null）',
    /function statementNameBlock\(answers\) \{\s*\n\s*if \(answers\?\.name_form\?\.choice !== 'statement'\) return null;\s*\n\s*return \{ label: '币名是事件陈述非实体指代（陈述句门）', form: 'statement' \};/.test(mapperSrc), null);
  check('F2 门链序：rm → st（陈述句门）→ C88 mem 地板 → 载体门（索引严格递增）', (() => {
    const rmIdx = mapperSrc.indexOf('referentMemeabilityLowBlock(answers)))');
    const stIdx = mapperSrc.indexOf('stBlock = statementNameBlock(answers)');
    const memFloorIdx = mapperSrc.indexOf('memScoreC88 < 2');
    const scIdx = mapperSrc.indexOf('subjectCarrierBlock(answers, category');
    return rmIdx > 0 && stIdx > rmIdx && memFloorIdx > stIdx && scIdx > memFloorIdx
      ? true : { rmIdx, stIdx, memFloorIdx, scIdx };
  })());
  check('F3 陈述句门臂无 superIpSlogan 豁免条件（五腿刻意不豁，源码形状）',
    /else if \(\(stBlock = statementNameBlock\(answers\)\)\) \{\s*\n\s*\/\/ C96 陈述句门/.test(mapperSrc), null);
  check('F4 改道公式：cashtagForced 优先、recapForced 次之（互斥无竞争）',
    mapperSrc.includes("const category = cashtagForced ? 'W' : (recapForced ? 'E' : (answers.event_category?.choice || null));"), null);
  check('F5 改道判据锁死 F+news_recap 组合（choice 恒等）',
    mapperSrc.includes("const recapForced = !!(answers.event_category?.choice === 'F'\n    && answers.finding_vs_recap?.choice === 'news_recap');"), null);
  check('F6 题集头部含 J1.37 changelog（C96 案档案）',
    (await readQuestionsSrc()).includes('* J1.37（2026-10-18') && (await readQuestionsSrc()).includes('0xc6d089d749409f7646de440d637ac9db0e047777'), null);
  check('F7 存量行不重评=观察期语义，两题答案缺失 fail-open（E7 已验行为臂）',
    mapperSrc.includes('答案缺失（旧缓存行/unclear）fail-open'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_finding_recap_statement_gate: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

// 题集源码缓存读（A10/F6 双消费）
let _qsSrc = null;
async function readQuestionsSrc() {
  if (_qsSrc === null) {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    _qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  }
  return _qsSrc;
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
