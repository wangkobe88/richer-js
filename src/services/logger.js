/**
 * 日志服务
 * 用于实验日志记录
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(config = {}) {
        this.logDir = config.dir || path.join(process.cwd(), 'logs');
        this.experimentId = config.experimentId || 'main';
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

    getLogFilePath(experimentId = null) {
        const id = experimentId || this.experimentId;
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `experiment-${id}-${date}.log`);
    }

    /**
     * 格式化日志参数，支持多种调用方式
     * @private
     */
    _formatLogMessage(args) {
        let experimentId, module, message, data;

        // 判断调用方式
        if (args.length === 0) {
            return { experimentId: this.experimentId, module: '', message: '', data: null };
        }

        // logger.info(message, data) - 简单调用
        if (args.length === 1 || (args.length === 2 && typeof args[1] === 'object')) {
            message = args[0];
            data = args[1] || null;
            return { experimentId: this.experimentId, module: '', message, data };
        }

        // logger.info(experimentId, module, message, data) - 完整调用
        if (args.length >= 3) {
            experimentId = args[0];
            module = args[1] || '';
            message = args[2];
            data = args[3] || null;
            return { experimentId: experimentId || this.experimentId, module, message, data };
        }

        // 默认：第一个参数作为消息
        message = args[0];
        return { experimentId: this.experimentId, module: '', message, data: null };
    }

    /**
     * 写入日志到文件和控制台
     * @private
     */
    _writeLog(level, logLine) {
        const filePath = this.getLogFilePath();

        try {
            fs.appendFileSync(filePath, logLine + '\n', 'utf8');
        } catch (err) {
            console.error('Failed to write log:', err);
        }

        // Console output
        if (level === 'ERROR') {
            console.error(logLine);
        } else if (level === 'WARN') {
            console.warn(logLine);
        } else {
            console.log(logLine);
        }
    }

    log(...args) {
        const level = args[0] || 'INFO';
        const { experimentId, module, message, data } = this._formatLogMessage(args.slice(1));

        const timestamp = new Date().toISOString();
        const moduleInfo = module ? `[${module}]` : '';
        const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
        const logLine = `[${timestamp}] [${level}]${moduleInfo}${experimentId ? `[${experimentId}]` : ''} ${message}${dataStr}`;

        this._writeLog(level, logLine);
    }

    info(...args) {
        this.log('INFO', ...args);
    }

    warn(...args) {
        this.log('WARN', ...args);
    }

    error(...args) {
        this.log('ERROR', ...args);
    }

    debug(...args) {
        this.log('DEBUG', ...args);
    }

    logRaw(...args) {
        const timestamp = new Date().toISOString();
        let message = args.map(arg => {
            if (typeof arg === 'object') {
                return JSON.stringify(arg, null, 2);
            }
            return String(arg);
        }).join(' ');

        const logLine = `[${timestamp}] ${message}`;

        const filePath = this.getLogFilePath();
        try {
            fs.appendFileSync(filePath, logLine + '\n', 'utf8');
        } catch (err) {
            console.error('[Logger] logRaw failed:', err.message);
        }
    }
}

module.exports = Logger;
