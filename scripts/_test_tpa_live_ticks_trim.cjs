#!/usr/bin/env node
/**
 * TPA live ticks 缓冲窗口裁剪单测（批次 3b，2026-10-15）
 *
 * 长跑实验 _walletTicksPreloaded 无界增长——liveTicksRetainHours 显式配置（默认 null 关）
 * 时引擎 5min prune 周期调 trimLiveTicksBuffer：删旧行 + ★同步推进 _liveTicksBufferStartMs
 * 至裁剪线（不推进=缺口计数漏报=掩盖问题）。miss 请求走既有缺口计数分支 fail-loud。
 *
 * 零 DB 零网络：_fetchWalletTicksBatch 内存索引命中路径不碰 supabase（传 null，意外
 * DB 触碰会直接炸测试）。
 * 用法：node scripts/_test_tpa_live_ticks_trim.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { TokenPositionAnalyzer } = require('../src/services/TokenPositionAnalyzer');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const QUIET = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const TRIGGER = { blocks: 1, tradeCount: 10, buyBnb: 6, minHolders: 4 };
const H = 3600000;

const NOW = 1_760_000_000_000; // 固定「现在」（裁剪时刻，非回测路径可注入）
/** 构造带 retain 配置的 live 缓冲实例 */
function mkTpa(retainHours = 24) {
  const tpa = new TokenPositionAnalyzer(
    { trigger: TRIGGER, ...(retainHours != null ? { liveTicksRetainHours: retainHours } : {}) },
    { logger: QUIET },
  );
  tpa.initLiveTicksBuffer();
  return tpa;
}
function mkTick(wallet, msAgo, i = 0) {
  return {
    sender_address: wallet, trader_address: null,
    token_address: '0xtok', trade_type: 'buy',
    bnb_amount: 0.01 + i * 0.001, block_number: 40000000 + i,
    block_time: new Date(NOW - msAgo).toISOString(),
    platform: 'fourmeme',
  };
}

console.log('A. 核心裁剪：删旧行/清空钱包/起点推进（24h 窗）');
{
  const tpa = mkTpa(24);
  const cutoff = NOW - 24 * H;
  // w1 混合：1 裁 2 留；w2 全裁；w3 全留（零裁剪路径）
  const w1 = [mkTick('0xw1', 25 * H), mkTick('0xw1', 23 * H, 1), mkTick('0xw1', 1 * H, 2)];
  const w2 = [mkTick('0xw2', 25.5 * H), mkTick('0xw2', 25 * H, 1)];
  const w3 = [mkTick('0xw3', 30 * 60 * 1000)];
  for (const t of [...w1, ...w2, ...w3]) tpa.ingestLiveTick(t);
  // ingest 后抓 Map 内真实数组引用（ingest 新建数组≠本地构造变量）
  const w3ArrRef = tpa._walletTicksPreloaded.get('0xw3');
  // init 置真实墙钟起点；回拨到 48h 前模拟「已运行 48h」（preload 向前扩效果）——
  // 不回拨则裁剪线 (NOW-24h) 恒早于起点，走 D3 的零裁剪早返分支
  const oldStart = NOW - 48 * H;
  tpa._liveTicksBufferStartMs = oldStart;

  const r = tpa.trimLiveTicksBuffer(NOW);
  check('A1 删 3 行', r, { rows: 3, wallets: 1 });
  check('A2 ★起点推进至裁剪线（事故反证：停在旧值=cutoff 之外必被本断言抓）',
    tpa._liveTicksBufferStartMs, cutoff);
  check('A3 旧起点确实更早（防 A2 平凡通过）', oldStart < cutoff, true);
  check('A4 w1 剩 2 行', tpa._walletTicksPreloaded.get('0xw1').length, 2);
  check('A5 w2 全裁→条目删除（与「仅非空 set」读取口径一致）', tpa._walletTicksPreloaded.has('0xw2'), false);
  check('A6 w3 零裁剪→数组引用不变（ingest 进行中的 push 目标不被换）',
    tpa._walletTicksPreloaded.get('0xw3') === w3ArrRef, true);
  check('A7 累计计数', tpa._liveTicksTrimmedRows, 3);
}

console.log('B. 裁后读取同窗 bit 一致（与未裁对照实例 deep-equal）');
{
  const build = (tpa) => {
    // 窗口 [NOW-23h, NOW]：两侧数据全在保留区
    for (const t of [mkTick('0xw1', 25 * H), mkTick('0xw1', 23 * H, 1), mkTick('0xw1', 1 * H, 2), mkTick('0xw3', 30 * 60 * 1000)]) {
      tpa.ingestLiveTick(t);
    }
  };
  const ref = mkTpa(24); build(ref);          // 对照：不裁
  const trimmed = mkTpa(24); build(trimmed);
  // 两实例同回拨 48h（见 A 注）：ref 保持未裁覆盖，trimmed 裁后覆盖=[NOW-24h, NOW]
  ref._liveTicksBufferStartMs = NOW - 48 * H;
  trimmed._liveTicksBufferStartMs = NOW - 48 * H;
  trimmed.trimLiveTicksBuffer(NOW);           // 裁掉 25h 行 + 起点推进 NOW-24h
  (async () => {
    const sinceIso = new Date(NOW - 23.5 * H).toISOString(), asOfIso = new Date(NOW).toISOString();
    const a = await ref._fetchWalletTicksBatch(null, ['0xw1', '0xw3'], sinceIso, asOfIso);
    const b = await trimmed._fetchWalletTicksBatch(null, ['0xw1', '0xw3'], sinceIso, asOfIso);
    check('B1 保留区窗口读取 bit 一致', JSON.stringify([...b.entries()].map(([k, v]) => [k, v.length])),
      JSON.stringify([...a.entries()].map(([k, v]) => [k, v.length])));
    check('B2 w1 窗内恰 2 行（23h+1h；25h 行本就在窗外，裁剪不改变读取结果）', b.get('0xw1').length, 2);

    console.log('C. 裁剪缺口如实暴露（★事故反证：起点不推进=本组全 0 掩盖缺口）');
    check('C1 trimmed 缺口计数初始 0', trimmed._fetchTicksPreBufferN || 0, 0);
    // 同一 since=NOW-30h：ref（未裁，覆盖自 48h 前）无缺口；trimmed（起点已推进 24h 前）有缺口
    await ref._fetchWalletTicksBatch(null, ['0xw1'], new Date(NOW - 30 * H).toISOString(), asOfIso);
    check('C2 ref 未裁→30h 请求零缺口（覆盖内）', ref._fetchTicksPreBufferN || 0, 0);
    await trimmed._fetchWalletTicksBatch(null, ['0xw1'], new Date(NOW - 30 * H).toISOString(), asOfIso);
    check('C3 trimmed 已裁→同请求缺口计数 1（不静默不回退 DB）', trimmed._fetchTicksPreBufferN, 1);
    runRest();
  })().catch(e => { console.error(e); process.exit(1); });
}

function runRest() {
  console.log('D. 边界与守卫');
  {
    // D1 block_time == cutoff 恰保留（>= 语义）
    const tpa = mkTpa(24);
    const edge = mkTick('0xw1', 24 * H); // msAgo 恰 24h → block_time == cutoff
    tpa.ingestLiveTick(edge);
    // 起点需要早于 cutoff 才进裁剪分支：手动回拨起点模拟运行 24h+（preload 向前扩效果）
    tpa._liveTicksBufferStartMs = NOW - 30 * H;
    const r = tpa.trimLiveTicksBuffer(NOW);
    check('D1 block_time==cutoff 恰保留（>=）', [r.rows, tpa._walletTicksPreloaded.get('0xw1').length], [0, 1]);

    // D2 乱序晚到旧行：filter 全量清理（非只删头部）
    const t2 = mkTpa(24);
    for (const t of [mkTick('0xw4', 1 * H), mkTick('0xw4', 26 * H, 1), mkTick('0xw4', 30 * 60 * 1000, 2)]) t2.ingestLiveTick(t);
    t2._liveTicksBufferStartMs = NOW - 48 * H;
    const r2 = t2.trimLiveTicksBuffer(NOW);
    const w4 = t2._walletTicksPreloaded.get('0xw4');
    check('D2 乱序晚到旧行被清（相对序保持）', [r2.rows, w4.length, w4[0].bnb_amount, w4[1].bnb_amount],
      [1, 2, 0.01, 0.012]);

    // D3 裁剪线未过起点 → {0,0} 且起点不推进
    const t3 = mkTpa(24); // 起点=Date.now()（运行刚开始）
    const startBefore = t3._liveTicksBufferStartMs;
    const r3 = t3.trimLiveTicksBuffer(Date.now());
    check('D3 运行未满窗零裁剪零推进', [r3.rows, r3.wallets, t3._liveTicksBufferStartMs === startBefore], [0, 0, true]);

    // D4 未配置（null 默认）→ 零裁剪零日志，Map 不动
    const t4 = mkTpa(null);
    const snapshot = [['0xw1', 3]];
    for (let i = 0; i < 3; i++) t4.ingestLiveTick(mkTick('0xw1', 48 * H, i));
    const r4 = t4.trimLiveTicksBuffer(NOW);
    check('D4 null 默认关→返回 null', r4, null);
    check('D5 null Map 不动', t4._walletTicksPreloaded.get('0xw1').length, 3);

    // D6 回测路径反证：setHistoricalTicks 注入（startMs null）→ 绝不能裁
    const t5 = mkTpa(24);
    t5.initLiveTicksBuffer(); // 先 live 化再转回测形状
    t5._walletTicksPreloaded = null; t5._liveTicksBufferStartMs = null; // 复位
    const hist = [mkTick('0xw1', 48 * H), mkTick('0xw1', 72 * H, 1)];
    t5.setHistoricalTicks(hist);
    const r6 = t5.trimLiveTicksBuffer(NOW);
    check('D6 回测注入缓冲 trim 返回 null（startMs===null 早返）', r6, null);
    check('D7 回测注入行原封不动', t5._walletTicksPreloaded.get('0xw1').length, 2);
    // D8 web 路径（从未 init）同样 null
    const t6 = new TokenPositionAnalyzer({ trigger: TRIGGER, liveTicksRetainHours: 24 }, { logger: QUIET });
    check('D8 未 init 的实例 trim no-op', t6.trimLiveTicksBuffer(NOW), null);
  }

  console.log('E. 构造校验 fail-fast');
  {
    let threw = 0;
    for (const bad of [0, -1, 'abc']) {
      try { new TokenPositionAnalyzer({ trigger: TRIGGER, liveTicksRetainHours: bad }, { logger: QUIET }); }
      catch { threw++; }
    }
    check('E1 非法值（0/-1/abc）构造 throw 恰 3 次', threw, 3);
    const ok24 = new TokenPositionAnalyzer({ trigger: TRIGGER, liveTicksRetainHours: 24 }, { logger: QUIET });
    check('E2 合法 24 构造成功', ok24._liveTicksRetainHours, 24);
    const okDef = new TokenPositionAnalyzer({ trigger: TRIGGER }, { logger: QUIET });
    check('E3 缺省 null（默认关）', okDef._liveTicksRetainHours, null);
  }

  console.log('F. 源码口径（防回流）');
  {
    const tpaSrc = fs.readFileSync(path.join(__dirname, '../src/services/TokenPositionAnalyzer.js'), 'utf8');
    const m = tpaSrc.match(/trimLiveTicksBuffer\(nowMs = Date\.now\(\)\) \{[\s\S]*?\n  \}/);
    check('F1 方法存在', m !== null, true);
    if (m) {
      check('F2 ★起点推进在方法体内（Math.max 单调+推进——事故反证：缺本行=缺口漏报）',
        /this\._liveTicksBufferStartMs = Math\.max\(this\._liveTicksBufferStartMs, cutoffMs\);/.test(m[0]), true);
      check('F3 回测/网页早返守卫（startMs null）',
        /this\._walletTicksPreloaded == null \|\| this\._liveTicksBufferStartMs == null\) return null/.test(m[0]), true);
      check('F4 未配置早返守卫', /this\._liveTicksRetainHours == null\) return null/.test(m[0]), true);
    }
    const engSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
    check('F5 引擎 prune interval 挂 trim（与 FA prune 同周期独立 try/catch）',
      /this\._intervals\.prune = setInterval\(\(\) => \{[\s\S]*?trimLiveTicksBuffer\(\);[\s\S]*?\}, this\._pruneIntervalMs\);/.test(engSrc), true);
    check('F6 TPA 未构造不调（if (this._tokenPositionAnalyzer) 判空）',
      /if \(this\._tokenPositionAnalyzer\) \{\s*\n\s*try \{\s*\n\s*this\._tokenPositionAnalyzer\.trimLiveTicksBuffer\(\);/.test(engSrc), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}
