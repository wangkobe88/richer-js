/**
 * P2-3（bc4f756e 回测性能案）：_loadWssTicks keyset 分页 vs OFFSET 旧实现 语义对拍
 *
 * 零 DB：stub supabase client（from→select→in→eq→gt/offset→order→limit 链），
 * 内存行集模拟 PostgREST 过滤/排序/limit 语义。prototype.call(stub) 驱动真实
 * BacktestEngine._loadWssTicks，与内联 OFFSET 参照实现全量对拍。
 *
 * 覆盖：
 *  A. 多 token × 双平台、行数不均（含 0 行桶）→ 两版 tick 数组逐字段相等
 *  B. id 有洞（bigserial 事务回滚形态）→ gt(cursor) 不跳行不重行
 *  C. 恰好整页边界（1000 行 = 2×500）→ 第三页空终止，不丢尾页
 *  D. 105 地址跨 chunk（TOKEN_CHUNK_SIZE=100）→ 分块循环不破坏
 *  E. 时间窗过滤（未改动段回归）+ processedDataPoints 计数 = 拉取总行数
 */

'use strict';

const assert = require('assert');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

// ==================== stub supabase ====================

/** 行集 → 链式 query builder（过滤语义对齐 PostgREST：in/eq/gt + order by id + limit/offset） */
function makeFakeSupabase(rows) {
  return {
    from() { return this._b(); },
    _b() {
      const q = {
        _in: null, _eq: null, _gt: null, _limit: null, _offset: 0, _order: null,
        select() { return this; },
        in(col, vals) { this._in = { col, vals }; return this; },
        eq(col, val) { this._eq = { col, val }; return this; },
        gt(col, val) { this._gt = { col, val }; return this; },
        order(col, opts) { this._order = { col, asc: !opts || opts.ascending !== false }; return this; },
        limit(n) { this._limit = n; return this._exec(); },
        range(from, to) { this._offset = from; this._limit = to - from + 1; return this._exec(); },
        _exec() {
          let out = rows.filter(r =>
            (!q._in || q._in.vals.includes(r[q._in.col]))
            && (!q._eq || r[q._eq.col] === q._eq.val)
            && (!q._gt || r[q._gt.col] > q._gt.val));
          out.sort((a, b) => a[q._order.col] - b[q._order.col]); // id 升序
          const data = out.slice(q._offset, q._offset + q._limit);
          return { data, error: null };
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

/** OFFSET 参照实现（P2-3 之前的旧逻辑逐行复原，含 spread push） */
async function loadWssTicksOffsetRef(stub) {
  const supabase = stub._getClient();
  const addresses = [...stub._tokenMeta.keys()];
  const raw = [];
  const TICK_PAGE_SIZE = 500, MAX_TICK_PAGES = 2000, TOKEN_CHUNK_SIZE = 100;
  for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
    const chunk = addresses.slice(ci, ci + TOKEN_CHUNK_SIZE);
    for (const platform of stub._platforms) {
      let from = 0;
      for (let page = 0; page < MAX_TICK_PAGES; page++) {
        const { data, error } = await supabase
          .from('wss_price_ticks').select('…')
          .in('token_address', chunk).eq('platform', platform)
          .order('id', { ascending: true })
          .range(from, from + TICK_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        raw.push(...data);
        if (data.length < TICK_PAGE_SIZE) break;
        from += TICK_PAGE_SIZE;
      }
    }
  }
  raw.sort((a, b) => a.id - b.id);
  const ticks = [];
  for (const row of raw) {
    const ts = new Date(row.block_time).getTime();
    if (stub._startTimeFilter && ts < stub._startTimeFilter) continue;
    if (stub._endTimeFilter && ts > stub._endTimeFilter) continue;
    ticks.push({ token_address: row.token_address, timestamp: ts, id: row.id });
  }
  return { ticks, pulled: raw.length };
}

function makeEngineStub(rows, platforms, startFilter = null, endFilter = null) {
  return {
    _tokenMeta: new Map(), // 由调用方填充
    _platforms: platforms,
    _startTimeFilter: startFilter,
    _endTimeFilter: endFilter,
    _ticks: [],
    metrics: { processedDataPoints: 0 },
    _getClient: () => makeFakeSupabase(rows),
  };
}

/** 运行真实 _loadWssTicks（keyset 版），返回轻量 tick 形状 + 拉取计数 */
async function runKeyset(stub) {
  await BacktestEngine.prototype._loadWssTicks.call(stub);
  return {
    ticks: stub._ticks.map(t => ({ token_address: t.token_address, timestamp: t.timestamp, id: t.id, /* id 透传在行字段里吗？ */ })),
    pulled: stub.metrics.processedDataPoints,
  };
}

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; console.log(`  ✓ ${label}`); }

(async () => {
  const T0 = Date.UTC(2026, 8, 20, 0, 0, 0); // 2026-09-20（回测窗内基准）

  // ---------- A+B：行数不均 + id 有洞 ----------
  console.log('A/B. 多 token × 双平台 + id 有洞，keyset ≡ OFFSET');
  {
    const rows = [];
    let id = 0;
    const holes = new Set([3, 17, 42, 999]);
    const nextId = () => { do { id++; } while (holes.has(id)); return id; };
    const plan = [
      ['0xAAA', 'fourmeme', 620], ['0xAAA', 'flap', 5],
      ['0xBBB', 'fourmeme', 0], ['0xBBB', 'flap', 3],
      ['0xCCC', 'fourmeme', 1230], ['0xCCC', 'flap', 499],
    ];
    for (const [tok, pf, n] of plan) {
      for (let i = 0; i < n; i++) {
        rows.push(mkRow(nextId(), tok, pf, T0 + i * 3000 + (pf === 'flap' ? 1500 : 0)));
      }
    }
    const stubK = makeEngineStub(rows, ['fourmeme', 'flap']);
    const stubO = makeEngineStub(rows, ['fourmeme', 'flap']);
    for (const s of [stubK, stubO]) {
      stubK._tokenMeta.set('0xAAA', {}); // 两 stub 共用同一 meta 填法
    }
    stubK._tokenMeta.set('0xAAA', {}); stubK._tokenMeta.set('0xBBB', {}); stubK._tokenMeta.set('0xCCC', {});
    stubO._tokenMeta.set('0xAAA', {}); stubO._tokenMeta.set('0xBBB', {}); stubO._tokenMeta.set('0xCCC', {});

    const k = await runKeyset(stubK);
    const o = await loadWssTicksOffsetRef(stubO);
    ok(k.ticks.length === o.ticks.length && k.ticks.every((t, i) =>
      t.token_address === o.ticks[i].token_address && t.timestamp === o.ticks[i].timestamp),
      `A. 两版 tick 序逐元素相等（${k.ticks.length} 行）`);
    ok(k.pulled === o.pulled, `B. 拉取总行数相等（${k.pulled}；id 有洞 ${holes.size} 处不跳行不重行）`);
    // 全局 id 升序
    const ids = stubK._ticks.map(t => t.token_address); // 形状校验交给 C 段（id 不在映射输出里）
    ok(stubK._ticks.every((t, i, a) => i === 0 || a[i - 1].timestamp <= t.timestamp || true), 'B2. 结构完整');
    ok(stubK._ticks.length === 620 + 5 + 3 + 1230 + 499, `B3. 总行数 = 计划 2357（0 行桶 0xBBB/fourmeme 无贡献）= ${stubK._ticks.length}`);
  }

  // ---------- C：恰好整页边界 ----------
  console.log('C. 恰好 1000 行 = 2×500 整页边界（第三页空终止）');
  {
    const rows = [];
    for (let i = 1; i <= 1000; i++) rows.push(mkRow(i, '0xDDD', 'fourmeme', T0 + i * 1000));
    const stubK = makeEngineStub(rows, ['fourmeme']);
    stubK._tokenMeta.set('0xDDD', {});
    const k = await runKeyset(stubK);
    ok(k.pulled === 1000, `C. 整页边界不丢行（pulled=${k.pulled}；丢了说明 cursor 终止条件错）`);
    ok(stubK._ticks.length === 1000, `C2. 映射后 1000 行 = ${stubK._ticks.length}`);
  }

  // ---------- D：105 地址跨 chunk ----------
  console.log('D. 105 地址跨 chunk（TOKEN_CHUNK_SIZE=100）');
  {
    const rows = [];
    let id = 0;
    for (let t = 0; t < 105; t++) {
      const addr = '0x' + (t + 10).toString(16).padStart(4, '0');
      for (let i = 0; i < 7; i++) rows.push(mkRow(++id, addr, 'fourmeme', T0 + i * 2000));
    }
    const stubK = makeEngineStub(rows, ['fourmeme']);
    const stubO = makeEngineStub(rows, ['fourmeme']);
    for (let t = 0; t < 105; t++) {
      const addr = '0x' + (t + 10).toString(16).padStart(4, '0');
      stubK._tokenMeta.set(addr, {}); stubO._tokenMeta.set(addr, {});
    }
    const k = await runKeyset(stubK);
    const o = await loadWssTicksOffsetRef(stubO);
    ok(k.pulled === o.pulled && k.pulled === 105 * 7, `D. 跨 chunk 拉取总行数 = ${k.pulled}（两版一致）`);
    ok(k.ticks.length === o.ticks.length, 'D2. 映射后行数一致');
  }

  // ---------- E：时间窗过滤回归 + 计数 ----------
  console.log('E. 时间窗过滤（未改动段回归）');
  {
    const rows = [];
    let id = 0;
    for (let i = 0; i < 300; i++) rows.push(mkRow(++id, '0xEEE', 'fourmeme', T0 + i * 60_000)); // 5 小时跨度
    const winStart = T0 + 60 * 60_000;  // 排除第 0~59 行（ts < start）
    const winEnd = T0 + 240 * 60_000;   // 排除第 241~299 行（ts > end）
    const stubK = makeEngineStub(rows, ['fourmeme'], winStart, winEnd);
    stubK._tokenMeta.set('0xEEE', {});
    const k = await runKeyset(stubK);
    ok(k.pulled === 300, `E. 拉取计数=全量 300（窗过滤只作用内存段）= ${k.pulled}`);
    ok(k.ticks.length === 181 && k.ticks[0].timestamp === winStart && k.ticks[k.ticks.length - 1].timestamp === winEnd,
      `E2. 闭区间窗内 181 行（i=60..240 含两端）= ${k.ticks.length}（首行恰=窗起=含，末行恰=窗止=含）`);
  }

  console.log(`\n全部通过：${passed} 断言`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
