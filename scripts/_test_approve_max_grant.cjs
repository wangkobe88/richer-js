#!/usr/bin/env node
/**
 * 卖出 approve 大额一次授权单测（2026-10-15 GROK 案；零 DB 零网络）
 *
 * 案情：两 trader 卖出旧口径=精确额度 approve(spender, amountOutWei)——卖出即耗光
 * allowance，下一笔卖出 currentAllowance < amountOutWei 又重发 approve + await 回执
 * （旧路径 3.5-8s/笔 + gas）。链上实锤：GROK 0x5279…7777 三笔卖出每笔前都有独立
 * approve tx（块 205→P7 / 249→P9 / 284→P11）。改 MaxUint256 一次授权后 allowance
 * 恒充足，跳过分支结构保留。
 *
 * 覆盖：
 *   T1 FlapPortalTrader 源码口径：approve 参数=ethers.MaxUint256，approve 调用仍在
 *      currentAllowance < amountOutWei 条件内（一次授权后恒假跳过）
 *   T2 FourMemeDirectTrader 源码口径：同上（platformAddress 版）
 *   T3 旧口径残留反证：两文件不存在以 amountOutWei 作 approve 第二参的调用（防回流）
 *   T4 常量正确性：ethers.MaxUint256 === 2^256-1（防笔误成别的字面量）
 *
 * 用法：node scripts/_test_approve_max_grant.cjs
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { ethers } = require(path.join(ROOT, 'node_modules/ethers'));

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}

const FLAP_SRC = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader.js'), 'utf8');
const FM_SRC = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader.js'), 'utf8');

// ---- T1 FlapPortalTrader ----
{
    ok(/tokenContract\.approve\(this\.flapConfig\.portalAddress,\s*ethers\.MaxUint256\)/.test(FLAP_SRC),
        'T1a flap: approve 参数=ethers.MaxUint256');
    const condIdx = FLAP_SRC.indexOf('if (currentAllowance < amountOutWei)');
    const apprIdx = FLAP_SRC.indexOf('approve(this.flapConfig.portalAddress, ethers.MaxUint256)');
    ok(condIdx > 0 && apprIdx > condIdx && apprIdx - condIdx < 400,
        'T1b flap: approve 仍在 currentAllowance < amountOutWei 条件内（充足即跳过）');
}
// ---- T2 FourMemeDirectTrader ----
{
    ok(/tokenContract\.approve\(platformAddress,\s*ethers\.MaxUint256\)/.test(FM_SRC),
        'T2a fourmeme: approve 参数=ethers.MaxUint256');
    const condIdx = FM_SRC.indexOf('if (currentAllowance < amountOutWei)');
    const apprIdx = FM_SRC.indexOf('approve(platformAddress, ethers.MaxUint256)');
    ok(condIdx > 0 && apprIdx > condIdx && apprIdx - condIdx < 400,
        'T2b fourmeme: approve 仍在条件内');
}
// ---- T3 旧口径残留反证 ----
{
    ok(!/approve\((?:this\.flapConfig\.portalAddress|platformAddress),\s*amountOutWei\)/.test(FLAP_SRC),
        'T3a flap: 无精确额度 approve 残留（防回流）');
    ok(!/approve\((?:this\.flapConfig\.portalAddress|platformAddress),\s*amountOutWei\)/.test(FM_SRC),
        'T3b fourmeme: 无精确额度 approve 残留（防回流）');
}
// ---- T4 常量 ----
{
    const expect = (1n << 256n) - 1n;
    ok(ethers.MaxUint256 === expect, 'T4: ethers.MaxUint256 === 2^256-1');
}

console.log(`\n_approve_max_grant: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach(f => console.error(f)); process.exit(1); }
