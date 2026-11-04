#!/usr/bin/env node
/**
 * 背景信息严重不足无法理解桶（J1.158/C269）——零 DB 零网络单测
 *
 * 2026-11-04 用户裁定（1113 案 0x064f86075d930544ac655350f8295d1ef04d7777）：
 * 「这里明显不是什么 unfit，就是没搞明白这个代币到底啥意思，确实没有提供
 * 信息，并且搜索又没有明确结果，这样的在事件空洞检测中增加一个臂“背景信息
 * 严重不足无法搞明白叙事”，这种情况，叙事分析模块返回一个“无法理解”的
 * 结果给实验引擎，narrativeRating == 9 吧」。
 * 案发现场：symbol「1113」name「极寒降临」——语料全空，C77 搜索兜底按
 * 「1113」搜到的推文全是无关撞名（巴西 Mercedes 1113 卡车梗/彩票数字），
 * Jev 在 fit 题判 unfit 0.81 误拦 low/1。
 *
 * 三层形状：
 *   A（主体）语料/搜索背景在场但与币名建立不起关联 → impact 题第四桶
 *      background_info_insufficient 概率 ≥0.5 → rating='unrated' → 9
 *   B 语料全空+搜索零结果 → precheck 规则4 情况A no_public_info → unrated
 *   C 全抓取失败 !hasAnyData → no_data 兜底 → unrated
 *   （data_fetch_failed/public_info_fetch_failed=技术失败形状刻意不动）
 *
 * 覆盖：
 *   A. 题面：版本 J1.159 / impact 四桶 / 三层优先序（背景层>事件层>代币层）/
 *      1113 例证 / vs empty 划界（理解先于空洞）/ vs ip_reuse 划界 / 三排除锚
 *      （③=J1.159/C269a DND 划界：宣告推带主体内容载体→不选本桶走正常评估）
 *   B. mapper 概率门：≥0.5 → unrated（pass=null 刻意非 false）/ 恰 0.5 边界 /
 *      stage2 pass=true + 审计键恒落 / unfit 同 hit 审计保留（1113 现场形状）/
 *      Stage3 不 __clear（强制清零后 pass=true）/ stageFinal unrated 化
 *   C. <0.5 fail-open：argmax=新桶 0.44 掷骰段不拦不 unrated / 0.49 /
 *      旧缓存行缺桶 null 断代不冒充 0
 *   D. 优先级：bgInfo>政治线（unrated）；纯代码事实门 C168 在前照拦 low
 *   E. 六信封端到端：真实 mapper 输出 → resolveFinalRating 'unrated' → 9；
 *      反证锁 relation pass=false → low（Stage3 强制清零防线的必要性）；
 *      形状 B/C 信封 unrated 优先于规则3
 *   F. 图证在场不影响新桶（C114 豁免只挂 empty_content 臂）
 *   G. 源码口径：BLOCK_LABELS/BLOCK_SCOPE 空域/argmax 排除/pre-check
 *      no_public_info 'unrated'+情况B 'low' 不动/analyzer no_data 'unrated'/
 *      knowledge-feedback unrated∧毕业 false/getRatingMeta/lib RATING_SET
 *
 * 用法：node scripts/_test_background_insufficient_gate.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// impact 桶可注入；默认 none 放行形状（存量兼容基线）——抄 _test_event_trivial_gate
function baseAnswers(cat, impact) {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.72 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.97 } },
    bsc_meme_user_event_impact: impact ?? { choice: 'none', probabilities: { none: 0.9 } },
    bsc_meme_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.62, fit: 0.23 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.97 } },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.58, not_entity: 0.32 } },
    bsc_meme_user_phrase_acceptability: { choice: 'bsc_meme_user_acceptable', probabilities: { bsc_meme_user_acceptable: 0.72 } },
    token_name_quality: { score: 3, probabilities: {} },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
  };
}

function makeContext(extra = {}) {
  return {
    tokenData: { symbol: '1113', name: '极寒降临', raw_api_data: { name: '极寒降临' } },
    twitterInfo: { text: '1113', in_reply_to: null },
    includeBrandHijack: false,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

const stage2Of = (m) => m?.stage2DataToSave?.parsed_output || {};

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { resolveFinalRating, categoryToRating, getRatingMeta } = await import('../src/narrative/utils/rating-utils.mjs');
  const { _shouldCapture } = await import('../src/narrative/analyzer/knowledge/knowledge-feedback.mjs');
  const regLib = await import('../scripts/narrative/case-regression/lib.mjs');
  const qsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const pcSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/services/pre-check-service.mjs'), 'utf8');
  const anSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');

  console.log('\n── A. 题面（J1.158/C269 impact 题第四桶；J1.159/C269a DND 划界）──');
  check('A1 版本 = J1.159（C269a DND 划界排除锚③，题面-only mapper 零改动）', qm.JEV_QUESTIONS_VERSION === 'J1.159', qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const impQ = q.bsc_meme_user_event_impact;
  check('A2 impact 四桶（none/background_info_insufficient/event_empty_content/token_ip_reuse；加桶非加题）',
    ['none', 'background_info_insufficient', 'event_empty_content', 'token_ip_reuse'].every(k => impQ.criteria[k])
    && Object.keys(impQ.criteria).length === 4, Object.keys(impQ.criteria));
  const ins = impQ.instructions ?? '';
  const bg = impQ.criteria.background_info_insufficient ?? '';
  check('A3 instructions 三层优先序锚（背景层>事件层>代币层——理解不可能优先于一切质量判定）',
    ins.includes('background_info_insufficient = 背景层')
    && ins.includes('背景层 > 事件层 > 代币层')
    && ins.includes('票的根基是「没搞明白」，选 background_info_insufficient'),
    null);
  check('A4 主判据锚（全部在场证据综合看完仍无法建立「币名 ↔ 叙事内容」对应）',
    bg.includes('无法建立「币名 ↔ 叙事内容」的对应')
    && bg.includes('[TWITTER_SEARCH] 推特搜索事件背景段')
    && bg.includes('无宣告、无主体、无指认'), null);
  check('A5 1113 例证锚（C269 案发现场入题面防锚定漂移）',
    bg.includes('symbol「1113」name「极寒降临」')
    && bg.includes('巴西 Mercedes 1113 卡车梗/彩票数字'), null);
  check('A6 vs empty 划界锚（理解先于空洞判定：能确定在说什么但空洞→empty；连在说什么都无法确定→本桶）',
    bg.includes('vs event_empty_content，理解先于空洞判定')
    && bg.includes('能确定代币在说什么、但内容空洞无影响力')
    && bg.includes('连「在说什么」都无法确定 → 本项'), null);
  check('A7 vs ip_reuse 划界锚（知道蹭的是谁只是蹭得低质→ip_reuse；连是不是在蹭都确定不了→本桶）',
    bg.includes('vs token_ip_reuse')
    && bg.includes('知道蹭的是谁，只是蹭得低质')
    && bg.includes('连蹭的是什么、是不是在蹭都确定不了 → 本项'), null);
  check('A8 两排除锚（①纯零语料票不进本题=上游 fail-closed 另行处理；②信息足够得出任何具体判断→对应桶或 none）',
    bg.includes('纯零语料票')
    && bg.includes('无语料不进本题（上游 fail-closed 另行处理）')
    && bg.includes('本项只留给「认真看完所有证据仍然搞不明白」'), null);
  check('A9 J1.159/C269a DND 划界排除锚③（宣告推在场且携带主体内容载体→不选本桶走正常评估——「有信息但难懂」≠「没有信息」）',
    bg.includes('J1.159/C269a/DND 案裁定')
    && bg.includes('币安广场猫视频「DND 😾」形状')
    && bg.includes('宣告语料本身是内容载体、有可评估的事件本体')
    && bg.includes('本项只收「在场语料本身无内容可依」的票')
    && ins.includes('排除锚③'), null);

  console.log('\n── B. mapper 概率门 ≥0.5 → unrated ──');
  // 1113 现场形状：impact 新桶 0.6 + fit unfit 0.81 同 hit
  const mHit = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.6, none: 0.3 } }),
    makeContext());
  check('B1 llmResult rating=unrated / pass=null 刻意非 false / score=null / analysis_stage=3',
    mHit.llmResult.rating === 'unrated' && mHit.llmResult.pass === null
    && mHit.llmResult.score === null && mHit.llmResult.analysis_stage === 3,
    mHit.llmResult);
  check('B2 reason 含「无法理解」+桶 id+概率+「narrativeRating=9」（引擎可读终态文案）',
    (mHit.llmResult.reason || '').includes('无法理解')
    && mHit.llmResult.reason.includes('background_info_insufficient')
    && mHit.llmResult.reason.includes('60%≥50%')
    && mHit.llmResult.reason.includes('narrativeRating=9'),
    mHit.llmResult.reason);
  check('B3 stageFinalData category=unrated / blockReason=label / relevance·quality null（信息不足下是噪声）',
    mHit.stageFinalData.category === 'unrated'
    && mHit.stageFinalData.blockReason === '背景信息严重不足（无法理解叙事）'
    && mHit.stageFinalData.relevanceScore === null && mHit.stageFinalData.qualityScore === null
    && mHit.stageFinalData.totalScore === null,
    mHit.stageFinalData);
  check('B4 stage2 信封 pass=true（≠false——规则3 反证：任何信封 pass=false 都会被强转 low）',
    stage2Of(mHit).pass === true,
    stage2Of(mHit).pass);
  check('B5 stage2 审计键 backgroundInfoInsufficientMass=0.6 恒落',
    stage2Of(mHit).jev?.backgroundInfoInsufficientMass === 0.6,
    stage2Of(mHit).jev?.backgroundInfoInsufficientMass);
  const mUnfit = mapper.mapStandardAnswers(
    (() => {
      const a = baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.6, none: 0.3 } });
      a.bsc_meme_user_event_fit = { choice: 'unfit', probabilities: { unfit: 0.81, fit: 0.1 } };
      return a;
    })(),
    makeContext());
  check('B6 1113 现场形状（unfit 0.81 同 hit）→ 仍 unrated 非 low；w3Block 补算审计保留 web3UnfitMass=0.81',
    mUnfit.llmResult.rating === 'unrated' && mUnfit.llmResult.rating !== 'low'
    && stage2Of(mUnfit).jev?.web3UnfitMass === 0.81,
    { rating: mUnfit.llmResult.rating, unfitMass: stage2Of(mUnfit).jev?.web3UnfitMass });
  check('B7 Stage3 不 __clear（强制清零非跳过：relation 信封完整落库 pass=true）',
    !mHit.stage3DataToSave.__clear
    && mHit.stage3DataToSave?.parsed_output?.pass === true
    && mHit.stage3DataToSave?.parsed_output?.blockReason === null,
    mHit.stage3DataToSave);
  const mEdge = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.5, none: 0.4 } }),
    makeContext());
  check('B8 恰 0.5 边界 → unrated（≥0.5 含边界，web3UnfitBlock/emBlock 同款口径）',
    mEdge.llmResult.rating === 'unrated', mEdge.llmResult.rating);

  console.log('\n── C. <0.5 fail-open（C244 掷骰教训防线）──');
  const mDice = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.44, none: 0.4 } }),
    makeContext());
  check('C1 argmax=新桶但 0.44<0.5 掷骰段 → 不 unrated 也不拦（argmax 臂显式排除+概率门双保险）',
    mDice.llmResult.rating !== 'unrated'
    && stage2Of(mDice).blockReason == null
    && mDice.llmResult.rating !== 'low',
    { rating: mDice.llmResult.rating, block: stage2Of(mDice).blockReason });
  check('C2 0.44 概率审计照落（未过门票分布可追溯）',
    stage2Of(mDice).jev?.backgroundInfoInsufficientMass === 0.44,
    stage2Of(mDice).jev?.backgroundInfoInsufficientMass);
  const m49 = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.49, none: 0.4 } }),
    makeContext());
  check('C3 0.49 → 仍不触发（<0.5 fail-open 零翻转）',
    m49.llmResult.rating !== 'unrated', m49.llmResult.rating);
  // 旧缓存行形状：probabilities 无新桶键
  const mOld = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'none', probabilities: { none: 0.9 } }),
    makeContext());
  check('C4 旧缓存行缺桶 → 审计 null 断代不冒充 0（emptyContentMass 同款）',
    stage2Of(mOld).jev?.backgroundInfoInsufficientMass == null
    && mOld.llmResult.rating !== 'unrated',
    { mass: stage2Of(mOld).jev?.backgroundInfoInsufficientMass, rating: mOld.llmResult.rating });

  console.log('\n── D. 优先级（挂位=纯代码事实门之后、Jev 门之首）──');
  const mCP = mapper.mapStandardAnswers(
    (() => {
      const a = baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.55, none: 0.3 } });
      a.bsc_meme_user_event_fit = { choice: 'china_politics', probabilities: { china_politics: 0.9 } };
      return a;
    })(),
    makeContext());
  check('D1 bgInfo 0.55 + china_politics 0.9 → unrated（背景层先于政治线——bgInfo 臂在 cp 臂之前短路）',
    mCP.llmResult.rating === 'unrated' && mCP.llmResult.rating !== 'low', mCP.llmResult.rating);
  const mDedup = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.6, none: 0.3 } }),
    makeContext({ duplicateNarrative: { entryName: '牛来', entryId: 'b:niulai' } }));
  check('D2 bgInfo 0.6 + C168 蓝筹撞库 → low（纯代码事实门不依赖 Jev 理解，在前照拦）',
    mDedup.llmResult.rating === 'low'
    && (mDedup.llmResult.reason || '').includes('蓝筹去重'),
    mDedup.llmResult.rating);

  console.log('\n── E. 六信封端到端（pass=false 强转 low 坑的永久防线）──');
  const record = {
    event_result: { ...mHit.stage1DataToSave, rating: null },
    event_score_result: { ...mHit.stage2DataToSave, rating: null },
    relation_result: { ...mHit.stage3DataToSave, rating: null },
    final_result: { rating: mHit.stageFinalData.category, pass: true },
  };
  const fin = resolveFinalRating(record);
  check('E1 真实 mapper 输出组装六信封 → resolveFinalRating=unrated（规则1 在 final_result 接住）',
    fin === 'unrated', fin);
  check('E2 categoryToRating(unrated)=9（引擎 narrativeRating==9 消费链）',
    categoryToRating('unrated') === 9 && categoryToRating(null) === null, categoryToRating('unrated'));
  // 反证锁：若 Stage3 未强制清零（relation pass=false）→ 规则3 在 final 前强转 low——证明清零防线必要
  const recordBad = { ...record, relation_result: { rating: null, pass: false } };
  check('E3 反证锁：relation pass=false → low（规则3 先于 final 的规则1——Stage3 强制清零防线的必要性现场）',
    resolveFinalRating(recordBad) === 'low', resolveFinalRating(recordBad));
  check('E4 形状 B 信封：pre_check no_public_info unrated+pass=false → unrated（规则1 优先规则3）',
    resolveFinalRating({ pre_check_result: { rating: 'unrated', pass: false, details: { ruleName: 'no_public_info' } } }) === 'unrated',
    null);
  check('E5 形状 C 信封：no_data 兜底 unrated → unrated',
    resolveFinalRating({ pre_check_result: { rating: 'unrated', pass: false, reason: '没有可用的数据进行分析（所有推文/内容获取失败）——背景信息严重不足，无法理解叙事' } }) === 'unrated',
    null);

  console.log('\n── F. 图证在场不影响新桶 ──');
  const mImg = mapper.mapStandardAnswers(
    baseAnswers('E', { choice: 'background_info_insufficient', probabilities: { background_info_insufficient: 0.6, none: 0.3 } }),
    makeContext({ imageEvidence: { conclusion: '一张风景图' } }));
  check('F1 imageEvidence 在场 → 新桶照常 unrated（C114 图证豁免只挂 event_empty_content 臂，源码臂条件=blockChoice === \'event_empty_content\'）',
    mImg.llmResult.rating === 'unrated', mImg.llmResult.rating);

  console.log('\n── G. 源码口径（防复活/防漂移断言）──');
  check('G1 BLOCK_LABELS 新桶 label（背景信息严重不足（无法理解叙事））',
    mapperSrc.includes("background_info_insufficient: '背景信息严重不足（无法理解叙事）'"), null);
  check('G2 BLOCK_SCOPE 显式空域（blockInScope 对未知桶按 all 全域拦——空域是双保险之一）',
    /BLOCK_SCOPE[^;]*;?[\s\S]{0,400}background_info_insufficient: \[\],/.test(mapperSrc)
    || mapperSrc.includes('background_info_insufficient: [],'), null);
  check('G3 argmax 臂显式排除（第二道防线：掷骰段 choice=新桶不拦）',
    mapperSrc.includes("blockChoice !== 'background_info_insufficient'"), null);
  check("G4 pre-check 规则4 情况A no_public_info → 'unrated'（情况B public_info_fetch_failed 刻意保持 low——技术失败形状不动）",
    pcSrc.includes("buildPreCheckResult('unrated', reason, 'no_public_info'")
    && pcSrc.includes("buildPreCheckResult('low', '有公开信息链接但内容获取失败或已失效（推文删除、网站无法访问、视频下架等），叙事价值已耗尽', 'public_info_fetch_failed'"),
    null);
  check('G5 analyzer no_data 兜底 → unrated + reason 含背景信息严重不足',
    anSrc.includes("rating: 'unrated',\n            reason: '没有可用的数据进行分析（所有推文/内容获取失败）——背景信息严重不足，无法理解叙事'")
    || (anSrc.includes('返回unrated（无法理解，C269）') && anSrc.includes('——背景信息严重不足，无法理解叙事')),
    null);
  const fbCfg = { captureRatings: ['high'], graduatedAlso: true };
  check('G6 knowledge-feedback：unrated∧毕业 → false（收紧防「本系统评 unrated」噪声入 quasi-feedback）；low 毕业照 false、mid 毕业照 true（旧域 bit 一致）',
    _shouldCapture({ address: '0xabc0000000000000000000000000000000000abc', rating: 'unrated' }, fbCfg, true) === false
    && _shouldCapture({ address: '0xabc0000000000000000000000000000000000abc', rating: 'low' }, fbCfg, true) === false
    && _shouldCapture({ address: '0xabc0000000000000000000000000000000000abc', rating: 'mid' }, fbCfg, true) === true,
    null);
  check('G7 getRatingMeta(9).label=未评级/无法理解（前端渲染语义同步）',
    getRatingMeta(9).label === '未评级/无法理解', getRatingMeta(9).label);
  check('G8 回归工具 RATING_SET 含 unrated（expect.rating=unrated 可断言）',
    regLib.assertExpectation({ rating: 'unrated' }, { rating: 'unrated' }).failures.length === 0
    && regLib.assertExpectation({ rating: 'unrated' }, { rating: 'low' }).failures.length > 0,
    null);

  console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
