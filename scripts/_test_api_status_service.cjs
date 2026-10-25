/**
 * _test_api_status_service.cjs — API 现状服务单测（零 DB 零网络，fetch 全打桩）
 *
 * 覆盖：apidance 余额归一化与阈值三档 / 非数字响应报错 / SiliconFlow 20000 形状解析
 * 与未配置分支 / TypeSafe+AVE 探活归一化 / glm-news 端点死亡(405/HTML)判 error 而
 * 400 判 ok / 60s 缓存不打网 / refresh=1 绕过缓存 / 静态 provider configured 状态 /
 * extractKey 从真实源文件提取硬编码 key。
 *
 * 运行：node scripts/_test_api_status_service.cjs（断言失败退出非零）
 */

'use strict';

const assert = require('assert');
const path = require('path');

// 加载 config/.env（与 web-server 运行时同源；读文件零网络零 DB）
require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });

// ---- fetch 打桩 ----
let fetchCalls = [];
let fetchHandler = null; // (url, options) => ({status, text})

const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  fetchCalls.push(url);
  if (!fetchHandler) throw new Error(`单测未配置 fetchHandler，收到 ${url}`);
  return fetchHandler(url, options);
};

function stubFetch(handler) {
  fetchHandler = handler;
  fetchCalls = [];
}

function res(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

// ---- 载入被测（打桩须在 require 前完成——service 只在调用时用 fetch，此处防御性先打桩） ----
const { ApiStatusService, THRESHOLDS } = require('../src/web/services/api-status-service');

async function main() {
  // extractKey：从真实源文件提取（读文件零网络）
  const svc0 = new ApiStatusService();

  // 1. apidance：ok 档（余额远高于阈值）
  stubFetch((url) => {
    if (url.startsWith('https://api.apidance.pro/key/')) return res(200, '92651');
    throw new Error(`意外请求: ${url}`);
  });
  let r = await svc0.getStatus({ refresh: true });
  let apidance = r.providers.find(p => p.id === 'apidance');
  assert.strictEqual(apidance.status, 'ok', 'apidance 高余额应为 ok');
  assert.strictEqual(apidance.balanceValue, 92651);
  assert.ok(apidance.balanceText.includes('92,651'), `balanceText 应含千分位: ${apidance.balanceText}`);
  assert.ok(apidance.checkedAt);

  // 2. apidance：low 档（<=5000）
  stubFetch(() => res(200, String(THRESHOLDS.apidance.low)));
  apidance = await (async () => {
    const rr = await svc0.getStatus({ refresh: true });
    return rr.providers.find(p => p.id === 'apidance');
  })();
  assert.strictEqual(apidance.status, 'low', 'apidance 恰等于 low 阈值应判 low（<=）');

  // 3. apidance：critical 档（<=1000）
  stubFetch(() => res(200, String(THRESHOLDS.apidance.critical)));
  r = await svc0.getStatus({ refresh: true });
  apidance = r.providers.find(p => p.id === 'apidance');
  assert.strictEqual(apidance.status, 'critical');

  // 4. apidance：非数字响应 → error
  stubFetch(() => res(200, '<html>err</html>'));
  r = await svc0.getStatus({ refresh: true });
  apidance = r.providers.find(p => p.id === 'apidance');
  assert.strictEqual(apidance.status, 'error');
  assert.ok(apidance.error.includes('非数字'), `error 应说明非数字: ${apidance.error}`);

  // 5. SiliconFlow：20000 标准形状解析（本地未配 key 时跳过此段改验 unconfigured）
  const sfKey = process.env.SILICONFLOW_FALLBACK_KEY;
  if (sfKey) {
    stubFetch((url) => {
      if (url.includes('/user/info')) {
        return res(200, { code: 20000, data: { balance: '123.45', chargeBalance: '100.00', totalBalance: '123.45' } });
      }
      throw new Error(`意外请求: ${url}`);
    });
    r = await svc0.getStatus({ refresh: true });
    const sf = r.providers.find(p => p.id === 'siliconflow');
    assert.strictEqual(sf.status, 'ok');
    assert.strictEqual(sf.balanceValue, 123.45);
    assert.ok(sf.balanceText.includes('123.45'));
    assert.ok(sf.detail.includes('100.00'), `detail 应含充值余额: ${sf.detail}`);
  } else {
    r = await svc0.getStatus({ refresh: true });
    const sf = r.providers.find(p => p.id === 'siliconflow');
    assert.strictEqual(sf.status, 'unconfigured', '无 key 时应 unconfigured 而非打网');
  }

  // 6. TypeSafe 探活：models 列表 → ok，detail 说明无余额 API
  stubFetch((url) => {
    if (url.includes('typesafe.ai/v1/models')) {
      return res(200, { models: [{ name: 'jev-latest' }, { name: 'jev-preview' }] });
    }
    throw new Error(`意外请求: ${url}`);
  });
  r = await svc0.getStatus({ refresh: true });
  const ts = r.providers.find(p => p.id === 'typesafe');
  assert.strictEqual(ts.status, 'ok');
  assert.ok(ts.detail.includes('jev-latest'));
  assert.strictEqual(ts.balanceText, null, 'TypeSafe 无余额，balanceText 恒 null');

  // 7. AVE 探活：health status:1 → ok
  stubFetch((url) => {
    if (url.includes('prod.ave-api.com/health')) {
      return res(200, { status: 1, data: { api_version: 'v4.7.9-shared' } });
    }
    throw new Error(`意外请求: ${url}`);
  });
  r = await svc0.getStatus({ refresh: true });
  const ave = r.providers.find(p => p.id === 'ave');
  assert.strictEqual(ave.status, 'ok');
  assert.ok(ave.detail.includes('v4.7.9'));

  // 8. AVE health status!=1 → error
  stubFetch(() => res(200, { status: 0 }));
  r = await svc0.getStatus({ refresh: true });
  assert.strictEqual(r.providers.find(p => p.id === 'ave').status, 'error');

  // 9. glm-news：405/HTML = 端点死亡 → error；400 = 端点活着 → ok
  stubFetch((url) => {
    if (url.endsWith('/v1/messages')) return res(405, '<html>405</html>');
    throw new Error(`意外请求: ${url}`);
  });
  r = await svc0.getStatus({ refresh: true });
  const glm = r.providers.find(p => p.id === 'glm-news');
  if (glm.status !== 'unconfigured') {
    assert.strictEqual(glm.status, 'error', 'glm-news 405+HTML 应判 error');
    assert.ok(glm.error.includes('不可达'));
  }
  stubFetch((url) => {
    if (url.endsWith('/v1/messages')) return res(400, '{"error":"bad request"}');
    throw new Error(`意外请求: ${url}`);
  });
  r = await svc0.getStatus({ refresh: true });
  const glm2 = r.providers.find(p => p.id === 'glm-news');
  if (glm2.status !== 'unconfigured') {
    assert.strictEqual(glm2.status, 'ok', 'glm-news 400（网关正常处理坏请求）应判端点存活');
  }

  // 10. 静态 provider：unsupported 状态 + configured 布尔
  r = await svc0.getStatus({ refresh: true });
  const gmgn = r.providers.find(p => p.id === 'gmgn');
  assert.strictEqual(gmgn.status, 'unsupported');
  assert.strictEqual(gmgn.configured, Boolean(process.env.GMGN_API_KEY));
  const ankr = r.providers.find(p => p.id === 'ankr');
  assert.strictEqual(ankr.configured, Boolean(process.env.ANKR_WS_URL));

  // 11. 缓存：60s 内第二次 getStatus 不打网；refresh=1 打网
  stubFetch(() => { throw new Error('缓存命中期不应打网'); });
  r = await svc0.getStatus(); // 无 refresh
  assert.strictEqual(r.fresh, false, '缓存命中应 fresh=false');
  assert.ok(r.cachedAt);
  assert.strictEqual(fetchCalls.length, 0, '缓存命中期零网络请求');

  stubFetch((url) => {
    if (url.startsWith('https://api.apidance.pro/key/')) return res(200, '1');
    if (url.includes('typesafe.ai/v1/models')) return res(200, { models: [] });
    if (url.includes('prod.ave-api.com/health')) return res(200, { status: 1, data: {} });
    if (url.endsWith('/v1/messages')) return res(400, '{"error":"x"}');
    if (url.includes('ai.6551.io')) return res(200, { data: [] });
    if (url.includes('siliconflow')) return res(200, { code: 20000, data: { balance: '1' } });
    throw new Error(`意外请求: ${url}`);
  });
  r = await svc0.getStatus({ refresh: true });
  assert.strictEqual(r.fresh, true, 'refresh=1 应直查上游');
  assert.ok(fetchCalls.length >= 5, `refresh 应产生网络请求，实际 ${fetchCalls.length}`);

  console.log('✓ api-status-service 单测全部通过');
}

main().then(() => {
  global.fetch = realFetch;
}).catch(err => {
  console.error('✗ 单测失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
