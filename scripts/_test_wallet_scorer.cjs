#!/usr/bin/env node
/**
 * wallet-scorer 单测（pumpfun 回迁批 4；零 DB 纯函数）
 *
 * 覆盖（plan 条目 17）：
 *   1) DEFAULT_PARAMS BSC 锚点（×0.4 换算防漂移）
 *   2) scoreV1 曲线：vol/avg log-linear 锚点 + hold flat 0.25 + bad 维恒 0
 *   3) fallback：scoreFallback → 固定 3.2
 *   4) 恶意 cap 阶梯：ramp [0.45,0.6) 插值 / 锚点 0.6/0.8/0.95/1.0 / <0.45 不罚
 *   5) 大户偶发豁免 exempt：400tok+40BNB+50eff+脏度≤0.03+effBadRatio<0.8（各反例逐条拆）
 *   6) lowVol cap：锚点 0/1.2/4，min 语义
 *   7) Tier2 乘法衰减：ratio/count 锚点 + 双乘
 *   8) badActionByHuman cap 0.5 + sniper 豁免 + creator 豁免 sniper（setBadActionByHumanSet 注入后还原）
 *   9) low-level / tiny-level cap（badExempt 补充层；门与插值）
 *  10) classifyHolder 四桶优先级：new_wallet<3 > zhuang > retail(sniper300/tc>100) > neutral；
 *      sniper 否决、creator 豁免、人工标覆盖
 *  11) computeZhuangRetail 加权聚合 + 散=0 → computeZhuangRetailRatio Infinity
 *  12) scoreTokenFromHolders 聚合 + topN 切片 + lowFloat 惩罚 + creator 新钱包中性分 1.5
 *      + BSC 新钱包中性分 2.2（用户 2026-09-29 裁定先观察：非 creator、source=realtime、
 *        tokenCount<=1、只升不降；creator 维持 1.5 档不叠加；offline 系不豁免）
 *
 * 用法：node scripts/_test_wallet_scorer.cjs
 */

const {
    scoreProfile, scoreTokenFromHolders, aggregateTokenScore, applyLowFloatPenalty,
    classifyHolder, classifyHolderDetail, zhuangSubtype,
    computeZhuangRetail, computeZhuangRetailRatio,
    DEFAULT_PARAMS, NEW_WALLET_NEUTRAL_SCORE, setBadActionByHumanSet, isSniperLikeProfile,
} = require('../src/services/wallet-scorer');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function eq(actual, expected, msg) { ok(actual === expected, `${msg}（期望 ${expected}）`, actual); }
function approx(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg}（期望 ${b}±${eps}）`, a); }

// ─────────── profile 工厂（无 bad 候选的中性底座，按需覆盖） ───────────
function mkProfile(o = {}) {
    return Object.assign({
        tokenCount: 50, rawTotal: 50,
        totalBnb: 80, avgBnb: 4,           // vol/avg 双满（2+2）
        buyCount: 10, sellCount: 10, tickCount: 20, aggregatedTradeCount: 20,
        buckets: { total: 50, dust: 0, tiny: 0, small: 0, medium: 0, big: 0 },
        lowTinyRatio: 0,
        earlyLargeBuyCount: 0, crashLargeSellCount: 0,
        badBuyCount: 0, badSellCount: 0, badCount14d: 0,
        effectiveTradeCount: 60, largeTradeCount: 10,
        tier2Ratio: null, tier2CrashBlockSellCount: 0,
        medianHoldSeconds: null, badBuyRatio: 0, badSellRatio: 0,
    }, o);
}

// ═══════════════ 1. DEFAULT_PARAMS 锚点 ═══════════════
{
    const p = DEFAULT_PARAMS;
    eq(p.volFloor, 0.4, 'volFloor=0.4（1 SOL ×0.4）');
    eq(p.volCeil, 80, 'volCeil=80');
    eq(p.volMax, 2.0, 'volMax=2.0');
    eq(p.avgFloor, 0.04, 'avgFloor=0.04');
    eq(p.avgCeil, 4, 'avgCeil=4');
    eq(p.avgMax, 2.0, 'avgMax=2.0');
    eq(p.badRatioRampStart, 0.45, 'badRatioRampStart=0.45');
    eq(p.badRatioMidPenalty, 0.6, 'badRatioMidPenalty=0.6');
    eq(p.badRatioHigh, 0.8, 'badRatioHigh=0.8');
    eq(p.badRatioSevere, 0.95, 'badRatioSevere=0.95');
    eq(p.maliciousRampCeiling, 3.2, 'maliciousRampCeiling=3.2');
    eq(p.maliciousFloorMid, 2.4, 'maliciousFloorMid=2.4');
    eq(p.maliciousFloorHigh, 0.8, 'maliciousFloorHigh=0.8');
    eq(p.maliciousFloorSevere, 0.4, 'maliciousFloorSevere=0.4');
    eq(p.maliciousFloorPure, 0.24, 'maliciousFloorPure=0.24');
    eq(p.fallbackScore, 3.2, 'fallbackScore=3.2');
    eq(p.holdFlatScore, 0.25, 'holdFlatScore=0.25（flat 不奖不罚）');
    eq(p.lowVolThreshold, 4, 'lowVolThreshold=4');
    eq(p.lowVolMidBnb, 1.2, 'lowVolMidBnb=1.2');
    eq(p.lowVolFloorZero, 1.6, 'lowVolFloorZero=1.6');
    eq(p.lowVolFloorMid, 2.0, 'lowVolFloorMid=2.0');
    eq(p.lowVolCeilingHigh, 2.4, 'lowVolCeilingHigh=2.4');
    eq(p.lowFloat.walletHoldingPctThresh, 12, 'lowFloat.walletHoldingPctThresh=12');
    eq(p.lowFloat.penaltyCeiling, 2.0, 'lowFloat.penaltyCeiling=2.0');
    eq(p.exemptTokenCountMin, 400, 'exemptTokenCountMin=400');
    eq(p.exemptTotalBnbMin, 40, 'exemptTotalBnbMin=40');
    eq(p.exemptEffectiveTradeMin, 50, 'exemptEffectiveTradeMin=50');
    eq(p.exemptBadRatioMax, 0.03, 'exemptBadRatioMax=0.03');
    eq(p.exemptEffBadRatioMax, 0.8, 'exemptEffBadRatioMax=0.8');
    eq(p.llCandThreshold, 3, 'llCandThreshold=3');
    eq(p.llSevereThreshold, 0.95, 'llSevereThreshold=0.95');
    eq(p.llSevereFloor, 0.4, 'llSevereFloor=0.4');
    eq(p.tinyLevel.candThreshold, 10, 'tinyLevel.candThreshold=10');
    eq(p.tinyLevel.effThreshold, 0.8, 'tinyLevel.effThreshold=0.8');
    eq(JSON.stringify(p.tinyLevel.effAnchors), JSON.stringify([[0.8, 1.5], [0.9, 0.9], [1.0, 0.4]]), 'tinyLevel.effAnchors');
    eq(p.lltlExtended, null, 'lltlExtended 默认 null（扩展档关）');
    eq(p.tier2.ratioThreshold, 0.05, 'tier2.ratioThreshold=0.05');
    eq(p.tier2.countThreshold, 10, 'tier2.countThreshold=10');
    eq(p.tier2.ratioFloor, 0.02, 'tier2.ratioFloor=0.02');
}

// ═══════════════ 2. scoreV1 曲线（无 bad 候选 → badExempt，无任何 cap）═══════════════
{
    // vol 锚点（avgBnb=0 → dim2=0；总分=vol+0.25）
    eq(scoreProfile(mkProfile({ totalBnb: 0.4, avgBnb: 0 })).score, 0.25, 'vol=0.4（≤floor）→0 + hold 0.25');
    eq(scoreProfile(mkProfile({ totalBnb: 0.2, avgBnb: 0 })).score, 0.25, 'vol<floor →0');
    eq(scoreProfile(mkProfile({ totalBnb: 80, avgBnb: 0 })).score, 2.25, 'vol=80（≥ceil）→2 + 0.25');
    approx(scoreProfile(mkProfile({ totalBnb: 4, avgBnb: 0 })).score, 1.119, 1e-9, 'vol=4 →0.869（log10 线性）');
    approx(scoreProfile(mkProfile({ totalBnb: 40, avgBnb: 0 })).score, 1.988, 1e-9, 'vol=40 →1.738（t=2/log10(200)=0.8692）');

    // avg 锚点（totalBnb=80 → vol 满 2）
    eq(scoreProfile(mkProfile({ avgBnb: 0.04 })).score, 2.25, 'avg=0.04（≤floor）→0');
    eq(scoreProfile(mkProfile({ avgBnb: 4 })).score, 4.25, 'avg=4（≥ceil）→2；总 2+2+0.25=4.25');
    approx(scoreProfile(mkProfile({ avgBnb: 0.2 })).score, 2.949, 1e-9, 'avg=0.2 →0.699');
    approx(scoreProfile(mkProfile({ avgBnb: 2 })).score, 3.949, 1e-9, 'avg=2 →1.699');

    // bad 维恒 0（无候选 → badExempt；dim3 不加分）
    const r = scoreProfile(mkProfile());
    eq(r.breakdown.bad.score, 0, 'bad 维恒 0（只降不加）');
    eq(r.breakdown.bad.exempt, true, '无候选 → badExempt=true');
    eq(r.breakdown.hold.flat, true, 'hold flat 标记');
    eq(r.breakdown.hold.score, 0.25, 'hold=0.25');
    eq(r.fallback, false, '非 fallback');
    eq(r.version, 'v1', 'version=v1');
    eq(r.strategy, 'v1', 'strategy=v1');
}

// ═══════════════ 3. fallback ═══════════════
{
    const r = scoreProfile(mkProfile({ scoreFallback: true }));
    eq(r.score, 3.2, 'fallback 固定 3.2');
    eq(r.fallback, true, 'fallback 标记');
    eq(r.breakdown.hold.score, 0, 'fallback breakdown hold=0');
}

// ═══════════════ 4. 恶意 cap 阶梯（vol/avg 双满 4.25 作被压底座）═══════════════
{
    // effBadRatio = (badBuy+badSell)/(earlyBuy+crashSell)，crashSell=0 时 = badBuy/earlyBuy
    const capAt = (badBuy, earlyBuy) => {
        const r = scoreProfile(mkProfile({ badBuyCount: badBuy, earlyLargeBuyCount: earlyBuy }));
        return r;
    };
    // <0.45 不罚
    {
        const r = capAt(4, 10); // 0.4
        eq(r.score, 4.25, 'effBadRatio=0.4 <0.45 rampStart → 不罚满分');
        eq(r.breakdown.maliciousCap.applied, false, '0.4 cap 不触发');
        eq(r.breakdown.maliciousCap.capValue, null, '0.4 capValue=null');
    }
    // ramp 起点锚 0.45 → 3.2
    {
        const r = capAt(45, 100); // 0.45
        eq(r.score, 3.2, 'effBadRatio=0.45 → ramp 锚 3.2');
        eq(r.breakdown.maliciousCap.capValue, 3.2, '0.45 capValue=3.2');
    }
    // ramp 段中点 0.5 插值 2.933
    {
        const r = capAt(5, 10); // 0.5
        approx(r.score, 2.933, 1e-9, 'effBadRatio=0.5 → ramp 插值 2.933');
        approx(r.breakdown.maliciousCap.capValue, 2.933, 1e-9, '0.5 capValue=2.933');
        eq(r.breakdown.maliciousCap.reason, 'ramp', '0.5 reason=ramp');
    }
    // 锚点 0.6 → 2.4
    {
        const r = capAt(6, 10);
        approx(r.score, 2.4, 1e-9, 'effBadRatio=0.6 → 2.4');
        eq(r.breakdown.maliciousCap.reason, 'mid', '0.6 reason=mid');
    }
    // 0.9（[0.8,0.95) 段插值 0.533）
    {
        const r = capAt(9, 10);
        approx(r.score, 0.533, 1e-9, 'effBadRatio=0.9 → 0.533');
    }
    // 锚点 0.95 → 0.4
    {
        const r = capAt(95, 100);
        approx(r.score, 0.4, 1e-9, 'effBadRatio=0.95 → 0.4');
        eq(r.breakdown.maliciousCap.reason, 'severe', '0.95 reason=severe');
    }
    // 1.0 → 0.24
    {
        const r = capAt(10, 10);
        approx(r.score, 0.24, 1e-9, 'effBadRatio=1.0 → 纯恶意地板 0.24');
    }
    // 汇总口径（buy+sell 合并分母）：buy 3/10 + sell 1/10 → effBadRatio=0.4 <0.45 不罚（旧 max 口径 sellRatio=1.0 会误罚）
    {
        const r = scoreProfile(mkProfile({
            badBuyCount: 3, earlyLargeBuyCount: 10,
            badSellCount: 1, crashLargeSellCount: 10, badSellRatio: 1.0,
        }));
        eq(r.score, 4.25, '汇总口径 0.4 不罚（max 口径防回归）');
        eq(r.breakdown.maliciousCap.applied, false, '汇总分母 cap 不触发');
    }
    // hasDenom 门：earlyBuy=0 且 crashSell=0 → 豁免（effBadRatio=0）
    {
        const r = scoreProfile(mkProfile({ badBuyCount: 5, earlyLargeBuyCount: 0 }));
        eq(r.breakdown.bad.exempt, true, '无分母候选 → badExempt');
        eq(r.score, 4.25, '无分母不罚');
    }
}

// ═══════════════ 5. 大户偶发豁免（exempt）═══════════════
{
    // 命中全部豁免条件：tok≥400 + BNB≥40 + eff≥50 + 脏度≤0.03 + effBadRatio<0.8
    {
        const r = scoreProfile(mkProfile({
            tokenCount: 400, totalBnb: 50, effectiveTradeCount: 60, badCount14d: 1, // 脏度 1/60≈0.017 ≤0.03
            badBuyCount: 7, earlyLargeBuyCount: 10,   // effBadRatio=0.7 <0.8
        }));
        eq(r.breakdown.maliciousCap.incidentalExempt, true, '豁免命中');
        eq(r.breakdown.maliciousCap.reason, 'incidental_exempt', '豁免 reason');
        eq(r.breakdown.maliciousCap.applied, false, '豁免 → cap 不 applied');
        // 底座 totalBnb=50（豁免条件要求 ≥40）：vol(50)=1.823 + avg 2 + hold 0.25 = 4.073
        approx(r.score, 4.073, 1e-9, '豁免 → 不压（底座 4.073）');
    }
    // 反例 1：tokenCount 不足
    {
        const r = scoreProfile(mkProfile({
            tokenCount: 100, totalBnb: 50, effectiveTradeCount: 60, badCount14d: 1,
            badBuyCount: 7, earlyLargeBuyCount: 10,
        }));
        eq(r.breakdown.maliciousCap.incidentalExempt, false, 'tok<400 不豁免');
        approx(r.score, 1.6, 1e-9, 'tok<400 → 0.7 为 [0.6,0.8) 段中点插值 (2.4+0.8)/2=1.6');
    }
    // 反例 2：effBadRatio ≥0.8（靶率上限）
    {
        const r = scoreProfile(mkProfile({
            tokenCount: 400, totalBnb: 50, effectiveTradeCount: 60, badCount14d: 1,
            badBuyCount: 8, earlyLargeBuyCount: 10,   // 0.8 不满足 <0.8
        }));
        eq(r.breakdown.maliciousCap.incidentalExempt, false, 'effBadRatio≥0.8 不豁免（专项异常户）');
        approx(r.score, 0.8, 1e-9, '0.8 锚 ceiling');
    }
    // 反例 3：整体脏度超 3%
    {
        const r = scoreProfile(mkProfile({
            tokenCount: 400, totalBnb: 50, effectiveTradeCount: 60, badCount14d: 6, // 0.1 >0.03
            badBuyCount: 7, earlyLargeBuyCount: 10,
        }));
        eq(r.breakdown.maliciousCap.incidentalExempt, false, '脏度>0.03 不豁免');
    }
}

// ═══════════════ 6. lowVol cap ═══════════════
{
    // totalBnb=2：vol 0.608 + avg 2 + hold 0.25 = 2.858 → 压 [1.2,4) 插值 2.114
    approx(scoreProfile(mkProfile({ totalBnb: 2 })).score, 2.114, 1e-9, 'totalBnb=2 → lowVol 插值 2.114');
    eq(scoreProfile(mkProfile({ totalBnb: 2 })).breakdown.lowVolumeCap.applied, true, 'lowVol applied');
    // totalBnb=1.2 锚 → 2.0
    {
        const r = scoreProfile(mkProfile({ totalBnb: 1.2 })); // vol=log10(3)/log10(200)*2=0.379
        approx(r.breakdown.lowVolumeCap.ceiling, 2.0, 1e-9, 'totalBnb=1.2 锚 ceiling=2.0');
        approx(r.score, 2.0, 1e-9, 'totalBnb=1.2 → 压 2.0');
    }
    // totalBnb=4（≥threshold）→ null 不压
    {
        const r = scoreProfile(mkProfile({ totalBnb: 4 }));
        eq(r.breakdown.lowVolumeCap.ceiling, null, 'totalBnb=4 不压');
        eq(r.breakdown.lowVolumeCap.applied, false, 'totalBnb=4 applied=false');
    }
    // min 语义：恶意 cap 已压更低时 lowVol 不再抬升/重复压
    {
        const r = scoreProfile(mkProfile({ totalBnb: 2, badBuyCount: 10, earlyLargeBuyCount: 10 }));
        approx(r.score, 0.24, 1e-9, 'min 语义：malicious 0.24 < lowVol 2.114 → 取 0.24');
    }
}

// ═══════════════ 7. Tier2 乘法衰减 ═══════════════
{
    // ratio=0.05 锚 → factor 0.92；底座 4.25
    {
        const r = scoreProfile(mkProfile({ tier2Ratio: 0.05, tier2CrashBlockSellCount: 3 }));
        approx(r.score, 4.25 * 0.92, 1e-9, 'tier2Ratio=0.05 → ×0.92');
        eq(r.breakdown.tier2Penalty.applied, true, 'tier2 applied');
        approx(r.breakdown.tier2Penalty.ratioFactor, 0.92, 1e-9, 'ratioFactor=0.92');
    }
    // ratio=0.3 → 0.55（4.25×0.55=2.3375，score toFixed(3) 舍入 2.338）
    approx(scoreProfile(mkProfile({ tier2Ratio: 0.3, tier2CrashBlockSellCount: 3 })).score, 2.338, 1e-9, 'tier2Ratio=0.3 → ×0.55');
    // ratio=0.5 锚 → 0.40（1.0 锚才是 0.30）
    approx(scoreProfile(mkProfile({ tier2Ratio: 0.5, tier2CrashBlockSellCount: 3 })).score, 1.7, 1e-9, 'tier2Ratio=0.5 → ×0.40');
    // ratio<0.05 不衰减
    {
        const r = scoreProfile(mkProfile({ tier2Ratio: 0.049, tier2CrashBlockSellCount: 3 }));
        eq(r.score, 4.25, 'tier2Ratio<0.05 不衰减');
    }
    // count 档：ratio=0.03（≥ratioFloor 0.02，<ratioThreshold）+ count=10 → countFactor 0.90
    {
        const r = scoreProfile(mkProfile({ tier2Ratio: 0.03, tier2CrashBlockSellCount: 10 }));
        approx(r.score, 4.25 * 0.90, 1e-9, 'count=10 → ×0.90');
    }
    // count<10 → 不衰减
    {
        const r = scoreProfile(mkProfile({ tier2Ratio: 0.03, tier2CrashBlockSellCount: 9 }));
        eq(r.score, 4.25, 'count<10 不衰减');
    }
    // ratio<0.02 → count 也不衰减（ratioFloor 门）
    {
        const r = scoreProfile(mkProfile({ tier2Ratio: 0.01, tier2CrashBlockSellCount: 20 }));
        eq(r.score, 4.25, 'ratio<0.02 countFactor 不触发');
    }
    // 双乘：ratio=0.05（0.92）× count=20（0.82）=3.2062 → toFixed(3)=3.206
    approx(scoreProfile(mkProfile({ tier2Ratio: 0.05, tier2CrashBlockSellCount: 20 })).score, 3.206, 1e-9, 'ratio+count 双乘');
}

// ═══════════════ 8. badActionByHuman cap（注入后还原）═══════════════
{
    setBadActionByHumanSet(new Set(['0xHUMAN_BAD']));
    try {
        // 命中 + 非 sniper → 压 0.5
        {
            const r = scoreProfile(mkProfile({ address: '0xHUMAN_BAD', tokenCount: 50 }));
            eq(r.score, 0.5, '人工标命中 → cap 0.5');
            eq(r.breakdown.badActionByHumanCap.applied, true, 'humanCap applied');
        }
        // sniper-like（tc≥300）豁免
        {
            const r = scoreProfile(mkProfile({ address: '0xHUMAN_BAD', tokenCount: 300 }));
            eq(r.breakdown.badActionByHumanCap.sniperExempt, true, 'sniper-like 豁免 humanCap');
            eq(r.breakdown.badActionByHumanCap.applied, false, 'sniper-like 不压');
            eq(r.score, 4.25, 'sniper-like 满分');
        }
        // creator 豁免 sniper 判定（isSniperLike=false）→ 人工标照压
        {
            const r = scoreProfile(mkProfile({ address: '0xHUMAN_BAD', tokenCount: 300, isCreator: true }));
            eq(r.score, 0.5, 'creator 豁免 sniper → 人工标照压 0.5');
        }
        // 不在集合 → 不压
        {
            const r = scoreProfile(mkProfile({ address: '0xOTHER', tokenCount: 50 }));
            eq(r.score, 4.25, '不在集合不压');
        }
        // classifyHolderDetail 同源：人工标覆盖桶（非 sniper→zhuang，含 new_wallet 覆盖；sniper→retail）
        eq(classifyHolder({ address: '0xHUMAN_BAD', rawTotal: 10, tokenCount: 10 }), 'zhuang', '人工标 → zhuang');
        eq(classifyHolder({ address: '0xHUMAN_BAD', rawTotal: 2, tokenCount: 2 }), 'zhuang', '人工标覆盖 new_wallet 优先级');
        eq(classifyHolder({ address: '0xHUMAN_BAD', rawTotal: 2, tokenCount: 300 }), 'retail', '人工标 + sniper-like → retail');
    } finally {
        setBadActionByHumanSet(null); // 还原（后续测试不受全局态污染）
    }
    // Set=null（fail-open）→ 不压
    {
        const r = scoreProfile(mkProfile({ address: '0xHUMAN_BAD', tokenCount: 50 }));
        eq(r.score, 4.25, 'Set=null fail-open 不压');
        eq(r.breakdown.badActionByHumanCap.loaded, false, 'loaded=false');
    }
}

// ═══════════════ 9. low-level / tiny-level cap（badExempt 补充层）═══════════════
{
    // ll：badExempt + llCand≥3 + llEff≥0.95 → 压 0.4
    {
        const r = scoreProfile(mkProfile({
            lowLevelBadAction: { buy: { '0.6': { early: 5, bad: 5 } }, sell: { '1': { crash: 0, bad: 0 } } },
        }));
        eq(r.score, 0.4, 'll severe → 压 0.4');
        eq(r.breakdown.lowLevelCap.applied, true, 'llCap applied');
        eq(r.breakdown.lowLevelCap.llCand, 5, 'llCand=5');
    }
    // llEff<0.95 → 不压
    {
        const r = scoreProfile(mkProfile({
            lowLevelBadAction: { buy: { '0.6': { early: 5, bad: 4 } }, sell: {} },
        }));
        eq(r.score, 4.25, 'llEff=0.8<0.95 不压');
    }
    // llCand<3 → 不压
    {
        const r = scoreProfile(mkProfile({
            lowLevelBadAction: { buy: { '0.6': { early: 2, bad: 2 } }, sell: {} },
        }));
        eq(r.score, 4.25, 'llCand=2<3 不压');
    }
    // ll 豁免大户（tok400+BNB50+eff60+脏度0）不压（底座 totalBnb=50 → 4.073）
    {
        const r = scoreProfile(mkProfile({
            tokenCount: 400, totalBnb: 50, badCount14d: 0,
            lowLevelBadAction: { buy: { '0.6': { early: 5, bad: 5 } }, sell: {} },
        }));
        approx(r.score, 4.073, 1e-9, 'll 大户偶发豁免 → 不压（底座 4.073）');
    }
    // baseline 已 cap（badExempt=false）→ ll 不重复压（补充层语义）
    {
        const r = scoreProfile(mkProfile({
            badBuyCount: 10, earlyLargeBuyCount: 10,   // effBadRatio=1 → malicious 0.24
            lowLevelBadAction: { buy: { '0.6': { early: 5, bad: 5 } }, sell: {} },
        }));
        approx(r.score, 0.24, 1e-9, 'baseline 已 cap 0.24，ll 不重复压（不抬升）');
    }
    // tiny：badExempt + tlCand≥10 + tlEff≥0.8 → effAnchors 插值 ceiling
    {
        const r = scoreProfile(mkProfile({
            tinyLevelBadAction: { buy: { '0.2': { early: 15, bad: 15 } }, sell: { '0.2': { crash: 0, bad: 0 } } },
        }));
        approx(r.score, 0.4, 1e-9, 'tlEff=1.0 → 末锚 0.4');
        eq(r.breakdown.tinyLevelCap.applied, true, 'tlCap applied');
    }
    {
        const r = scoreProfile(mkProfile({
            tinyLevelBadAction: { buy: { '0.2': { early: 15, bad: 13 } }, sell: {} }, // 0.8667
        }));
        approx(r.score, 1.1, 1e-9, 'tlEff≈0.8667 → 1.5+(0.0667/0.1)×(0.9-1.5)=1.1');
    }
    // tlCand<10 → 不压
    {
        const r = scoreProfile(mkProfile({
            tinyLevelBadAction: { buy: { '0.2': { early: 9, bad: 9 } }, sell: {} },
        }));
        eq(r.score, 4.25, 'tlCand=9<10 不压');
    }
}

// ═══════════════ 10. classifyHolderDetail 四桶优先级 ═══════════════
{
    // new_wallet：rawTotal<3 最高优先
    eq(classifyHolder({ rawTotal: 2, tokenCount: 2, lowTinyRatio: 0.9 }), 'new_wallet', 'rawTotal<3 → new_wallet（命中 zhuang 维度也压不过）');
    // zhuang 三维度
    eq(classifyHolder({ rawTotal: 10, tokenCount: 10, lowTinyRatio: 0.6 }), 'zhuang', '①lowTiny≥0.5 → zhuang');
    eq(classifyHolder({ rawTotal: 10, tokenCount: 10, buckets: { total: 10, big: 4 } }), 'zhuang', '②bigDom>0.3 → zhuang');
    eq(classifyHolder({ rawTotal: 10, tokenCount: 10, earlyLargeBuyCount: 5, buyCount: 10 }), 'zhuang', '③rush 比例≥0.3 → zhuang');
    eq(classifyHolder({ rawTotal: 10, tokenCount: 10, earlyLargeBuyCount: 10, buyCount: 1000 }), 'zhuang', '③rush 绝对数≥10 → zhuang');
    // rush 边界：比例 0.29 且次数 9 → 不命中
    eq(classifyHolder({ rawTotal: 10, tokenCount: 10, earlyLargeBuyCount: 9, buyCount: 31 }), 'neutral', 'rush 未中（9<10 且 9/31<0.3）→ neutral');
    // sniper 否决：tc≥300 命中 zhuang 维度 → retail
    eq(classifyHolder({ rawTotal: 500, tokenCount: 500, lowTinyRatio: 0.9 }), 'retail', 'sniper(tc≥300) 否决 zhuang → retail');
    // creator 豁免 sniper：tc≥300 + isCreator → 可归 zhuang
    eq(classifyHolder({ rawTotal: 500, tokenCount: 500, lowTinyRatio: 0.9, isCreator: true }), 'zhuang', 'creator 豁免 sniper → zhuang');
    // retail：tc>100（非 sniper 无维度）
    eq(classifyHolder({ rawTotal: 150, tokenCount: 150 }), 'retail', 'tc>100 → retail');
    // neutral
    eq(classifyHolder({ rawTotal: 50, tokenCount: 50 }), 'neutral', '中频无维度 → neutral');
    // detail 结构
    {
        const d = classifyHolderDetail({ rawTotal: 10, tokenCount: 10, lowTinyRatio: 0.6, earlyLargeBuyCount: 0, buyCount: 10 });
        eq(d.bucket, 'zhuang', 'detail.bucket');
        eq(d.dims.lowTiny, true, 'dims.lowTiny');
        eq(d.dims.bigDom, false, 'dims.bigDom');
        eq(d.dims.rush, false, 'dims.rush');
        eq(d.subtype.dust, true, 'subtype.dust=①');
        eq(d.subtype.big, false, 'subtype.big=②||③');
        eq(d.rawTotal, 10, 'detail.rawTotal');
        eq(d.tokenCount, 10, 'detail.tokenCount');
    }
    // zhuangSubtype
    eq(JSON.stringify(zhuangSubtype({ rawTotal: 10, tokenCount: 10, buckets: { total: 10, big: 5 } })), JSON.stringify({ dust: false, big: true }), 'zhuangSubtype big');
    // isSniperLikeProfile
    eq(isSniperLikeProfile({ tokenCount: 300 }), true, 'isSniperLike tc=300');
    eq(isSniperLikeProfile({ tokenCount: 299 }), false, 'isSniperLike tc=299');
    eq(isSniperLikeProfile({ tokenCount: 500, isCreator: true }), false, 'isSniperLike creator 豁免');
}

// ═══════════════ 11. computeZhuangRetail + Ratio ═══════════════
{
    // 纯庄场（无 retail）→ computeZhuangRetailRatio Infinity
    const zr = computeZhuangRetail([
        { floatPct: 40, score: 4, tokenCount: 50 },                                     // neutral
        { floatPct: 30, score: 2, rawTotal: 10, tokenCount: 10, lowTinyRatio: 0.6 },    // zhuang
        { floatPct: 20, score: 1, rawTotal: 2, tokenCount: 2 },                         // new_wallet
        { floatPct: 10, score: null },                                                  // 未评分跳过
    ]);
    eq(zr.holderCount, 3, 'score=null 跳过不计 holderCount');
    approx(zr.neutralPct, 44.44, 0.01, 'neutralPct=40/90');
    approx(zr.zhuangPct, 33.33, 0.01, 'zhuangPct');
    approx(zr.newWalletPct, 22.22, 0.01, 'newWalletPct');
    eq(zr.retailPct, 0, 'retailPct=0');
    approx(zr.zhuangDustPct, 33.33, 0.01, 'zhuangDustPct（lowTiny 子类 30/90）');
    eq(zr.zhuangScore, 2, 'zhuangScore=桶内加权均分');
    eq(zr.neutralScore, 4, 'neutralScore');
    eq(zr.newWalletScore, 1, 'newWalletScore');
    eq(zr.retailScore, null, 'retailScore 空桶 null');
    eq(zr.minZR, null, 'minZR 需庄散双非 null');
    eq(zr.gapZR, null, 'gapZR 需庄散双非 null');
    eq(zr.ratio, 3000, 'ratio=庄/max(散,0.01)=30/0.01');
    eq(zr.zhuangScoredCount, 1, 'zhuangScoredCount');
    const ratio = computeZhuangRetailRatio(zr);
    ok(ratio === Infinity, '散=0 → Infinity', ratio);

    // 加 retail 后有限值
    const zr2 = computeZhuangRetail([
        { floatPct: 50, score: 3, tokenCount: 300 },                                    // retail(sniper)
        { floatPct: 30, score: 2, rawTotal: 10, tokenCount: 10, lowTinyRatio: 0.6 },    // zhuang
        { floatPct: 20, score: 1, rawTotal: 2, tokenCount: 2 },                         // new_wallet
    ]);
    eq(zr2.holderCount, 3, 'holderCount');
    const ratio2 = computeZhuangRetailRatio(zr2);
    approx(ratio2, 1.0, 0.01, '(庄30+新20)/散50=1.0');
    eq(zr2.minZR, 2, 'minZR=min(2,3)=2');
    eq(zr2.gapZR, -1, 'gapZR=2-3=-1');

    // null 语义
    eq(computeZhuangRetailRatio(null), null, 'zr=null → null');
    eq(computeZhuangRetailRatio({ holderCount: 0 }), null, 'holderCount=0 → null');
    eq(computeZhuangRetail([]).holderCount, 0, '空数组 holderCount=0');
}

// ═══════════════ 12. aggregateTokenScore + lowFloat + scoreTokenFromHolders ═══════════════
{
    const holders = [
        { address: '0xA', floatPct: 60, score: 4 },
        { address: '0xB', floatPct: 40, score: 1 },
        { address: '0xC', floatPct: 0, score: 5 },   // floatPct=0 不计
    ];
    // all 模式（默认）
    {
        const agg = aggregateTokenScore(holders, {}, { topN: 20, topNMode: 'all' });
        approx(agg.totalScore, 2.8, 1e-9, 'totalScoreAll=4×0.6+1×0.4');
        eq(agg.penalized, false, '无 lowFloat 不罚');
    }
    // top 模式：只用 topN 切片
    {
        const agg = aggregateTokenScore(holders, {}, { topN: 1, topNMode: 'top' });
        approx(agg.totalScore, 2.4, 1e-9, 'top1 模式=4×0.6');
        approx(agg.totalScoreAll, 2.8, 1e-9, 'totalScoreAll 仍全量');
    }
    // score=null 跳过
    {
        const agg = aggregateTokenScore([{ floatPct: 60, score: null }, { floatPct: 40, score: 1 }], {}, { topNMode: 'all' });
        approx(agg.totalScore, 0.4, 1e-9, 'score=null 跳过');
    }
    // lowFloat：<12% 压 2.0
    {
        const agg = aggregateTokenScore(holders, { walletHoldingPct: 5 }, { topNMode: 'all' });
        eq(agg.totalScore, 2.0, 'walletHoldingPct=5<12 → 压 2.0');
        eq(agg.penalized, true, 'penalized');
        eq(agg.penaltyReason, 'low_float', 'penaltyReason');
        eq(agg.lowFloat.hit, true, 'lowFloat.hit');
    }
    // lowFloat：=12 不罚（严格 <）
    {
        const agg = aggregateTokenScore(holders, { walletHoldingPct: 12 }, { topNMode: 'all' });
        approx(agg.totalScore, 2.8, 1e-9, 'walletHoldingPct=12 不罚');
    }
    // lowFloat：null 不罚（保守放行）
    {
        const agg = aggregateTokenScore(holders, { walletHoldingPct: null }, { topNMode: 'all' });
        approx(agg.totalScore, 2.8, 1e-9, 'walletHoldingPct=null 不罚');
    }
    // applyLowFloatPenalty 直测：prev.totalScore=null 透传
    {
        const r = applyLowFloatPenalty({ totalScore: null, penalized: false, penaltyReason: null }, { walletHoldingPct: 1 });
        eq(r.totalScore, null, 'totalScore=null 透传');
        eq(r.lowFloat.hit, true, 'lowFloat.hit 仍计算');
    }

    // scoreTokenFromHolders 端到端：per-holder 评分写回 + creator 新钱包中性分
    const profiles = [
        mkProfile({ address: '0xA', tokenCount: 50, totalBnb: 80, avgBnb: 4 }),          // → 4.25
        mkProfile({ address: '0xB', tokenCount: 5, totalBnb: 0, avgBnb: 0 }),            // → 0.25
        mkProfile({ address: '0xC', isCreator: true, source: 'realtime', tokenCount: 1, rawTotal: 1, totalBnb: 0, avgBnb: 0 }), // → 提 1.5
        mkProfile({ address: '0xD', source: 'realtime', tokenCount: 5, rawTotal: 5, totalBnb: 0, avgBnb: 0 }),  // tokenCount>1 → 不提
        mkProfile({ address: '0xE', isCreator: true, source: 'offline', tokenCount: 1, rawTotal: 1, totalBnb: 0, avgBnb: 0 }), // source 非 realtime → 不提
    ];
    const ws = scoreTokenFromHolders(profiles, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
    approx(profiles[0].score, 4.25, 1e-9, 'A 评分写回 4.25');
    approx(profiles[1].score, 0.25, 1e-9, 'B 评分写回 0.25');
    eq(profiles[2].score, 1.5, 'C creator realtime tokenCount1 → 中性分 1.5（不被 2.2 再抬）');
    eq(profiles[2].scoreBreakdown.creatorNewNeutral, true, 'C creatorNewNeutral 标记');
    eq(profiles[2].scoreBreakdown.newWalletNeutral, undefined, 'C 不叠加 newWalletNeutral');
    approx(profiles[3].score, 0.25, 1e-9, 'D tokenCount=5 超新钱包门维持 0.25');
    approx(profiles[4].score, 0.25, 1e-9, 'E source=offline 不提分');
    eq(ws.holderCount, 5, 'holderCount');
    eq(ws.scoredHolderCount, 5, 'scoredHolderCount');
    eq(ws.topNMode, 'all', 'topNMode 透传');
    eq(ws.scorerVersion, 'v1', 'scorerVersion');
    // floatPct 由调用方注入（scoreTokenFromHolders 不写 floatPct——holders 需带）；补上再验聚合
    const withFp = profiles.map((p, i) => ({ ...p, floatPct: [60, 20, 10, 5, 5][i] }));
    const ws2 = scoreTokenFromHolders(withFp, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
    approx(ws2.totalScore, 4.25 * 0.6 + 0.25 * 0.2 + 1.5 * 0.1 + 0.25 * 0.05 + 0.25 * 0.05, 1e-9, '端到端聚合 Σscore×fp/100');

    // BSC 新钱包中性分 2.2（用户 2026-09-29 裁定，先观察再定；creator 门不动）
    {
        const p1 = [mkProfile({ address: '0xF', source: 'realtime', tokenCount: 1, rawTotal: 1, totalBnb: 0, avgBnb: 0 })]; // THESIS burner 同形状（tokenCount=1）
        scoreTokenFromHolders(p1, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        eq(p1[0].score, NEW_WALLET_NEUTRAL_SCORE, 'F 非creator realtime tokenCount1 → 2.2');
        eq(p1[0].scoreBreakdown.newWalletNeutral, true, 'F newWalletNeutral 标记');
        approx(p1[0].scoreBreakdown.scoreBefore, 0.25, 1e-9, 'F scoreBefore=0.25');

        const p2 = [mkProfile({ address: '0xG', source: 'realtime', tokenCount: 0, rawTotal: 0, totalBnb: 0, avgBnb: 0 })]; // 零历史 burner
        scoreTokenFromHolders(p2, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        eq(p2[0].score, NEW_WALLET_NEUTRAL_SCORE, 'G tokenCount=0 零历史 → 2.2');

        const p3 = [mkProfile({ address: '0xH', source: 'realtime', tokenCount: 1, rawTotal: 10, totalBnb: 80, avgBnb: 4 })]; // 本高分 → 只升不降
        scoreTokenFromHolders(p3, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        approx(p3[0].score, 4.25, 1e-9, 'H 高分新钱包不被 2.2 压制（只升不降）');
        eq(p3[0].scoreBreakdown.newWalletNeutral, undefined, 'H 不打豁免标记');

        const p4 = [mkProfile({ address: '0xI', isCreator: true, source: 'realtime', tokenCount: 1, rawTotal: 1, totalBnb: 0, avgBnb: 0 })];
        scoreTokenFromHolders(p4, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        eq(p4[0].score, 1.5, 'I creator 维持 1.5 档（2.2 门不叠加）');

        const p5 = [mkProfile({ address: '0xJ', source: 'offline+inc', tokenCount: 0, rawTotal: 0, totalBnb: 0, avgBnb: 0 })];
        scoreTokenFromHolders(p5, { walletHoldingPct: 50 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        approx(p5[0].score, 0.25, 1e-9, 'J source=offline+inc 不豁免（offline 系路径不走 2.2 门）');

        // THESIS 0xa21bb591…7777 案形状锚定（per-dim 用近似画像，只锁方向不锁逐位）：
        // 大户 offline + burner 新钱包占 57.84% + 老散 offline——豁免前 burner 0.27 把
        // tokenScore 拖到 1.445 被 2.2 门拦（本案即 2026-09-29 裁定触发源）；豁免后必过门
        const th = [
            { ...mkProfile({ tokenCount: 255, rawTotal: 559, totalBnb: 559.7, avgBnb: 1.0 }), address: '0xz', floatPct: 37.31 },
            { ...mkProfile({ source: 'realtime', tokenCount: 0, rawTotal: 0, totalBnb: 0, avgBnb: 0 }), address: '0xb', floatPct: 57.84 },
            { ...mkProfile({ tokenCount: 227, rawTotal: 692, totalBnb: 82.4, avgBnb: 0.119 }), address: '0xr', floatPct: 4.85 },
        ];
        const agg = scoreTokenFromHolders(th, { walletHoldingPct: 99.99 }, { strategy: 'v1', topN: 20, topNMode: 'all' });
        const burnerScore = th[1].score;
        ok(burnerScore === NEW_WALLET_NEUTRAL_SCORE, 'THESIS burner 豁免到 2.2', 'score=' + burnerScore);
        ok(agg.totalScore > 2.2, 'THESIS 案豁免后 tokenScore 过 2.2 门（豁免前 1.445 被拦）', 'totalScore=' + agg.totalScore.toFixed(3));
    }
}

// ═══════════════ scoreProfile 未知策略 throw ═══════════════
{
    let threw = null;
    try { scoreProfile(mkProfile(), { strategy: 'v9' }); } catch (e) { threw = e.message; }
    ok(threw != null && threw.includes('unknown strategy'), '未知策略 throw', threw);
}

// ═══════════════ 汇总 ═══════════════
console.log(`\n_wallet_scorer: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(failures.join('\n')); process.exit(1); }
