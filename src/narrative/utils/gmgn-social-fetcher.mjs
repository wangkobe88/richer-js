/**
 * GMGN 社媒补源（BRF 案，2026-09-27 用户裁定）
 *
 * 背景：four.meme 元数据的 twitterUrl/webUrl 与链上 IPFS metadata 可能全部为空
 * （BRF 0x2c5b…：唯一信息源是 desc 自述，被 pre-check 规则 no_public_info 误拦），
 * 而 GMGN token info 的 link 聚合了社媒 handle（实测 twitter_username=bitgetfundbsc，
 * 推特本体验证有真实内容）。AVE 实测无独立社媒渠道——appendix 与 four.meme 元数据
 * 逐字符一致（三例对照，含 ?s=20 尾参），four.meme 元数据空的币 AVE 同样空，
 * GMGN 是唯一有效补源。
 *
 * 配额控制（用户裁定）：GMGN 是付费 API，只在交易引擎叙事直调（买门已 fire，
 * 其他购买条件已满足）时调用——data-fetch 层需显式传 enrichSocialByGmgn=true，
 * narrative engine 队列链路不传（保持现状零调用）。
 *
 * 防抖：GMGN 正常返回但无社媒 → 返回 null 进失败冷却（默认 1h，同 ipfs fetcher
 * 先例），冷却期内同 token 不重打；成功结果按 gmgn_token_info TTL 缓存。
 */
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * 拉取 GMGN token info 的社媒链接
 * @param {string} chain - 链标识（BSC-only 项目，固定 'bsc'）
 * @param {string} address - 代币合约地址
 * @returns {Promise<Object|null>} { twitterUrl, websiteUrl }；GMGN 无该 token /
 *   无社媒字段 / 未配置 key → null（调用方按无补源继续，行为与现状一致）；
 *   GMGN API 错误 → 抛错（调用方 catch 后按无补源继续）
 */
export async function fetchGmgnSocialLinks(chain, address) {
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) {
    console.warn('[GmgnSocialFetcher] GMGN_API_KEY 未配置，跳过社媒补源');
    return null;
  }

  const cacheKey = `gmgn:token:${chain}:${address.toLowerCase()}`;
  return CachedFetcher.fetchWithCache(cacheKey, 'gmgn_token_info', async () => {
    // ESM → CommonJS 动态 import（先例：twitter-validation/communities-api.js）
    const { GMGNTokenAPI } = await import('../../core/gmgn-api/index.js');
    const api = new GMGNTokenAPI({ apiKey, timeout: 10000 });
    const info = await api.getTokenInfo(chain, address);
    const link = info?.link || {};
    // GMGN 只填 handle（twitter_username），website_url/telegram 可能为空串——
    // 空串不当有效值（上段实测 BRF 行 website/telegram 均为空串）
    const twitterUrl = link.twitter_username ? `https://x.com/${link.twitter_username}` : null;
    const websiteUrl = (typeof link.website_url === 'string' && /^https?:\/\//.test(link.website_url))
      ? link.website_url : null;
    if (!twitterUrl && !websiteUrl) {
      console.log(`[GmgnSocialFetcher] GMGN 无社媒数据: ${address}`);
      return null;
    }
    console.log(`[GmgnSocialFetcher] 社媒补源成功: ${address} twitter=${twitterUrl} website=${websiteUrl}`);
    return { twitterUrl, websiteUrl };
  }, getCacheTTL('gmgn_token_info'));
}
