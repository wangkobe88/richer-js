#!/usr/bin/env node
/**
 * 事件意义太小轴（C231 立门 → C244 拆出退役）——零 DB 零网络单测
 *
 * 2026-10-26 用户裁定（小西案 0x8aeb285c613993d90cf35d16453b478f8152777）：
 * 「误拦的代价大于漏放（代币被靠前的门拦住了，后续的门起不到作用，某种意义
 * 也是浪费）。把 event_trivial 单独拆出来作为一个锚，可以就叫
 * bsc_meme_user_think_event_too_trivial_for_meme。然后继续深化这个锚，但是
 * 暂时不让它影响代币的叙事分析结果。」
 *
 * 案史：J1.127/C231 立门（BLACKBELT 黄仁勋名誉黑带 0.97 用户裁定该拦）→ 24h
 * 内四次补丁全由 P<0.5 掷骰段误拦触发（C235 反锚⑤ NMS 0.30 / C240 反锚⑥ 火蚁
 * 0.46 / C241 反锚⑦ 밈 0.44 / C244 小西 0.34——全被陈述者低影响力带偏：小西案
 * 语料=462 粉载体+父推 73 浏览，token 创建比主推晚 38s「零传播」是时间结构必然）；
 * 三个正确拦（BLACKBELT 0.97 / BPC 南瓜营 0.94 / 虎扑股币 0.50）全在 ≥0.5 段。
 * 全量生产面：桶存活 <1 天拦 114 票、40%（46 票）在 P<0.5 掷骰段。
 *
 * 覆盖：
 *   A. 题面：impact 四桶（trivial 已拆）/ 观察题两桶在场 / 四维度对照组锚
 *      （黄仁勋✗CZ✓ / 虎扑✗腾讯✓ / 火蚁✓Solana✗ / 抽奖✗带梗✓）/
 *      评事件不评陈述者横切锚 / 既有反锚例证保留 / 与 empty 划界
 *   B. mapper 集成：旧形状（trivial argmax）重放全类别不拦 / 观察题答案不进
 *      blockAnswers / 审计 trivialProbeChoice/trivialProbeMass 恒落与旧行 null
 *   C. 源码口径：BLOCK_SCOPE.event_trivial=[] 显式空域 / label 保留 / C244 注释
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
function baseAnswers(cat, impact, probe) {
  const a = {
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
  if (probe) a.bsc_meme_user_think_event_too_trivial_for_meme = probe;
  return a;
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

  console.log('\n── A. 题面（J1.142/C244 拆出退役）──');
  check('A1 版本 ≥ J1.142（J1.142=C244 trivial 拆出退役+观察题；J1.141=C243 图片直连修正；J1.127=C231 立门）',
    parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 142, qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const impQ = q.bsc_meme_user_event_impact;
  check('A2 impact 题四桶（trivial 已拆出：none/empty/baseless/ip_reuse——不删桶 argmax 仍会从原题拦，拆出即净）',
    ['none', 'event_empty_content', 'event_baseless_speculation', 'token_ip_reuse'].every(k => impQ.criteria[k])
    && Object.keys(impQ.criteria).length === 4
    && !('event_trivial' in impQ.criteria), Object.keys(impQ.criteria));
  const probeQ = q.bsc_meme_user_think_event_too_trivial_for_meme;
  const ins = probeQ?.instructions ?? '';
  check('A3 观察题在场（用户钦定键名 bsc_meme_user_think_event_too_trivial_for_meme）两桶 too_trivial/not_too_trivial',
    probeQ?.type === 'choice'
    && Object.keys(probeQ.criteria).length === 2
    && 'too_trivial' in probeQ.criteria && 'not_too_trivial' in probeQ.criteria,
    probeQ ? Object.keys(probeQ.criteria) : '题缺失');
  check('A4 维度①主体圈内地位对照组：黄仁勋名誉黑带=太琐碎 / CZ 随手发帖=不算琐碎（名气世界级≠圈内地位）',
    ins.includes('黄仁勋获国际柔道联合会名誉黑带=太琐碎')
    && ins.includes('CZ 随手发帖=不算琐碎')
    && ins.includes('圈内符号级人物/机构')
    && ins.includes('注意力雷达')
    && ins.includes('礼节性荣誉、日常琐事、例行公事'), null);
  check('A5 维度②主体量级×动作性质对照组：虎扑站内股币=太琐碎 / 腾讯同款=恐怕不算（事务性动作依赖主体与币圈直连）',
    ins.includes('虎扑上线站内股币玩法=太琐碎')
    && ins.includes('换腾讯同款=恐怕不算')
    && ins.includes('垂直二线平台')
    && ins.includes('信号意义与讨论度'), null);
  check('A6 维度③生态归属对照组：火蚁经 flap=不算 / Solana 生态抗议=太琐碎（判据=BSC 买家自己是不是当事人）',
    ins.includes('火蚁运动经 flap 收税发币=不算琐碎')
    && ins.includes('换成 Solana 生态社区的抗议=太琐碎')
    && ins.includes('BSC meme 买家自己是不是当事人/利益相关方')
    && ins.includes('别的链生态社区自己的事')
    && ins.includes('影响全体币圈用户的共同事务'), null);
  check('A7 维度④玩梗空间对照组：币安纯任务抽奖=太琐碎 / 带玩梗空间=不算琐碎（任务参与≠meme 参与）',
    ins.includes('币安纯任务型抽奖=太琐碎')
    && ins.includes('自带玩梗空间=不算琐碎')
    && ins.includes('Binance Pumpkin Camp is Live!'), null);
  check('A8 横切锚=评事件不评陈述者（小西案病灶：无名载体+新鲜零互动不降事件分量；不按载体账号数据评）',
    ins.includes('评估对象=事件本身，不是陈述者')
    && ins.includes('不降低事件本身的分量')
    && ins.includes('当前零互动不算「无传播」')
    && ins.includes('不按载体账号数据评'), null);
  check('A9 既有反锚例证保留（拆出不停深化）：C235 纳斯达克行业信号级 / C240 火蚁切身 / C241 fourdotmemezh 方向信号（用户原话）',
    ins.includes('纳斯达克官网放出示例 tokenized stock')
    && ins.includes('例证 C240 火蚁')
    && ins.includes('Four.meme 主号 fourdotmemezh')
    && ins.includes('打招呼就够了，不需要什么战略陈述/合作内容'), null);
  check('A10 四维任一不算琐碎侧成立 → not_too_trivial；与「没有事件」划界（根基=没有事件归 empty_content）',
    ins.includes('四维任一「不算琐碎」侧成立')
    && ins.includes('根基=没有事件')
    && ins.includes('本题只判事件已成立但分量太小的形状'), null);

  console.log('\n── B. mapper 集成（拦截位退役 + 观察信号续采）──');
  // BLACKBELT 现场复刻形状（trivial 0.62 argmax）→ C244 后不再拦（D+strong_fit 走正常评分）
  const siteImpact = { choice: 'event_trivial', probabilities: { event_trivial: 0.62, none: 0.2, event_empty_content: 0.1 } };
  const mSite = mapper.mapStandardAnswers(baseAnswers('D', siteImpact), makeContext());
  const blkSite = stage2Of(mSite).blockReason || '';
  check('B1 旧形状重放（D 类 trivial 0.62 argmax，BLACKBELT 现场形状）→ 不再拦「事件意义太小」（C244 退役=误拦代价大于漏放）',
    !blkSite.includes('事件意义太小') && mSite.llmResult.rating !== 'low', { rating: mSite.llmResult.rating, blkSite });
  // 全类别都不拦（W 票反锚④豁免语义随桶退役——拦截本身没了）
  let allPass = true;
  for (const cat of ['E', 'W', 'B', 'D']) {
    const m = mapper.mapStandardAnswers(baseAnswers(cat, { choice: 'event_trivial', probabilities: { event_trivial: 0.7, none: 0.2 } }), makeContext());
    if ((stage2Of(m).blockReason || '').includes('事件意义太小')) allPass = false;
  }
  check('B2 全类别（E/W/B/D）trivial argmax 重放零拦截（显式空域，不限域不限类）', allPass, null);
  // 观察题答案不进 blockAnswers：too_trivial 0.95 也绝不拦
  const mProbe = mapper.mapStandardAnswers(baseAnswers('D', null, { choice: 'too_trivial', probabilities: { too_trivial: 0.95, not_too_trivial: 0.05 } }), makeContext());
  check('B3 观察题答案不进 blockAnswers（too_trivial 0.95 → 不拦；blockAnswers 只读 impact 键）',
    !((stage2Of(mProbe).blockReason || '')).includes('事件意义太小') && mProbe.llmResult.rating !== 'low',
    { rating: mProbe.llmResult.rating, blockReason: stage2Of(mProbe).blockReason });
  check('B4 审计投影恒落：trivialProbeChoice=too_trivial + trivialProbeMass=0.95（emptyContentMass 同款观察键）',
    stage2Of(mProbe).jev?.trivialProbeChoice === 'too_trivial'
    && stage2Of(mProbe).jev?.trivialProbeMass === 0.95,
    { c: stage2Of(mProbe).jev?.trivialProbeChoice, m: stage2Of(mProbe).jev?.trivialProbeMass });
  // 旧缓存行无观察题键 → null（fail-open 观察）；none 形状照旧放行
  const mNone = mapper.mapStandardAnswers(baseAnswers('D', { choice: 'none', probabilities: { none: 0.81, event_empty_content: 0.1, token_ip_reuse: 0.08 } }), makeContext());
  check('B5 旧行（无观察题键）→ trivialProbeChoice/Mass=null；none 0.81 放行零翻转',
    stage2Of(mNone).jev?.trivialProbeChoice == null && stage2Of(mNone).jev?.trivialProbeMass == null
    && !((stage2Of(mNone).blockReason || '')).includes('事件意义太小'),
    { c: stage2Of(mNone).jev?.trivialProbeChoice, m: stage2Of(mNone).jev?.trivialProbeMass });

  console.log('\n── C. 源码口径 ──');
  check('C1 BLOCK_SCOPE.event_trivial=[] 显式空域（J1.43/J1.82 先例：blockInScope 未知选项返回 true，只删键无效）',
    /event_trivial: \[\],/.test(mapperSrc) && !/event_trivial: 'all',/.test(mapperSrc), null);
  check('C2 BLOCK_LABELS 含 event_trivial: 事件意义太小（label 保留防未知选项 fallback 打裸键名；历史行 reason 展示照旧）',
    /event_trivial: '事件意义太小',/.test(mapperSrc), null);
  check('C3 C244 注释在场（误拦代价大于漏放 + 114 票/40% 掷骰段取证 + 恢复拦截须用户裁定）',
    mapperSrc.includes('误拦的代价大于漏放') && mapperSrc.includes('恢复拦截须用户裁定'), null);
  check('C4 题集版本注释 J1.142/C244 段在场（用户裁定原话 + 四维度对照组 + 审计键）',
    qsSrc.includes('J1.142（2026-10-26，C244 event_trivial 拆出退役）')
    && qsSrc.includes('误拦的代价大于漏放')
    && qsSrc.includes('0x8aeb285c'), null);
  check('C5 C231/C235/C240/C241 立门与补丁史注释保留（历史档案在 changelog，不随桶删除）',
    qsSrc.includes('J1.127（C231') && qsSrc.includes('J1.132（C235') && qsSrc.includes('J1.138'), null);

  console.log(`\n══════ _test_event_trivial_gate: ${passed} passed, ${failed} failed ══════`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
