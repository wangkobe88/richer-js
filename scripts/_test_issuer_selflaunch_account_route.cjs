#!/usr/bin/env node
/**
 * C251 BIBIAIWork 案——发布者与代币同名 → 恒走账号路径（零 DB 零网络单测）
 *
 * 用户裁定（2026-10-27）：「如果提供的是账号，或者发布者跟代币一个名字，那么就
 * 得认为这是一个 Web3 项目/原生IP，除非账号影响力极大可以走 meme 路线，否则只能
 * 走账号路径。」
 * 案发现场：0x08be87804707fe0ebc86ef56d4bddb202c627777（BIBIAIWork，flap 税币）。
 * 语料=@BIBIaiwork（401 粉、0 赞 0 转、X 付费蓝标）第一人称宣告「AI 计算网络」
 * 功能清单；推文/官网均无 CA（官网内容未抓，websiteFetch 默认关）。detectIssuer-
 * SelfLaunch 双条件其实命中（品牌同一 bibiaiwork↔BIBIAIWork + 宣告指纹），但被
 * J1.68「有内容的推文」豁免放回标准路径 → event:W 概率 1.0 + W 资格轴 mid 0.55
 * （low 0.42 近 tie 掷骰）→ 47 分过 32 线 → 总分 60.6 mid → live v42 买入 10s
 * 后 -42.9% 全清（15 分钟 rug，官网已死）。
 *
 * 修复三件：
 * - 路由臂：shouldRouteToAccountCommunity 对 issuerSelfLaunch 无条件转账号路径
 *   （J1.68 有内容推文豁免对该臂废止；issuerCa 臂维持 J1.68）。
 * - 回落收口：analyzer C238b「地址核验失败回落标准路径 W」对同名臂失效——
 *   「只能走账号路径」，回落=自我陈述换考官重考（案发形状正是该回落会重开的洞）。
 * - 影响力极大例外：C117 双门既有（detectIssuerSelfLaunch ≥100 万粉不判 +
 *   superIP registry 短路强制标准路径），本测试锁其不被 C251 推翻。
 *
 * 用法：node scripts/_test_issuer_selflaunch_account_route.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${desc}`); }
  else { failed++; console.error(`  ✗ ${desc}\n      期望: ${e}\n      实际: ${a}`); }
}

(async () => {
  const { detectIssuerSelfLaunch, shouldRouteToAccountCommunity } =
    await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { performRulesValidation } =
    await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 案发现场数据（token_narrative 落库值逐字复刻）
  const ADDR = '0x08be87804707fe0ebc86ef56d4bddb202c627777';
  const bibiToken = { symbol: 'BIBIAIWork', name: 'BIBIAIWork', raw_api_data: { name: 'BIBIAIWork' } };
  const bibiTweet = {
    type: 'tweet',
    text: '使用你的币安AI钱包。BIBIAIWork 正在构建一个持续运行、结果可复验的 AI 计算网络。#BIBIAIWork #AI #BNBChain #AgenticAI',
    author_screen_name: 'BIBIaiwork',
    author_name: 'BIBIAIWork',
    author_followers_count: 401,
  };
  const bibiFetchResults = { twitterInfo: bibiTweet, classifiedUrls: {}, relatedAccounts: [] };

  console.log('== 1. detectIssuerSelfLaunch 现场命中（检出本身在旧代码就成立，案发=路由豁免） ==');
  const hit = detectIssuerSelfLaunch(bibiToken, { twitterInfo: bibiTweet });
  check('BIBIAIWork 现场：品牌同一+宣告指纹 → 命中', hit,
    { screenName: 'BIBIaiwork', symbol: 'BIBIAIWork' });
  check('同形状 ≥100 万粉 → null（C117 粉丝门维持=影响力极大走 meme 路线例外）',
    detectIssuerSelfLaunch(bibiToken, { twitterInfo: { ...bibiTweet, author_followers_count: 1000000 } }), null);
  check('彪弟形状（作者与币名不同一）→ null（J1.68 案例域不受影响）',
    detectIssuerSelfLaunch({ symbol: '彪弟', name: '彪弟' },
      { twitterInfo: { type: 'tweet', text: '我的新宠物取名彪弟', author_screen_name: '彪哥BiaoGe', author_name: '彪哥', author_followers_count: 50000 } }), null);

  console.log('== 2. 路由真值表：C251 无条件臂（旧 J1.68 形状=false 的翻转点） ==');
  check('有内容推文 + issuerSelfLaunch → true 账号路径（案发反证：旧形状 false 漏进 W mid）',
    shouldRouteToAccountCommunity({ fetchResults: bibiFetchResults, isProjectCoinResult: false, issuerDetected: true, issuerSelfLaunch: hit }), true);
  check('同形状 issuerSelfLaunch=null + issuerDetected=true → false（J1.68 issuerCa 臂存续）',
    shouldRouteToAccountCommunity({ fetchResults: bibiFetchResults, isProjectCoinResult: false, issuerDetected: true, issuerSelfLaunch: null }), false);
  check('无任何发行方信号 → false（标准路径）',
    shouldRouteToAccountCommunity({ fetchResults: bibiFetchResults, isProjectCoinResult: false, issuerDetected: false, issuerSelfLaunch: null }), false);
  check('账号级语料 → true（既有臂回归）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: { type: 'account' } }, isProjectCoinResult: false, issuerDetected: false, issuerSelfLaunch: null }), true);

  console.log('== 3. 账号路径内判：401 粉无 CA → stage=address（C251 后终局 low 不回落 W） ==');
  const rules = performRulesValidation(ADDR, 'BIBIAIWork', 'BIBIAIWork', {
    type: 'account',
    screen_name: 'BIBIaiwork',
    followers_count: 401,
    statuses_count: 12,
    verified: false,
    is_blue_verified: true,
    description: '一个由AI钱包驱动的算力调取任务奖励模型，使用AI 钱包进行交易策略压力测试',
  });
  check('401 粉（<500）账号质量未达标 ∧ 简介/推文无 CA → passed=false / stage=address',
    { passed: rules.passed, stage: rules.stage, addressVerified: rules.addressVerified },
    { passed: false, stage: 'address', addressVerified: false });
  const rulesCa = performRulesValidation(ADDR, 'BIBIAIWork', 'BIBIAIWork', {
    type: 'account',
    screen_name: 'BIBIaiwork',
    followers_count: 401,
    statuses_count: 12,
    verified: false,
    is_blue_verified: true,
    description: `BIBIAIWork CA: ${ADDR}`,
  });
  check('401 粉但简介公示 CA → passed=true / addressVerified=true（「提供 CA 还可以」臂照走）',
    { passed: rulesCa.passed, stage: rulesCa.stage, addressVerified: rulesCa.addressVerified },
    { passed: true, stage: 'passed', addressVerified: true });

  console.log('== 4. analyzer 接线源码口径断言（事故现场反证锁定） ==');
  const analyzerSrc = fs.readFileSync(
    path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  check('路由调用点透传 issuerSelfLaunch',
    analyzerSrc.includes('fetchResults, isProjectCoinResult, issuerDetected, issuerSelfLaunch,'), true);
  const fallbackMatch = analyzerSrc.match(/validationStage === 'address'[\s\S]{0,200}?&& !issuerSelfLaunch/);
  check('C238b 回落条件含 && !issuerSelfLaunch（同名臂不回落 W）', !!fallbackMatch, true);
  const routeFnSrc = fs.readFileSync(
    path.join(__dirname, '../src/narrative/analyzer/utils/narrative-utils.mjs'), 'utf8');
  const selfArmIdx = routeFnSrc.indexOf('if (issuerSelfLaunch) return true;');
  const j168Idx = routeFnSrc.indexOf("if (issuerDetected && !hasSubstantiveTweet) return true;");
  check('同名臂存在且位于 J1.68 issuerCa 臂之前', selfArmIdx > 0 && j168Idx > selfArmIdx, true);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
