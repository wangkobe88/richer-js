/**
 * Jev prestage 问题集（账号/社区代币前置判定，P3 迁移）
 *
 * 对象：analyzeAccountCommunityToken 的 LLM 段（原 account-community-analysis.mjs V2.0
 * + account-community-unverified.mjs V1.0 两条 prompt 合并为一次 speculative fan-out）。
 * 代码端按 addressVerified 分支采信：未命中 → 固定 account_based_meme 判定（只看
 * abm 两题）；命中 → token_type 二分 + project 评级数学（代码端，jev-prestage-mapper）。
 *
 * 版本：改动任何一题的 instructions/criteria 后必须 bump JEV_PRESTAGE_QUESTIONS_VERSION
 * P1.0：首版（2026-09-21），规则从 V2.0/V1.0 prompt 忠实提炼
 * P1.1：prestage_token_type 判据修正——类型判断与账号规模解耦（V2.0 语义：
 *   类型只看是否创造全新 IP 概念，规模走代码端底线过滤）。P1.0 校准发现低粉
 *   project 账号（自称产品但粉<60）被"small community"信号误吸为 web3ip，
 *   导致 low→unrated 评级方向反转
 * P1.2：P1.1 绝对化（"size NOT a criterion, REGARDLESS of size"）矫枉过正，
 *   真 web3ip 样本 10/14 被判 project。折中：project 侧保留"低粉产品号是
 *   project（规模由代码端过滤）"澄清，web3ip 侧恢复 V2.0 的伴随特征描述
 *   （小社区/早期/IP 叙事为主体）——规模是伴随信号而非充分条件
 */

export const JEV_PRESTAGE_QUESTIONS_VERSION = 'P1.2';

/**
 * 构建 prestage 问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildPrestageQuestions() {
  return {

    // ── 1. 币种类型（仅 addressVerified=true 时采信；原 V2.0 第一步二分）──
    prestage_token_type: {
      type: 'choice',
      instructions: `Token type behind this coin. The contract address IS verified in the account/community's bio or posts (or on its official website), so this is an official token of that account/community.
Decide by the account's MAIN narrative: is the story a functional product/service, or a brand-new IP concept people rally around? Follower count alone decides nothing here — a tiny account promoting a concrete product is still project (its follower baseline is checked separately in code), and an IP-concept account is web3_native_ip_early even if it also has a simple website.
- project: the account/community introduces a concrete product, technology, service or development plan; posts cover tech updates / product launches / development progress / partnerships; typically has an official website / whitepaper / technical docs; formal language emphasizing function and utility. Bot/tool accounts (launch bots, fee bots) that describe a functional service are also project.
- web3_native_ip_early: a BRAND-NEW IP concept/title/role was invented that did not exist before the token was created. It may take crypto figures or concepts as INSPIRATION but does NOT reuse the original name. Key test: was a new title/concept/role created that people could rally around, and is that IP concept the account's main story (rather than a product's features)? Qualifying examples: "币安之王" (King of Binance), "ETH之神" (God of ETH), "火星CEO" (Mars CEO), "币安女英雄" (Heroine of Binance), "币安改变人生" (Binance changes lives). Typical accompanying signals: small early-stage community (followers <5000 / members <500), few posts (<50), at least one of account/website/community as infrastructure.`,
      criteria: {
        project: 'Concrete product/tech/service with formal function-oriented content; official website/whitepaper/tech docs; low followers does NOT make it web3ip',
        web3_native_ip_early: 'Brand-new invented IP title/concept as the account\'s main story (inspired by but not reusing existing names); typically small early-stage community',
      },
    },

    // ── 2. abm 条件一：名称关联（仅 addressVerified=false 时采信；原 V1.0 第一步）──
    prestage_abm_name_link: {
      type: 'choice',
      instructions: `Name link between the token and the account (evaluate only the token Symbol/Name vs the account's screen name, display name, bio and post content). Pick the strongest link type.`,
      criteria: {
        exact: 'Exact match — token Symbol/Name equals the account name or display name (e.g. "PP" = "Prison Professors")',
        abbreviation: 'Abbreviation — token Symbol is a common abbreviation of the account/display name (e.g. "MS" = "Michael Santos")',
        semantic: 'Semantic link — token name has a clear semantic relation to the account bio or content (e.g. "Prison Professors" ↔ prison education topics)',
        none: 'No link — token name has nothing to do with the account',
      },
    },

    // ── 3. abm 条件二：Web3 流量事件（仅 addressVerified=false 时采信；原 V1.0 第二步）──
    prestage_abm_web3_traffic: {
      type: 'choice',
      instructions: `Web3 traffic event: did the ACCOUNT ITSELF recently (within 30 days) generate real Web3-related attention or interaction?
Counts as traffic (any one):
- The account was PROACTIVELY mentioned or engaged with by a well-known crypto KOL/institution (CZ, Binance, a16z, etc.) — NOT the account @-ing them itself
- The account's original crypto content received SIGNIFICANT engagement (substantial likes/retweets/replies, not single digits)
- Real TWO-WAY interaction with a major Web3 IP (both sides responded, not one-way @)
Does NOT count (common false positives):
- Self-declared bio claims ("Backed by XX", "Partnered with XX") — no evidence
- Reposting/retweeting someone else's content — not the account's own traffic
- The account @-mentioned a big IP but got no response — one-way action
- A marketing post without engagement data — no traffic evidence`,
      criteria: {
        has_traffic: 'At least one real Web3 traffic event within 30 days (proactive mention by crypto KOL/institution, significant engagement on original crypto content, or two-way interaction with a major Web3 IP)',
        no_traffic: 'No real Web3 traffic event within 30 days (self-declared claims, reposts, one-way @, or engagement-free marketing do not count)',
      },
    },

    // ── 4. 社区活跃度（仅 addressVerified=true 且社区型 project 评级用；原 V2.0 社区表"日活高"门槛）──
    prestage_community_activity: {
      type: 'choice',
      instructions: `Community recent activity level (evaluate only for community-type corpus, based on recent posts frequency and engagement).`,
      criteria: {
        high: 'High — frequent recent posts with active engagement (high daily activity)',
        medium: 'Medium — moderately active',
        low: 'Low — almost no recent activity',
      },
    },
  };
}
