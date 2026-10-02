/**
 * 组路由变量注册表 + groups 表达式解析（策略库一期，2026-09-28）
 *
 * cycle v1（strategy.cycle 数字 × token.cycleTag 等值）的泛化：腿配置
 * `groups: 'cycle==3'` 表达式，evaluate 内对 token 标签上下文（buildTagContext）
 * 求值——ConditionEvaluator 同一套 AND/OR/比较语法，为二期多维组
 * （tokenCategory 等字符串/枚举维度）铺路。
 *
 * fail-closed 语义（与 v1 一致）：
 *   - 引用变量值 null（cycleTag 证据不足/未启用 enforce）→ 腿全隐（显式 null 门）
 *   - 脏表达式（语法错/未知变量/IS NULL 系）→ loadStrategies throw 实验拒绝启动
 *     （warn+降级 null = 腿恒可见，是危险方向的静默变化）
 *
 * IS NULL / IS NOT NULL 刻意拒绝：它们对 null 求值 true，是比较类表达式
 * （null → false）之外的「逃生口」，会让无档 token 走到专门的腿——该语义
 * 一期不开放，需要时再议。
 */

const { ConditionEvaluator } = require('./ConditionEvaluator');

// 模块级共享解析器（只做 parseCondition，AST 缓存跨实验复用；求值侧各持实例）
const _parser = new ConditionEvaluator();

/**
 * 组变量注册表（静态闭集——与因子集开放动态的语义差异：未知组变量只可能是
 * 书写错，validateCondition 对未知因子 warn 的「防误杀」理由在这里不成立，throw）
 * 二期扩维度：加键 + readTokenData 即可，表达式/求值/校验零改动。
 */
const GROUP_VARIABLES = {
    cycle: {
        label: '行为周期',
        description: 'FA tps30s+gapMedianMs 三档判定（1=冷桶 2=中桶 3=热桶）；证据不足/热身期/未启用 enforce 为 null → 带 groups 腿全隐 fail-closed',
        values: [1, 2, 3],
        valueLabels: { 1: '冷桶', 2: '中桶', 3: '热桶' },
        source: 'token.cycleTag（experiment.config.tokenCycle.enforce=true 时引擎写入）',
        // 标签读取：token 对象上的 cycleTag（FA _cycleFactors → 引擎同步点写入）
        readTokenData: (tokenData) => tokenData?.cycleTag ?? null,
    },
};

// 变量名形态：字母/下划线开头（数字开头会被 _getOperandValue 的 parseFloat 当数字字面量）
const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 腿配置归一：groups 表达式字符串 | null（null=恒可见=旧语义）。
 * 优先级：config.groups 非空串 > 存量 config.cycle ∈{1,2,3} 转 'cycle==N' > null。
 * 脏 cycle（'3'/4/1.5/未配）→ null，与 v1 归一语义完全一致（DB 存量不迁移）。
 * @param {Object} config - 腿配置（读 groups/cycle 两字段）
 * @returns {string|null}
 */
function normalizeGroups(config) {
    if (typeof config.groups === 'string' && config.groups.trim() !== '') {
        return config.groups.trim();
    }
    if (Number.isInteger(config.cycle) && [1, 2, 3].includes(config.cycle)) {
        return `cycle==${config.cycle}`;
    }
    return null;
}

/**
 * AST 级校验（walk）：
 *   - IS_NULL / IS_NOT_NULL 节点 → throw（null 逃生口，一期不开放）
 *   - COMPARISON 左操作数：必须是注册组变量（数字字面量/未知标识符 → throw）
 *   - COMPARISON 右操作数：必须是数字字面量（变量对变量/'3abc' → throw；
 *     Number() 全串解析，parseFloat('3abc')=3 的宽松坑不放过）
 * @param {Object} node - ConditionEvaluator AST 节点
 * @param {string} expression - 原始表达式（错误信息带上下文）
 */
function validateGroupAst(node, expression) {
    if (!node) return;
    switch (node.type) {
        case 'AND':
        case 'OR':
            validateGroupAst(node.left, expression);
            validateGroupAst(node.right, expression);
            return;
        case 'IS_NULL':
        case 'IS_NOT_NULL':
            throw new Error(`组表达式不支持 IS NULL / IS NOT NULL（无档 token 路由一期不开放）: ${expression}`);
        case 'COMPARISON': {
            if (!VAR_NAME_RE.test(node.left) || !GROUP_VARIABLES[node.left]) {
                throw new Error(`组表达式左操作数必须是组变量（${Object.keys(GROUP_VARIABLES).join('/')}）: 实际 "${node.left}" in ${expression}`);
            }
            if (node.rightString === true) {
                // '3' 会通过下方 Number() 数字校验但求值侧是字符串（'3' === 3 恒
                // false 的严格比较陷阱）——数字标签语义必须裸写 cycle==3
                throw new Error(`组表达式右操作数必须是数字字面量（引号字符串不支持，请写 ${node.left}==${node.right}）: 实际 "${node.right}" in ${expression}`);
            }
            if (node.right === '' || isNaN(Number(node.right))) {
                throw new Error(`组表达式右操作数必须是数字字面量（变量对变量/字符串不支持）: 实际 "${node.right}" in ${expression}`);
            }
            return;
        }
        default:
            throw new Error(`组表达式出现未知节点类型 ${node.type}: ${expression}`);
    }
}

/**
 * 收集 AST 中引用的全部组变量名（校验通过后调用，left 恒为注册变量）
 * @param {Object} ast - 已校验的 AST
 * @returns {Array<string>} 去重排序后的变量名数组
 */
function collectGroupVariables(ast) {
    const vars = new Set();
    const walk = (node) => {
        if (!node) return;
        if (node.type === 'AND' || node.type === 'OR') {
            walk(node.left);
            walk(node.right);
        } else if (node.type === 'COMPARISON') {
            vars.add(node.left);
        }
    };
    walk(ast);
    return [...vars].sort();
}

/**
 * 解析组表达式（语法 + AST 级限制校验），供 loadStrategies / 库页入库校验共用
 * @param {string} raw - groups 表达式（非空字符串；空值归一见 normalizeGroups）
 * @returns {{expression: string, ast: Object, vars: Array<string>}}
 * @throws {Error} 语法错 / IS NULL 系 / 未知变量 / 右操作数非数字
 */
function parseGroupsExpression(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error(`组表达式必须是非空字符串: 实际 ${JSON.stringify(raw)}`);
    }
    const expression = raw.trim();
    const ast = _parser.parseCondition(expression); // 语法错向上抛（腿名由调用方包装）
    validateGroupAst(ast, expression);
    return { expression, ast, vars: collectGroupVariables(ast) };
}

/**
 * token 对象 → 标签求值上下文（注册表驱动，二期加键自动扩展）
 * @param {Object|null} tokenData - token 池对象（含 cycleTag）；null/缺键 → 变量值 null
 * @returns {Object} 变量名 → 值（null 表示无档）
 */
function buildTagContext(tokenData) {
    const ctx = {};
    for (const [name, def] of Object.entries(GROUP_VARIABLES)) {
        ctx[name] = def.readTokenData(tokenData);
    }
    return ctx;
}

/**
 * cycle 判定参数键映射（cycle 判定配置化，2026-09-28）：
 * 实验级显式入口 experiment.config.tokenCycle.params（段内去 cycle 前缀自然命名）
 * → FA FACTOR_PARAM_DEFAULTS 的 cycle* 键。引擎构造 FA 时经此映射并入
 * factorParams（tokenCycle.params 最后 spread = 三级合并中最高优先级：
 * FACTOR_PARAM_DEFAULTS < fourmemeWs.factorParams < tokenCycle.params）。
 * 只挑已知键（服务端 POST 已做闭集校验，这里是注入层不是兜底门——未知键
 * 不静默转写，直接丢弃层不做值校验）；null/undefined/非对象 → {}（存量
 * 实验不带 params 走 FACTOR_PARAM_DEFAULTS，行为零变化）。
 */
const CYCLE_PARAM_KEY_MAP = {
    hotTps: 'cycleHotTps',
    midTps: 'cycleMidTps',
    hotGapMs: 'cycleHotGapMs',
    midGapMs: 'cycleMidGapMs',
    minTicks: 'cycleMinTicks',
    warmupSec: 'cycleWarmupSec',
    upDwellSec: 'cycleUpDwellSec',
    downDwellSec: 'cycleDownDwellSec',
    staleMs: 'cycleStaleMs',
    gapSamples: 'cycleGapSamples',
};
// 导出供 web-server 校验清单复用（单一事实源：键映射/POST 校验/前端输入框三处同步义务收敛到此）

function mapCycleParams(params) {
    if (params === null || params === undefined) return {};
    if (typeof params !== 'object' || Array.isArray(params)) return {};
    const out = {};
    for (const [key, faKey] of Object.entries(CYCLE_PARAM_KEY_MAP)) {
        if (params[key] !== undefined) out[faKey] = params[key];
    }
    return out;
}

module.exports = {
    GROUP_VARIABLES,
    CYCLE_PARAM_KEY_MAP,
    normalizeGroups,
    parseGroupsExpression,
    collectGroupVariables,
    buildTagContext,
    mapCycleParams,
};
