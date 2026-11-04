/**
 * ② cheat 门 memSource 单测（2026-11-04，零 DB 零网络）
 *
 * 覆盖（plan ② 全断言面）：
 *  A. collector 行环（三份同构参数化）：挂点= _pushTickRow 咽喉（尘 tick 含环）、
 *     双段锚语义与 DB 路径逐位同构（<pullLimit anchor=total / 满帽 anchor=帽值+
 *     head300+tail3000 seen 去重）、head 出生最早段保底永不滚出、行对象同引用、
 *     乱序回推排序链上真序、断流清扫（活跃票=protected 语义永不误删）、stop 清环
 *  B. service 双源：mem hit 零 DB 查询+watermark/quoteToken 口径单点复用、
 *     miss 等 settleFlushMs 回落 DB、settle 双模（waitIdle+pullTicks 注入=零尾随；
 *     仅 waitIdle=尾随等 flush）、shadow 对拍（一致零告警/DB 缺行 mismatch/
 *     watermark 截断消除新行噪声）
 *  C. 引擎分派：单 collector 直取、both 按 _platformForToken 分派、平台未知 null、
 *     空映射 null（原型借调不跑 ctor）
 *  D. 源码口径锁：三 collector 环挂点/stop 清环/引擎注入构造 grep 断言
 */

'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── 三 collector 参数化 ──
const COLLECTORS = [
  ['fourmeme', 'fourmemeWs', require('../src/collectors/fourmeme-ankr-ws-collector.js').FourMemeAnkrWsCollector],
  ['flap', 'flapWs', require('../src/collectors/flap-ankr-ws-collector.js').FlapAnkrWsCollector],
  ['gang', 'gangWs', require('../src/collectors/gang-ankr-ws-collector.js').GangAnkrWsCollector],
];

/** 行工厂：block 链上真序（i 决定 block:log），字段对齐 tickRow 关键列 */
function tick(i, { token = '0xtok', sender = null, bnb = 0.1, quote = null } = {}) {
  return {
    token_address: token,
    block_time: new Date(1700000000000 + i * 750).toISOString(),
    block_number: 100 + Math.floor(i / 2), log_index: i % 2,
    tx_hash: `0xh${i}`, trade_type: i % 3 === 2 ? 'sell' : 'buy',
    bnb_amount: bnb, token_amount: 1e6, price_bnb: 1e-9, price_outlier: false,
    trader_address: `0xt${i % 7}`.padEnd(42, '0'), sender_address: sender,
    quote_token: quote, platform: null,
  };
}

function makeCollector(name, cfgKey, Ctor) {
  const c = new Ctor({ [cfgKey]: {} }, quietLogger);
  c._factorAggregator = { processTick: () => ({}), applyWalletTick: () => ({}), registerToken: () => {} };
  c._minTickBnb = 0; // 尘门关（A8 单独开）
  c._tickFlushThreshold = 1e9; // 防 flush 触发 DB 写
  return c;
}

async function main() {
  // ═══════════════ A. collector 行环 ═══════════════
  console.log('A. collector 行环（三份同构）');
  for (const [name, cfgKey, Ctor] of COLLECTORS) {
    // A1 未满帽：rows=全量链上真序升序，anchor=total，capped=false
    {
      const c = makeCollector(name, cfgKey, Ctor);
      for (let i = 0; i < 50; i++) c._pushTickRow(tick(i));
      const p = c.pullTokenTicks('0xtok');
      ok(p && p.rows.length === 50 && p.anchorTickCount === 50 && p.capped === false, `A1[${name}] 未满帽 anchor=total=capped false`);
      ok(p.rows[0].block_number <= p.rows[49].block_number, `A1[${name}] rows 链上真序升序`);
      ok(c._tokenRing.get('0xtok').total === 50 && c._tokenRing.get('0xtok').tail.length === 50, `A1[${name}] total/tail 计数`);
      ok(c.stats.ringTokens === 1, `A1[${name}] stats.ringTokens`);
    }

    // A2 满帽（total>3000）：anchor=3000 帽值，rows=head300+tail3000 无重叠
    {
      const c = makeCollector(name, cfgKey, Ctor);
      for (let i = 0; i < 3400; i++) c._pushTickRow(tick(i));
      const p = c.pullTokenTicks('0xtok');
      ok(p.capped === true && p.anchorTickCount === 3000, `A2[${name}] 满帽 anchor=pullLimit 帽值（真总数未知=DB 同构）`);
      ok(p.rows.length === 3300, `A2[${name}] rows=head300+tail3000（3400 行无重叠窗）`);
      ok(p.rows[0].tx_hash === '0xh0' && p.rows[299].tx_hash === '0xh299', `A2[${name}] head 段=出生最早 300（DB head 同构）`);
      ok(p.rows[300].tx_hash === '0xh400' && p.rows[3299].tx_hash === '0xh3399', `A2[${name}] tail 段=最近 3000（h400..h3399；h300-h399 淘汰=DB 同构）`);
    }

    // A3 重叠窗（3000<total≤3300）：head 与 tail 有交集 seen 去重（rows=total 不多算）
    {
      const c = makeCollector(name, cfgKey, Ctor);
      for (let i = 0; i < 3200; i++) c._pushTickRow(tick(i));
      const p = c.pullTokenTicks('0xtok');
      ok(p.capped === true && p.anchorTickCount === 3000, `A3[${name}] 3200 行满帽`);
      ok(p.rows.length === 3200, `A3[${name}] 重叠去重 rows=3200（head300∩tail200 只算一次，DB 同款 seen）`);
    }

    // A4 head 保底永不滚出：>3600 行后 head 仍是出生最早 300
    {
      const c = makeCollector(name, cfgKey, Ctor);
      for (let i = 0; i < 4000; i++) c._pushTickRow(tick(i));
      const p = c.pullTokenTicks('0xtok');
      ok(p.rows.length === 3300 && p.rows[0].tx_hash === '0xh0', `A4[${name}] 4000 行后 head 仍含 h0（保底不滚出）`);
      ok(p.rows[300].tx_hash === '0xh1000', `A4[${name}] tail=最近 3000（h1000..h3999）`);
    }

    // A5 同引用：环行===buffer 行（先入环后进 buffer；引用链是设计意图——
    //    FA price_outlier 回写/flush 失败 unshift 均同对象可见）
    {
      const c = makeCollector(name, cfgKey, Ctor);
      const row = tick(0);
      c._pushTickRow(row);
      ok(c._tokenRing.get('0xtok').tail[0] === row && c._tickBuffer[0] === row, `A5[${name}] 环行与 buffer 行同引用`);
      row.price_outlier = true;
      ok(c.pullTokenTicks('0xtok').rows[0].price_outlier === true, `A5[${name}] 同对象回写环内可见（sender 已终态行直接入环）`);
    }

    // A6 miss：未跟踪 token → null（service 回落 DB）
    {
      const c = makeCollector(name, cfgKey, Ctor);
      c._pushTickRow(tick(0));
      ok(c.pullTokenTicks('0xunknown') === null, `A6[${name}] 未跟踪 token → null`);
    }

    // A7 断流清扫：>10min 无 push 的票环清除；活跃票（新 push）永不清（protected 语义）
    {
      const c = makeCollector(name, cfgKey, Ctor);
      c._pushTickRow(tick(0, { token: '0xdead' }));
      const e = c._tokenRing.get('0xdead');
      e.lastPushAt = Date.now() - 11 * 60 * 1000;
      c._ringLastSweepAt = 0; // 强制下轮 push 触发 sweep
      c._pushTickRow(tick(1, { token: '0xalive' }));
      ok(!c._tokenRing.has('0xdead') && c._tokenRing.has('0xalive'), `A7[${name}] 断流 11min 清环/活跃票保留`);
      ok(c.stats.ringSwept === 1, `A7[${name}] ringSwept 计数`);
    }

    // A8 尘 tick（< minTickBnb）不喂 FA 仍进环（_pushTickRow 咽喉全路含环）
    {
      const c = makeCollector(name, cfgKey, Ctor);
      c._minTickBnb = 2;
      const r = tick(0);
      r.bnb_amount = 1; // 尘
      c._pushTickRow(r);
      ok(c._tokenRing.get('0xtok') && c._tokenRing.get('0xtok').total === 1, `A8[${name}] 尘 tick 进环（与 DB 行集同构含尘行）`);
    }

    // A9 乱序回推形状（resolver 乱序 push）→ pullTokenTicks 排序链上真序
    {
      const c = makeCollector(name, cfgKey, Ctor);
      c._pushTickRow(tick(2));
      c._pushTickRow(tick(0));
      c._pushTickRow(tick(1));
      const p = c.pullTokenTicks('0xtok');
      ok(p.rows.map((x) => x.tx_hash).join(',') === '0xh0,0xh1,0xh2', `A9[${name}] 乱序 push 排序链上真序`);
    }

    // A10 stop 清环
    {
      const c = makeCollector(name, cfgKey, Ctor);
      c._pushTickRow(tick(0));
      await c.stop();
      ok(c._tokenRing.size === 0 && c.pullTokenTicks('0xtok') === null, `A10[${name}] stop 清环`);
    }
  }

  // ═══════════════ B. service 双源 ═══════════════
  console.log('B. CheatCheckService 双源');
  const { CheatCheckService } = require('../src/market-analysis/CheatCheckService');

  function memDb({ ticks = [] } = {}) {
    const state = { tickQueries: 0 };
    const holder = { ticks };
    const client = {
      from(table) {
        const ops = [];
        const p = {
          select: () => p, eq: () => p,
          order: (...a) => { ops.push(['order', a]); return p; },
          limit: () => p,
          insert: () => Promise.resolve({ error: null }),
          then: (res, rej) => {
            if (table === 'wss_price_ticks') {
              state.tickQueries++;
              const orders = ops.filter((o) => o[0] === 'order');
              const asc = orders.length ? orders[0][1][1] && orders[0][1][1].ascending !== false : true;
              const sorted = [...holder.ticks].sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
              const limitOp = ops.find((o) => o[0] === 'limit');
              const limit = limitOp ? limitOp[1][0] : 1000;
              const data = asc ? sorted.slice(0, limit) : sorted.slice(-limit).reverse();
              return Promise.resolve({ data, error: null }).then(res, rej);
            }
            return Promise.resolve({ data: [], error: null }).then(res, rej);
          },
        };
        return p;
      },
    };
    return { client, state, holder };
  }

  // B1 mem hit：零 DB 拉数查询，watermark/quoteToken service 侧单点补
  {
    const db = memDb();
    const memRows = [];
    for (let i = 0; i < 20; i++) memRows.push(tick(i, { quote: i > 10 ? '0xUSD1' : null }));
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db.client, pullTicks: async () => ({ rows: memRows, anchorTickCount: 20, capped: false }) });
    const pull = await svc._pullTicks('0xtok');
    ok(pull.fromMem === true && pull.rows.length === 20 && pull.anchorTickCount === 20 && pull.capped === false, 'B1 mem hit 形状透传');
    ok(db.state.tickQueries === 0, 'B1 mem hit 零 DB 拉数查询');
    ok(pull.watermark && pull.watermark.key === `${memRows[19].block_number}:${memRows[19].log_index}`, 'B1 watermark service 单点计算');
    ok(pull.quoteToken === '0xUSD1', 'B1 quoteToken 行尾扫描（flap quote 盘）');
  }

  // B2 mem miss（null）→ 等 settleFlushMs 后回落 DB（settleFlushMs=5 快测）
  {
    const db = memDb({ ticks: [tick(0), tick(1)] });
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 0, settleFlushMs: 5, timeoutMs: 500 }, null,
      { dbClient: db.client, pullTicks: async () => null });
    const t0 = Date.now();
    const pull = await svc._pullTicks('0xtok');
    ok(!pull.fromMem && pull.rows.length === 2 && db.state.tickQueries === 1, 'B2 miss 回落 DB 路径（单次 tail 查询）');
    ok(Date.now() - t0 >= 5, 'B2 miss 吃 settleFlushMs 等 flush 边界');
    ok(pull.anchorTickCount === 2 && pull.capped === false, 'B2 DB 路径锚语义不变');
  }

  // B3 settle 双模组合：waitIdle+pullTicks 注入 → race 出窗后零尾随等待直拉 mem
  {
    const db = memDb();
    let idleCalled = 0;
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 4000, timeoutMs: 500, memSource: { auditShadow: false } }, null,
      {
        dbClient: db.client,
        waitIdle: async () => { idleCalled++; return true; },
        pullTicks: async () => ({ rows: [tick(0)], anchorTickCount: 1, capped: false }),
        loadLlm: async () => ({ JevClient: { ask: async () => ({ answers: {} }) }, buildCheatQuestions: () => ({}), CHEAT_QUESTIONS_VERSION: 'T' }),
      });
    const t0 = Date.now();
    await svc._chain('0xtok', { platform: 'flap' }, {});
    ok(idleCalled === 1 && svc.stats.settleIdleHits === 1, 'B3 waitIdle 注入 race 胜出（idle 提前出窗）');
    ok(Date.now() - t0 < 2000, `B3 settle≈0ms（waitIdle+mem 源零尾随零固定等待；实际 ${Date.now() - t0}ms）`);
  }

  // B4 仅 waitIdle（数据源仍 DB）→ 尾随 settleFlushMs 等 flush（settleFlushMs=80 实测）
  {
    const db = memDb({ ticks: [tick(0)] });
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 4000, settleFlushMs: 80, timeoutMs: 500 }, null,
      { dbClient: db.client, waitIdle: async () => true });
    const t0 = Date.now();
    await svc._chain('0xtok', { platform: 'flap' }, {});
    const dt = Date.now() - t0;
    ok(dt >= 80, `B4 仅 waitIdle：尾随 settleFlushMs 等 flush 边界（实际 ${dt}ms ≥80ms）`);
    ok(svc.stats.settleIdleHits === 1, 'B4 idle 命中计数');
  }

  // B5 未注入 waitIdle → 固定 settleDelayMs 现状 bit 一致（settleDelayMs=60 实测）
  {
    const db = memDb({ ticks: [tick(0)] });
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 60, timeoutMs: 500 }, null,
      { dbClient: db.client });
    const t0 = Date.now();
    await svc._chain('0xtok', { platform: 'flap' }, {});
    ok(Date.now() - t0 >= 60, 'B5 未注入=固定 settle 现状不变');
  }

  // B6 shadow 对拍：mem hit 后异步 DB 重拉——一致零告警；DB 缺行 mismatch；新行噪声截断消除
  {
    // B6a 一致：DB 行与 mem 行同集（shadow 等待 settleDelayMs+2s——用 0+短窗不现实，
    //    这里直接调 _shadowAudit 验证比对逻辑（等待窗外置）
    const memRows = [tick(0), tick(1), tick(2)];
    const db = memDb({ ticks: memRows.map((r) => ({ ...r })) });
    const svc = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db.client });
    await svc._shadowAudit('0xtok', { rows: memRows, anchorTickCount: 3, capped: false, watermark: svc._watermarkOf(memRows) });
    ok(svc.stats.shadowAudits === 1 && svc.stats.shadowMismatches === 0, 'B6a shadow 一致零告警');

    // B6b DB 缺行（flush 故障形状）→ mismatch
    const db2 = memDb({ ticks: [tick(0), tick(2)] });
    const svc2 = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db2.client });
    await svc2._shadowAudit('0xtok', { rows: memRows, anchorTickCount: 3, capped: false, watermark: svc2._watermarkOf(memRows) });
    ok(svc2.stats.shadowMismatches === 1, 'B6b DB 缺行 mismatch（flush/INSERT 故障信号）');

    // B6c mem 拉数后 DB 又来新行（正常瞬态）→ 按 watermark 截断对齐零误报
    const grown = memRows.map((r) => ({ ...r })).concat([tick(3), tick(4)]);
    const db3 = memDb({ ticks: grown });
    const svc3 = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db3.client });
    await svc3._shadowAudit('0xtok', { rows: memRows, anchorTickCount: 3, capped: false, watermark: svc3._watermarkOf(memRows) });
    ok(svc3.stats.shadowMismatches === 0, 'B6c watermark 截断消除新行噪声');

    // B6d mem 侧 sender 终态 vs DB 侧 NULL（值不一致）→ mismatch（sender 口径是比对项）
    const withSender = [tick(0), tick(1), tick(2)].map((r, i) => ({ ...r, sender_address: `0xreal${i}`.padEnd(42, '0') }));
    const nullSender = withSender.map((r) => ({ ...r, sender_address: null }));
    const db4 = memDb({ ticks: nullSender });
    const svc4 = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db4.client });
    await svc4._shadowAudit('0xtok', { rows: withSender, anchorTickCount: 3, capped: false, watermark: svc4._watermarkOf(withSender) });
    ok(svc4.stats.shadowMismatches === 1, 'B6d sender 值不一致比对命中（digest 含 sender_address）');

    // B6e shadow 全吞错：DB 查询 throw → shadowErrors 不崩
    const db5 = memDb({ ticks: [] });
    db5.client.from = () => { throw new Error('db down'); };
    const svc5 = new CheatCheckService({ enabled: true, settleDelayMs: 0, timeoutMs: 500 }, null,
      { dbClient: db5.client });
    await svc5._shadowAudit('0xtok', { rows: memRows, anchorTickCount: 3, capped: false, watermark: svc5._watermarkOf(memRows) });
    ok(svc5.stats.shadowErrors === 1 && svc5.stats.shadowMismatches === 0, 'B6e shadow 故障全吞错计数');
  }

  // B7 auditShadow 物化语义：memSource 段显式 false 关 / 缺省 true 开
  {
    ok(new CheatCheckService({ memSource: {} })._auditShadow === true, 'B7 memSource 缺 auditShadow=默认开');
    ok(new CheatCheckService({ memSource: { auditShadow: false } })._auditShadow === false, 'B7 显式 false 关');
    ok(new CheatCheckService({})._auditShadow === true, 'B7 缺 memSource 段=默认开（shadow 只在 mem hit 才跑，零 mem 依赖）');
  }

  // ═══════════════ C. 引擎分派（原型借调，不跑 ctor） ═══════════════
  console.log('C. 引擎 _cheatRingPull 分派');
  {
    const Eng = require('../src/trading-engine/implementations/FourMemeWssTradingEngine.js').FourMemeWssTradingEngine;
    const eng = Object.create(Eng.prototype);
    const pulls = [];
    eng._collectorsByPlatform = new Map([
      ['fourmeme', { pullTokenTicks: (t) => { pulls.push(['fourmeme', t]); return { rows: [], anchorTickCount: 1, capped: false }; } }],
      ['flap', { pullTokenTicks: (t) => { pulls.push(['flap', t]); return { rows: [], anchorTickCount: 2, capped: false }; } }],
    ]);
    eng._platformForToken = (t) => (t === '0xF' ? 'flap' : 'fourmeme');
    ok(eng._cheatRingPull('0xF').anchorTickCount === 2, 'C1 both 按 token 平台分派 flap 环');
    ok(eng._cheatRingPull('0x4').anchorTickCount === 1, 'C1 both 按 token 平台分派 fourmeme 环');

    eng._platformForToken = () => null;
    ok(eng._cheatRingPull('0xX') === null, 'C2 平台未知 null（service 回落 DB，绝不跨平台拿错环）');

    eng._collectorsByPlatform = new Map([['fourmeme', { pullTokenTicks: () => ({ rows: [], anchorTickCount: 9, capped: false }) }]]);
    eng._platformForToken = () => null;
    ok(eng._cheatRingPull('0xany').anchorTickCount === 9, 'C3 单 collector 直取（单平台实验零分派开销）');

    eng._collectorsByPlatform = new Map();
    ok(eng._cheatRingPull('0xt') === null, 'C4 空映射 null（stop 后）');
  }

  // ═══════════════ D. 源码口径锁 ═══════════════
  console.log('D. 源码口径锁（grep）');
  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const fm = read('src/collectors/fourmeme-ankr-ws-collector.js');
    const fl = read('src/collectors/flap-ankr-ws-collector.js');
    const ga = read('src/collectors/gang-ankr-ws-collector.js');
    for (const [name, src] of [['fourmeme', fm], ['flap', fl], ['gang', ga]]) {
      ok(/this\.stats\.ticksBuffered\+\+;\s*this\._ringPush\(tickRow\);/.test(src), `D1[${name}] 环挂点=_pushTickRow 咽喉（ticksBuffered 后立刻）`);
      ok(src.includes('this._tokenRing.clear();'), `D1[${name}] stop 清环`);
      ok(/RING_HEAD_LIMIT = 300/.test(src) && /RING_TAIL_LIMIT = 3000/.test(src), `D1[${name}] 环常量 300/3000（与 service pullLimit/headLimit 同构）`);
      ok(/e\.head\.length < RING_HEAD_LIMIT\) e\.head\.push/.test(src), `D1[${name}] head 只在 <300 时 push（保底语义）`);
      ok(src.includes('RING_IDLE_MAX_MS') && src.includes('_sweepTokenRing'), `D1[${name}] 断流清扫`);
    }
    const svc = read('src/market-analysis/CheatCheckService.js');
    ok(svc.includes('_pullTicksDb(token)'), 'D2 service DB 路径独立方法（shadow 复用不经 mem）');
    ok(/if \(!this\._deps\.pullTicks\) \{\s*await new Promise\(\(r\) => setTimeout\(r, this\._settleFlushMs\)\);/.test(svc), 'D2 尾随等待只在无 mem 源时（组合语义锁）');
    ok(svc.includes('pull.fromMem'), 'D2 mem hit 标记消费（shadow 挂点）');
    const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    ok(/waitIdle: \(token\) => \(this\._senderResolver/.test(eng), 'D3 引擎 waitIdle 恒注入（闭包延迟解析）');
    ok(/_cheatMemCfg\.enabled === true/.test(eng), 'D3 pullTicks 仅 memSource.enabled 显式开注入');
    ok(eng.includes('this._cheatRingPull(token)'), 'D3 引擎行环分派接线');
    ok(eng.includes('this._collectorsByPlatform.set(platform, collector)'), 'D3 collector 平台映射登记');
    const cfg = JSON.parse(read('config/default.json'));
    ok(cfg.fourmemeWs?.cheatCheck?.memSource?.enabled === false, 'D4 default.json memSource.enabled=false（默认关，灰度对拍后翻）');
    ok(cfg.fourmemeWs?.cheatCheck?.memSource?.auditShadow === true, 'D4 auditShadow 默认开（对拍护栏）');
  }

  console.log(`\n✅ 全部通过：${passed} 断言`);
}

main().catch((err) => {
  console.error(`\n❌ 失败（已过 ${passed} 断言）:`, err.message);
  process.exit(1);
});
