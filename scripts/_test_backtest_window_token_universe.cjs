/**
 * 回测时间范围通道 token 宇宙（_loadTokenMetadataFromEvents / 双通道分支 /
 * buildWindowCacheScopeKey）零 DB 零网络单测
 *
 * 背景（2026-11-15 用户需求「回测实验不绑定虚拟实验，只选数据时间范围」）：
 * ticks 直连（experiment_id=NULL）后源实验只剩提供 token 集一个实质作用——新通道
 * 由窗口内 wss_events kind='token_create' 事件派生 token 宇宙，与源实验口径
 * 语义等价（源实验集=其运行期间新创建的票）。
 *
 * 覆盖矩阵：
 *   A. 窗口边界闭区间（gte/lte 边界行收、窗外行不收）
 *   B. 同 token 重复事件行去重取最早 block_time（表无唯一约束）
 *   C. platform 过滤（both=两平台各收、单平台不吞）
 *   D. flap totalSupply=FLAP_TOTAL_SUPPLY（require.cache 哨兵 stub 证明真用了
 *      collector 常量而非硬编码；漏映射=age/流通盘因子静默失真）
 *   E. gang totalSupply=GANG_TOTAL_SUPPLY + gradAmtBnb → graduationThresholdBnb
 *   F. fourmeme 逐键对齐旧通道 _tokenMeta 形状（七键全断言）
 *   G. tokenAddresses 单票裁剪在路由层汇合点共存（D4 调用行所在函数）
 *   H. count>页上限 → 窗口中点二分递归全量收齐；叶子对账失配 throw；二分到
 *      ≤1s 仍超上限 throw（宁拒不漏——**不可**用 id-cursor keyset：无序页任意
 *      子集 + afterId=max(页) 跳过 id≤max 未返回行，gang 先例安全仅因行数远小
 *      于页大小）
 *   I. _initializeDataSources 双通道分支源码锁（两口径皆缺 throw / start≥end
 *      throw / 旧通道源实验校验保留）
 *   J. buildWindowCacheScopeKey：等价输入同 key（ms→toISOString 单一出口防同窗
 *      分裂）、异窗口异 key、win- 前缀格式
 *   K. 旧通道仍在（experiment_tokens 查询保留 + 路由分支）
 *
 * 零 DB：fake supabase 链式 builder（内存数组按 .eq/.gte/.lte 过滤 + count=过滤后
 * 总数 exact 语义）+ Object.create(prototype) stub 直调。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- 哨兵 stub：防 lazy require 拉起真实 collector 依赖链（零网络纪律），
// 哨兵值证明引擎真用了常量（若引擎硬编码 1e9，哨兵断言必失败）
const FLAP_SENTINEL = 1111111111;
const GANG_SENTINEL = 2222222222;
const flapPath = require.resolve('../src/collectors/flap-ankr-ws-collector');
const gangPath = require.resolve('../src/collectors/gang-ankr-ws-collector');
function stubModule(p, exportsObj) {
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [] };
}
stubModule(flapPath, { FLAP_TOTAL_SUPPLY: FLAP_SENTINEL });
stubModule(gangPath, { GANG_TOTAL_SUPPLY: GANG_SENTINEL });

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');
const { BacktestEngine, buildWindowCacheScopeKey } = require(ENGINE_PATH);
const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');

let n = 0;
function ok(cond, label) { n++; assert.ok(cond, label); console.log(`  ✓ ${label}`); }

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-11-14T00:00:00Z');
const DAY = 24 * 3600 * 1000;

// ---- fake supabase：wss_events 过滤查询（count exact 语义）
function makeFakeSupabase(events, opts = {}) {
  const queries = [];
  return {
    from(table) {
      if (table !== 'wss_events') throw new Error(`意外的表查询: ${table}`);
      const state = { eq: {}, gte: null, lte: null, gt: null, limitN: null, wantCount: false, ordered: false };
      const b = {};
      b.select = (cols, o) => { if (o && o.count) state.wantCount = true; return b; };
      b.eq = (c, v) => { state.eq[c] = v; return b; };
      b.gte = (c, v) => { state.gte = [c, v]; return b; };
      b.lte = (c, v) => { state.lte = [c, v]; return b; };
      b.gt = (c, v) => { state.gt = [c, v]; return b; };
      b.order = () => { state.ordered = true; return b; };
      b.limit = (lim) => {
        const rows = events.filter((r) => {
          for (const [c, v] of Object.entries(state.eq)) if (r[c] !== v) return false;
          if (state.gte && !(r[state.gte[0]] >= state.gte[1])) return false;
          if (state.lte && !(r[state.lte[0]] <= state.lte[1])) return false;
          if (state.gt && !(r[state.gt[0]] > state.gt[1])) return false;
          return true;
        });
        queries.push({ eq: { ...state.eq }, gte: state.gte, lte: state.lte, total: rows.length, ordered: state.ordered });
        let data = rows.slice(0, lim);
        if (opts.truncateData && rows.length <= lim && rows.length > 0) data = data.slice(0, rows.length - 1); // 对账失配注入
        return Promise.resolve({ data, count: rows.length, error: null });
      };
      return b;
    },
    _queries: queries,
  };
}

function ev(id, token, platform, payload, blockMs) {
  return { id, token_address: token, platform, payload, block_time: iso(blockMs), kind: 'token_create' };
}

function makeStub({ platforms, startMs, endMs, tokenAddressFilter }) {
  const eng = Object.create(BacktestEngine.prototype);
  eng._platforms = platforms;
  eng._startTimeFilter = startMs;
  eng._endTimeFilter = endMs;
  eng._tokenMeta = new Map();
  eng._tokenAddressFilter = tokenAddressFilter || null;
  eng._sourceExperimentId = null;
  eng._experimentId = 'ut-window';
  eng._warns = [];
  eng._infos = [];
  eng.logger = {
    info: (_id, _src, msg) => eng._infos.push(msg),
    warn: (_id, _src, msg) => eng._warns.push(msg),
  };
  return eng;
}

async function main() {

console.log('A. 窗口边界闭区间');
{
  const events = [
    ev(1, '0xbefore', 'fourmeme', { symbol: 'B' }, T0 - 1),              // 窗外（早 1ms）
    ev(2, '0xstart', 'fourmeme', { symbol: 'S' }, T0),                   // 边界=起点行收
    ev(3, '0xmid', 'fourmeme', { symbol: 'M' }, T0 + 3600 * 1000),
    ev(4, '0xend', 'fourmeme', { symbol: 'E' }, T0 + DAY),               // 边界=终点行收
    ev(5, '0xafter', 'fourmeme', { symbol: 'A' }, T0 + DAY + 1),         // 窗外（晚 1ms）
  ];
  const eng = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  ok(eng._tokenMeta.size === 3, `A1 闭区间 3 票（起点/终点边界行都收，得 ${eng._tokenMeta.size}）`);
  ok(eng._tokenMeta.has('0xstart') && eng._tokenMeta.has('0xend') && eng._tokenMeta.has('0xmid'),
    'A2 边界行恰好是 0xstart/0xend');
  ok(!eng._tokenMeta.has('0xbefore') && !eng._tokenMeta.has('0xafter'), 'A3 窗外行不收');
}

console.log('B. 重复事件行去重取最早');
{
  const events = [
    ev(1, '0xdup', 'fourmeme', { symbol: 'LATE', name: '晚行' }, T0 + 60 * 1000),
    ev(2, '0xdup', 'fourmeme', { symbol: 'EARLY', name: '早行' }, T0 + 5 * 1000),
    ev(3, '0xdup', 'fourmeme', { symbol: 'MID', name: '中行' }, T0 + 30 * 1000),
  ];
  const eng = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  ok(eng._tokenMeta.size === 1, 'B1 同 token 三行去重成 1 票');
  ok(eng._tokenMeta.get('0xdup').symbol === 'EARLY', 'B2 取最早 block_time 行（payload=早行）');
  ok(Math.abs(eng._tokenMeta.get('0xdup').createdAtSec - (T0 + 5 * 1000) / 1000) < 0.001,
    'B3 createdAtSec=最早行 block_time/1000');
}

console.log('C. platform 过滤');
{
  const events = [
    ev(1, '0xf1', 'fourmeme', { symbol: 'F1' }, T0 + 1000),
    ev(2, '0xf2', 'flap', { symbol: 'F2' }, T0 + 2000),
    ev(3, '0xf3', 'gang', { symbol: 'F3' }, T0 + 3000),
  ];
  const engBoth = makeStub({ platforms: ['fourmeme', 'flap'], startMs: T0, endMs: T0 + DAY });
  await engBoth._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  ok(engBoth._tokenMeta.size === 2 && engBoth._tokenMeta.has('0xf1') && engBoth._tokenMeta.has('0xf2'),
    'C1 both=fourmeme+flap 各收（gang 不在 _platforms 不收）');

  const engSingle = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await engSingle._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  ok(engSingle._tokenMeta.size === 1 && engSingle._tokenMeta.has('0xf1'), 'C2 单平台只收本平台');
}

console.log('D. flap totalSupply=collector 常量（哨兵证明）');
{
  const events = [ev(1, '0xfl', 'flap', { symbol: 'FL', name: 'Flap 票', creator: '0xc1' }, T0 + 1000)];
  const eng = makeStub({ platforms: ['flap'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  ok(eng._tokenMeta.get('0xfl').totalSupply === FLAP_SENTINEL,
    `D1 flap totalSupply=FLAP_TOTAL_SUPPLY 常量（哨兵 ${FLAP_SENTINEL}，非硬编码 1e9）`);
}

console.log('E. gang totalSupply 常量 + gradAmtBnb');
{
  const events = [ev(1, '0xga', 'gang',
    { symbol: 'GA', name: 'Gang 票', creator: '0xc2', gradAmtBnb: 15.5 }, T0 + 1000)];
  const eng = makeStub({ platforms: ['gang'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  const meta = eng._tokenMeta.get('0xga');
  ok(meta.totalSupply === GANG_SENTINEL, `E1 gang totalSupply=GANG_TOTAL_SUPPLY 常量（哨兵 ${GANG_SENTINEL}）`);
  ok(meta.graduationThresholdBnb === 15.5, 'E2 payload.gradAmtBnb → graduationThresholdBnb');
}

console.log('F. fourmeme 逐键对齐旧通道 _tokenMeta 形状');
{
  const tMs = T0 + 1234;
  const events = [ev(7, '0xfm', 'fourmeme',
    { symbol: 'FM', name: 'FourMeme 票', totalSupply: '1e9', creator: '0xcc' }, tMs)];
  const eng = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(makeFakeSupabase(events));
  const meta = eng._tokenMeta.get('0xfm');
  ok(meta.symbol === 'FM', 'F1 symbol');
  ok(meta.name === 'FourMeme 票', 'F2 name');
  ok(meta.platform === 'fourmeme', 'F3 platform');
  ok(meta.createdAtSec === tMs / 1000, 'F4 createdAtSec=block_time/1000');
  ok(meta.totalSupply === 1e9, 'F5 totalSupply=Number(payload.totalSupply)（字符串数值可转）');
  ok(meta.creator === '0xcc', 'F6 creator=payload.creator');
  ok(meta.graduationThresholdBnb === null, 'F7 非 gang 无 gradAmtBnb → null');
  // payload.platform 列缺席时行 platform 列兜底（行 platform 列即真相源）
  ok(Object.keys(meta).length === 7, `F8 恰七键（得 ${Object.keys(meta).length}）`);
}

console.log('G. tokenAddresses 裁剪在路由层汇合点共存');
{
  const events = [
    ev(1, '0xkeep', 'fourmeme', { symbol: 'K' }, T0 + 1000),
    ev(2, '0xdrop', 'fourmeme', { symbol: 'D' }, T0 + 2000),
  ];
  const eng = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY, tokenAddressFilter: ['0xkeep'] });
  eng._getClient = () => makeFakeSupabase(events);
  await eng._loadTokenMetadata();   // 路由层（含裁剪块）
  ok(eng._tokenMeta.size === 1 && eng._tokenMeta.has('0xkeep'),
    'G1 新通道 + tokenAddresses 裁剪共存（2→1）');
  ok(eng._warns.some((w) => w.includes('token 集限定')), 'G2 裁剪 warn 打出');
}

console.log('H. count>页上限二分 + fail-loud');
{
  // H1: 1500 行（count>1000）→ 窗口二分，两半各 ≤1000 对账收齐
  const events = [];
  for (let i = 0; i < 1500; i++) {
    events.push(ev(i + 1, `0xtok${i}`, 'fourmeme', { symbol: `T${i}` }, T0 + Math.floor(i * (DAY - 1000) / 1500)));
  }
  const supa = makeFakeSupabase(events);
  const eng = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await eng._loadTokenMetadataFromEvents(supa);
  ok(eng._tokenMeta.size === 1500, `H1 二分后 1500 票全收（得 ${eng._tokenMeta.size}，无重无漏）`);
  ok(supa._queries.length > 1, `H2 触发了二分子查询（共 ${supa._queries.length} 次查询）`);
  ok(supa._queries.every((q) => !q.ordered), 'H3 全程无 ORDER BY（wss_events 红线）');
  ok(supa._queries.every((q) => q.eq.platform === 'fourmeme'), 'H4 platform 单值 .eq（勿 .in 多值）');

  // H2 组: 叶子对账失配（count≤limit 但 data 少）→ throw
  const eng2 = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await assert.rejects(
    () => eng2._loadTokenMetadataFromEvents(makeFakeSupabase([ev(1, '0xx', 'fourmeme', {}, T0 + 1000)], { truncateData: true })),
    /对账失配/
  );
  ok(true, 'H5 count≤页上限但无序页行数<count → throw fail-loud（不静默漏）');

  // H3 组: 窗口≤1s 仍 >1000 行 → throw（物理不可能形状，宁拒不漏）
  const many = [];
  for (let i = 0; i < 1200; i++) many.push(ev(i + 1, `0xsq${i}`, 'fourmeme', { symbol: 'S' }, T0 + 500));
  const eng3 = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + 900 });
  await assert.rejects(
    () => eng3._loadTokenMetadataFromEvents(makeFakeSupabase(many)),
    /二分到 ≤1s 仍/
  );
  ok(true, 'H6 窗口二分到 ≤1s 仍超页上限 → throw（数据形状异常不冒充）');

  // H4 组: 空窗口合法形状（warn 不 throw）
  const eng4 = makeStub({ platforms: ['fourmeme'], startMs: T0, endMs: T0 + DAY });
  await eng4._loadTokenMetadataFromEvents(makeFakeSupabase([]));
  ok(eng4._tokenMeta.size === 0 && eng4._warns.some((w) => w.includes('空 token 集合法形状')),
    'H7 空窗口 warn 留痕不阻断');
}

console.log('I. _initializeDataSources 双通道分支源码锁');
{
  ok(engineSrc.includes('回测实验缺少 token 集口径：需 sourceExperimentId（旧通道）或 startTime+endTime（新通道，二者必填）'),
    'I1 两口径皆缺 throw fail-fast');
  ok(engineSrc.includes('backtest.startTime 必须早于 endTime'),
    'I2 start≥end throw');
  ok(/this\._tickCacheScopeKey = buildWindowCacheScopeKey\(startMs, endMs\);/.test(engineSrc),
    'I3 新通道赋值窗口 scope key');
  ok(/sourceExperimentId: this\._sourceExperimentId \|\| this\._tickCacheScopeKey/.test(engineSrc),
    'I4 缓存键双通道取值（旧=源 id，新=win- 窗口串）');
  ok(engineSrc.includes('源实验不存在: ${this._sourceExperimentId}'),
    'I5 旧通道源实验存在性校验保留');
  ok(engineSrc.includes('_loadTokenMetadataFromEvents') && engineSrc.includes('_loadTokenMetadataFromSourceExperiment'),
    'I6 路由两子函数在文件内');
}

console.log('J. buildWindowCacheScopeKey');
{
  const s = Date.parse('2026-11-14T00:00:00Z');
  const e = s + DAY;
  ok(buildWindowCacheScopeKey(s, e) === buildWindowCacheScopeKey(new Date(s).getTime(), new Date(e).getTime()),
    'J1 等价输入同 key（防同窗分裂）');
  ok(buildWindowCacheScopeKey(s, e) !== buildWindowCacheScopeKey(s, e + 3600 * 1000),
    'J2 异窗口异 key');
  const key = buildWindowCacheScopeKey(s, e);
  ok(/^win-[a-z0-9]+_[a-z0-9]+$/.test(key), `J3 win- 前缀紧凑格式（${key}）`);
  ok(key === 'win-20261114t000000000z_20261115t000000000z', 'J4 确定格式快照（目录名稳定跨进程）');
}

console.log('K. 旧通道仍在');
{
  ok(engineSrc.includes(".from('experiment_tokens')"), 'K1 experiment_tokens 查询保留');
  ok(/if \(this\._sourceExperimentId\) \{\s*\n\s*await this\._loadTokenMetadataFromSourceExperiment\(supabase\);/.test(engineSrc),
    'K2 路由分支：源 id 在场走旧通道');
  ok(/module\.exports = \{ BacktestEngine, compareByChainOrder, filterTokenMetaByAddresses, filterTickRowsByTokenSet, buildWindowCacheScopeKey \};/.test(engineSrc),
    'K3 exports 五件');
}

console.log(`\n全部通过: ${n} 断言`);

}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
