/**
 * Case 代币标签机制单测（2026-11-25）——零 DB 零网络打桩
 *
 * 覆盖矩阵：
 *   A. 校验纯函数：normalizeTag（trim/空/超长 40 上限/恰好 40/控制字符/非字符串）
 *      + normalizeTags（逗号分隔字符串→数组/去重保序/非法元素 400）
 *   B. addTokenTag：幂等（重复加不增行）/地址大写归一/返回最新标签列表
 *   C. removeTokenTag：删除成功/不存在 404 fail-loud
 *   D. listTags：全局聚合计数（同标签跨票）/按计数降序
 *   E. findTokensByTag：命中代币+所在集合（name/syncState/note）/孤儿标签
 *      代币 collections=[]（未入集合标签可见）
 *   F. getCollectionTags：只取本集合成员标签（别集合同标签票不混入）/
 *      计数与 tokenTags 分组/地址批 .in 50 跨批循环
 *   G. addToken 带 tags：初始标签落库/先标签后代币（本集合重复 409 时标签
 *      语义仍正确=标签不随代币行失败回滚）/非法 tag 400 且代币行不落
 *
 * 打桩惯例对齐 _test_case_collections_service.cjs（fake supabase builder + 直调）。
 */

'use strict';

const assert = require('assert');
const path = require('path');

const {
  CaseCollectionService,
  normalizeTag,
  normalizeTags,
  TAG_MAX_LEN,
  TAG_ADDR_BATCH,
} = require(path.join(__dirname, '..', 'src', 'web', 'services', 'CaseCollectionService'));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}
function eq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label}（got ${JSON.stringify(actual)}）`);
}

// ───────────────── fake supabase 链式 builder（对齐 case_collections 单测，
// 增补：insert/upsert 行缺 created_at 补 now()=真库 DEFAULT now() 模拟） ─────────────────
function makeFakeDb(tables, opts = {}) {
  const state = { tables, idCounters: {}, errors: opts.errors || {} };
  const record = (t) => (state.tables[t] = state.tables[t] || []);

  function build(t) {
    const stack = [];
    let mode = null;
    let payloadRows = null, updateVals = null, upsertOpts = null;
    let countMode = null, headOnly = false;
    let orderBy = null, limitN = null, rangePair = null;
    let single = false, maybe = false;
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
        if (orderBy) out.sort((a, b) => (orderBy.asc ? 1 : -1) * (cmp(a[orderBy.c], b[orderBy.c])));
        if (rangePair) out = out.slice(rangePair[0], rangePair[1] + 1);
        if (limitN != null) out = out.slice(0, limitN);
        const data = single ? (out[0] || null) : maybe ? (out[0] || null) : headOnly ? [] : out;
        return { data, count: countMode === 'exact' ? total : null, error: null };
      }
      if (mode === 'insert') {
        const withId = payloadRows.map(r => ({
          ...r,
          created_at: r.created_at || new Date().toISOString(), // 真库 DEFAULT now()
        }));
        rows.push(...withId);
        const data = single ? withId[0] : withId;
        return { data, count: null, error: null };
      }
      if (mode === 'upsert') {
        const conflictCols = (upsertOpts.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
        let inserted = 0;
        for (const r of payloadRows) {
          const dup = conflictCols.length
            ? rows.find(x => conflictCols.every(c => String(x[c]) === String(r[c])))
            : null;
          if (dup) { if (!upsertOpts.ignoreDuplicates) Object.assign(dup, r); }
          else {
            state.idCounters[t] = (state.idCounters[t] || 1000) + 1;
            rows.push({ ...r, id: state.idCounters[t], created_at: r.created_at || new Date().toISOString() });
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

function addr(seed, n = 40) {
  const hex = String(seed).padStart(n, '0').slice(0, n);
  return '0x' + hex.toLowerCase();
}

// ───────────────── 测试主体（CJS 无顶层 await，包 async main） ─────────────────
(async function main() {

// ───────────────── A. 校验纯函数 ─────────────────
console.log('A. 校验纯函数');
{
  eq(normalizeTag('  强庄  '), '强庄', 'A1 trim 归一');
  let threw = false;
  try { normalizeTag('   '); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A2 空白标签 400');
  threw = false;
  try { normalizeTag(''); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A3 空串 400');
  threw = false;
  try { normalizeTag(123); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A4 非字符串 400');
  threw = false;
  try { normalizeTag('x'.repeat(TAG_MAX_LEN + 1)); } catch (e) { threw = e.status === 400; }
  ok(threw, `A5 超长（>${TAG_MAX_LEN}）400`);
  eq(normalizeTag('x'.repeat(TAG_MAX_LEN)), 'x'.repeat(TAG_MAX_LEN), 'A6 恰好上限通过');
  threw = false;
  try { normalizeTag('强庄\n盘'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A7 控制字符 400（防 UI 注入混乱）');

  eq(normalizeTags([' a ', 'b', ' a ', ' c ']), ['a', 'b', 'c'], 'A8 数组去重保序');
  eq(normalizeTags(' 强庄, 慢热 , 强庄 '), ['强庄', '慢热'], 'A9 逗号分隔字符串→数组+去重');
  eq(normalizeTags([]), [], 'A10 空数组=空列表');
  eq(normalizeTags(''), [], 'A10b 空字符串=空列表（无标签意图≠非法元素）');
  eq(normalizeTags('   '), [], 'A10c 纯空白字符串=空列表');
  threw = false;
  try { normalizeTags(['ok', '  ']); } catch (e) { threw = e.status === 400; }
  ok(threw, 'A11 数组内非法元素 400（整体拒绝，不部分落库）');
}

// ───────────────── B. addTokenTag 幂等 + 归一 ─────────────────
console.log('B. addTokenTag');
const T1 = addr('ab');
{
  const db = makeFakeDb({ case_token_tags: [], case_collections: [], case_collection_tokens: [] });
  const svc = new CaseCollectionService({ client: db });
  const r1 = await svc.addTokenTag(T1.toUpperCase(), { tag: ' 强庄 ' });
  eq(r1.tags, ['强庄'], 'B1 添加返回最新列表（trim）');
  ok(db._state.tables.case_token_tags[0].token_address === T1,
    'B2 地址大写归一入库');
  const r2 = await svc.addTokenTag(T1, { tag: '强庄' });
  ok(r2.tags.length === 1 && db._state.tables.case_token_tags.length === 1,
    'B3 重复添加幂等（PK 冲突 ignoreDuplicates 不增行）');
  await svc.addTokenTag(T1, { tag: '慢热' });
  eq((await svc.getTagsForToken(T1)), ['强庄', '慢热'], 'B4 多标签 + 列表（created_at 升序）');
}

// ───────────────── C. removeTokenTag ─────────────────
console.log('C. removeTokenTag');
{
  const db = makeFakeDb({ case_token_tags: [
    { token_address: T1, tag: '强庄', created_at: '2026-11-25T00:00:00Z' },
    { token_address: T1, tag: '慢热', created_at: '2026-11-25T00:00:01Z' },
  ], case_collections: [], case_collection_tokens: [] });
  const svc = new CaseCollectionService({ client: db });
  const r = await svc.removeTokenTag(T1, '强庄');
  eq(r.tags, ['慢热'], 'C1 删除成功返回剩余列表');
  ok(db._state.tables.case_token_tags.length === 1, 'C2 行已删');
  let threw = false;
  try { await svc.removeTokenTag(T1, '强庄'); } catch (e) { threw = e.status === 404; }
  ok(threw, 'C3 删除不存在标签 404 fail-loud（防前端状态漂移掩盖问题）');
  threw = false;
  try { await svc.removeTokenTag('0x123', '强庄'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'C4 地址形状非法 400（与标签 404 分流）');
}

// ───────────────── D. listTags 全局聚合 ─────────────────
console.log('D. listTags');
{
  const T2 = addr('cd');
  const db = makeFakeDb({ case_token_tags: [
    { token_address: T1, tag: '强庄', created_at: '2026-11-25T00:00:00Z' },
    { token_address: T2, tag: '强庄', created_at: '2026-11-25T00:00:01Z' },
    { token_address: T1, tag: '慢热', created_at: '2026-11-25T00:00:02Z' },
  ], case_collections: [], case_collection_tokens: [] });
  const svc = new CaseCollectionService({ client: db });
  const tags = await svc.listTags();
  eq(tags, [{ tag: '强庄', tokenCount: 2 }, { tag: '慢热', tokenCount: 1 }],
    'D1 跨票聚合计数 + 降序');
}

// ───────────────── E. findTokensByTag 按标签查询 ─────────────────
console.log('E. findTokensByTag');
{
  const T2 = addr('cd');
  const db = makeFakeDb({
    case_token_tags: [
      { token_address: T1, tag: '强庄', created_at: '2026-11-25T00:00:00Z' },
      { token_address: T2, tag: '强庄', created_at: '2026-11-25T00:00:01Z' },
    ],
    case_collections: [
      { id: 'col-1', name: '金狗集合', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' },
    ],
    case_collection_tokens: [
      { collection_id: 'col-1', token_address: T1, note: 'LAB 案源', sync_state: 'synced' },
    ],
  });
  const svc = new CaseCollectionService({ client: db });
  const r = await svc.findTokensByTag(' 强庄 ');
  eq(r.tag, '强庄', 'E1 tag 归一');
  ok(r.tokens.length === 2, 'E2 命中全部带标签代币');
  const t1 = r.tokens.find(t => t.tokenAddress === T1);
  eq(t1.collections, [{ collectionId: 'col-1', collectionName: '金狗集合', syncState: 'synced', note: 'LAB 案源' }],
    'E3 成员归属（集合名/sync/note）');
  const t2 = r.tokens.find(t => t.tokenAddress === T2);
  eq(t2.collections, [], 'E4 未入集合代币 collections=[]（孤儿标签可见）');
  const none = await svc.findTokensByTag('不存在标签');
  ok(none.tokens.length === 0, 'E5 无命中=空列表（非错误）');
}

// ───────────────── F. getCollectionTags 集合内标签 ─────────────────
console.log('F. getCollectionTags');
{
  const T2 = addr('cd');
  const db = makeFakeDb({
    case_collections: [
      { id: 'col-1', name: '集合一', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' },
    ],
    case_collection_tokens: [
      { collection_id: 'col-1', token_address: T1 },
      { collection_id: 'col-1', token_address: T2 },
    ],
    case_token_tags: [
      { token_address: T1, tag: '强庄', created_at: '2026-11-25T00:00:00Z' },
      { token_address: T1, tag: '慢热', created_at: '2026-11-25T00:00:01Z' },
      { token_address: T2, tag: '强庄', created_at: '2026-11-25T00:00:02Z' },
      { token_address: addr('ef'), tag: '强庄', created_at: '2026-11-25T00:00:03Z' }, // 非本集合票
      { token_address: addr('ef'), tag: '独舞', created_at: '2026-11-25T00:00:04Z' },
    ],
  });
  const svc = new CaseCollectionService({ client: db });
  const r = await svc.getCollectionTags('col-1');
  eq(r.tags, [{ tag: '强庄', count: 2 }, { tag: '慢热', count: 1 }],
    'F1 只聚合本集合成员标签（别集合同标签票不混入）');
  eq(r.tokenTags[T1], ['强庄', '慢热'], 'F2 tokenTags 分组');
  eq(r.tokenTags[T2], ['强庄'], 'F3 tokenTags 分组');
  ok(!r.tokenTags[addr('ef')], 'F4 非成员票不出现在 tokenTags');
}

// ───────────────── F2. 地址批 .in 50 跨批循环 ─────────────────
console.log('F2. 地址批 .in 50 跨批循环');
{
  const addrs = [];
  for (let i = 0; i < TAG_ADDR_BATCH * 2 + 7; i++) addrs.push(addr(i.toString(16), 40));
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: '集合一', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' }],
    case_collection_tokens: addrs.map(a => ({ collection_id: 'col-1', token_address: a })),
    case_token_tags: addrs.map((a, i) => ({ token_address: a, tag: i < TAG_ADDR_BATCH + 1 ? '强庄' : '慢热', created_at: '2026-11-25T00:00:00Z' })),
  });
  const svc = new CaseCollectionService({ client: db });
  const r = await svc.getCollectionTags('col-1');
  ok(r.tags.some(t => t.tag === '强庄' && t.count === TAG_ADDR_BATCH + 1)
    && r.tags.some(t => t.tag === '慢热' && t.count === addrs.length - TAG_ADDR_BATCH - 1),
    'F2-1 跨批（>50 地址）聚合计数正确（分批 .in 无漏）');
  ok(Object.keys(r.tokenTags).length === addrs.length, 'F2-2 全部成员 tokenTags 覆盖');
}

// ───────────────── G. addToken 带 tags ─────────────────
console.log('G. addToken 带 tags');
const T3 = addr('12');
{
  const db = makeFakeDb({
    case_collections: [{ id: 'col-1', name: '集合一', description: '', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' }],
    case_collection_tokens: [],
    case_token_tags: [],
    wss_events: [
      { id: 1, kind: 'token_create', platform: 'fourmeme', token_address: T3, payload: { symbol: 'S' }, block_time: '2026-11-24T00:00:00Z' },
    ],
    case_events: [],
    case_ticks: [],
    wss_price_ticks: [],
    experiments: [],
  });
  const svc = new CaseCollectionService({ client: db });
  const token = await svc.addToken('col-1', { tokenAddress: T3, note: '', tags: ' 强庄, 慢热, 强庄 ' });
  await svc._chain;
  ok(token.token_address === T3, 'G1 代币入库');
  eq(db._state.tables.case_token_tags.map(r => r.tag).sort(), ['强庄', '慢热'],
    'G2 初始标签落库（逗号串+去重）');

  // 先标签后代币：本集合重复 409 时标签语义仍正确（标签不挂 FK 可独立存在）
  const T4 = addr('34');
  db._state.tables.wss_events.push(
    { id: 2, kind: 'token_create', platform: 'fourmeme', token_address: T4, payload: {}, block_time: '2026-11-24T00:00:00Z' });
  await svc.addToken('col-1', { tokenAddress: T4, tags: ['首打标签'] });
  await svc._chain;
  let threw = false;
  try { await svc.addToken('col-1', { tokenAddress: T4, tags: ['新标签'] }); } catch (e) { threw = e.status === 409; }
  ok(threw, 'G3 本集合重复 409');
  const t4Tags = db._state.tables.case_token_tags.filter(r => r.token_address === T4).map(r => r.tag);
  eq(t4Tags.sort(), ['新标签', '首打标签'],
    'G4 标签先于 dup 检查落库（409 前已写入——用户补标签意图不因成员行失败丢失）');

  // 非法 tag：整体 400，代币行不落
  let thrown400 = false;
  const T5 = addr('56');
  db._state.tables.wss_events.push(
    { id: 3, kind: 'token_create', platform: 'fourmeme', token_address: T5, payload: {}, block_time: '2026-11-24T00:00:00Z' });
  try { await svc.addToken('col-1', { tokenAddress: T5, tags: ['ok', ''] }); } catch (e) { thrown400 = e.status === 400; }
  ok(thrown400, 'G5 非法 tag 整体 400');
  ok(!db._state.tables.case_collection_tokens.some(r => r.token_address === T5),
    'G6 校验失败代币行不落（fail-fast 宁拒不漏）');
}

// ───────────────── 收尾 ─────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
})();
