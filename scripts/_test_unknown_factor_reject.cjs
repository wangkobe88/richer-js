#!/usr/bin/env node
// ============================================================================
// 条件表达式未知因子 fail-fast 单测（2026-10-03 hg55 事故防线）
//
// 事故：hg55 门配对（5efaff23/20b5b439）门子句误写裸键 holderTrendGrowth（真名
// holderTrendGrowthRatio），当时校验只 console.warn 放行 → (X >= 55 OR X IS NULL)
// 对未知 X 恒真，门零拦截，两臂作废。用户裁定：「发现没有因子，实验直接失败停止」。
//
// 防线三层（本测试锁定）：
//   ① ConditionEvaluator.validateCondition 补 IS_NULL/IS_NOT_NULL operand 检查
//   ② StrategyEngine.loadStrategies 校验失败 throw（四条件字段：condition /
//     narrativeCallCondition 用 FA 因子集；preBuyCheckCondition /
//     repeatBuyCheckCondition 用 PreBuyCheckService 评估上下文键集）
//   ③ PreBuyCheckService.getConditionFactorKeys()：空壳跑 _evaluateWithCondition
//     捕获 _safeEvaluate 实收 context 取键（真相源 = 运行时组装，零清单漂移）
//     + StrategyLibraryService.validateLegs 入库校验（库是第一编辑面）
//
// 零 DB 零网络。用法：node scripts/_test_unknown_factor_reject.cjs
// ============================================================================
const assert = require('assert');

const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { validateLegs } = require('../src/web/services/StrategyLibraryService');

let passed = 0, failed = 0;
function ok(cond, name) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

// ════════ A. validateCondition 矩阵（含 IS_NULL 新分支） ════════
section('A. validateCondition 矩阵');
{
    const ev = new ConditionEvaluator();
    const fa = new Set(['holderTrendGrowthRatio', 'tokenCycle', 'narrativeRating']);

    // A1 COMPARISON 未知左操作数
    let v = ev.validateCondition(ev.parseCondition('holderTrendGrowth >= 55'), fa);
    ok(!v.valid && v.errors.some(e => e.includes('holderTrendGrowth')),
        'A1 COMPARISON 未知左操作数报「未知因子」');

    // A2 COMPARISON 合法
    v = ev.validateCondition(ev.parseCondition('holderTrendGrowthRatio >= 55'), fa);
    ok(v.valid, 'A2 COMPARISON 合法因子通过');

    // A3 IS_NULL 未知 operand（事故形状的一半；原版绕过校验）
    v = ev.validateCondition(ev.parseCondition('holderTrendGrowth IS NULL'), fa);
    ok(!v.valid && v.errors.some(e => e.includes('holderTrendGrowth')),
        'A3 IS_NULL 未知 operand 报「未知因子」（事故形状）');

    // A4 IS_NOT_NULL 未知 operand
    v = ev.validateCondition(ev.parseCondition('holderTrendGrowth IS NOT NULL'), fa);
    ok(!v.valid, 'A4 IS_NOT_NULL 未知 operand 报「未知因子」');

    // A5 IS_NULL 合法
    v = ev.validateCondition(ev.parseCondition('tokenCycle IS NULL'), fa);
    ok(v.valid, 'A5 IS_NULL 合法因子通过');

    // A6 事故完整形状：OR 组合里未知键必须被查出
    v = ev.validateCondition(
        ev.parseCondition('(holderTrendGrowth >= 55 OR holderTrendGrowth IS NULL)'), fa);
    ok(!v.valid && v.errors.length >= 2, 'A6 (X >= 55 OR X IS NULL) 未知 X 两条子句均报');

    // A7 数字/字符串字面量右操作数不误报
    v = ev.validateCondition(ev.parseCondition("platform != 'flap'"), new Set(['platform']));
    ok(v.valid, "A7 字符串字面量右操作数不误报");
}

// ════════ B. loadStrategies throw 矩阵 ════════
section('B. loadStrategies fail-fast');
const FA_SET = new Set(require('../src/trading-engine/core/FactorBuilder').getAvailableFactorIds());
const PREBUY_SET = new Set(PreBuyCheckService.getConditionFactorKeys());
const leg = (over) => ({
    id: 'buy_0_1', name: '测试买腿', action: 'buy', priority: 1,
    condition: 'buyVolumeBnb >= 1.5', ...over,
});
const tryLoad = (cfgs, ids, pbIds) => {
    try {
        new StrategyEngine().loadStrategies(cfgs, ids, pbIds);
        return null;
    } catch (e) { return e; }
};
{
    // B1 主 condition 未知键 → throw
    let e = tryLoad([leg({ condition: 'holderTrendGrowth >= 55' })], FA_SET, PREBUY_SET);
    ok(e && /未知因子.*holderTrendGrowth/.test(e.message), 'B1 主 condition 未知键 throw');

    // B2 事故形状 → throw
    e = tryLoad([leg({ condition: 'buyVolumeBnb >= 1.5 AND (holderTrendGrowth >= 55 OR holderTrendGrowth IS NULL)' })], FA_SET, PREBUY_SET);
    ok(e && /holderTrendGrowth/.test(e.message), 'B2 事故形状 (X>=55 OR X IS NULL) throw');

    // B3 preBuyCheckCondition 未知键 → throw（preBuy 键集校验）
    e = tryLoad([leg({ preBuyCheckCondition: 'narrativeRatings == 2' })], FA_SET, PREBUY_SET);
    ok(e && /preBuyCheckCondition.*narrativeRatings/.test(e.message), 'B3 preBuy 未知键 throw');

    // B4 narrativeCallCondition 未知键 → throw（FA 键集校验）
    e = tryLoad([leg({ narrativeCallCondition: 'tokenAgeSecs < 90' })], FA_SET, PREBUY_SET);
    ok(e && /narrativeCallCondition.*tokenAgeSecs/.test(e.message), 'B4 narrativeCall 未知键 throw');

    // B5 repeatBuyCheckCondition 未知键 → throw
    e = tryLoad([leg({ repeatBuyCheckCondition: 'fooBar > 1' })], FA_SET, PREBUY_SET);
    ok(e && /repeatBuyCheckCondition.*fooBar/.test(e.message), 'B5 repeatBuy 未知键 throw');

    // B6 合法四条件全过 → 加载成功
    e = tryLoad([leg({
        condition: 'buyVolumeBnb >= 1.5 AND (holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL)',
        narrativeCallCondition: 'buyVolumeBnb >= 1.5 AND tokenAgeSec < 90',
        preBuyCheckCondition: "(narrativeRating == 2 OR narrativeRating == 3) AND (platform != 'flap' OR earlyTradesRouterPct >= 50)",
        repeatBuyCheckCondition: 'earlyTradesTop1BuySharePct < 60',
    })], FA_SET, PREBUY_SET);
    ok(e === null, 'B6 合法四条件（真名 hg 门 + router 分门）加载成功');

    // B7 不传集合 = 不校验（constructor 便捷路径/单测兼容）
    e = tryLoad([leg({ condition: 'totallyUnknownFactor > 1' })], null, null);
    ok(e === null, 'B7 不传集合不校验（兼容路径不 throw）');

    // B8 只传 FA 集、preBuy 条件含 preBuy 专有键 → 不误报（preBuy 集缺省跳过）
    e = tryLoad([leg({ preBuyCheckCondition: 'narrativeRating == 2' })], FA_SET, null);
    ok(e === null, 'B8 preBuy 集缺省时 preBuy 条件跳过校验（不拿 FA 集误报）');

    // B9 真名因子集完备性：hg 真名在 FA 集
    ok(FA_SET.has('holderTrendGrowthRatio'), 'B9 holderTrendGrowthRatio ∈ FA 因子集');
}

// ════════ C. getConditionFactorKeys 同源性 ════════
section('C. preBuy 键集真相源');
{
    const keys = PreBuyCheckService.getConditionFactorKeys();
    const must = ['narrativeRating', 'platform', 'earlyTradesRouterPct', 'earlyTradesTop1BuySharePct',
        'earlyTradesTop1BuyCovered', 'earlyTradesUniqueWallets', 'buyRound', 'drawdownFromHighest',
        'narrativeLeaderHot', 'gmgnBundlerWalletRatio', 'strictSameNameMaxFDV', 'walletDiversityIndex'];
    ok(must.every(k => keys.includes(k)), `C1 核心 preBuy 键齐全（${keys.length} 键）`);
    ok(!keys.includes('buyVolumeBnb') && !keys.includes('tokenAgeSec'),
        'C2 FA 专有键不在 preBuy 键集（分集正确，preBuy 评估上下文无 FA 因子）');

    // C3 与实际评估 context 同源：打桩实例跑一次非空 deps，捕获键集须与静态方法恒等
    const svc = Object.create(PreBuyCheckService.prototype);
    svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
    let captured = null;
    svc._safeEvaluate = (_c, ctx) => { captured = ctx; return true; };
    svc._diagnoseCondition = () => ({ conditionList: [], summaryReason: '' });
    const nz = { earlyTradesRouterPct: 50.4 };
    svc._evaluateWithCondition({}, {}, nz, {}, {}, {}, {}, '1 == 1', Date.now(), null, null, { narrativeRating: 2 });
    ok(captured && JSON.stringify(Object.keys(captured).sort()) === JSON.stringify([...keys].sort()),
        'C3 实跑捕获 context 键集与 getConditionFactorKeys 恒等（零清单漂移）');
}

// ════════ D. 策略库入库校验 ════════
section('D. validateLegs 入库防线');
{
    let r = validateLegs('buy', [{ condition: 'holderTrendGrowth >= 55' }]);
    ok(!r.valid && r.errors.some(e => e.includes('holderTrendGrowth')), 'D1 库腿未知因子被拦');

    r = validateLegs('buy', [{ condition: 'buyVolumeBnb >= 1.5', preBuyCheckCondition: 'narrativeRating == 2' }]);
    ok(r.valid, 'D2 preBuy 条件用 preBuy 专有键 narrativeRating 不误报');

    r = validateLegs('buy', [{ condition: 'buyVolumeBnb >= 1.5', preBuyCheckCondition: 'tokenAgeSec < 90' }]);
    ok(!r.valid, 'D3 preBuy 条件用 FA 专有键 tokenAgeSec 被拦（评估上下文没有该键，写=无效）');

    r = validateLegs('buy', [{ condition: 'buyVolumeBnb >= &&&' }]);
    ok(!r.valid && r.errors.some(e => e.includes('语法错误')), 'D4 库腿 condition 语法错被拦');

    r = validateLegs('buy', [{
        condition: 'buyVolumeBnb >= 1.5 AND (holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL)',
        narrativeCallCondition: 'tokenAgeSec < 90',
        preBuyCheckCondition: "(narrativeRating == 2 OR narrativeRating == 3) AND earlyTradesRouterPct >= 50",
    }]);
    ok(r.valid, 'D5 合法腿（真名 hg 门）零错误');
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${passed} / 失败 ${failed}`);
process.exit(failed ? 1 : 0);
