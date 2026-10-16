#!/usr/bin/env node
/**
 * live 执行器钱包加载（P0-A 实盘前置批）零 DB 零网络单测
 *
 * 覆盖 FourMemeWssTradingEngine._initializeLiveTrader 钱包双源解析：
 *   1. executorId 加载链：executors 表行 → auth_token 解密 → 地址一致性校验 →
 *      _walletSource='executor:<name>'；executor 的 reserve_native 覆盖 config 默认
 *   2. 三源互斥：executorId 与 privateKey 并存 → throw（防歧义）
 *   3. blockchain≠bsc → throw（BSC-only）
 *   4. 加载失败/行不存在/密文损坏 → 各自 throw（fail-loud 不静默）
 *   5. reserveNative 三级优先：实验 live 段 > executors 行 > base 默认 0.01
 *   6. privateKey 直配（存量实验）路径回归零变化
 *   7. 发单 RPC 解析：ANKR_HTTP_RPC_URL > ANKR_API_KEY > ANKR_WS_URL 末段 key 提取
 *      （wss://rpc.ankr.com/bsc/ws/<key> → https://rpc.ankr.com/bsc/<key>）
 *   8. 源码口径：executors 查询走 dbManager.getClient()（service key，RLS 红线）
 *
 * 打桩：dbManager 单例（executors 表）+ traders 工厂（require.cache 桩返回
 * stubTrader：真 ethers.Wallet 私钥派生地址，地址校验走真逻辑）+ CryptoUtils
 * 真加解密（纯计算）。_fetchBnbUsdOnce 走 provider.call 桩（零网络）。
 *
 * 运行：node scripts/_test_live_executor_loading.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');

// ═══════════════ env 前置清理（RPC 解析断言确定性）═══════════════
for (const k of ['ANKR_HTTP_RPC_URL', 'ANKR_API_KEY', 'ANKR_WS_URL']) delete process.env[k];

// ═══════════════ dbManager 单例打桩（引擎 require 前）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

class MockQuery {
    constructor(db, table) { this.db = db; this.table = table; this._eqs = {}; this._single = false; }
    select(cols) { this._cols = cols; return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    single() { this._single = true; return this; }
    then(resolve) {
        const rows = (this.db.tables[this.table] || []).filter(r => Object.entries(this._eqs).every(([c, v]) => r[c] === v));
        if (this._single) {
            resolve({ data: rows[0] || null, error: rows.length ? null : { code: 'PGRST116', message: '行不存在' } });
        } else {
            resolve({ data: rows, error: null });
        }
    }
}
const db = { tables: { executors: [] } };
db.client = { from: (t) => new MockQuery(db, t) };
dbManager.isInitialized = true;
dbManager.client = db.client;

// ═══════════════ traders 工厂打桩 ═══════════════
const created = [];
const TRADERS_PATH = require.resolve(path.join(ROOT, 'src/trading-engine/traders'));
require.cache[TRADERS_PATH] = {
    id: TRADERS_PATH, filename: TRADERS_PATH, loaded: true,
    exports: {
        createTrader: (type, config) => {
            const t = {
                _type: type, _config: config, wallet: null, provider: null, txWaitTimeoutMs: null,
                async setWallet(pk) {
                    this.wallet = new ethers.Wallet(pk);
                    // _fetchBnbUsdOnce 走 provider.call 桩（getAmountsOut 编码；零网络）
                    const p = new ethers.JsonRpcProvider('http://localhost:1');
                    const coder = ethers.AbiCoder.defaultAbiCoder();
                    p.call = async () => coder.encode(['uint256[]'], [[ethers.parseEther('1'), ethers.parseUnits('600', 18)]]);
                    this.provider = p;
                },
                async getNativeBalance() { return '1.234'; },
                setLogger(logger, experimentId) { this._logger = logger; this._logExperimentId = experimentId; },
            };
            created.push(t);
            return t;
        },
    },
};

const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const { CryptoUtils } = require(path.join(ROOT, 'src/utils/CryptoUtils'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function mkEngine({ wallet, live = undefined } = {}) {
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'live', initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experiment = { config: { wallet } };
    engine._applyWsConfig(live !== undefined ? { live } : {});
    return engine;
}

/** 真 executor 行（真钱包私钥加密成 auth_token） */
function mkExecutorRow(overrides = {}) {
    const w = ethers.Wallet.createRandom();
    return {
        id: 'exec-1',
        name: '主交易钱包',
        address: w.address,
        auth_token: new CryptoUtils().encrypt(w.privateKey),
        blockchain: 'bsc',
        reserve_native: 0.05,
        _privateKey: w.privateKey, // 测试自用（断言解密一致性）
        ...overrides,
    };
}

async function main() {
    // ═══════════════ 1. executorId 加载链 ═══════════════
    console.log('\n[1] executorId 加载链');
    {
        db.tables.executors = [mkExecutorRow()];
        created.length = 0;
        const engine = mkEngine({ wallet: { executorId: 'exec-1' } });
        await engine._initializeLiveTrader();

        ok(created.length === 1, 'trader 创建一次');
        ok(engine._walletAddress === db.tables.executors[0].address, '地址取自 executor 行');
        ok(engine._walletSource === 'executor:主交易钱包', `_walletSource=executor:<name>（${engine._walletSource}）`);
        ok(created[0].wallet.address.toLowerCase() === db.tables.executors[0].address.toLowerCase(),
            '解密私钥派生地址 = executor.address（地址一致性校验过）');
        // reserve_native 覆盖默认 0.01
        ok(engine._reserveNative.toString() === '0.05', `executor reserve_native=0.05 覆盖默认（${engine._reserveNative}）`);
        ok(engine._trader.txWaitTimeoutMs === engine._liveTxWaitTimeoutMs, 'txWaitTimeoutMs 透传');
    }

    // ═══════════════ 2. 三源互斥 ═══════════════
    console.log('\n[2] executorId × privateKey 互斥');
    {
        const engine = mkEngine({ wallet: { executorId: 'exec-1', privateKey: 'enc::whatever' } });
        await assert.rejects(() => engine._initializeLiveTrader(), /互斥/);
        ok(true, '双源并存 → throw（防歧义）');
    }

    // ═══════════════ 3. blockchain 校验 ═══════════════
    console.log('\n[3] blockchain BSC-only 校验');
    {
        db.tables.executors = [mkExecutorRow({ blockchain: 'ethereum' })];
        const engine = mkEngine({ wallet: { executorId: 'exec-1' } });
        await assert.rejects(() => engine._initializeLiveTrader(), /区块链不符/);
        ok(true, 'blockchain≠bsc → throw');
    }

    // ═══════════════ 4. fail-loud 三分支 ═══════════════
    console.log('\n[4] fail-loud 分支');
    {
        // 4a. 行不存在（error PGRST116）
        db.tables.executors = [];
        let engine = mkEngine({ wallet: { executorId: 'exec-gone' } });
        await assert.rejects(() => engine._initializeLiveTrader(), /执行器加载失败/);
        ok(true, '行不存在 → throw「执行器加载失败」');

        // 4b. 密文损坏（解密失败）
        db.tables.executors = [mkExecutorRow({ auth_token: 'not-a-valid-cipher' })];
        engine = mkEngine({ wallet: { executorId: 'exec-1' } });
        await assert.rejects(() => engine._initializeLiveTrader(), /解密失败/);
        ok(true, '密文损坏 → throw「解密失败（auth_token 可能损坏）」');

        // 4c. 地址不一致（私钥派生 ≠ executor.address——表数据损坏防线）
        const other = ethers.Wallet.createRandom();
        db.tables.executors = [mkExecutorRow({ address: other.address })];
        engine = mkEngine({ wallet: { executorId: 'exec-1' } });
        await assert.rejects(() => engine._initializeLiveTrader(), /钱包地址不一致.*执行器表数据损坏/);
        ok(true, '地址不一致 → throw 带「执行器表数据损坏」提示');

        // 4d. 无钱包配置
        engine = mkEngine({ wallet: undefined });
        await assert.rejects(() => engine._initializeLiveTrader(), /缺少钱包配置/);
        ok(true, '无 config.wallet → throw');
    }

    // ═══════════════ 5. reserveNative 三级优先 ═══════════════
    console.log('\n[5] reserveNative 三级优先');
    {
        // 5a. 实验级 live.reserveNative > executor
        db.tables.executors = [mkExecutorRow({ reserve_native: 0.05 })];
        const e1 = mkEngine({ wallet: { executorId: 'exec-1' }, live: { reserveNative: 0.02 } });
        await e1._initializeLiveTrader();
        ok(e1._reserveNative.toString() === '0.02', '实验 live 段 0.02 > executor 0.05（最高优先）');

        // 5b. executor > base 默认（1 已覆盖，此处补边界：executor null → base 默认）
        db.tables.executors = [mkExecutorRow({ reserve_native: null })];
        const e2 = mkEngine({ wallet: { executorId: 'exec-1' } });
        await e2._initializeLiveTrader();
        ok(e2._reserveNative.toString() === '0.01', 'executor reserve_native=NULL → base 默认 0.01');
    }

    // ═══════════════ 6. privateKey 直配回归 ═══════════════
    console.log('\n[6] privateKey 直配（存量实验）回归');
    {
        const w = ethers.Wallet.createRandom();
        db.tables.executors = [mkExecutorRow()]; // 表里有行也不该被读
        created.length = 0;
        const engine = mkEngine({ wallet: { address: w.address, privateKey: new CryptoUtils().encrypt(w.privateKey) } });
        await engine._initializeLiveTrader();
        ok(engine._walletSource === 'config', '_walletSource=config（路径零变化）');
        ok(engine._walletAddress === w.address, '地址取自 config.wallet.address');
        // executors 表未被查询（db 无查询断言点——trader 创建数与 walletSource 已锁定路径）
        ok(created.length === 1, 'trader 正常创建');
    }

    // ═══════════════ 7. 发单 RPC 解析 ═══════════════
    console.log('\n[7] ANKR HTTP RPC 解析');
    {
        db.tables.executors = [mkExecutorRow()];
        // 7a. ANKR_WS_URL 末段 key 提取
        process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws/abc123def/';
        created.length = 0;
        await mkEngine({ wallet: { executorId: 'exec-1' } })._initializeLiveTrader();
        ok(created[0]._config.network && created[0]._config.network.rpcUrl === 'https://rpc.ankr.com/bsc/abc123def',
            'WS URL 末段 key → 同源 HTTP RPC');

        // 7b. ANKR_API_KEY 次优先
        process.env.ANKR_API_KEY = 'key789';
        created.length = 0;
        await mkEngine({ wallet: { executorId: 'exec-1' } })._initializeLiveTrader();
        ok(created[0]._config.network.rpcUrl === 'https://rpc.ankr.com/bsc/key789', 'ANKR_API_KEY 构造 RPC');

        // 7c. ANKR_HTTP_RPC_URL 最高优先
        process.env.ANKR_HTTP_RPC_URL = 'https://custom-rpc.test/bsc';
        created.length = 0;
        await mkEngine({ wallet: { executorId: 'exec-1' } })._initializeLiveTrader();
        ok(created[0]._config.network.rpcUrl === 'https://custom-rpc.test/bsc', 'ANKR_HTTP_RPC_URL 显式最高优先');

        // 7d. 皆无 → 不带 network 段（BaseTrader 内置公共节点）
        for (const k of ['ANKR_HTTP_RPC_URL', 'ANKR_API_KEY', 'ANKR_WS_URL']) delete process.env[k];
        created.length = 0;
        await mkEngine({ wallet: { executorId: 'exec-1' } })._initializeLiveTrader();
        ok(!created[0]._config.network, '皆无配置 → 不带 network（公共节点+WARN）');

        // 7e. 非 ankr wss 形状不误提取
        process.env.ANKR_WS_URL = 'wss://other.example.com/ws/x';
        created.length = 0;
        await mkEngine({ wallet: { executorId: 'exec-1' } })._initializeLiveTrader();
        ok(!created[0]._config.network, '非 ankr wss 形状 → 不误提取 key');
        delete process.env.ANKR_WS_URL;
    }

    // ═══════════════ 8. 源码口径 ═══════════════
    console.log('\n[8] 源码口径');
    {
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
        const seg = src.slice(src.indexOf('async _initializeLiveTrader'), src.indexOf('_notifyLiveAlert'));
        // 8a. executors 查询走 dbManager.getClient()（service key 红线）
        ok(seg.includes('dbManager.getClient()') && seg.includes(".from('executors')"),
            'executors 查询走 dbManager.getClient()（service key）');
        // 8b. select 列集显式（不 select *——最小权限）
        ok(seg.includes(".select('name, address, auth_token, blockchain, reserve_native')"),
            'executor 查询列集显式');
        // 8c. 双平台 live 兜底防线已废（2026-10-14 改造：per-platform trader map 支持 both，
        // 详见 _test_live_dual_platform.cjs）；钱包双源互斥防线仍在
        ok(!seg.includes('双平台实验不支持 live'), '双平台 live 兜底 throw 已移除（防线废除）');
        ok(seg.indexOf('互斥') > 0 && seg.indexOf('互斥') < seg.indexOf('traderFactory'),
            'executorId × privateKey 互斥 throw 仍在钱包解析段');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
