/**
 * news-monitor 配置装载（fail-loud）：
 *   密钥类全部走 config/.env 的 NEWS_* 前缀变量（richer-js 的 LLM_* 已被 MiniMax 占用，勿混）；
 *   行为参数走 config/default.json 的 newsMonitor 段（缺省值兜底）；
 *   监控名单 = config/news-watchlist.json（迁移自 news_monitor 仓库根 watchlist.json）。
 * 必填 env 缺失直接抛错退出——宁可启动失败，不带病运行。
 */
'use strict';

require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const path = require('path');

// env 名 → 配置键（NEWS_ 前缀避免与 richer-js 既有变量冲突）
const ENV_KEYS = {
    wssUrl: 'NEWS_WSS_URL',
    wssToken: 'NEWS_WSS_TOKEN',
    apiBase: 'NEWS_API_BASE',
    sheetCsvUrls: 'NEWS_SHEET_CSV_URLS',
    llmBaseUrl: 'NEWS_LLM_BASE_URL',
    llmApiKey: 'NEWS_LLM_API_KEY',
    llmModel: 'NEWS_LLM_MODEL',
};

// 各命令实际需要的 env 子集（cli sheet 不要求 Supabase/LLM 已配置）
const REQUIRED_BY_CMD = {
    sheet: ['sheetCsvUrls'],
    listen: ['wssUrl', 'wssToken'],
    sync: ['wssToken', 'apiBase', 'sheetCsvUrls'],
    summarize: ['llmBaseUrl', 'llmApiKey', 'llmModel'],
    daemon: Object.keys(ENV_KEYS),   // daemon 全量
};

// default.json newsMonitor 段缺省值
const SECTION_DEFAULTS = {
    enabled: true,
    syncMinute: 0,        // 整点 sync（北京时间）
    summaryMinute: 5,     // :05 小时总结
    purgeMinute: 17,      // 每日 30 天滚动清理（对齐原 pg_cron 的 17 分）
    digestCap: 300,       // 单窗口送 LLM 素材上限
    heartbeatMs: 30000,   // WSS 心跳
    retainDays: 30,       // twitter_events 保留天数
};

function loadSection() {
    let section = {};
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/default.json'), 'utf8'));
        section = cfg.newsMonitor || {};
    } catch (err) {
        throw new Error(`newsMonitor: 读取 config/default.json 失败: ${err.message}`);
    }
    return { ...SECTION_DEFAULTS, ...section };
}

/** 监控名单（11 组 88 账号；条目 "handle" 或 {handle, name}） */
function loadWatchlist() {
    const file = path.resolve(__dirname, '../../config/news-watchlist.json');
    const watchlist = JSON.parse(fs.readFileSync(file, 'utf8'));
    const total = Object.values(watchlist).reduce((n, arr) => n + arr.length, 0);
    if (total < 1) throw new Error('news-watchlist.json 为空');
    return watchlist;
}

/**
 * @param {string} cmd 命令名（REQUIRED_BY_CMD 键）；缺省按 daemon 全量校验
 */
function loadNewsConfig(cmd = 'daemon') {
    const required = REQUIRED_BY_CMD[cmd] || REQUIRED_BY_CMD.daemon;
    const missing = required.filter(k => !process.env[ENV_KEYS[k]] || process.env[ENV_KEYS[k]].startsWith('<'));
    if (missing.length) {
        throw new Error(`newsMonitor 缺少必填环境变量: ${missing.map(k => ENV_KEYS[k]).join(', ')}（检查 config/.env）`);
    }
    const cfg = loadSection();
    const out = { ...cfg, watchlist: loadWatchlist() };
    for (const k of Object.keys(ENV_KEYS)) {
        if (process.env[ENV_KEYS[k]]) out[k] = process.env[ENV_KEYS[k]];
    }
    // 逗号分隔多个 CSV 导出 URL
    if (out.sheetCsvUrls) {
        out.sheetCsvUrls = String(out.sheetCsvUrls).split(',').map(s => s.trim()).filter(Boolean);
    }
    return out;
}

module.exports = { loadNewsConfig, loadWatchlist };
