#!/usr/bin/env node
/**
 * WSS tick 快速回执（2026-10-15 live 提速①）零 DB 零网络单测
 *
 * 背景（뮤오23 案 0x176c…7777，v17 live 实验 203570e3）：tx 上链后 0.32s 自家
 * collector 已见成交 tick（10:49:42.317），provider.waitForTransaction 却因 ethers v6
 * 4s 轮询 + ANKR receipt 索引滞后等到 10:49:50.206——8.2s 纯工程延迟。
 *
 * 覆盖：
 *   1. TxSeenSignal 单元：waitFor→notify 唤醒 / 超时 false+自清理无泄漏 / 同 hash
 *      多 waiter 全唤醒 / 迟到 notify 无害 / 大小写归一 / 无 waiter no-op
 *   2. race 快路径（事故现场反证）：waitForTransaction 桩挂起模拟 RPC 慢 + WSS seen
 *      + getTransactionReceipt → 远早于 RPC 路径拿到真 receipt
 *   3. 轮询循环：seen 后首查 miss → 间隔后命中
 *   4. 无 txSeenSignal → 纯原路径（getTransactionReceipt 不被调用）
 *   5. seen 但 receipt 恒 null（轮询窗耗尽，缩时桩）→ 永续 pending 让位 waitForTransaction
 *   6. WSS 路径 receipt.status=0 → 同样 throw reverted（校验不因快路径豁免）
 *   7. waitForTransaction 超时 → 回查/reset/throw 原语义不变（注入 signal 后仍成立）
 *   8. 源码口径：两 collector _emitTick 首行钩子 + 引擎构造门/注册/注入 + BacktestEngine
 *      零引用 + Flap/FourMeme 两 trader 同构存在
 *
 * 运行：node scripts/_test_tx_seen_receipt.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✅ ${label}`);
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  const { TxSeenSignal } = require(path.join(ROOT, 'src/trading-engine/core/TxSeenSignal'));

  // ============ 1. TxSeenSignal 单元 ============
  console.log('\n[1] TxSeenSignal 单元');
  {
    // 1a. waitFor → notify 唤醒（seen=true）
    const sig = new TxSeenSignal();
    const p = sig.waitFor('0xabc', 1000);
    setTimeout(() => sig.notify('0xabc'), 20);
    ok((await p) === true, 'waitFor→notify 唤醒 seen=true');
    ok(sig._waiters.size === 0, '唤醒后 waiters 条目清空');
    ok(sig.wakeCount === 1, 'wakeCount 计 1');

    // 1b. 超时 false + 自清理无泄漏
    const sig2 = new TxSeenSignal();
    const t0 = Date.now();
    ok((await sig2.waitFor('0xdef', 80)) === false, '超时 resolve false');
    ok(Date.now() - t0 >= 75, '超时按约定时长触发');
    ok(sig2._waiters.size === 0, '超时后 waiters Map 空（无死条目泄漏）');
    sig2.notify('0xdef'); // 迟到 notify：条目已清，no-op 不抛
    ok(sig2.wakeCount === 0, '迟到 notify 无 waiter 不唤醒');

    // 1c. 同 hash 多 waiter 全唤醒
    const sig3 = new TxSeenSignal();
    const ps = [sig3.waitFor('0x111', 1000), sig3.waitFor('0x111', 1000), sig3.waitFor('0x222', 1000)];
    sig3.notify('0x111');
    const rs = await Promise.all(ps.slice(0, 2));
    ok(rs[0] === true && rs[1] === true, '同 hash 两个 waiter 全部唤醒');
    ok(sig3.wakeCount === 2, 'wakeCount 计 2（0x222 未被误唤醒）');
    ok(sig3.pendingCount === 1, '未命中 hash 的 waiter 仍挂起');

    // 1d. 大小写归一：notify 大写唤醒小写 waiter（tx.hash 与 log txHash 来自两个 ethers 对象）
    const sig4 = new TxSeenSignal();
    const p4 = sig4.waitFor('0xabc123', 500);
    sig4.notify('0XABC123');
    ok((await p4) === true, '大小写归一：notify 大写唤醒小写 waiter');

    // 1e. notify 无 waiter / 空 hash：no-op
    const sig5 = new TxSeenSignal();
    sig5.notify('0xnobody');
    sig5.notify(null);
    sig5.notify(undefined);
    ok(sig5.notifyCount === 1 && sig5.wakeCount === 0, '无 waiter notify 计数不唤醒；空 hash 直接 return 不计数');
  }

  // ============ 2. race 快路径（事故现场反证） ============
  console.log('\n[2] race 快路径——뮤오23 事故现场反证');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 3000;
    const sig = new TxSeenSignal();
    trader.txSeenSignal = sig;

    const receiptStub = { status: 1, hash: '0xfast', blockNumber: 456, gasUsed: 21000n, logs: [] };
    // waitForTransaction 桩 3s 才 resolve（模拟 ethers 4s 轮询+ANKR 索引慢 = 事故形状）；
    // WSS 在 30ms 后见 tick；getTransactionReceipt 立即可取
    trader.provider = {
      waitForTransaction: () => new Promise((res) => setTimeout(() => res(receiptStub), 3000)),
      getTransactionReceipt: async (h) => (h === '0xfast' ? receiptStub : null),
    };
    const t0 = Date.now();
    setTimeout(() => sig.notify('0xfast'), 30);
    const got = await trader._awaitReceipt({ hash: '0xfast' }, '买入');
    const cost = Date.now() - t0;
    ok(got === receiptStub, 'race 由 WSS 快路径胜出，返回真 receipt 桩');
    ok(cost < 1000, `seen 后毫秒级返回（实测 ${cost}ms < 1000ms）——不再等 RPC 轮询 3s（事故现场 8.2s）`);
  }

  // ============ 3. 轮询循环：seen 后首查 miss → 间隔后命中 ============
  console.log('\n[3] seen 后 getTransactionReceipt 轮询循环');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 2000;
    trader.seenReceiptPollMs = 60;        // 缩时（生产 400ms）
    trader.seenReceiptPollMaxMs = 3000;   // 缩时（生产 10s）
    const sig = new TxSeenSignal();
    trader.txSeenSignal = sig;

    const receiptStub = { status: 1, hash: '0xmiss', blockNumber: 789, gasUsed: 21000n, logs: [] };
    let rpcCalls = 0;
    trader.provider = {
      waitForTransaction: () => new Promise(() => {}),  // 挂起（不干扰；wss 路径主导）
      getTransactionReceipt: async () => {
        rpcCalls++;
        return rpcCalls >= 3 ? receiptStub : null;      // 前两查 miss，第三查命中
      },
    };
    const t0 = Date.now();
    setTimeout(() => sig.notify('0xmiss'), 10);
    const got = await trader._awaitReceipt({ hash: '0xmiss' }, '买入');
    ok(got === receiptStub && rpcCalls === 3, `轮询两轮 miss 后第三轮命中（rpcCalls=${rpcCalls}）`);
    ok(Date.now() - t0 < 1500, '轮询间隔缩时下快速返回');
  }

  // ============ 4. 无 txSeenSignal → 纯原路径 ============
  console.log('\n[4] 无 txSeenSignal（virtual/开关关）→ 纯原路径');
  for (const name of ['FourMemeDirectTrader', 'FlapPortalTrader']) {
    const Ctor = require(path.join(ROOT, `src/trading-engine/traders/implementations/${name}`));
    const trader = new Ctor({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 1000;
    const receiptStub = { status: 1, hash: '0xplain', blockNumber: 1, gasUsed: 21000n, logs: [] };
    let receiptRpcCalls = 0;
    trader.provider = {
      waitForTransaction: async () => receiptStub,
      getTransactionReceipt: async () => { receiptRpcCalls++; return null; },
    };
    ok((await trader._awaitReceipt({ hash: '0xplain' }, '买入')) === receiptStub
      && receiptRpcCalls === 0, `${name}：未注入 signal → waitForTransaction 原路径，getTransactionReceipt 零调用`);
  }

  // ============ 5. seen 但 receipt 恒 null → 永续 pending 让位 ============
  console.log('\n[5] seen 但 RPC 索引滞后超窗 → 让位 waitForTransaction');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 1500;
    trader.seenReceiptPollMs = 40;
    trader.seenReceiptPollMaxMs = 200;    // 轮询窗 200ms 耗尽 → wss 路径永续 pending
    const sig = new TxSeenSignal();
    trader.txSeenSignal = sig;

    const receiptStub = { status: 1, hash: '0xslowrpc', blockNumber: 2, gasUsed: 21000n, logs: [] };
    trader.provider = {
      // RPC 慢路径 500ms 后给出 receipt（轮询窗 200ms 内 getTransactionReceipt 恒 null）
      waitForTransaction: () => new Promise((res) => setTimeout(() => res(receiptStub), 500)),
      getTransactionReceipt: async () => null,
    };
    setTimeout(() => sig.notify('0xslowrpc'), 10);
    const got = await trader._awaitReceipt({ hash: '0xslowrpc' }, '买入');
    ok(got === receiptStub, 'wss 路径让位后 waitForTransaction 结果胜出（绝不冒充/绝不 reject）');
  }

  // ============ 6. WSS 路径 status=0 → 同样 throw ============
  console.log('\n[6] WSS 快路径 receipt.status=0 → throw reverted');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 1000;
    const sig = new TxSeenSignal();
    trader.txSeenSignal = sig;
    trader.provider = {
      waitForTransaction: () => new Promise(() => {}),
      getTransactionReceipt: async () => ({ status: 0, hash: '0xrev', blockNumber: 3, gasUsed: 21000n, logs: [] }),
    };
    setTimeout(() => sig.notify('0xrev'), 10);
    await assert.rejects(() => trader._awaitReceipt({ hash: '0xrev' }, '买入'), /reverted/);
    ok(true, '快路径拿到 status=0 真 receipt → status 校验不豁免，throw reverted');
  }

  // ============ 7. waitForTransaction 超时 → 原语义（注入 signal 后仍成立） ============
  console.log('\n[7] 超时原语义：回查/reset/throw 不变');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 120;        // signal.waitFor 同超时：未见 → wss 路径 pending 让位
    const sig = new TxSeenSignal();
    trader.txSeenSignal = sig;
    let resetCalls = 0;
    trader.signer = { reset: () => { resetCalls++; } };
    trader.provider = {
      waitForTransaction: async () => { throw new Error('timeout'); },
      getTransactionReceipt: async () => null,
    };
    await assert.rejects(
      () => trader._awaitReceipt({ hash: '0xtx' }, '买入'),
      /确认超时\(0\.12s\)，txHash=0xtx/,
    );
    ok(resetCalls === 1, '超时未上链 → reset 恰 1 次 + throw 带 txHash（不重发防双买原语义）');
  }

  // ============ 8. 源码口径 ============
  console.log('\n[8] 源码口径（接线形状锁定）');
  {
    const four = readSrc('src/collectors/fourmeme-ankr-ws-collector.js');
    const flap = readSrc('src/collectors/flap-ankr-ws-collector.js');

    for (const [name, src] of [['fourmeme', four], ['flap', flap]]) {
      const start = src.indexOf('_emitTick(decoded) {');
      ok(start >= 0, `${name} collector：找到 _emitTick(decoded) 定义`);
      const body = src.slice(start, start + 2500);
      ok(body.slice(0, 400).includes('_onTickEmitted'), `${name} collector：_emitTick 首段含 _onTickEmitted 钩子`);
      // 钩子必须先于 senderResolver 分流（合约行 0.3-1s RPC 回查会污染快路径）
      const hookIdx = body.indexOf('_onTickEmitted');
      const resolverIdx = body.indexOf('senderResolver') >= 0 ? body.indexOf('senderResolver') : Infinity;
      ok(hookIdx >= 0 && hookIdx < resolverIdx, `${name} collector：钩子先于 senderResolver 分流`);
    }

    const engine = readSrc('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    ok(engine.includes("require('../core/TxSeenSignal.js')"), '引擎：顶部 require TxSeenSignal');
    ok(engine.includes('this._isLive && this._liveTxReceiptViaWss'), '引擎：构造门=live 且开关开（默认开）');
    ok(engine.includes('liveConfig.txReceiptViaWss !== false'), '引擎：开关语义 =!== false（显式 false 关）');
    ok(engine.includes('collector._onTickEmitted = (txHash)'), '引擎：collector 钩子注册');
    ok(engine.includes('trader.txSeenSignal = this._txSeenSignal'), '引擎：trader 属性注入（txWaitTimeoutMs 先例）');
    ok(!engine.includes('collector.setExperimentId('), '防线不受扰：引擎零 setExperimentId 调用');

    const backtest = readSrc('src/trading-engine/implementations/BacktestEngine.js');
    ok(!backtest.includes('TxSeenSignal') && !backtest.includes('txSeenSignal'), 'BacktestEngine：零 TxSeenSignal 引用（回测不涉及）');

    for (const name of ['FourMemeDirectTrader', 'FlapPortalTrader']) {
      const src = readSrc(`src/trading-engine/traders/implementations/${name}.js`);
      ok(src.includes('_receiptViaWssSeen'), `${name}：_receiptViaWssSeen 存在`);
      ok(src.includes('Promise.race([wssPath'), `${name}：_awaitReceipt race 形状`);
      ok(src.includes('if (receipt.status !== 1)'), `${name}：status 校验保留`);
    }
  }

  console.log(`\n全部通过：${passed} 项断言`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
