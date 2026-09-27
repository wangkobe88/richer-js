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
 * 从 GMGN token info 提取 dev 风险字段（x-0 案，2026-09-27 用户裁定）
 *
 * x-0 0xa5fd 实测：链上 creator 是 flap 工厂地址（每次发币换新 EOA，链上维度
 * creator 发币史恒 1）+ 一次性钱包（发币前 6.6 分钟从币安热钱包提币）+ 回收
 * handle 买粉伪装新项目（131 粉过 prestage project 60 底线 → mid 放行 -68.8%）。
 * GMGN 的推特维度归因暴露真相：twitter_create_token_count=16（serial issuer），
 * holder 侧 wallet_tags_stat 76% 是 bundler。字段随 token info 一次调用带出，
 * 零额外配额。
 * @param {Object} info - GMGN getTokenInfo 响应
 * @returns {Object|null} risk 字段集；dev/wallet_tags_stat 全缺 → null
 */
function extractGmgnRisk(info) {
  const dev = info?.dev || {};
  const tags = info?.wallet_tags_stat || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const risk = {
    issuerTokenCount: num(dev.twitter_create_token_count), // 该推特账号关联发币总数（x-0=16）
    creatorAddress: dev.creator_address || null,           // GMGN 归因真实 EOA（非链上工厂）
    creatorTokenStatus: dev.creator_token_status || null,  // creator_close=已清仓离场
    fundFrom: dev.fund_from || null,                       // creator 资金来源（币安热钱包=一次性钱包）
    bundlerWallets: num(tags.bundler_wallets),
    sniperWallets: num(tags.sniper_wallets),
    freshWallets: num(tags.fresh_wallets),
    topWallets: num(tags.top_wallets),                     // 标签统计分母（x-0=46）
    imageDupCount: num(info?.image_dup_count),             // 头像/图片重复数（批量盘特征）
  };
  const hasAny = Object.values(risk).some(v => v !== null);
  return hasAny ? risk : null;
}

/**
 * 拉取 GMGN token info（社媒补源 + dev 风险字段，一次调用两用）
 * @param {string} chain - 链标识（BSC-only 项目，固定 'bsc'）
 * @param {string} address - 代币合约地址
 * @returns {Promise<Object|null>} { twitterUrl, websiteUrl, risk }：社媒字段可
 *   为 null（无语料补源语义由调用方按字段判）；risk 为 dev 风险字段集（GMGN
 *   未索引该 token 时可能 null）。GMGN 无该 token / 未配置 key → null（按无
 *   补源、无风险因子继续）；GMGN API 错误 → 抛错（调用方 catch 后同上）。
 *   成功调用（含无社媒但有 risk）缓存 1d——比旧「无社媒进 1h 冷却」更长。
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
    return { twitterUrl, websiteUrl, risk };
  }, getCacheTTL('gmgn_token_info'));
}
