#!/usr/bin/env node
/**
 * J1.29 形象载体门（subject_carrier：C/D+非existing 拦、E+no_visual 拦）
 * ——本地零 DB 单测（2026-10-09 用户裁定挂门 M2，bddd3578 案）
 *
 * 病根：C/D 35 票净 -2.85 共同病根=叙事主体无形象/梗载体（web3 用户抓不住
 * 一个「东西」去玩梗/二创）；C/D 29/35 票 strong_fit≥0.9 而 winR 7%——web3_fit
 * 在蹭票上语义反向，J1.27 接纳门 fitMass 判据失效。配套第 16 题 subject_carrier
 * （J1.29 恒带 choice 三档），mapper 按类别×档位切门（M2）。
 *
 * 覆盖：
 *   A. 问卷形状：J1.29 恒带 subject_carrier（默认携带、carrier 废弃选项等价）
 *   B. 判定矩阵：类别 × 三档（C/D+非existing 拦；E 只拦 no_visual；A/B/F/G/W 不进门）
 *   C. 旧缓存行：无答案键 / choice null → 门不触发（fail-open，J1.28 同款）
 *   D. 挂位顺序：nr/rm 先拦 label 归属前者；载体门先于量级 D/E 门
 *   E. 审计字段：subjectCarrier 恒落 / subjectCarrierBlock 命中才落 / probabilities
 *   F. bddd 案形状锚定：BNC(D+improvised 拦) / bCAT(D+existing 过) /
 *      通透人生(E+no_visual 拦) / Ants(E+improvised 过——M2 刻意只拦 no_visual)
 *   G. 源码口径：门链序 / superIP 不消费 / CARRIER_LABELS / 失效脚本配套
 *
 * 用法：node scripts/_test_subject_carrier.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const GATE_LABEL = '叙事主体无形象载体';

/**
 * 标准路径基础形状：所有前置门（nhn/rcp/w3fit/pe/argmax/nr/rm）不命中，
 * 量级 A 档避开量级门，Stage3 不拦——专测载体门
 */
function baseAnswers(cat, carrier) {
  const answers = {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.9, notable_other: 0.08 } },
    referent_memeability: { score: 3, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.7 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
  };
  if (carrier !== undefined) {
    answers.subject_carrier = { choice: carrier, probabilities: carrier ? { [carrier]: 0.8 } : {} };
  }
  return answers;
}

const stdCtx = (symbol, name) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

function blockedByCarrier(r) {
  return r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes(GATE_LABEL);
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.29 恒带；carrier 选项废弃）──');
  check('A1 版本号 = J1.29', JEV_QUESTIONS_VERSION === 'J1.29', JEV_QUESTIONS_VERSION);
  const qsDefault = buildStandardQuestions();
  check('A2 默认恒带 subject_carrier（生产题集判据源）', 'subject_carrier' in qsDefault, Object.keys(qsDefault).length);
  const qsOpt = buildStandardQuestions({ carrier: true });
  check('A3 传废弃选项 carrier:true 与默认同一形状', JSON.stringify(qsOpt.subject_carrier) === JSON.stringify(qsDefault.subject_carrier), null);
  const sc = qsDefault.subject_carrier;
  check('A4 type=choice 三档', sc.type === 'choice' && Object.keys(sc.criteria).length === 3
    && ['existing_entity', 'improvised_entity', 'no_visual_entity'].every(k => k in sc.criteria), null);
  check('A5 题面钉死只判载体事实存在性（与热度/量级无关）', sc.instructions.includes('只判载体的事实存在性') && sc.instructions.includes('与热度/量级/时效无关'), null);
  check('A6 题面钉死评估对象=指代对象（与 name_referent/subject_entity 同口径）', sc.instructions.includes('与 name_referent/subject_entity 同对象口径'), null);
  check('A7 关键判别②：名字含形象词≠载体存在', sc.instructions.includes('名字含形象词') && sc.instructions.includes('不等于载体存在'), null);
  check('A8 与品牌劫持条件题互不影响', buildStandardQuestions({ includeBrandHijack: true }).subject_carrier != null && !('brand_hijack' in qsDefault), null);

  // ═══ B. 判定矩阵 ═══
  console.log('\n── B. 判定矩阵（M2：C/D+非existing 拦、E+no_visual 拦、其余类别不进门）──');
  const cases = [
    // [类别, carrier, 是否应拦, 说明]
    ['C', 'existing_entity', false, 'C+existing 放行'],
    ['C', 'improvised_entity', true, 'C+improvised 拦（脑补形象）'],
    ['C', 'no_visual_entity', true, 'C+no_visual 拦（无形象实体）'],
    ['D', 'existing_entity', false, 'D+existing 放行'],
    ['D', 'improvised_entity', true, 'D+improvised 拦'],
    ['D', 'no_visual_entity', true, 'D+no_visual 拦'],
    ['E', 'existing_entity', false, 'E+existing 放行'],
    ['E', 'improvised_entity', false, 'E+improvised 放行（M2 刻意：Ants 型戏谑票有肉）'],
    ['E', 'no_visual_entity', true, 'E+no_visual 拦'],
    ['A', 'improvised_entity', false, 'A 类不进门（类别本身即形象判定，量级门把关）'],
    ['A', 'no_visual_entity', false, 'A 类不进门（no_visual 同）'],
    ['B', 'no_visual_entity', false, 'B 类不进门'],
    ['F', 'no_visual_entity', false, 'F 类不进门'],
    ['G', 'no_visual_entity', false, 'G 类不进门'],
    ['W', 'no_visual_entity', false, 'W 类不进门（W 数学自持）'],
  ];
  for (const [cat, carrier, shouldBlock, note] of cases) {
    const r = mapStandardAnswers(baseAnswers(cat, carrier), stdCtx('TST', 'TST'));
    check(`B ${note}`, blockedByCarrier(r) === shouldBlock, r.llmResult.reason);
  }

  // ═══ C. 旧缓存行（无答案）不触发 ═══
  console.log('\n── C. 旧缓存行 / 答案缺失 ──');
  const rNoKey = mapStandardAnswers(baseAnswers('D', undefined), stdCtx('TST', 'TST'));
  check('C1 无 subject_carrier 键（旧缓存行）→ 门不触发（J1.28 同款 fail-open）', !blockedByCarrier(rNoKey), rNoKey.llmResult.reason);
  const rNullChoice = mapStandardAnswers(baseAnswers('D', null), stdCtx('TST', 'TST'));
  check('C2 choice 显式 null → 门不触发', !blockedByCarrier(rNullChoice), rNullChoice.llmResult.reason);
  check('C2b 审计 subjectCarrier=null（旧行可识别）', rNoKey.stage2DataToSave.parsed_output.jev.subjectCarrier === null, rNoKey.stage2DataToSave.parsed_output.jev.subjectCarrier);

  // ═══ D. 挂位顺序 ═══
  console.log('\n── D. 挂位顺序（nr → rm → sc → 量级门）──');
  const nrFirst = baseAnswers('C', 'improvised_entity');
  nrFirst.name_referent = { choice: 'minor_other', probabilities: { minor_other: 0.55, subject_self: 0.3 } };
  const rNr = mapStandardAnswers(nrFirst, stdCtx('TST', 'TST'));
  check('D1 nr 先拦的票 label 归属 nr（载体门不抢）', rNr.llmResult.rating === 'low' && (rNr.llmResult.reason || '').includes('名字指向无名对象')
    && !(rNr.llmResult.reason || '').includes(GATE_LABEL), rNr.llmResult.reason);
  const rmFirst = baseAnswers('C', 'no_visual_entity');
  rmFirst.referent_memeability = { score: 1, probabilities: {} };
  const rRm = mapStandardAnswers(rmFirst, stdCtx('TST', 'TST'));
  check('D2 rm 先拦的票 label 归属 rm（J1.28 优先级不变）', rRm.llmResult.rating === 'low' && (rRm.llmResult.reason || '').includes('不适合成为meme币')
    && !(rRm.llmResult.reason || '').includes(GATE_LABEL), rRm.llmResult.reason);
  // sc 先于量级门：量级 E 档 + D 类 + improvised → 拦截原因应是载体门非量级门
  const lowTier = baseAnswers('D', 'improvised_entity');
  lowTier.event_magnitude = { score: 0.5, probabilities: { '0': 0.8 } };
  const rSc = mapStandardAnswers(lowTier, stdCtx('TST', 'TST'));
  check('D3 载体门先于量级门（低量级 D 类票 label 归属载体门）', blockedByCarrier(rSc) && !(rSc.llmResult.reason || '').includes('量级不足'), rSc.llmResult.reason);
  // 反向对照：同量级 E 档 + existing → 量级门拦（载体门不参与）
  const lowTierPass = baseAnswers('D', 'existing_entity');
  lowTierPass.event_magnitude = { score: 0.5, probabilities: { '0': 0.8 } };
  const rTier = mapStandardAnswers(lowTierPass, stdCtx('TST', 'TST'));
  check('D4 existing 低量级票照走量级门（载体门不放大打击面）', rTier.llmResult.rating === 'low' && (rTier.llmResult.reason || '').includes('量级不足'), rTier.llmResult.reason);

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计字段（恒落/命中才落/probabilities）──');
  const rHit = mapStandardAnswers(baseAnswers('D', 'improvised_entity'), stdCtx('TST', 'TST'));
  const jHit = rHit.stage2DataToSave.parsed_output.jev;
  check('E1 命中：subjectCarrier=improvised_entity + subjectCarrierBlock={carrier}', jHit.subjectCarrier === 'improvised_entity'
    && JSON.stringify(jHit.subjectCarrierBlock) === '{"carrier":"improvised_entity"}', jHit.subjectCarrierBlock);
  check('E2 命中：probabilities.subject_carrier 落库', jHit.probabilities.subject_carrier != null, jHit.probabilities.subject_carrier);
  const rMiss = mapStandardAnswers(baseAnswers('D', 'existing_entity'), stdCtx('TST', 'TST'));
  const jMiss = rMiss.stage2DataToSave.parsed_output.jev;
  check('E3 未命中：subjectCarrier 恒落 + subjectCarrierBlock=null（门形状事后校准免重跑）', jMiss.subjectCarrier === 'existing_entity' && jMiss.subjectCarrierBlock === null, jMiss.subjectCarrierBlock);
  check('E4 未命中：probabilities.subject_carrier 照落', jMiss.probabilities.subject_carrier != null, jMiss.probabilities.subject_carrier);

  // ═══ F. bddd 案形状锚定（dry-run 实测档位）═══
  console.log('\n── F. bddd 案形状锚定 ──');
  // BNC 0xf5362fdf641d31e9ca1a9e6210ae193087167777：@aryonserwin「Why not BNC
  // standing for Binance cat」父推 @binance 倒计时——币安从未有过猫，脑补许愿形象；
  // 线上 77.24 high 放行后 -0.27（D 类 improvis­ed 典型）
  const rBnc = mapStandardAnswers(baseAnswers('D', 'improvised_entity'), stdCtx('BNC', 'Binance Cat'));
  check('F1 BNC 案（D+improvised）→ 拦', blockedByCarrier(rBnc), rBnc.llmResult.reason);
  // bCAT 0x5becb5cb498b62e5986f5693bdbe4e41b79e7777：币安钱包 APP 横幅演示页
  // 置顶 meme 头像——形象在官方本体真实出现；D+existing 放行（+0.11 赢票）
  const rBcat = mapStandardAnswers(baseAnswers('D', 'existing_entity'), stdCtx('bCAT', 'binance cat'));
  check('F2 bCAT 案（D+existing）→ 放行（载体真实存在，死因归时效等其它门）', !blockedByCarrier(rBcat), rBcat.llmResult.reason);
  // 通透人生 0xfd7475f24c6fdec2739711c6c866203c719d7777：抖音抽象概念梗（E 类
  // no_visual）——+0.55 赢票，是 M2 已知代价（E 类误伤面大头「XX人生」概念梗家族）
  const rTyrs = mapStandardAnswers(baseAnswers('E', 'no_visual_entity'), stdCtx('通透人生', '通透人生'));
  check('F3 通透人生案（E+no_visual）→ 拦（已知代价样本，E 类概念梗家族）', blockedByCarrier(rTyrs), rTyrs.llmResult.reason);
  // Ants：Anthropic 员工自称蚂蚁——E+improvised +1.42 戏谑票，M2 刻意放行
  const rAnts = mapStandardAnswers(baseAnswers('E', 'improvised_entity'), stdCtx('Ants', 'Ants'));
  check('F4 Ants 案（E+improvised）→ 放行（E 类戏谑票有肉，M3 全拦反亏 -1.19）', !blockedByCarrier(rAnts), rAnts.llmResult.reason);

  // ═══ G. 源码口径 ═══
  console.log('\n── G. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('G1 门函数 + CARRIER_LABELS 两键', /function subjectCarrierBlock\(answers, category\)/.test(mapperSrc)
    && /CARRIER_LABELS = \{[^}]*improvised_entity: '脑补形象'[^}]*no_visual_entity: '无形象实体'[^}]*\}/s.test(mapperSrc), null);
  const rmIdx = mapperSrc.indexOf('referentMemeabilityLowBlock(answers)))');
  const scIdx = mapperSrc.indexOf('subjectCarrierBlock(answers, category)))');
  const tierIdx = mapperSrc.indexOf("effTier === 'E' || effTier === 'D'");
  check('G2 阻断链序：rm 门 → 载体门 → 量级 D/E 门（索引严格递增）', rmIdx > 0 && scIdx > rmIdx && tierIdx > scIdx, { rmIdx, scIdx, tierIdx });
  const superFnBody = mapperSrc.slice(mapperSrc.indexOf('export function mapSuperIPAnswers'));
  check('G3 superIP 快车道不消费 subject_carrier（零出现）', !superFnBody.includes('subject_carrier'), null);
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('G4 题集头部含 J1.29 条目（bddd 案档案）', qsSrc.includes('* J1.29（2026-10-09') && qsSrc.includes('bddd3578'), null);
  check('G5 窗口缓存失效脚本配套（J1.28 模式）', readFileSync(join(__dirname, '..', 'scripts', 'narrative', 'invalidate-carrier-window.cjs'), 'utf8').length > 0, null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_subject_carrier: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
