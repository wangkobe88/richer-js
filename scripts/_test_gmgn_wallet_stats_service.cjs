#!/usr/bin/env node
/**
 * GMGN 钱包画像层 service 单测（2026-10-18 Agentum/Konasu/7777 sybil 案调研接入）
 * ——本地零 DB 零网络（打桩 dbManager/GMGNPortfolioAPI require cache）。
 *
 * 覆盖（现场反证为本案核心）：
 *   A. computeWalletProfileFactors 纯函数——两案簇指纹：
 *      Konasu（707/707/710 近镜像 + 13:40/13:41 同分钟创建）、
 *      Agentum A（7/7/24~25 镜像 + fresh 4 天前 + created null 不进分母）、
 *      Agentum B（08:38/08:39 差 61s 跨分钟边界——滑动窗命中、固定分钟桶漏）
 *   B. 标签方向性陷阱：smart_degen 正面标签出现在 Konasu 对倒 creator——
 *      键集零「正向放行」键源码口径反证；空标签只计分母
 *   C. 状态机：表命中零 API / 表 miss→fire 补查（成功·空数据行=无记录结论）/
 *      API 失败 covered=0 / refetchBudget 截断 / selected=0 null 放行 /
 *      预算耗尽 covered=0 / inflight join / 预取回写表
 *   D. 门条件草案联动：Konasu 形状门拒（ConditionEvaluator 真跑）
 *
 * 用法：node scripts/_test_gmgn_wallet_stats_service.cjs
 */

'use strict';

// ── 打桩：先污染 require cache 再加载 service（惰性 require 拿 stub）──
// gmgn-api：跟随 _test_gmgn_check_layer 先例直接 require 改 exports（顶层类定义无网络）
const gmgnMod = require('../src/core/gmgn-api');
const apiCalls = [];
let stubApi = null; // { profile } | { empty: true } | { error }
class StubGMGNPortfolioAPI {
  constructor(opts) { this.opts = opts; }
  async getWalletStats(chain, wallet, period) {
    apiCalls.push({ chain, wallet, period });
    if (stubApi && stubApi.error) throw stubApi.error;
    if (stubApi && stubApi.empty) return {};
    return stubApi ? stubApi.profile : null;
  }
}
gmgnMod.GMGNPortfolioAPI = StubGMGNPortfolioAPI;
// dbManager：塞 require.cache stub（真模块永不加载，service key 红线内 DB 零连接）
const dbManagerPath = require.resolve('../src/services/dbManager');
const tableRows = new Map();      // address → 行（表内容）
let tableReads = 0, upserts = [];
const stubClient = {
  from(t) {
    if (t !== 'gmgn_wallet_profiles') throw new Error(`意外表 ${t}`);
    return {
      select(cols) {
        return { async in(col, addrs) {
          tableReads++;
          if (col !== 'address') throw new Error(`意外列 ${col}`);
          const data = addrs.map(a => tableRows.get(a)).filter(Boolean);
          return { data, error: null };
        } };
      },
      async upsert(rows, opts) { upserts.push(...(Array.isArray(rows) ? rows : [rows])); return { data: null, error: null }; },
    };
  },
};
require.cache[dbManagerPath] = {
  id: dbManagerPath, filename: dbManagerPath, loaded: true,
  exports: { dbManager: { getClient: () => stubClient } },
};

const { GmgnWalletStatsService, GWP_FACTOR_KEYS } =
  require('../src/trading-engine/pre-check/GmgnWalletStatsService');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}
const fresh = (cfg) => new GmgnWalletStatsService(cfg, { info() {}, warn() {}, error() {} });

// ── fixture：182 实测标签数据（2026-10-17 调研）──
// Konasu 簇（0xc1db…7777）：三钱包 buy/sell≈707/707、tok≈710（最大相对差 0.42%，
// 精确等不命中、容差命中）；创建 13:40:00/13:41:00/13:39:30（同分钟簇）
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);          // 2026-10-18 12:00 UTC（测试时钟）
const KONASU_T0 = Math.floor(Date.UTC(2026, 9, 17, 13, 40, 0) / 1000);
const pK = (addr, over) => Object.assign({
  address: addr, tags: [], createdAtSec: null, fundFrom: null,
  buy7d: null, sell7d: null, tokenNum7d: null, fetchedAtMs: NOW,
}, over);
const KONASU = [
  pK('wk1', { buy7d: 707, sell7d: 707, tokenNum7d: 710, createdAtSec: KONASU_T0 }),
  pK('wk2', { buy7d: 704, sell7d: 710, tokenNum7d: 707, createdAtSec: KONASU_T0 + 60 }),
  pK('wk3', { buy7d: 710, sell7d: 704, tokenNum7d: 713, createdAtSec: KONASU_T0 - 30 }),
];
// Konasu creator dadca49e：[smart_degen,fomo,gmgn_go,launchpad_smart,gmgn]（正面标签陷阱现场）
const KONASU_CREATOR = pK('dadca49e', {
  tags: ['smart_degen', 'fomo', 'gmgn_go', 'launchpad_smart', 'gmgn'], createdAtSec: KONASU_T0 - 86400 * 200,
});
// Agentum 簇 A（0x76e85a19…7777）：c2847ca4=fresh_wallet 4 天前创建；1ae117b4/bf3a2045
// buy=7/sell=7/tok=24~25（4.2% 容差内）；c30b791d buy=1/tok=4 散户形状；其余 created null
const AGENTUM_A = [
  pK('c2847ca4', { tags: ['fresh_wallet'], createdAtSec: Math.floor(NOW / 1000) - 4 * 86400, buy7d: 3, sell7d: 3, tokenNum7d: 5 }),
  pK('1ae117b4', { buy7d: 7, sell7d: 7, tokenNum7d: 24 }),
  pK('bf3a2045', { buy7d: 7, sell7d: 7, tokenNum7d: 25 }),
  pK('c30b791d', { buy7d: 1, sell7d: 1, tokenNum7d: 4 }),
];
// Agentum 簇 B：两钱包 08:38:59/08:40:00（差 61s 跨分钟边界——固定分钟桶分 38/40 两桶漏）
const AGENTUM_B = [
  pK('wb1', { createdAtSec: Math.floor(Date.UTC(2026, 9, 17, 8, 38, 59) / 1000) }),
  pK('wb2', { createdAtSec: Math.floor(Date.UTC(2026, 9, 17, 8, 40, 0) / 1000) }),
];

const entriesOf = (ps, bnb = 0.15) => ps.map(p => ({ wallet: p.address, bnb }));
const mapOf = (ps) => { const m = new Map(); for (const p of ps) m.set(p.address, p); return m; };

console.log('A. 纯函数簇指纹（Agentum/Konasu 现场反证）');
{
  const f = (ps, now = NOW) => GmgnWalletStatsService.computeWalletProfileFactors(entriesOf(ps), mapOf(ps), {}, now);
  const k = f(KONASU);
  check('A1 Konasu 近镜像：容差臂 3 钱包（707/704/710 相对差 0.85%<1%）', k.gwpNearMirrorClusterWallets === 3, JSON.stringify(k));
  check('A2 Konasu 精确镜像不命中（三元组无全等——精确臂失效是容差臂存在理由）', k.gwpMirrorClusterWallets === 0);
  check('A3 Konasu 创建簇：13:39:30-13:41:00 滑动窗 3 钱包（固定分钟桶分 39/40/41 三桶漏）', k.gwpCreatedClusterWallets === 3);
  check('A4 Konasu 全簇 young（<7d）+ bnb 占比 100', k.gwpYoungCount === 3 && k.gwpYoungBnbPct === 100);

  const a = f(AGENTUM_A);
  check('A5 Agentum A 近镜像 2（7/7/24 vs 7/7/25，tok 4.2%≤10%）', a.gwpNearMirrorClusterWallets === 2, JSON.stringify(a));
  check('A6 Agentum A 精确臂不命中（24≠25）', a.gwpMirrorClusterWallets === 0);
  check('A7 Agentum A young 只数 created 非 null：1（c2847ca4）；null 钱包不进分子不误伤', a.gwpYoungCount === 1);
  check('A8 Agentum A minAge=4.0 天（c2847ca4 锚）', a.gwpMinWalletAgeDays === 4);
  check('A9 Agentum A fresh 标签 1（与 young 分开计数——口径滞后差异）', a.gwpFreshCount === 1 && a.gwpFreshBnbPct === 25);

  const b = f(AGENTUM_B);
  check('A10 Agentum B 创建簇差 61s 跨分钟边界命中：2 钱包（滑动窗反证固定分钟桶）', b.gwpCreatedClusterWallets === 2, JSON.stringify(b));

  // 单钱包不成簇（<2 → 0）
  const single = f([KONASU[0]]);
  check('A11 单钱包创建不成簇（<2 → 0；young/fresh 簇状双门槛同语义）', single.gwpCreatedClusterWallets === 0 && single.gwpMirrorClusterWallets === 0);
  // mirrorMinBuy 门：低频钱包三元组撞型是噪音（c30b791d buy=1 形状 ×2）
  const low = f([pK('x1', { buy7d: 1, sell7d: 1, tokenNum7d: 4 }), pK('x2', { buy7d: 1, sell7d: 1, tokenNum7d: 4 })]);
  check('A12 低频精确镜像不进近镜像臂（buy<5 噪音门）；精确臂 2 照记（观察分离）', low.gwpNearMirrorClusterWallets === 0 && low.gwpMirrorClusterWallets === 2);
  // fundSrc
  const ff = f([pK('y1', { fundFrom: '0xfeeder' }), pK('y2', { fundFrom: '0xfeeder' }), pK('y3', { fundFrom: null })]);
  check('A13 资金同源簇 2（y3 null 不进分母）', ff.gwpFundSrcClusterWallets === 2);
  // young 龄边界：[0, 7d] 闭区间（youngMaxAgeDays=最大龄）
  const edge = f([pK('e1', { createdAtSec: Math.floor(NOW / 1000) - 7 * 86400 })]);
  check('A14 young 龄边界：恰好 7d 算（<= 闭区间判据）', edge.gwpYoungCount === 1, JSON.stringify(edge));
  const edgeOut = f([pK('e2', { createdAtSec: Math.floor(NOW / 1000) - 7 * 86400 - 1 })]);
  check('A14b young 龄越界：7d+1s 不算', edgeOut.gwpYoungCount === 0);
  // 龄不依赖 fresh 标签（标签滞后 4 天才打上——用 created_at 判）
  const noTag = f([pK('n1', { createdAtSec: Math.floor(NOW / 1000) - 2 * 86400 })]);
  check('A15 young 用 created_at 判（无 fresh 标签照数）', noTag.gwpYoungCount === 1 && noTag.gwpFreshCount === 0);
}

console.log('B. 标签方向性陷阱（源码口径反证）');
{
  // smart_degen 正面标签出现在 Konasu 对倒 creator——键集不得含任何正向放行键
  const POSITIVE_KEYS = GWP_FACTOR_KEYS.filter(k => /good|smart|whale|renowned|allow|pass|trust/i.test(k));
  check('B1 GWP_FACTOR_KEYS 零正向放行键（smart_degen 陷阱反证）', POSITIVE_KEYS.length === 0, String(POSITIVE_KEYS));
  // creator 本人参与簇时 smart_degen 不产生任何放行效果：因子输出只有计数键
  const k = GmgnWalletStatsService.computeWalletProfileFactors(
    [{ wallet: 'dadca49e', bnb: 1 }], mapOf([KONASU_CREATOR]), {}, NOW);
  check('B2 smart_degen 钱包输出无放行语义（仅 gmgnUserPct 观察计数）',
    k.gwpGmgnUserPct === 100 && k.gwpYoungCount === 0 && k.gwpCreatedClusterWallets === 0);
  // 空标签钱包只计分母
  const k2 = GmgnWalletStatsService.computeWalletProfileFactors(
    [{ wallet: 'a8662c60', bnb: 1 }], mapOf([pK('a8662c60', { tags: [] })]), {}, NOW);
  check('B3 tags=[] 空标签只计分母（fresh=0/gmgn=0，无标签≠好人≠坏人）',
    k2.gwpFreshCount === 0 && k2.gwpGmgnUserPct === 0);
}

console.log('C. 状态机（打桩表/API）');
const savedKey = process.env.GMGN_API_KEY;
async function withKey(fn) {
  process.env.GMGN_API_KEY = 'test-key';
  try { return await fn(); } finally {
    if (savedKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = savedKey;
  }
}
const cDone = (async () => {
  // C1 表命中零 API：预填表行 → buildFactors 直查表
  tableRows.set('wk1', { address: 'wk1', tags: JSON.stringify(['gmgn']), created_at_sec: KONASU_T0, buy_7d: 707, sell_7d: 707, token_num_7d: 710, fetched_at: new Date().toISOString(), fetch_count: 1 });
  apiCalls.length = 0;
  const svc = fresh();
  const out = await withKey(() => svc.buildFactors([{ wallet: 'wk1', bnb: 0.2 }]));
  check('C1 表命中：covered=1 零 API 调用（离线建库主路径毫秒级）',
    out.gwpCovered === 1 && apiCalls.length === 0 && svc.stats.tableHits === 1, JSON.stringify(out));

  // C2 表 miss → fire 补查成功（wk1 表命中 + wk2 补查：两钱包合成近镜像簇）
  apiCalls.length = 0; stubApi = { profile: { common: { tags: ['gmgn'], created_at: KONASU_T0 + 60 }, buy: 704, sell: 710, pnl_stat: { token_num: 707 } } };
  const svc2 = fresh();
  const out2 = await withKey(() => svc2.buildFactors([{ wallet: 'wk1', bnb: 0.2 }, { wallet: 'wk2', bnb: 0.2 }]));
  check('C2 表 miss fire 补查：refetch=1 covered=1 近镜像与表行合成簇',
    out2.gwpCovered === 1 && out2.gwpRefetchCount === 1 && apiCalls.length === 1
      && out2.gwpNearMirrorClusterWallets === 2, JSON.stringify(out2));
  check('C2b 补查结果回写表（增量资产化）', upserts.some(r => r.address === 'wk2'));

  // C3 API 空数据 =「GMGN 无记录」结论（空行 covered=1；非失败）
  apiCalls.length = 0; stubApi = { empty: true }; tableRows.delete('wnew');
  const svc3 = fresh();
  const out3 = await withKey(() => svc3.buildFactors([{ wallet: 'wnew', bnb: 0.2 }]));
  check('C3 空数据行=无记录结论 covered=1（表 miss ≠ 无记录，须 API 确认）',
    out3.gwpCovered === 1 && out3.gwpProfiled === 1 && out3.gwpSelected === 1);
  check('C3b 无记录空行落表（下次表读即结论，7777 sybil 全新钱包不重复烧配额）',
    upserts.some(r => r.address === 'wnew' && Array.isArray(r.tags) && r.tags.length === 0));

  // C4 API 失败 → covered=0 fail-closed + 冷却内不重打
  apiCalls.length = 0; stubApi = { error: new Error('boom') };
  const svc4 = fresh();
  const out4 = await withKey(() => svc4.buildFactors([{ wallet: 'wfail', bnb: 0.2 }]));
  const calls4 = apiCalls.length;
  const out4b = await withKey(() => svc4.buildFactors([{ wallet: 'wfail', bnb: 0.2 }]));
  check('C4 失败 covered=0（fail-closed）+ 冷却内零重打',
    out4.gwpCovered === 0 && out4.gwpFailed === 1 && apiCalls.length === calls4 && out4b.gwpCovered === 0,
    JSON.stringify({ out4, out4b, calls: apiCalls.length, calls4 }));

  // C5 refetchBudget 截断：3 miss 只补 2 → 第 3 个无结论 covered=0
  apiCalls.length = 0; stubApi = { empty: true };
  const svc5 = fresh({ refetchBudget: 2 });
  const out5 = await withKey(() => svc5.buildFactors(
    [{ wallet: 'm1', bnb: 0.3 }, { wallet: 'm2', bnb: 0.2 }, { wallet: 'm3', bnb: 0.1 }]));
  check('C5 refetchBudget=2：3 miss 补 2，余 1 无结论 covered=0',
    out5.gwpCovered === 0 && out5.gwpRefetchCount === 2 && out5.gwpFailed === 1 && apiCalls.length === 2,
    JSON.stringify(out5));

  // C6 selected=0 → gwpCovered=null 放行形状（early 窗已冻结/无买家）
  const out6 = await fresh().buildFactors([]);
  check('C6 selected=0 → gwpCovered=null（IS NULL 臂放行）', out6.gwpCovered === null && out6.gwpSelected === 0);

  // C7 minBuyBnb 尘埃过滤 + limit 截断 + 小写归一
  const svc7 = fresh({ topWallets: 2, minBuyBnb: 0.05 });
  tableRows.delete('wk1');
  const out7 = await withKey(() => svc7.buildFactors([
    { wallet: '0xUPPER', bnb: 0.3 }, { wallet: 'dust', bnb: 0.004 }, { wallet: 'mid', bnb: 0.1 }]));
  check('C7 尘埃过滤 + top-N 截断 + 小写归一（selected=2）',
    out7.gwpSelected === 2 && out7.gwpProfiled + out7.gwpFailed === 2, JSON.stringify(out7));

  // C8 日预算耗尽 → covered=0
  apiCalls.length = 0; stubApi = { empty: true };
  const svc8 = fresh({ dailyBudget: 1, refetchBudget: 2 });
  await withKey(() => svc8.buildFactors([{ wallet: 'q1', bnb: 0.2 }]));
  const out8 = await withKey(() => svc8.buildFactors([{ wallet: 'q2', bnb: 0.2 }]));
  check('C8 日预算耗尽 covered=0（预算=配额防线；Phase 2 门拒=实质停买须告警——设计内代价）',
    out8.gwpCovered === 0 && out8.gwpRefetchCount === 0);

  // C9 无 API key → covered=0（与 GMGN token 层 no_api_key fail-closed 同语义）
  const svc9 = fresh();
  const out9 = await (async () => {
    const saved = process.env.GMGN_API_KEY; delete process.env.GMGN_API_KEY;
    try { return await svc9.buildFactors([{ wallet: 'nokey', bnb: 0.2 }]); }
    finally { if (saved !== undefined) process.env.GMGN_API_KEY = saved; }
  })();
  check('C9 无 key covered=0', out9.gwpCovered === 0);

  // C10 inflight join：同钱包并发补查合一次
  apiCalls.length = 0; stubApi = { profile: { common: { tags: [], created_at: null } } };
  const svc10 = fresh();
  await withKey(() => Promise.all([
    svc10.buildFactors([{ wallet: 'join1', bnb: 0.2 }]),
    svc10.buildFactors([{ wallet: 'join1', bnb: 0.2 }]),
  ]));
  check('C10 inflight join 同钱包并发一次 API', apiCalls.length === 1, `calls=${apiCalls.length}`);

  // C11 prefetchMiss：miss 钱包后台拉取回写表
  apiCalls.length = 0; stubApi = { profile: { common: { tags: ['fresh_wallet'], created_at: Math.floor(NOW / 1000) - 86400 } } };
  upserts.length = 0;
  const svc11 = fresh();
  const r11 = await withKey(() => svc11.prefetchMiss([{ wallet: 'pf1', bnb: 0.2 }]));
  check('C11 prefetchMiss 拉取+回写表（fire 查表毫秒级的暖库路径）',
    r11.fetched === 1 && upserts.some(x => x.address === 'pf1'));
  // 预取后 fire：表读命中零 API
  apiCalls.length = 0;
  const out11 = await withKey(() => svc11.buildFactors([{ wallet: 'pf1', bnb: 0.2 }]));
  check('C11b 预取后 fire 表命中零 API（gwpLeadMs 由引擎侧传）',
    out11.gwpCovered === 1 && apiCalls.length === 0 && out11.gwpRefetchCount === 0);
})().catch(e => { console.error('[fatal]', e); process.exit(1); });

// D 段与总结须等 C 段（async 状态机）完成——否则 C 段断言漏统计且进程可能先退
cDone.then(() => {
console.log('D. 门条件草案联动（ConditionEvaluator 真跑，Phase 2 形状预验）');
{
  // plan 门草案：IS NULL 放行臂 + covered==1 簇键三臂
  const GATE = '(gwpCovered IS NULL OR (gwpCovered == 1 AND gwpCreatedClusterWallets < 3 AND gwpNearMirrorClusterWallets < 3 AND (gwpYoungCount < 3 OR gwpYoungBnbPct < 60)))';
  const ev = new ConditionEvaluator();
  const eval_ = (ctx) => ev.evaluate(ev.parseCondition(GATE), ctx) === true;
  const konasu = GmgnWalletStatsService.computeWalletProfileFactors(entriesOf(KONASU), mapOf(KONASU), {}, NOW);
  check('D1 Konasu 形状门拒（cCluster=3 ∧ nearMirror=3 ∧ young=3/100%）',
    eval_({ ...konasu, gwpCovered: 1, gwpSelected: 3, gwpProfiled: 3, gwpFailed: 0 }) === false);
  const agentumA = GmgnWalletStatsService.computeWalletProfileFactors(entriesOf(AGENTUM_A), mapOf(AGENTUM_A), {}, NOW);
  check('D2 Agentum A 形状放行（镜像臂不拦 young 臂不拦——两臂分工：c284 young=1<3）',
    eval_({ ...agentumA, gwpCovered: 1, gwpSelected: 4, gwpProfiled: 4, gwpFailed: 0 }) === true);
  const empty = GmgnWalletStatsService.emptyFactors();
  check('D3 未启用/回测 IS NULL 臂放行（emptyFactors 形状）', eval_(empty) === true);
  check('D4 covered=0 拒（fail-closed：预算耗尽/失败）',
    eval_({ ...GmgnWalletStatsService.emptyFactors(), gwpCovered: 0 }) === false);
  // 7777 sybil 形状：5 钱包全部 2 天前创建（young 臂拦）
  const sybil = Array.from({ length: 5 }, (_, i) =>
    pK(`s${i}`, { createdAtSec: Math.floor(NOW / 1000) - 2 * 86400 }));
  const sybilF = GmgnWalletStatsService.computeWalletProfileFactors(entriesOf(sybil), mapOf(sybil), {}, NOW);
  check('D5 7777 sybil 形状 young 臂拦（5 钱包 young 100%）',
    eval_({ ...sybilF, gwpCovered: 1, gwpSelected: 5, gwpProfiled: 5, gwpFailed: 0 }) === false);
  // 键集完整性：emptyFactors 覆盖 GWP_FACTOR_KEYS 全键
  const ek = Object.keys(empty);
  check('D6 emptyFactors 全键 null 覆盖 GWP_FACTOR_KEYS', GWP_FACTOR_KEYS.every(k => empty[k] === null) && ek.length === GWP_FACTOR_KEYS.length);
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
});
