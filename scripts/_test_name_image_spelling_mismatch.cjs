#!/usr/bin/env node
/**
 * C78 图文名不符拼写门（detectNameImageSpellingMismatch，mapper 纯代码判据）
 * ——本地零 DB 零网络单测（2026-10-16 用户裁定「拼写错误这个肯定要阻断
 * （除非是引申等等，但这里就是拼写错误了）」，鲸元卷案
 * 0xe0cf0905310fc63cd8192513883d7426fc1e7777）
 *
 * 病根：币名「鲸元卷」，配图图内文字（vision img-v3 visible_text）写的是
 * 正字「鲸元券」（多次出现），全图无一「卷」字——名称连自己的宣告图都没
 * 抄对。Jev block_misspelling 探针拦不住：线上 0.28，题面加「图内文字写法
 * 对照」判据后 state 逐字重放反降 0.13（题面改锚分不动家族第三实证）→
 * 判据改代码接管（C28 cashtag 改道同款先例）。
 *
 * 覆盖：
 *   A. 鲸元卷事故现场反证：图内「鲸元券」≠币名「鲸元卷」→ Stage3 截断 low
 *      （reason 图文名不符 + 审计 spellingMismatch）
 *   B. 用户例外口径：有意变形全语料一致（图内也写「鲸元卷」）→ 不拦
 *   C. 图内双写法（币名在图内出现过）→ 不拦
 *   D. fail-closed 族：无图 / name<3字 / name 空 / image_analysis 空对象 → 不拦
 *   E. 英文同构：peep/pepe 拦；跨词拼接不误伤
 *   F. Jev 原门共存：misspellingP≥0.5 仍拦（无图形状）；门序=品牌劫持之后
 *   G. 审计字段：命中才落 {name, variant}，不命中 null
 *   H. 源码口径锁定：stage3 消费点形状 / C72 剥除兼容（analyzer 侧零改动，
 *      twitterInfo 已传 J1.17 通道）
 *
 * 用法：node scripts/_test_name_image_spelling_mismatch.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 鲸元卷案 answers 骨架：过 stage1/2（E 类 + 高量级 + 高 dim2），relevance exact_match 高分 */
function jyjAnswers() {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.62, C: 0.21 } },
    event_magnitude: { score: 4.4, probabilities: { '4': 0.55, '5': 0.25 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.99 } },
    dimension2: { score: 24, probabilities: { '5': 0.58, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.55, low_quality_derivative: 0.26 } },
    name_referent: { choice: 'minor_other', probabilities: { minor_other: 0.6 } },
    referent_memeability: { score: 3.48, probabilities: { '4': 0.58, '3': 0.32 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.97 } },
    subject_entity: { choice: 'company', probabilities: { company: 0.38, product_functional: 0.29 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.55 } },
    relevance_level: { score: 2.75, probabilities: { '3': 0.6 } },
    block_misspelling: { noul: 0.28 }, // 线上真实值：Jev 拦不住
    quality_spelling: { score: 2.53 },
    quality_reasonability: { score: 1.32 },
  };
}

/** 本案真实 image_analysis 形状（analysis.description 内嵌 JSON 字符串含 visible_text） */
function jyjImage(insideText) {
  const inner = JSON.stringify({
    description: '这是一张社交媒体截图，内容是关于 DeepSeek 的补偿公告。',
    key_elements: ['DeepSeek logo', '“鲸元券”的手绘设计外观', '“鲸元券”上的文字：面额 10000000 token'],
    visible_text: `DeepSeek 发补偿啦 【补偿通知】 尊敬的用户: 北京时间 2026年 10月 15日 期间服务出现故障。
 作为补偿, 我们将按账单7日内的消费金额以赠金形式 全额返到帐。 ${insideText} 271989 10000000 token 鲸亿 宕机5小时，DeepSeek给钱啦！`,
  });
  return { url: 'https://pbs.twimg.com/media/x.jpg', model: 'Qwen/Qwen3-Omni-30B-A3B-Captioner', analysis: { meme_type: null, description: inner }, analyzedAt: '2026-10-16T09:51:00Z', promptVersion: 'img-v3' };
}

const stdCtx = (over = {}) => ({
  tokenData: { symbol: '鲸元卷', name: '鲸元卷', raw_api_data: { name: '鲸元卷' } },
  includeBrandHijack: false,
  imageEvidence: true,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  ...over,
});

function stage3Jev(r) { return r.stage3DataToSave?.parsed_output?.jev; }

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  // ═══ A. 鲸元卷事故现场反证 ═══
  console.log('\n── A. 鲸元卷事故现场反证（图内「鲸元券」≠币名「鲸元卷」，misspellingP=0.28）──');
  const rCase = mapStandardAnswers(jyjAnswers(), stdCtx({
    twitterInfo: { image_analysis: jyjImage('鲸元券') },
  }));
  check('A1 rating 翻 low（Jev 门 0.28 拦不住，代码门拦）',
    rCase.llmResult.rating === 'low', rCase.llmResult.rating);
  check('A2 reason 含图文名不符 + 图内正字与币名',
    (rCase.llmResult.reason || '').includes('图文名不符') && (rCase.llmResult.reason || '').includes('鲸元券'),
    rCase.llmResult.reason);
  check('A3 blockReason 归「无背景拼写错误」族',
    rCase.stage3DataToSave?.parsed_output?.blockReason?.includes('图文名不符'), null);
  const smA = stage3Jev(rCase)?.spellingMismatch;
  check('A4 审计命中：{name:鲸元卷, variant:鲸元券}',
    smA?.name === '鲸元卷' && smA?.variant === '鲸元券', smA);
  // 对照臂：门缺席（无图）= 修正前行为——线上 66.31 mid 过线
  const rBefore = mapStandardAnswers(jyjAnswers(), stdCtx({ imageEvidence: false }));
  check('A5 修正前行为复现：无图票 66.31 同族 mid 过线（对照臂）',
    rBefore.llmResult.rating !== 'low', rBefore.llmResult.rating);

  // ═══ B. 用户例外口径：有意变形全语料一致 ═══
  console.log('\n── B. 例外口径（除非是引申等等——图内一致使用变形写法）──');
  const rConsistent = mapStandardAnswers(jyjAnswers(), stdCtx({
    twitterInfo: { image_analysis: jyjImage('鲸元卷') },
  }));
  check('B1 图内也写「鲸元卷」（全语料一致的有意变形）→ 不拦',
    rConsistent.llmResult.rating !== 'low', rConsistent.llmResult.rating);
  check('B2 审计不落（不命中）', stage3Jev(rConsistent)?.spellingMismatch == null, null);

  // ═══ C. 图内双写法 ═══
  console.log('\n── C. 图内双写法（币名在图内出现过=名字被使用过）──');
  const rDual = mapStandardAnswers(jyjAnswers(), stdCtx({
    twitterInfo: { image_analysis: jyjImage('鲸元券（又称鲸元卷）') },
  }));
  check('C1 图内两个写法都有 → 不拦（币名整体在图内出现）',
    rDual.llmResult.rating !== 'low', rDual.llmResult.rating);

  // ═══ D. fail-closed 族 ═══
  console.log('\n── D. fail-closed 族（无从对照不触发）──');
  check('D1 无图（C72 门跳过=analyzer 已剥 image_analysis）→ 不拦',
    mapStandardAnswers(jyjAnswers(), stdCtx({ imageEvidence: false })).llmResult.rating !== 'low', null);
  check('D2 twitterInfo null → 不拦',
    mapStandardAnswers(jyjAnswers(), stdCtx()).llmResult.rating !== 'low', null);
  const shortName = { symbol: '皮蛋', name: '皮蛋', raw_api_data: { name: '皮蛋' } };
  check('D3 name 2 字 → 长度门不判（误伤面）',
    mapStandardAnswers(jyjAnswers(), stdCtx({
      tokenData: shortName, twitterInfo: { image_analysis: jyjImage('皮旦') },
    })).llmResult.rating !== 'low', null);
  check('D4 name 空 → 不判',
    mapStandardAnswers(jyjAnswers(), stdCtx({
      tokenData: { symbol: 'X', name: '', raw_api_data: {} }, twitterInfo: { image_analysis: jyjImage('鲸元券') },
    })).llmResult.rating !== 'low', null);
  check('D5 image_analysis 空对象 → 不拦',
    mapStandardAnswers(jyjAnswers(), stdCtx({
      twitterInfo: { image_analysis: {} },
    })).llmResult.rating !== 'low', null);

  // ═══ E. 噪声面收紧（600 票历史扫描实测三噪声源）═══
  console.log('\n── E. 噪声面收紧（拉丁不判/黏连分隔/单次语境词）──');
  const rLatin = mapStandardAnswers(jyjAnswers(), stdCtx({
    tokenData: { symbol: 'pepe', name: 'pepe', raw_api_data: { name: 'pepe' } },
    twitterInfo: { image_analysis: { analysis: { description: 'a sign that says "pepo" twice: pepo pepo' } } },
  }));
  check('E1 拉丁名不判（CTS/ces、RAM/rom 实测 OCR 噪声族；英文真实 case 再定参）',
    rLatin.llmResult.rating !== 'low', rLatin.llmResult.rating);
  const rGlue = mapStandardAnswers(jyjAnswers(), stdCtx({
    tokenData: { symbol: 'NEON猫', name: 'NEON猫', raw_api_data: { name: 'NEON猫' } },
    twitterInfo: { image_analysis: { analysis: { description: '标题写着 NEON》 很醒目 NEON》' } } },
  }));
  check('E2 标点黏连当分隔符（neon》段 4 字 ≠ 币名 5 字 → 不命中；600 票扫描噪声源①）',
    rGlue.llmResult.rating !== 'low', rGlue.llmResult.rating);
  const rOnce = mapStandardAnswers(jyjAnswers(), stdCtx({
    tokenData: { symbol: '中国龙', name: '中国龙', raw_api_data: { name: '中国龙' } },
    twitterInfo: { image_analysis: { analysis: { description: '中国的文化源远流长，舞龙表演源自中国的传统。' } } },
  }));
  check('E3 CJK 语流黏连不误伤（「中国的」并入长段=非独立等长段；600 票扫描噪声源③——中国龙 mid 票实测）',
    rOnce.llmResult.rating !== 'low', rOnce.llmResult.rating);
  const rTrans = mapStandardAnswers(jyjAnswers(), stdCtx({
    tokenData: { symbol: 'pepe', name: 'pepe', raw_api_data: { name: 'pepe' } },
    twitterInfo: { image_analysis: { analysis: { description: 'a sign that says "peep" here' } } },
  }));
  check('E4 换位形状（pepe/peep 两位置不同）+拉丁 → 双重不覆盖',
    rTrans.llmResult.rating !== 'low', rTrans.llmResult.rating);

  // ═══ F. Jev 原门共存与门序 ═══
  console.log('\n── F. Jev 原门共存（misspellingP≥0.5 无图形状）──');
  const hi = jyjAnswers(); hi.block_misspelling = { noul: 0.8 };
  const rJev = mapStandardAnswers(hi, stdCtx({ imageEvidence: false }));
  check('F1 misspellingP=0.8 无图仍拦（原门不动）',
    rJev.llmResult.rating === 'low' && (rJev.llmResult.reason || '').includes('无背景拼写错误'),
    rJev.llmResult.reason);
  const rBoth = mapStandardAnswers(hi, stdCtx({ twitterInfo: { image_analysis: jyjImage('鲸元券') } }));
  check('F2 双证据命中 reason 走代码门文案（图文名不符优先可追溯）',
    (rBoth.llmResult.reason || '').includes('图文名不符'), rBoth.llmResult.reason);

  // ═══ G. 审计字段形状 ═══
  console.log('\n── G. 审计字段（命中才落）──');
  check('G1 命中落 {name, variant} 两键', Object.keys(smA || {}).length === 2, smA);

  // ═══ H. 源码口径锁定 ═══
  console.log('\n── H. 源码口径锁定（事故修复配源码断言）──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  check('H1 stage3 消费点：misspellingP>=0.5 || spellingMismatch.hit 双臂 OR',
    mapperSrc.includes('misspellingP >= 0.5 || spellingMismatch.hit'), null);
  check('H2 判据收紧三要件在源码：等长独立段 substitution（++diff > 1）/ 段内子串不拦（t.includes(name)）/ CJK 门（Han/Hangul/Kana 区间正则锚）/ 长度门 / 出现 ≥2 次（bestCount >= 2）',
    mapperSrc.includes('++diff > 1') && mapperSrc.includes('t.includes(name)')
      && mapperSrc.includes('name.length < 3') && mapperSrc.includes('bestCount >= 2')
      && mapperSrc.includes('가-힯'), null);
  check('H3 题面未动（题面改锚分不动家族：J1.30 零漂移，判据全在代码侧）',
    !mapperSrc.includes('最强判据是写法对照'), null);
  const analyzerSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  check('H4 analyzer 零改动依赖：twitterInfo 已传（J1.17 通道，C72 剥除兼容）',
    analyzerSrc.includes('twitterInfo, // J1.17 cashtag 改道判据'), null);

  console.log(`\n══ 结果：${passed} 过 / ${failed} 挂 ══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
