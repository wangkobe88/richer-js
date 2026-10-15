#!/usr/bin/env node
/**
 * strategy_signals 通知侧去重复读单测（批次 4a 步骤①，2026-10-15）
 *
 * 买信号链每 signal ≈7 次 DB 往返中的通知侧 SELECT * 重复读消除：
 * TradeSignal.save() 的 INSERT .select() 回读行保留（_insertedRow）→
 * processSignal/_updateSignalStatus 透传 → 通知侧本地组装 composedSignal
 * （metadata=UPDATE 后 newMetadata / executed=updateData.executed，与刚 UPDATE
 * 完的 DB 行值恒等）→ createEvent 零额外读。缺省 null 走 SELECT 兜底（既有形状）。
 *
 * 事故防线：composedSignal 与 SELECT * 回读行 deep-equal 对拍（若组装漏键/错值，
 * 对拍组直接炸）；signalRow 路径 select('*') 计数必须为 0。
 *
 * 零 DB 零网络：dbManager 单例打桩（MockQuery 含 insert/update/select 写回语义，
 * _test_live_dual_platform 先例）；Object.create(prototype) 桩引擎直调
 * _updateSignalStatus/_sendSignalNotificationWithFilter。
 * 用法：node scripts/_test_signal_metadata_cache.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

// ═══════════════ dbManager 单例打桩（引擎/TradeSignal require 前生效共享 require.cache）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

/** 链式 mock：insert().select() / update().eq() 写回 / select().eq().single() */
class MockQuery {
  constructor(db, table) { this.db = db; this.table = table; this._eqs = []; this._single = false; this._pending = null; }
  select(cols) { this._cols = cols; this._pending = this._pending || 'select'; return this; }
  eq(c, v) { this._eqs.push([c, v]); return this; }
  single() { this._single = true; return this; }
  insert(rows) { this._pending = 'insert'; this._rows = rows; return this; }
  update(data) { this._pending = 'update'; this._updateData = data; return this; }
  then(resolve) {
    const rows = () => (this.db.tables[this.table] || []).filter(r => this._eqs.every(([c, v]) => r[c] === v));
    this.db.calls.push({ op: this._pending, table: this.table, cols: this._cols ?? null });
    if (this._pending === 'insert') {
      // PostgREST INSERT .select()：回读 DB 侧默认值已回填的完整行（mock=原行直存）
      (this.db.tables[this.table] = this.db.tables[this.table] || []).push(...this._rows);
      resolve({ data: [...this._rows], error: null });
    } else if (this._pending === 'update') {
      for (const r of rows()) Object.assign(r, this._updateData);
      resolve({ data: null, error: null });
    } else if (this._single) {
      const found = rows();
      resolve({ data: found[0] || null, error: found.length ? null : { message: '行不存在' } });
    } else {
      resolve({ data: rows(), error: null });
    }
  }
}

const db = { tables: { strategy_signals: [] }, calls: [] };
dbManager.getClient = () => ({ from: (t) => new MockQuery(db, t) });

const { TradeSignal } = require(path.join(ROOT, 'src/trading-engine/entities/TradeSignal'));
const { AbstractTradingEngine } = require(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine'));
const { TradingMode } = require(path.join(ROOT, 'src/trading-engine/interfaces/ITradingEngine'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

/** 桩引擎：只填 _updateSignalStatus/_sendSignalNotificationWithFilter 触碰的字段 */
function mkEngine({ onlyExecuted = false } = {}) {
  const eng = Object.create(AbstractTradingEngine.prototype);
  eng._logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  eng._mode = TradingMode.VIRTUAL;
  eng._eventRecordingConfig = { enabled: true, onlyExecuted, buySignalIndices: new Set(), sellSignals: 'all' };
  eng._experimentId = 'exp-1';
  eng._experiment = { experimentName: 'T' };
  eng._blockchain = 'bsc';
  eng._tokenBuyNotificationState = new Map();
  eng._events = [];
  eng._eventService = { createEvent: (signal, info) => { eng._events.push({ signal, info }); } };
  return eng;
}
function resetDb() { db.tables.strategy_signals = []; db.calls = []; }

/** 落一条 signal（走真 TradeSignal.save()=真 INSERT .select() 回读链）。
 *  overrides 固定 id/createdAt：对拍组两侧产物须可 deep-equal（uuid/时钟天然不同） */
async function seedSignal(extraMeta = { note: '原语料' }, overrides = {}) {
  const ts = new TradeSignal({
    experimentId: 'exp-1', tokenAddress: '0xtok', tokenSymbol: 'SYM',
    signalType: 'SELL', action: 'sell', confidence: 0.8, reason: 'tp',
    chain: 'bsc', metadata: extraMeta, ...overrides,
  });
  const id = await ts.save();
  return { ts, id };
}
const FIXED = { id: '00000000-0000-4000-8000-000000000001', createdAt: new Date(Date.UTC(2026, 9, 15, 0, 0, 0)) };

(async () => {
  console.log('A. TradeSignal.save() INSERT 回读行保留（_insertedRow）');
  {
    resetDb();
    const { ts, id } = await seedSignal();
    check('A1 save 返回 id', typeof id === 'string' && id.length > 0, true);
    check('A2 _insertedRow 保留且 id 一致', [ts._insertedRow?.id === id], [true]);
    check('A3 行形状（snake 键 + metadata）',
      ['token_address', 'token_symbol', 'chain', 'action', 'metadata', 'executed', 'created_at']
        .every(k => k in ts._insertedRow), true);
    check('A4 DB 表恰 1 行', db.tables.strategy_signals.length, 1);
  }

  console.log('B. signalRow 路径全链：组装行直达 createEvent，零 select(*)');
  {
    resetDb();
    const eng = mkEngine();
    const { ts, id } = await seedSignal();
    db.calls = []; // 只看 _updateSignalStatus 之后的往返
    const result = { success: true, message: '卖出成功', trade: { id: 't1', tokenSymbol: 'SYM', tradeDirection: 'sell' } };
    await eng._updateSignalStatus(id, 'executed', result, ts._insertedRow);

    const row = db.tables.strategy_signals[0];
    check('B1 executed 写回 true', row.executed, true);
    check('B2 metadata merge：原键保留+执行四键新增',
      [row.metadata.note, typeof row.metadata.executed_at, row.metadata.execution_status, row.metadata.execution_reason, row.metadata.tradeResult.success],
      ['原语料', 'string', 'executed', '卖出成功', true]);
    check('B3 前置 select(metadata) 恰 1 次（UPDATE 基底读，步骤②换缓存）',
      db.calls.filter(c => c.op === 'select' && c.cols === 'metadata').length, 1);
    check('B4 ★select(*) 零调用（通知侧免重复读）',
      db.calls.filter(c => c.op === 'select' && c.cols === '*').length, 0);
    check('B5 createEvent 恰 1 次', eng._events.length, 1);
    const sig = eng._events[0].signal;
    check('B6 组装行 metadata=UPDATE 后 metadata（同值）', sig.metadata, row.metadata);
    check('B7 executed=true 透传', sig.executed, true);
    check('B8 createEvent 消费字段闭包齐（snake 键）',
      ['metadata', 'action', 'executed', 'token_address', 'token_symbol', 'chain', 'experiment_id', 'created_at']
        .every(k => k in sig), true);
    check('B9 experimentInfo', eng._events[0].info, { id: 'exp-1', mode: TradingMode.VIRTUAL, name: 'T', blockchain: 'bsc' });
  }

  console.log('C. ★对拍：signalRow 组装行 ≡ SELECT * 兜底回读行（事故防线：漏键/错值即炸）');
  {
    // C 组：同一初始行、同 result，null 路径走 SELECT * —— 与 B 组产物 deep-equal
    resetDb();
    const eng = mkEngine();
    const { id } = await seedSignal({ note: '原语料' }, FIXED);
    db.calls = [];
    const result = { success: true, message: '卖出成功', trade: { id: 't1', tokenSymbol: 'SYM', tradeDirection: 'sell' } };
    await eng._updateSignalStatus(id, 'executed', result, null); // _insertedRow 刻意不传

    check('C1 null 路径 select(*) 恰 1 次（兜底）',
      db.calls.filter(c => c.op === 'select' && c.cols === '*').length, 1);
    check('C2 createEvent 恰 1 次', eng._events.length, 1);
    const cSig = eng._events[0].signal;

    // B 组重跑（独立 db 态、同固定 id/createdAt），剥 executed_at（两次运行时间戳天然不同）后逐键对拍
    resetDb();
    const engB = mkEngine();
    const s2 = await seedSignal({ note: '原语料' }, FIXED);
    db.calls = [];
    await engB._updateSignalStatus(s2.id, 'executed', result, s2.ts._insertedRow);
    const bSig = engB._events[0].signal;
    const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.metadata.executed_at; return c; };
    let equal = true;
    try { assert.deepStrictEqual(strip(bSig), strip(cSig)); } catch (e) { equal = false; }
    check('C3 ★组装行与 SELECT 回读行逐键 deep-equal', equal, true);
    check('C4 两路径 DB 终态一致',
      [db.tables.strategy_signals[0].executed, db.tables.strategy_signals[0].metadata.note], [true, '原语料']);
  }

  console.log('D. failed 路径与 onlyExecuted 过滤');
  {
    // D1 failed：executed=false + execution_reason；onlyExecuted=false 仍通知
    resetDb();
    const eng = mkEngine({ onlyExecuted: false });
    const { ts, id } = await seedSignal();
    db.calls = [];
    await eng._updateSignalStatus(id, 'failed', { success: false, message: '余额不足' }, ts._insertedRow);
    check('D1 failed→executed=false 通知透传 + reason 落 metadata',
      [eng._events.length, eng._events[0].signal.executed, eng._events[0].signal.metadata.execution_reason, eng._events[0].signal.metadata.execution_status],
      [1, false, '余额不足', 'failed']);
    check('D2 failed 路径同样零 select(*)',
      db.calls.filter(c => c.op === 'select' && c.cols === '*').length, 0);

    // D2 onlyExecuted=true：未执行信号跳过事件（且不 SELECT——组装值即可判）
    resetDb();
    const eng2 = mkEngine({ onlyExecuted: true });
    const s2 = await seedSignal();
    db.calls = [];
    await eng2._updateSignalStatus(s2.id, 'failed', { success: false, message: 'x' }, s2.ts._insertedRow);
    check('D3 onlyExecuted=true 跳过事件且零 select(*)',
      [eng2._events.length, db.calls.filter(c => c.op === 'select' && c.cols === '*').length], [0, 0]);

    // D3 UPDATE error：不通知（旧语义保持，步骤②缓存 invalidate 在此语义上加）
    resetDb();
    const eng3 = mkEngine();
    const s3 = await seedSignal();
    const origUpdate = MockQuery.prototype.update;
    MockQuery.prototype.update = function () { return { eq: () => ({ then: (r) => r({ data: null, error: { message: 'db down' } }) }) }; };
    db.calls = [];
    await eng3._updateSignalStatus(s3.id, 'executed', { success: true, message: 'ok' }, s3.ts._insertedRow);
    MockQuery.prototype.update = origUpdate;
    check('D4 UPDATE error→不通知', eng3._events.length, 0);
  }

  console.log('E. 源码口径（防回流）');
  {
    const abs = fs.readFileSync(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
    check('E1 Abstract processSignal 两处透传 _insertedRow',
      (abs.match(/_updateSignalStatus\(signalId,[^)]*?tradeSignal\._insertedRow \|\| null\)/g) || []).length, 2);
    check('E2 _updateSignalStatus 第四参 signalRow（缺省 null）',
      /_updateSignalStatus\(signalId, status, result, signalRow = null\) \{/.test(abs), true);
    check('E3 组装行形状（metadata=newMetadata + executed=updateData.executed）',
      /signalRow\s*\?\s*\{ \.\.\.signalRow, metadata: newMetadata, executed: updateData\.executed \}\s*\n\s*: null;/.test(abs), true);
    check('E4 SELECT 兜底保留（composedSignal 缺省分支）',
      /let signal = composedSignal;\s*\n\s*if \(!signal\) \{/.test(abs), true);
    const tsSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/entities/TradeSignal.js'), 'utf8');
    check('E5 TradeSignal._insertedRow 保留（INSERT 回读行不丢弃）',
      /this\._insertedRow = data\[0\];/.test(tsSrc), true);
    const fm = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
    check('E6 FourMeme 覆盖版：save 后捕获回读行',
      /signalRow = tradeSignal\._insertedRow \|\| null;/.test(fm), true);
    check('E7 FourMeme 两处 _updateSignalStatus 透传 signalRow',
      (fm.match(/_updateSignalStatus\(signalId,[^)]*?, signalRow\)/g) || []).length, 2);
    // existingSignalId 分支（买腿 fire 链）signalRow=null 走兜底——步骤②缓存接管前形状
    const m = fm.match(/async processSignal\(signal, existingSignalId = null\) \{[\s\S]{0,2500}?let signalId/);
    check('E8 existingSignalId 免二次 save 分支保留', m !== null, true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
