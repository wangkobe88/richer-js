/**
 * Jev state 构造器
 *
 * 把原 3 阶段管线的全部语料（复用 prompts/sections/*.mjs 同一批构建器，
 * 保证 Jev 看到的材料与原 Stage1 Prompt 完全同源）压进一个 state 字符串，
 * 外加 [PRECOMPUTED] 块（代码端已确定的事实：推文类型/超大IP命中/日期）。
 *
 * 字符预算：60000（≈25-30k token，给 questions 留足 32k 上限内的空间）。
 * 分区配额（相互独立，不跨区挤占，保证语料多样性）：
 *   twitter 40% / website+github 25% / video 15% / 其余 20%
 * 超限处理：区内 section 按 priority 顺序保留，尾部整段丢弃并记入
 * stats.droppedSections（不做静默截断，供 dry-run/线上监控截断率）。
 */

import { safeSubstring } from '../utils/data-cleaner.mjs';
import { classifyTweetType } from '../services/tweet-type-classifier.mjs';
import { generateAccountBackgroundsPrompt } from '../prompts/account/account-backgrounds.mjs';
import { buildTwitterSection } from '../prompts/sections/twitter-section.mjs';
import { buildWebsiteSection } from '../prompts/sections/website-section.mjs';
import { buildGithubSection } from '../prompts/sections/github-section.mjs';
import { buildWeiboSection } from '../prompts/sections/weibo-section.mjs';
import { buildVideoSection } from '../prompts/sections/video-section.mjs';
import { buildWeixinSection } from '../prompts/sections/weixin-section.mjs';
import { buildAmazonSection } from '../prompts/sections/amazon-section.mjs';
import { buildXiaohongshuSection } from '../prompts/sections/xiaohongshu-section.mjs';
import { buildInstagramSection } from '../prompts/sections/instagram-section.mjs';
import { buildBinanceSquareSection } from '../prompts/sections/binance-square-section.mjs';
import { buildTwitterSearchSection } from '../prompts/sections/twitter-search-section.mjs';
import { buildKnowledgeSection } from '../prompts/sections/knowledge-section.mjs';

export const STATE_CHAR_BUDGET = 60000;

/** prestage（账号/社区代币前置判定）state 预算：语料量远小于主路径（单账号 20 推），独立小预算 */
export const PRESTAGE_STATE_CHAR_BUDGET = 20000;

/** 各区占预算比例（和为 1） */
const SECTION_GROUP_QUOTAS = {
  twitter: 0.40,
  websiteGithub: 0.25,
  video: 0.15,
  others: 0.20,
};

/** 区内剩余配额低于该值时不再塞截断段（避免只剩个标题碎片） */
const MIN_SECTION_KEEP_CHARS = 200;

/**
 * 构建 Jev state
 * @param {Object} tokenData - 代币数据（同 buildStage1Preprocessing 的输入）
 * @param {Object} fetchResults - 数据获取结果（同 Stage1）
 * @param {Object} [options]
 * @param {Object|null} [options.superIPInfo] - 超大IP注册表命中信息（C83：注入
 *   认证事实行 + 反混淆提示行进 PRECOMPUTED，不再预评分——评分全归 Jev 题集）
 * @param {Object|null} [options.tweetClassification] - 预分类结果（不传则现场分类）
 * @param {number} [options.now] - 时间基准（毫秒时间戳；默认 Date.now()）。
 *   生产传代币创建时间（时效=发币时语料新鲜度，与何时分析无关——补跑/回测/延迟分析幂等，
 *   与 pre-check 规则2 同裁定）；dry-run/校准用历史 token 时传旧分析时刻，保证时效项与旧评级同基准可比
 * @returns {{state: string, stats: Object}}
 *   stats: { totalChars, budget, groups: {name, quota, used, droppedSections[]} }
 */
export function buildJevState(tokenData, fetchResults, options = {}) {
  const {
    twitterInfo = null,
    websiteInfo = null,
    githubInfo = null,
    amazonInfo = null,
    extractedInfo = null,
    backgroundInfo = null,
    youtubeInfo = null,
    douyinInfo = null,
    tiktokInfo = null,
    bilibiliInfo = null,
    xiaohongshuInfo = null,
    instagramInfo = null,
    weixinInfo = null,
    binanceSquareInfo = null,
    accountSummary = null,
    relatedAccounts = null,
  } = fetchResults;

  // ── 头部：代币信息 + 当前时间（不占分区配额，预算从余量扣）──────────
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const nowMs = options.now ?? Date.now();
  const currentDate = new Date(nowMs).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
  });

  const headerParts = [
    `[TOKEN]`,
    `Symbol: ${tokenData.symbol || ''}`,
    tokenName ? `Name: ${tokenName}` : null,
    `Address: ${tokenData.address || ''}`,
    extractedInfo?.intro_en ? `Intro(EN): ${extractedInfo.intro_en}` : null,
    extractedInfo?.intro_cn ? `Intro(CN): ${extractedInfo.intro_cn}` : null,
    '',
    `[TIME]`,
    `Now: ${currentDate}（重要：现在是2026年，任何2026年或之前的时间都是过去或现在，不是未来）`,
  ].filter(p => p !== null);

  // ── PRECOMPUTED：代码端已确定的事实（Jev 无需重复判断）─────────────
  const tweetClassification = options.tweetClassification || classifyTweetType(twitterInfo);
  const precomputed = [
    '',
    '[PRECOMPUTED] （以下事实由系统预先判定，直接采信）',
    `tweet_type: ${tweetClassification.type}（direct_tweet=推文即事件本身/angle_seeking=借势找角度/interpretive_reply=解读他人消息）`,
    `tweet_type_reason: ${tweetClassification.reason || ''}`,
    // C113（J1.46）：上面 reason 里的粉丝/赞/转是 C74 时效分桶产物——载体推文自身
    // 账号数据。不划清边界它就顶着「直接采信」帽子污染量级/dim2 判断现场（哭哭奶龙
    // 案 dim2 8.2 按载体 138 粉判了奶龙 IP 方权重）
    `tweet_type_note: reason 中的粉丝/赞/转是载体推文（陈述者）自身的账号数据，仅用于时效分桶——不是事件传播数据；量级/dimension2/传播判定不得以载体账号数据评事件主体（找角度推文按被借势事件/IP自身的传播与知名度判，J1.20形状②/J1.46）`,
  ];
  if (options.superIPInfo) {
    precomputed.push(
      // J1.56（C126）：键名 super_ip_hit 与币名题选项同名=概念复用混淆源——改
      // corpus_author_identity，只描述「语料作者是谁」这一作者侧事实。
      `corpus_author_identity: ${options.superIPInfo.name}（${options.superIPInfo.type}/${options.superIPInfo.tier}级，${options.superIPInfo.desc}）`,
      // C83 反混淆提示（BI 簇案）：身份事实进直接采信块，但「作者是 IP」≠「票属于
      // IP」——关联/主体资格/量级仍归题集判定，防 Jev 把作者认证误当代币背书。
      // J1.56 补充：作者原话票（币名逐字出自主推文本）由代码侧 authorUtterance
      // 事实承担 C88 救援腿，**不要求 Jev 在币名实体题里因此升档**——问候语/口头
      // 禅如实判 no_entity（C126 何一「こんにちは」裁定）。
      `corpus_author_identity_note: 以上仅为语料作者的身份认证事实（该账号确为注册表在册IP）。代币与该实体的实际关联、代币主体资格与事件量级仍须按题集逐题判定；作者身份本身不构成对该代币的背书（作者本人原话票的识别由系统代码侧事实完成，请勿在币名映射实体题里因作者身份升档；本约束仅针对币名映射实体题，web3_user_event_fit 可按发言者身份判事件与 web3 用户的契合——J1.90/C152）`,
    );
  }

  // ── 分区语料 ────────────────────────────────────────────────────────
  const stats = {
    budget: STATE_CHAR_BUDGET,
    totalChars: 0,
    groups: {},
    droppedSections: [],
  };

  const groups = [
    {
      name: 'twitter',
      sections: [
        accountSummary ? `[ACCOUNT_SUMMARY]\n${accountSummary}` : null,
        generateAccountBackgroundsPrompt(twitterInfo),
        buildTwitterSection(twitterInfo, { now: nowMs }),
        relatedAccounts?.length ? `[RELATED_ACCOUNTS]\n${relatedAccounts.map(a =>
          `@${a.screen_name || a.username || '?'}(${a.role || '?'}) 粉丝:${a.followers_count || 0}${a.verified ? ' ✓' : ''}${a.description ? ` 简介:${a.description}` : ''}`
        ).join('\n')}` : null,
      ].filter(Boolean),
    },
    {
      name: 'websiteGithub',
      sections: [
        buildWebsiteSection(websiteInfo),
        buildGithubSection(githubInfo),
      ].filter(Boolean),
    },
    {
      name: 'video',
      sections: [buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo)].filter(Boolean),
    },
    {
      name: 'others',
      sections: [
        buildWeiboSection(backgroundInfo),
        buildWeixinSection(weixinInfo),
        buildXiaohongshuSection(xiaohongshuInfo),
        buildInstagramSection(instagramInfo),
        buildAmazonSection(amazonInfo),
        buildBinanceSquareSection(binanceSquareInfo, { now: nowMs }),
      ].filter(Boolean),
    },
  ];

  // ── 搜索事件背景段（C76 空语料搜索兜底）：证据走 tokenData.raw_api_data.search_evidence
  // （analyzer 旁路时浅拷贝附加），无证据返回 '' → headerStr 逐字节与现状一致（bit-parity）。
  // 挂 header 与 [PRECOMPUTED] 同位形，不占四区配额（背景证据非代币自有语料）。
  // prestage 路径刻意不接（账号/社区判定不消费搜索背景）
  const searchSection = buildTwitterSearchSection(tokenData.raw_api_data?.search_evidence, { now: nowMs });
  // ── 系统知识库背景段（C165）：analyzer 匹配命中透传 options.knowledgeMatches，
  // 无命中返回 '' → bit-parity（与搜索段两段独立判空，互不干扰）
  const knowledgeSection = buildKnowledgeSection(options.knowledgeMatches, options.knowledgeMaxChars);
  const headerStr = headerParts.join('\n') + '\n' + precomputed.filter(Boolean).join('\n')
    + (searchSection ? '\n\n' + searchSection : '')
    + (knowledgeSection ? '\n\n' + knowledgeSection : '');
  let remaining = STATE_CHAR_BUDGET - headerStr.length;
  const bodyParts = [];

  for (const group of groups) {
    const quota = Math.floor(STATE_CHAR_BUDGET * (SECTION_GROUP_QUOTAS[group.name] || 0));
    const groupStats = { name: group.name, quota, used: 0, droppedSections: [] };
    let used = 0;

    for (let i = 0; i < group.sections.length; i++) {
      const section = group.sections[i];
      const remainingQuota = quota - used;
      if (section.length <= remainingQuota) {
        bodyParts.push(section);
        used += section.length;
        continue;
      }
      // 放不下：剩余空间够大则截断保头（section 优先级从前往后递减），
      // 否则从本段起整段丢弃——两种情况都记录，后续 section 一并丢弃
      if (remainingQuota >= MIN_SECTION_KEEP_CHARS) {
        bodyParts.push(safeSubstring(section, remainingQuota, '\n...(内容已截断)'));
        used += remainingQuota;
        groupStats.truncatedSection = `${group.name}[${i}]`;
      }
      for (let j = remainingQuota >= MIN_SECTION_KEEP_CHARS ? i + 1 : i; j < group.sections.length; j++) {
        groupStats.droppedSections.push(`${group.name}[${j}](${group.sections[j].length}字符)`);
        stats.droppedSections.push(`${group.name}[${j}]`);
      }
      break;
    }
    groupStats.used = used;
    stats.groups[group.name] = groupStats;
    remaining -= used;
  }

  const state = headerStr + '\n\n' + bodyParts.join('\n\n');
  stats.totalChars = state.length;
  if (knowledgeSection) {
    stats.knowledgeSection = {
      chars: knowledgeSection.length,
      entries: options.knowledgeMatches?.matches?.length ?? 0,
      truncated: Boolean(options.knowledgeMatches?.truncated),
    };
  }
  return { state, stats };
}

/**
 * 构建 prestage state（账号/社区代币前置判定，P3）
 *
 * 语料与原 V2.0/V1.0 prompt 同源：fullAccountOrCommunityData（规则验证段已取回的
 * 账号/社区数据，50 条完整推文——避免旧 prompt 的二次 fetch），state 渲染前 20 条
 * 各 100 字（与旧 prompt 的推文摘要量一致）。项目币路径附加 website section。
 *
 * @param {Object} tokenData - 代币数据
 * @param {Object} fullAccountOrCommunityData - getAccountWithFullTweets/getCommunityWithFullTweets 结果
 * @param {Object} [options]
 * @param {boolean} [options.addressVerified] - 规则验证的地址命中结果
 * @param {Object|null} [options.rulesResult] - performRulesValidation 结果（名称匹配/账号质量进 PRECOMPUTED）
 * @param {Object|null} [options.websiteInfo] - 网站信息（项目币路径，地址从网站验证时）
 * @param {Object|null} [options.websiteCheck] - P1.14/C164 项目币官网核验状态：
 *   {status:'reachable'|'unreachable'|'none', url, info}——仅 addressVerified=true 时
 *   传入；PRECOMPUTED 注入 website_check 状态行，reachable 时 info 渲染【网页内容】段
 * @param {number} [options.now] - 时间基准（毫秒时间戳；生产传代币创建时间使时效与何时分析
 *   无关——补跑/回测/延迟分析幂等；校准历史 token 时传旧分析时刻）
 * @returns {{state: string, stats: Object}} stats: { totalChars, budget, droppedSections[] }
 */
export function buildPrestageState(tokenData, fullAccountOrCommunityData, options = {}) {
  const data = fullAccountOrCommunityData;
  const isAccount = data.type === 'account';
  const nowMs = options.now ?? Date.now();
  const currentDate = new Date(nowMs).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
  });

  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const headerParts = [
    `[TOKEN]`,
    `Symbol: ${tokenData.symbol || ''}`,
    tokenName ? `Name: ${tokenName}` : null,
    `Address: ${tokenData.address || ''}`,
    tokenData.raw_api_data?.intro_en ? `Intro(EN): ${tokenData.raw_api_data.intro_en}` : null,
    tokenData.raw_api_data?.intro_cn ? `Intro(CN): ${tokenData.raw_api_data.intro_cn}` : null,
    '',
    `[TIME]`,
    `Now: ${currentDate}（重要：现在是2026年，任何2026年或之前的时间都是过去或现在，不是未来）`,
  ].filter(p => p !== null);

  // ── PRECOMPUTED：规则验证已确定的事实（旧 prompt 的地址验证横幅等价物）────
  const precomputed = ['', '[PRECOMPUTED] （以下事实由系统预先判定，直接采信）'];
  if (options.addressVerified) {
    // P1.9（C46 MarsCoin 案）措辞中性化：原「项目官方网站…项目方官方代币」在
    // Jev 判 token_type 前预设了 project 方向——社区 meme 主账号（官网/简介挂 CA）
    // 也命中此横幅，被带节奏判 project。「官方」只陈述地址归属事实，不预设类型
    precomputed.push(`address_verified: true（${options.websiteInfo ? `官方网站 ${options.websiteInfo.url || ''} 的内容中包含代币合约地址，确认为该账号/社区的官方代币` : '账号简介或推文中找到了代币合约地址，确认为该账号/社区的官方代币'}）`);
  } else {
    precomputed.push(`address_verified: false（账号简介和推文中都没有找到代币合约地址——真项目方会公示地址，这不是官方代币，而是以账号为背景的 meme 币）`);
  }
  if (options.rulesResult) {
    const r = options.rulesResult;
    if (r.nameMatch !== null && r.nameMatch !== undefined) {
      precomputed.push(`name_literal_match: ${r.nameMatch}（代码端字面匹配：${r.details?.nameMatchType || '-'}；语义关联仍需自行判断）`);
    }
    if (r.details?.accountQuality) {
      const q = r.details.accountQuality;
      precomputed.push(`account_quality: 粉丝${q.followersCount} 发推${q.statusesCount} 认证:${q.verified || q.isBlueVerified ? '是' : '否'}${q.matchedConditions?.length ? `（${q.matchedConditions.join(' + ')}）` : ''}`);
    }
  }
  // P1.14/C164 项目币官网核验状态行（代码端事实：抓没抓到/有没有站——reachability 是
  // 代码判定的，Jev 只负责 reachable 时的内容判定与 none 时的基础设施宣称判定）
  if (options.websiteCheck && options.addressVerified) {
    const wc = options.websiteCheck;
    if (wc.status === 'reachable') {
      precomputed.push(`website_check: reachable（官方网站 ${wc.url || ''} 抓取成功，正文见【网页内容】段）`);
    } else if (wc.status === 'unreachable') {
      precomputed.push(`website_check: unreachable（提供了官方网站 ${wc.url || ''} 但抓取失败：打不开/超时/被拦——注意死链不等于没提供站）`);
    } else {
      precomputed.push('website_check: none（未提供有效官方网站；聚合器自动代币页不算网站证据）');
    }
  }

  // ── 账号/社区信息块（旧 prompt 的【账号信息】段等价物）──────────────────
  const infoBlock = isAccount ? [
    `[ACCOUNT]`,
    `@${data.screen_name || ''}（显示名: ${data.name || ''}）`,
    `简介: ${data.description || '无'}`,
    `粉丝数: ${(data.followers_count || 0).toLocaleString()}`,
    `认证状态: ${data.verified ? '认证' : data.is_blue_verified ? '蓝V' : '无'}`,
    `推文总数: ${(data.statuses_count || 0).toLocaleString()}`,
  ] : [
    `[COMMUNITY]`,
    `社区名: ${data.name || ''}`,
    `简介: ${data.description || '无'}`,
    `成员数: ${(data.members_count || 0).toLocaleString()}`,
    `管理员数: ${data.moderators_count || 0}`,
    `推文总数: ${(data.timeline_tweet_count || 0).toLocaleString()}`,
  ];

  // ── 推文列表：前 20 条各 500 字（P1.6：旧 100 字/条是 3-stage prompt 摘要量
  //    遗留——budget 20k 实际只用 ~3.5k，产品功能描述却常落在推文 100 字之后被
  //    整体切断（THESIS 案实度 1.81 分时 Jev 没看到产品用途段）。放宽到 500：
  //    20×500+开销 ≈ 11k < 20k 预算；超预算时组装层仍整段 drop 记 droppedSections）──
  const tweets = (data.tweets || []).slice(0, 20);
  const tweetsBlock = tweets.length ? [
    `[RECENT_POSTS]（${tweets.length}条）`,
    ...tweets.map((t, i) => {
      const author = !isAccount && t.user?.screen_name ? `@${t.user.screen_name}: ` : '';
      return `${i + 1}. [${t.created_at || ''}] ${author}${safeSubstring(t.text || '', 500)}`;
    }),
  ] : null;

  // ── website section（项目币路径：地址从网站验证时传入 / P1.14 官网核验 reachable）──
  const websiteSection = options.websiteCheck?.info
    ? buildWebsiteSection(options.websiteCheck.info)
    : (options.websiteInfo ? buildWebsiteSection(options.websiteInfo) : null);

  // ── 组装：预算内从低优先级（website）到高优先级（推文）保内容 ────────────
  // 系统知识库背景段（C165 用户裁定 prestage 也注入——股票代币/Flap 平台概念对
  // 项目币定档同样关键；与主路径搜索段「prestage 刻意不接」是有意差异）。
  // includePrestage 配置门在调用方（account-analysis-service）判定，builder 只认
  // options.knowledgeMatches 传入与否；无命中返回 '' → bit-parity
  const knowledgeSection = buildKnowledgeSection(options.knowledgeMatches, options.knowledgeMaxChars);
  const headerStr = headerParts.join('\n') + '\n' + precomputed.filter(Boolean).join('\n')
    + (knowledgeSection ? '\n\n' + knowledgeSection : '');
  const stats = { budget: PRESTAGE_STATE_CHAR_BUDGET, totalChars: 0, droppedSections: [] };

  const sections = [
    { name: 'info', body: infoBlock.join('\n') },
    { name: 'posts', body: tweetsBlock ? tweetsBlock.join('\n') : null },
    { name: 'website', body: websiteSection },
  ];

  const bodyParts = [];
  let remaining = PRESTAGE_STATE_CHAR_BUDGET - headerStr.length;
  for (const { name, body } of sections) {
    if (!body) continue;
    if (body.length <= remaining) {
      bodyParts.push(body);
      remaining -= body.length;
    } else {
      stats.droppedSections.push(`${name}(${body.length}字符)`);
    }
  }

  const state = headerStr + '\n\n' + bodyParts.join('\n\n');
  stats.totalChars = state.length;
  if (knowledgeSection) {
    stats.knowledgeSection = {
      chars: knowledgeSection.length,
      entries: options.knowledgeMatches?.matches?.length ?? 0,
      truncated: Boolean(options.knowledgeMatches?.truncated),
    };
  }
  return { state, stats };
}
