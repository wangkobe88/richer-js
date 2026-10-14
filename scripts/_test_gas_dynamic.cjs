#!/usr/bin/env node
/**
 * 动态 gas 策略（B4 实盘加固）零网络单测
 *
 * 覆盖 BaseTrader._resolveGasPrice / _resolveGasLimit / gasStrategy 读取链：
 *   1. gasPrice 动态分支：链上价 ≤ max 用链上价 / 超 max 钳 max / getFeeData
 *      失败回落 max（=旧行为）/ 链上价异常低（<0.01 gwei）回落 max；现实低价
 *      （0.5 gwei，BSC 2026-10 常驻 0.05-0.3 gwei）直用链价（10-14 修复）
 *   2. pinned 回滚开关：恒用 max（完全旧行为）
 *   3. gasLimit：estimate × 1.3 缓冲 / 超 hardCap 钳 cap / estimateGas 失败回落固定值
 *   4. gasStrategy 配置链：trading.gasStrategy > config.gasStrategy > 默认 dynamic
 *   5. 源码口径：调用点形状（发单路径全部经 _resolveGasPrice/_resolveGasLimit）
 *
 * 旧行为事故口径：maxGasPrice 被当精确值恒用（上限被当保底价，gas 费系统性高估）——
 * 本测是「修后行为」与「pinned 回滚开关（=旧行为）」的双向锁定。
 *
 * 打桩：BaseTrader 实例的 provider 字段（getFeeData/estimateGas 桩），零网络。
 *
 * 运行：node scripts/_test_gas_dynamic.cjs
 */

const assert = require('assert');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const BaseTrader = require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}

function gwei(n) { return ethers.parseUnits(String(n), 'gwei'); }

/** 构造打桩 trader：provider.getFeeData/estimateGas 可控 */
function mkTrader({ feeDataGasPrice = null, feeDataThrows = false, estimate = null, estimateThrows = false, gasStrategy } = {}) {
    const t = Object.create(BaseTrader.prototype);
    t.gasStrategy = gasStrategy || 'dynamic';
    t.tradingConfig = { maxGasPrice: 10 }; // 上限 10 gwei
    t.wallet = { address: '0x' + 'ab'.repeat(20) };
    t.provider = {
        getFeeData: async () => {
            if (feeDataThrows) throw new Error('fee rpc down');
            return { gasPrice: feeDataGasPrice, maxFeePerGas: null, maxPriorityFeePerGas: null };
        },
        estimateGas: async () => {
            if (estimateThrows) throw new Error('estimate rpc down');
            return estimate;
        },
    };
    return t;
}

async function main() {
    // ═══════════════ 1. gasPrice 动态分支 ═══════════════
    console.log('\n[1] _resolveGasPrice 动态分支');
    {
        // 1a. 链上价 3 gwei ≤ max 10 → 用链上价
        let t = mkTrader({ feeDataGasPrice: gwei(3) });
        ok((await t._resolveGasPrice(10)) === gwei(3), '链上价 3gwei ≤ max 10 → 用链上价');

        // 1b. 链上价 50 gwei > max 10 → 钳到 max
        t = mkTrader({ feeDataGasPrice: gwei(50) });
        ok((await t._resolveGasPrice(10)) === gwei(10), '链上价 50gwei 超 max → 钳到 10gwei');

        // 1c. getFeeData 失败 → 回落 max（=旧行为，永不因 gas 解析阻断发单）
        t = mkTrader({ feeDataThrows: true });
        ok((await t._resolveGasPrice(10)) === gwei(10), 'getFeeData 失败 → 回落 max');

        // 1d. 链上价 0.5 gwei（BSC 现实低价，2026-10 常驻 0.05-0.3 gwei）→ 直用链价
        //     （2026-10-14 修复：旧 <1 gwei 下限误判现实低价回落满格 max，v11 首回合实证）
        t = mkTrader({ feeDataGasPrice: gwei(0.5) });
        ok((await t._resolveGasPrice(10)) === gwei(0.5), '链上价 0.5gwei 现实低价 → 直用链价');

        // 1d-2. 链上价 <0.01 gwei → 回落 max（防脏数据/零价）
        t = mkTrader({ feeDataGasPrice: gwei(0.005) });
        ok((await t._resolveGasPrice(10)) === gwei(10), '链上价 0.005gwei <0.01gwei → 回落 max');

        // 1e. maxGasPriceGwei 参数缺省回落 tradingConfig.maxGasPrice
        t = mkTrader({ feeDataGasPrice: gwei(50) });
        ok((await t._resolveGasPrice(undefined)) === gwei(10), 'maxGasPrice 参数缺省 → tradingConfig.maxGasPrice');

        // 1f. gasPrice 为 null（某些 RPC 不返回）→ 回落 max
        t = mkTrader({ feeDataGasPrice: null });
        ok((await t._resolveGasPrice(10)) === gwei(10), 'feeData.gasPrice=null → 回落 max');
    }

    // ═══════════════ 2. pinned 回滚开关（旧行为）═══════════════
    console.log('\n[2] pinned 回滚开关');
    {
        const t = mkTrader({ feeDataGasPrice: gwei(3), gasStrategy: 'pinned' });
        ok((await t._resolveGasPrice(10)) === gwei(10), 'pinned 恒用 max（完全旧行为，不查链上价）');
    }

    // ═══════════════ 3. gasLimit 分支 ═══════════════
    console.log('\n[3] _resolveGasLimit 分支');
    {
        // 3a. estimate 200k × 1.3 = 260k ≤ cap 600k
        let t = mkTrader({ estimate: 200000n });
        ok((await t._resolveGasLimit({ to: '0x1', data: '0x' }, 300000, 600000)) === 260000n,
            'estimate 200k ×1.3 → 260k');

        // 3b. estimate 500k × 1.3 = 650k > cap 600k → 钳 cap
        t = mkTrader({ estimate: 500000n });
        ok((await t._resolveGasLimit({ to: '0x1', data: '0x' }, 300000, 600000)) === 600000n,
            'estimate 缓冲后超 cap → 钳到 600k');

        // 3c. estimateGas 失败 → 回落固定值 fallback（不阻断发单）
        t = mkTrader({ estimateThrows: true });
        ok((await t._resolveGasLimit({ to: '0x1', data: '0x' }, 300000, 600000)) === 300000n,
            'estimateGas 失败 → 回落固定值（链上 revert 语义与旧行为一致）');

        // 3d. 缓冲用整数运算（est × 13 / 10，非浮点）
        t = mkTrader({ estimate: 100001n });
        ok((await t._resolveGasLimit({ to: '0x1', data: '0x' }, 300000, 600000)) === (100001n * 13n) / 10n,
            '×1.3 缓冲是 bigint 整数运算');
    }

    // ═══════════════ 4. gasStrategy 配置链 ═══════════════
    console.log('\n[4] gasStrategy 读取链');
    {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader.js'), 'utf8');
        ok(src.includes('this.config.trading && this.config.trading.gasStrategy') && src.includes("|| this.config.gasStrategy || 'dynamic'"),
            '配置链 trading.gasStrategy > config.gasStrategy > 默认 dynamic');
    }

    // ═══════════════ 5. 源码口径：发单路径接线 ═══════════════
    console.log('\n[5] 源码口径（发单路径全部经动态解析）');
    {
        const fs = require('fs');
        // FourMeme/Flap：B4 改造统一走 BaseTrader 动态解析
        for (const f of ['FourMemeDirectTrader', 'FlapPortalTrader']) {
            const src = fs.readFileSync(path.join(ROOT, `src/trading-engine/traders/implementations/${f}.js`), 'utf8');
            const hasPrice = src.includes('await this._resolveGasPrice(');
            const hasLimit = src.includes('await this._resolveGasLimit(');
            ok(hasPrice && hasLimit, `${f}: 发单路径经 _resolveGasPrice/_resolveGasLimit`);
        }
        // PCS：rich-js 迁移时自带独立动态 gas（getOptimalGasPrice→getFeeData + estimateGas + BigInt 缓冲）
        // —— 非 BaseTrader 统一解析，但同为动态非恒 max；断言其动态要素在位
        const pcs = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/PancakeSwapV2Trader.js'), 'utf8');
        ok(/await this\.getOptimalGasPrice\(/.test(pcs) && pcs.includes('this.provider.getFeeData'),
            'PancakeSwapV2Trader: 自带动态 gas 解析（getOptimalGasPrice→getFeeData）');
        ok(/await this\.provider\.estimateGas\(/.test(pcs), 'PancakeSwapV2Trader: 发前 estimateGas');
        // 事故反证：不再有恒 maxGasPrice 精确值的旧形状（maxGasPrice 直接进交易参数）
        const fourmeme = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader.js'), 'utf8');
        ok(!/gasPrice:\s*ethers\.parseUnits\(String\(options\.maxGasPrice/.test(fourmeme),
            '旧形状（maxGasPrice 直填交易参数）已清除');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
