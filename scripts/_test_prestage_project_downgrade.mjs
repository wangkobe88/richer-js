/**
 * prestage project 信用降档本地零 DB 单测（x-0 案 C15，P1.3，2026-09-27）
 *
 * 覆盖：
 * 1. rateProject 降档边界（少推文/新号/正常号/缺 created_at/社区型不受影响）
 * 2. 年龄锚定幂等性（token 创建时点锚，与"何时分析"无关）
 * 3. mapPrestageAnswers 透传（tokenCreatedAtSec → downgrade 进 jevDetails）
 */
import { rateProject, mapPrestageAnswers } from '../src/narrative/analyzer/llm/jev-prestage-mapper.mjs';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// x-0 案形状：131 粉、09-15 注册、token 09-26 铸（11 天）、1 条推文
const X0 = {
  type: 'account', followers_count: 131, statuses_count: 1,
  created_at: 'Mon Sep 15 08:00:00 +0000 2026', verified: false, is_blue_verified: true,
};
const X0_TOKEN_AT = new Date('2026-09-26T12:02:17Z').getTime() / 1000;

console.log('== 1. 降档边界 ==');
// x-0：双触发（1 推文 <5 且 11 天 <30）→ low
let r = rateProject(X0, null, X0_TOKEN_AT);
check('x-0 形状（1推文+11天）→ low', { rating: r.rating, met: r.baselineMet },
  { rating: 'low', met: true });
check('x-0 downgrade 记录', r.downgrade, { statuses: 1, accountAgeDays: 11 });

// 只有推文少（老号 3 条）：OR 触发 → low
r = rateProject({ ...X0, created_at: 'Wed Jan 01 08:00:00 +0000 2020' }, null, X0_TOKEN_AT);
check('老号但 3 条推文 → low（OR）', r.rating, 'low');

// 只有号新（推文多）：OR 触发 → low
r = rateProject({ ...X0, statuses_count: 500 }, null, X0_TOKEN_AT);
check('11 天号但 500 条推文 → low（OR）', r.rating, 'low');

// 正常项目方：老号 + 推文足 + 131 粉 → mid（P1.2 行为不变）
r = rateProject({ ...X0, statuses_count: 120, created_at: 'Wed Jan 01 08:00:00 +0000 2020' }, null, X0_TOKEN_AT);
check('老号 120 推文 131 粉 → mid 零回归', { rating: r.rating, dg: r.downgrade }, { rating: 'mid', dg: null });

// 老号 ≥300 粉 → high 不变
r = rateProject({ ...X0, followers_count: 500, statuses_count: 120, created_at: 'Wed Jan 01 08:00:00 +0000 2020' }, null, X0_TOKEN_AT);
check('老号 120 推文 500 粉 → high 零回归', r.rating, 'high');

// 边界值：恰好 30 天 / 恰好 5 条推文 → 不拦（< 严格）
const exactly30d = X0_TOKEN_AT - 30 * 86400;
r = rateProject({ ...X0, statuses_count: 5, created_at: new Date(exactly30d * 1000).toUTCString().replace('GMT', '+0000') }, null, X0_TOKEN_AT);
check('恰好 5 推文 + 恰好 30 天 → mid（严格小于不拦）', r.rating, 'mid');

// 29.9 天 → 拦
r = rateProject({ ...X0, statuses_count: 5, created_at: new Date((X0_TOKEN_AT - 29.9 * 86400) * 1000).toUTCString().replace('GMT', '+0000') }, null, X0_TOKEN_AT);
check('29.9 天 → low', r.rating, 'low');

console.log('== 2. 缺数据 fail-open 与社区型 ==');
// created_at 缺失：跳过年龄项，推文够 → mid
r = rateProject({ ...X0, statuses_count: 120, created_at: null }, null, X0_TOKEN_AT);
check('created_at 缺失 + 推文足 → mid（跳过年龄项）', r.rating, 'mid');
// created_at 缺失 + 推文少 → 仍降档（推文项独立）
r = rateProject({ ...X0, statuses_count: 2, created_at: null }, null, X0_TOKEN_AT);
check('created_at 缺失 + 2 推文 → low（推文项独立生效）', r.rating, 'low');
// tokenCreatedAtSec 缺失（raw_api_data.created_at 无）：年龄项跳过
r = rateProject(X0, null, null);
check('tokenAt 缺失 → 只看推文（1<5 拦）', r.rating, 'low');
r = rateProject({ ...X0, statuses_count: 120, created_at: 'Mon Sep 25 08:00:00 +0000 2026' }, null, null);
check('tokenAt 缺失 + 推文足 → mid（年龄不可算不拦）', r.rating, 'mid');
// created_at 解析失败（垃圾串）
r = rateProject({ ...X0, statuses_count: 120, created_at: 'not-a-date' }, null, X0_TOKEN_AT);
check('created_at 垃圾串 + 推文足 → mid（解析失败跳过）', r.rating, 'mid');
// 社区型：无降档概念，500 成员活跃 high 不变
r = rateProject({ type: 'community', members_count: 500 }, 'high', X0_TOKEN_AT);
check('社区型 500 成员活跃 → high 不受降档影响', { rating: r.rating, dg: r.downgrade }, { rating: 'high', dg: null });
// 粉丝底线以下仍走原 low（baselineMet=false；§六-23 底线 60→20 后 30 粉已过线，
// 用 10 粉测底线分支）
r = rateProject({ ...X0, followers_count: 10 }, null, X0_TOKEN_AT);
check('10 粉 < 底线 → low（baselineMet=false 原语义）', { rating: r.rating, met: r.baselineMet }, { rating: 'low', met: false });

console.log('== 3. 年龄锚定幂等性 ==');
// 同一账号同一 token：无论何时重放（tokenAt 锚定不变），评级一致
const late = rateProject(X0, null, X0_TOKEN_AT);
const replayDaysLater = rateProject(X0, null, X0_TOKEN_AT); // tokenAt 同值即同结果
check('重放同 tokenAt → 同结果', late.rating, replayDaysLater.rating);
// 对照：若用分析时刻锚，一年后重放会从 low 翻 mid（错误方向）；tokenAt 锚不受影响
const aYearLater = Math.floor(Date.now() / 1000) + 0; // 不使用——仅文档性说明
check('tokenAt 锚定（非墙钟）：账号年龄仅由 token 创建时点决定',
  late.downgrade.accountAgeDays, 11);

console.log('== 4. mapPrestageAnswers 透传 ==');
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
const mapped = mapPrestageAnswers(answers, {
  fullAccountOrCommunityData: X0,
  addressVerified: true,
  rulesResult: { nameMatch: true },
  tokenCreatedAtSec: X0_TOKEN_AT,
  callInfo,
});
check('x-0 全链形状 → rating low + promptType P1.7', { rating: mapped.rating, pt: mapped.promptType },
  { rating: 'low', pt: 'prestage-jev(P1.7/project)' });
check('jevDetails 含 downgrade', mapped.jevDetails.downgrade, { statuses: 1, accountAgeDays: 11 });
check('reason 含降档依据', mapped.reasoning.includes('信用降档'), true);

const mappedOk = mapPrestageAnswers(answers, {
  fullAccountOrCommunityData: { ...X0, statuses_count: 120, created_at: 'Wed Jan 01 08:00:00 +0000 2020' },
  addressVerified: true, rulesResult: { nameMatch: true },
  tokenCreatedAtSec: X0_TOKEN_AT, callInfo,
});
check('正常号全链 → mid 无 downgrade 键', { rating: mappedOk.rating, has: 'downgrade' in mappedOk.jevDetails },
  { rating: 'mid', has: false });

console.log('== 5. P1.5 项目实度豁免（WIRED 案 C35，2026-10-01）==');
// WIRED 形状：1041 粉、109 推文、账号比 token 晚 15 分钟（负年龄）、实度 4 分
const WIRED = {
  type: 'account', followers_count: 1041, statuses_count: 109,
  created_at: new Date((X0_TOKEN_AT + 15 * 60) * 1000).toUTCString().replace('GMT', '+0000'),
  verified: true, is_blue_verified: true,
};
r = rateProject(WIRED, null, X0_TOKEN_AT, 4);
check('WIRED 形状（0天号+109推文+实度4）→ high 豁免降档', { rating: r.rating, dg: r.downgrade },
  { rating: 'high', dg: null });
check('豁免审计 qualityExempt', r.qualityExempt.accountAgeDays <= 0 && r.qualityExempt.projectQuality === 4, true);
check('豁免 reason 标注', r.reason.includes('项目实度4分≥3豁免降档'), true);
// 同形状但实度低分 → 维持拦
r = rateProject(WIRED, null, X0_TOKEN_AT, 2);
check('0天号+实度2分<3 → low 维持拦', { rating: r.rating, q: r.downgrade.projectQuality }, { rating: 'low', q: 2 });
// 缺分（fail-closed：题未答/未带）→ 维持拦（= 旧调用零回归的机器证明）
r = rateProject(WIRED, null, X0_TOKEN_AT, null);
check('0天号+实度缺分 → low（fail-closed）', { rating: r.rating, has: 'projectQuality' in (r.downgrade || {}) },
  { rating: 'low', has: false });
// 边界：恰好 3 分 → 豁免（≥ 语义）
r = rateProject({ ...WIRED, followers_count: 131 }, null, X0_TOKEN_AT, 3);
check('0天号+131粉+实度3分（边界）→ mid 豁免', r.rating, 'mid');
// 推文 <5 保留拦：实度分救不了无内容（x-0 语义维持）
r = rateProject({ ...WIRED, statuses_count: 1 }, null, X0_TOKEN_AT, 5);
check('0天号+1推文+实度5分 → low（推文项独立，无内容=质量无从评估）', r.rating, 'low');
// 老号低分：分数只对账号新的生效，老号不消费（不因低分误伤老项目）
r = rateProject({ ...WIRED, created_at: 'Wed Jan 01 08:00:00 +0000 2020' }, null, X0_TOKEN_AT, 1);
check('老号+实度1分 → high 不消费分数（1041粉带；零回归）', { rating: r.rating, qe: r.qualityExempt }, { rating: 'high', qe: null });
// 全链：豁免形状进 jevDetails
const mappedExempt = mapPrestageAnswers({
  ...answers, prestage_project_quality: { score: 4, probabilities: {} },
}, {
  fullAccountOrCommunityData: WIRED,
  addressVerified: true, rulesResult: { nameMatch: true },
  tokenCreatedAtSec: X0_TOKEN_AT, callInfo,
});
check('WIRED 全链 → high + qualityExempt 进 jevDetails',
  { rating: mappedExempt.rating, qe: mappedExempt.jevDetails.qualityExempt.projectQuality },
  { rating: 'high', qe: 4 });
// 全链：低分形状降档 reason 带分
const mappedLowQ = mapPrestageAnswers({
  ...answers, prestage_project_quality: { score: 2, probabilities: {} },
}, {
  fullAccountOrCommunityData: WIRED,
  addressVerified: true, rulesResult: { nameMatch: true },
  tokenCreatedAtSec: X0_TOKEN_AT, callInfo,
});
check('低分全链 → low + reason 含实度分', mappedLowQ.rating === 'low' && mappedLowQ.reasoning.includes('项目实度2分<3'), true);

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
