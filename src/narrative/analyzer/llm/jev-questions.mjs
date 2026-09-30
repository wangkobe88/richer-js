/**
 * Jev 问题集定义（叙事分析全量迁移）
 *
 * 设计原则（对应官方 speculative fan-out 模式）：
 * - 一次调用把可能用得上的问题全部问完（含 W 类两题、品牌劫持等条件题），
 *   代码端按 event_category 结果取舍采信哪些答案
 * - 每题只做原子判断；分数聚合/阈值/截断/等级映射全部在
 *   jev-result-mapper.mjs 代码端完成（保持原 3 阶段管线的确定性公式）
 * - criteria 内容从原 2000 行 prompt 规则提炼为锚点压缩版，
 *   分档边界与原 prompt 逐档对齐（tier S/A/B/C、时效档、W 类三段式等）
 *
 * 版本：改动任何一题的 instructions/criteria 后必须 bump JEV_QUESTIONS_VERSION
 * J1.8：问题文本与 J1.7 相同；本版变更在 jev-result-mapper.mjs 的代码端量表校准
 *       （MAGNITUDE_TIER_SCORES S39/A34/B27/C22 + DIM2_BANDS 分位带，108 样本定参）
 * J1.9：block_reason 新增 word_extraction 截词选项 + subject_unqualified 扩作用域。
 *       ⚠️ word_extraction 方案已废弃（J1.10 拆独立题替代）；J1.9 无任何 DB 行产出
 *       （E1 回测期间 182 运行的是 J1.8），subject_unqualified 扩作用域在 J1.10 延续
 * J1.10：新增独立 name_referent 题（代币名指向）替代 word_extraction，移除该选项。
 *       2026-09-23 用户裁定（CONVICTION/OneKey/YAYA 案）：截词/截名发币要成立，
 *       名字的主人得是超级 IP——被超级IP/大V提到≠名字本身有生命力，知名≠超级IP。
 *       代码端按 name_referent 阻断（minor_other/common_word/notable_other 阻断侧
 *       合计概率≥0.5，scope C/D/F/G，见 mapper——CONVICTION 案照此不放行）。
 *       曾尝试在 block_reason 里加 word_extraction 复合选项，六轮措辞 Jev 均无法
 *       同时覆盖"话中截词"与"指向文中当事人但当事人无名"两种结构，拆独立题解决。
 *       subject_unqualified 扩作用域 A→A/C/D/F/G（小主体确定性兜底，防 Jev 量级
 *       在 C/B 边界漂移漏过事件分下限）
 * J1.11：block_reason 新增 negative_hard_news 选项（2026-09-26 用户裁定，C9 bitget被盗案
 *       0x0e323198：蹭 Bitget 热钱包被盗 3.516 亿官方公告命名，D 类 + A 档量级 80.32
 *       high 放行后 -55%。裁定：事件热度高≠该放——负面事故（被盗/暴雷）+纯硬新闻
 *       （无梗/无玩味空间/主体不自嘲传播）的事件无 meme 价值，蹭其命名只是消费热度。
 *       边界收窄到"安全事故/被盗/被黑/暴雷/巨额损失/灾难"，其余负面留给 Jev 自由裁量。
 *       代码端 mapper 双挂：BLOCK_SCOPE 'all'（argmax 机制全域）+ 概率 ≥0.5 质量门
 *       negativeHardNewsBlock（标准 + superIP 双路径），见 jev-result-mapper）
 * J1.12：name_referent super_ip 加双前提（2026-09-27 用户裁定，C11 哦案 0xbefe2b70：
 *       name="o"/symbol="哦"，第三方骑乘 OpenAI DevDay 传闻的 always-on assistant
 *       命名"o"（ChatGPT 内部 config 曝光、未官宣未发布），name_referent super_ip 0.81
 *       命中 C8 豁免 → B 类 S 档 80.05 high 放行。裁定「把'o'直接发成中文'哦'，感觉
 *       不行」）：①忠实呈现——币名须为该超级 IP 名字的忠实使用（原名直接出现或官方/
 *       通用标准译名），音译/形近/跨书写系统变体不算；②已官宣存在——名字所指对象须
 *       已被官方正式官宣或已公开发布，仅为传闻/泄露/内部界面曝光/未官宣计划中的名字
 *       不算。不满足前提的判 notable_other（承接语义同步写入该项 criteria）。mapper
 *       零改动（notable_other 已在阻断侧三项、scope 已含 B/C/D/F/G/W）
 * J1.13：block_reason 新增 routine_content_product（2026-09-27 用户裁定，C12 绣春刀3案
 *       0xa7c9c86e：BTCdayu 推「绣春刀3电影即将推出」，第三方骑乘华语电影系列名发币，
 *       name_referent super_ip 0.66 命中 C8 豁免 → B 类 65.95 high 放行（BUY 信号）。
 *       裁定「即使推出了，也不能作为meme币」——常规电影等内容型产品宣传与官宣与否
 *       无关，均不构成叙事事件。J1.12 双前提对本案双满足拦不住（J1.12 下重析靠
 *       notable_other 0.53 贴线拦截，非类型确定），故立独立阻断项。边界收窄：内容
 *       本身已是全民玩梗对象（名场面梗/大规模二创）不选（按 E 类热点评估）；跨世代
 *       文化符号/神话/历史人物/公共事件（孔子/嫦娥/探月）不是产品宣传不选；Web3
 *       产品（W 类）不适用；世界级颠覆性实体产品发布不选。代码端 mapper 双挂：
 *       BLOCK_SCOPE 'all' + 概率 ≥0.5 质量门 routineContentProductBlock（标准+superIP
 *       双路径），与 negative_hard_news 同构，见 jev-result-mapper）
 * J1.14：name_referent super_ip 加第③前提「实体性」+ common_word 去除「文本作者非
 *       超级IP」限制（2026-09-27 用户裁定，C13 Cz黄鞋案 0x91c4c4e9：name=symbol=
 *       「Cz黄鞋」=注册表 IP 缩写 + CZ 闲聊推文物品词拼接，superIP 快车道 S 级预评分
 *       40+15 直接喂饱 + name_referent super_ip 0.44 argmax 摇摆（common_word 0.27 被
 *       「文本作者非超级IP」限制压低）→ high 77.15 放行。J1.12 双前提双满足拦不住
 *       ——「Cz」是忠实缩写、「黄鞋」非传闻名）。裁定原话「superIP讲了一个第三方
 *       主体也没有问题，例如CZ说了Giggle肯定没问题，但是问题在于，'yellow shoes'
 *       不是什么具体实体，只是一个修饰+名词，没有具体实体对应，也没有meme元素」：
 *       ①super_ip 主定义扩含「该 IP 亲口提及/讲述的具体实体（产品/项目/公司/事件）
 *       ——提及本身即事件」（Giggle 语义，实体类型不含被@的普通人物账号，YAYA 型
 *       仍走 minor_other）；②③实体性前提——名字主体须指向具体实体，「IP名+日常
 *       物品词」拼接（Cz黄鞋）或 IP 文本中无实体对应、无 meme 元素的普通词组判
 *       common_word；③common_word 承接（去作者量级限制）。自指原话词（天才）在主
 *       定义实体性满足项内，不翻转。mapper 零改动（common_word 已在阻断侧三项）
 * J1.15：name_referent super_ip 扩含「官方口号/标志性品牌主张」（2026-09-27 用户裁定，
 *       C23 货币自由案 0xced5a2ba：币安APP更新后界面出现"货币自由"（Freedom of
 *       Money 品牌口号）字样，第三方博主发现后发币，被 J1.14 实体性前提压成
 *       common_word 0.53 → 截词拦截 low。裁定原话「币安应用中的slogan，并且口号
 *       比较强，确实这个币是应该过的。口号的'作者'并不是发推者，而是币安应用，
 *       发推者只是叙事的陈述者」）：①super_ip 主定义扩含该IP官方产出物（已上线
 *       产品界面/官网/开屏/官方公告/品牌宣传）中的官方口号/标志性品牌主张——口号
 *       作者=产出该口号的机构，发现/转述/解读口号的推文作者只是叙事陈述者，不改
 *       变归属；产品界面普通功能文案（菜单/按钮/功能名，如"提现"）无口号强度仍
 *       common_word；②前提"已官宣存在"区分：正式上线/更新后公开可见的界面口号=
 *       已公开发布（"内部界面曝光"仅指未发布产品的内部截图/泄露）；③实体性前提：
 *       官方口号/品牌主张是IP标志性资产，视为有实体对应。common_word 排除句同步。
 *       mapper 零改动（super_ip 已在放行侧）
 * J1.16：角色IP币豁免 routine_content_product（2026-09-28 用户裁定，C25 久留美案
 *       0xfedf19759ba9c45b1a8345a2bde916b38acc7777：动画《FX戦士くるみちゃん》官号
 *       （2.3万粉）先行上映会感谢+10/1开播定档推发出4.5h后，第三方发角色名币
 *       「久留美」（symbol=主角くるみ音译），J1.14 判 D类+routine_content_product
 *       0.91 → rating 1 终端 veto 拦下 BUY；实际创建后100分钟 12.6倍毕业，实验涨幅
 *       第一。裁定原话「这个不仅仅是开播剧，是里头的角色——其实是基于角色IP发的币」：
 *       作品中的角色（人物/形象）是有形象的独立IP实体，可有自身meme生命周期，角色
 *       名币≠蹭作品宣传消费上映热度，与 C12 绣春刀案（币名=电影系列名，纯消费上映
 *       热度）机制不同。三处改动：①event_category 主体归属新增规则——代币名指向
 *       作品中角色（角色名而非作品名）→主体=该角色、类别A（形象IP），作品官方宣传
 *       推只是角色语料载体；②block_reason routine_content_product 边界收窄——角色
 *       名币不选本项，改A类评估；③event_magnitude A类语义锚定——角色按自身及关联
 *       IP知名度定档，未开播/未出圈角色=无名IP低档（官号粉丝数≠角色知名度）。把关
 *       交给A类数值门：本案按A轴 C档22+dim2 18.64+时效15=55.64<60 仍拦（量级不足），
 *       知名/爆梗角色B档以上（≥60.64）可过线。mapper 零改动（A类不在
 *       NAME_REFERENT_BLOCK_SCOPE；rcp 概率门随 Jev 判定自然放行；A类 D/E 档量级
 *       拦截承接无名角色）。10/1 开播为自然验证点：角色爆梗→B档通道实证；无声息→
 *       归档开播抢跑盘（台账§六未决跟踪）
 * J1.17：问题文本与 J1.16 相同；本版变更在 jev-result-mapper 代码端——cashtag 改道
 *       （2026-09-28 用户裁定，C28 iNu案 0xf578b84ba599b44baea6d766e5cb3421a77a7777：
 *       32.7万粉 KOL @theunipcs 回复 "$INU"（讨论 RH Chain 上 @iNuApple 的另一个
 *       INU 代币）14 秒后 BSC 蹲号盘 iNu 出生，C 类 0.52 压过 W 0.25 → 67.4 过线
 *       high 放行。裁定原话「推文里面有明确的代币ticker，那么肯定说的是一个web3
 *       资产了，应该走W」）：语料推文（含被回复父推）出现与币名归一化全等的
 *       $TICKER cashtag → 强制按 W 类数学评分（被骑资产影响力须极高，小项目
 *       w_product 低分拦截），Jev event_category 概率不再有决定权。判据纯代码
 *       （detectCorpusCashtag，narrative-utils），无新题
 * J1.18：name_referent super_ip 加「发布者指代」分支（2026-09-29 用户裁定，C29
 *       Cue/Manus 案 0x5074546cb787d5a698ec8e9a1734e33a3fae7777：Manus 官宣独立
 *       新产品 Cue，第三方骑乘发币被 notable_other 0.5（Manus=知名非超级IP）+
 *       阻断侧 0.80 拦截。裁定原话「骑乘第三方产品，必须满足两个条件，一个是
 *       产品本身不是简单"更新"，而是独立产品发布，或者重大升级；第二，就是
 *       产品的影响力，新产品往往由产品发布者指代，这里Manus是可以作为大IP的
 *       （在AI领域已经很有名气）」）——骑乘第三方产品的成立条件细化为两条：
 *       ①独立产品发布或重大升级（版本更新/功能改进/新平台移植不算，C8 v3
 *       Muse 桌面版语义维持拦截）；②产品影响力由发布者指代——发布者是该产品
 *       所属领域具有显著知名度的机构/人物（领域知名即算，不要求世界级），其
 *       发布的独立新产品/重大升级按 super_ip 评估（放行侧），后续走标准数学
 *       按发布者量级计分。notable_other 承接句同步（版本更新仍判本项阻断）。
 *       主挂点同步嵌入 B 类评分标准（用户裁定「把这个逻辑嵌入到B类评分标准中」）：
 *       event_magnitude B 类语义锚定——新产品（尚无自身影响力积累）的分量由产品
 *       发布者（产品方，非语料作者）指代：领域知名大IP→A档起/普通知名公司→B档/
 *       无名发布者→C档以下；仅「独立新产品发布/重大升级」构成B类叙事事件，版本
 *       更新/功能改进/新平台移植（桌面版/mobile版/v2迭代，Muse桌面版型）→E/D
 *       阻断档（C8 v3「版本更新 block_reason 不可判」的判定迁移：语料明示版本
 *       字样时量级题与 name_referent 双侧可判）。dimension2 B 类同步句（新产品同
 *       按发布者指代定档、版本更新按低档）。内容型产品不适用发布者指代——rcp 门
 *       （J1.13）独立于量级门拦截，C12 绣春刀裁定维持。
 *       mapper 代码门（detectPublisherProxy 四判据：官方域名 stem=币名 + 作者粉
 *       丝≥10万 + 币名与作者名互不包含 + 无版本指纹词）：题面措辞实证 Jev 执行不
 *       下去（super_ip 0.16→0.31 压不过 0.5、magnitude 稳定 B 档），J1.16 先例——
 *       Jev 分不动的边界由代码确定性切分。pubProxyActive 时（仅 B/C 域，cashtag
 *       改道优先）：nameReferentBlock/骑乘改道/marketing_gimmick argmax 三处豁免
 *       + 量级 A 档锚（effTier，S 不降 A 原判不动）+ stage1 审计标记
 *       publisherProxy/tierAnchored（Jev 原判 tier 保留在 magnitudeTier 键）
 * J1.19：新增独立第 14 题 web3_fit（2026-09-29 用户裁定，C30 死亡观察员/太阳之勤案
 *       0xd2a6d440…7777 / 0xe5fa214f…7777：两票均为抖音爆款视频票——「AI死亡
 *       短片 44.7万赞」「范小勤抽象梗 13.7万赞」，pre-check video_unrated 爆款
 *       短路（点赞≥10万 → 不进Jev直接mid）放行后 Web3 用户不买账阴跌（各实验
 *       净 -0.245 / -0.267）。裁定原话「Web3用户是不会喜欢的，不符合用户胃口」：
 *       Web2 传播热度 ≠ Web3 用户偏好——链上 meme 买家（BSC 发射平台，华语
 *       crypto 圈为主）喜欢动物萌宠/币圈梗/AI/知名IP/可玩味乐子梗，不喜欢消费
 *       弱势真人的土味网红梗、丧文化阴郁主题、纯内容欣赏无玩梗空间。两处配套：
 *       ①本版新增 web3_fit（strong_fit/fit/marginal/unfit 四档独立题，语义独立
 *       不并入 block_reason 的「无叙事价值」语义）；②pre-check 规则 3 爆款短路
 *       收窄——有可读推文文本（推文已描述视频内容，「内容无法解析」不成立）时
 *       不再短路，进 Jev 完整评估；无可读语料才维持爆款 mid 短路。
 *       mapper：web3FitBlock 质量门（unfit 概率 ≥0.5 → rating 1，与
 *       negativeHardNewsBlock 同构：全域 + 标准/superIP 双路径），marginal 不拦
 *       概率落库观察。历史口径支撑：video_unrated 27 成交票净 +7.6 全靠熊猫
 *       +7.78 / 大头混子 +7.40（动物萌宠/可玩抽象）两张撑，其余 25 票全亏
 *       -7.58——偏好层「赢放亏拦」即该口子的正确过滤网
 * J1.20：event_magnitude/dimension2 陈述者两形状分流（2026-09-30 用户裁定，C32 正龟案
 *       0x969c6981…7777：A股「允许银行贷款入市」新规发布，语料是 4 粉小号对 14.6 万粉
 *       财经博主父推的找角度回复（谐音梗「正龟」=正经股票+龟速爬涨），J1.19 判
 *       C 档（criteria「第三方小号」字面锚定陈述者，score 2.27 概率 argmax 却是
 *       B 0.42，Jev 在题面矛盾中置信 0.33）→ 事件分 58.2<60 拦下；实际 7 分钟
 *       ×10.6 毕业。用户定性原话「这个 case，陈述的是一个与发推者/回复者无直接
 *       关系的事件，它俩只是陈述者罢了（叙事陈述者），事件的主体是A股」。
 *       落地（每档 criteria 双锚）：instructions 主体判定规则显式两形状——
 *       形状① 陈述者关联事件（事件=陈述者本人言行/作品/声明）→ 主体=陈述者，
 *       按其粉丝量级定档（原语义正确保留）；形状② 陈述者无关联、只是陈述者
 *       （事件=外部热点/监管政策/平台现象）→ 主体=事件本身，按事件自身传播
 *       规模定档，陈述者粉丝数既不代表也不封顶；回复/转述语料按父推/源头定
 *       形状，父推本身就是事件传播证据（十万粉级以上父推陈述=被大V扩散证据
 *       计入事件传播规模），回复者粉丝数不参与定档；E 类升级规则同步（被大V
 *       主动报道含父推）。C 档「无源可溯最高到此档」封顶保留——7777 家族无主
 *       作业票谎称热点仍被 C 档封顶。dimension2 同形状分流引用。mapper 零改动
 */

export const JEV_QUESTIONS_VERSION = 'J1.20';

/**
 * 品牌劫持关键词预检表（自 stage3-token-analysis.mjs V21.0 迁入，规则原样）
 * 代币 Symbol/Name（去 emoji/数字/特殊字符后）命中任何一项时才向 Jev 提出
 * brand_hijack 问题，否则省略（省 token、避免无品牌代币被误判）。
 */
const BRAND_HIJACK_KEYWORDS = [
  // A类：头部知名代币
  'btc', 'bitcoin', '比特币', 'eth', 'ethereum', '以太坊', 'bnb', 'sol', 'solana',
  'xrp', 'doge', 'dogecoin', 'pepe', 'shib', 'usdt', 'usdc', 'link', 'uni', 'aave', 'floki',
  // B类：全球级名人
  'cz', '赵长鹏', 'elon', 'musk', '马斯克', 'trump', '特朗普',
  'vitalik', '何一', '孙宇晨', 'sbf',
  // C类：头部知名机构
  'binance', '币安', 'coinbase', 'openai', 'google', '谷歌',
];

/**
 * 检查代币名是否命中品牌劫持预检（决定是否问 brand_hijack 题）
 * @param {string} symbol - 代币 Symbol
 * @param {string} name - 代币 Name
 * @returns {boolean}
 */
export function shouldIncludeBrandHijackCheck(symbol, name) {
  const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') // 移除emoji
      .replace(/\d/g, '')                     // 移除数字
      .replace(/[^a-z\u4e00-\u9fff]/g, '');   // 只保留小写字母和中文
  };

  const normalizedSymbol = normalize(symbol);
  const normalizedName = normalize(name);

  return BRAND_HIJACK_KEYWORDS.some(kw =>
    normalizedSymbol.includes(kw) || normalizedName.includes(kw)
  );
}

/** 时效 6 档（标准类换算：15/10/0/10/5/0；W 类换算：25/15/0/15/0/0） */
export const TIMING_OPTIONS = [
  'within_7d', 'within_30d', 'older',
  'expected_within_30d', 'expected_beyond_30d', 'unknown',
];

/**
 * 构建主路径问题集（standard 模式，superIP 模式复用同一问题集）
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeBrandHijack] - 是否包含品牌劫持题
 *   （仅当代币名命中 BRAND_HIJACK_KEYWORDS 预检时为 true，代码端在
 *   jev-result-mapper 的 shouldIncludeBrandHijackCheck 控制）
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildStandardQuestions(options = {}) {
  const includeBrandHijack = options.includeBrandHijack === true;

  const questions = {

    // ── 1. 事件分类（原 Stage1，8 类 + 边界规则；英文——文档标注英文最佳，校准实证中文边界规则下 50% 样本分类漂移）──
    event_category: {
      type: 'choice',
      instructions: `Event classification. Select the single best category for the event constituted by this tweet/content.
Priority when multiple could apply: A > W > B > F > G > C > D > E.
Key discriminating signals:
- E = a trend or viral content spreading NOW on some platform (meme, challenge, hot post, trending topic). The tweet merely reports or rides content that is already hot.
- F = the author presents THEIR OWN finding: a hidden pattern, data insight, or narrative connection they claim to have discovered. Even if the finding is about trending content, an original discovery claim is F, not E.
- G = a PREDICTION about a future event, with some reasoning but insufficient evidence.
- C = a statement or action by an INDIVIDUAL person speaking personally (a personal account, even if that person is a CEO — unless posting as the institution's official mouthpiece).
- D = an announcement or action by an INSTITUTION's official account (company or organization official channel).
- W = a blockchain/crypto product launch or update (token, DeFi, NFT, public chain, infra tool, protocol).
- B = a non-Web3 product launch or update (app, game, hardware, website, consumer product).
- A = a visual IP: meme character, mascot, virtual image, cartoon IP, emoji-pack character.
Subject attribution rules (critical):
- angle-seeking tweet / interpretive reply: the event subject is the ORIGINAL event being leveraged or interpreted, NOT the tweet author.
- tweet reporting or relaying an external hot event: subject = the hot event's protagonist, not the relayer.
- tweet about the author's own content/work/statement: subject = the author (only then does the author's follower count represent event magnitude).
- token named after a CHARACTER inside a work (anime/manga/game/film character: token name = the character's own name, NOT the work's title): subject = that character as a visual IP → category A. The work's official promo/announcement tweet is merely the corpus source for the character — it does NOT make the event an institutional product announcement (D) or a routine content-product promo. Judge the character's own IP notability and meme evidence; an unknown / not-yet-aired character is a low-tier IP.`,
      criteria: {
        A: 'Visual IP: meme character / mascot / virtual image / cartoon IP',
        W: 'Web3 project: blockchain/crypto launch or update (token/DeFi/NFT/chain/tool)',
        B: 'Non-Web3 product: app/game/hardware/website/consumer product launch or update',
        F: 'Discovery: hidden pattern / data insight / narrative finding, evidence-backed, author-discovered',
        G: 'Speculation: future prediction with reasoning but insufficient evidence',
        C: 'Personal statement: an individual speaking personally (not as institutional official mouthpiece)',
        D: 'Institutional action: official account announcement/action of a company or organization',
        E: 'Social hotspot: trend/viral content spreading on social platforms now',
      },
    },

    // ── 2. 事件主体量级（原 Stage2 维度一，6 档有序）──────────────────
    event_magnitude: {
      type: 'score',
      instructions: `事件主体量级（原各类Stage2维度一分量等级），从低到高评估。
⚠️ 主体判定规则（最重要）：主体=事件本身的核心实体，不一定是发推人。先分清两种形状（J1.20）：
形状① 陈述者关联事件——事件就是陈述者（发推人/被回复者）本人的言行/作品/声明/行为 → 主体=该陈述者本人，按其粉丝量级/知名度定档
形状② 陈述者无关联、只是陈述者——事件是外部实体（外部热点/他人事件/监管政策/平台现象），陈述者只是报道/搬运/评论/找角度 → 主体=该外部事件本身，按事件自身的传播规模定档，陈述者的粉丝数既不代表也不封顶事件量级
- 推文报道/搬运/讨论外部热点（某视频在抖音爆火、某事件上微博热搜、某大新闻/全国性政策新规）→ 形状②：主体=该热点事件的主角/发起方，按热点的传播规模定档，发推人只是信息搬运者，其粉丝数不代表事件量级
- 推文是作者自己的内容/作品/声明 → 形状①：主体=作者（此时才看发推人粉丝数/认证）
- 找角度/解读型推文 → 形状②：量级针对被借势/被解读的原始事件主体，不是发推人
- 回复/转述/引用型语料 → 按被回复父推/被转述源头所陈述的事件定形状与主体；父推/源头本身就是事件的传播证据（十万粉级以上父推主动陈述该事件=事件被大V扩散的证据，计入事件传播规模），回复者本人的粉丝数不参与定档
量级含义按事件类别（分类见event_category题）：
- A类（形象化IP）=IP/形象的知名度；角色（作品人物）按该角色自身及其关联IP的知名度定档——未开播/未出圈的角色=无名IP低档，作品官号粉丝数是宣传渠道数据不是角色知名度证据；B类（非Web3产品）=发布方地位+产品影响力——新产品（尚无自身影响力积累）的分量由产品发布者（产品方，非语料作者）指代：按发布者在该产品所属领域的知名度定档（领域知名大IP→A档起，如AI领域知名公司发布全新agent产品；普通知名公司→B档；无名发布者→C档以下）；仅「独立新产品发布/重大升级」构成B类叙事事件——现有产品的版本更新/功能改进/新平台移植（桌面版/mobile版/v2迭代，Muse桌面版型）不构成事件→E/D阻断档；C/D类=人物/机构影响力；E类（社会热点）=热点传播量级；W类不适用本题
E类无量化数据时的升级规则（仅有定性描述时）：
- 强热度词（爆火/热搜/疯传/大爆/持续发酵）/主流平台持续有新内容/跨语言地域传播/用户自发二创模仿/被KOL大V主动报道（含十万粉级以上父推对本事件的陈述）——任意2项→至少B档；仅1项→C档；0项→D档以下
B类第三方限制：发布方是第三方小号（非产品官方）且影响力低→最高C档，除非第三方本身是世界级/知名机构人物`,
      criteria: [
        'E档：完全无热度/无价值——无可识别事件主体、无传播、无独特性（各类阻断档）',
        'D档：小主体——①陈述者关联：粉丝<1万普通创作者/小型不知名媒体/无特色产品；②陈述者无关：地区性本地事件/仅个别人提及的外部小事（各类阻断档）',
        'C档：一般主体——①陈述者关联：粉丝<4万的普通KOL/第三方小号/普通个人创作/小项目；②陈述者无关：社区级讨论/小圈子传播的热点；事件主体无法从语料与常识追溯（无源可溯）时最高到此档',
        'B档：知名主体——①陈述者关联：粉丝>4万的KOL或知名个人/知名中小IP/普通公司有特点产品/中型机构；②陈述者无关：平台级热点爆款（百万级传播：播放100万+或点赞50万+）/被十万粉级以上KOL主动报道扩散的事件',
        'A档：头部主体——①陈述者关联：知名大IP/知名公司或行业影响力产品/全国级人物或大型机构；②陈述者无关：全国级热点（千万级传播/全国热搜/全国性监管政策与市场事件）',
        'S档：世界级——全球性IP/世界级公司或颠覆性产品/世界级名人/顶级机构（币安/OpenAI级）/全球热点（亿级传播/全球热搜），两种形状同一口径',
      ],
    },

    // ── 3. 事件时效（原 Stage2 时效项，6 档；分数代码端换算）─────────
    event_timing: {
      type: 'choice',
      instructions: `事件时效（timing relative to now）。以当前时间为基准判断事件的发生时间。预期型=尚未发生的未来事件。
E类（社会热点）按发酵状态定档：正在发酵/传播进行中→within_7d档；仍是持续热点但热度已过峰值→within_30d档；已过气→older档`,
      criteria: {
        within_7d: '事件已发生，且发生在7天内',
        within_30d: '事件已发生，发生在7-30天前',
        older: '事件已发生，超过30天',
        expected_within_30d: '未来事件，预期30天内发生',
        expected_beyond_30d: '未来事件，预期超过30天才发生',
        unknown: '无法判断',
      },
    },

    // ── 4. 维度二：主体影响力/传播权重（原各类 Stage2 第二维度，0-30）─
    dimension2: {
      type: 'score',
      instructions: `事件第二维度：主体影响力/传播权重加分（原各类Stage2维度二，0-30分）。
⚠️ 与event_magnitude同主体：两题评估同一主体，档位应基本一致（magnitude给高主体本维度也给高档），不要在这题重新贬低主体。同按event_magnitude的两形状分流（J1.20）：陈述者无关联、只是陈述者时，本维度评估的是外部事件主体自身的传播规模，陈述者（发推人/回复者）的粉丝数与互动数据既不代表也不封顶；回复/转述语料按父推/源头所陈述事件的传播计（十万粉级以上父推陈述=事件被大V扩散的证据）。
各类别语义：
- A类（形象化IP）=IP方权重：看创作者/关联IP的知名度——世界级IP 30/知名IP 20-25/KOL>4万粉 18-22/普通KOL 12-17/普通创作者 8-11/新账号 5-8；关联名人IP按该IP知名度定档（如吉祥物蹭总统选举IP→按世界级算）
- B类（非Web3产品）=发布方权重（发布方本身的影响力）：世界级公司25-30/领域知名机构约22/知名个人约20/普通团队8-15/小号约8；新产品尚无自身影响力数据时同按发布者指代定档（与event_magnitude同口径，如AI领域知名公司→20-24带），版本更新/功能改进/新平台移植语料按低档
- C/D类=人物/机构影响力权重：直接看事件主体的粉丝量级与身份——世界级名人/顶级机构25-30、知名人物/大型机构20-24、十万粉级15-19、万粉级10-14、千粉及以下5-9（形状②外部事件主体：按事件传播规模对标同分带，如全国级政策/市场事件=全民话题级25-30）
- E类（社会热点）=热点传播量级：看热点在源头平台的传播（播放量/讨论度/出圈/二创），不看发推人/回复者的互动与粉丝数据（回复语料按父推/源头传播算）；推文描述的"爆火/热搜/疯传"直接采信
- F/G类=主体影响力权重（同C类语义）
- W类不适用本题（W类独立计分）`,
      criteria: [
        '0-4分：无——无名主体/零影响力/零互动/无传播',
        '5-9分：微弱——新账号/小号/千粉以下/极小范围传播',
        '10-14分：小——万粉级/普通KOL/小圈子传播/有限讨论',
        '15-19分：中——十万粉KOL/中型机构/中等传播/有讨论度和跟风',
        '20-24分：强——知名IP/大V/大型机构/多级扩散/持续发酵',
        '25-30分：极强——世界级IP/顶级机构/全民话题/病毒式传播/大规模二创',
      ],
    },

    // ── 5. 硬阻断（原各类 Stage2 阻断条件合集，12 选项；J1.11 加 negative_hard_news，J1.13 加 routine_content_product）──
    block_reason: {
      type: 'choice',
      instructions: `硬阻断检查（hard-block check）。该事件是否命中任一硬阻断条件？未命中选 none。
阻断=事件本身无叙事价值/无传播潜力，无论分数多高都不能通过。`,
      criteria: {
        none: '无阻断——事件有明确主体和内容，有叙事价值',
        subject_unqualified: '主体资格不足——事件主体（注意：是事件本身的核心实体，报道外部热点的推文其主体是热点主角而非发推人）粉丝<1万且无认证且非知名IP',
        niche_subculture: '小圈子亚文化——圈内梗/黑话，圈外人无法理解，无出圈可能',
        empty_content: '空洞内容——纯问候/感叹/日常闲聊，无具体事件或设定',
        institution_routine: '机构日常运营——机构的例行推文：问候/转发/回复/无信息量互动。⚠️ 实质性内容不算：产品发布/功能更新/政策公告/数据报告/合作消息都是有信息量的实质事件',
        low_quality_derivative: '低质衍生——对现有IP/热点的简单替换/拼贴/抄袭/模仿',
        marketing_gimmick: '营销噱头——无任何实质产品/事件信息，纯标题党/引流/蹭热点包装（有具体产品或事件内容的推文不算）',
        baseless_speculation: '无据猜测——预测没有任何推理依据支撑',
        ip_reuse: 'IP二次利用——直接使用现有知名IP但活动无重大传播力（活动有重大传播力则不算）',
        regional_event: '地区性事件——仅特定地区有感知，无更大范围影响',
        negative_hard_news: '负面硬新闻——安全事故/被盗/被黑/暴雷/巨额损失/灾难类负面事件，语料是事故通报/官方公告/新闻报道。事件无meme化玩味空间：主体是机构/平台（不会参与自嘲式传播），无梗、无二创动力，蹭此类事件命名的名字无独立叙事生命力（热度再高也不算叙事价值）。⚠️ 仅限该窄边界：监管罚款/项目失败/名人去世等其他负面不选本项，按事件实际叙事价值正常评估',
        routine_content_product: '常规内容产品宣传——电影/剧集/综艺/动漫/小说/游戏等常规内容型产品的发布/上映/定档/预告/官宣消息。观众是消费者而非玩梗社区：无二创动力、无meme玩味空间，蹭其命名只是消费上映/上线热度——即便作品已官宣已上映、即便系列国民级知名也不构成叙事事件（产品知名度≠该放，同负面硬新闻语义：蹭其命名无独立叙事生命力）。⚠️ 边界收窄：代币名指向作品中的角色（人物/形象，含角色名的音译/译名形式，如くるみ↔久留美/Kurumi——不以字符字面一致为条件）而非作品名本身时必不选本项：即使推文内容本身是作品的宣传/定档消息，角色名币的叙事主体是该角色而非作品宣传——角色是有形象的独立IP实体、可有自身meme生命周期（角色名币≠消费作品上映热度），改按A类（形象IP）评估该角色自身的知名度与玩梗证据（无名/未出圈角色由A类量级门拦截把关）；内容本身已是全民玩梗对象（名场面梗/梗图泛滥/大规模二创模仿）不选本项（按社会热点正常评估）；跨世代文化符号/神话/历史人物/公共事件（如孔子、嫦娥、探月工程）本身不是产品宣传，不选本项；Web3产品不适用本题；世界级颠覆性实体产品/平台发布（硬件/平台级）不选，按实际影响力正常评估',
      },
    },

    // ── 5.5 Web3 用户偏好契合（J1.19 独立题，事件层受众判断，代码端 unfit≥0.5 质量门拦截）──
    web3_fit: {
      type: 'choice',
      instructions: `Web3用户偏好契合度（web3 meme buyer fit）。判断事件主题与meme币链上买家群体的口味契合度——不是事件影响力大小。
链上买家画像（BSC meme发射平台真实用户群）：以华语crypto圈为主、全球meme玩家参与；玩梗文化、乐子导向、财富叙事；买的是「能玩、能二创、能传播」的主题。
判据核心两问：①这个主题能否被链上买家玩梗/二创/自嘲式传播（有形象、有梗、有乐子）？②事件受众与crypto圈是否重叠？
强契合典型：动物/萌宠形象（猫狗蛙熊猫等）、币圈自嘲与财富叙事（梭哈/归零/韭菜）、马斯克/CZ/币安等币圈名人梗、AI前沿话题、知名IP/角色/梗图、有形象可二创的乐子梗。
不契合典型：消费具体弱势真人的土味网红梗（如范小勤/小马云型）、死亡/疾病/器官等阴郁丧主题、纯内容欣赏无玩梗空间（影评式赞叹「立意很好值得一看」）、严肃社会议题、纯人名无形象无梗、娱乐圈八卦、受众与crypto圈完全不重叠的领域热点。
⚠️ 传播数据（点赞/播放量）大小不是本题判断依据——只问主题本身合不合Web3用户口味；Web3产品/币圈事件（W类）天然强契合。`,
      criteria: {
        strong_fit: '强契合——动物萌宠/币圈梗/AI前沿/马斯克CZ币安/知名IP角色/大众乐子梗，链上买家天然喜欢',
        fit: '契合——有形象或有玩味空间，受众与crypto圈重叠',
        marginal: '边缘——有部分契合要素，但主题小众或玩味空间有限',
        unfit: '不契合——土味网红消费真人/丧文化阴郁主题/纯内容欣赏无梗/严肃议题/纯人名无形象/受众与crypto圈不重叠',
      },
    },

    // ── 6-7. W 类专用（产品分 0-35 + 币安交互 0-40，仅 W 类采信）─────
    w_product_score: {
      type: 'score',
      instructions: 'Web3产品分（仅当事件是Web3项目发布/更新时评估）。产品事件的重要程度，0-35分。',
      criteria: [
        '0-8分：小改进/边缘更新（改进型事件基线5分）',
        '9-17分：一般新功能（新功能基线12分+重要性低）',
        '18-26分：重要新功能或有特点的新产品（新产品基线20分+特点5-9分；或12分+重要性高）',
        '27-35分：创新产品（新产品20分+创新性10-15分）',
      ],
    },
    w_binance_interaction: {
      type: 'score',
      instructions: `币安交互分（仅Web3项目评估），0-40分。
⚠️ 仅在Four.meme发射不算交互；BSC核心平台（Four.meme/PancakeSwap/Thena）自身发布算交互。`,
      criteria: [
        '0-9分：无交互——仅Four.meme发射/仅提及币安无实际交互',
        '10-19分：生态热度——币安旗下平台火了/与币安生态间接关联',
        '20-29分：明确交互——与币安有交互记录（合作/活动/上币相关）',
        '30-40分：深度交互——深度合作25-34分；币安官方直接交互/公告35-40分',
      ],
    },

    // ── 8-9. 关联性（原 Stage3 第一大项）─────────────────────────────
    relevance_type: {
      type: 'choice',
      instructions: `代币名与事件的关联类型（token-event relevance type）。
检查代币的Symbol和Name（去emoji/数字/特殊字符后）与事件核心词的关系，选最强的一种类型。
⚠️ 泛化概念预检：代币名是抽象概念（AI/LOVE/meme/PEACE等）或行业大类词时选 generic_concept（上限3-7分），除非该概念就是事件的核心主题。`,
      criteria: {
        exact_match: '完全匹配——代币名与事件核心词完全一致（含"代币即产品本身"的情况）',
        translation_match: '中英文对应——代币名是事件核心词的另一语言形式（trump=特朗普）',
        abbreviation_alias: '缩写/别名/绰号——首字母缩写（MAGA）、数字缩写（K/M/B）、外号',
        semantic: '语义关联——主题相关但名称不同（同一话题/同一事件要素）',
        cultural: '文化关联——梗文化/圈层文化上的关联，非字面关联',
        generic_concept: '泛化概念——抽象概念/行业大类，任何事件都能蹭',
        none: '无关联——代币名与事件没有任何关系',
      },
    },
    relevance_level: {
      type: 'score',
      instructions: '代币与事件的关联强度等级（relevance strength，无→完美）。',
      criteria: [
        '无：完全没有关联',
        '弱：勉强沾边，需要解释才能看出联系',
        '中：能自然看出联系',
        '强：联系紧密，见名即知事件',
        '完美：名称即事件核心词本身',
      ],
    },

    // ── 10. 代币名指向（J1.10：名字的主人量级决定名字价值，代码端按指向阻断）──
    name_referent: {
      type: 'choice',
      instructions: `代币名指向谁（name referent）——判定代币 Symbol/Name 实际指代对象的身份量级，不是事件热度。
名字的价值由名字的主人决定：主人是超级IP→名字有独立meme生命力；主人无名或仅知名（非超级IP）→名字只是蹭事件热度。`,
      criteria: {
        subject_self: '事件主体/作者自己——名字=主体（或推文作者）的名称/自称/外号/作品/原创梗，且名字出自其本人的文本/背景（含解读型作者自创的说法）。⚠️ 若名字指向的主体本身是无名对象（小号/普通人/小公司/周边人物），且名字来自第三者（哪怕超级IP/大V）报道/提到/@到该对象的文本→不算本项，应选 minor_other',
        super_ip: '超级IP本人——名字直接指向世界级名人/顶级机构（币安/OpenAI级）/全球性IP/全国级人物或国民级IP，或按发布者指代指向领域知名大IP发布者的独立新产品/重大升级（⚠️ 此分支不要求世界级：发布者为该产品所属领域具有显著知名度和影响力的机构/人物即算（如AI领域知名公司、其官号粉丝数十万级），新产品尚无自身影响力积累，其名字的分量由发布者的知名度指代——发布者知名度即转移给新产品名；名字本身是日常词汇不影响（产品官宣/官方域名即为其实体对应）；「独立新产品/重大升级」不含现有产品的版本更新/功能改进/新平台移植（如"桌面版/mobile版/v2上线"——Muse桌面版型，那些不满足发布者指代，仍按 notable_other 评估））（含其关于自己的原话词，如名人原话"我不是天才"→代币"天才"；含该超级IP亲口提及/讲述的具体实体——产品/项目/公司/事件，超级IP的提及本身即事件，如CZ提到的某产品名；含其官方产出物（已上线产品界面/官网/开屏/官方公告/品牌宣传）中的官方口号/标志性品牌主张——口号的作者=产出该口号的机构本身，发现/转述/解读该口号的推文作者只是叙事陈述者，不改变名字归属（如币安APP正式上线界面的品牌口号"货币自由"）；产品界面普通功能文案（菜单/按钮/功能名称，如"提现"）无口号强度不算；不含被其@到的普通人物/小号账号——那些仍是周边对象）。⚠️ 三个前提：①忠实呈现——币名须为该IP名字的忠实使用（原名直接出现，或该IP官方/通用标准译名），经变体替换的（音译字/形近字/跨书写系统字符，如"o"→"哦"）不算，不满足判 notable_other；②已官宣存在——名字所指的对象须已被官方正式官宣或已公开发布，仅为传闻/泄露/内部界面曝光/未官宣计划中的名字（"will be named X"）不算（官方产品正式上线/更新后公开可见的界面口号属已公开发布；发布会/官推正式官宣的新产品属已官宣；"内部界面曝光"仅指未发布产品的内部截图/泄露），不满足判 notable_other；③实体性——名字的主体须指向具体实体（该IP本人/其自指原话词/其实体性提及对象/其官方口号与品牌主张——口号是IP标志性资产，视为有实体对应；发布者指代的新产品/重大升级亦为具体实体），名字只是"IP名或称谓+日常物品词"的拼接（如"Cz黄鞋"=Cz+闲聊物品词"黄鞋"）、或主体词是该IP文本中无具体实体对应的普通词组（修饰+名词的日常用语，无meme元素）——判 common_word',
        notable_other: '知名但非超级IP——名字指向知名人物/知名公司/知名IP/大V本身的名字，量级达不到超级IP（如十万粉级KOL、行业知名公司/机构自身的名字）。⚠️ 判本项前先查 super_ip 发布者指代分支：语料若是某领域知名发布者（机构/人物，官号粉丝数十万级）官宣其独立新产品/重大升级、币名=该新产品名——不判本项，按 super_ip 评估（发布者知名度指代新产品）；本项承接的是：该发布者的版本更新/功能改进/新平台移植（桌面版/mobile版/v2迭代）、以及名字指向知名主体自身名字的其他场景。含变体/传闻指向：币名经变体替换（音译字/形近字/跨书写系统，如"o"→"哦"）、或所指名字仅为未官宣传闻/泄露/未发布产品的命名——即使指向超级IP也判本项',
        minor_other: '无名对象——名字指向事件中被提到/@到/点评到的小号、小公司、普通人、小项目、纠纷对象、周边人物（被超级IP或大V提到不改变其无名属性）',
        common_word: '普通词——名字是事件文本中的普通词汇/短语，不指向特定实体；含超级IP文本中的非实体词组：IP闲聊/日常里的日常用词（多为"修饰+名词"，如"Cz黄鞋"的主体词"黄鞋"——无具体实体对应、无meme元素），文本作者是超级IP不影响判本项；超级IP明确提及/讲述的具体实体、及其官方产出物中的官方口号/品牌主张不是普通词（按super_ip评估；界面功能文案除外）',
        none_related: '与事件无关——名字在事件文本和主体背景中找不到来源',
      },
    },

    // ── 10. 品牌劫持（原 Stage3 1.0 节，仅预检命中时加入）────────────
    ...(includeBrandHijack ? {
      brand_hijack: {
        type: 'noul',
        instructions: `品牌劫持判断（brand hijacking）。
⚠️ 核心事实：此代币来自meme代币发行平台，平台上只能创建meme代币，不可能存在真正的知名代币。
当代币名（Symbol或Name，去emoji/数字/特殊字符后）与知名品牌完全匹配或高度相似时判断是否为品牌劫持。
豁免条件（满足任一即不算劫持）：
① 同名但与品牌完全无关（如 Apple 指水果事件）
② 品牌官方衍生且背后有真实重大事件
③ 显式meme化创作（明显的玩笑/戏仿/二创，圈内公认）
④ 知名人物本人直接发起且有实质内容
⑤ 头部机构的重大事件（机构自己发的）
⑥ 书名/绰号（去掉机构名后剩余部分有独立意义，如"币安风云录"去掉"币安"后"风云录"仍成立）`,
      },
    } : {}),

    // ── 11. 无背景拼写错误（原 Stage3 截断规则 2）─────────────────────
    block_misspelling: {
      type: 'noul',
      instructions: `无背景拼写错误（misspelling without background）。
代币名中是否包含对事件实体/已知概念的明显拼写错误，且这个拼写错误没有独立的背景故事或文化来源？
（有文化来源的变体拼写不算，如doge→dogwifhat是meme文化变体）`,
    },

    // ── 12-13. 质量（原 Stage3 第二大项，长度分代码端算）─────────────
    quality_spelling: {
      type: 'score',
      instructions: '代币名拼写/可读性（spelling & readability），0-7分。',
      criteria: [
        '0-1分：完全无法理解——随机字符串/纯符号',
        '2-3分：错误较多——大小写混乱/词间无分隔/难读',
        '4-5分：有小瑕疵——可读但有变形',
        '6-7分：完全正确——标准词/知名品牌名/易读',
      ],
    },
    quality_reasonability: {
      type: 'score',
      instructions: '代币名合理性（name reasonability：是否像一个真实词/有意义组合），0-5分。',
      criteria: [
        '0-1分：荒谬——无意义组合',
        '2-3分：勉强——可读但奇怪',
        '4-5分：合理——真实词汇/有意义组合',
      ],
    },
  };

  return questions;
}
