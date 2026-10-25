#!/usr/bin/env node
/**
 * Web3 用户契合证据门（J1.83/C141；前身=产品实体接纳门 J1.27/C55 华为麒麟案族）
 * ——本地零 DB 零网络单测
 *
 * C141 演化（用户裁定「这个也是口味契合的大类，应该放到 web3_user_event_fit 中，
 * 如果 C/D 类没有通用硬门可以加」）：event_subject_entity 题退役，门一般化为
 * strong_fit+fit 合计 <0.5 全域拦（豁免链 pubProxy/isW/binanceCorpus/
 * platformOfficial 原样继承）。行为单向收紧：非产品实体票 sf+fit<0.5 旧放新拦。
 *
 * 覆盖：
 *   A. 题面完整性：J1.83 版本 / 12 题无 event_subject_entity / fit 题尾产品实体
 *      锚句升级（→unfit）/ unfit 桶含母公司影响力≠产品接纳臂
 *   B. 封装边界：web3FitMassBlock 私有不导出
 *   C. mapStandardAnswers 集成：麒麟形状③实测答案（J1.27 wording 实验轮2 数值）
 *      → fitMass 驱动拦截（se 标注不再参与判定）+ 阈值边界 + 豁免链 +
 *      历史行 se 键照落（保留读验证）
 *   D. 源码口径：挂点顺序（w3Block 后 event_quality_veto argmax 前）+ 豁免四条件接线 + C56 三处豁免位
 *   F. C56 平台官方源豁免（flap 裁定「flap 是币安链的 meme 币发布平台…跟币安链一个道理」）：
 *      FlapGuy 复验实测形状——argmax 机构日常运营豁免（实际拦截位）/ rcp 概率门豁免 /
 *      契合证据门豁免 / handle 硬集矩阵（大小写归一·单词不中·account 型双字段）/
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
  event_quality_veto: { choice: 'none', probabilities: { none: 0.9, event_routine_content_product: 0.06 } },
  web3_user_event_fit: { choice: 'marginal', probabilities: { strong_fit: 0.14, fit: 0.05, marginal: 0.62, unfit: 0.19 } },
  web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.8, unknown: 0.16 } },
  name_event_relevance: { choice: 'translation_match', probabilities: { translation_match: 0.51, exact_match: 0.45 } },
  relevance_level: { score: 3.46, probabilities: { '4': 0.69, '3': 0.19 } },
  block_misspelling: { noul: 0.1 },
  quality_spelling: { score: 2.82 },
  quality_reasonability: { score: 1.96 },
  event_subject_entity: { choice: 'product_functional', probabilities: { product_functional: 0.86, company: 0.09, product_character: 0.05 } },
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

  console.log('\n── A. 题面完整性（J1.83/C141）──');
  check('A1 版本 ≥J1.87', parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 87, qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  check('A2 题集 10 题且 event_subject_entity/w_product_score/web3_user_entity_visuality 已退役（J1.102/C171 删 visuality+event_influence；J1.84 删 w_product_score；J1.83 删 event_subject_entity；J1.79 删 impact 14→13；C108 删 block_misspelling；C109 收敛 19→16）',
    Object.keys(q).length === 10 && !('event_subject_entity' in q) && !('w_product_score' in q) && !q.web3_user_entity_visuality && !q.event_influence && !q.event_resonance && !q.block_misspelling, Object.keys(q).length);
  check('A3 J1.79 事件价值题收敛为 web3_user_event_fit（impact 旧 score 题已删；J1.110/C181 同键名复活为 choice 否决题不再承担事件分，唯一事件价值题标记仍在）',
    q.bsc_meme_user_event_impact?.type === 'choice'
    && q.bsc_meme_user_event_fit.instructions.includes('标准路径的事件价值题'));
  check('A3b event_subject_entity 题面判据迁移：fit 题尾锚句升级（纯功能型→unfit，对齐 mapper 门）+ 母公司影响力核心句',
    q.bsc_meme_user_event_fit.instructions.includes('公司产品实体（J1.27/J1.83）')
    && q.bsc_meme_user_event_fit.instructions.includes('无形象无玩梗空间→unfit')
    && q.bsc_meme_user_event_fit.instructions.includes('母公司影响力/规格不转移给产品'));
  check('A3c event_category D/W 边界句（币安机构官宣自家产品→D 不判 W）仍在，impact 旧 score 题删除不带走该锚（J1.110 复活键为 choice 否决题；J1.125 题面中文重写锚词同步）',
    q.event_category.instructions.includes('D vs W 边界')
    && q.event_category.instructions.includes('不是 W')
    && q.bsc_meme_user_event_impact?.type === 'choice');
  check('A4 unfit 桶含产品实体臂（华为发布麒麟≠链上用户接纳麒麟）+ crypto 原生机构例外',
    q.bsc_meme_user_event_fit.criteria.unfit.includes('公司产品实体不被接纳')
    && q.bsc_meme_user_event_fit.criteria.unfit.includes('华为发布麒麟芯片≠链上用户接纳麒麟')
    && q.bsc_meme_user_event_fit.criteria.unfit.includes('天然强契合不选本项'));

  console.log('\n── B. 封装边界 ──');
  check('B1 web3FitMassBlock 不导出（私有封装，门矩阵经 C 段集成；前身 productEntityAcceptanceBlock 同款私例）',
    mapper.web3FitMassBlock === undefined && mapper.__web3FitMassBlock === undefined
    && mapper.productEntityAcceptanceBlock === undefined);

  console.log('\n── C. mapStandardAnswers 集成（麒麟形状③实测答案，fitMass 驱动）──');
  // C1 se 标注退役：无 event_subject_entity 的同形状答案（J1.26 旧行形状）照拦——
  //    通用门只读 fitMass，se 键不参与判定（C141 单向收紧的行为锁定）
  const oldAnswers = { ...qilinAnswers };
  delete oldAnswers.event_subject_entity;
  const rOld = mapper.mapStandardAnswers(oldAnswers, makeContext(qilinTokenData, oldAnswers));
  check('C1 无 se 标注照拦（fitMass 19%<50%，se 驱动退役、fitMass 驱动上岗）',
    rOld.llmResult.rating === 'low'
    && (rOld.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足(J1.83)'),
    rOld.stage2DataToSave?.parsed_output?.blockReason);

  // C2 麒麟形状③ → 门拦截（与新键 label）
  const rBlocked = mapper.mapStandardAnswers(qilinAnswers, makeContext(qilinTokenData, qilinAnswers));
  const blk = rBlocked.stage2DataToSave?.parsed_output?.blockReason || '';
  check('C2 麒麟形状 → low + blockReason 命中契合证据门（label 不再区分功能产品/形象）',
    rBlocked.llmResult.rating === 'low' && blk.includes('Web3用户契合证据不足(J1.83)'), { rating: rBlocked.llmResult.rating, blk });
  check('C2b blockReason 带合计数值（19%<50%）', blk.includes('19%'), blk);
  const audit = rBlocked.stage2DataToSave?.parsed_output?.jev?.web3FitMassBlock;
  check('C2c 审计字段 web3FitMassBlock={fitMass}（旧键 productEntityBlock 随题退役不产出）',
    audit && audit.fitMass === 0.19 && !('subject' in audit)
    && rBlocked.stage2DataToSave?.parsed_output?.jev?.productEntityBlock === undefined,
    audit);
  check('C2d 历史行兼容：se 键在场照落 subjectEntity 审计（保留读，新行自然 null）',
    rBlocked.stage2DataToSave?.parsed_output?.jev?.subjectEntity === 'product_functional'
    && rBlocked.stage2DataToSave?.parsed_output?.jev?.probabilities?.event_subject_entity?.product_functional === 0.86);

  // C3 se=character_ip 旧不拦 → 新门照拦：拦截不再由 se 标注驱动（独立形象语义
  //    票的口味责任移交 fit 题统一判——题面形象自身玩梗证据锚）
  const seChar = { ...qilinAnswers, event_subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.8, product_character: 0.15 } } };
  const rChar = mapper.mapStandardAnswers(seChar, makeContext(qilinTokenData, seChar));
  check('C3 se=character_ip 同拦（fitMass<0.5 全域，se 标注零参与——C141 行为翻转锁定）',
    (rChar.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足(J1.83)'),
    rChar.stage2DataToSave?.parsed_output?.blockReason);

  // C3b 用户点名的 C/D 通用硬门：C 类事件票（非产品实体语境）fitMass 低 → 拦
  const cdShape = {
    ...qilinAnswers,
    event_category: { choice: 'C', probabilities: { C: 0.75, D: 0.15 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.9 } },
  };
  const rCd = mapper.mapStandardAnswers(cdShape, makeContext(qilinTokenData, cdShape));
  check('C3b C/D 类通用硬门（other_entity 事件票 fitMass 19% 旧放新拦——主要新增面）',
    rCd.llmResult.rating === 'low'
    && (rCd.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足(J1.83)'),
    rCd.stage2DataToSave?.parsed_output?.blockReason);

  // C4 接纳度过线：sf+fit ≥0.5 → 门放行（两条路统一底线，C55 语义不变）
  const fitPass = { ...qilinAnswers, web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.5, fit: 0.1, marginal: 0.35, unfit: 0.05 } } };
  const rPass = mapper.mapStandardAnswers(fitPass, makeContext(qilinTokenData, fitPass));
  check('C4 sf+fit=60% 过线放行（不被契合门拦）',
    !(rPass.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足'),
    rPass.stage2DataToSave?.parsed_output?.blockReason);

  // C5 W 类豁免：cat=W（原生 W）不触门（W 数学独立计分）
  const seW = { ...qilinAnswers, event_category: { choice: 'W', probabilities: { W: 0.8, D: 0.15 } },
    w_product_score: { score: 25, probabilities: { '2': 0.6, '3': 0.3 } },
    w_bsc_user_appeal: { score: 22, probabilities: { '2': 0.7 } } };
  const rW = mapper.mapStandardAnswers(seW, makeContext(qilinTokenData, seW));
  check('C5 cat=W 豁免（W 数学不消费契合门）',
    !(rW.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足'),
    rW.stage2DataToSave?.parsed_output?.blockReason);

  // C6 unfit 负门优先级：unfit≥0.5 的票先被 web3UnfitBlock 拦（label 归属更准）
  const unfitAnswers = { ...qilinAnswers, web3_user_event_fit: { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2, strong_fit: 0.1, fit: 0.08 } } };
  const rUnfit = mapper.mapStandardAnswers(unfitAnswers, makeContext(qilinTokenData, unfitAnswers));
  check('C6 unfit≥0.5 票先被 web3_user_event_fit 负门拦（非契合证据门 label）',
    (rUnfit.stage2DataToSave?.parsed_output?.blockReason || '').includes('BSC meme 用户偏好不合'), rUnfit.stage2DataToSave?.parsed_output?.blockReason);

  // C7 币安豁免（C55 补充裁定「要豁免币安」）：同麒麟形状答案（19% 接纳度本应拦）
  //    + 代币名含「币安」→ 门不拦 + 审计 productEntityBinanceExempt=true
  const bzTokenData = { symbol: '币安支付', name: '币安支付', raw_api_data: { name: '币安支付' } };
  const rBz = mapper.mapStandardAnswers(qilinAnswers, makeContext(bzTokenData, qilinAnswers));
  check('C7 币安语料（代币名）豁免——19% 接纳度不拦（C35 币安支付形状）',
    !(rBz.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足')
    && rBz.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt === true,
    { blk: rBz.stage2DataToSave?.parsed_output?.blockReason, audit: rBz.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt });

  // C7b 币安词在父推（in_reply_to.text）同样豁免（C40 BI 骑乘形状：主推英文、父推 @binance）
  const rBz2 = mapper.mapStandardAnswers(qilinAnswers, {
    ...makeContext(qilinTokenData, qilinAnswers),
    twitterInfo: { text: 'BI is coming', in_reply_to: { text: '@binance announces Binance Intelligence event' } },
  });
  check('C7b 币安词在父推豁免（C40 BI 骑乘形状）',
    !(rBz2.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足')
    && rBz2.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt === true);

  // C7c 非币安票不落豁免审计（麒麟 C2 对照——华为语料零豁免键）
  check('C7c 非币安票不落 productEntityBinanceExempt（对照 C2 麒麟）',
    rBlocked.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null);

  // C7d 币安语料但门本不会拦（sf 过线）→ 不落豁免审计（无救票形状）
  const rBz3 = mapper.mapStandardAnswers(fitPass, makeContext(bzTokenData, fitPass));
  check('C7d 币安语料+fitMass 过线 → 不落豁免审计（豁免未改变判定）',
    rBz3.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null);

  console.log('\n── D. 源码口径（挂点/豁免接线）──');
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const idxW3 = src.indexOf('} else if ((w3Block = web3UnfitBlock(answers))) {');
  const idxPe = src.indexOf('} else if ((peBlock = web3FitMassBlock(answers,');
  const idxBr = src.indexOf("} else if (blockChoice !== 'none' && noneProb < 0.5");
  check('D1 挂点顺序：w3Block → 契合证据门 → event_quality_veto argmax', idxW3 > 0 && idxPe > idxW3 && idxBr > idxPe, { idxW3, idxPe, idxBr });
  check('D2 豁免四条件接线（pubProxyActive / isW / binanceCorpus / platformOfficial；J1.56 rideMass 退役）',
    src.includes('opts.pubProxyActive || opts.isW')
    && src.includes('if (opts.binanceCorpus || opts.platformOfficial) return null;')
    && src.includes('binanceCorpus, platformOfficial }))) {'));
  check('D2b C56 平台官方源豁免接线（detectPlatformOfficial 双字段；J1.88/C150 删 argmax 机构日常子句）',
    !src.includes("&& !(platformOfficial && blockChoice === 'event_institution_routine')")
    && src.includes('const platformOfficial = detectPlatformOfficial(twitterInfo);')
    && src.includes('twitterInfo?.author_screen_name || twitterInfo?.screen_name')
    && !src.includes('routineContentProductBlock(')
    && !src.includes('rcpPlatformExempt,'));
  check('D2c superIP 快车道已删 + routine 门退役反证',
    !src.includes('mapSuperIPAnswers') && !src.includes('routineContentProductBlock('));
  check('D3 阈值 0.5 与 unfit 负门/strong_fit 正门同线', src.includes('const fitMass = (p.strong_fit ?? 0) + (p.fit ?? 0);') && src.includes('if (fitMass >= 0.5) return null;'));
  check('D3b detectBinanceCorpus 关键词与语料源（binance/币安 × 主推+父推+代币名）',
    src.includes("const BINANCE_KEYWORDS = ['binance', '币安'];") && src.includes('twitterInfo?.in_reply_to?.text'));
  const qSrc = fs.readFileSync(require('path').join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  check('D4 版本头条目含 C141 案号与门一般化语义', qSrc.includes('J1.83') && qSrc.includes('C141') && qSrc.includes('web3FitMassBlock'));
  check('D5 币安豁免句已随题收敛到 fit 题（影响力可正常转移给产品，随 J1.83 升级措辞）',
    q.bsc_meme_user_event_fit.instructions.includes('币安等 crypto 原生机构（交易所/公链/Web3 平台）的产品不在此列')
    && q.bsc_meme_user_event_impact?.type === 'choice');

  console.log('\n── F. C56 平台官方源豁免（FlapGuy 0x2fb77ad0…7777 复验实测形状）──');
  // FlapGuy 双轮复验（J1.27，182 真实 Jev 调用）：cat=D、mag 3.04-3.08（round→B 档，
  // P3 0.75-0.79 稳定）、dim2 3.01-3.05、nr subject_self 0.6-0.72
  // （minor+common 0.13 恒 <0.5）、block argmax=event_institution_routine（0.55 / none 0.30
  // / rcp 仅 0.10）——实际拦截点在 argmax 位而非 rcp 概率门，豁免必须三处齐备
  const flapTokenData = { symbol: 'FlapGuy', name: 'FlapGuy', raw_api_data: { name: 'FlapGuy' } };
  const flapAnswers = {
    event_category: { choice: 'D', probabilities: { D: 0.62, W: 0.21, C: 0.12 } },
    event_magnitude: { score: 3.05, probabilities: { '3': 0.76, '4': 0.16 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 3.02, probabilities: { '4': 0.5, '5': 0.3 } },
    event_quality_veto: { choice: 'event_institution_routine', probabilities: { event_institution_routine: 0.55, none: 0.3, event_routine_content_product: 0.1, event_marketing_gimmick: 0.05 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.55, fit: 0.25, marginal: 0.15, unfit: 0.05 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9, unknown: 0.09, no_entity: 0.01 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.88 } },
    relevance_level: { score: 4.2, probabilities: { '4': 0.7, '5': 0.2 } },
    block_misspelling: { noul: 0.05 },
    quality_spelling: { score: 3.1 },
    quality_reasonability: { score: 2.2 },
    event_subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.8, product_character: 0.15 } },
  };
  const flapTw = (handle) => ({ type: 'tweet', text: 'Flap mode 🍌', author_screen_name: handle, author_followers_count: 99800 });
  const flapCtx = (answers, twitterInfo) => ({ ...makeContext(flapTokenData, answers), twitterInfo });

  // F1 主线：官方源 → argmax 机构日常运营豁免 → 事件分过线 high（数值全推演锚定）
  const rF1 = mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, flapTw('flapdotsh')));
  check('F1 flapdotsh 官方源 → argmax 机构日常运营豁免（J1.87 rcpPlatformExempt 审计键退役）',
    rF1.llmResult.rating === 'high'
    && !(rF1.stage2DataToSave?.parsed_output?.blockReason || '').includes('机构日常运营')
    && rF1.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt === undefined,
    { rating: rF1.llmResult.rating, blk: rF1.stage2DataToSave?.parsed_output?.blockReason });
  check('F1b 数值锚定：J1.79 fit 口径 strong55+fit25→80 过线 → 总分 86.3（48+20+18.3）',
    rF1.stageFinalData.eventCompositeScore === 80 && rF1.stageFinalData.totalScore === 86.3,
    { s2: rF1.stageFinalData.eventCompositeScore, total: rF1.stageFinalData.totalScore });

  // F1c 对照：路人号（BOB 0xf2fca4cf…7777 主推 @zhangxuanhui，228 粉玩 CZ 香蕉梗）
  //      同答案形状：J1.88/C150 起 institution 桶退役，旧 choice 不再拦
  const rF1c = mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, flapTw('zhangxuanhui')));
  check('F1c 路人号同形状：institution 桶退役后不再拦「机构日常运营」（J1.88/C150）',
    !(rF1c.stage2DataToSave?.parsed_output?.blockReason || '').includes('机构日常运营')
    && rF1c.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt == null,
    { rating: rF1c.llmResult.rating, blk: rF1c.stage2DataToSave?.parsed_output?.blockReason });

  // F2 handle 矩阵（J1.88/C150：institution 桶退役后不再用 argmax 区分官方/路人；
  // detectPlatformOfficial 仍服务 web3FitMassBlock 豁免位）
  const ratingOf = (tw) => mapper.mapStandardAnswers(flapAnswers, flapCtx(flapAnswers, tw)).llmResult.rating;
  check('F2 handle 矩阵（J1.88/C150 后 institution 不再拦，FlapDotSh/binance/flap 单词/flapdotsh_alt/空 均 high）',
    ratingOf(flapTw('FlapDotSh')) === 'high' && ratingOf(flapTw('binance')) === 'high'
    && ratingOf(flapTw('flap')) === 'high' && ratingOf(flapTw('flapdotsh_alt')) === 'high' && ratingOf(flapTw('')) === 'high',
    { binance: ratingOf(flapTw('binance')), flapWord: ratingOf(flapTw('flap')) });
  check('F2b account 型语料（token 自挂官方账号链接）screen_name 双字段命中 → high',
    ratingOf({ type: 'account', screen_name: 'flapdotsh' }) === 'high');

  // F3 routine 0.62 形状（J1.87 桶退役）：官方源/路人号都不再被「常规内容产品宣传」拦；
  // rcpPlatformExempt 审计键不再产出
  const rcpShape = { ...flapAnswers, event_quality_veto: { choice: 'event_routine_content_product', probabilities: { event_routine_content_product: 0.62, none: 0.25, event_institution_routine: 0.1 } } };
  const rF3 = mapper.mapStandardAnswers(rcpShape, flapCtx(rcpShape, flapTw('flapdotsh')));
  check('F3 routine 0.62 形状：桶退役后不再拦 + rcpPlatformExempt 不产出',
    !(rF3.stage2DataToSave?.parsed_output?.blockReason || '').includes('常规内容产品宣传')
    && rF3.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt === undefined,
    { blk: rF3.stage2DataToSave?.parsed_output?.blockReason });
  const rF3b = mapper.mapStandardAnswers(rcpShape, flapCtx(rcpShape, flapTw('zhangxuanhui')));
  check('F3b 路人号同 routine 形状：桶退役后同样不拦（不再有 routine 专属豁免面）',
    !(rF3b.stage2DataToSave?.parsed_output?.blockReason || '').includes('常规内容产品宣传')
    && rF3b.stage2DataToSave?.parsed_output?.jev?.rcpPlatformExempt === undefined,
    rF3b.stage2DataToSave?.parsed_output?.blockReason);

  // F4 契合证据门豁免：麒麟 19% 接纳度答案（C2 无语料时被契合门拦）+ 官方源 → 不拦；
  //     币安豁免审计不落（FlapGuy 语料无 binance 字样——两豁免互斥隔离）
  const rF4 = mapper.mapStandardAnswers(qilinAnswers, flapCtx(qilinAnswers, flapTw('flapdotsh')));
  check('F4 官方源豁免契合证据门（19% 接纳度不拦）+ productEntityBinanceExempt 不落（互斥隔离）',
    !(rF4.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足')
    && rF4.stage2DataToSave?.parsed_output?.jev?.web3FitMassBlock == null
    && rF4.stage2DataToSave?.parsed_output?.jev?.productEntityBinanceExempt == null,
    { blk: rF4.stage2DataToSave?.parsed_output?.blockReason, fm: rF4.stage2DataToSave?.parsed_output?.jev?.web3FitMassBlock });
  const rF4b = mapper.mapStandardAnswers(qilinAnswers, flapCtx(qilinAnswers, flapTw('zhangxuanhui')));
  check('F4b 路人号同语料被契合门拦（对照 F4 单变量隔离）',
    (rF4b.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足'),
    rF4b.stage2DataToSave?.parsed_output?.blockReason);

  console.log(`\n========== ${passed} 通过 / ${failed} 失败 ==========`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
