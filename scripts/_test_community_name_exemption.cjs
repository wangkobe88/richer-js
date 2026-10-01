#!/usr/bin/env node
/**
 * 社区票名称豁免单测（C50 CZ 案，2026-10-01 用户裁定）
 * ——本地零 DB 零网络（直接 import performRulesValidation 纯函数本体打矩阵；
 *   模块顶层依赖链不触发 DB 初始化，实测 import 干净）
 *
 * 裁定原话：「如果社区中有地址，并且社区有数百人，基本够了」——
 *   字面名称匹配（精确/包含）对缩写/谐音/双关叙事结构性失明：
 *   CZ = Crypto for Gen Z 首尾缩写双关（"cz" 与 "cryptoforgenz" 无字面包含关系），
 *   jiaojiaojio（2.2 万粉）宣告帖定义叙事；社区含合约地址 = 最强归属绑定，
 *   名称关联与叙事价值交 prestage Jev（P1.2 名字关联题）。
 *   缩写匹配方案被否决（打补丁永远有下一种双关形态漏网），删拒因才是根治。
 *
 * 豁免条件（全中才过）：type=community × 地址验证过 × members_count ≥ 200
 * （200 = 「数百人」下界取整；本案 crypto for genz 实测 292 过线）
 *
 * 覆盖：
 *   A. 豁免矩阵（CZ 案数值锚定 / 门槛下界 / 边界 200 / 地址缺失 / 成员缺失）
 *   B. 非豁免路径零回归（account 侧不豁免 / 名称匹配票原路径 / 项目币 skip 分支）
 *   C. 源码口径（豁免分支存在性 + 门限值 + 只对 community）
 *
 * 用法：node scripts/_test_community_name_exemption.cjs
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
const ADDR = '0x7a848a5a8169aa6a2f603d056a749f924f504444'.toLowerCase();

// CZ 案真实形状：社区名 crypto for genz，symbol CZ 首尾缩写，推文含 CA
const czCommunity = {
  type: 'community',
  name: 'crypto for genz',
  description: 'crypto for genz',
  members_count: 292,
  moderators_count: 3,
  tweets: [{ tweet_id: '1', text: `The Final Form Bull $CZ ${ADDR}`, created_at: '2026-07-10T00:00:00Z' }]
};

const run = async () => {
  const { performRulesValidation } = await import(
    '../src/narrative/analyzer/prompts/account/account-community-rules.mjs'
  );

  // ═══ A. 豁免矩阵 ═══
  console.log('\n── A. 社区票名称豁免矩阵 ──');

  const a1 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull', czCommunity);
  check('A1 CZ 案形状翻案：passed=true（地址过+292 成员+名称不匹配）',
    a1.passed === true && a1.stage === 'community_address_members_pass', a1);
  check('A2 翻案行 addressVerified=true / nameMatch=false（字面不匹配如实记录）',
    a1.addressVerified === true && a1.nameMatch === false);
  check('A3 reason 含成员数与「交 Prestage」语义',
    /292/.test(a1.reason) && /Prestage/.test(a1.reason));
  check('A4 details 落 nameExempt 审计标记 + communityMembers',
    a1.details?.nameExempt === 'community_address_members' && a1.details?.communityMembers === 292);

  const a5 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull',
    { ...czCommunity, members_count: 199 });
  check('A5 199 成员（门槛下）维持名称拒',
    a5.passed === false && a5.stage === 'name', a5);

  const a6 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull',
    { ...czCommunity, members_count: 200 });
  check('A6 边界 200 成员过豁免（>=）',
    a6.passed === true && a6.stage === 'community_address_members_pass', a6);

  const a7 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull',
    { ...czCommunity, tweets: [{ tweet_id: '1', text: 'no address here', created_at: '2026-07-10T00:00:00Z' }] });
  check('A7 地址未命中（成员 292 也不豁免）维持地址拒',
    a7.passed === false && a7.stage === 'address', a7);

  const a8 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull',
    { ...czCommunity, members_count: undefined });
  check('A8 成员数缺失 fail-closed（0 < 200）维持名称拒',
    a8.passed === false && a8.stage === 'name', a8);

  // ═══ B. 非豁免路径零回归 ═══
  console.log('\n── B. 非豁免路径零回归 ──');

  // B1 account 侧不豁免：质量未达标账号（10 粉 2 推）+ 地址命中 + 名称不匹配 → 名称拒
  const b1 = performRulesValidation(ADDR, 'XYZ', 'Some Token', {
    type: 'account',
    screen_name: 'someacct',
    name: 'Some Account',
    description: '',
    followers_count: 10,
    statuses_count: 2,
    verified: false,
    is_blue_verified: false,
    tweets: [{ tweet_id: '1', text: `addr ${ADDR}`, created_at: '2026-07-10T00:00:00Z' }]
  });
  check('B1 account 侧名称不匹配仍拒（豁免只对 community）',
    b1.passed === false && b1.stage === 'name', b1);

  // B2 社区名称匹配票走原「全部通过」路径（不经豁免分支）
  const b2 = performRulesValidation(ADDR, 'CFG', 'crypto for genz', czCommunity);
  check('B2 名称精确匹配社区票走原 passed 路径（stage=passed 非 stage=community_address_members_pass）',
    b2.passed === true && b2.stage === 'passed' && b2.nameMatch === true, b2);

  // B3 账号质量达标 + 地址命中零回归（500 粉 + 20 推 → account_quality_address_found）
  const b3 = performRulesValidation(ADDR, 'SOMEACCT', 'Some Account', {
    type: 'account',
    screen_name: 'someacct',
    name: 'Some Account',
    description: '',
    followers_count: 500,
    statuses_count: 20,
    verified: false,
    is_blue_verified: false,
    tweets: [{ tweet_id: '1', text: `addr ${ADDR}`, created_at: '2026-07-10T00:00:00Z' }]
  });
  check('B3 账号质量达标分支零回归（account_quality_address_found）',
    b3.passed === true && b3.stage === 'account_quality_address_found', b3);

  // B4 项目币 skipAddressValidation 分支零回归
  const b4 = performRulesValidation(ADDR, 'CZ', 'The Final Form Bull', czCommunity,
    { skipAddressValidation: true });
  check('B4 项目币 skip 分支零回归（project_coin_website_verified，名称仍只记录）',
    b4.passed === true && b4.stage === 'project_coin_website_verified', b4);

  // ═══ C. 源码口径 ═══
  console.log('\n── C. 源码口径 ──');
  const src = readFileSync(resolve(ROOT,
    'src/narrative/analyzer/prompts/account/account-community-rules.mjs'), 'utf8');
  check('C1 豁免门限常量 200（「数百人」下界，本案 292 过线）',
    /COMMUNITY_NAME_EXEMPT_MIN_MEMBERS = 200/.test(src));
  check('C2 豁免限 type === \'community\'（account 侧不受影响）',
    /type === 'community'/.test(src) && /COMMUNITY_NAME_EXEMPT_MIN_MEMBERS/.test(src));
  check('C3 豁免以 addressResult.found 为前提（地址是最强归属绑定）',
    /addressResult\.found/.test(src) && /COMMUNITY_NAME_EXEMPT_MIN_MEMBERS/.test(src));
  check('C4 原名称拒分支保留（门槛外形状照常拒）',
    /stage: 'name'/.test(src));

  console.log(`\n══════ _test_community_name_exemption: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(e => { console.error('单测执行失败:', e); process.exit(1); });
