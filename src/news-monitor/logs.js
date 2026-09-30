/**
 * news-monitor 自写日志：console + logs/news-monitor-YYYYMMDD.log 按天文件，双 transport。
 * 不用 tee（screen/nohup 重定向会双写）；启动时清理 14 天前的旧日志文件。
 * fileLogger：独立 JSONL 追加（ingest-error / report-fallback 等可人工重放的留痕）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../../logs');
const PREFIX = 'news-monitor';
const RETENTION_DAYS = 14;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

let stream = null;
let streamDate = '';

function ensureStream() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (stream && streamDate === today) return stream;
    if (stream) stream.end();
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(path.join(LOG_DIR, `${PREFIX}_${today}.log`), { flags: 'a' });
    streamDate = today;
    return stream;
}

function cleanupOldLogs() {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const m = f.match(new RegExp(`^${PREFIX}_(\\d{8})\\.log$`));
        if (!m) continue;
        const t = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`);
        if (t < cutoff) fs.unlinkSync(path.join(LOG_DIR, f));
    }
}

function ts() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtMeta(meta) {
    if (!meta) return '';
    return ' ' + Object.entries(meta)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
}

function log(level, msg, meta) {
    if (LEVELS[level] < currentLevel) return;
    const line = `${ts()} [${level}] ${msg}${fmtMeta(meta)}`;
    console[level === 'debug' ? 'log' : level](line);
    try {
        ensureStream().write(line + '\n');
    } catch {
        // 文件写入失败不能影响主流程（磁盘满等），console 已有输出
    }
}

const logger = {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
};

/** 独立 JSONL 文件追加（可人工重放的留痕）。文件名固定在 logs/ 下带 news-monitor 前缀 */
function fileLogger(filename) {
    const file = path.join(LOG_DIR, `${PREFIX}-${filename}`);
    return {
        write(obj) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
            fs.appendFileSync(file, JSON.stringify(obj) + '\n');
        },
        get path() {
            return file;
        },
    };
}

module.exports = { logger, fileLogger, cleanupOldLogs };
