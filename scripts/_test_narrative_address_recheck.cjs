#!/usr/bin/env node
/**
 * C253 地址重验等待——本地零 DB 零网络单测
 * （打桩 dbManager 单例 client（import 链经 ExternalResourceCache 触达）+
 *  全量注入 pull/sleep/now/config；performRulesValidation 用真函数=命中口径单一真相源）
 *
 * 覆盖：
 *   1. getAddressRecheckConfig：段缺失=默认开（narrativeRetry 先例）/ enabled:false 关 /
 *      intervalMs、windowMs 越界与残缺 throw fail-loud / 合法自定义透传
 *   2. shouldAttemptAddressRecheck 真值表：配置关 / 缺锚 fail-closed / 老票出窗 /
 *      新鲜票过 / 深度 1 限死
 *   3. recheckAddressEvidence：首查命中（零 sleep）/ 第二次命中 / 窗尽未命中
 *      （attempts=window/interval 边界）/ 拉取异常计尝试不中断
 *   4. ★事故现场反证（BNCI 0x35c4…7777 案）：真 performRulesValidation——
 *      质量未达标（260 粉<500）∧ bio 无 CA（02:15 首析快照 description=null）→
 *      addressVerified=false（stage='address'）；同一账号 bio 后补 CA →
 *      addressVerified=true——「bio CA 是命中判据、质量门不拦地址命中臂」锁死
 *   5. 接线源码断言：NarrativeAnalyzer 回落分支接线在（重验块先于置 false 回落）/
 *      递归深度参数透传 / config 段在 / accountOnly 非账号型语料不启动
 *
 * 用法：node scripts/_test_narrative_address_recheck.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（import 链经 account-community-rules →
// ExternalResourceCache → dbManager 触达，必须在被测模块加载前完成；不连任何真实服务）
const { dbManager } = require('../src/services/dbManager');
dbManager.isInitialized = true;
dbManager.client = {
    from: () => {
        throw new Error('单测禁触 DB——recheck 路径不应有任何 DB 调用');
    },
};

// ═══════════════ 测试基建 ═══════════════
let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

async function main() {
    const svc = await import('../src/narrative/analyzer/services/address-recheck-service.mjs');
    const { getAddressRecheckConfig, shouldAttemptAddressRecheck, recheckAddressEvidence } = svc;

    const CFG = { intervalMs: 15000, windowMs: 300000 };
    const ADDR = '0x35c4680cf97ccc6d6d85dd0e5ed9d4faa8907777';
    // BNCI 案账号快照（260 粉=质量未达标；name=BNCI 与 symbol 匹配）
    const accountData = (description) => ({
        type: 'account',
        id: '439842745',
        screen_name: 'MessariCrypto',
        name: 'BNCI',
        description,
        followers_count: 260,
        statuses_count: 7,
        verified: false,
        is_blue_verified: false,
        tweets: [],
    });

    // ── 1. getAddressRecheckConfig ─────────────────────────────────────────
    console.log('1. getAddressRecheckConfig');
    {
        const def = getAddressRecheckConfig({ config: {} });
        check('段缺失=默认开（narrativeRetry 先例）', def !== null && def.intervalMs === 15000 && def.windowMs === 300000);
        check('显式 enabled:false → null', getAddressRecheckConfig({ config: { addressRecheck: { enabled: false } } }) === null);
        check('显式段 null → null', getAddressRecheckConfig({ config: { addressRecheck: null } }) === null);
        const custom = getAddressRecheckConfig({ config: { addressRecheck: { enabled: true, intervalMs: 10000, windowMs: 600000 } } });
        check('合法自定义透传', custom.intervalMs === 10000 && custom.windowMs === 600000);
        let threw1 = false, threw2 = false, threw3 = false;
        try { getAddressRecheckConfig({ config: { addressRecheck: { enabled: true, intervalMs: 1000 } } }); }
        catch (e) { threw1 = /intervalMs/.test(e.message); }
        try { getAddressRecheckConfig({ config: { addressRecheck: { enabled: true, windowMs: 'abc' } } }); }
        catch (e) { threw2 = /windowMs/.test(e.message); }
        try { getAddressRecheckConfig({ config: { addressRecheck: { enabled: true, windowMs: 10000 } } }); }
        catch (e) { threw3 = /windowMs/.test(e.message); }
        check('intervalMs 下界越界 throw', threw1);
        check('windowMs 残缺（非数字）throw', threw2);
        check('windowMs 下界越界 throw', threw3);
    }

    // ── 2. shouldAttemptAddressRecheck 真值表 ─────────────────────────────
    console.log('2. shouldAttemptAddressRecheck');
    {
        const now = 1793160000000; // 固定 now（禁 Date.now 内部取值）；windowMs=300000（毫秒）
        const tok = (createdSec) => ({ tokenCreatedAtSec: createdSec, raw_api_data: {}, symbol: 'BNCI' });
        check('配置关（显式 null）→ false', shouldAttemptAddressRecheck(tok((now / 1000 - 20) | 0), {}, now, null) === false);
        check('缺锚 fail-closed → false', shouldAttemptAddressRecheck({ raw_api_data: {} }, {}, now, CFG) === false);
        check('老票出窗（age=301s>windowMs）→ false', shouldAttemptAddressRecheck(tok(now / 1000 - 301), {}, now, CFG) === false);
        check('新鲜票（age=299s）→ true', shouldAttemptAddressRecheck(tok(now / 1000 - 299), {}, now, CFG) === true);
        check('窗边界（age=300s 恰等，<= 放行）→ true', shouldAttemptAddressRecheck(tok(now / 1000 - 300), {}, now, CFG) === true);
        check('深度 1 限死 → false', shouldAttemptAddressRecheck(tok(now / 1000 - 100), { _addressRecheckDepth: 1 }, now, CFG) === false);
        check('深度 0/缺省 → 过', shouldAttemptAddressRecheck(tok(now / 1000 - 100), { _addressRecheckDepth: 0 }, now, CFG) === true);
    }

    // ── 3. recheckAddressEvidence（注入假时钟/sleep/pull）─────────────────
    console.log('3. recheckAddressEvidence');
    {
        // 假时钟：sleep 推进
        const mkDeps = (pullFn) => {
            let t = 0;
            let sleeps = 0;
            return {
                config: CFG,
                now: () => t,
                sleep: async (ms) => { sleeps++; t += ms; },
                pull: pullFn,
                get sleeps() { return sleeps; },
            };
        };
        const args = { tokenAddress: ADDR, tokenSymbol: 'BNCI', tokenName: 'BNC Inu', screenName: 'MessariCrypto', untilSec: 1793072084 };

        // 3a. 首查命中（bio CA 已补）
        {
            const d = mkDeps(async () => accountData(ADDR));
            const r = await recheckAddressEvidence(args, d);
            check('首查命中 hit=true attempts=1', r.hit === true && r.attempts === 1 && r.followersCount === 260, JSON.stringify(r));
            check('首查命中零 sleep', d.sleeps === 0);
        }
        // 3b. 第一次无 CA、第二次后补 → attempts=2
        {
            let n = 0;
            const d = mkDeps(async () => accountData(n++ === 0 ? null : ADDR));
            const r = await recheckAddressEvidence(args, d);
            check('第二次命中 attempts=2', r.hit === true && r.attempts === 2, JSON.stringify(r));
            check('第二次命中 sleep 1 次', d.sleeps === 1);
        }
        // 3c. 窗尽未命中：interval 15000 / window 300000 → 首查+19 轮 = 20 次、19 睡
        {
            const d = mkDeps(async () => accountData(null));
            const r = await recheckAddressEvidence(args, d);
            check('窗尽未命中 hit=false attempts=20', r.hit === false && r.attempts === 20, JSON.stringify(r));
            check('窗尽 sleep 19 次（不发超窗拉取）', d.sleeps === 19);
        }
        // 3d. 拉取异常一次后命中 → 不中断
        {
            let n = 0;
            const d = mkDeps(async () => { if (n++ === 0) throw new Error('apidance 限流'); return accountData(ADDR); });
            const r = await recheckAddressEvidence(args, d);
            check('拉取异常计尝试不中断 → 命中', r.hit === true && r.attempts === 2, JSON.stringify(r));
        }
        // 3e. 推文级 CA 也命中（宣告推后补，bio 恒空；verifyTokenAddress 消费 tweet.text）
        {
            const d = mkDeps(async () => ({
                ...accountData(null),
                tweets: [{ text: `BNCI launch! CA: ${ADDR}`, created_at: 'Wed Oct 28 02:20:00 +0000 2026' }],
            }));
            const r = await recheckAddressEvidence(args, d);
            check('推文级 CA 命中（宣告推形状）', r.hit === true && r.attempts === 1, JSON.stringify(r));
        }
    }

    // ── 4. ★事故现场反证（真 performRulesValidation 口径）──────────────────
    console.log('4. 事故现场反证（BNCI 案两快照对拍）');
    {
        // 动态 import 真函数（与 service 内同一份——单一真相源）
        const rules = await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');
        const atFirstAnalysis = rules.performRulesValidation(ADDR, 'BNCI', 'BNC Inu', accountData(null), {});
        check('02:15 首析快照（bio 无 CA）→ addressVerified=false stage=address',
            atFirstAnalysis.addressVerified === false && atFirstAnalysis.stage === 'address',
            JSON.stringify({ stage: atFirstAnalysis.stage }));
        const afterCaBackfill = rules.performRulesValidation(ADDR, 'BNCI', 'BNC Inu', accountData(ADDR), {});
        check('bio 后补 CA（260 粉质量未达标）→ addressVerified=true（质量门不拦地址命中臂）',
            afterCaBackfill.addressVerified === true && afterCaBackfill.passed === true,
            JSON.stringify({ stage: afterCaBackfill.stage }));
        // 递归重析走过的真实终点（182 定向重析实证 mid）依赖 prestage Jev——纯规则层只锁核验臂
    }

    // ── 5. 接线源码断言（防线：接线被删/错位时本测失败）────────────────────
    console.log('5. 接线源码断言');
    {
        const fs = require('fs');
        const src = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
        check('NarrativeAnalyzer import 三函数', /import \{ getAddressRecheckConfig, shouldAttemptAddressRecheck, recheckAddressEvidence \}/.test(src));
        const recheckBlock = src.indexOf('地址重验等待启动（C253');
        const fallbackLine = src.indexOf("shouldUseAccountCommunity = false;", src.indexOf('地址核验失败 → 回落标准路径'));
        check('重验块在 C238b 回落置 false 之前', recheckBlock > 0 && fallbackLine > recheckBlock,
            `recheckBlock=${recheckBlock} fallbackLine=${fallbackLine}`);
        check('命中递归重析带深度参数与缓存失效', src.includes('_addressRecheckDepth: (options._addressRecheckDepth || 0) + 1')
            && src.includes('ignoreCache: true,\n                    invalidateAccountCorpus: true,'));
        check('账号型语料门（非 account 不启动重验）', /if \(twitterInfo\?\.type === 'account'/.test(src));
        const cfg = JSON.parse(fs.readFileSync('config/narrative-engine.json', 'utf8'));
        check('config addressRecheck 段 enabled=true', cfg.addressRecheck?.enabled === true && cfg.addressRecheck?.intervalMs === 15000 && cfg.addressRecheck?.windowMs === 300000);
    }

    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
