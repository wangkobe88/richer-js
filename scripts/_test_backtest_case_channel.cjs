/**
 * BacktestEngine Case 集合通道单测（2026-11-20 Case 集合管理系统）——零 DB 零网络
 *
 * 覆盖矩阵：
 *   A. buildCaseCacheScopeKey：case-<uuid 小写> 前缀、大小写归一（缓存目录隔离）
 *   B. _loadTokenMetadataFromCaseSet 直调：token_meta 快照 → 七键 _tokenMeta，
 *      与窗口通道逐字节同映射（flap/gang totalSupply 哨兵证明共用 token-create-meta）；
 *      count>1000 fail-loud；对账失配 throw；空集合语义（引擎侧 _initializeDataSources 拒启）
 *   C. _tickSourceQuery：Case 通道 from('case_ticks').eq(collection_id)；非 Case
 *      通道 from('wss_price_ticks') 零过滤（现状 bit 不变）
 *   D. _fetchHeadTickId/_anchorRowExists Case 形状直调：headAnchor 带 collection_id
 *      限定（复合 PK 子树）；anchorExists 必带 collection_id（case 表 id 全表不唯一）
 *   E. 源码锁：_initializeDataSources 三分支（互斥 throw/未 synced throw 列票/空集合
 *      throw/平台并集覆盖 _platforms/allowPartialCaseSync 豁免）；_loadTokenMetadata
 *      三路由；_loadGraduationEvents 表切换；_loadRawTickRows scope key 三分支沿用；
 *      5 处表字面量全部经 _tickSourceQuery（无裸 .from('wss_price_ticks') 残留于装载方法）
 *   F. token-create-meta 共享模块：flap/gang 哨兵 + gradAmtBnb + creator/name 缺省
 *      （窗口通道与 Case 通道同源映射的单一真相源本体）
 *
 * 打桩惯例对齐 _test_backtest_window_token_universe.cjs（require.cache 哨兵 +
 * Object.create(prototype) stub 直调 + 源码正则锁）。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- 哨兵 stub：防 lazy require 拉起真实 collector 依赖链；哨兵值证明真用了常量
const FLAP_SENTINEL = 1111111111;
const GANG_SENTINEL = 2222222222;
function stubModule(p, exportsObj) {
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [] };
}
stubModule(require.resolve('../src/collectors/flap-ankr-ws-collector'), { FLAP_TOTAL_SUPPLY: FLAP_SENTINEL });
stubModule(require.resolve('../src/collectors/gang-ankr-ws-collector'), { GANG_TOTAL_SUPPLY: GANG_SENTINEL });

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');
const { BacktestEngine, buildCaseCacheScopeKey } = require(ENGINE_PATH);
const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
const { tokenMetaFromCreatePayload } = require('../src/trading-engine/core/token-create-meta');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ───────────────── 测试主体（CJS 无顶层 await，包 async main） ─────────────────
(async function main() {

// ───────────────── A. scope key ─────────────────
console.log('A. buildCaseCacheScopeKey');
{
  const key = buildCaseCacheScopeKey('AB12CD34-EF56-0000-0000-0000000000FF');
  ok(key === 'case-ab12cd34-ef56-0000-0000-0000000000ff', `A1 uuid 小写归一（${key}）`);
  ok(buildCaseCacheScopeKey('X') === buildCaseCacheScopeKey('x'), 'A2 大小写不分裂缓存目录');
  ok(buildCaseCacheScopeKey('abc') !== buildCaseCacheScopeKey('abd'), 'A3 异集合异目录');
}

// ───────────────── B. _loadTokenMetadataFromCaseSet 直调 ─────────────────
console.log('B. Case 集合成员装载（七键同映射）');
const ADDR_FLAP = '0x' + 'aa'.repeat(20);
const ADDR_GANG = '0x' + 'bb'.repeat(20);
const ADDR_FM = '0x' + 'cc'.repeat(20);
const CASE_ID = '11111111-2222-3333-4444-555555555555';
function stubEngine() {
  const eng = Object.create(BacktestEngine.prototype);
  eng._tokenMeta = new Map();
  eng._caseCollectionId = CASE_ID;
  eng._caseCollectionName = '测试集合';
  eng.logger = { info: () => {}, warn: () => {}, error: () => {} };
  eng._experimentId = 'test-exp';
  eng.metrics = { processedDataPoints: 0 };
  return eng;
}
function fakeCaseMemberDb(rows, countOverride) {
  const calls = [];
  return {
    calls,
    from(table) {
      const stack = [];
      let countMode = null, limitN = null;
      const self = this;
      const chain = {
        select(c, o) { countMode = o?.count || null; return chain; },
        eq(col, v) { stack.push(['eq', col, v]); return chain; },
        gt(col, v) { stack.push(['gt', col, v]); return chain; },
        in(col, arr) { stack.push(['in', col, arr]); return chain; },
        lte(col, v) { stack.push(['lte', col, v]); return chain; },
        order() { return chain; },
        limit(n) { limitN = n; return chain; },
        async then(res) {
          calls.push({ table, stack, countMode, limitN });
          // case_collection_tokens 查询：测试数据即目标集合成员（.eq(collection_id)
          // 在真实 DB 生效，fake 不再过滤）；countOverride 模拟超限/失配场景
          const total = countOverride != null ? countOverride : rows.length;
          res({ data: rows.slice(0, limitN || rows.length), count: countMode === 'exact' ? total : null, error: null });
        },
      };
      return chain;
    },
  };
}
{
  const members = [
    {
      token_address: ADDR_FLAP, platform: 'flap',
      token_meta: { payload: { symbol: 'FL', name: 'FlapCoin', creator: '0xcreator1' }, blockTimeIso: '2026-11-01T00:00:00Z', platform: 'flap' },
    },
    {
      token_address: ADDR_GANG, platform: 'gang',
      token_meta: { payload: { symbol: 'GA', gradAmtBnb: '15.5' }, blockTimeIso: '2026-11-01T01:00:00Z', platform: 'gang' },
    },
    {
      token_address: ADDR_FM, platform: 'fourmeme',
      token_meta: { payload: { symbol: 'FM', totalSupply: '1e9' }, blockTimeIso: '2026-11-01T02:00:00Z', platform: 'fourmeme' },
    },
  ];
  const eng = stubEngine();
  const db = fakeCaseMemberDb(members);
  eng._getClient = () => db;
  // 直接调成员装载方法（绕过 _loadTokenMetadata 路由）
  await BacktestEngine.prototype._loadTokenMetadataFromCaseSet.call(eng, db);

  const fl = eng._tokenMeta.get(ADDR_FLAP);
  ok(fl && fl.symbol === 'FL' && fl.name === 'FlapCoin' && fl.platform === 'flap'
    && fl.creator === '0xcreator1', 'B1 flap 七键基础四键');
  ok(fl.totalSupply === FLAP_SENTINEL, 'B2 flap totalSupply=collector 哨兵（共用 token-create-meta）');
  ok(fl.createdAtSec === Date.parse('2026-11-01T00:00:00Z') / 1000, 'B3 createdAtSec=blockTimeIso');

  const ga = eng._tokenMeta.get(ADDR_GANG);
  ok(ga.totalSupply === GANG_SENTINEL, 'B4 gang totalSupply 哨兵');
  ok(ga.graduationThresholdBnb === 15.5, 'B5 gang gradAmtBnb → graduationThresholdBnb');

  const fm = eng._tokenMeta.get(ADDR_FM);
  ok(fm.totalSupply === 1e9 && fm.graduationThresholdBnb === null, 'B6 fourmeme totalSupply=payload 数值+无 gradAmt=null');

  // 与共享纯函数逐字节一致（防通道漂移的机制本体）
  ok(JSON.stringify(fl) === JSON.stringify(tokenMetaFromCreatePayload('flap', members[0].token_meta.payload, members[0].token_meta.blockTimeIso)),
    'B7 Case 通道产物与 tokenMetaFromCreatePayload 逐字节一致');

  // count 超限 fail-loud
  const eng2 = stubEngine();
  const db2 = fakeCaseMemberDb(members, 1500);
  eng2._getClient = () => db2;
  let threw = false;
  try { await BacktestEngine.prototype._loadTokenMetadataFromCaseSet.call(eng2, db2); } catch (e) { threw = /超页上限/.test(e.message); }
  ok(threw, 'B8 成员数超 1000 fail-loud（宁拒不漏）');

  // 对账失配 throw
  const eng3 = stubEngine();
  const db3 = fakeCaseMemberDb([]);
  db3.from = () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], count: 3, error: null }) }) }) });
  eng3._getClient = () => db3;
  threw = false;
  try { await BacktestEngine.prototype._loadTokenMetadataFromCaseSet.call(eng3, db3); } catch (e) { threw = /对账失配/.test(e.message); }
  ok(threw, 'B9 无序页与 count 失配 throw');
}

// ───────────────── C/D. ticks 表源切换直调 ─────────────────
console.log('C/D. _tickSourceQuery 与锚/探针形状');
{
  function spyDb() {
    const calls = [];
    const make = () => {
      const stack = [];
      const chain = {
        select(c) { stack.push(['select', c]); return chain; },
        eq(col, v) { stack.push(['eq', col, v]); return chain; },
        gt(col, v) { stack.push(['gt', col, v]); return chain; },
        in(col, arr) { stack.push(['in', col, arr]); return chain; },
        order(col, o) { stack.push(['order', col, o]); return chain; },
        limit(n) { stack.push(['limit', n]); return chain; },
        then(res) { calls.push(...stack); res({ data: [], count: null, error: null }); },
      };
      return chain;
    };
    return {
      calls,
      from(table) { calls.push(['FROM', table]); return make(); },
    };
  }

  // C1 非 Case 通道：from('wss_price_ticks') 零附加过滤（现状 bit 不变）
  const eng0 = stubEngine();
  eng0._caseCollectionId = null;
  const db0 = spyDb();
  eng0._tickSourceQuery(db0);
  ok(db0.calls[0][0] === 'FROM' && db0.calls[0][1] === 'wss_price_ticks' && db0.calls.length === 1,
    'C1 非 Case 通道 wss_price_ticks 零过滤');

  // C2 Case 通道：from('case_ticks') + .eq(collection_id)
  const eng1 = stubEngine();
  const db1 = spyDb();
  const q1 = eng1._tickSourceQuery(db1);
  q1.select('id').limit(1);
  await q1;
  ok(db1.calls[0][0] === 'FROM' && db1.calls[0][1] === 'case_ticks', 'C2 Case 通道 from case_ticks');
  ok(db1.calls.some(op => op[0] === 'eq' && op[1] === 'collection_id' && op[2] === CASE_ID),
    'C3 附加 .eq(collection_id)（漏带=读到别集合行）');

  // D1 _fetchHeadTickId Case 形状（eq(collection_id)+ORDER BY id DESC LIMIT 1）
  const dbH = spyDb();
  eng1._getClient = () => dbH;
  await BacktestEngine.prototype._fetchHeadTickId.call(eng1, dbH);
  ok(dbH.calls[0][0] === 'FROM' && dbH.calls[0][1] === 'case_ticks', 'D1 headAnchor 走 case_ticks');
  ok(dbH.calls.some(op => op[0] === 'order' && op[1] === 'id') && dbH.calls.some(op => op[0] === 'limit' && op[1] === 1),
    'D2 headAnchor ORDER BY id DESC LIMIT 1（复合 PK 子树反向最右叶）');
  ok(dbH.calls.some(op => op[0] === 'eq' && op[1] === 'collection_id'),
    'D3 headAnchor 带 collection_id 限定');

  // D4 _anchorRowExists Case 形状（必须带 collection_id）
  const dbA = spyDb();
  await BacktestEngine.prototype._anchorRowExists.call(eng1, dbA, 42);
  ok(dbA.calls.some(op => op[0] === 'eq' && op[1] === 'id' && String(op[2]) === '42')
    && dbA.calls.some(op => op[0] === 'eq' && op[1] === 'collection_id'),
    'D4 anchorExists=collection_id+id 复合 PK 单行（case 表 id 全表不唯一）');
}

// ───────────────── E. 源码锁（分支/校验/表切换） ─────────────────
console.log('E. 源码锁');
{
  ok(/if \(this\._caseCollectionId\) \{\s*\n\s*if \(this\._sourceExperimentId\) \{/.test(engineSrc)
    && /互斥（Case 集合通道 vs 源实验通道/.test(engineSrc),
    'E1 互斥 fail-fast 在场（case 分支内先判 sourceExperimentId）');
  ok(/allowPartialCaseSync !== true/.test(engineSrc) && /未同步成员/.test(engineSrc),
    'E2 未 synced 成员拒启+豁免键');
  ok(/Case 集合为空（集合是显式资产/.test(engineSrc), 'E3 空集合拒启');
  ok(/this\._platforms = this\._casePlatforms \|\| resolvePlatforms\(this\._platform\)/.test(engineSrc),
    'E4 平台并集覆盖 _platforms');
  ok(/else if \(this\._caseCollectionId\) \{\s*\n\s*await this\._loadTokenMetadataFromCaseSet\(supabase\);/.test(engineSrc),
    'E5 _loadTokenMetadata 三路由');
  ok(/this\._caseCollectionId\s*\?\s*supabase\.from\('case_events'\)\.eq\('collection_id', this\._caseCollectionId\)/.test(engineSrc),
    'E6 graduation Case 通道读 case_events（带 collection_id）');
  ok(/sourceExperimentId \|\| this\._tickCacheScopeKey/.test(engineSrc),
    'E7 _loadRawTickRows scope key 汇合沿用（case-<id> 经 _tickCacheScopeKey）');
  ok((engineSrc.match(/\.from\('wss_price_ticks'\)/g) || []).length === 1,
    'E8 wss_price_ticks 字面量仅剩 _tickSourceQuery 内 1 处（五装载方法全走表源辅助）');
  ok((engineSrc.match(/this\._tickSourceQuery\(supabase\)/g) || []).length >= 5,
    'E9 五装载方法经 _tickSourceQuery（countFetch/keyset/head/probe/anchorExists）');
  ok(/buildCaseCacheScopeKey\(this\._caseCollectionId\)/.test(engineSrc),
    'E10 _initializeDataSources 用 buildCaseCacheScopeKey');
}

// ───────────────── F. 共享映射模块本体 ─────────────────
console.log('F. token-create-meta 共享模块');
{
  const m = tokenMetaFromCreatePayload(null, {}, null);
  ok(m.platform === 'fourmeme' && m.symbol === '' && m.creator === null && m.createdAtSec === null,
    'F1 缺省防御（platform 回落 fourmeme/空串/null）');
  const g = tokenMetaFromCreatePayload('gang', { gradAmtBnb: 0 }, '2026-11-01T00:00:00Z');
  ok(g.graduationThresholdBnb === null, 'F2 gradAmtBnb<=0 → null（不冒充）');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`BacktestEngine Case 通道单测：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

})();
