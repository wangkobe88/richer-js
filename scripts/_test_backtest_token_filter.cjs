/**
 * 回测单票 token 集限定（filterTokenMetaByAddresses / backtest.tokenAddresses）零 DB 单测
 *
 * 背景（2026-11-08 m4ga-v12 案 977689d2，用户裁定原话「只回测一个代币，只取这一个
 * 代币的数据」）：backtest-token-case.cjs create 只锚窗口不限定 token 集——token 集
 * 继承源实验 experiment_tokens 全量（bp46 谱系基底数百票），45min 窗口一筛 80 票同跑：
 * BUY 信号 400+（80 票 ×13 帽）、成交 53 笔跨票、共享资金池争抢污染目标票成交、
 * cheat/BP 门 Jev 配额浪费（每信号真调）。信号时刻早于目标票创建（07:24:38 <
 * 07:39:24）= 污染现场反证。
 *
 * 修复：backtest.tokenAddresses 显式数组 → BacktestEngine._loadTokenMetadata 单点裁剪
 * _tokenMeta（token 集合唯一真相源，ticks 装载/graduation/叙事预载全下游）。
 *
 * 覆盖矩阵：
 *   A. 纯函数：单票裁剪（3→1）/ 多票子集 / 全部命中 removed=0 / missing 报告
 *   B. 大小写：限定地址混大写 → 命中小写 meta 键（归一比较）
 *   C. 空元素防御：addresses 含空串/null → 过滤不进 want
 *   D. 引擎源码锁：ctor 解析 tokenAddresses + 显式空数组 throw 拒启（防静默退化
 *      全量误跑——空数组若走全量=污染方向 fail-open，必须 fail-fast）+
 *      _loadTokenMetadata 调用纯函数 + warn 接线 + 导出
 *   E. 工具源码锁：backtest-token-case.cjs create 写 tokenAddresses=[TOKEN]（单票）
 *
 * 零 DB：纯函数矩阵 + 源码字符串断言（项目既有「源码口径」风格）。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');
const TOOL_PATH = path.join(__dirname, 'backtest-token-case.cjs');

const { filterTokenMetaByAddresses } = require(ENGINE_PATH);
const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
const toolSrc = fs.readFileSync(TOOL_PATH, 'utf8');

let n = 0;
function ok(cond, label) { n++; assert.ok(cond, label); console.log(`  ✓ ${label}`); }

function mkMap(addrs) {
  const m = new Map();
  for (const a of addrs) m.set(a, { symbol: 'X' });
  return m;
}

console.log('A. 纯函数矩阵');
{
  // A1 单票裁剪：3→1，removed=2，missing=[]
  const m = mkMap(['0xaaa', '0xbbb', '0xccc']);
  const r = filterTokenMetaByAddresses(m, ['0xbbb']);
  ok(r.before === 3 && r.kept === 1 && r.removed === 2, `A1 单票 3→1 (removed=${r.removed})`);
  ok(m.has('0xbbb') && !m.has('0xaaa') && !m.has('0xccc'), 'A1 就地删键只剩目标票');

  // A2 多票子集
  const m2 = mkMap(['0x1', '0x2', '0x3', '0x4', '0x5']);
  const r2 = filterTokenMetaByAddresses(m2, ['0x2', '0x4']);
  ok(r2.kept === 2 && r2.removed === 3, `A2 多票子集 5→${r2.kept}`);

  // A3 全部命中 removed=0
  const m3 = mkMap(['0x1']);
  const r3 = filterTokenMetaByAddresses(m3, ['0x1']);
  ok(r3.removed === 0 && r3.kept === 1 && r3.missing.length === 0, 'A3 全命中 removed=0');

  // A4 missing 报告：限定地址不在源表 → missing 列出（其余照常裁剪）
  const m4 = mkMap(['0x1', '0x2']);
  const r4 = filterTokenMetaByAddresses(m4, ['0x2', '0xdead']);
  ok(r4.missing.length === 1 && r4.missing[0] === '0xdead', 'A4 missing 地址报告');
  ok(r4.kept === 1 && !m4.has('0x1'), 'A4 missing 不阻断其余裁剪');
}

console.log('B. 大小写归一');
{
  const m = mkMap(['0xabc0000000000000000000000000000000000001']);
  const r = filterTokenMetaByAddresses(m, ['0xABC0000000000000000000000000000000000001']);
  ok(r.kept === 1 && r.removed === 0 && r.missing.length === 0, 'B1 混大写限定地址命中同票');
  const m2 = mkMap(['0xAbC2']);
  const r2 = filterTokenMetaByAddresses(m2, ['0xabc2']);
  ok(r2.kept === 1 && r2.missing.length === 0, 'B2 meta 键混大写被小写限定命中（双侧归一）');
}

console.log('C. 空元素防御');
{
  const m = mkMap(['0x1', '0x2']);
  const r = filterTokenMetaByAddresses(m, ['0x1', '', null, undefined]);
  ok(r.kept === 1 && r.missing.length === 0, 'C1 空串/null 元素过滤不进 want');
}

console.log('D. 引擎源码锁');
{
  ok(engineSrc.includes('backtestConfig.tokenAddresses'), 'D1 ctor 读 backtestConfig.tokenAddresses');
  ok(engineSrc.includes('拒绝启动（防全量误跑）'), 'D2 显式空数组 fail-fast throw（防静默退化全量）');
  ok(/this\._tokenAddressFilter = null;/.test(engineSrc), 'D3 缺省 null=全量现状 bit 不变');
  ok(engineSrc.includes('filterTokenMetaByAddresses(this._tokenMeta, this._tokenAddressFilter)'),
    'D4 _loadTokenMetadata 调用纯函数（_tokenMeta 单点裁剪）');
  ok(engineSrc.includes('不在源实验 experiment_tokens（将零 ticks 零信号）'),
    'D5 missing loud warn 接线（绝不静默）');
  ok(engineSrc.includes('filterTokenMetaByAddresses'), 'D6 纯函数在引擎文件内定义');
  ok(/module\.exports = \{ BacktestEngine, compareByChainOrder, filterTokenMetaByAddresses \};/.test(engineSrc),
    'D7 导出三件');
}

console.log('E. 工具源码锁');
{
  ok(toolSrc.includes('tokenAddresses: [TOKEN]'), 'E1 backtest-token-case create 写单票限定');
  ok(toolSrc.includes('源实验 token 表裁剪到单票'), 'E2 dry-run 打印限定行（可见性）');
}

console.log(`\n全部通过: ${n} 断言`);
