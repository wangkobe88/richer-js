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
 *
 * C182 必要门+失败封顶（2026-10-23 用户裁定，GMGN IP 级 RATE_LIMIT_BANNED
 * 事故：v34 15h 叙事补源 694 次成功调用仅 37 次真正并入社媒——「AVE api 信息
 * 够了就不需要补充，GMGN API 信息全毛病多」）：①**失败封顶在本模块**——per-token
 * 连续 2 次 API 真失败（429/超时/网络，GMGN 正常返回空数据不算）→ 本进程内
 * 不再发包（重启清零；封顶斩断 ban 窗口「每轮重打续封」恶性循环）；成功即清零。
 * ②必要门（AVE 已有 twitter 链接不调）在 data-fetch-service 消费侧，判据
 * hasTwitterLink 也从本模块导出（单一真相，与并入门同源）。
 */
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

// dev 风险字段提取抽到 CJS 共享层（2026-10-14，行为零变化）：买腿第三层 GMGN
// 条件（GmgnRiskCheckService）与叙事社媒补源共用同一提取——单一真相源防口径漂移
import { extractGmgnRisk } from '../../core/gmgn-api/risk-fields.js';

// 失败封顶（C182，2026-10-23 用户裁定「抓不成功最多再尝试一次，就往下走」）：
// per-token 连续 API 真失败计数，≥2 → 本进程内直接 return null 不发包（重启清零）。
// 只对 throw 形状（429/超时/网络）计数——GMGN 正常返回但无社媒/风险（null 结果）
// 是 API 健康的空数据，走 ExternalResourceCache 自带的失败冷却，不计入封顶。
const GMGN_MAX_FAILS = 2;
const gmgnFailCounts = new Map(); // key `${chain}:${addr 小写}` → 连续失败次数

// twitter 链接判据（C182 必要门）：URL 集里已有 twitter/x.com 链接 = AVE/上游
// 信息已够，不需要 GMGN 补——与 data-fetch-service 并入判定（原内联正则）同源
// 单一真相，改判据两处同步变
const TWITTER_LINK_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:twitter\.com|x\.com)\//i;

/**
 * URL 集中是否已有 twitter/x.com 链接（GMGN 社媒补源的「必要」判据）
 * @param {string[]|null} urls
 * @returns {boolean}
 */
export function hasTwitterLink(urls) {
  return Array.isArray(urls) && urls.some(u => typeof u === 'string' && TWITTER_LINK_RE.test(u));
}

/**
 * URL 是否为推文级链接（x.com/twitter.com 域 + /status(es)/<id> 路径）
 * C238b 判据：账号级 URL（官方号页）只给身份档案（粉丝/发帖数），推文级 URL
 * 才是「宣告证据」——GMGN link.twitter_username 的推文路径形状（股城
 * MEJ50749/status/…）拼接产物即本形状。与 hasTwitterLink 同源导出（单一真相）
 * @param {string} url
 * @returns {boolean}
 */
export function isTweetLevelUrl(url) {
  return typeof url === 'string'
    && TWITTER_LINK_RE.test(url)
    && /\/status(es)?\/\d+/.test(url);
}

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

  // 失败封顶（C182）：连续 2 次真失败后本进程内不再发包——按无补源继续（null
  // 语义与 GMGN 无数据/未索引一致），不打日志（每轮分析都会走到，静默防刷屏；
  // 封顶达成的那一刻 warn 一次见下方 catch）
  const strikeKey = `${chain}:${address.toLowerCase()}`;
  if ((gmgnFailCounts.get(strikeKey) || 0) >= GMGN_MAX_FAILS) {
    return null;
  }

  const cacheKey = `gmgn:token:${chain}:${address.toLowerCase()}`;
  return CachedFetcher.fetchWithCache(cacheKey, 'gmgn_token_info', async () => {
    try {
      // ESM → CommonJS 动态 import（先例：twitter-validation/communities-api.js）
      const { GMGNTokenAPI } = await import('../../core/gmgn-api/index.js');
      const api = new GMGNTokenAPI({ apiKey, timeout: 10000 });
      const info = await api.getTokenInfo(chain, address);
      // API 健康（含返回空数据 null 形状）→ 连续失败计数清零
      gmgnFailCounts.delete(strikeKey);
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
    } catch (e) {
      // API 真失败（429/超时/网络/dynamic import）→ 连续失败 +1；达到封顶 warn 一次
      // （此后调用在函数入口直接 null，不再走到这）
      const fails = (gmgnFailCounts.get(strikeKey) || 0) + 1;
      gmgnFailCounts.set(strikeKey, fails);
      if (fails >= GMGN_MAX_FAILS) {
        console.warn(`[GmgnSocialFetcher] 连续 ${fails} 次失败封顶（${strikeKey}），本进程内不再调用 GMGN`);
      }
      throw e;
    }
  }, getCacheTTL('gmgn_token_info'));
}
