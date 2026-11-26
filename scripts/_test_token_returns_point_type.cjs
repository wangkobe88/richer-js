#!/usr/bin/env node
/**
 * token-returns 页「点位类型」列单测（2026-11-25）——本地零 DB 零网络
 * （打桩 dbManager/Logger require cache；页面 JS 在 vm 沙箱里跑，stub window/document/fetch）
 *
 * 数据链：trades.signal_id → strategy_signals.metadata.pointType（T216 点位类型，
 * 信号 fire 时刻分类）。列的各态互不冒充：类型徽章 /「-」信号无该段 /「⚠ 类型缺失」
 * 包已启用模块却缺段 /「…」加载中 /「⚠ 信号缺失」；查询失败=整列显式「加载失败」，
 * 绝不渲染成「-」。
 *
 * 覆盖矩阵：
 *   A. DataService.getSignalPointTypesBySignalIds
 *     A1 空入参零 DB 调用 / A2 去重+分批 ≤100+轻列 select+形状映射
 *     A3 250 id → 3 批、并发 ≤8 / A4 DB 报错原样抛出（不被吞成 []）
 *     A5 入参门 isSignalId（路由直调；含 2000 随机 uuid 性质测试+六段串事故反证）
 *   B. 页面渲染（vm 沙箱直调真实渲染函数）
 *     B1 买入信号索引口径 / B2 单信号片段各态+转义 / B3 单元去重与顺序
 *     B4 FIFO 交易对携带匹配买入信号 / B5 加列三处同步对齐锁 / B6 加载状态机
 *
 * 用法：node scripts/_test_token_returns_point_type.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}${detail !== undefined ? `\n      实际: ${detail}` : ''}`); }
}

// ───────────────── A. DataService ─────────────────
console.log('A. getSignalPointTypesBySignalIds（打桩 supabase）');
const dbManagerPath = require.resolve('../src/services/dbManager');
const loggerPath = require.resolve('../src/services/logger');
const dbCalls = [];
const dbRowsById = new Map();
let dbError = null;
let inFlight = 0, maxInFlight = 0;

const stubSupabase = {
  from(table) {
    const q = {
      table, cols: null, eqs: [], ins: [],
      select(s) { this.cols = s; return this; },
      eq(c, v) { this.eqs.push([c, v]); return this; },
      in(c, list) { this.ins.push([c, list]); return this; },
      // await query：模拟网络停顿以观测并发上限
      then(resolve) {
        const snapshot = { table: q.table, cols: q.cols, eqs: q.eqs, ins: q.ins };
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          dbCalls.push(snapshot);
          if (dbError) return resolve({ data: null, error: dbError });
          const [, list] = snapshot.ins[0];
          resolve({ data: list.filter((id) => dbRowsById.has(id)).map((id) => dbRowsById.get(id)), error: null });
        }, 5);
      },
    };
    return q;
  },
};
class StubLogger { info() {} warn() {} error() {} debug() {} }
require.cache[dbManagerPath] = {
  id: dbManagerPath, filename: dbManagerPath, loaded: true,
  exports: { dbManager: { getClient: () => stubSupabase } },
};
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: StubLogger };

const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

// PostgREST `metadata->pointType` 实测形状（2026-11-25 本地 3 行探针）：子键摊平到行顶层
dbRowsById.set('id-a', { id: 'id-a', token_address: '0xa', pointType: { type: 'normal', label: '普通点位', policy: {}, version: 'PT47', snapshot: {} } });
dbRowsById.set('id-b', { id: 'id-b', token_address: '0xb' }); // 缺段：键不出现

async function testService() {
  const svc = new ExperimentDataService();
  dbCalls.length = 0;

  // A1
  for (const empty of [undefined, null, 'x', [], ['', null, 7]]) {
    const r = await svc.getSignalPointTypesBySignalIds('exp1', empty);
    ok(Array.isArray(r) && r.length === 0, `A1 空入参 ${JSON.stringify(empty)} → []`);
  }
  ok(dbCalls.length === 0, 'A1 空入参零 DB 调用');

  // A2
  const r2 = await svc.getSignalPointTypesBySignalIds('exp1', ['id-a', 'id-b', 'id-a', 'id-zzz']);
  ok(dbCalls.length === 1, `A2 去重后单批（实际 ${dbCalls.length} 批）`);
  ok(dbCalls[0].table === 'strategy_signals', 'A2 查 strategy_signals 表');
  ok(dbCalls[0].cols === 'id, token_address, metadata->pointType', 'A2 轻列 select（只取 JSON 子键，禁 select *）', dbCalls[0].cols);
  ok(dbCalls[0].eqs.length === 1 && dbCalls[0].eqs[0][0] === 'experiment_id' && dbCalls[0].eqs[0][1] === 'exp1', 'A2 experiment_id 等值限定（实验域护栏）');
  ok(dbCalls[0].ins.length === 1 && dbCalls[0].ins[0][0] === 'id', 'A2 .in 走 id 主键列');
  assert.deepStrictEqual([...dbCalls[0].ins[0][1]], ['id-a', 'id-b', 'id-zzz']);
  ok(true, 'A2 .in 列表=去重后入参原序');
  assert.deepStrictEqual(r2, [
    { signal_id: 'id-a', token_address: '0xa', point_type: { type: 'normal', label: '普通点位', policy: {}, version: 'PT47', snapshot: {} } },
    { signal_id: 'id-b', token_address: '0xb', point_type: null },
  ]);
  ok(true, 'A2 返回形状：子键映射 point_type，缺段 → null，查无 id 不产出行');

  // A3
  dbCalls.length = 0; maxInFlight = 0;
  const many = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  await svc.getSignalPointTypesBySignalIds('exp1', many);
  const sizes = dbCalls.map((c) => c.ins[0][1].length);
  ok(dbCalls.length === 3 && sizes.join(',') === '100,100,50', `A3 250 id → 100/100/50 三批（实际 ${sizes.join(',')}）`);
  ok(sizes.every((n) => n <= 100), 'A3 单批 ≤100（URL 长度 + max-rows 1000 双上限内）');
  ok(maxInFlight <= 8, `A3 并发 ≤8（实测峰值 ${maxInFlight}）`);
  const flat = dbCalls.flatMap((c) => [...c.ins[0][1]]);
  assert.deepStrictEqual(flat, many);
  ok(true, 'A3 分批覆盖全量入参不丢不重');

  // A4（PostgREST 错误是普通对象 {message,code}——路由侧读 .message 转 500，须原样上抛）
  dbError = { message: 'boom', code: 'XX000' };
  const caught = await svc.getSignalPointTypesBySignalIds('exp1', ['id-a']).then(() => null, (e) => e);
  ok(caught === dbError && caught.message === 'boom', 'A4 DB 报错原样抛出（不被吞成 [] 冒充「无类型」）', caught);
  dbError = null;

  // A5 入参门（路由 POST /signals/point-types 直接调用本函数）。事故现场：首版正则
  // 误写成六段 8-4-4-4-4-12，合法 ID 全被 400——当时入参门零测试覆盖，端到端才暴露
  const { v4: uuidv4 } = require('uuid');
  const random = Array.from({ length: 2000 }, () => uuidv4());
  ok(random.every(ExperimentDataService.isSignalId), 'A5 2000 个随机 uuid v4 全部通过形状校验');
  ok(random.every((id) => ExperimentDataService.isSignalId(id.toUpperCase())), 'A5 大写十六进制全部通过');
  ok(ExperimentDataService.isSignalId('00099963-0604-470c-ba8c-f7b21a47ee32'), 'A5 真实信号 ID（bt-v274 实测行）通过');
  ok(random.every((id) => !ExperimentDataService.isSignalId(id.slice(0, -1))), 'A5 任意合法 ID 删一字符即拒');
  for (const [label, v] of [
    ['六段串', '377a7306-1e48-4fd6-8f79-7b0b-6ebc5db2'],
    ['手敲漏字符（35 位）', '377a7306-1e48-4fd6-8f79-b0b6ebc5db2'],
    ['非十六进制 g', '377a7306-1e48-4fd6-8f79-7b0b6ebc5dbg'],
    ['多一字符', '377a7306-1e48-4fd6-8f79-7b0b6ebc5db21'],
    ['首尾空白', ' 377a7306-1e48-4fd6-8f79-7b0b6ebc5db2'],
    ['非 uuid 文本', 'not-a-uuid'], ['空串', ''], ['null', null], ['数字', 7], ['对象', {}], ['undefined', undefined],
  ]) {
    ok(ExperimentDataService.isSignalId(v) === false, `A5 拒 ${label}`);
  }
  ok(!['not-a-uuid', null, 7, ''].every(ExperimentDataService.isSignalId)
    && ['not-a-uuid', random[0]].every(ExperimentDataService.isSignalId) === false
    && [random[0], random[1]].every(ExperimentDataService.isSignalId) === true, 'A5 Array.every 接线形状：混入一个非法即整体拒');
}

// ───────────────── B. 页面渲染（vm 沙箱）─────────────────
const PAGE_JS = path.join(__dirname, '..', 'src', 'web', 'static', 'js', 'experiment_token_returns.js');
const PAGE_HTML = path.join(__dirname, '..', 'src', 'web', 'templates', 'experiment_token_returns.html');

function makePage() {
  const fetchLog = [];
  let fetchImpl = async () => ({ ok: false });
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      addEventListener() {}, getElementById: () => null, querySelectorAll: () => [],
    },
    window: { location: { pathname: '/experiment/exp1/token-returns' } },
    navigator: {},
    setTimeout, clearTimeout,
    fetch: (url, opts) => { fetchLog.push({ url, opts }); return fetchImpl(url, opts); },
    __setFetch(impl) { fetchImpl = impl; },
    __fetchLog: fetchLog,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PAGE_JS, 'utf8'), sandbox, { filename: 'experiment_token_returns.js' });
  const Page = vm.runInContext('ExperimentTokenReturns', sandbox);
  const page = new Page(); // init() 异步：fetch 桩返回 ok:false → loadData 走 catch 分支收尾
  return { page, sandbox };
}

const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });

/** 合成成交行（形状对齐 /api/experiment/:id/trades：字符串金额 + signal_id） */
function trade(over) {
  return {
    token_address: '0xtoken', token_symbol: 'TST', trade_direction: 'buy', trade_status: 'success',
    input_amount: '0.1', output_amount: '1000', unit_price: '0.0001',
    created_at: '2026-10-20T00:00:10Z', signal_id: 's1', metadata: {}, chain: 'bsc',
    ...over,
  };
}

/** vm 沙箱=独立 realm（数组/对象原型不同）：其产物深比较前先 JSON 往返归一化 */
const plain = (v) => JSON.parse(JSON.stringify(v));
const TD_RE = /<td[\s\S]*?<\/td>/g;
const TH_RE = /<th[\s\S]*?<\/th>/g;

async function testPage() {
  const { page, sandbox } = makePage();
  await new Promise((r) => setTimeout(r, 20)); // 等 init() 的 loadData 失败分支收尾

  // ── B1 买入信号索引口径 ──
  page.tradesData = [
    // API 实际返回序=created_at 倒序，这里照搬倒序输入验证索引内排序
    trade({ trade_direction: 'sell', signal_id: 's9', created_at: '2026-10-20T00:00:30Z' }),
    trade({ trade_direction: 'BUY', signal_id: 's1', created_at: '2026-10-20T00:00:20Z' }), // 同信号第二笔（大小写臂）
    trade({ signal_id: 's1', created_at: '2026-10-20T00:00:10Z' }),
    trade({ signal_id: 's2', created_at: '2026-10-20T00:00:05Z' }),
    trade({ token_address: '0xmanual', signal_id: null, created_at: '2026-10-20T00:00:02Z' }),
    trade({ trade_status: 'failed', status: 'failed', signal_id: 's3', created_at: '2026-10-20T00:00:01Z' }),
  ];
  page.buildTokenBuySignalIdsMap();
  assert.deepStrictEqual(plain(page.tokenBuySignalIdsMap.get('0xtoken')), ['s2', 's1']);
  ok(true, 'B1 成功买入按成交时间正序、同信号去重、大写 BUY 认买');
  ok(!page.tokenBuySignalIdsMap.has('0xmanual'), 'B1 无 signal_id 成交（手工买）不入索引');
  assert.deepStrictEqual([...page.tokenBuySignalIdsMap.keys()], ['0xtoken']);
  ok(true, 'B1 失败买入/卖出不入索引');

  // ── B2 单信号片段四态 ──
  const COLD_PIT = 'Famous入场-大户在场-长时间冷寂-有买入的低价坑-二波潜力币';
  page.pointTypeBySignalId = new Map([
    ['sPit', { type: 'famous_holder_cold_pit', label: COLD_PIT, policy: {}, version: 'PT47', snapshot: {} }],
    ['sNormal', { type: 'normal', label: '普通点位', policy: {}, version: 'PT47', snapshot: {} }],
    ['sNew', { type: 'brand_new_type', label: '全新类型', version: 'PT99' }],
    ['sLong', { type: 'unregistered_long', label: '做市节奏盘-每块有交易-机械阶梯拉盘-中途深砸次低价坑-闪电毕业暴拉币', version: 'PT99' }],
    ['sPart', { type: 'famous_participation_pit', label: 'Famous参与-坑位-反弹确认-二波潜力币', version: 'PT47' }],
    ['sConv', { type: 'famous_conviction_pit', label: 'Famous/聪明钱高位重参与-深回撤低位坑-反弹确认-二波潜力币', version: 'PT47' }],
    ['sEvil', { type: 'x"<>&', label: '<b>标签</b>', version: 'PT1' }],
    ['sNoLabel', { type: 't' }],
    ['sNoVer', { type: 'strongbacker_solo_dance', label: '一个钱包的独舞' }],
    ['sNone', null],
    ['sStr', 'not-an-object'],
  ]);
  page.pointTypeState = 'loading';
  assert.deepStrictEqual(plain(page._pointTypeFragment('sUnknown')), {
    key: '_loading', html: '<span class="text-gray-500 text-xs" title="点位类型加载中">…</span>',
  });
  ok(true, 'B2 loading 态未缓存 →「…」');
  assert.strictEqual(page._pointTypeFragment('sNone').key, '_none');
  ok(true, 'B2 刷新期命中旧缓存照常出片段（loading 态不吞已知值）');
  page.pointTypeState = 'ready';

  const fMissing = page._pointTypeFragment('sUnknown');
  ok(fMissing.key === '_missing' && fMissing.html.includes('⚠ 信号缺失'), 'B2 ready 态查无 →「⚠ 信号缺失」（不冒充「-」）', fMissing.html);
  const fNone = page._pointTypeFragment('sNone');
  ok(fNone.key === '_none' && fNone.html.includes('>-<'), 'B2 信号无该段（null）→「-」', fNone.html);
  // 实验包已启用 pointType 模块却缺段=信号初始元数据未留存（bt-v274 27/900 BUY 信号实证：
  // 回测写缓冲跨批 UPDATE 整列覆盖）→ 显式标记，不冒充「无类型」
  page.experimentData = { blockchain: 'bsc', config: { strategyResolved: { modules: { pointType: 'PT47' } } } };
  const fLost = page._pointTypeFragment('sNone');
  ok(fLost.key === '_lost' && fLost.html.includes('>⚠ 类型缺失<') && fLost.html.includes('实验策略包已启用 pointType（PT47），但该信号行无类型段'), 'B2 包已启用模块却无该段 →「⚠ 类型缺失」（不冒充「-」）', fLost.html);
  page.experimentData = { blockchain: 'bsc', config: { strategyResolved: { modules: { cheatCheck: 'D3.81' } } } };
  ok(page._pointTypeFragment('sNone').key === '_none', 'B2 包未启用 pointType 模块 →「-」');
  page.experimentData = { blockchain: 'bsc', config: {} };
  ok(page._pointTypeFragment('sNone').key === '_none', 'B2 旧实验（无 strategyResolved）→「-」');
  page.experimentData = undefined;
  ok(page._pointTypeFragment('sStr').key === '_bad', 'B2 非对象段 →「数据异常」');
  ok(page._pointTypeFragment('sNoLabel').key === '_bad', 'B2 缺 label →「数据异常」');

  const fPit = page._pointTypeFragment('sPit');
  ok(fPit.key === 'famous_holder_cold_pit' && fPit.html.includes('>黄金坑<'), 'B2 类型徽章显示短名', fPit.html);
  ok(fPit.html.includes(`title="${COLD_PIT}（famous_holder_cold_pit · PT47）"`), 'B2 tooltip=完整 label（type · version）', fPit.html);
  ok(fPit.html.includes('bg-indigo-900 text-indigo-100 border border-indigo-400'), 'B2 命中类型=indigo 色系（与信号页 pointType 同色）');

  const fNormal = page._pointTypeFragment('sNormal');
  ok(fNormal.html.includes('>普通<') && fNormal.html.includes('bg-gray-600 text-white'), 'B2 normal=灰底「普通」', fNormal.html);
  ok(fNormal.html.includes('普通点位：未命中任何类型，门链按现行全链走（normal · PT47）'), 'B2 normal tooltip 说明兜底语义', fNormal.html);

  const fNew = page._pointTypeFragment('sNew');
  ok(fNew.html.includes('>全新类型<') && fNew.html.includes('bg-indigo-900'), 'B2 未收录 type id → 显示信号自带 label（不依赖短名表）', fNew.html);
  ok(fNew.html.includes('whitespace-nowrap'), 'B2 未收录类型的短 label（全角宽 ≤4）单行', fNew.html);
  const fLong = page._pointTypeFragment('sLong');
  ok(fLong.html.includes('做市节奏盘-每块有交易') && fLong.html.includes('max-w-[7.5rem] whitespace-normal') && !fLong.html.includes('whitespace-nowrap'), 'B2 未收录类型的长 label 限宽折行（列宽不被长 label 撑开）', fLong.html);
  const fPart = page._pointTypeFragment('sPart');
  ok(fPart.html.includes('>参与坑<') && fPart.html.includes('whitespace-nowrap'), 'B2 famous_participation_pit 短名「参与坑」单行', fPart.html);
  ok(page._pointTypeFragment('sConv').html.includes('>强认同坑<'), 'B2 famous_conviction_pit 短名「强认同坑」');

  // 短名表形状锁：本表容器宽度恒定（max-w-7xl），加列空间只能从相邻列挤——短名全部
  // ≤4 全角宽且不含拉丁字母（带英文前缀实测把列撑到 117px 并挤竖排相邻表头）；注册表
  // 每个类型（含 active:false）都有短名，新增类型不补短名=长 label 上表=在此拦截
  const SHORT = plain(vm.runInContext('POINT_TYPE_SHORT', sandbox));
  const { POINT_TYPES } = require('../src/market-analysis/point-type-router');
  assert.deepStrictEqual([...POINT_TYPES.map((t) => t.id)].sort(), Object.keys(SHORT).sort());
  ok(true, `B2 短名表与注册表 ${POINT_TYPES.length} 个类型 id 一一对应`);
  const fwOf = (s) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55), 0);
  const offenders = Object.entries(SHORT).filter(([, v]) => typeof v !== 'string' || !v || fwOf(v) > 4 || /[A-Za-z]/.test(v));
  ok(offenders.length === 0, 'B2 全部短名 ≤4 全角宽且不含拉丁字母', JSON.stringify(offenders));
  const names = Object.values(SHORT);
  ok(new Set(names).size === names.length, 'B2 短名互不重复');
  const fNoVer = page._pointTypeFragment('sNoVer');
  ok(fNoVer.html.includes('>独舞<') && fNoVer.html.includes('（strongbacker_solo_dance）'), 'B2 缺 version → tooltip 无版本尾巴、不出现 undefined', fNoVer.html);

  const fEvil = page._pointTypeFragment('sEvil');
  ok(fEvil.html.includes('&lt;b&gt;标签&lt;/b&gt;') && !/<\/?b>/.test(fEvil.html), 'B2 label HTML 转义', fEvil.html);
  ok(fEvil.html.includes('title="&lt;b&gt;标签&lt;/b&gt;（x&quot;&lt;&gt;&amp; · PT1）"'), 'B2 tooltip 引号/尖括号转义', fEvil.html);

  // ── B3 单元去重与顺序 ──
  page.pointTypeBySignalId.set('sPit2', { type: 'famous_holder_cold_pit', label: COLD_PIT, version: 'PT47' });
  page.pointTypeState = 'error';
  page.pointTypeError = 'HTTP 500 <x>';
  const errCell = page.renderPointTypeCell(['sPit']);
  ok(errCell.includes('加载失败') && errCell.includes('title="HTTP 500 &lt;x&gt;"') && !errCell.includes('黄金坑'), 'B3 error 态整列显式「加载失败」——不渲染缓存值也不渲染「-」', errCell);
  page.pointTypeState = 'ready';
  ok(page.renderPointTypeCell(undefined).includes('>-<') && page.renderPointTypeCell([]).includes('>-<'), 'B3 无买入信号 →「-」');
  const mixed = page.renderPointTypeCell(['sPit', 'sPit2', 'sNormal', 'sUnknown', 'sPit']);
  const order = ['黄金坑', '普通', '⚠ 信号缺失'].map((t) => mixed.indexOf(`>${t}<`) >= 0 ? mixed.indexOf(t) : -1);
  ok(order[0] >= 0 && order[1] > order[0] && order[2] > order[1], 'B3 按类型去重、保持首次出现顺序（黄金坑 → 普通 → 信号缺失）', mixed);
  ok((mixed.match(/黄金坑/g) || []).length === 1, 'B3 同类型多信号只出一个徽章', mixed);

  // ── B4 FIFO 交易对携带匹配买入信号 ──
  page.pointTypeState = 'ready';
  page.tradesData = [
    trade({ signal_id: 'sPit', created_at: '2026-10-20T00:00:10Z' }),                                  // 买 1000
    trade({ signal_id: 'sNormal', created_at: '2026-10-20T00:00:20Z' }),                               // 买 1000
    trade({ trade_direction: 'sell', signal_id: 'sellA', input_amount: '1500', output_amount: '0.3', unit_price: '0.0002', created_at: '2026-10-20T00:00:40Z' }),
    trade({ trade_direction: 'sell', signal_id: 'sellB', input_amount: '500', output_amount: '0.1', unit_price: '0.0002', created_at: '2026-10-20T00:00:50Z' }),
  ];
  page.buildTokenBuySignalIdsMap(); // 生产路径=loadData 内紧跟 tradesData 赋值
  const pnl = page.calculateTokenPnL('0xtoken');
  assert.deepStrictEqual(plain(pnl.tradePairs.map((p) => p.signalIds)), [['sPit', 'sNormal'], ['sNormal']]);
  ok(true, 'B4 跨两笔买入的部分成交对 → 两信号；尾对 → 仅剩余买入信号');
  assert.strictEqual(pnl.tradePairs[0].cost > 0 && Number.isFinite(pnl.tradePairs[0].returnRate), true);
  ok(true, 'B4 既有 pair 字段（cost/returnRate）不受新增字段影响');

  // ── B5 加列三处同步对齐锁 ──
  const html = fs.readFileSync(PAGE_HTML, 'utf8');
  const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  const ths = thead.match(TH_RE);
  // 表头文本=去标签后的「点位类型」（受控断点：两个 nowrap span，窄列只能断成「点位/类型」）
  const thText = (h) => h.replace(/<[^>]+>/g, '').trim();
  const thIdx = ths.findIndex((h) => thText(h) === '点位类型');
  ok(ths.length === 15, `B5 表头 15 列（实际 ${ths.length}）`);
  ok(thIdx === 4 && ths[3].includes('叙事评级') && ths[5].includes('最高涨幅'), `B5 表头「点位类型」位于叙事评级之后（实际下标 ${thIdx}）`);
  ok(ths[thIdx].includes('title="点位类型（T216）'), 'B5 表头带说明 tooltip');
  ok(ths[thIdx].includes('<span class="whitespace-nowrap">点位</span><span class="whitespace-nowrap">类型</span>'), 'B5 表头受控断点（窄列只断成「点位/类型」，不出现「点位类/型」）', ths[thIdx]);
  ok(ths[3].includes('>叙事评级</th>') && thText(ths[5]) === '最高涨幅', 'B5 相邻表头文本未变');

  page.experimentData = { blockchain: 'bsc', config: {} };
  page.tradingMode = null;
  const item = { tokenAddress: '0xtoken', symbol: 'TST', chain: 'bsc', pnl };
  const mainTds = page.renderMainRow(item, true).match(TD_RE);
  const pairTds = page.renderTradePairRow(item, pnl.tradePairs[0], true).match(TD_RE);
  const unmatched = page.renderUnmatchedBuyRow(item, true);
  ok(mainTds.length === 15, `B5 主行 15 个 td（实际 ${mainTds.length}）`);
  ok(pairTds.length === 15, `B5 明细行 15 个 td（实际 ${pairTds.length}）`);
  ok(/colspan="15"/.test(unmatched), 'B5 持仓提示行 colspan=15');
  ok(mainTds[4].includes('>黄金坑<') && mainTds[4].includes('>普通<'), 'B5 主行点位类型列=该代币全部买入信号类型（同列下标 4）', mainTds[4]);
  ok(pairTds[4].includes('>黄金坑<') && pairTds[4].includes('>普通<'), 'B5 明细行点位类型列=该对匹配买入类型（跨两笔买入 → 两类型）', pairTds[4]);
  ok(!pairTds[3].includes('黄金坑') && !mainTds[3].includes('黄金坑'), 'B5 相邻列（叙事评级）未被挤占');
  ok(pairTds[5].includes('买入:'), 'B5 明细行其后各列未错位（下标 5 仍为买卖价）', pairTds[5]);
  ok(mainTds[5].includes('>-<'), 'B5 主行其后各列未错位（下标 5 为最高涨幅）', mainTds[5]);

  // ── B6 加载状态机 ──
  page.tokenBuySignalIdsMap = new Map([['0xtoken', ['s1']], ['0xtoken2', ['s2', 's1']]]);
  page.pointTypeBySignalId = new Map();
  page.pointTypeState = 'loading';
  sandbox.__fetchLog.length = 0; // 清掉首屏 loadData 的请求记录
  sandbox.__setFetch(async () => jsonRes(200, {
    success: true, count: 2,
    data: [
      { signal_id: 's1', token_address: '0xtoken', point_type: { type: 'normal', label: '普通点位', version: 'PT47' } },
      { signal_id: 's2', token_address: '0xtoken2', point_type: null },
    ],
  }));
  await page.loadPointTypeData();
  ok(sandbox.__fetchLog.length === 1, 'B6 单次请求');
  const call = sandbox.__fetchLog[0];
  ok(call.url === '/api/experiment/exp1/signals/point-types' && call.opts.method === 'POST', 'B6 POST /signals/point-types', call.url);
  assert.deepStrictEqual(JSON.parse(call.opts.body), { signalIds: ['s1', 's2'] });
  ok(true, 'B6 请求体=全 token 买入信号 ID 去重子集');
  ok(page.pointTypeState === 'ready', 'B6 成功 → ready');
  assert.deepStrictEqual(plain(page.pointTypeBySignalId.get('s1')), { type: 'normal', label: '普通点位', version: 'PT47' });
  ok(page.pointTypeBySignalId.get('s2') === null, 'B6 缺段行入缓存为 null（与「查无」undefined 区分）');
  ok(page.renderPointTypeCell(['s1']).includes('>普通<'), 'B6 到达后即可渲染');

  sandbox.__setFetch(async () => jsonRes(500, { success: false, error: 'db down', data: [] }));
  page.pointTypeState = 'loading';
  await assert.rejects(() => page.loadPointTypeData(), /HTTP 500/);
  ok(true, 'B6 HTTP 500 → 抛出（由 loadData 置 error 态）');
  sandbox.__setFetch(async () => jsonRes(200, { success: false, error: 'PGRST 42P01' }));
  await assert.rejects(() => page.loadPointTypeData(), /PGRST 42P01/);
  ok(true, 'B6 success:false → 抛出服务端 error');
  sandbox.__setFetch(async () => jsonRes(200, { success: true, data: 'nope' }));
  await assert.rejects(() => page.loadPointTypeData(), /响应格式错误/);
  ok(true, 'B6 data 非数组 → 抛出「响应格式错误」');

  page.tokenBuySignalIdsMap = new Map();
  page.pointTypeState = 'loading';
  sandbox.__fetchLog.length = 0;
  await page.loadPointTypeData();
  ok(sandbox.__fetchLog.length === 0 && page.pointTypeState === 'ready', 'B6 无买入信号 → 零请求直接 ready');
}

(async function main() {
  await testService();
  console.log('B. 页面渲染（vm 沙箱）');
  await testPage();
  console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试执行异常:', e); process.exit(1); });
