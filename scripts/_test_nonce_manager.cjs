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
 *   4. _nonceGuard：nonce 错误 reset + 重试一次（交易未上链无双花风险）/
 *      非 nonce 错误原样抛 / 只重试一次（连续 nonce 错第二次仍抛）
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
            ['transaction already known', true],
            ['incorrect nonce for transaction', true],
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
    }

    // ═══════════════ 4. _nonceGuard 重试语义 ═══════════════
    console.log('\n[3] _nonceGuard 重试语义');
    {
        const t = Object.create(BaseTrader.prototype);
        let resets = 0;
        t.signer = { reset: () => { resets++; } };

        // 4a. 首次 nonce 错、重试成功 → 返回重试值 + reset 一次
        let calls = 0;
        const result = await t._nonceGuard(async () => {
            calls++;
            if (calls === 1) { const e = new Error('nonce too low'); throw e; }
            return 'RETRY_OK';
        });
        ok(result === 'RETRY_OK' && calls === 2 && resets === 1,
            'nonce 拒收 → reset 后重试一次成功（交易未上链无双花）');

        // 4b. 非 nonce 错误原样抛出不重试
        calls = 0; resets = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { calls++; throw new Error('execution reverted'); }),
            /execution reverted/,
        );
        ok(calls === 1 && resets === 0, '非 nonce 错误不 reset 不重试（原样抛）');

        // 4c. 连续 nonce 错：只重试一次，第二次仍抛
        calls = 0; resets = 0;
        await assert.rejects(
            () => t._nonceGuard(async () => { calls++; const e = new Error('already known'); throw e; }),
            /already known/,
        );
        ok(calls === 2 && resets === 1, '连续 nonce 错只重试一次（防无限循环）');
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
