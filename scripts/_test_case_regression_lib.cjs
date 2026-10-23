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
  const libPath = path.resolve(__dirname, 'narrative/case-regression/lib.mjs');
  const { interpret, assertExpectation, loadAndValidateFixtures, toCsv, csvEscape, buildCase, updateExpect, stratifySample, mulberry32 } = await import(libPath);

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
    stage1_result: { jev: { audit: { recognizedEntitySlogan: 1 } } },
  });
  check('I3 评级票判读+审计进 blob', i3.rating === 'high' && i3.score === 80.56 && i3.blob.includes('recognizedEntitySlogan'), JSON.stringify(i3).slice(0, 120));

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
  const fixturesPath = path.resolve(__dirname, 'narrative/case-regression/fixtures.json');
  const doc = JSON.parse(require('fs').readFileSync(fixturesPath, 'utf8'));
  const real = loadAndValidateFixtures(doc);
  check('F1 真实 fixtures 校验零错误', real.errors.length === 0, real.errors.join('; '));
  check('F2 票数=103（≥30 扩集；45→46=C162 BINA 双 BINA 复刻票，46→47=C164 FOURGE，47→48=C167 梗王大乱斗，48→49=C168 BIAOQING，49→50=C138a Heyi.ai 本票，50→51=C170 RSA4 nhn 门退役案票，51→52=C173 「4」撞蓝筹新陈述豁免票，52→53=C176 Nightshift rug 项目票，53→103=C180 名字门 unknown/词句两臂退役观察票 50 张——2026-10-23 用户裁定全收 [low,mid,high] 待逐张裁定预期后收紧，编号 C180-C229 为收录批非单案）', real.cases.length === 103, String(real.cases.length));
  check('F3 caseId 无重复', new Set(real.cases.map((c) => c.caseId)).size === real.cases.length);

  const bad = loadAndValidateFixtures({ cases: [
    { caseId: 'X1', addr: '0x123', expect: { rating: 'low' } },                       // 坏地址
    { caseId: 'X1', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7777' },              // 重复 caseId+缺 expect
    { caseId: 'X3', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7778', expect: { rating: 'banana' } }, // 非法枚举
    { caseId: 'X4', addr: '0xad55993dfd097ca2adb89ffbc2b0ccceb6dc7779', expect: { reasonIncludes: 'x' } }, // 非数组
  ] });
  check('F4 事故形状全部拒启', bad.errors.length >= 5, bad.errors.join('; '));
  check('F5 空 cases 拒', loadAndValidateFixtures({ cases: [] }).errors.length === 1);

  // ── 工具化收录/预期更新（--add/--update-expect 纯函数层）──
  const A = (h) => '0x' + h.repeat(40);
  const bc = buildCase({ caseId: 'C112', symbol: '测试票', addr: A('a'), interp: { rating: 'low', tokenCategory: 'event:W' }, note: 'n', observe: 'o', today: '2026-10-19' });
  check('B1 buildCase 终态确定性键复制+addedAt 留痕',
    bc.expect.rating === 'low' && bc.expect.tokenCategory === 'event:W' && bc.addedAt === '2026-10-19' && bc.observe === 'o' && bc.note === 'n',
    JSON.stringify(bc));
  const bc2 = buildCase({ caseId: 'C113', symbol: 'x', addr: A('b'), interp: { rating: 'high', tokenCategory: null }, today: '2026-10-19' });
  check('B2 buildCase 无 category 不写键/无 note-observe 不写键',
    bc2.expect.tokenCategory === undefined && !('observe' in bc2) && !('note' in bc2) && Object.keys(bc2.expect).length === 1,
    JSON.stringify(bc2));

  const oldCase = { caseId: 'C9', symbol: 's', addr: A('c'), expect: { rating: ['high', 'mid'], reasonIncludes: ['关键词'], auditIncludes: ['staleParentOverride'] } };
  const ue = updateExpect(oldCase, { rating: 'low', tokenCategory: null }, 'C115 裁定拦截面收紧', '2026-10-19');
  check('U1 updateExpect rating 刷新+细节键保留+成对留痕+纯函数不改原对象',
    ue.expect.rating === 'low' && ue.expect.reasonIncludes.length === 1 && ue.expect.auditIncludes[0] === 'staleParentOverride'
      && ue.expectSince === '2026-10-19' && ue.expectBecause === 'C115 裁定拦截面收紧' && Array.isArray(oldCase.expect.rating) && oldCase.expect.rating.length === 2,
    JSON.stringify(ue));
  const ue2 = updateExpect({ caseId: 'C8', symbol: 's', addr: A('d'), expect: { rating: 'low' } }, { rating: 'high', tokenCategory: 'account_based_meme' }, 'b', '2026-10-20');
  check('U2 updateExpect tokenCategory 在场时刷新', ue2.expect.tokenCategory === 'account_based_meme' && ue2.expect.rating === 'high', JSON.stringify(ue2));

  // V1 留痕键校验：expectSince/Because 必须成对；addedAt/expectSince 须 YYYY-MM-DD
  const meta = loadAndValidateFixtures({ cases: [
    { caseId: 'M1', addr: A('e'), expect: { rating: 'low' }, addedAt: '2026-10-19', expectSince: '2026-10-19', expectBecause: 'x' },
    { caseId: 'M2', addr: A('f'), expect: { rating: 'low' }, expectSince: '2026-10-19' },
    { caseId: 'M3', addr: A('1'), expect: { rating: 'low' }, addedAt: '10-19', expectSince: '2026-10-19', expectBecause: 'y' },
  ] });
  check('V1 留痕键成对+ISO 日期校验（M2 缺 because / M3 addedAt 非法）', meta.errors.length === 2, meta.errors.join('; '));

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

  // ── stratifySample：涨幅分层抽样（抽样测试集构建的纯函数核心）──
  const mk = (addr, max, final) => ({ addr: '0x' + addr.padStart(40, '0'), max, final });
  const pool = [
    mk('a1', 100, 50), mk('a2', 500, 400), mk('a3', 0, -80), mk('a4', 0, -30), mk('a5', 0, -30),
    mk('a6', 50, null), mk('a7', 500, 300), mk('a8', 10, 5), mk('a9', 0, -10), mk('aa', 20, 8),
  ];
  const st = stratifySample(pool, { top: 2, bottom: 3, random: 2, seed: 20261021 });
  check('S1 top=峰值降序（并列 final 降序）', st.top[0].addr === pool[1].addr && st.top[1].addr === pool[6].addr, JSON.stringify(st.top.map((p) => p.addr.slice(-2))));
  check('S2 bottom=max 升序（max=0 并列 final 升序=跌最狠优先，再 addr 升序）',
    st.bottom.map((p) => p.addr.slice(-2)).join(',') === 'a3,a4,a5', JSON.stringify(st.bottom.map((p) => p.addr.slice(-2))));
  const allPicked = [...st.top, ...st.bottom, ...st.random].map((p) => p.addr);
  check('S3 三层互斥且总数=配额', new Set(allPicked).size === 7 && allPicked.length === 7, JSON.stringify(allPicked.map((a) => a.slice(-2))));
  const st2 = stratifySample(pool, { top: 2, bottom: 3, random: 2, seed: 20261021 });
  check('S4 同 seed 随机层可复现', JSON.stringify(st.random.map((p) => p.addr)) === JSON.stringify(st2.random.map((p) => p.addr)), '');
  const st3 = stratifySample(pool, { top: 2, bottom: 3, random: 2, seed: 99 });
  check('S5 异 seed 随机层不同（洗牌真随机化）', JSON.stringify(st.random.map((p) => p.addr)) !== JSON.stringify(st3.random.map((p) => p.addr)) || st.random.length < 2, '');
  let threw = false;
  try { stratifySample(pool.slice(0, 3), { top: 2, bottom: 2, random: 2, seed: 1 }); } catch { threw = true; }
  check('S6 池不足 fail-fast throw', threw, '池 3 < 配额 6 未拒');
  check('S7 mulberry32 输出域 [0,1)', mulberry32(7)() >= 0 && mulberry32(7)() < 1, '');
  check('S8 抽样不改入参池（纯函数）', pool.length === 10 && pool[0].addr === mk('a1', 0, 0).addr, '');

  console.log(`\n全部通过 ✅（${passed} 断言，case 回归断言器）`);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
