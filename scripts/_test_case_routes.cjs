/**
 * Case 集合 API 路由单测（2026-11-20）——零 DB 零网络
 *
 * 覆盖矩阵：
 *   A. 路由表形状：固定子路径（/:id/sync-status、/:id/derived-experiments、
 *      /:id/sync、/:id/tokens/.../sync）必须注册在 /:id 之前（express 按注册序
 *      匹配——strategy-library 头注同款坑：'sync-status' 会被当作 :id 吞掉）
 *   B. handler 直调（fake req/res + CaseCollectionService.prototype 打桩）：
 *      CRUD/添加代币/同步入队/状态轮询/派生实验的响应约定 {success,data,error}
 *      与 err.status（400/404/409）映射
 *   C. 校验短路：POST / 无 name → 400；POST /:id/tokens 无 tokenAddress → 400
 */

'use strict';

const assert = require('assert');
const path = require('path');

const router = require(path.join(__dirname, '..', 'src', 'web', 'routes', 'case-collections.routes.js'));
const { CaseCollectionService } = require(path.join(__dirname, '..', 'src', 'web', 'services', 'CaseCollectionService'));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ───────────────── A. 路由表形状 ─────────────────
console.log('A. 路由表');
const layers = router.stack.map(l => ({
  method: Object.keys(l.route.methods)[0],
  path: l.route.path,
}));
{
  const idx = p => layers.findIndex(l => l.path === p);
  ok(layers.length === 12, `A1 十二端点（实际 ${layers.length}）`);
  ok(idx('/:id/sync-status') !== -1 && idx('/:id/sync-status') < idx('/:id'),
    'A2 /:id/sync-status 注册在 /:id 之前（express 注册序匹配坑）');
  ok(idx('/:id/derived-experiments') !== -1 && idx('/:id/derived-experiments') < idx('/:id'),
    'A3 /:id/derived-experiments 在 /:id 之前');
  ok(idx('/:id/sync') !== -1 && idx('/:id/sync') < idx('/:id/tokens/:tokenAddress/sync'),
    'A4 /:id/sync 在 /:id/tokens/:tokenAddress/sync 之前');
  ok(idx('/') === 0 && layers[0].method === 'get', 'A5 GET / 列表首位');
  const methods = new Set(layers.map(l => l.method));
  ok(methods.has('post') && methods.has('put') && methods.has('delete'), 'A6 全动词覆盖');
}

// ───────────────── B/C. handler 直调 ─────────────────
console.log('B/C. handler 行为（prototype 打桩）');
function fakeRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(c) { out.statusCode = c; return this; },
    json(j) { out.body = j; return this; },
  };
}
function findHandler(method, p) {
  const layer = router.stack.find(l => l.route.path === p && l.route.methods[method]);
  return layer.route.stack[layer.route.route ? 0 : 0].handle;
}
// 直接从 layer 取 handler（单中间件）
function handlerOf(method, p) {
  const layer = router.stack.find(l => l.route.path === p && l.route.methods[method]);
  return layer.route.stack[0].handle;
}

(async function main() {
  // B1 GET / 列表透传
  const savedList = CaseCollectionService.prototype.list;
  CaseCollectionService.prototype.list = async () => [{ id: 'x', name: '集合A', tokenCount: 2, synced: 2, tickTotal: 100 }];
  {
    const res = fakeRes();
    await handlerOf('get', '/')(null, res);
    ok(res.out.statusCode === null && res.out.body.success === true && res.out.body.data[0].name === '集合A',
      'B1 GET / 列表 {success,data}');
  }
  CaseCollectionService.prototype.list = savedList;

  // B2 错误 status 映射（404/409/400）
  for (const [stub, p, params, expectCode, label] of [
    [async () => { const e = new Error('集合不存在: x'); e.status = 404; throw e; }, '/:id', { id: 'x' }, 404, 'B2a 404 映射'],
    [async () => { const e = new Error('该代币已在本集合中'); e.status = 409; throw e; }, '/:id/tokens', { id: 'x' }, 409, 'B2b 409 映射'],
    [async () => { const e = new Error('tokenAddress 形状非法'); e.status = 400; throw e; }, '/:id/tokens', { id: 'x' }, 400, 'B2c 400 映射'],
  ]) {
    const key = Object.keys(CaseCollectionService.prototype).length ? null : null; // noop
    const methodName = p === '/:id' ? 'getDetail' : 'addToken';
    const saved = CaseCollectionService.prototype[methodName];
    CaseCollectionService.prototype[methodName] = stub;
    const res = fakeRes();
    await handlerOf(p === '/:id' ? 'get' : 'post', p)({ params, body: { tokenAddress: '0xbad' } }, res);
    ok(res.out.statusCode === expectCode && res.out.body.success === false && res.out.body.error,
      `${label}（${expectCode}）`);
    CaseCollectionService.prototype[methodName] = saved;
  }

  // C1 POST / 无 name → 400
  {
    const res = fakeRes();
    await handlerOf('post', '/')({ body: { description: 'no name' } }, res);
    ok(res.out.statusCode === 400, 'C1 POST / 缺 name 400');
  }

  // C2 POST /:id/tokens 缺 tokenAddress → 400
  {
    const res = fakeRes();
    await handlerOf('post', '/:id/tokens')({ params: { id: 'x' }, body: {} }, res);
    ok(res.out.statusCode === 400 && /tokenAddress/.test(res.out.body.error), 'C2 缺 tokenAddress 400');
  }

  // B3 单票同步入队透传
  const savedEnqueue = CaseCollectionService.prototype.enqueueSync;
  let enqueueCalledWith = null;
  CaseCollectionService.prototype.enqueueSync = async (cid, addr) => { enqueueCalledWith = [cid, addr]; return { queued: true }; };
  {
    const res = fakeRes();
    await handlerOf('post', '/:id/tokens/:tokenAddress/sync')(
      { params: { id: 'col-1', tokenAddress: '0xabc' } }, res);
    ok(res.out.body.success === true && enqueueCalledWith[0] === 'col-1' && enqueueCalledWith[1] === '0xabc',
      'B3 同步端点调 enqueueSync（cid+addr）');
  }
  CaseCollectionService.prototype.enqueueSync = savedEnqueue;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Case 集合路由单测：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
