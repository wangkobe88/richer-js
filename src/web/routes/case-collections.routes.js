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

// ─────────────── 标签路由（固定子路径，必须在 /:id 之前注册） ───────────────

/**
 * GET /api/case-collections/tags
 * 全局标签聚合 [{tag, tokenCount}]（按计数降序）——列表页标签检索面板数据源
 */
router.get('/tags', async (req, res) => {
    try {
        const items = await service.listTags();
        res.json({ success: true, data: items });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/case-collections/tags/:tag
 * 按标签查询：带该标签的全部代币 + 所在集合（含未入集合的孤儿标签代币）
 */
router.get('/tags/:tag', async (req, res) => {
    try {
        const item = await service.findTokensByTag(req.params.tag);
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * GET /api/case-collections/tokens/:tokenAddress/tags
 * 单代币标签列表
 */
router.get('/tokens/:tokenAddress/tags', async (req, res) => {
    try {
        const tags = await service.getTagsForToken(req.params.tokenAddress);
        res.json({ success: true, data: { tokenAddress: req.params.tokenAddress, tags } });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * POST /api/case-collections/tokens/:tokenAddress/tags
 * 添加标签 { tag }（幂等：重复加无副作用）——标签可打在任意地址上（先分类后入集）
 */
router.post('/tokens/:tokenAddress/tags', async (req, res) => {
    try {
        const { tag } = req.body || {};
        if (!tag) {
            return res.status(400).json({ success: false, error: 'tag 必填' });
        }
        const item = await service.addTokenTag(req.params.tokenAddress, { tag });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/case-collections/tokens/:tokenAddress/tags/:tag
 * 移除标签（不存在 → 404 fail-loud）
 */
router.delete('/tokens/:tokenAddress/tags/:tag', async (req, res) => {
    try {
        const item = await service.removeTokenTag(req.params.tokenAddress, req.params.tag);
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error, 404);
    }
});

/**
 * GET /api/case-collections/:id/tags
 * 集合内标签数据 {tags: [{tag,count}], tokenTags: {addr: [tags]}}（详情页一次性拉取）
 */
router.get('/:id/tags', async (req, res) => {
    try {
        const item = await service.getCollectionTags(req.params.id);
        res.json({ success: true, data: item });
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
 * 添加代币 { tokenAddress, note, tags }——自动入队后台复制；无 token_create 事件 → 400
 * tags：可选（数组或逗号分隔字符串；先落标签后代币行）
 */
router.post('/:id/tokens', async (req, res) => {
    try {
        const { tokenAddress, note = '', tags = [] } = req.body || {};
        if (!tokenAddress) {
            return res.status(400).json({ success: false, error: 'tokenAddress 必填' });
        }
        const item = await service.addToken(req.params.id, { tokenAddress, note, tags });
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
