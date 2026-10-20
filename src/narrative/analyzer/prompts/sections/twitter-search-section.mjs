/**
 * 推特搜索事件背景 Section（C76 空语料搜索兜底）
 *
 * 渲染 twitter-search-fallback 采集的搜索证据为 Jev state 独立段。挂 header
 * [PRECOMPUTED] 同位形（不占四区配额）——本段只反映「同名事件背景热度」，
 * 不是本代币自有语料：代币语料四区（twitter/websiteGithub/video/others）与
 * 本段结构性分离，lag 口径（extractCorpusTs 三路径）不读本段任何数据。
 *
 * 红线：本 section 只读 searchEvidence 参数，绝不触碰 twitterInfo 三键
 * （主推/父推/第二推文）——narrativeCorpusLagSec 隔离防线，单测 G 段源码锁。
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

const DEFAULT_MAX_CHARS = 2500;
const MAX_TWEET_TEXT_CHARS = 140;

/** 推文时间渲染：Twitter legacy 格式（Wed Oct 15 08:00:00 +0000 2026）→ MM-DD；解析失败原样前缀 */
function _formatDate(at) {
  if (!at) return '?';
  const ts = Date.parse(at);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${mm}-${dd}`;
  }
  return String(at).slice(0, 10);
}

/**
 * 构建推特搜索事件背景 section
 * @param {Object|null} searchEvidence - twitter-search-fallback 采集的证据（含 products/query/hasCorpus）
 * @param {Object} [options]
 * @param {number} [options.maxChars] - 段落字符上限（默认 2500；缺省回退 evidence.meta.maxChars）
 * @returns {string} section 文本；无证据/空产品 → ''（无证据时 state 逐字节 bit-parity）
 */
export function buildTwitterSearchSection(searchEvidence, options = {}) {
  if (!searchEvidence || !searchEvidence.products) return '';
  const productNames = Object.keys(searchEvidence.products)
    .filter(p => searchEvidence.products[p] && searchEvidence.products[p].total > 0);
  if (productNames.length === 0) return '';

  const maxChars = options.maxChars ?? searchEvidence.meta?.maxChars ?? DEFAULT_MAX_CHARS;
  const queryName = searchEvidence.query?.term || searchEvidence.query?.rawQuery || '';

  const lines = [
    '[TWITTER_SEARCH] 推特搜索事件背景（系统预取，非代币自有语料）',
    `⚠️ 本代币自身无任何宣告语料（元数据/官网/推文全空）；以下为按搜索词「${queryName}」、`
      + `时间窗 ${searchEvidence.sinceDate || '?'} 起的推特搜索结果，反映同名事件的背景热度，`
      + `不是本代币的宣告推文，代币与事件的关联需你自行判断`,
  ];

  // 聚合行：两产品命中数/最大互动 + 口径声明
  const summaryParts = productNames.map(p => {
    const pr = searchEvidence.products[p];
    return `${p} ${pr.total} 条（最大互动 ${pr.maxEngagement}）`;
  });
  lines.push(`搜索命中 ${summaryParts.join(' / ')}；互动口径=点赞+2×转发，单推最大 ${searchEvidence.maxEngagement ?? 0}`);

  // Top / Latest 块（服务层已按各产品口径排序截断：Top 按互动序 / Latest 返回序）
  for (const p of productNames) {
    const tweets = searchEvidence.products[p].tweets || [];
    if (tweets.length === 0) continue;
    lines.push(`${p}（${p === 'Top' ? '按互动排序' : '时间序'}前 ${tweets.length} 条）:`);
    for (const t of tweets) {
      const text = (t.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TWEET_TEXT_CHARS);
      lines.push(`[${_formatDate(t.at)}] @${t.user || '?'}(粉丝${t.followers ?? 0}) 赞${t.fav ?? 0}/转${t.rt ?? 0}/回${t.reply ?? 0}：${text}`);
    }
  }

  return safeSubstring(lines.join('\n'), maxChars, '\n…(搜索结果已截断)');
}
