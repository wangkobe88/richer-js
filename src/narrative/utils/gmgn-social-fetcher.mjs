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
 *
 * CRO 案后续裁定（2026-10-19，C112 台账）：①**全量 raw payload 随行落库**——
 * 派生形状只有 twitterUrl/websiteUrl/risk 三键，原始 link 对象（twitter_username
 * 原值/geckoterminal 等）不落即丢，晚到归因/事后审计只能现查现猜；per-token
 * 调用极少，raw 几 KB 落 external_resource_cache 无压力（upsert 保留最新一份）。
 * ②**缓存 5s 过期=买前新鲜语义**——原 {maxAge:1d, ttl:90d} 在 fetchWithCache
 * 命中公式下实际命中窗 ≈91 天，把「GMGN 无社媒」结论冻结三个月（link 聚合晚到
 * 永远吃不到，CRO 现场）；调用频次=每 token 几次，5s 重打配额无忧。
 */
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

// dev 风险字段提取抽到 CJS 共享层（2026-10-14，行为零变化）：买腿第三层 GMGN
// 条件（GmgnRiskCheckService）与叙事社媒补源共用同一提取——单一真相源防口径漂移
import { extractGmgnRisk } from '../../core/gmgn-api/risk-fields.js';

/**
 * 拉取 GMGN token info（社媒补源 + dev 风险字段，一次调用两用）
 * @param {string} chain - 链标识（BSC-only 项目，固定 'bsc'）
 * @param {string} address - 代币合约地址
 * @returns {Promise<Object|null>} { twitterUrl, websiteUrl, risk, raw }：社媒字段可
 *   为 null（无语料补源语义由调用方按字段判）；risk 为 dev 风险字段集（GMGN
 *   未索引该 token 时可能 null）；raw=GMGN 原始 info 全量落库（审计/晚到归因，
 *   2026-10-19 裁定，派生字段不满足时以 raw 为准复核）。GMGN 无该 token / 未配置
 *   key → null（按无补源、无风险因子继续）；GMGN API 错误 → 抛错（调用方 catch
 *   后同上）。成功调用缓存 5s（买前新鲜语义，见文件头）。
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
    const risk = extractGmgnRisk(info);
    if (!twitterUrl && !websiteUrl && !risk) {
      console.log(`[GmgnSocialFetcher] GMGN 无社媒/风险数据: ${address}`);
      return null;
    }
    console.log(`[GmgnSocialFetcher] GMGN 数据: ${address} twitter=${twitterUrl} website=${websiteUrl}` +
      ` issuerTokenCount=${risk?.issuerTokenCount ?? '-'} bundler=${risk?.bundlerWallets ?? '-'}/${risk?.topWallets ?? '-'}`);
    return { twitterUrl, websiteUrl, risk, raw: info };
  }, getCacheTTL('gmgn_token_info'));
}
