/**
 * 系统知识库背景 Section（C164 叙事分析知识库）
 *
 * 渲染匹配命中的知识条目（蓝筹/准蓝筹/BSC 概念）为 Jev state 独立段。挂 header
 * 与 [PRECOMPUTED]/[TWITTER_SEARCH] 同位形（不占四区配额）——本段是系统预取的
 * 背景知识，不是本代币自有语料：代币语料四区与本段结构性分离，lag 口径
 * （extractCorpusTs 三路径）不读本段任何数据。
 *
 * 免责声明与 superIP 反混淆 note 同精神：背景事实≠关联背书——条目与本代币的
 * 关联、条目事实的适用性、代币主体资格与价值仍归题集逐题判定。
 *
 * prestage 路径同款注入（用户裁定双路径；与搜索段「prestage 刻意不接」是有意
 * 差异——股票代币/Flap 平台概念对项目币定档同样关键）。
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

const DEFAULT_MAX_CHARS = 2000;
const MAX_ENTRY_CHARS = 300;

/** 规则中文名（审计/展示；未知规则原样） */
const RULE_LABELS = {
  address_exact: '本票即在册代币',
  twitter_exact: '推特号一致',
  name_exact: '名字全等',
  name_substring: '名字共享片段',
  corpus_contains: '语料提及',
  concept_keyword: '语料关键词',
};

/** 条目事实尾行（按 kind 取最能说明身份的字段） */
function _factLine(entry) {
  const parts = [];
  if (entry.kind === 'bluechip' && Number.isFinite(entry.athMarketCapUsd)) {
    parts.push(`ATH市值≈$${Math.round(entry.athMarketCapUsd / 1000)}k`);
  }
  if (entry.kind === 'quasi') {
    if (entry.graduatedAt) parts.push(`毕业 ${String(entry.graduatedAt).slice(0, 10)}`);
    if (entry.rating) parts.push(`本系统评 ${entry.rating}`);
  }
  if (entry.rating && entry.kind === 'bluechip') parts.push(`本系统评 ${entry.rating}`);
  return parts.join('；');
}

/**
 * 构建系统知识库背景 section
 * @param {Object|null} knowledgeMatches - matchKnowledge 结果（{matches, truncated}）；null/空 matches → ''
 * @param {Object} [options]
 * @param {number} [options.maxChars] - 段落字符上限（默认 2000）
 * @returns {string} section 文本；无命中 → ''（state 逐字节 bit-parity）
 */
export function buildKnowledgeSection(knowledgeMatches, options = {}) {
  const matches = knowledgeMatches?.matches;
  if (!Array.isArray(matches) || matches.length === 0) return '';

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const lines = [
    '[KNOWLEDGE_BASE] 系统知识库背景（系统预取，非代币自有语料）',
    `⚠️ 以下条目由系统按地址/推特/名字/语料提及匹配注入，是链上与概念背景知识而非本代币的宣告语料；`
      + `条目与本代币的关联、条目事实的适用性、代币主体资格与价值仍须按题集逐题判定`,
  ];

  for (const m of matches) {
    const e = m.entry || {};
    const idPart = e.address ? `, ${e.address.slice(0, 6)}…${e.address.slice(-4)}` : '';
    const symPart = e.symbol ? ` ${e.symbol}` : '';
    const fact = _factLine(e);
    const narrativeFull = (e.narrative || '').replace(/\s+/g, ' ').trim();
    const narrative = narrativeFull.length > MAX_ENTRY_CHARS
      ? `${narrativeFull.slice(0, MAX_ENTRY_CHARS)}…` : narrativeFull;
    const via = RULE_LABELS[m.rule] || m.rule;
    const matchedOn = m.matchedOn ? `「${m.matchedOn}」` : '';
    lines.push(
      `- [${e.kind}] ${e.name}${symPart}${idPart}${narrative ? ` 叙事：${narrative}` : ''}`
      + `${fact ? `（${fact}）` : ''}。匹配：${via}${matchedOn}`,
    );
  }
  if (knowledgeMatches.truncated) {
    lines.push(`（命中条目超注入上限，已按匹配优先级截断）`);
  }

  return safeSubstring(lines.join('\n'), maxChars, '\n…(知识条目已截断)');
}
