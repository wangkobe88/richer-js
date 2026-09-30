/**
 * news-monitor API 路由（原 news_monitor bin/web.js 的 /api/* 收编）。
 * 全部挂 /api/news 前缀（richer-js 已有 /api/events，避免冲突）。
 *
 * ⚠️ client 一律 dbManager.getClient()（service key）——RLS enable 无 anon policy，
 * 勿照抄 narrative.routes 的 anon 客户端（anon 会被静默过滤成空）。
 */
'use strict';

const express = require('express');
const { dbManager } = require('../../services/dbManager');
const store = require('../../news-monitor/store');
const { loadWatchlist } = require('../../news-monitor/config');
const { logger } = require('../../news-monitor/logs');

const router = express.Router();

// handle → ecosystem（与 sync 共用同一 news-watchlist.json，展示分组不漂移）
let ecoOf = null;
function getEcoOf() {
    if (!ecoOf) {
        ecoOf = new Map();
        for (const [eco, entries] of Object.entries(loadWatchlist())) {
            for (const entry of entries) {
                ecoOf.set(String(typeof entry === 'object' ? entry.handle : entry).toLowerCase(), eco);
            }
        }
    }
    return ecoOf;
}

const wrap = fn => (req, res) => {
    fn(req, res).catch(err => {
        logger.error('news api 处理失败', { path: req.path, err: err.message });
        res.status(500).json({ error: err.message });
    });
};

// GET /api/news/status
router.get('/status', wrap(async (req, res) => {
    const [watchCount, latestReport, maxId] = await Promise.all([
        store.countWatchAccounts(),
        store.getLatestReport(),
        store.getMaxEventId(),
    ]);
    res.json({
        watchCount,
        latestReportAt: latestReport?.created_at ?? null,
        latestWindowEnd: latestReport?.window_end ?? null,
        maxEventId: maxId,
        serverTime: new Date().toISOString(),
    });
}));

// GET /api/news/latest-report
router.get('/latest-report', wrap(async (req, res) => {
    const report = await store.getLatestReport();
    res.json({ report: report ?? null });
}));

// GET /api/news/reports?before_id=&limit=
router.get('/reports', wrap(async (req, res) => {
    const beforeId = req.query.before_id;
    const limit = Number(req.query.limit || 30);
    const reports = await store.getReports(beforeId ? Number(beforeId) : null, limit);
    res.json({ reports });
}));

// GET /api/news/report/:id
router.get('/report/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const report = await store.getReport(id);
    if (!report) return res.status(404).json({ error: 'not found' });
    res.json({ report });
}));

// GET /api/news/report/:id/events —— 报告窗口关联事件
router.get('/report/:id/events', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const report = await store.getReport(id);
    if (!report) return res.status(404).json({ error: 'not found' });
    if (report.first_event_id == null || report.last_event_id == null) {
        return res.json({ events: [] });
    }
    const events = await store.fetchEventsBetween(report.first_event_id, report.last_event_id);
    res.json({ events });
}));

// GET /api/news/events?before_id=&limit= —— 事件流（id 倒序游标）
router.get('/events', wrap(async (req, res) => {
    const beforeId = req.query.before_id;
    const limit = Number(req.query.limit || 50);
    const events = await store.fetchRecentEvents(beforeId ? Number(beforeId) : null, limit);
    res.json({ events });
}));

// GET /api/news/accounts —— 当前监控账号全量（百级小结果集），附 ecosystem 分组标签
router.get('/accounts', wrap(async (req, res) => {
    const accounts = await store.fetchAllAccounts();
    const eco = getEcoOf();
    for (const a of accounts) a.ecosystem = eco.get(a.handle) ?? null;
    res.json({ accounts });
}));

module.exports = router;
