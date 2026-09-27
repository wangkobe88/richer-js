#!/usr/bin/env node
/**
 * 卡牌仓位机制测试（零 DB，迁自 rich-js 卡牌机制）
 *
 * 1) StrategyEngine 归一化：cards（'8'→8 / 卖腿 'all' / 买腿 'all'→null / 脏值→null）
 *    与 cooldownSec（字符串数字/正小数保留，非正/非数→null）
 * 2) 冷却：evaluate 在 cooldownSec 内跳过该腿（低优先级腿可顶上）、期满恢复、
 *    与 maxExecutions 共存、无 tokenData 不拦截；recordStrategyExecution(..., ts)
 *    写入指定时刻（回测虚拟时钟依赖）
 * 3) 卡牌算术（decimal.js 直证）：钳制语义、全清腿 sellPct 恒精确 1（Object.is）、
 *    PM 删仓判据 Decimal.mul(1).sub(x).eq(0)、部分腿 1/3 残差链 + 末腿全清余仓归零
 *
 * 用法：node scripts/_test_card_position_mechanisms.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Decimal = require(path.join(ROOT, 'node_modules/decimal.js'));
const { StrategyEngine } = require(path.join(ROOT, 'src/strategies/StrategyEngine'));
const TokenPool = require(path.join(ROOT, 'src/core/token-pool'));

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}

// ==================== 1. 归一化 ====================

function testNormalization() {
    console.log('\n[1] cards / cooldownSec 归一化');
    const se = new StrategyEngine({
        strategies: [
            { id: 's_str', name: '字符串数字', action: 'sell', condition: 'profitPercent > 50', priority: 1, cards: '8' },
            { id: 's_all', name: '全清', action: 'sell', condition: 'profitPercent > 50', priority: 2, cards: ' ALL ' },
            { id: 's_num', name: '数字', action: 'sell', condition: 'profitPercent > 50', priority: 3, cards: 4 },
            { id: 's_dirty', name: '脏值', action: 'sell', condition: 'profitPercent > 50', priority: 4, cards: 2.5 },
            { id: 's_zero', name: '零', action: 'sell', condition: 'profitPercent > 50', priority: 5, cards: 0 },
            { id: 'b_all', name: '买腿all非法', action: 'buy', condition: 'earlyReturn > 80', priority: 6, cards: 'all' },
            { id: 'b_cards', name: '买腿数字', action: 'buy', condition: 'earlyReturn > 80', priority: 7, cards: '4', cooldownSec: '600' },
            { id: 's_frac', name: '小数冷却合法', action: 'sell', condition: 'profitPercent > 50', priority: 8, cooldownSec: 30.5 },
            { id: 's_bad_cd', name: '非正冷却', action: 'sell', condition: 'profitPercent > 50', priority: 9, cooldownSec: -5 },
        ],
    });

    ok(se.getStrategy('s_str').cards === 8, "cards '8' → 8", se.getStrategy('s_str').cards);
    ok(se.getStrategy('s_all').cards === 'all', "卖腿 ' ALL ' → 'all'", se.getStrategy('s_all').cards);
    ok(se.getStrategy('s_num').cards === 4, 'cards 4 → 4', se.getStrategy('s_num').cards);
    ok(se.getStrategy('s_dirty').cards === null, 'cards 2.5 → null', se.getStrategy('s_dirty').cards);
    ok(se.getStrategy('s_zero').cards === null, 'cards 0 → null', se.getStrategy('s_zero').cards);
    ok(se.getStrategy('b_all').cards === null, "买腿 'all' → null", se.getStrategy('b_all').cards);
    ok(se.getStrategy('b_cards').cards === 4 && se.getStrategy('b_cards').cooldownSec === 600,
        "买腿 cards '4'→4 / cooldownSec '600'→600",
        { c: se.getStrategy('b_cards').cards, cd: se.getStrategy('b_cards').cooldownSec });
    ok(se.getStrategy('s_frac').cooldownSec === 30.5, 'cooldownSec 30.5 保留', se.getStrategy('s_frac').cooldownSec);
    ok(se.getStrategy('s_bad_cd').cooldownSec === null, 'cooldownSec -5 → null', se.getStrategy('s_bad_cd').cooldownSec);
    ok(se.getStrategy('s_str').cooldownSec === null, '未配置 cooldownSec → null', se.getStrategy('s_str').cooldownSec);
    ok(se.getStrategy('s_str').sellPercentage === 1, '未配置 sellPercentage 缺省 1 不受影响', se.getStrategy('s_str').sellPercentage);
}

// ==================== 2. 冷却 ====================

function testCooldown() {
    console.log('\n[2] 冷却（evaluate + recordStrategyExecution）');

    // 2.1 recordStrategyExecution 写入指定时刻（回测虚拟时钟）
    const stubLogger = { info() {}, warn() {}, error() {}, debug() {} };
    const pool = new TokenPool(stubLogger);
    pool.addToken({ token: '0xABC', chain: 'bsc', symbol: 'TST', created_at: Date.now() / 1000 });
    pool.initStrategyExecutions('0xABC', 'bsc', ['sell_0_1']);
    const T0 = 1_750_000_000_000; // 任意虚拟时刻
    pool.recordStrategyExecution('0xABC', 'bsc', 'sell_0_1', T0);
    const rec = pool.getToken('0xABC', 'bsc').strategyExecutions['sell_0_1'];
    ok(rec.count === 1 && rec.lastExecuted === T0, 'recordStrategyExecution(..., T0) 写入指定虚拟时刻',
        { count: rec.count, lastExecuted: rec.lastExecuted });

    // 2.2 冷却期内跳过高优先级腿 → 低优先级腿顶上；期满恢复
    const se = new StrategyEngine({
        strategies: [
            { id: 'sell_hi', name: '高优先级', action: 'sell', condition: 'profitPercent > 50', priority: 1, cooldownSec: 600 },
            { id: 'sell_lo', name: '低优先级', action: 'sell', condition: 'profitPercent > 50', priority: 2 },
        ],
    });
    const tokenData = {
        strategyExecutions: {
            sell_hi: { count: 1, lastExecuted: T0 },
            sell_lo: { count: 0, lastExecuted: null },
        },
    };
    const factors = { profitPercent: 80 };

    let hit = se.evaluate(factors, '0xABC', T0 + 599 * 1000, tokenData, 'sell');
    ok(hit && hit.id === 'sell_lo', '冷却期内高优先级腿跳过 → 低优先级腿顶上', hit && hit.id);

    hit = se.evaluate(factors, '0xABC', T0 + 600 * 1000, tokenData, 'sell');
    ok(hit && hit.id === 'sell_hi', '冷却期满高优先级腿恢复', hit && hit.id);

    // 2.3 与 maxExecutions 共存：总次数先耗尽 → 冷却无关，永久跳过
    const se2 = new StrategyEngine({
        strategies: [
            { id: 'sell_x', name: '限次', action: 'sell', condition: 'profitPercent > 50', priority: 1, maxExecutions: 1, cooldownSec: 600 },
            { id: 'sell_y', name: '兜位', action: 'sell', condition: 'profitPercent > 50', priority: 2 },
        ],
    });
    const td2 = { strategyExecutions: { sell_x: { count: 1, lastExecuted: T0 }, sell_y: { count: 0, lastExecuted: null } } };
    hit = se2.evaluate(factors, '0xABC', T0 + 9999 * 1000, td2, 'sell');
    ok(hit && hit.id === 'sell_y', 'maxExecutions 耗尽优先于冷却（永久跳过）', hit && hit.id);

    // 2.4 无 tokenData / 无执行记录 → 不拦截
    hit = se.evaluate(factors, '0xABC', T0, null, 'sell');
    ok(hit && hit.id === 'sell_hi', '无 tokenData 不受冷却拦截', hit && hit.id);
    const td3 = { strategyExecutions: { sell_hi: { count: 0, lastExecuted: null } } };
    hit = se.evaluate(factors, '0xABC', T0, td3, 'sell');
    ok(hit && hit.id === 'sell_hi', 'lastExecuted=null 不拦截', hit && hit.id);
}

// ==================== 3. 卡牌算术（PM 精度链直证） ====================

/** 引擎侧 sizing 的纯算术复刻（_emitSellSignal 内的解析逻辑） */
function resolveCardSellPct(cards, tokenCards) {
    const soldN = cards === 'all' ? tokenCards : Math.min(cards, tokenCards);
    return soldN >= tokenCards ? 1 : soldN / tokenCards;
}

function testCardArithmetic() {
    console.log('\n[3] 卡牌算术（decimal.js PM 精度链）');

    // 3.1 钳制与全清腿恒精确 1
    ok(resolveCardSellPct(1, 3) === 1 / 3, '1卡/3卡 → 1/3', resolveCardSellPct(1, 3));
    ok(Object.is(1, resolveCardSellPct(5, 3)), '请求5卡/余3卡 → 钳制全清，sellPct 恒精确 1', resolveCardSellPct(5, 3));
    ok(Object.is(1, resolveCardSellPct('all', 3)), "'all' → 精确 1", resolveCardSellPct('all', 3));
    ok(Object.is(1, resolveCardSellPct(1, 1)), '1卡/1卡 → 精确 1（末卡全清）', resolveCardSellPct(1, 1));

    // 3.2 PM 删仓判据：Decimal(x).mul(1) 恒等 → sub 后 eq(0)
    // 不变量：PM 持仓 amount 恒 ≤20 位有效数字（PM add/sub 结果按 Decimal 默认精度 20
    // 舍入；买入 amount 经 toNumber() ≤17 位）。mul(1) 在 ≤20 位时精确恒等（积不触发
    // 舍入）；>20 位时积会被舍入到 20 位 → 非恒等。两条都锁：前者是判据成立的前提，
    // 后者是边界警示（若未来链路产出 >20 位 Decimal，全清腿判据即失效，须先修口径）
    const amt = new Decimal('8932.5612345678901234'); // 20 位有效数字（PM 上界）
    ok(new Decimal(amt).mul(1).sub(amt).eq(0), 'amount ≤20 位有效数字时 Decimal.mul(1) 恒等（PM 删仓判据成立）');
    const amtOver = new Decimal('8932.56123456789012345678'); // 24 位（超界）
    ok(!new Decimal(amtOver).mul(1).sub(amtOver).eq(0), '边界锁：>20 位有效数字时 mul(1) 非恒等（真实链路不可达，守卫口径变化）');

    // 3.3 部分腿残差链 + 末腿全清：余仓最终精确归零（E5d 僵尸仓反例的直证）
    let cur = new Decimal(100);
    cur = cur.sub(new Decimal(cur).mul(resolveCardSellPct(1, 3)));   // 1/3 → 残差并入
    ok(cur.gt(0) && cur.lt(67), '1/3 部分腿后余仓 ≈66.67（部分腿不清仓）', cur.toString());
    cur = cur.sub(new Decimal(cur).mul(resolveCardSellPct(1, 2)));   // 1/2 → 残差并入
    cur = cur.sub(new Decimal(cur).mul(resolveCardSellPct(1, 1)));   // 末卡 mul(1) 精确全清
    ok(cur.eq(0), '末腿全清后余仓精确 eq(0)（PM 删仓，无僵尸仓）', cur.toString());

    // 3.4 整除链同样归零
    let c2 = new Decimal(300);
    c2 = c2.sub(new Decimal(c2).mul(resolveCardSellPct(1, 3)));
    c2 = c2.sub(new Decimal(c2).mul(resolveCardSellPct(1, 2)));
    c2 = c2.sub(new Decimal(c2).mul(resolveCardSellPct(1, 1)));
    ok(c2.eq(0), '整除链（300→200→100→0）余仓归零', c2.toString());
}

// ==================== main ====================

testNormalization();
testCooldown();
testCardArithmetic();

console.log(`\n${'='.repeat(50)}`);
console.log(`卡牌仓位机制测试: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('✅ 全部通过');
