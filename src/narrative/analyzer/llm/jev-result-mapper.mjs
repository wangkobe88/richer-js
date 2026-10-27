/**
 * Jev answers → 阶段结果映射器
 *
 * 全部确定性聚合在本文件完成（原 3 阶段管线的公式原样保留）：
 * - J1.71 起标准类只有一个事件价值分：Web3 用户影响力（0-5 → 0-100，60 过线）；
 *   D/E 档阻断由影响力档位（impactTierOf）承担
 * - 标准类 eventCompositeScore = Web3 用户影响力（单题 0-5 → 0-100），pass ≥ 60；
 *   传播面/时效已内化为影响力证据（J1.71）
 * - J1.23 Web3 偏好锚（A/B 类 + strong_fit≥0.5 → effTier 锚 B；C94 起 B 类同享
 *   dim2<18 锚 18——web3 用户喜欢是根本判据，发布主体量级无所谓）
 * - W 类独立数学：产品(0-35) + 项目对 BSC 用户吸引力(0-40) + 时效(0-25) = 100，pass ≥ 60
 *   （J1.73/C134：币安交互臂退役——刚发布的 BSC 项目不可能有币安交互；C42 豁免随之退役）
 * - 最终 = round(eventCompositeScore×0.6, 2) + 关联分 + 质量分，≥70 high / ≥50 mid / else low
 * - Stage3 截断顺序：无背景拼写错误 → 关联≤10 → 质量≤4（品牌劫持臂已废
 *   J1.103/C172：名字-事件关系归 bsc_meme_user_name_event_acceptance 用户视角，真蹭
 *   名票 unacceptable → relevance 低 → 关联≤10 截断自然拦）
 * - reason 为代码端模板拼接（Jev 不生成文本，已裁定接受损失）
 *
 * 输出形状与 NarrativeAnalyzer 旧流程的 stageXDataToSave 完全一致（旧格式），
 * 经 buildStageSaveData 零改动转换为五列存储契约（{stage}_result/_prompt/_raw_output）。
 */

import { JEV_QUESTIONS_VERSION } from './jev-questions.mjs';
import { detectCorpusCashtag, detectPublisherProxy } from '../utils/narrative-utils.mjs';

/** 量级 6 档（J1.79 起由 fit 质量派生，供豁免/审计） */
const MAGNITUDE_TIERS = ['E', 'D', 'C', 'B', 'A', 'S'];

/**
 * 主路径量级档 → 分（108 样本校准定参，2026-09-20）：
 * 按条件期望 E[旧tier分|Jev档]（S 38.8/A 33.9/B 27.3，n=91）取整；
 * C 档从期望 26.8 下调至 22——Jev 的 C 档混有旧 B/A 样本（期望被拉高），
 * 但"C 档主体难过 pass 线"是旧管线核心语义（C22+dim2均值21.5+时效15=58.5<60）。
 * D/E 档不进表：维持主体量级不足阻断。
 * （C83 起全语料走标准路径——superIP 快车道的 TIER_SCORES 预评分已随通道删除）
 */
/** 叙事源头陈旧窗（秒）——C75 FLY 案（2026-10-16 用户裁定「币安的推文已经一年多
 * 以前了，这种控一下吧」）：direct_tweet 语料的主推本身就是事件来源（分类器语义：
 * 高粉/高互动作者直发），事件窗=主推发布时间（客观锚）。发币人当天的宣告/找角度
 * 推文（website_tweet 等第二语料）刻意不计入——宣告推新是当然的，不构成「事件
 * 新鲜」证据；Jev 会被宣告推误导把一年前的源头推答成新鲜档拿满时效分（FLY
 * 0x4ec2…7777：币安 2025-06 公告为主推+gapJ 当天宣告推在第二语料，77.32 high
 * 放行，实跑 -36%）。与 C68 载体窗对称互补：C68 管 angle 类「角度曝光窗」（载体
 * 最新一条 6h，「任一新即活」），本门管 direct 类「叙事源头窗」（主推 30d，对齐
 * Jev within_30d/older 档边界——主推超窗=事件客观上至少 older 档）。与 C74 啾啾案
 * 分桶协同：C74 把 direct_tweet 从 precheck 硬拦豁免交 Jev event_timing 软评
 * （高粉新闻推被人发现得晚，300s 硬拦误杀）——本门=软评层的客观时效锚，豁免的
 * 口子由 30d 软窗接住真陈旧源头。存量扫描（2026-10-16，7177 行）：主推>30d 的
 * direct 票 117，其中 high 20 票全是骑 CZ/币安/何一/雷军 35d-5.7y 老推形状，
 * 6 买 5 亏（唯 CRAZYCOIN +139%），用户裁定控。 */
const SOURCE_STALE_SEC = 30 * 86400;

/** C102 借壳语料父推源头窗：binanceCorpus 票的叙事源头（in_reply_to 父推）>24h
 * → timing 归 older。用户裁定 2026-10-18（BAI 案）：「借币安语料发币，3 天前的
 * 币安推文肯定不行，早就被人用烂了」——币安活动的注意力半衰期小时级，24h 线外
 * 全是接力尾部（帕鲁 10-16 第一波 / BAI 10-18 第二波，同一活动推两波蹭票实证）。 */
const BINANCE_PARENT_STALE_SEC = 24 * 3600;

/** C103 载体↔父推关系源头窗（秒）——Jean Phil 案 0x6915bec6…7777（2026-10-18
 * 用户裁定）：主推位=Dexerto 原生新闻推（145 万粉，20 天老）、website_tweet 位=
 * 229 粉小号发币前 13s 的中文翻译推（reply 到 Dexerto 原推）——C68 载体集「任一
 * 新即活」被翻译推洗白、C75 主推 20d<30d 不触、Jev 按 within_30d 给 10 分
 * 63.65 压线过。裁定：找角度推文借原生父推解释现象（有新解读）父推可老；但
 * 「仅翻译老推」或「解释二手找角度推」的被翻译/被解释推必须 24h 内。与 C102
 * 分工：C102=币安语料无条件（借壳不加区别），本门=通用语料按关系分档。 */
const PARENT_REL_STALE_SEC = 24 * 3600;

/** C250 借壳语料陈旧窗（秒）——自由之钱案 0x2c048d9c…ffff（2026-10-27 用户裁定
 * 「叙事能过简直扯淡，是个明显的叙事模块漏洞」）：部署者把大 V 主页塞进 meta
 * twitterUrl（账号级语料，无宣告推=叙事主体与币零关联零互动），全部实义语料只有
 * 一篇 193 天前的第三方 square 旧文（CZ 4 月出书《Freedom of Money》的书评，作者
 * @youcancallmeJo 非 CZ——corpus_author_identity 的 S 级认证被 meta 抢注冒领），
 * 币名抄文章标题反而成为 exact_match/fit strong 的正向证据链（关联 20 满分 +
 * sf+fit 0.64 过硬门）→ total 72.77 high 放行，实盘对倒盘 -37.5%。同宇宙对照
 * 0x26a0「金钱的自由」high 92.98 为正确放行：CZ 敲钟讲话当天新鲜主推
 * direct_tweet 在场=宣告关联真实。门=资格层两腿全真才拦：
 *   ① 无推文级语料（载体槽位全空——部署者零宣告动作，账号主页≠宣告）
 *   ② 全部语料源真实时间距 token 创建锚 >30d（对齐 C75 主推源头窗刻度；用户
 *      裁定「所有的语料都是老的才行」——任一语料新鲜即放：CZ 正在宣传新书的
 *      square 新文=腿②假照放）
 * 时间源=实际进 state 的语料（推文槽位/square publishedAt/website
 * publishedTime/**账号注册时间 twitterInfo.created_at**——2026-10-27 追裁定
 * 「代币只提供大V地址（大V账号肯定是老账号）应也能拦」：纯裸账号形状（无
 * square/website）内容源为空会 fail-open 漏放，账号对象本身的时间属性补源后
 * 老账号借壳被拦；**账号推文时间刻意不入源**——活跃大 V 永远有新推，算推文
 * 时间门对借壳账号恒失效）；时间源全缺失（连账号注册时间都不可解析）/锚缺失
 * fail-open 放（对齐 C75 缺锚语义，交给既有门链）。mapper-only 不 bump 题集
 * 版本；prestage 不接；Jev 照跑留档。 */
const SHELL_CORPUS_STALE_SEC = 30 * 86400;

/**
 * C75 叙事源头陈旧 override（纯代码，mapper-only，题集版本不动——时效分本来
 * 就是代码查表，J1.16/J1.23/J1.24/C68 同款：分数锚定类必须代码侧）：
 * tweet_type=direct_tweet 且主推 lag 超 SOURCE_STALE_SEC → 返回详情（调用方
 * 把 timing 归 older=0 分）；否则 null 不干预。
 * 判定轴=主推（twitterInfo）时间且仅主推：direct_tweet 语义「推文本身就是事件
 * 来源」，主推=源头本体；第二语料（website_tweet/quoted/retweeted）刻意不进
 * 集合——与 C68 载体集合（最新一条，「任一新即活」）刻意相反：宣告推再新也
 * 不构成事件新鲜证据。angle_seeking/interpretive_reply 不触达（C68 域，两门
 * type 互斥精确实位）；unknown 不触达（留给 Jev 自判）。
 * 锚=tokenCreatedAtSec||raw_api_data.created_at（与 C68 同链）；任一不可得
 * fail-open 不干预（不误伤数据缺失票）。
 */
function overrideStaleSourceTiming(tweetClassification, twitterInfo, tokenData, rawTiming) {
  if (!tweetClassification || tweetClassification.type !== 'direct_tweet') return null;
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!anchorSec || !twitterInfo?.created_at) return null;
  const ms = new Date(twitterInfo.created_at).getTime();
  if (!Number.isFinite(ms)) return null;
  const lagSec = anchorSec - ms / 1000;
  if (!Number.isFinite(lagSec) || lagSec <= SOURCE_STALE_SEC) return null;
  return { lagSec: Math.round(lagSec), staleSec: SOURCE_STALE_SEC, rawTiming: rawTiming || null };
}

/**
 * C102 借壳语料父推源头窗 override（纯代码，mapper-only，题集版本不动——C68/C75
 * 同款：时效分本来就是代码查表）——BAI 案 0x11efcbd0…27777（2026-10-18 用户裁定）：
 * binancezh「创意广告大赛」活动推（10-15）→ 第一波帕鲁 10-16 蹭 → zhuifei008 参赛推
 * 10-18 09:05:10 → 50 秒后发币 BAI。载体 lag=50s 极新鲜洗白源头 lag≈3d，Jev 给
 * rating=3 high（weightedEventScore 45 拿满事件分）——时效三件套全盲：C74 锚主推 lag+粉豁免、
 * C75 只锚主推（BOB 案先例刻意排除父推）、C97 只查主推作者（binancezh 在父推位）。
 * 本门补父推位：判据=binanceCorpus（C97 宽判据现成：币名/主推/父推含 binance/币安）
 * ∧ 主推 in_reply_to.created_at 存在 ∧ 父推 lag > BINANCE_PARENT_STALE_SEC(24h)
 * → timing 归 older=0。**不限 tweet_type**（判据轴是「源头事件年龄」，不是「载体
 * 行为」——angle/direct/unknown 载体都能挂旧源头）；与 C68/C75 可同票并存（同归
 * older 不冲突，审计键各落各的）。锚=tokenCreatedAtSec||raw_api_data.created_at
 * （C68/C75 同链）；父推时间缺失/无 in_reply_to fail-open 不干预。载体推（主推/
 * quoted/retweeted）刻意不进判定——新载体不构成源头新鲜证据（C75 同理）。
 */
function overrideStaleParentTiming(binanceCorpus, twitterInfo, tokenData, rawTiming) {
  if (!binanceCorpus) return null;
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  const parentMs = new Date(twitterInfo?.in_reply_to?.created_at || '').getTime();
  if (!anchorSec || !Number.isFinite(parentMs)) return null;
  const lagSec = anchorSec - parentMs / 1000;
  if (!Number.isFinite(lagSec) || lagSec <= BINANCE_PARENT_STALE_SEC) return null;
  return { lagSec: Math.round(lagSec), staleSec: BINANCE_PARENT_STALE_SEC, rawTiming: rawTiming || null };
}

/** 语料载体槽位（C68 载体集同集）：主推/website_tweet/quoted/retweeted 四位。
 * C103 判定轴=各槽位 in_reply_to 父推；Jean Phil 案父推在 website_tweet 位、
 * BAI 案父推在主推位——两案实证必须全集扫描。 */
const CARRIER_SLOTS = (twitterInfo) => [
  twitterInfo,
  twitterInfo?.website_tweet,
  twitterInfo?.quoted_status,
  twitterInfo?.retweeted_status,
];

/** 语料是否携带【回复的推文】块（任一载体槽位有 in_reply_to）——J1.39 条件题
 * parent_relationship 的问出闸（无父推不问防幻觉作答；imageConsistency 等条件题
 * 同款条件题模式）；与 twitter-section 渲染条件（tweet.in_reply_to 存在即渲染）
 * 同源。导出供 NarrativeAnalyzer 门控，mapper C103 判定共用槽位集防漂移。 */
export function hasReplyParent(twitterInfo) {
  return CARRIER_SLOTS(twitterInfo).some((t) => t?.in_reply_to != null);
}

/**
 * C103 载体↔父推关系源头窗 override（J1.39 条件题 parent_relationship 判关系
 * + 代码侧 24h 窗——语义判断归题面、阈值聚合归代码，J1.16/J1.23/C68 教训）：
 * Jev 判定载体与被回复父推的关系 ∈ {translation_or_repost, explains_derivative}
 * （仅翻译搬运 / 父推本身是二手找角度推——两种形状载体都不贡献新叙事，新鲜
 * 义务落在源头）∧ 任一载体槽位父推 lag > PARENT_REL_STALE_SEC(24h)
 * → timing 归 older=0。new_angle_on_original 臂（载体借原生父推解释现象、有
 * 新解读）刻意放行——用户裁定「找角度推文解释一个原生推文，被引用的可以老
 * 一些」；unclear/答案缺失（旧缓存行 J1.38- 无此题）fail-open 不干预。
 * 与 C102 并存互补：C102=币安语料无条件拦（借壳豁免不适用），本门=通用语料
 * 按 Jev 关系分档；同票双中各自落审计键同归 older。锚=tokenCreatedAtSec||
 * raw_api_data.created_at（C68/C75/C102 同链）缺失 fail-open。
 */
function overrideStaleRelParentTiming(answers, twitterInfo, tokenData, rawTiming, options = {}) {
  const choice = answers?.parent_relationship?.choice;
  if (choice !== 'translation_or_repost' && choice !== 'explains_derivative') return null;
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!anchorSec || !twitterInfo) return null;
  let worst = null;
  for (const slot of CARRIER_SLOTS(twitterInfo)) {
    // J1.137/C240 火蚁案同主体链豁免（skipSameSourceParent 开时）：被回复父推
    // =主推作者自己的内容（author 同 / tweet_id 同 / 文本同头任一）→ 翻译/
    // 转述自己的宣言=讲自己的事，该槽位不计入陈旧判定（异主体父推照常判）；
    // 作者与 id 均缺失时文本同头兜底（火蚁实证：website_tweet.in_reply_to 的
    // text 即主推宣言本体）；三证皆缺保守不豁免
    if (options.skipSameSourceParent && isSameSourceParent(slot, twitterInfo)) continue;
    const parentMs = new Date(slot?.in_reply_to?.created_at || '').getTime();
    if (!Number.isFinite(parentMs)) continue;
    const lagSec = anchorSec - parentMs / 1000;
    if (Number.isFinite(lagSec) && lagSec > PARENT_REL_STALE_SEC
      && (worst === null || lagSec > worst.lagSec)) {
      worst = { lagSec: Math.round(lagSec), slotMs: parentMs };
    }
  }
  if (!worst) return null;
  return { lagSec: worst.lagSec, staleSec: PARENT_REL_STALE_SEC, choice, rawTiming: rawTiming || null };
}

/** J1.137/C240：父推与主推同主体链判定（C103 豁免臂专用）——父推=主推作者
 * 自己的内容（翻译自己的宣言≠洗白别人的旧闻）。三层证据任一：作者 handle
 * 相同 / 父推 tweet_id=主推 tweet_id / 归一文本同头（前 20 字符互 startsWith，
 * 主推与嵌入父推文本一致的火蚁实证形状）。 */
function isSameSourceParent(slot, twitterInfo) {
  const parent = slot?.in_reply_to;
  if (!parent) return false;
  const mainAuthor = String(twitterInfo?.author_screen_name || twitterInfo?.screen_name || '').toLowerCase();
  const parentAuthor = String(parent.author_screen_name || '').toLowerCase();
  if (mainAuthor && parentAuthor && mainAuthor === parentAuthor) return true;
  if (parent.tweet_id && parent.tweet_id === twitterInfo?.tweet_id) return true;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const pt = norm(parent.text);
  const mt = norm(twitterInfo?.text);
  if (pt.length > 20 && mt.length > 20
    && (mt.startsWith(pt.slice(0, 20)) || pt.startsWith(mt.slice(0, 20)))) return true;
  return false;
}

/** C250 腿①：推文级语料在场判定——主推（type='tweet'）或任一载体槽位
 * （website_tweet/quoted/retweeted/in_reply_to）有推文对象。账号级主页语料
 * （type='account'，buildAccountPart 只渲染账号头）刻意不算——账号存在≠宣告
 * （自由之钱案 twitter 段仅 92 字符=零推文内容）。null twitterInfo 同判无。 */
function hasTweetLevelCorpus(twitterInfo) {
  if (!twitterInfo) return false;
  if (twitterInfo.type === 'tweet') return true;
  return !!(twitterInfo.website_tweet || twitterInfo.quoted_status
    || twitterInfo.retweeted_status || twitterInfo.in_reply_to);
}

/** C250 腿②原料：进 state 的语料源时间戳全集（毫秒；不可解析源跳过）。
 * CARRIER_SLOTS+in_reply_to 覆盖推文槽位（腿①真时恒空，防御性收集防判据
 * 演化漂移）；square publishedAt（binance-square-fetcher bapi
 * firstReleaseTime/JSON-LD datePublished）；website publishedTime
 * （web-fetcher jina 回退提取）；账号注册时间 twitterInfo.created_at
 * （twitter-fetcher _fetchAccountInternal 恒带——纯裸账号形状唯一时间源，
 * 追裁定见 SHELL_CORPUS_STALE_SEC 头注）。 */
function collectCorpusSourceTsMs(twitterInfo, binanceSquareInfo, websiteInfo) {
  const ts = [];
  const push = (v) => {
    if (!v) return;
    const ms = new Date(v).getTime();
    if (Number.isFinite(ms)) ts.push(ms);
  };
  for (const slot of CARRIER_SLOTS(twitterInfo)) push(slot?.created_at);
  push(twitterInfo?.in_reply_to?.created_at);
  push(twitterInfo?.created_at);
  push(binanceSquareInfo?.publishedAt);
  push(websiteInfo?.publishedTime);
  return ts;
}

/** C250 借壳语料陈旧门：两腿全真（无推文级语料 ∧ 全部语料源距创建锚 >30d）
 * → {label, lagSec, staleSec, sources}（调用方拦 low）；否则 null 不干预。
 * 最新语料源（max）也要超窗才拦=「所有语料都是老的」语义——任一源新鲜
 * 即放。时间源全缺失/锚缺失 fail-open（C75 缺锚同语义）。 */
function shellCorpusStaleBlock(twitterInfo, binanceSquareInfo, websiteInfo, tokenData) {
  if (hasTweetLevelCorpus(twitterInfo)) return null;
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!anchorSec) return null;
  const tsMs = collectCorpusSourceTsMs(twitterInfo, binanceSquareInfo, websiteInfo);
  if (tsMs.length === 0) return null;
  const newestMs = Math.max(...tsMs);
  const lagSec = anchorSec - newestMs / 1000;
  if (!Number.isFinite(lagSec) || lagSec <= SHELL_CORPUS_STALE_SEC) return null;
  const sources = [];
  if (new Date(twitterInfo?.created_at || '').getTime() === newestMs) sources.push('twitter_account');
  if (new Date(binanceSquareInfo?.publishedAt || '').getTime() === newestMs) sources.push('binance_square');
  if (new Date(websiteInfo?.publishedTime || '').getTime() === newestMs) sources.push('website');
  return {
    label: `借壳语料陈旧：无宣告推且全部语料超 ${SHELL_CORPUS_STALE_SEC / 86400} 天（最新语料 ${Math.round(lagSec / 86400)} 天前）`,
    lagSec: Math.round(lagSec),
    staleSec: SHELL_CORPUS_STALE_SEC,
    sources,
  };
}

/**
 * web3_user_event_spread 校准带（原 dimension2；108 样本远程校准定参，2026-09-20）：
 * Jev 档位与旧 LLM 维度二分几乎不相关（旧量表 P25=18/P50=22/P75=25，近似恒 20-25
 * 的宽松输出），故按分布分位匹配而非逐点拟合——Jev 档 1-4 累计占比 29%/58%/86%/100%
 * ↔ 旧分位 15.5/22.5/26/29，映射后均值 21.5 ≈ 旧均值 21.1。
 * 带语义（与 jev-questions web3_user_event_spread criteria 的六档对应）：
 * 无[0,10] / 微弱[10,20] / 小[18,26] / 中[23,28] / 强[26,30] / 极强[28,30]
 */
// J1.84（C142）：W 双轴合并为单轴——w_product_score 0-35 带整链退役；
// w_bsc_user_appeal 0-40 → 0-75 四分带（语义档位
// 不变：无吸引力/一般/有明确吸引力/强吸引力；Jev Score 原语仍回 0-3 期望带，
// 由 bandInterpolate 映射到 0-75）。W 数学 = 吸引力 + 时效，pass 线 57。
const W_APPEAL_BANDS = [[0, 18], [19, 37], [38, 56], [57, 75]];
// J1.107（2026-10-23 用户裁定「w_bsc_user_appeal 可以给弱中强三档」）：题改 Choice
// 三桶，分值表弱 15/中 47/强 66（弱合并旧 0-18/19-37 两档取保守代表 15<32 线；
// 中=旧 38-56 带中点；强=旧 57-75 带中点）。pass 线 32 不动；probabilities 留审计。
// J1.125（C230）：题键断代 w_bsc_user_appeal → bsc_meme_user_* 家族（资格轴并入：
// weak 覆盖「发布者全无影响力+无 CA 背书」一票定档）——分值表不动。
// J1.126（C230 追裁）：键名再调整 bsc_meme_user_web3_project_acceptance_and_impact
// （加 web3_project 域限定；题面/桶/分值零改动，纯键名断代）
// J1.129（C233，2026-10-26 用户裁定「也用 low/mid/high 呗」）：桶 id 断代
// weak/moderate/strong → low/mid/high（与评级词汇统一）；分值/pass 线/资格轴语义
// 零改动。表内保留旧键=J1.107-J1.128 旧缓存行重放同分直读（零分支归一读）
const W_APPEAL_CHOICE_SCORES = { low: 15, mid: 47, high: 66, weak: 15, moderate: 47, strong: 66 };
const SPELLING_BANDS = [[0, 1], [2, 3], [4, 5], [6, 7]];
const REASONABILITY_BANDS = [[0, 1], [2, 3], [4, 5]];
// J1.43（C109）token_name_quality 单题 band 索引 0-3 → 联合量纲 0-12
// （=旧 spelling 0-7 + reasonability 0-5 的合计刻度：好名字旧≈10-12→band3 10-12，
// 量表刻度保持，类别阈值语义不变）
const TOKEN_QUALITY_BANDS = [[0, 2], [3, 5], [6, 9], [10, 12]];

/**
 * 关联分查表：[type][levelIdx 0-4]（levelIdx = round(relevance_level.score)）。
 * J1.43（C109）起 relevance_level 题删除——本表只服务 legacy 形状行（旧缓存行
 * 重放/旧题集手写 fixture）；新形状走 RELEVANCE_FUSED_SCORES 单值直查。
 */
const RELEVANCE_TABLE = {
  exact_match:      [20, 20, 20, 20, 20],
  translation_match: [18, 18, 18, 18, 18],
  abbreviation_alias: [16, 16, 17, 18, 18],
  semantic:          [8, 10, 12, 15, 15],
  cultural:          [1, 5, 10, 14, 15],
  generic_concept:   [2, 4, 6, 7, 7],
  none:              [0, 1, 2, 2, 2],
};

/**
 * J1.43（C109）融合关联分：旧 9 桶单值（吸收原 relevance_level 语义）——旧缓存行
 * 重放兼容保留。
 * J1.92（C155，2026-10-21 用户裁定）：name_event_relevance 收敛为 3 桶用户视角；J1.93/C156 题键改名 web3_user_name_event_acceptance（双键读旧行；J1.112/C183 再断代 bsc_meme_user_name_event_acceptance）——
 * exact_match（明确匹配 20）/ acceptable（BSC meme 用户能理解并接受的引申关联 15，
 * 过 ≤10 截断）/ unacceptable（看不懂/不接受 5，落 ≤10 截断）。旧 9 桶分数原样
 * 保留供存量行重放（新题集不再产出）。超级IP（币安/何一）陈述的合理引申归
 * acceptable 的题面锚。
 */
const RELEVANCE_FUSED_SCORES = {
  exact_match: 20,
  acceptable: 15,
  unacceptable: 5,
  // —— legacy 9 桶（旧缓存行/旧 fixture 重放；新题集不再产出）——
  translation_match: 18,
  abbreviation_alias: 17,
  semantic_clear: 13,
  semantic_weak: 9,
  cultural_rich: 12,
  cultural_thin: 3,
  generic_concept: 5,
  none: 0,
};

/**
 * J1.82（C140）题键断代：event_token_block_reason → event_quality_veto；
 * J1.110（C181）再断代：event_quality_veto → web3_user_event_impact（用户裁定
 * 改 web3 用户视角，主轴=对 Web3 用户的影响力；桶 id 不变零断代）。存量
 * token_narrative 行/旧 fixture 仍是旧键，读取一律走本 helper 多键归一
 * （C123 改名先例：改名不改判据，旧行 bit 不变）。
 * J1.112（C183）再断代：web3_user_event_impact → bsc_meme_user_event_impact
 * （评估主体收窄=BSC meme 币用户，题面措辞同步；桶 id 不变零断代）。
 */
// J1.112/C183 键名断代归一读取：web3_user_* → bsc_meme_user_*（评估主体收窄=
// BSC meme 币用户——用户裁定「web3 用户范围太大，有的事件不是对 Web3 不重要，
// 而是对 BSC 的 meme 币用户不重要」，JPM 案 0x27ff2020…7777）。判据不动
// （C123 改名先例）：新键优先、旧键兼容=存量缓存行/旧 fixture 形状走同一门。
const q = (answers, key, legacyKey) => {
  if (answers == null) return undefined;
  const v = answers[key];
  return v !== undefined && v !== null ? v : answers[legacyKey];
};

const blockAnswers = (answers) => answers?.bsc_meme_user_event_impact ?? answers?.web3_user_event_impact ?? answers?.event_quality_veto ?? answers?.event_token_block_reason ?? null;

/**
 * bsc_meme_user_event_impact（J1.82 前键名 event_quality_veto/event_token_block_reason）选项 → 中文标签（reason 模板用）。
 * J1.43（C109）退役两桶（182 全量 10815 行实证）：regional_event 9 次 argmax/
 * 0 次域内拦截=从未拦过票的死桶（且与 event_magnitude 的地区性/全国性范围镜头
 * 冲突）；subject_unqualified 31 次/23 次弱概率拦截（p 0.22-0.58），与 C108 后
 * name_form「无名实体」臂/event_magnitude 无名主体低档/name_entity_memeability
 * 0 分档三重冗余，粉丝<1万量化锚由 name_form 语义承接。题集侧桶文本删除、
 * BLOCK_SCOPE 侧显式空域退役（历史行 rating 已落库不变，重析走新题集）。
 */
const BLOCK_LABELS = {
  none: '无阻断',
  // 退役桶 label 保留（空域后不可达，防未知选项 fallback 打裸键名）
  subject_unqualified: '主体资格不足',
  regional_event: '地区性事件',
  // J1.53（C122）桶键断代：niche_subculture → token_circle_reachability（门名对齐
  // 语义「Web3 用户圈层可达性」）；J1.82（C140）桶退役（并入 unfit 负门）——
  // 新旧键 label 保留=存量数据/旧 fixture 可读（防未知选项 fallback 打裸键名）
  niche_subculture: '小圈子亚文化',
  token_circle_reachability: 'Web3 用户圈层可达性不足',
  event_empty_content: '空洞内容',
  // J1.127/C231：事件成立但意义太小（黄仁勋名誉黑带案）；J1.142/C244 拦截位
  // 退役后 label 保留（防未知选项 fallback 打裸键名；历史行 reason 展示照旧）
  event_trivial: '事件意义太小',
  event_institution_routine: '机构日常运营',
  low_quality_derivative: '低质衍生',
  event_baseless_speculation: '无据猜测',
  token_ip_reuse: 'IP低质复用',
  event_negative_hard_news: '负面硬新闻事件',
  event_routine_content_product: '常规内容产品宣传',
};

/**
 * bsc_meme_user_name_entity_acceptance 阻断（J1.10）——**C108（2026-10-19）拦截位退役**，全档案并档：
 *
 * 案史：J1.10（2026-09-23）立门「截词/截名发币要成立，名字的主人得是超级IP」，
 * 阻断侧 minor_other（无名对象，YAYA 案=何一推文@的币安员工）+common_word（截词，
 * CONVICTION 案）；J1.15 super_ip 扩含官方口号；J1.26 notable_other 全域退出
 * （知名度梯度是错轴，移交 bsc_meme_user_event_fit unfit 负门）。
 *
 * 退役裁定（C108，用户三轮）：触发案 EARLY（CZ 回复 "you got in early" 逐字
 * 发币）被 common_word「截词（非超级IP话中词）」臂 0.96 误拦——"early" 有圈内
 * 「趁早」深意、用户侧有感知，该放行。「很多门，不如合并为『合不合适作为
 * meme 币』门，这是根本的」「名字指向实体时实体情况仍需考量（普通币安员工
 * 就不行），但 early 不是一个实体」「YAYA 就是币安员工所以不行」「用一个门
 * 涵盖多种情况」——拦截责任全部移交 web3UserAcceptabilityBlock（J1.42 name_form 四分支：
 * ①指向实体——无名实体不合格 ②非实体词——圈内文化词合格/无感知句片段不合格
 * ③形态缺陷 ④无背景拼写变体）。bsc_meme_user_name_entity_acceptance 题保留，概率只喂评分与豁免链
 * （C88 五腿 entityAcceptedProb / rideDetour / pubProxyActive），不再承载拦截。
 *
 * 术语混乱实证随案立档：本门 common_word label「截词」与 Stage3「截断:」前缀、
 * 「拼写错误」臂三连撞，EARLY 案排查时归因即错（实拦于本门而非 misspelling）。
 * 历史行 reason 中的「截词（非超级IP话中词）」「名字指向无名对象」label 展示
 * 照旧，不再新增。
 */

/**
 * 阻断选项的类别作用域（与原各类 Stage2 prompt 的阻断条件集合对齐）：
 * - A 类（形象化IP）：小圈子亚文化/IP低质复用（J1.44 起 low_quality_derivative 与
 *   token_ip_reuse 合一，判据同拦 A 域）
 * - W/B 类：营销噱头/标题党（旧管线仅此两类设此项，校准实证设为通用会误伤 E/C 类热点推文）
 * - C/D 类：机构日常运营
 * - G 类：无据猜测
 * - 通用（各类均设）：空洞内容
 * J1.43（C109）退役两域（实证死桶/三重冗余，见 BLOCK_LABELS 注释）：
 * subject_unqualified（A/C/D/F/G）与 regional_event（E）。
 * Jev 在不知类别的情况下作答（speculative fan-out），代码端按分类结果
 * 条件采信——scope 外的 choice 不构成阻断（如 E 类蹭热点命名代币不算低质衍生）。
 */
const BLOCK_SCOPE = {
  event_empty_content: 'all',
  // J1.127（C231 BLACKBELT 案，2026-10-25 用户裁定「事件没有感情感染力/影响力，
  // 看一眼就划过。虽然是黄仁勋，但事情本身意义很小」）：新桶 event_trivial=
  // 事件真实成立但对 BSC meme 用户意义太小（圈外名人/机构礼节性荣誉/日常琐事/
  // 例行公事——主体再著名不抬事件分量）。全域拦（C184b 快狗案同判：类型不合
  // 与事件分类正交，限域 miss 会漏放）；argmax 门自动接入，旧缓存行无该桶键
  // =fail-open 零翻转。C191 币安传奇观察点①（大 IP+小事件无仲裁位）的接棒位
  // J1.142（C244，2026-10-26 用户裁定「误拦的代价大于漏放」——小西案
  // 0x8aeb285c…7777 被 462 粉载体带偏误拦 0.34 近 tie；桶存活 <1 天拦 114 票、
  // 40% 在 P<0.5 掷骰段且四个已知误拦案全在该段，三个正确拦全在 ≥0.5 段）：
  // 桶从 impact 题拆出为独立观察题 bsc_meme_user_think_event_too_trivial_for_
  // meme（判据四维度重构，见题集），拦截位退役=显式空域（J1.43/J1.82 先例：
  // blockInScope 未知选项按通用处理返回 true，只删键无效）——旧缓存行
  // event_trivial argmax 重放不再拦。观察信号续采：恒落审计
  // trivialProbeChoice/trivialProbeMass（blockAnswers 不读新题键=天然不拦）。
  // 恢复拦截须用户裁定
  event_trivial: [],
  // J1.45（C110 扫描后裁定）扩全域：原 ['W','B'] 跨类空洞 261 行（E123/A104/
  // C75/D63…，high/mid 逃逸 25 票实买 6 票，noneP 全<0.5）——「营销噱头无实质
  // 产品」语义不分类别；pubProxy/platformOfficial 豁免仍在拦截位前置不受影响
  // J1.53（C122）桶键断代：niche_subculture → token_circle_reachability；
  // J1.82（C140）圈层可达性桶退役：拦截责任并入 bsc_meme_user_event_fit unfit
  // 概率门（题集侧锚句随迁：圈外亚文化 get 不到=unfit）。新旧键显式空域
  // （J1.43 先例：blockInScope 对未知选项按通用处理返回 true，只删键无效；
  // 空数组=任何类别都不拦，旧缓存行/旧 fixture 重放不再拦，重析走新题集）
  token_circle_reachability: [],
  niche_subculture: [],
  token_ip_reuse: ['A'],
  event_baseless_speculation: ['G'],
  // J1.88（C150，2026-10-21 用户裁定「event_institution_routine 也没必要存在，
  // 都让 bsc_meme_user_event_fit 去判断」）：机构日常运营桶退役——题集删桶、argmax
  // platformOfficial∧institution 子句删除；显式空域防旧缓存行/旧 fixture 的
  // institution_routine choice 照拦（BLOCK_LABELS 保留历史展示）。机构日常/
  // 重要度改由第二层 bsc_meme_user_event_fit + 名字/载体/关联/质量门判。
  event_institution_routine: [],
  // J1.43（C109）退役桶：显式空域（blockInScope 对未知选项按通用处理返回 true——
  // 只删键会让 legacy 形状 choice 照拦，删除无效；空数组=任何类别都不拦）。
  // 新题集已不提供这两个选项，此处只兜旧缓存行/旧 fixture 重放
  subject_unqualified: [],
  regional_event: [],
  // J1.44（C110）退役桶：low_quality_derivative 并入 token_ip_reuse（两桶均 A 域、判据
  // 重叠=对现有 IP/热点的低质衍生与直接复用、拦截效果等价的功能双桶合一）
  low_quality_derivative: [],
  // J1.11（2026-09-26 用户裁定，C9 bitget被盗案）：负面事故（被盗/暴雷）+纯硬新闻
  // 的事件无 meme 价值，全域拦截。J1.101（C170 RSA4 案，2026-10-22 用户裁定
  // 「去掉 negative_hard_news 得了，直接让 web3 契合度去处理」）：整门退役——
  // 题集删桶、negativeHardNewsBlock 概率门删除；此处显式空域防旧缓存行/旧
  // fixture 的 negative_hard_news choice 照拦（BLOCK_LABELS 保留历史展示）。
  // 负面事件的玩味空间与口味改由第二层 bsc_meme_user_event_fit 判
  // （unfit≥0.5 负门 + J1.83 sf+fit<0.5 通用硬门接棒）。案史：J1.38/C98 粉豹
  // 法国骚乱案扩政治暴力边界（「政治暴力臂不看载体玩味空间」）随门退役
  event_negative_hard_news: [],
  // J1.87（C145，2026-10-21 用户裁定「产品日常不应该是事件符不符合要求的最终判定，
  // 应该直接到 web3 用户那边，看用户接纳度」「使用 bsc_meme_user_event_fit 即可」）：
  // 常规内容产品宣传桶退役——题集删桶、概率门 routineContentProductBlock/argmax
  // 臂 routine 子句删除；此处显式空域防旧缓存行/旧 fixture 的 routine choice 照拦
  // （BLOCK_LABELS 保留历史展示）。产品/内容型日常宣传改由第二层 bsc_meme_user_event_fit
  // + 名字/载体/关联/质量门判。J1.88/C150 再删 event_institution_routine（机构日常
  // 同交 bsc_meme_user_event_fit，见上）。
  event_routine_content_product: [],
};

/**
 * nameReferentBlock（J1.10 阻断函数）——C108 随拦截位退役删除，案史与裁定见
 * 上方并档注释。bsc_meme_user_name_entity_acceptance 题与概率保留（评分/豁免链消费），历史实现 git。
 */

/**
 * referentMemeabilityLowBlock（J1.28 mem≤1 低档门）——**C108（2026-10-19）
 * 拦截位退役**：拦截责任并入 web3UserAcceptabilityBlock 分支①/②（无名实体名/无圈内
 * 感知词——「用户侧不接纳」同轴）。案史：J1.28（2026-10-08，0fed29f9 亏损票
 * 续案）「币安汽车/日产类蹭得过头根本不可能成为 meme 币的票要拦」，dry-run
 * mem≤1 拦 4 票净 -0.354；其「无名/严肃对象」票型由 J1.42 name_form 四分支
 * 承接（YAYA 币安员工花名对照锚）。name_entity_memeability 题保留，分数只喂
 * C88 五腿（mem≥2）与恒落审计 referentMemeabilityScore；mem∈(1,2) 的 C88
 * memFloor 拦截位同批退役（覆盖与 nf 形态判据重叠——币安上电视 mem 1.72 本
 * 就是 not_meme_name）。历史实现 git。
 */

/**
 * J1.29 形象载体门 entityVisualBlock —— **C171（2026-10-22）整轴退役**：用户裁定
 * 「实体的可视化有形象，其实也是实体的 web3 用户接纳度的一部分（web3_user_name_
 * entity_acceptance），有形象接纳度会高，但也不是说没有形象就不行，一切看情况」
 * ——形象载体是用户偏好轴非资格轴，判据并入实体接纳题面锚句（J1.102）。
 *
 * 案史：C61（2026-10-09）立门回测 +4.42 BNB（避亏 59 张 +7.50 − 弃赢 13 张 −3.08，
 * existing/improvised/no_visual winR 39%/8%/24%）；此后 13 天九连打洞未止——C88
 * 五腿载体豁免臂（10-18）、C109 名图一致覆盖（10-19）、C118 演绎臂、C138 作者
 * 原话豁免、C139 著名免形象资格、C159 近 tie 臂、C160 动物救助情感豁免、C161
 * 巨大影响力豁免、C167 载体性质第四臂 fail-closed。三票终审实证结构性卡死：
 * 股城（web3 项目 no_visual 0.91 拦——项目类实体本来就不该有形象）、TREE（三桶
 * 0.44/0.35/0.21 argmax 拦——无置信门槛）、Heyi.ai（accepted choice 但概率 0.25
 * <0.5 著名豁免线拦——间接指代结构达不到豁免线）。
 *
 * 连带退役：web3_user_entity_visuality/image_depicts_name/image_carrier_nature/
 * event_influence 四题（题集 J1.102）+ 全部豁免链 + subjectCarrier* 审计键（历史行
 * 保留展示，新行不再产出）。避亏功能无等价替代（BNC/Bicat 类无形象亏损票改由
 * web3FitMassBlock/量级门/nameEntityLowBlock 接棒，无法机器证明等效——回归观察）。
 * 历史实现 git（bddd3578 立门 … J1.100/C167 最后加臂）。
 */

/**
 * C108 名字门（J1.42 name_form=not_meme_name——**唯一名字拦截位**）。
 *
 * 演化史：C96 币安上电视案立 statement 门（J1.37）→ C105 日本語版案立
 * functional_label 门（J1.40）→ C107 收敛为单一合格度三选（J1.41「是否合适
 * 作为 meme 币」）→ **C108 名字门统一**：nrBlock（J1.10 minor_other+
 * common_word 概率阻断）/rmBlock（J1.28 mem≤1）/memFloor（C88 mem∈(1,2)）/
 * misspelling 探针臂（block_misspelling noul，C78 实证失效）四个拦截位全部
 * 退役并入本门。触发案 EARLY（0xc8a5…7777，CZ 回复 "you got in early" 逐字
 * 发币）被 common_word「截词」臂 0.96 误拦——用户裁定三轮：
 * ①「很多门，不如合并为『合不合适作为 meme 币』门，这是根本的」
 * ②「如果代币的名字指向一个实体，那么这个实体到底是什么情况还是需要考量
 *   （例如普通币安员工就不行），但是 early 并不是一个实体」
 * ③「YAYA 我记得就是币安员工，所以不行」「meme 名字拼写错误，也肯定不行…
 *   …用一个门涵盖多种情况」。
 *
 * J1.42 name_form 四分支判据（承接全部退役位的拦截责任）：
 * ①指向实体——实体无名（普通员工花名 YAYA 型）不合格；实体是圈内符号/超级IP
 *   合格（实体量级与玩味另有题评，本题只确认用户认得、接得住）；
 * ②非实体词——圈内文化词（Early/趁早、HODL、LFG）合格；无圈内感知句片段
 *   （滑雪/我要去）不合格。分界=用户侧感知，非词源身份、非是否截词
 *   （EARLY/CONVICTION 型圈内词由「截词」误拦的票面放行）；
 * ③形态缺陷——陈述句/版本词/序号（C96/C105/C107 继承）；
 * ④无背景拼写变体（自 block_misspelling 探针并入；图文对照 C78 拦截位
 *   = J1.140 条件题 image_name_text_match，纯代码门已退役）。
 *
 * 旧 choice 兼容映射（断代 bit 兼容红线）：J1.37-J1.40 缓存行 choice=
 * statement/functional_label → 继续拦（语义等价 not_meme_name）；entity_phrase
 * → 放行（语义等价 meme_name）；unclear/缺失 → fail-open。存量行行为与断代前
 * 逐位一致（缓存行不重放 mapper，重析票按新门判）。
 *
 * J1.50（C119 用户视角统一）键名断代：name_form 三态改名
 * web3_user_acceptable / web3_user_not_acceptable / unclear（问法收敛「web3
 * 用户能否接纳这个名字作为 meme 币的名字」）。本 Set 收拦键
 * web3_user_not_acceptable + 全部旧拦键（not_meme_name/statement/
 * functional_label 存量缓存行照拦）；positive 侧结构不变——Set 外即放行
 * （acceptable 桶/meme_name/entity_phrase/unclear/缺失 fail-open），
 * 正臂无需枚举。J1.112/C183 桶值同族断代：新桶 bsc_meme_user_not_acceptable
 * 入 Set、新正桶 bsc_meme_user_acceptable 同为 Set 外放行。
 *
 * J1.80（C138 heyi.ai 案，2026-10-21 用户裁定「方案B」）超IP来源判据为纯题面
 * 追加段：原判据零改动；判断信息=state corpus_author_identity 认证行（super-ip
 * 注册表命中注入，代码事实零掷骰——heyibinance 在册 tier S）∧ 名字与主体相关
 * → 不能接纳标准提高为极端否证「从 BSC 链 meme 币交易者角度，即使是超级IP即
 * 影响力超大的用户讲的话，也完全当不了符号，完全不适合作为 meme 币，不会产生
 * 购买意愿」。choice 仍三态：mapper 本函数零改动（拦截 Set 不变），语义翻转
 * 全部由 Jev 按新判据出 choice 承担；旧缓存行不重放 mapper 零影响。快速交易
 * 框架：本门检验短窗购买意愿非长期生命力（heyi.ai 案 14s 毕业+vol24 $103K=
 * 购买意愿已被市场验证，事件 S 级/strong_fit 0.94 全判对、唯名字门 0.62 拦）。
 *
 * C88 recognizedEntitySlogan 五腿刻意不豁（继承）：五腿前提是口号票（名字=口号=可
 * 传播符号），陈述句/版本词名字连口号都不是。全域（不限类别）；无概率 mass
 * （choice 档位门）；unclear/答案缺失 fail-open 不拦（生产链 JevClient 缺
 * 答案 throw）。
 */
const WEB3_USER_NOT_ACCEPTABLE_CHOICES = new Set([
  'bsc_meme_user_not_acceptable', // J1.112 新键（C183）
  'web3_user_not_acceptable', // J1.50 新键（C119）
  'not_meme_name', 'statement', 'functional_label', // J1.37-J1.48 存量行兼容
]);

/**
 * J1.53（C122）题键断代：name_form → web3_user_name_acceptability（门名对齐语义
 * 「Web3 用户接纳度」，判据不动）；J1.81（C139）→ web3_user_phrase_acceptability
 * 只评 not_entity 票；J1.112（C183）→ bsc_meme_user_phrase_acceptability（评估主体
 * 收窄=BSC meme 币用户）。新键优先、旧键兼容=存量缓存行/旧 fixture
 * 形状仍走同一门（缓存行不重放 mapper，兼容只在重析前的旧形状测试与工具）。
 */
function web3UserAcceptabilityChoice(answers) {
  return answers?.bsc_meme_user_phrase_acceptability?.choice
    ?? answers?.web3_user_phrase_acceptability?.choice
    ?? answers?.web3_user_name_acceptability?.choice
    ?? answers?.name_form?.choice;
}

function wrongEntityBlock(answers) {
  const p = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.wrong_entity ?? 0;
  if (p < 0.5) return null;
  return { mass: Math.round(p * 100) / 100, label: `币名试图指向实体但指歪/指残（拼写错/不忠实呈现/版本残片，wrong_entity ${Math.round(p * 100)}%≥50%）` };
}

function web3UserAcceptabilityBlock(answers) {
  // J1.81/C139 词句门收窄：只评 not_entity 形状（口号/玩梗/文化词/句片段/陈述句/
  // 日常用语）；实体票（accepted/unacceptable_type/wrong_entity，J1.113/C184 四桶）
  // 不经本题——名字质量归实体轴（类型不合/指歪）+ 词句轴。版本臂/
  // 拼写臂已删（C105/C108 拦截责任迁入 wrongEntityBlock）。no_entity=J1.81 前旧缓存
  // 行兼容读（旧行按原口径照评，bit 不变）；旧 new_entity 行≠not_entity 照跳过（
  // J1.113 删桶后历史缓存行兼容，无需枚举）。
  // C180（2026-10-23）曾退役拦截、纯观察落档；**C189（2026-10-24）恢复拦截**
  // （C96 币安上电视追裁「要不被实体拒绝，要不被口号拒绝」）——拆臂期的两个
  // 病灶已由 C187 三因素重构（J1.116-J1.119）与上方实体臂优先路由 gate 根治：
  // 拦截原因混杂（审美=fit 的域/事件与代币不匹配=关联题的域）→ 三因素判据
  // 理顺；越权拦实体票 → entityChoice gate（实体票不经本题）。审计键
  // web3UserAcceptabilityBlock 照落
  const entityChoice = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.choice;
  if (entityChoice && entityChoice !== 'not_entity' && entityChoice !== 'no_entity') return null;
  const choice = web3UserAcceptabilityChoice(answers);
  if (!WEB3_USER_NOT_ACCEPTABLE_CHOICES.has(choice)) return null;
  return { label: 'Web3 用户不接纳该名字（词句接纳度门）', choice };
}

/**
 * C105 功能标注词门（J1.40）已随 C107 收敛并入上方 web3UserAcceptabilityBlock：
 * functional_label 旧 choice 经 WEB3_USER_NOT_ACCEPTABLE_CHOICES 兼容映射继续拦
 * （案史与论证见 web3UserAcceptabilityBlock 注释）。
 */

/**
 * J1.31 E 类情绪Web3偏好折损系数（2026-10-16 用户裁定，C80 蝙蝠侠摇案
 * 0x4547dae7757fb4043e034d27ed02dfabe9aa7777：「蝙蝠侠式蹦迪」抖音舞蹈现象票，
 * Jev E 类 0.99 + B 档量级 0.97 → 事件分 27+28.68+15=70.68 过线 high 放行，
 * 实测 18 分钟 54 tick 冷盘、买入 31s -12.4%。裁定原话「对时事现象热度，其实也
 * 应该度量事件对Web3用户的情绪感染力。这个事件没啥情绪感染力，我不会被它有任何
 * 触动，也并非一个大时事」——E 类事件分的 magnitude/dim2 量的是现象传播广度
 * （烧了多大），不是情绪转化（Web3 用户会不会被触动到想参与）：观众≠买家。
 * 折损作用于标准数学的影响力合成分（J1.71 合并后整体折损，传播/时效已内化，
 * 与情绪无关；W 数学不消费本题，cashtag/骑乘改道票 category==='W' 天然不触达）：
 *   strong_reaction 1（圈内情绪卷入不折——啾啾案 C74 新闻大时事形状）
 *   mild_amusement 0.5（轻度有趣：上限组合 (39+30)×0.5+15=49.5<60，数学上
 *     全档拦——「觉得有趣但不驱动参与」按裁定语义就是不该买，现象量级再大也
 *     不构成参与冲动；真被 crypto 圈主动传播的现象按题面锚应判 strong 而非
 *     mild。刻意保留系数形式而非阻断门：折损后事件分照常落库（档间梯度可
 *     观察，阈值事后校准免重跑，J1.28 referentMemeabilityScore 同款语义））
 *   indifferent 0.25（无感：B 档 28.92 / A 档 32.25 / S 档 33.5 全拦——圈层
 *     无感的现象对 meme 买盘无意义，传播量级再大也不折算成情绪）
 * 仅 category==='E' 消费（A/B/C/D/W/F/G 不折——用户裁定域=时事现象热度；A 类
 * 另有 J1.23 Web3 偏好锚、B 类产品另有 J1.27 接纳门、C/D 人物机构量级是客观
 * 影响力不依赖情绪转化）。答案缺失（旧缓存行/手写 fixture）→ 不折（fail-open，
 * J1.28/J1.29 同款；生产链 JevClient.ask 对缺答案 id 直接 throw，缺失形状只在
 * 旧缓存）。（C83 起全语料走标准路径，event_resonance 对 superIP 语料票同样生效）。
 * 窗口回测要触发折损须先失效缓存（scripts/narrative/invalidate-resonance-
 * window.cjs，照 J1.28/J1.29 模式）。
 *
 * J1.36（2026-10-18，C93 유과 강아지案续）：event_resonance 题删除（18→17 题），
 * 折损判据源换 bsc_meme_user_event_fit——用户裁定「meme 币发币哪里有什么圈内圈外一说，web3
 * 用户喜欢就行了」（B 案：折损机制保留、判据源替换）。根因：resonance 量的
 * 「情绪行动力」对 Jev 不可观测（只见语料不见链上），推断素材与 bsc_meme_user_event_fit 完全
 * 同源，独立作答只产生矛盾面（유과 案同次作答 bsc_meme_user_event_fit strong_fit 0.97 vs
 * resonance mild 0.79 互斥）；例文「圈外」焊死 mild 档定义，轴腐化为圈层归属。
 * 新判据：E 类且 bsc_meme_user_event_fit (strong_fit+fit) < 0.5（marginal 占优）→ 影响力
 * 合成分 ×0.5（J1.71 合并后整体折损）；≥0.5 → 原公式（유과 0.97 / 蝙蝠侠摇 0.76 均
 * 不折——后者形状放行为用户明示接受：当年 -12.4% 归盘面非叙事错判）。0.5 阈值
 * 与 J1.19 负门/J1.23 锚/J1.27 接纳门同一条线。unfit≥0.5 的票全域负门已拦，
 * 折损层不再管。bsc_meme_user_event_fit 答案整体缺失（J1.19 前旧缓存行）→ fail-open 不折；
 * J1.31-J1.35 行有 bsc_meme_user_event_fit 答案可重放新逻辑（存量不重评，回测/校准重放生效）。
 */
const WEB3_FIT_DAMP_COEF = 0.5;
const WEB3_FIT_DAMP_THRESHOLD = 0.5;

/**
 * 负面硬新闻质量门（J1.11，2026-09-26 用户裁定，C9 bitget被盗案 0x0e323198：
 * 蹭 Bitget 热钱包被盗 3.516 亿官方公告命名，D 类 + A 档量级直接喂饱事件分 74.65
 * → 80.32 high 放行后 -55%。裁定原文「第一，这是一个负面事件；第二，它没有啥
 * meme的」）。
 *
 * **J1.101（C170 RSA4 案 0x34866574…7777，2026-10-22 用户裁定「去掉
 * negative_hard_news 得了，直接让 web3 契合度去处理」）：门退役删除**——
 * CZ 转发印度 CA eMudhra 私钥泄露事件（其中一把私钥就是「4」）1 分钟后发币
 * RSA4，被本门 0.88 拦 low，但 strong_fit 0.87/exact_match 0.58/S 级/within_7d
 * 其余门全绿——圈内强相关安全事件被 S 级作者本人玩梗（"the internet was
 * encrypted by '4'"）。负面事件是否有 meme 玩味空间、值不值得玩，改由第二层
 * bsc_meme_user_event_fit 判（unfit≥0.5 负门 + J1.83 sf+fit<0.5 通用硬门接棒，
 * 与 J1.87/C145 routine 桶、J1.88/C150 institution 桶退役同构）。题集侧
 * J1.101 删桶；BLOCK_SCOPE 显式空域兜旧缓存行/旧 fixture 重放。
 */
/**
 * 常规内容产品宣传质量门（J1.13，2026-09-27 用户裁定，C12 绣春刀3案 0xa7c9c86e：
 * BTCdayu 推「绣春刀3电影即将推出」，第三方骑乘电影系列名发币，bsc_meme_user_name_entity_acceptance
 * super_ip 0.66 命中 C8 豁免 → B 类 65.95 high 放行。裁定「即使推出了，也不能
 * 作为meme币」——常规电影等内容型产品宣传与官宣与否无关：观众是消费者不是玩梗
 * 社区，无二创动力、无 meme 玩味空间，蹭其命名只是消费上映热度，产品知名度
 * 再高也不该放（与 event_negative_hard_news 同构：热度/知名度≠叙事价值））。
 *
 * 与 argmax 机制（BLOCK_SCOPE 'all'）双挂（语义同已退役的 negativeHardNewsBlock：
 * 本门按概率 ≥0.5 独立拦边界抖动，二者任一命中即拦，全域、标准 + superIP 双路径）。
 *
 * J1.16 角色IP豁免（2026-09-28 用户裁定，C25 久留美案 0xfedf19759ba9c45b1a8345a2bde916b
 * 38acc7777：角色名币被本门 0.91 拦下 rating 1，实际 12.6 倍毕业实验涨幅第一。裁定「这
 * 个不仅仅是开播剧，是里头的角色」——作品中的角色是独立 IP 实体可有自身 meme 生命
 * 周期，角色名币≠蹭作品宣传）：category=A（形象IP，event_category 主体归属规则同版本
 * 新增）时本门豁免，把关交给 A 类量级门（无名/未出圈角色 D/E 档直接拦、事件分 <60 拦；
 * Jev 对角色豁免的题目层措辞实证只能把 rcp 概率压到 0.57-0.70 压不过 0.5 线，与 J1.13
 * word_extraction 六轮措辞教训一致——Jev 分不动的边界由代码确定性切分）。
 * （C83 起全语料走标准路径：注册表账号语料票同样享受 A 类豁免——通道差异消失）
 */
/**
 * Web3 用户偏好质量门（J1.19，2026-09-29 用户裁定，C30 死亡观察员/太阳之勤案
 * 0xd2a6d440…7777 / 0xe5fa214f…7777：两票均为抖音爆款视频票，video_unrated
 * 爆款短路（点赞≥10万 → 不进Jev直接mid）放行后 Web3 用户不买账阴跌。裁定原话
 * 「Web3用户是不会喜欢的，不符合用户胃口」：Web2 传播热度 ≠ Web3 用户偏好——
 * 事件可以完全有叙事价值（E 类爆款）只是不合链上 meme 买家口味，故独立成题
 * （bsc_meme_user_event_fit 四档）而非并入 event_token_block_reason 的「无叙事价值」语义）。
 *
 * 独立题独立门：unfit 概率 ≥0.5 → rating 1（同已退役 negativeHardNewsBlock 的
 * 概率门形状：对抗 argmax 跨 run 抖动，全域不限类别、标准 + superIP 双路径）。
 * marginal 不拦——四档概率落库观察，待校准数据后再定是否收严。
 *
 * J1.82（C140）吸收 token_circle_reachability 拦截责任（用户裁定「web3 圈层
 * 不可达，就是不适合 web3 用户」）：原 A 域 argmax 桶退役，圈层不可达票改由
 * 本门拦（题集侧 unfit 档已带圈外亚文化 get 不到锚句+PEPE/doge 反向臂；marginal
 * 圈外臂同批删除=原圈外落 marginal 不拦的逃逸洞封死）。J1.101（C170）再吸收
 * negativeHardNews 拦截责任（用户裁定「直接让 web3 契合度去处理」；rcp 桶
 * J1.87 起已同交本层——第一层质量概率门至此全部退役，本门升级为事件质量/
 * 口味唯一否决入口，argmax 链只剩 empty_content/baseless/ip_reuse 三桶）。
 */
function web3UnfitBlock(answers) {
  const p = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities?.unfit ?? 0;
  if (p < 0.5) return null;
  return { label: 'BSC meme 用户偏好不合', mass: Math.round(p * 100) / 100 };
}

/**
 * 中国政治主题否决门（J1.122/C192，2026-10-25 用户裁定）：BSC 链用户多是中文
 * 用户、中国政治方面非常敏感——中国政治相关的票「这种影响力绝大多数情况并不
 * 适合构建 meme 币」，在 bsc_meme_user_event_fit 拦住（影响力存在 ≠ 适合做
 * meme，属第二层口味契合）。
 *
 * 判据源=fit 题第 5 桶 china_politics 的 **argmax choice**（独立否决桶，不参与
 * 四档连续比较；题面钉死「不看玩味空间」——有形象征集/二创空间/正面情绪/官方
 * IP 化不改变本判，C98 政治暴力臂同款写法）。确定性代码执行（J1.16/J1.23
 * 题面改锚分不动家族教训）：Jev 判该桶即拦，与该票 fit 四档概率无关；旧缓存行
 * 无该桶（choice 非 china_politics）→ fail-open 零翻转。
 *
 * 刻意无豁免链：pubProxy/isW/binanceCorpus/platformOfficial 均不适用于中国政治
 * 主题（这不是契合度概率问题）；港澳台按同标准由题面判，非中国政治不选本桶。
 */
function chinaPoliticsBlock(answers) {
  const c = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.choice;
  if (c !== 'china_politics') return null;
  return { label: '中国政治主题不适合构建 meme 币（J1.122）' };
}

/**
 * 币安系语料检测（纯代码，无 LLM）——C55 补充裁定（2026-10-03 用户「不过刚才
 * 说的情况，要豁免币安」）：产品实体接纳门对币安豁免。币安/crypto 原生机构的
 * 产品对链上买家天然高接纳——BSC meme 平台建在币安生态上、买家即币安用户，
 * 「产品实体不被 web3 接纳」的前提对币安系不成立（C35 币安支付 D 类 / C40 BI
 * 骑乘票不得被 C55 门拦）：币安影响力允许正常转移给其产品事件，与传统公司
 * 产品切分（C55 主体）相反。
 *
 * 判据：代币名（symbol/name）或语料推文（主推+父推，与 detectCorpusCashtag
 * 同文本源）含 binance/币安。宽判据有意——与 W 类交互分对币安生态票的宽松
 * 口径一致（J1.24 戏谑关联豁免同款先例）。
 */
const BINANCE_KEYWORDS = ['binance', '币安'];
function detectBinanceCorpus(tokenData, twitterInfo) {
  const norm = (s) => String(s || '').toLowerCase();
  const hay = [
    norm(tokenData?.symbol),
    norm(tokenData?.name || tokenData?.raw_api_data?.name),
    norm(typeof twitterInfo?.text === 'string' ? twitterInfo.text : ''),
    norm(typeof twitterInfo?.in_reply_to?.text === 'string' ? twitterInfo.in_reply_to.text : ''),
  ].join(' ');
  return BINANCE_KEYWORDS.some(kw => hay.includes(kw));
}

/**
 * 币安链原生平台官方账号检测（纯代码，无 LLM）——C56 补充裁定（2026-10-03 用户
 * 「flap 是币安链的 meme 币发布平台，也是我们交易代币主要来源，跟币安链一个
 * 道理」）：flap 平台官方 IP 票与币安官方票同构——自家场子的官方内容不算
 * 拦截对象（FlapGuy 0x2fb77ad0…7777 案：主推 @flapdotsh 官方号 9.98 万粉，
 * J1.27 下 cat=D + se=character_ip，实际拦截点 = event_token_block_reason argmax
 * event_institution_routine「机构日常运营」双轮稳定——历史豁免位有两处：① argmax 链
 * event_institution_routine 子句（J1.88/C150 随桶退役删除）②
 * 契合证据门（web3FitMassBlock opts，J1.83 前身=产品实体接纳门）。J1.87/C145
 * 起 routine_content_product 桶退役（产品日常改由 bsc_meme_user_event_fit 判），原
 * rcp 概率门豁免位随桶删除；J1.88/C150 再删 institution 桶，本检测现仅服务
 * web3FitMassBlock 豁免位。
 * （C83 起快车道删除，此处豁免面对全部语料生效；注册表内其余机构账号的
 * event_institution_routine argmax 已随 J1.88 桶退役不再拦——机构日常交 fit）
 *
 * 刻意用主推作者 handle 硬集而非文本关键词：flap/four 等词在 BSC meme 语料里
 * 高频出现（平台链接/普通英文词），裸查会把蹭名票误豁免；只查主推作者不查
 * in_reply_to 父推（BOB 0xf2fca4cf…7777 案：主推是 228 粉路人号 @zhangxuanhui
 * 玩 CZ 香蕉梗，父推才是 cz_binance——非官方源不豁免，common_word 拦截维持）。
 * 官方账号集遇新 case 再扩（four.meme 官方号暂未出现 case，不预设）。
 * 作者字段双形状：tweet 型 author_screen_name（FlapGuy 实测）/ account 型
 * screen_name（twitter-fetcher.mjs 两种返回形状，token 自挂官方账号链接时是
 * account 型）——两个字段都查。
 */
const PLATFORM_OFFICIAL_HANDLES = new Set(['binance', 'flapdotsh']);
function detectPlatformOfficial(twitterInfo) {
  const h = String(twitterInfo?.author_screen_name || twitterInfo?.screen_name || '').toLowerCase().trim();
  return h !== '' && PLATFORM_OFFICIAL_HANDLES.has(h);
}

/**
 * C97 币安地域子账号检测（纯代码，无 LLM）——0xf37b…7777「币安游戏」案
 * （2026-10-18 用户裁定「币安的地域账号，所发布的局部地域的事件，也不要被
 * 视为超级IP事件」）：主推作者=@BinanceArabic ✓（币安阿拉伯地域子账号，
 * 17.99 万粉）发「想象币安要办电视问答节目，帮节目起个名」——零赞零转的
 * 假设性互动推，token 名「币安游戏」即起名梗参赛。J1.36 判 D 类（机构）
 * A 档 34 分借壳母机构量级放行（74.45 high）。代码确定性切分（J1.16/J1.23
 * 家族教训：题面锚移不动 Jev 的分）：handle 以 binance 开头且非全球主号/
 * 全球职能臂 → 地域子账号；冒充号一并命中（方向 fail-safe 偏拦——冒充号
 * 更不配借壳量级，无需 verified 门）。
 *
 * 全球号集合（GLOBAL_BINANCE_HANDLES）：主号 + 全球职能臂（Labs=风投 /
 * Research=研究 / Square=内容平台）+ 币安中文 binancezh（2026-10-23 用户
 * 裁定「binancezh 改为币安核心号，因为 BSC 多是中文用户」——中文主阵地
 * 视同核心号，不锚 D）。新全球职能臂遇 case 再扩
 * （PLATFORM_OFFICIAL_HANDLES 同款维护语义）；地域号（Arabic/Africa/
 * Turkiye/…）全部视为地域子账号。只查主推作者不查父推（BOB 案先例：主推
 * 是路人号玩梗、父推才是官方——主体判定以主推作者为准）。作者字段双形状：
 * tweet 型 author_screen_name / account 型 screen_name（detectPlatformOfficial
 * 同款）；handle 缺失 → null fail-open（旧缓存行/无推语料票不锚）。
 */
const GLOBAL_BINANCE_HANDLES = new Set(['binance', 'binancelabs', 'binanceresearch', 'binancesquare', 'binancezh']);
function detectBinanceRegionalAccount(twitterInfo) {
  const h = String(twitterInfo?.author_screen_name || twitterInfo?.screen_name || '').toLowerCase().trim();
  if (!h.startsWith('binance') || GLOBAL_BINANCE_HANDLES.has(h)) return null;
  return { handle: h, followers: Number(twitterInfo?.author_followers_count ?? 0) || 0 };
}

/**
 * CJK 长名前提（J1.140/C78 图片直连架构）：原纯代码门 detectNameImageSpellingMismatch
 * 的判据①——仅 CJK 名（Han/Hangul/Kana）且长度 ≥3 才做图内文字对照（拉丁名
 * 不判：3-4 字母名与图内任意词一字符差全是 OCR 噪声，CTS/ces、RAM/rom 实测族）。
 * caption 中介退役后拼写对照改由 J1.140 条件题 image_name_text_match 承接，
 * 本谓词=analyzer 侧问不问该题的代码前提（题集 imageNameTextMatch 与 mapper
 * 拦截位经「题只在前提真时问」天然同源，无第二处判定）。
 */
export function isCjkLongName(tokenData) {
  const name = String(tokenData?.name || tokenData?.raw_api_data?.name || '').toLowerCase().replace(/\s+/g, '');
  return name.length >= 3 && /[一-鿿가-힯぀-ヿ]/.test(name);
}

/**
 * （已退役 J1.140 图片直连架构）：C78 图文名不符拼写门原为纯代码门
 * detectNameImageSpellingMismatch——读 caption 转写（image_analysis
 * stringify）做 substitution 一字差对照；caption 中介随 SiliconFlow 替换退役
 * 后，图内文字对照由看图的 Jev 条件题 image_name_text_match 承接（拦截位=
 * one_char_diff ≥0.5（J1.141 三桶），鲸元卷案形状承接；CJK≥3 前提=isCjkLongName
 * 代码侧，题只在前提真时问）。案史：C78 鲸元卷 0xe0cf0905…7777（图内正字
 * 「鲸元券」多次出现、全图无一「卷」字——名称连自己的宣告图都没抄对）；
 * Jev 探针实证拦不住（block_misspelling 线上 0.28/加判据 0.13）系旧文本探针
 * 形状，新条件题四桶直接对照图本体。审计键 spellingMismatch 值形状改为
 * {name, bucket, prob}。
 */

/**
 * Web3 用户契合证据门（J1.83/C141 通用化；前身=产品实体接纳门 J1.27，2026-10-03
 * 用户裁定，C55 华为麒麟案族——评3 161 票
 * 东西方归类发现「中国公司产品发布」簇 ~15 票几乎全亏：麒麟 0x967e4a52…7777
 * 实测 mag S71%/dim2 五档84% =「华为」的世界级影响力整体转移给「麒麟芯片」产品
 * 实体；B 类 J1.21「发布者指代」/D 类机构影响力/A 类形象档三条继承通道横跨四类）。
 * 裁定原话「这里面的主体并不是"华为"/"网易"，而只是它们发布的产品（实体）。
 * 要不就是事件形成了大影响力（并不需要一定是顶级IP），要不就是玩梗/有趣，
 * 对应着一个可爱的形象，本质上还是web3用户能不能喜欢与接纳的问题」。
 *
 * 执行：第 15 题 event_subject_entity 显式标注主体=公司产品实体（product_functional/
 * product_character）时，两条路统一收敛到接纳度底线——bsc_meme_user_event_fit 的 strong_fit+fit
 * 合计 <0.5 → 阻断（路b 玩梗可爱票靠 sf 高过线；路a 真出圈大影响力事件的票
 * fit 至少中性——web3 用户在讨论它；纯功能产品无论母公司多大、大众圈多热，
 * crypto 圈不接纳就拦）。母公司影响力的切分由题面形状③承担（wording 实证：
 * 麒麟 mag 4.58→2.97 且 fit sf44→mg62）、dim2 残留（国产芯片报道被判事件自传播
 * 五档57%）由本门兜底——题面切分+代码执行双防线（J1.16/J1.23/J1.24 教训）。
 *
 * J1.83（C141）题退役门一般化（用户裁定「这个也是口味契合的大类，应该放到
 * bsc_meme_user_event_fit 中，如果 C/D 类没有通用硬门可以加」）：event_subject_entity
 * 题删除（判据素材与 fit 完全同源，独立作答只产生矛盾面——C140 圈层并入同款
 * 第二次），产品实体接纳门退役为本通用门——**strong_fit+fit 合计 <0.5 → 阻断，
 * 全域不限类别**。门域全域是麒麟簇横跨 A/B/D 三类的必然（收窄 C/D 会让 B 类
 * 发布者指代票逃逸）。行为单向收紧：非产品实体票 sf+fit<0.5 旧放新拦（C/D
 * 客观规模票=主要新增面=用户点名的通用硬门）；产品实体票拦截条件为子集关系
 * bit 不变；豁免救回的 E 类票 J1.36 折损仍生效（非豁免 E 类低 fit 票改由本门
 * 拦，折损臂收窄为豁免路径）。题面侧锚句随迁：unfit 桶新增产品实体臂（母公司
 * 影响力≠产品接纳核心句+币安/crypto 原生机构例外）。
 *
 * 豁免：①pubProxyActive（J1.18/C29 发布者指代激活——骑乘票的量级语义由代码
 * 锚定，两裁定并存）；②isW（W 数学独立计分，Web3 产品 fit 天然高、门无增益；
 * J1.56 起 rideMass 豁免位随骑乘改道退役）；③binanceCorpus（C55 补充裁定：币安系产品对链上买家
 * 天然高接纳，币安影响力可正常转移给其产品——C35 币安支付/C40 BI 不拦）；
 * ③b platformOfficial（C56 补充裁定：flap 等币安链原生平台官方账号源，与
 * 币安同理）。（C83 起全语料走标准路径，本题对 superIP 语料票同样生效）
 */
function web3FitMassBlock(answers, opts) {
  // J1.56（C126）：rideMass 豁免位随骑乘改道退役——低影响力实体由
  // nameEntityLowBlock（unknown ≥0.5）在 B/C 域直接拦，不再改道 W 数学。
  if (opts.pubProxyActive || opts.isW) return null;
  if (opts.binanceCorpus || opts.platformOfficial) return null;
  const p = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities ?? {};
  const fitMass = (p.strong_fit ?? 0) + (p.fit ?? 0);
  if (fitMass >= 0.5) return null;
  return {
    label: `Web3用户契合证据不足(J1.83)（sf+fit合计${Math.round(fitMass * 100)}%<50%）`,
    fitMass: round2(fitMass),
  };
}

/**
 * 骑乘改道（C8）**J1.56 退役**（C126 何一「こんにちは」案 + 用户裁定「低影响力
 * 实体不通过」）：旧实现吃 name_referent 的 subject_self + super_ip 拆分——
 * subject_self 过半 = 币名是推文主体自己的东西且主体不是超级 IP → B/C 域改道
 * W 数学（要求被骑产品自身影响力极高）。新题 bsc_meme_user_name_entity_acceptance
 * 把「归属」折叠进实体接受度轴：低影响力实体（自己的或他人的）一律 unknown →
 * 由 nameEntityLowBlock 在 B/C/D/F/G/W 域直接拦，W 数学路径结构性不可达。
 * 行为变化=被拦而非降级评分，方向与用户裁定一致（低影响力实体不通过）；
 * 高影响力实体（accepted）本就豁免改道，零变化。项目制作者自己发币仍走
 * detectIssuerSelfLaunch → prestage（C7 方案 A，不受影响）。
 *
 * 注意：W 类原生（event_category=W）与 cashtag 改道（J1.17）不受影响。
 */

/**
 * 实体类型接纳门（J1.113/C184）：币名映射到可辨实体、但该实体的类型/性质不能被
 * BSC meme 币用户接纳为 meme 币名（圈外商业品牌/金融机构/品种学名等——无论著名）
 * → unacceptable_type ≥0.5 **全域拦**（C184b 方案一，2026-10-23 用户裁定）。
 * 用户裁定（2026-10-23，观察票 C183-C187 vs C189-C191）：可乐/银行名/犬种学名=
 * 类型不可 meme 化该拦；天狗/恩恩崽/乐宝豆=可接纳类型该放。二轮裁定：不评认知度
 * ——事件已成立且实体与事件关联（关联度门管）时用户已知晓该实体，判据只看实体
 * 类型与性质（实体量级归量级门）。
 * 域全域化（C184b 快狗打车案 0x497ebe5c…7777）：实体题已正确判 unacceptable_type
 * 0.9（accepted 仅 0.05——「狗」字没有把实体题带偏），但 event_category 掷骰 E
 * （置信 0.32，D 0.22/B 0.19 平铺）→ 旧域 B/C/D/F/G/W 不含 E → 门 miss 放行
 * high 86.57。旧域排除 A/E 是 J1.56 认知度轴遗留（圈内事件/meme 类实体认知度豁免
 * 的理由），类型轴下实体是银行/可乐/犬种学名与事件分类正交——裁定对齐 wrong_entity
 * 去域限制全域拦。
 * 断代：**不归一读旧 unknown**（C180 前认知度轴桶值）——历史缓存行零翻转，重析
 * 后自然更新到新桶；审计键 nameEntityTypeUnfitMass（旧 nameEntityLowMass 键停
 * 产出，历史行保留展示）。
 * 史档——C180（2026-10-23）曾退役本门拦截（认知度轴判据下 unknown 臂 89% 被拦票
 * fit 过线、关联题 exact 被越权拦——「拦的少惹的事多」）；C184 以类型轴判据恢复
 * 拦截，认知度轴语义随桶值断代废弃：
 * - pubProxyActive 豁免保留（官方域名=具体产品落地 C29 裁定，随拦截恢复）
 * - 旧 new_entity 桶（J1.72/C133 股城案「不拦」）已随 J1.113/C184 删桶——
 *   历史缓存行 new_entity argmax 时 unacceptable_type 必然 <0.5（概率和为 1）
 *   天然不触门，兼容无需处理
 * - 与旧 nrBlock 的刻意 delta：旧规合计 minor_other + common_word；新轴的
 *   截词/普通词归 not_entity（中性，C108 名字形态责任史）
 */
function nameEntityTypeUnfitBlock(answers) {
  const p = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.unacceptable_type ?? 0;
  if (p < 0.5) return null;
  return { mass: Math.round(p * 100) / 100, label: `币名实体类型不被 BSC meme 用户接纳为 meme 币名（可乐/银行/犬种学名类类型不合，unacceptable_type ${Math.round(p * 100)}%≥50%）` };
}

/**
 * 实体-事件影响力脱节门（J1.124/C194，2026-10-25 用户裁定）：齐天大圣
 * 0x4a6a6c8b…7777——「齐天大圣是中国非常著名的超级 IP，但是这个事件影响力明显
 * 不大。这样就是代币 IP 很大，事件本身影响力极小，两者脱节，事件明显支撑不起
 * 这个代币，这种情况需要据掉」。
 *
 * 判据源=实体题第 5 桶 entity_event_mismatch 概率 ≥0.5 **全域拦**（与
 * unacceptable_type/wrong_entity 同形状：概率门对抗 argmax 跨 run 抖动）。
 * 域全域=大 IP + 小事件的脱节与事件分类正交（E/W/B 分类都可能是旁观小热点）。
 * pubProxyActive 豁免保留（官方域名=具体产品落地 C29 裁定：发布者指代票的事件
 * 就是官宣产品发布本身，不是旁观小热点）。旧缓存行无该桶 → 概率 0 fail-open
 * 零翻转。审计键 nameEntityEventMismatchMass（命中才落）。
 */
function entityEventMismatchBlock(answers) {
  const p = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.entity_event_mismatch ?? 0;
  if (p < 0.5) return null;
  return { mass: Math.round(p * 100) / 100, label: `事件与代币实体影响力脱节（大 IP + 小事件撑不起代币，entity_event_mismatch ${Math.round(p * 100)}%≥50%）` };
}

/**
 * 阻断选项是否在该类别下生效
 * @param {string} choice - bsc_meme_user_event_impact（旧键 event_quality_veto/event_token_block_reason）的 choice（≠'none'）
 * @param {string|null} category - event_category 的 choice
 * @returns {boolean}
 */
function blockInScope(choice, category) {
  const scope = BLOCK_SCOPE[choice];
  if (scope === undefined) return true; // 未知选项按通用处理（问题集与表需同步维护）
  return scope === 'all' || (Array.isArray(scope) && category != null && scope.includes(category));
}

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Score 带内线性插值：score=i+f → 第 i 带内 lo+f*(hi-lo)
 * @param {number} score - Jev Score 原始值（0 ~ bands.length）
 * @param {Array<[number,number]>} bands - 有序带边界
 * @returns {number} 插值后的分
 */
function bandInterpolate(score, bands) {
  const idx = clamp(Math.floor(score), 0, bands.length - 1);
  const frac = clamp(score - Math.floor(score), 0, 1);
  const [lo, hi] = bands[idx];
  return round2(lo + frac * (hi - lo));
}

/**
 * 量级档位：score 四舍五入到最近档
 * @returns {string} 'E'|'D'|'C'|'B'|'A'|'S'
 */
function impactTierOf(score) {
  return MAGNITUDE_TIERS[clamp(Math.round(score), 0, MAGNITUDE_TIERS.length - 1)];
}

/**
 * 质量长度分（确定性表，原 Stage3 2.1 节）
 * 中文：1-3字8分，4-6字5-7分，7-10字2-4分，>10字0-1分
 * 英文：1词8分，2-3词5-7分，4词2-4分，>4词0-1分
 */
export function qualityLengthScore(symbol) {
  if (!symbol) return 0;
  const cjkCount = [...symbol].filter(c => {
    const code = c.codePointAt(0);
    return code >= 0x4E00 && code <= 0x9FFF;
  }).length;
  if (cjkCount > 0) {
    if (cjkCount <= 3) return 8;
    if (cjkCount <= 6) return 6;   // 5-7 带中值
    if (cjkCount <= 10) return 3;  // 2-4 带中值
    return 0;                       // 0-1
  }
  const words = symbol.split(/[^a-zA-Z]+/).filter(Boolean).length;
  if (words <= 1) return 8;
  if (words <= 3) return 6;
  if (words === 4) return 3;
  return 0;
}

/**
 * 从 answers 提取关联分。J1.43（C109）两题合一：新形状（无 relevance_level 键）→
 * choice 命中融合桶单值直查（levelIdx=null，reason 模板打点适配）；旧形状
 * （relevance_level 键在=旧两题形影不离）→ legacy 两题查表路径原样
 * （RELEVANCE_TABLE+round(level)），存量行/旧 fixture bit 不变。
 */
function relevanceFrom(answers) {
  const type = q(answers, 'bsc_meme_user_name_event_acceptance', 'web3_user_name_event_acceptance')?.choice ?? answers.name_event_relevance?.choice ?? 'none';
  // 形状分流而非桶名分流：融合表与旧表有 5 个同名桶且分值不同
  // （abbreviation_alias/generic_concept/none 等），旧形状判据=relevance_level 键在
  // （旧两题形影不离），只看桶名会让 legacy 行被融合表劫持破坏 bit 不变。
  if (answers.relevance_level == null) {
    const fused = RELEVANCE_FUSED_SCORES[type];
    if (fused != null) return { type, levelIdx: null, score: fused };
  }
  const levelIdx = clamp(Math.round(answers.relevance_level?.score ?? 0), 0, 4);
  const table = RELEVANCE_TABLE[type] || RELEVANCE_TABLE.none;
  return { type, levelIdx, score: table[levelIdx] };
}

/**
 * 从 answers 提取质量分（长度代码算）。J1.43（C109）两题合一：token_name_quality
 * （band 索引 0-3）→ TOKEN_QUALITY_BANDS 联合量纲 0-12，name=合并子分、
 * spelling/reasonability=null；旧形状（quality_spelling+quality_reasonability）
 * → legacy 双 band 路径原样，name=null。total 两种形状同为「长+名字质量」合计
 * 刻度，类别阈值语义不变。
 */
function qualityFrom(answers, symbol) {
  const length = qualityLengthScore(symbol);
  const tq = answers.token_name_quality?.score;
  if (tq != null) {
    const name = bandInterpolate(tq, TOKEN_QUALITY_BANDS);
    return { length, spelling: null, reasonability: null, name, total: round2(length + name) };
  }
  const spelling = bandInterpolate(answers.quality_spelling?.score ?? 0, SPELLING_BANDS);
  const reasonability = bandInterpolate(answers.quality_reasonability?.score ?? 0, REASONABILITY_BANDS);
  return { length, spelling, reasonability, name: null, total: round2(length + spelling + reasonability) };
}

/**
 * 组装三个 stage 共用的调用元数据（prompt 列存储内容）
 * full=true 携带 state（语料全文）+ questions（问题集全文）——Jev 单次调用的完整 prompt，
 * 落库供页面回放展示；full=false 为摘要版（主路径 event_score/relation 与 event 同一次调用，
 * 全文只存 jev_prompt，避免一行三份 60k 语料，指针 fullPromptIn 指明全文所在列）
 */
function buildCallPromptMeta(questions, stateStats, state, { full = false } = {}) {
  return JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_QUESTIONS_VERSION,
    questionIds: Object.keys(questions),
    stateStats,
    ...(full ? { state, questions } : { fullPromptIn: 'jev_prompt' }),
  });
}

/**
 * 主路径（原 3 阶段管线）映射
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.tokenData - 代币数据
 * @param {Object} context.tokenData - 代币数据
 * （context.includeBrandHijack/credibleEventAnchor 已废 J1.103/C172：品牌劫持轴
 *   整体退役，传参静默忽略）
 * @param {boolean} [context.instagramLinked] - 语料是否引用 Instagram 链接（C44 IG 影响力
 *   兜底锚条件①，analyzer 层按 classifiedUrls.instagram 算好传入）
 * @param {boolean} [context.instagramInfoFetched] - IG 数据是否已抓到（false=数据不可得，
 *   走兜底锚；true=真数据已进 state 由 Jev 按真证据判分）
 * @param {boolean} [context.imageEvidence] - 配图视觉证据是否存在（J1.30 名图一致豁免
 *   条件①，analyzer 传 imageEvidence = twitterInfo.image_analysis 存在；与题集
 *   imageConsistency 条件同源——答案缺失/无图票豁免 fail-closed 不触发）
 * @param {Object} context.callInfo - {model, questions, state, stateStats, usage, startedAt, finishedAt}
 * @param {Object|null} [context.tweetClassification] - 推文预分类
 * @returns {Object} { stage1DataToSave, stage2DataToSave, stage3DataToSave,
 *                     stageFinalData, llmResult, promptType, jevDetails }
 */
export function mapStandardAnswers(answers, context) {
  const {
    tokenData, callInfo, tweetClassification = null, twitterInfo = null,
    // C44 IG 影响力兜底（analyzer 传入）：instagramLinked = classifiedUrls.instagram
    // 有 URL；instagramInfoFetched = IG 数据已抓到（真数据进 state，Jev 按真证据
    // 判分不兜底）
    instagramLinked = false, instagramInfoFetched = false,
    // J1.137/C240 火蚁案：发行方自发宣告证据（detectIssuerSelfLaunch 产物，
    // null=未检出零侵入）——C75/C103 时效 override 豁免臂判据
    issuerSelfLaunch = null,
    // C250 借壳语料陈旧门原料（analyzer 直传 fetch 产物）：square/website 语料
    // 时间戳 mapper 侧收集判定腿②（twitterInfo 已在 context 供腿①）
    binanceSquareInfo = null, websiteInfo = null,
  } = context;
  const symbol = tokenData.symbol || '';
  // stage1 存完整 prompt（state+questions 全文），stage2/3 存摘要+指针
  const promptMetaFull = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state, { full: true });
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state);
  const rawOutput = JSON.stringify({ answers, usage: callInfo.usage });
  const baseFields = {
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    started_at: callInfo.startedAt,
    finished_at: callInfo.finishedAt,
    success: true,
    error: null,
  };

  // ── Stage1：分类（无阻断语义）──────────────────────────────────────
  // J1.17 cashtag 改道（2026-09-28 用户裁定，C28 iNu案 0xf578b84b：语料推文含与
  // 币名相同的 $TICKER cashtag = 推文讨论的是已存在的 web3 资产，代币是骑乘/
  // 蹲号该资产的名字而非截词原创叙事 → 强制按 W 类数学评分（被骑资产影响力须
  // 极高）。判据在 detectCorpusCashtag（纯代码，无 LLM），Jev event_category
  // 概率不再有决定权——iNu 案 W 0.25 输给 C 0.52 的 argmax 逃逸正是漏放根因。
  const cashtagHit = detectCorpusCashtag(tokenData, twitterInfo);
  const cashtagForced = !!(cashtagHit && answers.event_category?.choice !== 'W');
  // C96 F→E 改道（2026-10-18 用户裁定，币安上电视 0xc6d0…7777 CZ 推文 1 秒快枪案：
  // 「币安上电视算是个哪门子 meme 币？这是一个陈述不是一个实体」方向 1）：Jev 把
  // 「目击新闻」判进 F（Discovery「author-discovered」被 spotted 目击语气满足——
  // CZ 转发「BNB 上越南国家电视」→ F 类 A 档 34+28+15=77 high 放行，22 秒 -33.4%）
  // 是分类逃逸：no_visual_entity 0.97 若按语义判 E/D 会被 J1.29 载体门当场拦死，
  // 逃进 F 不吃载体门不吃 J1.36 折损。改道判据=J1.37 新题 event_finding_vs_recap：
  // event_category=F 且 news_recap（叙事内容是对新闻事件的报道/目击/搬运，发现
  // 语气只是目击动作）→ 强制改 E，E 类既有门自动接管（载体门 E+no_visual /
  // bsc_meme_user_event_fit 折损 / E 类时效与量级语义）。cashtag 改道优先（F 与 cashtagHit 互斥
  // 无竞争：cashtagForced 时改 W 数学，本改道不触达）。event_finding_vs_recap=
  // narrative_finding/unclear/缺失（旧缓存行 fail-open，J1.28/J1.29 同款）→ 维持
  // F 零变化。审计 categoryForced='f_recap_e'（cashtag_w 同款，Jev 原 choice 见
  // event_category probabilities 可追溯）。
  const recapForced = !!(answers.event_category?.choice === 'F'
    && answers.event_finding_vs_recap?.choice === 'news_recap');
  const category = cashtagForced ? 'W' : (recapForced ? 'E' : (answers.event_category?.choice || null));
  // J1.18 发布者指代（C29 Cue/Manus 案 0x5074546c，2026-09-29 用户裁定「骑乘第三方
  // 产品：①独立产品发布/重大升级；②产品影响力由发布者指代——领域知名发布者算
  // 大IP」）：领域知名发布者官宣独立新产品（判据全代码可读，detectPublisherProxy：
  // 官宣域名 stem=币名 + 作者粉丝≥10万 + 币名与作者名互不包含 + 无版本指纹词）被
  // 第三方骑乘发币时，按发布者知名度指代计分：
  // - nameReferentBlock / 骑乘改道豁免——等同 super_ip≥0.5 放行侧语义（Jev 对
  //   发布者知名度的知识缺口五轮实测 super_ip 0.16→0.31 压不过 0.5 线）；
  // - （J1.64 已删 event_marketing_gimmick 选项——噱头并入影响力轴）
  //   噱头定义直接矛盾（CUE 本轮 argmax gimmick 0.30/none 0.29 抖动即此形状）；
  // - 量级 A 档锚（effTier）——题面「领域知名大IP→A档起」Jev 执行不下去（magnitude
  //   稳定 B 档），发布者知名度由代码事实锚定；superIP 快车道 S 级预评分同构
  //   （量级代码判定的体系先例；C83 起快车道删除，pubProxy 锚保留为唯一同构物）。
  // 边界：仅 B/C 域（与 rideDetourMass 同域，防 B/C 边界跨 run 抖动）；cashtag
  // 改道优先（推文含 $TICKER = 讨论已存在 web3 资产，W 数学语义不变）；rcp /
  // negativeHardNews 门不豁免（内容型产品 C12 绣春刀裁定维持——发布者指代不适用
  // 于电影等内容产品；rcp J1.87/C145、nhn J1.101/C170 两门已退役，本句存史）。
  const pubProxy = detectPublisherProxy(tokenData, twitterInfo);
  const pubProxyActive = !!(pubProxy && !cashtagForced && (category === 'B' || category === 'C'));
  // C55 补充裁定：币安系语料（代币名/主推/父推含 binance/币安）——产品实体
  // 接纳门豁免位（detectBinanceCorpus 见上）
  const binanceCorpus = detectBinanceCorpus(tokenData, twitterInfo);
  // C56 补充裁定（flap 官方源）：主推作者=币安链原生平台官方账号（binance/
  // flapdotsh）——rcp 门 + 产品门双豁免位（detectPlatformOfficial 见上）
  const platformOfficial = detectPlatformOfficial(twitterInfo);
  // C97 币安地域子账号量级锚：主推作者=binance 前缀非全球号（detectBinanceRegionalAccount）
  // 且语料/币名借币安（binanceCorpus）→ 量级不按母机构借壳。锚降优先于
  // pubProxy/web3Fit 两锚升（effTier 天花板——地域子账号运营内容不再翻案）；
  // 量级门 D/E 臂无 recognizedEntitySlogan 豁免（C88 五腿只豁载体门/rcp/劫持/关联
  // 截断/事件分不足臂）——本案五腿全中（superIp 0.55/mem 2.39/relPositive 0.8）
  // 把 no_visual 0.98 豁出载体门后，本锚是唯一拦截位。cashtag/骑乘改道走
  // W 数学 tier 不参与，天然无竞争。
  const binanceRegional = detectBinanceRegionalAccount(twitterInfo);
  const regionalAnchorActive = !!(binanceRegional && binanceCorpus);
  // J1.79：事件分 = fit 质量（strong_fit+fit）；tier 由 fit 派生，供既有
  // magExempt/审计结构继续工作。身份/存在性由各自的臂负责。
  const fitProbsForScore = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities || {};
  const fitStrongForScore = fitProbsForScore.strong_fit ?? 0;
  const fitForScore = fitProbsForScore.fit ?? 0;
  const likedMass = Math.min(1, fitStrongForScore + fitForScore);
  const influenceScore = round2(likedMass * 5);   // 0-5（fit 派生；tier/豁免/审计）
  const influenceBase = round2(likedMass * 100);  // 0-100 事件分
  const tier = impactTierOf(influenceScore);
  // 发布者指代量级锚生效位：Jev 原判低于 A 时锚到 A（S 不降，A 原判不动）
  const tierAnchored = pubProxyActive && tier !== 'S' && tier !== 'A';
  // J1.23 Web3 偏好量级锚生效位（C38 久留美案续，2026-10-01 用户裁定「A类判定
  // 没有考虑 Web3 用户喜好…最根本上要占到用户角度看叙事」）：A 类（形象 IP）的
  // 量级本质=多少人愿意拿这个形象玩梗，Web3 买家群体强喜欢本身就是量级证据。
  // 题面改锚实证 Jev 执行不动（久留美 C 档置信 0.82→0.94，语料「2.5万粉官号/
  // 未开播角色」的客观事实锚死大众知名度口径；同票 bsc_meme_user_event_fit strong_fit 0.88
  // 高置信——J1.16 rcp / J1.18 pubProxy 同款教训：Jev 分不动的边界代码切）。
  // strong_fit ≥0.5（与 unfit 负门同阈值，两档概率互斥无冲突）时量级锚 B：
  // B 档=过线最低量级带；不越权 A/S——圈内喜好不证明世界级知名度，大众知名
  // 通道（A/S）仍由知名度证据决定。原判 B/A/S 不动；D/E 档随之放行（偏好
  // 证据推翻「量级不足」）。
  // C94 扩展臂（2026-10-18 用户裁定，京小安案 0xcb98accaa8040a7e839c305b8aca
  // 08e113c87777：「bsc_meme_user_event_fit 如果高，豁免发布主体…web3 用户喜欢，发布这个
  // 新闻的是什么主体就无所谓了，地方媒体全国媒体都可以」）：B 类（非 Web3
  // 产品票）同享量级锚——J1.27 形状③已把产品实体的发布方知名度切掉，剩余
  // 量级判据（自传播/形象玩梗）在小号转述+原始语料数据缺失时必然 D 档
  // （京小安：北京日报官微源未抓到，1 粉转述 0 赞 0 转 → 1.35/D 档 75%），
  // 偏好证据（strong_fit 0.57）推翻「量级不足」。纯功能产品天然 strong_fit
  // <0.5（题面限制「不高于 marginal」），豁免臂结构性不触达无形象产品票。
  // 仍仅 A/B 类：C/D/E 类量级是人物影响力/热点传播的客观规模，偏好不替代
  // 规模（维持）；事件影响力特别大的票走 S/A 档高分既有通路，与本豁免正交。
  const web3FitStrongP = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities?.strong_fit ?? 0;
  const web3FitAnchored = !tierAnchored && (category === 'A' || category === 'B')
    && web3FitStrongP >= 0.5
    && tier !== 'S' && tier !== 'A' && tier !== 'B';
  const effTier = regionalAnchorActive ? 'D' : (tierAnchored ? 'A' : (web3FitAnchored ? 'B' : tier));
  // C75 叙事源头陈旧 override：direct_tweet 主推超 30d → timing 归 older（在
  // timing 变量源头生效，W/标准数学 + 全下游一致消费）
  // J1.137/C240 火蚁案豁免：发行方自发宣告票（issuerSelfLaunch 检出=主推作者
  // 即宣告主体，truthy 对象）讲自己的事——源头早=运动/叙事历史而非蹭旧叙事，
  // C75 全量豁免（主推=宣告主体自己的宣言）；C103 豁免收紧为同主体链父推
  // （被翻译/解释的父推=主推作者自己的内容——火蚁形状=website_tweet 回复的
  // 就是主推宣言本体；翻译别人〔binancezh 活动推〕的老内容不豁免，BAI 参赛
  // 票防线）；时效档交 event_timing 题持续运动锚软评；C102 币安借壳语料
  // 刻意不豁免（BAI 案：issuer 检出的是参赛小号宣告、主推作者是 binancezh，
  // 同款豁免会洗白参赛蹭票）
  const issuerTimingExempt = !!issuerSelfLaunch;
  const staleSourceTiming = issuerTimingExempt ? null
    : overrideStaleSourceTiming(tweetClassification, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleSourceOverride = staleSourceTiming
    ? { lagSec: staleSourceTiming.lagSec, staleSec: SOURCE_STALE_SEC, rawTiming: staleSourceTiming.rawTiming }
    : null;
  // C102 借壳语料父推源头窗：binanceCorpus 票父推 lag 超 24h → timing 归 older
  //（BAI 案；不限 type，与 C75/C103 同票并存不冲突——三条 override 同归 older）
  const staleParentTiming = overrideStaleParentTiming(binanceCorpus, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleParentOverride = staleParentTiming
    ? { lagSec: staleParentTiming.lagSec, staleSec: BINANCE_PARENT_STALE_SEC, rawTiming: staleParentTiming.rawTiming }
    : null;
  // C103 载体↔父推关系源头窗（Jean Phil 案）：Jev 判翻译/二手解读 + 父推 lag
  // 超 24h → timing 归 older（三条 override 同归 older，审计键各落各的）
  const staleRelParentTiming = issuerTimingExempt
    ? overrideStaleRelParentTiming(answers, twitterInfo, tokenData, answers.event_timing?.choice, { skipSameSourceParent: true })
    : overrideStaleRelParentTiming(answers, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleRelParentOverride = staleRelParentTiming
    ? { lagSec: staleRelParentTiming.lagSec, staleSec: PARENT_REL_STALE_SEC, choice: staleRelParentTiming.choice, rawTiming: staleRelParentTiming.rawTiming }
    : null;
  const rawTiming = answers.event_timing?.choice || 'unknown';
  // J1.91/C154：event_timing 题删 expected_within_30d / expected_beyond_30d——
  // 旧行/旧缓存残值归一（预期30天内→within_30d；预期超过30天→unknown）。
  const timing = (staleSourceTiming || staleParentTiming || staleRelParentTiming) ? 'older'
    : rawTiming === 'expected_within_30d' ? 'within_30d'
    : rawTiming === 'expected_beyond_30d' ? 'unknown'
    : rawTiming;
  // J1.71 合并：传播面/时效不再是独立计分项——单一影响力题给分（0-5）。
  // C44 IG 证据缺失锚：A 类+IG 链接+数据未抓到 且原判 <3 档 → 影响力下限 50
  // （用户裁定「下限 50 不保过线」）。C94 偏好锚并入 web3FitAnchored（下限 50）。
  const instagramSpreadAnchorActive = category === 'A' && instagramLinked === true
    && instagramInfoFetched !== true && influenceScore < 3;
  const web3FitSpreadAnchorActive = false;
  const influenceFloor = (() => {
    let floor = 0;
    if (tierAnchored) floor = Math.max(floor, 40);              // 发布者指代锚 → A 档等效
    if (web3FitAnchored) floor = Math.max(floor, 50);            // C94 偏好锚（下限 50）
    if (instagramSpreadAnchorActive) floor = Math.max(floor, 50); // C44 IG 证据缺失（下限 50）
    return floor > 0 ? floor : null;
  })();
  // 三条时效 override（C75/C102/C103）合并为影响力扣分（等价旧时效项清零 ≈ -18）
  const timingPenaltyActive = !!(staleSourceTiming || staleParentTiming || staleRelParentTiming);
  const blockChoice = blockAnswers(answers)?.choice || 'none';
  // C114b（C181b，RichardTeng 0x007f5ddb…7777 案）：C114 图证豁免收窄——图证豁免的
  // 假设是「图就是内容」（DND 案图=梗图本体）；image_depicts_name 明确 decorative
  // （≥0.5）=装饰图与币名无关，不构成内容 → 豁免失效，empty_content 照拦。答案
  // 缺失/未问/unclear/depicts_name → 照旧豁免（fail-open 与 C114 原方向一致，
  // 存量历史行零翻转；条件题与 imageEvidence 同源、无图不问=天然不触发）
  const depictAns = answers.image_depicts_name;
  const imgDecorative = depictAns?.choice === 'decorative' && (depictAns?.probabilities?.decorative ?? 0) >= 0.5;
  const blockProb = blockAnswers(answers)?.probabilities?.[blockChoice];
  // 原 prompt 语义是"命中任一阻断条件即阻断"（二值）。Choice 摊成 10 路分布后
  // 9 个阻断项共享概率质量，argmax≠none 过易触发（dry-run 实证：P=0.43 即阻断）。
  // 忠实转译：P(none)≥0.5 才视为无阻断。
  const noneProb = blockAnswers(answers)?.probabilities?.none ?? 0;
  // C244 观察题（trivial 拦截位退役后信号续采）：独立观察题答案只读作审计，
  // blockAnswers 不读该键=天然不参与拦截/评分；旧行无该键 → null（fail-open 观察）
  const trivialProbe = answers.bsc_meme_user_think_event_too_trivial_for_meme ?? null;
  // （J1.102/C171：event_influence/massiveInfluenceCarrierExempt/carrierWouldBlock
  //  随载体门整轴退役删除——历史行审计键 eventInfluence/subjectCarrier* 保留展示）
  // C159（2026-10-21）：empty_content 概率质量单独保留。J1.95 把「短句点名具体
  // meme/实体」从空洞里排除后，DND 这类「纯缩写+表情+配图」票的 empty vs none
  // 会变成 0.43/0.47 掷骰；C114 的图证载体豁免原本只在 blockChoice=empty_content
  // 时触发，argmax 翻到 none 就会把载体门重新打开。近 tie 且图证在场时，仍按
  // 「图就是内容」处理（C114 语义），不因 argmax 抖动改变载体门结论。
  const emptyContentMass = blockAnswers(answers)?.probabilities?.event_empty_content ?? 0;
  // bsc_meme_user_name_entity_acceptance（J1.10 阻断位已随 C108 退役）：choice/概率保留纯观察落库
  // （Jev 原判可追溯；拦截责任在 web3UserAcceptabilityBlock——题概率另喂 C88 五腿/骑乘改道）
  const nameEntityAcceptance = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.choice || null;
  const nameEntityAcceptanceProb = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.[nameEntityAcceptance] ?? null;
  // J1.26 nrNotableExempt 审计随 nr 阻断位退役删除（notable 是否抬过阻断门槛已
  // 无判定可影响；历史行键保留展示）

  const stage1DataToSave = {
    category,
    ...baseFields,
    prompt: promptMetaFull, // 覆盖 baseFields 的摘要版：stage1 是完整 prompt 的落库位
    parsed_output: {
      pass: true,
      eventClassification: category ? { primaryCategory: category } : null,
      eventDescription: null, // Jev 不生成文本，叙事细节由 details 概率承载
      jev: {
        tweetType: tweetClassification?.type || null,
        // C75 审计标记：叙事源头陈旧 override 命中详情（direct_tweet 主推 lag/窗/
        // Jev 原判档可追溯；null=未命中——形态不符/窗内/锚或主推时间缺失）
        staleSourceOverride,
        // C102 审计标记：借壳语料父推源头窗命中详情（binanceCorpus 父推 lag/24h 窗/
        // Jev 原判档可追溯；null=未命中——非借壳语料/窗内/锚或父推时间缺失）
        staleParentOverride,
        staleRelParentOverride,
        // J1.137/C240 审计标记：发行方自发宣告票时效 override 豁免命中
        // （issuerSelfLaunch 检出→C75/C103 不打，时效交题面持续运动锚软评；
        // null=未命中/未检出零侵入）
        issuerTimingExempt: issuerTimingExempt ? true : null,
        jevImpactTier: tier,
        effectiveImpactTier: effTier,
        effectiveTiming: timing,
        blockChoice,
        // J1.17 审计标记：category 被代码端 cashtag 判据改写为 W（原 Jev choice 见
        // event_category probabilities），落库行可追溯改道来源；C96 F→E 改道同位
        // （'f_recap_e'——news_recap 改道 E，Jev 原 choice=F 可追溯）
        categoryForced: cashtagForced ? 'cashtag_w' : (recapForced ? 'f_recap_e' : null),
        cashtagMatched: cashtagHit?.cashtag ?? null,
        // C96 审计标记：Web3 用户接纳度恒落（J1.37 起原名 name_form；J1.53
        // C122 题键断代 → web3_user_name_acceptability，旧缓存行双键读；命中
        // web3UserAcceptabilityBlock 拦截时 stage2 jev.web3UserAcceptabilityBlock 落详情）
        web3UserAcceptability: web3UserAcceptabilityChoice(answers) ?? null,
        // C96 审计标记：发现 vs 转述恒落（J1.37 event_finding_vs_recap 题，旧缓存行 →
        // null——非 F 类也落纯观察，改道只消费 F+news_recap 组合）
        findingVsRecap: answers.event_finding_vs_recap?.choice ?? null,
        // J1.18 审计标记：发布者指代门命中详情（判据/豁免可追溯，Jev 原判 tier
        // 保留在 magnitudeTier 键不受锚定影响）
        publisherProxy: pubProxy ? { domain: pubProxy.domain, followers: pubProxy.followers } : null,
        publisherProxyActive: pubProxyActive || null,
        // C97 审计标记：币安地域子账号量级锚命中详情（handle/粉丝数可追溯；
        // null=未命中——全球号/无借壳语料/非 binance 前缀源/handle 缺失；
        // 原判档在 magnitudeTier 键不受锚影响）
        regionalSubAccount: binanceRegional && binanceCorpus
          ? { handle: binanceRegional.handle, followers: binanceRegional.followers } : null,
        anchoredTier: tierAnchored ? 'A' : null,
        // J1.23 审计标记：A/B 类（C94 起 B 类同享）+ bsc_meme_user_event_fit strong_fit≥0.5 的
        // 偏好量级锚（Jev 原判 tier 保留在 magnitudeTier 键不受锚定影响）
        web3FitAnchoredTier: web3FitAnchored ? 'B' : null,
        web3FitStrongPAnchored: web3FitAnchored ? web3FitStrongP : null,
        // J1.26 nrNotableExempt 审计键随 C108 nr 阻断位退役（历史行键保留展示）
        probabilities: {
          event_category: answers.event_category?.probabilities,
          // J1.110 键名断代新行落 web3_user_event_impact、J1.112/C183 再断代新行落
          // bsc_meme_user_event_impact（旧键 web3_user_event_impact/event_quality_veto/
          // event_token_block_reason 历史行保留展示；前端多键读）
          bsc_meme_user_event_impact: blockAnswers(answers)?.probabilities,
          bsc_meme_user_name_entity_acceptance: q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities,
          bsc_meme_user_event_fit: q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities,
          event_subject_entity: answers.event_subject_entity?.probabilities,
        },
      },
    },
  };

  // ── Stage2：阻断 + 事件分 ──────────────────────────────────────────
  const isW = category === 'W';
  // J1.56（C126）：骑乘改道（C8 rideDetourMass）退役——低影响力实体（自己的或
  // 他人的）在新实体题里统一落 unknown，由 nameEntityLowBlock 直接拦；W 数学
  // 路径只保留 W 类原生与 cashtag 改道。
  let eventScoreBlocked = false;
  let gateBlockReason = null;
  // （J1.101/C170 nhnBlock 随 negativeHardNewsBlock 门退役删除——历史行 audit
  //  键 negativeHardNewsMass 保留展示）
  let w3Block = null; // bsc_meme_user_event_fit 质量门信息 {label, mass}（J1.19，Web3用户偏好）
  let peBlock = null; // 契合证据门信息 {label, fitMass}（J1.83/C141；前身产品实体接纳门 J1.27/C55）
  let cpBlock = null; // 中国政治主题否决信息 {label}（J1.122/C192，fit 题 china_politics 桶）
  let shellStaleBlock = null; // 借壳语料陈旧门信息 {label, lagSec, staleSec, sources}（C250，无宣告推+全语料>30d）
  // C108：nrBlock（J1.10）/rmBlock（J1.28）/memFloorFired（C88）随名字门统一退役
  // J1.56（C126）：实体低影响力门回归——按旧 J1.10 规格吃新实体题的 unknown
  // （≥0.5，全域拦——C184b 方案一），挂在名字门之前（实体层否决先于形态层）
  // C180（2026-10-23 用户裁定「两门不再参与拦截，代码先保留」）：unknown 臂
  // （nameEntityLowBlock）与词句门（web3UserAcceptabilityBlock）退役拦截、纯观察
  // 落档。生产审计依据：286 张被拦票 89% fit 过线、关联题大量 exact_match 被
  // 越权拦——两臂把事件影响力（fit 的域）与审美/匹配（关联题的域）都吸进来了。
  // 词句门维持退役观察（C184 未推翻）。
  // J1.113/C184（2026-10-23 用户裁定）：实体题 unknown 认知度轴桶断代
  // unacceptable_type 类型轴（可乐/银行/犬种学名=类型不可 meme 化，无论著名；
  // 不评认知度——事件+关联在场时用户已知晓；new_entity 桶随之删）→
  // nameEntityTypeUnfitBlock 恢复拦截，名字轴拦截位=类型门+wrongEntityBlock
  // C184b（2026-10-23 用户裁定方案一）：去 J1.56 域限制 B/C/D/F/G/W 全域拦——
  // 快狗打车案实体题已判 unacceptable_type 0.9 但 category 掷骰 E（0.32 低置信）
  // 域外 miss 放行；类型不合与事件分类正交，对齐 wrong_entity 全域
  const neBlock = nameEntityTypeUnfitBlock(answers);
  const emBlock = entityEventMismatchBlock(answers); // J1.124/C194 实体-事件影响力脱节（大 IP + 小事件）
  let weBlock = null; // 指歪拦截位信息 {label, mass}（J1.81/C139 wrong_entity 全域，C180 起名字轴唯一拦截位）
  const uaBlock = web3UserAcceptabilityBlock(answers); // {label, choice}（C189 恢复拦截：not_entity 形状 web3_user_not_acceptable 档拦；C96→C105→C107→C108→J1.81 收窄→C180 拆臂→C189 恢复，实体臂优先路由 gate 在函数内）
  let timingScore = null;
  let wTimingCapActive = false;
  let eventCompositeScore = null;
  // J1.36 E 类Web3偏好折损（C93 判据源迁移）：web3FitDampCoef=生效系数（null=未
  // 触达——非 E 类 / bsc_meme_user_event_fit 答案缺失 fail-open / fitMass≥0.5 不折），标准数学
  // 分支赋值；fitMass 恒落审计（web3FitDampMass）
  let w3fFitMass = null;
  let web3FitDampCoef = null;
  let wAppeal = null;
  let eventScoreReason = null;
  // C55 币安豁免审计：仅在该豁免实际改变门判定时落键（币安语料 + 无豁免时
  // 门会拦 = 豁免救票形状），命中才落键模式（J1.83 起门=
  // web3FitMassBlock，豁免语义不变）
  const peBinanceExempt = binanceCorpus
    && web3FitMassBlock(answers, { pubProxyActive, isW }) != null
    ? true : null;
  // J1.87（C145）：rcpPlatformExempt/rcpArgmaxWouldBlock 随 routine 桶退役删除。
  // J1.88（C150）：event_institution_routine 桶退役，平台官方源 argmax 豁免子句
  // 一并删除（platformOfficial 仍用于 web3FitMassBlock 豁免）。

  // ── Stage3 豁免判定前移（C86 D-1，2026-10-17 用户裁定「豁免应贯穿」）──
  // J1.30 名图一致豁免原本定义在 Stage3 段（只豁 Stage3 截断），
  // 但 Stage2 量级门在门链中先于 Stage3 执行——豁免票若 tier D/E（J1.30 可达）或
  // 事件分<60 会在到达豁免语义前被量级门拦下 = 遗漏。豁免判定是纯函数（依赖
  // answers/timing/effTier/relevanceFrom/context，全部在上方已就绪），整块前移到
  // 门链之前；豁免本体条件一字不动（J1.24 戏谑豁免已随 J1.103/C172 品牌劫持轴
  // 整体退役——该段历史注释见 git）。W 数学分支 pass 线刻意不豁免（W 有自己的
  // C42 豁免机制与 cashtag 改道拦截语义，量级门不属于 W 数学）
  const relevance = relevanceFrom(answers);
  // 品牌劫持轴已废（J1.103/C172，用户裁定「品牌劫持本质是事件/代币关系层面的，
  // 如果要放也是放到 bsc_meme_user_name_event_acceptance，而该题已站在用户视角判断，
  // 品牌劫持可以删掉」）：brandMismatchP/punExempt（J1.24 戏谑豁免）整链删除——
  // J1.24 豁免的前提即 brandMismatchP≥0.5，桶删后恒 0 随死；其豁免功能由
  // J1.92 正确评分承接（真蹭名票 unacceptable → relevance 低分 → 关联≤10 截断
  // 自然拦，不再需要「弱字面关联+强语境关联」的豁免通道）。旧缓存行残留
  // brand_mismatch 概率键 mapper 不读。

  // J1.30 名图一致豁免（C64 巴巴鸡案 0x1ea2152c…7777，2026-10-14 用户裁定「如果
  // 名字是一只鸡，图片也是一只鸡，恐怕认为这俩有关联就好了，因为给的信息可能很难
  // 判断」）：配图与币名视觉一致时豁免 Stage3 关联≤10 截断——弱字面关联的根源常
  // 是证据缺失（本案梗名「巴巴鸡」只在配图的图内文字里，旧版图分析无转写指令且
  // maxTokens 截断，Jev 只剩「名字含鸡+图是鸡形角色」弱证据判 cultural 5 分），
  // 配图与名字同类视觉主体是更直接的一手关联证据。三门全中才豁免（relevance 分
  // 照常计入总分——弱字面关联的代价在分数上体现，J1.24/C59 同款计分语义）：
  //   ① 图证据（context.imageEvidence = twitterInfo.image_analysis 存在，与 C59
  //     条件①同源）且题已问（name_image_consistency 条件题与 imageEvidence 同源，
  //     答案缺失 → nicMatchP=0 → 不豁免——旧缓存行/无图票 fail-closed 零影响）
  //   ② same_entity+same_visual_category 合并质量 ≥0.5（合并对抗跨 run 抖动，
  //     nameReferentBlock 同思路；阈值与阻断侧惯例一致）
  //   ③ 0 < relevance ≤ 10（只救会被本截断拦的票；纯零关联 none 0 分不救，
  //     与 C59 条件②同——图再像也救不了与事件毫无关系的名字）
  // （原 punExempt 并存臂已随 J1.103/C172 品牌劫持轴退役；C83 起全语料走标准
  //   路径，superIP 语料票同样可获豁免；快车道时代的 C59 meme≥3 门随通道删除，
  //   意图由本门+J1.28 覆盖）
  const nicProbs = answers.name_image_consistency?.probabilities ?? {};
  const nicMatchP = (nicProbs.same_entity ?? 0) + (nicProbs.same_visual_category ?? 0);
  // C118 演绎臂（DND 案）：配图在演绎名字含义=币名↔叙事的关联证据。J1.102/C171
  // 用户裁定「演绎关系是事/币关联的一个维度」——载体门退役后本臂从载体豁免迁入
  // J1.30 关联豁免第二臂（概念名/缩写票 nicMatch 两档天然吃不到：DND vs 猫
  // unrelated 0.85 但猫拉窗帘正是「别打扰」的画面演绎）；答案缺失/未问 → 0
  // 只剩 nicMatch 臂（旧缓存行/无图票 fail-closed 零影响）
  const depictP = answers.image_depicts_name?.probabilities?.depicts_name ?? 0;
  const imgNameExempt = !!context.imageEvidence && (nicMatchP >= 0.5 || depictP >= 0.5)
    && relevance.score > 0 && relevance.score <= 10;
  // （J1.102/C171：carrierNature（J1.100 第四臂）/imgCarrierOverride（C109 覆盖）/
  //  emotionalImpactCarrierExempt（C160）/emptyContentImgLike（C159 近 tie 臂）四块
  //  载体豁免计算随载体门整轴退役删除；event_empty_content 的图证/作者豁免
  //  （C114/J1.58）保留——那是 block 门豁免非载体门豁免）

  // C88 超级IP事件口号票五腿救援谓词（2026-10-18 CZ 出书簇用户裁定：暗号資産の
  // 覹者 0x926c…7777 11.8x 毕业被 rcp argmax 臂拦死、BI 0x3891…7777 4.86x 被
  // J1.29 拦死——「找角度借热点事件发币本身没问题，判据=发币形态/事件量级/币的
  // 口号性」，Jev 已把信号全判对、门不消费）。五腿全中=名字指代超级IP ∧ 关联腿
  // 含引申（直接 exact/translation 天然满足；引申=正向质量 exact+translation+
  // abbreviation+semantic+cultural ≥0.3 且 none<0.5——「BI 应该算是引申关联」
  // 2026-10-18 裁定，币名→超级IP→事件链成立即算关联，none 占优=链断不救）∧
  // 口号性 mem≥2（2 分=有玩味点及格线，与地板臂 <2 构成完整分离轴）∧ 事件新鲜
  // ∧ web3 买家共鸣。不送分：豁免只翻门，分数照算（J1.24/J1.30/C86 D-1 先例）；
  // 刻意不豁 nhn/w3/pe/nr/rm/quality 门/D-E 量级臂/W 数学
  const FRESH_TIMING_C88 = new Set(['within_7d', 'within_30d', 'expected_within_30d']);
  // J1.56（C126）：第一腿改吃新实体题的 accepted 概率；作者原话票（币名逐字
  // 出自语料作者主推文本 ∧ 作者在册）由代码侧事实 authorUtterance 补位——
  // 「super_ip 本来就该使用语料作者身份」，但**不要求 Jev 在实体题里升档**
  // （问候语如实 no_entity，作者身份改由代码事实表达）。audit 键
  // corpus_author_identity 与 authorUtterance 双落，可追溯补位来源。
  const entityAcceptedProb = q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.accepted ?? 0;
  const authorUtterance = !!context.authorUtterance;
  const relMassC88 = q(answers, 'bsc_meme_user_name_event_acceptance', 'web3_user_name_event_acceptance')?.probabilities ?? answers.name_event_relevance?.probabilities ?? {};
  // J1.43（C109）融合桶名并入正向质量求和（semantic_clear/weak=cultural_rich/thin
  // 拆分自旧 semantic/cultural 单桶）；旧桶名保留在求和里防回放工具旧形状
  const relPositiveMass = (relMassC88.exact_match ?? 0) + (relMassC88.translation_match ?? 0)
    + (relMassC88.abbreviation_alias ?? 0) + (relMassC88.semantic ?? 0) + (relMassC88.cultural ?? 0)
    + (relMassC88.semantic_clear ?? 0) + (relMassC88.semantic_weak ?? 0)
    + (relMassC88.cultural_rich ?? 0) + (relMassC88.cultural_thin ?? 0);
  const relNoneMass = relMassC88.none ?? 1;
  // J1.61：mem≥2 腿随 name_entity_memeability 题删除——名字形态/玩味责任由
  // bsc_meme_user_name_acceptability 单点承担（C88 只做「实体口号票」的四腿判定）
  // （J1.81/C139 famousEntity 变量随载体门整轴退役删除——原消费=著名免形象资格
  //  早退+subjectCarrierFamousExempt 审计；C88 五腿直接判 entityAcceptedProb）
  const recognizedEntitySlogan = (entityAcceptedProb >= 0.5 || authorUtterance)
    && relPositiveMass >= 0.3 && relNoneMass < 0.5
    && FRESH_TIMING_C88.has(timing) && web3FitStrongP >= 0.5;

  // C86 D-1：量级门豁免聚合标记（magExemptTags=救援标注与审计用）；C88 实体
  // 口号票并入聚合（事件分<60 臂放行——BI 同形状弱传播票由总分承担量级代价）
  const magExempt = imgNameExempt || recognizedEntitySlogan;
  const magExemptTags = [imgNameExempt ? 'J1.30名图' : null,
    recognizedEntitySlogan ? 'C88实体口号' : null]
    .filter(Boolean).join('+');

  // C173 蓝筹去重新陈述豁免（2026-10-22 用户裁定，「4」案 0x972e6c99…7777：CZ 本人
  // 新推直接陈述概念「A large part of the internet was encrypted by '4'」发出的票
  // name_exact 撞前蓝筹（b:0x0a43…4444，ATH $306M）不算重复——「名字一样」≠「叙事
  // 同一」，新推文陈述的新概念自带入场资格。豁免双条件（缺一即拦，边界=用户裁定
  // 「如果是一个陈述老叙事的找角度推文，显然不行」）：
  //   ① 主推=direct_tweet（新陈述形态；angle_seeking/interpretive_reply/unknown=
  //      找角度/解读复述/不确定形状照拦——_tweet-type-classifier 既有分桶）
  //   ② 语料作者在 super-ip 注册表在册（context.corpusAuthorInRegistry=作者有
  //      足够动能再点燃同名叙事；无名小号 direct_tweet 复述=无动能复制品照拦）
  // 在册巨触达作者老推被翻出的「用烂」形状不归本臂管（C104 主从结构门/C132
  // MEGA_REACH 时效层既有职责）——本臂只回答「撞名是否等于重复叙事」这一个问题，
  // 解除后票回到门链正常评估（unfit/契合门/量级门照常接管）
  const dedupNewStatement = !!(tweetClassification?.type === 'direct_tweet' && context.corpusAuthorInRegistry);

  // C242 蓝筹去重新事件豁免（2026-10-26 用户裁定，BNC 案 0x5cbc…7777：BNB Standard
  // 敲纳斯达克开市钟当天，新票 name_exact 撞前蓝筹 BNB Standard BNC 被首臂拦 low——
  // 「名字一样，但是新代币有真实新事件做背景，就不要被拦截。这也是一个基本原则。
  // 熊猫头 case 不是这个形态（熊猫头是重新发布了形象化 IP）」。豁免三条件：
  //   ① 事件同一性=新事件：bluechip_event_identity（J1.139 条件题，撞名才问）
  //      new_event ≥0.5——撞名蓝筹的主体/对象发生了新的独立事实事件，本票承载
  //      的是该新事件；同事件姐妹复制品（C121 牛来案 none 0.67+within_7d，只看
  //      ②③会误放——用户 2026-10-22 裁定该拦）与形象复刻（熊猫头）判
  //      same_event 照拦。答案缺失/旧缓存行无此题 → fail-保守照拦（零翻转）
  //   ② 事件质量第一层真值 P(none)≥0.5（bsc_meme_user_event_impact 无阻断=事件
  //      真实成立有分量；空洞口号/trivial/IP 复用/无据猜测形状不豁免照拦）
  //   ③ 事件新鲜 timing ∈ {within_7d, within_30d}（FRESH_TIMING_C88 同集——
  //      older/unknown=老叙事回收/不确定形状照拦，C173 边界「陈述老叙事的
  //      找角度推文显然不行」同源）
  // 事件同一性是叙事判断归 Jev（代码侧无可靠材料：蓝筹条目无叙事源锚、姐妹票
  // 载体推各自独立，URL/时间线判据都分不开 C121 与 BNC）。与 C173 同构：豁免
  // 只翻门，分数照算；两臂任一命中即解除撞名拦截（撞名证据照记
  // bluechipDuplicate），票回门链正常评估（unfit/契合门/量级门照常接管）
  const dedupNewEventProb = answers.bluechip_event_identity?.probabilities?.new_event ?? 0;
  const dedupNewEvent = noneProb >= 0.5 && FRESH_TIMING_C88.has(timing) && dedupNewEventProb >= 0.5;

  // J1.11 负面硬新闻质量门（事件性质层面的否决，优先于其他阻断展示）；
  // argmax 命中时下方 BLOCK_SCOPE 'all' 也能拦，此处覆盖概率过半但 argmax/noneProb
  // 边界抖动的情况（nameReferentBlock 同思路：合并质量对抗五五开抖动）
  // J1.13 常规内容产品宣传质量门同位双挂（C12 绣春刀3案，事件性质层面否决）
  // J1.19 Web3用户偏好质量门第三位同挂（C30 死亡观察员/太阳之勤案，受众口味
  // 层面否决——事件可有叙事价值但不合链上 meme 买家口味，热度再高也不该放）
  if (context.duplicateNarrative && !dedupNewStatement && !dedupNewEvent) {
    // C168 蓝筹去重门（2026-10-22 用户裁定「蓝筹需要去重，小蓝筹不需要——短期
    // 热门叙事往往会发好些个票」）：票以 name_exact 撞已验证蓝筹（b:，ATH>$1M
    // curated 库）→ 后来的票是纯复制品，入场资格否决（链首：资格问题先于内容
    // 质量评估，label 归属干净——撞蓝筹票不再被 NHN/unfit 等 label 掩盖；rule
    // 0.52「同名蓝筹废除移交叙事层」在此接棒，判据从宽口径同名升级为 curated
    // 库+exact）。twitter_exact 臂上线即撤（回归反证 9 票误拦：twitter=语料出处
    // 非票身份，借壳大 V 同源多票是常态）。证据=analyzer 侧
    // detectDuplicateNarrative 纯代码事实（quasi 姐妹票刻意不算、蓝筹本体自
    // 排除）；Jev 照跑留完整档案，评级 low；C173 新陈述豁免/C242 新事件豁免
    // 见上方判据
    eventScoreBlocked = true;
    gateBlockReason = `蓝筹去重：撞已验证蓝筹叙事（${context.duplicateNarrative.entryName}）`;
    // （J1.101/C170 原 negativeHardNewsBlock 门位——退役删除，负面事件交
    // web3UnfitBlock/web3FitMassBlock 口径层判）
  } else if ((shellStaleBlock = shellCorpusStaleBlock(twitterInfo, context.binanceSquareInfo, context.websiteInfo, tokenData))) {
    // C250 借壳语料陈旧门（2026-10-27 自由之钱案 0x2c048d9c…ffff 用户裁定）：
    // 资格层否决（部署者与叙事主体零关联零互动=抢注形状）挂蓝筹去重之后——
    // 蓝筹 curated 库证据更硬居首，本门补「首发抢注无条目可撞」的洞（C168 只
    // 拦 name_exact 撞 b: 域，自由之钱首发生效时无条目）。两腿判据/失败语义见
    // SHELL_CORPUS_STALE_SEC 头注；mapper-only，全域不限类别
    eventScoreBlocked = true;
    gateBlockReason = shellStaleBlock.label;
  } else if ((cpBlock = chinaPoliticsBlock(answers))) {
    // J1.122/C192 中国政治主题否决（2026-10-25 用户裁定）：fit 题 china_politics
    // argmax → 确定性拦（独立否决桶，不参与四档比较；不看玩味空间/无豁免）。
    // 挂位在 fit 概率门之前——主题类别否决先于概率门，label 归属更准
    eventScoreBlocked = true;
    gateBlockReason = cpBlock.label;
  } else if (!pubProxyActive && emBlock != null) {
    // J1.124/C194 实体-事件影响力脱节（大 IP + 小事件）：实体类型可接纳、但事件
    // 量级远撑不起实体（齐天大圣游乐园）。**挂位在 fit 概率门之前**（2026-10-25
    // 用户裁定「可以挪」）——资格层面的脱节先于口味概率门，label 归属更准：
    // 齐天大圣类票不再被「契合证据不足」抢先（C193 情感臂同样命中时，真实理由
    // 是实体/事件量级脱节）；pubProxy 豁免与类型门同源
    eventScoreBlocked = true;
    gateBlockReason = emBlock.label;
  } else if ((w3Block = web3UnfitBlock(answers))) {
    eventScoreBlocked = true;
    gateBlockReason = w3Block.label;
  } else if ((peBlock = web3FitMassBlock(answers, { pubProxyActive, isW, binanceCorpus, platformOfficial }))) {
    // J1.83（C141）契合证据通用门（前身=J1.27 产品实体接纳门）：strong_fit+fit
    // 合计 <0.5 → 阻断，全域不限类别（C/D 客观规模票的通用口味硬门=用户裁定
    // 补的位；产品实体票判据同前 bit 不变）。挂位在 bsc_meme_user_event_fit unfit
    // 负门之后（unfit 票先被负门拦，label 归属更准），
    // bsc_meme_user_event_impact argmax 之前（事件性质层面的否决）
    eventScoreBlocked = true;
    gateBlockReason = peBlock.label;
  } else if (blockChoice !== 'none' && noneProb < 0.5
    // J1.18 发布者指代豁免：官方域名=具体产品落地（J1.64 起 gimmick 选项已删，本注释仅存史）
    // 「无任何实质产品」的定义直接矛盾（CUE 本轮 gimmick 0.30/none 0.29 抖动即此
    // 形状——官方域名的存在本身就是反证），不拦
    // J1.88（C150）：event_institution_routine 桶退役，原 platformOfficial∧institution
    // argmax 豁免子句随之删除（机构日常不再由本题拦；platformOfficial 仍用于
    // web3FitMassBlock 豁免位）。
    // C114 图证在场豁免（event_empty_content 臂失效，DND 案 0x4dbcb10e…7777，用户裁定
    // 「选1」）：极短主推+配图/视频证据在场 → 「空洞内容」不成立——图就是内容
    // （DND 😾+猫拉窗帘视频，event_empty_content 0.36 vs none 0.31 掷骰边缘拦截；买家
    // 视角「币安发 DND 推+猫视频」是可成立的 meme 形态）。图证判据与 J1.30 名图
    // 一致豁免同源（context.imageEvidence = twitterInfo.image_analysis 存在）；
    // 无图票不触发=纯文字空洞票照拦。只翻本门：名字门/载体门/量级门照常接管
    // （DND 终局由 C97 地域子账号锚 D 档量级门拦——拦截理由干净；真·大号官方
    // 梗票不再被空洞门误伤）。同案 name_form 通用梗缩写锚=J1.47（题集侧）
    && !(blockChoice === 'event_empty_content' && !!context.imageEvidence && !imgDecorative)
    // J1.58（C126 二轮）：高影响力主体（语料作者=super-ip 注册表在册）的公开
    // 问候/表态/对实质事件的简短回应=事件素材，event_empty_content 臂不拦（用户裁定：
    // 「何一发一个问候语，在 BSC meme 币场景不是空洞行为，何况是回复实质事件」）。
    // 与 C114 图证豁免同构：只翻本门，名字/载体/量级门照常接管。
    && !(blockChoice === 'event_empty_content' && !!context.corpusAuthorInRegistry)
    && blockInScope(blockChoice, category)) {
    eventScoreBlocked = true;
    gateBlockReason = BLOCK_LABELS[blockChoice] || blockChoice;
  // J1.113/C184 实体类型接纳门恢复拦截（C180 曾退役、认知度轴判据断代为类型轴）：
  // unacceptable_type ≥0.5 域 B/C/D/F/G/W 拦 + pubProxyActive 豁免（官方域名=
  // 具体产品落地 C29，随拦截恢复）；不归一读旧 unknown——历史缓存行零翻转
  } else if (!pubProxyActive && neBlock != null) {
    eventScoreBlocked = true;
    gateBlockReason = neBlock.label;
  } else if ((weBlock = wrongEntityBlock(answers))) {
    // J1.81/C139 指歪拦截位（全域）：币名试图指向实体但指歪/指残——拼写错/不忠实
    // 呈现/版本残片（C105 版本词臂、C108 拼写臂拦截责任迁入实体轴；「日本語版」
    // 型无论类别、无论出自谁的官宣文本都拦）。C180 起名字轴唯一存留拦截位
    eventScoreBlocked = true;
    gateBlockReason = weBlock.label;
  } else if (uaBlock) {
    // C189（2026-10-24，C96 币安上电视追裁）词句门恢复拦截：用户裁定「先走实体
    // 门，然后走 phrase 门——要不被实体拒绝，要不被口号拒绝」（陈述=口号类，
    // 实体臂判 not_entity 后落词句臂）。C180 拆臂回滚——判据已由 C187 三因素
    // 重构理顺（J1.116-J1.119），实体臂优先路由 gate 在 web3UserAcceptabilityBlock
    // 内（entityChoice!=='not_entity' → null：实体票不经词句门，C180 前越权拦
    // 实体票的病灶已除）；not_entity 形状 + not_acceptable 档位拦
    eventScoreBlocked = true;
    gateBlockReason = uaBlock.label;
  // （J1.102/C171：形象载体门 scBlock 分支随门整轴退役删除——
  //  上一位=词句门 web3UserAcceptabilityBlock，下一位=量级门 D/E 档臂）
  } else if (!isW && (effTier === 'E' || effTier === 'D') && !imgNameExempt) {
    // 量级 D/E 档：主体量级不足，直接阻断（原各类 prompt 的 D/E 处理）。
    // C86 D-1 豁免贯穿：J1.30 名图一致豁免无 tier 前置（图证据+一致性质量+弱关联
    // 三门全中即可），主体量级弱但名字与配图视觉一致的票不在此拦——落入标准数学
    // 分支按影响力低档计分，弱量级代价在总分上体现（J1.24 punExempt 已随品牌劫持
    // 轴退役 J1.103/C172；其前提 effTier S/A 在本臂本就结构性不可达）
    eventScoreBlocked = true;
    gateBlockReason = `事件主体量级不足（${tier}档${regionalAnchorActive ? '→D档·币安地域子账号不借壳' : ''}）`;
  } else if (isW) {
    // W 数学（W 类原生 / J1.17 cashtag 改道共用：项目对 BSC 用户吸引力 + 时效，
    // pass 线 57）
    // J1.84（C142）：w_product_score 与 w_bsc_user_appeal 合并为单轴（吸引力 0-75）。
    // J1.91（C154 时效体系清理，2026-10-21 用户裁定「哪些机制冗余/无意义都可以删」）：
    // 删除 W 时效正向表（within_7d=25/within_30d=15/older=0）——25 分
    // 对 69.6% 的 W 票是常数偏移；W 分改为纯吸引力（0-75），pass 线 57→32
    // （=57-25，保持 fresh 通过集）；时效不再给正分，仅对「已知 older/unknown
    // 或 override 命中」做封顶 30 的 cap（与标准路径 J1.71 后同构）。
    // J1.107：题改 Choice 三桶（weak/moderate/strong）→ 分值表；旧缓存行 score
    // 形状走 legacy bandInterpolate（双形状兼容，C123 门名断代先例）
    // J1.125（C230）：键名断代 w_bsc_user_appeal → bsc_meme_user_* 家族（题面新增
    // 发布者影响力资格轴：项目方自发币须 CA 背书/发布者须有影响力，全无影响力+
    // 无地址 → weak）；J1.126 键名再调整加 web3_project 域限定。桶 id 与分值表
    // 不变，旧缓存行 q() 归一读同门
    // J1.129（C233）：桶 id 断代 low/mid/high（与评级词汇统一）；分值表双键同分
    // （weak/moderate/strong 旧 choice 直读 15/47/66），旧行重放零翻转
    const appealAnswer = q(answers, 'bsc_meme_user_web3_project_acceptance_and_impact', 'w_bsc_user_appeal');
    wAppeal = appealAnswer?.choice != null
      ? (W_APPEAL_CHOICE_SCORES[appealAnswer.choice] ?? 0)
      : bandInterpolate(appealAnswer?.score ?? 0, W_APPEAL_BANDS);
    wTimingCapActive = timingPenaltyActive || timing === 'older' || timing === 'unknown';
    eventCompositeScore = round2(wAppeal);
    if (wTimingCapActive) eventCompositeScore = Math.min(eventCompositeScore, 30);
    eventScoreBlocked = eventCompositeScore < 32;
    const wLabel = cashtagForced ? `cashtag改道W类(${cashtagHit.cashtag})` : 'W类';
    eventScoreReason = `${wLabel} BSC用户接纳度与影响力${wAppeal}${wTimingCapActive ? '·时效封顶30' : ''}=${eventCompositeScore}（pass线32）`;
    if (eventScoreBlocked) gateBlockReason = `${wLabel}总分不足（${eventCompositeScore}<32）`;
  } else {
    // J1.71：单题影响力 → 0-100 合成分（传播/时效内化；时效 override 扣分、锚为下限）
    // J1.79：事件分 = fit 质量（0-100）；锚只抬下限；旧源 override 封顶 30
    eventCompositeScore = clamp(round2(influenceBase), 0, 100);
    if (influenceFloor != null) eventCompositeScore = Math.max(eventCompositeScore, influenceFloor);
    if (timingPenaltyActive) eventCompositeScore = Math.min(eventCompositeScore, 30);
    // J1.36/J1.71 E 类Web3偏好折损判据源=bsc_meme_user_event_fit（C93）：E 类且
    // (strong_fit+fit)<0.5 → 影响力整体 ×系数（合并后不再区分 tier/spread/时效）
    const w3fProbs = q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities;
    const hasW3f = w3fProbs != null && Object.keys(w3fProbs).length > 0;
    w3fFitMass = hasW3f ? (w3fProbs.strong_fit ?? 0) + (w3fProbs.fit ?? 0) : null;
    web3FitDampCoef = category === 'E' && hasW3f && w3fFitMass < WEB3_FIT_DAMP_THRESHOLD
      ? WEB3_FIT_DAMP_COEF : null;
    const web3FitDamped = web3FitDampCoef !== null && web3FitDampCoef < 1;
    if (web3FitDamped) eventCompositeScore = round2(eventCompositeScore * web3FitDampCoef);
    // C86 D-1 豁免贯穿（事件分不足臂）：豁免票的 eventCompositeScore<60 不拦，弱量级
    // 代价照常在总分（0.6×低事件分）上体现——与豁免原本「relevance 10 分照常
    // 计入」的计分语义同款。magExemptRescuedArm=D/E 档臂被豁免放行（本分支
    // 影响力低档的票）；两臂任一被救都在 reason 落可检索标注
    const magExemptRescuedArm = magExempt && (effTier === 'E' || effTier === 'D');
    const magExemptRescuedPass = magExempt && eventCompositeScore < 60;
    const magExemptSuffix = (magExemptRescuedArm || magExemptRescuedPass)
      ? `｜量级门豁免(${magExemptTags}：${[magExemptRescuedArm ? `${effTier}档臂` : null, magExemptRescuedPass ? '事件分<60臂' : null].filter(Boolean).join('与')}不拦，弱量级代价在总分)`
      : '';
    eventScoreBlocked = eventCompositeScore < 60 && !magExempt;
    eventScoreReason = `Web3口味契合${Math.round(likedMass * 100)}%(strong ${Math.round(fitStrongForScore * 100)}%+fit ${Math.round(fitForScore * 100)}%)→${eventCompositeScore}${effTier !== tier ? `(${tier}档→${effTier}档锚)` : `(${effTier}档)`}${tierAnchored ? `·发布者指代锚` : ''}${web3FitAnchored ? `·Web3偏好锚(strong_fit ${Math.round(web3FitStrongP * 100)}%)` : ''}${instagramSpreadAnchorActive ? '·IG证据缺失下限' : ''}${timingPenaltyActive ? '·旧源封顶30' : ''}${web3FitDamped ? `｜Web3偏好折损×${web3FitDampCoef}(bsc_meme_user_event_fit契合${Math.round(w3fFitMass * 100)}%<50)` : ''}（pass线60）${magExemptSuffix}`;
    if (eventScoreBlocked) gateBlockReason = `事件分不足（${eventCompositeScore}<60）`;
  }

  const stage2DataToSave = {
    category: eventScoreBlocked ? 'low' : (isW ? 'W' : category),
    ...baseFields,
    parsed_output: {
      pass: !eventScoreBlocked,
      blockReason: eventScoreBlocked ? gateBlockReason : null,
      scoringResult: {
        category: isW ? 'W' : category,
        eventCompositeScore,
        influenceScore: isW ? null : influenceScore,
        influenceTier: isW ? null : effTier,
        influenceFloor: isW ? null : influenceFloor,
        timingPenalty: (isW ? wTimingCapActive : timingPenaltyActive) ? 30 : null,
        timingScore: null,
        // J1.84（C142）：wProductScore 退役（W 双轴合并单轴）；历史行保留旧键展示
        wAppealScore: isW ? wAppeal : null,
      },
      reason: eventScoreReason,
      jev: {
        jevImpactTier: tier,
        effectiveImpactTier: effTier,
        blockChoice,
        blockChoiceProbability: blockProb ?? null,
        // C244 观察键（恒落，emptyContentMass 同款）：trivial 拆出退役后判据信号
        // 续采——观察题 choice + P(too_trivial)，只观察不参与任何门；深度校准后
        // 恢复拦截须用户裁定
        trivialProbeChoice: trivialProbe?.choice ?? null,
        trivialProbeMass: trivialProbe ? round2(trivialProbe.probabilities?.too_trivial ?? 0) : null,
        // C168 审计标记：蓝筹去重门命中详情（命中才落，subjectCarrierBlock 同款
        // 模式；证据来自 analyzer 侧 detectDuplicateNarrative——撞了哪条蓝筹、
        // 哪级规则可追溯）
        bluechipDuplicate: context.duplicateNarrative ? {
          rule: context.duplicateNarrative.rule,
          entry: context.duplicateNarrative.entryName,
          entryId: context.duplicateNarrative.entryId,
          matchedOn: context.duplicateNarrative.matchedOn,
        } : null,
        // C173 审计标记：蓝筹去重新陈述豁免命中（命中才落，emptyContentImgOverride
        // 同款模式；撞名证据照记在 bluechipDuplicate——豁免理由与撞名事实各自可
        // 追溯，豁免票后续门链的拦截位不再被去重 label 掩盖）
        bluechipDedupNewStatement: (context.duplicateNarrative && dedupNewStatement)
          ? { tweetType: tweetClassification?.type ?? null }
          : null,
        // C242 审计标记：蓝筹去重新事件豁免命中（命中才落，bluechipDedupNewStatement
        // 同款模式；newEventProb/noneProb/timing 三判据留痕——豁免票后续门链的拦截
        // 位不再被去重 label 掩盖）
        bluechipDedupNewEvent: (context.duplicateNarrative && dedupNewEvent)
          ? { newEventProb: round2(dedupNewEventProb), noneProb: round2(noneProb), timing }
          : null,
        // C159 观察键（用户追加担忧：短句点名 meme 的锚可能被虚假叙事利用）：
        // 恒落 empty_content 概率质量，后续按买点结果回看「蹭名无实质事件」票；
        // 只观察不参与任何门。
        emptyContentMass: round2(emptyContentMass),
        // C114 审计标记：图证在场 event_empty_content 臂失效（block 门豁免；命中才落
        // ——被覆盖的 event_empty_content 概率面可追溯，DND 案形状。空图证票不落键
        // =event_empty_content 照拦零歧义）
        emptyContentImgOverride: (blockChoice === 'event_empty_content' && !!context.imageEvidence && !imgDecorative)
          ? { emptyP: round2(blockProb ?? 0), noneP: round2(noneProb) } : null,
        // J1.58 审计：作者在册豁免 event_empty_content 臂（命中才落，可追溯被覆盖的
        // event_empty_content 概率面；与图证豁免同构）
        emptyContentAuthorOverride: (blockChoice === 'event_empty_content' && !!context.corpusAuthorInRegistry)
          ? { emptyP: round2(blockProb ?? 0), noneP: round2(noneProb) } : null,
        nameEntityAcceptance,
        nameEntityAcceptanceProbability: nameEntityAcceptanceProb,
        // nameReferentBlockMass（历史键名）随 C108 nr 阻断位退役——历史行键保留展示；
        // J1.56 起本层另有 nameEntityLowBlock（unknown≥0.5，见拦截发生点审计）。
        // negativeHardNewsMass 随 J1.101/C170 nhn 门退役删除（历史行键保留展示）
        web3UnfitMass: w3Block?.mass ?? null,
        // J1.113/C184 实体类型门审计：命中才落 mass（unacceptable_type 概率），
        // 未命中 null。旧键 nameEntityLowMass（unknown 认知度轴）随桶断代停产出，
        // 历史行键保留展示
        nameEntityTypeUnfitMass: neBlock?.mass ?? null,
        nameWrongEntityMass: weBlock?.mass ?? null,
        // J1.124/C194 实体-事件影响力脱节审计：命中才落 mass（entity_event_mismatch
        // 概率），旧缓存行/未命中为 null
        nameEntityEventMismatchMass: emBlock?.mass ?? null,
        effectiveTiming: timing,
        // C44 审计标记：IG 证据缺失锚命中详情（影响力下限 50）
        instagramSpreadAnchor: instagramSpreadAnchorActive ? { fromInfluenceScore: influenceScore, floor: 50 } : null,
        // C42 世界级主体产品豁免币安交互随交互臂退役（J1.73/C134）；历史行保留
        // 该键展示，新行不再产出
        // J1.83（C141）审计标记：契合证据门命中详情（fitMass 可追溯；豁免票不落键）
        // + 币安豁免命中（C55 补充裁定，救票形状可追溯）。productEntityBlock
        // 旧键随题退役（历史行保留展示，新行不再产出）
        web3FitMassBlock: peBlock ? { fitMass: peBlock.fitMass } : null,
        productEntityBinanceExempt: peBinanceExempt,
        // J1.122（C192）审计标记：中国政治主题否决命中才落键（fit 题 china_politics
        // argmax；未命中不落=旧行形状零变化）
        chinaPoliticsBlock: cpBlock ? { choice: 'china_politics' } : null,
        // C250 审计标记：借壳语料陈旧门命中才落键（lagSec=最新语料距创建锚秒数，
        // sources=构成最新语料的源；未命中不落=旧行形状零变化）
        shellCorpusStale: shellStaleBlock
          ? { lagSec: shellStaleBlock.lagSec, staleSec: shellStaleBlock.staleSec, sources: shellStaleBlock.sources }
          : null,
        // J1.87（C145）：rcpPlatformExempt 随 routine 桶退役（历史行保留展示，新行不产出）
        // J1.61：name_entity_memeability 题已删（并入名字门）——历史行保留
        // referentMemeabilityScore 键，新行不再产出。J1.83（C141）event_subject_entity
        // 题同款退役（判据并入 bsc_meme_user_event_fit unfit 桶）——历史行保留展示
        subjectEntity: answers.event_subject_entity?.choice ?? null,
        // （J1.102/C171：subjectCarrier/subjectCarrierBlock/subjectCarrierFamous-
        //  Exempt/subjectCarrierImgOverride/subjectCarrierReferentVeto/
        //  subjectCarrierEmptyImgOverride/subjectCarrierEmotionalImpactExempt/
        //  eventInfluence/subjectCarrierMassiveInfluenceExempt/
        //  subjectCarrierAuthorOverride 审计键随载体门整轴退役——历史行键保留
        //  展示，新行不再产出；C118 演绎臂迁 J1.30 imgNameExempt 关联豁免第二臂）
        // C96 审计标记：发现 vs 转述恒落（J1.37 event_finding_vs_recap；旧缓存行 → null
        // ——阈值/口径事后校准免重跑）；改道详情在 stage1 jev.categoryForced
        // （'f_recap_e'）。与 stage1 恒落版双写：stage2 jev 段是信号页/校准脚本
        // 的消费位（referentMemeabilityScore 恒落同款先例）
        findingVsRecap: answers.event_finding_vs_recap?.choice ?? null,
        // C96/C105/C107/C108 审计标记：Web3 用户接纳度门命中才落
        // （subjectCarrierBlock 同款模式）；form=Jev 原 choice（not_meme_name=
        // J1.41+ 新判 / statement·functional_label=J1.37-J1.40 旧缓存行兼容臂，
        // 归因可分）；档位恒落在 stage1 jev.web3UserAcceptability（J1.53 断代名）。
        // C180 起纯观察落档（拦截退役，「唯一名字拦截位」移交 wrongEntityBlock）
        web3UserAcceptabilityBlock: uaBlock ? { choice: uaBlock.choice } : null,
        // C88 审计标记①：实体口号票五腿快照。恒落含 hit:false（标签零列推导消费
        // 本键：hit=true→narrativeSuperIpSlogan=1 / hit=false→0 / 键缺失（旧缓存
        // 行）→null——0/null 语义分离，nameEntityMemeabilityScore 恒落同款）。
        // J1.56：第一腿来源可分离——accepted=实体题概率，authorUtterance=作者
        // 原话代码事实（币名逐字出自主推文本∧作者在册），后者命中时 accepted
        // 可能 <0.5（问候语如实 no_entity）。
        recognizedEntitySlogan: {
          hit: recognizedEntitySlogan,
          accepted: round2(entityAcceptedProb),
          authorUtterance,
          relPositive: round2(relPositiveMass),
          relNone: round2(relNoneMass),
          timing,
          strongFit: round2(web3FitStrongP),
        },
        // C88 审计标记②：memFloorBlock 命中键随 C108 拦截位退役（历史行键保留
        // 展示；C88 五腿快照 recognizedEntitySlogan 不受影响）
        // J1.36 审计标记（C93 判据源迁移）：E 类Web3偏好折损详情。fitMass 恒落
        // （=bsc_meme_user_event_fit strong_fit+fit 概率和，J1.19 前旧缓存行无答案 → null，
        // 阈值事后校准免重跑）；系数生效（<1）才落折损详情（subjectCarrierBlock
        // 同款模式）。eventCompositeScore/事件分不足拦截由折损后值直接承载，原值可由
        // 影响力原值反解。eventResonance 档位字段随题删除退役——
        // J1.31-J1.35 历史行的该键不再产生
        web3FitDampMass: w3fFitMass,
        web3FitDamp: web3FitDampCoef !== null && web3FitDampCoef < 1
          ? { fitMass: w3fFitMass, coef: web3FitDampCoef } : null,
        probabilities: {
          event_timing: answers.event_timing?.probabilities,
          web3_user_event_spread: answers.web3_user_event_spread?.probabilities ?? answers.dimension2?.probabilities,
          // J1.84（C142）：w_product_score 概率键退役（历史行保留；mapper 不再消费）
          // J1.125/C230：题键断代（投影键名保留 w_bsc_user_appeal=审计形状不变，值归一读）
          w_bsc_user_appeal: q(answers, 'bsc_meme_user_web3_project_acceptance_and_impact', 'w_bsc_user_appeal')?.probabilities,
          bsc_meme_user_event_fit: q(answers, 'bsc_meme_user_event_fit', 'web3_user_event_fit')?.probabilities,
          event_subject_entity: answers.event_subject_entity?.probabilities,
          // （J1.102/C171：name_entity_carrier dump 键随形象轴退役删除——历史行
          //  保留展示；web3_user_name_acceptability 同段保留）
          bsc_meme_user_phrase_acceptability: q(answers, 'bsc_meme_user_phrase_acceptability', 'web3_user_phrase_acceptability')?.probabilities
            ?? answers.web3_user_name_acceptability?.probabilities ?? answers.name_form?.probabilities,
          event_finding_vs_recap: answers.event_finding_vs_recap?.probabilities,
        },
      },
    },
  };

  // ── Stage3：截断检查 + 关联/质量 ───────────────────────────────────
  // relevance/nicMatchP/imgNameExempt 已前移至 Stage2 门链
  // 之前（C86 D-1 豁免贯穿，见上方案释）；本段只留 Stage3 专属计算
  const quality = qualityFrom(answers, symbol);
  // C78 图文名不符拼写门（J1.140 图片直连改判据源；J1.141 四桶→三桶）：条件题
  // image_name_text_match（图在场∧CJK≥3 才问）one_char_diff ≥0.5 → 拦（鲸元卷
  // 案形状：图内出现与币名等长恰一位差的独立文字段——次数不构成豁免，J1.140
  // 短暂四桶期「≥2 次」判据翻车实证；币名整体在图内=exact_match 放行承接原
  // 代码③分支）；题未问（无图/非 CJK 长名/旧缓存行无答案）→ 0 不拦（fail-open
  // 与无图票同语义；detectNameImageSpellingMismatch 纯代码门已退役，防复活断言
  // 在 _test_image_name_text_gate.cjs）
  // J1.141 三桶（one_char_diff ≥0.5 拦）；Math.max 三键归一读=旧四桶缓存行
  // （repeated/once 分桶）重放零翻转——鲸元卷案图内独立「鲸元券」仅 1 处也拦
  const nameTextProbs = answers.image_name_text_match?.probabilities;
  const nameTextRejP = nameTextProbs
    ? Math.max(nameTextProbs.one_char_diff ?? 0, nameTextProbs.one_char_diff_repeated ?? 0, nameTextProbs.one_char_diff_once ?? 0)
    : 0;
  const spellingMismatch = nameTextRejP >= 0.5
    ? { hit: true, bucket: 'one_char_diff', prob: nameTextRejP }
    : { hit: false, bucket: null, prob: null };

  let stage3Blocked = false;
  let stage3BlockReason = null;
  // C88 超级IP口号票豁免贯穿 Stage3 关联≤10 臂（原品牌劫持臂已随 J1.103/C172
  // 品牌劫持轴退役整删：名字-事件关系归 bsc_meme_user_name_event_acceptance 用户
  // 视角，真蹭名票 unacceptable → relevance 低分在本段自然拦）
  if (spellingMismatch.hit) {
    stage3Blocked = true;
    stage3BlockReason = `图文名不符（图内出现与币名一位之差的写法（Jev 判 ${spellingMismatch.prob.toFixed(2)}）≠币名，无背景拼写错误）`;
  } else if (relevance.score <= 10 && !imgNameExempt && !recognizedEntitySlogan) {
    stage3Blocked = true;
    stage3BlockReason = `关联性不足（${relevance.score}分/${relevance.type}）`;
  } else if (quality.total <= 4) {
    stage3Blocked = true;
    stage3BlockReason = `代币质量过低（${quality.total}分）`;
  }

  let aggregatedCategory;
  let aggregatedTotalScore = null;
  let weightedEventScore = null;

  if (eventScoreBlocked || stage3Blocked) {
    aggregatedCategory = 'low';
  } else {
    weightedEventScore = round2(eventCompositeScore * 0.6);
    aggregatedTotalScore = round2(weightedEventScore + relevance.score + quality.total);
    aggregatedCategory = aggregatedTotalScore >= 70 ? 'high'
      : aggregatedTotalScore >= 50 ? 'mid' : 'low';
  }

  // J1.43（C109）reason 模板适配：融合形状 relevance 无 levelIdx（不落 lv 段）、
  // token_name_quality 单题落「长+名」（legacy 双题形状保持「长+拼+合」原样）
  const relPart = `${relevance.type}${relevance.levelIdx != null ? `/lv${relevance.levelIdx}` : ''}`;
  const qualityPart = quality.name != null
    ? `长${quality.length}+名${quality.name}`
    : `长${quality.length}+拼${quality.spelling}+合${quality.reasonability}`;

  const finalReason = eventScoreBlocked
    ? `阻断:${gateBlockReason}｜P=${w3Block?.mass ?? (blockProb ?? '-')}`
    : stage3Blocked
      ? `截断:${stage3BlockReason}`
      : `${imgNameExempt ? '名图一致豁免(J1.30)｜' : ''}${recognizedEntitySlogan ? '超级IP口号票豁免(C88)｜' : ''}${instagramSpreadAnchorActive ? 'IG影响力豁免(C44)｜' : ''}${web3FitSpreadAnchorActive ? 'Web3偏好传播豁免(C94)｜' : ''}事件分${weightedEventScore}(${eventCompositeScore}×0.6)｜关联${relevance.score}(${relPart})｜质量${quality.total}(${qualityPart})｜总分${aggregatedTotalScore}→${aggregatedCategory}`;

  const stage3DataToSave = eventScoreBlocked
    ? { __clear: true }  // 对齐原流程：Stage2 未通过 → Stage3 被跳过，清旧数据
    : {
        category: aggregatedCategory,
        ...baseFields,
        parsed_output: {
          pass: !stage3Blocked,
          blockReason: stage3Blocked ? stage3BlockReason : null,
          relevanceScore: relevance.score,
          qualityScore: quality.total,
          total_score: aggregatedTotalScore,
          category_agg: aggregatedCategory,
          breakdown: {
            length: quality.length,
            spelling: quality.spelling,
            reasonability: quality.reasonability,
            // J1.43（C109）token_name_quality 单题合并子分（legacy 双题形状为 null）
            name: quality.name,
          },
          jev: {
            relevanceType: relevance.type,
            relevanceLevelIdx: relevance.levelIdx,
            // （brandMismatchP/punExempt 审计键已废 J1.103/C172 品牌劫持轴退役；
            //   历史行保留展示，新行不产出）
            // J1.30 审计标记：名图一致豁免命中详情（关联档位/一致性质量可追溯，
            // J1.30 审计标记：名图一致豁免命中详情（关联档位/匹配质量可追溯，
            // 命中才落模式——未触发不落键）。J1.102/C171 起 via='depicts' 臂=
            // C118 演绎臂迁入（matchP=0 且 depictP≥0.5 的命中=演绎臂触发）
            imgNameExempt: imgNameExempt ? { relType: relevance.type, relScore: relevance.score, matchP: round2(nicMatchP), via: nicMatchP >= 0.5 ? 'match' : 'depicts', depictP: depictP > 0 ? round2(depictP) : null } : null,
            // （J1.102/C171：subjectCarrierImgOverride/subjectCarrierReferent-
            //  Veto/subjectCarrierAuthorOverride 三键随载体门整轴退役删除——
            //  历史行键保留展示，新行不再产出；演绎臂审计并入 imgNameExempt.via）
            // C88 审计标记：超级IP口号票豁免命中（命中才落；五腿全量在 stage2
            // jev.recognizedEntitySlogan 恒落版——stage2 拦截票本段 __clear 不落）
            recognizedEntitySloganExempt: recognizedEntitySlogan ? { accepted: round2(entityAcceptedProb), authorUtterance, timing } : null,
            // C78 图文名不符拼写门审计（命中才落：J1.140 起=条件题判据
            // {name, bucket, prob}；旧 variant 转写形状随纯代码门退役停产出）
            spellingMismatch: spellingMismatch.hit
              ? { name: String(tokenData?.name || tokenData?.raw_api_data?.name || ''), bucket: spellingMismatch.bucket, prob: spellingMismatch.prob }
              : null,
            probabilities: {
              bsc_meme_user_name_event_acceptance: q(answers, 'bsc_meme_user_name_event_acceptance', 'web3_user_name_event_acceptance')?.probabilities ?? answers.name_event_relevance?.probabilities,
              relevance_level: answers.relevance_level?.probabilities,
              // J1.85（C143）：name_brand_hijack 题已退役——品牌信号改落实体题
              // probabilities（stage1 jev.probabilities.bsc_meme_user_name_entity_acceptance
              // 已含 brand_mismatch 桶），本段不再产旧键
              // J1.30 条件题：题已问才落（无图票题集无此题， probabilities 缺省）
              ...(answers.name_image_consistency ? { name_image_consistency: answers.name_image_consistency.probabilities } : {}),
              ...(answers.image_name_text_match ? { image_name_text_match: answers.image_name_text_match.probabilities } : {}),
            },
          },
        },
      };

  const stageFinalData = {
    category: aggregatedCategory,
    totalScore: aggregatedTotalScore,
    weightedEventScore,
    relevanceScore: eventScoreBlocked ? null : relevance.score,
    qualityScore: eventScoreBlocked ? null : quality.total,
    eventWeight: 0.6,
    eventCompositeScore,
    blockReason: eventScoreBlocked ? gateBlockReason : (stage3Blocked ? stage3BlockReason : null),
  };

  const llmResult = eventScoreBlocked
    ? {
        rating: 'low',
        reason: finalReason,
        score: eventCompositeScore,
        pass: false,
        analysis_stage: 2,
      }
    : {
        rating: aggregatedCategory,
        reason: finalReason,
        score: aggregatedTotalScore,
        pass: true,
        analysis_stage: 3,
      };

  const promptType = `jev(${JEV_QUESTIONS_VERSION}/${category || '?'}类`
    + `${isW ? '-W数学' : ''})`;

  return {
    stage1DataToSave,
    stage2DataToSave,
    stage3DataToSave,
    stageFinalData,
    llmResult,
    promptType,
    jevDetails: { impactTier: tier, effectiveTiming: timing, influenceScore, relevance, quality },
  };
}

