#!/usr/bin/env node
/**
 * T245 上涨趋势认知因子族单测（steady_trend_climb 趋势质量维度，2026-11-28 计划）
 * ——零 DB 零网络。
 *
 * 十键（FourMemeFactorAggregator，zigzag detectSwings 复用 + act 环密度派生）：
 *   zigzag 7 键（原料=_relPriceTrend 链序可靠价，TREND_SWING_PCT=10 摆动阈值）：
 *   - riseLegSec：当前上涨腿已持续秒数（下跌腿=0 有证据零值；未定向/点数<2=null）
 *   - riseLegAmplPct：当前上涨腿累计涨幅 %（无腿=null）
 *   - riseConcentrationPct：腿内最大 10s 桶涨幅占比 %（均匀性主键；腿涨幅<5%=null）
 *   - launchPullbackN：发出后 ≥10% 回调次数（0=从无回调 有证据零值）
 *   - launchMaxPullbackPct：历史最大单腿回调深度 %（无回调=0）
 *   - riseLegStartVsFirstPct：当前腿起点价 vs 首可靠价 %（≈0=趋势含发出点）
 *   - swingDirSwitchN：最近 300s 方向切换次数（0=单向明确）
 *   密度 3 键（原料=_activityEvents 环，10s 窗；量<0.05B 比值失真=null）：
 *   - actTradersPerBnb：每 BNB 独立钱包数 / actNewTradersRatio：新钱包占比 % /
 *     actAvgTradeBnb：笔均成交额 BNB
 *
 * 覆盖：
 *   A. zigzag 状态机：单点全 null / 匀速爬升 riseLegSec 随 now 推进 / 8% 浅回调
 *      不分段 / 12% 深回调切段（N=1 + 下跌腿 riseLegSec=0）/ 未定向全 null
 *   B. 浓度桶数学：半开边界归属 / 单桶 100 / 两桶等涨幅 ≈47.6 / 腿涨幅 4.99% null
 *   C. 回调族：从无回调 0 值 / 三跌腿计数与最深 / 起点 vs 首价三态 / switchN 300s 窗
 *   D. 密度键：0.0499 null / 0.05 出值 / 零独立钱包 0 与 null 分形 / defer 乱序
 *   E. 探针+快照+源码口径（TREND_SWING_PCT=10 / 禁 Date.now / 白名单 ?? null）
 *
 * 用法：node scripts/_test_uptrend_cognition_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 0.1, token_amount: 100000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);
function newFA(factorParams) {
    const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
    const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}
// 价格喂入助手：每 tick 指定价与 ts（amount 0.1 ≥ minPriceUpdateBnb 0.002 → 可靠价入链）
function feedPrice(fa, seq) {
    for (const [ts, price] of seq) fa.processTick(mkTick({ timestamp: ts, price_bnb: price }));
}
const cog = (f) => ({
    sec: f.riseLegSec, ampl: f.riseLegAmplPct, conc: f.riseConcentrationPct,
    pullN: f.launchPullbackN, pullMax: f.launchMaxPullbackPct,
    startVsFirst: f.riseLegStartVsFirstPct, switchN: f.swingDirSwitchN,
});
const BASE = 0.000001;
const P = (mult) => BASE * mult; // 相对价（首价 P(100)=1e-4 级别不 care，只 care 比例）

console.log('A. zigzag 状态机（TREND_SWING_PCT=10）');
{
    const fa = newFA();
    feedPrice(fa, [[T0 + 1000, P(100)]]);
    let f = fa.buildFactorMap('0xtoken', T0 + 1000);
    check('A1 单点 <2：zigzag 七键全 null', () => assert.deepStrictEqual(cog(f), { sec: null, ampl: null, conc: null, pullN: null, pullMax: null, startVsFirst: null, switchN: null }));

    // 匀速爬升：100→120（+20%，每 5s 一步）→ dir=0 单调无中间价不确认首摆点
    // → 早期趋势语义（腿起点=序列最低点 100）
    const fa2 = newFA();
    feedPrice(fa2, [[T0 + 1000, P(100)], [T0 + 6000, P(106)], [T0 + 11000, P(112)], [T0 + 16000, P(120)]]);
    f = fa2.buildFactorMap('0xtoken', T0 + 16000);
    check('A2 早期趋势（dir0 单调涨）：riseLegSec=15（now−序列最低点）、ampl≈+20、pullN=0/max=0、switchN=0（无确认段）', () => {
        assert.strictEqual(cog(f).sec, 15);
        assert.strictEqual(cog(f).ampl, 20);
        assert.strictEqual(cog(f).pullN, 0);
        assert.strictEqual(cog(f).pullMax, 0);
        assert.strictEqual(cog(f).switchN, 0);
    });
    check('A2b riseLegSec 随 now 推进（虚拟钟；断流腿龄照走）', () => {
        const f2 = fa2.buildFactorMap('0xtoken', T0 + 20000);
        assert.strictEqual(cog(f2).sec, 19);
    });
    check('A2c startVsFirst：腿起点=首可靠价 100 → 0（趋势含发出点）', () => assert.strictEqual(cog(f).startVsFirst, 0));

    // 8% 浅回调不分段：120 → 110.4（-8% <10）仍在上涨腿
    fa2.processTick(mkTick({ timestamp: T0 + 21000, price_bnb: P(110.4) }));
    f = fa2.buildFactorMap('0xtoken', T0 + 21000);
    check('A3 8% 浅回调：不切段（sec 照走、N=0）', () => {
        assert.strictEqual(cog(f).sec, 20);
        assert.strictEqual(cog(f).pullN, 0);
    });

    // 12% 深回调：先爬回 120 再跌 12%（107.04 即 120×0.892）→ 确认峰@120、dir=-1
    fa2.processTick(mkTick({ timestamp: T0 + 26000, price_bnb: P(120) }));
    fa2.processTick(mkTick({ timestamp: T0 + 31000, price_bnb: P(105.6) }));
    f = fa2.buildFactorMap('0xtoken', T0 + 31000);
    check('A4 12% 深回调：切段 pullN=1/max=12、下跌腿 riseLegSec=0（有证据零值）、ampl=null', () => {
        assert.strictEqual(cog(f).pullN, 1);
        assert.strictEqual(cog(f).pullMax, 12);
        assert.strictEqual(cog(f).sec, 0);
        assert.strictEqual(cog(f).ampl, null);
    });

    // 未定向整体下跌：价格阴跌（无中间价确认）
    const fa3 = newFA();
    feedPrice(fa3, [[T0 + 1000, P(100)], [T0 + 6000, P(99)], [T0 + 11000, P(98)]]);
    f = fa3.buildFactorMap('0xtoken', T0 + 11000);
    check('A5 未定向整体下跌：全 null（无上涨证据）', () => assert.deepStrictEqual(cog(f), { sec: null, ampl: null, conc: null, pullN: null, pullMax: null, startVsFirst: null, switchN: null }));
}

console.log('B. 浓度桶数学（10s 桶半开）');
{
    // 单桶：腿起点 ts 恰在桶边界场景——legStart=100@t1，桶 (t1, t1+10s] 内涨 20%
    const fa = newFA();
    feedPrice(fa, [[T0 + 1000, P(100)], [T0 + 2000, P(110)], [T0 + 4000, P(120)]]);
    // dir 0 期：120 触 fromMin=+20 ≥10 → points=[low@100]、dir=1；legs=[{100→120,+20}]
    let f = fa.buildFactorMap('0xtoken', T0 + 4000);
    check('B1 短腿（<10s）单桶：浓度=100（短促暴拉语义）', () => {
        assert.strictEqual(cog(f).ampl, 20);
        assert.strictEqual(cog(f).conc, 100);
    });
    // 两桶等涨幅：100→110（桶1，10s 内）+10%→121（桶2）总涨幅 21%，桶份额 10/21≈47.6
    const fa2 = newFA();
    feedPrice(fa2, [[T0 + 1000, P(100)], [T0 + 2000, P(110)], [T0 + 12000, P(121)]]);
    f = fa2.buildFactorMap('0xtoken', T0 + 12000);
    check('B2 两桶等涨幅：conc≈47.6（10/21）', () => {
        assert.strictEqual(cog(f).ampl, 21);
        assert.ok(Math.abs(cog(f).conc - 47.62) < 0.1, 'conc=' + cog(f).conc);
    });
    // 腿涨幅 4.99% → conc null；5.01% → 出值
    const fa3 = newFA();
    feedPrice(fa3, [[T0 + 1000, P(100)], [T0 + 2000, P(104.99)]]);
    f = fa3.buildFactorMap('0xtoken', T0 + 2000);
    check('B3 腿涨幅 4.99%：conc=null（防噪声）；ampl 照出', () => {
        assert.strictEqual(cog(f).ampl, 4.99);
        assert.strictEqual(cog(f).conc, null);
    });
    const fa4 = newFA();
    feedPrice(fa4, [[T0 + 1000, P(100)], [T0 + 2000, P(105.01)]]);
    f = fa4.buildFactorMap('0xtoken', T0 + 2000);
    check('B4 腿涨幅 5.01%：conc 出值（=100 单桶）', () => assert.strictEqual(cog(f).conc, 100));
}

console.log('C. 回调族 / 明确性');
{
    // 三跌腿序列：100→120（+20，dir0 单调）→107（-10.83 确认峰@120、dir=-1）→96（续跌）
    // →110（+14.58 确认谷@96、dir=1）→107（-2.7 不切）→95（-11.2 从 110 确认峰@110）
    // →88（续跌）→97（+10.23 确认谷@88）→91（不切）
    // legs：120→96(-20)、96→110(+14.58)、110→88(-20)、88→97(+10.23) —— 下跌腿 2 段（-20、-20）
    const fa = newFA();
    feedPrice(fa, [
        [T0 + 1000, P(100)], [T0 + 3000, P(120)], [T0 + 5000, P(107)], [T0 + 7000, P(96)],
        [T0 + 9000, P(110)], [T0 + 11000, P(107)], [T0 + 13000, P(95)], [T0 + 15000, P(88)],
        [T0 + 17000, P(97)], [T0 + 19000, P(91)],
    ]);
    let f = fa.buildFactorMap('0xtoken', T0 + 19000);
    check('C1 两段深回调：pullN=2、pullMax=20、switchN=4（300s 内全部段）', () => {
        assert.strictEqual(cog(f).pullN, 2);
        assert.strictEqual(cog(f).pullMax, 20);
        assert.strictEqual(cog(f).switchN, 4);
    });
    check('C2 当前上涨腿（谷@88 ts=15000）：riseLegSec=4（19000−15000）、startVsFirst=−12（88/100−1）', () => {
        assert.strictEqual(cog(f).sec, 4);
        assert.strictEqual(cog(f).ampl, 3.41);
        assert.strictEqual(cog(f).startVsFirst, -12);
    });
    // switchN 300s 窗外不计：now 推到 300s 后，legs 全部出窗
    f = fa.buildFactorMap('0xtoken', T0 + 19000 + 301000);
    check('C3 300s 窗外：switchN=0（切换计数只数最近 300s）', () => assert.strictEqual(cog(f).switchN, 0));
    // 从无回调 0 值已在 A2 覆盖；首价缺失场景（_relFirstPriceBnb=0 不可达——registerToken 后首可靠价即首价）跳过
}

console.log('D. 密度三键（10s 窗 act 环）');
{
    // 0.0499 量 → null；0.05 → 出值。先喂窗外旧行让 0xa 首见在窗外（ratio 测非新钱包）
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 - 20000, bnb_amount: 0.5, trader_address: '0xa' })); // 窗外旧行（firstSeen 在窗外）
    const t = (i, amt, trader) => mkTick({ timestamp: T0 + 1000 * (i + 1), bnb_amount: amt, trader_address: trader });
    fa.processTick(t(0, 0.03, '0xa'));
    fa.processTick(t(1, 0.0199, '0xb'));
    let f = fa.buildFactorMap('0xtoken', T0 + 3000);
    check('D1 量 0.0499 <0.05：actTradersPerBnb=null（比值失真）', () => assert.strictEqual(f.actTradersPerBnb, null));
    fa.processTick(t(2, 0.05, '0xb'));
    f = fa.buildFactorMap('0xtoken', T0 + 4000);
    check('D2 量 0.05+：密度=2/0.0999≈20.02、ratio=50（0xb 新 0xa 非新）、avg≈0.0333', () => {
        assert.ok(Math.abs(f.actTradersPerBnb - 20.02) < 0.01, 'density=' + f.actTradersPerBnb);
        assert.strictEqual(f.actNewTradersRatio, 50);
        assert.ok(Math.abs(f.actAvgTradeBnb - 0.0333) < 0.0001, 'avg=' + f.actAvgTradeBnb);
    });
    // null-wallet 行：有量零独立钱包 → density=0 有证据、ratio=null
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: T0 + 1000, bnb_amount: 0.1, trader_address: null, sender_address: null }));
    f = fa2.buildFactorMap('0xtoken', T0 + 1000);
    check('D3 有量零独立钱包：density=0（有证据）、ratio=null', () => {
        assert.strictEqual(f.actTradersPerBnb, 0);
        assert.strictEqual(f.actNewTradersRatio, null);
        assert.strictEqual(f.actAvgTradeBnb, 0.1);
    });
    // 无交易：avg=null
    const fa3 = newFA();
    f = fa3.buildFactorMap('0xtoken', T0 + 1000);
    check('D4 无交易：三键 null（缺证据）', () => {
        assert.strictEqual(f.actAvgTradeBnb, null);
        assert.strictEqual(f.actTradersPerBnb, null);
        assert.strictEqual(f.actNewTradersRatio, null);
    });
    // defer 乱序：晚到旧行 ts 早于 cutoff 不影响窗口值
    const fa4 = newFA();
    fa4.processTick(mkTick({ timestamp: T0 + 20000, bnb_amount: 0.2, trader_address: '0xa' }));
    fa4.processTick(mkTick({ timestamp: T0 + 1000, bnb_amount: 0.5, trader_address: '0xb' })); // 旧行晚到
    f = fa4.buildFactorMap('0xtoken', T0 + 20000);
    check('D5 defer 旧行晚到：密度只计窗内行（1 钱包/0.2=5）', () => assert.strictEqual(f.actTradersPerBnb, 5));
}

console.log('E. 探针 + 快照 + 源码口径');
{
    const KEYS = ['riseLegSec', 'riseLegAmplPct', 'riseConcentrationPct', 'launchPullbackN', 'launchMaxPullbackPct', 'riseLegStartVsFirstPct', 'swingDirSwitchN', 'actTradersPerBnb', 'actNewTradersRatio', 'actAvgTradeBnb'];
    const fa = newFA();
    check('E1 getFactorKeys 探针含十键', () => {
        const keys = fa.getFactorKeys();
        for (const k of KEYS) assert.ok(keys.has(k), '缺键 ' + k);
    });
    check('E2 FactorBuilder 快照：{} 下十键在位且 null（缺键不掩盖）', () => {
        const snap = FactorBuilder.buildFactorValuesForTimeSeries({});
        for (const k of KEYS) assert.strictEqual(snap[k], null, k + ' 应 null');
    });
    const faSrc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    check('E3 源码口径：TREND_SWING_PCT=10 / require detectSwings / _trendCognitionFactors 禁 Date.now', () => {
        assert.ok(/const TREND_SWING_PCT = 10;/.test(faSrc), '摆动阈值常量');
        assert.ok(/require\('\.\.\/market-analysis\/buy-point-snapshot'\)/.test(faSrc), 'detectSwings require');
        const body = faSrc.slice(faSrc.indexOf('_trendCognitionFactors(state, now)'), faSrc.indexOf('净买窗三键'));
        assert.ok(!/Date\.now/.test(body), '禁 Date.now');
    });
    check('E4 源码口径：FactorBuilder 白名单十行 ?? null', () => {
        for (const k of KEYS) assert.ok(fbSrc.includes(`${k}: factorResults.${k} ?? null`), k + ' 白名单行');
    });
}

console.log(`\n============================================================`);
console.log(`上涨趋势认知因子族单测：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
