/**
 * 执行器（交易钱包）API 路由（实盘前置批，2026-10-13，迁移自 rich-js）
 *
 * 五端点：GET list / GET :id / POST / PUT :id / DELETE :id。
 * 私钥密文（auth_token）只在 POST/PUT 写入，任何响应绝不回传。
 *
 * ⚠️ 表 RLS service_role-only——全部走 dbManager.getClient()（service key，红线③）。
 */

const express = require('express');
const router = express.Router();

const { ExecutorService } = require('../services/ExecutorService');

const service = new ExecutorService();

/** 统一错误响应：err.status（400/404）优先，否则 500 */
function fail(res, error, fallbackStatus = 500) {
    const status = error.status || fallbackStatus;
    const body = { success: false, error: error.message };
    if (Array.isArray(error.linked)) body.linked = error.linked; // DELETE 关联实验清单
    res.status(status).json(body);
}

/**
 * GET /api/executors
 * 列表（新→旧；恒不含 auth_token）
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
 * GET /api/executors/:id
 * 单查（恒不含 auth_token）
 */
router.get('/:id', async (req, res) => {
    try {
        const item = await service.getById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: '执行器不存在' });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * POST /api/executors
 * 新建 { name, address, auth_token, reserve_native? }
 * auth_token 接受明文私钥（0x+64hex 自动加密落库）或已加密密文
 */
router.post('/', async (req, res) => {
    try {
        const { name, address, auth_token, reserve_native } = req.body || {};
        if (!name || String(name).trim() === '') {
            return res.status(400).json({ success: false, error: 'name 必填' });
        }
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
            return res.status(400).json({ success: false, error: 'address 必须是 EVM 地址（0x + 40 hex）' });
        }
        if (!auth_token || typeof auth_token !== 'string') {
            return res.status(400).json({ success: false, error: 'auth_token 必填（明文私钥或密文）' });
        }
        if (reserve_native != null && !(Number(reserve_native) >= 0)) {
            return res.status(400).json({ success: false, error: 'reserve_native 必须为非负数（BNB）' });
        }
        const item = await service.create({
            name: String(name).trim(),
            address: String(address).trim(),
            auth_token,
            reserve_native: reserve_native != null ? Number(reserve_native) : undefined,
        });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * PUT /api/executors/:id
 * 更新 { name?, address?, auth_token?, reserve_native? }
 * auth_token 缺省/空串 = 不修改；提供则嗅探加密后更新
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, address, auth_token, reserve_native } = req.body || {};
        if (address != null && !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
            return res.status(400).json({ success: false, error: 'address 必须是 EVM 地址（0x + 40 hex）' });
        }
        if (reserve_native != null && !(Number(reserve_native) >= 0)) {
            return res.status(400).json({ success: false, error: 'reserve_native 必须为非负数（BNB）' });
        }
        const item = await service.update(req.params.id, {
            name: name != null ? String(name).trim() : undefined,
            address: address != null ? String(address).trim() : undefined,
            auth_token: auth_token || undefined,
            reserve_native: reserve_native != null ? Number(reserve_native) : undefined,
        });
        res.json({ success: true, data: item });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * DELETE /api/executors/:id
 * 删除（有关联 live 实验引用 config.wallet.executorId 时 400 拒删 + 关联清单）
 */
router.delete('/:id', async (req, res) => {
    try {
        await service.remove(req.params.id);
        res.json({ success: true });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
