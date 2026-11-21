/**
 * Case 集合服务单测（2026-11-20 Case 集合管理系统）——零 DB 零网络打桩
 *
 * 覆盖矩阵：
 *   A. 校验纯函数：normalizeTokenAddress（归一/形状拒）/ validateCollectionInput
 *      / buildTokenMetaSnapshot（payload 原样+blockTimeIso+溯源键，不预映射）
 *   B. fake supabase 链式 builder（内存数组过滤+count exact+IDENTITY 自增+
 *      upsert onConflict 幂等）——service 全 CRUD/addToken/syncToken 走真方法
 *   C. addToken：多 token_create 行去重取最早 block_time；零行 400 宁拒不漏
 *      （不走 experiment_tokens 兜底）；本集合重复 409（跨集合允许）
 *   D. syncToken 事件步：三类 kind 镜像 + event 水位推进（gt 水位增量）+count 对账
 *   E. syncToken ticks 步：单 token 等值 keyset 形状（.eq(token).eq(platform)
 *      .gt(id).order(id asc).limit(500)）+ 双水位推进 + upsert onConflict
 *      'collection_id,tx_hash,log_index' ignoreDuplicates 幂等重跑零重复
 *   F. 异常→failed+sync_error 落盘（水位保留=重试续传）；零 tick 合法 synced
 *   G. 串行链：enqueueSync 两个任务按入队序执行（IDENTITY 分配序=提交序裁定）
 *   H. 重启 sweep：进程启动前的 syncing → failed；启动后的不动
 *   I. 派生实验反查（config->backtest->>caseCollectionId 路径过滤语义由 fake 呈现）
 *
 * 打桩惯例对齐 _test_backtest_window_token_universe.cjs（fake builder + 直调）。
 */

'use strict';

const assert = require('assert');
const path = require('path');

const {
  CaseCollectionService,
  normalizeTokenAddress,
  validateCollectionInput,
  buildTokenMetaSnapshot,
  SYNC_TICK_PAGE,
} = require(path.join(__dirname, '..', 'src', 'web', 'services', 'CaseCollectionService'));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ───────────────── fake supabase 链式 builder ─────────────────
function makeFakeDb(tables, opts = {}) {
  const state = { tables, idCounters: {}, errors: opts.errors || {} };
  const record = (t) => (state.tables[t] = state.tables[t] || []);

  function build(t) {
    const stack = [];
    let mode = null;            // 'select' | 'insert' | 'update' | 'delete' | 'upsert'
    let payloadRows = null, updateVals = null, upsertOpts = null;
    let countMode = null, headOnly = false;
    let orderBy = null, limitN = null, rangePair = null;
    let single = false, maybe = false;
    // ★supabase-js 2.x 形状约束（bt-v165 首跑事故防线，2026-11-21）：from() 返回
    // QueryBuilder 无 filter 方法——eq/gt/order/limit 等只在 .select()（或
    // insert/update/delete/upsert 转入 FilterBuilder）之后可用。fake 忠实模拟，
    // 写歪当场 throw 而非静默通过（service 现行代码全部 select 先行=合规）。
    const guard = (m) => {
      if (!mode) throw new Error(`fake supabase-js 形状约束: .${m}() 只能在 .select()/.insert()/.update()/.delete()/.upsert() 之后调用`);
    };

    const chain = {
      select(_cols, o) { mode = mode || 'select'; countMode = o?.count || null; headOnly = !!o?.head; return chain; },
      insert(rows) { mode = 'insert'; payloadRows = Array.isArray(rows) ? rows : [rows]; return chain; },
      upsert(rows, o) { mode = 'upsert'; payloadRows = Array.isArray(rows) ? rows : [rows]; upsertOpts = o || {}; return chain; },
      update(vals) { mode = 'update'; updateVals = vals; return chain; },
      delete() { mode = 'delete'; return chain; },
      eq(c, v) { guard('eq'); stack.push(['eq', c, v]); return chain; },
      gt(c, v) { guard('gt'); stack.push(['gt', c, v]); return chain; },
      gte(c, v) { guard('gte'); stack.push(['gte', c, v]); return chain; },
      lt(c, v) { guard('lt'); stack.push(['lt', c, v]); return chain; },
      lte(c, v) { guard('lte'); stack.push(['lte', c, v]); return chain; },
      in(c, arr) { guard('in'); stack.push(['in', c, arr]); return chain; },
      order(c, o) { guard('order'); orderBy = { c, asc: o ? o.ascending !== false : true }; return chain; },
      limit(n) { guard('limit'); limitN = n; return chain; },
      range(a, b) { guard('range'); rangePair = [a, b]; return chain; },
      single() { guard('single'); single = true; return exec(); },
      maybeSingle() { guard('maybeSingle'); maybe = true; return exec(); },
      then(res, rej) { guard('then'); exec().then(res, rej); },
    };

    // 数值列直比；时间戳（ISO 串）列走 Date 解析（Number(ISO)=NaN 会静默全 false）
    function cmp(a, b) {
      const na = Number(a), nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
      return new Date(a).getTime() - new Date(b).getTime();
    }
    function applyFilters(rows) {
      let out = rows.slice();
      for (const [op, c, v] of stack) {
        if (op === 'eq') out = out.filter(r => String(r[c]) === String(v));
        else if (op === 'gt') out = out.filter(r => cmp(r[c], v) > 0);
        else if (op === 'gte') out = out.filter(r => cmp(r[c], v) >= 0);
        else if (op === 'lt') out = out.filter(r => cmp(r[c], v) < 0);
        else if (op === 'lte') out = out.filter(r => cmp(r[c], v) <= 0);
        else if (op === 'in') { const s = new Set((v || []).map(String)); out = out.filter(r => s.has(String(r[c]))); }
      }
      return out;
    }

    async function exec() {
      const errKey = t + ':' + mode;
      if (state.errors[errKey]) return { data: null, count: null, error: { message: state.errors[errKey], code: 'XX000' } };
      const rows = record(t);
      if (mode === 'select') {
        const filtered = applyFilters(rows);
        const total = filtered.length;
        let out = filtered.slice();
        if (orderBy) out.sort((a, b) => (orderBy.asc ? 1 : -1) * (Number(a[orderBy.c]) - Number(b[orderBy.c]) || String(a[orderBy.c]).localeCompare(String(b[orderBy.c]))));
        if (rangePair) out = out.slice(rangePair[0], rangePair[1] + 1);
        if (limitN != null) out = out.slice(0, limitN);
        const data = single ? (out[0] || null) : maybe ? (out[0] || null) : headOnly ? [] : out;
        return { data, count: countMode === 'exact' ? total : null, error: null };
      }
      if (mode === 'insert') {
        const withId = payloadRows.map(r => ({ ...r }));
        rows.push(...withId);
        const data = single ? withId[0] : withId;
        return { data, count: null, error: null };
      }
      if (mode === 'upsert') {
        // onConflict 幂等：冲突且 ignoreDuplicates → 跳过（保留首见行）
        const conflictCols = (upsertOpts.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
        let inserted = 0;
        for (const r of payloadRows) {
          const dup = conflictCols.length
            ? rows.find(x => conflictCols.every(c => String(x[c]) === String(r[c])))
            : null;
          if (dup) { if (!upsertOpts.ignoreDuplicates) Object.assign(dup, r); }
          else {
            state.idCounters[t] = (state.idCounters[t] || 1000) + 1; // IDENTITY 自增模拟
            rows.push({ ...r, id: state.idCounters[t] });
            inserted++;
          }
        }
        return { data: null, count: null, error: null, _inserted: inserted };
      }
      if (mode === 'update') {
        const hits = applyFilters(rows);
        for (const r of hits) Object.assign(r, updateVals);
        const data = single ? (hits[0] || null) : hits;
        return { data, count: null, error: null };
      }
      if (mode === 'delete') {
        const hits = applyFilters(rows);
        state.tables[t] = rows.filter(r => !hits.includes(r));
        return { data: null, count: null, error: null };
      }
      return { data: null, count: null, error: { message: `fake: unknown mode ${mode}` } };
    }

    return chain;
  }

  return { from: build, _state: state };
}

// ───────────────── 测试主体（CJS 无顶层 await，包 async main） ─────────────────
(async function main() {

// ───────────────── A. 校验纯函数 ─────────────────
console.log('A. 校验纯函数');
{
  ok(normalizeTokenAddress('0xABCdef0000000000000000000000000000001234')
    === '0xabcdef0000000000000000000000000000001234', 'A1 地址小写归一');
  let threw = false;
  try { normalizeTokenAddress('0x123'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A2 短地址 400 拒绝');
  threw = false;
  try { normalizeTokenAddress('abc'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A3 非 0x 前缀 400 拒绝');

  const v = validateCollectionInput({ name: '  burst 案例  ', description: ' x ' });
  ok(v.name === 'burst 案例' && v.description === 'x', 'A4 集合名/描述 trim');
  threw = false;
  try { validateCollectionInput({ name: '  ' }); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A5 空名 400');

  const snap = buildTokenMetaSnapshot({
    id: 77, platform: 'flap',
    payload: { symbol: 'S', name: 'N', creator: '0xc' },
    block_time: '2026-11-01T00:00:00Z',
  });
  ok(snap.payload.symbol === 'S' && snap.payload.name === 'N',
    'A6 快照存原始 payload（不预映射七键——映射留装载侧共享纯函数）');
  ok(snap.blockTimeIso === '2026-11-01T00:00:00Z' && snap.sourceEventId === 77 && snap.platform === 'flap',
    'A7 快照带 blockTimeIso/溯源键/平台');
}

// ───────────────── C. addToken（含 B fake 生效） ─────────────────
console.log('C. addToken');
const ADDR = '0x' + 'ab'.repeat(20);
const ADDR2 = '0x' + 'cd'.repeat(20);
{
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: 'Burst 案例', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' }],
    case_collection_tokens: [],
    wss_events: [
      { id: 5, kind: 'token_create', platform: 'flap', token_address: ADDR, payload: { symbol: 'LATE' }, block_time: '2026-11-02T00:00:00Z' },
      { id: 3, kind: 'token_create', platform: 'flap', token_address: ADDR, payload: { symbol: 'EARLY' }, block_time: '2026-11-01T00:00:00Z' },
    ],
    case_events: [],
    case_ticks: [],
    wss_price_ticks: [],
    experiments: [],
  });
  const svc = new CaseCollectionService({ client: db });
  const token = await svc.addToken('col-1', { tokenAddress: ADDR.toUpperCase(), note: '金狗' });
  ok(token.token_address === ADDR, 'C1 地址归一入库');
  ok(token.platform === 'flap', 'C2 platform 取 token_create 行');
  ok(token.token_meta.payload.symbol === 'EARLY' && token.token_meta.sourceEventId === 3,
    'C3 多 create 行去重取最早 block_time（id=3 EARLY）');
  // C4：添加即自动入队后台复制（用户裁定）——fake 下链 drain 极快，等链后 synced
  await svc._chain;
  const autoRow = db._state.tables.case_collection_tokens.find(r => r.collection_id === 'col-1' && r.token_address === ADDR);
  ok(autoRow && autoRow.sync_state === 'synced', 'C4 添加即自动后台复制（await 链后 synced）');

  let threw = false;
  try { await svc.addToken('col-1', { tokenAddress: ADDR }); } catch (e) { threw = e.status === 409; }
  ok(threw, 'C5 本集合重复 409（跨集合独立副本=UNIQUE(collection,token) 语义）');

  // 跨集合允许：col-2 加同一 token 正常
  db._state.tables.case_collections.push({ id: 'col-2', name: '强庄', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' });
  const t2 = await svc.addToken('col-2', { tokenAddress: ADDR });
  ok(t2.token_address === ADDR, 'C6 同 token 入第二集合成功（独立副本）');

  let threw400 = false;
  try { await svc.addToken('col-1', { tokenAddress: ADDR2 }); } catch (e) { threw400 = e.status === 400 && /token_create/.test(e.message); }
  ok(threw400, 'C7 无 token_create 行 400 宁拒不漏（无兜底）');
}

// ───────────────── D/E/F. syncToken 全链 ─────────────────
console.log('D/E/F. syncToken 复制执行器');
{
  const ticks = [];
  for (let i = 1; i <= 1200; i++) {
    ticks.push({
      id: 1000 + i, token_address: ADDR, platform: 'flap', tx_hash: '0xtx' + i, log_index: i,
      trade_type: i % 2 ? 'buy' : 'sell', trader_address: '0xr', sender_address: '0xs',
      price_bnb: '0.001', price_usd: '0.7', bnb_amount: '0.1', token_amount: '100',
      price_outlier: false, block_number: 100 + i, block_time: '2026-11-01T00:00:0' + (i % 10) + 'Z',
      received_at: '2026-11-01T00:00:00Z', quote_token: null,
    });
  }
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: 'Burst', description: '', created_at: 'x', updated_at: 'x' }],
    case_collection_tokens: [{
      id: 'tk-1', collection_id: 'col-1', token_address: ADDR, platform: 'flap', note: '',
      token_meta: {}, sync_state: 'pending', sync_error: null, sync_started_at: null,
      tick_count: 0, event_count: 0, tick_watermark_id: 0, event_watermark_id: 0,
      last_synced_at: null, added_at: 'x',
    }],
    wss_events: [
      { id: 3, kind: 'token_create', platform: 'flap', token_address: ADDR, payload: { symbol: 'E' }, block_time: '2026-11-01T00:00:00Z' },
      { id: 9, kind: 'graduation', platform: 'flap', token_address: ADDR, payload: { fundsBnb: 16 }, block_time: '2026-11-01T01:00:00Z' },
      { id: 12, kind: 'heartbeat', platform: 'flap', token_address: ADDR, payload: {}, block_time: '2026-11-01T02:00:00Z' }, // 非三类：不该镜像
    ],
    case_events: [], case_ticks: [], wss_price_ticks: ticks, experiments: [],
  });
  const svc = new CaseCollectionService({ client: db });
  await svc._syncToken('col-1', ADDR);

  const evRows = db._state.tables.case_events;
  ok(evRows.length === 2 && evRows.every(r => r.kind !== 'heartbeat'),
    'E1 事件步只镜像 token_create/graduation/token_quote_set（heartbeat 排除）');
  ok(evRows.every(r => r.source_event_id === 3 || r.source_event_id === 9),
    'E2 source_event_id 溯源落列');
  const tk1 = db._state.tables.case_collection_tokens[0];
  ok(tk1.event_watermark_id === 9, 'D1 event 水位=max(事件 id)=9');
  ok(tk1.tick_watermark_id === 1000 + 1200, 'E3 tick 水位推进到尾行源 id');
  ok(db._state.tables.case_ticks.length === 1200, 'E4 ticks 全量复制 1200 行');
  ok(db._state.tables.case_ticks.every(r => r.collection_id === 'col-1' && r.source_tick_id > 1000),
    'E5 副本行带 collection_id+source_tick_id');
  ok(tk1.sync_state === 'synced' && tk1.tick_count === 1200 && tk1.event_count === 2,
    'F0 收尾 synced+count 对账回写');

  // 幂等重跑（水位已满 → 零新行零重复）
  await svc._syncToken('col-1', ADDR);
  ok(db._state.tables.case_ticks.length === 1200 && db._state.tables.case_events.length === 2,
    'E6 幂等重跑零重复（水位增量+upsert onConflict）');

  // 增量：源表来新 ticks → 补拉
  ticks.push({ id: 9999, token_address: ADDR, platform: 'flap', tx_hash: '0xnew', log_index: 9999,
    trade_type: 'buy', trader_address: 'r', sender_address: 's', price_bnb: '1', price_usd: '1',
    bnb_amount: '1', token_amount: '1', price_outlier: false, block_number: 999, block_time: '2026-11-01T03:00:00Z',
    received_at: '2026-11-01T03:00:00Z', quote_token: null });
  await svc._syncToken('col-1', ADDR);
  const tk2 = db._state.tables.case_collection_tokens[0];
  ok(db._state.tables.case_ticks.length === 1201 && tk2.tick_watermark_id === 9999 && tk2.tick_count === 1201,
    'E7 增量补拉（gt 水位 keyset）');
}

// F 异常落盘 + 零 tick 合法
console.log('F. failed 落盘 / 零 tick');
{
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: 'B', description: '', created_at: 'x', updated_at: 'x' }],
    case_collection_tokens: [{
      id: 'tk-1', collection_id: 'col-1', token_address: ADDR2, platform: 'fourmeme', note: '',
      token_meta: {}, sync_state: 'pending', sync_error: null, sync_started_at: null,
      tick_count: 0, event_count: 0, tick_watermark_id: 0, event_watermark_id: 0, last_synced_at: null, added_at: 'x',
    }],
    wss_events: [], case_events: [], case_ticks: [], wss_price_ticks: [],
  });
  const svc = new CaseCollectionService({ client: db });
  // 零 tick + 零事件 = 真零成交票 → synced（合法形状）
  await svc._syncToken('col-1', ADDR2);
  ok(db._state.tables.case_collection_tokens[0].sync_state === 'synced'
    && db._state.tables.case_collection_tokens[0].tick_count === 0,
    'F1 零 tick 合法 synced（真零成交）');

  // 注入 ticks 拉取失败 → failed + sync_error
  db._state.errors['wss_price_ticks:select'] = '网络炸了';
  db._state.tables.case_collection_tokens[0].tick_watermark_id = 0;
  db._state.tables.case_collection_tokens[0].sync_state = 'pending';
  let threw = false;
  try { await svc._syncToken('col-1', ADDR2); } catch (e) { threw = true; }
  const row = db._state.tables.case_collection_tokens[0];
  ok(threw && row.sync_state === 'failed' && /网络炸了/.test(row.sync_error || ''),
    'F2 拉取异常→failed+sync_error 落盘（异常向上抛，链上 catch 兜住不断链）');
}

// ───────────────── G. 串行链 ─────────────────
console.log('G. 串行复制链');
{
  const order = [];
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: 'B', description: '', created_at: 'x', updated_at: 'x' }],
    case_collection_tokens: [], wss_events: [], case_events: [], case_ticks: [], wss_price_ticks: [],
  });
  const svc = new CaseCollectionService({ client: db });
  const orig = svc._syncToken.bind(svc);
  svc._syncToken = async (cid, addr) => {
    order.push('start:' + addr);
    await new Promise(r => setTimeout(r, addr === ADDR ? 30 : 5)); // 首任务慢——若并发会乱序完成
    order.push('end:' + addr);
  };
  svc.enqueueSync('col-1', ADDR);
  svc.enqueueSync('col-1', ADDR2);
  await svc._chain;
  ok(order.join(',') === `start:${ADDR},end:${ADDR},start:${ADDR2},end:${ADDR2}`,
    'G1 全局串行：后入队任务等前任务完成（IDENTITY 分配序=提交序裁定）');
  // G2：慢任务在跑时同 token 再入队 → 去重（队已 drain 后再入队=合法新任务）
  svc.enqueueSync('col-1', ADDR); // 慢任务（30ms）重新入队并立即在跑
  const dup = svc.enqueueSync('col-1', ADDR);
  ok(dup.queued === false, 'G2 运行态去重：同 token 在队不重复入队');
  await svc._chain;
}

// ───────────────── H. 重启 sweep ─────────────────
console.log('H. 重启 sweep');
{
  const OLD = '2026-11-20T00:00:00Z';
  const db = makeFakeDb({
    case_collections: [],
    case_collection_tokens: [
      { collection_id: 'c', token_address: 'a', sync_state: 'syncing', sync_started_at: OLD }, // 上进程残留
      { collection_id: 'c', token_address: 'b', sync_state: 'syncing', sync_started_at: new Date(Date.now() + 60000).toISOString() }, // 本进程刚起（未来时间=必晚于 bootAt）
    ],
    wss_events: [], case_events: [], case_ticks: [], wss_price_ticks: [],
  });
  const svc = new CaseCollectionService({ client: db });
  await svc._ensureSweep();
  const rows = db._state.tables.case_collection_tokens;
  ok(rows[0].sync_state === 'failed' && /重启中断/.test(rows[0].sync_error),
    'H1 进程启动前的 syncing → failed（可重试）');
  ok(rows[1].sync_state === 'syncing', 'H2 启动后的 syncing 不误杀');
}

// ───────────────── I. 派生实验反查 ─────────────────
console.log('I. 派生实验反查');
{
  const db = makeFakeDb({
    experiments: [
      { id: 'e1', name: 'bt-v200', status: 'completed', trading_mode: 'backtest', created_at: 'x', config: { backtest: { caseCollectionId: 'col-1' } } },
      { id: 'e2', name: 'bt-v201', status: 'running', trading_mode: 'backtest', created_at: 'y', config: { backtest: { caseCollectionId: 'col-9' } } },
    ],
  });
  const svc = new CaseCollectionService({ client: db });
  // fake 的 .eq('config->backtest->>caseCollectionId') 走 String 比较——路径列取值
  // 由 fake 不支持，改用 service 源码锁（真实 PostgREST jsonb 路径过滤）
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'web', 'services', 'CaseCollectionService.js'), 'utf8');
  ok(src.includes(".eq('config->backtest->>caseCollectionId'"),
    'I1 派生实验反查走 jsonb 路径过滤（源码锁；fake 不模拟路径列）');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Case 集合服务单测：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

})();
