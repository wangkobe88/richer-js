/**
 * 策略库 API 路由（策略库一期，2026-09-28）
 *
 * 七端点：GET list / GET :id / POST / PUT :id（乐观并发 409）/ DELETE :id /
 * GET :id/usage / GET meta/variables（组变量注册表下发，前端帮助单源）。
 *
 * ⚠️ 表 RLS service_role-only——全部走 dbManager.getClient()（service key）。
 */

const express = require('express');
const router = express.Router();

const { StrategyLibraryService } = require('../services/StrategyLibraryService');
const { GROUP_VARIABLES } = require('../../strategies/group-variables');

const service = new StrategyLibraryService();

/** 统一错误响应：err.status（400/404/409）优先，否则 500 */
function fail(res, error, fallbackStatus = 500) {
    const status = error.status || fallbackStatus;
    res.status(status).json({ success: false, error: error.message });
}

/**
 * GET /api/strategy-library?side=buy|sell
 * 条目列表（含腿数/被引用数）
 */
router.get('/', async (req, res) => {
    try {
        const side = req.query.side || null;
        const items = await service.list(side);
        res.json({ success: true, data: items });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/strategy-library/meta/variables
 * 组变量注册表（前端帮助/表达式提示单一事实源）
 * ⚠️ 必须声明在 /:id 之前（否则 "meta" 会被当成 id）
 */
router.get('/meta/variables', (req, res) => {
    res.json({ success: true, data: GROUP_VARIABLES });
});

/**
 * GET /api/strategy-library/:id
 * 单条目
 */
router.get('/:id', async (req, res) => {
    try {
        const item = await service.getById(req.params.id);
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error, 404);
    }
});

/**
 * POST /api/strategy-library
 * 新建条目 { name, description, side, legs }
 */
router.post('/', async (req, res) => {
    try {
        const { name, description = '', side, legs } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'name 必填' });
        }
        const item = await service.create({ name, description, side, legs });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * PUT /api/strategy-library/:id
 * 更新条目 { name, description, legs, expectedVersion }（side 锁死）
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, description = '', legs, expectedVersion } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'name 必填' });
        }
        if (!Number.isInteger(expectedVersion)) {
            return res.status(400).json({ success: false, error: 'expectedVersion 必填（乐观并发）' });
        }
        const item = await service.update(req.params.id, { name, description, legs, expectedVersion });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/strategy-library/:id
 * 删除条目（快照语义：运行零影响；响应带删除前被引用数）
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await service.remove(req.params.id);
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/strategy-library/:id/usage
 * 被引用明细（引用该条目的实验 id 列表）
 */
router.get('/:id/usage', async (req, res) => {
    try {
        const result = await service.getUsage(req.params.id);
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
