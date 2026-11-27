#!/usr/bin/env node
/**
 * 创建页「点位类型激活」开关单测（T242，2026-11-26 用户指令「web 创建页加类型开关」）
 * ——零 DB 零网络
 *
 * 覆盖：
 *   A. 纯函数核 src/web/static/js/point_types_picker.js：专属腿绑定提取 / 初值（复制
 *      覆盖优先 → 注册表缺省，normal 恒 true，陈旧键忽略）/ 汇总（与缺省全等 → null
 *      不写段）/ 行模型 / 摘要
 *   B. 页面只能产出引擎认的配置：collectConfig 产物恒过 resolvePointTypeOverride，且
 *      effectivePointTypeActive(产物) === 勾选表；与克隆 CLI --point-types 产物逐键一致
 *   C. 注册表接口：GET /api/strategy-library/point-types 形状（真 router.handle）+ 注册
 *      序在 /:id 之前；?include=condition 逐类型附判据原文（2026-11-27 信号页 ⓪类型通路
 *      卡用；缺省形状不变）
 *   D. 接线源码锁：创建页引脚本 + 提交带段 / 列表页复制携带 / 服务端创建路由解构 +
 *      同口径校验 + 包未启用 pointType 时 400
 *
 * 用法：node scripts/_test_point_types_picker.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const P = require(path.join(ROOT, 'src/web/static/js/point_types_picker.js'));
const routerMod = require(path.join(ROOT, 'src/market-analysis/point-type-router'));
const { PACK_DEFINITION } = require(path.join(ROOT, 'scripts/deploy-trading-strategy.cjs'));
const { applyPointTypes } = require(path.join(ROOT, 'scripts/clone-experiment.cjs'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}

// 注册表（接口形状：[{id,label,active}]——与 C 段真接口输出同形）
const TYPES = routerMod.POINT_TYPES.map((t) => ({ id: t.id, label: t.label, active: t.active === true }));
const IDS = TYPES.map((t) => t.id);
const defaults = Object.fromEntries(IDS.map((id) => [id, TYPES.find((t) => t.id === id).active]));
const onlyOn = (...ids) => Object.fromEntries(IDS.map((id) => [id, id === 'normal' || ids.includes(id)]));
const BOUND = P.boundLegsByType(PACK_DEFINITION);

function testA() {
  console.log('A. 纯函数核');
  check('A1 专属腿绑定：主包 P16~P20 各绑其类型，ladder 十四腿不出现', BOUND,
    { famous_holder_cold_pit: ['P16'], strongbacker_solo_dance: ['P17'], famous_participation_pit: ['P18'], steady_trend_climb: ['P19'], market_maker_rhythm_pit: ['P20'] });
  check('A1 无绑定 / 空定义 / 非数组 → {}', [P.boundLegsByType({ buyLegs: [{ priority: 1 }] }), P.boundLegsByType({}), P.boundLegsByType(null), P.boundLegsByType({ buyLegs: 'x' })], [{}, {}, {}, {}]);
  check('A2 初值=注册表缺省（normal 恒 true）', P.initialChecks(TYPES, null), defaults);
  const ov = { ...defaults, steady_trend_climb: false, slow_develop_early: true };
  check('A3 复制携带覆盖优先（关持续趋势 + 开 slow_develop_early）', P.initialChecks(TYPES, ov), { ...defaults, steady_trend_climb: false, slow_develop_early: true });
  check('A4 覆盖表里的陈旧键 / 非布尔值 / 停用 normal 一概不采（normal 恒 true）',
    P.initialChecks(TYPES, { normal: false, no_such_type: true, steady_trend_climb: 'yes', famous_holder_cold_pit: false }),
    { ...defaults, famous_holder_cold_pit: false });
  check('A5 汇总：与注册表缺省全等 → null（不写段）', P.collectConfig(TYPES, defaults), null);
  // 未勾=关：空表 / null 勾选表按「全未勾」汇总（页面恒传全表；collectPointTypes 对空态
  // 另有 null 守卫——此处锁纯函数自身的字面语义，不替调用方兜底）
  check('A5 汇总：空表 / null 勾选表 = 全未勾（只有 normal）→ 写段而非回落缺省', [P.collectConfig(TYPES, {}), P.collectConfig(TYPES, null)], [{ active: onlyOn() }, { active: onlyOn() }]);
  check('A6 汇总：只激活 normal → 全注册表布尔表（仅 normal true）', P.collectConfig(TYPES, onlyOn()), { active: onlyOn() });
  check('A7 汇总：开一个注册表未激活类型 → 写段（偏离缺省）', P.collectConfig(TYPES, { ...defaults, slow_develop_early: true }), { active: { ...defaults, slow_develop_early: true } });
  check('A7 汇总：停一个注册表激活类型 → 写段', P.collectConfig(TYPES, { ...defaults, steady_trend_climb: false }), { active: { ...defaults, steady_trend_climb: false } });
  const rows = P.rows(TYPES, BOUND, { ...defaults, steady_trend_climb: false });
  check('A8 行模型：注册表顺序 / normal 标记 / 专属腿挂到对应类型 / 未勾如实 / 未激活缺省如实',
    [rows.map((r) => r.id), rows.filter((r) => r.isNormal).map((r) => r.id), rows.filter((r) => r.legs.length).map((r) => [r.id, r.legs]), rows.find((r) => r.id === 'steady_trend_climb').checked, rows.filter((r) => !r.registryActive).map((r) => r.id)],
    [IDS, ['normal'], [['famous_holder_cold_pit', ['P16']], ['strongbacker_solo_dance', ['P17']], ['famous_participation_pit', ['P18']], ['steady_trend_climb', ['P19']], ['market_maker_rhythm_pit', ['P20']]], false, ['famous_participation_pit', 'slow_develop_early']]);
  check('A9 摘要：缺省态（slow_develop_early 未激活；专属腿全在）', P.summary(TYPES, BOUND, defaults), { activeN: IDS.length - 2, inactiveN: 2, disabledLegs: ['P18'] });
  check('A10 摘要：只激活 normal → 专属腿 P16~P20 全停', P.summary(TYPES, BOUND, onlyOn()), { activeN: 1, inactiveN: IDS.length - 1, disabledLegs: ['P16', 'P17', 'P18', 'P19', 'P20'] });
  check('A11 摘要：无专属腿的类型停用不进停用腿清单（famous_conviction_pit；缺省态 P18 已因 participation 未激活停用）', P.summary(TYPES, BOUND, { ...defaults, famous_conviction_pit: false }).disabledLegs, ['P18']);
}

function testB() {
  console.log('B. 页面产物 = 引擎认的配置');
  let allValid = true, allEqual = true;
  const n = TYPES.length;
  // 全组合（8 类型=256 种）：collectConfig 产物恒过 resolvePointTypeOverride，且
  // effectivePointTypeActive(产物) === 勾选表；null（与缺省全等）时有效表 === 注册表缺省
  for (let mask = 0; mask < (1 << n); mask++) {
    const checks = {}; IDS.forEach((id, i) => { checks[id] = id === 'normal' ? true : !!(mask & (1 << i)); });
    const cfg = P.collectConfig(TYPES, checks);
    try {
      const eff = routerMod.effectivePointTypeActive(routerMod.resolvePointTypeOverride(cfg));
      IDS.forEach((id) => { if (eff[id] !== checks[id]) allEqual = false; });
      if (cfg === null && JSON.stringify(eff) !== JSON.stringify(defaults)) allEqual = false;
    } catch (e) { allValid = false; }
  }
  ok(`B1 全部 ${1 << n} 种勾选组合：产物恒过 resolvePointTypeOverride（引擎不拒启）`, allValid);
  ok('B2 全部组合：有效激活表 === 勾选表（页面所见即引擎所得；缺省态产物 null → 注册表缺省）', allEqual);
  const viaUi = P.collectConfig(TYPES, P.initialChecks(TYPES, onlyOn('steady_trend_climb')));
  const cfgCli = {}; const changes = [];
  applyPointTypes(cfgCli, 'normal,steady_trend_climb', changes);
  check('B3 创建页产物 ≡ clone --point-types normal,steady_trend_climb 产物', [viaUi, cfgCli.pointTypes], [{ active: onlyOn('steady_trend_climb') }, { active: onlyOn('steady_trend_climb') }]);
}

async function testC() {
  console.log('C. 注册表接口');
  const libRouter = require(path.join(ROOT, 'src/web/routes/strategy-library.routes'));
  const call = (method, url, query = {}) => new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    try {
      libRouter.handle({ method, url, headers: {}, params: {}, query }, res, (err) => (err ? reject(err) : resolve(res)));
    } catch (e) { reject(e); }
  });
  const r = await call('GET', '/point-types');
  check('C1 GET /api/strategy-library/point-types → {success, data:{version, types}}', [r.statusCode, r.body.success, r.body.data.version, r.body.data.types],
    [200, true, routerMod.POINT_TYPE_VERSION, TYPES]);
  ok('C2 types 每项恰 {id,label,active}（不泄露 condition/policy）', r.body.data.types.every((t) => JSON.stringify(Object.keys(t).sort()) === '["active","id","label"]'));
  // 2026-11-27 信号页 ⓪类型通路卡「判据表达式 + 逐子句因子 chips」：显式 include=condition 才附判据原文
  const rc = await call('GET', '/point-types?include=condition', { include: 'condition' });
  check('C2b include=condition：版本与类型序/激活不变，逐类型多出 condition 判据原文（normal 兜底=null）',
    [rc.statusCode, rc.body.data.version, rc.body.data.types.map((t) => [t.id, t.label, t.active, t.condition])],
    [200, routerMod.POINT_TYPE_VERSION, routerMod.POINT_TYPES.map((t) => [t.id, t.label, t.active === true, t.condition ?? null])]);
  ok('C2c include=condition 仍不泄露 policy（每项恰四键）', rc.body.data.types.every((t) => JSON.stringify(Object.keys(t).sort()) === '["active","condition","id","label"]'));
  const rx = await call('GET', '/point-types?include=other', { include: 'other' });
  ok('C2d include 取其它值=缺省形状（不带判据）', rx.body.data.types.every((t) => JSON.stringify(Object.keys(t).sort()) === '["active","id","label"]'));
  const src = read('src/web/routes/strategy-library.routes.js');
  ok('C3 注册序锁：/point-types 在 /:id 之前（否则字面路径被 :id 吞掉）',
    src.indexOf("router.get('/point-types'") > 0 && src.indexOf("router.get('/point-types'") < src.indexOf("router.get('/:id'"));
  const r2 = await call('GET', '/module-versions');
  check('C4 存量 /module-versions 不受影响', [r2.statusCode, r2.body.success, typeof r2.body.data], [200, true, 'object']);
}

function testD() {
  console.log('D. 接线源码锁');
  const html = read('src/web/templates/create_experiment.html');
  const inlineStart = html.indexOf('<script>\n        // 全局变量（T202 策略库二期）');
  ok('D1 创建页在內联脚本之前引入 point_types_picker.js（带缓存版本串）',
    /<script src="\/static\/js\/point_types_picker\.js\?v=\d+"><\/script>/.test(html) && inlineStart > 0 && html.indexOf('/static/js/point_types_picker.js') < inlineStart);
  ok('D2 创建页开关区 DOM 在位（section / list / summary / reset）', ['point-types-section', 'point-types-list', 'point-types-summary', 'point-types-reset'].every((id) => html.includes(`id="${id}"`)));
  const inline = html.slice(inlineStart);
  ok('D3 创建页内联脚本消费纯函数核五件（初值 / 汇总 / 行模型 / 摘要 / 专属腿）',
    ['PointTypesPicker.initialChecks(', 'PointTypesPicker.collectConfig(', 'PointTypesPicker.rows(', 'PointTypesPicker.summary(', 'PointTypesPicker.boundLegsByType('].every((s) => inline.includes(s)));
  ok('D4 提交：config 顶层按 collectPointTypes() 条件带 pointTypes 段', inline.includes('const pointTypesCfg = collectPointTypes();') && inline.includes('...(pointTypesCfg ? { pointTypes: pointTypesCfg } : {})'));
  ok('D5 复制链捕获源实验 pointTypes.active 作初值', inline.includes('window._copyPointTypes = copyData.pointTypes && copyData.pointTypes.active'));
  ok('D6 包未启用 pointType → 整块隐藏（packHasPointType 判定 modules.pointType != null）',
    inline.includes('function packHasPointType(pack)') && inline.includes('mods.pointType != null') && /if \(!packHasPointType\(pack\)\) \{\s*sec\.hidden = true;/.test(inline));
  ok('D7 normal 复选框恒勾选且禁用（兜底类型不可停用，引擎同口径拒启）', inline.includes("${r.checked ? ' checked' : ''}${r.isNormal ? ' disabled' : ''}"));
  ok('D8 所选包未启用 / 注册表未加载时 collectPointTypes 恒 null（不写段）', /if \(!pointTypeRegistry \|\| !pointTypesChecks \|\| !packHasPointType\(selectedPack\)\) return null;/.test(inline));
  const expJs = read('src/web/static/js/experiments.js');
  const expHtml = read('src/web/templates/experiments.html');
  ok('D9 列表页复制载荷携带 pointTypes + 脚本版本已 bump（≥7.13）',
    expJs.includes('if (config.pointTypes) copyData.pointTypes = config.pointTypes;')
    && /experiments\.js\?v=7\.(1[3-9]|[2-9]\d)/.test(expHtml));
  const srv = read('src/web-server.js');
  const createStart = srv.indexOf("this.app.post('/api/experiments'");
  const destructure = srv.slice(createStart, srv.indexOf('} = req.body;', createStart));
  ok('D10 服务端创建路由：解构 pointTypes + 经 validateExperimentPointTypes 单点校验 + 写入 config',
    /\n\s+pointTypes,\s*\n/.test(destructure)
    && srv.includes('const ptCheck = validateExperimentPointTypes(pointTypes, packRow.definition);')
    && srv.includes('config.pointTypes = JSON.parse(JSON.stringify(pointTypes));')
    && /const \{ StrategyLibraryService, validatePack, validateExperimentPointTypes \} = require\('\.\/web\/services\/StrategyLibraryService'\);/.test(srv));
  ok('D11 服务端：校验不过 → 400 带全部错误（不落库）', /if \(!ptCheck\.valid\) \{\s*return res\.status\(400\)\.json\(\{ success: false, error: `pointTypes 非法：\$\{ptCheck\.errors\.join\('；'\)\}` \}\);/.test(srv));
}

function testE() {
  console.log('E. 入库校验 validateExperimentPointTypes（纯函数，与引擎 / 克隆脚本同口径）');
  const { validateExperimentPointTypes } = require(path.join(ROOT, 'src/web/services/StrategyLibraryService'));
  const main = PACK_DEFINITION;
  const noPt = { ...PACK_DEFINITION, modules: { ...PACK_DEFINITION.modules } };
  delete noPt.modules.pointType;
  check('E1 合法覆盖 + 主包 → 通过', validateExperimentPointTypes({ active: onlyOn() }, main), { valid: true, errors: [] });
  check('E2 合法覆盖 + 包未启用 pointType → 一条错（无消费点）', validateExperimentPointTypes({ active: onlyOn() }, noPt).valid, false);
  const e2 = validateExperimentPointTypes({ active: onlyOn() }, noPt).errors;
  ok('E2 错误文案指路（未启用 modules.pointType）', e2.length === 1 && e2[0].includes('未启用 modules.pointType'), e2);
  check('E3 脏形状（数组 / 未知键 / 未知类型 / 非布尔 / 停用 normal / 空段）全拒',
    [[], { active: { normal: true }, foo: 1 }, { active: { nope: false } }, { active: { normal: 'true' } }, { active: { normal: false } }, { active: {} }].map((v) => validateExperimentPointTypes(v, main).valid),
    [false, false, false, false, false, false]);
  check('E4 脏形状 ∧ 包未启用 → 两条错都报（不互相遮蔽）', validateExperimentPointTypes({ active: {} }, noPt).errors.length, 2);
  check('E5 产物回放：页面 collectConfig 产物过得了入库校验（256 组合）', (() => {
    let all = true;
    for (let mask = 0; mask < (1 << TYPES.length); mask++) {
      const checks = {}; IDS.forEach((id, i) => { checks[id] = id === 'normal' ? true : !!(mask & (1 << i)); });
      if (!validateExperimentPointTypes(P.collectConfig(TYPES, checks), main).valid) all = false;
    }
    return all;
  })(), true);
}

(async () => {
  testA();
  testB();
  await testC();
  testD();
  testE();
  console.log(`\n${'='.repeat(60)}\n点位类型激活开关单测：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 异常: ${e?.stack || e}`); process.exit(1); });
