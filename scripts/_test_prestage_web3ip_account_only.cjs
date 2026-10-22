#!/usr/bin/env node
/**
 * C101 OK❌ 案修复二——web3_native_ip_early 仅限于账号语料（零 DB 零网络单测）
 *
 * 用户裁定（2026-10-18）：「web3_native_ip_early 仅限于账号」「这不是账号，这就
 * 是个推文」「这个也需要修」。挂链语料是一条推文（twitterInfo.type==='tweet'）
 * 时，「币本身即该账号的 IP」没有账号叙事承载——单条推文（含找角度宣告）不
 * 构成 web3ip，mapper 不采信该答案，回落 abm 双条件评定（两题恒带已答，零
 * 额外 Jev 调用）；账号/社区语料不受影响；project 不受限；corpusType 缺省
 * null=放行（存量调用/单测零影响）。版本 P1.10→P1.11（P1.3 先例：聚合语义
 * 变化须可按版本筛历史行）。
 *
 * 触发案 OK❌ 0x0195119e…7777：找角度推文宣告（@Notickernowif 0 粉 3 推）+
 * t.me/#CA 伪造 addressVerified → web3ip 0.96 → 粉丝带 mid → 买 -12.75%。
 * 修复一（URL 假 addressVerified，_test_isproject_coin_url_not_ca_hit）断源后
 * 该形状死在规则验证 stage='address'；本修复是第二道独立防线——即便 address
 * 验证侥幸为 true（如真宣告推文含 CA 的找角度票），推文语料也不得按 web3ip
 * 定档。
 *
 * 用法：node scripts/_test_prestage_web3ip_account_only.cjs
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
  const { mapPrestageAnswers } = await import('../src/narrative/analyzer/llm/jev-prestage-mapper.mjs');
  const { JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
  const fs = await import('node:fs');

  const callInfo = {
    model: 'test', questions: { q1: { type: 'choice' } }, stateStats: { totalChars: 10 },
    state: 'test-state', usage: {}, startedAt: '2026-10-18T00:00:00Z', finishedAt: '2026-10-18T00:00:01Z',
  };
  const account = (over = {}) => ({
    type: 'account', screen_name: 'acct', followers_count: 0, statuses_count: 3,
    created_at: '2026-10-17T00:00:00Z', ...over,
  });
  const ctx = (data, over = {}) => ({
    fullAccountOrCommunityData: data, addressVerified: true, rulesResult: null,
    callInfo, ...over,
  });
  // OK❌ 现场答案形状：web3ip 0.96（落库值）+ abm 两题无关联/无流量
  const okxAnswers = {
    prestage_token_type: { choice: 'web3_native_ip_early', probabilities: { web3_native_ip_early: 0.96 } },
    prestage_abm_name_link: { choice: 'none', probabilities: { none: 0.9 } },
    prestage_abm_web3_traffic: { choice: 'no_traffic', probabilities: { has_traffic: 0.05 } },
    prestage_community_activity: { choice: 'low', probabilities: { low: 0.7 } },
    // P1.14 恒带官网核验题：pass 臂（本测试只测 C101 改道语义）
    prestage_website_check: { choice: 'website_substantiates', probabilities: { website_substantiates: 0.9 } },
  };

  console.log('== 0. 版本 ==');
  check('P1.14（官网核验题）', JEV_PRESTAGE_QUESTIONS_VERSION, 'P1.14');

  console.log('== 1. OK❌ 事故反证（推文语料 web3ip 不采信） ==');
  const redirected = mapPrestageAnswers(okxAnswers, ctx(account(), { corpusType: 'tweet' }));
  check('tokenType 回落 account_based_meme', redirected.tokenType, 'account_based_meme');
  check('rating=low（abm：名称无关联+无流量）', redirected.rating, 'low');
  check('category 落 account_based_meme', redirected.prestageDataToSave.category, 'account_based_meme');
  check('parsed_output.addressVerified 事实保留 true', redirected.prestageDataToSave.parsed_output.addressVerified, true);
  check('jevDetails 观测键 web3ipRejectedCorpusType', redirected.jevDetails.web3ipRejectedCorpusType, 'tweet');
  check('promptType=P1.14/account_based_meme', redirected.promptType, 'prestage-jev(P1.14/account_based_meme)');
  check('reasoning 含 C101 改道说明', redirected.reasoning.includes('C101'), true);

  console.log('== 2. 回落通道语义（abm 双过 → mid） ==');
  const abmStrong = mapPrestageAnswers({
    ...okxAnswers,
    prestage_abm_name_link: { choice: 'exact', probabilities: { exact: 0.9 } },
    prestage_abm_web3_traffic: { choice: 'has_traffic', probabilities: { has_traffic: 0.8 } },
  }, ctx(account({ followers_count: 500 }), { corpusType: 'tweet' }));
  check('推文语料 web3ip + abm 双过 → mid（回落通道照常）', abmStrong.rating, 'mid');
  check('tokenType=account_based_meme', abmStrong.tokenType, 'account_based_meme');

  console.log('== 3. 账号/社区语料 web3ip 不受影响（回归） ==');
  const accountCorpus = mapPrestageAnswers(okxAnswers, ctx(account(), { corpusType: 'account' }));
  check('账号语料 0 粉 → web3ip mid（粉丝带只定档）', { t: accountCorpus.tokenType, r: accountCorpus.rating },
    { t: 'web3_native_ip_early', r: 'mid' });
  const communityData = { type: 'community', members_count: 50, statuses_count: 10 };
  const communityCorpus = mapPrestageAnswers(okxAnswers, ctx(communityData, { corpusType: 'community' }));
  check('社区语料 → web3ip mid', { t: communityCorpus.tokenType, r: communityCorpus.rating },
    { t: 'web3_native_ip_early', r: 'mid' });
  const nullCorpus = mapPrestageAnswers(okxAnswers, ctx(account()));
  check('corpusType 缺省 null → web3ip 照常（存量调用零影响）', nullCorpus.tokenType, 'web3_native_ip_early');

  console.log('== 4. 边界：project 与 addressVerified=false 不受限 ==');
  const projectTweet = mapPrestageAnswers({
    ...okxAnswers,
    prestage_token_type: { choice: 'project', probabilities: { project: 0.8 } },
  }, ctx(account(), { corpusType: 'tweet' }));
  check('推文语料 project 答案照常（仅 web3ip 受限）', { t: projectTweet.tokenType, r: projectTweet.rating },
    { t: 'project', r: 'mid' });
  const abmPlain = mapPrestageAnswers(okxAnswers, ctx(account(), { corpusType: 'tweet', addressVerified: false }));
  check('addressVerified=false 原路径不受影响（abm low）', { t: abmPlain.tokenType, r: abmPlain.rating },
    { t: 'account_based_meme', r: 'low' });
  check('原路径无改道观测键', abmPlain.jevDetails.web3ipRejectedCorpusType, undefined);

  console.log('== 5. 接线源码口径锁（corpusType 必须透传） ==');
  const svcSrc = fs.readFileSync('src/narrative/analyzer/services/account-analysis-service.mjs', 'utf8');
  check('account-analysis-service 透传 corpusType: twitterInfo?.type',
    svcSrc.includes('corpusType: twitterInfo?.type || null'), true);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
