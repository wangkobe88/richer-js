/**
 * API 提供方现状服务（api-status 页数据源）
 *
 * 集中查询各付费/外部 API 的余额与可用性，供「API 现状」一级页面展示——
 * 余额不足时及时充值。查询能力按各家实际情况（2026-10-25 逐一实测）：
 *   - apidance：GET /key/{apikey} → 剩余调用次数（纯数字文本）
 *   - SiliconFlow：GET {vision.baseUrl}/user/info → balance（CNY，code 20000）
 *   - TypeSafe (Jev)：无余额 API（openapi.json 实证仅 /v1/models 与 /v1/systemone）→ 探活
 *   - AVE：无余额 API → 探活 /health（status:1）
 *   - GMGN / JustOneAPI / ANKR：无余额 API（404 实证 / WSS-only）→ 仅展示配置状态
 *
 * 设计约束：
 *   - key 来源与生产一致：env（SILICONFLOW_FALLBACK_KEY/TYPESAFE_API_KEY/AVE_API_KEY/
 *     GMGN_API_KEY/NEWS_*）+ 源码硬编码处（apidance/justoneapi 用正则提取文本，
 *     不 require 模块——.mjs 无法 require 且避免执行上游代码）
 *   - 单家查询 8s 超时；结果 60s 内存缓存（页面 60s 轮询不打爆上游；?refresh=1 强制）
 *   - 归一化输出 status：ok / low / critical / error / unconfigured / unsupported——
 *     low/critical 阈值仅 UI 提示（黄/红），不做任何交易决策
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROBE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60000;

/** 余额提示阈值（UI 展示用，非交易门） */
const THRESHOLDS = {
  apidance: { low: 5000, critical: 1000 },      // 剩余调用次数（叙事链日耗千级）
  siliconflow: { low: 20, critical: 5 },        // CNY（图片分析单价低）
};

/** 从源码文件提取硬编码 key（正则匹配文本，不执行模块） */
function extractKey(relPath, pattern) {
  try {
    const text = fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
    const m = text.match(pattern);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** 读 config/narrative-engine.json（jev/vision 段是 baseUrl 单一真相源） */
function loadNarrativeConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/narrative-engine.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** 带超时的文本请求；返回 {res, text}（不在此解析 JSON，探活类要看原始形状） */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

function checkedAt() {
  return new Date().toISOString();
}

function balanceStatus(id, value) {
  const th = THRESHOLDS[id];
  if (!th || value == null || Number.isNaN(value)) return 'ok';
  if (value <= th.critical) return 'critical';
  if (value <= th.low) return 'low';
  return 'ok';
}

// ---- 各提供方检查函数（返回归一化结果） ----

/** apidance：剩余调用次数 */
async function checkApidance() {
  const apiKey = extractKey('../../utils/twitter-validation/new-apis.js', /apiKey:\s*'([^']+)'/);
  if (!apiKey) return { status: 'error', error: '未能从 new-apis.js 提取 apiKey（源码结构变更？）', checkedAt: checkedAt() };
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout(`https://api.apidance.pro/key/${apiKey}`, {
    headers: { apikey: apiKey },
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const value = parseInt(text.trim(), 10);
  if (Number.isNaN(value)) throw new Error(`响应非数字: ${text.slice(0, 100)}`);
  return {
    status: balanceStatus('apidance', value),
    balanceValue: value,
    balanceText: `${value.toLocaleString()} 次`,
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** SiliconFlow：账户余额（CNY） */
async function checkSiliconflow() {
  const vision = loadNarrativeConfig().vision || {};
  const apiKey = process.env[vision.apiKeyEnv || 'SILICONFLOW_FALLBACK_KEY'];
  if (!apiKey) return { status: 'unconfigured', detail: `${vision.apiKeyEnv || 'SILICONFLOW_FALLBACK_KEY'} 未配置（本机无 key 属预期，182 部署环境有）`, checkedAt: checkedAt() };
  const base = (vision.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout(`${base}/user/info`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const data = json && json.data;
  if (!data) throw new Error(`响应缺 data: ${text.slice(0, 200)}`);
  const value = Number(data.balance ?? data.totalBalance);
  return {
    status: Number.isNaN(value) ? 'ok' : balanceStatus('siliconflow', value),
    balanceValue: Number.isNaN(value) ? null : value,
    balanceText: Number.isNaN(value) ? null : `¥ ${value.toFixed(2)}`,
    detail: Number.isNaN(data.chargeBalance) ? null : `充值余额 ¥ ${Number(data.chargeBalance).toFixed(2)}（其余为赠送额度）`,
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** TypeSafe (Jev)：无余额 API，探活 /v1/models */
async function checkTypesafe() {
  const jev = loadNarrativeConfig().jev || {};
  const apiKey = process.env[jev.apiKeyEnv || 'TYPESAFE_API_KEY'];
  if (!apiKey) return { status: 'unconfigured', checkedAt: checkedAt() };
  const base = new URL(jev.endpoint || 'https://api.typesafe.ai/v1/systemone').origin;
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const models = Array.isArray(json.models) ? json.models.map(m => m.name).join(' / ') : '';
  return {
    status: 'ok',
    balanceText: null,
    detail: `服务可用（${models}）——官方不提供余额查询 API，用量请在控制台查看`,
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** AVE：无余额 API，探活 /health */
async function checkAve() {
  const apiKey = process.env.AVE_API_KEY;
  if (!apiKey) return { status: 'unconfigured', checkedAt: checkedAt() };
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout('https://prod.ave-api.com/health', {
    headers: { 'X-API-KEY': apiKey },
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.status !== 1) throw new Error(`health status=${json.status}`);
  return {
    status: 'ok',
    balanceText: null,
    detail: `服务存活（api ${(json.data && json.data.api_version) || '?'}）——无余额查询 API，用量请在控制台查看`,
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** 智谱 GLM（news-monitor 摘要 LLM）：按 news-monitor 实际调用形状探活 {base}/v1/messages
 *  判定：HTTP 400/401/422/429 = 端点活着（网关正常处理了坏请求/鉴权）；
 *  404/405/HTML = 路径不存在（探活失败如实暴露） */
async function checkGlmNews() {
  const base = (process.env.NEWS_LLM_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.NEWS_LLM_API_KEY;
  if (!base || !apiKey) return { status: 'unconfigured', checkedAt: checkedAt() };
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: '{}',
  });
  const latencyMs = Date.now() - t0;
  const endpointAlive = res.status !== 404 && res.status !== 405 && !text.trimStart().startsWith('<');
  if (!endpointAlive) throw new Error(`端点不可达 HTTP ${res.status}（${base}/v1/messages 返回非 API 响应）`);
  return {
    status: 'ok',
    balanceText: null,
    detail: `端点存活（HTTP ${res.status} 为空请求预期响应）——无余额查询 API`,
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** ai.6551.io（news-monitor watch 服务）：探活 POST /open/twitter_watch（纯列表查询，轻量） */
async function checkNewsWatch() {
  const base = (process.env.NEWS_API_BASE || '').replace(/\/+$/, '');
  const token = process.env.NEWS_WSS_TOKEN;
  if (!base || !token) return { status: 'unconfigured', checkedAt: checkedAt() };
  const t0 = Date.now();
  const { res, text } = await fetchWithTimeout(`${base}/open/twitter_watch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return {
    status: 'ok',
    balanceText: null,
    detail: '服务可用——watch 服务无计费余额',
    latencyMs,
    checkedAt: checkedAt(),
  };
}

/** 提供方静态清单（unsupported 类不走网络，只展示配置状态） */
function staticProviders() {
  const gmgnKey = process.env.GMGN_API_KEY;
  const justoneKey = extractKey('../../narrative/utils/amazon-fetcher.mjs', /JUSTONEAPI_KEY\s*=\s*'([^']+)'/);
  const ankrUrl = process.env.ANKR_WS_URL;
  return [
    {
      id: 'gmgn', name: 'GMGN 开放平台', description: '风控数据 / 钱包画像（GmgnRiskCheckService 等）',
      status: 'unsupported',
      configured: Boolean(gmgnKey),
      detail: '官方不提供余额/积分查询 API（openapi.gmgn.ai 实测 404），用量请在 GMGN 控制台查看',
    },
    {
      id: 'justoneapi', name: 'JustOneAPI', description: '亚马逊商品 / 微信公众号语料抓取（叙事引擎）',
      status: 'unsupported',
      configured: Boolean(justoneKey),
      detail: '服务不提供余额查询 API（api.justoneapi.com 实测 404），用量请在其后台查看',
    },
    {
      id: 'ankr', name: 'ANKR', description: 'BSC WSS 行情订阅（collector 直连数据源）',
      status: 'unsupported',
      configured: Boolean(ankrUrl),
      detail: ankrUrl ? `已配置（${new URL(ankrUrl).host}）——WSS 订阅无余额查询 API，用量请在 ANKR 控制台查看` : 'ANKR_WS_URL 未配置',
    },
  ];
}

/** 动态检查清单 */
const DYNAMIC_PROVIDERS = [
  { id: 'apidance', name: 'apidance', description: 'Twitter 数据（叙事引擎主源：用户/推文/社区/搜索）', check: checkApidance },
  { id: 'siliconflow', name: 'SiliconFlow', description: 'vision 图片分析（Qwen3-Omni Captioner）', check: checkSiliconflow },
  { id: 'typesafe', name: 'TypeSafe (Jev)', description: '叙事决策 LLM（结构化 Choice/Score/Noul）', check: checkTypesafe },
  { id: 'ave', name: 'AVE', description: '代币数据 / holder 预检（AVE_API_KEY）', check: checkAve },
  { id: 'glm-news', name: '智谱 GLM（新闻摘要）', description: 'news-monitor 小时摘要 LLM（NEWS_LLM_*）', check: checkGlmNews },
  { id: 'news-watch', name: 'ai.6551.io（新闻 watch）', description: '新闻监控账号 watch 列表（NEWS_API_BASE）', check: checkNewsWatch },
];

class ApiStatusService {
  constructor() {
    this._cache = null;      // { at, data }
  }

  /**
   * 查询全部提供方（60s 缓存）
   * @param {Object} [options] { refresh: boolean } 强制绕过缓存
   * @returns {Promise<{cachedAt: string|null, fresh: boolean, providers: Array}>}
   */
  async getStatus(options = {}) {
    if (!options.refresh && this._cache && Date.now() - this._cache.at < CACHE_TTL_MS) {
      return { cachedAt: new Date(this._cache.at).toISOString(), fresh: false, providers: this._cache.data };
    }

    const dynamicResults = await Promise.all(DYNAMIC_PROVIDERS.map(async p => {
      try {
        const result = await p.check();
        return { id: p.id, name: p.name, description: p.description, ...result };
      } catch (err) {
        return {
          id: p.id, name: p.name, description: p.description,
          status: 'error', error: err.name === 'AbortError' ? `查询超时（>${PROBE_TIMEOUT_MS}ms）` : err.message,
          checkedAt: checkedAt(),
        };
      }
    }));

    const statics = staticProviders().map(p => ({ ...p, checkedAt: null }));
    const providers = [...dynamicResults, ...statics];
    this._cache = { at: Date.now(), data: providers };
    return { cachedAt: null, fresh: true, providers };
  }
}

module.exports = { ApiStatusService, THRESHOLDS };
