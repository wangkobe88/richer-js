/**
 * 轮次摘要收集器
 *
 * 职责：
 * - 收集每轮迭代的代币指标数据
 * - 记录信号生成和执行状态
 * - 汇总投资组合信息
 * - 格式化输出到控制台和日志
 */

const { BlockchainConfig } = require('../../utils/BlockchainConfig');

class RoundSummary {
    /**
     * 构造函数
     * @param {string} experimentId - 实验ID
     * @param {Object} logger - 日志记录器
     * @param {string} blockchain - 区块链类型 (bsc, solana)
     */
    constructor(experimentId, logger, blockchain = 'bsc') {
        this.experimentId = experimentId;
        this.logger = logger;
        this.blockchain = blockchain;

        // 使用 BlockchainConfig 获取主币符号
        this.nativeCurrency = BlockchainConfig.getNativeTokenSymbol(blockchain);

        /** @type {Object} 当前轮次数据 */
        this.roundData = {
            timestamp: null,
            loopCount: 0,
            tokens: new Map(),  // tokenAddress -> TokenRoundData
            portfolio: null,
            signals: [],
            collectorStats: null
        };
    }

    /**
     * 开始新轮次
     * @param {number} loopCount - 循环次数
     */
    startRound(loopCount) {
        this.roundData = {
            timestamp: new Date(),
            loopCount,
            tokens: new Map(),
            portfolio: null,
            signals: [],
            collectorStats: null
        };
    }

    /**
     * 记录收集器统计信息
     * @param {Object} stats - 收集器统计数据
     */
    recordCollectorStats(stats) {
        this.roundData.collectorStats = stats;
    }

    /**
     * 记录代币指标数据
     * @param {string} tokenAddress - 代币地址
     * @param {string} tokenSymbol - 代币符号
     * @param {Object} indicators - 指标数据
     * @param {number} currentPrice - 当前价格（USD）
     * @param {Object} tokenInfo - 代币额外信息 { createdAt, addedAt, status, collectionPrice }
     */
    recordTokenIndicators(tokenAddress, tokenSymbol, indicators, currentPrice, tokenInfo = {}) {
        this.roundData.tokens.set(tokenAddress, {
            address: tokenAddress,
            symbol: tokenSymbol,
            indicators,
            currentPrice,
            collectionPrice: tokenInfo.collectionPrice || null,
            signal: null,
            signalExecuted: false,
            executionReason: null,
            position: null,
            // 代币时间信息
            createdAt: tokenInfo.createdAt || null,
            addedAt: tokenInfo.addedAt || Date.now(),
            status: tokenInfo.status || 'monitoring'
        });
    }

    /**
     * 记录交易信号
     * @param {string} tokenAddress - 代币地址
     * @param {Object} signal - 信号对象
     */
    recordSignal(tokenAddress, signal) {
        const tokenData = this.roundData.tokens.get(tokenAddress);
        if (tokenData) {
            tokenData.signal = signal;
        }
        this.roundData.signals.push({ tokenAddress, signal });
    }

    /**
     * 记录信号执行状态
     * @param {string} tokenAddress - 代币地址
     * @param {boolean} executed - 是否执行成功
     * @param {string} reason - 未执行原因（如有）
     */
    recordSignalExecution(tokenAddress, executed, reason = null) {
        const tokenData = this.roundData.tokens.get(tokenAddress);
        if (tokenData) {
            tokenData.signalExecuted = executed;
            tokenData.executionReason = reason;
        }
    }

    /**
     * 记录持仓信息
     * @param {string} tokenAddress - 代币地址
     * @param {Object} position - 持仓信息
     */
    recordPosition(tokenAddress, position) {
        const tokenData = this.roundData.tokens.get(tokenAddress);
        if (tokenData) {
            tokenData.position = position;
        }
    }

    /**
     * 记录投资组合总览
     * @param {Object} portfolioData - 投资组合数据
     */
    recordPortfolio(portfolioData) {
        this.roundData.portfolio = portfolioData;
    }

    /**
     * 输出摘要到控制台
     */
    printToConsole() {
        console.log('\n' + '='.repeat(80));
        console.log(`轮次 #${this.roundData.loopCount} 摘要`);
        console.log(`   时间: ${this.roundData.timestamp.toISOString()}`);
        console.log('='.repeat(80));

        // 输出收集器统计
        if (this.roundData.collectorStats) {
            this._printCollectorStats();
        }

        // 输出每个代币的信息
        if (this.roundData.tokens.size > 0) {
            console.log(`\n监控代币: ${this.roundData.tokens.size}个`);
            for (const [address, tokenData] of this.roundData.tokens) {
                this._printTokenSummary(tokenData);
            }
        } else {
            console.log('\n监控代币: 0个');
        }

        // 输出投资组合总览
        if (this.roundData.portfolio) {
            this._printPortfolioSummary();
        }

        console.log('='.repeat(80) + '\n');
    }

    /**
     * 输出摘要到日志
     */
    writeToLog() {
        try {
            if (!this.experimentId) {
                console.warn('experimentId 为 null，跳过日志输出');
                return;
            }

            const lines = this._formatForLog();

            if (this.logger && typeof this.logger.logRaw === 'function') {
                const summaryText = lines.join('\n');
                this.logger.logRaw(this.experimentId, summaryText);
            } else {
                console.error('logger 或 logRaw 方法不可用');
            }
        } catch (error) {
            console.error('writeToLog() 失败:', error);
        }
    }

    /**
     * 获取当前轮次数据
     * @returns {Object} 轮次数据
     */
    getRoundData() {
        return {
            timestamp: this.roundData.timestamp,
            loopCount: this.roundData.loopCount,
            tokens: Array.from(this.roundData.tokens.values()),
            portfolio: this.roundData.portfolio,
            signalCount: this.roundData.signals.length,
            collectorStats: this.roundData.collectorStats
        };
    }

    // ========== 私有方法 ==========

    /**
     * 格式化状态显示
     * @private
     * @param {string} status - 状态
     * @returns {string} 格式化后的状态
     */
    _formatStatus(status) {
        const statusMap = {
            'monitoring': '监控中',
            'bought': '已买入',
            'selling': '卖出中',
            'exited': '已退出'
        };
        return statusMap[status] || status;
    }

    /**
     * 打印收集器统计
     * @private
     */
    _printCollectorStats() {
        const stats = this.roundData.collectorStats;
        console.log('\n收集器统计:');
        console.log(`   本次获取: ${stats.lastFetched || 0}个`);
        console.log(`   新增池子: ${stats.lastAdded || 0}个`);
        console.log(`   跳过(超龄): ${stats.lastSkipped || 0}个`);
        console.log(`   池子总量: ${stats.poolSize || 0}个`);
        console.log(`   监控中: ${stats.monitoringCount || 0}个`);
        console.log(`   已买入: ${stats.boughtCount || 0}个`);
    }

    /**
     * 打印单个代币摘要
     * @private
     * @param {Object} tokenData - 代币数据
     */
    _printTokenSummary(tokenData) {
        console.log(`\n代币: ${tokenData.symbol}`);
        console.log(`   地址: ${tokenData.address}`);

        // 时间信息
        if (tokenData.createdAt) {
            const now = Date.now();
            const createdAge = (now - tokenData.createdAt * 1000) / 1000 / 60; // 分钟
            const monitoringAge = (now - tokenData.addedAt) / 1000 / 60; // 分钟
            console.log(`   创建时长: ${createdAge.toFixed(2)}分钟`);
            console.log(`   监控时长: ${monitoringAge.toFixed(2)}分钟`);
            console.log(`   状态: ${this._formatStatus(tokenData.status)}`);
        }

        // 价格信息
        if (tokenData.currentPrice) {
            console.log(`   当前价格: $${tokenData.currentPrice.toExponential(4)}`);
        } else {
            console.log(`   当前价格: N/A`);
        }

        // 获取时价格（收集时价格）
        if (tokenData.collectionPrice !== null && tokenData.collectionPrice !== undefined) {
            console.log(`   获取时价格: $${tokenData.collectionPrice.toExponential(4)}`);
        }

        // 技术指标
        if (tokenData.indicators && Object.keys(tokenData.indicators).length > 0) {
            console.log('   技术指标:');
            this._printIndicators(tokenData.indicators);
        }

        // 信号信息
        if (tokenData.signal) {
            const direction = tokenData.signal.direction || tokenData.signal.action || 'UNKNOWN';
            const confidence = tokenData.signal.confidence || 0;
            const directionEmoji = direction === 'BUY' || direction === 'buy' ? '买入' : (direction === 'SELL' || direction === 'sell' ? '卖出' : direction);
            console.log(`   信号: ${directionEmoji} (信心度: ${confidence.toFixed(0)}%)`);
        } else {
            console.log('   信号: 无');
        }

        // 执行状态
        if (tokenData.signalExecuted) {
            console.log('   执行: 成功');
        } else if (tokenData.signal) {
            const reason = tokenData.executionReason || '未知原因';
            console.log(`   执行: 失败 (${reason})`);
        } else {
            console.log('   执行: -');
        }

        // 持仓信息
        if (tokenData.position) {
            const pos = tokenData.position;
            console.log(`   持仓:`);
            console.log(`      数量: ${pos.amount ? pos.amount.toFixed(4) : 'N/A'} ${pos.symbol || tokenData.symbol}`);
            if (pos.buyPrice) {
                console.log(`      买入价: $${pos.buyPrice.toExponential(4)}`);
            }
            if (pos.currentPrice) {
                const pnl = pos.currentPrice - pos.buyPrice;
                const pnlPercent = pos.buyPrice > 0 ? (pnl / pos.buyPrice * 100) : 0;
                const emoji = pnl >= 0 ? '+' : '';
                console.log(`      当前价: $${pos.currentPrice.toExponential(4)} (${emoji}${pnlPercent.toFixed(2)}%)`);
            }
        }
    }

    /**
     * 打印技术指标
     * @private
     * @param {Object} indicators - 指标对象
     */
    _printIndicators(indicators) {
        // 因子策略类型
        if (indicators.type === 'factor-based') {
            console.log(`      类型: 因子策略`);
            console.log(`      因子数量: ${indicators.factorCount || 0}`);
            console.log(`      策略数量: ${indicators.strategyCount || 0}`);

            // 显示因子值
            if (indicators.factorValues) {
                const factorValues = [];
                for (const [factorId, value] of Object.entries(indicators.factorValues)) {
                    // 跳过不需要显示的因子
                    if (factorId === 'rsiIsDefault' || factorId === 'profitPercent') continue;

                    // 格式化因子值
                    let displayValue = value;
                    if (typeof value === 'number') {
                        // 价格类因子使用科学计数法
                        if (factorId === 'currentPrice' || factorId === 'collectionPrice' ||
                            factorId === 'buyPrice' || factorId === 'highestPrice') {
                            displayValue = value.toExponential(4);
                        } else if (factorId === 'age') {
                            displayValue = value.toFixed(2);
                        } else {
                            displayValue = value.toFixed(2);
                        }
                    } else if (value === null || value === undefined) {
                        displayValue = '-';
                    } else if (value === 0 && (factorId === 'buyPrice' || factorId === 'holdDuration')) {
                        displayValue = '-';
                    }

                    // RSI 特殊处理
                    if (factorId === 'rsi' && indicators.factorValues.rsiIsDefault) {
                        displayValue = `${value.toFixed(2)}(默认值,数据不足)`;
                    }

                    factorValues.push(`${factorId}=${displayValue}`);
                }
                console.log(`      因子值: ${factorValues.join(', ')}`);
            }

            // 显示触发的策略
            if (indicators.triggeredStrategy) {
                const ts = indicators.triggeredStrategy;
                const actionText = ts.action === 'buy' ? '买入' : '卖出';
                console.log(`      触发策略: ${ts.name || ts.id} (${actionText}, 优先级:${ts.priority})`);
            } else {
                console.log(`      触发策略: 无`);
            }
            return;
        }

        // RSI指标
        if (indicators.rsi !== undefined) {
            const rsi = indicators.rsi;
            let trend = '->';
            if (rsi < 30) trend = '(超卖)';
            else if (rsi > 70) trend = '(超买)';

            const extra = [];
            if (indicators.period) extra.push(`周期:${indicators.period}`);

            const extraStr = extra.length > 0 ? ` (${extra.join(', ')})` : '';
            console.log(`      RSI: ${rsi.toFixed(1)} ${trend}${extraStr}`);
        }

        // 其他指标
        for (const [key, value] of Object.entries(indicators)) {
            if (!['type', 'factorValues', 'triggeredStrategy', 'factorCount', 'strategyCount', 'rsi', 'period'].includes(key)) {
                if (typeof value === 'object' && value !== null) {
                    console.log(`      ${key}: ${JSON.stringify(value)}`);
                } else {
                    console.log(`      ${key}: ${value}`);
                }
            }
        }
    }

    /**
     * 打印投资组合摘要
     * @private
     */
    _printPortfolioSummary() {
        const portfolio = this.roundData.portfolio;
        if (!portfolio) return;

        console.log('\n投资组合总览:');

        // 总价值和现金余额
        const totalValue = portfolio.totalValue ? portfolio.totalValue.toFixed(2) : 'N/A';
        const cashBalance = portfolio.cashBalance ? portfolio.cashBalance.toFixed(2) : 'N/A';

        let cashPercent = 'N/A';
        if (portfolio.totalValue > 0 && portfolio.cashBalance) {
            cashPercent = ((portfolio.cashBalance / portfolio.totalValue) * 100).toFixed(1) + '%';
        }

        console.log(`   总价值: ${totalValue} ${this.nativeCurrency}`);
        console.log(`   现金余额: ${cashBalance} ${this.nativeCurrency} (${cashPercent})`);

        // 持仓信息
        if (portfolio.positions && portfolio.positions.length > 0) {
            console.log(`   持仓数量: ${portfolio.positions.length}个代币`);
            for (const pos of portfolio.positions) {
                const value = pos.value ? pos.value.toFixed(2) : 'N/A';
                let percent = 'N/A';
                if (portfolio.totalValue > 0 && pos.value) {
                    percent = ((pos.value / portfolio.totalValue) * 100).toFixed(1) + '%';
                }
                console.log(`      - ${pos.symbol}: ${pos.amount ? pos.amount.toFixed(4) : 'N/A'} (价值: ${value} ${this.nativeCurrency}, ${percent})`);
            }
        } else {
            console.log(`   持仓数量: 0个代币`);
        }
    }

    /**
     * 格式化为日志输出
     * @private
     * @returns {Array<string>} 日志行数组
     */
    _formatForLog() {
        const lines = [];

        lines.push('');
        lines.push('='.repeat(80));
        lines.push(`轮次 #${this.roundData.loopCount} 摘要`);
        lines.push(`   时间: ${this.roundData.timestamp.toISOString()}`);
        lines.push('='.repeat(80));

        // 收集器统计
        if (this.roundData.collectorStats) {
            const stats = this.roundData.collectorStats;
            lines.push('');
            lines.push('收集器统计:');
            lines.push(`   本次获取: ${stats.lastFetched || 0}个`);
            lines.push(`   新增池子: ${stats.lastAdded || 0}个`);
            lines.push(`   跳过(超龄): ${stats.lastSkipped || 0}个`);
            lines.push(`   池子总量: ${stats.poolSize || 0}个`);
            lines.push(`   监控中: ${stats.monitoringCount || 0}个`);
            lines.push(`   已买入: ${stats.boughtCount || 0}个`);
        }

        // 每个代币的信息
        for (const [address, tokenData] of this.roundData.tokens) {
            lines.push('');
            lines.push(`代币: ${tokenData.symbol}`);
            lines.push(`   地址: ${tokenData.address}`);

            // 时间信息
            if (tokenData.createdAt) {
                const now = Date.now();
                const createdAge = (now - tokenData.createdAt * 1000) / 1000 / 60; // 分钟
                const monitoringAge = (now - tokenData.addedAt) / 1000 / 60; // 分钟
                lines.push(`   创建时长: ${createdAge.toFixed(2)}分钟`);
                lines.push(`   监控时长: ${monitoringAge.toFixed(2)}分钟`);
                lines.push(`   状态: ${this._formatStatus(tokenData.status)}`);
            }

            if (tokenData.currentPrice) {
                lines.push(`   当前价格: $${tokenData.currentPrice.toExponential(4)}`);
            } else {
                lines.push(`   当前价格: N/A`);
            }

            // 获取时价格（收集时价格）
            if (tokenData.collectionPrice !== null && tokenData.collectionPrice !== undefined) {
                lines.push(`   获取时价格: $${tokenData.collectionPrice.toExponential(4)}`);
            }

            // 技术指标
            if (tokenData.indicators && Object.keys(tokenData.indicators).length > 0) {
                lines.push('   技术指标:');

                if (tokenData.indicators.type === 'factor-based') {
                    lines.push(`      类型: 因子策略`);
                    lines.push(`      因子数量: ${tokenData.indicators.factorCount || 0}`);
                    lines.push(`      策略数量: ${tokenData.indicators.strategyCount || 0}`);

                    if (tokenData.indicators.factorValues) {
                        const factorValues = [];
                        for (const [factorId, value] of Object.entries(tokenData.indicators.factorValues)) {
                            // 跳过不需要显示的因子
                            if (factorId === 'rsiIsDefault' || factorId === 'profitPercent') continue;

                            // 格式化因子值
                            let displayValue = value;
                            if (typeof value === 'number') {
                                // 价格类因子使用科学计数法
                                if (factorId === 'currentPrice' || factorId === 'collectionPrice' ||
                                    factorId === 'buyPrice' || factorId === 'highestPrice') {
                                    displayValue = value.toExponential(4);
                                } else if (factorId === 'age') {
                                    displayValue = value.toFixed(2);
                                } else {
                                    displayValue = value.toFixed(2);
                                }
                            } else if (value === null || value === undefined) {
                                displayValue = '-';
                            } else if (value === 0 && (factorId === 'buyPrice' || factorId === 'holdDuration')) {
                                displayValue = '-';
                            }

                            // RSI 特殊处理
                            if (factorId === 'rsi' && tokenData.indicators.factorValues.rsiIsDefault) {
                                displayValue = `${value.toFixed(2)}(默认值,数据不足)`;
                            }

                            factorValues.push(`${factorId}=${displayValue}`);
                        }
                        lines.push(`      因子值: ${factorValues.join(', ')}`);
                    }

                    if (tokenData.indicators.triggeredStrategy) {
                        const ts = tokenData.indicators.triggeredStrategy;
                        const actionText = ts.action === 'buy' ? '买入' : '卖出';
                        lines.push(`      触发策略: ${ts.name || ts.id} (${actionText}, 优先级:${ts.priority})`);
                    } else {
                        lines.push(`      触发策略: 无`);
                    }
                } else {
                    // 其他指标
                    for (const [key, value] of Object.entries(tokenData.indicators)) {
                        if (!['type', 'factorValues', 'triggeredStrategy', 'factorCount', 'strategyCount'].includes(key)) {
                            lines.push(`      ${key}: ${value}`);
                        }
                    }
                }
            }

            // 信号
            if (tokenData.signal) {
                const direction = tokenData.signal.direction || tokenData.signal.action || 'UNKNOWN';
                const confidence = tokenData.signal.confidence || 0;
                lines.push(`   信号: ${direction} (信心度: ${confidence.toFixed(0)}%)`);
            } else {
                lines.push('   信号: 无');
            }

            // 执行
            if (tokenData.signalExecuted) {
                lines.push('   执行: 成功');
            } else if (tokenData.signal) {
                lines.push(`   执行: 失败 (${tokenData.executionReason || '未知'})`);
            } else {
                lines.push('   执行: -');
            }
        }

        // 投资组合总览
        if (this.roundData.portfolio) {
            lines.push('');
            this._formatPortfolioSummaryForLog(lines, this.roundData.portfolio);
        }

        lines.push('='.repeat(80));
        lines.push('');

        return lines;
    }

    /**
     * 格式化投资组合摘要（用于日志输出）
     * @private
     * @param {Array} lines - 日志行数组
     * @param {Object} portfolio - 投资组合数据
     */
    _formatPortfolioSummaryForLog(lines, portfolio) {
        lines.push('投资组合总览:');
        lines.push(`   总价值: ${portfolio.totalValue ? portfolio.totalValue.toFixed(2) : 'N/A'} ${this.nativeCurrency}`);
        lines.push(`   现金余额: ${portfolio.cashBalance ? portfolio.cashBalance.toFixed(2) : 'N/A'} ${this.nativeCurrency}`);
        lines.push(`   持仓数量: ${portfolio.positions ? portfolio.positions.length : 0}个`);
        if (portfolio.positions && portfolio.positions.length > 0) {
            for (const pos of portfolio.positions) {
                lines.push(`      - ${pos.symbol}: ${pos.value ? pos.value.toFixed(2) : 'N/A'} ${this.nativeCurrency}`);
            }
        }
    }
}

module.exports = {
    RoundSummary
};
