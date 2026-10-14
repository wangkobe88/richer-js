#!/usr/bin/env node
/**
 * 双平台 live（both）零 DB 零网络单测（2026-10-14 用户裁定改造：实盘必须支持多平台）
 *
 * 改造语义：单引擎 per-platform trader map——fourmeme→FourMemeDirectTrader /
 * flap→FlapPortalTrader，同一钱包；首个 trader 建钱包，其余 setWallet 校验后
 * shareSignerFrom 共享 wallet+NonceManager（同地址进程内单一 nonce 分配源）。
 * 三重防线（web 400 / main throw / 引擎兜底 throw）全部废除。
 *
 * 1. 双平台构造：两 trader 按平台分派类型 + 第二 trader 共享首 trader 的 wallet/signer
 *    + this._trader=首个（平台无关读点兼容）+ _liveTraderMap 键位正确
 * 2. 单平台回归：flap-only / fourmeme-only 各建 1 trader，无 shareSignerFrom 调用
 * 3. _liveTraderFor 分派：单平台恒返 _trader；双平台按 token 平台查 map；
 *    平台未知 fail-closed throw（真实资金绝不跨协议盲发）
 * 4. _platformForToken：token 池 record.platform 优先 → FA state.platform 兜底 → null
 * 5. BaseTrader.shareSignerFrom：源未初始化 throw；共享后 wallet/signer 引用相等（===）
 * 6. FlapPortalTrader.shareSignerFrom：portalContract 重绑共享 signer（prepare 重建——
 *    覆盖后发单仍走旧 NonceManager 的事故防线）
 * 7. _restoreLiveTokens platform 恢复（우땅이 卖出分派错案 2026-10-14）：恢复持仓平台
 *    归属取 DB 真值（experiment_tokens.platform）——修复前恒 _wsPlatforms()[0]，双平台
 *    实验把 flap 票冒充 fourmeme → 卖出分派 FourMemeDirectTrader → four.meme 合约
 *    revert「代币由不同的 TokenManager 管理」。DB 缺列：单平台回退唯一平台，双平台
 *    null 不冒充（分派层 fail-closed）
 * 8. 源码口径：三重防线零残留；买/卖点走 _liveTraderFor 分派；构造循环含
 *    _liveTraderTypeFor；恢复 platform 形状锁
 *
 * 打桩：dbManager 单例 + traders 工厂（require.cache 桩，真 ethers.Wallet 私钥派生
 * 地址走真地址校验）+ CryptoUtils 真加解密。_fetchBnbUsdOnce 走 provider.call 桩。
 *
 * 运行：node scripts/_test_live_dual_platform.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');

for (const k of ['ANKR_HTTP_RPC_URL', 'ANKR_API_KEY', 'ANKR_WS_URL']) delete process.env[k];

// ═══════════════ dbManager 单例打桩（引擎 require 前）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

class MockQuery {
    constructor(db, table) { this.db = db; this.table = table; this._eqs = {}; this._ins = {}; this._single = false; }
    select(cols) { this._cols = cols; return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    in(col, arr) { this._ins[col] = arr; return this; }
    single() { this._single = true; return this; }
    then(resolve) {
        const rows = (this.db.tables[this.table] || []).filter(r =>
            Object.entries(this._eqs).every(([c, v]) => r[c] === v)
            && Object.entries(this._ins).every(([c, arr]) => arr.includes(r[c])));
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

// ═══════════════ traders 工厂打桩（带 shareSignerFrom 记录）═══════════════
const created = [];
const shareCalls = [];
const TRADERS_PATH = require.resolve(path.join(ROOT, 'src/trading-engine/traders'));
require.cache[TRADERS_PATH] = {
    id: TRADERS_PATH, filename: TRADERS_PATH, loaded: true,
    exports: {
        createTrader: (type, config) => {
            const t = {
                _type: type, _config: config, wallet: null, signer: null, provider: null, txWaitTimeoutMs: null,
                async setWallet(pk) {
                    this.wallet = new ethers.Wallet(pk);
                    this.signer = { _nonceManagerFor: this._type }; // 占位（引擎不读内部）
                    // _fetchBnbUsdOnce 走 provider.call 桩（getAmountsOut 编码；零网络）
                    const p = new ethers.JsonRpcProvider('http://localhost:1');
                    const coder = ethers.AbiCoder.defaultAbiCoder();
                    p.call = async () => coder.encode(['uint256[]'], [[ethers.parseEther('1'), ethers.parseUnits('600', 18)]]);
                    this.provider = p;
                },
                async getNativeBalance() { return '1.234'; },
                async shareSignerFrom(other) {
                    shareCalls.push({ from: this._type, to: other._type });
                    if (!other.wallet || !other.signer) throw new Error('shareSignerFrom: 源 trader 未初始化钱包');
                    this.wallet = other.wallet;
                    this.signer = other.signer;
                },
            };
            created.push(t);
            return t;
        },
    },
};

const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const { FlapWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FlapWssTradingEngine'));
const { CryptoUtils } = require(path.join(ROOT, 'src/utils/CryptoUtils'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function mkEngine(EngineCls, { wallet, platform } = {}) {
    const engine = new EngineCls({ tradingMode: 'live', initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experiment = { config: { wallet, ...(platform ? { platform } : {}) } };
    engine._applyWsConfig({});
    return engine;
}

function mkExecutorRow(overrides = {}) {
    const w = ethers.Wallet.createRandom();
    return {
        id: 'exec-1', name: 'BSC新币交易', address: w.address,
        auth_token: new CryptoUtils().encrypt(w.privateKey),
        blockchain: 'bsc', reserve_native: 0.01,
        _privateKey: w.privateKey,
        ...overrides,
    };
}

async function main() {
    db.tables.executors = [mkExecutorRow()];

    // ═══════════════ 1. 双平台构造 ═══════════════
    console.log('\n[1] 双平台（both）构造');
    {
        created.length = 0; shareCalls.length = 0;
        const engine = mkEngine(FourMemeWssTradingEngine, { wallet: { executorId: 'exec-1' }, platform: 'both' });
        await engine._initializeLiveTrader();

        ok(created.length === 2, `两 trader 按平台创建（实际 ${created.length}）`);
        ok(created[0]._type === 'fourmeme' && created[1]._type === 'flap',
            `类型分派 fourmeme→FourMemeDirectTrader / flap→FlapPortalTrader（实际 ${created.map(t => t._type).join(',')}）`);
        ok(shareCalls.length === 1 && shareCalls[0].from === 'flap' && shareCalls[0].to === 'fourmeme',
            '第二 trader（flap）shareSignerFrom 首 trader（fourmeme）恰一次');
        ok(engine._trader === created[0], 'this._trader = 首个 trader（平台无关读点兼容）');
        ok(engine._liveTraderMap.get('fourmeme') === created[0] && engine._liveTraderMap.get('flap') === created[1],
            '_liveTraderMap 键位：fourmeme/flap 各归位');
        // nonce 单一分配源（共享后引用相等）
        ok(created[1].signer === created[0].signer && created[1].wallet === created[0].wallet,
            'flap trader wallet/signer === fourmeme trader（同地址单一 nonce 分配源）');
        // 两 trader txWaitTimeoutMs 均透传
        ok(created[0].txWaitTimeoutMs === engine._liveTxWaitTimeoutMs && created[1].txWaitTimeoutMs === engine._liveTxWaitTimeoutMs,
            '两 trader txWaitTimeoutMs 均透传');
    }

    // ═══════════════ 2. 单平台回归（零行为变化）═══════════════
    console.log('\n[2] 单平台回归');
    {
        // 2a. flap-only（FlapWssTradingEngine）
        created.length = 0; shareCalls.length = 0;
        const flapEngine = mkEngine(FlapWssTradingEngine, { wallet: { executorId: 'exec-1' } });
        await flapEngine._initializeLiveTrader();
        ok(created.length === 1 && created[0]._type === 'flap', 'flap-only：单 trader 类型 flap');
        ok(shareCalls.length === 0, 'flap-only：无 shareSignerFrom 调用');
        ok(flapEngine._liveTraderFor('0xany') === flapEngine._trader, 'flap-only：_liveTraderFor 恒返唯一 trader');

        // 2b. fourmeme-only（基类默认平台）
        created.length = 0; shareCalls.length = 0;
        const fmEngine = mkEngine(FourMemeWssTradingEngine, { wallet: { executorId: 'exec-1' } });
        await fmEngine._initializeLiveTrader();
        ok(created.length === 1 && created[0]._type === 'fourmeme', 'fourmeme-only：单 trader 类型 fourmeme');
        ok(shareCalls.length === 0, 'fourmeme-only：无 shareSignerFrom 调用');
    }

    // ═══════════════ 3. _liveTraderFor 分派（双平台）═══════════════
    console.log('\n[3] _liveTraderFor 分派');
    {
        created.length = 0; shareCalls.length = 0;
        const engine = mkEngine(FourMemeWssTradingEngine, { wallet: { executorId: 'exec-1' }, platform: 'both' });
        await engine._initializeLiveTrader();
        const fmTrader = created[0], flapTrader = created[1];

        // 打桩平台归属源：token 池 record（优先）+ FA state（兜底）
        engine._tokenPool = { getToken: (addr) => addr === '0xFLAP' ? { platform: 'flap' } : addr === '0xFOUR' ? { platform: 'fourmeme' } : null };
        engine._factorAggregator = { getTokenState: (addr) => addr === '0xFAONLY' ? { platform: 'flap' } : null };

        ok(engine._liveTraderFor('0xFLAP') === flapTrader, 'flap token → FlapPortalTrader');
        ok(engine._liveTraderFor('0xFOUR') === fmTrader, 'fourmeme token → FourMemeDirectTrader');
        ok(engine._liveTraderFor('0xFAONLY') === flapTrader, 'token 池无记录 → FA state 平台兜底（flap）');
        assert.throws(() => engine._liveTraderFor('0xUNKNOWN'), /分派失败/);
        ok(true, '平台未知 → throw fail-closed（拒绝跨协议盲发）');

        // 3b. _platformForToken 直接验证
        ok(engine._platformForToken('0xFLAP') === 'flap' && engine._platformForToken('0xFOUR') === 'fourmeme',
            '_platformForToken：token 池 record.platform 优先');
        ok(engine._platformForToken('0xFAONLY') === 'flap', '_platformForToken：FA state.platform 兜底');
        ok(engine._platformForToken('0xUNKNOWN') === null, '_platformForToken：均无 → null');
    }

    // ═══════════════ 4. BaseTrader.shareSignerFrom 单元 ═══════════════
    console.log('\n[4] BaseTrader.shareSignerFrom');
    {
        const BaseTrader = require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader'));
        const a = Object.create(BaseTrader.prototype);
        const b = Object.create(BaseTrader.prototype);
        // 4a. 源未初始化 → throw
        assert.throws(() => b.shareSignerFrom(a), /未初始化钱包/);
        ok(true, '源 trader 未初始化 → throw');
        // 4b. 正常共享：wallet/signer 引用相等（nonce 单一分配源的机器证明）
        a.wallet = { address: '0xA' };
        a.signer = { _isNonceManager: true };
        b.shareSignerFrom(a);
        ok(b.wallet === a.wallet && b.signer === a.signer, '共享后 wallet/signer 引用相等（===）');
    }

    // ═══════════════ 5. FlapPortalTrader.shareSignerFrom（portalContract 重绑）═══════════════
    console.log('\n[5] FlapPortalTrader.shareSignerFrom');
    {
        const FlapPortalTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader'));
        const primary = Object.create(require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader')).prototype);
        const w = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        primary.wallet = w;
        primary.signer = new ethers.NonceManager(w); // 真 NonceManager（共享对象语义）

        const flap = new FlapPortalTrader({}); // constructor 不发网络
        flap.provider = { getCode: async () => '0xdeadbeef' }; // prepare 连通性探测桩
        flap.wallet = w; flap.signer = { stale: true }; // 占位（待共享覆盖）

        await flap.shareSignerFrom(primary);
        ok(flap.signer === primary.signer && flap.wallet === primary.wallet,
            '共享覆盖：wallet/signer === 源 trader 实例');
        ok(flap.portalContract && flap.portalContract.runner === primary.signer,
            'portalContract 重绑共享 signer（prepare 重建——发单不再走旧 NonceManager）');
    }

    // ═══════════════ 6. _restoreLiveTokens 平台恢复（우땅이 卖出分派错案）═══════════════
    console.log('\n[6] _restoreLiveTokens platform 恢复');
    {
        const TOKEN = '0x14ea81254dd8f14774f71a7278a91156f2027777';
        const mkRestoreEngine = (EngineCls, platform) => {
            const engine = mkEngine(EngineCls, { wallet: { executorId: 'exec-1' }, ...(platform ? { platform } : {}) });
            const calls = { register: [], addToken: [], markAsBought: 0 };
            engine._factorAggregator = { registerToken: (addr, meta) => calls.register.push({ addr, meta }) };
            engine._tokenPool = {
                addToken: (rec) => calls.addToken.push(rec),
                markAsBought: () => { calls.markAsBought++; },
            };
            return { engine, calls };
        };

        // 6a. 双平台 + DB platform='flap' → addToken/registerToken 均 flap（修复核心）
        db.tables.experiment_tokens = [{
            token_address: TOKEN, token_symbol: '우땅이', experiment_id: null, platform: 'flap',
            created_at: '2026-10-14T03:32:00Z', creator_address: null, raw_api_data: {},
        }];
        const { engine: both, calls: bothCalls } = mkRestoreEngine(FourMemeWssTradingEngine, 'both');
        await both._restoreLiveTokens([{ tokenAddress: TOKEN, avgPriceUsd: 0.01, lastBuy: null }]);
        ok(bothCalls.addToken[0]?.platform === 'flap',
            `双平台：DB platform='flap' → addToken platform='flap'（修复前恒 'fourmeme' 冒充；实际 ${bothCalls.addToken[0]?.platform}）`);
        ok(bothCalls.register[0]?.meta?.platform === 'flap',
            'registerToken meta.platform 透传（FA state.platform 兜底源）');

        // 7b. 双平台 + DB 无 platform → null 不冒充（卖侧分派 fail-closed throw，绝不发错协议）
        db.tables.experiment_tokens = [{ token_address: TOKEN, token_symbol: 'X', experiment_id: null, created_at: null, raw_api_data: {} }];
        const { engine: noPlat, calls: noPlatCalls } = mkRestoreEngine(FourMemeWssTradingEngine, 'both');
        await noPlat._restoreLiveTokens([{ tokenAddress: TOKEN, avgPriceUsd: 0.01, lastBuy: null }]);
        ok(noPlatCalls.addToken[0]?.platform === null,
            `双平台：DB 缺 platform → null 不冒充（实际 ${noPlatCalls.addToken[0]?.platform}）`);
        ok(noPlatCalls.register[0]?.meta?.platform === undefined,
            'DB 缺 platform → registerToken 不传 platform 键（FA write-once 语义零污染）');

        // 7c. 单平台 + DB 无 platform → 回退唯一平台（=语义无损）
        const { engine: single, calls: singleCalls } = mkRestoreEngine(FlapWssTradingEngine, null);
        await single._restoreLiveTokens([{ tokenAddress: TOKEN, avgPriceUsd: 0.01, lastBuy: null }]);
        ok(singleCalls.addToken[0]?.platform === 'flap',
            `flap-only：DB 缺 platform → 回退唯一平台 'flap'（实际 ${singleCalls.addToken[0]?.platform}）`);

        // 7d. 恢复后的分派闭环：addToken record.platform='flap' → _liveTraderFor → FlapPortalTrader
        created.length = 0; shareCalls.length = 0;
        const engine = mkEngine(FourMemeWssTradingEngine, { wallet: { executorId: 'exec-1' }, platform: 'both' });
        await engine._initializeLiveTrader();
        const fmTrader = created[0], flapTrader = created[1];
        engine._tokenPool = { getToken: () => ({ platform: 'flap' }) };
        engine._factorAggregator = { getTokenState: () => null };
        ok(engine._liveTraderFor(TOKEN) === flapTrader && engine._liveTraderFor(TOKEN) !== fmTrader,
            '事故现场反证：恢复 record platform=flap → 卖出分派 FlapPortalTrader（修复前会分派 FourMemeDirectTrader）');

        delete db.tables.experiment_tokens;
    }

    // ═══════════════ 7. 源码口径（防线放开 + 分派接线）═══════════════
    console.log('\n[7] 源码口径');
    {
        const engineSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
        const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
        const webSrc = fs.readFileSync(path.join(ROOT, 'src/web-server.js'), 'utf8');
        const htmlSrc = fs.readFileSync(path.join(ROOT, 'src/web/templates/create_experiment.html'), 'utf8');

        // 7a. 三重防线 + 前端拦截零残留
        const guardNeedle = '双平台实验不支持 live';
        ok(!engineSrc.includes(guardNeedle) && !mainSrc.includes(guardNeedle)
            && !webSrc.includes(guardNeedle) && !htmlSrc.includes(guardNeedle),
            '「双平台实验不支持 live」防线四文件零残留');
        ok(!/bothSelected|双平台 live 禁止/.test(htmlSrc), '前端平台勾选 live 限制逻辑零残留');

        // 7b. 构造循环：per-platform 分派 + 共享
        const initSeg = engineSrc.slice(engineSrc.indexOf('async _initializeLiveTrader'), engineSrc.indexOf('_notifyLiveAlert'));
        ok(initSeg.includes('for (const platform of this._wsPlatforms())') && initSeg.includes('this._liveTraderTypeFor(platform)'),
            '_initializeLiveTrader 按平台循环建 trader（_liveTraderTypeFor 分派）');
        ok(initSeg.includes('await trader.shareSignerFrom(this._trader)'),
            '非首 trader shareSignerFrom 首 trader（nonce 单一分配源）');

        // 7c. 买/卖点分派接线
        ok(/this\._liveTraderFor\(signal\.tokenAddress\)\.buyToken/.test(engineSrc),
            '_executeBuyLive 买点走 _liveTraderFor 分派');
        ok(/\(traderOverride \|\| this\._liveTraderFor\(signal\.tokenAddress\)\)\.sellToken/.test(engineSrc),
            '_executeSellLive 卖点走（traderOverride || _liveTraderFor）分派（毕业票 PCS 覆盖优先）');

        // 7d. 分派 fail-closed 源码形状
        ok(/_liveTraderFor\(tokenAddress\)[\s\S]{0,600}拒绝跨协议盲发/.test(engineSrc),
            '_liveTraderFor 未知平台 throw fail-closed');

        // 7e. FlapPortalTrader 覆写源码口径
        const flapSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader.js'), 'utf8');
        ok(/shareSignerFrom\(other\)[\s\S]{0,300}super\.shareSignerFrom\(other\);\s*await this\.prepare\(\);/.test(flapSrc),
            'FlapPortalTrader.shareSignerFrom：super 共享后重跑 prepare（portalContract 重绑）');

        // 7f. 恢复路径 platform 源码锁（우땅이 案防线）：select 含 platform 列 +
        //     restorePlatform 单平台回退形状（恒 [0] 冒充写法零回归）
        ok(/experiment_tokens'\)[\s\S]{0,120}select\('[^']*platform[^']*'\)/.test(engineSrc),
            "_restoreLiveTokens select 列含 platform（DB 真值进恢复链）");
        ok(/const restorePlatform = meta\.platform\s*\|\|\s*\(this\._wsPlatforms\(\)\.length === 1 \? this\._wsPlatforms\(\)\[0\] : null\);/.test(engineSrc),
            'restorePlatform 形状：DB 真值优先，仅单平台实验回退 [0]，双平台缺列 null 不冒充');
        ok(!/platform: this\._wsPlatforms\(\)\[0\],/.test(engineSrc),
            '恒 [0] 冒充写法零残留（事故现场反证）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
