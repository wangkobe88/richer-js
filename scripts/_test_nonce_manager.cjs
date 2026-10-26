#!/usr/bin/env node
/**
 * NonceManager 包装（B2 实盘加固）零网络单测
 *
 * 覆盖 BaseTrader.setWallet 签名链与 nonce 守卫：
 *   1. setWallet 后 signer 是 NonceManager 实例（发送串行取 pending nonce，
 *      根治跨 token 并发买 nonce 竞争）
 *   2. this.wallet 保持 raw Wallet（引擎多处同步读 trader.wallet.address——
 *      NonceManager.getAddress 是 async 不能顶替，这是刻意的双字段设计）
 *   3. _isNonceError 短语表：nonce 类拒收识别 / 'gas price too low' 不误伤
 *      （裸 'too low' 匹配的事故反证）
 *   4. _nonceGuard：nonce 错误取证语义（T2）——payload raw 链上未上链 → reset +
 *      重试一次；首发已在链上 → 恢复追踪不重发（双卖事故反证）；无 payload raw →
 *      fail-closed 原样抛 / 非 nonce 错误原样抛 / 只重试一次
 *   5. 源码口径：发送调用点全部经 _nonceGuard
 *
 * 打桩：真 Wallet + 真 NonceManager（零网络——不发交易），_nonceGuard 的 fn 桩。
 *
 * 运行：node scripts/_test_nonce_manager.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const BaseTrader = require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}

async function main() {
    // ═══════════════ 1+2. setWallet 签名链 ═══════════════
    console.log('\n[1] setWallet：NonceManager 包装 + raw Wallet 保留');
    {
        const t = Object.create(BaseTrader.prototype);
        t.provider = new ethers.JsonRpcProvider('http://localhost:1'); // 构造不发请求
        t.gasStrategy = 'dynamic';
        t.tradingConfig = { maxGasPrice: 10 };
        t.wallet = null; t.signer = null;

        const pk = ethers.Wallet.createRandom().privateKey;
        // 复刻 setWallet 核心段（真方法依赖 config 初始化——此处按源码同款包装）
        t.wallet = new ethers.Wallet(pk, t.provider);
        t.signer = new ethers.NonceManager(t.wallet);

        ok(t.signer instanceof ethers.NonceManager, 'signer 是 NonceManager 实例（发送走 signer 串行 nonce）');
        ok(t.wallet instanceof ethers.Wallet, 'wallet 保持 raw Wallet');
        ok(typeof t.wallet.address === 'string' && t.wallet.address.startsWith('0x'),
            'wallet.address 同步可读（引擎地址校验/余额对账依赖）');
        // NonceManager 包装同一 underlying（派生地址一致）
        const viaSigner = await t.signer.getAddress();
        ok(viaSigner.toLowerCase() === t.wallet.address.toLowerCase(),
            'signer 与 wallet 派生地址一致（同一密钥）');

        // 源码口径：setWallet 内的确切包装形状（防线锁定——防未来直接 signer=wallet 回退）
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader.js'), 'utf8');
        ok(src.includes('this.signer = new ethers.NonceManager(this.wallet);'),
            '源码：setWallet 内 signer = new NonceManager(wallet)');
        ok(src.includes('this.wallet 保持 raw Wallet 不变') || src.includes('NonceManager 包装'),
            '源码：双字段设计注释在位（wallet=raw / signer=包装）');
    }

    // ═══════════════ 3. _isNonceError 短语表 ═══════════════
    console.log('\n[2] _isNonceError 短语表');
    {
        const t = Object.create(BaseTrader.prototype);
        const cases = [
            ['nonce too low', true],
            ['nonce has already been used', true],
            ['replacement transaction underpriced', true],
            ['incorrect nonce for transaction', true],
            // already known ≠ 拒收（raw 已在 mempool）——走 _recoverTxFromAlreadyKnown
            // 恢复分支，绝不 reset 重签重发（2026-10-25 v36 幽灵卖出事故语义变更）
            ['transaction already known', false],
            // 反证：非 nonce 语义绝不匹配（'gas price too low' 若用裸 'too low' 会误伤）
            ['gas price too low', false],
            ['insufficient funds for gas', false],
            ['execution reverted:TRANSFER_FAILED', false],
            ['', false],
            [null, false],
        ];
        for (const [msg, expect] of cases) {
            const got = t._isNonceError(msg instanceof Error ? msg : (msg && new Error(msg)) || msg);
            ok(got === expect, `「${msg || '(空)'}」→ ${expect}`);
        }
        ok(t._isAlreadyKnownError(new Error('could not coalesce error (already known)')) === true,
            '_isAlreadyKnownError：嵌入 message 也能识别');
    }

    // ═══════════════ 4. _nonceGuard 取证重试语义（T2） ═══════════════
    console.log('\n[3] _nonceGuard 取证重试语义');
    {
        // 真 raw（本地签名构造，合法 legacy tx，可 Transaction.from 解析算 hash——零网络）
        const rawWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        const raw = await rawWallet.signTransaction({
            to: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', nonce: 1735,
            gasLimit: 624952, gasPrice: ethers.parseUnits('50', 'mwei'),
            data: '0xef7ec2e7', chainId: 56, type: 0,
        });
        const nonceErr = () => {
            // T2 事故现场形状（v37 2026-10-25 日志实证）：首发 nonce 1735 已上链成交，
            // HTTP 响应丢失后请求层重发同 raw，节点报 NONCE_EXPIRED
            const e = new Error('nonce has already been used (info={ "error": { "code": -32000, "message": "nonce too low: next nonce 1736, tx nonce 1735" } }, code=NONCE_EXPIRED)');
            e.info = { payload: { params: [raw] } };
            return e;
        };
        const t = Object.create(BaseTrader.prototype);
        t.log = () => {};
        let resets = 0;
        t.signer = { reset: () => { resets++; } };
        // 链上查无首发（真拒收形状：节点不索引被拒 raw）
        t.provider = { getTransaction: async () => null };

        // 4a. 首发确认未上链 → reset + 重试一次成功
        let calls = 0;
        const result = await t._nonceGuard(async () => {
            calls++;
            if (calls === 1) throw nonceErr();
            return 'RETRY_OK';
        });
        ok(result === 'RETRY_OK' && calls === 2 && resets === 1,
            'nonce 拒收（取证未上链）→ reset 后重试一次成功');

        // 4b. 非 nonce 错误原样抛出不重试
        calls = 0; resets = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { calls++; throw new Error('execution reverted'); }),
            /execution reverted/,
        );
        ok(calls === 1 && resets === 0, '非 nonce 错误不 reset 不重试（原样抛）');

        // 4c. 连续 nonce 错（取证均未上链）：只重试一次，第二次仍抛
        calls = 0; resets = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { calls++; throw nonceErr(); }),
            /nonce has already been used/,
        );
        ok(calls === 2 && resets === 1, '连续 nonce 错只重试一次（防无限循环）');
    }

    // ═══════════════ 4b. T2 双卖事故现场反证（2026-10-25 K线人生 0xfeff…7777） ═══════════════
    console.log('\n[3c] nonce 错误取证：首发已在链上 → 恢复追踪不重发（T2 双卖反证）');
    {
        const rawWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        const raw = await rawWallet.signTransaction({
            to: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', nonce: 1735,
            gasLimit: 624952, gasPrice: ethers.parseUnits('50', 'mwei'),
            data: '0xef7ec2e7', chainId: 56, type: 0,
        });
        const ghostSellErr = () => {
            const e = new Error('nonce has already been used (info={ "error": { "code": -32000, "message": "nonce too low: next nonce 1736, tx nonce 1735" } }, code=NONCE_EXPIRED)');
            e.info = { payload: { params: [raw] } };
            return e;
        };
        const expectedHash = ethers.Transaction.from(raw).hash;
        const t = Object.create(BaseTrader.prototype);
        t.log = () => {};
        let resets = 0, getCalls = 0;
        t.signer = { reset: () => { resets++; } };
        // 事故形状：首发（nonce 1735）已上链成交——getTransaction 立即命中
        t.provider = { getTransaction: async (h) => { getCalls++; return { hash: h, conf: 1 }; } };

        // a. 核心反证：fn 只调一次（不重发 nonce+1 第二笔）、不 reset、返回首发 tx
        let fnCalls = 0;
        const tx = await t._nonceGuard(async () => { fnCalls++; throw ghostSellErr(); }, '卖出');
        ok(tx.hash === expectedHash && fnCalls === 1 && resets === 0 && getCalls === 1,
            '首发已上链 → 恢复首发 tx 追踪（不 reset/不重发/不双卖）');

        // b. 事故数字反证：next nonce 1736 > tx nonce 1735 形状判定归恢复分支而非重试
        //    （源码口径：重试分支日志必须先过取证）
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader.js'), 'utf8');
        ok(src.includes('_probeNonceErrorTx'), '源码：nonce 错误取证分支在位');
        ok(/nonce 冲突拒收（首发确认未上链/.test(src), '源码：重试臂日志标注「首发确认未上链」（取证前置锁定）');

        // c. nonce 错误无 payload raw：无法证明首发未上链 → fail-closed 原样抛
        const bare = new Error('nonce too low: next nonce 1736, tx nonce 1735');
        let bareCalls = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { bareCalls++; throw bare; }, '卖出'),
            /nonce too low/,
        );
        ok(bareCalls === 1 && resets === 0, '无 payload raw → fail-closed 不重试（无法排除首发已上链）');
    }

    // ═══════════════ 3d. NONCE_EXPIRED error.transaction 取证源（2026-10-26 邪恶千问 0xb05b…7777 幽灵卡案） ═══════════════
    console.log('\n[3d] NONCE_EXPIRED 携带 error.transaction（broadcastTransaction 索引滞后形状）');
    {
        const rawWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        const raw = await rawWallet.signTransaction({
            to: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', nonce: 1777,
            gasLimit: 1081854, gasPrice: ethers.parseUnits('2', 'gwei'),
            data: '0xef7ec2e7', chainId: 56, type: 0,
        });
        // 千问事故现场形状（v38 2026-10-25 日志实证）：首发 nonce 1777 已上链成交
        // （tx 0xc01d…a01，block 129737025），节点 getTransaction 索引滞后 → ethers
        // broadcastTransaction 轮询超时后查 nonce 已消费 → 抛 NONCE_EXPIRED 且
        // transaction 字段携带首发 raw，info 里只有 error（无 payload.params）——
        // 旧取证只认 info.payload → undefined → fail-closed 误判失败 → 幽灵卡
        const ghostErr = () => {
            const e = new Error('nonce has already been used (info={ "error": { "code": -32000, "message": "nonce too low: next nonce 1778, tx nonce 1777" } }, code=NONCE_EXPIRED, version=6.16.0)');
            e.transaction = raw;
            return e;
        };
        const expectedHash = ethers.Transaction.from(raw).hash;
        let t = Object.create(BaseTrader.prototype);
        t.log = () => {};
        let resets = 0, getCalls = 0, fnCalls = 0;
        t.signer = { reset: () => { resets++; } };
        t.provider = { getTransaction: async (h) => { getCalls++; return { hash: h, conf: 1 }; } };

        // a. 核心反证：error.transaction 携带 raw → 恢复首发追踪不重发不误判失败
        //    （事故形状：旧行为取证 undefined → fail-closed 判失败 → 账面幽灵卡+熔断循环）
        const tx = await t._nonceGuard(async () => { fnCalls++; throw ghostErr(); }, '卖出');
        ok(tx.hash === expectedHash && fnCalls === 1 && resets === 0,
            'transaction 字段携带 raw → 恢复首发追踪（不 reset/不重发/不误判失败）');

        // b. TransactionResponse 形状（transaction.serialized 携带 raw）同取证恢复
        fnCalls = 0; resets = 0; getCalls = 0;
        const respErr = () => {
            const e = new Error('nonce has already been used (code=NONCE_EXPIRED)');
            e.transaction = { serialized: raw, hash: expectedHash };
            return e;
        };
        const tx2 = await t._nonceGuard(async () => { fnCalls++; throw respErr(); }, '卖出');
        ok(tx2.hash === expectedHash && fnCalls === 1 && resets === 0 && getCalls === 1,
            'transaction.serialized（Response 形状）→ 同样恢复首发追踪');

        // c. 双取证源都缺 → 仍 fail-closed 原样抛（保守语义不变）
        const bare = new Error('nonce too low: next nonce 1778, tx nonce 1777');
        let bareCalls = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { bareCalls++; throw bare; }, '卖出'),
            /nonce too low/,
        );
        ok(bareCalls === 1 && resets === 0, '两取证源全缺 → fail-closed 不重试（语义不变）');

        // d. 源码口径：_errorRawTx 双源提取在位（防取证源回退只剩 payload 臂）
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader.js'), 'utf8');
        ok(src.includes('_errorRawTx(error)'), '源码：_errorRawTx 共用取证在位');
        ok(/_probeNonceErrorTx\(error, label = '交易'\) \{\s*\n\s*const raw = this\._errorRawTx\(error\);/.test(src),
            '源码：nonce 取证走 _errorRawTx（payload 臂之外补 transaction 臂）');
    }

    // ═══════════════ 4b. already known 恢复语义（2026-10-25 v36 幽灵卖出事故） ═══════════════
    console.log('\n[3b] already known 恢复（不 reset 不重发，恢复 raw→hash 追踪回执）');
    {
        // 真 raw（本地签名构造，合法 legacy tx，可 Transaction.from 解析算 hash——零网络）
        const rawWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        const raw = await rawWallet.signTransaction({
            to: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', nonce: 1705,
            gasLimit: 1015534, gasPrice: ethers.parseUnits('50', 'gwei'),
            data: '0xef7ec2e7', chainId: 56, type: 0,
        });
        const mkErr = () => {
            const e = new Error('could not coalesce error (error={ "code": -32000, "message": "already known" }, payload={ "method": "eth_sendRawTransaction" })');
            e.info = { payload: { params: [raw] } }; // ethers v6 JsonRpcError 形状（事故日志实证）
            return e;
        };
        const expectedHash = ethers.Transaction.from(raw).hash;
        const t = Object.create(BaseTrader.prototype);
        t.log = () => {};
        let resets = 0, getCalls = 0;
        t.signer = { reset: () => { resets++; } };
        t.provider = { getTransaction: async (h) => { getCalls++; return { hash: h, conf: 1 }; } };

        // a. 恢复成功：fn 只调一次（不重发）、不 reset、返回该 raw 的 tx response
        let fnCalls = 0;
        const tx = await t._nonceGuard(async () => { fnCalls++; throw mkErr(); }, '卖出');
        ok(tx.hash === expectedHash && fnCalls === 1 && resets === 0 && getCalls === 1,
            'already known → 从 payload raw 恢复 tx response（不 reset/不重发/不双卖）');

        // b. 节点暂未索引：轮询直到拿到（首两轮 null）
        getCalls = 0; fnCalls = 0;
        t.provider = { getTransaction: async (h) => { getCalls++; return getCalls >= 3 ? { hash: h } : null; } };
        const tx2 = await t._nonceGuard(async () => { fnCalls++; throw mkErr(); }, '卖出');
        ok(tx2.hash === expectedHash && getCalls === 3, 'already known → 节点滞后轮询重取（第 3 轮命中）');

        // c. 无 payload raw：原样抛（保守判失败，绝不臆造重发）
        const bare = new Error('already known');
        await assert.rejects(() => t._nonceGuard(async () => { throw bare; }, '卖出'), /already known/);
        ok(true, 'already known 无 payload → 原样抛');

        // d. 源码口径：_isNonceError 正则不再含 already known（防语义回退混入 reset 重试）
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader.js'), 'utf8');
        const re = src.match(/_isNonceError\(error\) \{[\s\S]*?return ([^;]+);/);
        ok(re && !/already known/.test(re[1]), '源码：_isNonceError 正则不含 already known');
        ok(src.includes('_recoverTxFromAlreadyKnown'), '源码：already known 恢复分支在位');
    }

    // ═══════════════ 5. 源码口径：发送调用点接线 ═══════════════
    console.log('\n[4] 源码口径（发送路径经 _nonceGuard）');
    {
        const fourmeme = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader.js'), 'utf8');
        const flap = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader.js'), 'utf8');
        const guardCountFm = (fourmeme.match(/this\._nonceGuard\(/g) || []).length;
        const guardCountFlap = (flap.match(/this\._nonceGuard\(/g) || []).length;
        ok(guardCountFm >= 4, `FourMemeDirectTrader 发送点全接 _nonceGuard（${guardCountFm} 处：AMAP/兜底买/approve/4参卖/7参卖）`);
        ok(guardCountFlap >= 2, `FlapPortalTrader 发送点全接 _nonceGuard（${guardCountFlap} 处：swap/approve）`);

        // PancakeSwapV2：删 _executeWithRetry 后的发送点（手工交易毕业票路由）
        // （剥注释——源码注释保留了「禁自动重试（P0-C）」的历史说明）
        const pcs = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/PancakeSwapV2Trader.js'), 'utf8')
            .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        ok(!pcs.includes('_executeWithRetry'), 'PCS：_executeWithRetry 双发防线已删（绝不重发）');
        const guardCountPcs = (pcs.match(/this\._nonceGuard\(/g) || []).length;
        ok(guardCountPcs >= 2, `PancakeSwapV2Trader 发送点全接 _nonceGuard（${guardCountPcs} 处）`);
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
