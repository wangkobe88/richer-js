/**
 * 策略库 API 路由（策略库二期 / T202，2026-11-20）
 *
 * 七端点：GET list / GET module-versions / GET :id / POST / PUT :id（乐观并发
 * 409）/ DELETE :id / GET :id/usage。
 *
 * 条目 = 完整交易策略包（definition jsonb：buyLegs/sellLegs + stallClose +
 * burstCooldown + modules 版本键）；实验创建页经本路由选包，实验 config 只存
 * strategyId。
 *
 * ⚠️ 表 RLS service_role-only——全部走 dbManager.getClient()（service key）。
 * ⚠️ GET /module-versions 必须注册在 GET /:id 之前（express 按注册序匹配，
 *    否则 'module-versions' 会被当作 :id 吞掉）。
 */

const express = require('express');
const router = express.Router();

const { StrategyLibraryService } = require('../services/StrategyLibraryService');
const { listModuleVersions } = require('../../market-analysis/module-registry');

const service = new StrategyLibraryService();

/** 统一错误响应：err.status（400/404/409）优先，否则 500 */
function fail(res, error, fallbackStatus = 500) {
    const status = error.status || fallbackStatus;
    res.status(status).json({ success: false, error: error.message });
}

/**
 * GET /api/strategy-library
 * 策略包列表（含买/卖腿数与被引用数）
 */
router.get('/', async (req, res) => {
    try {
        const items = await service.list();
        res.json({ success: true, data: items });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/strategy-library/module-versions
 * 检测模块版本键清单（代码注册表单一真相源——库页 modules 下拉用；
 * 页面硬编码会漂移，一律从这里取）
 */
router.get('/module-versions', async (req, res) => {
    try {
        res.json({ success: true, data: listModuleVersions() });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/strategy-library/:id
 * 单策略包
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
 * 新建策略包 { name, description, definition }
 */
router.post('/', async (req, res) => {
    try {
        const { name, description = '', definition } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'name 必填' });
        }
        if (definition === undefined) {
            return res.status(400).json({ success: false, error: 'definition 必填（策略包：buyLegs/sellLegs/burstCooldown/modules——断流卖出=T233 腿化卖腿）' });
        }
        const item = await service.create({ name, description, definition });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * PUT /api/strategy-library/:id
 * 更新策略包 { name, description, definition, expectedVersion }
 * 「启动时取最新」语义：改动在引用实验下次启动生效
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, description = '', definition, expectedVersion } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'name 必填' });
        }
        if (!Number.isInteger(expectedVersion)) {
            return res.status(400).json({ success: false, error: 'expectedVersion 必填（乐观并发）' });
        }
        if (definition === undefined) {
            return res.status(400).json({ success: false, error: 'definition 必填（策略包：buyLegs/sellLegs/burstCooldown/modules——断流卖出=T233 腿化卖腿）' });
        }
        const item = await service.update(req.params.id, { name, description, definition, expectedVersion });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/strategy-library/:id
 * 删除策略包（只影响下次启动的实验；响应带删除前被引用数）
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
 * 被引用明细（引用该策略包的实验 id 列表）
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
