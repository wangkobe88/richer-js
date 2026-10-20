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
 * P1.3：题面未动——mapper 端 project 评级表加账号信用降档（J1.8 量表校准
 *   同例 bump：聚合语义变化须可按版本筛历史行）。x-0 案（C15）：买粉新号
 *   131 粉精确卡进 mid 带（粉丝是评级表唯一量化指标的盲区）→ 推文 <5 或
 *   账号年龄 <30 天（token 创建时点锚定，重跑/回测幂等）→ low
 * P1.4：题面未动——mapper 端消灭 unrated（2026-09-27 用户裁定：分析完成的结果
 *   必须落在 low/mid/high，9 只保留给直调失败/超时/未触发）。abm 双条件满足
 *   unrated→mid；web3_native_ip_early 不再 unrated"等社区成长"，复用 rateProject
 *   粉丝带 + P1.3 降档按账号基本面给结论（蝴蝶轮回 168 粉 → mid）
 * P1.5：新增恒带第 5 题 prestage_project_quality（项目实度 0-5：产品价值 + 推文
 *   内容质量两维度，账号注册时间/粉丝数/认证不构成证据）。2026-10-01 用户裁定
 *   （C35 轮 WIRED 0x55db4b1f 案：flap launchpad 基础设施项目、币后 15 分钟开的
 *   发币专用号被 P1.3 年龄一刀切）：addressVerified 走项目后账号新不再一票否决，
 *   以项目实度为根本——mapper 端 age<30 分支从 hard low 改为实度分 ≥3 豁免降档
 *   走粉丝带（<3 或缺分 fail-closed 维持 low）；推文 <5 保留拦（无内容=质量无）。
 *   token_type 是 Jev 判的、调用前不可知，故恒带（abm/community 型不消费该题）
 * P1.6：题面未动——state 构造变化（jev-state-builder RECENT_POSTS 每条 100→500
 *   字）。100 字/条是 3-stage prompt 摘要量遗留：budget 20k 实际只用 ~3.5k 却把
 *   推文截在产品功能描述之前（THESIS 0x4519cacc 案实度 1.81 分时 Jev 没看到
 *   产品用途段，营销 hook 恰好都在前 100 字）；放宽后项目实度/内容质量类判定
 *   才有完整输入。同 token 两版本下的分数不可直接比较
 * P1.7：判据措辞修正——P1.5/P1.6 的分界词「可验证的可用功能」「产品可验证」把
 *   判据立在了 Jev 做不到的事上（只有语料，无法实证产品真实可用；2026-10-01
 *   用户裁定：「不需要产品实证，你要怎么实证呢」）。全部判据落到语料文本层：
 *   产品价值 = 描述的具体性（在解决什么问题/有什么功能/什么进展），推文内容
 *   质量 = 持续运营 vs 营销空话；题面显式指示「不要求也无法实证产品真实可用，
 *   不要因无法验证产品是否真实存在而压分」。2→3 分分界从「可否验证」改为
 *   「描述是否具体 AND 运营是否持续」
P1.8：判据尺度校准（2026-10-01 用户裁定，THESIS 0x4519cacc 案 2.65 卡线复审）：
   ①「推特上直接讲自己产品功能的，一篇足够」——产品价值维度有一篇讲清在解决
   什么问题/有什么功能的产品陈述推即达标，不要求多篇佐证、不要求进展证据；
   ②「对比对象是链上每天几万个新币，营销做一下不那么差就行」——推文内容
   质量维度基准从成熟项目绝对尺度改为链上新币相对尺度：有产品陈述推垫底时，
   多语言分发/常规宣传/热点借势等营销推不扣分，只有「零产品描述 + 纯营销
   空话/喊单/刷量」才是低分形状。触发案：THESIS 20 推中 1 篇扎实产品陈述 +
   17 条三语营销分发，P1.7 下 45:42 悬在 3 分线下（2.65）——同文案多语言
   分发被误当「模板刷量」，实际是面向多语言市场的正常运营
P1.9：token 类型判据补社区 meme 主账号形状（2026-10-01 用户裁定，C46 MarsCoin 案
   0xfe189e97832da1573e4e4ff034f4ffc3a15c7777——@bnbMarsCoin 是「代币大了后社区
   自己搞的 Meme 币主账号」，不属于项目；「很多 meme 币一出生就有账号，一般算是
   web3 原生IP」）：①web3ip 判据从「全新发明称号、不复用原名」扩为「币本身即IP」
   双形状——a) 发明新称号/概念（币安之王型）b) 社区/文化 meme（热点人物主题的
   社区主账号，MarsCoin 型：bio 自称 Community account、推文全为 meme 文化内容），
   账号随币而生或社区后建，账号年龄不构成反证；②project 侧补显式反例——社区
   meme 主账号有官网/品牌/认证也不算 project（官网≠产品）；③state 预计算段
   「项目官方网站…项目方官方代币」措辞中性化（jev-state-builder，带节奏偏置源）。
   配套 mapper：web3ip 评级不再吃 P1.3 年龄降档/P1.5 实度门（项目信用框架对
   meme 范畴错配——实度题要求产品陈述，meme 无产品可陈述；MarsCoin 实度 2.76
   的低分正是范畴错配产物）。同 token 两版本下的类型判定/评级不可直接比较
P1.10：题面未动（token_type 判据措辞一处修正）——mapper 端账号基本面门全删
   （2026-10-15 用户裁定，bunker 案 C70 0x2ec1e08c…7777：flap 当天新号 2 粉
   发币 21 分钟毕业被粉丝底线拦 low；近 7 天底线拦截 168 票 16 票毕业 9.5%
   判别力接近随机；发币后 5 秒快照对当天新号系统性失真——「交易者不会因为
   粉丝少/账号新/推文少拒绝一个项目」）。粉丝底线 <20、推文 <5、账号年龄
   <30 天三道门 + P1.5 实度豁免全删；prestage_project_quality 题随豁免逻辑
   一并删除（唯一消费方已不存在，5 题→4 题）；token_type 判据
   中 "its follower baseline is checked separately in code" 措辞改为
   "follower count decides nothing here — it only sets the rating tier in
   code, it never blocks"。粉丝/成员数只剩定档（0-299 mid / ≥300 high）。
   同 token 两版本下的评级不可直接比较（low→mid 单向翻转）
P1.11：题面未动——mapper 端采信语义变化（P1.3 同例 bump：聚合语义变化须可按版本
   筛历史行）。C101（2026-10-18 用户裁定「web3_native_ip_early 仅限于账号」「这不是
   账号，这就是个推文」）：corpusType==='tweet'（挂链语料是一条推文）时
   web3_native_ip_early 答案不采信，回落 abm 双条件评定（两题恒带已答零额外调用）
   ——「币本身即该账号的 IP」需要账号叙事承载，单条推文不构成。触发案：OK❌
   0x0195119e…7777（flap 税币，找角度推文宣告 + 假 addressVerified 双洞，同日
   修复）净 -12.75%。同 token 两版本下推文语料票的类型判定不可直接比较
P1.12：prestage_community_activity 题删除（C110 题集全面复查，2026-10-19）——
   唯一消费方=社区型 project 评级的高档条件（≥100 成员∧活跃 high→high），
   窄消费点不值一题配额；mapper 社区臂回落恒 mid（原 high 需双条件，删一
   条件后不白拿 high——收紧方向；账号臂 0-299 mid/≥300 high 不动）。
   同 token 两版本下社区型 project 票的评级不可直接比较（high→mid 单向）
P1.13：prestage_abm_name_link 判据加「web3 用户自然联想」用户感知锚（C125，2026-10-20）——
   四档结构/choice 键/二值消费（nameLink !== none）全部不变，只给 none 档与三档 label
   加「web3 用户看到这个币名会不会自然联想到该账号/人物」的口径；行为边界移动属预期
 */

export const JEV_PRESTAGE_QUESTIONS_VERSION = 'P1.13';

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
Decide by the account's MAIN narrative: is the story a functional product/service, or is the COIN ITSELF the IP that people rally around? Follower count alone decides nothing here — a tiny account promoting a concrete product is still project (it only sets the rating tier in code, it never blocks), and a community meme account is web3_native_ip_early even if it also has a simple website.
- project: the account/community introduces a concrete product, technology, service or development plan; posts cover tech updates / product launches / development progress / partnerships; formal language emphasizing function and utility. Bot/tool accounts (launch bots, fee bots) that describe a functional service are also project. ⚠️ NOT project: a community meme coin's main/official account whose posts are meme/culture/community-rallying content around the coin itself — even when it has an official website, branding, or a verification badge. Website + branding alone does not make a product.
- web3_native_ip_early: the coin itself IS the IP — the account's main story is the meme/coin identity, not a product's features. Two common shapes: (a) a brand-new invented IP title/concept/role that people could rally around ("币安之王" King of Binance, "ETH之神" God of ETH, "火星CEO" Mars CEO, "币安女英雄" Heroine of Binance); (b) a community/culture meme themed on a hot topic or public figure — e.g. MarsCoin: an Elon/SpaceX/Mars-themed community meme whose account bio says "Community account" and whose posts are all Mars-culture memes with zero product content. It may take public figures/topics as INSPIRATION but does not reuse an existing token's identity as its product. The account is typically born together with the token or built by the community after the coin grew — account age relative to token creation is NOT a counter-signal for this type. Typical accompanying signals: early-stage community, meme-style posts, community rallying language.`,
      criteria: {
        project: 'Concrete product/tech/service with formal function-oriented content; official website/whitepaper/tech docs; low followers does NOT make it web3ip; a community meme main account with website/branding but zero product content is NOT project',
        web3_native_ip_early: 'The coin itself is the IP: invented new title/concept OR community/culture meme as the account\'s main story (meme content, community rallying, no product/service); account born with the token or community-built later — young account is NOT a counter-signal',
      },
    },

    // ── 2. abm 条件一：名称关联（仅 addressVerified=false 时采信；原 V1.0 第一步）──
    prestage_abm_name_link: {
      type: 'choice',
      instructions: `Name link between the token and the account (evaluate only the token Symbol/Name vs the account's screen name, display name, bio and post content). Pick the strongest link type as a **web3 user** would see it: looking at the token name alone, would a web3 user naturally associate it with this account/person?`,
      criteria: {
        exact: 'Exact match — token Symbol/Name equals the account name or display name; a web3 user would immediately connect the name to the account (e.g. "PP" = "Prison Professors")',
        abbreviation: 'Abbreviation — token Symbol is a common abbreviation of the account/display name; a web3 user would naturally read it as that account (e.g. "MS" = "Michael Santos")',
        semantic: 'Semantic link — token name has a clear semantic relation to the account bio or content that a web3 user would naturally connect (e.g. "Prison Professors" ↔ prison education topics)',
        none: 'No link — a web3 user seeing this token name would NOT naturally associate it with the account/person (the name has nothing to do with the account)',
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

    // P1.10（C70）：prestage_project_quality 题删除——唯一消费方（P1.5 实度豁免）
    // 随账号基本面门全删，无消费方的题不烧 Jev 配额（5 题 → 4 题）
    // P1.12（C110）：prestage_community_activity 题删除——唯一消费方（社区型
    // project 评级高档条件）窄消费点不值一题配额，社区臂回落恒 mid（4 题 → 3 题）
  };
}
