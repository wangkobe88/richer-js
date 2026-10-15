#!/usr/bin/env node
/**
 * _walletNetTokens 聚合单趟合并单测（批次 5b，2026-10-15）
 *
 * buildFactorMap 里 P 组 top3/top5（五变量插入排序）+ GMGN 实时占比 + sniper
 * top20 三趟全遍历 _walletNetTokens——合并为单趟（top20 槽无条件构建，top3/5
 * 从降序前缀派生）。bit 一致论证：
 * - top5 值多重集合恒同：五变量与 20 槽均严格 > 稳定插入，仅消费值
 * - 求和降序左结合同序；_posTotal/_gmgnPos/_sum20/_sumSn 加法链次序逐字保持
 *
 * 对拍方式：源码提取被测真身段 eval（非抄写副本）vs 旧三趟内联参考。
 * 零 DB 零网络。用法：node scripts/_test_wallet_net_single_pass.cjs
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

/** 旧三趟参考（改造前逐字内联形状；maintainTpa/_sniperWallets/creator 经参数注入） */
function refThreePass(state, maintainTpa, sniperWallets) {
  let _nA = 0, _nB = 0, _nC = 0, _nD = 0, _nE = 0;
  for (const v of state._walletNetTokens.values()) {
    if (v <= 0) continue;
    if (v > _nA) { _nE = _nD; _nD = _nC; _nC = _nB; _nB = _nA; _nA = v; }
    else if (v > _nB) { _nE = _nD; _nD = _nC; _nC = _nB; _nB = v; }
    else if (v > _nC) { _nE = _nD; _nD = _nC; _nC = v; }
    else if (v > _nD) { _nE = _nD; _nD = v; }
    else if (v > _nE) { _nE = v; }
  }
  const holderTop3 = _nA + _nB + _nC;
  const holderTop5 = _nA + _nB + _nC + _nD + _nE;

  let gmgnUserPct = null;
  if (maintainTpa) {
    let _posTotal = 0, _gmgnPos = 0;
    for (const [_addr, _net] of state._walletNetTokens) {
      if (_net <= 0) continue;
      _posTotal += _net;
      if ((state._walletRoutedBuyBnb.get(_addr) || 0) > 0) _gmgnPos += _net;
    }
    gmgnUserPct = _posTotal > 0 ? Number(((_gmgnPos / _posTotal) * 100).toFixed(2)) : 0;
  }

  let sniperHolderShare = null;
  if (sniperWallets) {
    const _top20 = [];
    for (const [addr, v] of state._walletNetTokens) {
      if (v <= 0) continue;
      let i = _top20.length;
      while (i > 0 && _top20[i - 1][1] < v) i--;
      if (i >= 20) continue;
      _top20.splice(i, 0, [addr, v]);
      if (_top20.length > 20) _top20.pop();
    }
    let _sum20 = 0, _sumSn = 0;
    for (const [addr, v] of _top20) {
      _sum20 += v;
      if (addr !== state.creatorAddress && sniperWallets.has(addr)) _sumSn += v;
    }
    if (_sum20 > 0) sniperHolderShare = _sumSn / _sum20 * 100;
  }
  return { holderTop3, holderTop5, gmgnUserPct, sniperHolderShare };
}

/** 从源码提取被测真身段（单趟合并版）eval；this._maintainTpa 经 _self 注入 */
const SRC = fs.readFileSync(path.join(__dirname, '../src/services/FourMemeFactorAggregator.js'), 'utf8');
const seg = SRC.match(/const _top20 = \[\];[\s\S]*?if \(_sum20 > 0\) _sniperHolderShare = _sumSn \/ _sum20 \* 100;\s*\n\s*\}/);
if (!seg) { console.error('✗ 未定位单趟段'); process.exit(1); }
function newSinglePass(state, maintainTpa, sniperWallets) {
  const _self = { _maintainTpa: maintainTpa }; // 段内 this._maintainTpa 经 call 绑定注入
  const fn = new Function('state', '_self', '_sniperWallets',
    `${seg[0]}
  return { holderTop3: _holderTop3, holderTop5: _holderTop5, gmgnUserPct: _gmgnUserPct, sniperHolderShare: _sniperHolderShare };`);
  return fn.call(_self, state, _self, sniperWallets);
}

console.log('A. 随机 400 组（四门组合 × 多形状 wallet map）：逐值 Object.is 全等');
{
  let seed = 0xa5b6c7d8;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  let mismatches = [];
  for (let i = 0; i < 400; i++) {
    const maintainTpa = rnd() < 0.5;
    const hasSniper = rnd() < 0.7;
    const state = {
      _walletNetTokens: new Map(),
      _walletRoutedBuyBnb: new Map(),
      creatorAddress: rnd() < 0.5 ? null : `0xw${Math.floor(rnd() * 8)}`,
    };
    const snipers = new Set();
    if (hasSniper) for (let k = 0; k < 4; k++) if (rnd() < 0.6) snipers.add(`0xw${k}`);

    const n = Math.floor(rnd() * 40);
    for (let k = 0; k < n; k++) {
      const addr = `0xw${Math.floor(rnd() * 30)}`;
      const v = rnd() < 0.25 ? (rnd() < 0.5 ? 0 : -rnd()) : rnd() * 10 + (rnd() < 0.1 ? 1e-9 : 0);
      state._walletNetTokens.set(addr, v); // 重复键=覆盖（Map 语义）
      if (maintainTpa && rnd() < 0.4) state._walletRoutedBuyBnb.set(addr, rnd());
    }
    // tie 压力：同值多钱包
    for (let k = 0; k < 6; k++) state._walletNetTokens.set(`0xtie${k}`, 3.7);

    const got = newSinglePass(state, maintainTpa, hasSniper ? snipers : null);
    const want = refThreePass(state, maintainTpa, hasSniper ? snipers : null);
    for (const key of ['holderTop3', 'holderTop5', 'gmgnUserPct', 'sniperHolderShare']) {
      if (!Object.is(got[key], want[key])) mismatches.push([i, key, got[key], want[key]]);
    }
  }
  check('A1 400 组 × 4 键 Object.is 全等', mismatches.length, 0);
  if (mismatches.length) console.log('   首个失配:', JSON.stringify(mismatches[0]));
}

console.log('B. 门矩阵（null 语义锁定）');
{
  const mkState = () => {
    const s = { _walletNetTokens: new Map([['a', 5], ['b', 3], ['c', -1], ['d', 0], ['e', 7.5]]), _walletRoutedBuyBnb: new Map([['a', 1]]), creatorAddress: null };
    return s;
  };
  check('B1 无 TPA 无名单 → gmgn/sniper 均 null',
    newSinglePass(mkState(), false, null), { holderTop3: 15.5, holderTop5: 15.5, gmgnUserPct: null, sniperHolderShare: null });
  const s2 = mkState();
  check('B2 有 TPA 无名单 → gmgn 数值 sniper null',
    newSinglePass(s2, true, null).gmgnUserPct, refThreePass(s2, true, null).gmgnUserPct);
  const s3 = mkState();
  const sn = new Set(['e']);
  check('B3 名单含非 creator 大户 → share=7.5/(7.5+5+3)×100（分母=top20 全体净和）',
    newSinglePass(s3, false, sn).sniperHolderShare, 7.5 / 15.5 * 100);
  const s4 = { _walletNetTokens: new Map([['x', 2], ['y', 2]]), _walletRoutedBuyBnb: new Map(), creatorAddress: 'x' };
  const sn2 = new Set(['x', 'y']);
  check('B4 creator 豁免（x 剔除）→ share=2/4*100',
    newSinglePass(s4, false, sn2).sniperHolderShare, 50);
}

console.log('C. >20 钱包 top20 截断 + top5 派生正确性（浮点陷阱专项）');
{
  const state = { _walletNetTokens: new Map(), _walletRoutedBuyBnb: new Map(), creatorAddress: null };
  const vals = [1e16, 1, 0.1, 3.3, 7, 1e-9, 5, 5, 5, 2.2, 9.9, 4, 8, 6, 0.5, 12, 11, 10, 0.3, 0.7, 13, 14];
  vals.forEach((v, i) => state._walletNetTokens.set(`w${i}`, v));
  const got = newSinglePass(state, false, null), want = refThreePass(state, false, null);
  check('C1 22 钱包（>20 截断）top3/top5 Object.is 全等（1e16 与微量混排）',
    [Object.is(got.holderTop3, want.holderTop3), Object.is(got.holderTop5, want.holderTop5)], [true, true]);
  const sn = new Set(['w0', 'w21', 'w5']);
  const g2 = newSinglePass(state, true, sn), w2 = refThreePass(state, true, sn);
  check('C2 同形状 sniperShare（top20 外名单成员不计）',
    Object.is(g2.sniperHolderShare, w2.sniperHolderShare), true);
}

console.log('D. 源码口径（防回流）');
{
  check('D1 单趟结构（top20 槽无条件 + maintainTpa 门内累加）',
    [/const _top20 = \[\];/.test(SRC),
     /for \(const \[addr, v\] of state\._walletNetTokens\) \{\s*\n\s*if \(v <= 0\) continue;\s*\n\s*if \(this\._maintainTpa\) \{/.test(SRC)].every(Boolean), true);
  check('D2 五变量插入排序旧形状零残留',
    /if \(v > _nA\) \{ _nE = _nD; _nD = _nC; _nC = _nB; _nB = _nA; _nA = v; \}/.test(SRC), false);
  check('D3 top3/top5 从 top20 前缀派生（降序左结合）',
    [/const _nA = _top20\[0\] \? _top20\[0\]\[1\] : 0;/.test(SRC),
     /const _holderTop3 = _nA \+ _nB \+ _nC;/.test(SRC),
     /const _holderTop5 = _nA \+ _nB \+ _nC \+ _nD \+ _nE;/.test(SRC)].every(Boolean), true);
  check('D4 _walletNetTokens 全遍历恰一趟（主聚合段内）',
    (SRC.match(/for \(const \[addr, v\] of state\._walletNetTokens\)/g) || []).length
    + (SRC.match(/for \(const v of state\._walletNetTokens\.values\(\)\)/g) || []).length
    + (SRC.match(/for \(const \[_addr, _net\] of state\._walletNetTokens\)/g) || []).length, 1);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
