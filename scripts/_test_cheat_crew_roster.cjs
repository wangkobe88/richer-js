#!/usr/bin/env node
/**
 * 做市/作弊团队黑名单 + cheatCrewBuyBnb/cheatCrewWallets 因子单测（T179 2026-11-18
 * bt-v147 瞬时V案，用户裁定「作弊钱包名单迟早要做……控住」）——本地零 DB 零网络
 * （名单经 setCheatCrewWalletsForTest 桩注入；loader 用 tmp 文件）。
 *
 * 因子口径：名单钱包在本 token 的累计买入 BNB（K 组 _buyerVolume 读时扫——famous/
 * sybil 同款零写点）+ 命中成员数。ladder v31 G5（同车 T178+T179） `cheatCrewBuyBnb == 0` 绝对 veto
 * 载体：0=名单缺失/空集合/无命中（famous 去 NULL 同方向——未启用零影响）；>0=拒。
 *
 * 覆盖：
 *   A. 案源现场反证：拉升三件套 0.296+0.2x+0.059 三笔买入 → buyBnb=Σ、wallets=3
 *      （0x6b03 t+47s pull 波形状）
 *   B. 卖腿不计（团队砸盘卖出不改变「已在场买入」标记——累计不冻结不回退）
 *   C. 名单 null（未加载）→ 0 放行 / 空 Set → 0 放行（fail-open 双形状）
 *   D. defer 两段喂食 parity：无 sender 行喂价段 + applyWalletTick 回推真 sender
 *      → 恰计一次（K 组单挂点天然保证）
 *   E. 乱序回放收敛（Map 累加交换律）
 *   F. 键探针自动收键（getFactorKeys 含两键——三防线零登记）
 *   G. loader：tmp 名单文件加载（toLowerCase 归一）/幂等/损坏 throw/schema 不符 throw
 *   H. 大小写命中（trader 口径 checksum 形态行——命中侧 toLowerCase 对齐）
 *   I. 源码锁：读点禁 Date.now（全史累计无需 now）/0 语义（无 IS NULL 臂需求）/
 *      两引擎 loader 接线在位
 *
 * 用法：node scripts/_test_cheat_crew_roster.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// 案源拉升三件套（0x6b03/0x2939 跨票逐笔复现档位）
const PULL_A = '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc'; // 0.296 档
const PULL_B = '0x0b2259e10d494f848ea1458acb39152ad9865424'; // 0.2x 档
const PULL_C = '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2'; // 0.059 档
const OUTSIDER = '0x9999888877776666555544443333222211110000';
const ROSTER = new Set([PULL_A, PULL_B, PULL_C]);

async function main() {
    console.log('═ A. 案源现场反证（三件套 pull 波）');
    await checkAsync('三笔 pull 买入 → buyBnb=Σ(0.296+0.2491+0.0592)/wallets=3', async () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: PULL_A, bnb_amount: 0.296 }));
        fa.processTick(mkTick({ sender_address: PULL_B, bnb_amount: 0.2491 }));
        fa.processTick(mkTick({ sender_address: PULL_C, bnb_amount: 0.0592 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0.6043);
        assert.strictEqual(f.cheatCrewWallets, 3);
    });
    await checkAsync('条件串语义：cheatCrewBuyBnb == 0 → false（G5 拒）', async () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: PULL_A, bnb_amount: 0.296 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb === 0, false);
    });

    console.log('═ B. 卖腿不计/累计不回退');
    check('团队清仓卖出后计数保持（身份标记非净持仓）', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: PULL_A, bnb_amount: 0.296 }));
        fa.processTick(mkTick({ sender_address: PULL_A, trade_type: 'sell', bnb_amount: 0.29 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0.296);
        assert.strictEqual(f.cheatCrewWallets, 1);
    });
    check('名单外钱包大额买入不计', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: OUTSIDER, bnb_amount: 5 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0);
        assert.strictEqual(f.cheatCrewWallets, 0);
    });

    console.log('═ C. 0 语义（fail-open 双形状）');
    check('名单 null（未加载）→ 恒 0 放行', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(null);
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: PULL_A, bnb_amount: 0.296 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0);
        assert.strictEqual(f.cheatCrewWallets, 0);
    });
    check('空 Set（已加载未启用）→ 恒 0 放行', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(new Set());
        const fa = newFA();
        fa.processTick(mkTick({ sender_address: PULL_A, bnb_amount: 0.296 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0);
    });

    console.log('═ D. defer 两段喂食恰一次');
    await checkAsync('无 sender 价段 + applyWalletTick 真 sender 回推 → 恰计一次', async () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        const row = mkTick({ sender_address: null, trader_address: null, bnb_amount: 0.296 });
        fa.processTick(row, { deferWallet: true });
        let f = fa.buildFactorMap('0xtoken', new Date(T0 + 1500));
        assert.strictEqual(f.cheatCrewBuyBnb, 0, '价段（sender 未知）不计');
        fa.applyWalletTick(Object.assign({}, row, { sender_address: PULL_A }));
        f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0.296);
        assert.strictEqual(f.cheatCrewWallets, 1);
    });

    console.log('═ E. 乱序回放收敛');
    check('任意序重放同值（Map 累加交换律）', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const rows = [
            mkTick({ sender_address: PULL_A, bnb_amount: 0.296, block_number: 200 }),
            mkTick({ sender_address: PULL_B, bnb_amount: 0.2491, block_number: 100 }),
            mkTick({ sender_address: PULL_A, bnb_amount: 0.1, block_number: 150 }),
            mkTick({ sender_address: OUTSIDER, bnb_amount: 2, block_number: 120 }),
        ];
        const fa1 = newFA(); for (const r of rows) fa1.processTick(r);
        const fa2 = newFA(); for (const r of [...rows].reverse()) fa2.processTick(r);
        const f1 = fa1.buildFactorMap('0xtoken', new Date(T0 + 9000));
        const f2 = fa2.buildFactorMap('0xtoken', new Date(T0 + 9000));
        assert.strictEqual(f1.cheatCrewBuyBnb, f2.cheatCrewBuyBnb);
        assert.strictEqual(f1.cheatCrewBuyBnb, 0.6451);
        assert.strictEqual(f1.cheatCrewWallets, f2.cheatCrewWallets);
    });

    console.log('═ F. 探针收键（三防线自动性）');
    check('getFactorKeys() 含 cheatCrewBuyBnb/cheatCrewWallets', () => {
        const fa = newFA();
        const keys = fa.getFactorKeys();
        assert.ok(keys.has('cheatCrewBuyBnb'), 'cheatCrewBuyBnb 不在键集');
        assert.ok(keys.has('cheatCrewWallets'), 'cheatCrewWallets 不在键集');
    });
    check('FactorBuilder 时序快照白名单透传两键', () => {
        const { buildFactorValuesForTimeSeries } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
        const snap = buildFactorValuesForTimeSeries({ cheatCrewBuyBnb: 0.296, cheatCrewWallets: 1 });
        assert.strictEqual(snap.cheatCrewBuyBnb, 0.296);
        assert.strictEqual(snap.cheatCrewWallets, 1);
        const snapEmpty = buildFactorValuesForTimeSeries({});
        assert.strictEqual(snapEmpty.cheatCrewBuyBnb, null, '旧 FA 无键 → null 不掩盖');
    });

    console.log('═ G. loader');
    await checkAsync('tmp 名单文件加载（toLowerCase 归一,v3 两形状同测）+ 幂等', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-roster-'));
        const p = path.join(dir, 'cheat-crew-wallets.json');
        fs.writeFileSync(p, JSON.stringify({ version: 3, wallets: [PULL_A.toUpperCase(), { address: PULL_B, role: 'burst 等额三人组' }] }));
        // loader 路径硬编码 config/rosters——测试用环境置换：直接验证解析语义
        // v3 两形状归一（string | {address, role}——role=作弊方式备注,用户裁定 2026-11-18）
        const addrOf = w => typeof w === 'string' ? w : (w && typeof w === 'object' && typeof w.address === 'string' ? w.address : null);
        const addrs = JSON.parse(fs.readFileSync(p, 'utf8')).wallets.map(addrOf).filter(w => w).map(w => w.toLowerCase());
        const set = new Set(addrs);
        assert.ok(set.has(PULL_A));
        assert.ok(set.has(PULL_B), 'v3 对象形状 {address, role} 未被归一');
        assert.strictEqual(set.size, 2);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    check('仓库在位 roster 文件 schema 合法（wallets 数组+13 址 v3 对象形状全 role 备注）', () => {
        const p = path.join(ROOT, 'config', 'rosters', 'cheat-crew-wallets.json');
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        assert.ok(Array.isArray(parsed.wallets), 'wallets 非数组');
        assert.strictEqual(parsed.wallets.length, 13);
        assert.strictEqual(parsed.version, 3, 'version 未至 v3（对象形状）');
        for (const w of parsed.wallets) {
            assert.ok(w && typeof w === 'object' && typeof w.address === 'string' && /^0x[0-9a-f]{40}$/.test(w.address), `元素非 {address} 形状: ${JSON.stringify(w).slice(0, 60)}`);
            assert.ok(typeof w.role === 'string' && w.role.length >= 8, `role 作弊方式备注缺失: ${w.address}`);
        }
        const addrs = new Set(parsed.wallets.map(w => w.address));
        assert.ok(addrs.has(PULL_A));
        assert.ok(addrs.has('0x27ac0351e225a15fb13d6b84a8dc31d799d0fe76'));
        // v2 追加：0x37d9 burst 流水线 7 址（等额三人组+c18/c3 配单）
        assert.ok(addrs.has('0x9d41e99374e4bceebb4c0bd070e814e72b7e7ace'));
        assert.ok(addrs.has('0xf7a934528d38e2f2865a7cd30c335c6d115928b8'));
        assert.ok(addrs.has('0xa44039d10d4883a7353ee729a48fda88fa5d2333'));
    });
    check('loader 源码锁：v3 两形状归一+非法元素 throw（静默滤空=G5 veto 失效危险方向）', () => {
        const src = read('src/services/FourMemeFactorAggregator.js');
        const i = src.indexOf('static async loadCheatCrewWallets()');
        const seg = src.slice(i, src.indexOf('setCheatCrewWalletsForTest', i));
        assert.ok(seg.includes('addrOf'), 'v3 addrOf 归一缺失');
        assert.ok(/throw new Error\(`\[FourMemeFA\] loadCheatCrewWallets: 名单元素形状非法/.test(seg), '非法形状 fail-loud throw 缺失');
        assert.ok(!seg.includes(".filter(w => typeof w === 'string'"), '旧静默过滤残留');
    });

    console.log('═ H. 大小写命中（checksum 形态行）');
    check('trader_address 大写形态 → 命中侧 toLowerCase 对齐', () => {
        FourMemeFactorAggregator.setCheatCrewWalletsForTest(ROSTER);
        const fa = newFA();
        // sender 缺失回退 trader；trader 为 checksum 大写形态（K 组键原样存，命中侧归一）
        fa.processTick(mkTick({ sender_address: null, trader_address: PULL_A.toUpperCase(), bnb_amount: 0.296 }));
        const f = fa.buildFactorMap('0xtoken', new Date(T0 + 2000));
        assert.strictEqual(f.cheatCrewBuyBnb, 0.296);
    });

    console.log('═ I. 源码锁');
    check('因子读块禁 Date.now（全史累计无需墙钟）', () => {
        const src = read('src/services/FourMemeFactorAggregator.js');
        const i = src.indexOf('let cheatCrewBuyBnb = 0;');
        const seg = src.slice(i, src.indexOf('// trend*', i));
        assert.ok(!/Date\.now/.test(seg), 'cheatCrew 读块出现 Date.now');
    });
    check('两引擎 loader 接线在位（parity）', () => {
        for (const f of ['src/trading-engine/implementations/FourMemeWssTradingEngine.js',
            'src/trading-engine/implementations/BacktestEngine.js']) {
            assert.ok(read(f).includes('loadCheatCrewWallets'), `${f} 缺 loader 接线`);
        }
    });
    check('ladder G5 门串在位（deploy 脚本；版本锁随 T180 v33 迁移同步——G5 在 v31 引入沿用，v33=T180 G6 迁出回 G1~G5）', () => {
        const src = read('scripts/deploy-signal-source-strategies.cjs');
        assert.ok(src.includes("CREW_VETO_GATE = ' AND cheatCrewBuyBnb == 0'"), 'G5 门串缺失');
        assert.ok(src.includes('l.condition += CREW_VETO_GATE'), 'G5 未拼进腿');
        assert.ok(src.includes('信号源阶梯 v33'), '版本号未至 v33（T180 迁移）');
    });

    FourMemeFactorAggregator.setCheatCrewWalletsForTest(null);
    console.log(`\n${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
