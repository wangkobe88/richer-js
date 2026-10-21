#!/usr/bin/env node
/**
 * C83 快车道退役单测：superIP 注册表命中注入标准 Jev 路径 state
 * ——本地零 DB 零网络（buildJevState 行为断言 + 源码口径断言 + detectSuperIP 回归）
 *
 * 背景（bbbe2561 v20 体检，2026-10-17）：super_ip_fast 快车道「引用即 IP」——
 * BI 簇 6 票引用同一条 binance 推文全拿 S 级 84-86 分 high、6 票全亏（快车道
 * 10 票 9 亏净 -0.0085 BNB）；量级被 S40+时效15 代码喂饱；reason 不落库。
 * 用户裁定：快车道整体删除；registry 命中信息（认证事实行）注入标准路径
 * state，评分全归 Jev 题集，不加代码侧 tier 锚定。
 *
 * 覆盖：
 *   A. buildJevState 注入形状（corpus_author_identity 事实行 + corpus_author_identity_note 反混淆
 *      提示行；无 pre_scores 残留；不传命中时 bit-parity 红线——非 superIP
 *      票 state 逐字节不变，事故反证式锁定）
 *   B. 源码口径（analyzer 快车道分支删除 / 标准调用点注入 / mapper 函数
 *      不存在 / registry 三删除导出四保留导出 / credibleEventAnchor 可达）
 *   C. detectSuperIP 回归（作者备选臂 = C51 GMGN 并入语料的命中路径）
 *   D. 边界（注入 + twitterInfo=null 不 throw——旧快车道依赖 created_at 算时效）
 *
 * 用法：node scripts/_test_superip_standard_path.cjs
 */

'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const ROOT = resolve(__dirname, '..');

const run = async () => {
  const { buildJevState } = await import('../src/narrative/analyzer/llm/jev-state-builder.mjs');
  const { SUPER_IP_REGISTRY, detectSuperIP, isSuperIpTweetUrl, extractScreenNameFromUrl } = await import(
    '../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs'
  );
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  const FIXED_NOW = 1760000000000; // 固定时基：state 内 [TIME] 行确定性
  const tokenData = {
    address: '0x1111111111111111111111111111111111111111',
    symbol: 'TEST',
    name: '测试代币',
    raw_api_data: { name: '测试代币' },
  };
  // 全 null fetchResults：各 section builder 对 null 安全（已核实返回 '' /
  // 不产出段），state 只剩 header + PRECOMPUTED —— 断言聚焦注入行本身
  const nullFetch = {
    twitterInfo: null, websiteInfo: null, githubInfo: null, amazonInfo: null,
    extractedInfo: null, backgroundInfo: null, youtubeInfo: null, douyinInfo: null,
    tiktokInfo: null, bilibiliInfo: null, xiaohongshuInfo: null, instagramInfo: null,
    weixinInfo: null, binanceSquareInfo: null, accountSummary: null, relatedAccounts: null,
  };

  // ═══ A. buildJevState 注入形状 ═══
  console.log('\n── A. buildJevState 注入形状 ──');

  const binance = SUPER_IP_REGISTRY['binance'];
  const hit = buildJevState(tokenData, nullFetch, { superIPInfo: binance, now: FIXED_NOW });

  // A1 认证事实行（格式与快车道时代一致，Jev 见惯形状）
  check('A1 corpus_author_identity 事实行精确匹配',
    hit.state.includes('corpus_author_identity: 币安官方（institution/S级，全球最大加密交易所）'));

  // A2 反混淆提示行（BI 案防线：作者身份≠代币背书；只锁键名+关键词不锁全文）
  const noteLine = hit.state.split('\n').find(l => l.startsWith('corpus_author_identity_note:'));
  check('A2 corpus_author_identity_note 行存在且含「身份认证」「背书」关键词',
    !!noteLine && noteLine.includes('身份认证') && noteLine.includes('背书'),
    noteLine);

  // A3 评分锚零残留（用户裁定：不加代码侧 tier 锚定——事故反证式锁定）
  check('A3 state 无 super_ip_pre_scores / tierScore= 字样',
    !hit.state.includes('super_ip_pre_scores') && !hit.state.includes('tierScore='));

  // A4 不传命中：两行皆无
  const miss = buildJevState(tokenData, nullFetch, { now: FIXED_NOW });
  check('A4 不传 superIPInfo → 两行皆无',
    !miss.state.includes('corpus_author_identity:') && !miss.state.includes('corpus_author_identity_note:'));

  // A5 红线 bit-parity：非 superIP 票 state 与 null 命中逐字节一致，
  // 且整个 state 无 'super_ip' 子串（C83 前标准路径行为零扰动）
  const explicitNull = buildJevState(tokenData, nullFetch, { superIPInfo: null, now: FIXED_NOW });
  check('A5 bit-parity 红线：{now} 与 {superIPInfo:null,now} state 逐字节 ===',
    miss.state === explicitNull.state);
  check('A5b 非 superIP 票全 state 无 super_ip 子串',
    !miss.state.includes('super_ip'));

  // A6 注入行在 [PRECOMPUTED] 段内（「直接采信」块语义 = 事实非评分）
  const preIdx = hit.state.indexOf('[PRECOMPUTED]');
  const hitIdx = hit.state.indexOf('corpus_author_identity:');
  const noteIdx = hit.state.indexOf('corpus_author_identity_note:');
  check('A6 注入两行均在 [PRECOMPUTED] 段内',
    preIdx !== -1 && hitIdx > preIdx && noteIdx > preIdx);

  // ═══ B. 源码口径 ═══
  console.log('\n── B. 源码口径 ──');

  const analyzerSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  const mapperSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');

  // B1 快车道删除（分支/调用/timing 段三重不存在）
  check('B1 analyzer 无 mapSuperIPAnswers / jev.superip / calculatePreScores',
    !analyzerSrc.includes('mapSuperIPAnswers') && !analyzerSrc.includes('jev.superip')
    && !analyzerSrc.includes('calculatePreScores'));

  // B2 标准调用点注入形状（唯一 buildJevState 调用位）
  const callShape = 'buildJevState(tokenData, jevFetchResults, { superIPInfo, now: jevNowMs })';
  check('B2 标准路径调用点含 superIPInfo 注入',
    analyzerSrc.includes(callShape));
  check('B2b analyzer 内 buildJevState 调用恰 1 处（快车道调用点已删）',
    (analyzerSrc.match(/buildJevState\(tokenData, jevFetchResults/g) || []).length === 1);

  // B3 mapper 函数不存在（动态 import 探针 + 源码双口径）
  check('B3 mapper.mapSuperIPAnswers === undefined',
    mapper.mapSuperIPAnswers === undefined);
  check('B3b mapper 源码无 mapSuperIPAnswers / REFERENT_MEME_EXEMPT_MIN / referentMemeScore',
    !mapperSrc.includes('mapSuperIPAnswers') && !mapperSrc.includes('REFERENT_MEME_EXEMPT_MIN')
    && !mapperSrc.includes('referentMemeScore'));

  // B4 registry 导出形状：三删四留（保留方 = tweet-type-classifier 与 C51 data-fetch）
  const registry = await import('../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
  check('B4 registry 删 calculatePreScores/TIER_SCORES/calculateTimeliness',
    registry.calculatePreScores === undefined && registry.TIER_SCORES === undefined
    && registry.calculateTimeliness === undefined);
  check('B4b registry 留 SUPER_IP_REGISTRY/detectSuperIP/isSuperIpTweetUrl/extractScreenNameFromUrl',
    typeof registry.SUPER_IP_REGISTRY === 'object' && typeof registry.detectSuperIP === 'function'
    && typeof registry.isSuperIpTweetUrl === 'function' && typeof registry.extractScreenNameFromUrl === 'function');

  // B5 credibleEventAnchor 的 superIPInfo 项保留（C40 锚——删快车道后真实可达）
  check('B5 credibleEventAnchor 仍含 superIPInfo 项',
    analyzerSrc.includes('credibleEventAnchor: !!(superIPInfo ||'));

  // ═══ C. detectSuperIP 回归（作者备选臂 = C51 GMGN 并入语料命中路径）═══
  console.log('\n── C. detectSuperIP 回归 ──');

  const viaAuthor = detectSuperIP(null, { author_screen_name: 'binance' });
  check('C1 作者备选臂命中（binance → S 级 institution）',
    viaAuthor?.name === '币安官方' && viaAuthor?.tier === 'S' && viaAuthor?.type === 'institution');

  check('C2 未注册作者返回 null',
    detectSuperIP(null, { author_screen_name: 'RandomGuy1975' }) === null);

  const viaUrl = detectSuperIP('https://x.com/cz_binance/status/1234567890', null);
  check('C3 URL 臂命中（cz_binance → S 级 person）',
    viaUrl?.name === 'CZ（赵长鹏）' && viaUrl?.type === 'person');

  // ═══ D. 边界 ═══
  console.log('\n── D. 边界 ──');

  // D1 注入 + twitterInfo=null 不 throw（旧快车道依赖 twitterInfo.created_at 算时效，
  // 新路径无此依赖——null 语料票注入恒安全）
  let threw = null;
  try { buildJevState(tokenData, nullFetch, { superIPInfo: SUPER_IP_REGISTRY['cz_binance'], now: FIXED_NOW }); }
  catch (e) { threw = e.message; }
  check('D1 注入 + twitterInfo=null 不 throw', threw === null, threw);

  // D2 JEV_QUESTIONS_VERSION 已 bump（J1.42=C108 名字门统一四分支+block_misspelling 删题；J1.41=C107 name_form 收敛三选（meme_name/not_meme_name/unclear）；J1.40=C105 第四选（收敛后经兼容 Set 继续拦）；J1.39=C103 条件题 parent_relationship；J1.38=C98 event_negative_hard_news 题面扩政治暴力边界；J1.37=C96 F→E 改道+陈述句门两新题；J1.36=C93 resonance 判据源换 web3_user_event_fit；J1.35=C92 E类证据层级）
  const { JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  check('D2 JEV_QUESTIONS_VERSION === J1.80（J1.80=C138 超IP来源判据；J1.79 删 web3_user_event_impact 改 fit 单一事件分；J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity；J1.55=C124 圈内符号级锚；J1.54=C123 门名/题键语义化；J1.42=C108 名字门统一）', JEV_QUESTIONS_VERSION === 'J1.80', JEV_QUESTIONS_VERSION);

  // ═══ 汇总 ═══
  console.log(`\n═══ _test_superip_standard_path: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
};

run().catch(err => {
  console.error('❌ 测试执行异常:', err);
  process.exit(1);
});
