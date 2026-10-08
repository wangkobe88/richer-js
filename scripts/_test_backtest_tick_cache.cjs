/**
 * 回测 ticks 装载缓存（BacktestTickCache）零 DB 单测
 *
 * 覆盖矩阵（对照设计状态机）：
 *  A. MISS：空目录全量拉取 → data+meta 落盘，行 deep-equal（price 字符串原样），fetchRows 以 afterId=0 调用
 *  B. FRESH：命中零分页拉取（探针除外），返回行 deep-equal
 *  C. STALE 增量：DB 追加 id>maxId（跨 chunk、含 id 洞）→ 旧行+增量合并，meta 更新，再读 FRESH deep-equal
 *  D. STALE 全局排序：105 地址双 chunk 增量块间 id 交错 → 重写文件逐行 id 严格升序
 *  E. 探针失败 → bypass：WARN 日志、fetchRows(0) 直拉、缓存目录无任何文件
 *  F. forceRefresh：跳过缓存读强制重拉重建
 *  G. 损坏-数据：坏 gzip / 坏 JSON 行 → 自动删缓存 MISS 重拉不中断
 *  H. 损坏-meta：gzipBytes 篡改（crash 窗口形态）→ drop + MISS
 *  I. 表回缩：锚行被删 → 锚行 PK 核验 false → drop + MISS（2026-10-08 锚定探针
 *     语义迁移：gt 锚形状下 probeMax < meta.maxId 分支结构性不可达，检测责任移交锚行核验）
 *  J. 空 platform：meta{0,0} 再读 FRESH 空数组零拉取；meta 非空 + probe null → drop+MISS
 *  K. both 双平台引擎级：缓存路径 _ticks 与直拉路径 _ticks 逐字段 deep-equal + 计数相等
 *  L. 时间窗过滤（引擎级）：缓存 vs 直拉 deep-equal（窗过滤/映射段未动的回归证明）
 *  M. 并发去重：同 key 两个未决 getOrFetch → fetchRows 计数=1，结果同引用
 *  N. cacheEnabled=false：直拉，缓存目录保持空
 *  O. id 超 Number.MAX_SAFE_INTEGER → 写路径 throw（fail-loud）
 *  P. columnsTag 漂移 → 判废 MISS 重拉
 *  Q. 锚定探针形状（2026-10-08 计划翻转事故）：探针 desc 查询带 gt(meta.maxId) 锚、
 *     FRESH 路径锚行 PK 核验恰一次、STALE 增量拉取 afterId=锚
 *
 * 零 DB：fake supabase（v2：order desc 生效 + 探针失败注入）打桩 + tmp 目录真实文件读写。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mkdtempSync } = fs;

const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');
const { BacktestTickCache } = require('../src/trading-engine/core/BacktestTickCache');

// ==================== stub supabase（v2） ====================

/**
 * 行集 → 链式 query builder（过滤语义对齐 PostgREST：in/eq/gt + order by id 升/降 + limit）。
 * 相比 _test_backtest_keyset_paging.cjs 的 v1：① order 的 asc 标志真实生效；
 * ② opts.failProbe=true 时探针形状查询（无 order + in 过滤，2026-10-08 无序探针形状）
 * 返回 error（bypass 用例注入；PK 核验 eq 查询无 in 不误伤）；
 * ③ opts.onExec(asc, q) 每次查询执行回调（FRESH 零拉取计数/锚定形状断言用）；
 * ④ 无 order 的查询（探针/锚行 PK 核验）不排序直接过滤（v3）。
 */
function makeFakeSupabaseV2(rows, opts = {}) {
  return {
    from() { return this._b(); },
    _b() {
      const q = {
        _in: null, _eq: null, _gt: null, _limit: null, _order: null,
        select() { return this; },
        in(col, vals) { this._in = { col, vals }; return this; },
        eq(col, val) { this._eq = { col, val }; return this; },
        gt(col, val) { this._gt = { col, val }; return this; },
        order(col, o) { this._order = { col, asc: !o || o.ascending !== false }; return this; },
        limit(n) { this._limit = n; return this._exec(); },
        _exec() {
          if (opts.failProbe && !q._order && q._in) {
            return { data: null, error: { message: 'probe boom (injected)' } };
          }
          if (opts.onExec) opts.onExec(!!(q._order && q._order.asc), q);
          let out = rows.filter(r =>
            (!q._in || q._in.vals.includes(r[q._in.col]))
            && (!q._eq || r[q._eq.col] === q._eq.val)
            && (!q._gt || r[q._gt.col] > q._gt.val));
          if (q._order) {
            out.sort((a, b) => (q._order.asc ? a[q._order.col] - b[q._order.col] : b[q._order.col] - a[q._order.col]));
          }
          return { data: out.slice(0, q._limit), error: null };
        },
      };
      return q;
    },
  };
}

/** 构造 DB 行（wss_price_ticks 形状；price 字符串模拟 numeric 列） */
function mkRow(id, token, platform, tsMs) {
  return {
    id, token_address: token, trade_type: 'buy', trader_address: `trader${id}`,
    price_bnb: String(0.001 + (id % 7) * 0.0001), price_usd: String(0.7 + (id % 5) * 0.1),
    bnb_amount: String(0.05), token_amount: String(1000), block_number: 40000000 + id,
    block_time: new Date(tsMs).toISOString(), tx_hash: `0x${id.toString(16)}`, log_index: id % 10,
    price_outlier: id % 11 === 0, platform,
  };
}

/** 假 logger（三参形态，warn/info 可捕获断言） */
function mkLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logs,
    info: (exp, tag, msg) => logs.info.push(msg),
    warn: (exp, tag, msg) => logs.warn.push(msg),
    error: (exp, tag, msg) => logs.error.push(msg),
  };
}

/** 引擎级 stub：预注入 tmp cacheDir 的 BacktestTickCache 实例 + 原型方法借用链。
 *  _tokenMeta 自动从 rows 收集全部 token（引擎真实行为就是 token 全集驱动拉取）。 */
function makeEngineStub({ rows, platforms, startFilter = null, endFilter = null, cacheDir, useCache = true, forceRefresh = false, supabaseOpts = {} }) {
  const logger = mkLogger();
  const tokenMeta = new Map();
  for (const r of rows) tokenMeta.set(r.token_address, {});
  const stub = {
    _tokenMeta: tokenMeta,
    _platforms: platforms,
    _startTimeFilter: startFilter,
    _endTimeFilter: endFilter,
    _ticks: [],
    metrics: { processedDataPoints: 0 },
    _sourceExperimentId: 'exp-src',
    _experiment: {
      config: {
        backtest: {
          sourceExperimentId: 'exp-src',
          ...(useCache ? {} : { cacheEnabled: false }),
          ...(forceRefresh ? { forceRefreshCache: true } : {}),
        },
      },
    },
    logger,
    _tickCache: new BacktestTickCache({ logger, experimentId: 'exp-bt', cacheDir }),
    _loadRawTickRows: BacktestEngine.prototype._loadRawTickRows,
    _fetchPlatformTicksRows: BacktestEngine.prototype._fetchPlatformTicksRows,
    _probeIncrementalTickId: BacktestEngine.prototype._probeIncrementalTickId,
    _anchorRowExists: BacktestEngine.prototype._anchorRowExists,
    _getClient: () => makeFakeSupabaseV2(rows, supabaseOpts),
  };
  return stub;
}

function mkTmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'bt-tick-cache-'));
}

/** 读缓存文件全部行（id 序），供排序断言 */
function readCacheRows(cacheDir, src, platform) {
  const zlib = require('zlib');
  const buf = fs.readFileSync(path.join(cacheDir, src, `${platform}.jsonl.gz`));
  const text = zlib.gunzipSync(buf).toString('utf8');
  return text.split('\n').filter(l => l).map(l => JSON.parse(l));
}

function readMeta(cacheDir, src, platform) {
  return JSON.parse(fs.readFileSync(path.join(cacheDir, src, `${platform}.meta.json`), 'utf8'));
}

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; console.log(`  ✓ ${label}`); }

(async () => {
  const T0 = Date.UTC(2026, 8, 20, 0, 0, 0);

  // ---------- A：MISS ----------
  console.log('A. MISS：空目录全量拉取 + 落盘');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 120; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const fetchCalls = [];
    const stub = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    const origFetch = stub._fetchPlatformTicksRows;
    stub._fetchPlatformTicksRows = function (sb, addrs, pf, afterId, prior) {
      fetchCalls.push(afterId);
      return origFetch.call(this, sb, addrs, pf, afterId, prior);
    };
    await BacktestEngine.prototype._loadWssTicks.call(stub);
    ok(fetchCalls.length === 1 && fetchCalls[0] === 0, `A. fetchRows 以 afterId=0 调用（calls=${JSON.stringify(fetchCalls)}）`);
    ok(stub._ticks.length === 120, `A2. _ticks 120 行 = ${stub._ticks.length}`);
    ok(fs.existsSync(path.join(dir, 'exp-src', 'fourmeme.jsonl.gz'))
      && fs.existsSync(path.join(dir, 'exp-src', 'fourmeme.meta.json')), 'A3. data+meta 落盘');
    const meta = readMeta(dir, 'exp-src', 'fourmeme');
    ok(meta.maxId === 120 && meta.rows === 120, `A4. meta.maxId=120/rows=120（${meta.maxId}/${meta.rows}）`);
    ok(meta.gzipBytes === fs.statSync(path.join(dir, 'exp-src', 'fourmeme.jsonl.gz')).size, 'A5. meta.gzipBytes === 实际 size');
    ok(meta.tokenCount === 1, `A6. meta.tokenCount=1`);
    // 行内容 deep-equal（字符串 price 原样 round-trip）
    const cached = readCacheRows(dir, 'exp-src', 'fourmeme');
    ok(cached.length === 120
      && cached.every((r, i) => r.price_bnb === rows[i].price_bnb && typeof r.price_bnb === 'string'
        && r.block_time === rows[i].block_time && r.price_outlier === rows[i].price_outlier),
      'A7. 缓存行与 DB 行 deep-equal（price 字符串/ISO 时间/布尔原样）');
  }

  // ---------- B：FRESH ----------
  console.log('B. FRESH：命中零分页拉取');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 80; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    // 第二次：同 cacheDir，fake supabase 钩子计数分页查询（order asc）次数
    let pagedQueries = 0;
    const stub2 = makeEngineStub({
      rows, platforms: ['fourmeme'], cacheDir: dir,
      supabaseOpts: { onExec: (asc) => { if (asc) pagedQueries++; } },
    });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 80, `B. FRESH 读出 80 行 = ${stub2._ticks.length}`);
    ok(pagedQueries === 0, `B2. 零分页拉取查询（pagedQueries=${pagedQueries}；仅探针/锚行核验查询）`);
    ok(stub1._ticks.length === stub2._ticks.length
      && stub1._ticks.every((t, i) => JSON.stringify(t) === JSON.stringify(stub2._ticks[i])),
      'B3. 两次 _ticks deep-equal');
  }

  // ---------- C：STALE 增量 ----------
  console.log('C. STALE：增量补拉合并');
  {
    const dir = mkTmpDir();
    const rows = [];
    let id = 0;
    for (let i = 0; i < 100; i++) rows.push(mkRow(++id, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    // DB 追加：留 id 洞 + 新地址（105 地址触发第二 chunk），id 无重复
    const grown = rows.slice();
    let id2 = id + 12; // id+1..id+11 为洞
    grown.push(mkRow(id2, '0xAAA', 'fourmeme', T0 + 100 * 1000));
    for (let t = 0; t < 105; t++) {
      const addr = '0x' + (t + 10).toString(16).padStart(4, '0');
      grown.push(mkRow(++id2, addr, 'fourmeme', T0 + 101 * 1000 + t));
    }
    const stub2 = makeEngineStub({ rows: grown, platforms: ['fourmeme'], cacheDir: dir });
    const logs2 = stub2.logger.logs;
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(logs2.info.some(m => m.includes('stale')), `C. source=stale 日志发出`);
    ok(stub2._ticks.length === grown.length, `C2. 合并后行数 = DB 全量 ${grown.length} = ${stub2._ticks.length}`);
    const meta = readMeta(dir, 'exp-src', 'fourmeme');
    ok(meta.maxId === id2 && meta.rows === grown.length, `C3. meta 更新 maxId=${id2}/rows=${grown.length}`);
    // 再读一次 FRESH 且与 DB 全量对拍
    const stub3 = makeEngineStub({ rows: grown, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub3);
    const byId = (a) => a.map(t => [t.token_address, t.timestamp]);
    const expect = grown.slice().sort((a, b) => a.id - b.id);
    ok(JSON.stringify(byId(stub3._ticks)) === JSON.stringify(byId(expectRawTicks(expect))),
      'C4. 增量后再读 FRESH 与 DB 全量对拍 deep-equal');
  }

  // ---------- D：STALE 重写文件全局 id 升序 ----------
  console.log('D. STALE 合并后文件逐行 id 严格升序');
  {
    const dir = mkTmpDir();
    // 首轮：105 地址（两 chunk）各 5 行
    const rows = [];
    let id = 0;
    const addrs = [];
    for (let t = 0; t < 105; t++) {
      const addr = '0x' + (t + 10).toString(16).padStart(4, '0');
      addrs.push(addr);
      for (let i = 0; i < 5; i++) rows.push(mkRow(++id, addr, 'fourmeme', T0 + i * 2000));
    }
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    // 追加：交错 id 形态（新行 id 递增但 token 分布交错——chunk 间拉取顺序与 id 序无关）
    const grown = rows.slice();
    for (let i = 0; i < 50; i++) {
      grown.push(mkRow(++id, addrs[(i * 37) % 105], 'fourmeme', T0 + 10 * 2000 + i * 1000));
    }
    const stub2 = makeEngineStub({ rows: grown, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    const cached = readCacheRows(dir, 'exp-src', 'fourmeme');
    ok(cached.length === grown.length, `D. 文件行数 = 全量 ${grown.length} = ${cached.length}`);
    ok(cached.every((r, i) => i === 0 || cached[i - 1].id < r.id), 'D2. 文件逐行 id 严格升序');
  }

  // ---------- E：探针失败 bypass ----------
  console.log('E. 探针失败 → bypass 直拉，缓存原状');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 30; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    // 先正常装载落缓存（空缓存直接 MISS 不经探针——一致性校验在前，bypass 用例需已有缓存）
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    const dataFile = path.join(dir, 'exp-src', 'fourmeme.jsonl.gz');
    const before = fs.readFileSync(dataFile);
    const beforeMtime = fs.statSync(dataFile).mtimeMs;
    // 再注入探针失败
    const stub = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir, supabaseOpts: { failProbe: true } });
    await BacktestEngine.prototype._loadWssTicks.call(stub);
    ok(stub._ticks.length === 30, `E. bypass 直拉 30 行 = ${stub._ticks.length}`);
    ok(stub.logger.logs.warn.some(m => m.includes('探针失败')), 'E2. WARN 日志发出');
    ok(fs.readFileSync(dataFile).equals(before) && fs.statSync(dataFile).mtimeMs === beforeMtime,
      'E3. 缓存文件未动（bypass 不读写缓存）');
  }

  // ---------- F：forceRefresh ----------
  console.log('F. forceRefresh 强制重拉重建');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 50; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    // DB 变化 + forceRefresh：即便探针本可判 stale，force 直接全量重拉
    const grown = rows.concat([mkRow(51, '0xAAA', 'fourmeme', T0 + 51 * 1000)]);
    let fetchCalls = 0;
    const stub2 = makeEngineStub({ rows: grown, platforms: ['fourmeme'], cacheDir: dir, forceRefresh: true });
    const origFetch = stub2._fetchPlatformTicksRows;
    stub2._fetchPlatformTicksRows = function (...a) { fetchCalls++; return origFetch.apply(this, a); };
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(fetchCalls >= 1, `F. fetchRows 被调用（${fetchCalls} 次）`);
    ok(stub2._ticks.length === 51, `F2. 重拉后 51 行 = ${stub2._ticks.length}`);
    const meta = readMeta(dir, 'exp-src', 'fourmeme');
    ok(meta.maxId === 51, `F3. 缓存重建 maxId=51`);
  }

  // ---------- G：损坏-数据文件 ----------
  console.log('G. 损坏数据文件 → 删缓存 MISS 重拉');
  {
    // G1: 坏 gzip（随机字节）
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 40; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    fs.writeFileSync(path.join(dir, 'exp-src', 'fourmeme.jsonl.gz'), Buffer.from('not a gzip at all'));
    const stub2 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 40, `G. 坏 gzip 自动删缓存重拉 40 行 = ${stub2._ticks.length}`);
    ok(stub2.logger.logs.info.some(m => m.includes('缓存读损坏') || m.includes('缓存失配')), 'G2. 损坏日志发出');
    ok(readCacheRows(dir, 'exp-src', 'fourmeme').length === 40, 'G3. 缓存复原');

    // G2: 合法 gzip 但行非 JSON
    const dir2 = mkTmpDir();
    const stub3 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir2 });
    await BacktestEngine.prototype._loadWssTicks.call(stub3);
    const zlib = require('zlib');
    fs.writeFileSync(path.join(dir2, 'exp-src', 'fourmeme.jsonl.gz'),
      zlib.gzipSync(Buffer.from('{broken json\n{also broken\n')));
    const stub4 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir2 });
    await BacktestEngine.prototype._loadWssTicks.call(stub4);
    ok(stub4._ticks.length === 40, `G4. 坏 JSON 行自动重拉 40 行 = ${stub4._ticks.length}`);
  }

  // ---------- H：meta.gzipBytes 篡改 ----------
  console.log('H. meta.gzipBytes 失配 → drop + MISS');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 25; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    const metaPath = path.join(dir, 'exp-src', 'fourmeme.meta.json');
    const m = readMeta(dir, 'exp-src', 'fourmeme');
    m.gzipBytes = m.gzipBytes + 999;   // 模拟 crash 窗口（rename 后 meta 落盘前中断）
    fs.writeFileSync(metaPath, JSON.stringify(m));
    const stub2 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 25, `H. 失配 drop 后 MISS 重拉 25 行 = ${stub2._ticks.length}`);
    ok(readMeta(dir, 'exp-src', 'fourmeme').gzipBytes === fs.statSync(path.join(dir, 'exp-src', 'fourmeme.jsonl.gz')).size,
      'H2. meta 复原');
  }

  // ---------- I：表回缩 ----------
  console.log('I. 锚行被删（表回缩）→ 锚行 PK 核验失败 → drop + MISS');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 60; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    const shrunk = rows.filter(r => r.id <= 30);   // DB 删了大 id 行（锚行 id=60 消失）
    const stub2 = makeEngineStub({ rows: shrunk, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 30, `I. 回缩后按 DB 重拉 30 行 = ${stub2._ticks.length}`);
    ok(stub2.logger.logs.info.some(m => m.includes('回缩')), 'I2. 回缩日志发出（锚行核验不存在分支）');
  }

  // ---------- J：空 platform ----------
  console.log('J. 空 platform（token 集在该平台无行）');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 10; i++) rows.push(mkRow(i, '0xAAA', 'flap', T0 + i * 1000));  // 只有 flap 行
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    ok(stub1._ticks.length === 0, `J. fourmeme 空 platform MISS 后 0 行`);
    const meta = readMeta(dir, 'exp-src', 'fourmeme');
    ok(meta.maxId === 0 && meta.rows === 0, `J2. 空集 meta{0,0}`);
    // 再读：FRESH 空数组零拉取
    let paged = 0;
    const stub2 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 0 && stub2.logger.logs.info.some(m => m.includes('source=fresh')),
      'J3. 空集再读 FRESH');
    // meta 非空 + probe null（DB 清空该 platform 行）→ drop+MISS
    const dir2 = mkTmpDir();
    const rows2 = rows.map(r => ({ ...r, platform: 'fourmeme' }));
    const stub3 = makeEngineStub({ rows: rows2, platforms: ['fourmeme'], cacheDir: dir2 });
    await BacktestEngine.prototype._loadWssTicks.call(stub3);
    const stub4 = makeEngineStub({ rows: [], platforms: ['fourmeme'], cacheDir: dir2 });   // DB 清空
    await BacktestEngine.prototype._loadWssTicks.call(stub4);
    ok(stub4._ticks.length === 0 && stub4.logger.logs.info.some(m => m.includes('表空')),
      'J4. meta 非空 + probe null → drop+MISS（日志「表空」）');
  }

  // ---------- K：both 双平台引擎级对拍 ----------
  console.log('K. both 双平台：缓存路径 ≡ 直拉路径');
  {
    const rows = [];
    let id = 0;
    const plan = [
      ['0xAAA', 'fourmeme', 137], ['0xAAA', 'flap', 3],
      ['0xBBB', 'fourmeme', 0], ['0xBBB', 'flap', 26],
      ['0xCCC', 'fourmeme', 501], ['0xCCC', 'flap', 9],
    ];
    for (const [tok, pf, n] of plan) {
      for (let i = 0; i < n; i++) rows.push(mkRow(++id, tok, pf, T0 + i * 3000 + (pf === 'flap' ? 1500 : 0)));
    }
    const dir = mkTmpDir();
    const stubC = makeEngineStub({ rows, platforms: ['fourmeme', 'flap'], cacheDir: dir });
    const stubD = makeEngineStub({ rows, platforms: ['fourmeme', 'flap'], cacheDir: mkTmpDir(), useCache: false });
    await BacktestEngine.prototype._loadWssTicks.call(stubC);
    await BacktestEngine.prototype._loadWssTicks.call(stubD);
    ok(JSON.stringify(stubC._ticks) === JSON.stringify(stubD._ticks),
      `K. both 缓存 _ticks ≡ 直拉 _ticks（${stubC._ticks.length} 行逐字段）`);
    ok(stubC.metrics.processedDataPoints === stubD.metrics.processedDataPoints,
      `K2. processedDataPoints 相等（${stubC.metrics.processedDataPoints}）`);
    ok(fs.existsSync(path.join(dir, 'exp-src', 'fourmeme.jsonl.gz'))
      && fs.existsSync(path.join(dir, 'exp-src', 'flap.jsonl.gz')), 'K3. 两 platform 文件独立落盘');
  }

  // ---------- L：时间窗过滤 ----------
  console.log('L. 时间窗过滤：缓存 ≡ 直拉');
  {
    const rows = [];
    for (let i = 0; i < 300; i++) rows.push(mkRow(i + 1, '0xEEE', 'fourmeme', T0 + i * 60_000));
    const winStart = T0 + 60 * 60_000;
    const winEnd = T0 + 240 * 60_000;
    const dir = mkTmpDir();
    const stubC = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir, startFilter: winStart, endFilter: winEnd });
    const stubD = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: mkTmpDir(), useCache: false, startFilter: winStart, endFilter: winEnd });
    await BacktestEngine.prototype._loadWssTicks.call(stubC);
    await BacktestEngine.prototype._loadWssTicks.call(stubD);
    ok(stubC._ticks.length === 181 && JSON.stringify(stubC._ticks) === JSON.stringify(stubD._ticks),
      `L. 闭区间窗 181 行，缓存 ≡ 直拉（${stubC._ticks.length}）`);
    // 缓存文件仍是全量 300 行（缓存存全量、运行期过滤）
    ok(readCacheRows(dir, 'exp-src', 'fourmeme').length === 300, 'L2. 缓存文件存全量 300 行（窗过滤只在内存层）');
  }

  // ---------- M：并发去重 ----------
  console.log('M. 同 key 并发去重');
  {
    const dir = mkTmpDir();
    const logger = mkLogger();
    const cache = new BacktestTickCache({ logger, cacheDir: dir });
    const rows = [mkRow(1, '0xA', 'fourmeme', T0), mkRow(2, '0xA', 'fourmeme', T0 + 1)];
    let fetchCount = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchRows = async () => { fetchCount++; await gate; return rows.slice(); };
    const probe = async () => 2;
    const anchor = async () => true;
    const p1 = cache.getOrFetch({ sourceExperimentId: 's', platform: 'fourmeme', addresses: ['0xA'], fetchRows, probeMaxId: probe, anchorExists: anchor });
    const p2 = cache.getOrFetch({ sourceExperimentId: 's', platform: 'fourmeme', addresses: ['0xA'], fetchRows, probeMaxId: probe, anchorExists: anchor });
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    ok(fetchCount === 1, `M. fetchRows 只执行一次（${fetchCount}）`);
    ok(r1 === r2 && r1.rows === r2.rows, 'M2. 两调用共享同一结果对象');
  }

  // ---------- N：cacheEnabled=false ----------
  console.log('N. cacheEnabled=false 直拉');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 15; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir, useCache: false });
    await BacktestEngine.prototype._loadWssTicks.call(stub);
    ok(stub._ticks.length === 15, `N. 直拉 15 行 = ${stub._ticks.length}`);
    ok(!fs.existsSync(path.join(dir, 'exp-src')), 'N2. 缓存目录保持空');
  }

  // ---------- O：id 超 MAX_SAFE_INTEGER ----------
  console.log('O. id 超精度护栏 fail-loud');
  {
    const dir = mkTmpDir();
    const logger = mkLogger();
    const cache = new BacktestTickCache({ logger, cacheDir: dir });
    const bad = mkRow(Number.MAX_SAFE_INTEGER + 1000, '0xA', 'fourmeme', T0);
    let threw = null;
    try {
      await cache.getOrFetch({
        sourceExperimentId: 's', platform: 'fourmeme', addresses: ['0xA'],
        fetchRows: async () => [bad], probeMaxId: async () => bad.id, anchorExists: async () => true,
      });
    } catch (e) { threw = e; }
    ok(threw && /MAX_SAFE_INTEGER/.test(threw.message), `O. 超 precision 写入 throw（${threw && threw.message.slice(0, 40)}…）`);
  }

  // ---------- P：columnsTag 漂移 ----------
  console.log('P. columnsTag 漂移 → 判废重拉');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 20; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);
    const m1 = readMeta(dir, 'exp-src', 'fourmeme');
    ok(m1.columnsTag != null && m1.columnsTag.includes('token_address'), 'P. meta 记录 columnsTag');
    // 模拟列清单变更：直接篡改 meta.columnsTag
    const metaPath = path.join(dir, 'exp-src', 'fourmeme.meta.json');
    m1.columnsTag = 'id, changed_columns';
    fs.writeFileSync(metaPath, JSON.stringify(m1));
    const stub2 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 20, `P2. 漂移判废后 MISS 重拉 20 行 = ${stub2._ticks.length}`);
    ok(readMeta(dir, 'exp-src', 'fourmeme').columnsTag.includes('token_address'), 'P3. meta columnsTag 复原');
  }

  // ---------- Q：锚定探针形状（2026-10-08 计划翻转事故） ----------
  console.log('Q. 锚定探针：探针带 gt(meta.maxId) 锚 + 锚行 PK 核验');
  {
    const dir = mkTmpDir();
    const rows = [];
    for (let i = 1; i <= 80; i++) rows.push(mkRow(i, '0xAAA', 'fourmeme', T0 + i * 1000));
    const stub1 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir });
    await BacktestEngine.prototype._loadWssTicks.call(stub1);   // MISS 落盘 maxId=80

    // Q-1 FRESH 形状：无增量 → 锚定探针 null + 锚行核验在 → 纯读
    const probeAnchors = [];   // 无序探针查询携带的 gt 锚值（无锚记 null）
    const pkChecks = [];       // PK 核验查询的 eq id 值
    const stub2 = makeEngineStub({
      rows, platforms: ['fourmeme'], cacheDir: dir,
      supabaseOpts: { onExec: (asc, q) => {
        if (q._eq && q._eq.col === 'id') pkChecks.push(q._eq.val);
        else if (!asc) probeAnchors.push(q._gt ? q._gt.val : null);
      } },
    });
    await BacktestEngine.prototype._loadWssTicks.call(stub2);
    ok(stub2._ticks.length === 80, `Q. FRESH 纯读 80 行 = ${stub2._ticks.length}`);
    ok(probeAnchors.length >= 1 && probeAnchors.every(v => v === 80),
      `Q2. 探针全部带 gt 锚=meta.maxId=80（anchors=${JSON.stringify(probeAnchors)}）`);
    ok(pkChecks.length === 1 && pkChecks[0] === 80,
      `Q3. 锚行 PK 核验恰一次且 id=80（checks=${JSON.stringify(pkChecks)}）`);

    // Q-4 STALE 形状：增量 3 行 → 锚定探针返回增量 max（>锚），增量拉取 afterId=锚
    const dir2 = mkTmpDir();
    const grown = rows.concat([
      mkRow(81, '0xAAA', 'fourmeme', T0 + 81 * 1000),
      mkRow(82, '0xAAA', 'fourmeme', T0 + 82 * 1000),
      mkRow(83, '0xAAA', 'fourmeme', T0 + 83 * 1000),
    ]);
    const stub3 = makeEngineStub({ rows, platforms: ['fourmeme'], cacheDir: dir2 });
    await BacktestEngine.prototype._loadWssTicks.call(stub3);   // 落盘 maxId=80
    const staleFetchAfterIds = [];
    const stub4 = makeEngineStub({ rows: grown, platforms: ['fourmeme'], cacheDir: dir2 });
    const origFetch = stub4._fetchPlatformTicksRows;
    stub4._fetchPlatformTicksRows = function (sb, addrs, pf, afterId, prior) {
      if (afterId > 0) staleFetchAfterIds.push(afterId);   // 只记增量拉取（MISS afterId=0 不记）
      return origFetch.call(this, sb, addrs, pf, afterId, prior);
    };
    await BacktestEngine.prototype._loadWssTicks.call(stub4);
    ok(stub4._ticks.length === 83 && staleFetchAfterIds.length === 1 && staleFetchAfterIds[0] === 80,
      `Q4. STALE 增量拉取恰一次且 afterId=锚 80（afterIds=${JSON.stringify(staleFetchAfterIds)}, ticks=${stub4._ticks.length}）`);
    ok(readMeta(dir2, 'exp-src', 'fourmeme').maxId === 83, 'Q5. STALE 合并后 meta.maxId=83');
  }

  console.log(`\n全部通过：${passed} 断言`);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

/** 参照期望 _ticks 形状（token_address + timestamp），供 C 段对拍 */
function expectRawTicks(sortedRows) {
  return sortedRows.map(r => ({ token_address: r.token_address, timestamp: new Date(r.block_time).getTime() }));
}
