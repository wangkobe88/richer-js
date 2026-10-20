#!/usr/bin/env node
/**
 * C97 币安地域子账号量级锚单测（mapper-only，题集版本不动——J1.16/J1.23
 * 「题面锚移不动 Jev 的分」家族的代码切分先例）——本地零 DB 零网络单测
 * （2026-10-18 用户裁定「币安的地域账号，所发布的局部地域的事件，也不要
 * 被视为超级IP事件」）
 *
 * 案发（0xf37bbaea289a67af00ac0ee58421553e11987777「币安游戏」）：主推
 * @BinanceArabic ✓（币安阿拉伯地域子账号，17.99 万粉）发「想象币安要办电视
 * 问答节目，帮节目起个名」——零赞零转假设性互动推，token 名即起名梗参赛。
 * J1.36 判 D 类 0.84 + A 档 34 分借壳母机构量级；no_visual 0.98 载体门被
 * C88 五腿豁免（superIp 0.55/mem 2.39/relPositive 0.8/within_7d/
 * strongFit 0.73 全中）→ 74.45 high 放行。
 *
 * 机制：主推作者 handle 以 binance 开头且非全球号（GLOBAL_BINANCE_HANDLES）
 * ∧ binanceCorpus（币名/语料借币安）→ effTier 锚 D（量级不足阻断档）。
 * 量级门 D/E 臂无 recognizedEntitySlogan 豁免 → 本锚是五腿全中形状的唯一拦截位。
 * 锚降优先于 pubProxy/web3Fit 两锚升。
 *
 * 覆盖：
 *   A. 检测真值表（handle 形状：地域号/全球号/职能臂/非 binance 前缀/缺失）
 *   B. 锚效果与对照（@binance/@cz_binance/@BinanceLabs/无借壳语料全不锚）
 *   C. 事故现场反证（币安游戏全值快照：五腿 hit 仍拦=唯一拦截位；
 *      同形状换 @cz_binance 源 pass=true=锚必要性正证）
 *   D. 锚互斥（regional 先手 web3FitAnchoredTier：A 类 D 档原判+strong_fit≥0.5
 *      本应锚 B 翻案，regional 锚赢仍拦）
 *   E. 审计字段（regionalSubAccount 命中才落/jevImpactTier 保留原判/label）
 *   F. 源码口径（effTier 三元链/全球号集合/只查主推不查父推/label 模板）
 *
 * 用法：node scripts/_test_jev_regional_binance_anchor.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const ANCHOR_LABEL = '币安地域子账号不借壳';

/**
 * 事故快照形状（token_narrative J1.36 行实测值）：D 类 0.84 / A 档（34 分）/
 * super_ip 0.55 / mem 2.39 / strong_fit 0.73 / no_visual 0.98 / company 0.53 /
 * exact 0.24+semantic 0.49+none 0.14 / within_7d / event_baseless_speculation 0.3
 * （G 类域 choice，D 类不拦）。五腿全中：recognizedEntitySlogan hit=true。
 */
function gameShowAnswers() {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.84, G: 0.1, B: 0.02 } },
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.89 } },
    dimension2: { score: 25, probabilities: { '3': 0.37, '4': 0.27, '5': 0.25 } },
    event_token_block_reason: { choice: 'event_baseless_speculation', probabilities: { event_baseless_speculation: 0.3, none: 0.24, event_marketing_gimmick: 0.28, event_institution_routine: 0.12, event_routine_content_product: 0.05 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.55, unknown: 0.35 } },
    name_entity_memeability: { score: 2.39, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.73, fit: 0.17, marginal: 0.09 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.98, improvised_entity: 0.01, existing_entity: 0.01 } },
    event_subject_entity: { choice: 'company', probabilities: { company: 0.53, product_functional: 0.27, event_hotspot: 0.17 } },
    name_event_relevance: { choice: 'semantic', probabilities: { semantic: 0.49, exact_match: 0.24, none: 0.14, generic_concept: 0.06, translation_match: 0.05 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.11 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    name_form: { choice: 'entity_phrase', probabilities: { entity_phrase: 0.9 } },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.6 } },
  };
}

const gameShowCtx = (twitterInfo) => ({
  tokenData: { symbol: '币安游戏', name: '币安游戏', raw_api_data: { name: '币安游戏' } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

const AR_TWITTER = {
  author_screen_name: 'BinanceArabic',
  author_followers_count: 179946,
  author_verified: true,
  text: 'تخيل أن بينانس ستطلق برنامج مسابقات تلفزيوني',
};

function blockedByAnchor(r) {
  return r.llmResult.rating === 'low'
    && (r.llmResult.reason || '').includes(ANCHOR_LABEL)
    && (r.llmResult.reason || '').includes('量级不足');
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  // ═══ A. 检测真值表（行为级：audit regionalSubAccount 命中形状）═══
  console.log('\n── A. 检测真值表（handle 形状）──');
  const detectArms = [
    // [handle, 预期命中, 说明]
    ['BinanceArabic', true, '地域号（本案）'],
    ['binance_africa', true, '下划线地域号'],
    ['BinanceTurkiye', true, '混大小写地域号（归一化）'],
    ['binance', false, '全球主号'],
    ['BinanceLabs', false, '全球职能臂 Labs'],
    ['binanceresearch', false, '全球职能臂 Research'],
    ['binancesquare', false, '全球职能臂 Square'],
    ['cz_binance', false, '非 binance 前缀（大V 谈币安）'],
    ['binancefan123', true, '冒充号/粉丝号一并命中（fail-safe 偏拦）'],
  ];
  for (const [handle, shouldHit, note] of detectArms) {
    const r = mapStandardAnswers(gameShowAnswers(), gameShowCtx({
      author_screen_name: handle, author_followers_count: 100000, text: 'imagine binance show',
    }));
    const hit = r.stage1DataToSave.parsed_output.jev.regionalSubAccount != null;
    check(`A ${note} → ${shouldHit ? '锚' : '不锚'}`, hit === shouldHit,
      r.stage1DataToSave.parsed_output.jev.regionalSubAccount);
  }
  // A10 主推作者缺失（旧缓存形状/handle 缺失）→ fail-open 不锚
  const rA10 = mapStandardAnswers(gameShowAnswers(), gameShowCtx({ text: 'imagine binance show' }));
  check('A10 主推作者缺失 → 不锚 fail-open',
    rA10.stage1DataToSave.parsed_output.jev.regionalSubAccount === null
    && rA10.llmResult.pass === true, rA10.llmResult.reason);

  // ═══ B. 锚效果与对照 ═══
  console.log('\n── B. 锚效果与对照（四对照臂全不锚）──');
  const rB1 = mapStandardAnswers(gameShowAnswers(), gameShowCtx(AR_TWITTER));
  check('B1 @BinanceArabic+币安游戏名 → 拦（A档→D档 锚）', blockedByAnchor(rB1), rB1.llmResult.reason);
  const rB2 = mapStandardAnswers(gameShowAnswers(), gameShowCtx({
    author_screen_name: 'binance', author_followers_count: 14000000, author_verified: true,
    text: 'imagine binance show',
  }));
  check('B2 对照 @binance 全球主号 → 不锚（五腿豁载体门+A 档照过）',
    rB2.llmResult.pass === true && rB2.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true,
    { pass: rB2.llmResult.pass, reason: rB2.llmResult.reason });
  const rB3 = mapStandardAnswers(gameShowAnswers(), gameShowCtx({
    author_screen_name: 'cz_binance', author_followers_count: 12990000, author_verified: true,
    text: 'imagine binance show',
  }));
  check('B3 对照 @cz_binance 大V 谈币安 → 不锚（非 binance 前缀，量级按事件自身评）',
    rB3.llmResult.pass === true, rB3.llmResult.reason);
  const rB4 = mapStandardAnswers(gameShowAnswers(), gameShowCtx({
    author_screen_name: 'BinanceArabic', author_followers_count: 179946,
    text: 'just a game show tweet',
    tokenData: undefined,
  }));
  // token 名不含币安+推文不含 binance → binanceCorpus null → 不锚
  const noCorpusCtx = {
    tokenData: { symbol: 'TST', name: 'TST', raw_api_data: { name: 'TST' } },
    includeBrandHijack: false, tweetClassification: null,
    twitterInfo: { author_screen_name: 'BinanceArabic', author_followers_count: 179946, text: 'just a show tweet' },
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
  const rB4b = mapStandardAnswers(gameShowAnswers(), noCorpusCtx);
  check('B4 对照 无借壳语料（名/推文均不含币安）→ 不锚（锚的是借壳形状非账号本身）',
    rB4b.stage1DataToSave.parsed_output.jev.regionalSubAccount === null && rB4b.llmResult.pass === true,
    rB4b.llmResult.reason);

  // ═══ C. 事故现场反证 ═══
  console.log('\n── C. 事故现场反证（币安游戏 0xf37b…7777 J1.36 快照全值）──');
  check('C1 五腿全中（recognizedEntitySlogan hit）仍拦——D/E 臂无五腿豁免=唯一拦截位',
    blockedByAnchor(rB1) && rB1.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true,
    rB1.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan);
  check('C2 拦截时 no_visual 0.98 载体门已被五腿豁出（subjectCarrierBlock=null）——锚非载体门',
    rB1.stage2DataToSave.parsed_output.jev.subjectCarrierBlock === null, null);
  check('C3 label 形状：量级不足（A档→D档·币安地域子账号不借壳）——原判档可追溯',
    (rB1.llmResult.reason || '').includes('A档→D档'), rB1.llmResult.reason);
  check('C4 jevImpactTier 保留 Jev 原判 A（不受锚影响）',
    rB1.stage1DataToSave.parsed_output.jev.jevImpactTier === 'A', rB1.stage1DataToSave.parsed_output.jev.jevImpactTier);

  // ═══ D. 锚互斥（regional 先手锚升）═══
  console.log('\n── D. 锚互斥（锚降优先于 pubProxy/web3Fit 锚升）──');
  // D1 web3FitAnchoredTier 臂：A 类+D 档原判+strong_fit 0.9 本应锚 B 翻案 → regional 赢仍拦
  const aClassD = gameShowAnswers();
  aClassD.event_category = { choice: 'A', probabilities: { A: 0.8 } };
  aClassD.event_magnitude = { score: 1.4, probabilities: { '1': 0.7 } }; // D 档
  aClassD.web3_user_event_fit = { choice: 'strong_fit', probabilities: { strong_fit: 0.9, fit: 0.05 } };
  aClassD.name_entity_memeability = { score: 2.5, probabilities: {} };
  const rD1 = mapStandardAnswers(aClassD, gameShowCtx(AR_TWITTER));
  check('D1 A 类 D 档原判+strong_fit 0.9（本应 web3Fit 锚 B）→ regional 锚赢仍拦',
    blockedByAnchor(rD1), rD1.llmResult.reason);
  // D1b 对照：同形状 @cz_binance → web3FitAnchoredTier 翻案 B 档放行
  const rD1b = mapStandardAnswers(aClassD, gameShowCtx({
    author_screen_name: 'cz_binance', author_followers_count: 12990000, text: 'imagine binance show',
  }));
  check('D1b 对照 同形状非 binance 源 → web3Fit 锚 B 翻案放行（锚降只作用于地域子账号）',
    rD1b.llmResult.pass === true, rD1b.llmResult.reason);

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计字段（命中才落/handle+粉丝数可追溯）──');
  const audit = rB1.stage1DataToSave.parsed_output.jev.regionalSubAccount;
  check('E1 命中：regionalSubAccount={handle:binancearabic, followers:179946}',
    audit && audit.handle === 'binancearabic' && audit.followers === 179946, audit);
  check('E2 未命中臂=null（B2 全球号）',
    rB2.stage1DataToSave.parsed_output.jev.regionalSubAccount === null, null);

  // ═══ F. 源码口径 ═══
  console.log('\n── F. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('F1 effTier 三元链：regionalAnchorActive 先手（锚降 > pubProxy 锚A > web3Fit 锚B > 原判）',
    mapperSrc.includes("const effTier = regionalAnchorActive ? 'D' : (tierAnchored ? 'A' : (web3FitAnchored ? 'B' : tier));"), null);
  check('F2 全球号集合四键（主号+Labs/Research/Square）',
    /GLOBAL_BINANCE_HANDLES = new Set\(\['binance', 'binancelabs', 'binanceresearch', 'binancesquare'\]\)/.test(mapperSrc), null);
  check('F3 检测只查主推作者（author_screen_name || screen_name，无 in_reply_to）',
    /function detectBinanceRegionalAccount\(twitterInfo\) \{\s*\n\s*const h = String\(twitterInfo\?\.author_screen_name \|\| twitterInfo\?\.screen_name[^)]*\)/.test(mapperSrc), null);
  check('F4 锚激活=地域号 ∧ binanceCorpus 双条件',
    mapperSrc.includes('const regionalAnchorActive = !!(binanceRegional && binanceCorpus);'), null);
  check('F5 label 模板带原判档（${tier}档→D档·币安地域子账号不借壳）',
    mapperSrc.includes("事件主体量级不足（${tier}档${regionalAnchorActive ? '→D档·币安地域子账号不借壳' : ''}）"), null);
  // F6 行为级：父推是地域号、主推不是 → 不锚（BOB 案先例：主体判定以主推作者为准）
  const rF6 = mapStandardAnswers(gameShowAnswers(), gameShowCtx({
    author_screen_name: 'someone123', author_followers_count: 50,
    in_reply_to: { author_screen_name: 'BinanceArabic', author_followers_count: 179946 },
    text: 'imagine binance show',
  }));
  check('F6 父推地域号+主推路人号 → 不锚（只查主推作者）',
    rF6.stage1DataToSave.parsed_output.jev.regionalSubAccount === null && rF6.llmResult.pass === true,
    rF6.llmResult.reason);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_regional_binance_anchor: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
