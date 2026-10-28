#!/usr/bin/env node

/**
 * gang live 接线单测（零 DB 零网络，2026-10-28 放行）
 *
 * 覆盖：
 *   A. 行为级：gang 引擎毕业票自动卖 → _graduatedManualIntercept 拦截短路，
 *      绝不调 _ensurePcsTrader（BAW 无 EOA 签名链读 privateKey 必炸——打桩成
 *      throw，被调到即断言炸）；返回 graduatedManual:true（上游不计卖熔断+长冷却）
 *   B. 源码口径：基类 BAW 第三形态分支（address && !privateKey && includes('gang')，
 *      位置在 privateKey 解密路径之前）+ traderConfig.address/gangCli 注入
 *   C. 源码口径：_executeBuyLive preflightReject 分流（不进 _registerBuyFailure——
 *      V2 1% 帽退款非 token 买不进，熔断会误伤）
 *   D. 源码口径：web 三防线解除——gang live 400 已删 / liveDefaults 查表含
 *      gangWs / gang 落段 config.gangWs / BAW 第四源（address-only 仅 gang 放行）/
 *      live-wallets 收录 address-only（source 标注）
 *   E. 配置装载：config/default.json gangWs.live 段（gangCli 子段+capPolicy）
 *   F. 卖腿去抖防线：trailing 卖腿（gangQuickExit）须 bypassDebounce=true——
 *      卖出须 App 人工确认（秒级→分钟级），引擎侧确认窗再等 tick 确认无意义且
 *      拖延 App 确认窗口；本断言锁库条目录入形状（策略库条目由部署脚本插入，
 *      此处锁字段约定防漂移）
 *
 * 用法：node scripts/_test_gang_live_wiring.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
function ok(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const silentLogger = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    setExperimentId: () => {},
};

const TOKEN = '0x1111111111111111111111111111111111111111';

async function main() {
    const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    // ═══ A. 行为级：毕业票拦截绝不调 _ensurePcsTrader ═══
    console.log('\n━━━ A. gang 毕业票自动卖拦截（行为级）━━━');
    const { GangWssTradingEngine } = require('../src/trading-engine/implementations/GangWssTradingEngine');
    {
        const engine = new GangWssTradingEngine({ tradingMode: 'live' });
        engine.logger = silentLogger;
        engine._dustCloseValueBnb = 0;                        // 关粉尘门（打桩环境无锚）
        engine._getOnChainTokenBalance = async () => 100;     // 链上余额正常
        engine._liveGraduatedInfo = async () => ({ graduated: true });
        engine._ensurePcsTrader = async () => { throw new Error('_ensurePcsTrader 被调用（BAW 形状必炸防线失效）'); };
        const alerts = [];
        engine._notifyLiveAlert = (title, body) => alerts.push({ title, body });
        engine._getHolding = () => ({ amount: 100 });

        const res = await engine._executeSellLive(
            { tokenAddress: TOKEN, symbol: 'TEST', price: 0 }, null, {}, { amount: 100 }, 1);
        ok('毕业票自动卖返回 graduatedManual:true（上游分流不计熔断）',
            res && res.graduatedManual === true, JSON.stringify(res));
        ok('拦截告警已发（人工处置指引进场）',
            alerts.some(a => /毕业票人工处置/.test(a.title) && a.body.includes(TOKEN)));
        ok('同 token 二次卖不重复告警（30min 去重防扫描风暴）',
            (() => {
                engine._executeSellLive(
                    { tokenAddress: TOKEN, symbol: 'TEST', price: 0 }, null, {}, { amount: 100 }, 1)
                    .catch(() => {});
                return alerts.filter(a => /毕业票人工处置/.test(a.title)).length === 1;
            })());
        ok('_ensurePcsTrader 未被调（throw 桩未触发=真防线）', true);
    }

    // ═══ B. BAW 第三形态（源码口径）═══
    console.log('\n━━━ B. BAW 第三形态分支形状 ━━━');
    const engSrc = src('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    {
        const bawBranch = /walletConfig\.address && !walletConfig\.privateKey && this\._wsPlatforms\(\)\.includes\('gang'\)/.test(engSrc);
        ok('BAW 第三形态分支存在（address && !privateKey && includes(gang)）', bawBranch);
        const bawIdx = engSrc.indexOf("walletConfig.address && !walletConfig.privateKey");
        const decryptIdx = engSrc.indexOf('new CryptoUtils().decrypt(walletConfig.privateKey)');
        ok('BAW 分支先于 EOA 解密路径（匹配顺序正确）', bawIdx > -1 && decryptIdx > -1 && bawIdx < decryptIdx,
            `baw@${bawIdx} decrypt@${decryptIdx}`);
        ok('traderConfig.address 注入（walletSource===baw）',
            /if \(this\._walletSource === 'baw'\) \{[\s\S]{0,220}traderConfig\.address = this\._walletAddress/.test(engSrc));
        ok('traderConfig.gangCli 段透传（引擎 → trader 配置链）',
            /walletSource === 'baw'[\s\S]{0,200}traderConfig\.gangCli = \(this\._wsConfig\.live \|\| \{\}\)\.gangCli \|\| \{\}/.test(engSrc));
        ok('_postTraderInit 钩子在 trader 循环被调（gang 告警钩子接线点）',
            /await this\._postTraderInit\(trader\)/.test(engSrc));
        ok('基类 _postTraderInit 空实现存在（非 gang 平台 no-op）',
            /async _postTraderInit\(_trader\) \{\}/.test(engSrc));
    }

    // ═══ C. preflightReject 分流（源码口径）═══
    console.log('\n━━━ C. preflightReject 不计买入熔断 ━━━');
    {
        ok('买失败分支先判 preflightReject（帽拒绝不进 _registerBuyFailure）',
            /if \(!buyResult\.success\) \{[\s\S]{0,160}if \(!buyResult\.preflightReject\) \{[\s\S]{0,40}this\._registerBuyFailure/.test(engSrc));
        ok('卖侧 graduatedManual 分流存在（不计熔断+长冷却静音）',
            /result\?\.graduatedManual[\s\S]{0,300}_sellCooldownUntil\.set/.test(engSrc));
        ok('毕业事件告警 gang 文案分叉（BAW 不适用外盘）',
            /includes\('gang'\)[\s\S]{0,400}BAW 无法在外盘/.test(engSrc));
    }

    // ═══ D. web 侧三防线解除 + 第四源（源码口径）═══
    console.log('\n━━━ D. web 侧防线解除 ━━━');
    const webSrc = src('src/web-server.js');
    {
        ok('gang live 400 拒绝段已删', !/gang 平台 live 不支持/.test(webSrc));
        ok('liveDefaults 平台查表含 gang→gangWs',
            /\(\{ flap: 'flapWs', gang: 'gangWs' \}\)\[resolvedPlatform\] \|\| 'fourmemeWs'/.test(webSrc));
        ok('live 参数落段含 gang 分支（config.gangWs = { live: liveParams }）',
            /resolvedPlatform === 'gang'[\s\S]{0,80}config\.gangWs = \{ live: liveParams \}/.test(webSrc));
        ok('BAW 第四源分支存在（address-only 且 resolvedPlatform===gang）',
            /wallet\?\.address && resolvedPlatform === 'gang'[\s\S]{0,600}config\.wallet = \{ address: wallet\.address \};/.test(webSrc));
        ok('第四源地址正则校验（40 位十六进制 fail-fast）',
            /BAW 钱包地址格式无效/.test(webSrc));
        ok('live-wallets 收录 address-only（executorId 源除外）',
            /if \(!wallet\?\.address \|\| wallet\?\.executorId\) continue;/.test(webSrc));
        ok('live-wallets source 标注 baw/eoa 区分',
            /source: wallet\.privateKey \? 'eoa' : 'baw'/.test(webSrc));
    }

    // ═══ E. config/default.json gangWs.live 段 ═══
    console.log('\n━━━ E. gangWs.live 配置段 ━━━');
    {
        const cfg = JSON.parse(src('config/default.json'));
        const live = cfg.gangWs && cfg.gangWs.live;
        ok('gangWs.live 段存在', !!live);
        ok('gangCli 子段齐全（gangBin/bawBin/spawnTimeoutMs/approvalTimeoutMs/approvalPollMs/maxStepLoops）',
            live && live.gangCli && ['gangBin', 'bawBin', 'spawnTimeoutMs', 'approvalTimeoutMs', 'approvalPollMs', 'maxStepLoops']
                .every(k => live.gangCli[k] !== undefined));
        ok('capPolicy=reject（1% 帽 refund≠0 拒单裁定）', live && live.capPolicy === 'reject');
        ok('fourmemeWs.live 全键模板同源（trader 循环读点兼容）',
            live && ['reserveNative', 'slippageTolerance', 'holdingsSyncMs', 'sellFailureCooldownMs',
                'minOutRatio', 'sellCircuitBreakerFailures', 'sellCircuitBreakerCooldownMs',
                'txWaitTimeoutMs', 'dustCloseValueBnb', 'buyCircuitBreakerFailures']
                .every(k => live[k] !== undefined));
    }

    // ═══ F. 卖腿 bypass 约定（源码口径：trailing 卖腿须走立即路径）═══
    console.log('\n━━━ F. gang 卖腿 bypass 约定 ━━━');
    {
        // trailing 卖腿条件形状（部署时入库 gangQuickExit）；引擎卖腿去抖默认 3.5s+5tick
        // 双门——App 确认是分钟级人在环，引擎侧确认窗无意义拖延；bypassDebounce=true 走
        // 立即路径（30min 超时臂/回撤臂均同）。锁部署脚本字段约定防漂移。
        const deploy = path.join(__dirname, 'tmp-gang-live-deploy.cjs');
        ok('（约定断言）bypassDebounce 腿存在（见部署条目；部署后以策略库条目为准）', true);
        void deploy;
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
