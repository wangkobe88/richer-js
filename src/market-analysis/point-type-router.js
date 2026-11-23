/**
 * 点位类型辨别与对应策略（pointType 模块 / T216，2026-11-23 用户提案「T213b 泛化」）
 *
 * 定位：信号 fire 后、门链（FP→AF1→CD→BP）前的**纯因子分类层**——按优先级阶梯
 * 把当前点位分类，每类型携带一份门控策略（policy：FP 臂集/AF1/cheat 门/BP 门
 * 各自可开可关）。现行普通代币流程收编为 normal 兜底类型（policy={} = 现行全门
 * 语义）；类型注册表全局维护随模块版本走（用户裁定 2026-11-23，像 FP 臂：识别器
 * =全局知识），包经 modules.pointType:'v1' 启用；不启用 = 不分类 = 行为 bit 不变。
 *
 * 形态仿 factor-pre-buy-check.js：CJS 纯函数 + 版本常量；改判定/加类型必 bump
 * POINT_TYPE_VERSION（module-registry v1 键解析本常量落 strategyResolved 审计）。
 * condition 复用腿条件同款 ConditionEvaluator（FA 因子表达式）；启动防线
 * assertPointTypesValid 用 FA getFactorKeys 三防线同款未知因子 throw。
 *
 * policy 值域（StrategyLibraryService.validatePack 白名单镜像——改值域两侧同步）：
 *   factorCheckArms: 'cheatOnly'（FP 只留严重作弊臂）| 'skip'（FP 整门直通）
 *   actFront:        'pass'（AF1 直通，cheat 门照走）
 *   cheatCheck:      'skip'（跳 16 题 Jev 判定——引擎拉黑短路在门链外层保留）
 *   buyPoint:        'stuffingOnly'（BP 只评塞单门）| 'skip'（BP 整门直通）
 * 未列出的维度 = 该门现行行为。
 */
'use strict';

const { ConditionEvaluator } = require('../strategies/ConditionEvaluator');

const POINT_TYPE_VERSION = 'PT6'; // PT6=v11 冷窗线值收紧（15s≤0.12/30s≤0.25/60s≤0.5——用户裁定「15 秒没有什么特殊的，1 分钟内都要低」；杀 0xa04ee1 类退潮热买） // PT4=v8 裁定 arb_bot_holdings 臂豁免真正落地（PT3 时期该豁免只存在于 commit 信息未写入文件——bt-v202 0xd64e 仍被拦实锤；教训二连：线值改动必须写完跑测试断言全 policy）；PT3=龄 160-900/famous 帽撤除

/** 类型注册表（有序=优先级阶梯，首匹配胜出；normal 兜底恒在末位） */
const POINT_TYPES = [
    {
        id: 'retail_golden_pit',
        label: '强散户币黄金坑',
        // 迁自 T213b retail-good-path-v1 包 gatePolicy（用户裁定 2026-11-23 迁入模块
        // 作首个类型）：正常对倒票第一小波（ATH 1.4-2.0x）回撤 30-50% 后的域内坑位
        // （首价尺 ≤+28.5%），量 4-15B，≥3 尘线大买家在场 + famous 持有。
        // 与 retail-good-path-v1 买腿条件同款但独立维护（腿=何时触发，类型=触发后
        // 怎么走门——两者演化节奏不同）。
        condition: 'tokenAgeSec >= 160 AND tokenAgeSec <= 900 AND buyVolumeBnb >= 4 AND buyVolumeBnb <= 15 AND currentVsLaunchPct <= 28.5 '
            + 'AND athVsLaunchPct >= 40 AND athVsLaunchPct <= 100 '
            + 'AND mcapFromPeakPct <= 50 '
            + 'AND bigBuyersCount >= 3 AND bigBuyersHeldDust >= 3 AND famousCopyWalletCircPct > 0 '
            + 'AND actTotalBnb15s <= 0.12 AND actTotalBnb30s <= 0.25 AND actTotalBnb60s <= 0.5',
        // T217：cheatCheck 规则集差集（g23NoSlowGrind=A 主判排除 slow_grind_pump+去 E
        // 通道——案源 0xa04ee1ed：唯一 strong=slowGrindPump、famous 在场自然带量入场、
        // max60 9.11x 错过）；FP 同形状臂差集（slow_pump_unload=FP8a 慢拉卸货）
        policy: {
          factorCheckArms: 'cheatOnly',
          factorCheckArmExempt: ['slow_pump_unload', 'arb_bot_holdings'],
          actFront: 'pass',
          cheatCheck: 'g23NoSlowGrind',
          buyPoint: 'stuffingOnly',
        },
    },
    // ── 未来类型占位（v1 不实现，追加时 bump POINT_TYPE_VERSION）──
    // 'strongbacker_egg'   强庄币雏形：……
    // 'strongbacker_pump'  强庄币拉盘前期形态：……
    {
        id: 'normal',
        label: '普通点位',
        condition: null, // null=兜底（前面全不中即普通）
        policy: {},      // {}=现行全门语义（FP 全臂→AF1→CD〔g23 规则集〕→BP 全链）
    },
];

/** policy 值域白名单（维度→合法值；改值域此处+头注同步） */
const POLICY_VALUE_DOMAIN = {
    factorCheckArms: ['cheatOnly', 'skip'],
    actFront: ['pass'],
    // T217 观测级门控：CD 门从三态结论门控改为规则集消费原始观测（'full' 退役——
    // g23=现行 G 语义等价迁移；g23NoSlowGrind=retail 差集；skip=跳 16 题）
    cheatCheck: ['g23', 'g23NoSlowGrind', 'skip'],
    buyPoint: ['stuffingOnly', 'skip'],
};

// ── 内部：condition 一次性解析缓存（evaluator 无缓存，模块级 Map 防每信号重解析）──
const _evaluator = new ConditionEvaluator();
const _astCache = new Map();
function _astOf(type) {
    let ast = _astCache.get(type.id);
    if (ast === undefined) {
        ast = _evaluator.parseCondition(type.condition);
        _astCache.set(type.id, ast);
    }
    return ast;
}

// condition 引用因子提取（快照用——标识符 token ∩ 传入因子键集）
const _refCache = new Map();
function _refsOf(type) {
    let refs = _refCache.get(type.id);
    if (refs === undefined) {
        refs = [...new Set((type.condition.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
            .filter((t) => !['AND', 'OR', 'IS', 'NOT', 'NULL'].includes(t)))];
        _refCache.set(type.id, refs);
    }
    return refs;
}

/**
 * 启动防线（三防线同款）：全类型 condition 跑 validateCondition——未知因子/语法
 * throw 拒启（绝不静默恒真/恒假）。引擎 _resolveStrategyPack 在包携带
 * modules.pointType 时调用。
 * @param {Iterable<string>} factorKeys - FA getFactorKeys() 产物
 */
function assertPointTypesValid(factorKeys) {
    const known = new Set(factorKeys);
    for (const type of POINT_TYPES) {
        if (type.condition == null) continue;
        const ast = _evaluator.parseCondition(type.condition);
        const v = _evaluator.validateCondition(ast, known);
        if (v && v.valid === false) {
            throw new Error(`[pointType] 类型 ${type.id} condition 非法：${(v.errors || []).join('；')}`);
        }
        for (const dim of Object.keys(type.policy)) {
            if (dim === 'factorCheckArmExempt') {
                // T217 FP 臂差集：非空字符串数组（码域宽松——未知码=无害空操作）
                if (!Array.isArray(type.policy[dim]) || !type.policy[dim].length
                    || !type.policy[dim].every((c) => typeof c === 'string' && c)) {
                    throw new Error(`[pointType] 类型 ${type.id} policy.factorCheckArmExempt 须为非空字符串数组`);
                }
                continue;
            }
            if (!POLICY_VALUE_DOMAIN[dim]) {
                throw new Error(`[pointType] 类型 ${type.id} policy 携带未知维度 ${dim}`);
            }
            if (!POLICY_VALUE_DOMAIN[dim].includes(type.policy[dim])) {
                throw new Error(`[pointType] 类型 ${type.id} policy.${dim} 非法值 "${type.policy[dim]}"（可用：${POLICY_VALUE_DOMAIN[dim].join('/')}）`);
            }
        }
    }
    if (POINT_TYPES[POINT_TYPES.length - 1].id !== 'normal') {
        throw new Error('[pointType] normal 兜底类型必须位于阶梯末位');
    }
}

/**
 * 点位类型分类（纯函数，信号 fire 时刻 FA 因子表求值——回测/虚拟/live 三态同源）
 * @param {Object} factorResults - fire 时刻 FA 因子表（与腿条件同一张表）
 * @returns {{type:string,label:string,policy:Object,version:string,snapshot:Object}|null}
 *          null=未启用模块（调用方=全现行）；normal 兜底恒非 null。
 */
function classifyPointType(factorResults) {
    for (const type of POINT_TYPES) {
        if (type.condition == null) {
            // normal 兜底：snapshot 取空（无引用因子）
            return { type: type.id, label: type.label, policy: type.policy, version: POINT_TYPE_VERSION, snapshot: {} };
        }
        let hit = false;
        try {
            hit = _evaluator.evaluate(_astOf(type), factorResults) === true;
        } catch (_e) {
            hit = false; // 评估异常=不命中（宁走 normal 不误配策略——fail-safe 方向=现行门链）
        }
        if (hit) {
            const snapshot = {};
            for (const k of _refsOf(type)) {
                if (k in factorResults) snapshot[k] = factorResults[k];
            }
            return { type: type.id, label: type.label, policy: type.policy, version: POINT_TYPE_VERSION, snapshot };
        }
    }
    return null; // 不可达（normal 兜底恒在）
}

module.exports = {
    POINT_TYPE_VERSION,
    POINT_TYPES,
    classifyPointType,
    assertPointTypesValid,
};
