/**
 * Case 集合 API 路由（2026-11-20 Case 集合管理系统）
 *
 * 集合 CRUD + 成员代币 CRUD + 数据复制（自动后台同步/手动补拉/全量同步）+
 * 同步状态轮询 + 派生回测实验反查。
 *
 * ⚠️ 表 RLS service_role-only——service 内一律 dbManager.getClient()（service key）。
 * ⚠️ 固定子路径（/sync-status、/derived-experiments 等）必须注册在 /:id 之前
 *    （express 按注册序匹配，否则被当作 :id 吞掉——strategy-library 同款坑）。
 */

const express = require('express');
const router = express.Router();

const { CaseCollectionService } = require('../services/CaseCollectionService');

const service = new CaseCollectionService();

/** 统一错误响应：err.status（400/404/409）优先，否则 500 */
function fail(res, error, fallbackStatus = 500) {
    const status = error.status || fallbackStatus;
    res.status(status).json({ success: false, error: error.message });
}

/**
 * GET /api/case-collections
 * 集合列表（含 token 数/sync 汇总；创建页下拉复用）
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
 * GET /api/case-collections/:id/sync-status
 * 同步状态（DB sync_state 真源 + 内存运行态；详情页轮询）
 */
router.get('/:id/sync-status', async (req, res) => {
    try {
        const status = await service.syncStatus(req.params.id);
        res.json({ success: true, data: status });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/case-collections/:id/derived-experiments
 * 以该集合为代币宇宙的回测实验清单
 */
router.get('/:id/derived-experiments', async (req, res) => {
    try {
        const items = await service.listDerivedExperiments(req.params.id);
        res.json({ success: true, data: items });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/case-collections/:id
 * 集合详情（成员全列）
 */
router.get('/:id', async (req, res) => {
    try {
        const item = await service.getDetail(req.params.id);
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error, 404);
    }
});

/**
 * POST /api/case-collections
 * 新建集合 { name, description }
 */
router.post('/', async (req, res) => {
    try {
        const { name, description = '' } = req.body || {};
        const item = await service.create({ name, description });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * PUT /api/case-collections/:id
 * 更新集合 { name, description }
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, description = '' } = req.body || {};
        const item = await service.update(req.params.id, { name, description });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/case-collections/:id
 * 删除集合（级联删成员+ticks+events 副本；响应带删除前规模）
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
 * POST /api/case-collections/:id/sync
 * 全量同步（pending/failed 成员逐个入队）
 */
router.post('/:id/sync', async (req, res) => {
    try {
        const result = await service.enqueueSyncAll(req.params.id);
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * POST /api/case-collections/:id/tokens
 * 添加代币 { tokenAddress, note }——自动入队后台复制；无 token_create 事件 → 400
 */
router.post('/:id/tokens', async (req, res) => {
    try {
        const { tokenAddress, note = '' } = req.body || {};
        if (!tokenAddress) {
            return res.status(400).json({ success: false, error: 'tokenAddress 必填' });
        }
        const item = await service.addToken(req.params.id, { tokenAddress, note });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * PUT /api/case-collections/:id/tokens/:tokenAddress
 * 更新成员备注 { note }
 */
router.put('/:id/tokens/:tokenAddress', async (req, res) => {
    try {
        const { note = '' } = req.body || {};
        const item = await service.updateTokenNote(req.params.id, req.params.tokenAddress, { note });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/case-collections/:id/tokens/:tokenAddress
 * 移除代币（级联删该票 ticks+events 副本；响应带规模）
 */
router.delete('/:id/tokens/:tokenAddress', async (req, res) => {
    try {
        const result = await service.removeToken(req.params.id, req.params.tokenAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * POST /api/case-collections/:id/tokens/:tokenAddress/sync
 * 单票同步/补拉增量（入队串行链立即返回；前端轮询 sync-status）
 */
router.post('/:id/tokens/:tokenAddress/sync', async (req, res) => {
    try {
        const result = await service.enqueueSync(req.params.id, req.params.tokenAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
