#!/usr/bin/env node
/**
 * K 组对敲去 Set 物化单测（批次 5a，2026-10-15）
 *
 * buildFactorMap 里 K 组对敲重叠族旧实现 new Set([...buyers,...sellers]) 物化
 * 并集——每 build 一次纯分配浪费（热路径）。新实现两趟无分配遍历，迭代序与旧
 * Set 迭代序恒同（buyers 插入序 → sellers 中非 buyer 插入序），_v 取值表达式
 * 逐字不变 → 浮点加法链 bit 一致（Object.is 全等，非近似）。
 *
 * 依赖键集不变式：_buyerVolume≡_buyerAddresses / _sellerVolume≡_sellerAddresses
 * （processTick 同点成对写 :830-836）——违反时第二趟 0 值兜底会与旧实现发散。
 *
 * 零 DB 零网络：FA 实例直调 _computeCounterpartyOverlap 形状（桩 state）。
 * 用法：node scripts/_test_k_group_no_materialize.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

/** 旧实现参考（改造前逐字内联形状） */
function refKGroup(state) {
  let counterpartyOverlapRate = 0, counterpartyOverlapVolume = 0;
  {
    const _all = new Set([...state._buyerAddresses, ...state._sellerAddresses]);
    if (_all.size > 0) {
      let _overlap = 0, _unionVol = 0, _interVol = 0;
      for (const _addr of _all) {
        const _v = (state._buyerVolume.get(_addr) || 0) + (state._sellerVolume.get(_addr) || 0);
        _unionVol += _v;
        if (state._buyerAddresses.has(_addr) && state._sellerAddresses.has(_addr)) {
          _overlap++;
          _interVol += _v;
        }
      }
      counterpartyOverlapRate = _overlap / _all.size;
      counterpartyOverlapVolume = _unionVol > 0 ? _interVol / _unionVol : 0;
    }
  }
  return { counterpartyOverlapRate, counterpartyOverlapVolume };
}

/** 从源码提取新实现的 K 组段并 eval 成函数（对拍被测真身，非抄写副本） */
const SRC = fs.readFileSync(path.join(__dirname, '../src/services/FourMemeFactorAggregator.js'), 'utf8');
const kg = SRC.match(/\/\/ K 组：对敲重叠[\s\S]*?\n        \}\n(?=\n        \/\/ 秒级桶 RSI)/);
if (!kg) { console.error('✗ 未定位 K 组段'); process.exit(1); }
// 对拍被测真身（非抄写副本）：源码段原封内嵌 + 尾部 return 取 let 声明的两变量
const newKGroup = new Function('state', `${kg[0]}\n  return { counterpartyOverlapRate, counterpartyOverlapVolume };`);

console.log('A. 随机 500 组：新实现 vs 旧内联参考逐值 Object.is 全等');
{
  // 确定性 PRNG（mulberry32）——失败可复现
  let seed = 0x5eed1234;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  let mismatches = [];
  for (let i = 0; i < 500; i++) {
    // 构造状态：随机买家/卖家集（重叠随机）、量随机（含 0 量、极小量、重复叠加形状）
    const state = {
      _buyerAddresses: new Set(), _sellerAddresses: new Set(),
      _buyerVolume: new Map(), _sellerVolume: new Map(),
    };
    const nB = Math.floor(rnd() * 12), nS = Math.floor(rnd() * 12), nO = Math.floor(rnd() * 6);
    const mkAddr = (k) => `0xw${k.toString(16).padStart(4, '0')}`;
    // 两栖地址（同点成对写——保持键集不变式）
    for (let k = 0; k < nO; k++) {
      const a = mkAddr(k), buyV = rnd() < 0.15 ? 0 : rnd() * 3, sellV = rnd() < 0.15 ? 0 : rnd() * 2;
      state._buyerAddresses.add(a); state._buyerVolume.set(a, buyV);
      state._sellerAddresses.add(a); state._sellerVolume.set(a, sellV);
    }
    // 纯买家 / 纯卖家（部分 0 量仍成对写，键集不变式保持）
    for (let k = 0; k < nB; k++) {
      const a = mkAddr(100 + k); state._buyerAddresses.add(a);
      state._buyerVolume.set(a, rnd() < 0.2 ? 0 : rnd() * 5);
    }
    for (let k = 0; k < nS; k++) {
      const a = mkAddr(200 + k); state._sellerAddresses.add(a);
      state._sellerVolume.set(a, rnd() < 0.2 ? 0 : rnd() * 4);
    }
    // 重复叠加形状：同地址多次累加（模拟多 tick）
    for (let k = 0; k < 3; k++) {
      const a = mkAddr(Math.floor(rnd() * (nO || 1)));
      if (state._buyerVolume.has(a)) state._buyerVolume.set(a, state._buyerVolume.get(a) + rnd());
      if (state._sellerVolume.has(a)) state._sellerVolume.set(a, state._sellerVolume.get(a) + rnd());
    }

    const got = newKGroup(state);
    const want = refKGroup(state);
    if (!Object.is(got.counterpartyOverlapRate, want.counterpartyOverlapRate)
      || !Object.is(got.counterpartyOverlapVolume, want.counterpartyOverlapVolume)) {
      mismatches.push([i, got, want]);
    }
  }
  check('A1 500 组 Object.is 全等（重叠/单边/零量/叠加）', mismatches.length, 0);
  if (mismatches.length) console.log('   首个失配:', JSON.stringify(mismatches[0]));
}

console.log('B. 退化形状');
{
  const mk = () => ({ _buyerAddresses: new Set(), _sellerAddresses: new Set(), _buyerVolume: new Map(), _sellerVolume: new Map() });
  check('B1 双空 → 0/0', newKGroup(mk()), { counterpartyOverlapRate: 0, counterpartyOverlapVolume: 0 });
  const s2 = mk(); s2._buyerAddresses.add('a'); s2._buyerVolume.set('a', 1);
  check('B2 仅买家无卖家 → rate 0 vol 0', newKGroup(s2), refKGroup(s2));
  const s3 = mk(); s3._sellerAddresses.add('b'); s3._sellerVolume.set('b', 1.5);
  check('B3 仅卖家 → rate 0 vol 0', newKGroup(s3), refKGroup(s3));
  const s4 = mk();
  ['a', 'b', 'c'].forEach((x, i) => { s4._buyerAddresses.add(x); s4._buyerVolume.set(x, i + 1); s4._sellerAddresses.add(x); s4._sellerVolume.set(x, 1); });
  check('B4 全两栖 → rate 1 vol 1', newKGroup(s4), { counterpartyOverlapRate: 1, counterpartyOverlapVolume: 1 });
  const s5 = mk();
  ['a', 'b', 'c'].forEach((x, i) => { s5._buyerAddresses.add(x); s5._buyerVolume.set(x, i + 1); });
  s5._sellerAddresses.add('a'); s5._sellerVolume.set('a', 0); // 两栖但卖量 0
  check('B5 两栖零卖量（interVol 计 buyer 量）', newKGroup(s5), refKGroup(s5));
}

console.log('C. 键集不变式：源码同点成对写锁定（防拆对）');
{
  check('C1 买入同点成对（add 后紧跟 set）',
    /if \(isBuy\) \{\s*\n\s*state\._buyerAddresses\.add\(addr\);\s*\n\s*state\._buyerVolume\.set\(/.test(SRC), true);
  check('C2 卖出同点成对',
    /\} else \{\s*\n\s*state\._sellerAddresses\.add\(addr\);\s*\n\s*state\._sellerVolume\.set\(/.test(SRC), true);
  check('C3 K 组段零 Set 物化残留',
    /new Set\(\[\.\.\.state\._buyerAddresses, \.\.\.state\._sellerAddresses\]\)/.test(SRC), false);
  check('C4 _v 表达式两趟逐字同款（buyerVol 在前的加法次序 bit 一致）',
    (SRC.match(/\(state\._buyerVolume\.get\(_addr\) \|\| 0\) \+ \(state\._sellerVolume\.get\(_addr\) \|\| 0\)/g) || []).length, 2);
}

console.log('D. 迭代序等价反证：乱序插入的地址集合上仍全等（旧 Set 序=插入序）');
{
  // 插入序非字典序：z/a/m 等——两实现都必须按插入序累加，浮点和才 bit 一致
  const state = {
    _buyerAddresses: new Set(['0xz', '0xa', '0xm']),
    _sellerAddresses: new Set(['0xm', '0xq', '0xa', '0xb']),
    _buyerVolume: new Map([['0xz', 0.1], ['0xa', 0.30000000000000004], ['0xm', 7.7]]),
    _sellerVolume: new Map([['0xm', 0.2], ['0xq', 3.3], ['0xa', 1e-13], ['0xb', 0.7]]),
  };
  const got = newKGroup(state), want = refKGroup(state);
  check('D1 乱序插入 Object.is 全等（含 1e-13 量级）',
    [Object.is(got.counterpartyOverlapRate, want.counterpartyOverlapRate),
     Object.is(got.counterpartyOverlapVolume, want.counterpartyOverlapVolume)], [true, true]);
  // 浮点陷阱专项：不同累加序会发散的量集
  const st2 = {
    _buyerAddresses: new Set(['p', 'q', 'r', 's']),
    _sellerAddresses: new Set(['r']),
    _buyerVolume: new Map([['p', 1e16], ['q', 1], ['r', 0.1], ['s', 3]]),
    _sellerVolume: new Map([['r', 0.30000000000000004]]),
  };
  check('D2 大小量悬殊累加（1e16 与 1 混排）仍全等',
    Object.is(newKGroup(st2).counterpartyOverlapVolume, refKGroup(st2).counterpartyOverlapVolume), true);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
