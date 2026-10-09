// ============================================================================
// markAsBought 虚拟时钟口径零 DB 单测（case 0xcc4d7275d13a49872544625f218072abe2807777）
//
// 事故形状（实验 bddd3578 回测，2026-10-09 发现）：token-pool markAsBought 写死
// token.buyTime = Date.now()（墙钟），无视 BacktestEngine 传入的虚拟 buyTime →
// 卖信号 metadata.holdDuration = 虚拟 now − 墙钟 buyTime = -375387.785s（负 4.34 天）。
//
// 修复：token.buyTime = buyDecision.buyTime ?? Date.now()
//   - 回测：markAsBought({ buyTime: nowTs 虚拟 }) → holdDuration 同钟域（本测试 T1/T3）
//   - 实时：两调用点显式传 Date.now() / lastBuy.timeMs（墙钟）→ 行为零变化（T2）
//
// 另含 signals 页排序 tie-break 源码口径（T4）：同秒时间戳买在前，防止
// 「卖在买入前」显示误导（回测 created_at=block_time 秒精度，BSC 0.75s 出块
// 同秒先买后卖常见）。
//
// 运行：node scripts/_test_token_pool_buytime.cjs（零 DB 零网络）
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TokenPool = require(path.join(ROOT, 'src/core/token-pool.js'));

// 静默 logger（TokenPool 构造需要）
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}\n     ${e.message}`);
  }
}

function makePool() {
  return new TokenPool(silentLogger, null, null, {});
}

function seedToken(pool, token = '0xabc0000000000000000000000000000000007777') {
  pool.addToken({ token, chain: 'bsc', symbol: 'TEST' });
  return token;
}

console.log('━━━ T1 markAsBought 尊重传入 buyTime（回测虚拟时钟直通）━━━');
check('传入虚拟 buyTime → token.buyTime === 虚拟值（不再被 Date.now() 覆盖）', () => {
  const pool = makePool();
  const t = seedToken(pool);
  const virtualTs = Date.UTC(2026, 9, 4, 22, 18, 20, 0); // 回放时点，距墙钟数天
  pool.markAsBought(t, 'bsc', { buyPrice: 1.26e-8, buyTime: virtualTs });
  const token = pool.getToken(t, 'bsc');
  assert.strictEqual(token.buyTime, virtualTs, `buyTime 应为传入虚拟值 ${virtualTs}，实际 ${token.buyTime}`);
  assert.ok(Math.abs(token.buyTime - Date.now()) > 86400000, '虚拟值应与墙钟相差天级（防误判：值本身就该不同）');
});
check('虚拟 buyTime 下 holdDuration 同钟域为正小值（事故形状 -375387s 不再复现）', () => {
  const pool = makePool();
  const t = seedToken(pool);
  const buyTs = Date.UTC(2026, 9, 4, 22, 18, 20, 0);
  pool.markAsBought(t, 'bsc', { buyPrice: 1e-8, buyTime: buyTs });
  const token = pool.getToken(t, 'bsc');
  const sellNowTs = buyTs + 750; // 同秒后续块（BSC 0.75s 出块）
  const holdDuration = (sellNowTs - token.buyTime) / 1000;
  assert.strictEqual(holdDuration, 0.75, `holdDuration 应为 0.75s，实际 ${holdDuration}`);
});

console.log('━━━ T2 缺省/实时路径行为零变化 ━━━');
check('不传 buyTime → 回退墙钟（≈Date.now()）', () => {
  const pool = makePool();
  const t = seedToken(pool);
  const before = Date.now();
  pool.markAsBought(t, 'bsc', { buyPrice: 1e-8 });
  const after = Date.now();
  const token = pool.getToken(t, 'bsc');
  assert.ok(token.buyTime >= before && token.buyTime <= after,
    `缺省应回退墙钟，实际 ${token.buyTime} 不在 [${before}, ${after}] 内`);
});
check('显式传 Date.now()（实时引擎调用形状）→ 与旧实现等价', () => {
  const pool = makePool();
  const t = seedToken(pool);
  const before = Date.now();
  pool.markAsBought(t, 'bsc', { buyPrice: 1e-8, buyTime: Date.now() });
  const token = pool.getToken(t, 'bsc');
  assert.ok(token.buyTime >= before, '实时墙钟语义应保持');
});
check('markAsBought 其余副作用不受影响（status/buyPrice/highestPriceSinceLastBuy）', () => {
  const pool = makePool();
  const t = seedToken(pool);
  pool.markAsBought(t, 'bsc', { buyPrice: 2.5e-8, buyTime: 1234567890000 });
  const token = pool.getToken(t, 'bsc');
  assert.strictEqual(token.status, 'bought');
  assert.strictEqual(token.buyPrice, 2.5e-8);
  assert.strictEqual(token.highestPriceSinceLastBuy, 2.5e-8);
});

console.log('━━━ T3 调用点接线源码口径（三处 markAsBought 全量审计）━━━');
const poolSrc = fs.readFileSync(path.join(ROOT, 'src/core/token-pool.js'), 'utf8');
const btSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
const fmSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');

check('token-pool：buyTime = buyDecision.buyTime ?? Date.now()（写死 Date.now() 不复存在）', () => {
  assert.ok(poolSrc.includes('token.buyTime = buyDecision.buyTime ?? Date.now();'),
    'token-pool.js 应含 buyDecision.buyTime ?? Date.now() 回退写法');
  assert.ok(!/\n\s*token\.buyTime = Date\.now\(\);/.test(poolSrc),
    'token-pool.js 不应再存在写死 token.buyTime = Date.now() 的行');
});
check('BacktestEngine：markAsBought 传虚拟 nowTs（buyTime: nowTs）', () => {
  const m = btSrc.match(/markAsBought\([^;]+?buyTime:[^;]+?\);/s);
  assert.ok(m, 'BacktestEngine markAsBought 调用点应存在');
  assert.ok(/buyTime:\s*nowTs/.test(m[0]), `回测应传虚拟 nowTs，实际：${m[0].replace(/\s+/g, ' ')}`);
});
check('BacktestEngine：卖信号 holdDuration 消费 token.buyTime（修复生效链闭合）', () => {
  assert.ok(/holdDuration:\s*token\.buyTime\s*\?\s*\(\(nowTs\s*-\s*token\.buyTime\)\s*\/\s*1000\)/.test(btSrc),
    '卖信号 holdDuration 应由 token.buyTime 与虚拟 nowTs 同钟域求差');
});
check('FourMemeWssTradingEngine：实时买点显式传 Date.now()（墙钟语义自洽）', () => {
  const calls = fmSrc.match(/markAsBought\([\s\S]{0,220}?\}\);/g) || [];
  const buyCall = calls.find(c => /buyPrice:\s*execPriceUsd/.test(c));
  assert.ok(buyCall, '实时买点 markAsBought 调用应存在');
  assert.ok(/buyTime:\s*Date\.now\(\)/.test(buyCall), `实时买点应显式传墙钟，实际：${buyCall.replace(/\s+/g, ' ')}`);
});
check('FourMemeWssTradingEngine：恢复路径传 lastBuy.timeMs（真实时间戳直通）', () => {
  const calls = fmSrc.match(/markAsBought\([\s\S]{0,220}?\}\);/g) || [];
  const restoreCall = calls.find(c => /buyPrice:\s*buyPriceUsd/.test(c));
  assert.ok(restoreCall, '恢复路径 markAsBought 调用应存在');
  assert.ok(/buyTime\b/.test(restoreCall), '恢复路径应传 buyTime（shorthand，= lastBuy?.timeMs || Date.now()）');
});

console.log('━━━ T4 signals 页排序 tie-break 源码口径 ━━━');
const sigSrc = fs.readFileSync(path.join(ROOT, 'src/web/static/js/experiment_signals.js'), 'utf8');
check('comparator 含同秒 tie-break（时间相等时 buy 排前）', () => {
  const m = sigSrc.match(/sort\(\(a,\s*b\)\s*=>\s*\{[\s\S]{0,400}?return\s+\(a\.action[\s\S]{0,120}?\}\)/);
  assert.ok(m, 'renderSignals comparator 应含 action tie-break 分支');
  assert.ok(/if\s*\(timeDiff\s*!==\s*0\)\s*return timeDiff;/.test(m[0]), '时间差优先，仅 tie 时启用 action 分支');
  assert.ok(/a\.action\s*===\s*'buy'\s*\?\s*0\s*:\s*1/.test(m[0]), "tie 分支应为 buy=0 买在前");
});

console.log('━━━ T5 图表标注同刻错位源码口径（散点图/K线图共用 helper）━━━');
check('_buildSignalAnnotations 含同刻 yAdjust 逐条下移（同秒标签不再互相覆盖）', () => {
  assert.ok(/yAdjust:\s*idx\s*\*\s*18/.test(sigSrc), '标签应含 yAdjust: idx * 18 同刻错位');
  assert.ok(/stackCount\.get\(signalTime\)/.test(sigSrc), '应以 signalTime 维护同刻计数');
});
check('标注构造前排序：时间升序 + 同刻 buy 在前（与列表 tie-break 同口径）', () => {
  const m = sigSrc.match(/_buildSignalAnnotations[\s\S]{0,2000}?inWindow\.sort\(\(a,\s*b\)\s*=>[\s\S]{0,300}?\)\)/);
  assert.ok(m, '_buildSignalAnnotations 应含 inWindow.sort');
  assert.ok(/a\.signalTime\s*-\s*b\.signalTime/.test(m[0]), '主键应为时间升序');
  assert.ok(/a\.signal\.action\s*===\s*'buy'/.test(m[0]), '同刻 tie-break 应 buy 在前');
});

console.log(`\n${'━'.repeat(50)}\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
