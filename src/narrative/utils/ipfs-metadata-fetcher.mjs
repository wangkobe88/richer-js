/**
 * four.meme IPFS metadata 解包器（C7，2026-09-24）
 *
 * 背景：four.meme API 的 twitterUrl/webUrl 字段可能为空，真实社交链接只存在于
 * 链上 metadata（raw_api_data.meta 指向的 IPFS JSON）里——URL 提取层只扫 API
 * 字符串字段时这些链接永远进不了语料，"公告先于铸币"的正规盘会被规则4-B
 * （public_info_fetch_failed）误拦（case ARENA 0x4b4d…，8.5min 寿命峰值 12.54x 漏过）。
 *
 * 网关说明：ipfs.io 官方网关已进入 sunset（429 + sunset 响应头），多网关按序轮询；
 * metadata 内容按 IPFS 语义不可变，缓存给长期值（同 tweet 档）。
 */
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

// pinata 实测可用（2026-09-24）；ipfs.io 官方保留但已 429/sunset，后两个备用
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://4everland.io/ipfs/',
  'https://w3s.link/ipfs/',
];
const GATEWAY_TIMEOUT_MS = 8000;
const MAX_JSON_CHARS = 64 * 1024; // metadata 为几百字节 JSON，超长大概率不是 metadata

/**
 * 判断 URL 是否为 IPFS 网关链接（任意 host 的 /ipfs/<cid> 路径）
 * @param {string} url
 * @returns {boolean}
 */
export function isIpfsUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^/]+\/ipfs\/[A-Za-z0-9]+/i.test(url);
}

/**
 * 归一化 meta 引用为可解包的网关 URL
 *
 * four.meme 的 raw_api_data.meta 有两种形状（BRF 案实测）：
 * - http 网关 URL（ARENA 型，extractAllUrls 能提取到）
 * - 裸 CID（BRF：meta="bafkreigaw…"，extractAllUrls / isIpfsUrl 均不识别，
 *   曾导致 0-URL 早退连 IPFS 解包都不跑）
 * 裸 CID 统一转 pinata 网关 URL（fetchIpfsMetadata 多网关轮询的第一站）
 * @param {string} ref - raw_api_data.meta 原始值
 * @returns {string|null} 网关 URL；非 IPFS 引用返回 null
 */
export function normalizeIpfsRef(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (isIpfsUrl(ref)) return ref;
  // CID v0（Qm 开头 44 位 base58）/ v1（baf 开头 base32，长度可变取下限 20）
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})$/.test(ref.trim())) {
    return `https://gateway.pinata.cloud/ipfs/${ref.trim()}`;
  }
  return null;
}

function extractCid(url) {
  const m = url.match(/\/ipfs\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchGatewayJson(gatewayUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(gatewayUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length > MAX_JSON_CHARS) return null;
    const json = JSON.parse(text);
    return (json && typeof json === 'object') ? json : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取并解析 meta 指向的 four.meme metadata JSON（多网关轮询 + 缓存）
 * @param {string} metaUrl - raw_api_data.meta 的 IPFS URL
 * @returns {Promise<Object|null>} metadata JSON 对象；全网关失败返回 null（上层按原流程处理 meta 链接）
 */
export async function fetchIpfsMetadata(metaUrl) {
  const cid = extractCid(metaUrl);
  if (!cid) return null;

  return CachedFetcher.fetchWithCache(metaUrl, 'ipfs_metadata', async () => {
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const json = await fetchGatewayJson(`${gateway}${cid}`);
        if (json) {
          console.log(`[IpfsMetadataFetcher] metadata 获取成功（${gateway}）: ${metaUrl}`);
          return json;
        }
      } catch (_) {
        // 单网关失败，轮询下一个
      }
    }
    console.warn(`[IpfsMetadataFetcher] metadata 所有网关均失败: ${metaUrl}`);
    return null;
  }, getCacheTTL('ipfs_metadata'));
}
