#!/usr/bin/env node
/**
 * C88 超级IP事件口号票：五腿救援 + mem 口径地板 + narrativeSuperIp 标签
 * ——本地零 DB 单测（2026-10-18 CZ 出书事件簇用户裁定）
 *
 * 案发链（四票两向失败，answers 均为 token_narrative 实测快照 2026-10-18）：
 *   暗号資産の覇者 0x926c…7777  11.8x 毕业 → low（rcp argmax 0.44 vs none 0.41 拦；
 *     反事实 J1.29 no_visual 0.92 也拦）→ 裁定：该过（口号性强+事件不小）
 *   BI 0x3891…7777              4.86x 毕业 → low（J1.29 improvised 0.62 拦；name_brand_hijack
 *     0.56 在后）→ 裁定：「BI 应该算是引申关联」（cultural 0.31+semantic 0.18）
 *   币安上电视 0xc6d0…7777      0.59x 死 → high 77 在跑（F 类载体门不触达，mem 1.72 在
 *     J1.28 (1,2) 死区）→ 裁定：该拦（无意义名字）
 *   CZDOODOO 0xd567…7777        0.50x 死 → high 76 在跑 → 裁定：该拦（与事件无关联；
 *     super_ip 0.02 证明拦截面不能设 super_ip 带内门槛）
 *
 * 裁定原话（2026-10-17）：「找角度借热点事件发币本身没问题，判据=发币形态/事件量级/
 * 币的口号性」——Jev 已把信号全判对（super_ip/mem/timing/strong_fit），门不消费。
 *
 * 机制（全 mapper-only 不动题面，无 JEV_QUESTIONS_VERSION bump）：
 *   ① recognizedEntitySlogan 五腿：super_ip≥0.5 ∧ 关联腿含引申（正向质量 exact+translation
 *      +abbreviation+semantic+cultural ≥0.3 且 none<0.5）∧ mem≥2 ∧ timing fresh ∧
 *      strong_fit≥0.5。豁免面：rcp 双臂 / J1.29 scBlock / Stage3 品牌劫持臂+关联≤10
 *      截断 / C86 D-1 magExempt <60 臂。刻意不豁：nhn/w3/pe/nr/rm/quality/D-E 量级臂/W 数学。
 *   ② mem 口径地板（J1.28 扩展臂）：标准数学域（!isW && rideMass==null）∧ fresh ∧
 *      mem<2 → 拦「蹭热点但名字无口号性」；mem∈(1,2) 是旧 ≤1 臂与五腿 ≥2 带之间的死区。
 *   ③ narrativeSuperIp/narrativeSuperIpSlogan 标签：零列方案，deriveSuperIpLabels
 *      从 stage1/stage2 JSON 三路推导（缓存路/新鲜路/回测 preload），1/0/null 三态。
 * 不送分原则：豁免只翻门，分数照算（BI 关联 1 分照计=诚实 mid 53.35）。
 *
 * 覆盖：
 *   A. 四票事故反证（精确值：暗号 78.36→80.51 high / BI 65.6→56.11 mid /
 *      币安上电视 mem 1.72 拦 / CZDOODOO mem 1.24 拦 + 审计全量）
 *   B. 关联腿编码（BI 引申 0.51/0.39 入带；none 0.6 链断不救 / 正向 0.2 不救）
 *   C. mem 地板（边界 1.99 拦 2.0 过 / older 豁出 / mem 缺失 fail-open / W 域豁出 /
 *      rideMass 骑乘改道豁出）
 *   D. 五腿单腿负（super_ip 0.48 / strong_fit 0.4 → slogan false 回归旧拦截形状）
 *   E. 豁免域边界（D 档量级臂照拦 / magExempt <60 臂救+无豁免对照 / 品牌劫持臂对照 /
 *      关联≤10 截断对照）
 *   F. deriveSuperIpLabels 三态（对象/字符串 JSON/缺路径/旧行无键）
 *   G. 源码口径：五腿定义 / 五处守卫 / magExempt 聚合 / D-E 臂无 C88 守卫（防漂移）/
 *      F4a/b/c 回归红线保持 / 审计恒落 / 标签链 8 接线
 *
 * 用法：node scripts/_test_superip_slogan_class.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}


// J1.56（C126）旧答案快照迁移：name_referent 六选项 → 新实体题三选项
// super_ip→accepted；subject_self/minor_other/notable_other→unknown；
// common_word/other_referent/none_related→no_entity；同类概率求和。
function migrateEntityAnswer(a) {
  const key = 'web3_user_name_entity_acceptance';
  const ans = a?.[key];
  if (!ans) return a;
  const map = { super_ip: 'accepted', subject_self: 'unknown', minor_other: 'unknown', notable_other: 'unknown', other_referent: 'no_entity', common_word: 'no_entity', none_related: 'no_entity' };
  const probs = {};
  for (const [k, v] of Object.entries(ans.probabilities || {})) {
    const nk = map[k] || k;
    probs[nk] = (probs[nk] || 0) + (typeof v === 'number' ? v : 0);
  }
  ans.probabilities = probs;
  ans.choice = map[ans.choice] || ans.choice;
  return a;
}

// ── 四票实测 answers 快照（token_narrative dump 2026-10-18，去 legend/confidence）──
// 暗号資産の覇者 0x926ce819b7fdcf47bd9ccb3166c489280c537777（11.8x 毕业，现网 low）
const ANHO = migrateEntityAnswer(JSON.parse('{"event_category":{"type":"choice","choice":"C","probabilities":{"A":0.01,"W":0.01,"B":0.22,"F":0.01,"G":0.01,"C":0.45,"D":0.28,"E":0.01}},"event_magnitude":{"type":"score","score":4.78,"probabilities":{"0":0,"1":0.01,"2":0.01,"3":0.04,"4":0.07,"5":0.87}},"event_timing":{"type":"choice","choice":"expected_within_30d","probabilities":{"within_7d":0.38,"within_30d":0,"older":0,"expected_within_30d":0.62,"expected_beyond_30d":0,"unknown":0}},"dimension2":{"type":"score","score":4.84,"probabilities":{"0":0.01,"1":0.02,"2":0.01,"3":0.01,"4":0.03,"5":0.92}},"event_token_block_reason":{"type":"choice","choice":"event_routine_content_product","probabilities":{"none":0.41,"subject_unqualified":0.02,"niche_subculture":0,"event_empty_content":0,"event_institution_routine":0.01,"low_quality_derivative":0.05,"event_marketing_gimmick":0.02,"event_baseless_speculation":0.01,"token_ip_reuse":0.02,"regional_event":0.02,"event_negative_hard_news":0,"event_routine_content_product":0.44}},"web3_user_event_fit":{"type":"choice","choice":"strong_fit","probabilities":{"strong_fit":0.97,"fit":0.02,"marginal":0.01,"unfit":0}},"event_subject_entity":{"type":"choice","choice":"person","probabilities":{"company":0.03,"product_functional":0.14,"product_character":0.01,"character_ip":0.01,"person":0.58,"event_hotspot":0.2,"meme_word":0.01,"none_of_above":0.02}},"event_resonance":{"type":"choice","choice":"strong_reaction","probabilities":{"strong_reaction":0.69,"mild_amusement":0.3,"indifferent":0.01}},"w_product_score":{"type":"score","score":0.24,"probabilities":{"0":0.86,"1":0.05,"2":0.07,"3":0.02}},"w_bsc_user_appeal":{"type":"score","score":1.8,"probabilities":{"0":0.35,"1":0.02,"2":0.09,"3":0.54}},"name_event_relevance":{"type":"choice","choice":"exact_match","probabilities":{"exact_match":0.8,"translation_match":0.07,"abbreviation_alias":0.02,"semantic":0.05,"cultural":0,"generic_concept":0.03,"none":0.02}},"relevance_level":{"type":"score","score":3.39,"probabilities":{"0":0.04,"1":0.09,"2":0.04,"3":0.09,"4":0.74}},"web3_user_name_entity_acceptance":{"type":"choice","choice":"super_ip","probabilities":{"subject_self":0.06,"super_ip":0.82,"notable_other":0.04,"minor_other":0,"common_word":0.07,"none_related":0.01}},"name_entity_memeability":{"type":"score","score":2,"probabilities":{"0":0.25,"1":0.04,"2":0.31,"3":0.29,"4":0.1,"5":0.01}},"name_entity_carrier":{"type":"choice","choice":"no_visual_entity","probabilities":{"existing_entity":0.04,"improvised_entity":0.04,"no_visual_entity":0.92}},"block_misspelling":{"type":"noul","noul":0.12},"quality_spelling":{"type":"score","score":2.7,"probabilities":{"0":0.02,"1":0.07,"2":0.09,"3":0.81}},"quality_reasonability":{"type":"score","score":1.79,"probabilities":{"0":0.03,"1":0.15,"2":0.82}}}'));
// BI 0x3891aeb8bf0ebb0079b4b1e6c18dd0ca26d77777（4.86x 毕业，现网 low；引申关联票）
const BI = migrateEntityAnswer(JSON.parse('{"event_category":{"type":"choice","choice":"C","probabilities":{"A":0.11,"W":0,"B":0,"F":0.01,"G":0,"C":0.81,"D":0.01,"E":0.06}},"event_magnitude":{"type":"score","score":3.05,"probabilities":{"0":0.03,"1":0.01,"2":0.01,"3":0.83,"4":0.06,"5":0.06}},"event_timing":{"type":"choice","choice":"within_7d","probabilities":{"within_7d":1,"within_30d":0,"older":0,"expected_within_30d":0,"expected_beyond_30d":0,"unknown":0}},"dimension2":{"type":"score","score":2.7,"probabilities":{"0":0.14,"1":0.04,"2":0.03,"3":0.62,"4":0.1,"5":0.07}},"event_token_block_reason":{"type":"choice","choice":"none","probabilities":{"none":0.4,"subject_unqualified":0.01,"niche_subculture":0.01,"event_empty_content":0.03,"event_institution_routine":0.1,"low_quality_derivative":0.27,"event_marketing_gimmick":0.09,"event_baseless_speculation":0,"token_ip_reuse":0.08,"regional_event":0,"event_negative_hard_news":0,"event_routine_content_product":0.01}},"web3_user_event_fit":{"type":"choice","choice":"strong_fit","probabilities":{"strong_fit":1,"fit":0,"marginal":0,"unfit":0}},"event_subject_entity":{"type":"choice","choice":"product_functional","probabilities":{"company":0.06,"product_functional":0.51,"product_character":0.16,"character_ip":0.21,"person":0.01,"event_hotspot":0.02,"meme_word":0.01,"none_of_above":0.02}},"event_resonance":{"type":"choice","choice":"mild_amusement","probabilities":{"strong_reaction":0.04,"mild_amusement":0.9,"indifferent":0.06}},"w_product_score":{"type":"score","score":0.01,"probabilities":{"0":1,"1":0,"2":0,"3":0}},"w_bsc_user_appeal":{"type":"score","score":0.35,"probabilities":{"0":0.8,"1":0.11,"2":0.03,"3":0.06}},"name_event_relevance":{"type":"choice","choice":"none","probabilities":{"exact_match":0.01,"translation_match":0,"abbreviation_alias":0.01,"semantic":0.18,"cultural":0.31,"generic_concept":0.1,"none":0.39}},"relevance_level":{"type":"score","score":0.63,"probabilities":{"0":0.44,"1":0.52,"2":0.03,"3":0.01,"4":0}},"web3_user_name_entity_acceptance":{"type":"choice","choice":"super_ip","probabilities":{"subject_self":0.02,"super_ip":0.59,"notable_other":0.13,"minor_other":0.07,"common_word":0.06,"none_related":0.13}},"name_entity_memeability":{"type":"score","score":2.19,"probabilities":{"0":0.14,"1":0.11,"2":0.34,"3":0.27,"4":0.11,"5":0.03}},"name_entity_carrier":{"type":"choice","choice":"improvised_entity","probabilities":{"existing_entity":0.07,"improvised_entity":0.62,"no_visual_entity":0.31}},"name_image_consistency":{"type":"choice","choice":"same_visual_category","probabilities":{"same_entity":0.04,"same_visual_category":0.88,"unrelated":0.08}},"name_brand_hijack":{"type":"noul","noul":0.56},"block_misspelling":{"type":"noul","noul":0.11},"quality_spelling":{"type":"score","score":2.89,"probabilities":{"0":0,"1":0.01,"2":0.09,"3":0.9}},"quality_reasonability":{"type":"score","score":1.86,"probabilities":{"0":0.01,"1":0.12,"2":0.87}}}'));
// 币安上电视 0xc6d089d749409f7646de440d637ac9db0e047777（0.59x 死，现网 high 77 在跑）
const TV = migrateEntityAnswer(JSON.parse('{"event_category":{"type":"choice","choice":"F","probabilities":{"A":0.01,"W":0.05,"B":0.02,"F":0.29,"G":0.01,"C":0.25,"D":0.16,"E":0.21}},"event_magnitude":{"type":"score","score":3.89,"probabilities":{"0":0.01,"1":0.04,"2":0.03,"3":0.3,"4":0.22,"5":0.4}},"event_timing":{"type":"choice","choice":"within_7d","probabilities":{"within_7d":1,"within_30d":0,"older":0,"expected_within_30d":0,"expected_beyond_30d":0,"unknown":0}},"dimension2":{"type":"score","score":4.5,"probabilities":{"0":0.01,"1":0.01,"2":0.02,"3":0.13,"4":0.07,"5":0.76}},"event_token_block_reason":{"type":"choice","choice":"none","probabilities":{"none":0.55,"subject_unqualified":0,"niche_subculture":0,"event_empty_content":0.09,"event_institution_routine":0.13,"low_quality_derivative":0.01,"event_marketing_gimmick":0.05,"event_baseless_speculation":0.05,"token_ip_reuse":0.01,"regional_event":0.09,"event_negative_hard_news":0,"event_routine_content_product":0.01}},"web3_user_event_fit":{"type":"choice","choice":"strong_fit","probabilities":{"strong_fit":0.93,"fit":0.04,"marginal":0.03,"unfit":0}},"event_subject_entity":{"type":"choice","choice":"product_functional","probabilities":{"company":0.13,"product_functional":0.61,"product_character":0,"character_ip":0.01,"person":0.01,"event_hotspot":0.1,"meme_word":0.01,"none_of_above":0.13}},"event_resonance":{"type":"choice","choice":"strong_reaction","probabilities":{"strong_reaction":0.79,"mild_amusement":0.2,"indifferent":0.01}},"w_product_score":{"type":"score","score":0.04,"probabilities":{"0":0.98,"1":0.01,"2":0.01,"3":0}},"w_bsc_user_appeal":{"type":"score","score":1.55,"probabilities":{"0":0.31,"1":0.16,"2":0.18,"3":0.35}},"name_event_relevance":{"type":"choice","choice":"exact_match","probabilities":{"exact_match":0.44,"translation_match":0.3,"abbreviation_alias":0.03,"semantic":0.21,"cultural":0.01,"generic_concept":0.01,"none":0}},"relevance_level":{"type":"score","score":3.58,"probabilities":{"0":0.01,"1":0.04,"2":0.06,"3":0.18,"4":0.71}},"web3_user_name_entity_acceptance":{"type":"choice","choice":"super_ip","probabilities":{"subject_self":0.04,"super_ip":0.6,"notable_other":0.12,"minor_other":0.03,"common_word":0.2,"none_related":0.01}},"name_entity_memeability":{"type":"score","score":1.72,"probabilities":{"0":0.1,"1":0.47,"2":0.17,"3":0.16,"4":0.07,"5":0.03}},"name_entity_carrier":{"type":"choice","choice":"no_visual_entity","probabilities":{"existing_entity":0.02,"improvised_entity":0.01,"no_visual_entity":0.97}},"name_brand_hijack":{"type":"noul","noul":0.44},"block_misspelling":{"type":"noul","noul":0.13},"quality_spelling":{"type":"score","score":2.77,"probabilities":{"0":0,"1":0.04,"2":0.13,"3":0.83}},"quality_reasonability":{"type":"score","score":1.75,"probabilities":{"0":0.02,"1":0.21,"2":0.77}}}'));
// CZDOODOO 0xd5674a6438969b9bc178065f8050290e5bb87777（0.50x 死，现网 high 76 在跑）
const DOODOO = migrateEntityAnswer(JSON.parse('{"event_category":{"type":"choice","choice":"A","probabilities":{"A":0.46,"W":0.01,"B":0,"F":0,"G":0,"C":0.45,"D":0.01,"E":0.07}},"event_magnitude":{"type":"score","score":4.18,"probabilities":{"0":0.03,"1":0.05,"2":0.05,"3":0.14,"4":0.05,"5":0.6799999999999999}},"event_timing":{"type":"choice","choice":"within_7d","probabilities":{"within_7d":1,"within_30d":0,"older":0,"expected_within_30d":0,"expected_beyond_30d":0,"unknown":0}},"dimension2":{"type":"score","score":4.29,"probabilities":{"0":0.03,"1":0.03,"2":0.12,"3":0.03,"4":0.05,"5":0.74}},"event_token_block_reason":{"type":"choice","choice":"event_institution_routine","probabilities":{"none":0.19,"subject_unqualified":0,"niche_subculture":0.03,"event_empty_content":0.09,"event_institution_routine":0.49,"low_quality_derivative":0.09,"event_marketing_gimmick":0.01,"event_baseless_speculation":0,"token_ip_reuse":0.1,"regional_event":0,"event_negative_hard_news":0,"event_routine_content_product":0}},"web3_user_event_fit":{"type":"choice","choice":"strong_fit","probabilities":{"strong_fit":0.96,"fit":0.02,"marginal":0.01,"unfit":0.01}},"event_subject_entity":{"type":"choice","choice":"character_ip","probabilities":{"company":0.04,"product_functional":0.01,"product_character":0.01,"character_ip":0.74,"person":0.05,"event_hotspot":0.07,"meme_word":0.02,"none_of_above":0.06}},"event_resonance":{"type":"choice","choice":"strong_reaction","probabilities":{"strong_reaction":0.69,"mild_amusement":0.29,"indifferent":0.02}},"w_product_score":{"type":"score","score":0.02,"probabilities":{"0":0.99,"1":0.01,"2":0,"3":0}},"w_bsc_user_appeal":{"type":"score","score":1.36,"probabilities":{"0":0.46,"1":0.08,"2":0.1,"3":0.36}},"name_event_relevance":{"type":"choice","choice":"exact_match","probabilities":{"exact_match":0.43,"translation_match":0.01,"abbreviation_alias":0.12,"semantic":0.18,"cultural":0.2,"generic_concept":0.01,"none":0.05}},"relevance_level":{"type":"score","score":2.03,"probabilities":{"0":0.04,"1":0.35000000000000003,"2":0.24,"3":0.29,"4":0.08}},"web3_user_name_entity_acceptance":{"type":"choice","choice":"minor_other","probabilities":{"subject_self":0.05,"super_ip":0.02,"notable_other":0.13,"minor_other":0.78,"common_word":0.01,"none_related":0.01}},"name_entity_memeability":{"type":"score","score":1.24,"probabilities":{"0":0.65,"1":0.01,"2":0.03,"3":0.15,"4":0.11,"5":0.05}},"name_entity_carrier":{"type":"choice","choice":"improvised_entity","probabilities":{"existing_entity":0.27,"improvised_entity":0.39,"no_visual_entity":0.34}},"name_brand_hijack":{"type":"noul","noul":0.47},"block_misspelling":{"type":"noul","noul":0.39},"quality_spelling":{"type":"score","score":1.7,"probabilities":{"0":0.03,"1":0.33,"2":0.55,"3":0.09}},"quality_reasonability":{"type":"score","score":0.56,"probabilities":{"0":0.49,"1":0.45,"2":0.06}}}'));

const TOKENS = {
  anho: { symbol: '暗号資産の覇者', name: '暗号資産の覇者', raw_api_data: { name: '暗号資産の覇者' } },
  bi: { symbol: 'BI', name: 'BI', raw_api_data: { name: 'BI' } },
  tv: { symbol: '币安上电视', name: '币安上电视', raw_api_data: { name: '币安上电视' } },
  doodoo: { symbol: 'CZDOODOO', name: 'CZDOODOO', raw_api_data: { name: 'CZDOODOO' } },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const EXISTING_CARRIER = { type: 'choice', choice: 'existing_entity', probabilities: { existing_entity: 0.9, improvised_entity: 0.05, no_visual_entity: 0.05 } };

function makeContext({ tokenData, includeBrandHijack = true, credibleEventAnchor = true } = {}) {
  // imageEvidence 不传=J1.30 imgNameExempt false（BI nic 0.88 但无图证据不豁免——
  // C88 测试聚焦本豁免，J1.30 有专属测试）
  return {
    tokenData,
    includeBrandHijack,
    credibleEventAnchor,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage2Of(m) { return m.stage2DataToSave?.parsed_output || {}; }
function stage3Of(m) { return m.stage3DataToSave?.parsed_output || {}; }

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { deriveSuperIpLabels } = require('../src/core/narrative/superip-labels.js');

  console.log('\n── A. 四票事故反证（实测 answers 精确复现） ──');

  // A1 暗号：修复前 rcp argmax 臂拦（0.44 vs none 0.41 五五开抖动 + 反事实 J1.29
  // no_visual 0.92 也拦）→ 修复后五腿全中放行；J1.79 事件分=fit 质量 0.99→99 → high 92.89
  const mA = mapStandardAnswers(ANHO, makeContext({ tokenData: TOKENS.anho }));
  const s2A = stage2Of(mA), s3A = stage3Of(mA);
  check('A1 暗号 stage2 放行：J1.79 fit 质量 0.99 → 事件分 99',
    s2A.pass === true && s2A.scoringResult?.eventCompositeScore === 99,
    { pass: s2A.pass, total: s2A.scoringResult?.eventCompositeScore });
  check('A1b 暗号四腿审计恒落：{hit:true, accepted:0.82, relPositive:0.94, relNone:0.02, timing:within_30d, strongFit:0.97}',
    JSON.stringify(s2A.jev?.recognizedEntitySlogan) === JSON.stringify({ hit: true, accepted: 0.82, authorUtterance: false, relPositive: 0.94, relNone: 0.02, timing: 'within_30d', strongFit: 0.97 }),
    s2A.jev?.recognizedEntitySlogan);
  check('A1c 暗号 stage3 high 精确值：J1.79 92.89（事件59.4+关联20+质量13.49）',
    s3A.pass === true && s3A.total_score === 92.89 && s3A.category_agg === 'high'
    && s3A.relevanceScore === 20 && s3A.qualityScore === 13.49,
    { pass: s3A.pass, total: s3A.total_score, cat: s3A.category_agg });
  check('A1d 暗号 rating=high + reason 前缀「超级IP口号票豁免(C88)」+ stage3 豁免审计',
    mA.llmResult?.rating === 'high' && /超级IP口号票豁免\(C88\)/.test(mA.llmResult?.reason || '')
    && JSON.stringify(s3A.jev?.recognizedEntitySloganExempt) === JSON.stringify({ accepted: 0.82, authorUtterance: false, timing: 'within_30d' }),
    { rating: mA.llmResult?.rating, exempt: s3A.jev?.recognizedEntitySloganExempt });

  // A2 BI：修复前 J1.29 improvised 0.62 拦（name_brand_hijack 0.56 在后）→ 修复后引申关联
  // 入带放行；不送分：关联 1 分照计（none/lv1）→ J1.79 fit 1.0 事件分 100 → 诚实 high 76.75
  const mB = mapStandardAnswers(BI, makeContext({ tokenData: TOKENS.bi }));
  const s2B = stage2Of(mB), s3B = stage3Of(mB);
  check('A2 BI stage2 放行：J1.79 fit 质量 1.0 → 事件分 100',
    s2B.pass === true && s2B.scoringResult?.eventCompositeScore === 100,
    { pass: s2B.pass, total: s2B.scoringResult?.eventCompositeScore });
  check('A2b BI 引申关联腿入带审计：relPositive=0.51（sem0.18+cult0.31+exact0.01+abbr0.01）/relNone=0.39',
    JSON.stringify(s2B.jev?.recognizedEntitySlogan) === JSON.stringify({ hit: true, accepted: 0.59, authorUtterance: false, relPositive: 0.51, relNone: 0.39, timing: 'within_7d', strongFit: 1 }),
    s2B.jev?.recognizedEntitySlogan);
  check('A2c BI 不送分：关联 1 分照计 + 品牌 0.56 劫持臂放行 + J1.79 诚实总分 76.75 high',
    s3B.pass === true && s3B.relevanceScore === 1 && s3B.blockReason === null
    && s3B.total_score === 76.75 && s3B.category_agg === 'high',
    { pass: s3B.pass, rel: s3B.relevanceScore, total: s3B.total_score, cat: s3B.category_agg });
  check('A2d BI rating=high + reason 前缀（引擎可经 narrativeSuperIpSlogan 标签消费）',
    mB.llmResult?.rating === 'high' && /超级IP口号票豁免\(C88\)/.test(mB.llmResult?.reason || ''),
    { rating: mB.llmResult?.rating });

  // A3 币安上电视：现网 high 77 在跑（F 类载体门不触达 + mem 1.72 在 J1.28 (1,2) 死区）
  // → C108 memFloor 退役：名字拦截责任移交 name_form（TV fixture name_form 兼容
  // 放行臂）→ 票放行；五腿 hit:false 审计恒落（mem 腿独立观察保留）
  const mT = mapStandardAnswers(TV, makeContext({ tokenData: TOKENS.tv }));
  const s2T = stage2Of(mT);
  check('A3 币安上电视 mem 地板 C108 退役：票放行 + memFloorBlock 键不落',
    s2T.pass === true && s2T.blockReason === null && s2T.jev?.memFloorBlock === undefined,
    { pass: s2T.pass, blockReason: s2T.blockReason, floor: s2T.jev?.memFloorBlock });
  check('A3b J1.61 四腿审计恒落（mem 腿已删——hit:true，accepted 0.6）',
    s2T.jev?.recognizedEntitySlogan?.hit === true && s2T.jev?.recognizedEntitySlogan?.accepted === 0.6
    && s2T.jev?.recognizedEntitySlogan?.mem === undefined,
    { audit: s2T.jev?.recognizedEntitySlogan });

  // A4 CZDOODOO：super_ip 0.02 → 五腿不中 hit:false 恒落观察；memFloor 退役不再拦
  // （super_ip 0.02=观察腿，名字无玩味点的拦截责任移交 name_form 判）
  const mD = mapStandardAnswers(DOODOO, makeContext({ tokenData: TOKENS.doodoo }));
  const s2D = stage2Of(mD);
  check('A4 CZDOODOO A 类不在实体门域（B/C/D/F/G/W）：放行 + accepted 0.02 hit:false 恒落观察',
    s2D.pass === true && s2D.blockReason === null
    && s2D.jev?.recognizedEntitySlogan?.accepted === 0.02 && s2D.jev?.recognizedEntitySlogan?.hit === false
    && s2D.jev?.memFloorBlock === undefined,
    { blockReason: s2D.blockReason, audit: s2D.jev?.recognizedEntitySlogan });

  console.log('\n── B. 关联腿编码（直接 exact/translation 天然满足；引申=正向质量≥0.3 且 none<0.5） ──');

  // B1 none 0.6 占优（引申链断——事件与名字真无关）→ slogan false；J1.87/C145
  // routine 桶退役后不再由「常规内容产品宣传」argmax 拦
  let a = clone(ANHO); a.name_event_relevance.probabilities.none = 0.6;
  let m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.anho }));
  check('B1 暗号 none=0.6：链断不救 → slogan false；routine 桶退役后不再拦',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === false
    && !(stage2Of(m).blockReason || '').includes('常规内容产品宣传'),
    { blockReason: stage2Of(m).blockReason });

  // B2 relPositive 0.2（链太弱）→ 同 B1
  a = clone(ANHO);
  a.name_event_relevance.probabilities = { exact_match: 0.1, translation_match: 0, abbreviation_alias: 0, semantic: 0.1, cultural: 0, generic_concept: 0.1, none: 0.4 };
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.anho }));
  check('B2 暗号 relPositive=0.2：链弱不救 → slogan false；routine 桶退役后不再拦',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === false
    && !(stage2Of(m).blockReason || '').includes('常规内容产品宣传'),
    { blockReason: stage2Of(m).blockReason });

  console.log('\n── C. mem 口径（C108 后 memFloor 退役；mem 只在五腿公式 mem≥2 消费）──');

  // C1 边界：mem=1.99 退役后放行（拦截责任移交 name_form）；mem=2.0 五腿全中
  // slogan=true（与五腿 mem≥2 构成完整分离轴——地板退役后仅剩五腿一侧）
  a = clone(TV); a.name_entity_memeability.score = 1.99;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.tv }));
  check('C1 J1.61：mem 腿删除后该票四腿全中 → C88 救援（hit:true）',
    stage2Of(m).pass === true && stage2Of(m).blockReason === null
    && stage2Of(m).jev?.recognizedEntitySlogan?.hit === true,
    { blockReason: stage2Of(m).blockReason });
  a = clone(TV); a.name_entity_memeability.score = 2;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.tv }));
  check('C1b mem=2.0 边界过：五腿全中 slogan=true + J1.79 fit 事件分 97 pass',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === true && stage2Of(m).pass === true
    && stage2Of(m).scoringResult?.eventCompositeScore === 97 && m.llmResult?.rating === 'high',
    { hit: stage2Of(m).jev?.recognizedEntitySlogan?.hit, pass: stage2Of(m).pass });

  // C2 older 豁出：蹭冷饭由时限 override 封顶 30 守（J1.79 起=封顶非扣分）
  a = clone(TV); a.event_timing = { type: 'choice', choice: 'older', probabilities: { older: 1 } };
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.tv }));
  check('C2 J1.79：Jev timing 不独立计分（仅 override 封顶 30），无 override 时 97 pass',
    stage2Of(m).blockReason !== '蹭热点但名字无口号性（mem 1.72<2）'
    && stage2Of(m).pass === true && stage2Of(m).scoringResult?.eventCompositeScore === 97,
    { blockReason: stage2Of(m).blockReason, total: stage2Of(m).scoringResult?.eventCompositeScore });

  // C3 mem 答案缺失（旧缓存行）→ fail-open 不拦（五腿 mem:null 恒落观察保留）
  a = clone(TV); delete a.name_entity_memeability;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.tv }));
  check('C3 J1.61 mem 缺失无影响（腿已删）：四腿全中 hit:true + 审计无 mem 键',
    stage2Of(m).pass === true && stage2Of(m).jev?.memFloorBlock === undefined
    && stage2Of(m).jev?.recognizedEntitySlogan?.hit === true
    && stage2Of(m).jev?.recognizedEntitySlogan?.mem === undefined,
    { pass: stage2Of(m).pass, floor: stage2Of(m).jev?.memFloorBlock });

  // C4 W 数学域豁出：W 票 mem 1.5 fresh 不落 mem 地板（RedCoin 类产品票 mem 天然低；
  // W 有自己的 cashtag 机制）。J1.84/C142 起 W 单轴：吸引力 1.0→19 + 25=44<57。
  a = clone(BI);
  a.event_category = { type: 'choice', choice: 'W', probabilities: { W: 0.9, C: 0.1 } };
  a.w_product_score = { type: 'score', score: 0.5, probabilities: {} }; // J1.84 起零消费
  a.w_bsc_user_appeal = { type: 'score', score: 1.0, probabilities: {} };
  a.name_entity_memeability.score = 1.5;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('C4 W 类 mem=1.5：mem 地板不拦（落 W 数学 19<32 照拦）',
    stage2Of(m).blockReason === 'W类总分不足（19<32）',
    { blockReason: stage2Of(m).blockReason });

  // C5 J1.56 骑乘改道退役：B 类低影响力实体（unknown≥0.5）由实体低影响力门
  // 直接拦（旧实现 subject_self+super_ip mass≥0.5 → 改道 W 数学；新轴统一 unknown，
  // 用户裁定「低影响力实体不通过」——被拦而非降级评分）
  a = clone(BI);
  a.event_category = { type: 'choice', choice: 'B', probabilities: { B: 0.9, C: 0.1 } };
  a.web3_user_name_entity_acceptance.probabilities.accepted = 0.45;
  a.web3_user_name_entity_acceptance.probabilities.unknown = 0.55;
  a.name_entity_memeability.score = 1.5;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('C5 B 类 unknown 0.55≥0.5：实体低影响力门拦（骑乘改道退役）',
    stage2Of(m).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(m).blockReason || ''),
    { blockReason: stage2Of(m).blockReason });

  console.log('\n── D. 五腿单腿负（任一腿断 → slogan false 回归旧门） ──');

  // D1 super_ip 0.48：名字不指代超级IP → slogan false；J1.87/C145 routine 桶
  // 退役后由下一层载体门接管（叙事主体无形象载体），不再落 routine
  a = clone(ANHO); a.web3_user_name_entity_acceptance.probabilities.accepted = 0.48;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.anho }));
  check('D1 暗号 accepted=0.48：slogan false → routine 桶退役，载体门接管',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === false
    && (stage2Of(m).blockReason || '').includes('叙事主体无形象载体')
    && !(stage2Of(m).blockReason || '').includes('常规内容产品宣传'),
    { blockReason: stage2Of(m).blockReason });

  // D2 strong_fit 0.4：web3 买家共鸣不足 → slogan false；routine 桶退役后不再拦
  a = clone(ANHO);
  a.web3_user_event_fit.probabilities = { strong_fit: 0.4, fit: 0.5, marginal: 0.1, unfit: 0 };
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.anho }));
  check('D2 暗号 strongFit=0.4：slogan false；routine 桶退役后不再拦',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === false
    && !(stage2Of(m).blockReason || '').includes('常规内容产品宣传'),
    { blockReason: stage2Of(m).blockReason });

  console.log('\n── E. 豁免域边界（刻意不豁清单实证） ──');

  // E1 J1.79 结构性事实：tier 由 fit 质量派生，而五腿要求 strong_fit≥0.5 →
  // likedMass≥0.5 → influenceScore≥2.5 → round 3=B 档起——**口号五腿全中票与
  // D/E 量级臂互斥（D/E 臂对口号票不可达）**。低 fit 票照常走 D/E 臂，但五腿断。
  a = clone(BI);
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('E1 fit 派生档位：五腿全中票 tier≥B（S），D/E 量级臂结构性不可达（hit=true 且无量级拦截）',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === true
    && stage2Of(m).pass === true
    && ['S', 'A', 'B'].includes(stage2Of(m).scoringResult?.influenceTier)
    && !/量级不足/.test(stage2Of(m).blockReason || ''),
    { hit: stage2Of(m).jev?.recognizedEntitySlogan?.hit, tier: stage2Of(m).scoringResult?.influenceTier, blockReason: stage2Of(m).blockReason });
  a = clone(ANHO);
  a.web3_user_event_fit.probabilities = { strong_fit: 0.1, fit: 0.1, marginal: 0.7, unfit: 0.1 };
  a.event_quality_veto = { type: 'choice', choice: 'none', probabilities: { none: 0.9 } };
  a.name_entity_carrier = EXISTING_CARRIER;
  // J1.83/C141：低 fit 票先被契合证据门拦（挂量级门前）——币安语料豁新门，
  // 保「五腿断+量级 D 档臂拦」原断言（豁免票的量级臂照常接管）
  m = mapStandardAnswers(a, makeContext({ tokenData: { symbol: '币安暗号', name: '币安暗号', raw_api_data: { name: '币安暗号' } } }));
  check('E1b 低 fit（mass 0.2→D 档）票：五腿断（strongFit<0.5）且量级臂照拦「事件主体量级不足（D档）」',
    stage2Of(m).jev?.recognizedEntitySlogan?.hit === false
    && stage2Of(m).pass === false && stage2Of(m).blockReason === '事件主体量级不足（D档）',
    { hit: stage2Of(m).jev?.recognizedEntitySlogan?.hit, blockReason: stage2Of(m).blockReason });

  // E2 magExempt <60 臂救（C86 D-1 聚合扩至 C88口号）：strong_fit 恰 0.5 保五腿 +
  // fit 0.05 → 事件分 55<60 放行（tier B：0.55×5=2.75→round 3，不触发 D/E 臂）
  const FIVE_LEG_EDGE_FIT = { strong_fit: 0.5, fit: 0.05, marginal: 0.4, unfit: 0.05 };
  a = clone(BI); a.web3_user_event_fit = { type: 'choice', choice: 'strong_fit', probabilities: FIVE_LEG_EDGE_FIT };
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('E2 BI fit 0.55→事件分 55<60：C88实体口号 magExempt 放行 + reason 标注',
    stage2Of(m).pass === true && stage2Of(m).scoringResult?.eventCompositeScore === 55
    && /量级门豁免\(C88实体口号：事件分<60臂不拦，弱量级代价在总分\)/.test(stage2Of(m).reason || ''),
    { pass: stage2Of(m).pass, reason: stage2Of(m).reason });

  // E3 对照：同 55 分无五腿（sip 0.45 断腿 + carrier existing 出 J1.29）→「事件分不足（55<60）」照拦
  a = clone(BI); a.web3_user_event_fit = { type: 'choice', choice: 'strong_fit', probabilities: FIVE_LEG_EDGE_FIT };
  a.web3_user_name_entity_acceptance.probabilities.accepted = 0.45; a.name_entity_carrier = EXISTING_CARRIER;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('E3 同 55 分无豁免：照拦「事件分不足（55<60）」',
    stage2Of(m).pass === false && stage2Of(m).blockReason === '事件分不足（55<60）',
    { blockReason: stage2Of(m).blockReason });

  // E4 品牌劫持臂对照（BI 案发现场：J1.85 起信号=实体题 brand_mismatch 0.56 劫持了
  // Binance 品牌=预检关键词命中）：slogan 断（sip 0.45）且 tier B（fit 0.6，punExempt
  // 要求 S/A 不触发）→ 劫持臂拦截
  const HIJACK_TEST_FIT = { type: 'choice', choice: 'fit', probabilities: { strong_fit: 0.4, fit: 0.2, marginal: 0.3, unfit: 0.1 } };
  a = clone(BI); a.web3_user_event_fit = HIJACK_TEST_FIT;
  a.web3_user_name_entity_acceptance.probabilities.accepted = 0.45;
  a.web3_user_name_entity_acceptance.probabilities.brand_mismatch = 0.56;
  a.name_entity_carrier = EXISTING_CARRIER;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('E4 slogan 断 + brand_mismatch 0.56：Stage3 劫持臂恢复拦截「品牌劫持」',
    stage2Of(m).pass === true && stage3Of(m).pass === false && stage3Of(m).blockReason === '品牌劫持',
    { s3block: stage3Of(m).blockReason });

  // E5 关联≤10 截断对照：E4 基础上 brand_mismatch 0.49（劫持臂不触发）→ 关联性不足照拦
  // （引申关联的 rescue 只属于五腿全中票）
  a = clone(BI); a.web3_user_event_fit = HIJACK_TEST_FIT;
  a.web3_user_name_entity_acceptance.probabilities.accepted = 0.45;
  a.web3_user_name_entity_acceptance.probabilities.brand_mismatch = 0.49;
  a.name_entity_carrier = EXISTING_CARRIER;
  m = mapStandardAnswers(a, makeContext({ tokenData: TOKENS.bi }));
  check('E5 slogan 断 + brand_mismatch 0.49 + 关联 1 分：照拦「关联性不足」',
    stage3Of(m).pass === false && /关联性不足/.test(stage3Of(m).blockReason || ''),
    { blockReason: stage3Of(m).blockReason });

  console.log('\n── F. deriveSuperIpLabels 三态（零列方案：stage1/stage2 JSON 推导） ──');

  const S1 = (p) => ({ parsed_output: { jev: { probabilities: { web3_user_name_entity_acceptance: { accepted: p } } } } });
  const S2HIT = (hit) => ({ parsed_output: { jev: { recognizedEntitySlogan: { hit } } } });

  check('F1 super_ip≥0.5 → narrativeSuperIp=1（对象输入）',
    deriveSuperIpLabels(S1(0.7), S2HIT(true)).narrativeSuperIp === 1);
  check('F2 super_ip<0.5 → 0（=有分析有判定的合法 0 值，非 null）',
    deriveSuperIpLabels(S1(0.3), S2HIT(false)).narrativeSuperIp === 0);
  check('F3 缺路径 → null（未分析/prestage——题集 grep 零命中恒 null 诚实语义）',
    deriveSuperIpLabels({}, S2HIT(true)).narrativeSuperIp === null
    && deriveSuperIpLabels(null, null).narrativeSuperIp === null);
  check('F4 字符串 JSON 输入（Supabase jsonb 惰性 text 形状）同形解析',
    deriveSuperIpLabels(JSON.stringify(S1(0.82)), JSON.stringify(S2HIT(true)))
      .narrativeSuperIp === 1);
  check('F5 slogan.hit=true → 1 / false → 0',
    deriveSuperIpLabels(S1(0.7), S2HIT(true)).narrativeSuperIpSlogan === 1
    && deriveSuperIpLabels(S1(0.7), S2HIT(false)).narrativeSuperIpSlogan === 0);
  check('F6 旧行（C88 前缓存 stage2 无 recognizedEntitySlogan 键）→ slogan null（0=评估过 false 的 C88 后行专有）',
    deriveSuperIpLabels(S1(0.7), { parsed_output: { jev: {} } }).narrativeSuperIpSlogan === null
    && deriveSuperIpLabels(S1(0.7), null).narrativeSuperIpSlogan === null);
  check('F7 坏 JSON 字符串 → null 不抛（保守）',
    deriveSuperIpLabels('not-json{', S2HIT(true)).narrativeSuperIp === null);
  // F8/F9 落库信封形状（2026-10-18 v22 页面实测发现初版 bug：buildStageSaveData
  // 转换后 parsed_output 整包存进 details 键——DB 行（formatResult 缓存路/回测
  // preload/getExperimentNarratives）全部该形状；初版只认 parsed_output = 三条
  // DB 路恒 null，v22 659 票实测全 null 实锤）
  const S1DB = (p) => ({ rating: null, pass: true, details: { jev: { probabilities: { web3_user_name_entity_acceptance: { accepted: p } } } } });
  const S2DB = (hit) => ({ category: 'low', pass: false, details: { jev: { recognizedEntitySlogan: { hit } } } });
  check('F8 落库信封 details 形状（DB 行）同形推导',
    deriveSuperIpLabels(S1DB(0.7), S2DB(true)).narrativeSuperIp === 1
    && deriveSuperIpLabels(S1DB(0.7), S2DB(true)).narrativeSuperIpSlogan === 1
    && deriveSuperIpLabels(S1DB(0.3), S2DB(false)).narrativeSuperIp === 0);
  check('F9 details 信封 JSON 字符串（Supabase 惰性 text）同形解析',
    deriveSuperIpLabels(JSON.stringify(S1DB(0.66)), JSON.stringify(S2DB(true)))
      .narrativeSuperIp === 1);

  console.log('\n── G. 源码口径断言（防线锁定） ──');

  const fs = require('fs');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');

  check('G1 四腿谓词定义形状（J1.61：accepted∨authorUtterance ∧ 关联 ∧ fresh ∧ strongFit；无 mem 腿）',
    /const recognizedEntitySlogan = \(entityAcceptedProb >= 0\.5 \|\| authorUtterance\)/.test(mapperSrc)
    && !/memScoreC88/.test(mapperSrc)
    && /FRESH_TIMING_C88\.has\(timing\) && web3FitStrongP >= 0\.5/.test(mapperSrc)
    && /const FRESH_TIMING_C88 = new Set\(\['within_7d', 'within_30d', 'expected_within_30d'\]\)/.test(mapperSrc));
  check('G2 豁免守卫（J1.87/C145 routine 桶退役后）：scBlock opts / Stage3 劫持臂 / 关联≤10 截断；routine 概率臂与 argmax 子句不存在',
    !/routineContentProductBlock\(/.test(mapperSrc)
    && !/blockChoice === 'event_routine_content_product' && recognizedEntitySlogan/.test(mapperSrc)
    && /entityVisualBlock\(answers, category, \{\s*famousEntity,\s*authorUtterance, imgCarrierOverride,/.test(mapperSrc)
    && /brandMismatchP >= 0\.5 && !punExempt && !recognizedEntitySlogan/.test(mapperSrc)
    && /relevance\.score <= 10 && !punExempt && !imgNameExempt && !recognizedEntitySlogan/.test(mapperSrc));
  check('G3 memFloor 臂 C108 退役源码反证（reason 模板/mem<2 拦截/变量赋值不存在——仅注释档保留）',
    !/蹭热点但名字无口号性/.test(mapperSrc)
    && !/memScoreC88 < 2/.test(mapperSrc)
    && !/memFloorFired = /.test(mapperSrc));
  check('G4 magExempt 聚合含 C88实体口号 tag（C86 D-1 同款 <60 臂贯穿）',
    /const magExempt = punExempt \|\| imgNameExempt \|\| recognizedEntitySlogan;/.test(mapperSrc)
    && /recognizedEntitySlogan \? 'C88实体口号' : null/.test(mapperSrc));
  check('G5 D/E 量级臂守卫刻意无 recognizedEntitySlogan（防漂移：事件太小不救的裁定锁死）',
    /\(effTier === 'E' \|\| effTier === 'D'\) && !punExempt && !imgNameExempt/.test(mapperSrc)
    && !/\(effTier === 'E' \|\| effTier === 'D'\) && !punExempt && !imgNameExempt && !recognizedEntitySlogan/.test(mapperSrc));
  check('G6 C86 D-1 回归红线保持：F4a 守卫行 + F4b 事件分臂 + F4c W 裸线（J1.92 起 <32）恰好一处',
    /\(effTier === 'E' \|\| effTier === 'D'\) && !punExempt && !imgNameExempt/.test(mapperSrc)
    && /eventScoreBlocked = eventCompositeScore < 60 && !magExempt;/.test(mapperSrc)
    && mapperSrc.split('eventScoreBlocked = eventCompositeScore < 32;').length - 1 === 1);
  check('G7 stage2 审计恒落（hit:false 亦落——标签零列推导消费）；memFloorBlock 键 C108 退役不落（仅注释档保留）',
    /recognizedEntitySlogan: \{\s*\n\s*hit: recognizedEntitySlogan,/.test(mapperSrc)
    && !/memFloorBlock: /.test(mapperSrc));
  check('G8 stage3 豁免审计命中才落 + finalReason 前缀',
    /recognizedEntitySloganExempt: recognizedEntitySlogan \? \{ accepted: round2\(entityAcceptedProb\), authorUtterance, timing \} : null/.test(mapperSrc)
    && /recognizedEntitySlogan \? '超级IP口号票豁免\(C88\)｜' : ''/.test(mapperSrc));

  // 标签链 8 接线（C85 narrativeCategory 管线镜像，漏任一处=三态分裂红线）
  const parserSrc = fs.readFileSync('src/narrative/analyzer/parsers/response-parser.mjs', 'utf8');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const callerSrc = fs.readFileSync('src/trading-engine/pre-check/NarrativeDirectCaller.js', 'utf8');
  const faSrc = fs.readFileSync('src/services/FourMemeFactorAggregator.js', 'utf8');
  const engineSrc = fs.readFileSync('src/trading-engine/implementations/FourMemeWssTradingEngine.js', 'utf8');
  const backtestSrc = fs.readFileSync('src/trading-engine/implementations/BacktestEngine.js', 'utf8');
  const dataSvcSrc = fs.readFileSync('src/web/services/ExperimentDataService.js', 'utf8');
  const webJsSrc = fs.readFileSync('src/web/static/js/experiment_token_returns.js', 'utf8');

  check('G9 缓存路（response-parser formatResult）spread 推导',
    /import \{ deriveSuperIpLabels \} from '\.\.\/\.\.\/\.\.\/core\/narrative\/superip-labels\.js';/.test(parserSrc)
    && /\.\.\.deriveSuperIpLabels\(record\.stage1_result, record\.stage2_result\),/.test(parserSrc));
  check('G10 新鲜路（NarrativeAnalyzer）与缓存路同形 flat spread',
    /const superIpLabels = deriveSuperIpLabels\(stage1DataToSave, stage2DataToSave\);/.test(analyzerSrc)
    && /\.\.\.superIpLabels,/.test(analyzerSrc));
  check('G11 直调 ratingResult 两键 + catch 路补 null',
    /narrativeSuperIp: result\?\.narrativeSuperIp \?\? null,/.test(callerSrc)
    && /narrativeSuperIpSlogan: result\?\.narrativeSuperIpSlogan \?\? null,/.test(callerSrc)
    && callerSrc.split('narrativeSuperIp: null,').length - 1 === 1);
  check('G12 FA 两字面量键无条件出键（探针自动收录）',
    /factors\.narrativeSuperIp = _nar \? \(_nar\.superIp \?\? null\) : null;/.test(faSrc)
    && /factors\.narrativeSuperIpSlogan = _nar \? \(_nar\.recognizedEntitySlogan \?\? null\) : null;/.test(faSrc));
  check('G13 C84 触发状态机三同步点（st 初始/完成回填/投影——漏一处=三态分裂红线）',
    /superIp: null, recognizedEntitySlogan: null,/.test(engineSrc)
    && /st\.superIp = r\.narrativeSuperIp \?\? null;/.test(engineSrc)
    && /st\.recognizedEntitySlogan = r\.narrativeSuperIpSlogan \?\? null;/.test(engineSrc)
    && /superIp: st\.superIp \?\? null,/.test(engineSrc)
    && /recognizedEntitySlogan: st\.recognizedEntitySlogan \?\? null,/.test(engineSrc));
  check('G14 回测 preload 零列推导（fetchRowsByIds 全列行零查询）',
    /require\('\.\.\/\.\.\/core\/narrative\/superip-labels\.js'\)/.test(backtestSrc)
    && /const _sip = deriveSuperIpLabels\(row\.stage1_result, row\.stage2_result\);/.test(backtestSrc)
    && /superIp: _sip\.narrativeSuperIp \?\? null,/.test(backtestSrc));
  check('G15 web 数据层 + token-returns 页 badge（超级IP/口号）',
    /\.\.\.deriveSuperIpLabels\(narrative\.stage1_result, narrative\.stage2_result\),/.test(dataSvcSrc)
    && /narrative\.narrative\.narrativeSuperIp/.test(webJsSrc)
    && /narrative\.narrative\.narrativeSuperIpSlogan/.test(webJsSrc));
  check('G16 GMGN 条件键集刻意不加两键（爆炸面最小：只进 FA fire 因子表）',
    !/narrativeSuperIp/.test(fs.readFileSync('src/trading-engine/pre-check/GmgnRiskCheckService.js', 'utf8')));

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
