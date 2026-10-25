/**
 * API 现状路由（一级页面「API 现状」数据端点）
 *
 * GET /api/api-status            全部提供方余额/可用性（60s 缓存）
 * GET /api/api-status?refresh=1  强制刷新（绕过缓存直查上游）
 *
 * 纯外网轻量查询，不碰 Supabase（无 RLS/service key 问题）。
 */

const express = require('express');
const router = express.Router();

const { ApiStatusService } = require('../services/api-status-service');

const service = new ApiStatusService();

router.get('/', async (req, res) => {
    try {
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await service.getStatus({ refresh });
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
