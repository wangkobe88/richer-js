#!/usr/bin/env node
/**
 * 产品实体接纳门（J1.27/C55 华为麒麟案族）——本地零 DB 零网络单测
 *
 * 覆盖：
 *   A. 题面完整性：J1.27 版本 / 15 题含 subject_entity / 三题形状③追加
 *   B. productEntityAcceptanceBlock 纯函数矩阵：se 标注 × 接纳度阈值边界 ×
 *      三豁免（pubProxyActive / isW / rideMass）× 非 product 标不拦 × 旧答案无标注不拦
 *   C. mapStandardAnswers 集成：麒麟形状③实测答案（J1.27 wording 实验轮2 数值）
 *      + se=product_functional → 拦（blockReason/审计字段）；同答案 se=character_ip
 *      不拦（拦截全由 se 标注驱动）；fitMass 过线放行；旧答案零行为变化
 *   D. 源码口径：挂点顺序（w3Block 后 block_reason 前）+ 豁免五条件接线 + C56 三处豁免位
 *   F. C56 平台官方源豁免（flap 裁定「flap 是币安链的 meme 币发布平台…跟币安链一个道理」）：
 *      FlapGuy 复验实测形状——argmax 机构日常运营豁免（实际拦截位）/ rcp 概率门豁免 /
 *      产品实体门豁免 / handle 硬集矩阵（大小写归一·单词不中·account 型双字段）/
 *      BOB 路人号反例照拦 / superIP 通道不传 opts
 *
 * 用法：node scripts/_test_jev_product_entity.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 麒麟案（0x967e4a528c264529fe8d6d9773665a6357787777）J1.27 形状③题面实测答案
//    （2026-10-03 wording 实验轮 2：mag 4.58→2.97、dim2 4.66→3.82、fit sf44→sf14/mg62）──
const qilinTokenData = { symbol: '麒麟', name: '麒麟', raw_api_data: { name: '麒麟' } };
const qilinAnswers = {
  event_category: { choice: 'D', probabilities: { D: 0.69, B: 0.17, A: 0.09, W: 0.05 } },
  event_magnitude: { score: 2.97, probabilities: { '3': 0.55, '4': 0.20, '5': 0.20 } },
  event_timing: { choice: 'within_7d', probabilities: { within_7d: 1 } },
  dimension2: { score: 3.82, probabilities: { '4': 0.57, '5': 0.30 } },
  block_reason: { choice: 'none', probabilities: { none: 0.9, routine_content_product: 0.06 } },
  web3_fit: { choice: 'marginal', probabilities: { strong_fit: 0.14, fit: 0.05, marginal: 0.62, unfit: 0.19 } },
  name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.8, notable_other: 0.09, subject_self: 0.07 } },
  relevance_type: { choice: 'translation_match', probabilities: { translation_match: 0.51, exact_match: 0.45 } },
  relevance_level: { score: 3.46, probabilities: { '4': 0.69, '3': 0.19 } },
  block_misspelling: { noul: 0.1 },
  quality_spelling: { score: 2.82 },
  quality_reasonability: { score: 1.96 },
  subject_entity: { choice: 'product_functional', probabilities: { product_functional: 0.86, company: 0.09, product_character: 0.05 } },
};

function makeContext(tokenData, answers) {
  return {
    tokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. 题面完整性 ──');
  check('A1 版本 bump 到 J1.27', qm.JEV_QUESTIONS_VERSION === 'J1.27', qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  check('A2 题集 15 题含 subject_entity', Object.keys(q).length === 15 && !!q.subject_entity, Object.keys(q).length);
  check('A3 event_magnitude 含形状③（母公司不转移+两条路）',
    q.event_magnitude.instructions.includes('形状③ 产品实体') && q.event_magnitude.instructions.includes('不转移不计入') && q.event_magnitude.instructions.includes('两条都不占→C档以下'));
  check('A3b 形状③收窄锚（校准修订：仅产品实体主体适用+非全域收紧反向锚）',
    q.event_magnitude.instructions.includes('当且仅当事件主体确为公司/机构发布的产品实体')
    && q.event_magnitude.instructions.includes('不是全域收紧')
    && q.dimension2.instructions.includes('仅产品实体主体适用')
    && q.dimension2.instructions.includes('按上述各类别原有口径正常评分'));
  check('A3c event_category D/W 边界句（币安机构官宣自家产品→D 不判 W）',
    q.event_category.instructions.includes('D vs W boundary')
    && q.event_category.instructions.includes('NOT W')
    && q.event_magnitude.instructions.includes('事件类别按机构公告口径评估不判W'));
  check('A4 dimension2 含形状③（通稿不算自传播）',
    q.dimension2.instructions.includes('形状③ 产品实体') && q.dimension2.instructions.includes('媒体通稿覆盖量不计入'));
  check('A5 web3_fit 含产品实体边界（纯功能产品不高于 marginal）',
    q.web3_fit.instructions.includes('公司产品实体') && q.web3_fit.instructions.includes('不高于marginal'));
  const seKeys = Object.keys(q.subject_entity.criteria);
  check('A6 subject_entity 8 档（company/product_functional/product_character/character_ip/person/event_hotspot/meme_word/none_of_above）',
    seKeys.length === 8 && ['company', 'product_functional', 'product_character', 'character_ip', 'person', 'event_hotspot', 'meme_word', 'none_of_above'].every(k => seKeys.includes(k)), seKeys);
  check('A7 subject_entity 题面含公司/产品区分锚', q.subject_entity.instructions.includes('区分「公司本身」与「公司发布的产品」'));

  console.log('\n── B. 封装边界 ──');
  // productEntityAcceptanceBlock 为 mapper 私有函数（项目惯例只导出 map*Answers），
  // 门矩阵经 C 段 mapStandardAnswers 集成覆盖
  check('B1 productEntityAcceptanceBlock 不导出（私有封装，门矩阵经 C 段集成）',
    mapper.productEntityAcceptanceBlock === undefined && mapper.__productEntityAcceptanceBlock === undefined);

  console.log('\n── C. mapStandardAnswers 集成（麒麟形状③实测答案）──');
  // C1 基线：无 subject_entity 标注（J1.26 旧答案形状）——数学照旧、无门拦截（零行为变化锚）
  const oldAnswers = { ...qilinAnswers };
  delete oldAnswers.subject_entity;
  const rOld = mapper.mapStandardAnswers(oldAnswers, makeContext(qilinTokenData, oldAnswers));
  check('C1 旧答案（无 subject_entity）不触发产品门（blockReason 不含 J1.27 label / 审计为 null）',
    !(rOld.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳')
    && rOld.stage2DataToSave?.parsed_output?.jev?.productEntityBlock == null,
    rOld.stage2DataToSave?.parsed_output?.blockReason);

  // C2 麒麟形状③ + se=product_functional → 门拦截
  const rBlocked = mapper.mapStandardAnswers(qilinAnswers, makeContext(qilinTokenData, qilinAnswers));
  const blk = rBlocked.stage2DataToSave?.parsed_output?.blockReason || '';
  check('C2 麒麟 + se=product_functional → low + blockReason 命中产品实体门',
    rBlocked.llmResult.rating === 'low' && blk.includes('产品实体未被web3买家接纳(J1.27)') && blk.includes('功能产品'), { rating: rBlocked.llmResult.rating, blk });
  check('C2b blockReason 带接纳度数值（19%<50%）', blk.includes('19%'), blk);
  const audit = rBlocked.stage2DataToSave?.parsed_output?.jev?.productEntityBlock;
  check('C2c 审计字段 productEntityBlock={subject, fitMass}',
    audit && audit.subject === 'product_functional' && audit.fitMass === 0.19, audit);
  check('C2d 审计字段 subjectEntity 落库 + probabilities.subject_entity 落库',
    rBlocked.stage2DataToSave?.parsed_output?.jev?.subjectEntity === 'product_functional'
    && rBlocked.stage2DataToSave?.parsed_output?.jev?.probabilities?.subject_entity?.product_functional === 0.86);

  // C3 同答案 se=character_ip → 门不拦（拦截全由 se 标注驱动，character_ip 有独立形象语义）
  const seChar = { ...qilinAnswers, subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.8, product_character: 0.15 } } };
  const rChar = mapper.mapStandardAnswers(seChar, makeContext(qilinTokenData, seChar));
  check('C3 se=character_ip 不触发产品门（走原数学）',
    !(rChar.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳')
    && rChar.stage2DataToSave?.parsed_output?.jev?.productEntityBlock == null,
    rChar.stage2DataToSave?.parsed_output?.blockReason);

  // C4 同答案 se=product_character（公司产品形象）→ 同拦（两档同门）
  const sePc = { ...qilinAnswers, subject_entity: { choice: 'product_character', probabilities: { product_character: 0.7, character_ip: 0.2 } } };
  const rPc = mapper.mapStandardAnswers(sePc, makeContext(qilinTokenData, sePc));
  check('C4 se=product_character 同拦（label 标「产品形象」）',
    (rPc.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳') && (rPc.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品形象'),
    rPc.stage2DataToSave?.parsed_output?.blockReason);

  // C5 接纳度过线：sf50 恰好 ≥0.5 → 门放行（两条路统一底线）
  const fitPass = { ...qilinAnswers, web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.5, fit: 0.1, marginal: 0.35, unfit: 0.05 } } };
  const rPass = mapper.mapStandardAnswers(fitPass, makeContext(qilinTokenData, fitPass));
  check('C5 sf+fit=60% 过线放行（不被产品门拦）',
    !(rPass.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳'),
    rPass.stage2DataToSave?.parsed_output?.blockReason);

  // C6 W 类豁免：cat=W（原生 W）不触门（W 数学独立计分）
  const seW = { ...qilinAnswers, event_category: { choice: 'W', probabilities: { W: 0.8, D: 0.15 } },
    w_product_score: { score: 25, probabilities: { '2': 0.6, '3': 0.3 } },
    w_binance_interaction: { score: 22, probabilities: { '2': 0.7 } } };
  const rW = mapper.mapStandardAnswers(seW, makeContext(qilinTokenData, seW));
  check('C6 cat=W 豁免（W 数学不消费产品门）',
    !(rW.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳'),
    rW.stage2DataToSave?.parsed_output?.blockReason);

  // C7 unfit 负门优先级：unfit≥0.5 的产品票先被 web3FitBlock 拦（label 归属更准）
  const unfitAnswers = { ...qilinAnswers, web3_fit: { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2, strong_fit: 0.1, fit: 0.08 } } };
  const rUnfit = mapper.mapStandardAnswers(unfitAnswers, makeContext(qilinTokenData, unfitAnswers));
  check('C7 unfit≥0.5 票先被 web3_fit 负门拦（非产品门 label）',
    (rUnfit.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户偏好不合'), rUnfit.stage2DataToSave?.parsed_output?.blockReason);

  // C8 币安豁免（C55 补充裁定「要豁免币安」）：同麒麟形状答案（19% 接纳度本应拦）
  //    + 代币名含「币安」→ 门不拦 + 审计 productEntityBinanceExempt=true
  const bzTokenData = { symbol: '币安支付', name: '币安支付', raw_api_data: { name: '币安支付' } };
  const rBz = mapper.mapStandardAnswers(qilinAnswers, makeContext(bzTokenData, qilinAnswers));
  check('C8 币安语料（代币名）豁免——19% 接纳度不拦（C35 币安支付形状）',
    !(rBz.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳')
    && rBz.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt === true,
    { blk: rBz.stage2DataToSave?.parsed_output?.blockReason, audit: rBz.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt });

  // C8b 币安词在父推（in_reply_to.text）同样豁免（C40 BI 骑乘形状：主推英文、父推 @binance）
  const rBz2 = mapper.mapStandardAnswers(qilinAnswers, {
    ...makeContext(qilinTokenData, qilinAnswers),
    twitterInfo: { text: 'BI is coming', in_reply_to: { text: '@binance announces Binance Intelligence event' } },
  });
  check('C8b 币安词在父推豁免（C40 BI 骑乘形状）',
    !(rBz2.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳')
    && rBz2.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt === true);

  // C8c 非币安票不落豁免审计（麒麟 C2 对照——华为语料零豁免键）
  check('C8c 非币安票不落 productEntityBinanceExempt（对照 C2 麒麟）',
    rBlocked.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null);

  // C8d 币安语料但门本不会拦（sf 过线）→ 不落豁免审计（无救票形状）
  const rBz3 = mapper.mapStandardAnswers(fitPass, makeContext(bzTokenData, fitPass));
  check('C8d 币安语料+fitMass 过线 → 不落豁免审计（豁免未改变判定）',
    rBz3.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null);

  console.log('\n── D. 源码口径（挂点/豁免接线）──');
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const idxW3 = src.indexOf('} else if ((w3Block = web3FitBlock(answers))) {');
  const idxPe = src.indexOf('} else if ((peBlock = productEntityAcceptanceBlock(answers,');
  const idxBr = src.indexOf('} else if (blockChoice !== \'none\' && noneProb < 0.5');
  check('D1 挂点顺序：w3Block → 产品门 → block_reason argmax', idxW3 > 0 && idxPe > idxW3 && idxBr > idxPe, { idxW3, idxPe, idxBr });
  check('D2 豁免五条件接线（pubProxyActive / isW / rideMass / binanceCorpus / platformOfficial）',
    src.includes('opts.pubProxyActive || opts.isW || opts.rideMass != null')
    && src.includes('if (opts.binanceCorpus || opts.platformOfficial) return null;')
    && src.includes('binanceCorpus, platformOfficial }))) {'));
  check('D2b C56 平台官方源豁免三处接线（rcp 门 opts / argmax 子句 / detectPlatformOfficial 双字段 + 审计落库）',
    src.includes('routineContentProductBlock(answers, category, { platformOfficial })')
    && src.includes("&& !(platformOfficial && (blockChoice === 'institution_routine' || blockChoice === 'routine_content_product'))")
    && src.includes('const platformOfficial = detectPlatformOfficial(twitterInfo);')
    && src.includes('rcpPlatformExempt,')
    && src.includes('twitterInfo?.author_screen_name || twitterInfo?.screen_name'));
  check('D2c superIP 通道不传 opts（C23 域语义不变，币安官方号走注册表快车道本就豁免）',
    src.includes('const rcpBlock = routineContentProductBlock(answers);'));
  check('D3 阈值 0.5 与 unfit 负门/strong_fit 正门同线', src.includes('const fitMass = (p.strong_fit ?? 0) + (p.fit ?? 0);') && src.includes('if (fitMass >= 0.5) return null;'));
  check('D3b detectBinanceCorpus 关键词与语料源（binance/币安 × 主推+父推+代币名）',
    src.includes("const BINANCE_KEYWORDS = ['binance', '币安'];") && src.includes('twitterInfo?.in_reply_to?.text'));
  const qSrc = fs.readFileSync(require('path').join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  check('D4 版本头条目含 C55 案号与裁定语义', qSrc.includes('J1.27') && qSrc.includes('C55') && qSrc.includes('产品（实体）'));
  check('D5 题面三处币安豁免句（magnitude/dim2/fit）',
    q.event_magnitude.instructions.includes('豁免币安等 crypto 原生机构')
    && q.dimension2.instructions.includes('币安等 crypto 原生机构的产品不切分')
    && q.web3_fit.instructions.includes('币安等 crypto 原生机构（交易所/公链/Web3 平台）的产品不在此列'));

  console.log('\n── F. C56 平台官方源豁免（FlapGuy 0x2fb77ad0…7777 复验实测形状）──');
  // FlapGuy 双轮复验（J1.27，182 真实 Jev 调用）：cat=D、mag 3.04-3.08（round→B 档，
  // P3 0.75-0.79 稳定）、dim2 3.01-3.05、se=character_ip、nr subject_self 0.6-0.72
  // （minor+common 0.13 恒 <0.5）、block argmax=institution_routine（0.55 / none 0.30
  // / rcp 仅 0.10）——实际拦截点在 argmax 位而非 rcp 概率门，豁免必须三处齐备
  const flapTokenData = { symbol: 'FlapGuy', name: 'FlapGuy', raw_api_data: { name: 'FlapGuy' } };
  const flapAnswers = {
    event_category: { choice: 'D', probabilities: { D: 0.62, W: 0.21, C: 0.12 } },
    event_magnitude: { score: 3.05, probabilities: { '3': 0.76, '4': 0.16 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 3.02, probabilities: { '4': 0.5, '5': 0.3 } },
    block_reason: { choice: 'institution_routine', probabilities: { institution_routine: 0.55, none: 0.3, routine_content_product: 0.1, marketing_gimmick: 0.05 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.55, fit: 0.25, marginal: 0.15, unfit: 0.05 } },
    name_referent: { choice: 'subject_self', probabilities: { subject_self: 0.7, minor_other: 0.07, common_word: 0.06, notable_other: 0.13, super_ip: 0.01, none_related: 0.03 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.88 } },
    relevance_level: { score: 4.2, probabilities: { '4': 0.7, '5': 0.2 } },
    block_misspelling: { noul: 0.05 },
    quality_spelling: { score: 3.1 },
    quality_reasonability: { score: 2.2 },
    subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.8, product_character: 0.15 } },
  };
  const flapTw = (handle) => ({ type: 'tweet', text: 'Flap mode 🍌', author_screen_name: handle, author_followers_count: 99800 });
  const flapCtx = (answers, twitterInfo) => ({ ...makeContext(flapTokenData, answers), twitterInfo });

  // F1 主线：官方源 → argmax 机构日常运营豁免 → 事件分过线 high（数值全推演锚定）
  const rF1 = mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, flapTw('flapdotsh')));
  check('F1 flapdotsh 官方源 → argmax 机构日常运营豁免 + 审计 rcpPlatformExempt=true',
    rF1.llmResult.rating === 'high'
    && !(rF1.stage2DataToSave?.parsed_output?.blockReason || '').includes('机构日常运营')
    && rF1.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt === true,
    { rating: rF1.llmResult.rating, blk: rF1.stage2DataToSave?.parsed_output?.blockReason });
  check('F1b 数值锚定：27(B档)+23.1(dim2)+15(时效)=65.1 过线 → 总分 77.36（20+18.3）',
    rF1.stageFinalData.stage2TotalScore === 65.1 && rF1.stageFinalData.totalScore === 77.36,
    { s2: rF1.stageFinalData.stage2TotalScore, total: rF1.stageFinalData.totalScore });

  // F1c 对照：路人号（BOB 0xf2fca4cf…7777 主推 @zhangxuanhui，228 粉玩 CZ 香蕉梗）
  //      同答案形状照拦——非官方源不豁免
  const rF1c = mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, flapTw('zhangxuanhui')));
  check('F1c 路人号同形状照拦「机构日常运营」+ 审计不落（BOB 反例口径）',
    rF1c.llmResult.rating === 'low'
    && (rF1c.stage2DataToSave?.parsed_output?.blockReason || '').includes('机构日常运营')
    && rF1c.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt == null,
    { rating: rF1c.llmResult.rating, blk: rF1c.stage2DataToSave?.parsed_output?.blockReason });

  // F2 handle 矩阵：大小写归一命中 / 单词 flap·变体·空不命中 / account 型 screen_name 命中
  const exemptOf = (tw) => mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, tw))
    .stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt;
  check('F2 handle 矩阵（FlapDotSh/binance 命中；flap 单词/flapdotsh_alt/空/父推不命中）',
    exemptOf(flapTw('FlapDotSh')) === true && exemptOf(flapTw('binance')) === true
    && exemptOf(flapTw('flap')) == null && exemptOf(flapTw('flapdotsh_alt')) == null && exemptOf(flapTw('')) == null,
    { binance: exemptOf(flapTw('binance')), flapWord: exemptOf(flapTw('flap')) });
  check('F2b account 型语料（token 自挂官方账号链接）screen_name 双字段命中',
    exemptOf({ type: 'account', screen_name: 'flapdotsh' }) === true);

  // F3 rcp 概率门形状：官方源 → 概率门（routineContentProductBlock opts）+ argmax 双豁免
  const rcpShape = { ...flapAnswers, block_reason: { choice: 'routine_content_product', probabilities: { routine_content_product: 0.62, none: 0.25, institution_routine: 0.1 } } };
  const rF3 = mapper.mapStandardAnswers(rcpShape, flapCtx(rcpShape, flapTw('flapdotsh')));
  check('F3 rcp 0.62 概率形状 + 官方源 → 概率门豁免（不被「常规内容产品宣传」拦）+ 审计 true',
    !(rF3.stage2DataToSave?.parsed_output?.blockReason || '').includes('常规内容产品宣传')
    && rF3.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt === true,
    { blk: rF3.stage2DataToSave?.parsed_output?.blockReason });
  const rF3b = mapper.mapStandardAnswers(rcpShape, flapCtx(rcpShape, flapTw('zhangxuanhui')));
  check('F3b 路人号同 rcp 形状照拦「常规内容产品宣传」+ 审计 null',
    (rF3b.stage2DataToSave?.parsed_output?.blockReason || '').includes('常规内容产品宣传')
    && rF3b.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt == null,
    rF3b.stage2DataToSave?.parsed_output?.blockReason);

  // F4 产品实体门豁免：麒麟 19% 接纳度答案（C2 无语料时被产品门拦）+ 官方源 → 不拦；
  //     币安豁免审计不落（FlapGuy 语料无 binance 字样——两豁免互斥隔离）
  const rF4 = mapper.mapStandardAnswers(qilinAnswers, flapCtx(qilinAnswers, flapTw('flapdotsh')));
  check('F4 官方源豁免产品实体门（19% 接纳度不拦）+ productEntityBinanceExempt 不落（互斥隔离）',
    !(rF4.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳')
    && rF4.stage2DataToSave?.parsed_output?.jev?.productEntityBlock == null
    && rF4.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null,
    { blk: rF4.stage2DataToSave?.parsed_output?.blockReason, pe: rF4.stage2DataToSave?.parsed_output?.jev?.productEntityBlock });
  const rF4b = mapper.mapStandardAnswers(qilinAnswers, flapCtx(qilinAnswers, flapTw('zhangxuanhui')));
  check('F4b 路人号同语料被产品门拦（对照 F4 单变量隔离）',
    (rF4b.stage2DataToSave?.parsed_output?.blockReason || '').includes('产品实体未被web3买家接纳'),
    rF4b.stage2DataToSave?.parsed_output?.blockReason);

  console.log(`\n========== ${passed} 通过 / ${failed} 失败 ==========`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
