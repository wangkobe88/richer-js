#!/usr/bin/env node
/**
 * 叙事 case 回归集断言器单测（2026-10-19）——零 DB 零网络：
 * 只测 case-regression-lib.mjs 纯函数（interpret/assertExpectation/
 * loadAndValidateFixtures/toCsv），fixtures 文件按磁盘路径读取校验。
 *
 * 用法：node scripts/_test_case_regression_lib.cjs
 */
'use strict';

const path = require('path');

let passed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) { console.error(`   失败详情: ${detail || ''}`); process.exit(1); }
  passed++;
};

async function main() {
  const libPath = path.resolve(__dirname, 'narrative/case-regression-lib.mjs');
  const { interpret, assertExpectation, loadAndValidateFixtures, toCsv, csvEscape } = await import(libPath);

  // ── interpret：落库两信封形状（C88 信封坑反证锁定）──
  // 形状1：precheck 拒票（fin=null，pcr 带 reason + details.ruleName）
  const i1 = interpret({
    stage_final_result: null,
    pre_check_result: { rating: 'low', reason: '发币时所有推文距代币创建已超过300秒（推文类型=angle_seeking）', details: { ruleName: 'expired_tweet' } },
  });
  check('I1 precheck 拒票判读', i1.rating === 'low' && i1.ruleName === 'expired_tweet' && i1.reason.includes('超过300秒'), JSON.stringify(i1));

  // 形状2：stage2 拦截票（blockReason 在 fin.details，reason 顶层 null）
  const i2 = interpret({
    stage_final_result: { rating: 'low', score: null, reason: null, details: { blockReason: '币名不适合作为 meme 符号（名字门）' } },
    pre_check_result: null,
  });
  check('I2 stage2 拦截票判读（blockReason 非 pcr.reason）', i2.rating === 'low' && i2.reason === '币名不适合作为 meme 符号（名字门）' && i2.ruleName === null, JSON.stringify(i2));

  // 形状2b：ruleName 顶层信封（buildPreCheckResult 两形状既定事实）
  const i2b = interpret({ stage_final_result: null, pre_check_result: { rating: 'low', reason: 'x', ruleName: 'public_info_fetch_failed' } });
  check('I2b ruleName 顶层形状', i2b.ruleName === 'public_info_fetch_failed', JSON.stringify(i2b));

  // 形状3：评级票
  const i3 = interpret({
    stage_final_result: { rating: 'high', score: 80.56, details: { blockReason: null } },
    stage1_result: { jev: { audit: { superIpSlogan: 1 } } },
  });
  check('I3 评级票判读+审计进 blob', i3.rating === 'high' && i3.score === 80.56 && i3.blob.includes('superIpSlogan'), JSON.stringify(i3).slice(0, 120));

  // 无行
  check('I4 无行全 null', interpret(null).rating === null && interpret(null).blob === '');

  // 形状4：prestage 路径票（C70/C85 回归揭出的第四信封——project 票终态在 prestage_result 顶层）
  const i5 = interpret({
    stage_final_result: null,
    pre_check_result: null,
    prestage_result: { pass: true, rating: 'mid', reason: '项目币评级：粉丝2 → mid（粉丝带只定档不拦截）', details: { jev: { probabilities: {} } } },
  });
  check('I5 prestage 路径票判读（prestage_result 顶层 rating/reason）', i5.rating === 'mid' && i5.reason.includes('粉丝带只定档'), JSON.stringify(i5).slice(0, 120));

  // 形状4b：abm 续走标准路径票（prestage 与 fin 并存，fin 优先）
  const i5b = interpret({ stage_final_result: { rating: 'high', score: 80, details: {} }, prestage_result: { rating: 'mid', reason: 'x' } });
  check('I5b fin 优先于 prest（abm 续走标准路径票不受 prestage 定档遮蔽）', i5b.rating === 'high', JSON.stringify(i5b).slice(0, 80));

  // ── assertExpectation ──
  check('A1 rating 单值命中', assertExpectation({ rating: 'low', reason: 'x', ruleName: '', blob: '' }, { rating: 'low' }).failures.length === 0);
  check('A2 rating 不命中报失败', assertExpectation({ rating: 'high', reason: '', ruleName: '', blob: '' }, { rating: 'low' }).failures.length === 1);
  check('A3 rating 数组命中', assertExpectation({ rating: 'mid', reason: '', ruleName: '', blob: '' }, { rating: ['high', 'mid'] }).failures.length === 0);
  check('A4 rating null 不断言（评级交后腿的票）', assertExpectation({ rating: 'high', reason: '', ruleName: '', blob: '' }, { rating: null }).failures.length === 0);
  check('A5 rating 非法枚举在断言层也报', assertExpectation({ rating: 'low', reason: '', ruleName: '', blob: '' }, { rating: 'banana' }).failures.length >= 1);

  const r6 = assertExpectation({ rating: 'low', reason: '事件主体量级不足（A档→D档·币安地域子账号不借壳）', ruleName: '', blob: '' }, { rating: 'low', reasonIncludes: ['事件主体量级不足', '币安地域子账号'] });
  check('A6 reasonIncludes 全 AND 命中', r6.failures.length === 0, JSON.stringify(r6));

  const r7 = assertExpectation({ rating: 'low', reason: '叙事主体无形象载体（无形象实体）', ruleName: '', blob: '' }, { reasonExcludes: ['币名不适合作为 meme 符号'] });
  check('A7 reasonExcludes 不含禁词=过', r7.failures.length === 0, JSON.stringify(r7));
  const r7b = assertExpectation({ rating: 'low', reason: '币名不适合作为 meme 符号（名字门）', ruleName: '', blob: '' }, { reasonExcludes: ['币名不适合'] });
  check('A7b reasonExcludes 含禁词=失败', r7b.failures.length === 1, JSON.stringify(r7b));

  check('A8 precheckRuleIncludes/Excludes',
    assertExpectation({ rating: 'low', reason: 'x', ruleName: 'expired_tweet', blob: '' }, { precheckRuleIncludes: ['expired_tweet'] }).failures.length === 0
    && assertExpectation({ rating: 'low', reason: 'x', ruleName: 'public_info_fetch_failed', blob: '' }, { precheckRuleExcludes: ['public_info_fetch_failed'] }).failures.length === 1);

  check('A9 auditIncludes blob 匹配',
    assertExpectation({ rating: 'high', reason: '', ruleName: '', blob: '{"s1":{"audit":{"subjectCarrierImgOverride":1}}}' }, { auditIncludes: ['subjectCarrierImgOverride'] }).failures.length === 0
    && assertExpectation({ rating: 'high', reason: '', ruleName: '', blob: '{"s1":{}}' }, { auditIncludes: ['subjectCarrierImgOverride'] }).failures.length === 1);

  check('A10 判读输入缺失', assertExpectation(null, {}).failures.length === 1);

  // A11 tokenCategory / tokenCategoryExcludes（C85 'project' 断言、C75/C83 脱离 super_ip_fast）
  const i11 = { rating: 'mid', reason: '', ruleName: '', blob: '' };
  check('A11 tokenCategory 精确等/不等拒/Excludes 命中拒',
    assertExpectation({ ...i11, tokenCategory: 'project' }, { tokenCategory: 'project' }).failures.length === 0
    && assertExpectation({ ...i11, tokenCategory: 'event:W' }, { tokenCategory: 'project' }).failures.length === 1
    && assertExpectation({ ...i11, tokenCategory: 'super_ip_fast' }, { tokenCategoryExcludes: ['super_ip_fast'] }).failures.length === 1
    && assertExpectation({ ...i11, tokenCategory: 'event:W' }, { tokenCategoryExcludes: ['super_ip_fast'] }).failures.length === 0);

  // ── loadAndValidateFixtures：真实 fixtures 全过 + 事故形状反证 ──
  const fixturesPath = path.resolve(__dirname, 'narrative/case-regression-fixtures.json');
  const doc = JSON.parse(require('fs').readFileSync(fixturesPath, 'utf8'));
  const real = loadAndValidateFixtures(doc);
  check('F1 真实 fixtures 校验零错误', real.errors.length === 0, real.errors.join('; '));
  check('F2 票数=33（≥30 扩集）', real.cases.length === 33, String(real.cases.length));
  check('F3 caseId 无重复', new Set(real.cases.map((c) => c.caseId)).size === real.cases.length);

  const bad = loadAndValidateFixtures({ cases: [
    { caseId: 'X1', addr: '0x123', expect: { rating: 'low' } },                       // 坏地址
    { caseId: 'X1', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7777' },              // 重复 caseId+缺 expect
    { caseId: 'X3', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7778', expect: { rating: 'banana' } }, // 非法枚举
    { caseId: 'X4', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7779', expect: { reasonIncludes: 'x' } }, // 非数组
  ] });
  check('F4 事故形状全部拒启', bad.errors.length >= 5, bad.errors.join('; '));
  check('F5 空 cases 拒', loadAndValidateFixtures({ cases: [] }).errors.length === 1);

  // ── toCsv：转义与列对齐 ──
  check('C1 csvEscape 引号双写', csvEscape('a"b,c') === '"a""b,c"', csvEscape('a"b,c'));
  check('C2 csvEscape null/undefined 空', csvEscape(null) === '' && csvEscape(undefined) === '');
  const csv = toCsv([{ caseId: 'T', symbol: '测试,票', addr: '0xabc', status: 'PASS', expect: { rating: ['high', 'mid'], tokenCategoryExcludes: ['super_ip_fast'] }, baseline: { rating: 'low', reason: 'r1' }, current: { rating: 'mid', reason: '含"引号"文案', tokenCategory: 'project' }, failures: [] }]);
  const lines = csv.split('\n');
  check('C3 toCsv 头行+数据行', lines.length === 2 && lines[0].split(',').length === 25, lines[0]);
  check('C4 数组 rating | 连接', /,high\|mid,/.test(lines[1]), lines[1].slice(0, 80));
  check('C5 逗号字段转义', lines[1].includes('"测试,票"'), lines[1].slice(0, 80));
  check('C6 内嵌引号双写', lines[1].includes('含""引号""'), lines[1].slice(-80));
  check('C7 tokenCat 期望≠前缀+当前列', lines[1].includes('≠super_ip_fast') && /,project,"含/.test(lines[1]), lines[1].slice(-120));

  console.log(`\n全部通过 ✅（${passed} 断言，case 回归断言器）`);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
