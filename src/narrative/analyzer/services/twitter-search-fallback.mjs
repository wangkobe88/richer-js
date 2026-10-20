/**
 * 空语料推特搜索兜底（C76，2026-10-16；背景=特斯拉飞行汽车三票案 C73 提案①）
 *
 * 病因：token metadata 零 URL → precheck 规则 4-A no_public_info 秒拒，分析器
 * 根本不知道背后有轰动事件（FTR 案 0x109afc17…7777）。本服务在语料为空时按
 * token 全名 + since:<创建时间-7d> 搜推特（apidance graphql/SearchTimeline，
 * 2026-10-16 冒烟验证：事件名搜索 1.6s/22 条带互动数据；CA 直搜 404 死——
 * 主用例是「事件量级证据」，不是宣告推救援）。
 *
 * 证据语义（三条红线）：
 *   1. 证据只走 tokenData.raw_api_data.search_evidence + state [TWITTER_SEARCH]
 *      独立段，绝不触碰 twitterInfo 三键（主推/父推/第二推文）——
 *      narrativeCorpusLagSec（extractCorpusTs 三路径只读 twitterInfo）结构性隔离；
 *   2. 证据是「同名事件背景热度」，section 渲染显式声明非本代币宣告语料，
 *      代币与事件的关联由 Jev 判断（web3_user_name_entity_acceptance/name_brand_hijack 题仍是判据）；
 *   3. 失败永不 throw：任何失败返回 null，analyzer 维持原拒 bit-identical。
 *
 * 缓存（getAccountWithFullTweets 同款手工 get/set，不走 CachedFetcher.fetchWithCache
 * ——失败 1h 冷却行会灭 PrecheckFailRetryService 重试窗）：
 *   ★只缓存「有语料」的结果（hasCorpus===true 才 set）。零结果/失败零痕迹——
 *   否则 1800s TTL（=no_public_info 重试域时长）会把重试窗内全部 ≤5 次重析
 *   冻死在首析快照上，晚到的推文永远翻不了案。
 *
 * 配置（config/narrative-engine.json searchFallback 节，段缺失=静默关）：
 *   { enabled, corpusMode:'empty', minNameChars, sinceDays, products:['Top','Latest'],
 *     count, stateTopTweets, stateMaxChars, timeoutMs, cacheTtlSec }
 *
 * ★2026-10-20 股城（STOCKOPOLIS）案用户裁定：「为什么要卡互动呢？不卡，只通过
 * 语料了解叙事」——搜索兜底不设互动门槛（原 bypass.minTweets/minTopEngagement
 * 已删）。去重剔转推后只要语料非空即旁路 no_public_info 交 Jev 判断；engagement
 * 只在 state/审计里展示，不参与准入。
 */

import { getConfig } from '../../engine/config.mjs';
import logger from '../../core/logger.mjs';
import { ExternalResourceCache } from '../../db/ExternalResourceCache.mjs';
import { searchTimeline } from '../../../utils/twitter-validation/index.js';

/** 缓存 resourceType（external_resource_cache.url + resource_type 联合键；key 非真 URL） */
const CACHE_RESOURCE_TYPE = 'twitter_search';

/** 进程内 in-flight 去重：同 rawQuery 并发共享一次调用（复蹭簇同 token 多调用点） */
const inflight = new Map();

/** 代码侧默认值（enabled 时必须显式配置的键见 getSearchFallbackConfig 校验；其余缺省回退此处） */
const CODE_DEFAULTS = {
  minNameChars: 4,
  sinceDays: 7,
  stateTopTweets: 5,
  stateMaxChars: 2500,
  timeoutMs: 5000,
  cacheTtlSec: 1800,
};

/**
 * 读取并校验 searchFallback 配置节
 * @param {Object} [options] - 单测注入 { config }（整个 config 对象形状，覆盖全局读取）
 * @returns {Object|null} 完整配置（含代码默认值）；段缺失 / enabled=false → null（静默关）
 * @throws enabled=true 但 products/count 残缺（部署错误 fail-loud，vision 同语义）
 */
export function getSearchFallbackConfig(options = {}) {
  const section = options.config
    ? (options.config.searchFallback ?? null)
    : (getConfig().searchFallback ?? null);
  if (!section || !section.enabled) return null;

  if (!Array.isArray(section.products) || section.products.length === 0
    || !section.products.every(p => p === 'Top' || p === 'Latest')) {
    throw new Error('searchFallback 配置残缺：products 须为非空数组（成员 Top/Latest）');
  }
  if (!Number.isFinite(section.count) || section.count <= 0) {
    throw new Error('searchFallback 配置残缺：count 须为正数');
  }
  if (section.corpusMode && section.corpusMode !== 'empty') {
    throw new Error(`searchFallback 配置残缺：corpusMode '${section.corpusMode}' 暂不支持（首版仅 'empty'，扩展位）`);
  }
  return { ...CODE_DEFAULTS, ...section };
}

/**
 * 构造搜索查询
 * @param {Object} tokenData - fetchTokenData 返回（name 恒 undefined，取 raw_api_data.name）
 * @param {Object} cfg - 已解析配置
 * @returns {{rawQuery:string, sinceDate:string, name:string}|null}
 *   null = 短名（去空格 < minNameChars）/ 名缺失 / 无创建时间锚（fail-safe 防全史无界搜索）
 */
export function buildSearchQuery(tokenData, cfg) {
  const name = (tokenData.name || tokenData.raw_api_data?.name || '').trim();
  if (!name || name.replace(/\s+/g, '').length < cfg.minNameChars) return null;
  const anchorSec = tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at || null;
  if (!anchorSec) return null;
  const sinceDate = new Date((anchorSec - cfg.sinceDays * 86400) * 1000).toISOString().slice(0, 10);
  return { rawQuery: `"${name}" since:${sinceDate}`, sinceDate, name };
}

/** 单推互动分：点赞 + 2×转发（转发传播权重更高） */
export function engagementOf(t) {
  return (t.favorite_count || 0) + 2 * (t.retweet_count || 0);
}

/**
 * 语料在场判定（2026-10-20 股城案用户裁定「为什么要卡互动呢？不卡，只通过语料
 * 了解叙事」）：去重+剔转推后只要语料非空即视为有语料，旁路 no_public_info 交
 * Jev 判断叙事价值。engagement 只作 state 展示/审计，绝不作为准入门槛。
 */
export function hasSearchCorpus(evidence) {
  return !!(evidence && evidence.uniqueTweets > 0);
}

/** 持久化瘦推文形态（控制 raw_api_data 膨胀，全量 <3KB） */
function _thinTweet(t, maxTextChars = 200) {
  return {
    id: t.tweet_id,
    at: t.created_at,
    user: t.author_screen_name,
    followers: t.author_followers_count,
    fav: t.favorite_count,
    rt: t.retweet_count,
    reply: t.reply_count,
    text: (t.text || '').slice(0, maxTextChars),
  };
}

/** 单产品采集：缓存命中直用 / miss 真调（fresh=true 供落缓存判定） */
async function _collectProduct(product, q, cfg) {
  const cacheKey = `twitter_search:${product}:${q.rawQuery}`;
  try {
    const cached = await ExternalResourceCache.get(cacheKey, CACHE_RESOURCE_TYPE, { maxAge: cfg.cacheTtlSec });
    if (cached && Array.isArray(cached.tweets)) return { tweets: cached.tweets, fresh: false };
  } catch (error) {
    logger.warn('SearchFallback', `缓存读失败降级真拉 | ${product} ${error.message}`);
  }
  const { tweets } = await searchTimeline({ rawQuery: q.rawQuery, product, count: cfg.count, timeoutMs: cfg.timeoutMs });
  return { tweets: Array.isArray(tweets) ? tweets : [], fresh: true };
}

/** 单次完整采集（inflight 体内）：两产品并发、部分失败降级、union 聚合、达阈值落缓存 */
async function _collectOnce(q, cfg) {
  const productsData = {};
  await Promise.all(cfg.products.map(async (product) => {
    try {
      productsData[product] = await _collectProduct(product, q, cfg);
    } catch (error) {
      logger.warn('SearchFallback', `搜索产品失败降级跳过 | ${product} ${error.message}`);
    }
  }));
  if (Object.keys(productsData).length === 0) return null; // 全失败 → null 维持原拒

  // union：tweet_id 去重 + 剔除纯转推（'RT @' 开头——防 1 原推+2 转推凑 minTweets）
  const seen = new Set();
  const union = [];
  for (const { tweets } of Object.values(productsData)) {
    for (const t of tweets) {
      if (!t.tweet_id || seen.has(t.tweet_id)) continue;
      if ((t.text || '').startsWith('RT @')) continue;
      seen.add(t.tweet_id);
      union.push(t);
    }
  }

  const evidence = {
    v: 1,
    query: q,
    sinceDate: q.sinceDate,
    fetchedAt: new Date().toISOString(),
    products: {},
    uniqueTweets: union.length,
    maxEngagement: union.reduce((m, t) => Math.max(m, engagementOf(t)), 0),
    meta: { topN: cfg.stateTopTweets, maxChars: cfg.stateMaxChars },
    hasCorpus: false,
  };
  for (const [product, { tweets }] of Object.entries(productsData)) {
    const ordered = product === 'Top'
      ? [...tweets].sort((a, b) => engagementOf(b) - engagementOf(a)) // Top：显式按互动序（不信任 API 排序）
      : [...tweets]; // Latest：返回序（时间序）
    evidence.products[product] = {
      total: tweets.length,
      maxEngagement: tweets.reduce((m, t) => Math.max(m, engagementOf(t)), 0),
      tweets: ordered.slice(0, cfg.stateTopTweets).map(t => _thinTweet(t)),
    };
  }

  // ★只有有语料才落缓存（零结果零痕迹——保 1800s 重试域内证据可增长）
  evidence.hasCorpus = hasSearchCorpus(evidence);
  if (evidence.hasCorpus) {
    for (const [product, { tweets, fresh }] of Object.entries(productsData)) {
      if (!fresh) continue; // 缓存命中的行已存在
      try {
        await ExternalResourceCache.set(
          `twitter_search:${product}:${q.rawQuery}`,
          CACHE_RESOURCE_TYPE,
          { tweets },
          { ttl: cfg.cacheTtlSec },
        );
      } catch (error) {
        logger.warn('SearchFallback', `缓存写失败（不影响本次证据）| ${product} ${error.message}`);
      }
    }
  }
  return evidence;
}

/**
 * 采集搜索证据（永不 throw）
 * @param {Object} tokenData - fetchTokenData 返回
 * @param {Object} [options] - { config }（已解析配置=getSearchFallbackConfig 结果；
 *   缺省时内部自读全局配置）
 * @returns {Promise<Object|null>} evidence（hasCorpus 标记语料是否非空）；
 *   null = 配置关/查询不可构造/全失败（analyzer 侧维持原拒 bit-identical）
 */
export async function collectSearchEvidence(tokenData, options = {}) {
  try {
    const cfg = options.config ?? getSearchFallbackConfig();
    if (!cfg) return null;
    const q = buildSearchQuery(tokenData, cfg);
    if (!q) return null;

    let promise = inflight.get(q.rawQuery);
    if (!promise) {
      promise = _collectOnce(q, cfg).finally(() => inflight.delete(q.rawQuery));
      inflight.set(q.rawQuery, promise);
    }
    return await promise;
  } catch (error) {
    logger.warn('SearchFallback', `搜索兜底失败（维持原拒）: ${error.message}`);
    return null;
  }
}
