#!/usr/bin/env node
/**
 * tickBuffer 水位监控单测（批次 3a，2026-10-15）
 *
 * 落库速度跟不上时 _tickBuffer 无界增长——水位检查挂 _pushTickRow 尾部（O(1)）：
 * 超阈 error 告警（节流重告）+ stats 峰值/计数 + 引擎可选回调；回落一次性恢复 info。
 * ★绝不丢行：全程零 splice/shift/drop（本测试核心反证）。
 *
 * 零 DB 零网络：只 new collector 不 start（构造零副作用——WSS/timer/supabase 全 lazy），
 * 直调 _pushTickRow 喂行；flush 阈值调到不可达避免 _flushTickBuffer 干扰 buffer 长度断言。
 * 用法：node scripts/_test_tick_buffer_watermark.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
const { FlapAnkrWsCollector } = require('../src/collectors/flap-ankr-ws-collector.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 打桩 logger：收 error/info 调用供断言 */
function makeStubLogger() {
  const errors = [], infos = [];
  return {
    errors, infos,
    error: (expId, tag, msg) => errors.push({ expId, tag, msg }),
    info: (expId, tag, msg) => infos.push({ expId, tag, msg }),
    warn: () => {}, debug: () => {},
  };
}

function makeTick(i) {
  return {
    token_address: '0xtok', trade_type: 'buy', trader_address: '0xt',
    price_bnb: 5e-9, price_usd: 3e-6, bnb_amount: 0.01,
    block_number: 40000000 + i, timestamp: 1700000000000 + i,
    tx_hash: `0xtx${i}`, log_index: 0, platform: 'fourmeme',
  };
}

/** 构造测试用 collector：阈值 5 行 / 重告窗 150ms / flush 阈值不可达（隔离 flush 机制） */
function makeCollector(Ctor, section, label) {
  const logger = makeStubLogger();
  const collector = new Ctor({
    [section]: {
      tickBuffer: { alertThresholdRows: 5, alertReAlertMs: 150, flushThreshold: 1_000_000 },
      contracts: {}, // 空 contracts：仅初始化字段，不订阅
    },
  }, logger);
  collector._label = label;
  return { collector, logger };
}

/** 核心场景套件（fourmeme/flap 参数化同跑） */
async function runWatermarkSuite(Ctor, section, label) {
  console.log(`\n== ${label} 核心场景 ==`);
  const { collector, logger } = makeCollector(Ctor, section, label);
  const cbCalls = [];
  collector._onTickBufferHighWatermark = (len) => cbCalls.push(len);

  // A. 初始低水位零日志（未告警态回落分支不触发）
  collector._pushTickRow(makeTick(0));
  check('A1 初始低水位零 error', logger.errors.length, 0);
  check('A2 初始低水位零 info（未告警态无恢复可发）', logger.infos.length, 0);

  // B. 超阈恰一告（len==5 恰达阈值边界，>= 语义）
  for (let i = 1; i <= 4; i++) collector._pushTickRow(makeTick(i)); // len=5
  check('B1 恰达阈值触发告警（len==threshold）', logger.errors.length, 1);
  check('B2 告警计数=1', collector.stats.tickBufferHighWatermarkAlerts, 1);
  check('B3 峰值=5', collector.stats.tickBufferHighWatermarkPeak, 5);
  check('B4 进入高水位态', collector._tickBufferHighWatermark, true);
  check('B5 告警文案含长度/阈值/绝不丢行',
    /\[TickBuffer高水位\] buffer=5 阈值=5 累计写失败=0——落库速度跟不上，绝不丢行/.test(logger.errors[0].msg), true);
  check('B6 引擎回调收到 len=5', cbCalls, [5]);

  // C. 节流窗内不重告（同步 push 20 行 << 150ms 窗）
  for (let i = 5; i < 25; i++) collector._pushTickRow(makeTick(i)); // len=25
  check('C1 节流窗内零重告', logger.errors.length, 1);
  check('C2 回调零重复', cbCalls, [5]);
  check('C3 未告警的更高水位不进峰值（峰值只在告警时刻取）', collector.stats.tickBufferHighWatermarkPeak, 5);

  // D. 跨窗再告（sleep 160ms > 150ms 重告窗）
  await sleep(160);
  collector._pushTickRow(makeTick(25)); // len=26
  check('D1 跨窗重告恰一条', logger.errors.length, 2);
  check('D2 告警计数=2', collector.stats.tickBufferHighWatermarkAlerts, 2);
  check('D3 峰值更新=26', collector.stats.tickBufferHighWatermarkPeak, 26);
  check('D4 回调第二次收到 26', cbCalls, [5, 26]);

  // E. ★不丢行反证：全程零 splice/shift/drop——buffer.length === push 总数（flush 未触发）
  const totalPushed = 26;
  check('E1 不丢行反证 buffer.length===push 总数', collector._tickBuffer.length, totalPushed);
  check('E2 ticksBuffered 计数一致', collector.stats.ticksBuffered, totalPushed);

  // F. 回落恢复恰一次（模拟 flush 成功排空后再来一行）
  collector._tickBuffer.length = 0; // flush 成功排空（水位检查只读长度）
  collector._pushTickRow(makeTick(26)); // len=1 < 5
  check('F1 回落恢复 info 恰一条', logger.infos.length, 1);
  check('F2 恢复文案含阈值', /已回落至阈值 5 以下/.test(logger.infos[0].msg), true);
  check('F3 退出高水位态', collector._tickBufferHighWatermark, false);
  collector._pushTickRow(makeTick(27));
  check('F4 恢复后低水位不再刷 info', logger.infos.length, 1);

  // G. 再超再告（恢复后重新越过阈值，_tickLastAlertAt 已是历史值但窗口未满——先跨窗）
  await sleep(160);
  for (let i = 28; i <= 32; i++) collector._pushTickRow(makeTick(i)); // len=6 >= 5
  check('G1 恢复后再超再告', logger.errors.length, 3);
  check('G2 告警计数=3', collector.stats.tickBufferHighWatermarkAlerts, 3);

  return { collector, logger };
}

/** 回调健壮性：回调 throw 不影响采集与后续告警 */
async function runCallbackThrowCase(Ctor, section, label) {
  console.log(`\n== ${label} 回调 throw 健壮性 ==`);
  const { collector, logger } = makeCollector(Ctor, section, label);
  let threw = 0;
  collector._onTickBufferHighWatermark = () => { threw++; throw new Error('telegram 炸了'); };
  for (let i = 0; i < 6; i++) collector._pushTickRow(makeTick(i));
  check('H1 回调被调用恰一次', threw, 1);
  check('H2 回调异常被吞——告警照常', logger.errors.length, 1);
  check('H3 回调异常不影响行入缓冲', collector._tickBuffer.length, 6);
  // 不挂回调（缺省 undefined）= 零变化：告警照常不 throw
  const { collector: c2, logger: l2 } = makeCollector(Ctor, section, label);
  for (let i = 0; i < 5; i++) c2._pushTickRow(makeTick(i));
  check('H4 缺省无回调零异常', l2.errors.length, 1);
}

(async () => {
  await runWatermarkSuite(FourMemeAnkrWsCollector, 'fourmemeWs', 'fourmeme');
  await runCallbackThrowCase(FourMemeAnkrWsCollector, 'fourmemeWs', 'fourmeme');
  await runWatermarkSuite(FlapAnkrWsCollector, 'flapWs', 'flap');
  await runCallbackThrowCase(FlapAnkrWsCollector, 'flapWs', 'flap');

  console.log('\n== 默认参数（未配置 tickBuffer 水位键）==');
  {
    const logger = makeStubLogger();
    const collector = new FourMemeAnkrWsCollector({ fourmemeWs: { contracts: {} } }, logger);
    check('I1 默认阈值 100_000', collector._tickAlertThresholdRows, 100000);
    check('I2 默认重告窗 600_000ms', collector._tickAlertReAlertMs, 600000);
    const fl = new FlapAnkrWsCollector({ flapWs: {} }, makeStubLogger());
    check('I3 flap 默认同款', [fl._tickAlertThresholdRows, fl._tickAlertReAlertMs], [100000, 600000]);
  }

  console.log('\n== 源码口径（防回流）==');
  {
    const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    for (const [file, label] of [
      ['src/collectors/fourmeme-ankr-ws-collector.js', 'fourmeme'],
      ['src/collectors/flap-ankr-ws-collector.js', 'flap'],
    ]) {
      const src = read(file);
      // 提取 _checkTickBufferWatermark 方法体：断言全程零丢行原语
      const m = src.match(/_checkTickBufferWatermark\(\) \{[\s\S]*?\n    \}/);
      check(`J1 ${label} 方法存在`, m !== null, true);
      if (m) {
        check(`J2 ${label} 方法体零 splice/shift/pop/drop（绝不丢行）`,
          /splice|\.shift\(|\.pop\(|delete |_tickBuffer = \[\]/.test(m[0]), false);
      }
      check(`J3 ${label} 挂点在 _pushTickRow 尾部（push 之后水位检查）`,
        /this\._tickBuffer\.push\(tickRow\);[\s\S]*?this\._checkTickBufferWatermark\(\);/.test(src), true);
      check(`J4 ${label} stats 双键（峰值/告警计数）`,
        src.includes('tickBufferHighWatermarkPeak') && src.includes('tickBufferHighWatermarkAlerts'), true);
      check(`J5 ${label} 引擎可选回调 try/catch 包裹（回调失败不影响采集）`,
        /try \{ this\._onTickBufferHighWatermark\(len\); \} catch/.test(src), true);
    }
    // 引擎转发：live Telegram 判空零变化 + fire-and-forget
    const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    check('K1 引擎挂 collector._onTickBufferHighWatermark 转发',
      /collector\._onTickBufferHighWatermark = \(len\) =>/.test(eng), true);
    check('K2 转发判 _telegramNotifier（virtual/backtest 恒 null=零变化）',
      /_onTickBufferHighWatermark = \(len\) => \{[\s\S]*?if \(!this\._telegramNotifier\) return;/.test(eng), true);
    // config 显式声明两键（可发现性）
    const cfg = JSON.parse(read('config/default.json'));
    for (const sec of ['fourmemeWs', 'flapWs']) {
      check(`L1 ${sec}.tickBuffer.alertThresholdRows=100000`,
        cfg[sec].tickBuffer.alertThresholdRows, 100000);
      check(`L2 ${sec}.tickBuffer.alertReAlertMs=600000`,
        cfg[sec].tickBuffer.alertReAlertMs, 600000);
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();
