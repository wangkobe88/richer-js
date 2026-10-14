#!/usr/bin/env node
/**
 * 单测：FA 两阶段喂食 + 链上序迟到防护（2026-10-14 鸡蛋案 0x906e95e2…7777）
 *
 * 鸡蛋案事故现场（flap USD 计价盘，v12 94924a30）：SenderResolver 并发 4，同块 10 笔
 * 突发回查 ~3s，FA 按 RPC 完成序乱序喂食——迟到 li=393 旧价 7.352e-9 覆盖 currentPrice
 * （fire 价 61% 低锚）+ lastTickAt 回拨（idleSec 虚高 3.593 假断流触发 P11 全清）。
 *
 * 修复形状：
 * 1. processTick({deferWallet:true}) 只跑价格/流量段（WSS 到达即喂，零回查依赖）
 * 2. applyWalletTick sender 定值后补 wallet 聚合段（holders/K 组/holderTrend/GMGN 精确计数）
 * 3. chainLate 判据：blockNumber+log_index 复合水位（同块 block_time 相同判不出倒挂），
 *    迟到 tick 跳过价格接受链（_acceptPrice 有副作用防污染），流量照计
 * 4. lastTickAt Math.max 防回拨
 *
 * 零 DB 零网络。node scripts/_test_fa_deferred_wallet_feeding.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const FourMemeFactorAggregator = require(path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator'));

let passed = 0, failed = 0;
function ok(cond, name, extra) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}${extra !== undefined ? `\n    got: ${JSON.stringify(extra)}` : ''}`); }
}
function eq(actual, expected, name) { ok(Object.is(actual, expected), name, `${actual} (期望 ${expected})`); }

const GMGN = '0x1de460f363af910f51726def188f9004276bf4bc'; // GMGN BSC 聚合路由（AGGREGATOR_ROUTER_ADDRS 首条）
const T0 = 1790802000000;
let liSeq = 0;

/** 造 tick（真实 collector 形状；log_index 块内全局递增不变量） */
function mkTick(overrides) {
    return Object.assign({
        token_address: '0xtoken',
        trade_type: 'buy',
        trader_address: null,
        sender_address: null,
        price_bnb: 0.00001,
        price_usd: 0.006,
        bnb_amount: 1,
        token_amount: 1000,
        block_number: 100,
        timestamp: T0,
        tx_hash: '0xtx' + (++liSeq),
        log_index: ++liSeq,
    }, overrides);
}

function newFA(config) {
    const fa = new FourMemeFactorAggregator(config || {}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0 - 1000, totalSupply: 1e9, symbol: 'EGG' });
    return fa;
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[1] 鸡蛋案事故现场反证：迟到旧价不覆盖 currentPrice、不回拨 lastTickAt');

{
    // 事故时序复刻（同块两笔，先喂 li=547 新价、后到 li=393 旧价——鸡蛋案实测倒挂形状）
    const late = mkTick({
        trade_type: 'sell', trader_address: '0xeoa_a', sender_address: '0xeoa_a',
        price_bnb: 7.352e-9, bnb_amount: 0.5, token_amount: 100,
        block_number: 53167284, log_index: 393, timestamp: T0,
    });
    const fresh = mkTick({
        trade_type: 'sell', trader_address: '0xeoa_b', sender_address: '0xeoa_b',
        price_bnb: 8.6176e-9, bnb_amount: 0.5, token_amount: 100,
        block_number: 53167284, log_index: 547, timestamp: T0 + 20,
    });
    const lateOldTs = mkTick({ // 另一笔跨块迟到（block 更小 + ts 更旧）
        trade_type: 'sell', trader_address: '0xeoa_c', sender_address: '0xeoa_c',
        price_bnb: 6.9e-9, bnb_amount: 0.5, token_amount: 100,
        block_number: 53167283, log_index: 900, timestamp: T0 - 3000,
    });

    const fa = newFA();
    // 两阶段：价格段即时喂（resolver 场景）
    fa.processTick(fresh, { deferWallet: true, emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 8.6176e-9, 'li=547 新价即时进 currentPrice（价格段零回查依赖）');

    // li=393 同块后到：chainLate 拦价格链
    const r2 = fa.processTick(late, { deferWallet: true, emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 8.6176e-9, 'li=393 迟到旧价不覆盖 currentPrice（鸡蛋案 61% 低锚根因根除）');
    eq(r2.priceAccepted, false, '迟到 tick priceAccepted=false');
    eq(r2.priceOutlier, false, '迟到 tick 不是 outlier（chainLate≠离群，落库 flag 不误标）');
    eq(fa._states.get('0xtoken').tradeCount, 2, '迟到 tick 流量照计（tradeCount=2）');

    // 跨块迟到 + ts 更旧：价格不进、lastTickAt 不回拨
    const tBefore = fa._states.get('0xtoken').lastTickAt;
    fa.processTick(lateOldTs, { deferWallet: true, emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 8.6176e-9, '跨块迟到旧价同样不进价格链');
    eq(fa._states.get('0xtoken').lastTickAt, tBefore, 'lastTickAt 不被迟到旧 ts 回拨（idleSec 假断流根因根除）');
    eq(fa._stats.chainLateTicks, 2, 'chainLateTicks 观测计数=2');

    // wallet 段照补（三笔全喂）：迟到 tick 的 wallet 聚合不丢（三笔皆 sell → 净持仓负、
    // holderCount=0 是正确语义；验证点=三个真实 EOA 全部入账）
    fa.applyWalletTick(fresh, { emitFactors: false });
    fa.applyWalletTick(late, { emitFactors: false });
    fa.applyWalletTick(lateOldTs, { emitFactors: false });
    const st1 = fa._states.get('0xtoken');
    eq(st1._walletNetTokens.size, 3, '三笔 wallet 段照补 → 净持仓 map 3 个真实 EOA（迟到不丢 wallet 聚合）');
    eq(st1._sellerAddresses.size, 3, 'K 组卖家集=3（sell 腿入账）');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[2] GMGN 路由票 holders 精确计数（两阶段 vs 旧 NULL 回退对照）');

{
    const fa = newFA({ tokenPositionAnalyzer: {} }); // 开 _maintainTpa（routedBuy 维护）
    // 3 个真实买家全部经 GMGN 路由：trader 全是 GMGN，sender 各不相同
    for (let i = 0; i < 3; i++) {
        const t = mkTick({
            trade_type: 'buy',
            trader_address: GMGN,
            sender_address: '0xreal_buyer_' + i,
            bnb_amount: 0.05, token_amount: 1000,
            block_number: 200 + i, log_index: 10 + i, timestamp: T0 + i * 500,
        });
        fa.processTick(t, { deferWallet: true, emitFactors: false });
        // 价格段喂完（sender 还是行初值）→ wallet 段补真 sender（resolver 回查完成）
        const row = Object.assign({}, t, { sender_address: '0xreal_buyer_' + i });
        fa.applyWalletTick(row, { emitFactors: false });
    }
    const st = fa._states.get('0xtoken');
    eq(st.holderCount, 3, 'GMGN 3 买家 → holderCount=3（真 sender 计数）');
    eq(st._walletNetTokens.size, 3, '净持仓 map 键=3 个真实 EOA（非 GMGN 单键合并像）');
    eq(st._buyerAddresses.size, 3, 'K 组买家集=3 个真实 EOA');
    eq(st._walletRoutedBuyBnb.size, 3, 'GMGN routedBuy 归集到 3 个真实钱包（TPA 剔除原料）');
    let routedTotal = 0;
    for (const v of st._walletRoutedBuyBnb.values()) routedTotal += v;
    ok(Math.abs(routedTotal - 0.15) < 1e-12, 'routedBuy 总量=0.15 BNB（3×0.05）', routedTotal);

    // 对照反证：若 wallet 段只吃 sender NULL 行（=不两阶段、resolver 失败回退）→ 合并像
    const fa2 = newFA();
    for (let i = 0; i < 3; i++) {
        fa2.processTick(mkTick({
            trade_type: 'buy', trader_address: GMGN, sender_address: null,
            bnb_amount: 0.05, token_amount: 1000,
            block_number: 200 + i, log_index: 10 + i, timestamp: T0 + i * 500,
        }), { emitFactors: false });
    }
    eq(fa2._states.get('0xtoken').holderCount, 1, '反证：sender 全 NULL 回退 trader → holderCount=1（合并像，两阶段修复目标）');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[3] 两段幂等：计数/流量只计一次，wallet 段不重计');

{
    const fa = newFA();
    const t = mkTick({
        trade_type: 'buy', trader_address: '0xw1', sender_address: '0xw1',
        bnb_amount: 0.02, token_amount: 500,
        block_number: 300, log_index: 1, timestamp: T0,
    });
    fa.processTick(t, { deferWallet: true, emitFactors: false });
    fa.applyWalletTick(t, { emitFactors: false });
    const st = fa._states.get('0xtoken');
    eq(st.tradeCount, 1, 'tradeCount=1（价格段计，wallet 段不重计）');
    ok(Math.abs(st.totalBuyBnb - 0.02) < 1e-15, 'totalBuyBnb=0.02（单次）', st.totalBuyBnb);
    eq(st.holderCount, 1, 'holderCount=1');
    ok(Math.abs((st._buyerVolume.get('0xw1') || 0) - 0.02) < 1e-15, 'K 组买量=0.02（单次）');
    eq(st.tickCount, 1, 'tickCount=1');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[4] defer 两阶段 vs 单段直喂：同一 tick 序 wallet 终态 bit 一致（乱序回推收敛）');

{
    const seq = [];
    for (let i = 0; i < 12; i++) {
        seq.push(mkTick({
            trade_type: i % 3 === 2 ? 'sell' : 'buy',
            trader_address: i % 2 === 0 ? GMGN : '0xdirect_' + (i % 3),
            sender_address: '0xsimple_' + (i % 5),
            price_bnb: 1e-8 * (1 + i * 0.05),
            bnb_amount: 0.01 + i * 0.001,
            token_amount: 400 + i * 10,
            block_number: 400 + Math.floor(i / 2),
            log_index: i,
            timestamp: T0 + i * 450,
        }));
    }
    // A：单段直喂（回测/无 resolver 路径，链上序）
    const faA = newFA();
    seq.forEach(t => faA.processTick(t, { emitFactors: false }));
    // B：两阶段，wallet 段乱序回推（模拟 RPC 完成序：偶数笔先补、奇数笔后补）
    const faB = newFA();
    seq.forEach(t => faB.processTick(t, { deferWallet: true, emitFactors: false }));
    for (let i = seq.length - 2; i >= 0; i -= 2) faB.applyWalletTick(seq[i], { emitFactors: false }); // 偶序
    for (let i = seq.length - 1; i >= 0; i -= 2) faB.applyWalletTick(seq[i], { emitFactors: false }); // 奇序
    const a = faA._states.get('0xtoken'), b = faB._states.get('0xtoken');
    // defer 路径 holderTrend 序列由事件缓冲+读取时重放维护——走真实消费路径触发
    faB.buildFactorMap('0xtoken', T0 + 12 * 450);
    eq(a.holderCount, b.holderCount, `holderCount 一致（${a.holderCount}）——任意序重放收敛（P2a 归纳等价）`);
    eq(a._walletNetTokens.size, b._walletNetTokens.size, '净持仓 map 键集一致');
    let netSame = true;
    for (const [k, v] of a._walletNetTokens) {
        if (b._walletNetTokens.get(k) !== v) { netSame = false; break; }
    }
    ok(netSame, '净持仓逐钱包数值一致');
    eq(a._buyerAddresses.size, b._buyerAddresses.size, '买家集一致');
    eq(a._sellerAddresses.size, b._sellerAddresses.size, '卖家集一致');
    eq(a.currentPriceBnb, b.currentPriceBnb, 'currentPrice 一致（价格段两路径同序）');
    eq(a.tradeCount, b.tradeCount, 'tradeCount 一致');
    // holderTrend 桶也收敛（blockNumber 归桶，晚到不错桶）
    const ha = JSON.stringify(a._holderSeries), hb = JSON.stringify(b._holderSeries);
    ok(ha === hb, 'holderTrend 原料序列一致（blockNumber 桶乱序回推收敛）', `${ha?.slice(0, 80)} vs ${hb?.slice(0, 80)}`);
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[5] applyWalletTick fail-loud：价格段未先行 throw（时序契约破坏不静默）');

{
    const fa = newFA();
    let threw = null;
    try {
        fa.applyWalletTick(mkTick({ token_address: '0xnever_seen', timestamp: T0 }), { emitFactors: false });
    } catch (e) { threw = e; }
    ok(threw !== null && /无 state/.test(threw.message), 'state 缺失 throw fail-loud（绝不静默建裸 state）', threw && threw.message);
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[6] chainLate 判据边界');

{
    const fa = newFA();
    // 链证据缺失 fail-open
    const noLi = mkTick({ block_number: 500, log_index: null, timestamp: T0, price_bnb: 1e-8, trade_type: 'sell' });
    fa.processTick(noLi, { emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 1e-8, 'log_index 缺失 → fail-open 不判迟到（价格照进）');
    const noBlock = mkTick({ block_number: null, log_index: 7, timestamp: T0 + 100, price_bnb: 1.1e-8, trade_type: 'sell' });
    fa.processTick(noBlock, { emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 1.1e-8, 'block_number 缺失 → fail-open 不判迟到');

    // 同 (block, log_index) 重复行判迟到（UNIQUE(tx_hash,log_index) 下不应出现；防线）
    const dup = mkTick({ block_number: 501, log_index: 9, timestamp: T0 + 200, price_bnb: 1.2e-8, trade_type: 'sell' });
    fa.processTick(dup, { emitFactors: false });
    const dup2 = mkTick({ block_number: 501, log_index: 9, timestamp: T0 + 200, price_bnb: 9e-9, trade_type: 'sell' });
    fa.processTick(dup2, { emitFactors: false });
    eq(fa._states.get('0xtoken').currentPriceBnb, 1.2e-8, '同 (block,li) 重复行不进价格链（<= 判据含等值）');

    // 离群毒价防护不受 chainLate 影响：正常新 tick 大幅偏离 → outlier 拒收
    const poison = mkTick({ block_number: 502, log_index: 10, timestamp: T0 + 300, price_bnb: 1.2e-8 * 3000, trade_type: 'sell' });
    const rp = fa.processTick(poison, { emitFactors: false });
    eq(rp.priceOutlier, true, '离群毒价照常拒收（chainLate 不削弱 outlier 判定）');
    eq(fa._states.get('0xtoken').currentPriceBnb, 1.2e-8, '毒价不进 currentPrice');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[7] factorsUpdated 双发：价格版先到、wallet 版后补（引擎 debounce 合并）');

{
    const fa = newFA();
    const events = [];
    fa.on('factorsUpdated', (e) => events.push(e));
    const t = mkTick({
        trade_type: 'buy', trader_address: GMGN, sender_address: '0xreal',
        block_number: 600, log_index: 1, timestamp: T0,
    });
    fa.processTick(t, { deferWallet: true }); // emitFactors 默认 true
    const priceEmitCount = events.length;
    eq(priceEmitCount, 1, '价格段 emit 一次');
    ok(events[0].factors && events[0].factors.holders === 0, '价格版 factors 先发（wallet 未补 → holders=0 滞后值）', events[0].factors && events[0].factors.holders);
    fa.applyWalletTick(Object.assign({}, t, { sender_address: '0xreal' }));
    eq(events.length, 2, 'wallet 段再 emit 一次（合计双发）');
    eq(events[1].factors.holders, 1, 'wallet 版 factors.holders=1（真 sender 计数）');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[8] collector 源码口径：两阶段调用序形状锁定（flap + fourmeme 同构）');

{
    for (const file of ['flap-ankr-ws-collector.js', 'fourmeme-ankr-ws-collector.js']) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'collectors', file), 'utf8');
        const feedDefer = 'this._feedFa(decoded, tickRow, priceUsd, { deferWallet: true })';
        const submitIdx = src.indexOf('this._senderResolver.submit({');
        const deferIdx = src.indexOf(feedDefer);
        ok(deferIdx !== -1 && deferIdx < submitIdx, `${file}: 价格段 deferWallet 喂食先于 resolver.submit`);
        ok(/pushRow: \(row\) => \{ this\._feedWallet\(decoded, row, priceUsd, priceFa\); this\._pushTickRow\(row\); \}/.test(src),
            `${file}: pushRow = _feedWallet→_pushTickRow（sender 定值后补 wallet 段）`);
        ok(/price_accepted: priceFa \? priceFa\.priceAccepted === true : false/.test(src),
            `${file}: priceFa.priceAccepted 透传（smartBot 补跑资格原料）`);
        // 无 resolver 直推路径保持单段零变化
        const directRe = /else \{\s*this\._feedFa\(decoded, tickRow, priceUsd\);\s*this\._pushTickRow\(tickRow\);\s*\}/;
        ok(directRe.test(src), `${file}: 无 resolver 直推路径单段零变化（回测/禁用 resolver 行为不变）`);
        // 旧单段回推形状必须已移除（防回流）
        ok(!src.includes('pushRow: (row) => { this._feedFa(decoded, row, priceUsd); this._pushTickRow(row); }'),
            `${file}: 旧「回推再 _feedFa」单段形状已移除（防回流）`);
    }
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════════');
console.log(`结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('全部通过 ✅');
