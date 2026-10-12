#!/usr/bin/env node

/**
 * BacktestWriteBuffer P4c 异步化单测（2026-10-12，perf5 画像：96 次段边界
 * 同步 await flush 等待 254.9s ≈ 有效回放墙钟 25%）。零 DB 零网络：
 * mock supabase（可控挂起门）验证 swap/串行化/同批合并/收尾语义。
 *
 * 覆盖面：
 *  A swap：flush 挂起期间 add 的新行落新数组（不被 inflight 批带走、不丢）
 *  B 串行化：并发 flush 排队——批写入顺序保持（signals 先行全序不乱）
 *  C 尾部收尾语义：inflight 批挂起中 await flush() 返回时两批都已写完
 *  D metadata 同批合并锚点：insert+update 同批入队 → insert 行 metadata 含
 *    update 键（swap 不影响——引擎每 tick drain 保证同批，见 flush 注释）
 *  E 空批 flush：pending 0 直接返回空 stats，不产生写调用
 *  F 失败降级回归：批插 error → 降级单条（原路径行为不变）
 *  G 引擎侧源码口径：段边界 flush 无 await（fire-and-forget + catch 兜底），
 *    尾部/停机两处保留 await（红线 13：事故现场源码断言锁定防线）
 *  H update 跨批独立：insert 已被 swap 走后 addSignalUpdate → 独立 update
 *    分支（与旧版「insert 已 flush」路径行为 bit 一致——不合并、原样发）
 */

const fs = require('fs');
const path = require('path');
const { BacktestWriteBuffer } = require('../src/trading-engine/backtest/BacktestWriteBuffer.js');

let passed = 0, failed = 0;
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ═══════════════ mock supabase（可控挂起门） ═══════════════
// pause() 后所有 insert/upsert/update 挂起；resume() 全部放行。
// writes 记录实际写库调用（顺序敏感——串行化断言用）
function makeMockDb(opts = {}) {
  const writes = [];
  let gateOpen = true;
  const waiters = [];
  const gate = () => new Promise(r => { gateOpen ? r() : waiters.push(r); });
  let insertCalls = 0;
  const client = {
    from(table) {
      const c = {};
      c.insert = async (rows) => {
        await gate();
        insertCalls++;
        const fail = opts.failNthInsert && insertCalls === opts.failNthInsert;
        if (!fail) writes.push({ table, op: 'insert', rows });
        return { error: fail ? { message: 'batch rejected' } : null };
      };
      c.upsert = async (rows) => {
        await gate();
        writes.push({ table, op: 'upsert', rows });
        return { error: null };
      };
      c.update = (payload) => {
        const u = {
          eq() { return u; },
          then(f, g) {
            return gate().then(() => {
              writes.push({ table, op: 'update', payload });
              const v = { error: null };
              return f ? f(v) : v;
            }, g);
          },
        };
        return u;
      };
      return c;
    },
    pause() { gateOpen = false; },
    resume() { gateOpen = true; waiters.forEach(r => r()); waiters.length = 0; },
    writes,
  };
  return client;
}

const logger = { info() {}, error() {}, warn() {} };
const sig = (id, metadata = {}) => ({ id, experiment_id: 'exp', metadata });

(async () => {
  // ═══ A swap：挂起期间的新 add 落新数组 ═══
  {
    console.log('\n[A] swap：flush 挂起期间 add 的新行不被 inflight 批带走、不丢');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('s1'));
    db.pause();
    const p1 = wb.flush('exp');
    // flush() 已同步完成 swap——此后 add 落新数组
    wb.addSignalInsert(sig('s2'));
    assert('挂起期间 pendingCount 只含新行（s1 已被摘走）', wb.pendingCount === 1, `pending=${wb.pendingCount}`);
    assert('inflight 批存在（_flushChain 非 null）', wb._flushChain != null);
    db.resume();
    const st1 = await p1;
    assert('inflight 批写入 s1', st1.signalsInserted === 1 && db.writes.some(w => w.rows?.some(r => r.id === 's1')));
    assert('inflight 批不含 s2', !db.writes.some(w => w.rows?.some(r => r.id === 's2')));
    assert('s2 仍在 pending（下一批）', wb.pendingCount === 1);
    const st2 = await wb.flush('exp');
    assert('第二次 flush 带走 s2', st2.signalsInserted === 1 && db.writes.some(w => w.rows?.some(r => r.id === 's2')));
    assert('flush 完成后 _flushChain 清空', wb._flushChain == null);
  }

  // ═══ B 串行化：并发 flush 排队保序 ═══
  {
    console.log('\n[B] 串行化：flush B 等 inflight A 完成后才写自己的批（signals 先行全序不乱）');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('a1'));
    db.pause();
    const pA = wb.flush('exp');
    wb.addSignalInsert(sig('b1'));
    wb.addSignalUpdate('b1', { metadata: { trend: 1 } });
    const pB = wb.flush('exp');   // 排队等 A
    db.resume();
    await Promise.all([pA, pB]);
    const insA = db.writes.findIndex(w => w.rows?.some(r => r.id === 'a1'));
    const insB = db.writes.findIndex(w => w.rows?.some(r => r.id === 'b1'));
    const updB = db.writes.findIndex(w => w.op === 'update');
    assert('两批都写入', insA >= 0 && insB >= 0);
    assert('A 批先于 B 批落库', insA < insB, `insA=${insA} insB=${insB}`);
    assert('B 批 signals INSERT 先于其 UPDATE（跨批全序保持）', insB < updB, `insB=${insB} updB=${updB}`);
  }

  // ═══ C 尾部收尾语义 ═══
  {
    console.log('\n[C] 尾部语义：inflight 挂起中 await flush() 返回时，此前全部 pending 已写完');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('c1'));
    db.pause();
    wb.flush('exp');              // fire-and-forget（引擎段边界形态）
    wb.addSignalInsert(sig('c2'));
    db.resume();
    await wb.flush('exp');        // 引擎尾部/停机形态：await 排队收尾
    assert('c1（inflight 批）与 c2（尾部批）都已写库',
      db.writes.some(w => w.rows?.some(r => r.id === 'c1')) &&
      db.writes.some(w => w.rows?.some(r => r.id === 'c2')));
    assert('收尾后 pending 清零', wb.pendingCount === 0);
  }

  // ═══ D metadata 同批合并锚点 ═══
  {
    console.log('\n[D] 同批合并：insert+update 同批入队 → 两边 metadata 全量（swap 不破坏锚点）');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('d1', { price: 100, strategyId: 'x' }));
    wb.addSignalUpdate('d1', { metadata: { trendFactors: { a: 1 } }, executed: false });
    await wb.flush('exp');
    const insRow = db.writes.find(w => w.table === 'strategy_signals' && w.op === 'insert')?.rows[0];
    const upd = db.writes.find(w => w.op === 'update');
    assert('insert 行 metadata 含 update 键（合并进 insert）', insRow?.metadata?.trendFactors?.a === 1);
    assert('insert 行保留原键', insRow?.metadata?.price === 100 && insRow?.metadata?.strategyId === 'x');
    assert('update payload metadata 同为全量', upd?.payload?.metadata?.price === 100 && upd?.payload?.metadata?.trendFactors?.a === 1);
  }

  // ═══ E 空批 flush ═══
  {
    console.log('\n[E] 空批：pending 0 时 flush 返回空 stats 零写调用');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    const st = await wb.flush('exp');
    assert('stats 全 0', st.signalsInserted === 0 && st.signalsUpdated === 0);
    assert('零写调用', db.writes.length === 0);
  }

  // ═══ F 失败降级回归 ═══
  {
    console.log('\n[F] 失败降级：批插 error → 降级逐条（原路径行为不变）');
    const db = makeMockDb({ failNthInsert: 1 });
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('f1'));
    wb.addSignalInsert(sig('f2'));
    const st = await wb.flush('exp');
    // 第 1 次批插失败 → 降级两条单条（各 1 次 insert 调用，均成功计入）
    assert('降级单条后两行都计入', st.signalsInserted === 2, `signalsInserted=${st.signalsInserted}`);
    assert('单条 insert 写库两次', db.writes.filter(w => w.table === 'strategy_signals').length === 2);
  }

  // ═══ G 引擎侧源码口径（红线 13：源码断言锁定防线） ═══
  {
    console.log('\n[G] BacktestEngine 段边界源码口径');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js'), 'utf8');
    const segBlock = src.match(/if \(processed % 5000 === 0\) \{[\s\S]*?\n        \}/);
    assert('段边界块存在', !!segBlock);
    if (segBlock) {
      const block = segBlock[0];
      assert('段边界 flush 为 fire-and-forget（无 await）', /this\._writeBuffer\.flush\(this\._experimentId\)\.catch/.test(block) && !/await this\._writeBuffer\.flush/.test(block));
      assert('fire-and-forget 带 catch 兜意外异常（防 unhandled rejection）', /\.catch\(err =>/.test(block));
    }
    const awaitFlushCount = (src.match(/await this\._writeBuffer\.flush/g) || []).length;
    assert('尾部与停机两处保留 await flush', awaitFlushCount === 2, `count=${awaitFlushCount}`);
    // writeBuffer 侧：swap 先于任何写库 await（_doFlush 引用 batch 不触 _pending）
    const wbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'backtest', 'BacktestWriteBuffer.js'), 'utf8');
    assert('串行化等待存在（while _flushChain）', /while \(this\._flushChain\) await this\._flushChain;/.test(wbSrc));
    const doFlushBody = wbSrc.match(/async _doFlush\(batch, experimentId\) \{[\s\S]*?\n  \}/)?.[0] || '';
    assert('_doFlush 不触碰 this._pending*（无共享可变状态）', !/this\._pending/.test(doFlushBody));
    assert('swap 段在 _doFlush 之前（flush 体内）', wbSrc.indexOf('同步 swap') < wbSrc.indexOf('async _doFlush'));
  }

  // ═══ H update 跨批独立（锁定与旧版 bit 一致的不可达形状行为） ═══
  {
    console.log('\n[H] 跨批 update：insert 已被摘走 → 独立 update 分支（与旧版「已 flush」路径一致）');
    const db = makeMockDb();
    const wb = new BacktestWriteBuffer(db, logger);
    wb.addSignalInsert(sig('h1', { price: 7 }));
    await wb.flush('exp');        // insert 已写库
    wb.addSignalUpdate('h1', { metadata: { late: 1 } });
    await wb.flush('exp');
    const upd = db.writes.find(w => w.op === 'update');
    assert('update metadata 原样发（不与已落库 insert 合并——与旧版行为 bit 一致）',
      upd?.payload?.metadata?.late === 1 && upd?.payload?.metadata?.price === undefined);
  }

  console.log('\n══════════════════════════════');
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('单测异常:', e); process.exit(1); });
