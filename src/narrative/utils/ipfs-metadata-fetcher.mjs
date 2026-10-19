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
 *
 * C106（2026-10-19 TREE 0xd50e…7777 案）：pump.fun 迁移票 meta 直链形状
 * （metadata.j7tracker.io/metadata/<id>.json）并入本解包器——非 /ipfs/<cid> 非
 * 裸 CID，原 normalizeIpfsRef 返回 null 不解包，社媒锁死在 metadata JSON 里被
 * 规则 4-B（public_info_fetch_failed）终局误杀。直链无网关可轮询，单点直抓。
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

// C106 迁移直链网关：host+路径双卡位（.json 收尾、id 段无斜杠），出现新迁移
// 网关形状时在此追加
const DIRECT_METADATA_URL_RE = /^https:\/\/metadata\.j7tracker\.io\/metadata\/[A-Za-z0-9_-]+\.json$/;

export function isDirectMetadataUrl(url) {
  return typeof url === 'string' && DIRECT_METADATA_URL_RE.test(url.trim());
}

/**
 * 归一化 meta 引用为可解包的 metadata URL
 *
 * raw_api_data.meta 三种形状：
 * - http IPFS 网关 URL（ARENA 型，extractAllUrls 能提取到）
 * - 裸 CID（BRF：meta="bafkreigaw…"，extractAllUrls / isIpfsUrl 均不识别，
 *   曾导致 0-URL 早退连 IPFS 解包都不跑）
 * - 迁移直链 JSON（C106：j7tracker.io，pump.fun 迁移票——twitterUrl/webUrl
 *   API 字段为空，真实社媒只在 JSON 里）
 * 裸 CID 统一转 pinata 网关 URL（fetchIpfsMetadata 多网关竞速的第一站）
 * @param {string} ref - raw_api_data.meta 原始值
 * @returns {string|null} 可解包 URL；非 metadata 引用返回 null
 */
export function normalizeIpfsRef(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (isIpfsUrl(ref)) return ref;
  // CID v0（Qm 开头 44 位 base58）/ v1（baf 开头 base32，长度可变取下限 20）
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})$/.test(ref.trim())) {
    return `https://gateway.pinata.cloud/ipfs/${ref.trim()}`;
  }
  if (isDirectMetadataUrl(ref)) return ref.trim();
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
  // C106 迁移直链：非内容寻址、无网关可轮询——单点直抓（同款 8s 超时 + 64k
  // JSON 校验）；失败/异常均 warn + null（对齐网关路径语义），走原
  // 「解包失败按 website 处理」路径
  if (isDirectMetadataUrl(metaUrl)) {
    return CachedFetcher.fetchWithCache(metaUrl, 'ipfs_metadata', async () => {
      try {
        const json = await fetchGatewayJson(metaUrl);
        if (json) return json;
        console.warn(`[IpfsMetadataFetcher] 直链 metadata 获取失败: ${metaUrl}`);
        return null;
      } catch (e) {
        console.warn(`[IpfsMetadataFetcher] 直链 metadata 获取异常: ${metaUrl} (${e.message})`);
        return null;
      }
    }, getCacheTTL('ipfs_metadata'));
  }

  const cid = extractCid(metaUrl);
  if (!cid) return null;

  return CachedFetcher.fetchWithCache(metaUrl, 'ipfs_metadata', async () => {
    // N2（2026-10-13 叙事提速案）：4 网关并发 first-success（原逐网关串行轮询
    // 8s×N 最坏 32s）；同 CID 内容寻址一致，单网关 null/异常 → 该 promise reject
    // → any 取第一个成功，语义与「轮询到第一个可用」等价；全失败保原 warn + null
    try {
      const json = await Promise.any(IPFS_GATEWAYS.map(async (gateway) => {
        const j = await fetchGatewayJson(`${gateway}${cid}`);
        if (j) {
          console.log(`[IpfsMetadataFetcher] metadata 获取成功（${gateway}）: ${metaUrl}`);
          return j;
        }
        throw new Error(`网关返回空/无效: ${gateway}`);
      }));
      return json;
    } catch (_) {
      console.warn(`[IpfsMetadataFetcher] metadata 所有网关均失败: ${metaUrl}`);
      return null;
    }
  }, getCacheTTL('ipfs_metadata'));
}
