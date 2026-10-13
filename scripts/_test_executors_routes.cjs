#!/usr/bin/env node
/**
 * 执行器（executors）CRUD + 路由校验（P0-A 实盘前置批）零 DB 零网络单测
 *
 * 覆盖 ExecutorService + executors.routes：
 *   1. create：明文私钥嗅探加密（0x+64hex → CryptoUtils 密文落库）；
 *      已加密密文原样落库（不二次加密）
 *   2. list/getById 恒用安全列集——auth_token（密文）绝不出库（私钥永不回传）
 *   3. update：auth_token 缺省/空串 = 不修改；提供则嗅探加密；空 patch 400
 *   4. remove：关联检查（live 实验 config.wallet.executorId 引用 → 400 + 清单）；
 *      无关联正常删除（修复 rich-js 可删在用钱包弱点）
 *   5. 路由层校验：name/address/auth_token 格式 400、reserve_native 非负 400、
 *      err.status 透传（400/404 不被吞成 500）
 *   6. 源码口径：service 层 dbManager.getClient()（service key，RLS 红线）
 *
 * 打桩：dbManager 单例（executors + experiments 两表 mock，select 列集裁剪
 * 语义模拟 supabase）+ CryptoUtils 真加解密（纯计算）。路由层用伪 req/res
 * 直接调 router 函数（零端口零网络）。
 *
 * 运行：node scripts/_test_executors_routes.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');

// ═══════════════ dbManager 单例打桩（被测模块 require 前）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

class MockQuery {
    constructor(db, table) { this.db = db; this.table = table; this._eqs = {}; this._cols = '*'; this._lim = null; this._single = false; this._ins = null; this._upd = null; this._del = false; }
    select(cols) { this._cols = cols || '*'; return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    order(col, opts) { this._order = { col, ...opts }; return this; }
    insert(rows) { this._ins = rows; return this; }
    update(patch) { this._upd = patch; return this; }
    delete() { this._del = true; return this; }
    single() { this._single = true; return this; }
    then(resolve) { resolve(this._exec()); }
    _rows() {
        let rows = this.db.tables[this.table] || [];
        for (const [c, v] of Object.entries(this._eqs)) rows = rows.filter(r => String(r[c]) === String(v));
        return rows;
    }
    _project(rows) {
        if (this._cols === '*') return rows;
        const keys = this._cols.split(',').map(s => s.trim());
        return rows.map(r => Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]])));
    }
    _exec() {
        if (this._ins) {
            const addr = String(this._ins[0].address || '').toLowerCase();
            if ((this.db.tables[this.table] || []).some(r => String(r.address).toLowerCase() === addr)) {
                return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            const row = { id: `gen-${this.table.length}-${Math.random().toString(36).slice(2, 6)}`, ...this._ins[0] };
            this.db.tables[this.table].push(row);
            return { data: this._project([row])[0], error: null };
        }
        if (this._upd) {
            const rows = this._rows();
            if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: '0 rows' } };
            for (const r of rows) Object.assign(r, this._upd);
            return { data: this._project(rows)[0], error: null };
        }
        if (this._del) {
            const rows = this._rows();
            this.db.tables[this.table] = this.db.tables[this.table].filter(r => !rows.includes(r));
            return { data: null, error: null };
        }
        let rows = this._rows();
        if (this._order) rows = [...rows].sort((a, b) =>
            String(a[this._order.col]).localeCompare(String(b[this._order.col])) * (this._order.ascending ? 1 : -1));
        if (this._single) {
            if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: '0 rows' } };
            return { data: this._project(rows)[0], error: null };
        }
        return { data: this._project(rows), error: null };
    }
}
const db = { tables: { executors: [], experiments: [] } };
db.client = { from: (t) => new MockQuery(db, t) };
dbManager.isInitialized = true;
dbManager.client = db.client;

const { ExecutorService, SAFE_COLUMNS, isEvmPlainPrivateKey } = require(path.join(ROOT, 'src/web/services/ExecutorService'));
const { CryptoUtils } = require(path.join(ROOT, 'src/utils/CryptoUtils'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}

function resetDb() { db.tables.executors = []; db.tables.experiments = []; }

/** 伪 req/res 直接调 express router（零端口；res.json=响应终态即 resolve） */
async function callRoute(router, method, urlPath, body) {
    const req = Object.assign(Object.create(require('http').IncomingMessage.prototype), { method, url: urlPath, body });
    // express router 从 url 提取 params（path-to-regexp 匹配 req.url 相对挂载点）
    let settle;
    const res = {
        statusCode: 200, payload: null,
        status(c) { this.statusCode = c; return this; },
        json(p) { this.payload = p; settle(); return this; },
    };
    await new Promise((resolve) => { settle = resolve; router(req, res, () => resolve()); });
    return { status: res.statusCode, body: res.payload };
}

async function main() {
    const PLAIN_PK = ethers.Wallet.createRandom().privateKey; // 0x+64hex 明文
    const CIPHER = new CryptoUtils().encrypt(PLAIN_PK);

    // ═══════════════ 0. 嗅探纯函数 ═══════════════
    console.log('\n[0] isEvmPlainPrivateKey 嗅探');
    {
        ok(isEvmPlainPrivateKey(PLAIN_PK) === true, '明文私钥（0x+64hex）识别');
        ok(isEvmPlainPrivateKey(CIPHER) === false, '密文（base64）不误判');
        ok(isEvmPlainPrivateKey('0x' + 'ab'.repeat(20)) === false, 'EVM 地址（0x+40hex）不误判');
        ok(isEvmPlainPrivateKey(null) === false && isEvmPlainPrivateKey(42) === false, '非字符串不炸');
    }

    // ═══════════════ 1. create 嗅探加密 ═══════════════
    console.log('\n[1] create：明文嗅探加密 / 密文原样');
    {
        resetDb();
        const svc = new ExecutorService();
        const addr = ethers.Wallet.createRandom().address;

        const row1 = await svc.create({ name: 'A', address: addr, auth_token: PLAIN_PK });
        const stored1 = db.tables.executors[0];
        ok(stored1.auth_token !== PLAIN_PK, '明文不落库（嗅探后加密）');
        ok(new CryptoUtils().decrypt(stored1.auth_token) === PLAIN_PK, '落库密文可解回原私钥');
        ok(row1 && !('auth_token' in row1), 'create 返回值不含 auth_token（安全列集）');
        ok(stored1.blockchain === 'bsc', 'blockchain 恒 bsc');
        ok(stored1.reserve_native === 0.01, 'reserve_native 默认 0.01');

        // 密文原样（不二次加密）
        const row2 = await svc.create({ name: 'B', address: ethers.Wallet.createRandom().address, auth_token: CIPHER, reserve_native: 0.2 });
        ok(db.tables.executors[1].auth_token === CIPHER, '已加密密文原样落库（不二次加密）');
        ok(row2.reserve_native === 0.2, 'reserve_native 显式 0.2');

        // 唯一地址冲突 400
        await assert.rejects(
            () => svc.create({ name: 'C', address: addr, auth_token: PLAIN_PK }),
            (e) => e.status === 400 && /已存在/.test(e.message),
        );
        ok(true, '地址重复（23505）→ 400 友好报错');
    }

    // ═══════════════ 2. list/getById 密文永不回传 ═══════════════
    console.log('\n[2] 查询路径密文永不回传');
    {
        resetDb();
        const svc = new ExecutorService();
        await svc.create({ name: 'A', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK });
        await svc.create({ name: 'B', address: ethers.Wallet.createRandom().address, auth_token: CIPHER });

        const list = await svc.list();
        ok(list.length === 2 && list.every(r => !('auth_token' in r)), 'list 无 auth_token 键（列集裁剪）');
        ok(SAFE_COLUMNS.includes('auth_token') === false, 'SAFE_COLUMNS 不含 auth_token（源码口径）');

        const one = await svc.getById(db.tables.executors[0].id);
        ok(one && !('auth_token' in one), 'getById 无 auth_token 键');
        ok(await svc.getById('no-such-id') === null, '不存在 → null（PGRST116 不 throw）');
    }

    // ═══════════════ 3. update 语义 ═══════════════
    console.log('\n[3] update 语义');
    {
        resetDb();
        const svc = new ExecutorService();
        const row = await svc.create({ name: 'A', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK });
        const storedBefore = db.tables.executors[0].auth_token;

        await svc.update(row.id, { name: 'A2' }); // auth_token 缺省
        ok(db.tables.executors[0].auth_token === storedBefore, 'auth_token 缺省 = 不修改');
        ok(db.tables.executors[0].name === 'A2', 'name 正常更新');

        await svc.update(row.id, { name: 'A3', auth_token: '' }); // 空串+伴随字段
        ok(db.tables.executors[0].auth_token === storedBefore && db.tables.executors[0].name === 'A3',
            'auth_token 空串 = 不修改（伴随字段正常更新）');
        await assert.rejects(() => svc.update(row.id, { auth_token: '' }), (e) => e.status === 400);
        ok(true, '纯空串（patch 全空）→ 400 无可更新字段');

        const pk2 = ethers.Wallet.createRandom().privateKey;
        await svc.update(row.id, { auth_token: pk2 });
        ok(db.tables.executors[0].auth_token !== storedBefore
            && new CryptoUtils().decrypt(db.tables.executors[0].auth_token) === pk2, '新明文嗅探加密更新');

        await assert.rejects(() => svc.update(row.id, {}), (e) => e.status === 400);
        ok(true, '空 patch → 400');

        await assert.rejects(() => svc.update('no-such-id', { name: 'X' }), (e) => e.status === 404);
        ok(true, '更新不存在行 → 404');
    }

    // ═══════════════ 4. remove 关联检查 ═══════════════
    console.log('\n[4] remove 关联检查（rich-js 弱点修复）');
    {
        resetDb();
        const svc = new ExecutorService();
        const row = await svc.create({ name: 'A', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK });

        // 4a. 无关联 → 正常删
        ok(await svc.remove(row.id) === true, '无关联正常删除');
        ok(db.tables.executors.length === 0, '行已删');

        // 4b. 有 live 实验引用 → 400 + 清单
        const row2 = await svc.create({ name: 'B', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK });
        db.tables.experiments = [
            { id: 'exp-1', experiment_name: '实盘A', trading_mode: 'live', config: { wallet: { executorId: row2.id } } },
            { id: 'exp-2', experiment_name: '虚拟B', trading_mode: 'virtual', config: { wallet: { executorId: row2.id } } }, // 非 live 不拦
            { id: 'exp-3', experiment_name: '实盘C', trading_mode: 'live', config: { wallet: { executorId: 'other' } } },   // 引用他人不拦
            { id: 'exp-4', experiment_name: '实盘D', trading_mode: 'live', config: {} },                                     // 无 wallet 不拦
        ];
        await assert.rejects(
            () => svc.remove(row2.id),
            (e) => e.status === 400 && /1 个 live 实验/.test(e.message) && e.linked.length === 1 && e.linked[0].id === 'exp-1',
        );
        ok(true, 'live 引用 → 400 + linked 清单（只含真正引用者）');
        ok(db.tables.executors.length === 1, '被引用行未删');

        // 4c. virtual 实验引用不拦（删除语义只保护 live）
        db.tables.experiments = [db.tables.experiments[1]]; // 只剩 virtual 引用
        ok(await svc.remove(row2.id) === true, '仅 virtual 引用 → 放行删除');
    }

    // ═══════════════ 5. 路由层校验（伪 req/res）═══════════════
    console.log('\n[5] 路由层校验');
    {
        resetDb();
        const router = require(path.join(ROOT, 'src/web/routes/executors.routes'));

        // 5a. POST 校验链
        let r = await callRoute(router, 'POST', '/', {});
        ok(r.status === 400 && /name 必填/.test(r.body.error), 'POST 缺 name → 400');
        r = await callRoute(router, 'POST', '/', { name: 'A', address: '0xbad', auth_token: PLAIN_PK });
        ok(r.status === 400 && /EVM 地址/.test(r.body.error), 'POST 地址格式 → 400');
        r = await callRoute(router, 'POST', '/', { name: 'A', address: ethers.Wallet.createRandom().address });
        ok(r.status === 400 && /auth_token 必填/.test(r.body.error), 'POST 缺 auth_token → 400');
        r = await callRoute(router, 'POST', '/', { name: 'A', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK, reserve_native: -1 });
        ok(r.status === 400 && /非负/.test(r.body.error), 'POST reserve_native 负数 → 400');
        r = await callRoute(router, 'POST', '/', { name: 'A', address: ethers.Wallet.createRandom().address, auth_token: PLAIN_PK });
        ok(r.status === 201 && r.body.success && !('auth_token' in r.body.data), 'POST 合法 → 201 且响应无密文');

        // 5b. GET 路径
        r = await callRoute(router, 'GET', '/', null);
        ok(r.status === 200 && r.body.data.length === 1 && !('auth_token' in r.body.data[0]), 'GET list 200 无密文');
        r = await callRoute(router, 'GET', '/no-such-id', null);
        ok(r.status === 404, 'GET 不存在 → 404');

        // 5c. PUT 校验
        const eid = db.tables.executors[0].id;
        r = await callRoute(router, 'PUT', `/${eid}`, { address: 'zzz' });
        ok(r.status === 400 && /EVM 地址/.test(r.body.error), 'PUT 地址格式 → 400');
        r = await callRoute(router, 'PUT', '/no-such-id', { name: 'X' });
        ok(r.status === 404 && /不存在/.test(r.body.error), 'PUT 不存在 → 404（err.status 透传不被吞成 500）');

        // 5d. DELETE 关联透传
        db.tables.experiments = [{ id: 'exp-1', experiment_name: 'L1', trading_mode: 'live', config: { wallet: { executorId: eid } } }];
        r = await callRoute(router, 'DELETE', `/${eid}`, null);
        ok(r.status === 400 && r.body.linked && r.body.linked.length === 1, 'DELETE 关联 → 400 + linked 透传');
        db.tables.experiments = [];
        r = await callRoute(router, 'DELETE', `/${eid}`, null);
        ok(r.status === 200 && r.body.success === true, 'DELETE 无关联 → 200');
    }

    // ═══════════════ 6. 源码口径 ═══════════════
    console.log('\n[6] 源码口径');
    {
        const svcSrc = fs.readFileSync(path.join(ROOT, 'src/web/services/ExecutorService.js'), 'utf8');
        ok(svcSrc.includes('dbManager.getClient()') && !svcSrc.includes('createClient'),
            'service 层 dbManager.getClient()（service key，RLS 红线）');
        const routeSrc = fs.readFileSync(path.join(ROOT, 'src/web/routes/executors.routes.js'), 'utf8');
        // 路由层不直接触 DB（全走 service——单一 service key 出口）
        ok(!routeSrc.includes('.from('), '路由层零直接 DB 访问（全走 service）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
