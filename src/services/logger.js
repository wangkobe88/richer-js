/**
 * 日志服务
 * 用于实验日志记录
 */

const fs = require('fs');
const path = require('path');

/** 日志级别权重（minLevel 判级用；未知级别按 0 恒输出，保守不丢行） */
const LEVEL_ORDER = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

class Logger {
    constructor(config = {}) {
        this.logDir = config.dir || path.join(process.cwd(), 'logs');
        this.experimentId = config.experimentId || 'main';
        this.ensureLogDirectory();
        // 按文件路径复用的 WriteStream（flags:'a' 追加），替代 appendFileSync 同步阻塞写
        // （bc4f756e 性能案：单次回放 30.5 万行日志 × 双写 = 30 万次同步系统调用）。
        // experimentId / 日期变化 → 路径变化 → 自动新建 stream，旧 stream 由进程退出关闭
        this._streams = new Map();
        // 最低级别（P1-2 日志降噪）：null/undefined = 全量输出（默认，现状语义）；
        // 大小写不敏感（配置侧 'warn'/'WARN' 等价），脏值 → null = 全量（保守不丢行）；
        // 设置后低于该级别的行在 JSON.stringify 之前短路——大对象格式化开销一并省掉
        this._minLevelOrder = this._normalizeMinLevel(config.minLevel);
    }

    /** 级别名归一为权重（脏值/空 → null = 全量） */
    _normalizeMinLevel(level) {
        if (!level || typeof level !== 'string') return null;
        const w = LEVEL_ORDER[level.toUpperCase()];
        return w != null ? w : null;
    }

    /**
     * 设置最低日志级别（'DEBUG'|'INFO'|'WARN'|'ERROR'，大小写不敏感；null = 全量）
     * @param {string|null} level
     */
    setMinLevel(level) {
        this._minLevelOrder = this._normalizeMinLevel(level);
    }

    /**
     * 按 filePath 复用 WriteStream（追加模式），命中即复用，未命中新建
     * write() 把数据写入内核缓冲后立即返回（非阻塞）；错误走 error 事件打 console
     * @private
     */
    _getStream(filePath) {
        let stream = this._streams.get(filePath);
        if (!stream) {
            stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
            stream.on('error', (err) => {
                console.error('[Logger] writeStream error:', filePath, err.message);
            });
            this._streams.set(filePath, stream);
        }
        return stream;
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

    /**
     * 更新实验ID
     * @param {string} experimentId - 实验ID
     */
    setExperimentId(experimentId) {
        this.experimentId = experimentId;
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

        // 两个字符串参数：视为 (module, message)
        module = args[0];
        message = args[1];
        return { experimentId: this.experimentId, module, message, data: null };
    }

    /**
     * 写入日志到文件和控制台
     * @private
     */
    _writeLog(level, logLine) {
        const filePath = this.getLogFilePath();

        try {
            this._getStream(filePath).write(logLine + '\n', 'utf8');
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
        // minLevel 判级短路（P1-2）：低于最低级别直接返回，格式化零开销。
        // 未知级别权重按 0 恒放行（保守方向：多打一行不丢信息）
        if (this._minLevelOrder != null && (LEVEL_ORDER[level] ?? 0) < this._minLevelOrder) {
            return;
        }
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
            this._getStream(filePath).write(logLine + '\n', 'utf8');
        } catch (err) {
            console.error('[Logger] logRaw failed:', err.message);
        }
    }
}

module.exports = Logger;
