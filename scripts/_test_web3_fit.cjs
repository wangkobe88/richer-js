#!/usr/bin/env node
/**
 * Web3 用户偏好判断层（web3_user_event_fit 题 + video_unrated 爆款短路收窄）——本地零 DB 单测
 * （J1.19，2026-09-29 用户裁定，C30 死亡观察员/太阳之勤案）
 *
 * 覆盖：
 *   A. 问卷形状：web3_user_event_fit 题存在（choice 四档 strong_fit/fit/marginal/unfit）、
 *      版本号 J1.19、name_brand_hijack 条件题互不影响
 *   B. mapStandardAnswers 路由矩阵：死亡观察员形状（E 类爆款事件分过线 +
 *      unfit 0.72 → rating low + reason 含「Web3用户偏好不合」P=0.72）/
 *      unfit 0.3 放行对照 / 边界 0.5 拦 0.49 放 / 概率缺失放（miss 不误拦）/
 *      nhn 门优先级在前 / stage1+stage2 概率落库审计（probabilities.web3_user_event_fit、
 *      web3UnfitMass）
 *   D. performPreCheck 规则 3 收窄：爆款+有推文文本或视频标题任一非空 → null
 *      （C83 起 superIP 语料票同走标准路径，本门对 superIP 票经同一 mapper 可达）
 *      （进 Jev，C31 Training season/显化之歌案二次收窄——标题也算语料）/
 *      爆款+两者皆空 → mid 短路（video_unrated 原行为）/ 非爆款 → null（原行为）
 *
 * 用法：node scripts/_test_web3_fit.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C30 死亡观察员案形状（DB 实证：E 类抖音爆款 44.7 万赞，事件分可过线）─────────
const tokenData = { symbol: '死亡观察员', name: '死亡观察员', raw_api_data: { name: '死亡观察员' } };

// E 类 + B 档量级（平台级热点爆款：点赞 50 万+）+ within_7d + dim2 高分 → 事件分 27+25+15=67 ≥60 过线
function makeAnswers(web3FitProbs) {
  const answers = {
    event_category: { choice: 'E', probabilities: { E: 0.62, C: 0.2, F: 0.1 } },
    event_magnitude: { score: 3.5, probabilities: { '3': 0.5, '4': 0.3 } }, // B 档
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 4.1, probabilities: { '4': 0.5, '5': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.9, event_empty_content: 0.1 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.85, unknown: 0.15 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.75, semantic: 0.2 } },
    relevance_level: { score: 3.6, probabilities: { '3': 0.4, '4': 0.5 } },
    block_misspelling: { noul: 0.05 },
    quality_spelling: { score: 2.8 },
    quality_reasonability: { score: 1.7 },
  };
  if (web3FitProbs) answers.web3_user_event_fit = { choice: 'unfit', probabilities: web3FitProbs };
  return answers;
}

function makeContext(td, answers, twitterInfo) {
  return {
    tokenData: td,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: twitterInfo || null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.19 第 14 题，版本随问题集 bump）──');
  const qs = buildStandardQuestions();
  check('A1 版本号 ≥ J1.21（随问题集 bump 不回退）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 21, JEV_QUESTIONS_VERSION);
  const w3q = qs.web3_user_event_fit;
  check('A2 web3_user_event_fit 题存在且 type=choice', !!w3q && w3q.type === 'choice', w3q?.type);
  check('A3 四档选项齐全', w3q && ['strong_fit', 'fit', 'marginal', 'unfit'].every(k => typeof w3q.criteria[k] === 'string' && w3q.criteria[k].length > 0), w3q ? Object.keys(w3q.criteria) : null);
  check('A4 题面含买家画像与判据说明', w3q && w3q.instructions.includes('链上买家画像') && w3q.instructions.includes('玩梗'), null);
  const qsNoBrand = buildStandardQuestions({ includeBrandHijack: false });
  const qsBrandMismatch = buildStandardQuestions({ brandMismatch: true });
  check('A5 品牌题已退役（任何题集都不含 name_brand_hijack；品牌信号仅在关键词票实体题 brand_mismatch 桶）',
    !('name_brand_hijack' in qsNoBrand) && !('name_brand_hijack' in qs)
      && !('brand_mismatch' in qs.web3_user_name_entity_acceptance.criteria)
      && !!qsBrandMismatch.web3_user_name_entity_acceptance?.criteria?.brand_mismatch
      && 'web3_user_event_fit' in qsNoBrand, null);
  check('A6 J1.90/C152 圈内平台/项目核心开发者本人表态锚（eth_cedric MEMES 案）',
    w3q.instructions.includes('圈内平台/项目官方账号或核心开发者本人的公开表态/口号')
    && w3q.instructions.includes('Memes will continue')
    && w3q.instructions.includes('至少 fit')
    && w3q.criteria.fit.includes('至少本档')
    && w3q.criteria.strong_fit.includes('J1.90/C152'), null);
  {
    const fs = require('fs');
    const path = require('path');
    const stateSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-state-builder.mjs'), 'utf8');
    check('A7 J1.90/C152 author identity note 作用域澄清（仅约束实体题，fit 题可按发言者身份判）',
      stateSrc.includes('本约束仅针对币名映射实体题，web3_user_event_fit 可按发言者身份判事件与 web3 用户的契合'), null);
  }

  // ═══ B. mapStandardAnswers 路由矩阵 ═══
  console.log('\n── B. 标准路径 web3_user_event_fit 质量门矩阵 ──');

  // B1 死亡观察员形状：unfit 0.72 → 拦
  const r1 = mapStandardAnswers(makeAnswers({ unfit: 0.72, marginal: 0.12, fit: 0.1, strong_fit: 0.06 }), makeContext(tokenData));
  check('B1 unfit 0.72 → rating low', r1.llmResult.rating === 'low', r1.llmResult);
  check('B2 reason 含「Web3用户偏好不合」+ P=0.72', r1.llmResult.reason.includes('Web3用户偏好不合') && r1.llmResult.reason.includes('0.72'), r1.llmResult.reason);
  check('B3 stage2 blockReason 同标签', r1.stage2DataToSave.parsed_output.blockReason === 'Web3用户偏好不合', r1.stage2DataToSave.parsed_output.blockReason);
  check('B4 stage2 审计 web3UnfitMass=0.72', r1.stage2DataToSave.parsed_output.jev.web3UnfitMass === 0.72, r1.stage2DataToSave.parsed_output.jev.web3UnfitMass);
  check('B5 stage1 概率落库 probabilities.web3_user_event_fit', r1.stage1DataToSave.parsed_output.jev.probabilities.web3_user_event_fit?.unfit === 0.72, r1.stage1DataToSave.parsed_output.jev.probabilities.web3_user_event_fit);

  // B6 同形状 unfit 0.3（fit 为主）→ 不因偏好拦，评分正常走
  // J1.79：事件分=strong_fit+fit 质量——fit 质量须 ≥0.6 才不被事件分不足另拦
  //（旧 fit 0.58 形状在新口径下 58<60 会由事件分门拦，非本门；隔离被测轴）
  const r2 = mapStandardAnswers(makeAnswers({ unfit: 0.3, fit: 0.62, marginal: 0.05, strong_fit: 0.03 }), makeContext(tokenData));
  check('B6 unfit 0.3 → 不因偏好拦（rating 非 low；J1.79 fit 质量 0.65 过事件分线）', r2.llmResult.rating !== 'low', r2.llmResult);
  check('B6b 审计 web3UnfitMass=null（未拦）', r2.stage2DataToSave.parsed_output.jev.web3UnfitMass === null, r2.stage2DataToSave.parsed_output.jev.web3UnfitMass);

  // B7/B8 边界：0.5 拦，0.49 放
  const r3 = mapStandardAnswers(makeAnswers({ unfit: 0.5, marginal: 0.3, fit: 0.2 }), makeContext(tokenData));
  check('B7 边界 unfit=0.5 → 拦（≥0.5 语义）', r3.llmResult.rating === 'low' && r3.llmResult.reason.includes('Web3用户偏好不合'), r3.llmResult.reason);
  const r4 = mapStandardAnswers(makeAnswers({ unfit: 0.49, marginal: 0.31, fit: 0.2 }), makeContext(tokenData));
  // B8 只锁 web3UnfitBlock 阈值轴（0.49<0.5 不拦）：该 fixture 是 E 类且 fit mass
  // 0.2<0.5，J1.36 共振折损（C93）会把总分砍半致「事件分不足」拦——那是折损
  // 轴的正确行为非本门漏拦，断言按 B9 模式隔离被测轴
  check('B8 边界 unfit=0.49 → web3UnfitBlock 不拦（0.49<0.5 阈值下界；E 类低 fit mass 票由 J1.36 折损另拦）',
    !((r4.llmResult.reason || '').includes('Web3用户偏好不合')), r4.llmResult.reason);

  // B9 概率缺失（JevClient 缺 answer 会 throw，到 mapper 的一般是完整集；miss 不误拦）
  const r5 = mapStandardAnswers(makeAnswers(null), makeContext(tokenData));
  check('B9 web3_user_event_fit 答案缺失 → 不拦（?? 0 兜底）', r5.llmResult.rating !== 'low' || !r5.llmResult.reason.includes('Web3用户偏好不合'), r5.llmResult.reason);

  // B10 nhn 门退役反证（J1.101/C170）：旧形状 nhn 0.6 不再拦——同票 unfit 0.7
  // 接管拦截，label 归属口味层（负面事件交 web3 契合度处理的裁定落点）
  const nhnAnswers = makeAnswers({ unfit: 0.7, fit: 0.3 });
  nhnAnswers.event_quality_veto = { choice: 'none', probabilities: { none: 0.3, event_negative_hard_news: 0.6, event_empty_content: 0.1 } };
  const r6 = mapStandardAnswers(nhnAnswers, makeContext(tokenData));
  check('B10 nhn 0.6 退役不拦 + unfit 0.7 接管（reason=Web3用户偏好不合 非 负面硬新闻）',
    r6.llmResult.rating === 'low' && r6.llmResult.reason.includes('Web3用户偏好不合') && !r6.llmResult.reason.includes('负面硬新闻'), r6.llmResult.reason);

  // B11 对照组：同形状无偏好门概念时事件分确实过线（证明拦的是偏好门不是量级）
  const r7 = mapStandardAnswers(makeAnswers({ fit: 0.9, strong_fit: 0.1 }), makeContext(tokenData));
  const s2r = r7.stage2DataToSave.parsed_output;
  check('B11 对照组事件分 ≥60 过线（拦的是偏好门）', s2r.scoringResult.eventCompositeScore >= 60 && s2r.pass === true, { totalScore: s2r.scoringResult.eventCompositeScore, pass: s2r.pass });

  // ═══ C 段已删（C83）：mapSuperIPAnswers 快车道同门矩阵随通道删除——superIP
  // 语料票现走标准路径，本门（B 段矩阵）对 superIP 票经同一 mapStandardAnswers 可达 ═══

  // ═══ D. performPreCheck 规则 3 收窄（J1.19 收窄 + C31 二次收窄：推文文本或视频标题任一非空进 Jev）═══
  console.log('\n── D. video_unrated 爆款短路收窄 ──');
  // 参数避开口径依赖：无 created_at（同名/过期检查跳过）+ ignoreExpired（规则2跳过）
  const baseToken = { symbol: '死亡观察员', name: '死亡观察员', raw_api_data: { name: '死亡观察员' } };
  const nowIso = new Date().toISOString();
  const makeTwitter = (text) => ({
    type: 'tweet', text,
    author_screen_name: 'testuser', author_followers_count: 74, created_at: nowIso,
  });
  const urls = { twitter: [{ url: 'https://x.com/i/web/status/1', type: 'tweet', platform: 'twitter', priority: 1 }] };
  const viralDouyin = { type: 'video', title: 'AI短片', like_count: 446981, view_count: 0, create_time: nowIso };
  // C31 Training season 形状对照：fetcher 未带 title（或 title 空串）→ 语料真不可读，维持短路
  const viralDouyinNoTitle = { type: 'video', like_count: 446981, view_count: 0, create_time: nowIso };
  const viralDouyinBlankTitle = { type: 'video', title: '   ', like_count: 446981, view_count: 0, create_time: nowIso };

  // D1 爆款 + 有推文文本 → null（进 Jev，收窄生效）
  const d1 = await performPreCheck(baseToken, makeTwitter('抖音最新爆火AI短片，点赞破50万'), { twitter_url: 'https://x.com/i/web/status/1' }, null, urls, { douyinInfo: viralDouyin }, null, null, { ignoreExpired: true });
  check('D1 爆款+有文本 → null 进 Jev（收窄生效）', d1 === null, d1);

  // D2 爆款 + 推文文本为空串 + 无标题 → 维持 mid 短路
  const d2 = await performPreCheck(baseToken, makeTwitter('   '), { twitter_url: 'https://x.com/i/web/status/1' }, null, urls, { douyinInfo: viralDouyinNoTitle }, null, null, { ignoreExpired: true });
  check('D2 爆款+空文本+无标题 → mid 短路 video_unrated（原行为）', d2 && d2.rating === 'mid' && d2.details.ruleName === 'video_unrated' && d2.pass === true, d2);

  // D2b 爆款 + 空文本 + title 为空白串 → 同无标题（trim 判空生效）
  const d2b = await performPreCheck(baseToken, makeTwitter('   '), { twitter_url: 'https://x.com/i/web/status/1' }, null, urls, { douyinInfo: viralDouyinBlankTitle }, null, null, { ignoreExpired: true });
  check('D2b 爆款+空文本+空白标题 → mid 短路（trim 判空）', d2b && d2b.rating === 'mid' && d2b.details.ruleName === 'video_unrated', d2b);

  // D3 爆款 + 无 twitterInfo + 无标题 → 维持 mid 短路（无推文只有视频链接型）
  const d3 = await performPreCheck(baseToken, null, { twitter_url: 'https://v.douyin.com/xxx' }, null, { douyin: [{ url: 'https://v.douyin.com/xxx', type: 'video', platform: 'douyin', priority: 1 }] }, { douyinInfo: viralDouyinNoTitle }, null, null, { ignoreExpired: true });
  check('D3 爆款+无推文+无标题 → mid 短路（无语料可读型）', d3 && d3.rating === 'mid' && d3.details.ruleName === 'video_unrated', d3);

  // D5 爆款 + 无 twitterInfo + 有视频标题 → null 进 Jev（C31 Training season/显化之歌案：
  // 抖音链接票无推文文本，但 title「Dua Lipa的显化之歌…」完整描述内容类型，Jev 凭标题可判 web3_user_event_fit）
  const d5 = await performPreCheck(baseToken, null, { twitter_url: 'https://v.douyin.com/xxx' }, null, { douyin: [{ url: 'https://v.douyin.com/xxx', type: 'video', platform: 'douyin', priority: 1 }] }, { douyinInfo: viralDouyin }, null, null, { ignoreExpired: true });
  check('D5 爆款+无推文+有标题 → null 进 Jev（C31 二次收窄生效）', d5 === null, d5);

  // D6 爆款 + 空文本 + 有标题 → null 进 Jev（文本空但标题非空，任一非空即进）
  const d6 = await performPreCheck(baseToken, makeTwitter('   '), { twitter_url: 'https://x.com/i/web/status/1' }, null, urls, { douyinInfo: viralDouyin }, null, null, { ignoreExpired: true });
  check('D6 爆款+空文本+有标题 → null 进 Jev', d6 === null, d6);

  // D7 TikTok 平台标题字段是 description（fetcher 无 title；video-section 同款口径）→
  // 有 description 进 Jev / 无 description 维持短路
  const viralTikTok = { type: 'video', description: 'manifestation song gone viral', like_count: 0, view_count: 600000 };
  const d7 = await performPreCheck(baseToken, null, { twitter_url: 'https://www.tiktok.com/@a/video/1' }, null, { tiktok: [{ url: 'https://www.tiktok.com/@a/video/1', type: 'video', platform: 'tiktok', priority: 1 }] }, { tiktokInfo: viralTikTok }, null, null, { ignoreExpired: true });
  check('D7 TikTok 爆款+有description → null 进 Jev（titleField=description）', d7 === null, d7);
  const viralTikTokNoDesc = { type: 'video', like_count: 0, view_count: 600000 };
  const d7b = await performPreCheck(baseToken, null, { twitter_url: 'https://www.tiktok.com/@a/video/1' }, null, { tiktok: [{ url: 'https://www.tiktok.com/@a/video/1', type: 'video', platform: 'tiktok', priority: 1 }] }, { tiktokInfo: viralTikTokNoDesc }, null, null, { ignoreExpired: true });
  check('D7b TikTok 爆款+无description → mid 短路', d7b && d7b.rating === 'mid' && d7b.details.ruleName === 'video_unrated', d7b);

  // D4 非爆款 → null（原有行为不变，进 Jev）
  const nonViral = { ...viralDouyin, like_count: 99999, view_count: 0 };
  const d4 = await performPreCheck(baseToken, makeTwitter('普通视频'), { twitter_url: 'https://x.com/i/web/status/1' }, null, urls, { douyinInfo: nonViral }, null, null, { ignoreExpired: true });
  check('D4 非爆款 → null 进 Jev（原行为）', d4 === null, d4);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_web3_fit: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
