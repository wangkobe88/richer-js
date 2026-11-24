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
const { assertModuleKey, resolveModules, listModuleVersions, MODULE_NAMES } =
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
    await throwsWithAsync('A10 resolveModules 未知版本键 throw',
        () => resolveModules({ cheatCheck: 'v2' }), '未知版本键');

    const listed = listModuleVersions();
    check('A11 listModuleVersions 四模块各含 v1',
        ['factorCheck', 'cheatCheck', 'actFrontGate', 'buyPointCheck']
            .every((m) => Array.isArray(listed[m]) && listed[m].includes('v1')),
        JSON.stringify(listed));
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

// ═══════════════ 主流程 ═══════════════
(async () => {
    await testA();
    testB();
    await testC();
    testD();
    console.log(`\n============================================================`);
    console.log(`策略包（T202 策略库二期）单测：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exit(1);
})().catch((e) => {
    console.error('测试脚本异常:', e);
    process.exit(1);
});
