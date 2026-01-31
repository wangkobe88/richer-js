/**
 * 日志服务
 * 用于实验日志记录
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(config = {}) {
        this.logDir = config.dir || path.join(process.cwd(), 'logs');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getLogFilePath(experimentId = 'main') {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `experiment-${experimentId}-${date}.log`);
    }

    log(experimentId, level, module, message, data = null) {
        const timestamp = new Date().toISOString();
        const moduleInfo = module ? `[${module}]` : '';
        const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
        const logLine = `[${timestamp}] [${level}] ${moduleInfo}${experimentId ? `[${experimentId}]` : ''} ${message}${dataStr}`;

        const filePath = this.getLogFilePath(experimentId);

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

    info(experimentId, module, message, data) {
        this.log(experimentId, 'INFO', module, message, data);
    }

    warn(experimentId, module, message, data) {
        this.log(experimentId, 'WARN', module, message, data);
    }

    error(experimentId, module, message, data) {
        this.log(experimentId, 'ERROR', module, message, data);
    }

    debug(experimentId, module, message, data) {
        this.log(experimentId, 'DEBUG', module, message, data);
    }

    logRaw(experimentId, ...args) {
        const timestamp = new Date().toISOString();
        let message = args.map(arg => {
            if (typeof arg === 'object') {
                return JSON.stringify(arg, null, 2);
            }
            return String(arg);
        }).join(' ');

        const logLine = `[${timestamp}] ${message}`;

        const filePath = this.getLogFilePath(experimentId);
        try {
            fs.appendFileSync(filePath, logLine + '\n', 'utf8');
        } catch (err) {
            console.error('[Logger] logRaw failed:', err.message);
        }
    }
}

module.exports = Logger;
