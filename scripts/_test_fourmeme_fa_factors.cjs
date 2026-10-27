#!/usr/bin/env node
/**
 * pumpfun 回迁批 1 因子测试（零 DB，合成 tick）
 *
 * 1) 存活键零 diff 回归：git show 7cbbdee（2026-10-13 因子清理前）的 FA 基线写入
 *    src/services/_fa_baseline_tmp.cjs（同目录使内部相对 require 可解析），同一确定性
 *    合成序列喂基线/新版，采样 buildFactorMap 对基线输出的每个【存活】键做 Object.is
 *    级对比（含中途 setBuyState/clearBuyState 的持仓键）——清理删除 68 死键后，
 *    存活 111 键因子行为零变化的硬门槛。
 * 2) 存活因子场景断言：K 组对敲/集中度/bigHolder/RSI 全量重算/warmup null/
 *    砸速/单块跌幅链结算时机/peakProfitPct/首块脉冲/null 语义矩阵/断流。
 * 3) getFactorKeys 差集：新增 0；丢失集精确 = 68 删除键（键拼写防回归）。
 *
 * 用法：node scripts/_test_fourmeme_fa_factors.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { HOLDING_FACTOR_KEYS } = require('../src/services/tpa-factor-keys');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_COMMIT = '7cbbdee'; // 2026-10-13 因子清理（删 68 死键）前的最后 commit（固定，勿随 HEAD 推进改）
const BASELINE_PATH = path.join(ROOT, 'src', 'services', '_fa_baseline_tmp.cjs');

// 2026-10-13 清理删除的 68 死键（DB 策略/实验零引用 + 观察快照白名单零引用；
// 裁定记录见 auto-memory）+ 2026-10-15 cycle 分桶路由机制删除的 5 键。
// scenarioFactorKeys 断言丢失集与此精确相等。
const DELETED_KEYS = [
    'bigHolderDumpBnb3s', 'bigHolderDumpBnb9s', 'bigHolderEarlyPresent', 'bigHolderEarlyShare',
    'bigHolderLatePresent', 'bigHolderLateShare', 'bigHolderPresentRatio',
    'blockLowMcapBnb', 'blockLowMcapUsd', 'blocksSinceHighest', 'bnbPerSecondSlide',
    'buySellVolumeRatio5m', 'buyVolumeBnb5m', 'buysPerMin',
    'creatorPriorCnt24h', 'creatorRecentHitRate3', 'cumBuyTop5Share', 'ddConfirmSellFlag',
    'cycleGapMedianMs', 'cycleTps30s',
    'klineBarReturn', 'klineBodyPct', 'klineBsRatio', 'klineConsecUp',
    'klineRange5', 'klineTrendSampleSize', 'klineTrendSlope', 'klineVolBnb',
    'lastSwingLowPrice', 'lastSwingLowRsi',
    'max3BlockDropPct', 'maxCumBuyShare', 'maxDdSinceHighestPct', 'maxSingleBuyBnb',
    'maxSingleSellBnb', 'msSinceHighest',
    'nBuysMa10', 'newTradersPerSecondSlide', 'newWalletsSlide',
    'peakFallSpeedPctPerSec', 'postPeakSlope', 'postPulseConsecUp',
    'prevSwingLowPrice', 'prevSwingLowRsi', 'recentDrawdownFromWindowHighPct',
    'riseFromBlockLowPct', 'riseFromLow6s',
    'rsi14', 'rsi14Bar15m', 'rsi14Bar15mRt', 'rsi14Bar15s', 'rsi14Bar5m', 'rsi14Bar5mRt',
    'rsi14PostProtect', 'rsi30Sec', 'rsi60Sec',
    'rsi9', 'rsi9Bar15m', 'rsi9Bar15mRt', 'rsi9Bar5m', 'rsi9PostProtect', 'rsi9Sec',
    'secondsSinceDeepDrop70', 'sellVolumeBnb5m', 'sellsPerMin', 'slopePct20',
    'spikeCurveRatio', 'tickFlowOk', 'tokenCycle', 'tokenCycleRaw',
    'tokenCycleAgeSec', 'tradesPerMin', 'tradesPerSecondSlide',
];

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function approx(a, b, eps, msg) {
    ok(Math.abs(a - b) <= eps, `${msg} (期望 ${b}±${eps})`, a);
}

// ─────────── 合成工具 ───────────

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let txSeq = 0;
function mkTick(token, ts, isBuy, priceBnb, bnbAmount, trader, block, tokenAmount) {
    return {
        token_address: token,
        trade_type: isBuy ? 'buy' : 'sell',
        trader_address: trader,
        price_bnb: priceBnb,
        price_usd: priceBnb > 0 ? priceBnb * 600 : null,
        bnb_amount: bnbAmount,
        token_amount: tokenAmount,
        block_number: block,
        timestamp: ts,
        tx_hash: '0x' + (++txSeq).toString(16).padStart(8, '0'),
        // 真实 log_index 是块内全局严格递增（UNIQUE(tx_hash,log_index)）——合成数据用全局
        // 递增序对齐该不变量（2026-10-14 鸡蛋案 chainLate 判据上线后，恒 0 的旧形状会把
        // 同块第二笔误判迟到拦出价格链）；跨块时 block 比较先行短路，li 数值本身无约束
        log_index: txSeq,
    };
}

/** 确定性合成序列：3 token 随机走 + 尘门跨越 + 离群价 + 同秒/多秒间隔 */
function makeSyntheticSequence() {
    const rng = mulberry32(20260922);
    const tokens = ['TOK_AAAA', 'TOK_BBBB', 'TOK_CCCC'];
    const traders = Array.from({ length: 20 }, (_, i) => '0xtrader' + i.toString(16).padStart(2, '0'));
    const all = [];
    tokens.forEach((tok, ti) => {
        const n = [700, 200, 150][ti];
        let ts = 1758500000000 + ti * 1000;
        let block = 50000000 + ti * 1000;
        let price = 2e-7 * (1 + ti);
        for (let i = 0; i < n; i++) {
            const drift = (rng() - 0.48) * 0.12;
            price = Math.max(price * (1 + drift), 1e-9);
            let p = price;
            if (i > 5 && i % 97 === 0) p = price * 3000; // 离群毒价
            const bnb = Math.exp(Math.log(0.0005) + rng() * (Math.log(0.5) - Math.log(0.0005))); // log-uniform 跨 0.002 尘门
            const isBuy = rng() < 0.55;
            const amt = Math.round(bnb / Math.max(price, 1e-12) * 1e6) / 1e6;
            all.push(mkTick(tok, ts, isBuy, p, Math.round(bnb * 1e6) / 1e6,
                traders[Math.floor(rng() * traders.length)], block, amt));
            ts += Math.round(rng() < 0.15 ? rng() * 900 : 500 + rng() * 2500);
            if (rng() < 0.4) block += 1;
        }
    });
    all.sort((a, b) => a.timestamp - b.timestamp || a.tx_hash.localeCompare(b.tx_hash));
    return { ticks: all, tokens, traders };
}

// ─────────── 1) 存活键零 diff 回归 ───────────

function runZeroDiff(baselineMod, currentMod) {
    fs.writeFileSync(BASELINE_PATH, execSync(
        `git show ${BASELINE_COMMIT}:src/services/FourMemeFactorAggregator.js`,
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    const BaselineFA = require(BASELINE_PATH);
    const CurrentFA = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator'));

    // 存活键集（当前 FA 全量键探针）：零 diff 只对比基线输出中仍存活的键——
    // 删除键在当前输出恒缺席（其缺席由 scenarioFactorKeys 的丢失集断言锁定）
    const surviving = new CurrentFA({}).getFactorKeys();
    // 2026-10-14 holderTrend slot 化（用户裁定①原地改语义：10s 墙钟桶 → blockNumber 桶
    // ≈4s 窗）：11 键有意断代，不参与基线零 diff（本序列 tick 间隔 0.5-3s 与块推进
    // 不同步，两机制必产生不同序列）；行为契约由 _test_holder_trend_slot_series 专属锁定
    const HOLDER_TREND_KEYS = new Set([
        'holderTrendDataPoints', 'holderTrendGrowthRatio', 'holderTrendRiseRatio', 'holderTrendCV',
        'holderTrendRecentDecreaseCount', 'holderTrendRecentDecreaseRatio', 'holderTrendConsecutiveDecreases',
        'holderTrendHolderCountUp', 'holderTrendMedianUp', 'holderTrendSlope', 'holderTrendStrengthScore',
    ]);
    for (const k of HOLDER_TREND_KEYS) surviving.delete(k);

    const { ticks, tokens } = makeSyntheticSequence();
    const base = new BaselineFA({});
    const cur = new CurrentFA({});
    for (const t of tokens) {
        const info = { createdAtMs: 1758500000000 - 2000, totalSupply: 1e9, symbol: t.slice(4) };
        base.registerToken(t, info);
        cur.registerToken(t, info);
    }

    // 穿插持仓生命周期（触发 positionFactors 键路径），采样点固定
    const buyAt = { 250: [tokens[0]], 500: [tokens[1]] };
    const clearAt = { 600: [tokens[0]] };

    let diffs = 0;
    const diffKeys = new Set();
    const check = (label) => {
        for (const t of tokens) {
            const lastTs = lastTsByToken.get(t);
            if (lastTs === undefined) continue;
            const ob = base.buildFactorMap(t, lastTs);
            const oc = cur.buildFactorMap(t, lastTs);
            if (!ob) continue;
            for (const k of Object.keys(ob)) {
                if (!surviving.has(k)) continue; // 2026-10-13 清理删除键：基线有、当前无（预期缺席）
                const a = ob[k];
                const b = oc === null ? undefined : oc[k];
                // 2026-10-22 去 NULL 裁定：crashSpeedPctPerSec 无暴跌/横盘/反弹收复
                // 由 null → 0（「最低是 0」，门侧裸比较 crashSpeedPctPerSec > -10 放行
                // 与原 IS NULL 臂逐输入等价）——该形状豁免，其余任何 diff（数值变化）仍零容忍
                if (k === 'crashSpeedPctPerSec' && a === null && b === 0) continue;
                if (!Object.is(a, b)) {
                    diffs++;
                    diffKeys.add(`${label}:${t}:${k}(${a} → ${b})`);
                }
            }
        }
    };
    const lastTsByToken = new Map();

    ticks.forEach((tick, i) => {
        base.processTick(tick, { emitFactors: false });
        cur.processTick(tick, { emitFactors: false });
        lastTsByToken.set(tick.token_address, tick.timestamp);
        if (buyAt[i]) {
            for (const t of buyAt[i]) {
                const bs = { buyPriceBnb: 3e-7, buyPriceUsd: 2e-4, buyTime: tick.timestamp };
                base.setBuyState(t, bs);
                cur.setBuyState(t, bs);
            }
        }
        if (clearAt[i]) {
            for (const t of clearAt[i]) { base.clearBuyState(t); cur.clearBuyState(t); }
        }
        if (i % 50 === 0 || i === ticks.length - 1) check(`i${i}`);
    });

    if (diffs > 0) {
        for (const d of [...diffKeys].slice(0, 20)) console.error(`    diff: ${d}`);
    }
    ok(diffs === 0, `存活键零 diff 回归（${ticks.length} ticks，全程采样，含持仓生命周期）`, `${diffs} 处 diff`);
    return CurrentFA;
}

// ─────────── 2) 存活因子场景断言 ───────────

function scenarioKOverlap(FA) {
    const fa = new FA({});
    const T = 'T_KOVERLAP', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 10, 1.0, '0xA', 100, 1000), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 1000, false, 10, 0.5, '0xA', 100, 500), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 2000, true, 10, 0.3, '0xB', 101, 300), { emitFactors: false });
    const f = fa.buildFactorMap(T, t0 + 2000);
    approx(f.counterpartyOverlapRate, 0.5, 1e-12, 'K组：两栖地址占比 1/2');
    approx(f.counterpartyOverlapVolume, 1.5 / 1.8, 1e-12, 'K组：双边量交集 1.5/1.8');
}

function scenarioConcentration(FA) {
    const fa = new FA({});
    const T = 'T_CONC', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1000 });
    const nets = [['0x1', 300], ['0x2', 200], ['0x3', 100], ['0x4', 50], ['0x5', 50]];
    nets.forEach(([w, amt], i) => {
        fa.processTick(mkTick(T, t0 + i * 1000, true, 1, 0.01, w, 200 + i, amt), { emitFactors: false });
    });
    const f = fa.buildFactorMap(T, t0 + 5000);
    approx(f.top3HolderShare, 0.6, 1e-12, '集中度：top3 = 600/1000');
    approx(f.top5HolderShare, 0.7, 1e-12, '集中度：top5 = 700/1000');
    // totalSupply 缺失（=0）→ shares 族 null fail-closed
    const fa2 = new FA({});
    const T2 = 'T_NOSUPPLY';
    fa2.registerToken(T2, { createdAtMs: t0 - 1000, totalSupply: 0 });
    fa2.processTick(mkTick(T2, t0, true, 1, 0.01, '0x1', 300, 100), { emitFactors: false });
    const f2 = fa2.buildFactorMap(T2, t0);
    ok(f2.top3HolderShare === null && f2.top5HolderShare === null
        && f2.bigHolderShare === null, 'totalSupply=0 → shares 族全 null fail-closed',
        f2.top3HolderShare);
}

function scenarioBigHolder(FA) {
    const fa = new FA({});
    const T = 'T_BH', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e6 });
    // A 累计买 1.2（跨门槛）后清仓；B 累计买 1.5（跨门槛）在场
    fa.processTick(mkTick(T, t0, true, 10, 1.2, '0xA', 200, 600), { emitFactors: false });
    const tSell = t0 + 1000;
    fa.processTick(mkTick(T, tSell, false, 10, 1.0, '0xA', 201, 600), { emitFactors: false }); // A 清仓（净持仓 0，累计买入留痕）
    fa.processTick(mkTick(T, t0 + 2000, true, 10, 1.5, '0xB', 205, 700), { emitFactors: false });
    const f = fa.buildFactorMap(T, tSell + 1000);
    ok(f.bigHolderTotal === 2, '大户：W 群体总数=2（A、B 跨 1.0 门槛；只看累计买入）', f.bigHolderTotal);
    ok(f.bigHolderPresent === 1, '大户：在场=1（A 清仓净持仓 0）', f.bigHolderPresent);
}

function scenarioRsi(FA) {
    const fa = new FA({});
    const T = 'T_RSI', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    const rng = mulberry32(42);
    let price = 100;
    const allSecCloses = [];
    let lastSec = null;
    for (let s = 0; s < 80; s++) {
        price = Math.max(price * (1 + (rng() - 0.5) * 0.1), 1);
        const ts = t0 + s * 1000 + 500;
        fa.processTick(mkTick(T, ts, true, price, 0.01, '0xR', 300 + s, 100), { emitFactors: false });
        fa.processTick(mkTick(T, ts + 200, false, price * 1.001, 0.01, '0xR2', 300 + s, 50), { emitFactors: false });
        // 下一秒的首 tick 会闭合上一秒——记录"已闭合秒收盘"全集（同秒末笔覆盖）
        const sec = Math.floor((ts + 200) / 1000);
        if (lastSec !== null && sec > lastSec) allSecCloses.push(lastClose);
        lastSec = sec; lastClose = price * 1.001;
    }
    // 收尾：闭合最后秒
    fa.processTick(mkTick(T, t0 + 80500, true, price, 0.01, '0xR', 400, 100), { emitFactors: false });
    if (lastSec !== null) allSecCloses.push(lastClose);
    // 同款环形窗（secRsiMaxBars=60）：FA 侧 _secCloses 超 60 即 shift，重建序列须同裁
    while (allSecCloses.length > fa._fp.secRsiMaxBars) allSecCloses.shift();

    const f = fa.buildFactorMap(T, t0 + 80500);
    const full14 = fa._rsi(allSecCloses, 14);
    ok(f.rsi14Sec !== null && full14 !== null, 'RSI：双方均已过 warmup', f.rsi14Sec);
    approx(f.rsi14Sec, full14, 1e-9, 'RSI 对拍：rsi14Sec = 全量重算（已闭合秒序列）');
    // warmup fail-closed：全新 token 少量收盘
    const fa2 = new FA({});
    const T2 = 'T_RSIWARM';
    fa2.registerToken(T2, { createdAtMs: t0, totalSupply: 1e9 });
    for (let s = 0; s < 3; s++) {
        fa2.processTick(mkTick(T2, t0 + s * 1000 + 100, true, 100 + s, 0.01, '0xW', 500 + s, 10), { emitFactors: false });
    }
    const f2 = fa2.buildFactorMap(T2, t0 + 3100);
    ok(f2.rsi14Sec === null, 'RSI warmup null fail-closed', f2.rsi14Sec);
}

function scenarioCrashSpeed(FA) {
    const fa = new FA({});
    const T = 'T_PEAK', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xP', 600, 10), { emitFactors: false });
    const tCrash = t0 + 10000;
    fa.processTick(mkTick(T, tCrash, true, 25, 0.01, '0xP', 604, 10), { emitFactors: false }); // -75%
    const f = fa.buildFactorMap(T, tCrash);
    approx(f.crashSpeedPctPerSec, -7.5, 1e-6, '砸速：-75% / 10s（分母钳 3s 不生效）');
    // 新高重置
    const tNewHigh = t0 + 20000;
    fa.processTick(mkTick(T, tNewHigh, true, 120, 0.01, '0xP', 610, 10), { emitFactors: false });
    const f2 = fa.buildFactorMap(T, tNewHigh);
    ok(f2.crashSpeedPctPerSec === 0, '创新高 → crashSpeed 0（无暴跌=速度 0，2026-10-22 去 NULL）', f2.crashSpeedPctPerSec);
}

function scenarioMaxBlockDrop(FA) {
    const fa = new FA({});
    const T = 'T_BLKDROP', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xD', 700, 10), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 1000, true, 110, 0.01, '0xD', 700, 10), { emitFactors: false }); // block700 close=110 high=110
    fa.processTick(mkTick(T, t0 + 4000, true, 66, 0.01, '0xD', 701, 10), { emitFactors: false });  // block701 首笔：结算 (null,110) 跳过；close=66
    const f1 = fa.buildFactorMap(T, t0 + 4000);
    ok(f1.maxBlockDropPct === null, '相邻对未结算（需下一块首 tick）→ null', f1.maxBlockDropPct);
    fa.processTick(mkTick(T, t0 + 5000, true, 60, 0.01, '0xD', 701, 10), { emitFactors: false }); // 同块第二笔 close=60 high=66 → intra 9.09%
    const f2 = fa.buildFactorMap(T, t0 + 5000);
    approx(f2.maxBlockDropPct, (66 - 60) / 66 * 100, 1e-9, '块内瞬时回落 (66→60)');
    fa.processTick(mkTick(T, t0 + 7000, true, 60, 0.01, '0xD', 702, 10), { emitFactors: false }); // block702 首笔：结算 (110,60) = 45.45%
    const f3 = fa.buildFactorMap(T, t0 + 7000);
    approx(f3.maxBlockDropPct, (110 - 60) / 110 * 100, 1e-9, '相邻块收盘对结算 (110→60)');
}

function scenarioPeakProfit(FA) {
    const fa = new FA({});
    const T = 'T_DDC', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xD', 800, 10), { emitFactors: false });
    fa.setBuyState(T, { buyPriceBnb: 100, buyPriceUsd: 60000, buyTime: t0 });
    fa.processTick(mkTick(T, t0 + 1000, true, 120, 0.01, '0xD', 801, 10), { emitFactors: false }); // 峰 120
    const f1 = fa.buildFactorMap(T, t0 + 1000);
    approx(f1.peakProfitPct, 20, 1e-9, 'peakProfitPct=+20（先推进后读取）');
    fa.processTick(mkTick(T, t0 + 2000, true, 95, 0.01, '0xD', 802, 10), { emitFactors: false }); // -20.8%
    const f3 = fa.buildFactorMap(T, t0 + 2000);
    approx(f3.peakProfitPct, 20, 1e-9, '回撤不降低 peakProfitPct running max');
    // running max 跨清仓：新仓归零后重新推进
    fa.processTick(mkTick(T, t0 + 4000, true, 118, 0.01, '0xD', 804, 10), { emitFactors: false });
    const holder = fa.getHolderFactors(T, 'default', t0 + 4000);
    ok(holder !== null && holder.peakProfitPct === 20,
        'getHolderFactors 同步暴露 H 组 peakProfitPct', holder && holder.peakProfitPct);
}

function scenarioFirstBlockPulse(FA) {
    const fa = new FA({});
    const T = 'T_PULSE', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 10, 0.5, '0xF', 900, 50), { emitFactors: false });  // 首买 anchor
    const f1 = fa.buildFactorMap(T, t0 + 500);
    ok(f1.firstBlockBuyShare === null, '首块脉冲：窗口未冻结 → null', f1.firstBlockBuyShare);
    fa.processTick(mkTick(T, t0 + 1000, true, 10, 0.3, '0xF', 900, 30), { emitFactors: false });  // 窗内
    fa.processTick(mkTick(T, t0 + 4000, true, 10, 0.2, '0xF2', 902, 20), { emitFactors: false }); // 窗外
    const f2 = fa.buildFactorMap(T, t0 + 4000);
    approx(f2.firstBlockBuyShare, 0.8, 1e-12, '首块脉冲：0.8 / 总买 1.0');
}

function scenarioOutOfOrderBlock(FA) {
    const fa = new FA({});
    const T = 'T_OOO', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xO', 1200, 10), { emitFactors: false });        // block1200 close=100
    fa.processTick(mkTick(T, t0 + 500, true, 1, 0.01, '0xO', 1198, 10), { emitFactors: false });    // 回退 block：块链忽略
    fa.processTick(mkTick(T, t0 + 3500, true, 100, 0.01, '0xO', 1201, 10), { emitFactors: false }); // block1201：结算 (null,100) 跳过
    const f = fa.buildFactorMap(T, t0 + 3500);
    ok(f.maxBlockDropPct === null, '乱序 block：回退 tick 不污染单块跌幅链（无跌幅证据 → null）', f.maxBlockDropPct);
}

function scenarioIdle(FA) {
    const fa = new FA({});
    const T = 'T_IDLE', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0, totalSupply: 1e9 });
    const f0 = fa.buildFactorMap(T, t0);
    ok(f0.idleSecSinceLastTick === null, '无 tick → 断流键 null（不误判）', f0.idleSecSinceLastTick);
    fa.processTick(mkTick(T, t0, true, 10, 0.01, '0xI', 1500, 10), { emitFactors: false });
    const f1 = fa.buildFactorMap(T, t0 + 5000);
    approx(f1.idleSecSinceLastTick, 5, 1e-9, 'idleSecSinceLastTick=5');
    const f2 = fa.buildFactorMap(T, t0 + 200000);
    approx(f2.idleSecSinceLastTick, 200, 1e-9, 'idleSecSinceLastTick=200');
}

// ─────────── 名单因子（回迁批 3.3）───────────

function scenarioListFactors(FA) {
    const t0 = 1758800000000;
    const PX = 10; // 价格恒定无离群；block 手写递增

    // ── smartBotCount：名单内累计可靠买额 ≥ smartBotMinBuyBnb(0.02) 的地址数 ──
    {
        const fa = new FA({});
        fa.registerToken('T_SB', { createdAtMs: t0, totalSupply: 1e9, creatorAddress: '0xC' });
        FA.setSmartBotWalletsForTest(new Set(['0xA', '0xB']));
        // A：0.012+0.012=0.024 ≥0.02 → 计；B：单笔恰 0.02（≥ 边界）→ 计；
        // Z：5 BNB 非名单 → 不计；尘 tick 0.001（<minPriceUpdateBnb 0.002）不进可靠价链不累计
        fa.processTick(mkTick('T_SB', t0 + 1000, true, PX, 0.012, '0xA', 1000, 120), { emitFactors: false });
        fa.processTick(mkTick('T_SB', t0 + 4000, true, PX, 0.012, '0xA', 1001, 120), { emitFactors: false });
        fa.processTick(mkTick('T_SB', t0 + 7000, true, PX, 0.02, '0xB', 1002, 200), { emitFactors: false });
        fa.processTick(mkTick('T_SB', t0 + 10000, true, PX, 5, '0xZ', 1003, 50000), { emitFactors: false });
        fa.processTick(mkTick('T_SB', t0 + 13000, true, PX, 0.001, '0xA', 1004, 10), { emitFactors: false });
        // A 清仓卖出：_smartBotBuyBnb 只累不减（参与留痕）→ 计数不变
        fa.processTick(mkTick('T_SB', t0 + 16000, false, PX, 0.03, '0xA', 1005, 240), { emitFactors: false });
        const f = fa.buildFactorMap('T_SB', t0 + 16000);
        ok(f.smartBotCount === 2, '名单：A 累计 0.024 + B 恰 0.02 → 2（Z 非名单/尘不计/卖不减）', f.smartBotCount);
    }
    {
        // 名单 null（未加载/加载失败）→ 恒 0 fail-open
        const fa = new FA({});
        FA.setSmartBotWalletsForTest(null);
        fa.registerToken('T_SB2', { createdAtMs: t0, totalSupply: 1e9 });
        fa.processTick(mkTick('T_SB2', t0 + 1000, true, PX, 1, '0xA', 1000, 10000), { emitFactors: false });
        const f = fa.buildFactorMap('T_SB2', t0 + 1000);
        ok(f.smartBotCount === 0, '名单：smart_bot 未加载 → 恒 0（fail-open 观察，不拦交易）', f.smartBotCount);
    }

    // ── sniperHolderShare：top20 净持仓 sniper 占比（creator 豁免；分母=_sum20 非 totalSupply）──
    {
        const fa = new FA({});
        FA.setSniperWalletsForTest(new Set(['0xSNIP']));
        // totalSupply 缺失(0) → top3/top5HolderShare null；sniperHolderShare 分母=_sum20 不受影响
        fa.registerToken('T_SN', { createdAtMs: t0, totalSupply: 0, creatorAddress: '0xC' });
        // 净持仓：0xC(creator) 1000 / 0xSNIP 500 / 0xX 500 / 0xY 买 400 卖 400 → 净 0 不进 top20
        fa.processTick(mkTick('T_SN', t0 + 1000, true, PX, 1, '0xC', 1000, 1000), { emitFactors: false });
        fa.processTick(mkTick('T_SN', t0 + 4000, true, PX, 1, '0xSNIP', 1001, 500), { emitFactors: false });
        fa.processTick(mkTick('T_SN', t0 + 7000, true, PX, 1, '0xX', 1002, 500), { emitFactors: false });
        fa.processTick(mkTick('T_SN', t0 + 10000, true, PX, 0.5, '0xY', 1003, 400), { emitFactors: false });
        fa.processTick(mkTick('T_SN', t0 + 13000, false, PX, 0.5, '0xY', 1004, 400), { emitFactors: false });
        const f = fa.buildFactorMap('T_SN', t0 + 13000);
        approx(f.sniperHolderShare, 25, 1e-9, '名单：top20=[C1000,SNIP500,X500] creator 豁免 → 500/2000=25%');
        ok(f.top5HolderShare === null, '名单：totalSupply=0 → top5 null（对照 sniperHolderShare 不依赖 totalSupply）', f.top5HolderShare);
    }
    {
        // 名单 null → 恒 null fail-closed；名单在但全清仓 _sum20=0 → null
        const fa = new FA({});
        FA.setSniperWalletsForTest(null);
        fa.registerToken('T_SN2', { createdAtMs: t0, totalSupply: 1e9, creatorAddress: '0xC' });
        fa.processTick(mkTick('T_SN2', t0 + 1000, true, PX, 1, '0xSNIP', 1000, 500), { emitFactors: false });
        const f = fa.buildFactorMap('T_SN2', t0 + 1000);
        ok(f.sniperHolderShare === null, '名单：sniper 未加载 → 恒 null（fail-closed，引用键的门不放行）', f.sniperHolderShare);

        FA.setSniperWalletsForTest(new Set(['0xSNIP']));
        fa.processTick(mkTick('T_SN2', t0 + 4000, false, PX, 1, '0xSNIP', 1001, 500), { emitFactors: false });
        const f2 = fa.buildFactorMap('T_SN2', t0 + 4000);
        ok(f2.sniperHolderShare === null, '名单：全清仓 _sum20=0 → null（无分母）', f2.sniperHolderShare);
    }

    // ── 复位（模块级单例跨场景/跨探针共享，防泄漏）──
    FA.setSmartBotWalletsForTest(null);
    FA.setSniperWalletsForTest(null);
}

function scenarioFactorKeys(FA, baselineKeys) {
    const fa = new FA({});
    const keys = fa.getFactorKeys();
    // 2026-10-13 清理后键集契约：相对删除前基线（7cbbdee），新增恰 = 白名单新键、丢失恰 = 68 删除键。
    // ADDED_KEYS：清理后新增因子（拼写防回归）——2026-10-14 gmgnUserPct（GMGN 用户实时占比，
    // 小王子案替换 TPAPre 快照口径，详见 _test_gmgn_user_pct_factor.cjs）；
    // 2026-10-15 act* 8 键（交易活跃度滑窗，取代同日删除的 cycle 分桶路由，
    // 详见 _test_activity_window_factors.cjs）；
    // 2026-10-15 双口径 5 键（0xc7fe…7777 案：holdDuration 重定义=信号口径 + realHoldDuration
    // 物理持有 + buySignalAt/buyExecutedAt/buyExecutedPriceBnb 执行口径透传，
    // 详见 _test_prebuy_peak_backfill.cjs；buyPriceBnb 同日补顶层映射供快照审计）；
    // 2026-10-16 bundle* 6 键（同 block 首买簇捆绑检测，BITCAT 案 Phase 1 观察键，
    // 详见 _test_bundle_cluster_factors.cjs）；同日 top1HolderCircPct（TOP1 持仓
    // 集中度门键，maxBlockBuyCircPct 的存量替代——用户裁定）；
    // 同日 maxCopyWalletHolderCircPct（最大跟单钱包持仓，FLY 案钱包标签方案，
    // 详见 _test_copy_wallet_roster_factors.cjs）；
    // 2026-10-17 C84 买腿链路重构：narrative 三键注入（narrativeRating/narrativeRounds/
    // narrativeRetryDue，_narrativeFactorOverrides 静态映射，叙事发起条件/单一买条件
    // 消费，详见 _test_fa_narrative_factors.cjs）。earlyTrades* 10 键原属本批迁入，
    // 已于 2026-10-26 T71 整族删除（冻结窗对慢热票失真，门换 tradesNetBuyRatio/
    // tradesRouterPct 全史实时载体，见文件尾 T70 段）——键从白名单移除即 getFactorKeys
    // 探针不再收键
    const ADDED_KEYS = [
        'gmgnUserPct',
        'actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades',
        'actTraders', 'actBuyers', 'actSellers', 'actNewTraders',
        'buySignalAt', 'buyExecutedAt', 'buyExecutedPriceBnb', 'realHoldDuration',
        'buyPriceBnb',
        'bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
        'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
        // 2026-10-25 T1 bundle 门存量口径（漏登记随 top2 键补）
        'bundleClusterHoldCircPct',
        // 2026-10-17 Agentum 案方向 C 出生锚定捆绑簇 4 键（10s 滑窗迟到 fire 漏创建块簇；
        // 详见 _test_bundle_cluster_factors.cjs M/N 段与 FA launch* 注释）
        'launchBundleClusterSize', 'launchBundleClusterSharePct',
        'launchEqualClusterWallets', 'launchEqualClusterBnb',
        // 2026-10-18 用户点名集合（famous 门原料）+ C96/C97 叙事键（category 透传 +
        // superIP 注入键）——并行批次追加时未同步本白名单（2026-10-20 补）
        'famousCopyWalletCircPct', 'narrativeCategory',
        'narrativeSuperIp', 'narrativeSuperIpSlogan',
        'top1HolderCircPct',
        'maxCopyWalletHolderCircPct',
        // 2026-10-20 乌龟案：sybil 大簇合计持仓门原料（详见 _test_sybil_cluster_factor.cjs）
        'sybilClusterHolderCircPct',
        'narrativeRating', 'narrativeRounds', 'narrativeRetryDue',
        // 2026-10-22 C166 账号信息复检（宣告账号删号/删推卖臂因子，引擎 AccountHealthMonitor 回填）
        'issuerAccountState',
        // 2026-10-22 人气门去簇口径两键（簇钱包买入/持有者不计人气，
        // 详见 _test_sybil_cluster_factor.cjs H 段）
        'buyVolumeBnbExSybil', 'holdersExSybil',
        // 2026-10-25 AIFLY 案第二道存量门（最大两块买家并集去重，详见 _test_bundle_cluster_factors.cjs P 段）
        'top2BundleClusterHoldCircPct',
        // 2026-10-26 同族第三块观察键（最大三块并集去重，详见 _test_bundle_cluster_factors.cjs Q 段）
        'top3BundleClusterHoldCircPct',
        // 2026-10-26 T70 全史实时净买/路由占比两键（early 90s 冻结窗对慢热票失真——
        // 智子/币安1986 案买腿换实时载体；详见 _test_fa_early_trades_factors.cjs T70 段）
        'tradesNetBuyRatio', 'tradesRouterPct',
        // 2026-10-26 T74 等额买簇三观察键（0x8c4a…7777 对倒案：跨块同额买入并集去重
        // 正净持仓 ÷ 流通；详见 _test_even_cluster_factors.cjs）
        'evenClusterHoldCircPct', 'evenClusterWallets', 'evenClusterGroups',
        // 2026-10-27 T77 注意力空转观测键原料（独立买入钱包数=K 组 _buyerAddresses
        // 全史 Set size；GMGN 层 gmgnVisitorsPerBuyer 分母，详见 _test_gmgn_attention_ratio.cjs）
        'buyWallets',
        // 2026-10-27 T77 滚动净买窗两键（MUSK2028 0x8f53…7777 迟买案 W=10s：窗口净比
        // null=窗内零买缺近期证据 fail-closed + 窗买量观察键；详见 _test_netbuy_window_factors.cjs）
        'tradesNetBuyRatioWin', 'tradesNetBuyWinBnb',
    ];
    const added = [...keys].filter(k => !baselineKeys.has(k));
    // T71（2026-10-26）防复活反证：earlyTrades* 出生锚 90s 冻结窗十键整族已删
    ok(![...keys].some(k => k.startsWith('earlyTrades')),
        'T71 防复活：getFactorKeys 不含任何 earlyTrades* 键',
        [...keys].filter(k => k.startsWith('earlyTrades')));
    const addedOk = added.length === ADDED_KEYS.length && ADDED_KEYS.every(k => added.includes(k));
    ok(addedOk, `键集新增恰 = ${ADDED_KEYS.length} 白名单键（无意外键）`, added);
    const lost = [...baselineKeys].filter(k => !keys.has(k)).sort();
    const expect = [...DELETED_KEYS].sort();
    const same = lost.length === expect.length && lost.every((k, i) => k === expect[i]);
    ok(same, `丢失集精确 = ${DELETED_KEYS.length} 删除键（实际 ${lost.length}）`,
        { extraLost: lost.filter(k => !expect.includes(k)), missingLost: expect.filter(k => !lost.includes(k)) });
    // 存活抽查（清理时最易误删的活性键；完备性由零 diff + 丢失集双向锁定）
    const MUST_KEEP = [
        'tokenAgeSec', 'platform',
        'crashSpeedPctPerSec', 'risePct5m', 'riseVel5m', 'priceTrendSlope',
        'recentRiseFromWindowLowPct', 'rsi14Sec', 'rsi9Bar5mRt', 'graduationProgress',
        'peakProfitPct', 'peakMarketCapSinceLastBuy', 'maxBlockDropPct',
        'drawdownFromHighestSinceLastBuy', 'firstBlockBuyShare', 'idleSecSinceLastTick',
        'smartBotCount', 'sniperHolderShare', 'bigHolderPresent', 'bigHolderTotal',
        'counterpartyOverlapRate', 'top3HolderShare', 'top5HolderShare',
        'TPAAnalyzed', 'TPAPre_retention', 'TPAPre_asofRelFirst', ...HOLDING_FACTOR_KEYS,
    ];
    const missing = MUST_KEEP.filter(k => !keys.has(k));
    ok(missing.length === 0, `存活抽查 ${MUST_KEEP.length} 活性键在册`, missing);
}

// ─────────── 主流程 ───────────

function main() {
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
        console.error('不在 git 仓库内，无法取基线');
        process.exit(1);
    }
    console.log('═'.repeat(72));
    console.log('FA 因子测试（2026-10-13 清理后契约：存活键零 diff + 删除集精确）');
    console.log('═'.repeat(72));

    let CurrentFA = null;
    let baselineKeys = new Set();
    try {
        fs.writeFileSync(BASELINE_PATH, execSync(
            `git show ${BASELINE_COMMIT}:src/services/FourMemeFactorAggregator.js`,
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        ));
        const BaselineFA = require(BASELINE_PATH);
        baselineKeys = new (require(BASELINE_PATH))({}).getFactorKeys();
        CurrentFA = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator'));

        console.log('\n[1] 存活键零 diff 回归（基线 = git 7cbbdee 清理前）');
        runZeroDiff(BaselineFA, CurrentFA);

        console.log('[2] 场景断言');
        scenarioKOverlap(CurrentFA);
        console.log('  ✓ K 组对敲重叠');
        scenarioConcentration(CurrentFA);
        console.log('  ✓ 持仓集中度 + totalSupply null 语义');
        scenarioBigHolder(CurrentFA);
        console.log('  ✓ bigHolder 群体（累计买入门 + 净持仓在场）');
        scenarioRsi(CurrentFA);
        console.log('  ✓ RSI 全量重算对拍 + warmup null');
        scenarioCrashSpeed(CurrentFA);
        console.log('  ✓ 砸速 + 新高重置');
        scenarioMaxBlockDrop(CurrentFA);
        console.log('  ✓ 单块跌幅链（块内瞬时 + 相邻对结算时机）');
        scenarioPeakProfit(CurrentFA);
        console.log('  ✓ peakProfitPct running max');
        scenarioFirstBlockPulse(CurrentFA);
        console.log('  ✓ 首块脉冲');
        scenarioOutOfOrderBlock(CurrentFA);
        console.log('  ✓ 乱序 block 忽略');
        scenarioIdle(CurrentFA);
        console.log('  ✓ 断流 idleSec');
        scenarioListFactors(CurrentFA);
        console.log('  ✓ 名单因子 smartBotCount/sniperHolderShare');
        scenarioFactorKeys(CurrentFA, baselineKeys);
        console.log('  ✓ getFactorKeys 删除集精确（68 键）+ 存活抽查');
    } finally {
        try { fs.unlinkSync(BASELINE_PATH); } catch (_) { /* 基线文件不存在（首行写入失败）时静默 */ }
    }

    console.log('\n' + '═'.repeat(72));
    console.log(`结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) {
        process.exit(1);
    }
    console.log('全部通过 ✅');
}

main();
