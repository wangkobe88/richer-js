/**
 * AVE 社媒补源（C238 股城案，2026-10-26 用户裁定「ave api 确认使用」）
 *
 * 背景：flap 票链上 IPFS meta 可能不含任何链接（股城 0xaacbc156435dbab7815a61bccba1c827e52a7777：
 * meta JSON 仅 name/symbol/一句 description/头像图，URL 提取全空），而 AVE token
 * detail 有独立社媒聚合——实测股城 appendix JSON 带 twitter=https://x.com/STOCK__OPOLIS
 * （官方号）+ website=utter.cash 税信息页。BRF 案「AVE appendix 与元数据逐字符
 * 一致」的结论只对 four.meme 票成立（AVE 爬发行方自填字段），flap 票 AVE 是
 * 独立数据源。与 GMGN 互补：AVE=官方账号页（宣告推+粉丝量/发帖数——W 资格轴
 * 证据），GMGN link=宣告推文直链（股城实测 "MEJ50749/status/2112469093156630545"）。
 *
 * 源优先级链（2026-10-26 用户裁定「GMGN 一定是所有的数据都失效后才走这一路，
 * 因为 GMGN API 无付费版本，容易因为流量封锁使用」）：
 *   meta/appendix → IPFS 解包 → AVE（本模块）→ GMGN → C77 推特搜索（最后手段）
 * 逐层必要门 = !hasTwitterLink（判据从 gmgn-social-fetcher 导入，单一真相）——
 * twitter 已到手不烧下一层配额。
 *
 * 配额/缓存：AVE 是付费 key；成功结果 60s 过期（一轮 retry 补轮内不重打，
 * 聚合晚到下次分析自然刷新）；无社媒（null）与失败进 1h 失败冷却（CachedFetcher
 * 语义，与 GMGN 无社媒形状同）——晚到聚合由 GMGN 5s TTL 层与 C77 兜底接住，
 * 不靠 AVE 反复重试烧配额。appendix 原文随 raw 落库（晚到归因审计，CRO 案同款）。
 */
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';
import { hasTwitterLink } from './gmgn-social-fetcher.mjs';

export { hasTwitterLink };

/**
 * 拉取 AVE token detail（社媒补源）
 * @param {string} chain - 链标识（BSC-only 项目，固定 'bsc'）
 * @param {string} address - 代币合约地址
 * @returns {Promise<Object|null>} { twitterUrl, websiteUrl, raw }：链接为完整 URL
 *   原样返回（AVE 与 GMGN 裸 handle 不同，不拼接）；AVE 未索引该 token / 无
 *   社媒字段 / 未配置 key → null（按无补源继续）；AVE API 错误 → 抛错（调用方
 *   catch 后按无补源继续）。成功调用缓存 60s。
 */
export async function fetchAveSocialLinks(chain, address) {
  const apiKey = process.env.AVE_API_KEY;
  if (!apiKey) {
    console.warn('[AveSocialFetcher] AVE_API_KEY 未配置，跳过社媒补源');
    return null;
  }

  const cacheKey = `ave:token:${chain}:${address.toLowerCase()}`;
  return CachedFetcher.fetchWithCache(cacheKey, 'ave_token_detail', async () => {
    // ESM → CommonJS 动态 import（先例：gmgn-social-fetcher → gmgn-api）
    const { AveTokenAPI } = await import('../../core/ave-api/token-api.js');
    const api = new AveTokenAPI('https://prod.ave-api.com', 10000, apiKey);
    const detail = await api.getTokenDetail(`${address}-${chain}`);
    // 客户端 getTokenDetail 的固定映射集不含 twitter/website 顶层键——社媒
    // 只在 appendix JSON 里（2026-10-26 股城 curl 实测：raw token 顶层与
    // appendix 的 twitter/website 一致，appendix 是稳定承载字段）
    const token = detail?.token || {};
    let appendix = {};
    if (typeof token.appendix === 'string' && token.appendix) {
      try { appendix = JSON.parse(token.appendix); } catch (_) { /* 空 appendix=无社媒形状 */ }
    } else if (token.appendix && typeof token.appendix === 'object') {
      appendix = token.appendix;
    }
    // AVE 给完整 URL 不拼接；空串/非 http 形状不当有效值（BRF 实测同款坑）
    const pickHttp = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : null);
    const twitterUrl = pickHttp(appendix.twitter);
    const websiteUrl = pickHttp(appendix.website);
    if (!twitterUrl && !websiteUrl) {
      console.log(`[AveSocialFetcher] AVE 无社媒数据: ${address}`);
      return null;
    }
    console.log(`[AveSocialFetcher] AVE 数据: ${address} twitter=${twitterUrl} website=${websiteUrl}`);
    return { twitterUrl, websiteUrl, raw: token };
  }, getCacheTTL('ave_token_detail'));
}
