#!/usr/bin/env node
// ============================================================================
// router 门观察史单测（2026-10-03 用户指令：拦「rp<50 涨进窗」+「被拒 >10 次」）
//
// 链路：引擎实例级 _routerGateState Map（per-token）→ performAllChecks options
// 透传 → preBuy 评估 context 新两键 earlyTradesRouterLowSideSeen /
// earlyTradesRouterRejectCount → 门条件 fail-open 消费。状态语义 = 分析脚本
// analyze-router-late-entry.cjs 的 mixed 口径（flap && rp 非空 && (rp<50 ||
// rp>=80) 出界；rp 三处空/错路径返回 0 非 null，与该口径天然一致）。
//
// 五节：
//   A. 纯函数矩阵（updateRouterGateState / routerGateFactors / 边界常量）
//   B. 门条件评估矩阵（真 ConditionEvaluator：新两子句 × 状态/platform 组合）
//   C. 场景重放（≥80 回落放行 / <50 涨进拦 / >10 拦·恰 10 放 / fourmeme 恒放）
//   D. service 透传（context+baseResult 含新键；getConditionFactorKeys 收键；
//      完整 W1 条件过 validateCondition fail-fast 集）
//   E. 源码口径（两引擎 + service 接线字符串断言）
//
// 零 DB 零网络。用法：node scripts/_test_router_gate_state.cjs
// ============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  updateRouterGateState, routerGateFactors, ROUTER_GATE_LOW, ROUTER_GATE_HIGH,
} = require('../src/trading-engine/pre-check/router-gate-state');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let passed = 0, failed = 0;
function ok(cond, name) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

// W1 门臂追加的两子句（与 create-router-gate-pair.cjs 同文；风格对齐既有
// `(platform != 'flap' OR …)` 区间门子句）
const GATE_CLAUSE = "(platform != 'flap' OR earlyTradesRouterLowSideSeen == 0 OR earlyTradesRouterLowSideSeen IS NULL)"
  + " AND (platform != 'flap' OR earlyTradesRouterRejectCount <= 10 OR earlyTradesRouterRejectCount IS NULL)";
// 完整 W1 preBuyCheckCondition（9252d60a 基线 + 上述两子句）
const FULL_W1 = "(narrativeRating == 2 OR narrativeRating == 3) AND earlyTradesTop1BuySharePct < 60"
  + " AND earlyTradesTop1BuyCovered == 1 AND (platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))"
  + " AND earlyTradesUniqueWallets >= 15 AND " + GATE_CLAUSE;

// ════════ A. 纯函数矩阵 ════════
section('A. updateRouterGateState / routerGateFactors 纯函数');
{
    // A1 边界常量锚定（与 buy-v2 区间门 [50,80) 同源；物理分离警示见模块头）
    ok(ROUTER_GATE_LOW === 50 && ROUTER_GATE_HIGH === 80, 'A1 边界常量 50/80');

    // A2 rp=null → 不累计，无状态给 fresh 零状态
    let st = updateRouterGateState(undefined, 'flap', null);
    ok(st && st.lowSideSeen === 0 && st.outCount === 0, 'A2 rp=null 无状态 → fresh {0,0}');
    st = updateRouterGateState({ lowSideSeen: 1, outCount: 3 }, 'flap', null);
    ok(st.lowSideSeen === 1 && st.outCount === 3, 'A2b rp=null 既有状态原样保留');

    // A3 非 flap → 不累计（fourmeme 票观察史恒零）
    st = updateRouterGateState(undefined, 'fourmeme', 0);
    ok(st && st.lowSideSeen === 0 && st.outCount === 0, 'A3 非 flap 无状态 → fresh {0,0}');
    st = updateRouterGateState({ lowSideSeen: 1, outCount: 3 }, 'fourmeme', 90);
    ok(st.lowSideSeen === 1 && st.outCount === 3, 'A3b 非 flap 既有状态原样保留（不累计）');
    st = updateRouterGateState({ lowSideSeen: 0, outCount: 2 }, null, 90);
    ok(st.outCount === 2, 'A3c platform=null 不累计');

    // A4 rp<50 → lowSide 置位 + 出界计数
    st = updateRouterGateState(undefined, 'flap', 30);
    ok(st.lowSideSeen === 1 && st.outCount === 1, 'A4 rp=30 → {1,1}');
    // A5 rp>=80 → 只计 outCount 不动 lowSide
    st = updateRouterGateState({ lowSideSeen: 0, outCount: 1 }, 'flap', 85);
    ok(st.lowSideSeen === 0 && st.outCount === 2, 'A5 rp=85 → {0,2}（高侧不置 lowSide）');
    // A6 窗内 [50,80) → 完全不累计
    st = updateRouterGateState({ lowSideSeen: 1, outCount: 3 }, 'flap', 60);
    ok(st.lowSideSeen === 1 && st.outCount === 3, 'A6 rp=60 窗内 → 状态不变');
    st = updateRouterGateState(undefined, 'flap', 76);
    ok(st && st.lowSideSeen === 0 && st.outCount === 0, 'A6b 首 fire rp=76 窗内 → fresh {0,0}');
    // A7 边界值：50 在窗内 / 80 出界 / 49.99 低侧
    st = updateRouterGateState({ lowSideSeen: 0, outCount: 0 }, 'flap', 50);
    ok(st.outCount === 0, 'A7 rp=50（闭下界）窗内不计数');
    st = updateRouterGateState({ lowSideSeen: 0, outCount: 0 }, 'flap', 80);
    ok(st.outCount === 1 && st.lowSideSeen === 0, 'A7b rp=80（开上界）出界计数');
    st = updateRouterGateState({ lowSideSeen: 0, outCount: 0 }, 'flap', 49.99);
    ok(st.lowSideSeen === 1 && st.outCount === 1, 'A7c rp=49.99 低侧置位+计数');
    // A8 只置不清：低侧见过后窗内序列不清零
    st = { lowSideSeen: 1, outCount: 1 };
    for (const rp of [55, 60, 70, 76]) st = updateRouterGateState(st, 'flap', rp);
    ok(st.lowSideSeen === 1 && st.outCount === 1, 'A8 低侧标记只置不清（历史形状）');

    // A9 routerGateFactors：无状态双 null；有状态直读
    let f = routerGateFactors(undefined);
    ok(f.earlyTradesRouterLowSideSeen === null && f.earlyTradesRouterRejectCount === null,
        'A9 无状态 → 双 null（门 fail-open）');
    f = routerGateFactors({ lowSideSeen: 0, outCount: 7 });
    ok(f.earlyTradesRouterLowSideSeen === 0 && f.earlyTradesRouterRejectCount === 7,
        'A9b 有状态 → 直读字段');
}

// ════════ B. 门条件评估矩阵（真 ConditionEvaluator） ════════
section('B. 新门两子句评估矩阵');
const ev = new ConditionEvaluator();
{
    const cases = [
        // [platform, lowSide, count, 期望, 说明]
        ['flap', 0, 0, true, 'flap 全净史放行'],
        ['flap', 1, 1, false, 'flap 低侧见过 → 拦'],
        ['flap', 1, 0, false, 'flap 低侧见过（计数 0）→ 拦'],
        ['flap', 0, 10, true, '恰 10 次出界 → 放（>10 才拦）'],
        ['flap', 0, 11, false, '11 次出界 → 拦'],
        ['flap', null, null, true, 'flap 无状态双 null → IS NULL 放行（首 fire）'],
        ['flap', null, 5, true, 'flap lowSide null（不应发生，防御）→ IS NULL 放行'],
        ['fourmeme', 1, 20, true, 'fourmeme 恒放行（platform != flap 短路）'],
        [null, null, null, true, 'platform null + 无状态 → IS NULL 放行 fail-open'],
        [null, 1, 11, false, 'platform null + 有出界史 → 拦（!= null 比较恒 false 落新门，fail-closed）'],
    ];
    for (const [plat, low, cnt, want, name] of cases) {
        const got = ev.evaluate(GATE_CLAUSE, {
            platform: plat,
            earlyTradesRouterLowSideSeen: low,
            earlyTradesRouterRejectCount: cnt,
        });
        ok(got === want, `B ${name} [platform=${plat} low=${low} count=${cnt}] → ${want}`);
    }
}

// ════════ C. 场景重放（引擎 Map 演化 + 门评估同序） ════════
section('C. fire 序列重放（评估读检查前状态 → 检查后回填）');
{
    // 模拟引擎循环：options 读 routerGateFactors(state) → 评估 → 回填 update
    function replay(fires) {
        let state;   // Map.get 初始 undefined
        return fires.map(([platform, rp]) => {
            const factors = routerGateFactors(state);
            const gatePass = ev.evaluate(GATE_CLAUSE, { platform, ...factors });
            state = updateRouterGateState(state, platform, rp);
            return { gatePass, stateAfter: state };
        });
    }

    // C1 ≥80 回落进窗票（bot 退潮侧，净正形状）——不拦
    let r = replay([['flap', 85], ['flap', 82], ['flap', 76]]);
    ok(r.every(x => x.gatePass), 'C1 rp=[85,82,76] 回落票三次 fire 门全放');
    ok(r[2].stateAfter.lowSideSeen === 0 && r[2].stateAfter.outCount === 2,
        'C1b 终态 {0,2}（高侧两次出界、低侧从未见过）');

    // C2 <50 涨进窗票（GMGN 追热侧，净负形状）——第二次 fire 起拦
    r = replay([['flap', 30], ['flap', 45], ['flap', 55]]);
    ok(r[0].gatePass === true, 'C2 首 fire（无状态）放行——本次 rp=30 出界由区间门拦');
    ok(r[1].gatePass === false, 'C2b 第二 fire rp=45：lowSide=1 → 新门拦');
    ok(r[2].gatePass === false, 'C2c 第三 fire rp=55 涨进窗：历史低侧 → 新门拦（核心目标形状）');

    // C3 被拒 >10 次票——第 12 次 fire 起拦
    const fires = Array.from({ length: 12 }, () => ['flap', 85]);
    fires.push(['flap', 60]);
    r = replay(fires);
    ok(r.slice(0, 11).every(x => x.gatePass), 'C3 前 11 fire（评估读 outCount 0→10）门全放');
    ok(r[10].stateAfter.outCount === 11 && r[10].gatePass === true,
        'C3b 第 11 fire：评估读 outCount=10 恰在阈值内放行，回填后 11');
    ok(r[11].gatePass === false, 'C3c 第 12 fire（评估读 outCount=11 > 10）→ 拦');
    ok(r[12].gatePass === false, 'C3d 第 13 fire rp=60 漂进窗：出界 12 次 → 仍拦');

    // C4 fourmeme 票——观察史恒零恒放
    r = replay([['fourmeme', 0], ['fourmeme', 0], ['fourmeme', 95]]);
    ok(r.every(x => x.gatePass), 'C4 fourmeme 三 fire 门全放（rp 对 fourmeme 无语义）');
    ok(r[2].stateAfter.outCount === 0, 'C4b 状态恒 {0,0}（非 flap 不累计）');

    // C5 全窗内序列——首 fire 即净史
    r = replay([['flap', 60], ['flap', 65]]);
    ok(r.every(x => x.gatePass) && r[1].stateAfter.outCount === 0,
        'C5 窗内正常票零扰动（无出界史 → 新门不生效）');
}

// ════════ D. service 透传 + fail-fast 键集 ════════
section('D. PreBuyCheckService 透传');
{
    // D1 _evaluateWithCondition：extraContext 新键进 context 与 baseResult（打桩姿势同 _test_unknown_factor_reject）
    const svc = Object.create(PreBuyCheckService.prototype);
    svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
    let captured = null;
    svc._safeEvaluate = (_c, ctx) => { captured = ctx; return true; };
    svc._diagnoseCondition = () => ({ conditionList: [], summaryReason: '' });
    const nz = {};
    const res = svc._evaluateWithCondition(nz, nz, nz, nz, nz, nz, nz, '1 == 1', Date.now(), null, null, {
        platform: 'flap', earlyTradesRouterLowSideSeen: 1, earlyTradesRouterRejectCount: 3,
    });
    ok(captured && captured.earlyTradesRouterLowSideSeen === 1 && captured.earlyTradesRouterRejectCount === 3,
        'D1 评估 context 含新两键（透传值）');
    ok(captured && captured.platform === 'flap', 'D1b platform 同链透传');
    ok(res.earlyTradesRouterLowSideSeen === 1 && res.earlyTradesRouterRejectCount === 3,
        'D1c baseResult 存档含新两键（signal metadata preBuyCheckFactors 可见）');

    // D2 extraContext 缺键 → 双 null（fail-open 默认）
    let cap2 = null;
    svc._safeEvaluate = (_c, ctx) => { cap2 = ctx; return true; };
    svc._evaluateWithCondition(nz, nz, nz, nz, nz, nz, nz, '1 == 1', Date.now(), null, null, {});
    ok(cap2 && cap2.earlyTradesRouterLowSideSeen === null && cap2.earlyTradesRouterRejectCount === null,
        'D2 缺省 → 双 null');

    // D3 getConditionFactorKeys 真相源收键（loadStrategies fail-fast 校验集）
    const keys = PreBuyCheckService.getConditionFactorKeys();
    ok(keys.includes('earlyTradesRouterLowSideSeen') && keys.includes('earlyTradesRouterRejectCount'),
        'D3 getConditionFactorKeys 含新两键（空壳捕获自动跟上）');

    // D4 完整 W1 条件过 validateCondition（hg55 事故同款防线：未知因子拒启）
    const v = ev.validateCondition(ev.parseCondition(FULL_W1), new Set(keys));
    ok(v.valid, `D4 完整 W1 条件过 preBuy 键集校验${v.valid ? '' : ' errors=' + JSON.stringify(v.errors)}`);

    // D5 完整 W1 条件端到端评估（真 evaluator，无打桩）：净史放行 / 低侧拦 / 超次数拦
    const passCtx = {
        narrativeRating: 2, earlyTradesTop1BuySharePct: 30, earlyTradesTop1BuyCovered: 1,
        platform: 'flap', earlyTradesRouterPct: 65, earlyTradesUniqueWallets: 20,
        earlyTradesRouterLowSideSeen: 0, earlyTradesRouterRejectCount: 0,
    };
    ok(ev.evaluate(FULL_W1, passCtx) === true, 'D5 flap 净史全门过 → 放行');
    ok(ev.evaluate(FULL_W1, { ...passCtx, earlyTradesRouterLowSideSeen: 1 }) === false,
        'D5b 低侧史 → 拦（其余门全过）');
    ok(ev.evaluate(FULL_W1, { ...passCtx, earlyTradesRouterRejectCount: 11 }) === false,
        'D5c 11 次出界史 → 拦');
    ok(ev.evaluate(FULL_W1, { ...passCtx, earlyTradesRouterLowSideSeen: null, earlyTradesRouterRejectCount: null }) === true,
        'D5d 首 fire 双 null → 放行');
    ok(ev.evaluate(FULL_W1, { ...passCtx, platform: 'fourmeme', earlyTradesRouterPct: 0,
        earlyTradesRouterLowSideSeen: 1, earlyTradesRouterRejectCount: 20 }) === true,
        'D5e fourmeme 新门短路放行');
}

// ════════ E. 源码口径（两引擎 + service 接线） ════════
section('E. 源码接线断言');
{
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const live = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    const bt = read('src/trading-engine/implementations/BacktestEngine.js');
    const svc = read('src/trading-engine/pre-check/PreBuyCheckService.js');

    for (const [label, src] of [['实时引擎', live], ['回测引擎', bt]]) {
        ok(src.includes('this._routerGateState = new Map()'), `E ${label} constructor Map`);
        ok(src.includes("require('../pre-check/router-gate-state')"), `E ${label} 延迟 require`);
        ok(src.includes('routerGateFactors(this._routerGateState.get('), `E ${label} options 透传读状态`);
        ok(src.includes('updateRouterGateState('), `E ${label} fire 后回填`);
        ok(src.includes('earlyTradesRouterPct != null'), `E ${label} 回填 rp 非空门（宁漏不误）`);
    }
    ok(bt.includes('tokenPlatform,\n') && /updateRouterGateState\(\s*\n?\s*this\._routerGateState\.get\(token\.token\),\s*\n?\s*tokenPlatform,/.test(bt),
        'E 回测引擎回填用 tokenPlatform（tick 行级平台）');
    ok(svc.includes('earlyTradesRouterLowSideSeen, earlyTradesRouterRejectCount } = options'),
        'E service options 解构');
    ok((svc.match(/earlyTradesRouterLowSideSeen \?\? null/g) || []).length >= 2,
        'E service extraContext/baseResult/context null 默认');
}

// ════════ F. FactorBuilder 存档白名单（signal metadata preBuyCheckFactors 可见性） ════════
section('F. buildPreBuyCheckFactorValues 存档白名单');
{
    const { buildPreBuyCheckFactorValues } = require('../src/trading-engine/core/FactorBuilder');
    // F1 缺省输入 → 双 null（compare/归因从 metadata 读键；null 非 0——首 fire 语义区分）
    const empty = buildPreBuyCheckFactorValues({});
    ok(empty.earlyTradesRouterLowSideSeen === null && empty.earlyTradesRouterRejectCount === null,
        'F1 缺省输入 → 双 null');
    // F2 透传值直读
    const full = buildPreBuyCheckFactorValues({ earlyTradesRouterLowSideSeen: 1, earlyTradesRouterRejectCount: 7 });
    ok(full.earlyTradesRouterLowSideSeen === 1 && full.earlyTradesRouterRejectCount === 7,
        'F2 透传值直读存档');
    // F3 null 显式输入保持 null（?? 兜底不冒充 0）
    const nulls = buildPreBuyCheckFactorValues({ earlyTradesRouterLowSideSeen: null, earlyTradesRouterRejectCount: null });
    ok(nulls.earlyTradesRouterLowSideSeen === null && nulls.earlyTradesRouterRejectCount === null,
        'F3 null 输入 → null 不冒充 0');
    // F4 rp 既有键不受影响（相邻键回归）
    ok(buildPreBuyCheckFactorValues({ earlyTradesRouterPct: 63 }).earlyTradesRouterPct === 63,
        'F4 既有 routerPct 键回归');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
