#!/usr/bin/env node
/**
 * pumpfun 回迁批 1 因子测试（零 DB，合成 tick）
 *
 * 1) 旧键零 diff 回归：git show 2c8c74f 的 FA 基线写入 src/services/_fa_baseline_tmp.cjs
 *    （同目录使内部相对 require 可解析），同一确定性合成序列喂基线/新版，
 *    采样 buildFactorMap 对基线输出的每个键做 Object.is 级对比（含中途 setBuyState/
 *    clearBuyState 的持仓键）——存量实验因子行为零变化的硬门槛。
 * 2) 新因子场景断言：K 组对敲/集中度/bigHolder/RSI 双实现（增量 Wilder vs 全量重算）/
 *    峰值重置与 deepDrop latch/单块跌幅链结算时机/ddConfirm 状态机/首块脉冲/滑窗 span/
 *    针曲线/乱序 block 忽略/null 语义矩阵/断流分档。
 * 3) getFactorKeys 差集 = 精确 68 新键（键拼写防回归）。
 *
 * 用法：node scripts/_test_fourmeme_fa_factors.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_COMMIT = '2c8c74f'; // 批 1 改造前的最后 commit（固定，勿随 HEAD 推进改）
const BASELINE_PATH = path.join(ROOT, 'src', 'services', '_fa_baseline_tmp.cjs');

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
        log_index: 0,
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

// ─────────── 1) 旧键零 diff 回归 ───────────

function runZeroDiff(baselineMod, currentMod) {
    fs.writeFileSync(BASELINE_PATH, execSync(
        `git show ${BASELINE_COMMIT}:src/services/FourMemeFactorAggregator.js`,
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    const BaselineFA = require(BASELINE_PATH);
    const CurrentFA = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator'));

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
                const a = ob[k];
                const b = oc === null ? undefined : oc[k];
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
    ok(diffs === 0, `旧键零 diff 回归（${ticks.length} ticks，全程采样，含持仓生命周期）`, `${diffs} 处 diff`);
    return CurrentFA;
}

// ─────────── 2) 新因子场景断言 ───────────

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
        && f2.cumBuyTop5Share === null && f2.maxCumBuyShare === null
        && f2.bigHolderShare === null, 'totalSupply=0 → shares 族全 null fail-closed',
        f2.top3HolderShare);
}

function scenarioBigHolder(FA) {
    const fa = new FA({});
    const T = 'T_BH', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e6 });
    // A 累计买 1.2（early，首买块=首块 200），后清仓；B 累计买 1.5（late，块 205）
    fa.processTick(mkTick(T, t0, true, 10, 1.2, '0xA', 200, 600), { emitFactors: false });
    const tSell = t0 + 1000;
    fa.processTick(mkTick(T, tSell, false, 10, 1.0, '0xA', 201, 600), { emitFactors: false }); // A 清仓 → bhSellEvents 记录
    fa.processTick(mkTick(T, t0 + 2000, true, 10, 1.5, '0xB', 205, 700), { emitFactors: false });
    const f = fa.buildFactorMap(T, tSell + 1000);
    ok(f.bigHolderTotal === 2, '大户：W 群体总数=2（A、B 跨 1.0 门槛）', f.bigHolderTotal);
    ok(f.bigHolderPresent === 1, '大户：在场=1（A 清仓净持仓 0）', f.bigHolderPresent);
    ok(f.bigHolderEarlyPresent === 0, '大户：早到在场=0', f.bigHolderEarlyPresent);
    ok(f.bigHolderLatePresent === 1, '大户：晚到在场=1（B 首买块 205 > s0+1=201）', f.bigHolderLatePresent);
    approx(f.bigHolderPresentRatio, 0.5, 1e-12, '大户：在场率 1/2');
    approx(f.bigHolderDumpBnb3s, 1.0, 1e-12, '大户：3s 出货窗含 A 清仓 1.0');
    approx(f.bigHolderDumpBnb9s, 1.0, 1e-12, '大户：9s 出货窗含 A 清仓 1.0');
    // 留存裁剪：13s 后再一笔大户卖出 → 旧事件出窗
    const tSell2 = tSell + 13000;
    fa.processTick(mkTick(T, tSell2, false, 10, 0.5, '0xB', 210, 100), { emitFactors: false });
    const f2 = fa.buildFactorMap(T, tSell2 + 100);
    approx(f2.bigHolderDumpBnb9s, 0.5, 1e-12, '大户：12s 留存裁剪后 9s 窗仅剩新事件 0.5');
}

function scenarioRsiDuality(FA) {
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

    const f = fa.buildFactorMap(T, t0 + 80500);
    const full30 = fa._rsi(allSecCloses, 30);
    const full60 = fa._rsi(allSecCloses, 60);
    ok(f.rsi30Sec !== null && full30 !== null, 'RSI 双实现：双方均已过 warmup', f.rsi30Sec);
    approx(f.rsi30Sec, full30, 1e-9, 'RSI 双实现对拍：rsi30Sec 增量 Wilder = 全量重算');
    approx(f.rsi60Sec, full60, 1e-9, 'RSI 双实现对拍：rsi60Sec');
    // warmup fail-closed：全新 token 少量收盘
    const fa2 = new FA({});
    const T2 = 'T_RSIWARM';
    fa2.registerToken(T2, { createdAtMs: t0, totalSupply: 1e9 });
    for (let s = 0; s < 3; s++) {
        fa2.processTick(mkTick(T2, t0 + s * 1000 + 100, true, 100 + s, 0.01, '0xW', 500 + s, 10), { emitFactors: false });
    }
    const f2 = fa2.buildFactorMap(T2, t0 + 3100);
    ok(f2.rsi9Sec === null && f2.rsi30Sec === null && f2.rsi9 === null, 'RSI warmup null fail-closed', f2.rsi9Sec);
}

function scenarioPeakAndDeepDrop(FA) {
    const fa = new FA({});
    const T = 'T_PEAK', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xP', 600, 10), { emitFactors: false });
    const tCrash = t0 + 10000;
    fa.processTick(mkTick(T, tCrash, true, 25, 0.01, '0xP', 604, 10), { emitFactors: false }); // -75%
    const f = fa.buildFactorMap(T, tCrash);
    approx(f.maxDdSinceHighestPct, -75, 1e-9, '峰值链：峰后最深回撤 -75%');
    ok(f.secondsSinceDeepDrop70 !== null && f.secondsSinceDeepDrop70 >= 0,
        '深跌 latch：-75% ≤ -70% 首触记录', f.secondsSinceDeepDrop70);
    approx(f.crashSpeedPctPerSec, -7.5, 1e-6, '砸速：-75% / 10s（分母钳 3s 不生效）');
    approx(f.peakFallSpeedPctPerSec, -7.5, 1e-6, '峰距跌速：全程 -75% / 10s');
    // 新高重置
    const tNewHigh = t0 + 20000;
    fa.processTick(mkTick(T, tNewHigh, true, 120, 0.01, '0xP', 610, 10), { emitFactors: false });
    const f2 = fa.buildFactorMap(T, tNewHigh);
    ok(f2.secondsSinceDeepDrop70 === null, '新高重置 deepDrop70At latch', f2.secondsSinceDeepDrop70);
    approx(f2.maxDdSinceHighestPct, 0, 1e-12, '新高重置 minDd');
    ok(f2.crashSpeedPctPerSec === null, '创新高 → crashSpeed null（无回撤）', f2.crashSpeedPctPerSec);
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

function scenarioDdConfirm(FA) {
    const fa = new FA({});
    const T = 'T_DDC', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0 - 1000, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 100, 0.01, '0xD', 800, 10), { emitFactors: false });
    fa.setBuyState(T, { buyPriceBnb: 100, buyPriceUsd: 60000, buyTime: t0 });
    fa.processTick(mkTick(T, t0 + 1000, true, 120, 0.01, '0xD', 801, 10), { emitFactors: false }); // 峰 120
    const f1 = fa.buildFactorMap(T, t0 + 1000);
    approx(f1.peakProfitPct, 20, 1e-9, 'ddConfirm 场景：peakProfitPct=+20（先推进后读取）');
    fa.processTick(mkTick(T, t0 + 2000, true, 95, 0.01, '0xD', 802, 10), { emitFactors: false }); // -20.8% → arm(ref=95)
    const f2 = fa.buildFactorMap(T, t0 + 2000);
    ok(f2.ddConfirmSellFlag === 0, 'arm 未确认（95 > 95×0.98）', f2.ddConfirmSellFlag);
    fa.processTick(mkTick(T, t0 + 3000, true, 93, 0.01, '0xD', 803, 10), { emitFactors: false }); // 93 ≤ 93.1 → 确认
    const f3 = fa.buildFactorMap(T, t0 + 3000);
    ok(f3.ddConfirmSellFlag === 1, 'ddConfirm：arm 后再跌 2% → sell latch', f3.ddConfirmSellFlag);
    approx(f3.peakProfitPct, 20, 1e-9, '回撤不降低 peakProfitPct running max');
    // latch 保持至清仓
    fa.processTick(mkTick(T, t0 + 4000, true, 118, 0.01, '0xD', 804, 10), { emitFactors: false });
    const f4 = fa.buildFactorMap(T, t0 + 4000);
    ok(f4.ddConfirmSellFlag === 1, 'ddConfirm latch：价格收复仍保持', f4.ddConfirmSellFlag);
    ok(fa.getHolderFactors(T, 'default', t0 + 4000).ddConfirmSellFlag === 1,
        'getHolderFactors 同步暴露 H 组');
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
    approx(f2.maxSingleBuyBnb, 0.5, 1e-12, '单笔最大买 0.5');
    approx(f2.maxSingleSellBnb !== null ? f2.maxSingleSellBnb : -1, -1, 1e-12, '无卖出 → maxSingleSellBnb null');
}

function scenarioSlideWindow(FA) {
    const fa = new FA({});
    const T = 'T_SLIDE', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0, totalSupply: 1e9 });
    fa.processTick(mkTick(T, t0, true, 10, 0.1, '0xS1', 1000, 10), { emitFactors: false });
    const f1 = fa.buildFactorMap(T, t0); // age≈0 → spanSec 钳 1
    approx(f1.tradesPerSecondSlide, 1, 1e-12, '滑窗：新币 span=1s，1 笔/tick=1/s');
    ok(f1.newWalletsSlide === 1, '滑窗：首笔钱包全史首现即窗内首现', f1.newWalletsSlide);
    const f2 = fa.buildFactorMap(T, t0 + 40000);
    // 母版语义：写时裁剪——无新 tick 不触发出窗，分子陈旧 1 笔、分母已钳 30s
    approx(f2.tradesPerSecondSlide, 1 / 30, 1e-12, '滑窗：写时裁剪（陈旧分子/30s 分母）');
    ok(f2.newWalletsSlide === 0, '滑窗：首现时间出窗 → 0', f2.newWalletsSlide);
    // 新 tick 写入触发裁剪 → 旧笔出窗
    fa.processTick(mkTick(T, t0 + 41000, true, 10, 0.1, '0xS2', 1001, 10), { emitFactors: false });
    const f3 = fa.buildFactorMap(T, t0 + 41000);
    approx(f3.tradesPerSecondSlide, 1 / 30, 1e-12, '滑窗：新 tick 触发裁剪后窗内仅剩新 1 笔');
    ok(f3.newWalletsSlide === 1, '滑窗：新钱包 0xS2 窗内首现', f3.newWalletsSlide);
}

function scenarioSpikeCurve(FA) {
    const fa = new FA({});
    const T = 'T_SPIKE', now = 1758600000000;
    fa.registerToken(T, { createdAtMs: now - 60000, totalSupply: 1e9 });
    // 6s 窗内 4 个 reliable tick：lo=1 → cur=2 = +100%；3s 窗内 2 tick 同价（lo=2）→ rise 0%
    fa.processTick(mkTick(T, now - 5800, true, 1, 0.01, '0xX', 1100, 10), { emitFactors: false });
    fa.processTick(mkTick(T, now - 4000, true, 1.05, 0.01, '0xX', 1101, 10), { emitFactors: false });
    fa.processTick(mkTick(T, now - 1000, true, 2, 0.01, '0xX', 1102, 10), { emitFactors: false });
    fa.processTick(mkTick(T, now, true, 2, 0.01, '0xX', 1103, 10), { emitFactors: false });
    const f = fa.buildFactorMap(T, now);
    approx(f.riseFromLow6s, 100, 1e-9, '针曲线：6s 自低点反弹 +100%');
    approx(f.spikeCurveRatio, 1.0, 1e-9, '针曲线：6s 档 100%/100% 锚点 → ratio=1.0');
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
    ok(f.max3BlockDropPct === null, '乱序 block：m3 链不受回退 tick 影响', f.max3BlockDropPct);
    // m3 正向：4 个连续块收盘 100→80→64→51.2 → d3 = 1-0.512 = 48.8%
    const fa2 = new FA({});
    const T2 = 'T_M3';
    fa2.registerToken(T2, { createdAtMs: t0, totalSupply: 1e9 });
    [[100, 1300], [80, 1301], [64, 1302], [51.2, 1303]].forEach(([p, b], i) => {
        fa2.processTick(mkTick(T2, t0 + i * 3000, true, p, 0.01, '0xM', b, 10), { emitFactors: false });
    });
    const f2 = fa2.buildFactorMap(T2, t0 + 3 * 3000);
    approx(f2.max3BlockDropPct, 48.8, 1e-9, 'm3：4 块连续收盘最大跌幅 48.8%');
}

function scenarioKlineShape(FA) {
    const fa = new FA({});
    const T = 'T_KLINE', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0, totalSupply: 1e9 });
    // 间隔 12s（> 脉冲期 10s）：首根闭合桶 firstTs=t0 在脉冲期内，其后根脉冲期外
    fa.processTick(mkTick(T, t0, true, 10, 0.05, '0xK', 1400, 10), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 12000, true, 11, 0.05, '0xK', 1401, 10), { emitFactors: false });
    const f1 = fa.buildFactorMap(T, t0 + 12000);
    ok(f1.klineBarReturn === null, 'K线：仅 1 根已闭合（当前块未闭合）→ barReturn null', f1.klineBarReturn);
    ok(f1.klineConsecUp === 1, 'K线：单根平开（close>=open）计 1', f1.klineConsecUp);
    ok(f1.rsi9 === null && f1.rsi14 === null, 'K线：1 根收盘 RSI warmup null', f1.rsi9);
    ok(f1.klineBsRatio === null, 'K线：纯买桶 sellBnb=0 → BsRatio null（避 Inf）', f1.klineBsRatio);
    fa.processTick(mkTick(T, t0 + 24000, true, 12, 0.05, '0xK', 1402, 10), { emitFactors: false });
    const f2 = fa.buildFactorMap(T, t0 + 24000); // closed=[{10},{11}]
    approx(f2.klineBarReturn, 10, 1e-9, 'K线：barReturn 比值口径 (11/10-1)×100');
    ok(f2.klineConsecUp === 2, 'K线：两根平开阳 consecUp=2', f2.klineConsecUp);
    ok(f2.postPulseConsecUp === 1, '脉冲期外连阳：{11} 计 1，{10} firstTs 在脉冲期内截断', f2.postPulseConsecUp);
    // block1402 内两笔：开 12 收 9 → 阴线；block1403 首笔闭合它
    fa.processTick(mkTick(T, t0 + 36000, true, 12, 0.05, '0xK', 1403, 10), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 37000, false, 9, 0.05, '0xK', 1403, 10), { emitFactors: false });
    fa.processTick(mkTick(T, t0 + 48000, true, 9, 0.05, '0xK', 1404, 10), { emitFactors: false });
    const f3 = fa.buildFactorMap(T, t0 + 48000); // closed=[{10},{11},{12},{o=12,c=9}]
    ok(f3.klineConsecUp === 0, 'K线：末根阴线（9<12）consecUp=0', f3.klineConsecUp);
    approx(f3.klineBarReturn, (9 / 12 - 1) * 100, 1e-9, 'K线：barReturn (9/12-1)×100（prev=block1402 收盘 12）');
    ok(f3.klineBsRatio !== null && f3.klineBsRatio > 0, 'K线：末根含卖 → BsRatio 出值', f3.klineBsRatio);
}

function scenarioIdleTickFlow(FA) {
    const fa = new FA({});
    const T = 'T_IDLE', t0 = 1758600000000;
    fa.registerToken(T, { createdAtMs: t0, totalSupply: 1e9 });
    const f0 = fa.buildFactorMap(T, t0);
    ok(f0.idleSecSinceLastTick === null && f0.tickFlowOk === null, '无 tick → 断流键 null（不误判）', f0.tickFlowOk);
    fa.processTick(mkTick(T, t0, true, 10, 0.01, '0xI', 1500, 10), { emitFactors: false });
    const f1 = fa.buildFactorMap(T, t0 + 5000); // age=5s ≤90 → 阈 9s
    ok(f1.tickFlowOk === 1 && f1.idleSecSinceLastTick === 5, '年轻档 idle=5s <9s → 1', f1.tickFlowOk);
    const f2 = fa.buildFactorMap(T, t0 + 200000); // age=200s >180 → 阈 24s
    ok(f2.tickFlowOk === 0, '老档 idle=200s >24s → 0', f2.tickFlowOk);
    approx(f2.idleSecSinceLastTick, 200, 1e-9, 'idleSecSinceLastTick=200');
}

function scenarioFactorKeys(FA, baselineKeys) {
    const fa = new FA({});
    const keys = fa.getFactorKeys();
    const NEW_KEYS = [
        // 滑窗 4
        'tradesPerSecondSlide', 'bnbPerSecondSlide', 'newTradersPerSecondSlide', 'newWalletsSlide',
        // K 组 2
        'counterpartyOverlapRate', 'counterpartyOverlapVolume',
        // shares 4
        'top3HolderShare', 'top5HolderShare', 'cumBuyTop5Share', 'maxCumBuyShare',
        // 大户 10
        'bigHolderPresent', 'bigHolderEarlyPresent', 'bigHolderLatePresent', 'bigHolderTotal',
        'bigHolderPresentRatio', 'bigHolderShare', 'bigHolderEarlyShare', 'bigHolderLateShare',
        'bigHolderDumpBnb3s', 'bigHolderDumpBnb9s',
        // P 组防砸盘 8
        'maxBlockDropPct', 'max3BlockDropPct', 'maxSingleBuyBnb', 'maxSingleSellBnb',
        'blockLowMcapBnb', 'blockLowMcapUsd', 'riseFromBlockLowPct', 'firstBlockBuyShare',
        // R 组 22
        'klineTrendSlope', 'klineTrendSampleSize', 'klineBarReturn', 'klineBodyPct',
        'klineConsecUp', 'klineBsRatio', 'klineVolBnb', 'postPulseConsecUp',
        'rsi9', 'rsi14', 'rsi9Sec', 'rsi14Sec', 'rsi14Bar15s', 'rsi30Sec', 'rsi60Sec',
        'slopePct20', 'nBuysMa10', 'klineRange5',
        'lastSwingLowPrice', 'prevSwingLowPrice', 'lastSwingLowRsi', 'prevSwingLowRsi',
        // T 组 12
        'msSinceHighest', 'blocksSinceHighest', 'postPeakSlope', 'maxDdSinceHighestPct',
        'crashSpeedPctPerSec', 'peakFallSpeedPctPerSec', 'secondsSinceDeepDrop70',
        'riseFromLow6s', 'spikeCurveRatio', 'priceTrendSlope',
        'recentDrawdownFromWindowHighPct', 'recentRiseFromWindowLowPct',
        // E 组 2
        'idleSecSinceLastTick', 'tickFlowOk',
        // H 组 4
        'peakProfitPct', 'ddConfirmSellFlag', 'rsi9PostProtect', 'rsi14PostProtect',
    ];
    const missing = NEW_KEYS.filter(k => !keys.has(k));
    ok(missing.length === 0, `getFactorKeys 含全部 ${NEW_KEYS.length} 新键`, missing);
    const added = [...keys].filter(k => !baselineKeys.has(k));
    ok(added.length === NEW_KEYS.length,
        `键集增量精确 = ${NEW_KEYS.length}（实际 +${added.length}，无意外键）`, added.filter(k => !NEW_KEYS.includes(k)));
    const lost = [...baselineKeys].filter(k => !keys.has(k));
    ok(lost.length === 0, '基线键零丢失', lost);
}

// ─────────── 主流程 ───────────

function main() {
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
        console.error('不在 git 仓库内，无法取基线');
        process.exit(1);
    }
    console.log('═'.repeat(72));
    console.log('pumpfun 回迁批 1 因子测试');
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

        console.log('\n[1] 旧键零 diff 回归（基线 = git 2c8c74f）');
        runZeroDiff(BaselineFA, CurrentFA);

        console.log('[2] 场景断言');
        scenarioKOverlap(CurrentFA);
        console.log('  ✓ K 组对敲重叠');
        scenarioConcentration(CurrentFA);
        console.log('  ✓ 持仓集中度 + totalSupply null 语义');
        scenarioBigHolder(CurrentFA);
        console.log('  ✓ bigHolder 群体/早到晚到/出货窗/留存裁剪');
        scenarioRsiDuality(CurrentFA);
        console.log('  ✓ RSI 双实现对拍 + warmup null');
        scenarioPeakAndDeepDrop(CurrentFA);
        console.log('  ✓ 峰值链/深跌 latch/砸速/新高重置');
        scenarioMaxBlockDrop(CurrentFA);
        console.log('  ✓ 单块跌幅链（块内瞬时 + 相邻对结算时机）');
        scenarioDdConfirm(CurrentFA);
        console.log('  ✓ ddConfirm 状态机 + peakProfitPct');
        scenarioFirstBlockPulse(CurrentFA);
        console.log('  ✓ 首块脉冲 + 单笔最大');
        scenarioSlideWindow(CurrentFA);
        console.log('  ✓ 滑窗 span 自适应 + 出窗');
        scenarioSpikeCurve(CurrentFA);
        console.log('  ✓ 针曲线 + riseFromLow6s');
        scenarioOutOfOrderBlock(CurrentFA);
        console.log('  ✓ 乱序 block 忽略 + m3');
        scenarioKlineShape(CurrentFA);
        console.log('  ✓ K 线形态（比值 barReturn/连阳/脉冲期）');
        scenarioIdleTickFlow(CurrentFA);
        console.log('  ✓ 断流分档');
        scenarioFactorKeys(CurrentFA, baselineKeys);
        console.log('  ✓ getFactorKeys 键集增量精确');
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
