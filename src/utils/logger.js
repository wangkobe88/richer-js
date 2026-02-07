/**
 * Logger Utility
 *
 * Provides logging functionality with file output
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(config = {}) {
        this.logDir = config.dir || './logs';
        this.level = config.level || 'INFO';
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    async initialize() {
        // 异步初始化方法（兼容 TradingEngine 的要求）
        // 日志目录已在构造函数中创建
        return Promise.resolve();
    }

    getLogFilePath() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `richer-js-${date}.log`);
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        let msg = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            msg += ` | ${JSON.stringify(data)}`;
        }
        return msg;
    }

    log(level, message, data = null) {
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        const currentLevelIndex = levels.indexOf(this.level);
        const msgLevelIndex = levels.indexOf(level);

        if (msgLevelIndex < currentLevelIndex) {
            return; // Skip logs below current level
        }

        const logMessage = this.formatMessage(level, message, data);

        // Write to file
        try {
            fs.appendFileSync(this.getLogFilePath(), logMessage + '\n');
        } catch (err) {
            console.error('Failed to write log:', err);
        }

        // Console output
        console.log(logMessage);
    }

    debug(message, data) {
        this.log('DEBUG', message, data);
    }

    info(message, data) {
        this.log('INFO', message, data);
    }

    warn(message, data) {
        this.log('WARN', message, data);
    }

    error(message, data) {
        this.log('ERROR', message, data);
    }

    // Specialized logging methods for trading decisions
    buyDecision(tokenData, reason, metrics) {
        this.info('BUY_DECISION', {
            type: 'BUY_DECISION',
            timestamp: new Date().toISOString(),
            token: {
                address: tokenData.token,
                symbol: tokenData.symbol,
                chain: tokenData.chain
            },
            reason,
            metrics,
            expectedAction: '买入'
        });
    }

    sellDecision(tokenData, reason, metrics, sellPercentage) {
        this.info('SELL_DECISION', {
            type: 'SELL_DECISION',
            timestamp: new Date().toISOString(),
            token: {
                address: tokenData.token,
                symbol: tokenData.symbol,
                chain: tokenData.chain
            },
            reason,
            metrics,
            sellPercentage,
            expectedAction: `卖出${sellPercentage * 100}%仓位`
        });
    }

    tokenTimeout(tokenData, reason, finalMetrics) {
        this.info('TIMEOUT', {
            type: 'TIMEOUT',
            timestamp: new Date().toISOString(),
            token: {
                address: tokenData.token,
                symbol: tokenData.symbol,
                chain: tokenData.chain
            },
            reason,
            finalMetrics,
            expectedAction: '清除监控'
        });
    }
}

module.exports = Logger;
