#!/usr/bin/env node
/**
 * TokenPool 监控票淘汰单测（批次 3c，2026-10-15）
 *
 * pool Map 长跑零淘汰无界增长——tokenPoolEvictMinAgeMs（fourmemeWs 段，默认 null=关）
 * 显式配置时引擎 5min prune 周期删「monitoring 且 age≥门槛」条目。安全子集：
 * 仅 monitoring（sold 观察窗后仍可再买/inactive/exited 语义未审计不动）+ protected
 * set 双防线（pool status 与引擎状态脱钩时以引擎侧为准）。
 *
 * 零 DB 零网络：Object.create(prototype) 桩引擎实例直调 _evictStaleMonitoringTokens，
 * 假 tokenPool 收 removeToken 调用。
 * 用法：node scripts/_test_token_pool_eviction.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const H = 3600000;

/** 桩引擎：只填 _evictStaleMonitoringTokens 触碰的字段（不跑重构造） */
function mkEngine({ minAgeMs = 24 * H, holdings = [], buying = [], selling = [], buyPending = [], sellPending = [], anchors = [] } = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  eng._tokenPoolEvictMinAgeMs = minAgeMs;
  eng._getAllHoldings = () => holdings;
  eng._buyingTokens = new Set(buying);
  eng._sellingTokens = new Set(selling);
  eng._buyDebouncer = { pending: new Map(buyPending.map(a => [a, {}])) };
  eng._sellConfirmDebouncer = { pending: new Map(sellPending.map(a => [a, {}])) };
  eng._restoreAnchors = new Map(anchors.map(a => [a, {}]));
  eng.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  eng._experimentId = 't';
  return eng;
}
/** 假 pool：记录 removeToken 调用 */
function mkPool(tokens) {
  return {
    tokens, removed: [],
    getAllTokens: () => tokens,
    removeToken(addr, chain) { this.removed.push({ addr, chain }); },
  };
}
function mkToken(addr, status, ageH, extra = {}) {
  return {
    token: addr, chain: 'bsc', status, symbol: 'SYM',
    createdAt: Math.floor((Date.now() - ageH * H) / 1000),
    ...extra,
  };
}

console.log('A. 安全子集：仅 monitoring 超时条目可删');
{
  const pool = mkPool([
    mkToken('0xA1', 'monitoring', 25),   // 唯一合法候选
    mkToken('0xB1', 'bought', 25),       // 持仓恒不删
    mkToken('0xC1', 'selling', 25),      // 卖出中恒不删
    mkToken('0xD1', 'sold', 0.4),        // sold 24min 观察窗内（pool 自身规则可删也不删）
    mkToken('0xD2', 'sold', 48),         // sold 48h 也不删（再买语义，刻意不动）
    mkToken('0xE1', 'exited', 25),       // exited 不删
    mkToken('0xF1', 'inactive', 25),     // inactive 不删
    mkToken('0xA2', 'monitoring', 23),   // monitoring 未达 24h 门槛
  ]);
  const eng = mkEngine({ holdings: [{ tokenAddress: '0xB1' }] });
  eng._tokenPool = pool;
  const n = eng._evictStaleMonitoringTokens();
  check('A1 恰删 1（仅 monitoring 25h）', n, 1);
  check('A2 删的是 0xA1', pool.removed, [{ addr: '0xA1', chain: 'bsc' }]);
}

console.log('B. protected set 双防线（脱钩反证：pool=monitoring 但引擎侧有真状态 → 拦）');
{
  const mk = (fields) => {
    const pool = mkPool([
      mkToken('0xheld', 'monitoring', 30),
      mkToken('0xbuying', 'monitoring', 30),
      mkToken('0xselling', 'monitoring', 30),
      mkToken('0xbuypend', 'monitoring', 30),
      mkToken('0xsellpend', 'monitoring', 30),
      mkToken('0xanchor', 'monitoring', 30),
      mkToken('0xfree', 'monitoring', 30),
    ]);
    const eng = mkEngine(fields);
    eng._tokenPool = pool;
    return { pool, n: eng._evictStaleMonitoringTokens() };
  };
  // 全保护源齐上：只有 0xfree 可删
  const r1 = mk({
    holdings: [{ tokenAddress: '0xHELD' }],           // 大写地址（大小写归一反证）
    buying: ['0xbuying'], selling: ['0xselling'],
    buyPending: ['0xbuypend'], sellPending: ['0xsellpend'],
    anchors: ['0xanchor'],
  });
  check('B1 六路保护全拦+大小写归一（持仓大写拦小写 pool 条目）', r1.n, 1);
  check('B2 删的仅 0xfree', r1.pool.removed, [{ addr: '0xfree', chain: 'bsc' }]);
  // 逐路独立反证：只给一路保护，其余六票应被删、被保护票不在删除列表
  for (const [name, fields, protectedAddr] of [
    ['持仓', { holdings: [{ tokenAddress: '0xheld' }] }, '0xheld'],
    ['买执行中', { buying: ['0xbuying'] }, '0xbuying'],
    ['卖执行中', { selling: ['0xselling'] }, '0xselling'],
    ['买 debounce pending', { buyPending: ['0xbuypend'] }, '0xbuypend'],
    ['卖 debounce pending', { sellPending: ['0xsellpend'] }, '0xsellpend'],
    ['恢复锚点', { anchors: ['0xanchor'] }, '0xanchor'],
  ]) {
    const r = mk(fields);
    check(`B3 ${name} 单路保护恰拦己票（其余 6 票照删）`,
      [r.n, r.pool.removed.some(x => x.addr === protectedAddr)], [6, false]);
  }
}

console.log('C. 守卫与边界');
{
  // C1 null 默认关：getAllTokens 不被碰（零淘汰旧行为）
  let touched = false;
  const eng = mkEngine({ minAgeMs: null });
  eng._tokenPool = { getAllTokens: () => { touched = true; return []; }, removeToken: () => {} };
  check('C1 null 默认→返回 0 且不遍历 pool', [eng._evictStaleMonitoringTokens(), touched], [0, false]);
  // C2 非法值（0/负数）同样关
  const eng2 = mkEngine({ minAgeMs: 0 });
  eng2._tokenPool = { getAllTokens: () => { touched = true; return []; }, removeToken: () => {} };
  check('C2 非法 0→关', eng2._evictStaleMonitoringTokens(), 0);
  // C3 createdAt 缺失 fail-safe 不删
  const pool3 = mkPool([mkToken('0xnan', 'monitoring', 0, { createdAt: undefined })]);
  const eng3 = mkEngine({});
  eng3._tokenPool = pool3;
  check('C3 createdAt 缺失→不删', eng3._evictStaleMonitoringTokens(), 0);
  // C4 恰达门槛（age==minAgeMs）删（>= 语义；30h vs 24h 已由 A 覆盖，此处锁边界不含）
  const pool4 = mkPool([mkToken('0xedge', 'monitoring', 24.0001)]);
  const eng4 = mkEngine({});
  eng4._tokenPool = pool4;
  check('C4 门槛之上删', eng4._evictStaleMonitoringTokens(), 1);
}

console.log('D. 源码口径（防回流）');
{
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const m = src.match(/_evictStaleMonitoringTokens\(\) \{[\s\S]*?\n  \}/);
  check('D1 方法存在', m !== null, true);
  if (m) {
    check('D2 仅 monitoring 单一状态（sold/inactive/exited 刻意不动）',
      /token\.status !== 'monitoring'\) continue;/.test(m[0]), true);
    check('D3 ★sold 再买语义锁定注释在（_onFactorsUpdated status!==bought）',
      /status!=='bought' 语义锁定/.test(src), true);
    check('D4 protected set 六源（持仓/买/卖/两 debouncer/恢复锚点）',
      ['_getAllHoldings()', '_buyingTokens', '_sellingTokens', '_buyDebouncer?.pending', '_sellConfirmDebouncer?.pending', '_restoreAnchors'].every(p => m[0].includes(p)), true);
    check('D5 createdAt fail-safe（Number.isFinite）',
      /Number\.isFinite\(ageMs\)/.test(m[0]), true);
    check('D6 删除走 removeToken(token, chain)（不直捣 pool.delete）',
      /this\._tokenPool\.removeToken\(token\.token, token\.chain\);/.test(m[0]), true);
  }
  check('D7 挂点在 prune interval 内（与 FA prune/TPA 裁剪同周期独立 try/catch）',
    /this\._intervals\.prune = setInterval\(\(\) => \{[\s\S]*?_evictStaleMonitoringTokens\(\);[\s\S]*?\}, this\._pruneIntervalMs\);/.test(src), true);
  check('D8 配置键读取（tokenPoolEvictMinAgeMs ?? null）',
    /this\._tokenPoolEvictMinAgeMs = this\._wsConfig\.tokenPoolEvictMinAgeMs \?\? null;/.test(src), true);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
