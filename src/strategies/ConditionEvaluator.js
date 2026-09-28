/**
 * 条件评估器
 *
 * 解析和评估策略条件表达式
 * 参考 rich-js strategies/core/ConditionEvaluator.js 的简化版本
 *
 * 支持的条件语法:
 * - 比较运算: age < 1, profitPercent >= 30, currentPrice > 0
 * - 空值检查: holders IS NULL, holders IS NOT NULL
 * - 逻辑运算: condition1 AND condition2, condition1 OR condition2
 * - 括号分组: (condition1 AND condition2) OR condition3
 */

class ConditionEvaluator {
    constructor() {
        // 缓存已解析的条件
        this._cache = new Map();
    }

    /**
     * 解析条件表达式为AST
     * @param {string} condition - 条件表达式
     * @returns {Object} AST
     */
    parseCondition(condition) {
        if (!condition || typeof condition !== 'string') {
            throw new Error('条件表达式必须是字符串');
        }

        const trimmed = condition.trim();

        // 检查缓存
        if (this._cache.has(trimmed)) {
            return this._cache.get(trimmed);
        }

        const ast = this._parseCondition(trimmed);
        this._cache.set(trimmed, ast);
        return ast;
    }

    /**
     * 从 buy condition 表达式提取 age 的范围上下界，供 FactorAggregator
     * preFilter 粗筛（pumpfun 回迁：跳过 condition 本就会拒绝的 tick 的因子
     * 构建，纯提效）。age 口径 = 分钟（与 FA buildFactorMap 的 age 因子同锚
     * 同单位：锚 createdAtMs）。
     *
     * 仅提取 AND 链中的 age 比较子句；OR 分支无法确定单一范围 → 返回 null
     * 安全降级（不过滤）。阈值 = condition 实际范围，绝不偏紧（偏紧会漏买）。
     * 调用方（FA）用「严格大于上界 / 严格小于下界」判定跳过，保证对 < 与
     * <= operator 都不漏买（边界值交回 condition 评估）。
     *
     * @param {string} condition - 条件表达式字符串
     * @returns {{minAgeMinutes?:number, maxAgeMinutes?:number}|null}
     *          整体 null 表示无法提取（不过滤）；字段缺省由调用方填 0/Infinity
     */
    static extractBuyRangeFromCondition(condition) {
        if (!condition || typeof condition !== 'string') return null;
        try {
            const ast = new ConditionEvaluator().parseCondition(condition);
            return ConditionEvaluator._walkBuyRange(ast);
        } catch {
            return null; // 语法错/认不出 → 不过滤（fail-open 方向）
        }
    }

    /** 递归提取 age 范围；AND 取最紧（上界取小/下界取大），OR → null（安全降级） */
    static _walkBuyRange(node) {
        if (!node) return null;
        if (node.type === 'AND') {
            const l = ConditionEvaluator._walkBuyRange(node.left);
            const r = ConditionEvaluator._walkBuyRange(node.right);
            if (!l && !r) return null;
            if (!l) return r;
            if (!r) return l;
            const TIGHTER = { maxAgeMinutes: Math.min, minAgeMinutes: Math.max };
            const out = {};
            for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
                const a = l[k], b = r[k];
                const v = a == null ? b : (b == null ? a : TIGHTER[k](a, b));
                if (v != null) out[k] = v;
            }
            return out;
        }
        if (node.type === 'OR') return null; // OR 无法确定单一范围，安全降级
        if (node.type === 'COMPARISON') {
            const num = Number(node.right);
            if (!Number.isFinite(num)) return null;
            if (node.left === 'age') {
                if (node.operator === '<' || node.operator === '<=') return { maxAgeMinutes: num };
                if (node.operator === '>' || node.operator === '>=') return { minAgeMinutes: num };
            }
            return null;
        }
        return null; // IS_NULL 等其他节点
    }

    /**
     * 解析条件表达式（递归下降解析器）
     * @private
     * @param {string} input - 输入字符串
     * @returns {Object} AST
     */
    _parseCondition(input) {
        let pos = 0;

        const skipWhitespace = () => {
            while (pos < input.length && /\s/.test(input[pos])) {
                pos++;
            }
        };

        const parseOr = () => {
            let left = parseAnd();

            while (pos < input.length) {
                skipWhitespace();
                if (pos + 2 <= input.length && input.substr(pos, 2).toUpperCase() === 'OR') {
                    pos += 2;
                    skipWhitespace();
                    const right = parseAnd();
                    left = { type: 'OR', left, right };
                } else {
                    break;
                }
            }

            return left;
        };

        const parseAnd = () => {
            let left = parsePrimary();

            while (pos < input.length) {
                skipWhitespace();
                if (pos + 3 <= input.length && input.substr(pos, 3).toUpperCase() === 'AND') {
                    pos += 3;
                    skipWhitespace();
                    const right = parsePrimary();
                    left = { type: 'AND', left, right };
                } else {
                    break;
                }
            }

            return left;
        };

        const parsePrimary = () => {
            skipWhitespace();

            // 括号分组
            if (pos < input.length && input[pos] === '(') {
                pos++; // 跳过 '('
                const expr = parseOr();
                skipWhitespace();
                if (pos < input.length && input[pos] === ')') {
                    pos++; // 跳过 ')'
                    return expr;
                }
                throw new Error('括号不匹配');
            }

            // 简单比较表达式
            return parseComparison();
        };

        const parseComparison = () => {
            skipWhitespace();

            // 解析左操作数（变量名）
            const start = pos;
            while (pos < input.length && /[\w.]/.test(input[pos])) {
                pos++;
            }
            const leftOperand = input.substring(start, pos).trim();

            if (!leftOperand) {
                throw new Error('期望操作数');
            }

            skipWhitespace();

            // 检查 IS NULL / IS NOT NULL
            if (pos + 6 <= input.length && input.substr(pos, 6).toUpperCase() === 'IS NOT') {
                pos += 6;
                skipWhitespace();
                if (pos + 4 <= input.length && input.substr(pos, 4).toUpperCase() === 'NULL') {
                    pos += 4;
                    return { type: 'IS_NOT_NULL', operand: leftOperand };
                }
                throw new Error('IS NOT 后期望 NULL');
            }
            if (pos + 2 <= input.length && input.substr(pos, 2).toUpperCase() === 'IS') {
                pos += 2;
                skipWhitespace();
                if (pos + 4 <= input.length && input.substr(pos, 4).toUpperCase() === 'NULL') {
                    pos += 4;
                    return { type: 'IS_NULL', operand: leftOperand };
                }
                throw new Error('IS 后期望 NULL');
            }

            // 解析比较运算符
            let operator = null;
            if (pos + 1 <= input.length) {
                const twoChar = input.substr(pos, 2);
                if (twoChar === '>=' || twoChar === '<=' || twoChar === '==' || twoChar === '!=') {
                    operator = twoChar;
                    pos += 2;
                }
            }

            if (!operator && pos < input.length) {
                const oneChar = input[pos];
                if (oneChar === '>' || oneChar === '<' || oneChar === '=') {
                    operator = oneChar;
                    pos++;
                }
            }

            if (!operator) {
                throw new Error('期望比较运算符');
            }

            skipWhitespace();

            // 解析右操作数（数字或变量名，支持负数）
            const rightStart = pos;
            // 匹配负号、数字、字母、下划线、点号
            while (pos < input.length && /[-\w.]/.test(input[pos])) {
                pos++;
            }
            const rightOperand = input.substring(rightStart, pos).trim();

            if (!rightOperand) {
                throw new Error('期望右操作数');
            }

            return {
                type: 'COMPARISON',
                operator,
                left: leftOperand,
                right: rightOperand
            };
        };

        return parseOr();
    }

    /**
     * 验证条件表达式
     * @param {Object} ast - AST
     * @param {Set<string>} availableFactorIds - 可用的因子ID集合
     * @returns {Object} 验证结果
     */
    validateCondition(ast, availableFactorIds = new Set()) {
        const errors = [];

        const validateNode = (node) => {
            if (!node) return;

            if (node.type === 'AND' || node.type === 'OR') {
                validateNode(node.left);
                validateNode(node.right);
            } else if (node.type === 'COMPARISON') {
                // 检查左操作数
                const leftVar = node.left;
                const rightVar = node.right;

                // 如果操作数不是数字，检查是否在可用因子中
                const leftIsNumber = !isNaN(parseFloat(leftVar));
                const rightIsNumber = !isNaN(parseFloat(rightVar));

                if (!leftIsNumber && !availableFactorIds.has(leftVar)) {
                    errors.push(`未知因子: ${leftVar}`);
                }

                if (!rightIsNumber && !availableFactorIds.has(rightVar)) {
                    errors.push(`未知因子: ${rightVar}`);
                }
            }
        };

        validateNode(ast);

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 评估条件表达式
     * @param {Object|string} condition - 条件表达式或AST
     * @param {Map<string, number>|Object} factorResults - 因子计算结果
     * @returns {boolean} 评估结果
     */
    evaluate(condition, factorResults) {
        let ast = condition;

        // 如果是字符串，先解析
        if (typeof condition === 'string') {
            ast = this.parseCondition(condition);
        }

        return this._evaluateNode(ast, factorResults);
    }

    /**
     * 评估AST节点
     * @private
     * @param {Object} node - AST节点
     * @param {Map<string, number>|Object} factorResults - 因子计算结果
     * @returns {boolean} 评估结果
     */
    _evaluateNode(node, factorResults) {
        if (!node) {
            return false;
        }

        switch (node.type) {
            case 'AND':
                return this._evaluateNode(node.left, factorResults) &&
                       this._evaluateNode(node.right, factorResults);

            case 'OR':
                return this._evaluateNode(node.left, factorResults) ||
                       this._evaluateNode(node.right, factorResults);

            case 'IS_NULL': {
                const val = this._getOperandValue(node.operand, factorResults);
                return val == null;
            }

            case 'IS_NOT_NULL': {
                const val = this._getOperandValue(node.operand, factorResults);
                return val != null;
            }

            case 'COMPARISON':
                return this._evaluateComparison(node, factorResults);

            default:
                return false;
        }
    }

    /**
     * 评估比较表达式
     * @private
     * @param {Object} node - 比较节点
     * @param {Map<string, number>|Object} factorResults - 因子计算结果
     * @returns {boolean} 评估结果
     */
    _evaluateComparison(node, factorResults) {
        const leftValue = this._getOperandValue(node.left, factorResults);
        const rightValue = this._getOperandValue(node.right, factorResults);

        // 如果任何一边是 undefined 或 null，条件无法评估，返回 false
        // （JS 中 null < number 会隐式转换为 0 < number，导致误判）
        if (leftValue == null || rightValue == null) {
            return false;
        }

        switch (node.operator) {
            case '>':
                return leftValue > rightValue;
            case '<':
                return leftValue < rightValue;
            case '>=':
                return leftValue >= rightValue;
            case '<=':
                return leftValue <= rightValue;
            case '==':
            case '=':
                return leftValue === rightValue;
            case '!=':
                return leftValue !== rightValue;
            default:
                return false;
        }
    }

    /**
     * 获取操作数的值
     * @private
     * @param {string} operand - 操作数
     * @param {Map<string, number>|Object} factorResults - 因子计算结果
     * @returns {number|undefined} 值，如果不存在则返回 undefined
     */
    _getOperandValue(operand, factorResults) {
        // 尝试解析为数字
        if (!isNaN(parseFloat(operand))) {
            return parseFloat(operand);
        }

        // 从因子结果中获取
        if (factorResults instanceof Map) {
            const value = factorResults.get(operand);
            return value !== undefined ? value : undefined;
        }

        const value = factorResults[operand];
        return value !== undefined ? value : undefined;
    }

    /**
     * 评估条件表达式并返回满足比例
     * 适用于 AND 连接的多个条件，计算满足条件的百分比
     * @param {string} condition - 条件表达式
     * @param {Map<string, number>|Object} factorResults - 因子计算结果
     * @returns {number} 满足比例（0-100）
     */
    evaluateWithScore(condition, factorResults) {
        const ast = this.parseCondition(condition);
        const leafConditions = this._extractLeafConditions(ast);

        if (leafConditions.length === 0) {
            return 0;
        }

        let satisfiedCount = 0;
        for (const cond of leafConditions) {
            try {
                if (this._evaluateComparison(cond, factorResults)) {
                    satisfiedCount++;
                }
            } catch (e) {
                // 条件评估失败（例如字段不存在），视为不满足
            }
        }

        return (satisfiedCount / leafConditions.length) * 100;
    }

    /**
     * 提取AST中的所有叶子条件（COMPARISON节点）
     * @private
     * @param {Object} node - AST节点
     * @returns {Array} 叶子条件数组
     */
    _extractLeafConditions(node) {
        const conditions = [];

        if (!node) {
            return conditions;
        }

        switch (node.type) {
            case 'AND':
            case 'OR':
                // 递归提取左右子树的叶子条件
                conditions.push(...this._extractLeafConditions(node.left));
                conditions.push(...this._extractLeafConditions(node.right));
                break;

            case 'COMPARISON':
                // 叶子节点，直接添加
                conditions.push(node);
                break;
        }

        return conditions;
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this._cache.clear();
    }
}

module.exports = { ConditionEvaluator };
