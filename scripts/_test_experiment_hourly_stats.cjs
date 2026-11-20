#!/usr/bin/env node
/**
 * 实验统计监控（按小时 × 平台）单测——本地零 DB 零网络
 * （require-cache 打桩 dbManager/Logger，真模块永不加载，_test_trades_filter_columns 同款）。
 *
 * 覆盖：
 *   A 纯函数
 *     A1 bucketTokensByHour：跨小时/平台计数、discovered_at null 跳过计数
 *     A2 bucketGraduationsByHour：交集口径（∈/∉ discoveredSet）、block_time null→unplaced
 *     A3 computeHeatLabel：恰等阈值归上档（>=）、平台分档（同数值不同档）、
 *        GRAD_WEIGHT 权重、gradTotal=null → null（未知不冒充档位）
 *     A4 buildHourSeries：首尾不满 1h 占整点桶、endMs 排他、failedGradPlatforms
 *        null 传播（平台 grad=null → total grad=null → heat=null）
 *     A5 mergeHourBuckets：1h→4h UTC 网格对齐（10/11 点并桶 08、12 点独立桶）、
 *        1d 跨日不并桶、null 传播、合并后 heat 按合并值重算
 *   B 编排（假 supabase client）
 *     B1 普通 both 实验：13 桶、逐桶 platform 计数、毕业双口径、skippedTokenRows
 *     B2 graduation 查询形状（红线）：每查询恰一个 platform 单值 .eq、kind='graduation'、
 *        gte/lt block_time、limit 1000、**链上无 .order 调用**（wss_events 禁 ORDER BY 事故反证）
 *     B3 回测旧通道：token 查询打源实验 ID + tokenUniverseSource 透出
 *     B4 时间范围回测：窗口取 config.backtest.startTime/endTime + 空 token 集合法
 *     B5 运行中实验：windowEnd≈now、windowEndSource='now'
 *     B6 count>1000 触发 ms 二分：无重无漏全量收集
 *     B7 对账失配（count≠data.length）→ platformErrors + 该平台 grad=null + 整体不 throw
 *     B8 token 分页：短页即止；连续满页 31 页 → truncated=true
 *     B9 缓存：60s 内二次调用零新增查询、refresh=1 重查
 *     B10 脏窗口（end<=start）→ 合法空态不 throw
 *
 * 用法：node scripts/_test_experiment_hourly_stats.cjs
 */
'use strict';

// ── 打桩：先污染 require cache 再加载被测模块 ──
const dbManagerPath = require.resolve('../src/services/dbManager');
const loggerPath = require.resolve('../src/services/logger');

class StubLogger {
  constructor() {}
  info() {} warn() {} error() {} debug() {}
}
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true, exports: StubLogger,
};

// 假 supabase：可编程脚本（experiments 行 / token 分页 / graduation 窗口过滤）+ 调用记录
function makeFakeClient(script) {
  const calls = []; // { table, ops: [ [fn, ...args] ] }
  const client = {
    from(table) {
      const ops = [];
      calls.push({ table, ops });
      const b = {
        select: (cols, opts) => { ops.push(['select', cols, opts]); return b; },
        eq: (c, v) => { ops.push(['eq', c, v]); return b; },
        gte: (c, v) => { ops.push(['gte', c, v]); return b; },
        lt: (c, v) => { ops.push(['lt', c, v]); return b; },
        gt: (c, v) => { ops.push(['gt', c, v]); return b; },
        lte: (c, v) => { ops.push(['lte', c, v]); return b; },
        order: (c, o) => { ops.push(['order', c, o]); return b; },
        limit: (n) => { ops.push(['limit', n]); return b; },
        range: (a, z) => { ops.push(['range', a, z]); return b; },
        single: async () => {
          const row = script.experimentsRow || null;
          return row
            ? { data: row, error: null }
            : { data: null, error: { message: '行不存在' } };
        },
        then: (resolve, reject) => execute(table, ops, script).then(resolve, reject),
      };
      return b;
    },
  };
  return { client, calls };
}

async function execute(table, ops, script) {
  const get = (fn, col) => {
    const hit = ops.find(([f, c]) => f === fn && (col === undefined || c === col));
    return hit ? hit[hit.length - 1] : undefined;
  };
  if (table === 'experiments') {
    const row = script.experimentsRow || null;
    return row ? { data: row, error: null } : { data: null, error: { message: '行不存在' } };
  }
  if (table === 'experiment_tokens') {
    const offset = get('range');
    const pages = script.tokenPages || [[]];
    const idx = Math.min(Math.floor(offset / 1000), pages.length - 1);
    const data = pages[idx] || [];
    return { data, error: null };
  }
  if (table === 'wss_events') {
    const platform = get('eq', 'platform');
    const s = new Date(get('gte', 'block_time')).getTime();
    const e = new Date(get('lt', 'block_time')).getTime();
    const kind = get('eq', 'kind');
    if (kind !== 'graduation') return { data: [], count: 0, error: null };
    const out = script.gradWindow(platform, s, e);
    return { data: out.data, count: out.count, error: null };
  }
  return { data: [], error: { message: `未知表 ${table}` } };
}

const { dbManager } = require('../src/services/dbManager');
require.cache[dbManagerPath] = {
  id: dbManagerPath, filename: dbManagerPath, loaded: true,
  exports: { dbManager: { getClient: () => fakeRef.client } },
};

let fakeRef = { client: null };

const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) { console.error(`   失败详情: ${detail || ''}`); process.exit(1); }
};

const svcMod = require('../src/web/services/ExperimentHourlyStatsService');
const {
  ExperimentHourlyStatsService,
  computeHeatLabel, bucketTokensByHour, bucketGraduationsByHour,
  buildHourSeries, mergeHourBuckets,
} = svcMod;

const iso = (s) => new Date(s).toISOString();

async function runService(script) {
  const fake = makeFakeClient(script);
  fakeRef = { client: fake.client };
  const svc = new ExperimentHourlyStatsService();
  return { svc, result: await svc.getHourlyStats('exp-1', {}), calls: fake.calls };
}

async function main() {
  // ═══ A 纯函数 ═══
  // A1 新票分桶
  {
    const { byHour, skippedNull } = bucketTokensByHour([
      { platform: 'fourmeme', discovered_at: iso('2026-11-18T01:10:00Z') },
      { platform: 'fourmeme', discovered_at: iso('2026-11-18T01:50:00Z') },
      { platform: 'flap', discovered_at: iso('2026-11-18T02:20:00Z') },
      { platform: 'flap', discovered_at: null },
    ]);
    check('A1a 跨小时/平台计数', byHour.get(new Date('2026-11-18T01:00:00Z').getTime()).get('fourmeme') === 2
      && byHour.get(new Date('2026-11-18T02:00:00Z').getTime()).get('flap') === 1, JSON.stringify([...byHour.entries()]));
    check('A1b discovered_at null 跳过并计数', skippedNull === 1, String(skippedNull));
  }
  // A2 毕业分桶（交集口径）
  {
    const set = new Set(['0xt1']);
    const { byHour, unplaced } = bucketGraduationsByHour([
      { platform: 'fourmeme', token_address: '0xt1', block_time: iso('2026-11-18T04:00:00Z') },       // ∈ → total+discovered
      { platform: 'fourmeme', token_address: '0xother', block_time: iso('2026-11-18T04:30:00Z') },   // ∉ → 仅 total
      { platform: 'flap', token_address: '0xt1', block_time: null },                                  // → unplaced
    ], set);
    const cell = byHour.get(new Date('2026-11-18T04:00:00Z').getTime()).get('fourmeme');
    check('A2a 交集口径 total=2 discovered=1', cell.total === 2 && cell.discovered === 1, JSON.stringify(cell));
    check('A2b block_time null → unplaced', unplaced === 1, String(unplaced));
  }
  // A3 热度档位
  {
    check('A3a 恰等阈值归上档 hot', computeHeatLabel('fourmeme', 150, 0) === 'hot', computeHeatLabel('fourmeme', 150, 0));
    check('A3b 恰等 active', computeHeatLabel('fourmeme', 60, 0) === 'active', computeHeatLabel('fourmeme', 60, 0));
    check('A3c 恰等 calm', computeHeatLabel('fourmeme', 15, 0) === 'calm', computeHeatLabel('fourmeme', 15, 0));
    check('A3d 阈值下 cold', computeHeatLabel('fourmeme', 14, 0) === 'cold', computeHeatLabel('fourmeme', 14, 0));
    check('A3e 平台分档（gang 12 票=active，fourmeme 同数=cold）',
      computeHeatLabel('gang', 12, 0) === 'active' && computeHeatLabel('fourmeme', 12, 0) === 'cold',
      `${computeHeatLabel('gang', 12, 0)}/${computeHeatLabel('fourmeme', 12, 0)}`);
    check('A3f GRAD_WEIGHT 权重（gang 0 票 1 毕业	score 5 → calm）', computeHeatLabel('gang', 0, 1) === 'calm', computeHeatLabel('gang', 0, 1));
    check('A3g gradTotal=null → null 不冒充', computeHeatLabel('total', 100, null) === null, String(computeHeatLabel('total', 100, null)));
  }
  // A4 小时网格 + failed null 传播
  {
    const tByH = new Map([[new Date('2026-11-18T01:00:00Z').getTime(), new Map([['fourmeme', 2]])]]);
    const gByH = new Map([[new Date('2026-11-18T01:00:00Z').getTime(), new Map([['flap', { total: 1, discovered: 1 }]])]]);
    const hours = buildHourSeries(
      new Date('2026-11-18T00:30:00Z').getTime(),
      new Date('2026-11-18T03:00:00Z').getTime(),
      tByH, gByH, new Set(['flap']),
    );
    check('A4a 首尾不满 1h 占整点桶（00:30~03:00 → 00/01/02 三桶）', hours.length === 3, String(hours.length));
    const h1 = hours[1];
    check('A4b 桶内计数', h1.platforms.fourmeme.newTokens === 2, JSON.stringify(h1.platforms));
    check('A4c 失败平台 grad=null', h1.platforms.flap.gradTotal === null && h1.platforms.flap.gradDiscovered === null, JSON.stringify(h1.platforms.flap));
    check('A4d total grad null 传播（组成不全不冒充合计）', h1.total.gradTotal === null, JSON.stringify(h1.total));
    check('A4e 失败平台/total heat=null', h1.heat.flap === null && h1.heat.total === null, JSON.stringify(h1.heat));
    check('A4f 正常平台 heat 有值', h1.heat.fourmeme === 'cold', String(h1.heat.fourmeme));
  }
  // A5 粒度合并
  {
    const mk = (h, newTokens, gradTotal) => ({
      hourStart: iso(`2026-11-18T${String(h).padStart(2, '0')}:00:00Z`),
      platforms: { fourmeme: { newTokens, gradTotal, gradDiscovered: gradTotal } },
      total: { newTokens, gradTotal, gradDiscovered: gradTotal },
      heat: {},
    });
    // 4h 网格：10/11 点 → 08 桶；12 点 → 12 桶
    const m4 = mergeHourBuckets([mk(10, 3, 0), mk(11, 4, 0), mk(12, 5, 0)], 4);
    check('A5a 4h UTC 网格对齐（10+11→08 桶、12→12 桶）', m4.length === 2
      && m4[0].hourStart === iso('2026-11-18T08:00:00Z') && m4[0].total.newTokens === 7
      && m4[1].hourStart === iso('2026-11-18T12:00:00Z') && m4[1].total.newTokens === 5,
      JSON.stringify(m4.map((x) => [x.hourStart, x.total.newTokens])));
    // 1d 跨日：23 点与次日 01 点不并桶
    const m24 = mergeHourBuckets([mk(23, 1, 0), { ...mk(1, 2, 0), hourStart: iso('2026-11-19T01:00:00Z') }], 24);
    check('A5b 1d 跨日不并桶', m24.length === 2, String(m24.length));
    // null 传播 + heat 重算：两 calm 桶（各 8）合并 16 → fourmeme calm（15 线）→ 16>=15 calm；合并 70 → active
    const mn = mergeHourBuckets([mk(10, 8, null), mk(11, 8, 2)], 4);
    check('A5c null 传播（未知+已知=未知）', mn[0].total.gradTotal === null, JSON.stringify(mn[0].total));
    const mh = mergeHourBuckets([mk(10, 35, 0), mk(11, 35, 0)], 4);
    check('A5d 合并后 heat 按合并值重算（35+35=70 → active）', mh[0].heat.fourmeme === 'active', String(mh[0].heat.fourmeme));
  }

  // ═══ B 编排（假 client）═══
  // 基础脚本：both 实验 00:30~12:00Z
  const baseScript = () => ({
    experimentsRow: {
      id: 'exp-1', experiment_name: '测试实验', trading_mode: 'virtual', status: 'completed',
      started_at: '2026-11-18T00:30:00Z', stopped_at: '2026-11-18T12:00:00Z',
      created_at: '2026-11-18T00:20:00Z', config: { platform: 'both' },
    },
    tokenPages: [[
      { token_address: '0xt1', platform: 'fourmeme', discovered_at: iso('2026-11-18T01:10:00Z') },
      { token_address: '0xt2', platform: 'fourmeme', discovered_at: iso('2026-11-18T02:20:00Z') },
      { token_address: '0xt3', platform: 'flap', discovered_at: iso('2026-11-18T03:30:00Z') },
      { token_address: '0xt4', platform: 'flap', discovered_at: null },
    ]],
    gradWindow: (platform, s, e) => {
      const all = [
        { platform: 'fourmeme', token_address: '0xt1', block_time: iso('2026-11-18T04:00:00Z') },
        { platform: 'fourmeme', token_address: '0xother', block_time: iso('2026-11-18T04:30:00Z') },
        { platform: 'flap', token_address: '0xt3', block_time: iso('2026-11-18T05:00:00Z') },
      ];
      const data = all.filter((r) => r.platform === platform
        && new Date(r.block_time).getTime() >= s && new Date(r.block_time).getTime() < e);
      return { data, count: data.length };
    },
  });

  // B1+B2 普通 both 实验
  {
    const { result, calls } = await runService(baseScript());
    check('B1a fresh=true', result.fresh === true && result.cachedAt, JSON.stringify({ fresh: result.fresh }));
    check('B1b 平台集 both→[fourmeme,flap]', JSON.stringify(result.experiment.platforms) === '["fourmeme","flap"]',
      JSON.stringify(result.experiment.platforms));
    check('B1c 12 桶（00:30~12:00 endMs 排他，桶 00:00~11:00）', result.hours.length === 12, String(result.hours.length));
    const h04 = result.hours[4];
    check('B1d 毕业双口径（04 桶 fourmeme gradTotal=2/discovered=1）',
      h04.platforms.fourmeme.gradTotal === 2 && h04.platforms.fourmeme.gradDiscovered === 1, JSON.stringify(h04.platforms));
    check('B1e 01 桶 fourmeme 新票=1', result.hours[1].platforms.fourmeme.newTokens === 1, JSON.stringify(result.hours[1].platforms));
    check('B1f skippedTokenRows=1', result.warnings.skippedTokenRows === 1, JSON.stringify(result.warnings));
    check('B1g summary 合计 newTokens=3',
      result.summary.total.newTokens === 3
      && result.summary.total.gradTotal === 3 && result.summary.total.gradDiscovered === 2,
      JSON.stringify(result.summary.total));
    check('B1h peakHour 非空', result.summary.peakHour && result.summary.peakHour.hourStart, JSON.stringify(result.summary.peakHour));

    // B2 graduation 查询形状（红线）
    const gradCalls = calls.filter((c) => c.table === 'wss_events');
    check('B2a graduation 查询存在（每平台 6h 分片 11.5h→2 片×2 平台=4 次）', gradCalls.length === 4, String(gradCalls.length));
    for (const c of gradCalls) {
      const platEq = c.ops.filter(([f, col]) => f === 'eq' && col === 'platform');
      check('B2b 恰一个 platform 单值 .eq', platEq.length === 1, JSON.stringify(c.ops));
      check('B2c kind=graduation + gte/lt block_time + limit 1000',
        c.ops.some(([f, col, v]) => f === 'eq' && col === 'kind' && v === 'graduation')
        && c.ops.some(([f, col]) => f === 'gte' && col === 'block_time')
        && c.ops.some(([f, col]) => f === 'lt' && col === 'block_time')
        && c.ops.some(([f, n]) => f === 'limit' && n === 1000),
        JSON.stringify(c.ops));
      check('B2d 链上无 .order（wss_events 禁 ORDER BY 事故反证）',
        !c.ops.some(([f]) => f === 'order'), JSON.stringify(c.ops));
    }
  }
  // B3 回测旧通道 → 源实验 token 宇宙
  {
    const script = baseScript();
    script.experimentsRow.config = { platform: 'fourmeme', backtest: { sourceExperimentId: 'SRC1' } };
    const { result, calls } = await runService(script);
    const tokCalls = calls.filter((c) => c.table === 'experiment_tokens');
    check('B3a token 查询打源实验 ID', tokCalls.length > 0
      && tokCalls.every((c) => c.ops.some(([f, col, v]) => f === 'eq' && col === 'experiment_id' && v === 'SRC1')),
      JSON.stringify(tokCalls.map((c) => c.ops)));
    check('B3b tokenUniverseSource 透出', result.experiment.tokenUniverseSource === 'source-experiment:SRC1',
      result.experiment.tokenUniverseSource);
    check('B3c 窗口仍取 started/stopped', result.experiment.windowSource === 'started_at', result.experiment.windowSource);
  }
  // B4 时间范围回测：窗口取 backtest 配置 + 空 token 集合法
  {
    const script = baseScript();
    script.experimentsRow.config = {
      platform: 'fourmeme',
      backtest: { startTime: '2026-11-18T02:00:00Z', endTime: '2026-11-18T05:00:00Z' },
    };
    script.tokenPages = [[]];
    const { result } = await runService(script);
    check('B4a 窗口取 backtest-config', result.experiment.windowSource === 'backtest-config'
      && result.experiment.windowStart === iso('2026-11-18T02:00:00Z') && result.experiment.windowEnd === iso('2026-11-18T05:00:00Z'),
      JSON.stringify(result.experiment));
    check('B4b 空 token 集=合法形状（3 桶全 0 不 throw）', result.hours.length === 3
      && result.hours.every((h) => Object.keys(h.platforms).length === 0 || Object.values(h.platforms).every((p) => p.newTokens === 0)),
      JSON.stringify(result.hours));
  }
  // B5 运行中实验 → windowEnd≈now
  {
    const script = baseScript();
    script.experimentsRow.stopped_at = null;
    const t0 = Date.now();
    const { result } = await runService(script);
    check('B5 windowEnd≈now + windowEndSource=now', result.experiment.windowEndSource === 'now'
      && Math.abs(new Date(result.experiment.windowEnd).getTime() - t0) < 5000,
      JSON.stringify(result.experiment));
  }
  // B6 count>1000 → ms 二分无重无漏
  {
    const script = baseScript();
    const bulk = [];
    const bulkBase = Date.parse('2026-11-18T01:00:00Z');
    for (let i = 0; i < 1200; i++) {
      bulk.push({
        platform: 'fourmeme',
        token_address: `0xbulk${i}`,
        block_time: iso(bulkBase + Math.floor(i * 900000 / 1200)), // 01:00~01:15 均布（全落首片）
      });
    }
    script.gradWindow = (platform, s, e) => {
      const data = bulk.filter((r) => r.platform === platform
        && new Date(r.block_time).getTime() >= s && new Date(r.block_time).getTime() < e);
      return { data, count: data.length };
    };
    script.tokenPages = [[]];
    script.experimentsRow.config = { platform: 'fourmeme' };
    script.experimentsRow.started_at = '2026-11-18T01:00:00Z';
    script.experimentsRow.stopped_at = '2026-11-18T02:00:00Z';
    const { result, calls } = await runService(script);
    const gradCalls = calls.filter((c) => c.table === 'wss_events');
    check('B6a count>1000 触发二分（查询数>分片数 1）', gradCalls.length > 1, String(gradCalls.length));
    check('B6b 二分无重无漏全量收集（gradTotal=1200）',
      result.hours[0].platforms.fourmeme.gradTotal === 1200, JSON.stringify(result.hours[0].platforms));
  }
  // B7 对账失配 → platformErrors + grad=null + 不炸整体
  {
    const script = baseScript();
    script.gradWindow = (platform) => {
      if (platform === 'fourmeme') return { data: [{ token_address: '0xa', block_time: iso('2026-11-18T04:00:00Z') }], count: 5 }; // 失配
      return { data: [], count: 0 };
    };
    const { result } = await runService(script);
    check('B7a platformErrors 记录失配', /对账失配/.test(result.warnings.platformErrors.fourmeme || ''),
      JSON.stringify(result.warnings.platformErrors));
    check('B7b 失败平台 grad=null（未知≠0）', result.hours[4].platforms.fourmeme.gradTotal === null,
      JSON.stringify(result.hours[4].platforms));
    check('B7c 其余平台照常（flap grad=0 有证据零值）', result.hours[4].platforms.flap.gradTotal === 0,
      JSON.stringify(result.hours[4].platforms));
  }
  // B8 token 分页：31 满页 → truncated
  {
    const script = baseScript();
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      token_address: `0xp${i}`, platform: 'fourmeme', discovered_at: iso('2026-11-18T01:10:00Z'),
    }));
    script.tokenPages = Array.from({ length: 31 }, () => fullPage);
    const { result, calls } = await runService(script);
    const tokCalls = calls.filter((c) => c.table === 'experiment_tokens');
    check('B8a 连续满页到 cap（30 页）停 + truncated=true', result.warnings.tokenRowsTruncated === true && tokCalls.length === 30,
      JSON.stringify({ calls: tokCalls.length, t: result.warnings.tokenRowsTruncated }));
    check('B8b 截断后仍组装出数据（newTokens=30000）', result.summary.total.newTokens === 30000,
      String(result.summary.total.newTokens));
  }
  // B9 缓存
  {
    const fake = makeFakeClient(baseScript());
    fakeRef = { client: fake.client };
    const svc = new ExperimentHourlyStatsService();
    const r1 = await svc.getHourlyStats('exp-1', {});
    const callsAfterFirst = fake.calls.length;
    const r2 = await svc.getHourlyStats('exp-1', {});
    check('B9a 60s 内二次调用零新增查询', fake.calls.length === callsAfterFirst && r2.fresh === false && r2.cachedAt,
      JSON.stringify({ fresh: r2.fresh }));
    const r3 = await svc.getHourlyStats('exp-1', { refresh: true });
    check('B9b refresh=1 重查', r3.fresh === true && fake.calls.length > callsAfterFirst,
      JSON.stringify({ fresh: r3.fresh, calls: fake.calls.length - callsAfterFirst }));
  }
  // B10 脏窗口（end<=start）→ 合法空态
  {
    const script = baseScript();
    script.experimentsRow.started_at = '2026-11-18T12:00:00Z';
    script.experimentsRow.stopped_at = '2026-11-18T12:00:00Z';
    script.experimentsRow.created_at = '2026-11-18T12:00:00Z';
    const { result } = await runService(script);
    check('B10 脏窗口空态不 throw（hours=[] 且带元数据）', Array.isArray(result.hours) && result.hours.length === 0
      && result.experiment.id === 'exp-1', JSON.stringify(result.experiment));
  }

  console.log('\n全部通过 ✅');
}

main().catch((err) => {
  console.error('❌ 单测异常:', err);
  process.exit(1);
});
