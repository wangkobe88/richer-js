#!/usr/bin/env node
/**
 * 事件意义太小门（J1.127/C231）——零 DB 零网络单测
 *
 * 2026-10-25 用户裁定（BLACKBELT 0x46eaec0f241a0782b107d77fb5d0ed49974d7777）：
 * 「事件没有感情感染力/影响力，作为一名用户（bsc meme 币交易者），看一眼就划过了。
 * 虽然是黄仁勋，但是事情本身意义很小。」→ bsc_meme_user_event_impact 新增第 4 个
 * event_* 桶 event_trivial（事件真实成立但对 BSC meme 用户意义太小：圈外名人/机构
 * 礼节性荣誉/日常琐事/例行公事——主体再著名不抬事件分量）；mapper BLOCK_SCOPE
 * 全域拦（argmax 门自动接入）。与 empty_content 划界=有事件但太小 vs 没有事件。
 *
 * 案发现场（J1.126 轮误判 high 87.61）：黄仁勋获国际柔道联合会名誉黑带，@NVIDIAAI
 * （35.5 万粉官号）direct_tweet + @nvidianewsroom 官宣父推（赞 290/浏览 1.9 万）；
 * impact none 0.81（事件成立放行）+ fit strong_fit 0.62 派生 tier A + 量级锚黄仁勋
 * → high。C191 币安传奇观察点①（大 IP+小事件 fit 派生 tier 无仲裁位）第二例落锤。
 *
 * 覆盖：
 *   A. 题面：版本 J1.127 / impact 五桶 / trivial 判据锚（黄仁勋例证/看一眼就划过/
 *      圈外礼节性荣誉/圈内反锚 J1.58/项目发布反锚/与 empty 划界）
 *   B. mapper 集成：argmax=trivial 拦 / BLACKBELT 现场复刻（D+strong_fit 救不了）/
 *      none 高放行 / 旧行 fail-open / 全域 / 审计投影
 *   C. 源码口径：BLOCK_SCOPE 'all' / BLOCK_LABELS / C191 接棒注释
 *
 * 用法：node scripts/_test_event_trivial_gate.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// impact 桶可注入；默认 none 放行形状（存量兼容基线）
function baseAnswers(cat, impact) {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.72 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.97 } },
    bsc_meme_user_event_impact: impact ?? { choice: 'none', probabilities: { none: 0.9 } },
    bsc_meme_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.62, fit: 0.23 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.97 } },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.58, not_entity: 0.32 } },
    bsc_meme_user_phrase_acceptability: { choice: 'bsc_meme_user_not_acceptable', probabilities: { bsc_meme_user_not_acceptable: 0.65 } },
    token_name_quality: { score: 3, probabilities: {} },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
  };
}

function makeContext(extra = {}) {
  return {
    tokenData: { symbol: 'BLACKBELT', name: 'The Black Belt', raw_api_data: { name: 'The Black Belt' } },
    twitterInfo: { text: "Jensen's a black belt now. 🥋", in_reply_to: null },
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
  const qsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');

  console.log('\n── A. 题面（J1.127/C231）──');
  check('A1 版本 ≥ J1.127（J1.127=C231 trivial 桶；J1.126=C230 追裁；J1.124=C194）',
    parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 127, qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const impQ = q.bsc_meme_user_event_impact;
  check('A2 impact 题五桶（none/empty_content/trivial/baseless/ip_reuse）',
    ['none', 'event_empty_content', 'event_trivial', 'event_baseless_speculation', 'token_ip_reuse'].every(k => impQ.criteria[k])
    && Object.keys(impQ.criteria).length === 5, Object.keys(impQ.criteria));
  const trivialText = impQ.criteria.event_trivial;
  check('A3 trivial 桶判据锚：黄仁勋名誉黑带例证 + 看一眼就划过 + 圈外礼节性荣誉形状',
    trivialText.includes('事件意义太小')
    && trivialText.includes('圈外名人/机构的礼节性荣誉、日常琐事、例行公事')
    && trivialText.includes('看一眼就划过')
    && trivialText.includes('黄仁勋获国际柔道联合会名誉黑带')
    && trivialText.includes('主体再著名'), trivialText.slice(0, 80));
  check('A4 反锚四臂：圈内人物（J1.58）/ 玩梗参与空间（C160/C161）/ 广泛传播有分量 / W 项目发布交 w 臂题',
    trivialText.includes('圈内符号级人物/机构')
    && trivialText.includes('J1.58 同源')
    && trivialText.includes('C160/C161 族')
    && trivialText.includes('多方参与/持续发酵')
    && trivialText.includes('bsc_meme_user_web3_project_acceptance_and_impact'));
  check('A5 与 empty_content 划界（J1.111 事件层优先同源）：没有事件 → empty；本桶只管事件已成立但意义太小',
    trivialText.includes('与 event_empty_content 的划界')
    && trivialText.includes('根基=没有事件')
    && trivialText.includes('本项只管事件已成立但意义太小的票'));
  check('A6 C235 反锚⑤：重量级圈外机构加密/代币化立场性动作=行业信号级不拦（NMS 纳斯达克示例 tokenized stock 例证；载体形态不降低信号分量）',
    trivialText.includes('加密/代币化**立场性动作**')
    && trivialText.includes('行业信号级')
    && trivialText.includes('载体形态（一个示例页/一次试水/单方动作）不降低信号分量')
    && trivialText.includes('信号本身就是分量')
    && trivialText.includes('纳斯达克官网放出示例 tokenized stock')
    && trivialText.includes('C235'), trivialText.slice(-400, -120));
  check('A7 C235 典型形状「日常营业内容」划界：与行业立场无关的常规营业才算；涉加密/代币化动作不算日常营业',
    trivialText.includes('指与行业立场无关的常规营业')
    && trivialText.includes('涉加密/代币化的动作不算日常营业'), null);

  console.log('\n── B. mapper 集成（argmax 门 + 全域拦）──');
  // BLACKBELT 现场复刻：新题集下 Jev 若把 argmax 挪到 trivial → 拦（D 类 + strong_fit 0.62 派生救不了）
  const siteImpact = { choice: 'event_trivial', probabilities: { event_trivial: 0.62, none: 0.2, event_empty_content: 0.1 } };
  const mSite = mapper.mapStandardAnswers(baseAnswers('D', siteImpact), makeContext());
  const blkSite = stage2Of(mSite).blockReason || '';
  check('B1 BLACKBELT 现场复刻：D 类 + trivial 0.62 + strong_fit 0.62 → low + label 命中（fit 派生救不了）',
    mSite.llmResult.rating === 'low' && blkSite.includes('事件意义太小'), { rating: mSite.llmResult.rating, blkSite });
  check('B2 审计投影 blockChoice=event_trivial + blockChoiceProbability=argmax 概率（审计键，与 C184b ne/em 同形状）',
    stage2Of(mSite).jev?.blockChoice === 'event_trivial' && stage2Of(mSite).jev?.blockChoiceProbability === 0.62,
    { blockChoice: stage2Of(mSite).jev?.blockChoice, p: stage2Of(mSite).jev?.blockChoiceProbability });

  // none 仍高（事件成立）→ 放行（C191 币安传奇 J1.127 前形状 bit 不变）
  const mNone = mapper.mapStandardAnswers(baseAnswers('D', { choice: 'none', probabilities: { none: 0.81, event_empty_content: 0.1, token_ip_reuse: 0.08 } }), makeContext());
  check('B3 none 0.81 argmax → 放行不拦（存量 none 形状零翻转；trivial 语义=新桶须 Jev 主动选）',
    !(stage2Of(mNone).blockReason || '').includes('事件意义太小'), stage2Of(mNone).blockReason);

  // 旧缓存行无 trivial 键 → fail-open
  const mLegacy = mapper.mapStandardAnswers(baseAnswers('D', { choice: 'none', probabilities: { none: 0.4, event_empty_content: 0.35, token_ip_reuse: 0.2 } }), makeContext());
  check('B4 旧缓存行（四桶族无 trivial 键）→ fail-open 不因新桶翻转',
    !(stage2Of(mLegacy).blockReason || '').includes('事件意义太小'), stage2Of(mLegacy).blockReason);

  // 全域：E/W/B/D 都拦（限域 miss 会漏放——C184b 快狗案同判；W 票防误选由题面反锚负责）
  for (const cat of ['E', 'W', 'B', 'D']) {
    const m = mapper.mapStandardAnswers(baseAnswers(cat, { choice: 'event_trivial', probabilities: { event_trivial: 0.7, none: 0.2 } }), makeContext());
    check(`B5.${cat} 全域拦截（category=${cat}）`,
      (stage2Of(m).blockReason || '').includes('事件意义太小'), stage2Of(m).blockReason);
  }

  // 掷骰容忍：trivial argmax 但 none≥0.5 → 不拦（主门形状=blockChoice!=='none' && noneProb<0.5）
  const mDither = mapper.mapStandardAnswers(baseAnswers('D', { choice: 'event_trivial', probabilities: { event_trivial: 0.3, none: 0.55 } }), makeContext());
  check('B6 none≥0.5 时 trivial argmax 不拦（none 高=事件成立证据占优，与既有门同形状）',
    !(stage2Of(mDither).blockReason || '').includes('事件意义太小'), stage2Of(mDither).blockReason);

  console.log('\n── C. 源码口径 ──');
  check('C1 BLOCK_SCOPE 含 event_trivial: all（全域；C184b 同判）',
    /event_trivial: 'all',/.test(mapperSrc));
  check('C2 BLOCK_LABELS 含 event_trivial: 事件意义太小（argmax 拦截 label）',
    /event_trivial: '事件意义太小',/.test(mapperSrc));
  check('C3 C191 观察点接棒注释在场（大 IP+小事件 fit 派生 tier 无仲裁位 → 本桶接棒）',
    mapperSrc.includes('C191 币安传奇观察点①') || mapperSrc.includes('C191 币安传奇观察点'),
    null);
  check('C4 题集版本注释 J1.127/C231 段在场（含用户裁定原话与例证锚）',
    qsSrc.includes('J1.127（C231') && qsSrc.includes('0x46eaec0f') && qsSrc.includes('但事情本身意义很小'));
  check('C5 题集版本注释 J1.132/C235 段在场（NMS 误拦三轮掷骰取证+用户裁定原话）+ 版本 ≥ J1.132（J1.133=C236 W 资格形态一降档，C235 段不动）',
    qsSrc.includes('J1.132（C235') && qsSrc.includes('0xa9cb21aa') && qsSrc.includes('显然不算小，这是一个很有意思的事件')
    && parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 132, qm.JEV_QUESTIONS_VERSION);

  console.log(`\n══════ _test_event_trivial_gate: ${passed} passed, ${failed} failed ══════`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
