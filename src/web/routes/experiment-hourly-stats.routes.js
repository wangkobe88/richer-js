/**
 * 实验统计监控路由（实验子页面「统计监控」数据端点）
 *
 * GET /api/experiment/:id/hourly-stats            按小时 × 平台统计（per-experiment 60s 缓存）
 * GET /api/experiment/:id/hourly-stats?refresh=1  强制刷新（绕过缓存直查）
 *
 * 挂 /api（manual-trades 同款实验域 router 先例）；全部查询经 dbManager service key（RLS 红线）。
 */

const express = require('express');
const router = express.Router();

const { ExperimentHourlyStatsService } = require('../services/ExperimentHourlyStatsService');

const service = new ExperimentHourlyStatsService();

router.get('/experiment/:id/hourly-stats', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await service.getHourlyStats(req.params.id, { refresh });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

module.exports = router;
