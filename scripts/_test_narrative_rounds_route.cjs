#!/usr/bin/env node
/**
 * C84 叙事分析轮次查询 service+路由单测（2026-10-17 买腿链路重构）——零 DB 零网络。
 *
 * ExperimentDataService.getExperimentNarrativeRounds：narrative_analysis_rounds 表
 * （轮次留痕=信号页叙事事件列表/图表标注数据源，被拒 token 轨迹也可查）。
 * 锁定：列清单/experiment_id 过滤/started_at 正序/limit 2000/tokenAddress 可选
 * 过滤/错误 throw「叙事轮次查询失败」/data null → []；路由接线与 service key 红线。
 *
 * 用法：node scripts/_test_narrative_rounds_route.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { ExperimentDataService } = require(path.join(ROOT, 'src/web/services/ExperimentDataService.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ── supabase 链式桩（thenable 终端）──
function makeClient({ rows = [], err = null } = {}) {
  const ops = { table: null, select: null, eqs: [], order: null, limit: null };
  const c = {
    from(t) { ops.table = t; return c; },
    select(cols) { ops.select = cols; return c; },
    eq(col, val) { ops.eqs.push([col, val]); return c; },
    order(col, o) { ops.order = [col, o]; return c; },
    limit(n) { ops.limit = n; return c; },
    // supabase-js 契约：不 reject，resolve {data, error}（error 由调用方判）
    then(res) { res({ data: err ? null : rows, error: err }); },
  };
  return { ops, client: c };
}
function makeService(client) {
  // 绕过 ctor（真 ctor 走 dbManager.getClient()+落盘 Logger）——prototype 借调注入桩
  const svc = Object.create(ExperimentDataService.prototype);
  svc.supabase = client;
  return svc;
}

const COLS = 'id, token_address, round_no, trigger_reason, started_at, completed_at, rating, from_cache, error, created_at';

(async () => {
  console.log('A. 查询形状');
  await checkAsync('A1 列清单/experiment_id/started_at 正序/limit 2000', async () => {
    const { ops, client } = makeClient();
    await makeService(client).getExperimentNarrativeRounds('exp1');
    assert.strictEqual(ops.table, 'narrative_analysis_rounds');
    assert.strictEqual(ops.select, COLS);
    assert.deepStrictEqual(ops.eqs, [['experiment_id', 'exp1']]);
    assert.deepStrictEqual(ops.order, ['started_at', { ascending: true }]);
    assert.strictEqual(ops.limit, 2000);
  });
  await checkAsync('A2 tokenAddress 过滤=追加 eq（单 token 详情页链路）', async () => {
    const { ops, client } = makeClient();
    await makeService(client).getExperimentNarrativeRounds('exp1', { tokenAddress: '0xtok' });
    assert.deepStrictEqual(ops.eqs, [['experiment_id', 'exp1'], ['token_address', '0xtok']]);
  });
  await checkAsync('A3 无 tokenAddress 不加 token 过滤（全实验列表链路）', async () => {
    const { ops, client } = makeClient({ rows: [] });
    const r = await makeService(client).getExperimentNarrativeRounds('exp1', {});
    assert.strictEqual(ops.eqs.length, 1);
    assert.deepStrictEqual(r, []);
  });

  console.log('B. 结果与错误');
  await checkAsync('B1 行透传（rating/from_cache/error 字段原样）', async () => {
    const rows = [{ id: 1, token_address: '0xa', round_no: 1, rating: 2, from_cache: false, error: null }];
    const { client } = makeClient({ rows });
    const r = await makeService(client).getExperimentNarrativeRounds('exp1');
    assert.deepStrictEqual(r, rows);
  });
  await checkAsync('B2 data null → []（无行不冒充 null）', async () => {
    const { client } = makeClient({ rows: null });
    const r = await makeService(client).getExperimentNarrativeRounds('exp1');
    assert.deepStrictEqual(r, []);
  });
  await checkAsync('B3 error → throw 叙事轮次查询失败（fail-loud）', async () => {
    const { client } = makeClient({ err: { message: 'RLS 拒了' } });
    await assert.rejects(
      () => makeService(client).getExperimentNarrativeRounds('exp1'),
      /叙事轮次查询失败: RLS 拒了/);
  });

  console.log('C. 路由/红线源码口径');
  {
    const ws = read('src/web-server.js');
    check('C1 路由接线：GET /api/experiment/:id/narrative-rounds → service → {rounds,count}', () => {
      assert.ok(/this\.app\.get\('\/api\/experiment\/:id\/narrative-rounds'/.test(ws), '路由缺失');
      assert.ok(/getExperimentNarrativeRounds\(req\.params\.id, \{\s*tokenAddress: req\.query\.tokenAddress,?\s*\}\)/.test(ws),
        'service 调用形状漂移');
      assert.ok(/success: true, rounds, count: rounds\.length/.test(ws), '响应形状漂移');
    });
    check('C2 500 分支带 error.message（fail-loud 透传）', () =>
      assert.ok(/获取叙事分析轮次失败[\s\S]{0,200}status\(500\)[\s\S]{0,120}error: error\.message/.test(ws),
        '错误分支漂移'));
    const ds = read('src/web/services/ExperimentDataService.js');
    check('C3 service key 红线：ctor 走 dbManager.getClient()（anon RLS 静默空防线）', () =>
      assert.ok(/this\.supabase = dbManager\.getClient\(\);/.test(ds), 'service 未走 dbManager'));
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})();
