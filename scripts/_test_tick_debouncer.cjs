#!/usr/bin/env node
/**
 * TickDebouncer 单测（T208 到期即结算，2026-11-22）。零 DB 零网络纯类测。
 *
 * 事故现场反证（0x76b0 中文房间，bt-v177-jindog-v34-rerun）：11:30:25 0.1977B
 * 点火买单触发 leg buy_0_1 进买评估去抖（200ms），此后该票静默 10s——旧形状
 * advance(nowTs) 以推进时刻（下一笔 tick 11:30:35）作 fireTs，FA asOf/信号
 * created_at/FP 锚窗全体漂移 10s：FP40 临近段（锚前 30s）中位被 :35 尘买
 * 0.0253 拉下 0.05 线 → act_near_dead 一票翻转拒（:25.2 锚离线对拍 pass=true）。
 * 修后 fireTs=条目真实到期时刻（=real 模式 setTimeout 到期同刻），锚不再漂。
 */
'use strict';
const { TickDebouncer } = require('../src/trading-engine/core/TickDebouncer');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(name); }

function makeFires() { const arr = []; arr.onFire = (t, tick, fireTs) => arr.push({ t, tick, fireTs }); return arr; }

// ── A. 事故现场反证：静默 10s，fireTs=到期时刻 25200 而非推进时刻 35000 ──
section('A. 到期即结算（0x76b0 事故现场反证：gap 10s）');
{
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 200, maxWaitMs: 1000, mode: 'virtual', onFire: fires.onFire });
  d.touch('0x76b0', { timestamp: 25000 });
  ok(d.pending.size === 1, 'A1 touch 后 pending 1 条');
  d.advance(25100);
  ok(fires.length === 0 && d.pending.size === 1, 'A2 未到期不 fire');
  d.advance(35000); // 下一笔 tick 10s 后才到
  ok(fires.length === 1, 'A3 到期 fire 一次');
  ok(fires[0].fireTs === 25200, `A4 fireTs=到期时刻 25200（实得 ${fires[0].fireTs}，旧形状=35000）`);
  ok(fires[0].tick.timestamp === 25000, 'A5 回调携带 burst 末笔 tick');
  ok(d.pending.size === 0 && d.stats.fired === 1, 'A6 pending 清空 + fired 计数');
}

// ── B. burst 重置语义不变；密集 tick 下 fireTs=推进时刻（零漂移） ──
section('B. burst 重置与密集形状零变化');
{
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 200, maxWaitMs: 1000, mode: 'virtual', onFire: fires.onFire });
  d.touch('0xa', { timestamp: 25000 });
  d.touch('0xa', { timestamp: 25100 }); // burst 内重置
  d.advance(25250);
  ok(fires.length === 0, 'B1 重置后静默 150ms<200 未到期');
  d.advance(25300);
  ok(fires.length === 1 && fires[0].fireTs === 25300, `B2 密集形状 fireTs=25100+200=25300=推进时刻（实得 ${fires[0] && fires[0].fireTs}）`);
}

// ── C. maxWait 强制触发：fireTs=先到期腿的真实到期时刻（非推进时刻） ──
section('C. maxWait 到期时刻');
{
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 200, maxWaitMs: 1000, mode: 'virtual', onFire: fires.onFire });
  d.touch('0xa', { timestamp: 0 });
  d.touch('0xa', { timestamp: 300 });
  d.touch('0xa', { timestamp: 600 });
  d.touch('0xa', { timestamp: 900 });
  d.advance(1200); // 静默腿 1100 与 burst 腿 1000 均已到期——取先到 1000
  ok(fires.length === 1, 'C1 双腿均到期 fire 一次');
  ok(fires[0].fireTs === 1000, `C2 fireTs=min(静默 900+200=1100, burst 0+1000=1000)=1000（实得 ${fires[0].fireTs}）`);
}
{
  // 持续 touch 推迟静默腿：burst 腿先到（real 模式 maxTimer 同刻）
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 500, maxWaitMs: 1000, mode: 'virtual', onFire: fires.onFire });
  d.touch('0xa', { timestamp: 0 });
  d.touch('0xa', { timestamp: 990 });
  d.advance(1001); // 静默 11<500 未到；burst 1001≥1000 到期
  ok(fires.length === 1 && fires[0].fireTs === 1000, `C3 静默未满先由 burst 腿到期=1000（实得 ${fires[0] && fires[0].fireTs}）`);
}

// ── D. 多条目各自到期时刻；跨 token 互不干扰 ──
section('D. 多条目各自到期');
{
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 200, maxWaitMs: 0, mode: 'virtual', onFire: fires.onFire });
  d.touch('0xa', { timestamp: 1000 });
  d.touch('0xb', { timestamp: 5000 });
  d.advance(10000);
  ok(fires.length === 2, 'D1 两条件各自 fire');
  const byT = Object.fromEntries(fires.map(f => [f.t, f.fireTs]));
  ok(byT['0xa'] === 1200 && byT['0xb'] === 5200, `D2 fireTs 各自到期（实得 ${JSON.stringify(byT)}）`);
}

// ── E. debounceMs<=0 立即路径不变（fireTs=tick.timestamp） ──
section('E. 立即路径 / real no-op / clear');
{
  const fires = makeFires();
  const d0 = new TickDebouncer({ debounceMs: 0, maxWaitMs: 0, mode: 'virtual', onFire: fires.onFire });
  d0.touch('0xa', { timestamp: 77000 });
  ok(fires.length === 1 && fires[0].fireTs === 77000, 'E1 debounceMs<=0 touch 即 fire（fireTs=tick 时刻）');
  const dr = new TickDebouncer({ debounceMs: 200, maxWaitMs: 0, mode: 'real', onFire: fires.onFire });
  dr.touch('0xb', { timestamp: 1 });
  dr.advance(999999);
  ok(fires.length === 1, 'E2 real 模式 advance no-op（timer 驱动域外）');
  const dv = new TickDebouncer({ debounceMs: 200, maxWaitMs: 0, mode: 'virtual', onFire: fires.onFire });
  dv.touch('0xc', { timestamp: 1000 });
  dv.clear('0xc');
  dv.advance(999999);
  ok(fires.length === 1, 'E3 clear 不 fire');
}

// ── F. 回测尾 drain 形状：残留 burst 结算在自身到期时刻（非 +10min 推进值） ──
section('F. 尾部 drain');
{
  const fires = makeFires();
  const d = new TickDebouncer({ debounceMs: 200, maxWaitMs: 1000, mode: 'virtual', onFire: fires.onFire });
  const lastTickTs = 60000;
  d.touch('0xa', { timestamp: lastTickTs }); // 回放末笔后仍 pending
  d.advance(lastTickTs + 10 * 60 * 1000);
  ok(fires.length === 1 && fires[0].fireTs === 60200, `F1 尾 drain fireTs=60200 而非 ${lastTickTs + 600000}（实得 ${fires[0].fireTs}）`);
}

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
