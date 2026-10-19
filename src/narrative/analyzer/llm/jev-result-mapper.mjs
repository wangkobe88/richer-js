/**
 * Jev answers → 阶段结果映射器
 *
 * 全部确定性聚合在本文件完成（原 3 阶段管线的公式原样保留）：
 * - 量级档 S/A/B/C → 39/34/27/22（MAGNITUDE_TIER_SCORES，108 样本校准定参），D/E 档阻断
 * - 标准类 stage2Total = tierScore + dimension2(0-30) + 时效(0-20)，pass ≥ 60
 * - J1.23 Web3 偏好锚（A/B 类 + strong_fit≥0.5 → effTier 锚 B；C94 起 B 类同享
 *   dim2<18 锚 18——web3 用户喜欢是根本判据，发布主体量级无所谓）
 * - W 类独立数学：产品(0-35) + 币安交互(0-40) + 时效(0-25) = 100，pass ≥ 60
 * - 最终 = round(stage2Total×0.6, 2) + 关联分 + 质量分，≥70 high / ≥50 mid / else low
 * - Stage3 截断顺序：品牌劫持 → 无背景拼写错误 → 关联≤10 → 质量≤4
 * - reason 为代码端模板拼接（Jev 不生成文本，已裁定接受损失）
 *
 * 输出形状与 NarrativeAnalyzer 旧流程的 stageXDataToSave 完全一致（旧格式），
 * 经 buildStageSaveData 零改动转换为五列存储契约（{stage}_result/_prompt/_raw_output）。
 */

import { JEV_QUESTIONS_VERSION } from './jev-questions.mjs';
import { detectCorpusCashtag, detectPublisherProxy } from '../utils/narrative-utils.mjs';

/** 量级 6 档（与 jev-questions event_magnitude criteria 顺序一致） */
const MAGNITUDE_TIERS = ['E', 'D', 'C', 'B', 'A', 'S'];

/**
 * 主路径量级档 → 分（108 样本校准定参，2026-09-20）：
 * 按条件期望 E[旧tier分|Jev档]（S 38.8/A 33.9/B 27.3，n=91）取整；
 * C 档从期望 26.8 下调至 22——Jev 的 C 档混有旧 B/A 样本（期望被拉高），
 * 但"C 档主体难过 pass 线"是旧管线核心语义（C22+dim2均值21.5+时效15=58.5<60）。
 * D/E 档不进表：维持主体量级不足阻断。
 * （C83 起全语料走标准路径——superIP 快车道的 TIER_SCORES 预评分已随通道删除）
 */
const MAGNITUDE_TIER_SCORES = { S: 39, A: 34, B: 27, C: 22 };

/** 时效 6 档 → 分数（标准类 / W 类各自一张表，与原 prompt 逐档对齐） */
const TIMING_SCORES_STANDARD = {
  within_7d: 15, within_30d: 10, older: 0,
  expected_within_30d: 10, expected_beyond_30d: 5, unknown: 0,
};
const TIMING_SCORES_W = {
  within_7d: 25, within_30d: 15, older: 0,
  expected_within_30d: 15, expected_beyond_30d: 0, unknown: 0,
};

/** 找角度载体推文时效窗（秒）——C68 제로案（2026-10-14 用户裁定「找角度推文都是
 * 发出来后立马发币的」）：angle_seeking/interpretive_reply 语料的时效锚=载体推文
 * 发布时间（角度曝光窗口），不是叙事首次发生时间——叙事再热、载体推文过期=角度
 * 已死。C74 啾啾案（2026-10-16）后与 precheck 不再同窗：precheck 规则 2.1 已分桶
 * （非豁免桶 300s relocate 买门 / direct_tweet 豁免跳过硬拦），上游 300s 已吞主力
 * 拦截——本 override 保留作 Jev 层纵深防御，覆盖 ignoreExpired 穿透（web 重析
 * 勾选）、precheck 锚缺失跳过、存量缓存残例；本窗改不再有与 precheck 的联动义务。 */
const ANGLE_TWEET_STALE_SEC = 6 * 3600;

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

/**
 * C68 找角度时效 override 判定（纯代码，mapper-only，题集版本不动——时效分本来就
 * 是代码查表，J1.16/J1.23/J1.24 教训：分数锚定类必须代码侧）：
 * tweet_type=angle_seeking/interpretive_reply 且载体推文 lag 超 ANGLE_TWEET_STALE_SEC
 * → 返回 { lagSec, rawTiming }（调用方把 timing 归 older=0 分）；否则 null 不干预。
 * 载体时间取主推/website_tweet/quoted/retweeted 最新一条（与 precheck tweetSources
 * 同集，「任一新即活」对称）；锚=tokenCreatedAtSec||raw_api_data.created_at
 * （fetchTokenData wss_events 回退链）；任一不可得不 override（fail-open，与 precheck
 * 锚缺失跳过语义对称，不误伤数据缺失票）。分类器保证 type 命中集合时语料必为
 * tweet 型（account/community → unknown），无需再查 twitterInfo.type。
 */
function overrideAngleTiming(tweetClassification, twitterInfo, tokenData, rawTiming) {
  if (!tweetClassification
    || (tweetClassification.type !== 'angle_seeking' && tweetClassification.type !== 'interpretive_reply')) {
    return null;
  }
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!anchorSec || !twitterInfo) return null;
  // C86：载体集字段名=quoted_status（twitter-fetcher 产出键，state 组装主链同款）。
  // 原读 quoted_tweet 是幽灵字段（producer 从不写）——引用推作为「最新载体」实际
  // 永远缺席，C68「任一新即活」对引用推场景失效偏拦；与 precheck tweetSources 同集修复
  const sources = [twitterInfo, twitterInfo.website_tweet, twitterInfo.quoted_status, twitterInfo.retweeted_status];
  let latestMs = NaN;
  for (const t of sources) {
    if (!t?.created_at) continue;
    const ms = new Date(t.created_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(latestMs) || ms > latestMs) latestMs = ms;
  }
  if (!Number.isFinite(latestMs)) return null;
  const lagSec = anchorSec - latestMs / 1000;
  if (!Number.isFinite(lagSec) || lagSec <= ANGLE_TWEET_STALE_SEC) return null;
  return { lagSec: Math.round(lagSec), rawTiming: rawTiming || null };
}

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
 * rating=3 high（eventScore 45 拿满事件分）——时效三件套全盲：C74 锚主推 lag+粉豁免、
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
 * parent_relationship 的问出闸（无父推不问防幻觉作答，brand_hijack/imageConsistency
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
function overrideStaleRelParentTiming(answers, twitterInfo, tokenData, rawTiming) {
  const choice = answers?.parent_relationship?.choice;
  if (choice !== 'translation_or_repost' && choice !== 'explains_derivative') return null;
  const anchorSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!anchorSec || !twitterInfo) return null;
  let worst = null;
  for (const slot of CARRIER_SLOTS(twitterInfo)) {
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

/**
 * dimension2 校准带（108 样本远程校准定参，2026-09-20）：
 * Jev 档位与旧 LLM 维度二分几乎不相关（旧量表 P25=18/P50=22/P75=25，近似恒 20-25
 * 的宽松输出），故按分布分位匹配而非逐点拟合——Jev 档 1-4 累计占比 29%/58%/86%/100%
 * ↔ 旧分位 15.5/22.5/26/29，映射后均值 21.5 ≈ 旧均值 21.1。
 * 带语义（与 jev-questions dimension2 criteria 的六档对应）：
 * 无[0,10] / 微弱[10,20] / 小[18,26] / 中[23,28] / 强[26,30] / 极强[28,30]
 */
const DIM2_BANDS = [[0, 10], [10, 20], [18, 26], [23, 28], [26, 30], [28, 30]];
const W_PRODUCT_BANDS = [[0, 8], [9, 17], [18, 26], [27, 35]];
const W_INTERACTION_BANDS = [[0, 9], [10, 19], [20, 29], [30, 40]];
const SPELLING_BANDS = [[0, 1], [2, 3], [4, 5], [6, 7]];
const REASONABILITY_BANDS = [[0, 1], [2, 3], [4, 5]];
// J1.43（C109）token_quality 单题 band 索引 0-3 → 联合量纲 0-12
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
 * J1.43（C109）融合关联分：relevance_type 9 桶单值（吸收原 relevance_level
 * 语义）。取值对齐旧表分层：exact/translation 恒值；abbreviation 取旧五档
 * 均值 17；semantic_weak≈旧 lv0-1（8/10）、semantic_clear≈旧 lv2-4（12/15/15）
 * 取 9/13——weak 9 仍落关联截断线（≤10）内、clear 13 过线；cultural_thin≈旧
 * lv0-1（1/5）取 3、cultural_rich≈旧 lv2-4（10/14/15）取 12 过线（旧 lv2=10
 * 恰在截断线上，融合后归 rich 过线——边界移动已知，定向重析对拍覆盖）；generic
 * 取旧均值 5；none=0 而非旧均值——保住 imgNameExempt 的 relevance.score > 0
 * 锚（旧 lv0=0 同语义）。
 */
const RELEVANCE_FUSED_SCORES = {
  exact_match: 20,
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
 * block_reason 选项 → 中文标签（reason 模板用）。
 * J1.43（C109）退役两桶（182 全量 10815 行实证）：regional_event 9 次 argmax/
 * 0 次域内拦截=从未拦过票的死桶（且与 event_magnitude 的地区性/全国性范围镜头
 * 冲突）；subject_unqualified 31 次/23 次弱概率拦截（p 0.22-0.58），与 C108 后
 * name_form「无名实体」臂/event_magnitude 无名主体低档/referent_memeability
 * 0 分档三重冗余，粉丝<1万量化锚由 name_form 语义承接。题集侧桶文本删除、
 * BLOCK_SCOPE 侧显式空域退役（历史行 rating 已落库不变，重析走新题集）。
 */
const BLOCK_LABELS = {
  none: '无阻断',
  // 退役桶 label 保留（空域后不可达，防未知选项 fallback 打裸键名）
  subject_unqualified: '主体资格不足',
  regional_event: '地区性事件',
  niche_subculture: '小圈子亚文化',
  empty_content: '空洞内容',
  institution_routine: '机构日常运营',
  low_quality_derivative: '低质衍生',
  marketing_gimmick: '营销噱头',
  baseless_speculation: '无据猜测',
  ip_reuse: 'IP二次利用',
  negative_hard_news: '负面硬新闻事件',
  routine_content_product: '常规内容产品宣传',
};

/**
 * name_referent 阻断（J1.10）——**C108（2026-10-19）拦截位退役**，全档案并档：
 *
 * 案史：J1.10（2026-09-23）立门「截词/截名发币要成立，名字的主人得是超级IP」，
 * 阻断侧 minor_other（无名对象，YAYA 案=何一推文@的币安员工）+common_word（截词，
 * CONVICTION 案）；J1.15 super_ip 扩含官方口号；J1.26 notable_other 全域退出
 * （知名度梯度是错轴，移交 web3_fit unfit 负门）。
 *
 * 退役裁定（C108，用户三轮）：触发案 EARLY（CZ 回复 "you got in early" 逐字
 * 发币）被 common_word「截词（非超级IP话中词）」臂 0.96 误拦——"early" 有圈内
 * 「趁早」深意、用户侧有感知，该放行。「很多门，不如合并为『合不合适作为
 * meme 币』门，这是根本的」「名字指向实体时实体情况仍需考量（普通币安员工
 * 就不行），但 early 不是一个实体」「YAYA 就是币安员工所以不行」「用一个门
 * 涵盖多种情况」——拦截责任全部移交 notMemeNameBlock（J1.42 name_form 四分支：
 * ①指向实体——无名实体不合格 ②非实体词——圈内文化词合格/无感知句片段不合格
 * ③形态缺陷 ④无背景拼写变体）。name_referent 题保留，概率只喂评分与豁免链
 * （C88 五腿 sipProb / rideDetour / pubProxyActive），不再承载拦截。
 *
 * 术语混乱实证随案立档：本门 common_word label「截词」与 Stage3「截断:」前缀、
 * 「拼写错误」臂三连撞，EARLY 案排查时归因即错（实拦于本门而非 misspelling）。
 * 历史行 reason 中的「截词（非超级IP话中词）」「名字指向无名对象」label 展示
 * 照旧，不再新增。
 */

/**
 * 阻断选项的类别作用域（与原各类 Stage2 prompt 的阻断条件集合对齐）：
 * - A 类（形象化IP）：小圈子亚文化/IP低质复用（J1.44 起 low_quality_derivative 与
 *   ip_reuse 合一，判据同拦 A 域）
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
  empty_content: 'all',
  // J1.45（C110 扫描后裁定）扩全域：原 ['W','B'] 跨类空洞 261 行（E123/A104/
  // C75/D63…，high/mid 逃逸 25 票实买 6 票，noneP 全<0.5）——「营销噱头无实质
  // 产品」语义不分类别；pubProxy/platformOfficial 豁免仍在拦截位前置不受影响
  marketing_gimmick: 'all',
  niche_subculture: ['A'],
  ip_reuse: ['A'],
  baseless_speculation: ['G'],
  institution_routine: ['C', 'D'],
  // J1.43（C109）退役桶：显式空域（blockInScope 对未知选项按通用处理返回 true——
  // 只删键会让 legacy 形状 choice 照拦，删除无效；空数组=任何类别都不拦）。
  // 新题集已不提供这两个选项，此处只兜旧缓存行/旧 fixture 重放
  subject_unqualified: [],
  regional_event: [],
  // J1.44（C110）退役桶：low_quality_derivative 并入 ip_reuse（两桶均 A 域、判据
  // 重叠=对现有 IP/热点的低质衍生与直接复用、拦截效果等价的功能双桶合一）
  low_quality_derivative: [],
  // J1.11（2026-09-26 用户裁定，C9 bitget被盗案）：负面事故（被盗/暴雷）+纯硬新闻
  // 的事件无 meme 价值，全域拦截——事件热度高≠该放（A 档量级喂饱事件分 74.65、
  // 80.32 high 放行后 -55%）。质量门 negativeHardNewsBlock 同步双挂（argmax 五五开
  // 抖动时概率门兜底），二者任一命中即拦
  negative_hard_news: 'all',
  // J1.13（2026-09-27 用户裁定，C12 绣春刀3案）：常规内容型产品（电影/剧集/综艺/
  // 动漫/小说/游戏）的发布/上映/预告宣传无 meme 价值，全域拦截——产品知名度≠该放
  // （绣春刀3 super_ip 0.66 命中 C8 豁免 → 65.95 high 放行。裁定「即使推出了，也
  // 不能作为meme币」：官宣与否无关）。质量门 routineContentProductBlock 同步双挂，
  // 二者任一命中即拦
  routine_content_product: 'all',
};

/**
 * nameReferentBlock（J1.10 阻断函数）——C108 随拦截位退役删除，案史与裁定见
 * 上方并档注释。name_referent 题与概率保留（评分/豁免链消费），历史实现 git。
 */

/**
 * referentMemeabilityLowBlock（J1.28 mem≤1 低档门）——**C108（2026-10-19）
 * 拦截位退役**：拦截责任并入 notMemeNameBlock 分支①/②（无名实体名/无圈内
 * 感知词——「用户侧不接纳」同轴）。案史：J1.28（2026-10-08，0fed29f9 亏损票
 * 续案）「币安汽车/日产类蹭得过头根本不可能成为 meme 币的票要拦」，dry-run
 * mem≤1 拦 4 票净 -0.354；其「无名/严肃对象」票型由 J1.42 name_form 四分支
 * 承接（YAYA 币安员工花名对照锚）。referent_memeability 题保留，分数只喂
 * C88 五腿（mem≥2）与恒落审计 referentMemeabilityScore；mem∈(1,2) 的 C88
 * memFloor 拦截位同批退役（覆盖与 nf 形态判据重叠——币安上电视 mem 1.72 本
 * 就是 not_meme_name）。历史实现 git。
 */

/**
 * J1.29 形象载体门（2026-10-09 用户裁定挂门 M2，bddd3578 C/D/E 亏损票分析案）：
 * 「叙事主体没有具体的形象/梗载体」是 C/D 35 票（净 -2.85）的共同病根——叙事
 * 讲得再好（C/D 29/35 票 strong_fit≥0.9 而 winR 仅 7%），主体抓不住一个「东西」
 * （角色/动物/吉祥物/meme图）拿去玩梗，web3 用户就没有可参与的创作载体。配套
 * 新题 subject_carrier（J1.29 恒带，choice 三档：existing_entity/improvised_
 * entity/no_visual_entity），本门按类别×档位切分拦截：
 *
 * 门形状（M2，用户裁定）：C/D 类 + carrier∈{improvised_entity, no_visual_entity}
 * → 拦；E 类 + carrier=no_visual_entity → 拦；A/B/W/F/G 不碰。
 *
 * dry-run 实证（bddd3578 全 292 票标准路径 236 票，scripts/narrative/
 * _carrier-dryrun-bddd.mjs，state 保真复用线上 stage1_prompt.state）：全域判别力
 * existing 140 票 winR 39% 净 +11.69 / improvised 24 票 winR 8% 净 -1.11 /
 * no_visual 72 票 winR 24% 净 -3.78；冒烟 12/12 方向全对。虚拟收益：M2 过滤后
 * 实验净额 +21.90→+26.23 BNB（净效应 +4.33，winR 35%→41%）。
 *
 * 边界裁定依据：①E+improvised 有肉（6 票 +1.19，Ants +1.42「Anthropic 员工
 * 自称蚂蚁」型戏谑票）——E 类对脑补形象的容忍度高于 C/D（热点梗可自带传播），
 * 故 E 只拦 no_visual（M3 E 全拦净效应反而 -1.19）；②A 类（形象 IP）不进门——
 * 类别本身就是形象载体判定，量级门已把关；③W/F/G 样本内无此病根信号不碰。
 *
 * （C83 起全语料走标准路径，subject_carrier 对 superIP 语料票同样生效）；
 * 56 票 prestage/superIP 历史无 stage1 不适用。
 * 答案缺失（旧缓存行/旧题集手写 fixture）→ 不拦——生产链 JevClient.ask 对缺
 * 答案 id 直接 throw，缺失形状只在旧缓存/fixture；窗口回测要触发门须先失效
 * 缓存（scripts/narrative/invalidate-carrier-window.cjs，照 J1.28 模式）。
 */
const CARRIER_LABELS = {
  improvised_entity: '脑补形象',
  no_visual_entity: '无形象实体',
};

function subjectCarrierBlock(answers, category, opts) {
  const carrier = answers?.subject_carrier?.choice;
  if (!carrier) return null;
  // C88 超级IP口号票豁免（2026-10-18 CZ 出书簇裁定）：五腿全中的票不拦——真人
  // 人物/机构票在 carrier 体系天然映射 no_visual/improvised（暗号資産の覹者
  // no_visual 0.92 / BI improvised 0.62 均此位拦死），「抓不住形象载体」由口号性
  // 腿 mem≥2 与关联腿代偿（名字本身就是玩梗载体）
  if (opts?.superIpSlogan) return null;
  // C109 图证载体覆盖（M1，交易猫 0xc929…7777 案）：同一次 Jev 调用里
  // name_image_consistency 的事实答案（币安发猫图、币名「交易猫」same_entity
  // 0.73/conf 0.59）证明指代对象有可视化载体时，载体题的低置信掷硬币答案
  // （no_visual conf 仅 0.09——主体漂移到新闻发布方所致）不再单独定生死：
  // imageEvidence ∧ nicMatchP≥0.5 → 本门豁免（高置信事实证据覆盖低置信载体
  // 判断；终评级仍交全链其余门）。暗号資産の覹者(0.92)/BI(0.62) 校准不动：
  // 前者本就 C88 五腿豁免，后者无图证不触发本覆盖。
  if (opts?.imgCarrierOverride) return null;
  if (category === 'C' || category === 'D') {
    if (carrier === 'improvised_entity' || carrier === 'no_visual_entity') {
      return { label: `叙事主体无形象载体（${CARRIER_LABELS[carrier]}）`, carrier };
    }
  } else if (category === 'E' && carrier === 'no_visual_entity') {
    return { label: `叙事主体无形象载体（${CARRIER_LABELS[carrier]}）`, carrier };
  }
  return null;
}

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
 * ④无背景拼写变体（自 block_misspelling 探针并入；图文对照 C78 代码门
 *   detectNameImageSpellingMismatch 保留独立兜底）。
 *
 * 旧 choice 兼容映射（断代 bit 兼容红线）：J1.37-J1.40 缓存行 choice=
 * statement/functional_label → 继续拦（语义等价 not_meme_name）；entity_phrase
 * → 放行（语义等价 meme_name）；unclear/缺失 → fail-open。存量行行为与断代前
 * 逐位一致（缓存行不重放 mapper，重析票按新门判）。
 *
 * J1.50（C119 用户视角统一）键名断代：name_form 三态改名
 * web3_user_acceptable / web3_user_not_acceptable / unclear（问法收敛「web3
 * 用户能否接纳这个名字作为 meme 币的名字」）。本 Set 收新拦键
 * web3_user_not_acceptable + 全部旧拦键（not_meme_name/statement/
 * functional_label 存量缓存行照拦）；positive 侧结构不变——Set 外即放行
 * （web3_user_acceptable/meme_name/entity_phrase/unclear/缺失 fail-open），
 * 正臂无需枚举。
 *
 * C88 superIpSlogan 五腿刻意不豁（继承）：五腿前提是口号票（名字=口号=可
 * 传播符号），陈述句/版本词名字连口号都不是。全域（不限类别）；无概率 mass
 * （choice 档位门）；unclear/答案缺失 fail-open 不拦（生产链 JevClient 缺
 * 答案 throw）。
 */
const NOT_MEME_NAME_CHOICES = new Set([
  'web3_user_not_acceptable', // J1.50 新键（C119）
  'not_meme_name', 'statement', 'functional_label', // J1.37-J1.48 存量行兼容
]);

function notMemeNameBlock(answers) {
  const choice = answers?.name_form?.choice;
  if (!NOT_MEME_NAME_CHOICES.has(choice)) return null;
  return { label: '币名不适合作为 meme 符号（名字门）', form: choice };
}

/**
 * C105 功能标注词门（J1.40）已随 C107 收敛并入上方 notMemeNameBlock：
 * functional_label 旧 choice 经 NOT_MEME_NAME_CHOICES 兼容映射继续拦
 * （案史与论证见 notMemeNameBlock 注释）。
 */

/**
 * J1.31 E 类情绪感染力折损系数（2026-10-16 用户裁定，C80 蝙蝠侠摇案
 * 0x4547dae7757fb4043e034d27ed02dfabe9aa7777：「蝙蝠侠式蹦迪」抖音舞蹈现象票，
 * Jev E 类 0.99 + B 档量级 0.97 → 事件分 27+28.68+15=70.68 过线 high 放行，
 * 实测 18 分钟 54 tick 冷盘、买入 31s -12.4%。裁定原话「对时事现象热度，其实也
 * 应该度量事件对Web3用户的情绪感染力。这个事件没啥情绪感染力，我不会被它有任何
 * 触动，也并非一个大时事」——E 类事件分的 magnitude/dim2 量的是现象传播广度
 * （烧了多大），不是情绪转化（Web3 用户会不会被触动到想参与）：观众≠买家。
 * 折损作用于标准数学的 tierScore+effDim2 两项（时效不折——新鲜是客观属性，
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
 * 折损判据源换 web3_fit——用户裁定「meme 币发币哪里有什么圈内圈外一说，web3
 * 用户喜欢就行了」（B 案：折损机制保留、判据源替换）。根因：resonance 量的
 * 「情绪行动力」对 Jev 不可观测（只见语料不见链上），推断素材与 web3_fit 完全
 * 同源，独立作答只产生矛盾面（유과 案同次作答 web3_fit strong_fit 0.97 vs
 * resonance mild 0.79 互斥）；例文「圈外」焊死 mild 档定义，轴腐化为圈层归属。
 * 新判据：E 类且 web3_fit (strong_fit+fit) < 0.5（marginal 占优）→ tierScore+
 * effDim2 ×0.5（时效不折不变）；≥0.5 → 原公式（유과 0.97 / 蝙蝠侠摇 0.76 均
 * 不折——后者形状放行为用户明示接受：当年 -12.4% 归盘面非叙事错判）。0.5 阈值
 * 与 J1.19 负门/J1.23 锚/J1.27 接纳门同一条线。unfit≥0.5 的票全域负门已拦，
 * 折损层不再管。web3_fit 答案整体缺失（J1.19 前旧缓存行）→ fail-open 不折；
 * J1.31-J1.35 行有 web3_fit 答案可重放新逻辑（存量不重评，回测/校准重放生效）。
 */
const RESONANCE_FIT_COEF = 0.5;
const RESONANCE_FIT_THRESHOLD = 0.5;

/**
 * 负面硬新闻质量门（J1.11，2026-09-26 用户裁定，C9 bitget被盗案 0x0e323198：
 * 蹭 Bitget 热钱包被盗 3.516 亿官方公告命名，D 类 + A 档量级直接喂饱事件分 74.65
 * → 80.32 high 放行后 -55%。裁定原文「第一，这是一个负面事件；第二，它没有啥
 * meme的」——安全事故/被盗/被黑/暴雷/巨额损失类负面事件无 meme 化玩味空间
 * （主体是机构不自嘲、无梗无二创），蹭其命名只是消费热度，热度再高也不该放）。
 *
 * 与 argmax 机制（BLOCK_SCOPE 'all'）双挂：argmax 命中 negative_hard_news 且
 * noneProb<0.5 拦；本门按概率 ≥0.5 独立拦（覆盖 negative 是 argmax 但 none 恰
 * ≥0.5、或边界抖动 none/negative 五五开时 mass 仍过半的情况）。二者任一命中
 * 即拦，全域（不限类别）、标准 + superIP 双路径。
 */
function negativeHardNewsBlock(answers) {
  const p = answers?.block_reason?.probabilities?.negative_hard_news ?? 0;
  if (p < 0.5) return null;
  return { label: BLOCK_LABELS.negative_hard_news, mass: Math.round(p * 100) / 100 };
}

/**
 * 常规内容产品宣传质量门（J1.13，2026-09-27 用户裁定，C12 绣春刀3案 0xa7c9c86e：
 * BTCdayu 推「绣春刀3电影即将推出」，第三方骑乘电影系列名发币，name_referent
 * super_ip 0.66 命中 C8 豁免 → B 类 65.95 high 放行。裁定「即使推出了，也不能
 * 作为meme币」——常规电影等内容型产品宣传与官宣与否无关：观众是消费者不是玩梗
 * 社区，无二创动力、无 meme 玩味空间，蹭其命名只是消费上映热度，产品知名度
 * 再高也不该放（与 negative_hard_news 同构：热度/知名度≠叙事价值））。
 *
 * 与 argmax 机制（BLOCK_SCOPE 'all'）双挂，语义同 negativeHardNewsBlock：
 * 本门按概率 ≥0.5 独立拦边界抖动，二者任一命中即拦，全域、标准 + superIP 双路径。
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
function routineContentProductBlock(answers, category, opts) {
  if (category === 'A') return null;
  // C56 平台官方源豁免：币安/flap 等币安链原生平台官方账号发的自家内容（吉祥物
  // IP/产品公告）不算「机构日常运营」拦截对象——自家场子官方票（FlapGuy 案）
  // （C83 起全语料走本路径，豁免面即全部豁免面）
  if (opts?.platformOfficial) return null;
  // C88 超级IP口号票豁免（rcp 概率臂，与 A 类/platformOfficial 豁免同位）：五腿
  // 全中的超级IP事件票口号名是借热度玩梗，非「常规内容产品宣传」（暗号案的
  // argmax 臂豁免见门链内同款守卫）
  if (opts?.superIpSlogan) return null;
  const p = answers?.block_reason?.probabilities?.routine_content_product ?? 0;
  if (p < 0.5) return null;
  return { label: BLOCK_LABELS.routine_content_product, mass: Math.round(p * 100) / 100 };
}

/**
 * Web3 用户偏好质量门（J1.19，2026-09-29 用户裁定，C30 死亡观察员/太阳之勤案
 * 0xd2a6d440…7777 / 0xe5fa214f…7777：两票均为抖音爆款视频票，video_unrated
 * 爆款短路（点赞≥10万 → 不进Jev直接mid）放行后 Web3 用户不买账阴跌。裁定原话
 * 「Web3用户是不会喜欢的，不符合用户胃口」：Web2 传播热度 ≠ Web3 用户偏好——
 * 事件可以完全有叙事价值（E 类爆款）只是不合链上 meme 买家口味，故独立成题
 * （web3_fit 四档）而非并入 block_reason 的「无叙事价值」语义）。
 *
 * 独立题独立门：unfit 概率 ≥0.5 → rating 1（与 negativeHardNewsBlock 同构：
 * 概率门对抗 argmax 跨 run 抖动，全域不限类别、标准 + superIP 双路径）。
 * marginal 不拦——四档概率落库观察，待校准数据后再定是否收严。
 */
function web3FitBlock(answers) {
  const p = answers?.web3_fit?.probabilities?.unfit ?? 0;
  if (p < 0.5) return null;
  return { label: 'Web3用户偏好不合', mass: Math.round(p * 100) / 100 };
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
 * J1.27 下 cat=D + se=character_ip，实际拦截点 = block_reason argmax
 * institution_routine「机构日常运营」双轮稳定，rcp 概率只有 0.1——所以豁免位
 * 有三处：① rcp 概率门（routineContentProductBlock opts）② argmax 链
 * institution_routine / routine_content_product 子句（S/A 级平台官方号的实质
 * 内容推不算日常运营）③ 产品实体接纳门（productEntityAcceptanceBlock opts）。
 * （C83 起快车道删除，此处豁免面对全部语料生效；注册表内其余机构账号的
 * institution_routine argmax 按收紧语义拦截——BI 案教训方向）
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
 * Research=研究 / Square=内容平台）。新全球职能臂遇 case 再扩
 * （PLATFORM_OFFICIAL_HANDLES 同款维护语义）；地域号（Arabic/Africa/
 * Turkiye/…）全部视为地域子账号。只查主推作者不查父推（BOB 案先例：主推
 * 是路人号玩梗、父推才是官方——主体判定以主推作者为准）。作者字段双形状：
 * tweet 型 author_screen_name / account 型 screen_name（detectPlatformOfficial
 * 同款）；handle 缺失 → null fail-open（旧缓存行/无推语料票不锚）。
 */
const GLOBAL_BINANCE_HANDLES = new Set(['binance', 'binancelabs', 'binanceresearch', 'binancesquare']);
function detectBinanceRegionalAccount(twitterInfo) {
  const h = String(twitterInfo?.author_screen_name || twitterInfo?.screen_name || '').toLowerCase().trim();
  if (!h.startsWith('binance') || GLOBAL_BINANCE_HANDLES.has(h)) return null;
  return { handle: h, followers: Number(twitterInfo?.author_followers_count ?? 0) || 0 };
}

/**
 * 图文名不符拼写门（纯代码，无 LLM）——C78 鲸元卷案（2026-10-16 用户裁定
 * 「拼写错误这个肯定要阻断（除非是引申等等，但这里就是拼写错误了）」）：
 * 币名「鲸元卷」0xe0cf0905…7777 的配图图内文字写的是正字「鲸元券」（vision
 * img-v3 visible_text 逐字转写多次出现），全图无一「卷」字——名称连自己的
 * 宣告图都没抄对，只能是无意抄写错误。Jev 探针实证拦不住：block_misspelling
 * 线上答 0.28，题面加「图内文字写法对照」判据后重放反降 0.13（题面改锚分
 * 不动家族第三实证）→ 判据改由代码接管（C28 cashtag 改道同款先例）。
 *
 * 判据（substitution 一字差对照，600 票历史扫描后收紧三道）：
 *   ① 币名含 CJK（Han/Hangul/Kana）且长度 ≥3——拉丁名不判（3-4 字母名与
 *     图内任意词一字符差全是 OCR 噪声：CTS/ces、RAM/rom 实测族；英文真实
 *     case 未出现，出现后再定参数）
 *   ② 图内文字存在与币名等长、恰一位不同的**独立段**（非子串滑窗——语流
 *     内部黏连如「中国的龙」不产生段级命中），且全文出现 ≥2 次（核心名称
 *     主体 vs 一次性语料语境词：中国龙↔「中国的」单次出现实测不命中）
 *   ③ 币名整体不在图内文字出现（出现了=名字在图内被使用过——有意变形/图内
 *     双写法都不拦，天然编码用户例外口径「除非是引申等等」：有意谐音/引申
 *     通常全语料一致地用变形写法，图内也是「卷」→ 不触发）
 * 分段口径=非字母数字全当分隔符（标点黏连是最大噪声源：neon》/调教”/航小-
 * 实测族），故「“鲸元券”」独立成段 ✓。
 * 图内文字源=twitterInfo.image_analysis 整体 stringify（结构无关：visible_text/
 * key_elements/description 任意形状都覆盖）；无 image_analysis（无图票/C72 门跳过
 * 剥除）→ 无从对照不触发（fail-safe 偏拦方向与 C72 一致）。
 *
 * 残余误伤面声明（600 票扫描实测，收紧后 mid/high 误伤≈0）：同角色双译写
 * （爱丽丝/艾丽丝族）与 vision 形近转错（땅/당）若独立段 ≥2 次仍会命中——
 * 偏拦方向（fail-safe），审计字段 spellingMismatch 可追溯；转错成币名同字则
 * 币名出现 → 不触发（安全漂移）。换位形状（pepe/peep 两位置差）刻意不覆盖。
 *
 * @returns {{hit: boolean, variant: string|null}} hit=命中拦截；variant=图内命中的
 *   近似写法（审计用）
 */
export function detectNameImageSpellingMismatch(tokenData, twitterInfo) {
  const ia = twitterInfo?.image_analysis;
  if (!ia) return { hit: false, variant: null };
  const name = String(tokenData?.name || tokenData?.raw_api_data?.name || '').toLowerCase().replace(/\s+/g, '');
  // ① 仅 CJK 名（Han/Hangul/Kana），长度 ≥3
  if (name.length < 3 || !/[一-鿿가-힯぀-ヿ]/.test(name)) return { hit: false, variant: null };

  // 图内文字全文（结构无关）；小写 + 非字母数字全当分隔符（标点黏连防误伤）
  let fullText;
  try { fullText = JSON.stringify(ia); } catch { return { hit: false, variant: null }; }
  if (!fullText || fullText.length < name.length) return { hit: false, variant: null };
  const tokens = fullText.toLowerCase().split(/[^0-9a-z一-鿿가-힯぀-ヿ]+/).filter(Boolean);

  // ③ 币名整体在图内任一段出现（段内子串）→ 名字被图内使用过，不拦
  for (const t of tokens) {
    if (t.includes(name)) return { hit: false, variant: null };
  }
  // ② 等长独立段恰一位不同（substitution 距离 1）且全文出现 ≥2 次
  let best = null, bestCount = 0;
  const counts = new Map();
  for (const t of tokens) {
    if (t.length !== name.length) continue;
    let diff = 0;
    for (let j = 0; j < name.length; j++) {
      if (t[j] !== name[j] && ++diff > 1) break;
    }
    if (diff === 1) {
      counts.set(t, (counts.get(t) || 0) + 1);
      if (counts.get(t) > bestCount) { bestCount = counts.get(t); best = t; }
    }
  }
  return bestCount >= 2 ? { hit: true, variant: best } : { hit: false, variant: null };
}

/**
 * 产品实体接纳门（J1.27，2026-10-03 用户裁定，C55 华为麒麟案族——评3 161 票
 * 东西方归类发现「中国公司产品发布」簇 ~15 票几乎全亏：麒麟 0x967e4a52…7777
 * 实测 mag S71%/dim2 五档84% =「华为」的世界级影响力整体转移给「麒麟芯片」产品
 * 实体；B 类 J1.21「发布者指代」/D 类机构影响力/A 类形象档三条继承通道横跨四类）。
 * 裁定原话「这里面的主体并不是"华为"/"网易"，而只是它们发布的产品（实体）。
 * 要不就是事件形成了大影响力（并不需要一定是顶级IP），要不就是玩梗/有趣，
 * 对应着一个可爱的形象，本质上还是web3用户能不能喜欢与接纳的问题」。
 *
 * 执行：第 15 题 subject_entity 显式标注主体=公司产品实体（product_functional/
 * product_character）时，两条路统一收敛到接纳度底线——web3_fit 的 strong_fit+fit
 * 合计 <0.5 → 阻断（路b 玩梗可爱票靠 sf 高过线；路a 真出圈大影响力事件的票
 * fit 至少中性——web3 用户在讨论它；纯功能产品无论母公司多大、大众圈多热，
 * crypto 圈不接纳就拦）。母公司影响力的切分由题面形状③承担（wording 实证：
 * 麒麟 mag 4.58→2.97 且 fit sf44→mg62）、dim2 残留（国产芯片报道被判事件自传播
 * 五档57%）由本门兜底——题面切分+代码执行双防线（J1.16/J1.23/J1.24 教训）。
 *
 * 豁免：①pubProxyActive（J1.18/C29 发布者指代激活——骑乘票的量级语义由代码
 * 锚定，两裁定并存）；②isW / rideMass≠null（W 数学独立计分，Web3 产品 fit
 * 天然高、门无增益）；③binanceCorpus（C55 补充裁定：币安系产品对链上买家
 * 天然高接纳，币安影响力可正常转移给其产品——C35 币安支付/C40 BI 不拦）；
 * ③b platformOfficial（C56 补充裁定：flap 等币安链原生平台官方账号源，与
 * 币安同理）。（C83 起全语料走标准路径，本题对 superIP 语料票同样生效）
 */
function productEntityAcceptanceBlock(answers, opts) {
  const se = answers?.subject_entity?.choice;
  // J1.43（C109）subject_entity 8→2：product_entity 新桶 + 旧两桶名兼容集
  // （C107 先例——旧缓存行/旧 fixture choice 名继续触发，拦截语义 bit 不变）
  const PRODUCT_ENTITY_CHOICES = new Set(['product_entity', 'product_functional', 'product_character']);
  if (!PRODUCT_ENTITY_CHOICES.has(se)) return null;
  if (opts.pubProxyActive || opts.isW || opts.rideMass != null) return null;
  if (opts.binanceCorpus || opts.platformOfficial) return null;
  const p = answers.web3_fit?.probabilities ?? {};
  const fitMass = (p.strong_fit ?? 0) + (p.fit ?? 0);
  if (fitMass >= 0.5) return null;
  return {
    label: `产品实体未被web3买家接纳(J1.27)（${se === 'product_functional' ? '功能产品' : se === 'product_character' ? '产品形象' : '产品实体'}，接纳度${Math.round(fitMass * 100)}%<50%）`,
    subject: se,
    fitMass: round2(fitMass),
  };
}

/**
 * 骑乘改道（C8，2026-09-24 用户裁定）：项目制作者自己发币通过没问题（路由层
 * detectIssuerSelfLaunch 命中 → prestage，C7 方案 A）；**第三方骑乘**推文主体的
 * 作品/产品名发币，产品的分量就远远不足——不得按「主体=作者影响力」的标准分放行，
 * 改道 W 数学：要求被骑产品本身影响力极高（宝玉 demo 级被拦）。
 *
 * 判定（纯代码市场事实，无 LLM 新题）：
 * - 作用域 B+C：作品发布（B）与账号动态（C）在「作者展示自己的东西」语料上同构，
 *   event_category 在 B/C 边界跨 run 抖动（桃花源记两次 run：B 0.52/C 0.45 →
 *   B 0.41/C 0.56），只挂 B 会被抖到 C 绕过。C7 路由优先于本门不受影响。
 * - 触发：subject_self+super_ip 合计 ≥ 0.5（币名=推文主体自己的东西；合并质量
 *   对抗跨 run 抖动，语义同 nameReferentBlock 阻断侧合计）且 **super_ip 单项 < 0.5**
 *   ——super_ip 过半 = 名字的主人本身就是超级 IP（天才 0.97/嫦娥 0.65-0.7），
 *   J1.10 放行侧语义直接豁免；B 类下同构覆盖「超级牛产品骑乘可放」（用户裁定
 *   「如果是超级牛有巨大影响的产品发布那可能可以」）。
 * - D/F/E/G 不入域：无实证 case，D/F 全量行已是 low 零增益，E 热点命名先例不拦
 *   （语义同 NAME_REFERENT_BLOCK_SCOPE 的取舍）。
 *
 * 已知模糊区（C7 同源，接受）：到达标准路径的 B/C+subject_self 必是 detector
 * 不命中——真骑乘盘，或 handle 与币名无包含的漏检自发盘（语料层无法证明钱包归属）。
 * 误伤方向=漏检自发盘按产品分评（偏低）；detector 正向命中优先转 prestage 不受影响。
 */
function rideDetourBelow(answers, category) {
  if (category !== 'B' && category !== 'C') return null;
  const probs = answers?.name_referent?.probabilities;
  if (!probs) return null;
  const ss = probs.subject_self ?? 0;
  const sip = probs.super_ip ?? 0;
  if (sip >= 0.5) return null; // 名字主人=超级 IP：豁免（天才/嫦娥/超级牛产品）
  const mass = ss + sip;
  return mass >= 0.5 ? Math.round(mass * 100) / 100 : null;
}

/**
 * 阻断选项是否在该类别下生效
 * @param {string} choice - block_reason 的 choice（≠'none'）
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
function magnitudeTier(score) {
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
  const type = answers.relevance_type?.choice || 'none';
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
 * 从 answers 提取质量分（长度代码算）。J1.43（C109）两题合一：token_quality
 * （band 索引 0-3）→ TOKEN_QUALITY_BANDS 联合量纲 0-12，name=合并子分、
 * spelling/reasonability=null；旧形状（quality_spelling+quality_reasonability）
 * → legacy 双 band 路径原样，name=null。total 两种形状同为「长+名字质量」合计
 * 刻度，类别阈值语义不变。
 */
function qualityFrom(answers, symbol) {
  const length = qualityLengthScore(symbol);
  const tq = answers.token_quality?.score;
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
 * 落库供页面回放展示；full=false 为摘要版（主路径 stage2/3 与 stage1 同一次调用，
 * 全文只存 stage1_prompt，避免一行三份 60k 语料，指针 fullPromptIn 指明全文所在列）
 */
function buildCallPromptMeta(questions, stateStats, state, { full = false } = {}) {
  return JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_QUESTIONS_VERSION,
    questionIds: Object.keys(questions),
    stateStats,
    ...(full ? { state, questions } : { fullPromptIn: 'stage1_prompt' }),
  });
}

/**
 * 主路径（原 3 阶段管线）映射
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.tokenData - 代币数据
 * @param {boolean} context.includeBrandHijack - 品牌劫持预检是否命中（问题是否存在）
 * @param {boolean} [context.credibleEventAnchor] - 可信事件源锚（J1.24 戏谑关联豁免用：
 *   superIP 语料锚 / 广场官方认证源 / 发行方自发宣告 任一命中为 true，analyzer 层算好传入）
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
    tokenData, includeBrandHijack = false, callInfo, tweetClassification = null, twitterInfo = null,
    // C44 IG 影响力兜底（analyzer 传入）：instagramLinked = classifiedUrls.instagram
    // 有 URL；instagramInfoFetched = IG 数据已抓到（真数据进 state，Jev 按真证据
    // 判分不兜底）
    instagramLinked = false, instagramInfoFetched = false,
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
  // 逃进 F 不吃载体门不吃 J1.36 折损。改道判据=J1.37 新题 finding_vs_recap：
  // event_category=F 且 news_recap（叙事内容是对新闻事件的报道/目击/搬运，发现
  // 语气只是目击动作）→ 强制改 E，E 类既有门自动接管（载体门 E+no_visual /
  // web3_fit 折损 / E 类时效与量级语义）。cashtag 改道优先（F 与 cashtagHit 互斥
  // 无竞争：cashtagForced 时改 W 数学，本改道不触达）。finding_vs_recap=
  // narrative_finding/unclear/缺失（旧缓存行 fail-open，J1.28/J1.29 同款）→ 维持
  // F 零变化。审计 categoryForced='f_recap_e'（cashtag_w 同款，Jev 原 choice 见
  // event_category probabilities 可追溯）。
  const recapForced = !!(answers.event_category?.choice === 'F'
    && answers.finding_vs_recap?.choice === 'news_recap');
  const category = cashtagForced ? 'W' : (recapForced ? 'E' : (answers.event_category?.choice || null));
  // J1.18 发布者指代（C29 Cue/Manus 案 0x5074546c，2026-09-29 用户裁定「骑乘第三方
  // 产品：①独立产品发布/重大升级；②产品影响力由发布者指代——领域知名发布者算
  // 大IP」）：领域知名发布者官宣独立新产品（判据全代码可读，detectPublisherProxy：
  // 官宣域名 stem=币名 + 作者粉丝≥10万 + 币名与作者名互不包含 + 无版本指纹词）被
  // 第三方骑乘发币时，按发布者知名度指代计分：
  // - nameReferentBlock / 骑乘改道豁免——等同 super_ip≥0.5 放行侧语义（Jev 对
  //   发布者知名度的知识缺口五轮实测 super_ip 0.16→0.31 压不过 0.5 线）；
  // - marketing_gimmick argmax 豁免——官方域名=具体产品，与「无任何实质产品」的
  //   噱头定义直接矛盾（CUE 本轮 argmax gimmick 0.30/none 0.29 抖动即此形状）；
  // - 量级 A 档锚（effTier）——题面「领域知名大IP→A档起」Jev 执行不下去（magnitude
  //   稳定 B 档），发布者知名度由代码事实锚定；superIP 快车道 S 级预评分同构
  //   （量级代码判定的体系先例；C83 起快车道删除，pubProxy 锚保留为唯一同构物）。
  // 边界：仅 B/C 域（与 rideDetourBelow 同域，防 B/C 边界跨 run 抖动）；cashtag
  // 改道优先（推文含 $TICKER = 讨论已存在 web3 资产，W 数学语义不变）；rcp /
  // negativeHardNews 门不豁免（内容型产品 C12 绣春刀裁定维持——发布者指代不适用
  // 于电影等内容产品）。
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
  // 量级门 D/E 臂无 superIpSlogan 豁免（C88 五腿只豁载体门/rcp/劫持/关联
  // 截断/事件分不足臂）——本案五腿全中（superIp 0.55/mem 2.39/relPositive 0.8）
  // 把 no_visual 0.98 豁出载体门后，本锚是唯一拦截位。cashtag/骑乘改道走
  // W 数学 tier 不参与，天然无竞争。
  const binanceRegional = detectBinanceRegionalAccount(twitterInfo);
  const regionalAnchorActive = !!(binanceRegional && binanceCorpus);
  const magnitude = answers.event_magnitude?.score ?? 0;
  const tier = magnitudeTier(magnitude);
  // 发布者指代量级锚生效位：Jev 原判低于 A 时锚到 A（S 不降，A 原判不动）
  const tierAnchored = pubProxyActive && tier !== 'S' && tier !== 'A';
  // J1.23 Web3 偏好量级锚生效位（C38 久留美案续，2026-10-01 用户裁定「A类判定
  // 没有考虑 Web3 用户喜好…最根本上要占到用户角度看叙事」）：A 类（形象 IP）的
  // 量级本质=多少人愿意拿这个形象玩梗，Web3 买家群体强喜欢本身就是量级证据。
  // 题面改锚实证 Jev 执行不动（久留美 C 档置信 0.82→0.94，语料「2.5万粉官号/
  // 未开播角色」的客观事实锚死大众知名度口径；同票 web3_fit strong_fit 0.88
  // 高置信——J1.16 rcp / J1.18 pubProxy 同款教训：Jev 分不动的边界代码切）。
  // strong_fit ≥0.5（与 unfit 负门同阈值，两档概率互斥无冲突）时量级锚 B：
  // B 档=过线最低量级带；不越权 A/S——圈内喜好不证明世界级知名度，大众知名
  // 通道（A/S）仍由知名度证据决定。原判 B/A/S 不动；D/E 档随之放行（偏好
  // 证据推翻「量级不足」）。
  // C94 扩展臂（2026-10-18 用户裁定，京小安案 0xcb98accaa8040a7e839c305b8aca
  // 08e113c87777：「web3_fit 如果高，豁免发布主体…web3 用户喜欢，发布这个
  // 新闻的是什么主体就无所谓了，地方媒体全国媒体都可以」）：B 类（非 Web3
  // 产品票）同享量级锚——J1.27 形状③已把产品实体的发布方知名度切掉，剩余
  // 量级判据（自传播/形象玩梗）在小号转述+原始语料数据缺失时必然 D 档
  // （京小安：北京日报官微源未抓到，1 粉转述 0 赞 0 转 → 1.35/D 档 75%），
  // 偏好证据（strong_fit 0.57）推翻「量级不足」。纯功能产品天然 strong_fit
  // <0.5（题面限制「不高于 marginal」），豁免臂结构性不触达无形象产品票。
  // 仍仅 A/B 类：C/D/E 类量级是人物影响力/热点传播的客观规模，偏好不替代
  // 规模（维持）；事件影响力特别大的票走 S/A 档高分既有通路，与本豁免正交。
  const web3FitStrongP = answers?.web3_fit?.probabilities?.strong_fit ?? 0;
  const web3FitAnchored = !tierAnchored && (category === 'A' || category === 'B')
    && web3FitStrongP >= 0.5
    && tier !== 'S' && tier !== 'A' && tier !== 'B';
  const effTier = regionalAnchorActive ? 'D' : (tierAnchored ? 'A' : (web3FitAnchored ? 'B' : tier));
  // C68 找角度时效 override：Jev event_timing 锚「叙事首次发生时间」（제로案判
  // within_30d=10 分压线过），找角度推文的时效语义是「载体推文→发币」的 lag——
  // override 在 timing 变量源头生效，W/标准数学 + J1.24 punExempt 全下游一致消费
  const angleTiming = overrideAngleTiming(tweetClassification, twitterInfo, tokenData, answers.event_timing?.choice);
  const angleTimingOverride = angleTiming
    ? { lagSec: angleTiming.lagSec, staleSec: ANGLE_TWEET_STALE_SEC, rawTiming: angleTiming.rawTiming }
    : null;
  // C75 叙事源头陈旧 override：direct_tweet 主推超 30d → timing 归 older（与 C68
  // 同在 timing 变量源头生效，W/标准数学 + 全下游一致消费；两门 type 互斥不双命中）
  const staleSourceTiming = overrideStaleSourceTiming(tweetClassification, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleSourceOverride = staleSourceTiming
    ? { lagSec: staleSourceTiming.lagSec, staleSec: SOURCE_STALE_SEC, rawTiming: staleSourceTiming.rawTiming }
    : null;
  // C102 借壳语料父推源头窗：binanceCorpus 票父推 lag 超 24h → timing 归 older
  //（BAI 案；不限 type，与 C68/C75 同票并存不冲突——三条 override 同归 older）
  const staleParentTiming = overrideStaleParentTiming(binanceCorpus, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleParentOverride = staleParentTiming
    ? { lagSec: staleParentTiming.lagSec, staleSec: BINANCE_PARENT_STALE_SEC, rawTiming: staleParentTiming.rawTiming }
    : null;
  // C103 载体↔父推关系源头窗（Jean Phil 案）：Jev 判翻译/二手解读 + 父推 lag
  // 超 24h → timing 归 older（四条 override 同归 older，审计键各落各的）
  const staleRelParentTiming = overrideStaleRelParentTiming(answers, twitterInfo, tokenData, answers.event_timing?.choice);
  const staleRelParentOverride = staleRelParentTiming
    ? { lagSec: staleRelParentTiming.lagSec, staleSec: PARENT_REL_STALE_SEC, choice: staleRelParentTiming.choice, rawTiming: staleRelParentTiming.rawTiming }
    : null;
  const timing = (angleTiming || staleSourceTiming || staleParentTiming || staleRelParentTiming) ? 'older' : (answers.event_timing?.choice || 'unknown');
  const dim2 = bandInterpolate(answers.dimension2?.score ?? 0, DIM2_BANDS);
  // C44 IG 影响力兜底锚（2026-10-01 用户裁定「对，因为我们无法知道在Ins上这个猫
  // 的影响力多大，这里我觉得豁免一下吧，如果引用了Insgram的链接，就认为影响力
  // 达标」，土豪猫猫案 0xfade76ef…7777）：IG 是封闭平台，帖子/账号传播数据经常
  // 抓不到——语料「零传播证据」是证据缺失而非零影响力，dim2 被压 0-9 档属口径
  // 错位。条件全中才锚：①A 类（形象 IP——IG 是形象主阵地，裁定场景）；②语料
  // 引用了 IG 链接（instagramLinked）；③IG 数据未抓到（instagramInfoFetched
  // false——真数据已进 state 时 Jev 按真证据判分，不兜底）；④dim2 < 18（只升
  // 不降；18 = J1.23 dimension2 A 类「风格契合 Web3 偏好的角色形象」带下限）。
  // 不救量级门（strong_fit<0.5 的 D 档票死量级门合理——偏好证据另有 web3FitAnchored
  // 正门）；W 数学不消费 dim2 不触达；web3FitBlock unfit 负门在前，豁免票 unfit
  // 仍拦（交互安全）
  const igDim2Anchor = category === 'A' && instagramLinked === true
    && instagramInfoFetched !== true && dim2 < 18;
  // C94 Web3 偏好传播轴锚（2026-10-18 用户裁定双锚：web3_fit 强时发布主体
  // 无所谓，量级轴（上 web3FitAnchored）+传播轴（本锚）一并豁免）：B 类 dim2
  // 语义=发布方权重，小号转述票的 dim2 实际量的是转述者（京小安 1 粉小号→7
  // 分），原始事件源数据缺失（微博原文未抓到）是证据缺失而非零影响力——C44
  // IG 锚同款语义。strong_fit≥0.5 同阈值同条件；只升不降（dim2<18 才锚，
  // 18=J1.23 dimension2「风格契合 Web3 偏好」带下限=圈内吸引力基线）。
  // 仅 B 类：A 类已有 IG 锚+J1.23 锚组合覆盖（互斥不叠加），C/D/E 类量级是
  // 客观规模维持不豁。锚不改门只改分（mem 地板/量级门各自的拦截语义不动——
  // 京小安 mem 1.88<2 仍被 C88 地板拦是 2026-10-18 用户裁定「维持拦」）。
  const web3FitDim2Anchor = category === 'B' && web3FitStrongP >= 0.5 && dim2 < 18;
  const effDim2 = igDim2Anchor ? 18 : (web3FitDim2Anchor ? 18 : dim2);
  const blockChoice = answers.block_reason?.choice || 'none';
  const blockProb = answers.block_reason?.probabilities?.[blockChoice];
  // 原 prompt 语义是"命中任一阻断条件即阻断"（二值）。Choice 摊成 10 路分布后
  // 9 个阻断项共享概率质量，argmax≠none 过易触发（dry-run 实证：P=0.43 即阻断）。
  // 忠实转译：P(none)≥0.5 才视为无阻断。
  const noneProb = answers.block_reason?.probabilities?.none ?? 0;
  // name_referent（J1.10 阻断位已随 C108 退役）：choice/概率保留纯观察落库
  // （Jev 原判可追溯；拦截责任在 notMemeNameBlock——题概率另喂 C88 五腿/骑乘改道）
  const nameReferent = answers.name_referent?.choice || null;
  const nameReferentProb = answers.name_referent?.probabilities?.[nameReferent] ?? null;
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
        // C68 审计标记：找角度时效 override 命中详情（载体推文 lag/窗/Jev 原判档
        // 可追溯；null=未命中——形态不符/窗内/锚或载体时间缺失）
        angleTimingOverride,
        // C75 审计标记：叙事源头陈旧 override 命中详情（direct_tweet 主推 lag/窗/
        // Jev 原判档可追溯；null=未命中——形态不符/窗内/锚或主推时间缺失）
        staleSourceOverride,
        // C102 审计标记：借壳语料父推源头窗命中详情（binanceCorpus 父推 lag/24h 窗/
        // Jev 原判档可追溯；null=未命中——非借壳语料/窗内/锚或父推时间缺失）
        staleParentOverride,
        staleRelParentOverride,
        magnitudeTier: tier,
        timing,
        blockChoice,
        // J1.17 审计标记：category 被代码端 cashtag 判据改写为 W（原 Jev choice 见
        // event_category probabilities），落库行可追溯改道来源；C96 F→E 改道同位
        // （'f_recap_e'——news_recap 改道 E，Jev 原 choice=F 可追溯）
        categoryForced: cashtagForced ? 'cashtag_w' : (recapForced ? 'f_recap_e' : null),
        cashtagMatched: cashtagHit?.cashtag ?? null,
        // C96 审计标记：币名 meme 合格度恒落（J1.37-J1.41 name_form 题，旧缓存行
        // → null；命中 notMemeNameBlock 拦截时 stage2 jev.nameFormBlock 落详情）
        nameForm: answers.name_form?.choice ?? null,
        // C96 审计标记：发现 vs 转述恒落（J1.37 finding_vs_recap 题，旧缓存行 →
        // null——非 F 类也落纯观察，改道只消费 F+news_recap 组合）
        findingVsRecap: answers.finding_vs_recap?.choice ?? null,
        // J1.18 审计标记：发布者指代门命中详情（判据/豁免可追溯，Jev 原判 tier
        // 保留在 magnitudeTier 键不受锚定影响）
        publisherProxy: pubProxy ? { domain: pubProxy.domain, followers: pubProxy.followers } : null,
        publisherProxyActive: pubProxyActive || null,
        // C97 审计标记：币安地域子账号量级锚命中详情（handle/粉丝数可追溯；
        // null=未命中——全球号/无借壳语料/非 binance 前缀源/handle 缺失；
        // 原判档在 magnitudeTier 键不受锚影响）
        regionalSubAccount: binanceRegional && binanceCorpus
          ? { handle: binanceRegional.handle, followers: binanceRegional.followers } : null,
        tierAnchored: tierAnchored ? 'A' : null,
        // J1.23 审计标记：A/B 类（C94 起 B 类同享）+ web3_fit strong_fit≥0.5 的
        // 偏好量级锚（Jev 原判 tier 保留在 magnitudeTier 键不受锚定影响）
        web3FitAnchored: web3FitAnchored ? 'B' : null,
        web3FitStrongP: web3FitAnchored ? web3FitStrongP : null,
        // J1.26 nrNotableExempt 审计键随 C108 nr 阻断位退役（历史行键保留展示）
        probabilities: {
          event_category: answers.event_category?.probabilities,
          event_magnitude: answers.event_magnitude?.probabilities,
          block_reason: answers.block_reason?.probabilities,
          name_referent: answers.name_referent?.probabilities,
          web3_fit: answers.web3_fit?.probabilities,
          subject_entity: answers.subject_entity?.probabilities,
        },
      },
    },
  };

  // ── Stage2：阻断 + 事件分 ──────────────────────────────────────────
  const isW = category === 'W';
  // C8 骑乘改道：B 类第三方骑乘盘改走 W 数学（见 rideDetourBelow 注释）。
  // J1.18 发布者指代豁免：官方域名+领域知名发布者已实锤「独立新产品」，不再改道
  // W 数学（W 产品分对新非 Web3 产品无实体约束，语义错位），走标准数学按 effTier 计分
  const rideMass = pubProxyActive ? null : rideDetourBelow(answers, category);
  let stage2Blocked = false;
  let stage2BlockReason = null;
  let nhnBlock = null; // negative_hard_news 质量门信息 {label, mass}（J1.11）
  let rcpBlock = null; // routine_content_product 质量门信息 {label, mass}（J1.13）
  let w3Block = null; // web3_fit 质量门信息 {label, mass}（J1.19，Web3用户偏好）
  let peBlock = null; // 产品实体接纳门信息 {label, subject, fitMass}（J1.27/C55）
  // C108：nrBlock（J1.10）/rmBlock（J1.28）/memFloorFired（C88）随名字门统一退役
  let nfBlock = null; // 名字门信息 {label, form}（C96→C105→C107→C108 唯一名字拦截位，J1.42 name_form；form=Jev 原 choice）
  let scBlock = null; // 形象载体门信息 {label, carrier}（J1.29）
  let tierScore = 0;
  let timeliness = 0;
  let stage2Total = null;
  // J1.36 E 类感染力折损（C93 判据源迁移）：resonanceCoef=生效系数（null=未
  // 触达——非 E 类 / web3_fit 答案缺失 fail-open / fitMass≥0.5 不折），标准数学
  // 分支赋值；fitMass 恒落审计（resonanceFitMass）
  let w3fFitMass = null;
  let resonanceCoef = null;
  let wProduct = null;
  let wInteraction = null;
  let wInteractionExempt = false;
  let wNewProductP = null;
  let stage2Reason = null;
  // C55 币安豁免审计：仅在该豁免实际改变门判定时落键（币安语料 + 无豁免时
  // 门会拦 = 豁免救票形状），与 punExempt 命中才落的模式一致
  const peBinanceExempt = binanceCorpus
    && productEntityAcceptanceBlock(answers, { pubProxyActive, isW, rideMass }) != null
    ? true : null;
  // C56 平台官方源豁免审计（FlapGuy 案）：官方源 + 无豁免时三处拦截位任一会拦
  // （rcp 概率门 rcp≥0.5 OR argmax institution_routine/routine_content_product
  // 命中且 noneProb<0.5——忠实复算下方 argmax 链的判定，含 A 类 rcp 豁免与
  // scope 检查）才落键，与 peBinanceExempt 命中才落的模式一致。FlapGuy 实测
  // 命中的是 argmax 位（rcp 概率仅 0.1），概率门位是备用形状
  const rcpArgmaxWouldBlock = ['institution_routine', 'routine_content_product']
    .includes(answers?.block_reason?.choice)
    && (answers?.block_reason?.probabilities?.none ?? 1) < 0.5
    && !(answers?.block_reason?.choice === 'routine_content_product' && category === 'A')
    && blockInScope(answers?.block_reason?.choice, category);
  const rcpPlatformExempt = platformOfficial
    && ((answers?.block_reason?.probabilities?.routine_content_product ?? 0) >= 0.5
      || rcpArgmaxWouldBlock)
    ? true : null;

  // ── Stage3 豁免判定前移（C86 D-1，2026-10-17 用户裁定「豁免应贯穿」）──
  // J1.24 戏谑豁免 / J1.30 名图一致豁免原本定义在 Stage3 段（只豁 Stage3 截断），
  // 但 Stage2 量级门在门链中先于 Stage3 执行——豁免票若 tier D/E（J1.30 可达）或
  // 事件分<60 会在到达豁免语义前被量级门拦下 = 遗漏。豁免判定是纯函数（依赖
  // answers/timing/effTier/relevanceFrom/context，全部在上方已就绪），整块前移到
  // 门链之前；豁免本体条件一字不动（J1.24 仍要求 effTier S/A——tier 不足的纯蹭
  // 名盘是 C40 裁定原文的拦截方向，由 punExempt 自身条件继续承担；J1.30 三门
  // 原样）。W 数学分支 pass 线刻意不豁免（W 有自己的 C42 豁免机制与 cashtag
  // 改道拦截语义，量级门不属于 W 数学）
  const relevance = relevanceFrom(answers);
  const brandHijackP = includeBrandHijack ? (answers.brand_hijack?.noul ?? 0) : 0;

  // J1.24 戏谑关联豁免（C40 Binance Inu 案 0xcaf66eb2…7777，2026-10-01 用户裁定
  // 「不是劫持，而是web3用户特有的戏谑/趣味性关联。当然它也必须得是当前的热门
  // 新鲜事，否则就成了无病呻吟」）：品牌关键词票在「当前热门新鲜事锚」下——
  // timing within_7d（当前）+ effTier S/A（热门）+ 可信事件源锚（superIP 语料锚/
  // 广场官方认证/发行方自发宣告，analyzer 传入 credibleEventAnchor，事件真实性有
  // 背书）三条件全中时，缩写双关/谐音/形象嫁接类名字不算品牌劫持：蹭的是事件
  // 增量热度，不是品牌存量认知。两层截断同豁免：品牌劫持截断 + relevance≤10
  // 截断（戏谑关联的本质=弱字面关联+强语境关联，缩写双关在 relevance 体系天然
  // 落低档，是特性不是缺陷；10 分照常计入总分，弱关联代价在分数上体现）。
  // 不豁免：misspelling/quality 门（与戏谑语义无关）；brandHijackP<0.5 的票
  // （本就不会被劫持门拦，relevance 弱关联照常截断——那是普通弱关联票）；
  // timing 非 within_7d / 量级不足的纯蹭名盘（无病呻吟，裁定原文的拦截方向）。
  const punExempt = includeBrandHijack && brandHijackP >= 0.5
    && timing === 'within_7d'
    && (effTier === 'S' || effTier === 'A')
    && !!context.credibleEventAnchor;

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
  //     nameReferentBlock 同思路；阈值与 punExempt/阻断侧惯例一致）
  //   ③ 0 < relevance ≤ 10（只救会被本截断拦的票；纯零关联 none 0 分不救，
  //     与 C59 条件②同——图再像也救不了与事件毫无关系的名字）
  // 与 punExempt 正交并存（C83 起全语料走标准路径，superIP 语料票同样可获豁免；
  // 快车道时代的 C59 meme≥3 门随通道删除，意图由本门+J1.28 覆盖）。
  const nicProbs = answers.name_image_consistency?.probabilities ?? {};
  const nicMatchP = (nicProbs.same_entity ?? 0) + (nicProbs.same_visual_category ?? 0);
  const imgNameExempt = !!context.imageEvidence && nicMatchP >= 0.5
    && relevance.score > 0 && relevance.score <= 10;
  // C109 图证载体覆盖（M1，交易猫案）：图证据∧名字-图匹配质量≥0.5 → subject_carrier
  // 的低置信掷硬币不再单独拦 J1.29（与 imgNameExempt 同源同阈、独立判定——载体
  // 存在性与关联强弱正交，不套 relevance ≤10 窗）。审计键 subjectCarrierImgOverride
  // 命中才落（下方 imgNameExempt 同款）
  // C118 演绎臂（DND 案二轮，用户裁定「载体豁免认演绎关系」）：image_depicts_name
  // depicts≥0.5 同样触发——配图在演绎名字含义=载体存在的另一种事实证据。概念名
  // （缩写/口号）无实体可对应，nicMatch 两档天然吃不到（DND vs 猫 unrelated 0.85
  // 但猫拉窗帘正是「别打扰」的画面演绎）。J1.30 imgNameExempt 刻意不消费本题
  // （演绎≠名实一致，两豁免面不互扩）；答案缺失/未问 → depictP=0 只剩 nicMatch 臂
  const depictP = answers.image_depicts_name?.probabilities?.depicts_name ?? 0;
  const imgCarrierOverride = !!context.imageEvidence && (nicMatchP >= 0.5 || depictP >= 0.5);

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
  const sipProb = answers.name_referent?.probabilities?.super_ip ?? 0;
  const relMassC88 = answers.relevance_type?.probabilities ?? {};
  // J1.43（C109）融合桶名并入正向质量求和（semantic_clear/weak=cultural_rich/thin
  // 拆分自旧 semantic/cultural 单桶）；旧桶名保留在求和里防回放工具旧形状
  const relPositiveMass = (relMassC88.exact_match ?? 0) + (relMassC88.translation_match ?? 0)
    + (relMassC88.abbreviation_alias ?? 0) + (relMassC88.semantic ?? 0) + (relMassC88.cultural ?? 0)
    + (relMassC88.semantic_clear ?? 0) + (relMassC88.semantic_weak ?? 0)
    + (relMassC88.cultural_rich ?? 0) + (relMassC88.cultural_thin ?? 0);
  const relNoneMass = relMassC88.none ?? 1;
  const memScoreC88 = answers.referent_memeability?.score ?? null;
  const superIpSlogan = sipProb >= 0.5 && relPositiveMass >= 0.3 && relNoneMass < 0.5
    && memScoreC88 != null && memScoreC88 >= 2
    && FRESH_TIMING_C88.has(timing) && web3FitStrongP >= 0.5;

  // C86 D-1：量级门豁免聚合标记（magExemptTags=救援标注与审计用）；C88 口号票
  // 并入聚合（事件分<60 臂放行——BI 同形状弱传播票由总分承担量级代价）
  const magExempt = punExempt || imgNameExempt || superIpSlogan;
  const magExemptTags = [punExempt ? 'J1.24戏谑' : null, imgNameExempt ? 'J1.30名图' : null,
    superIpSlogan ? 'C88口号' : null]
    .filter(Boolean).join('+');

  // J1.11 负面硬新闻质量门挂最前（事件性质层面的否决，优先于其他阻断展示）；
  // argmax 命中时下方 BLOCK_SCOPE 'all' 也能拦，此处覆盖概率过半但 argmax/noneProb
  // 边界抖动的情况（nameReferentBlock 同思路：合并质量对抗五五开抖动）
  // J1.13 常规内容产品宣传质量门同位双挂（C12 绣春刀3案，事件性质层面否决）
  // J1.19 Web3用户偏好质量门第三位同挂（C30 死亡观察员/太阳之勤案，受众口味
  // 层面否决——事件可有叙事价值但不合链上 meme 买家口味，热度再高也不该放）
  if ((nhnBlock = negativeHardNewsBlock(answers))) {
    stage2Blocked = true;
    stage2BlockReason = nhnBlock.label;
  } else if ((rcpBlock = routineContentProductBlock(answers, category, { platformOfficial, superIpSlogan }))) {
    stage2Blocked = true;
    stage2BlockReason = rcpBlock.label;
  } else if ((w3Block = web3FitBlock(answers))) {
    stage2Blocked = true;
    stage2BlockReason = w3Block.label;
  } else if ((peBlock = productEntityAcceptanceBlock(answers, { pubProxyActive, isW, rideMass, binanceCorpus, platformOfficial }))) {
    // J1.27 产品实体接纳门（C55）：主体=公司产品实体且 web3 接纳度（sf+fit）<0.5 →
    // 阻断。挂位在 web3_fit unfit 负门之后（unfit 票先被负门拦，label 归属更准），
    // block_reason argmax 之前（事件性质层面的否决）
    stage2Blocked = true;
    stage2BlockReason = peBlock.label;
  } else if (blockChoice !== 'none' && noneProb < 0.5
    // J1.16 角色IP豁免：argmax 命中 rcp 且类别为 A（形象IP/角色）时不拦，与概率门同语义
    && !(blockChoice === 'routine_content_product' && category === 'A')
    // J1.18 发布者指代豁免：官方域名=具体产品落地，与 marketing_gimmick
    // 「无任何实质产品」的定义直接矛盾（CUE 本轮 gimmick 0.30/none 0.29 抖动即此
    // 形状——官方域名的存在本身就是反证），不拦
    && !(pubProxyActive && blockChoice === 'marketing_gimmick')
    // C56 平台官方源豁免（FlapGuy 案实际拦截点在此位：argmax institution_routine
    // 0.55 / none 0.30，rcp 概率只有 0.1 够不着概率门）——币安/flap 等币安链原生
    // 平台官方账号的实质内容推不算「机构日常运营/常规内容产品宣传」，与 superIP
    // 通道 institution_routine 豁免（blockedByBlockReason 的 blockChoice 排除）同语义
    && !(platformOfficial && (blockChoice === 'institution_routine' || blockChoice === 'routine_content_product'))
    // C88 超级IP口号票豁免（argmax 臂）：暗号案实际拦截位（rcp 0.44 vs none 0.41
    // 五五开抖动）——五腿全中时口号名不算常规内容产品，与 A 类/platformOfficial
    // 豁免同位
    && !(blockChoice === 'routine_content_product' && superIpSlogan)
    // C114 图证在场豁免（empty_content 臂失效，DND 案 0x4dbcb10e…7777，用户裁定
    // 「选1」）：极短主推+配图/视频证据在场 → 「空洞内容」不成立——图就是内容
    // （DND 😾+猫拉窗帘视频，empty_content 0.36 vs none 0.31 掷骰边缘拦截；买家
    // 视角「币安发 DND 推+猫视频」是可成立的 meme 形态）。图证判据与 J1.30 名图
    // 一致豁免同源（context.imageEvidence = twitterInfo.image_analysis 存在）；
    // 无图票不触发=纯文字空洞票照拦。只翻本门：名字门/载体门/量级门照常接管
    // （DND 终局由 C97 地域子账号锚 D 档量级门拦——拦截理由干净；真·大号官方
    // 梗票不再被空洞门误伤）。同案 name_form 通用梗缩写锚=J1.47（题集侧）
    && !(blockChoice === 'empty_content' && !!context.imageEvidence)
    && blockInScope(blockChoice, category)) {
    stage2Blocked = true;
    stage2BlockReason = BLOCK_LABELS[blockChoice] || blockChoice;
  } else if ((nfBlock = notMemeNameBlock(answers))) {
    // C108 名字门（J1.42 name_form=not_meme_name——唯一名字拦截位；C96 陈述句门
    // →C105 版本词门→C107 收敛→C108 四拦截位统一并入）：币名当不了 meme 符号、
    // web3 用户不接纳这名字——四分支：①指向无名实体（YAYA 币安员工花名型）
    // ②非实体词无圈内感知（滑雪/我要去型；圈内文化词 Early/HODL 型放行——EARLY
    // 案翻案位）③形态缺陷（陈述句/版本词/序号，C96/C105/C107 继承）④无背景拼写
    // 变体（自 block_misspelling 探针并入）。原 nrBlock（J1.10）/rmBlock（J1.28）
    // /memFloor（C88）拦截位退役——案史与裁定见 notMemeNameBlock 注释。全域无
    // 豁免（superIpSlogan 五腿不豁——五腿前提是口号票，陈述句/版本词名字连口号
    // 都不是）；无概率 mass（choice 档位门）
    stage2Blocked = true;
    stage2BlockReason = nfBlock.label;
  } else if ((scBlock = subjectCarrierBlock(answers, category, { superIpSlogan, imgCarrierOverride }))) {
    // J1.29 形象载体门（M2）：C/D+非existing / E+no_visual → 叙事主体无形象载体。
    // 名字门之后（主体层缺陷）、量级门之前（载体缺失先于量级判定）；无概率
    // mass（choice 档位门）
    stage2Blocked = true;
    stage2BlockReason = scBlock.label;
  } else if (!isW && (effTier === 'E' || effTier === 'D') && !punExempt && !imgNameExempt) {
    // 量级 D/E 档：主体量级不足，直接阻断（原各类 prompt 的 D/E 处理）。
    // C86 D-1 豁免贯穿：J1.30 名图一致豁免无 tier 前置（图证据+一致性质量+弱关联
    // 三门全中即可），主体量级弱但名字与配图视觉一致的票不在此拦——落入标准数学
    // 分支按 tierScore=0 计分，弱量级代价在总分上体现；J1.24 punExempt 要求
    // effTier S/A，在本臂结构性不可达，保留守卫是豁免定义漂移的防线（同 C85
    // IS NULL 前置臂的防漂移语义）
    stage2Blocked = true;
    stage2BlockReason = `事件主体量级不足（${tier}档${regionalAnchorActive ? '→D档·币安地域子账号不借壳' : ''}）`;
  } else if (isW || rideMass != null) {
    // W 数学（W 类原生 / B 类骑乘改道 / J1.17 cashtag 改道共用：产品分量 + 币安交互 + 时效，pass 线 60）
    wProduct = bandInterpolate(answers.w_product_score?.score ?? 0, W_PRODUCT_BANDS);
    wInteraction = bandInterpolate(answers.w_binance_interaction?.score ?? 0, W_INTERACTION_BANDS);
    timeliness = TIMING_SCORES_W[timing] ?? 0;
    // C42 世界级主体产品豁免币安交互（2026-10-01 用户裁定「世界级主体发布产品
    // （不是版本更新），可以豁免跟币安交互」，RedCoin 案 0xe2881a7ac454c473a8b4
    // c858732402154e107777：HSBC 官宣港元稳定币 RedCoin——机构本身的量级就是
    // 叙事价值，跟币安零交互是常态而非缺陷，交互轴（W 数学最大权重 40 分，为
    // 币安生态叙事票设计）压死这类票属语义错位（J1.17 ChainPulse 案同源注释）。
    // 条件全中才豁免：①原生 W 类（改道票不豁免——骑乘改道/cashtag 改道各有
    // 拦截语义，iNu 案 cashtag 改道就是要拦）；②effTier S/A（世界级/头部主体）；
    // ③新产品带 ≥0.5（排除 0 档小改进/版本更新与 1 档一般新功能——裁定原文
    // 「不是版本更新」；J1.27 适配 2026-10-03 RedCoin 复验案：形状③收窄后 Jev
    // 把世界级产品发布的概率质量移向 P4/P5 高档（RedCoin P2+P3=0.47<0.5 豁免
    // 意外失效 → 43.17 偶发低分，双轮复验 high 79.06/81.37 证实），故改按
    // 1−P0−P1 计——P2「重要新功能/新产品」/P3「创新产品」/P4/P5 更高档全是
    // 产品发布档，语义与 C42 原裁定一致）；
    // ④交互已落无交互带（<10 分）——交互 ≥10 的票三轴照算，剔除反而亏分。
    // 效果：产品+时效两轴归一化百分制（÷60×100），pass 线 60 不变；wInteraction
    // 照常计算落库（审计可见）但不参与总分。mapper-only 切分，题集版本不动
    // （J1.16/J1.23/J1.24 教训：题面锚移不动 Jev 的分，代码切分才决定性）。
    const wProb = answers.w_product_score?.probabilities ?? {};
    wNewProductP = round2(1 - (wProb['0'] ?? 0) - (wProb['1'] ?? 0));
    wInteractionExempt = isW && rideMass == null && !cashtagForced
      && (effTier === 'S' || effTier === 'A')
      && wNewProductP >= 0.5
      && wInteraction < 10;
    stage2Total = wInteractionExempt
      ? round2((wProduct + timeliness) / 60 * 100)
      : round2(wProduct + wInteraction + timeliness);
    stage2Blocked = stage2Total < 60;
    const wLabel = rideMass != null ? '骑乘改道W类' : (cashtagForced ? `cashtag改道W类(${cashtagHit.cashtag})` : 'W类');
    stage2Reason = wInteractionExempt
      ? `${wLabel}·世界级主体产品豁免币安交互 产品${wProduct}+时效${timeliness}=${stage2Total}（两轴归一，pass线60）`
      : `${wLabel} 产品${wProduct}+交互${wInteraction}+时效${timeliness}=${stage2Total}（pass线60）`;
    if (stage2Blocked) stage2BlockReason = `${wLabel}总分不足（${stage2Total}<60）`;
  } else {
    tierScore = MAGNITUDE_TIER_SCORES[effTier] || 0;
    timeliness = TIMING_SCORES_STANDARD[timing] ?? 0;
    // J1.36 E 类感染力折损判据源=web3_fit（C93：event_resonance 题已删，原 C80
    // 蝙蝠侠摇案折损机制保留）：E 类且 (strong_fit+fit)<0.5（marginal 占优=Web3
    // 用户不太喜欢）→ tierScore+effDim2 两项整体 ×0.5，时效不折（新鲜是客观
    // 属性）；非 E 类 / web3_fit 答案整体缺失（J1.19 前旧缓存行 fail-open）/
    // ≥0.5 → 原公式 bit-identical。unfit≥0.5 全域负门（J1.19）已拦不归本层。
    // W 数学与骑乘改道在上分支（isW || rideMass），进入本分支的票天然不受改道
    // 干扰
    const w3fProbs = answers?.web3_fit?.probabilities;
    const hasW3f = w3fProbs != null && Object.keys(w3fProbs).length > 0;
    w3fFitMass = hasW3f ? (w3fProbs.strong_fit ?? 0) + (w3fProbs.fit ?? 0) : null;
    resonanceCoef = category === 'E' && hasW3f && w3fFitMass < RESONANCE_FIT_THRESHOLD
      ? RESONANCE_FIT_COEF : null;
    const resonanceDamped = resonanceCoef !== null && resonanceCoef < 1;
    stage2Total = resonanceDamped
      ? round2((tierScore + effDim2) * resonanceCoef + timeliness)
      : round2(tierScore + effDim2 + timeliness);
    // C86 D-1 豁免贯穿（事件分不足臂）：豁免票的 stage2Total<60 不拦，弱量级
    // 代价照常在总分（0.6×低事件分）上体现——与豁免原本「relevance 10 分照常
    // 计入」的计分语义同款。magExemptRescuedArm=D/E 档臂被豁免放行（本分支
    // tierScore=0 的票）；两臂任一被救都在 reason 落可检索标注
    const magExemptRescuedArm = magExempt && (effTier === 'E' || effTier === 'D');
    const magExemptRescuedPass = magExempt && stage2Total < 60;
    const magExemptSuffix = (magExemptRescuedArm || magExemptRescuedPass)
      ? `｜量级门豁免(${magExemptTags}：${[magExemptRescuedArm ? `${effTier}档臂` : null, magExemptRescuedPass ? '事件分<60臂' : null].filter(Boolean).join('与')}不拦，弱量级代价在总分)`
      : '';
    stage2Blocked = stage2Total < 60 && !magExempt;
    stage2Reason = `事件分${tierScore}(${effTier}档)${tierAnchored ? `·发布者指代锚(原判${tier}档)` : ''}${web3FitAnchored ? `·Web3偏好锚(原判${tier}档,strong_fit ${Math.round(web3FitStrongP * 100)}%)` : ''}+传播${effDim2}${igDim2Anchor ? `·IG影响力豁免(原${dim2})` : ''}${web3FitDim2Anchor ? `·Web3偏好传播豁免(原${dim2})` : ''}+时效${timeliness}${resonanceDamped ? `｜感染力折损×${resonanceCoef}(web3_fit契合${Math.round(w3fFitMass * 100)}%<50)` : ''}=${stage2Total}（pass线60）${magExemptSuffix}`;
    if (stage2Blocked) stage2BlockReason = `事件分不足（${stage2Total}<60）`;
  }

  const stage2DataToSave = {
    category: stage2Blocked ? 'low' : (isW ? 'W' : category),
    ...baseFields,
    parsed_output: {
      pass: !stage2Blocked,
      blockReason: stage2Blocked ? stage2BlockReason : null,
      scoringResult: {
        category: (isW || rideMass != null) ? 'W' : category,
        totalScore: stage2Total,
        tierScore: isW ? null : tierScore,
        dimension2: isW ? null : effDim2,
        timeliness,
        wProductScore: isW ? wProduct : null,
        wInteractionScore: isW ? wInteraction : null,
      },
      reason: stage2Reason,
      jev: {
        magnitudeTier: tier,
        blockChoice,
        blockProbability: blockProb ?? null,
        // C114 审计标记：图证在场 empty_content 臂失效（block 门豁免；命中才落
        // ——被覆盖的 empty_content 概率面可追溯，DND 案形状。空图证票不落键
        // =empty_content 照拦零歧义）
        emptyContentImgOverride: (blockChoice === 'empty_content' && !!context.imageEvidence)
          ? { emptyP: round2(blockProb ?? 0), noneP: round2(noneProb) } : null,
        nameReferent,
        nameReferentProbability: nameReferentProb,
        // nameReferentBlockMass 随 C108 nr 阻断位退役（历史行键保留展示）
        negativeHardNewsMass: nhnBlock?.mass ?? null,
        routineContentProductMass: rcpBlock?.mass ?? null,
        web3FitMass: w3Block?.mass ?? null,
        timing,
        // C44 审计标记：IG 影响力兜底锚命中详情（原 dim2 可追溯，锚后值在
        // scoringResult.dimension2）
        instagramDim2Anchor: igDim2Anchor ? { from: dim2 } : null,
        // C94 审计标记：B 类 + web3_fit strong_fit≥0.5 的传播轴锚命中详情
        // （原 dim2 可追溯；null=未命中——非 B 类/贴线/dim2≥18 只升不降）
        web3FitDim2Anchor: web3FitDim2Anchor ? { from: dim2 } : null,
        // C42 审计标记：世界级主体产品豁免币安交互命中详情（effTier/新产品带概率
        // 可追溯；wInteractionScore 键照常落库不受豁免影响）
        wInteractionExempt: wInteractionExempt ? { tier: effTier, newProductP: wNewProductP } : null,
        // J1.27 审计标记：产品实体接纳门命中详情（subject_entity 标注 + 接纳度
        // 可追溯；豁免票不落键）+ 币安豁免命中（C55 补充裁定，救票形状可追溯）
        productEntityBlock: peBlock ? { subject: peBlock.subject, fitMass: peBlock.fitMass } : null,
        productEntityBinanceExempt: peBinanceExempt,
        // C56 审计标记：平台官方源 rcp 门豁免命中（rcp≥0.5 被官方源豁免救回）
        rcpPlatformExempt,
        // J1.28 审计标记：referent_memeability 分数恒落（阈值事后校准免重跑，旧缓存
        // 行无此题 → null；C88 五腿 mem≥2 腿与 referentMemeabilityScore 恒落保留）；
        // referentMemeabilityBlock 命中键随 C108 拦截位退役（历史行键保留展示）
        referentMemeabilityScore: answers.referent_memeability?.score ?? null,
        subjectEntity: answers.subject_entity?.choice ?? null,
        // J1.29 审计标记：形象载体门。档位恒落（门形状事后校准免重跑，旧缓存行
        // 无此题 → null）；block 命中才落（productEntityBlock 同款模式）
        subjectCarrier: answers.subject_carrier?.choice ?? null,
        subjectCarrierBlock: scBlock ? { carrier: scBlock.carrier } : null,
        // C118 审计标记：图证载体豁免（J1.29 覆盖豁免命中才落；与 Stage3 段同形）。
        // 拦截票 stage3 段 __clear，本段是唯一落库位——DND 形状（演绎臂救回载体
        // 门后被量级门拦）在 stage2 段可归因「载体门为何没拦」，与 subjectCarrier
        // =null 的「类别不适用」区分。via=match（C109 名图一致）|depicts（C118 演绎）
        subjectCarrierImgOverride: imgCarrierOverride
          ? {
              carrier: answers.subject_carrier?.choice ?? null,
              matchP: round2(nicMatchP),
              via: nicMatchP >= 0.5 ? 'match' : 'depicts',
              depictP: depictP > 0 ? round2(depictP) : null,
            }
          : null,
        // C96 审计标记：发现 vs 转述恒落（J1.37 finding_vs_recap；旧缓存行 → null
        // ——阈值/口径事后校准免重跑）；改道详情在 stage1 jev.categoryForced
        // （'f_recap_e'）。与 stage1 恒落版双写：stage2 jev 段是信号页/校准脚本
        // 的消费位（referentMemeabilityScore 恒落同款先例）
        findingVsRecap: answers.finding_vs_recap?.choice ?? null,
        // C96/C105/C107/C108 审计标记：名字门（唯一名字拦截位）命中才落
        // （subjectCarrierBlock 同款模式）；form=Jev 原 choice（not_meme_name=
        // J1.41+ 新判 / statement·functional_label=J1.37-J1.40 旧缓存行兼容臂，
        // 归因可分）；档位恒落在 stage1 jev.nameForm
        nameFormBlock: nfBlock ? { form: nfBlock.form } : null,
        // C88 审计标记①：超级IP口号票五腿快照。恒落含 hit:false（标签零列推导消费
        // 本键：hit=true→narrativeSuperIpSlogan=1 / hit=false→0 / 键缺失（旧缓存
        // 行）→null——0/null 语义分离，referentMemeabilityScore 恒落同款）
        superIpSlogan: {
          hit: superIpSlogan,
          superIp: round2(sipProb),
          relPositive: round2(relPositiveMass),
          relNone: round2(relNoneMass),
          mem: memScoreC88,
          timing,
          strongFit: round2(web3FitStrongP),
        },
        // C88 审计标记②：memFloorBlock 命中键随 C108 拦截位退役（历史行键保留
        // 展示；C88 五腿快照 superIpSlogan 不受影响）
        // J1.36 审计标记（C93 判据源迁移）：E 类感染力折损详情。fitMass 恒落
        // （=web3_fit strong_fit+fit 概率和，J1.19 前旧缓存行无答案 → null，
        // 阈值事后校准免重跑）；系数生效（<1）才落折损详情（subjectCarrierBlock
        // 同款模式）。stage2Total/事件分不足拦截由折损后值直接承载，原值可由
        // tierScore+dimension2 反解。eventResonance 档位字段随题删除退役——
        // J1.31-J1.35 历史行的该键不再产生
        resonanceFitMass: w3fFitMass,
        resonanceDamp: resonanceCoef !== null && resonanceCoef < 1
          ? { fitMass: w3fFitMass, coef: resonanceCoef } : null,
        probabilities: {
          event_timing: answers.event_timing?.probabilities,
          dimension2: answers.dimension2?.probabilities,
          w_product_score: answers.w_product_score?.probabilities,
          w_binance_interaction: answers.w_binance_interaction?.probabilities,
          web3_fit: answers.web3_fit?.probabilities,
          subject_entity: answers.subject_entity?.probabilities,
          subject_carrier: answers.subject_carrier?.probabilities,
          name_form: answers.name_form?.probabilities,
          finding_vs_recap: answers.finding_vs_recap?.probabilities,
        },
      },
    },
  };

  // ── Stage3：截断检查 + 关联/质量 ───────────────────────────────────
  // relevance/brandHijackP/punExempt/nicMatchP/imgNameExempt 已前移至 Stage2 门链
  // 之前（C86 D-1 豁免贯穿，见上方案释）；本段只留 Stage3 专属计算
  const quality = qualityFrom(answers, symbol);
  // C108：block_misspelling noul 探针臂退役（C78 实证失效死键——Jev 答 0.13-0.27
  // 拦不住真拼写蹭；判据「无背景拼写变体」并入 notMemeNameBlock 分支④）。图文
  // 拼写对照由 C78 纯代码门独立保留（确定性代码判据）
  const spellingMismatch = detectNameImageSpellingMismatch(tokenData, twitterInfo);

  let stage3Blocked = false;
  let stage3BlockReason = null;
  // C88 超级IP口号票豁免贯穿 Stage3 双截断（品牌劫持臂+关联≤10 臂）：引申关联票
  // 不算劫持（BI 案 noul 0.56 勉强过线是 Jev 在引申/劫持边界上的保守倾斜，
  // punExempt 因 B 档差 tier 腿救不到）——与 J1.24「两层截断同豁免」同构
  if (brandHijackP >= 0.5 && !punExempt && !superIpSlogan) {
    stage3Blocked = true;
    stage3BlockReason = '品牌劫持';
  } else if (spellingMismatch.hit) {
    stage3Blocked = true;
    stage3BlockReason = `图文名不符（图内“${spellingMismatch.variant}”≠币名，无背景拼写错误）`;
  } else if (relevance.score <= 10 && !punExempt && !imgNameExempt && !superIpSlogan) {
    stage3Blocked = true;
    stage3BlockReason = `关联性不足（${relevance.score}分/${relevance.type}）`;
  } else if (quality.total <= 4) {
    stage3Blocked = true;
    stage3BlockReason = `代币质量过低（${quality.total}分）`;
  }

  let aggregatedCategory;
  let aggregatedTotalScore = null;
  let eventScore = null;

  if (stage2Blocked || stage3Blocked) {
    aggregatedCategory = 'low';
  } else {
    eventScore = round2(stage2Total * 0.6);
    aggregatedTotalScore = round2(eventScore + relevance.score + quality.total);
    aggregatedCategory = aggregatedTotalScore >= 70 ? 'high'
      : aggregatedTotalScore >= 50 ? 'mid' : 'low';
  }

  // J1.43（C109）reason 模板适配：融合形状 relevance 无 levelIdx（不落 lv 段）、
  // token_quality 单题落「长+名」（legacy 双题形状保持「长+拼+合」原样）
  const relPart = `${relevance.type}${relevance.levelIdx != null ? `/lv${relevance.levelIdx}` : ''}`;
  const qualityPart = quality.name != null
    ? `长${quality.length}+名${quality.name}`
    : `长${quality.length}+拼${quality.spelling}+合${quality.reasonability}`;

  const finalReason = stage2Blocked
    ? `阻断:${stage2BlockReason}｜P=${w3Block?.mass ?? (rideMass ?? blockProb ?? '-')}`
    : stage3Blocked
      ? `截断:${stage3BlockReason}｜品牌劫持P=${round2(brandHijackP)}`
      : `${punExempt ? '戏谑关联豁免(J1.24)｜' : ''}${imgNameExempt ? '名图一致豁免(J1.30)｜' : ''}${superIpSlogan ? '超级IP口号票豁免(C88)｜' : ''}${wInteractionExempt ? '世界级主体产品豁免币安交互(C42)｜' : ''}${igDim2Anchor ? 'IG影响力豁免(C44)｜' : ''}${web3FitDim2Anchor ? 'Web3偏好传播豁免(C94)｜' : ''}事件分${eventScore}(${stage2Total}×0.6)｜关联${relevance.score}(${relPart})｜质量${quality.total}(${qualityPart})｜总分${aggregatedTotalScore}→${aggregatedCategory}`;

  const stage3DataToSave = stage2Blocked
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
            // J1.43（C109）token_quality 单题合并子分（legacy 双题形状为 null）
            name: quality.name,
          },
          jev: {
            relevanceType: relevance.type,
            relevanceLevelIdx: relevance.levelIdx,
            brandHijackP: includeBrandHijack ? brandHijackP : null,
            // J1.24 审计标记：戏谑关联豁免命中详情（timing/档位可追溯，Jev 原判
            // brandHijackP 保留在上一键不受豁免影响）
            punExempt: punExempt ? { timing, tier: effTier } : null,
            // J1.30 审计标记：名图一致豁免命中详情（关联档位/一致性质量可追溯，
            // brand_hijack 同款「命中才落」模式——未触发不落键）
            imgNameExempt: imgNameExempt ? { relType: relevance.type, relScore: relevance.score, matchP: round2(nicMatchP) } : null,
            // C109 审计标记：图证载体覆盖命中（J1.29 豁免；命中才落——被覆盖的
            // carrier choice 与匹配质量可追溯，交易猫案形状）。C118 起 matchP=0
            // 且 depictP>0 的命中=演绎臂触发（via:'depicts'），臂来源可归因
            subjectCarrierImgOverride: imgCarrierOverride
              ? {
                  carrier: answers.subject_carrier?.choice ?? null,
                  matchP: round2(nicMatchP),
                  via: nicMatchP >= 0.5 ? 'match' : 'depicts',
                  depictP: depictP > 0 ? round2(depictP) : null,
                }
              : null,
            // C88 审计标记：超级IP口号票豁免命中（命中才落；五腿全量在 stage2
            // jev.superIpSlogan 恒落版——stage2 拦截票本段 __clear 不落）
            superIpSloganExempt: superIpSlogan ? { mem: memScoreC88, timing } : null,
            // C78 图文名不符拼写门审计（命中才落：图内近似写法可追溯）
            spellingMismatch: spellingMismatch.hit
              ? { name: String(tokenData?.name || tokenData?.raw_api_data?.name || ''), variant: spellingMismatch.variant }
              : null,
            probabilities: {
              relevance_type: answers.relevance_type?.probabilities,
              relevance_level: answers.relevance_level?.probabilities,
              ...(includeBrandHijack ? { brand_hijack: answers.brand_hijack } : {}),
              // J1.30 条件题：题已问才落（无图票题集无此题， probabilities 缺省）
              ...(answers.name_image_consistency ? { name_image_consistency: answers.name_image_consistency.probabilities } : {}),
            },
          },
        },
      };

  const stageFinalData = {
    category: aggregatedCategory,
    totalScore: aggregatedTotalScore,
    eventScore,
    relevanceScore: stage2Blocked ? null : relevance.score,
    qualityScore: stage2Blocked ? null : quality.total,
    eventWeight: 0.6,
    stage2TotalScore: stage2Total,
    blockReason: stage2Blocked ? stage2BlockReason : (stage3Blocked ? stage3BlockReason : null),
  };

  const llmResult = stage2Blocked
    ? {
        rating: 'low',
        reason: finalReason,
        score: stage2Total,
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
    + `${isW ? '-W数学' : (rideMass != null ? '-骑乘改道W数学' : '')})`;

  return {
    stage1DataToSave,
    stage2DataToSave,
    stage3DataToSave,
    stageFinalData,
    llmResult,
    promptType,
    jevDetails: { tier, timing, dim2, relevance, quality, brandHijackP },
  };
}

