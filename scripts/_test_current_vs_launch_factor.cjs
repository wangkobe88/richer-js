#!/usr/bin/env node
/**
 * T122 currentVsLaunchPct（现价较发行价涨幅）单测（2026-11-07 接近发行价臂）——
 * 本地零 DB 零网络。
 *
 * 键语义（用户裁定「参考购买前检测中『接近发布价』的判断」）：BP
 * currentVsLaunchPct 同口径——分子分母同可靠价链（_relPriceBnb/_relFirstPriceBnb
 * = BP snapshot 的 arc.last/rel[0]），near_launch 判据=≤+50% 含破发；null=未见
 * 可靠价 fail-closed（裸比较恒 false 不触发=宁拦不冒充）。与 TPAPre_asofRelFirst
 * （TPA 审批时刻冻结快照）语义刻意分开——本键实时。
 *
 * 覆盖：
 *   A. 精确值（+50 恰界/+150/破发 -50/toFixed 舍入）
 *   B. 首可靠价冻结基准（多笔上涨后仍按首笔）
 *   C. 无可靠价 null（零 tick / 仅尘 tick 不进价链）
 *   D. getFactorKeys 探针含键（未知因子三防线）
 *   E. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   F. TPA asofRelFirst 冻结键与实时键分开（setAsofMs 后价再涨两键分叉）
 *   G. 源码口径锁（发射公式形状=可靠价链双哨兵；与 marketCap 任意价轨分开）
 *
 * 用法：node scripts/_test_current_vs_launch_factor.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
    price_bnb: 1.0 * 1e-9, price_usd: 0.0006, bnb_amount: 1, token_amount: 1000000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. 精确值 ═══════════════
console.log('A. 精确值（可靠价链 现价/首可靠价−1）');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000, block_number: 100 }));
    fa.processTick(mkTick({ price_bnb: 1.5 * 1e-9, timestamp: T0 + 2000, block_number: 101 }));
    check('1.0→1.5 = +50 恰界（near_launch 判据 ≤50 含边界）', () =>
        assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 50));

    const faUp = newFA();
    faUp.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faUp.processTick(mkTick({ price_bnb: 2.5 * 1e-9, timestamp: T0 + 2000 }));
    check('1.0→2.5 = +150（已脱离发行价区）', () =>
        assert.strictEqual(faUp.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 150));

    const faDn = newFA();
    faDn.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faDn.processTick(mkTick({ price_bnb: 0.5 * 1e-9, timestamp: T0 + 2000 }));
    check('破发 1.0→0.5 = -50（含破发=贴发行价区）', () =>
        assert.strictEqual(faDn.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, -50));

    const faR = newFA();
    faR.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faR.processTick(mkTick({ price_bnb: 1.1234 * 1e-9, timestamp: T0 + 2000 }));
    check('toFixed(2) 舍入 12.34', () =>
        assert.strictEqual(faR.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 12.34));

    const faFlat = newFA();
    faFlat.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    check('恰首价 → 0（有证据零值）', () =>
        assert.strictEqual(faFlat.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, 0));
}

// ═══════════════ B. 首可靠价冻结 ═══════════════
console.log('B. 基准=首个可靠价（T98 尘门同源 _relFirstPriceBnb 冻结语义）');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 2.0 * 1e-9, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ price_bnb: 3.0 * 1e-9, timestamp: T0 + 2000 }));
    fa.processTick(mkTick({ price_bnb: 4.0 * 1e-9, timestamp: T0 + 3000 }));
    check('三笔上涨后仍按首笔 2.0（4/2−1=+100）', () =>
        assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 3000).currentVsLaunchPct, 100));
}

// ═══════════════ C. 无可靠价 null ═══════════════
console.log('C. 未见可靠价 → null fail-closed（裸比较恒 false 不触发）');
{
    const fa0 = newFA();
    check('零 tick → null', () =>
        assert.strictEqual(fa0.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, null));

    const faDust = newFA();
    faDust.processTick(mkTick({ bnb_amount: 0.00001, timestamp: T0 + 1000 }));
    check('仅尘 tick（不进价链）→ null', () =>
        assert.strictEqual(faDust.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, null));
}

// ═══════════════ H. 平台常量锚（2026-11-08 发行价口径修正）═══════════════
console.log('H. 平台 curve 常量锚（four.meme 主流档/flap 主力档；quote 盘 2026-11-09 起同 FL 常量；gang=null 旧口径）');
{
    const FM = 4496173469e-18, FL = 6.14 / (107036752 + 1e9);
    // four.meme：分母=主流档常量（首单滑点 +35.2% 不再抬锚——现价 1.5×常量 → +50
    // 而非旧口径 10.95=1.5/1.352−1）
    const faFm = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faFm.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    faFm.processTick(mkTick({ price_bnb: FM * 1.352, timestamp: T0 + 1000 }));
    faFm.processTick(mkTick({ price_bnb: FM * 1.5, timestamp: T0 + 2000 }));
    check('fourmeme 分母=主流档常量（首价滑点 +35.2% 不抬锚：+50 非旧口径 10.95）', () =>
        assert.strictEqual(faFm.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 50));

    // four.meme 破发臂：1.1×FM → 0.8×FM。T134 起滚动地板=0.8×FM（运行期新低
    // 下移锚）→ 现价恰为滚动 min → 0（T134 前常量口径 -20；「较发行价」语义在
    // 锚下移后=「较历史最低」——地板只降不升）
    const faFmD = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faFmD.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    faFmD.processTick(mkTick({ price_bnb: FM * 1.1, timestamp: T0 + 1000 }));
    faFmD.processTick(mkTick({ price_bnb: FM * 0.8, timestamp: T0 + 2000 }));
    check('fourmeme 破发新低=滚动地板（现价即 min → 0；T134 前 -20）', () =>
        assert.strictEqual(faFmD.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 0));

    // flap BNB 盘：分母=主力档常量（无 quote_token 行）
    const faFl = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faFl.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'flap' });
    faFl.processTick(mkTick({ price_bnb: FL, timestamp: T0 + 1000 }));
    faFl.processTick(mkTick({ price_bnb: FL * 2, timestamp: T0 + 2000 }));
    check('flap BNB 盘分母=主力档常量（首价即常量 → +100）', () =>
        assert.strictEqual(faFl.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 100));

    // flap quote 盘：2026-11-09 用户裁定「落码吧，quote 盘也直接用常量」——182 实证
    // 11/11 有成交 quote 盘票首 tick=FL 常量 1.00x（p50=5.55e-9）；赵公主案首 tick
    // 口径 +38.5% 实为常量口径 +107.3%>40 放走 -0.0867 引出。首 tick=2×常量（模拟
    // 开盘冲击后，如赵公主 8.26e-9=×1.49）、现价 3×常量：常量口径 +200、旧口径 +50
    // ——数值互异锁死常量分母（quote_token 标记不再分流）
    const faQ = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faQ.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'flap' });
    faQ.processTick(mkTick({ price_bnb: FL * 2, timestamp: T0 + 1000, quote_token: '0xquote' }));
    faQ.processTick(mkTick({ price_bnb: FL * 3, timestamp: T0 + 2000, quote_token: '0xquote' }));
    check('flap quote 盘=FL 常量分母（3FL/FL−1=+200，旧口径首可靠价会得 +50）', () =>
        assert.strictEqual(faQ.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 200));

    // gang：已停未调研 → 旧口径
    const faG = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faG.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'gang' });
    faG.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faG.processTick(mkTick({ price_bnb: 2.0 * 1e-9, timestamp: T0 + 2000 }));
    check('gang=旧口径首可靠价（+100）', () =>
        assert.strictEqual(faG.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 100));
}

// ═══════════════ I. T130 地板补丁（2026-11-09，67ad68e0/6efa11ce 案）═══════════════
// 用户裁定「如果代币首次购买价格低于我们配置的代币初始价格，那么地板改为首次购买价」
// ——launch 锚=min(平台常量, 首笔买入可靠价)。低开票（flap quote 盘 -4.9%/-20.2% 实证）
// 以常量为地板会把 currentVsLaunchPct 整体抬高（首 tick 即 +20%=low 档），near_launch/
// almost_launch 位置判定系统性失真。state._firstBuyPriceBnb write-once 只认 BUY。
console.log('I. T130 地板补丁（launch=min(常量, 首笔买入可靠价)）');
{
    const FM = 4496173469e-18;
    // I1 低开票：首笔 buy 0.8×FM（-20%）→ 地板=首买价；现价 1.0×FM → +25
    //（常量锚下显 0=发行价即视；near_launch ≤40 判定随锚修正——6efa11ce 案形状）
    const faLow = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faLow.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    faLow.processTick(mkTick({ price_bnb: FM * 0.8, timestamp: T0 + 1000 }));
    faLow.processTick(mkTick({ price_bnb: FM * 1.0, timestamp: T0 + 2000 }));
    check('I1 低开票地板=首买价 0.8×FM（现价 1.0×FM → +25 非常量口径 0）', () =>
        assert.strictEqual(faLow.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 25));

    // I2 高开不降锚：首笔 buy 1.5×FM > 常量 → 地板=常量原值（min 语义只降不升）；
    // 现价 1.2×FM → +20
    const faHigh = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faHigh.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    faHigh.processTick(mkTick({ price_bnb: FM * 1.5, timestamp: T0 + 1000 }));
    faHigh.processTick(mkTick({ price_bnb: FM * 1.2, timestamp: T0 + 2000 }));
    check('I2 高开票地板=常量原值（min 语义；1.2×FM → +20 非旧首可靠价口径 -20）', () =>
        assert.strictEqual(faHigh.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 20));

    // I3 T134 起 sell 低价入地板：首笔可靠价 sell 0.7×FM 也是真实成交价 → 滚动
    // min=0.7×FM=地板（T130 首 buy 0.9 口径给 +5 已退役——write-once
    // _firstBuyPriceBnb 仍只认 BUY 但发射层原料已换 _minRelPriceBnb）；现价
    // 0.945×FM → +35
    const faSellFirst = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faSellFirst.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    faSellFirst.processTick(mkTick({ price_bnb: FM * 0.7, timestamp: T0 + 1000, trade_type: 'sell' }));
    faSellFirst.processTick(mkTick({ price_bnb: FM * 0.9, timestamp: T0 + 2000, trade_type: 'buy' }));
    faSellFirst.processTick(mkTick({ price_bnb: FM * 0.945, timestamp: T0 + 3000 }));
    check('I3 sell 低价入滚动地板（min=0.7×FM；0.945/0.7−1 → +35 非 T130 首 buy 口径 +5）', () =>
        assert.strictEqual(faSellFirst.buildFactorMap('0xtoken', T0 + 3000).currentVsLaunchPct, 35));

    // I4 无常量平台（gang）不应用地板（floorLaunchPriceBnb 返回 null → 旧口径
    // 首可靠价；首笔 buy 0.8e-9 → 现价 1.6e-9 → +100）
    const faGang = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faGang.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'gang' });
    faGang.processTick(mkTick({ price_bnb: 0.8 * 1e-9, timestamp: T0 + 1000 }));
    faGang.processTick(mkTick({ price_bnb: 1.6 * 1e-9, timestamp: T0 + 2000 }));
    check('I4 gang 无常量=旧口径首可靠价（+100）', () =>
        assert.strictEqual(faGang.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 100));

    // I5 源码锁：地板接线在 currentVsLaunchPct 发射（_floorLaunchPriceBnb 包
    // _resolveLaunchPriceBnb；_firstBuyPriceBnb write-once 冻结点=priceReliable 块；
    // T134 滚动 min 更新点同块、发射层两处原料=_minRelPriceBnb）
    const srcI = read('src/services/FourMemeFactorAggregator.js');
    ok('I5 源码锁（发射=地板包裹常量锚 ?? 首可靠价；冻结点 isBuy write-once；T134 滚动 min 更新+两发射点换参）',
        srcI.includes('_floorLaunchPriceBnb(')
        && srcI.includes('state._firstBuyPriceBnb === 0 && isBuy')
        && srcI.includes('state._firstBuyPriceBnb = priceBnb')
        && srcI.includes('state._minRelPriceBnb === 0 || priceBnb < state._minRelPriceBnb')
        && srcI.includes('state._minRelPriceBnb || state._firstBuyPriceBnb')
        // 滚动更新点必须在 famous 计数写点之前（同 tick 锚已含本笔价）——indexOf 序锁
        && srcI.indexOf('state._minRelPriceBnb === 0 || priceBnb < state._minRelPriceBnb')
            < srcI.indexOf('this._countFamousNearLaunchBuy(state, priceBnb)'));
}

// ═══════════════ J. T134 滚动地板（2026-11-11 v100 族一 9/9 案）═══════════════
// 用户方案三「如果出现价格比首交易/配置价格更低，那么以其为准」——launch 锚=
// min(常量, 首买价, ≤t 滚动最低可靠价)。族一案主体=首买后运行期跌出新低而锚不动
//（idx2 -29.3%/idx192 -31.7%/idx180 -27.9% 均 min 在首买后）；不限 BUY（sell 低价
// 同样是真实成交价）；锚只降不升（回升不回拨）。
console.log('J. T134 滚动地板（launch=min(常量, 首买, ≤t 滚动最低可靠价)）');
{
    const FM = 4496173469e-18;
    const newFm = () => {
        const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
        fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
        return fa;
    };

    // J1 族一案主形状：首买 1.0×FM（常量域）→ 运行期新低 0.75×FM（sell，T134 前锚
    // 不动）→ 回升 0.9×FM。滚动地板=0.75×FM → +20（T130/常量口径=−10）
    const faJ1 = newFm();
    faJ1.processTick(mkTick({ price_bnb: FM * 1.0, timestamp: T0 + 1000, trade_type: 'buy' }));
    faJ1.processTick(mkTick({ price_bnb: FM * 0.75, timestamp: T0 + 2000, trade_type: 'sell' }));
    faJ1.processTick(mkTick({ price_bnb: FM * 0.9, timestamp: T0 + 3000 }));
    check('J1 运行期新低下移锚（0.75×FM 地板；0.9/0.75−1=+20 非常量口径 −10）', () =>
        assert.strictEqual(faJ1.buildFactorMap('0xtoken', T0 + 3000).currentVsLaunchPct, 20));

    // J2 锚只降不升：J1 后再涨到 1.4×FM → 1.4/0.75−1≈+86.67（锚滞留新低不回拨）
    faJ1.processTick(mkTick({ price_bnb: FM * 1.4, timestamp: T0 + 4000 }));
    check('J2 回升不回拨（锚滞留 0.75×FM → +86.67）', () =>
        assert.strictEqual(faJ1.buildFactorMap('0xtoken', T0 + 4000).currentVsLaunchPct, 86.67));

    // J3 低开+运行期新低复合（idx2/-29.3% 形状）：首买 0.8×FM → 新低 0.7×FM →
    // 回升 0.85×FM → 地板=0.7×FM（低开首买价被更深新低覆盖）
    const faJ3 = newFm();
    faJ3.processTick(mkTick({ price_bnb: FM * 0.8, timestamp: T0 + 1000, trade_type: 'buy' }));
    faJ3.processTick(mkTick({ price_bnb: FM * 0.7, timestamp: T0 + 2000, trade_type: 'sell' }));
    faJ3.processTick(mkTick({ price_bnb: FM * 0.85, timestamp: T0 + 3000 }));
    check('J3 低开+新低复合（地板=更深新低 0.7×FM → +21.43）', () =>
        assert.strictEqual(faJ3.buildFactorMap('0xtoken', T0 + 3000).currentVsLaunchPct, 21.43));

    // J4 乱序 min 收敛：同三笔价以不同顺序喂（defer 乱序回推形状），再补一笔统一
    // 现价 0.9×FM——锚（min）是交换律统计量任意序一致；_relPriceBnb=最后到达价
    // 依赖喂序（既有机制），故锚收敛用统一末笔观测
    const mkJ4 = (order) => {
        const fa = newFm();
        const px = { a: FM * 0.9, b: FM * 0.7, c: FM * 1.2 };
        order.forEach((k, i) => fa.processTick(mkTick({ price_bnb: px[k], timestamp: T0 + 1000 + i, block_number: 100 + i })));
        fa.processTick(mkTick({ price_bnb: FM * 0.9, timestamp: T0 + 5000, block_number: 200 }));
        return fa.buildFactorMap('0xtoken', T0 + 5000).currentVsLaunchPct;
    };
    check('J4 乱序 min 收敛（三序锚全=0.7×FM → 0.9/0.7−1≈+28.57）', () => {
        const v1 = mkJ4(['a', 'b', 'c']), v2 = mkJ4(['c', 'b', 'a']), v3 = mkJ4(['b', 'a', 'c']);
        assert.strictEqual(v1, 28.57);
        assert.strictEqual(v1, v2);
        assert.strictEqual(v1, v3);
    });

    // J5 min 高于常量不降锚：全程 1.2~1.5×FM（高开票）→ 地板=常量原值
    const faJ5 = newFm();
    faJ5.processTick(mkTick({ price_bnb: FM * 1.5, timestamp: T0 + 1000, trade_type: 'buy' }));
    faJ5.processTick(mkTick({ price_bnb: FM * 1.2, timestamp: T0 + 2000 }));
    check('J5 min>常量不降锚（地板=常量 → 1.2×FM → +20）', () =>
        assert.strictEqual(faJ5.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 20));

    // J6 outlier/尘 tick 不进滚动 min（价格链同门：_acceptPrice 离群门与尘门都不入
    // 可靠价链 → 假低点不砸锚）。FA 侧离群门=1000 倍粗门（OUTLIER_RATIO）且需
    // recent≥3——先喂 3 笔常量域价填窗再喂 0.0005×FM 假低点（2000 倍偏离确定性拒收）
    const faJ6 = newFm();
    faJ6.processTick(mkTick({ price_bnb: FM * 1.0, timestamp: T0 + 1000, trade_type: 'buy' }));
    faJ6.processTick(mkTick({ price_bnb: FM * 1.0, timestamp: T0 + 1500 }));
    faJ6.processTick(mkTick({ price_bnb: FM * 1.0, timestamp: T0 + 2000 }));
    faJ6.processTick(mkTick({ price_bnb: FM * 0.0005, timestamp: T0 + 2500 })); // 1000 倍粗离群门拒收
    faJ6.processTick(mkTick({ bnb_amount: 0.00001, price_bnb: FM * 0.2, timestamp: T0 + 3000 })); // 尘门拒收
    faJ6.processTick(mkTick({ price_bnb: FM * 0.95, timestamp: T0 + 4000 }));
    check('J6 outlier/尘假低点不砸锚（地板=0.95×FM → 0）', () =>
        assert.strictEqual(faJ6.buildFactorMap('0xtoken', T0 + 4000).currentVsLaunchPct, 0));
}


console.log('D. getFactorKeys 探针含键（未知因子三防线自动认得）');
{
    const fa = newFA();
    check('探针收键', () => assert.ok(fa.getFactorKeys().has('currentVsLaunchPct')));
}

// ═══════════════ E. FactorBuilder 快照透传 ═══════════════
console.log('E. FactorBuilder 快照透传（缺键 → null 不掩盖）');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({ currentVsLaunchPct: 35.2 });
    check('透传 35.2', () => assert.strictEqual(snap.currentVsLaunchPct, 35.2));
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('旧 FA 缺键 → null', () => assert.strictEqual(snapOld.currentVsLaunchPct, null));
}

// ═══════════════ F. TPA 冻结键与实时键分开 ═══════════════
console.log('F. TPAPre_asofRelFirst（冻结）与 currentVsLaunchPct（实时）语义分开');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ price_bnb: 1.2 * 1e-9, timestamp: T0 + 2000 }));
    fa.setAsofMs('0xtoken', T0 + 2000); // TPA 审批时刻冻结 +20%
    fa.processTick(mkTick({ price_bnb: 1.5 * 1e-9, timestamp: T0 + 3000 }));
    const f = fa.buildFactorMap('0xtoken', T0 + 3000);
    check('冻结键停在 +20 / 实时键推进 +50', () => {
        assert.ok(Math.abs(f.TPAPre_asofRelFirst - 20) < 1e-9, `asofRelFirst=${f.TPAPre_asofRelFirst}`); // 冻结值未舍入（浮点原值）
        assert.strictEqual(f.currentVsLaunchPct, 50); // 实时键 toFixed(2)
    });
}

// ═══════════════ G. 源码口径锁 ═══════════════
console.log('G. 源码口径断言');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    ok('G 发射公式=分母常量锚优先（platform curve 常量 ?? 首可靠价回退；分子 _relPriceBnb>0 哨兵——不用任意价轨 currentPriceBnb）',
        src.includes('currentVsLaunchPct: (() => {')
        && src.includes('_resolveLaunchPriceBnb(state.platform, state.quoteToken)')
        && src.includes('?? state._relFirstPriceBnb'));
    ok('G 常量模块锁（four.meme 主流档 raw 4496173469 wei / flap BNB 盘 r=6.14,h=107036752——零依赖叶子防循环依赖）',
        read('src/market-analysis/launch-price.js').includes('4496173469e-18')
        && read('src/market-analysis/launch-price.js').includes('6.14 / (107036752 + 1e9)'));
    ok('G 回测同源（as-of 冻结键 _asofRelFirst 同分母首可靠价——BP 对拍口径一致）',
        src.includes('_asofRelFirst = ((state._relPriceBnb - state._relFirstPriceBnb) / state._relFirstPriceBnb) * 100'));
    const fb = read('src/trading-engine/core/FactorBuilder.js');
    ok('G 快照白名单透传（?? null 不掩盖）', fb.includes('currentVsLaunchPct: factorResults.currentVsLaunchPct ?? null'));
}
function ok(name, cond) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); }
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
