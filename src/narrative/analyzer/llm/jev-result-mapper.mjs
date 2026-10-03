/**
 * Jev answers → 阶段结果映射器
 *
 * 全部确定性聚合在本文件完成（原 3 阶段管线的公式原样保留）：
 * - 量级档 S/A/B/C → 39/34/27/22（MAGNITUDE_TIER_SCORES，108 样本校准定参），D/E 档阻断
 * - 标准类 stage2Total = tierScore + dimension2(0-30) + 时效(0-20)，pass ≥ 60
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
 * superIP 路径不用此表（注册表 tier 可信，走 TIER_SCORES 预评分）。
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

/** 关联分查表：[type][levelIdx 0-4]（levelIdx = round(relevance_level.score)） */
const RELEVANCE_TABLE = {
  exact_match:      [20, 20, 20, 20, 20],
  translation_match: [18, 18, 18, 18, 18],
  abbreviation_alias: [16, 16, 17, 18, 18],
  semantic:          [8, 10, 12, 15, 15],
  cultural:          [1, 5, 10, 14, 15],
  generic_concept:   [2, 4, 6, 7, 7],
  none:              [0, 1, 2, 2, 2],
};

/** block_reason 选项 → 中文标签（reason 模板用） */
const BLOCK_LABELS = {
  none: '无阻断',
  subject_unqualified: '主体资格不足',
  niche_subculture: '小圈子亚文化',
  empty_content: '空洞内容',
  institution_routine: '机构日常运营',
  low_quality_derivative: '低质衍生',
  marketing_gimmick: '营销噱头',
  baseless_speculation: '无据猜测',
  ip_reuse: 'IP二次利用',
  regional_event: '地区性事件',
  negative_hard_news: '负面硬新闻事件',
  routine_content_product: '常规内容产品宣传',
};

/**
 * name_referent 阻断（J1.10，2026-09-23 用户裁定：截词/截名发币要成立，名字的主人
 * 得是超级 IP——被超级IP/大V提到≠名字本身有生命力）：
 * - minor_other：名字指向事件中被提到/@到/点评到的无名对象（周边小号/小公司/纠纷
 *   对象等）——YAYA（何一推文@的周边账号）、OneKey（Flork 纠纷文中的失败会展）
 * - common_word：名字取自非超级IP文本中的普通词——CONVICTION（133万粉 KOL 推文截词）
 * - notable_other：名字指向知名但非超级IP（十万粉级 KOL/行业知名公司）——同样不构成
 *   名字的独立生命力（CONVICTION 案即 133 万粉 KOL 推文截词，知名≠超级IP，不放行）
 * - super_ip（CZ 原话"not a genius"→天才）/subject_self（嫦娥：作者自创）放行
 * - super_ip 扩含「官方口号/标志性品牌主张」（J1.15，2026-09-27 用户裁定，C23
 *   货币自由案 0xced5a2ba：币安APP上线界面口号"货币自由"被第三方发现后发币，
 *   common_word 0.53 截词拦 low。裁定：口号作者=产出该口号的机构（币安），发推者
 *   只是叙事陈述者——归 super_ip 放行侧；界面功能文案仍 common_word）
 * 作用域同截词语义：C/D/F/G + **B（2026-09-24 Muse 案补入）** + **W（2026-09-25
 * ChainPulse 案补入，用户裁定「被骑对象的热度还是远远不够的，如果是超大超火的
 * 产品被骑，那没问题。但现在就是一个几千粉的用户，发了个1赞的产品介绍，被骑
 * 肯定不行的」）**：
 * - B 类：币名指向的产品/对象不是超级 IP（Muse 桌面版 0xc313：minor_other 0.32+
 *   notable_other 0.31 阻断侧合计 0.66；用户定性「只是版本更新功能改进，影响力
 *   不够」——版本更新语义在 block_reason 题面不可判，实判 none 0.98，但无论事件
 *   性质如何，骑乘非超级 IP 的产品名本身无独立生命力，由本维度拦）
 * - W 类：第三方骑乘文章/事件中的**无名构想**发币（ChainPulse 0x1fc2：3886粉
 *   1赞推文链 Article 全文不可获取，标题构想的 agent 名被第三方发币，蹭 BNB
 *   Agent Studio v4 发版；W 数学交互分 18.1 被「BNB Chain」字样喂成生态热度档、
 *   产品分 18 对标题党创意无实体约束 → 61.1 压线过；阻断侧 0.68 拦）。W 数学的
 *   交互分存在语义错位——被骑对象火反而给骑乘盘加分，与 C7「骑乘盘要求被骑
 *   产品影响力极高才放」矛盾，由名字维度补此门；super_ip≥0.5（超大超火被骑）
 *   仍在放行侧豁免，真自发盘 subject_self 高不受影响
 * - 主体自己的作品名（B/C）走骑乘改道（rideDetourBelow，放行侧语义）。E 类热点
 *   命名先例不拦；A 类不适用
 * - J1.26（2026-10-02 用户裁定，C54 狮鹫案 0xcb808ef1…7777）：**notable_other
 *   全域退出阻断侧**——裁定演化两步：①「超级IP就那么几个，名字不是它们就不行
 *   吗」；②「CONVICTION/YAYA 案的核心问题并不是实体不够知名，而是实体根本没有
 *   被接纳为 Web3 meme 币的可能——一个是一个严肃词汇（不跟实体对应），一个是
 *   个人名，只是个普通币安员工」，即「知名但非超级IP」这个知名度梯度判据本身
 *   是错的轴。正确的轴（Web3 meme 可接纳性）已由 web3_fit unfit 负门（J1.19，
 *   全域）承载：狮鹫 strong_fit 0.96 放、严肃词汇/普通人名 unfit 拦。真有独立
 *   信息的只有 minor_other（关联对象纯无名，YAYA 案）与 common_word（纯截词，
 *   CONVICTION 案——严肃词汇不跟实体对应）。阻断侧全域只累计后两项；拦截责任
 *   移交 web3_fit unfit 负门 + minor/common + magnitude/tier（热度不够）。
 *   翻案票仍需过各类事件分 60 线 + 质量门 + preBuy 全套。实测影响面：B 143 票
 *   98→52 拦（46 放）、W 88→60（28 放，含 Manus 骑乘家族）、F 26→20（6 放）；
 *   市场实证错过成本：狮鹫 7.8 分钟毕业、首→峰 12.3x
 */
const NAME_REFERENT_BLOCK_LABELS = {
  minor_other: '名字指向无名对象',
  common_word: '截词（非超级IP话中词）',
  // notable_other（知名但非超级IP）J1.26 全域移出阻断侧——label 保留仅供
  // 历史行 reason 展示参考，不再参与阻断质量累计
};
const NAME_REFERENT_BLOCK_SCOPE = ['C', 'D', 'F', 'G', 'B', 'W'];

/**
 * J1.21 指代对象 meme 价值豁免门槛（C33 MTAT 案）：超级IP转发/提及的指代对象
 * referent_memeability ≥3（内容作品有玩味点 AND 与 web3 用户有可感知共鸣的双达
 * 标下限档）→ 豁免 superIP 通道 nameReferentBlock。3 档即题面 AND 语义下限，
 * 0-2（人名/账号/严肃对象/玩味弱或圈外）维持拦截（YAYA 案形状不变）。
 */
const REFERENT_MEME_EXEMPT_MIN = 3;

/**
 * 阻断选项的类别作用域（与原各类 Stage2 prompt 的阻断条件集合对齐）：
 * - A 类（形象化IP）：主体资格不足/小圈子亚文化/低质衍生(简单替换拼贴/抄袭)/IP二次利用
 * - W/B 类：营销噱头/标题党（旧管线仅此两类设此项，校准实证设为通用会误伤 E/C 类热点推文）
 * - C/D 类：机构日常运营
 * - G 类：无据猜测
 * - E 类：地区性事件
 * - A/C/D/F/G 类：主体资格不足（J1.9 扩：小主体事件原本靠"事件分<60"下限拦截，但
 *   Jev 量级打分在 C/B 边界会漂移（OneKey 语料A：257 粉小号时过时不过），此档
 *   兜底为确定性阻断。E 类不设——热点主体按归因规则是热点主角而非搬运小号）
 * - 通用（各类均设）：空洞内容
 * Jev 在不知类别的情况下作答（speculative fan-out），代码端按分类结果
 * 条件采信——scope 外的 choice 不构成阻断（如 E 类蹭热点命名代币不算低质衍生）。
 */
const BLOCK_SCOPE = {
  empty_content: 'all',
  marketing_gimmick: ['W', 'B'],
  subject_unqualified: ['A', 'C', 'D', 'F', 'G'],
  niche_subculture: ['A'],
  low_quality_derivative: ['A'],
  ip_reuse: ['A'],
  baseless_speculation: ['G'],
  institution_routine: ['C', 'D'],
  regional_event: ['E'],
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
 * name_referent 是否在该类别下构成阻断（独立作用域表，语义同 blockInScope）。
 * 返回 {label, mass} 或 null。label 取阻断侧各项中概率最大者的标签，mass 为合计。
 * 门槛用阻断侧合计概率（≥ 0.5）而非 argmax 单项：Jev 在 YAYA 案上
 * subject_self/minor_other 五五开（0.43/0.41，argmax 跨 run 抖动），合并阻断侧
 * 质量后稳定过半。放行侧（super_ip/subject_self/none_related）不累计
 * （B/C 类例外：subject_self 质量触发骑乘改道，见 rideDetourBelow）。
 * J1.26：notable_other 全域退出阻断侧（知名度梯度是错误的判定轴，移交 web3_fit
 * unfit 负门——见 NAME_REFERENT_BLOCK_LABELS 注释），阻断侧全域只累计
 * minor_other+common_word（无名对象/纯截词，有独立拦截信息）。
 */
function nameReferentBlock(answers, category) {
  if (category == null || !NAME_REFERENT_BLOCK_SCOPE.includes(category)) return null;
  const probs = answers?.name_referent?.probabilities;
  if (!probs) return null;
  const blockKeys = ['minor_other', 'common_word'];
  let mass = 0;
  let bestKey = blockKeys[0];
  let bestP = -1;
  for (const k of blockKeys) {
    const p = probs[k] ?? 0;
    mass += p;
    if (p > bestP) { bestP = p; bestKey = k; }
  }
  if (mass < 0.5) return null;
  return { label: NAME_REFERENT_BLOCK_LABELS[bestKey], mass: Math.round(mass * 100) / 100 };
}

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
 * word_extraction 六轮措辞教训一致——Jev 分不动的边界由代码确定性切分）。仅标准路径
 * 豁免；superIP 通道不豁免（注册表账号推自己参与的常规作品宣传仍拦，C23 域语义不变）。
 */
function routineContentProductBlock(answers, category, opts) {
  if (category === 'A') return null;
  // C56 平台官方源豁免：币安/flap 等币安链原生平台官方账号发的自家内容（吉祥物
  // IP/产品公告）不算「机构日常运营」拦截对象——自家场子官方票（FlapGuy 案）。
  // 仅标准路径豁免；superIP 通道不传 opts（C23 域语义不变）
  if (opts?.platformOfficial) return null;
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
 * institution_routine / routine_content_product 子句（与 superIP 通道
 * institution_routine 豁免同语义：S/A 级平台官方号的实质内容推不算日常运营）
 * ③ 产品实体接纳门（productEntityAcceptanceBlock opts）。币安官方号在
 * superIP 注册表走快车道（本就豁免 institution_routine），此处置标准路径兜底位。
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
 * 币安同理）；④superIP 快车道不消费本题（mapSuperIPAnswers 独立 mapper，
 * phase 1 边界同 C44）。
 */
function productEntityAcceptanceBlock(answers, opts) {
  const se = answers?.subject_entity?.choice;
  if (se !== 'product_functional' && se !== 'product_character') return null;
  if (opts.pubProxyActive || opts.isW || opts.rideMass != null) return null;
  if (opts.binanceCorpus || opts.platformOfficial) return null;
  const p = answers.web3_fit?.probabilities ?? {};
  const fitMass = (p.strong_fit ?? 0) + (p.fit ?? 0);
  if (fitMass >= 0.5) return null;
  return {
    label: `产品实体未被web3买家接纳(J1.27)（${se === 'product_functional' ? '功能产品' : '产品形象'}，接纳度${Math.round(fitMass * 100)}%<50%）`,
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

/** 从 answers 提取关联分 */
function relevanceFrom(answers) {
  const type = answers.relevance_type?.choice || 'none';
  const levelIdx = clamp(Math.round(answers.relevance_level?.score ?? 0), 0, 4);
  const table = RELEVANCE_TABLE[type] || RELEVANCE_TABLE.none;
  return { type, levelIdx, score: table[levelIdx] };
}

/** 从 answers 提取质量三项（长度代码算） */
function qualityFrom(answers, symbol) {
  const length = qualityLengthScore(symbol);
  const spelling = bandInterpolate(answers.quality_spelling?.score ?? 0, SPELLING_BANDS);
  const reasonability = bandInterpolate(answers.quality_reasonability?.score ?? 0, REASONABILITY_BANDS);
  return { length, spelling, reasonability, total: round2(length + spelling + reasonability) };
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
  const category = cashtagForced ? 'W' : (answers.event_category?.choice || null);
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
  //   （量级代码判定的体系先例）。
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
  // 证据推翻「量级不足」）。仅 A 类：B 类有 pubProxy 锚、C/D/E 类量级是人物
  // 影响力/热点传播的客观规模，偏好不替代规模。
  const web3FitStrongP = answers?.web3_fit?.probabilities?.strong_fit ?? 0;
  const web3FitAnchored = !tierAnchored && category === 'A' && web3FitStrongP >= 0.5
    && tier !== 'S' && tier !== 'A' && tier !== 'B';
  const effTier = tierAnchored ? 'A' : (web3FitAnchored ? 'B' : tier);
  const timing = answers.event_timing?.choice || 'unknown';
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
  const effDim2 = igDim2Anchor ? 18 : dim2;
  const blockChoice = answers.block_reason?.choice || 'none';
  const blockProb = answers.block_reason?.probabilities?.[blockChoice];
  // 原 prompt 语义是"命中任一阻断条件即阻断"（二值）。Choice 摊成 10 路分布后
  // 9 个阻断项共享概率质量，argmax≠none 过易触发（dry-run 实证：P=0.43 即阻断）。
  // 忠实转译：P(none)≥0.5 才视为无阻断。
  const noneProb = answers.block_reason?.probabilities?.none ?? 0;
  // name_referent 阻断（J1.10）：名字指向无名对象/截词/仅知名，无论事件分多高都不通过
  const nameReferent = answers.name_referent?.choice || null;
  const nameReferentProb = answers.name_referent?.probabilities?.[nameReferent] ?? null;
  // J1.26 审计：notable_other 全域豁免（旧口径会拦、新口径放行）的形状详情——
  // minor+common < 0.5 ≤ +notable，即 notable 是唯一把质量抬过门槛的项
  let nrNotableExempt = null;
  {
    const nrProbs = answers.name_referent?.probabilities;
    const nrMinorCommon = (nrProbs?.minor_other ?? 0) + (nrProbs?.common_word ?? 0);
    const nrNotable = nrProbs?.notable_other ?? 0;
    if (nrNotable > 0 && nrMinorCommon < 0.5 && nrMinorCommon + nrNotable >= 0.5) {
      nrNotableExempt = {
        minorCommon: Math.round(nrMinorCommon * 100) / 100,
        notable: Math.round(nrNotable * 100) / 100,
      };
    }
  }

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
        magnitudeTier: tier,
        timing,
        blockChoice,
        // J1.17 审计标记：category 被代码端 cashtag 判据改写为 W（原 Jev choice 见
        // event_category probabilities），落库行可追溯改道来源
        categoryForced: cashtagForced ? 'cashtag_w' : null,
        cashtagMatched: cashtagHit?.cashtag ?? null,
        // J1.18 审计标记：发布者指代门命中详情（判据/豁免可追溯，Jev 原判 tier
        // 保留在 magnitudeTier 键不受锚定影响）
        publisherProxy: pubProxy ? { domain: pubProxy.domain, followers: pubProxy.followers } : null,
        publisherProxyActive: pubProxyActive || null,
        tierAnchored: tierAnchored ? 'A' : null,
        // J1.23 审计标记：A 类 + web3_fit strong_fit≥0.5 的偏好量级锚（Jev 原判
        // tier 保留在 magnitudeTier 键不受锚定影响）
        web3FitAnchored: web3FitAnchored ? 'B' : null,
        web3FitStrongP: web3FitAnchored ? web3FitStrongP : null,
        // J1.26 审计标记：B 类 notable_other 退出阻断侧的豁免详情（翻案票可追溯）
        nrNotableExempt,
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
  let nrBlock = null; // name_referent 阻断信息 {label, mass}（reason 展示用）
  let nhnBlock = null; // negative_hard_news 质量门信息 {label, mass}（J1.11）
  let rcpBlock = null; // routine_content_product 质量门信息 {label, mass}（J1.13）
  let w3Block = null; // web3_fit 质量门信息 {label, mass}（J1.19，Web3用户偏好）
  let peBlock = null; // 产品实体接纳门信息 {label, subject, fitMass}（J1.27/C55）
  let tierScore = 0;
  let timeliness = 0;
  let stage2Total = null;
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

  // J1.11 负面硬新闻质量门挂最前（事件性质层面的否决，优先于其他阻断展示）；
  // argmax 命中时下方 BLOCK_SCOPE 'all' 也能拦，此处覆盖概率过半但 argmax/noneProb
  // 边界抖动的情况（nameReferentBlock 同思路：合并质量对抗五五开抖动）
  // J1.13 常规内容产品宣传质量门同位双挂（C12 绣春刀3案，事件性质层面否决）
  // J1.19 Web3用户偏好质量门第三位同挂（C30 死亡观察员/太阳之勤案，受众口味
  // 层面否决——事件可有叙事价值但不合链上 meme 买家口味，热度再高也不该放）
  if ((nhnBlock = negativeHardNewsBlock(answers))) {
    stage2Blocked = true;
    stage2BlockReason = nhnBlock.label;
  } else if ((rcpBlock = routineContentProductBlock(answers, category, { platformOfficial }))) {
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
    && blockInScope(blockChoice, category)) {
    stage2Blocked = true;
    stage2BlockReason = BLOCK_LABELS[blockChoice] || blockChoice;
  } else if (!pubProxyActive && (nrBlock = nameReferentBlock(answers, isW ? 'W' : category))) {
    // J1.18 发布者指代豁免（前置 !pubProxyActive）：名字的分量由发布者知名度指代
    // （= super_ip≥0.5 放行侧同语义），notable_other「Manus 知名非超级IP」不再构成阻断
    stage2Blocked = true;
    stage2BlockReason = nrBlock.label;
  } else if (!isW && (effTier === 'E' || effTier === 'D')) {
    // 量级 D/E 档：主体量级不足，直接阻断（原各类 prompt 的 D/E 处理）
    stage2Blocked = true;
    stage2BlockReason = `事件主体量级不足（${tier}档）`;
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
    stage2Total = round2(tierScore + effDim2 + timeliness);
    stage2Blocked = stage2Total < 60;
    stage2Reason = `事件分${tierScore}(${effTier}档)${tierAnchored ? `·发布者指代锚(原判${tier}档)` : ''}${web3FitAnchored ? `·Web3偏好锚(原判${tier}档,strong_fit ${Math.round(web3FitStrongP * 100)}%)` : ''}+传播${effDim2}${igDim2Anchor ? `·IG影响力豁免(原${dim2})` : ''}+时效${timeliness}=${stage2Total}（pass线60）`;
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
        nameReferent,
        nameReferentProbability: nameReferentProb,
        nameReferentBlockMass: nrBlock?.mass ?? null,
        negativeHardNewsMass: nhnBlock?.mass ?? null,
        routineContentProductMass: rcpBlock?.mass ?? null,
        web3FitMass: w3Block?.mass ?? null,
        timing,
        // C44 审计标记：IG 影响力兜底锚命中详情（原 dim2 可追溯，锚后值在
        // scoringResult.dimension2）
        instagramDim2Anchor: igDim2Anchor ? { from: dim2 } : null,
        // C42 审计标记：世界级主体产品豁免币安交互命中详情（effTier/新产品带概率
        // 可追溯；wInteractionScore 键照常落库不受豁免影响）
        wInteractionExempt: wInteractionExempt ? { tier: effTier, newProductP: wNewProductP } : null,
        // J1.27 审计标记：产品实体接纳门命中详情（subject_entity 标注 + 接纳度
        // 可追溯；豁免票不落键）+ 币安豁免命中（C55 补充裁定，救票形状可追溯）
        productEntityBlock: peBlock ? { subject: peBlock.subject, fitMass: peBlock.fitMass } : null,
        productEntityBinanceExempt: peBinanceExempt,
        // C56 审计标记：平台官方源 rcp 门豁免命中（rcp≥0.5 被官方源豁免救回）
        rcpPlatformExempt,
        subjectEntity: answers.subject_entity?.choice ?? null,
        probabilities: {
          event_timing: answers.event_timing?.probabilities,
          dimension2: answers.dimension2?.probabilities,
          w_product_score: answers.w_product_score?.probabilities,
          w_binance_interaction: answers.w_binance_interaction?.probabilities,
          web3_fit: answers.web3_fit?.probabilities,
          subject_entity: answers.subject_entity?.probabilities,
        },
      },
    },
  };

  // ── Stage3：截断检查 + 关联/质量 ───────────────────────────────────
  const relevance = relevanceFrom(answers);
  const quality = qualityFrom(answers, symbol);
  const brandHijackP = includeBrandHijack ? (answers.brand_hijack?.noul ?? 0) : 0;
  const misspellingP = answers.block_misspelling?.noul ?? 0;

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

  let stage3Blocked = false;
  let stage3BlockReason = null;
  if (brandHijackP >= 0.5 && !punExempt) {
    stage3Blocked = true;
    stage3BlockReason = '品牌劫持';
  } else if (misspellingP >= 0.5) {
    stage3Blocked = true;
    stage3BlockReason = '无背景拼写错误';
  } else if (relevance.score <= 10 && !punExempt) {
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

  const finalReason = stage2Blocked
    ? `阻断:${stage2BlockReason}｜P=${(w3Block ?? nrBlock)?.mass ?? (rideMass ?? blockProb ?? '-')}`
    : stage3Blocked
      ? `截断:${stage3BlockReason}｜品牌劫持P=${round2(brandHijackP)} 拼写P=${round2(misspellingP)}`
      : `${punExempt ? '戏谑关联豁免(J1.24)｜' : ''}${wInteractionExempt ? '世界级主体产品豁免币安交互(C42)｜' : ''}${igDim2Anchor ? 'IG影响力豁免(C44)｜' : ''}事件分${eventScore}(${stage2Total}×0.6)｜关联${relevance.score}(${relevance.type}/lv${relevance.levelIdx})｜质量${quality.total}(长${quality.length}+拼${quality.spelling}+合${quality.reasonability})｜总分${aggregatedTotalScore}→${aggregatedCategory}`;

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
          },
          jev: {
            relevanceType: relevance.type,
            relevanceLevelIdx: relevance.levelIdx,
            brandHijackP: includeBrandHijack ? brandHijackP : null,
            // J1.24 审计标记：戏谑关联豁免命中详情（timing/档位可追溯，Jev 原判
            // brandHijackP 保留在上一键不受豁免影响）
            punExempt: punExempt ? { timing, tier: effTier } : null,
            misspellingP,
            probabilities: {
              relevance_type: answers.relevance_type?.probabilities,
              relevance_level: answers.relevance_level?.probabilities,
              block_misspelling: answers.block_misspelling?.probabilities,
              ...(includeBrandHijack ? { brand_hijack: answers.brand_hijack } : {}),
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
    jevDetails: { tier, timing, dim2, relevance, quality, brandHijackP, misspellingP },
  };
}

/**
 * superIP 快速通道映射（原 fast track 单次 LLM 的等价物）
 *
 * 与主路径的差异：
 * - 量级分不用 event_magnitude（注册表 tier 已确定：S40/A32）
 * - 时效分不用 event_timing（代码端 calculateTimeliness 已算）
 * - W 类两题不采信（superIP 是 C/D 类事件）
 * - 结果写 prestage（category='super_ip_fast'），stage1/2/3 全 __clear
 *
 * @param {Object} answers - JevClient answers（与主路径同一问题集）
 * @param {Object} context
 * @param {Object} context.superIPInfo - 注册表命中信息 {name, type, tier, desc}
 * @param {Object} context.preScores - {tierScore, timeliness, baseEventScore}
 * @param {string} context.symbol - 代币 Symbol（质量长度分用）
 * @param {boolean} [context.includeBrandHijack] - 品牌劫持预检是否命中
 * @param {Object} context.callInfo - 同 mapStandardAnswers
 * @returns {Object} { prestageDataToSave, stageFinalData, llmResult, promptType }
 */
export function mapSuperIPAnswers(answers, context) {
  const { superIPInfo, preScores, callInfo } = context;
  // prestage 单列承载，无 stage2/3 冗余，直接存完整 prompt（state+questions 全文）
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state, { full: true });
  const rawOutput = JSON.stringify({ answers, usage: callInfo.usage });

  const blockChoice = answers.block_reason?.choice || 'none';
  const blockProb = answers.block_reason?.probabilities?.[blockChoice];
  const noneProb = answers.block_reason?.probabilities?.none ?? 0;
  const dim2 = bandInterpolate(answers.dimension2?.score ?? 0, DIM2_BANDS);

  // superIP 阻断：注册表账号的日常闲聊（如 S 级人物发纯问候）没有叙事价值
  // （阻断门槛与主路径一致：P(none)≥0.5 才放行；作用域按注册表 type → C/D 类）
  // 例外：institution_routine 对注册表账号豁免——旧 fast track 语义是
  // "S/A 级账号的实质内容推文不算日常运营"（校准实证：币安中文/BNB Chain 的
  // 实质内容推被 P=0.02-0.09 的日常运营误阻断）
  const superIPCategory = superIPInfo.type === 'person' ? 'C' : 'D';
  // name_referent 阻断（J1.10）同样适用于快车道：注册表账号的量级分不能被
  // "其推文中@到/提到的无名对象"蹭走（YAYA 案例：何一推文@的周边账号名）
  const nameReferent = answers.name_referent?.choice || null;
  const nameReferentProb = answers.name_referent?.probabilities?.[nameReferent] ?? null;
  const blockedByBlockReason = blockChoice !== 'none' && blockChoice !== 'institution_routine'
    && noneProb < 0.5 && blockInScope(blockChoice, superIPCategory);
  const nrBlock = nameReferentBlock(answers, superIPCategory);
  // J1.21 内容作品豁免（C33 MTAT 案，用户裁定「要看被转发的指代对象 meme 程度，
  // 以及被 web3 用户喜欢的程度」）：超级IP转发/提及的指代对象按对象类型分流——
  // 人名/账号（YAYA 型）无内容可玩味维持拦截；内容作品 meme 玩味 + web3 契合
  // 双达标（referent_memeability ≥3，superIP 通道条件题）豁免 nameReferentBlock
  // 走正常评分管线。仅 superIP 通道（无名对象须有超级IP曝光背书才有生命力）；
  // web3FitBlock unfit≥0.5 负门独立保底不受豁免影响；分缺失（null）不豁免
  // （fail-closed：豁免是放行方向，缺数据不放行）
  const referentMemeScore = answers.referent_memeability?.score ?? null;
  const nameReferentExempt = !!nrBlock && referentMemeScore != null && referentMemeScore >= REFERENT_MEME_EXEMPT_MIN;
  const blockedByNameReferent = !!nrBlock && !nameReferentExempt;
  // J1.11 负面硬新闻质量门（全域，与标准路径同门；superIP 通道无豁免——
  // 超级 IP 的被盗/事故公告同样无 meme 空间，蹭名盘照样拦）
  const nhnBlock = negativeHardNewsBlock(answers);
  const blockedByNegativeNews = !!nhnBlock;
  // J1.13 常规内容产品宣传质量门（全域，与标准路径同门；superIP 通道无豁免——
  // 注册表账号推自己参与的常规电影/剧集宣传，蹭名盘同样拦）
  const rcpBlock = routineContentProductBlock(answers);
  const blockedByRoutineContent = !!rcpBlock;
  // J1.19 Web3用户偏好质量门（全域，与标准路径同门；superIP 通道无豁免——
  // 超级 IP 语境下同样存在不合链上买家口味的事件，蹭名盘照样拦）
  const w3Block = web3FitBlock(answers);
  const blockedByWeb3Unfit = !!w3Block;
  const blocked = blockedByBlockReason || blockedByNameReferent || blockedByNegativeNews
    || blockedByRoutineContent || blockedByWeb3Unfit;

  const prestageDataToSave = {
    category: 'super_ip_fast',
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    parsed_output: {
      pass: !blocked,
      blockReason: blocked
        ? (blockedByNegativeNews ? nhnBlock.label
          : (blockedByRoutineContent ? rcpBlock.label
            : (blockedByWeb3Unfit ? w3Block.label
              : (blockedByBlockReason ? (BLOCK_LABELS[blockChoice] || blockChoice) : nrBlock.label))))
        : null,
      dimension2Score: dim2,
      ipInfo: superIPInfo,
      tierScore: preScores.tierScore,
      timeliness: preScores.timeliness,
      baseEventScore: preScores.baseEventScore,
      jev: {
        blockChoice,
        blockProbability: blockProb ?? null,
        nameReferent,
        nameReferentProbability: nameReferentProb,
        nameReferentBlockMass: nrBlock?.mass ?? null,
        // J1.21 豁免审计：分数 + 是否豁免（nrBlock 未命中时 exempt 恒 false、
        // 分数照落库观察；标准路径无此题恒 null）
        referentMemeability: referentMemeScore,
        nameReferentExempt,
        negativeHardNewsMass: nhnBlock?.mass ?? null,
        routineContentProductMass: rcpBlock?.mass ?? null,
        web3FitMass: w3Block?.mass ?? null,
        probabilities: {
          dimension2: answers.dimension2?.probabilities,
          block_reason: answers.block_reason?.probabilities,
          name_referent: answers.name_referent?.probabilities,
          web3_fit: answers.web3_fit?.probabilities,
        },
      },
    },
    started_at: callInfo.startedAt,
    finished_at: callInfo.finishedAt,
    success: true,
    error: null,
  };

  let stageFinalData = null;
  let llmResult;

  if (blocked) {
    llmResult = blockedByNegativeNews
      ? {
          rating: 'low',
          reason: `阻断:${nhnBlock.label}｜P=${nhnBlock.mass}`,
          score: null,
          pass: false,
        }
      : blockedByRoutineContent
      ? {
          rating: 'low',
          reason: `阻断:${rcpBlock.label}｜P=${rcpBlock.mass}`,
          score: null,
          pass: false,
        }
      : blockedByWeb3Unfit
      ? {
          rating: 'low',
          reason: `阻断:${w3Block.label}｜P=${w3Block.mass}`,
          score: null,
          pass: false,
        }
      : blockedByBlockReason
      ? {
          rating: 'low',
          reason: `阻断:${BLOCK_LABELS[blockChoice] || blockChoice}｜P=${blockProb ?? '-'}`,
          score: null,
          pass: false,
        }
      : {
          rating: 'low',
          reason: `阻断:${nrBlock.label}｜P=${nrBlock.mass}`,
          score: null,
          pass: false,
        };
  } else {
    // 原 fast track 聚合公式：eventTotal = baseEventScore + dimension2
    const eventTotal = round2(preScores.baseEventScore + dim2);
    const eventWeighted = round2(eventTotal * 0.6);
    const relevance = relevanceFrom(answers);
    const quality = qualityFrom(answers, context.symbol || '');

    // superIP 同样做 Stage3 截断检查（品牌劫持/拼写/关联/质量）
    const brandHijackP = context.includeBrandHijack ? (answers.brand_hijack?.noul ?? 0) : 0;
    const misspellingP = answers.block_misspelling?.noul ?? 0;
    let truncated = false;
    let truncateReason = null;
    if (brandHijackP >= 0.5) { truncated = true; truncateReason = '品牌劫持'; }
    else if (misspellingP >= 0.5) { truncated = true; truncateReason = '无背景拼写错误'; }
    else if (relevance.score <= 10) { truncated = true; truncateReason = `关联性不足（${relevance.score}分）`; }
    else if (quality.total <= 4) { truncated = true; truncateReason = `代币质量过低（${quality.total}分）`; }

    if (truncated) {
      llmResult = {
        rating: 'low',
        reason: `截断:${truncateReason}｜事件分${eventWeighted}(${eventTotal}×0.6)`,
        score: null,
        pass: false,
      };
      stageFinalData = {
        category: 'low',
        totalScore: null,
        eventScore: eventWeighted,
        relevanceScore: relevance.score,
        qualityScore: quality.total,
        eventWeight: 0.6,
        stage2TotalScore: eventTotal,
        blockReason: truncateReason,
      };
    } else {
      const totalScore = round2(eventWeighted + relevance.score + quality.total);
      const rating = totalScore >= 70 ? 'high' : totalScore >= 50 ? 'mid' : 'low';
      llmResult = {
        rating,
        reason: `事件分${eventWeighted}(${eventTotal}×0.6:${preScores.tierScore}+时效${preScores.timeliness}+传播${dim2})｜关联${relevance.score}(${relevance.type})｜质量${quality.total}｜总分${totalScore}→${rating}`,
        score: totalScore,
        pass: true,
      };
      stageFinalData = {
        category: rating,
        totalScore,
        eventScore: eventWeighted,
        relevanceScore: relevance.score,
        qualityScore: quality.total,
        eventWeight: 0.6,
        stage2TotalScore: eventTotal,
        blockReason: null,
      };
    }
  }

  const promptType = `super_ip_fast(${superIPInfo.name}/${superIPInfo.tier}级/jev-${JEV_QUESTIONS_VERSION})`;

  return {
    prestageDataToSave,
    stage1DataToSave: { __clear: true },
    stage2DataToSave: { __clear: true },
    stage3DataToSave: { __clear: true },
    stageFinalData,
    llmResult,
    promptType,
  };
}
