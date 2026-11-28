/**
 * T202 策略库二期单测（2026-11-20）——零 DB 零网络：
 *   A. module-registry：版本注册表（未知模块名/版本键 fail-fast；v1 解析为
 *      现行具体版本常量；null→{}）
 *   B. validatePack：策略包 definition 校验（顶层键白名单/两侧腿/RETIRED 段（stallClose
 *      T233 腿化退役）/burstCooldown/modules 版本键）
 *      burstCooldown/modules）
 *   C. _resolveStrategyPack 三分支：旧内嵌腿拒启（不前向兼容）/缺包拒启/
 *      definition 非法拒启/modules 未知键拒启/成功缓存+strategyResolved 写回
 *      （best-effort 失败不阻塞）
 *   D. _buildStrategyConfig：薄读缓存 / 无包 throw
 *   E. T242 实验级点位类型激活：无覆盖零行为变化 / 只激活 normal（专属腿停用+分类
 *      落 normal+审计）/ 部分覆盖 / fail-fast 六条 / 包无模块原引用 / 早退归零
 *   F. 主包内容锁：专属腿 P16~P20 绑定 / 门链因子代 v2 / Jev 基线可派生
 *
 * dbManager 单例打桩手法同 _test_embedded_collector_architecture.cjs（必须在
 * 被测模块 require 前完成）；ExperimentFactory.getInstance 测试内替换（还原）。
 */

// ═══ dbManager 单例打桩（require 被测模块前）═══
const { dbManager } = require('../src/services/dbManager');

/** strategy_library 查询桩：from().select().eq().single() 可编程返回 */
function makeDbStub() {
    const state = { packRow: null, packError: null };
    state.client = {
        from(table) {
            if (table !== 'strategy_library') throw new Error(`测试桩只接受 strategy_library，实际 ${table}`);
            const q = {
                _eq: {},
                select() { return q; },
                eq(col, v) { q._eq[col] = v; return q; },
                single() {
                    if (state.packError) return Promise.resolve({ data: null, error: state.packError });
                    if (state.packRow == null || q._eq.id !== state.packRow.id) {
                        return Promise.resolve({ data: null, error: { message: '多个行/未找到（stub）' } });
                    }
                    return Promise.resolve({ data: state.packRow, error: null });
                },
            };
            return q;
        },
    };
    return state;
}

const activeDb = makeDbStub();
dbManager.isInitialized = true;
dbManager.client = activeDb.client;

// ═══ 被测模块（打桩后 require）═══
const { assertModuleKey, resolveModules, listModuleVersions, MODULE_NAMES, FACTOR_GENERATION_KEY, isFactorGeneration } =
    require('../src/market-analysis/module-registry');
const { validatePack, validateBurstCooldownSection } =
    require('../src/web/services/StrategyLibraryService');
const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
const factoryMod = require('../src/trading-engine/factories/ExperimentFactory');

// 版本常量真值（从源模块直读防漂移——注册表 v1 必须映射到现行常量）
const { FACTOR_PREBUY_VERSION } = require('../src/market-analysis/factor-pre-buy-check');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}
function throwsWith(name, fn, substr) {
    try { fn(); check(name, false, '未抛出'); }
    catch (e) {
        check(name, String(e.message).includes(substr), `实得: ${e.message}`);
    }
}
async function throwsWithAsync(name, fn, substr) {
    try { await fn(); check(name, false, '未抛出'); }
    catch (e) {
        check(name, String(e.message).includes(substr), `实得: ${e.message}`);
    }
}
const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ═══════════════ A. module-registry ═══════════════
async function testA() {
    console.log('\n━━━ A. module-registry 版本注册表 ━━━');

    check('A1 MODULE_NAMES 恰五模块（T216 +pointType 点位类型路由）', JSON.stringify(MODULE_NAMES) ===
        JSON.stringify(['factorCheck', 'cheatCheck', 'actFrontGate', 'buyPointCheck', 'pointType']),
        JSON.stringify(MODULE_NAMES));

    check('A2 assertModuleKey 已注册键通过',
        assertModuleKey('factorCheck', 'v1') === true);
    throwsWith('A3 未知版本键 throw（信息含可用键）',
        () => assertModuleKey('factorCheck', 'v9'), 'v1');
    throwsWith('A4 未知模块名 throw（信息含可用模块名）',
        () => assertModuleKey('nope', 'v1'), 'factorCheck');

    const empty = await resolveModules(null);
    check('A5 modules null → {}（四门全关合法）', Object.keys(empty).length === 0);

    const resolved = await resolveModules(
        { factorCheck: 'v1', cheatCheck: 'v1', actFrontGate: 'v1', buyPointCheck: 'v1' });
    check('A6 v1 解析为现行具体版本（factorCheck）', resolved.factorCheck === FACTOR_PREBUY_VERSION,
        `实得 ${resolved.factorCheck} 期望 ${FACTOR_PREBUY_VERSION}`);
    check('A7 v1 解析为现行具体版本（cheatCheck D 系）', /^D3\./.test(resolved.cheatCheck || ''), JSON.stringify(resolved));
    check('A8 v1 解析为现行具体版本（actFrontGate AF 系）', /^AF/.test(resolved.actFrontGate || ''), JSON.stringify(resolved));
    check('A9 v1 解析为现行具体版本（buyPointCheck BP 系）', /^BP/.test(resolved.buyPointCheck || ''), JSON.stringify(resolved));
    // A10 未知版本键 throw（v2 自 Jev 退役·因子代起已是 cheatCheck/actFrontGate/buyPointCheck
    // 的合法键——未知键示例改用 v3）
    await throwsWithAsync('A10 resolveModules 未知版本键 throw',
        () => resolveModules({ cheatCheck: 'v3' }), '未知版本键');
    // factorCheck 无因子代（FP 本就是纯代码）——v2 对它仍是未知键
    await throwsWithAsync('A10b factorCheck 无 v2（因子门无需换代）',
        () => resolveModules({ factorCheck: 'v2' }), 'v1');

    const listed = listModuleVersions();
    check('A11 listModuleVersions 四模块各含 v1',
        ['factorCheck', 'cheatCheck', 'actFrontGate', 'buyPointCheck']
            .every((m) => Array.isArray(listed[m]) && listed[m].includes('v1')),
        JSON.stringify(listed));
}

// ═══════════════ A2. 因子代版本键（Jev 退役，2026-11-25） ═══════════════
async function testA2() {
    console.log('\n━━━ A2. 因子代版本键（Jev 退役） ━━━');
    const FR = require('../src/market-analysis/factor-responders');

    const v2 = await resolveModules({ cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2' });
    check('A2-1 三门 v2 解析为因子版本', v2.cheatCheck === FR.CHEAT_FACTOR_VERSION
        && v2.actFrontGate === FR.ACT_FRONT_FACTOR_VERSION
        && v2.buyPointCheck === FR.BUY_POINT_FACTOR_VERSION, JSON.stringify(v2));
    const v1 = await resolveModules({ cheatCheck: 'v1', actFrontGate: 'v1', buyPointCheck: 'v1' });
    check('A2-2 因子版本与 Jev 代版本域不重叠（粘滞 / bootstrap 版本域天然隔离）',
        ['cheatCheck', 'actFrontGate', 'buyPointCheck'].every((k) => v2[k] !== v1[k]), JSON.stringify({ v1, v2 }));
    check('A2-3 FACTOR_GENERATION_KEY = v2 / isFactorGeneration',
        FACTOR_GENERATION_KEY === 'v2' && isFactorGeneration('v2') === true && isFactorGeneration('v1') === false);
    const listed2 = listModuleVersions();
    check('A2-4 每模块 ≤2 代（规约锁：Jev 代 v1 + 因子代 v2，第三代须先退役一代）',
        Object.values(listed2).every((v) => v.length <= 2), JSON.stringify(listed2));
    check('A2-5 pointType 无因子代键', JSON.stringify(listed2.pointType) === JSON.stringify(['v1']));
    const mixed = await resolveModules({ cheatCheck: 'v1', actFrontGate: 'v2', buyPointCheck: 'v2' });
    check('A2-6 混代包合法（逐门消融对拍）', /^D3\./.test(mixed.cheatCheck) && mixed.actFrontGate === FR.ACT_FRONT_FACTOR_VERSION,
        JSON.stringify(mixed));

    const { validatePack } = require('../src/web/services/StrategyLibraryService');
    const goodBuyLeg = { priority: 1, cards: 4, buyPhase: 'first',
        condition: 'tradeCount >= 6 AND buyVolumeBnb >= 1',
        signalGate: { maxTriggers: 2, bpPassLevels: ['good', 'neutral'] } };
    const pack = (modules) => ({ buyLegs: [goodBuyLeg], sellLegs: [{ priority: 1, cards: 'all', condition: 'profitPercent >= 9999' }], modules });
    check('A2-7 validatePack 接受全因子代包', validatePack(pack({ cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2' })).valid === true);
    const badV3 = validatePack(pack({ cheatCheck: 'v3' }));
    check('A2-8 validatePack 拒绝未知版本键（v3）', badV3.valid === false && JSON.stringify(badV3.errors).includes('v3'),
        JSON.stringify(badV3.errors));
}

// ═══════════════ B. validatePack ═══════════════
function testB() {
    console.log('\n━━━ B. validatePack 策略包校验 ━━━');

    const goodBuyLeg = { priority: 1, cards: 4, buyPhase: 'first',
        condition: 'tradeCount >= 6 AND buyVolumeBnb >= 1',
        signalGate: { maxTriggers: 2, bpPassLevels: ['good', 'neutral'] } };
    const goodSellLeg = { priority: 2, cards: 'all', condition: 'profitPercent <= -40' };
    const goodPack = {
        buyLegs: [goodBuyLeg],
        sellLegs: [goodSellLeg],
        burstCooldown: {},
        modules: { factorCheck: 'v1', cheatCheck: 'v1', actFrontGate: 'v1', buyPointCheck: 'v1' },
    };
    check('B1 合法包通过', validatePack(goodPack).valid, JSON.stringify(validatePack(goodPack).errors));

    check('B2 definition 非对象 → invalid', !validatePack(null).valid);
    check('B3 definition 数组 → invalid', !validatePack([]).valid);

    const badTop = validatePack({ ...goodPack, side: 'buy' });
    check('B4 未知顶层键（side v1 残留）→ 错误提示',
        !badTop.valid && badTop.errors.some((e) => e.includes('未知顶层键')), JSON.stringify(badTop.errors));

    check('B5 buyLegs 空 → invalid', !validatePack({ ...goodPack, buyLegs: [] }).valid);
    check('B6 sellLegs 缺席 → invalid', !validatePack({ ...goodPack, sellLegs: undefined }).valid);

    const noCards = validatePack({ ...goodPack, sellLegs: [{ priority: 1, condition: 'profitPercent > 10' }] });
    check('B7 腿级错误透传（卖腿缺 cards）',
        !noCards.valid && noCards.errors.some((e) => e.includes('卖腿必须配置 cards')), JSON.stringify(noCards.errors));

    const badFactor = validatePack({ ...goodPack,
        buyLegs: [{ priority: 1, condition: 'noSuchFactor >= 1' }] });
    check('B8 未知因子腿拦截（三防线入库位）',
        !badFactor.valid && badFactor.errors.length > 0, JSON.stringify(badFactor.errors));

    const retiredStall = validatePack({ ...goodPack, stallClose: { stallMs: 50000 } });
    check('B9 顶层 stallClose（v16 及更早形状）→ RETIRED 错误引导腿化（T233）',
        !retiredStall.valid && retiredStall.errors.some((e) => e.includes('stallClose') && e.includes('T233')),
        JSON.stringify(retiredStall.errors));

    const stallLeg = {
        priority: 0, cards: 'all', bypassDebounce: true, stalledScanAfterSec: 45,
        condition: '(idleSecSinceLastSubstantialTick >= 90 AND currentVsLaunchPct <= 10) OR (idleSecSinceLastSubstantialTick >= 55 AND (currentVsLaunchPct > 10 OR currentVsLaunchPct IS NULL))',
    };
    check('B10 stall 签名卖腿（条件引用 idleSecSinceLastSubstantialTick 新键）→ 通过三防线',
        validatePack({ ...goodPack, sellLegs: [goodSellLeg, stallLeg] }).valid);
    check('B11 stall 腿 stalledScanAfterSec=45 形状 → 通过', validatePack({ ...goodPack, sellLegs: [stallLeg] }).valid);
    check('B12 stallClose 非对象（字符串）→ 同样 RETIRED 拦截',
        validatePack({ ...goodPack, stallClose: 'x' }).valid === false);

    check('B13 burstCooldown 死配置（check2Sec<=check1Sec）→ 错误',
        validateBurstCooldownSection({ check1Sec: 15, check2Sec: 15 }).some((e) => e.includes('必须大于')));
    check('B14 burstCooldown {} 全默认 → 通过', validateBurstCooldownSection({}).length === 0);
    check('B15 burstCooldown check1MinAbsorbBnb 越界 → 错误',
        validateBurstCooldownSection({ check1Sec: 15, check2Sec: 30, check1MinAbsorbBnb: 999 }).length > 0);

    const badMod1 = validatePack({ ...goodPack, modules: { factorCheck: 'v9' } });
    check('B16 modules 未知版本键 → 错误',
        !badMod1.valid && badMod1.errors.some((e) => e.includes('未知版本键')), JSON.stringify(badMod1.errors));
    const badMod2 = validatePack({ ...goodPack, modules: { nope: 'v1' } });
    check('B17 modules 未知模块名 → 错误',
        !badMod2.valid && badMod2.errors.some((e) => e.includes('未知模块名')), JSON.stringify(badMod2.errors));

    const noMods = validatePack({ buyLegs: [goodBuyLeg], sellLegs: [goodSellLeg] });
    check('B18 modules 缺席=四门全关（合法形状）', noMods.valid, JSON.stringify(noMods.errors));
}

// ═══════════════ C. _resolveStrategyPack ═══════════════
async function testC() {
    console.log('\n━━━ C. _resolveStrategyPack 解析三分支 ━━━');

    const def = {
        buyLegs: [{ priority: 1, cards: 4, condition: 'tradeCount >= 6' }],
        sellLegs: [{ priority: 2, cards: 'all', condition: 'profitPercent <= -40' }],
        burstCooldown: {},
        modules: { factorCheck: 'v1', cheatCheck: 'v1', actFrontGate: 'v1', buyPointCheck: 'v1' },
    };
    const fakeThis = (config) => ({
        _experiment: { id: 'exp-t202', config: JSON.parse(JSON.stringify(config)) },
        _experimentId: 'exp-t202',
        _logger: silentLogger,
    });
    const call = (self) => AbstractTradingEngine.prototype._resolveStrategyPack.call(self);

    // C1 旧内嵌腿拒启（不前向兼容）
    await throwsWithAsync('C1 旧内嵌腿 → throw 指引 --pack 转换',
        () => call(fakeThis({ strategiesConfig: { buyStrategies: [def.buyLegs[0]] } })),
        '--pack');

    // C2 无 strategyId 且无腿 → 静默返回（_buildStrategyConfig 后续报错）
    {
        const self = fakeThis({});
        await call(self);
        check('C2 无策略引用无旧腿 → 返回且不设缓存', self._strategyDefinition === undefined);
    }

    // C3 库缺行
    activeDb.packRow = null; activeDb.packError = { message: 'row not found' };
    await throwsWithAsync('C3 库缺行 → throw 策略包解析失败',
        () => call(fakeThis({ strategyId: '00000000-0000-0000-0000-000000000001' })),
        '策略包解析失败');

    // C4 definition 非法
    activeDb.packError = null;
    activeDb.packRow = { id: '00000000-0000-0000-0000-000000000002', name: '坏包', version: 3,
        definition: { buyLegs: [def.buyLegs[0]] } };
    await throwsWithAsync('C4 definition 缺 sellLegs → throw',
        () => call(fakeThis({ strategyId: activeDb.packRow.id })), 'definition 非法');

    // C5 modules 未知版本键
    activeDb.packRow = { id: '00000000-0000-0000-0000-000000000003', name: '坏模块包', version: 1,
        definition: { ...JSON.parse(JSON.stringify(def)), modules: { cheatCheck: 'v7' } } };
    await throwsWithAsync('C5 modules 未知版本键 → throw（fail-fast 不静默跑错代次）',
        () => call(fakeThis({ strategyId: activeDb.packRow.id })), '未知版本键');

    // C6 成功：缓存 + strategyResolved 写回
    activeDb.packRow = { id: '00000000-0000-0000-0000-000000000004', name: 'trading-standard-v1', version: 7,
        definition: JSON.parse(JSON.stringify(def)) };
    {
        const captured = [];
        const origGI = factoryMod.ExperimentFactory.getInstance;
        factoryMod.ExperimentFactory.getInstance = () => ({
            updateConfig: async (id, cfg) => { captured.push({ id, cfg }); return { success: true }; },
        });
        try {
            const self = fakeThis({ strategyId: activeDb.packRow.id, tradeAmount: 0.2 });
            await call(self);
            check('C6a _strategyDefinition 缓存包 definition',
                self._strategyDefinition === activeDb.packRow.definition);
            check('C6b _strategyResolved 带包 id/name/version/resolvedAt',
                self._strategyResolved.id === activeDb.packRow.id
                && self._strategyResolved.name === 'trading-standard-v1'
                && self._strategyResolved.version === 7
                && typeof self._strategyResolved.resolvedAt === 'string');
            check('C6c modules 解析为具体版本',
                self._strategyResolved.modules.factorCheck === FACTOR_PREBUY_VERSION
                && /^D3\./.test(self._strategyResolved.modules.cheatCheck));
            check('C6d 写回 config 含 strategyResolved（审计）',
                captured.length === 1 && captured[0].id === 'exp-t202'
                && captured[0].cfg.strategyResolved === self._strategyResolved
                && captured[0].cfg.tradeAmount === 0.2);
            check('C6e 内存 config 同步 strategyResolved', self._experiment.config.strategyResolved === self._strategyResolved);
        } finally {
            factoryMod.ExperimentFactory.getInstance = origGI;
        }
    }

    // C7 写回失败 best-effort：不阻塞启动、内存不更新
    {
        const origGI = factoryMod.ExperimentFactory.getInstance;
        factoryMod.ExperimentFactory.getInstance = () => ({
            updateConfig: async () => ({ success: false, error: 'stub-down' }),
        });
        try {
            const self = fakeThis({ strategyId: activeDb.packRow.id });
            let warned = 0;
            self._logger = { ...silentLogger, warn: () => { warned++; } };
            await call(self);
            check('C7a 写回失败不 throw（丢审计不丢交易）', self._strategyDefinition != null);
            check('C7b 写回失败 warn 留痕', warned > 0);
            check('C7c 写回失败内存 config 不更新', self._experiment.config.strategyResolved === undefined);
        } finally {
            factoryMod.ExperimentFactory.getInstance = origGI;
        }
    }

    // C8 stallClose 退役段引擎 fail-fast（双防线第二道：库层已 400，直插/残留行也拦）
    activeDb.packRow = { id: '00000000-0000-0000-0000-000000000005', name: 'v16-残留', version: 16,
        definition: { ...JSON.parse(JSON.stringify(def)), stallClose: { stallMs: 50000 } } };
    await throwsWithAsync('C8 definition 携带 stallClose → 引擎 fail-fast（T233）',
        () => call(fakeThis({ strategyId: activeDb.packRow.id })), '[T233]');
}

// ═══════════════ D. _buildStrategyConfig ═══════════════
function testD() {
    console.log('\n━━━ D. _buildStrategyConfig 薄读缓存 ━━━');

    const buyLegs = [{ priority: 1, condition: 'tradeCount >= 6' }];
    const sellLegs = [{ priority: 2, cards: 'all', condition: 'profitPercent <= -40' }];
    const self = {
        _experimentId: 'exp-t202',
        _experiment: { config: { strategyId: 'x' } },
        _strategyDefinition: { buyLegs, sellLegs, modules: {} },
    };
    const out = AbstractTradingEngine.prototype._buildStrategyConfig.call(self);
    check('D1 返回 {buyStrategies,sellStrategies} 引用包数组',
        out.buyStrategies === buyLegs && out.sellStrategies === sellLegs);

    throwsWith('D2 无缓存 → throw 指引 strategyId',
        () => AbstractTradingEngine.prototype._buildStrategyConfig.call(
            { _experimentId: 'e', _experiment: { config: {} }, _strategyDefinition: undefined }),
        'strategyId');
}

// ═══════════════ E. T242 实验级点位类型激活（引擎集成） ═══════════════
async function testE() {
    console.log('\n━━━ E. T242 实验级点位类型激活（_resolveStrategyPack / _buildStrategyConfig / _classifyPointType） ━━━');
    const router = require('../src/market-analysis/point-type-router');
    const IDS = router.POINT_TYPES.map((t) => t.id);
    const onlyNormal = Object.fromEntries(IDS.map((id) => [id, id === 'normal']));
    const SELL = [{ priority: 2, cards: 'all', condition: 'profitPercent <= -40' }];
    const P1 = { priority: 1, cards: 4, condition: 'tradeCount >= 6' };
    const P16 = { priority: 16, cards: 4, pointType: 'famous_holder_cold_pit', condition: 'tradeCount >= 60' };
    const P19 = { priority: 19, cards: 4, pointType: 'steady_trend_climb', condition: 'tradeCount >= 600' };
    const mkDef = (ptOn, buyLegs) => ({
        buyLegs, sellLegs: SELL, modules: { cheatCheck: 'v1', ...(ptOn ? { pointType: 'v1' } : {}) },
    });
    const fakeThis = (config) => ({
        _experiment: { id: 'exp-t242', config: JSON.parse(JSON.stringify(config)) },
        _experimentId: 'exp-t242',
        _logger: silentLogger,
    });
    const call = (self) => AbstractTradingEngine.prototype._resolveStrategyPack.call(self);
    const build = (self) => AbstractTradingEngine.prototype._buildStrategyConfig.call(self);
    const classify = (self, fx) => AbstractTradingEngine.prototype._classifyPointType.call(self, fx);
    let seq = 0xe0;
    const setPack = (def) => {
        activeDb.packError = null;
        seq += 1;
        activeDb.packRow = {
            id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`, name: 'pt-包', version: 1,
            definition: JSON.parse(JSON.stringify(def)),
        };
        return activeDb.packRow.id;
    };
    let writeCfg = null;
    const origGI = factoryMod.ExperimentFactory.getInstance;
    factoryMod.ExperimentFactory.getInstance = () => ({
        updateConfig: async (id, cfg) => { writeCfg = cfg; return { success: true }; },
    });
    try {
        const id = setPack(mkDef(true, [P1, P16, P19]));

        // E1 包启用 pointType、实验无覆盖 → 注册表缺省，零行为变化
        const self = fakeThis({ strategyId: id });
        await call(self);
        check('E1a 无覆盖 → 有效激活表 = 注册表缺省',
            JSON.stringify(self._pointTypeActiveById) === JSON.stringify(router.effectivePointTypeActive(null)));
        check('E1b 无覆盖不停用任何专属腿', Array.isArray(self._pointTypeDisabledLegs) && self._pointTypeDisabledLegs.length === 0);
        const out = build(self);
        check('E1c 买腿全组装（3 条）且包缓存数组不被改写',
            out.buyStrategies.length === 3 && self._strategyDefinition.buyLegs.length === 3
            && out.sellStrategies === self._strategyDefinition.sellLegs);
        check('E1d 审计 strategyResolved.pointTypes：source=registry / 未激活=famous_participation_pit,slow_develop_early（PT72）/ 无停用腿',
            self._strategyResolved.pointTypes.source === 'registry'
            && self._strategyResolved.pointTypes.inactive.join(',') === 'famous_participation_pit,slow_develop_early'
            && self._strategyResolved.pointTypes.disabledLegs.length === 0
            && self._strategyResolved.pointTypes.active[0] !== 'normal'
            && self._strategyResolved.pointTypes.active[self._strategyResolved.pointTypes.active.length - 1] === 'normal');
        check('E1e 写回 config 携带 pointTypes 审计', writeCfg.strategyResolved.pointTypes === self._strategyResolved.pointTypes);
        // PT73 判据对齐腿条件：夹具补全 p19 腿全部键
        const TREND = {
          tokenAgeSec: 120, currentVsLaunchPct: 55, priceMa60SlopePct: 20, actTotalBnb30s: 1.2, athVsFloorPct: 100,
          actTotalBnb: 0.5, chg10Pct: 5, chg30Pct: 12, anchorTickIsBuy: 1,
          mcapFromPeakPct: 10, launchMinVsFloorPct: 5, lifetimeBuyVolumeBnb: 6,
          sinceLastFamousBigBuySec: null, quietSpanMs: 0, actTotalBnb300s: 2,
          maxBlockBuyCircPct: 5, tradesRouterPct: 40, freshWalletHoldPct: 30,
          riseLegSec: 40, chg5Pct: 3, surgeStartSec: 40, tradedBlkConcPct: 20, tradedBlkChg5Pct: 10, famousFollowSlotMaxWallets: 3, gmgnRouterBuySharePct: 50,
        };
        check('E1f 无覆盖时引擎分类走类型（steady_trend_climb 夹具）', classify(self, TREND).type === 'steady_trend_climb');

        // E2 只激活 normal（用户指令「此处只激活 normal 这一个 pointType」）
        const self2 = fakeThis({ strategyId: id, pointTypes: { active: onlyNormal } });
        writeCfg = null;
        await call(self2);
        check('E2a 只激活 normal → 专属腿 P16/P19 停用', self2._pointTypeDisabledLegs.join(',') === '16,19');
        const out2 = build(self2);
        check('E2b 只组装无绑定的普通腿（P1）', out2.buyStrategies.length === 1 && out2.buyStrategies[0].priority === 1);
        check('E2c 包缓存原样（3 腿，过滤不落盘）', self2._strategyDefinition.buyLegs.length === 3);
        check('E2d 审计 source=experiment / active=[normal] / inactive=其余全部 / disabledLegs=[16,19]',
            self2._strategyResolved.pointTypes.source === 'experiment'
            && JSON.stringify(self2._strategyResolved.pointTypes.active) === '["normal"]'
            && JSON.stringify(self2._strategyResolved.pointTypes.inactive) === JSON.stringify(IDS.filter((x) => x !== 'normal'))
            && JSON.stringify(self2._strategyResolved.pointTypes.disabledLegs) === '[16,19]');
        check('E2e 写回 config 保留实验 pointTypes 段', writeCfg.pointTypes.active.normal === true
            && writeCfg.pointTypes.active.steady_trend_climb === false && writeCfg.pointTypes.active.famous_holder_cold_pit === false);
        check('E2f 引擎分类：原本命中类型的因子表落 normal（policy {}）',
            classify(self2, TREND).type === 'normal' && JSON.stringify(classify(self2, TREND).policy) === '{}'
            && classify(self2, { tokenAgeSec: 5 }).type === 'normal');

        // E3 部分覆盖：normal + steady_trend_climb
        const self3 = fakeThis({ strategyId: id, pointTypes: { active: { ...onlyNormal, steady_trend_climb: true } } });
        await call(self3);
        check('E3 部分覆盖（normal+steady_trend_climb）→ 仅停用 P16，P19 照常',
            self3._pointTypeDisabledLegs.join(',') === '16'
            && build(self3).buyStrategies.map((l) => l.priority).join(',') === '1,19'
            && classify(self3, TREND).type === 'steady_trend_climb');

        // E4 fail-fast 六条（启动防线；throw 后不缓存包）
        const packNoPt = setPack(mkDef(false, [P1]));
        await throwsWithAsync('E4a 实验携 pointTypes 但包未启用 modules.pointType → throw',
            () => call(fakeThis({ strategyId: packNoPt, pointTypes: { active: onlyNormal } })), '未启用 modules.pointType');
        const id2 = setPack(mkDef(true, [P1, P16, P19]));
        await throwsWithAsync('E4b 覆盖未知类型 → throw',
            () => call(fakeThis({ strategyId: id2, pointTypes: { active: { nope: false } } })), '未知类型');
        await throwsWithAsync('E4c 停用 normal → throw',
            () => call(fakeThis({ strategyId: id2, pointTypes: { active: { normal: false } } })), '不可停用');
        const badBind = setPack(mkDef(true, [P1, { priority: 20, cards: 4, pointType: 'nope', condition: 'tradeCount >= 6' }]));
        await throwsWithAsync('E4d 腿绑定未知类型 → throw',
            () => call(fakeThis({ strategyId: badBind })), '绑定非法');
        const bindNoMod = setPack(mkDef(false, [P1, { priority: 16, cards: 4, pointType: 'famous_holder_cold_pit', condition: 'tradeCount >= 60' }]));
        await throwsWithAsync('E4e 腿绑定而包无 pointType 模块 → throw',
            () => call(fakeThis({ strategyId: bindNoMod })), '未启用 modules.pointType');
        const allBound = setPack(mkDef(true, [P16, P19]));
        {
            const self = fakeThis({ strategyId: allBound, pointTypes: { active: onlyNormal } });
            await throwsWithAsync('E4f 覆盖使买腿清空 → throw',
                () => call(self), '使买腿清空');
            check('E4g fail-fast 后不缓存包（不半初始化）', self._strategyDefinition === undefined && self._strategyResolved === undefined);
        }

        // E5 包未启用 pointType 且无覆盖 → 包数组原引用零变化、无 pointTypes 审计键
        const id5 = setPack(mkDef(false, [P1]));
        const self5 = fakeThis({ strategyId: id5 });
        await call(self5);
        check('E5 包无 pointType 模块：有效表 null / 买腿原引用 / 审计无 pointTypes 键',
            self5._pointTypeActiveById === null && build(self5).buyStrategies === self5._strategyDefinition.buyLegs
            && self5._strategyResolved.pointTypes === undefined && classify(self5, TREND) === null);

        // E6 早退路径（无 strategyId）同样归零——防复用对象残留上一轮激活表
        const self6 = {
            _pointTypeActiveById: { normal: true }, _pointTypeDisabledLegs: [99],
            _experiment: { id: 'exp-t242', config: {} }, _experimentId: 'exp-t242', _logger: silentLogger,
        };
        await call(self6);
        check('E6 无 strategyId 早退 → 激活表/停用腿归零', self6._pointTypeActiveById === null && self6._pointTypeDisabledLegs.length === 0);
    } finally {
        factoryMod.ExperimentFactory.getInstance = origGI;
    }
}

// ═══════════════ F. 主包内容锁（T241 主包切因子代 + T242 专属腿绑定） ═══════════════
function testF() {
    console.log('\n━━━ F. 主包内容锁（T241 主包切因子代 + T242 专属腿↔类型绑定） ━━━');
    const { PACK_DEFINITION } = require('../scripts/deploy-trading-strategy.cjs');
    const { POINT_TYPES } = require('../src/market-analysis/point-type-router');
    const { deriveFactorPack } = require('../scripts/deploy-factor-generation-pack.cjs');
    const FR = require('../src/market-analysis/factor-responders');
    const BIND = {
        16: 'famous_holder_cold_pit', 17: 'strongbacker_solo_dance', 18: 'famous_participation_pit',
        19: 'steady_trend_climb', 20: 'market_maker_rhythm_pit',
    };
    const legs = PACK_DEFINITION.buyLegs;
    const bound = legs.filter((l) => l.pointType !== undefined);
    check('F1 专属腿恰 P16~P20 携带绑定且类型逐条正确；ladder 十四腿无绑定',
        bound.length === 5
        && legs.every((l) => (l.priority in BIND) === (l.pointType !== undefined) && (l.pointType === undefined || l.pointType === BIND[l.priority]))
        && legs.filter((l) => l.pointType === undefined).map((l) => l.priority).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12,13,14',
        JSON.stringify(bound.map((l) => [l.priority, l.pointType])));
    check('F2 绑定类型全在注册表；缺省激活除 P18（famous_participation_pit 未激活=PT72 裁定，主包静默丢 P18 腿=去激活语义）',
        bound.every((l) => POINT_TYPES.some((t) => t.id === l.pointType))
        && bound.filter((l) => POINT_TYPES.some((t) => t.id === l.pointType && t.active === true)).map((l) => l.pointType).join(',') === 'famous_holder_cold_pit,strongbacker_solo_dance,steady_trend_climb,market_maker_rhythm_pit'
        && bound.filter((l) => POINT_TYPES.some((t) => t.id === l.pointType && t.active === false)).map((l) => l.pointType).join(',') === 'famous_participation_pit');
    const mods = PACK_DEFINITION.modules;
    check('F3 主包启用 pointType 模块且 validatePack 通过', mods.pointType === 'v1' && validatePack(PACK_DEFINITION).valid === true);
    check('F4 主包门链 = 因子代（T241 用户裁定「主包切因子代」）：三门 v2，factorCheck/pointType v1',
        mods.cheatCheck === FACTOR_GENERATION_KEY && mods.actFrontGate === FACTOR_GENERATION_KEY
        && mods.buyPointCheck === FACTOR_GENERATION_KEY && mods.factorCheck === 'v1' && mods.pointType === 'v1',
        JSON.stringify(mods));
    const jev = deriveFactorPack(PACK_DEFINITION, null, 'v1');
    check('F5 Jev 基线可派生：--to v1 三门回 v1，腿逐字一致（回滚/对拍通道）',
        jev.swapped.join(',') === 'cheatCheck,actFrontGate,buyPointCheck'
        && jev.definition.modules.cheatCheck === 'v1' && jev.definition.modules.actFrontGate === 'v1'
        && jev.definition.modules.buyPointCheck === 'v1'
        && JSON.stringify(jev.definition.buyLegs) === JSON.stringify(PACK_DEFINITION.buyLegs)
        && JSON.stringify(jev.definition.sellLegs) === JSON.stringify(PACK_DEFINITION.sellLegs));
    check('F6 因子版本常量与键一致（v2 解析=CF/AF/BPF 现行常量）',
        FR.CHEAT_FACTOR_VERSION === 'CF1' && FR.ACT_FRONT_FACTOR_VERSION === 'AF3' && FR.BUY_POINT_FACTOR_VERSION === 'BPF3');
}

// ═══════════════ 主流程 ═══════════════
(async () => {
    await testA();
    await testA2();
    testB();
    await testC();
    testD();
    await testE();
    testF();
    console.log(`\n============================================================`);
    console.log(`策略包（T202 策略库二期）单测：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exit(1);
})().catch((e) => {
    console.error('测试脚本异常:', e);
    process.exit(1);
});
