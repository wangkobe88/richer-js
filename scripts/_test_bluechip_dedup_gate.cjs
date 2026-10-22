#!/usr/bin/env node
/**
 * C168 蓝筹去重门单测（mapper-only，题集版本不动——regional anchor 同款切分）
 * ——本地零 DB 零网络单测。
 *
 * 裁定（2026-10-22 用户）：「蓝筹需要去重，小蓝筹不需要，短期热门叙事往往会
 * 发好些个票」——准蓝筹（quasi=feedback/graduations）姐妹票刻意不算重复叙事
 * （BIAOQING 三连发 The Chinese Bear 同名簇不拦）；已验证蓝筹（b:，ATH>$1M
 * curated 库）被后来的票以 name_exact/twitter_exact 撞上 = 纯复制品 → mapper
 * 门链首臂拦 low。rule 0.52「同名蓝筹废除移交叙事层」的接棒位。
 *
 * 覆盖：
 *   A. 检测真值表（detectDuplicateNarrative：exact 两级命中/quasi 不算/
 *      substring·corpus 不算/蓝筹本体自地址排除/address 传入被忽略/空形状）
 *   B. mapper 臂（证据→low+reason+audit；无证据对照=原评级不变；
 *      twitter_exact label 形状）
 *   C. 源码口径（analyzer 接线/mapper 链首序/开关默认开/config 段）
 *
 * 用法：node scripts/_test_bluechip_dedup_gate.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 蓝筹/准蓝筹混编索引（打桩直构，buildKnowledgeIndex 同款路径） */
function buildTestIndex() {
  const { buildKnowledgeIndex } = mod;
  return buildKnowledgeIndex([
    { id: 'b:0xaaaa…4444', kind: 'bluechip', name: 'The Chinese Bear', symbol: 'BIAOQING', aliases: ['Panda Head'], address: '0xaaaa000000000000000000000000000000004444', twitter: null, source: 'manual' },
    { id: 'b:0xbbbb…4444', kind: 'bluechip', name: '翱翔天际的巨鸟', symbol: 'BIRD', aliases: [], address: '0xbbbb000000000000000000000000000000004444', twitter: 'https://x.com/TCryptochicks', source: 'gmgn' },
    { id: 'q:0xcccc…7777', kind: 'quasi', name: 'The Chinese Bear', symbol: 'CB2', aliases: [], address: '0xcccc000000000000000000000000000000007777', twitter: null, source: 'feedback' },
    { id: 'q:0xdddd…7777', kind: 'quasi', name: '哭哭马', symbol: 'KKM', aliases: [], address: '0xdddd000000000000000000000000000000007777', twitter: null, source: 'graduations' },
    { id: 'b:0xeeee…4444', kind: 'bluechip', name: '哭哭马', symbol: 'KKM2', aliases: [], address: '0xeeee000000000000000000000000000000004444', twitter: null, source: 'gmgn' },
    { id: 'concept:stock', kind: 'concept', name: '股票概念币', keywords: ['股票'], source: 'manual' },
  ]);
}

/** 同名蓝筹双条（截断免疫形状：alias 与 name 两路全等） */
function buildDupIndex() {
  const { buildKnowledgeIndex } = mod;
  return buildKnowledgeIndex([
    { id: 'b:0x1111…4444', kind: 'bluechip', name: '熊猫头', aliases: [], address: '0x1111000000000000000000000000000000004444', source: 'manual' },
    { id: 'b:0x2222…4444', kind: 'bluechip', name: '熊猫头本体', aliases: ['熊猫头'], address: '0x2222000000000000000000000000000000004444', source: 'gmgn' },
  ]);
}

/**
 * 对照基底（_test_jev_regional_binance_anchor gameShowAnswers 全值快照同源）：
 * 全球号源无地域锚 → 全门链通过 pass=true（regional 测试 C 组实证形状），
 * 本测在其上叠加/不叠加 duplicateNarrative 证据做对照。
 */
function passAnswers() {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.84, G: 0.1, B: 0.02 } },
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.89 } },
    dimension2: { score: 25, probabilities: { '3': 0.37, '4': 0.27, '5': 0.25 } },
    event_quality_veto: { choice: 'event_baseless_speculation', probabilities: { event_baseless_speculation: 0.3, none: 0.24, event_marketing_gimmick: 0.28 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.55, unknown: 0.35 } },
    name_entity_memeability: { score: 2.39, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.73, fit: 0.1, marginal: 0.09 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.98 } },
    event_subject_entity: { choice: 'company', probabilities: { company: 0.53 } },
    name_event_relevance: { choice: 'semantic', probabilities: { semantic: 0.49, exact_match: 0.24, none: 0.14 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    name_form: { choice: 'entity_phrase', probabilities: { entity_phrase: 0.9 } },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.6 } },
  };
}

const DUP_NAME_EVIDENCE = {
  rule: 'name_exact', matchedOn: 'thechinesebear', matchedField: 'name',
  entryId: 'b:0xaaaa…4444', entryName: 'The Chinese Bear', entryAddress: '0xaaaa000000000000000000000000000000004444',
};
const DUP_TW_EVIDENCE = {
  rule: 'twitter_exact', matchedOn: 'tcryptochicks', matchedField: 'twitterHandle',
  entryId: 'b:0xbbbb…4444', entryName: '翱翔天际的巨鸟', entryAddress: '0xbbbb000000000000000000000000000000004444',
};

function baseCtx(extra = {}) {
  return {
    tokenData: { symbol: 'TEST', name: 'TEST', raw_api_data: { name: 'TEST' } },
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: { author_screen_name: 'someuser', author_followers_count: 100, text: 'test' },
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

let mod;

async function main() {
  mod = await import('../src/narrative/analyzer/knowledge/knowledge-matcher.mjs');
  const { detectDuplicateNarrative } = mod;
  const idx = buildTestIndex();

  // ═══ A. 检测真值表 ═══
  console.log('\n── A. detectDuplicateNarrative 真值表 ──');

  console.log('A1 蓝筹 name_exact（票 name 全等蓝筹 name）');
  let r = detectDuplicateNarrative({ symbol: 'CB', name: 'The Chinese Bear', address: '0xfff…1', twitterHandle: null }, idx);
  check('命中 name_exact + 蓝筹名', r && r.rule === 'name_exact' && r.entryName === 'The Chinese Bear', r);

  console.log('A2 蓝筹 alias exact（票 symbol 归一化撞蓝筹 alias）');
  r = detectDuplicateNarrative({ symbol: 'Panda-Head!', name: '随便什么名字', address: '0xfff…2', twitterHandle: null }, idx);
  check('alias 全等命中（归一化剥符号）', r && r.rule === 'name_exact' && r.entryId === 'b:0xaaaa…4444', r);

  console.log('A3 蓝筹 twitter_exact（条目 twitter=URL 形态剥前缀）');
  r = detectDuplicateNarrative({ symbol: 'BIRD2', name: '别的鸟', address: '0xfff…3', twitterHandle: 'tcryptochicks' }, idx);
  check('handle 全等命中（URL 剥前缀）', r && r.rule === 'twitter_exact' && r.entryId === 'b:0xbbbb…4444', r);

  console.log('A4 quasi 同名不拦（裁定核心：小蓝筹不需要去重）');
  const idxQuasiOnly = buildTestIndex();
  // q:0xcccc 与蓝筹同名 "The Chinese Bear"——但蓝筹条目先入册：同 name_exact 命中
  // 排序后蓝筹在前。构造 quasi-only 视角：票与 quasi 同名但蓝筹不同名
  r = detectDuplicateNarrative({ symbol: 'QX', name: '哭哭马二号', address: '0xfff…4', twitterHandle: null }, idxQuasiOnly);
  check('quasi name 不全等 → null（substring 不算）', r === null, r);
  // 真正的 quasi 全等形状：移除蓝筹哭哭马条目后只剩 quasi 哭哭马
  const { buildKnowledgeIndex } = mod;
  const idxQuasi = buildKnowledgeIndex([
    { id: 'q:0xdddd…7777', kind: 'quasi', name: '哭哭马', symbol: 'KKM', aliases: [], address: '0xdddd000000000000000000000000000000007777', twitter: null, source: 'graduations' },
  ]);
  r = detectDuplicateNarrative({ symbol: '哭哭马', name: '哭哭马', address: '0xfff…5', twitterHandle: null }, idxQuasi);
  check('quasi（graduations）name_exact 全等 → null（刻意不拦）', r === null, r);
  const idxQuasiFb = buildKnowledgeIndex([
    { id: 'q:0xcccc…7777', kind: 'quasi', name: 'The Chinese Bear', aliases: [], address: '0xcccc000000000000000000000000000000007777', twitter: null, source: 'feedback' },
  ]);
  r = detectDuplicateNarrative({ symbol: 'CB', name: 'The Chinese Bear', address: '0xfff…6', twitterHandle: null }, idxQuasiFb);
  check('quasi（feedback）BIAOQING 形状 → null（短期热门叙事连发不拦）', r === null, r);

  console.log('A5 name_substring 撞蓝筹不拦（哭哭奶龙×哭哭马共享片段）');
  r = detectDuplicateNarrative({ symbol: '哭哭奶龙', name: '哭哭奶龙', address: '0xfff…7', twitterHandle: null }, idx);
  check('共享「哭哭」非全等 → null（C151 有意义变形）', r === null, r);

  console.log('A6 corpus 提及不触发（窄输入内部 corpusText 恒空）');
  r = detectDuplicateNarrative({ symbol: 'XYZ', name: 'XYZ', address: '0xfff…8', twitterHandle: null, corpusText: '语料里提到了熊猫头 Panda Head 和 The Chinese Bear' }, idx);
  check('corpusText 传入也被忽略 → null', r === null, r);

  console.log('A7 蓝筹本体自地址排除（重析自己不得被自己拦）');
  r = detectDuplicateNarrative({ symbol: 'BIAOQING', name: 'The Chinese Bear', address: '0xaaaa000000000000000000000000000000004444', twitterHandle: null }, idx, { selfAddress: '0xAAAA000000000000000000000000000000004444' });
  check('selfAddress=蓝筹地址 → null（大小写不敏感）', r === null, r);
  r = detectDuplicateNarrative({ symbol: 'CB', name: 'The Chinese Bear', address: '0xfff…9', twitterHandle: null }, idx, { selfAddress: '0x9999000000000000000000000000000000004444' });
  check('selfAddress=别的地址照拦', r && r.rule === 'name_exact', r);

  console.log('A8 matchInput.address 传入被忽略（address_exact 非去重语义）');
  r = detectDuplicateNarrative({ symbol: 'UNRELATED', name: '完全无关', address: '0xeeee000000000000000000000000000000004444', twitterHandle: null }, idx);
  check('address=蓝筹哭哭马地址 → null', r === null, r);

  console.log('A9 空形状');
  check('index null → null', detectDuplicateNarrative({ symbol: 'X', name: 'X', address: '0x1', twitterHandle: null }, null) === null);
  check('matchInput null → null', detectDuplicateNarrative(null, idx) === null);

  console.log('A10 截断免疫（多条蓝筹命中不因 maxEntries 丢证据）');
  const idxDup = buildDupIndex();
  r = detectDuplicateNarrative({ symbol: '熊猫头', name: '熊猫头', address: '0xfff…a', twitterHandle: null }, idxDup);
  check('两条蓝筹同 alias 全等 → 命中其一', r && r.rule === 'name_exact' && ['b:0x1111…4444', 'b:0x2222…4444'].includes(r.entryId), r);

  // ═══ B. mapper 门链首臂 ═══
  console.log('\n── B. mapper 蓝筹去重臂 ──');
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  console.log('B1 无证据对照（基底 pass 形状不受影响）');
  const base = await mapStandardAnswers(passAnswers(), baseCtx());
  const basePass = base.llmResult.pass && base.llmResult.rating !== 'low';
  check('无证据 → 原评级非 low（pass）', basePass, { rating: base.llmResult.rating, reason: base.llmResult.reason });

  console.log('B2 name_exact 证据 → low + reason + audit');
  const withDup = await mapStandardAnswers(passAnswers(), baseCtx({ duplicateNarrative: DUP_NAME_EVIDENCE }));
  check('rating=low', withDup.llmResult.rating === 'low', withDup.llmResult.rating);
  check('reason 含「蓝筹去重」与蓝筹名', (withDup.llmResult.reason || '').includes('蓝筹去重') && (withDup.llmResult.reason || '').includes('The Chinese Bear'), withDup.llmResult.reason);
  const auditDup = withDup.stage2DataToSave?.parsed_output?.jev?.bluechipDuplicate;
  check('audit bluechipDuplicate 命中才落（entry/rule/entryId）', auditDup && auditDup.rule === 'name_exact' && auditDup.entry === 'The Chinese Bear' && auditDup.entryId === 'b:0xaaaa…4444', auditDup);
  check('audit 拦截 label 同步（blockReason）', (withDup.stage2DataToSave?.parsed_output?.blockReason || '').includes('蓝筹去重'), withDup.stage2DataToSave?.parsed_output?.blockReason);
  check('无证据对照 audit=null', base.stage2DataToSave?.parsed_output?.jev?.bluechipDuplicate == null, base.stage2DataToSave?.parsed_output?.jev?.bluechipDuplicate);

  console.log('B3 twitter_exact 证据 → label 带 @handle');
  const withTw = await mapStandardAnswers(passAnswers(), baseCtx({ duplicateNarrative: DUP_TW_EVIDENCE }));
  check('rating=low + reason 含 @tcryptochicks', withTw.llmResult.rating === 'low' && (withTw.llmResult.reason || '').includes('@tcryptochicks'), withTw.llmResult.reason);

  console.log('B4 蓝筹去重先手 NHN（链首资格否决：label 归属唯一）');
  const nhnAnswers = passAnswers();
  nhnAnswers.event_negative_hard_news = { choice: 'negative_hard_news', probabilities: { negative_hard_news: 0.8 } };
  const withBoth = await mapStandardAnswers(nhnAnswers, baseCtx({ duplicateNarrative: DUP_NAME_EVIDENCE }));
  check('label=蓝筹去重（非 NHN）', (withBoth.llmResult.reason || '').includes('蓝筹去重') && !(withBoth.llmResult.reason || '').includes('负面'), withBoth.llmResult.reason);

  // ═══ C. 源码口径（防线锁定） ═══
  console.log('\n── C. 源码口径断言 ──');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(__dirname, '..');
  const analyzerSrc = fs.readFileSync(path.join(root, 'src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  const mapperSrc = fs.readFileSync(path.join(root, 'src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const configSrc = fs.readFileSync(path.join(root, 'src/narrative/analyzer/knowledge/knowledge-config.mjs'), 'utf8');

  check('analyzer import detectDuplicateNarrative', analyzerSrc.includes("detectDuplicateNarrative } from './knowledge/knowledge-matcher.mjs'") || analyzerSrc.includes('detectDuplicateNarrative }'));
  check('analyzer 检测传 selfAddress（蓝筹本体自排除接线）', /detectDuplicateNarrative\(\{[\s\S]*?selfAddress:\s*tokenData\.address/.test(analyzerSrc));
  check('analyzer duplicateGate 开关（缺省开，显式 false 关）', analyzerSrc.includes("duplicateGate?.enabled !== false"));
  check('analyzer 检测失败旁路（catch 置 null）', /蓝筹去重检测失败[\s\S]*?duplicateNarrative = null/.test(analyzerSrc));
  const dupPos = mapperSrc.indexOf('if (context.duplicateNarrative)');
  const nhnArmPos = mapperSrc.indexOf('else if ((nhnBlock = negativeHardNewsBlock(answers)))');
  check('mapper 门链首（先于 NHN 消费臂）', dupPos > 0 && dupPos < nhnArmPos, { dupPos, nhnArmPos });
  check('mapper audit bluechipDuplicate 键', mapperSrc.includes('bluechipDuplicate:'));
  check('config CODE_DEFAULTS duplicateGate 默认开', /duplicateGate:\s*\{\s*enabled:\s*true\s*\}/.test(configSrc));
  // 事故现场反证（BIAOQING 三连发）：用户点名的案例必须被真实数据接住——
  // 熊猫头蓝筹条目 aliases 含三连发 symbol/name 两路（缺一路=该票漏拦）
  const manualSrc = fs.readFileSync(path.join(root, 'config/knowledge/manual-entries.json'), 'utf8');
  const panda = JSON.parse(manualSrc).entries.find((e) => e.address === '0xf3525965a4ad3ca0ac13f4d2f237113691194444');
  check('熊猫头蓝筹条目在册', !!panda && panda.kind === 'bluechip');
  check('熊猫头 aliases 接 BIAOQING（symbol 路）与 The Chinese Bear（name 路）',
    panda && ['biaoqing', 'thechinesebear'].every((n) => panda.aliases.some((a) => String(a).toLowerCase().replace(/[\s_-]+/g, '') === n)),
    panda && panda.aliases);
  const rBiao = detectDuplicateNarrative({ symbol: 'BIAOQING', name: 'The Chinese Bear', address: '0x329c64d1b14c663b30fa995fef475fdaf3417777', twitterHandle: null },
    mod.buildKnowledgeIndex(JSON.parse(manualSrc).entries), { selfAddress: '0x329c64d1b14c663b30fa995fef475fdaf3417777' });
  check('三连发形状实测命中（0x329c…7777 撞熊猫头蓝筹）', rBiao && rBiao.rule === 'name_exact' && rBiao.entryId === 'b:0xf3525965a4ad3ca0ac13f4d2f237113691194444', rBiao);

  console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
