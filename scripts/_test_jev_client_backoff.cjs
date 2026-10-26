#!/usr/bin/env node
/**
 * _test_jev_client_backoff — 3d（2026-10-13 叙事提速第二批）JevClient Retry-After
 *
 * 零 DB 零网络：globalThis.fetch 桩按序吐假响应；setTimeout 包装记录退避值但
 * 立即执行（零真实等待，测试亚秒跑完；AbortController 的 timeoutMs(30000) 记录
 * 也在序列里，按值过滤掉）。断言：
 *   A 段：429/5xx 带 Retry-After → 重试间隔优先按头（覆盖固定表）
 *   B 段：钳制区间 [500, 15000]（过短抬到 500 / 过长压到 15000）
 *   C 段：无头 / 无效头 / 过去的 HTTP-date → 回落固定表 [500, 1500] 逐槽
 *   D 段：非可重试 4xx 立即抛错零退避
 *   E 段：_parseRetryAfterMs 纯函数矩阵
 *   F 段：源码口径（头读取/钳制表达式/常量区间）
 *   G 段：图片 assets（Jev 图片 API，2026-10-26）——带 assets → body 含顶层
 *     assets + TypeSafe-Danger-Zone-Images 头；无/空 assets → 两皆无（头仅带图请求加）
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

function fakeResponse({ status = 200, headers = {}, body = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) },
    text: async () => JSON.stringify(body ?? {}),
    json: async () => body ?? {},
  };
}

const OK_BODY = { model: 'jev-test', answers: { q1: { type: 'choice', choice: 'a' } }, usage: { input_tokens: 10 } };

async function main() {
  process.env.TYPESAFE_API_KEY = 'unit-test-key';

  const { JevClient } = await import(
    path.join(__dirname, '../src/narrative/analyzer/llm/JevClient.mjs')
  );

  // setTimeout 包装：记录退避值，立即执行（零等待）
  const origSetTimeout = globalThis.setTimeout;
  const timerValues = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    timerValues.push(ms);
    return origSetTimeout(fn, 0, ...rest);
  };

  const origFetch = globalThis.fetch;
  const questions = { q1: { type: 'choice', instructions: 'i', criteria: 'c' } };

  /** 跑一次 ask：fetch 按序吐 responses；返回 {result|error, backoffs} */
  async function runAsk(responses) {
    const queue = [...responses];
    const fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      const r = queue.shift();
      if (!r) throw new Error('测试桩耗尽');
      return r;
    };
    try {
      const result = await JevClient.ask('state', questions, { label: 'test' });
      return { result, backoffs: timerValues.filter(v => v !== 30000), fetchCount: fetchCalls.length };
    } catch (e) {
      return { error: e, backoffs: timerValues.filter(v => v !== 30000), fetchCount: fetchCalls.length };
    } finally {
      globalThis.fetch = origFetch;
      timerValues.length = 0;
    }
  }

  // ── A 段：Retry-After 优先于固定表 ──
  console.log('[A] Retry-After 优先');
  {
    const { result, backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': '1' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs.length === 1 && backoffs[0] === 1000, `429 RA=1s → 退避 1000ms（实际 ${backoffs}）`);
    assert(result && result.answers && result.answers.q1, '重试后成功返回校验过答案');
  }
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 503, headers: { 'retry-after': '2' } }),
      fakeResponse({ status: 429, headers: { 'retry-after': '3' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs.length === 2 && backoffs[0] === 2000 && backoffs[1] === 3000,
      `5xx→429 双失败各按头退避 [2000,3000]（实际 ${backoffs}）`);
  }
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': '1.5' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 1500, `小数秒 RA=1.5 → 1500ms（实际 ${backoffs}）`);
  }

  // ── B 段：钳制区间 ──
  console.log('[B] 钳制区间 [500, 15000]');
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': '0.2' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 500, `RA=0.2s(200ms) 抬到下界 500（实际 ${backoffs}）`);
  }
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': '120' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 15000, `RA=120s 压到上界 15000（实际 ${backoffs}）`);
  }

  // ── C 段：无头/无效/过去 → 固定表逐槽 ──
  console.log('[C] 回落固定表 [500, 1500]');
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429 }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 500, `429 无头 → 表槽 1 = 500（实际 ${backoffs}）`);
  }
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429 }),
      fakeResponse({ status: 500 }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs.length === 2 && backoffs[0] === 500 && backoffs[1] === 1500,
      `双失败无头 → [500, 1500] 逐槽（实际 ${backoffs}）`);
  }
  {
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': 'not-a-date' } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 500, `无效头 → 表槽 1（实际 ${backoffs}）`);
  }
  {
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    const { backoffs } = await runAsk([
      fakeResponse({ status: 429, headers: { 'retry-after': pastDate } }),
      fakeResponse({ status: 200, body: OK_BODY }),
    ]);
    assert(backoffs[0] === 500, `过去的 HTTP-date → 表槽 1（实际 ${backoffs}）`);
  }

  // ── D 段：非可重试 4xx 立即抛错 ──
  console.log('[D] 4xx 不重试');
  {
    const { error, backoffs, fetchCount } = await runAsk([
      fakeResponse({ status: 400, body: { message: 'bad request' } }),
    ]);
    assert(error && /HTTP 400/.test(error.message), 'HTTP 400 抛错');
    assert(fetchCount === 1, '零重试（恰 1 次 fetch）');
    assert(backoffs.length === 0, `零退避等待（实际 ${backoffs}）`);
  }

  // ── E 段：_parseRetryAfterMs 纯函数矩阵 ──
  console.log('[E] _parseRetryAfterMs 矩阵');
  {
    const now = 1700000000000;
    assert(JevClient._parseRetryAfterMs(null) === null, 'null 头 → null');
    assert(JevClient._parseRetryAfterMs('') === null, '空头 → null');
    assert(JevClient._parseRetryAfterMs('0') === 0, `'0' → 0（ask 侧钳到 500）`);
    assert(JevClient._parseRetryAfterMs('2') === 2000, `'2' → 2000`);
    assert(JevClient._parseRetryAfterMs('0.5') === 500, `'0.5' → 500`);
    assert(JevClient._parseRetryAfterMs(new Date(now + 4000).toUTCString(), now) === 4000,
      '未来 HTTP-date +4s → 4000');
    assert(JevClient._parseRetryAfterMs(new Date(now - 4000).toUTCString(), now) === null,
      '过去 HTTP-date → null');
    assert(JevClient._parseRetryAfterMs('garbage') === null, '垃圾值 → null');
  }

  // ── F 段：源码口径 ──
  console.log('[F] 源码口径');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/llm/JevClient.mjs'), 'utf8');
    assert(src.includes("response.headers.get('retry-after')"), '直接读 retry-after 头');
    assert(src.includes('Math.min(Math.max(lastRetryAfterMs, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS)'),
      '钳制表达式（min(max(·,500),15000)）');
    assert(src.includes('const RETRY_AFTER_MIN_MS = 500;') && src.includes('const RETRY_AFTER_MAX_MS = 15000;'),
      '钳制常量区间 [500, 15000]');
    assert(src.includes('const retryAfterMs = retryable'), '仅可重试类带出 retryAfterMs');
    assert(src.includes('lastRetryAfterMs = result.retryAfterMs ?? null'), 'ask 侧接上次头值');
  }

  // ── G 段：图片 assets（实验性图片 API）──
  console.log('[G] assets 图片支持');
  {
    const assets = { main_tweet_image: { type: 'image', data_base64: 'aGVsbG8=', format: 'jpeg' } };

    // G1：带 assets → body 顶层含 assets + 危险区头；answers 校验不变
    const captured = [];
    globalThis.fetch = async (url, opts) => {
      captured.push({ url, opts });
      return fakeResponse({ status: 200, body: OK_BODY });
    };
    let g1;
    try {
      g1 = await JevClient.ask('图见 main_tweet_image', questions, { label: 'img-test', assets });
    } finally { globalThis.fetch = origFetch; }
    assert(captured.length === 1, '带 assets 恰一次 fetch（零重试）');
    const body1 = JSON.parse(captured[0].opts.body);
    assert(body1.assets && body1.assets.main_tweet_image.data_base64 === 'aGVsbG8=',
      '请求体含 assets 顶层字段（原样透传）');
    assert(captured[0].opts.headers['TypeSafe-Danger-Zone-Images'] === 'true',
      '带 assets 加 TypeSafe-Danger-Zone-Images: true 头');
    assert(g1 && g1.answers.q1, '带 assets 响应 _validate 校验不变');

    // G2：无 assets → 无字段无头
    const captured2 = [];
    globalThis.fetch = async (url, opts) => {
      captured2.push({ url, opts });
      return fakeResponse({ status: 200, body: OK_BODY });
    };
    try {
      await JevClient.ask('state', questions, { label: 'no-img' });
    } finally { globalThis.fetch = origFetch; }
    const body2 = JSON.parse(captured2[0].opts.body);
    assert(!('assets' in body2), '无 assets 请求体不含 assets 字段');
    assert(!('TypeSafe-Danger-Zone-Images' in captured2[0].opts.headers),
      '无 assets 绝不加危险区头');

    // G3：空 assets 对象 → 同无图语义
    const captured3 = [];
    globalThis.fetch = async (url, opts) => {
      captured3.push({ url, opts });
      return fakeResponse({ status: 200, body: OK_BODY });
    };
    try {
      await JevClient.ask('state', questions, { label: 'empty-img', assets: {} });
    } finally { globalThis.fetch = origFetch; }
    const body3 = JSON.parse(captured3[0].opts.body);
    assert(!('assets' in body3) && !captured3[0].opts.headers['TypeSafe-Danger-Zone-Images'],
      '空 assets 对象 = 无图语义（无字段无头）');

    // G4：源码口径——危险区头只在 hasAssets 分支加
    const src = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/llm/JevClient.mjs'), 'utf8');
    assert(/headers\['TypeSafe-Danger-Zone-Images'\] = 'true';\s*\}/.test(src)
      && src.includes('if (hasAssets)'), '危险区头挂在 hasAssets 条件分支内');
    assert(src.includes('hasAssets ? { state, model, questions, assets } : { state, model, questions }'),
      '请求体条件展开（无图形状与旧版 bit 一致）');
  }

  globalThis.setTimeout = origSetTimeout;
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
