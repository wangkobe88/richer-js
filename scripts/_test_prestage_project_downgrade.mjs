/**
 * prestage 账号基本面门删除单测（P1.10，C70 bunker 案，2026-10-15 用户裁定）
 *
 * 「交易者不会因为项目方粉丝少/账号新/推文少拒绝一个项目」——粉丝底线 <20、
 * 推文 <5、账号年龄 <30 天三道门 + P1.5 实度豁免全删；粉丝/成员数只定档：
 * 账号 0-299 mid / ≥300 high，社区 ≥100 且活跃 high / 其余 mid，均不拦截。
 *
 * 覆盖：
 * 1. bunker 事故现场反证（0x2ec1e08c…7777：当天新号 2 粉 4 推 → 双路径 mid）
 * 2. 历史案形状回归（x-0 C15 / WIRED C35 删门后走向）
 * 3. 粉丝带定档边界（299/300、社区 99/100×活跃度矩阵）
 * 4. 输入不再消费锁定（改 statuses_count/created_at/多传实参 → rating 不变）
 * 5. mapPrestageAnswers 全链（P1.10 promptType / jevDetails 无 downgrade 键 /
 *    abm/web3ip/project 三分支 shape）
 */
import { rateProject, mapPrestageAnswers } from '../src/narrative/analyzer/llm/jev-prestage-mapper.mjs';
import { buildPrestageQuestions, JEV_PRESTAGE_QUESTIONS_VERSION } from '../src/narrative/analyzer/llm/jev-prestage-questions.mjs';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// bunker 案形状（0x2ec1e08c…7777，flap 2026-10-15 07:20 创建，21 分钟毕业）：
// @bunkeronbnb 发币后 5s 首析快照：2 粉、4 推、当天 04:26 注册（3h 新号）——
// P1.9 下 project 路径「粉丝 2<20 底线」拦 low；P1.10 只定档不拦截
const BUNKER = {
  type: 'account', followers_count: 2, statuses_count: 4,
  created_at: 'Thu Oct 15 04:26:00 +0000 2026', verified: false, is_blue_verified: false,
};
const BUNKER_TOKEN_AT = new Date('2026-10-15T07:20:16Z').getTime() / 1000;

// x-0 案形状（C15）：131 粉、11 天号、1 条推文——P1.3 下信用降档 low；
// P1.10 下 131 粉 → mid（信用由 CA 验证+nameMatch 承担）
const X0 = {
  type: 'account', followers_count: 131, statuses_count: 1,
  created_at: 'Mon Sep 15 08:00:00 +0000 2026', verified: false, is_blue_verified: true,
};
const X0_TOKEN_AT = new Date('2026-09-26T12:02:17Z').getTime() / 1000;

console.log('== 1. bunker 事故现场反证（C70）==');
// project 路径：2 粉 4 推 3h 新号 → mid（旧：low 底线拦）
let r = rateProject(BUNKER, null);
check('bunker project 形状（2粉4推当天号）→ mid（不再拦）', { rating: r.rating, met: r.baselineMet },
  { rating: 'mid', met: true });
// web3ip 路径（ratingLabel 差异）：同数据同结论
r = rateProject(BUNKER, null, { ratingLabel: '账号基本面评级' });
check('bunker web3ip 形状 → mid（双路径一致）', r.rating, 'mid');
check('reason 标注定档不拦截', r.reason.includes('粉丝带只定档不拦截'), true);
check('reason 用 ratingLabel', r.reason.startsWith('账号基本面评级：'), true);
// 0 粉（比底线更极端）：仍 mid——存在性下限一并删除
r = rateProject({ ...BUNKER, followers_count: 0 }, null);
check('0 粉 → mid（底线存在性下限同删）', { rating: r.rating, met: r.baselineMet }, { rating: 'mid', met: true });

console.log('== 2. 历史案形状回归 ==');
// x-0（C15 降档案形状）：131 粉 → mid（不再降档 low）
r = rateProject(X0, null);
check('x-0 形状（131粉 11天号 1推）→ mid（降档已删）', r.rating, 'mid');
// WIRED（C35 实度豁免案形状）：1041 粉 → high（豁免逻辑已删，纯粉丝带直达）
const WIRED = {
  type: 'account', followers_count: 1041, statuses_count: 109,
  created_at: new Date((X0_TOKEN_AT + 15 * 60) * 1000).toUTCString().replace('GMT', '+0000'),
  verified: true, is_blue_verified: true,
};
r = rateProject(WIRED, null);
check('WIRED 形状（1041粉 0天号）→ high（纯粉丝带）', r.rating, 'high');

console.log('== 3. 粉丝带定档边界 ==');
// 账号 299/300
r = rateProject({ ...X0, followers_count: 299 }, null);
check('299 粉 → mid', r.rating, 'mid');
r = rateProject({ ...X0, followers_count: 300 }, null);
check('300 粉 → high（≥ 语义）', r.rating, 'high');
// 社区矩阵：99/100 × high/medium/low/null
r = rateProject({ type: 'community', members_count: 99 }, 'high');
check('社区 99 成员活跃 → mid', r.rating, 'mid');
r = rateProject({ type: 'community', members_count: 100 }, 'high');
check('社区 100 成员活跃 → high', r.rating, 'high');
r = rateProject({ type: 'community', members_count: 100 }, 'medium');
check('社区 100 成员不活跃 → mid', r.rating, 'mid');
r = rateProject({ type: 'community', members_count: 500 }, null);
check('社区 500 成员活跃度缺失 → mid（宁 mid 不冒充 high）', r.rating, 'mid');
// 社区 <20 不再拦（旧底线分支删除的机器证明）
r = rateProject({ type: 'community', members_count: 5 }, 'low');
check('社区 5 成员 → mid（底线分支已删）', { rating: r.rating, met: r.baselineMet }, { rating: 'mid', met: true });

console.log('== 4. 输入不再消费锁定（防回流）==');
// 只改 statuses_count（旧 P1.3 推文项）/ created_at（旧年龄项）→ rating 不变
const base = rateProject(X0, null).rating;
check('statuses_count 1→500 rating 不变', rateProject({ ...X0, statuses_count: 500 }, null).rating, base);
check('created_at 当天→2020 rating 不变',
  rateProject({ ...X0, created_at: 'Wed Jan 01 08:00:00 +0000 2020' }, null).rating, base);
check('created_at 缺失 rating 不变', rateProject({ ...X0, created_at: null }, null).rating, base);
check('verified/blue 不影响 rating', rateProject({ ...X0, verified: true }, null).rating, base);
// 多传旧实参（第三参数字 = 旧 tokenCreatedAtSec 位、第四参 = 旧实度分位）：
// 新签名第三参是 opts 对象，传数字会落 opts.ratingLabel 无效但 rating 不变——
// 旧调用方若漏改不会改变评级方向（防御性锁定）
check('第三参传数字（旧调用残留）→ rating 不变',
  rateProject({ ...X0, followers_count: 500 }, null, X0_TOKEN_AT).rating, 'high');

console.log('== 5. mapPrestageAnswers 全链（P1.10）==');
const answers = {
  prestage_token_type: { choice: 'project', probabilities: { project: 0.8 } },
  prestage_abm_name_link: { choice: 'exact', probabilities: { exact: 0.9 } },
  prestage_abm_web3_traffic: { choice: 'no_traffic', probabilities: { has_traffic: 0.1 } },
  prestage_community_activity: { choice: null, probabilities: {} },
};
const callInfo = {
  model: 'test', questions: { q1: { type: 'choice' } }, state: 's', stateStats: { totalChars: 1 },
  usage: {}, startedAt: 't0', finishedAt: 't1',
};
// project 分支：bunker 形状 → mid + P1.10 promptType + jevDetails 无 downgrade/qualityExempt
const mapped = mapPrestageAnswers(answers, {
  fullAccountOrCommunityData: BUNKER,
  addressVerified: true,
  rulesResult: { nameMatch: true },
  callInfo,
});
check('bunker 全链 project → mid + promptType P1.10', { rating: mapped.rating, pt: mapped.promptType },
  { rating: 'mid', pt: `prestage-jev(P1.10/project)` });
check('jevDetails 无 downgrade/qualityExempt 键',
  { dg: 'downgrade' in mapped.jevDetails, qe: 'qualityExempt' in mapped.jevDetails },
  { dg: false, qe: false });
check('category=project', mapped.tokenType, 'project');
// context 带旧键 tokenCreatedAtSec（旧调用残留）→ 被忽略不炸
const mappedLegacyCtx = mapPrestageAnswers(answers, {
  fullAccountOrCommunityData: BUNKER,
  addressVerified: true,
  rulesResult: { nameMatch: true },
  tokenCreatedAtSec: BUNKER_TOKEN_AT,
  callInfo,
});
check('context 残留 tokenCreatedAtSec → 忽略不炸同结果', mappedLegacyCtx.rating, 'mid');
// web3ip 分支
const mappedIp = mapPrestageAnswers({
  ...answers, prestage_token_type: { choice: 'web3_native_ip_early', probabilities: {} },
}, {
  fullAccountOrCommunityData: { ...WIRED, followers_count: 131 },
  addressVerified: true, rulesResult: { nameMatch: true }, callInfo,
});
check('web3ip 分支 131 粉 → mid + promptType 带 web3_native_ip_early',
  { rating: mappedIp.rating, pt: mappedIp.promptType },
  { rating: 'mid', pt: 'prestage-jev(P1.10/web3_native_ip_early)' });
check('web3ip reason 含 IP 前缀', mappedIp.reasoning.startsWith('Web3原生IP早期'), true);
// abm 分支（addressVerified=false）：判定不消费 rateProject，两条件逻辑不变
const mappedAbm = mapPrestageAnswers(answers, {
  fullAccountOrCommunityData: BUNKER,
  addressVerified: false,
  callInfo,
});
check('abm 分支 nameLink=exact+traffic 0.1 → low（双证据逻辑零改动）',
  { rating: mappedAbm.rating, cat: mappedAbm.tokenType }, { rating: 'low', cat: 'account_based_meme' });
// 实度题已删：buildPrestageQuestions 无 prestage_project_quality 键
const qs = buildPrestageQuestions();
check('问题集无 prestage_project_quality（题随豁免逻辑删）',
  'prestage_project_quality' in qs, false);
check('问题集 4 题', Object.keys(qs).length, 4);
check('版本 P1.10', JEV_PRESTAGE_QUESTIONS_VERSION, 'P1.10');

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
