#!/usr/bin/env node
// P9 dev 钱包名单进程内缓存单测（2026-10-13 回测性能案）：前身
// _checkCreatorIsNotBadDevWallet 每次调用 select * from wallets 全表 roundtrip
// （perf 链 3699 次 preBuy 的 parCreator 大头）→ 改为进程加载一次的小写地址 Set。
// 零 DB 零网络：mock supabase 计数查询；Object.create(prototype) 实例覆盖先例
// = _test_backtest_perf_probe。
// 用法：node scripts/_test_prebuy_creator_dev_cache.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

/** 构造带查询计数 mock supabase 的服务实例 */
function mkSvc(rows, opts = {}) {
  const svc = Object.create(PreBuyCheckService.prototype);
  svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
  const state = { queries: 0 };
  svc.supabase = {
    from(table) {
      if (table !== 'wallets') throw new Error(`意外表: ${table}`);
      return {
        select(cols) {
          if (cols !== 'address, category') throw new Error(`意外列: ${cols}`);
          return (async () => {
            state.queries++;
            if (state.failNext) {
              state.failNext = false;
              return { data: null, error: { message: 'db down' } };
            }
            return { data: rows, error: null };
          })();
        },
      };
    },
  };
  state.failNext = false;
  svc._testState = state;
  if (opts.failFirst) state.failNext = true;
  return svc;
}

async function main() {
  const DEV = '0xDEVa1111111111111111111111111111111111111';
  const OK = '0xgood2222222222222222222222222222222222222';
  const rows = [
    { address: DEV, category: 'dev' },
    { address: OK, category: 'whale' },
    { address: null, category: 'dev' }, // 坏行：无地址剔除不炸
  ];

  // ── A. 判定语义（大小写不敏感 / 命中 0 未命中 1 / 空 creator 1 且零查询） ──
  console.log('A. 判定语义');
  {
    const svc = mkSvc(rows);
    eq('A1 dev 地址命中（原文大写）', (await svc._checkCreatorIsNotBadDevWallet(DEV)).creatorIsNotBadDevWallet, 0);
    eq('A2 dev 地址小写形式同样命中', (await svc._checkCreatorIsNotBadDevWallet(DEV.toLowerCase())).creatorIsNotBadDevWallet, 0);
    eq('A3 非 dev 地址放行', (await svc._checkCreatorIsNotBadDevWallet(OK)).creatorIsNotBadDevWallet, 1);
    eq('A4 未知地址放行', (await svc._checkCreatorIsNotBadDevWallet('0xunknown0000000000000000000000000000000000')).creatorIsNotBadDevWallet, 1);

    const svc2 = mkSvc(rows);
    await svc2._checkCreatorIsNotBadDevWallet(null);
    eq('A5 空 creator 默认 1', (await svc2._checkCreatorIsNotBadDevWallet(null)).creatorIsNotBadDevWallet, 1);
    eq('A6 空 creator 零查询', svc2._testState.queries, 0);
  }

  // ── B. 缓存：多次检查只查一次 DB ──
  console.log('B. 进程内缓存');
  {
    const svc = mkSvc(rows);
    await svc._checkCreatorIsNotBadDevWallet(OK);
    await svc._checkCreatorIsNotBadDevWallet(DEV);
    await svc._checkCreatorIsNotBadDevWallet(OK);
    eq('B1 三次检查一次查询', svc._testState.queries, 1);
    check('B2 缓存集仅含 dev 地址（小写）',
      svc._devWalletSet && [...svc._devWalletSet], [DEV.toLowerCase()]);
  }

  // ── C. 失败不缓存：下次调用自然重试（与前身每调用重试一致） ──
  console.log('C. 失败路径');
  {
    const svc = mkSvc(rows, { failFirst: true });
    eq('C1 加载失败保守放行 1', (await svc._checkCreatorIsNotBadDevWallet(DEV)).creatorIsNotBadDevWallet, 1);
    eq('C2 失败后未缓存（下次重试）', svc._devWalletSet, undefined);
    eq('C3 重试成功后命中', (await svc._checkCreatorIsNotBadDevWallet(DEV)).creatorIsNotBadDevWallet, 0);
    eq('C4 共两次查询（失败+成功）', svc._testState.queries, 2);
    await svc._checkCreatorIsNotBadDevWallet(OK);
    eq('C5 缓存后零追加查询', svc._testState.queries, 2);
  }

  // ── D. 真空表也缓存（与失败分流：error 显式判，空 data 是合法终态） ──
  console.log('D. 空表');
  {
    const svc = mkSvc([]);
    eq('D1 空表放行', (await svc._checkCreatorIsNotBadDevWallet(DEV)).creatorIsNotBadDevWallet, 1);
    await svc._checkCreatorIsNotBadDevWallet(DEV);
    eq('D2 空表缓存后零追加查询', svc._testState.queries, 1);
  }

  // ── E. 源码口径反证（红线 13：per-call roundtrip 事故形状锁定） ──
  console.log('E. 源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/pre-check/PreBuyCheckService.js'), 'utf8');
    eq('E1 WalletDataService import 已移除（结构性锁：无 import 即无实例化可能）',
      /require\([^)]*WalletDataService[^)]*\)/.test(src), false);
    eq('E2 源码无 getWallets 调用', /\.getWallets\(\)/.test(src), false);
    eq('E3 缓存判存在', /if \(!this\._devWalletSet\)/.test(src), true);
    // E4：截取方法体，catch 段不得出现缓存赋值（失败不固化）
    const m = src.match(/async _checkCreatorIsNotBadDevWallet[\s\S]*?\n  \}/);
    check('E4 方法体存在', !!m, true);
    if (m) {
      const body = m[0];
      const catchIdx = body.indexOf('catch (error)');
      check('E4 catch 段不写缓存（失败不固化，下次重试）',
        catchIdx > 0 && !/_devWalletSet\s*=/.test(body.slice(catchIdx)), true);
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
