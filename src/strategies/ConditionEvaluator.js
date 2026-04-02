/**
 * 条件评估器
 *
 * 解析和评估策略条件表达式
 * 参考 rich-js strategies/core/ConditionEvaluator.js 的简化版本
 *
 * 支持的条件语法:
 * - 比较运算: age < 1, profitPercent >= 30, currentPrice > 0
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

        // 如果任何一边是 undefined，条件无法评估，返回 false
        if (leftValue === undefined || rightValue === undefined) {
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
