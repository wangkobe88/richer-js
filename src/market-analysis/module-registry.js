/**
 * 交易策略包——检测模块版本注册表（策略库二期 / T202，2026-11-20）
 *
 * 策略包 definition.modules 携带抽象版本键（如 'v1'），键在场=模块启用；
 * 引擎启动时经本注册表把版本键解析为**当前代码**（resolve 返回该代次的
 * 具体版本常量，落 strategyResolved 审计与启动日志）。
 *
 * 版本规约（用户裁定 2026-11-20「代码一般只维护两个版本」）：
 *   - 模块逻辑做破坏性调整时**新增一代键**（v2…），旧键保留至退役再删——
 *     同一时刻注册表内最多两代（先例=wallet-scorer.js STRATEGIES 注册表）
 *   - 包携带未注册的模块名/版本键 → assertModuleKey/resolveModules 直接
 *     throw fail-fast（引擎拒启）——绝不静默回落（静默=跑错代次还以为在测新版）
 *   - 非破坏性微调（阈值/臂补强）不新增版本键，直接改现行实现——所有引用
 *     该键的包随进程升级自动吃到新代码（这正是「启动时取最新」语义的一半：
 *     键内跟随代码，键间显式选择）
 *
 * 红线：本文件是 CJS；cheat/buy-point 题集是 ESM（.mjs）——只经 dynamic
 * import 读取其导出（CheatCheckService.js:1337 先例），绝不在 .mjs 侧 import
 * 本文件，也不在题集文件里加任何注册表内容（单一方向依赖）。
 */

/** @type {Object<string, Object<string, {resolve: (Function|AsyncFunction)}>>} */
const REGISTRY = {
    // 因子购买前检查门（FP 族，纯代码零 Jev）——factor-pre-buy-check.js 是 CJS，同步 require
    factorCheck: {
        v1: { resolve: () => require('./factor-pre-buy-check').FACTOR_PREBUY_VERSION },
    },
    // Jev 作弊检测门（cheat 题集 + grade 规则）
    // v2 = 因子代（Jev 退役，2026-11-25 用户裁定）：结论由 factor-responders 产出，
    // 形状与 Jev 链同构、下游零改动；Jev 代 v1 保留一代（回滚 / 对拍基线）
    cheatCheck: {
        v1: {
            resolve: async () => {
                const q = await import('./llm/cheat-questions.mjs');
                return q.CHEAT_QUESTIONS_VERSION;
            },
        },
        v2: { resolve: () => require('./factor-responders').CHEAT_FACTOR_VERSION },
    },
    // Jev 前置活跃度门（AF1，独立于 cheatCheck 的版本域——组成/题面变化各自 bump）
    // v2 = 因子代（同上）
    actFrontGate: {
        v1: {
            resolve: async () => {
                const q = await import('./llm/cheat-questions.mjs');
                return q.ACT_FRONT_QUESTIONS_VERSION;
            },
        },
        v2: { resolve: () => require('./factor-responders').ACT_FRONT_FACTOR_VERSION },
    },
    // 买入点位检查门（BP 题集）；v2 = 因子代（同上）
    buyPointCheck: {
        v1: {
            resolve: async () => {
                const q = await import('./llm/buy-point-questions.mjs');
                return q.BUY_POINT_QUESTIONS_VERSION;
            },
        },
        v2: { resolve: () => require('./factor-responders').BUY_POINT_FACTOR_VERSION },
    },
    // 点位类型辨别与对应策略（T216——纯因子分类层，门链接纳策略路由）
    pointType: {
        v1: { resolve: () => require('./point-type-router').POINT_TYPE_VERSION },
    },
};

const MODULE_NAMES = Object.freeze(Object.keys(REGISTRY));

/**
 * 因子代版本键（Jev 退役，2026-11-25）：cheatCheck / actFrontGate / buyPointCheck
 * 三模块取此键 = 该门由 factor-responders 出结论、不调 Jev。引擎据它给 service 注入
 * factor 模式；三键可独立取（混代包合法——用于逐门消融对拍）。
 */
const FACTOR_GENERATION_KEY = 'v2';

/** 版本键是否为因子代 */
function isFactorGeneration(key) {
    return key === FACTOR_GENERATION_KEY;
}

/**
 * 断言模块名与版本键均已在注册表登记
 * @param {string} name - 模块名（factorCheck/cheatCheck/actFrontGate/buyPointCheck/pointType）
 * @param {string} key - 版本键（'v1' / 'v2'…；v2=因子代，仅 cheatCheck/actFrontGate/buyPointCheck 有）
 * @throws {Error} 未注册的模块名或版本键（fail-fast，调用方拒启/400）
 */
function assertModuleKey(name, key) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(REGISTRY, name)) {
        throw new Error(
            `策略包 modules 携带未知模块名 ${JSON.stringify(name)}（可用：${MODULE_NAMES.join('/')}）`);
    }
    const variants = REGISTRY[name];
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(variants, key)) {
        throw new Error(
            `策略包 modules.${name} 携带未知版本键 ${JSON.stringify(key)}（可用：${Object.keys(variants).join('/')}）`);
    }
    return true;
}

/**
 * 解析包 modules → 具体代码版本映射（用于 strategyResolved 审计与启动日志）
 * @param {Object|null} modules - {factorCheck:'v1',...}；null/undefined → {}
 * @returns {Promise<Object>} 如 {factorCheck:'FP32', cheatCheck:'D3.81', ...}
 * @throws {Error} 任一键非法（fail-fast）
 */
async function resolveModules(modules) {
    const out = {};
    if (modules == null) return out;
    if (typeof modules !== 'object' || Array.isArray(modules)) {
        throw new Error('策略包 modules 段形状非法（须为对象）');
    }
    for (const [name, key] of Object.entries(modules)) {
        assertModuleKey(name, key);
        out[name] = await REGISTRY[name][key].resolve();
    }
    return out;
}

/**
 * 注册表清单（API/页面下拉单一真相源：GET /api/strategy-library/module-versions）
 */
function listModuleVersions() {
    const out = {};
    for (const [name, variants] of Object.entries(REGISTRY)) {
        out[name] = Object.keys(variants);
    }
    return out;
}

module.exports = {
    assertModuleKey, resolveModules, listModuleVersions, MODULE_NAMES,
    FACTOR_GENERATION_KEY, isFactorGeneration,
};
