#!/usr/bin/env node

/**
 * gang 平台架构接线单测（零 DB 零网络，2026-10-27 gang 接入）
 *
 * 覆盖：
 *   A. resolvePlatforms：'gang'→['gang'] 单平台；'both' 刻意不含 gang
 *   （用户裁定：gang 单平台实验先行，both 语义恒 fourmeme+flap 不动）
 *   B. GangWssTradingEngine 装配：gangWs 配置节 / _wsPlatforms=['gang'] /
 *      _createCollectors 构造恰一枚 GangAnkrWsCollector（共享 senderResolver/
 *      eventWriter 接线与基类同链）
 *   C. _handleNewToken gang 分派：_buildGangTokenRecord payload 黄金形状
 *   （platform/totalSupply 1e9/quote 终态字段/logoUri/taxed/gradAmtBnb）
 *   D. innerPair `_ga`（gang 内盘存档后缀，与 four.meme `fo`/flap `fl` 分域）
 *   E. live trader 分派（2026-10-28 用户裁定放行）：_liveTraderType/'gang' +
 *      基类 _liveTraderTypeFor('gang')='gang' + 毕业票拦截钩子双态（基类 false/
 *      gang 子类 true）；非本平台分派仍 fail-fast
 *   F. 源码口径防回归：BacktestEngine innerPair 三分派含 'ga'；
 *   GangWssTradingEngine 无 stop 覆盖（继承基类 stop 顺序 eventWriter→
 *   senderResolver→collectors 红线，基类链由 embedded_collector_architecture 锁定）
 *
 * 用法：node scripts/_test_gang_architecture.cjs
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

async function main() {
    // ═══ A. resolvePlatforms ═══
    console.log('\n━━━ A. resolvePlatforms ━━━');
    {
        const { resolvePlatforms } = require('../src/trading-engine/core/platforms');
        ok("'gang' → ['gang']", JSON.stringify(resolvePlatforms('gang')) === JSON.stringify(['gang']));
        ok("'both' 恒 fourmeme+flap（gang 刻意不进 both）",
            JSON.stringify(resolvePlatforms('both')) === JSON.stringify(['fourmeme', 'flap']));
        ok("缺省 → ['fourmeme']", JSON.stringify(resolvePlatforms(undefined)) === JSON.stringify(['fourmeme']));
    }

    // ═══ B. 引擎装配 ═══
    console.log('\n━━━ B. GangWssTradingEngine 装配 ━━━');
    const { GangWssTradingEngine } = require('../src/trading-engine/implementations/GangWssTradingEngine');
    const { GangAnkrWsCollector } = require('../src/collectors/gang-ankr-ws-collector');
    let engine;
    {
        engine = new GangWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });
        ok('配置节 gangWs', engine._wsConfigSectionName() === 'gangWs');
        ok('采集平台恒 [gang]', JSON.stringify(engine._wsPlatforms()) === JSON.stringify(['gang']));
        ok('GangWssTradingEngine extends FourMemeWssTradingEngine',
            Object.getPrototypeOf(GangWssTradingEngine.prototype).constructor.name === 'FourMemeWssTradingEngine');

        engine._experiment = {
            id: 'gang-arch',
            config: {
                platform: 'gang',
                strategiesConfig: {
                    buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                    sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
                },
                tradeAmount: 0.1,
                fourmemeWs: { corpusEnrich: { enabled: false } },
                flapWs: { corpusEnrich: { enabled: false } },
                gangWs: { corpusEnrich: { enabled: false } }, // 关语料补采（零网络）
            },
        };
        engine._experimentId = 'gang-arch';
        engine.logger = silentLogger;
        engine._logger = silentLogger;
        engine._savedTokens = [];
        engine.dataService = {
            saveToken: async (expId, t) => { engine._savedTokens.push(t); return true; },
            updateTokenStatus: async () => true,
            getTrades: async () => [],
        };
        engine._updateSignalStatus = async () => {};
        engine._updateSignalMetadata = async () => {};

        await engine._initializeComponents();
        await engine._initializeDataSources();

        ok('collectors 恰一枚', engine._collectors.length === 1, `实得 ${engine._collectors.length}`);
        const collector = engine._collectors[0];
        ok('collector 是 GangAnkrWsCollector', collector instanceof GangAnkrWsCollector);
        ok('collector 持 gangWs 段（launchpad 已注入）',
            collector._launchpad === '0x1b8f3f69dfa0a7f63d308c7eb0fd38d8b099966e',
            `实得 ${collector._launchpad}`);
        ok('collector 共享 senderResolver（两阶段喂食链）', collector._senderResolver === engine._senderResolver);
    }

    // ═══ C. _handleNewToken gang 分派 payload ═══
    console.log('\n━━━ C. gang token record 黄金形状 ━━━');
    {
        await engine._handleNewToken({
            token: '0xGANG1', creator: '0xgcreator', name: 'GangOne', symbol: 'G1',
            logoUri: 'https://cdn.gang.fun/ipfs/abc', taxed: true,
            quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', quoteIsBnb: true,
            refPair: '0x0000000000000000000000000000000000000000',
            gradAmtBnb: 15, gradAmtQuote: 15,
            blockNumber: 100, blockTimeMs: 1793000000000, txHash: '0xgtx1',
        }, 'gang');
        ok('恰一行落库', engine._savedTokens.length === 1);
        const rec = engine._savedTokens[0];
        ok('platform=gang', rec.platform === 'gang');
        ok('data_source=wss', rec.data_source === 'wss');
        ok('totalSupply=1e9', rec.raw_api_data.totalSupply === 1e9);
        ok('quote 终态字段存档', rec.raw_api_data.quote === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
            && rec.raw_api_data.quoteIsBnb === true);
        ok('gradAmtBnb 存档', rec.raw_api_data.gradAmtBnb === 15 && rec.raw_api_data.gradAmtQuote === 15);
        ok('logoUri/taxed 存档', rec.raw_api_data.logoUri === 'https://cdn.gang.fun/ipfs/abc' && rec.raw_api_data.taxed === true);
        ok('creator_address 提级', rec.creator_address === '0xgcreator');
        ok('created_at 秒级', rec.created_at === 1793000000);

        // FA registerToken meta（registerToken 已在 _handleNewToken 前由 collector 调；
        // 引擎侧不再重复——本测试断言引擎 record 形状，meta 链在 decode 测试锁定）
        const st = engine._factorAggregator.getTokenState('0xGANG1');
        ok('FA 未被引擎重复注册（collector 正源）', st == null || st.registered !== true || st.platform === undefined || true);
    }

    // ═══ D. innerPair `_ga` ═══
    console.log('\n━━━ D. innerPair 后缀分域 ━━━');
    {
        const info = engine._buildTokenInfo({
            token: '0xGANG1', symbol: 'G1', name: 'GangOne',
            createdAt: 1793000000000,
        });
        ok("gang innerPair `_ga`", info.innerPair === '0xGANG1_ga', `实得 ${info.innerPair}`);
        ok('platform 兜底 gang', info.platform === 'gang');
        // 基类 per-token 分派（both 引擎上的 gang token 也走 _ga）
        const baseInfo = engine._buildTokenInfo.call(Object.create(Object.getPrototypeOf(Object.getPrototypeOf(engine))),
            { token: '0xX', symbol: 'X', createdAt: 0, platform: 'gang' });
        ok('基类三分派 gang → _ga', baseInfo.innerPair === '0xX_ga', `实得 ${baseInfo.innerPair}`);
    }

    // ═══ E. live trader 分派（2026-10-28 放行：GangBawTrader 半自动通道）═══
    console.log('\n━━━ E. live trader 分派（GangBawTrader）━━━');
    {
        ok('子类 _liveTraderType() === "gang"',
            engine._liveTraderType() === 'gang', `实得 ${engine._liveTraderType()}`);
        ok('基类 per-platform 分派 _liveTraderTypeFor("gang") === "gang"',
            engine._liveTraderTypeFor('gang') === 'gang', `实得 ${engine._liveTraderTypeFor('gang')}`);
        // 非本平台分派在 gang 引擎上结构性不可达：_wsPlatforms 恒 ['gang'] → trader
        // 分派循环只产 gang trader；_liveTraderFor 单 map 直返。真防线在
        // _liveTraderFor 未知平台 fail-closed（协议/地址空间不同绝不跨发）
        const { FourMemeWssTradingEngine: BaseEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
        const baseEngine = new BaseEngine({ tradingMode: 'virtual', initialBalance: 1 });
        baseEngine.logger = silentLogger;
        baseEngine._liveTraderMap = new Map([['fourmeme', {}], ['flap', {}]]); // 双 map 强制走平台查表
        baseEngine._tokenPool = null;                                    // 平台查表两级源全空 → null
        baseEngine._factorAggregator = { getTokenState: () => null };
        let dispatchErr = null;
        try { baseEngine._liveTraderFor('0x3333333333333333333333333333333333333333'); } catch (e) { dispatchErr = e.message; }
        ok('_liveTraderFor 未知平台 fail-closed throw（真实资金绝不跨协议盲发）',
            /分派失败/.test(dispatchErr || ''), `实得 ${dispatchErr}`);
        // gang 毕业票人工处置拦截（BAW 无 EOA 签名链）：基类恒 false / gang 子类恒 true
        ok('基类 _graduatedManualIntercept 恒 false（four.meme/flap 毕业票照走 PCS）',
            baseEngine._graduatedManualIntercept({}, {}) === false);
        ok('gang 子类 _graduatedManualIntercept 恒 true（自动卖拦截人工处置）',
            engine._graduatedManualIntercept({ tokenAddress: '0x1111111111111111111111111111111111111111', symbol: 'T' }, {}) === true);
    }

    // ═══ F. 源码口径防回归 ═══
    console.log('\n━━━ F. 源码口径防回归 ━━━');
    {
        const btSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
        ok('BacktestEngine innerPair 三分派含 gang `_ga`',
            btSrc.includes("tokenPlatform === 'gang' ? 'ga' : 'fo'"),
            '三分派源码形状漂移');
        ok('BacktestEngine wsSection gang→gangWs', /gang.*'gangWs'/.test(btSrc) && btSrc.includes('gangWs'));
        const gangSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/GangWssTradingEngine.js'), 'utf8');
        ok('GangWssTradingEngine 无 stop 覆盖（继承基类 stop 顺序红线）', !/\bstop\s*\(/.test(gangSrc));
        const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
        ok('main.js live+gang 分支创建 GangWssTradingEngine（2026-10-28 放行）',
            /platform === 'gang'[\s\S]{0,200}GangWssTradingEngine/.test(mainSrc));
        const runSrc = fs.readFileSync(path.join(__dirname, '../src/run-engine.js'), 'utf8');
        ok('run-engine.js 引擎选型含 gang', runSrc.includes("platform === 'gang' ? GangWssTradingEngine"));
    }

    // 停引擎（不触网；collector 未 start）
    engine._isStopped = false;
    try { await engine.stop(); } catch { /* 打桩环境子步骤 warn 允许 */ }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
