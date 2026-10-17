#!/usr/bin/env node

/**
 * run-engine 优雅停机零 DB 单测（2026-10-11 tnone 37bd7349 停机事故衍生）
 *
 * 事故形状：run-engine.js 的 SIGINT/SIGTERM 处理器注册在 `await engine.start()`
 * 之后，而回测的 start() 要等整个回放跑完才返回——回放期间（数小时）进程没有
 * 任何信号处理器，SIGTERM 走 Node 默认硬杀：不写 stopped、BacktestWriteBuffer
 * 残留 pending 行随进程丢失（实验行状态卡 running 需人工修 DB）。
 *
 * 修复口径：
 *   A. run-engine.js 信号注册提前到 engine 构造后、initialize/start() 之前；
 *      handler 内 engine.stop() 包 try/catch（停机链异常留痕后仍退出）
 *   B. BacktestEngine.stop() 中途停机（finalStatusSet=false）先刷写缓冲再走
 *      基类写 stopped；flush 失败原样上抛 fail-loud
 *
 * 零 DB 零网络：BacktestEngine.prototype.stop 以打桩 this 直调（super 链解析到
 * AbstractTradingEngine.prototype.stop，原生类 HomeObject 机制不受打桩影响）；
 * run-engine.js / BacktestEngine.js 另做源码口径断言锁形状。
 */

const fs = require('fs');
const path = require('path');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');
const { EngineStatus } = require('../src/trading-engine/interfaces/ITradingEngine');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

async function assertRejects(promise, msg) {
  try {
    await promise;
    assert(false, msg + '（未抛错）');
  } catch (e) {
    assert(true, msg + `（${e.message}）`);
  }
}

// 打桩 this：同时满足 BacktestEngine.stop（this.logger 三参）与基类 stop
// （this._logger 两参）两条日志链；order 数组记录调用序
function makeFakeThis(overrides = {}) {
  const order = [];
  return Object.assign({
    order,
    _experimentId: 'exp-test',
    _finalStatusSet: false,
    _isStopped: false,
    _status: null,
    _roundSummary: null,
    _loopCount: 0,
    _writeBufferEnabled: true,
    _writeBuffer: {
      pendingCount: 0,
      flush: async () => { order.push('flush'); },
    },
    // C84（2026-10-17）：stop 尾段清 FA 叙事常量注入迭代本 Map（真引擎 ctor 恒建）
    _tokenMeta: new Map(),
    logger: { info: () => { order.push('log'); }, error: () => { order.push('log-error'); } },
    _logger: { info: () => { order.push('log'); }, error: () => { order.push('log-error'); } },
    _createPortfolioSnapshot: async () => { order.push('snapshot'); },
    _updateExperimentStatus: async (status) => { order.push('status:' + status); },
  }, overrides);
}

function stopWith(fakeThis) {
  return BacktestEngine.prototype.stop.call(fakeThis);
}

function readSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function main() {
console.log('\n===== A 段：中途停机——刷缓冲先于终态写入 =====');
{
  const t = makeFakeThis();
  t._writeBuffer.pendingCount = 3;
  await stopWith(t);
  assert(t.order.includes('flush'), 'pending>0 时 flush 被调用');
  assert(t.order.indexOf('flush') < t.order.indexOf('status:stopped'), 'flush 先于 stopped 终态写入');
  assert(t.order.includes('status:stopped'), '基类终态写入执行（status:stopped）');
  assert(t._isStopped === true, '_isStopped 置位');
  assert(t._status === EngineStatus.STOPPED, '_status = STOPPED');
}

console.log('\n===== B 段：回放已终态——仅置本地标志，不刷不写 =====');
{
  const t = makeFakeThis({ _finalStatusSet: true });
  t._writeBuffer.pendingCount = 7;
  await stopWith(t);
  assert(!t.order.includes('flush'), '终态后停机不再 flush');
  assert(!t.order.includes('status:stopped'), '终态后停机不覆盖实验状态');
  assert(t._isStopped === true && t._status === EngineStatus.STOPPED, '本地标志仍置位');
}

console.log('\n===== C 段：无 pending / 缓冲关闭——不触发 flush =====');
{
  const t = makeFakeThis();
  t._writeBuffer.pendingCount = 0;
  await stopWith(t);
  assert(!t.order.includes('flush'), 'pending=0 不 flush');
  assert(t.order.includes('status:stopped'), '仍走基类终态写入');
}
{
  const t = makeFakeThis();
  t._writeBufferEnabled = false;
  t._writeBuffer.pendingCount = 5;
  await stopWith(t);
  assert(!t.order.includes('flush'), 'writeBufferEnabled=false 不 flush（含 pending）');
  assert(t.order.includes('status:stopped'), '仍走基类终态写入');
}

console.log('\n===== D 段：flush 抛错——fail-loud 上抛 =====');
{
  const t = makeFakeThis();
  t._writeBuffer.pendingCount = 2;
  t._writeBuffer.flush = async () => { throw new Error('模拟 DB 中断'); };
  await assertRejects(stopWith(t), 'flush 异常原样上抛（不被吞）');
  assert(!t.order.includes('status:stopped'), '失败路径不落 stopped（留 running 提示停机不完整）');
}

console.log('\n===== E 段：源码口径 run-engine.js——注册位置先于 start =====');
{
  const src = readSrc('src/run-engine.js');
  const idxCtor = src.indexOf('new EngineClass');
  const idxSigint = src.indexOf("process.on('SIGINT'");
  const idxSigterm = src.indexOf("process.on('SIGTERM'");
  const idxStart = src.indexOf('await engine.start()');
  assert(idxCtor !== -1 && idxStart !== -1, '锚点存在（构造点/start 点）');
  assert(idxSigint !== -1 && idxSigint < idxStart, 'SIGINT 注册在 await engine.start() 之前');
  assert(idxSigterm !== -1 && idxSigterm < idxStart, 'SIGTERM 注册在 await engine.start() 之前');
  assert(idxCtor !== -1 && idxSigint > idxCtor && idxSigterm > idxCtor, '注册在引擎构造之后（engine 引用可用）');
  assert(/try\s*\{\s*await engine\.stop\(\);/.test(src), 'handler 内 engine.stop() 包 try');
  assert(/catch\s*\(error\)\s*\{[\s\S]*?引擎停止失败/.test(src), 'catch 分支留痕（引擎停止失败日志）');
  // 旧位置残留检查：start() 之后不应再有信号注册
  const after = src.slice(idxStart);
  assert(!after.includes("process.on('SIGINT'") && !after.includes("process.on('SIGTERM'"), 'start() 之后无残留注册点');
}

console.log('\n===== F 段：源码口径 BacktestEngine.js——stop 内 flush 先于 super =====');
{
  const src = readSrc('src/trading-engine/implementations/BacktestEngine.js');
  const idxStop = src.indexOf('async stop()');
  const region = src.slice(idxStop, idxStop + 1800);
  const idxFlush = region.indexOf('.flush(');
  const idxSuper = region.indexOf('await super.stop()');
  const idxFinal = region.indexOf('this._finalStatusSet)');
  assert(idxStop !== -1, 'stop() 方法存在');
  assert(idxFinal !== -1 && idxFinal < idxFlush, '终态短路分支在前（finalStatusSet 保护不回退）');
  assert(idxFlush !== -1 && idxSuper !== -1 && idxFlush < idxSuper, '缓冲 flush 在 super.stop() 之前');
}

console.log(`\n===== 结果：${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('测试执行异常:', e); process.exit(1); });
