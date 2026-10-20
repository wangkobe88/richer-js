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
 * J1.9：event_token_block_reason 新增 word_extraction 截词选项 + subject_unqualified 扩作用域。
 *       ⚠️ word_extraction 方案已废弃（J1.10 拆独立题替代）；J1.9 无任何 DB 行产出
 *       （E1 回测期间 182 运行的是 J1.8），subject_unqualified 扩作用域在 J1.10 延续
 * J1.10：新增独立 web3_user_name_entity_acceptance 题（代币名指向）替代 word_extraction，移除该选项。
 *       2026-09-23 用户裁定（CONVICTION/OneKey/YAYA 案）：截词/截名发币要成立，
 *       名字的主人得是超级 IP——被超级IP/大V提到≠名字本身有生命力，知名≠超级IP。
 *       代码端按 web3_user_name_entity_acceptance 阻断（minor_other/common_word/notable_other 阻断侧
 *       合计概率≥0.5，scope C/D/F/G，见 mapper——CONVICTION 案照此不放行）。
 *       曾尝试在 event_token_block_reason 里加 word_extraction 复合选项，六轮措辞 Jev 均无法
 *       同时覆盖"话中截词"与"指向文中当事人但当事人无名"两种结构，拆独立题解决。
 *       subject_unqualified 扩作用域 A→A/C/D/F/G（小主体确定性兜底，防 Jev 量级
 *       在 C/B 边界漂移漏过事件分下限）
 * J1.11：event_token_block_reason 新增 event_negative_hard_news 选项（2026-09-26 用户裁定，C9 bitget被盗案
 *       0x0e323198：蹭 Bitget 热钱包被盗 3.516 亿官方公告命名，D 类 + A 档量级 80.32
 *       high 放行后 -55%。裁定：事件热度高≠该放——负面事故（被盗/暴雷）+纯硬新闻
 *       （无梗/无玩味空间/主体不自嘲传播）的事件无 meme 价值，蹭其命名只是消费热度。
 *       边界收窄到"安全事故/被盗/被黑/暴雷/巨额损失/灾难"，其余负面留给 Jev 自由裁量。
 *       代码端 mapper 双挂：BLOCK_SCOPE 'all'（argmax 机制全域）+ 概率 ≥0.5 质量门
 *       negativeHardNewsBlock（标准 + superIP 双路径），见 jev-result-mapper）
 * J1.12：web3_user_name_entity_acceptance super_ip 加双前提（2026-09-27 用户裁定，C11 哦案 0xbefe2b70：
 *       name="o"/symbol="哦"，第三方骑乘 OpenAI DevDay 传闻的 always-on assistant
 *       命名"o"（ChatGPT 内部 config 曝光、未官宣未发布），web3_user_name_entity_acceptance super_ip 0.81
 *       命中 C8 豁免 → B 类 S 档 80.05 high 放行。裁定「把'o'直接发成中文'哦'，感觉
 *       不行」）：①忠实呈现——币名须为该超级 IP 名字的忠实使用（原名直接出现或官方/
 *       通用标准译名），音译/形近/跨书写系统变体不算；②已官宣存在——名字所指对象须
 *       已被官方正式官宣或已公开发布，仅为传闻/泄露/内部界面曝光/未官宣计划中的名字
 *       不算。不满足前提的判 notable_other（承接语义同步写入该项 criteria）。mapper
 *       零改动（notable_other 已在阻断侧三项、scope 已含 B/C/D/F/G/W）
 * J1.13：event_token_block_reason 新增 event_routine_content_product（2026-09-27 用户裁定，C12 绣春刀3案
 *       0xa7c9c86e：BTCdayu 推「绣春刀3电影即将推出」，第三方骑乘华语电影系列名发币，
 *       web3_user_name_entity_acceptance super_ip 0.66 命中 C8 豁免 → B 类 65.95 high 放行（BUY 信号）。
 *       裁定「即使推出了，也不能作为meme币」——常规电影等内容型产品宣传与官宣与否
 *       无关，均不构成叙事事件。J1.12 双前提对本案双满足拦不住（J1.12 下重析靠
 *       notable_other 0.53 贴线拦截，非类型确定），故立独立阻断项。边界收窄：内容
 *       本身已是全民玩梗对象（名场面梗/大规模二创）不选（按 E 类热点评估）；跨世代
 *       文化符号/神话/历史人物/公共事件（孔子/嫦娥/探月）不是产品宣传不选；Web3
 *       产品（W 类）不适用；世界级颠覆性实体产品发布不选。代码端 mapper 双挂：
 *       BLOCK_SCOPE 'all' + 概率 ≥0.5 质量门 routineContentProductBlock（标准+superIP
 *       双路径），与 event_negative_hard_news 同构，见 jev-result-mapper）
 * J1.14：web3_user_name_entity_acceptance super_ip 加第③前提「实体性」+ common_word 去除「文本作者非
 *       超级IP」限制（2026-09-27 用户裁定，C13 Cz黄鞋案 0x91c4c4e9：name=symbol=
 *       「Cz黄鞋」=注册表 IP 缩写 + CZ 闲聊推文物品词拼接，superIP 快车道 S 级预评分
 *       40+15 直接喂饱 + web3_user_name_entity_acceptance super_ip 0.44 argmax 摇摆（common_word 0.27 被
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
 * J1.15：web3_user_name_entity_acceptance super_ip 扩含「官方口号/标志性品牌主张」（2026-09-27 用户裁定，
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
 * J1.16：角色IP币豁免 event_routine_content_product（2026-09-28 用户裁定，C25 久留美案
 *       0xfedf19759ba9c45b1a8345a2bde916b38acc7777：动画《FX戦士くるみちゃん》官号
 *       （2.3万粉）先行上映会感谢+10/1开播定档推发出4.5h后，第三方发角色名币
 *       「久留美」（symbol=主角くるみ音译），J1.14 判 D类+event_routine_content_product
 *       0.91 → rating 1 终端 veto 拦下 BUY；实际创建后100分钟 12.6倍毕业，实验涨幅
 *       第一。裁定原话「这个不仅仅是开播剧，是里头的角色——其实是基于角色IP发的币」：
 *       作品中的角色（人物/形象）是有形象的独立IP实体，可有自身meme生命周期，角色
 *       名币≠蹭作品宣传消费上映热度，与 C12 绣春刀案（币名=电影系列名，纯消费上映
 *       热度）机制不同。三处改动：①event_category 主体归属新增规则——代币名指向
 *       作品中角色（角色名而非作品名）→主体=该角色、类别A（形象IP），作品官方宣传
 *       推只是角色语料载体；②event_token_block_reason event_routine_content_product 边界收窄——角色
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
 * J1.18：web3_user_name_entity_acceptance super_ip 加「发布者指代」分支（2026-09-29 用户裁定，C29
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
 *       阻断档（C8 v3「版本更新 event_token_block_reason 不可判」的判定迁移：语料明示版本
 *       字样时量级题与 web3_user_name_entity_acceptance 双侧可判）。dimension2 B 类同步句（新产品同
 *       按发布者指代定档、版本更新按低档）。内容型产品不适用发布者指代——rcp 门
 *       （J1.13）独立于量级门拦截，C12 绣春刀裁定维持。
 *       mapper 代码门（detectPublisherProxy 四判据：官方域名 stem=币名 + 作者粉
 *       丝≥10万 + 币名与作者名互不包含 + 无版本指纹词）：题面措辞实证 Jev 执行不
 *       下去（super_ip 0.16→0.31 压不过 0.5、magnitude 稳定 B 档），J1.16 先例——
 *       Jev 分不动的边界由代码确定性切分。pubProxyActive 时（仅 B/C 域，cashtag
 *       改道优先）：nameReferentBlock/骑乘改道/event_marketing_gimmick argmax 三处豁免
 *       + 量级 A 档锚（effTier，S 不降 A 原判不动）+ stage1 审计标记
 *       publisherProxy/tierAnchored（Jev 原判 tier 保留在 magnitudeTier 键）
 * J1.19：新增独立第 14 题 web3_user_event_fit（2026-09-29 用户裁定，C30 死亡观察员/太阳之勤案
 *       0xd2a6d440…7777 / 0xe5fa214f…7777：两票均为抖音爆款视频票——「AI死亡
 *       短片 44.7万赞」「范小勤抽象梗 13.7万赞」，pre-check video_unrated 爆款
 *       短路（点赞≥10万 → 不进Jev直接mid）放行后 Web3 用户不买账阴跌（各实验
 *       净 -0.245 / -0.267）。裁定原话「Web3用户是不会喜欢的，不符合用户胃口」：
 *       Web2 传播热度 ≠ Web3 用户偏好——链上 meme 买家（BSC 发射平台，华语
 *       crypto 圈为主）喜欢动物萌宠/币圈梗/AI/知名IP/可玩味乐子梗，不喜欢消费
 *       弱势真人的土味网红梗、丧文化阴郁主题、纯内容欣赏无玩梗空间。两处配套：
 *       ①本版新增 web3_user_event_fit（strong_fit/fit/marginal/unfit 四档独立题，语义独立
 *       不并入 event_token_block_reason 的「无叙事价值」语义）；②pre-check 规则 3 爆款短路
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
 * J1.21：新增条件第 15 题 name_entity_memeability（2026-09-30 用户裁定，C33 MTAT案
 *       0x67fd1190013255c3e3ddc7363f0387d2258e7777：Yuki（1.8万粉）创作歌曲《More
 *       Than a Trade》送给交易员，币安中文官推（S级）转发「建议每日循环」，45秒后
 *       MTAT 抢发——superIP 快车道 web3_user_name_entity_acceptance minor_other 0.52（阻断侧 0.68）
 *       「名字指向无名对象」拦截。裁定原话「要看被转发的指代对象meme程度，以及
 *       被web3用户喜欢的程度。丫丫肯定不行啊是个币安员工，这首歌明显可以」：
 *       「无名对象」要按对象类型分流——人名/账号/周边人物（YAYA型）无内容可玩味
 *       维持拦截；内容作品（歌/视频/梗图/口号）看 meme 玩味空间 + web3 用户契合
 *       双达标放行。落地：①新题仅 superIP 快车道携带（buildStandardQuestions
 *       referentMemeability 参数，标准路径语料作者非超级IP、无名对象无曝光背书，
 *       ChainPulse/Muse 语义不变）；②题面钉死评估对象=web3_user_name_entity_acceptance 判定的指代
 *       对象本身（被超级IP转发/提及不加分——陈述者量级另有题评）；③两维度 AND
 *       语义入 3 档分档（≥3 豁免，mapper mapSuperIPAnswers nameReferentBlock
 *       命中时查分）；④web3_user_event_fit unfit≥0.5 负门继续独立保底（豁免不放 web3 unfit
 *       盘）
 * J1.22：name_brand_hijack 题判断锚改「名实一致性」（2026-10-01 用户裁定，C35 币安支付案
 *       0xfa4f58fd46fae74490a9d4cd69ed3eaf1b7d7777：@binance 官宣 Binance Pay×PayPay、
 *       何一(S级)转发、第三方铸「币安支付」——事件分 82.72 high 被 name_brand_hijack
 *       noul=0.74 硬截断 low，市场 $664K→$1.7M）。裁定原话「"币不是币安发的=劫持"
 *       这肯定不行。如果公司A发了一个产品B，那么代币名字叫B，这肯定不能算品牌
 *       劫持，但是如果发的代币叫做A，那么还是可能算品牌劫持（本质上算是IP或者说
 *       概念实体不一致，把事件的核心概念扩大了。或者不匹配）」+ CZ 补充「代币CZ，
 *       事件 CZ 本人发布《Freedom of Money》新书 → 本人发起+实质内容+发酵空间 →
 *       不触发劫持」。落地：核心事实句尾钉死发行归属非判据；新增判断锚四形状
 *       （币名=事件核心实体名→一致不算；币名=事件主体本人名→一致不算；币名指向
 *       更大实体→概念不匹配/扩大正常评估；纯蹭热度→劫持）；豁免②⑤加「且币名指向
 *       该事件核心实体」限定、④补「指事件由本人发起非指发币」澄清；①③⑥不动；
 *       mapper 零改动
 * J1.23：event_magnitude/dimension2 A类量级锚改「Web3买家视角」+ web3_user_event_fit 小众边界
 *       澄清（2026-10-01 用户裁定，C38 久留美案续 0xfedf19759ba9c45b1a8345a2bde916b38acc
 *       7777：J1.22 开播日重析 A类+C档22+传播18.56+时效15=55.56 维持 low——量级锚
 *       「角色大众知名度」未开播=C档0.82 置信锁死，web3_user_event_fit 同票只给 marginal 0.44
 *       （「主题小众」）。裁定原话「A类判定标准没有考虑到Web3用户的喜好，可爱风/
 *       极客风/奇怪的东西等等，Web3用户偏好很强。一个传统严肃的电影绣春刀宣传比
 *       这个case多得多，也不行。最根本上，还是要占到用户角度看叙事」：A类量级
 *       的评价主体是 Web3 meme 买家（玩梗文化/乐子导向），不是大众——①风格即
 *       吸引力：可爱萌系/极客风（AI/编程/科幻/交易投机文化题材）/奇怪猎奇荒诞
 *       是 Web3 用户天然偏好，风格契合时即使作品未开播、大众无名也可按圈内吸引
 *       力定档（可到B档）；②传统严肃风格（正剧/历史/文艺向）大众知名度与宣传量
 *       不转化为 Web3 吸引力（crypto圈不会拿严肃正剧角色玩梗），通常C档以下——
 *       大众知名度排序与 Web3 吸引力排序可完全反向（绣春刀宣传量>>久留美但判定
 *       相反）；③已是圈内梗/被crypto圈广泛二创（PEPE型）=A/S档。web3_user_event_fit 边界
 *       同步：「小众」按 Web3 买家视角判——动漫游戏/极客/ACG 对 crypto 圈不是
 *       小众（用户群高度重叠），小众指受众与crypto圈不重叠的领域（传统行业/地域
 *       文化/严肃专业）；强契合典型补可爱萌系ACG角色/极客风题材/奇怪猎奇乐子。
 *       dimension2 A类句配套双证据源（知名度 OR Web3圈内吸引力，与magnitude同
 *       视角）。superIP 快车道量级走 preScores 代码预打分不消费本题，零影响；
 *       mapper 零改动。验证：久留美重析+绣春刀3回归+C30/C31 unfit标准样本+校准集
 * J1.24：name_brand_hijack 豁免③扩充「当前热门新鲜事锚定的戏谑关联」（2026-10-01 用户
 *       裁定，C40 Binance Inu 案 0xcaf66eb2c00d206d741a654face34768cf2a7777：币安
 *       广场官宣 Binance Intelligence 发布会（官方认证、token 创建前 36s），第三方
 *       铸「BI (Binance Inu)」——大系统缩写双关 × Inu 狗形象。裁定原话「这里我觉得
 *       不是『劫持』，而是一种web3用户特有的戏谑/趣味性关联。当然它也必须得是当前
 *       的热门新鲜事，否则就成了无病呻吟了」：缩写双关/谐音/形象嫁接是 meme 创作
 *       手法，语料锚定近期真实大事件时蹭的是事件增量热度而非品牌存量认知，不算
 *       劫持；无新鲜事件锚的纯品牌词根盘（无病呻吟）才是劫持。配套 mapper 代码
 *       豁免 punExempt（题面锚 + 代码切分双防线，J1.16/J1.23 教训：Jev 分不动的
 *       边界代码切）：timing within_7d + effTier S/A + 可信事件源锚（superIP/
 *       官方认证/自发宣告）三条件全中才豁免品牌劫持截断与 relevance≤10 截断
 *       （戏谑关联的弱字面关联是固有属性），计分照常
 * J1.25：subject_unqualified 主体口径修正（2026-10-01 用户裁定「发帖的只是叙事的
 *       陈述者，它不是主体」，C43 土豪猫猫案 0xfade76ef97ada757be21a4a1aba87d576eda
 *       7777：@MGGA_BSC 转述「这里确实是叫 土豪--猫猫」+ Instagram 猫猫照片，Jev
 *       subject_unqualified 0.44 argmax 拦截——旧判据「粉丝<1万且无认证且非知名IP」
 *       是账号口径，把陈述者/语料账号的体量当成了事件主体的资格）。修正：主体=
 *       币名所指的核心实体（形象类主体按形象自身的知名度与玩梗证据判，来源账号
 *       粉丝量只是 proxy；陈述者账号绝不构成主体资格不足）。J1.9 扩域本意「小主体
 *       确定性兜底」维持——量级题（event_magnitude/dimension2）仍按正确主体判分，
 *       无名形象由量级门拦截把关
 * J1.27（J1.26 为 mapper-only 编号，题面跳号对齐）：「公司产品实体」主体切分
 *       （2026-10-03 用户裁定，C55 华为麒麟案族——82093ca3 评3 161 票东西方归类
 *       发现「中国公司产品发布」簇 ~15 票几乎全亏：麒麟 0x967e4a52…7777 实测 mag
 *       S71%/dim2 五档84%——「华为」的世界级影响力整体转移给「麒麟芯片」产品实体。
 *       裁定原话「这里面的主体并不是"华为"/"网易"，而只是它们发布的产品（实体）。
 *       要不就是事件形成了大影响力（并不需要一定是顶级IP），要不就是玩梗/有趣，
 *       对应着一个可爱的形象，本质上还是web3用户能不能喜欢与接纳的问题」）：
 *       ① event_magnitude 追加形状③产品实体（与 J1.20 陈述者两形状并列）——主体=
 *       产品实体时母公司知名度不转移不计入，分量只认两条路（事件自身大影响力
 *       ——第三方自发酵传播而非公司宣传声量；或自带可玩梗的可爱形象）；② dimension2
 *       同步形状③口径；③ web3_user_event_fit 追加产品实体边界（纯功能型产品不高于 marginal）；
 *       ④ 新增第 15 题 event_subject_entity（choice 8 档显式标注主体实体类型，供 mapper
 *       干净切门，替代概率组合猜形状）。wording 实验（5 票两轮，scripts/narrative/
 *       _exp-product-entity-shape.mjs）：麒麟 mag 4.58→2.97 且 fit sf44→mg62（主体
 *       切分生效但 dim2 残留五档57%→仍 high，代码门兜底必需）、狗剩 high73→low56、
 *       多多进宝 high73→low52、中国猪能飞/小八零误伤（±0.25 分抖动内）。web3_user_event_fit
 *       轴判别力（形状③后）：产品簇 sf+f 19-60% vs 对照赢票 99/74%。配套 mapper
 *       产品实体接纳门（J1.16/J1.23/J1.24 教训：题面切分+代码执行双防线）。
 *       同日补充裁定（用户「不过刚才说的情况，要豁免币安」）：币安等 crypto 原生
 *       机构的产品豁免本切分——链上买家即币安生态用户、其产品天然高接纳（C35
 *       币安支付/C40 BI 不得被拦），币安影响力正常转移给其产品事件；题面三处
 *       豁免句 + mapper detectBinanceCorpus（代币名/主推/父推含 binance/币安）
 *       代码豁免双防线。J1.27 零 DB 行产出前修订并入，不另立版本号。
 *       同日校准修订（161 票 182 实跑，/tmp/calib-j127.json）：首轮题面暴露两个
 *       副作用——①全域压分：dim2 均值 -3.32、tier B→C 40 票（形状③「不计入」
 *       排除性表述外溢到非产品票，se=character_ip/event_hotspot 票也整体掉档）；
 *       ②币安票类别漂移 D→W：币安智能×2/币智/智安线上全走 D 类标准数学过线
 *       （66-74 分），新题面「币安产品天然强契合」句把 Jev 推向 W 类判定，W 三
 *       轴不适配（发布会被 wProduct 打 0-8 带、wInteraction 打 0 带 → 26 分拦，
 *       违背豁免裁定）。修法三处（仍是 J1.27 零 DB 行产出前修订并入）：Ⅰ 形状③
 *       两处（magnitude/dim2）收窄为「当且仅当主体确为产品实体（event_subject_entity
 *       =product_functional/product_character）时适用」+ 显式反向锚「主体是公司
 *       本身/人物/形象IP/热点/梗词时完全不适用，本形状不是全域收紧」；Ⅱ 币安
 *       豁免句补类别口径「事件类别按机构公告口径评估不判W」；Ⅲ event_category
 *       补 D vs W 边界句（crypto 机构官号官宣自家产品 → D 机构行为；W 留给产品/
 *       项目本身为主体的独立发布）。首轮净效应已正确（避亏 +6.850 vs 放弃
 *       2.869 BNB），修订目标是收窄打击面回产品票
 * J1.28（2026-10-08）：name_entity_memeability（J1.21 superIP 条件题）改为标准路径
 *       恒带，配套 mapper 低档门（memScore≤1 → blocked「不适合成为meme币」，标准
 *       路径 Stage2 阻断链 nameReferentBlock 之后）。用户裁定（0fed29f9 亏损票
 *       分析续案）：「币安汽车」「日产」类蹭得过头、根本不可能成为 meme 币的票
 *       要拦——依然是 web3 用户接纳的问题；但 JACKET/永生/Taigan/皮草类不敢一
 *       棒子打死，故只上低档门。dry-run（96 票 182 实跑）验证：mem≤1 拦 4 票净
 *       -0.354（避亏，误拦仅 卷王 +0.013）；mem>1 合计 +3.035。语义边界（刻意）：
 *       本题量「指代对象本身的梗性」，非「组合体可接纳性」——点名亏票（币安汽车
 *       1.75/2.35、隔音舱 1.77、日产途乐 2.12）中间档无单调性故不设门。题面
 *       ⚠️ 行中性化（超级IP→超级IP/大V）。superIP 快车道 J1.21 豁免语义不动
 *       （mapSuperIPAnswers 原样读取）。旧缓存行无此答案不触发门——窗口级缓存
 *       失效脚本配套（scripts/narrative/invalidate-referent-window.cjs）
 * J1.29（2026-10-09 用户裁定挂门）：新增第 16 题 name_entity_carrier（形象载体存在性，
 *       choice 3 档，恒带——superIP 快车道 mapSuperIPAnswers 不消费本题答案，零影响）
 *       ——bddd3578 C/D/E 亏损票分析案：C/D 35 票净 -2.85 的共同病根=叙事主体无
 *       形象/梗载体（se 无形象桶全域 70 票 winR 17% 净 -5.37；C/D 29/35 票
 *       strong_fit≥0.9 而 winR 7%——web3_user_event_fit 在蹭票上语义反向，J1.27 接纳门
 *       fitMass 判据失效）。三档：existing_entity（形象已在事件/语料/官方本体中
 *       真实出现）/ improvised_entity（脑补许愿形象——BNC「binance cat」型，官方
 *       从未展示）/ no_visual_entity（人物言行/公司/功能产品/事件/概念/缩写）。
 *       dry-run（bddd3578 全 292 票标准路径 236 票，scripts/narrative/
 *       _carrier-dryrun-bddd.mjs，state 保真复用线上 stage1_prompt.state）：冒烟
 *       12/12 方向全对；全域判别力 existing 140 票 winR39% 净+11.69 / improvised
 *       24 票 winR8% 净-1.11 / no_visual 72 票 winR24% 净-3.78。用户裁定挂门 M2
 *       （C/D+非existing 拦、E+no_visual 拦、A/B/W/F/G 不碰）：实验净额 +21.90→
 *       +26.23 BNB（净效应 +4.33，winR 35%→41%）；E+improvised 有肉（6 票 +1.19，
 *       Ants +1.42「Anthropic 员工自称蚂蚁」型戏谑票）故 E 只拦 no_visual——M3
 *       （E 全拦）净效应反而 -1.19。56 票 prestage/superIP 路径无 stage1 state
 *       不适用（门只挂标准路径 mapper）。旧缓存行无此答案 → 门不触发，窗口级
 *       缓存失效照 J1.28 模式配套（scripts/narrative/invalidate-carrier-window.cjs）
 * J1.30（2026-10-14 用户裁定，C64 巴巴鸡案 0x1ea2152c68a3cba1cd3ffe68abd97d95f9ac7777）：
 *       新增第 17 题name_image_consistency（名字与配图主体一致性，choice 3 档，
 *       条件题——仅语料含【图片内容分析】块（imageConsistency=主推配图分析成功
 *       挂载）时问，与 name_brand_hijack 同款条件题模式，无图不问防幻觉作答）。用户
 *       裁定原话：「这种情况，如果名字是一只鸡，图片也是一只鸡，恐怕认为这俩有
 *       关联就好了，因为给的信息可能很难判断。」——巴巴鸡案 stage1 A 类
 *       （character_ip 0.84、strong_fit 0.92→web3FitAnchored B）/stage2 66.32 过线，
 *       stage3 关联 cultural lv1=5 分 ≤10 截断 low。根因=梗名「巴巴鸡」只在配图
 *       （抖音截图）的图内文字里（搜索框「巴巴鸡给鸡给巴巴视频」、视频标题），
 *       推文正文未写名；旧版图分析（img-v2）无文字转写指令且 maxTokens 1500 截断
 *       （key_elements 断成「猪八'"垃圾），字面证据没进 Jev state → Jev 只剩
 *       「名字含鸡+图是鸡形角色」弱证据判 cultural；C59 图豁免又只挂 superIP 快车
 *       道（标准路径无豁免位）且 name_entity_memeability 1.86<3 也不满足（低估同样
 *       源于证据缺失）。两改动（用户裁定「都做」）：①P1 根因修复 image-analysis-
 *       service img-v3（visible_text 逐字转写 + maxTokens 2500——图内文字进 state
 *       后 exact_match 档自然判出）；②P2 本题兜「图里没有文字、只有视觉主体」的
 *       形状（现金猫型），mapper（mapStandardAnswers）名图一致豁免 imgNameExempt
 *       三门：imageEvidence + same_entity/same_visual_category 合并 ≥0.5 +
 *       0<relevance≤10 → 豁免 Stage3 关联截断（relevance 分照常计入总分——弱字面
 *       关联的代价在分数上体现，J1.24/C59 同款计分语义）。superIP 快车道不消费
 *       本题（C59 的 meme≥3 门语义自洽不动）。旧缓存行无此答案 → 豁免不触发
 *       （fail-closed），窗口级缓存失效配套 scripts/narrative/
 *       invalidate-nameimage-window.cjs
 * J1.31（2026-10-16 用户裁定，C80 蝙蝠侠摇案 0x4547dae7757fb4043e034d27ed02dfabe9aa7777）：
 *       新增第 18 题事件情绪感染力（event_resonance，choice 3 档恒带——E 类判定
 *       来自 Jev 自答，fan-out 内无法按类别条件挂题，全票问、代码端仅 E 类消费；
 *       superIP 快车道 mapSuperIPAnswers 不消费本题答案，零影响）。裁定原话：
 *       「对时事现象热度，其实也应该度量事件对Web3用户的情绪感染力。这个事件
 *       没啥情绪感染力，我不会被它有任何触动，也并非一个大时事」——E 类事件分
 *       的 magnitude/dim2 量的是现象传播广度（蝙蝠侠摇 B 档 27+传播 28.68+时效
 *       15=70.68 过线 high），不是情绪转化：观众≠买家，泛娱乐现象可圈外百万级
 *       传播而 Web3 用户纯旁观（实测 18 分钟 54 tick 冷盘、买入 31s -12.4%）。
 *       mapper（mapStandardAnswers 标准数学分支）E 类感染力折损：strong=1（不
 *       折）/mild_amusement=0.5/indifferent=0.25，作用于 tierScore+effDim2 两项
 *       （时效不折——新鲜是客观属性；系数选择依据见 mapper 注释）。与 web3_user_event_fit
 *       分工：fit=主题合不合口味（静态偏好，J1.19），本题=事件当下激起的情绪
 *       行动力（动态感染）——圈内乐子大梗是 strong 不是 mild。旧缓存行无此答案
 *       → 折损不触发（fail-open，J1.28/J1.29 同款），窗口级缓存失效配套
 *       scripts/narrative/invalidate-resonance-window.cjs
 * J1.32（2026-10-17，C83 bbbe2561 体检案）：题面零改动；变更在 state 输入形状——
 *       superIP 注册表命中票改走标准路径全量 18 题（快车道 mapSuperIPAnswers
 *       删除），state PRECOMPUTED 注入 super_ip_hit 认证事实行 + super_ip_note
 *       反混淆提示（不再注入 tier 预分）。评级可比性断代：superIP 语料票的
 *       量级/时效由 Jev 自判（原 S40+时效15 代码喂饱取消），event_institution_routine
 *       豁免收紧为仅平台官方 handle。校准/对账按 prompt_version 过滤。
 * J1.34（2026-10-18，C91 BI 0x3891…7777 mem 1.86 案）：name_entity_memeability 主轴重定义
 *       （J1.33 人物口径泛化）——用户裁定「币安的产品在币安链上怎么就没有 meme
 *       玩味价值？不能认为是产品就没玩味价值，跟不能认为是人一样；所谓玩味
 *       价值就是 Web3 的影响力」+补「或 Web3 的潜在影响力」：玩味价值核心=
 *       对象在 web3 圈内的当前或潜在影响力和符号性，对象类型（人/产品/公司/
 *       机构/事件）不作分档依据——「无名且无潜力」才无玩味空间。原 1 分档
 *       「普通公司/组织名」与 2 分档「产品功能名」的按类压分收窄为「圈外/
 *       无人知晓」限定；圈内顶流产品/平台（币安级）与禀赋足以预期圈内接住
 *       的新事物按 3-5 档评（3 分档补产品例）。消费点零改动（分数门同 J1.33）。
 * J1.33（2026-10-18，C90 暗号資産の覹者 mem 1.96 案；commit 3440275 误写 C89 已勘误）：name_entity_memeability
 *       题面口径修正——原 0 分档「人名/账号名/周边人物」把一切人物压向无玩味
 *       方向（超级人物指代票 mem 概率分裂 0 档 vs 3 档、分数落带下）。用户
 *       裁定「要看人是什么样的人：普通人当然没有，CZ 当然可以」：0 档收窄为
 *       无名普通人；已是圈内文化符号/被大规模玩梗二创的超级人物（CZ 级）
 *       其人物符号性即内容载体，按 3-5 档正常评分（instructions ① 同步改）。
 *       消费点零改动（J1.28 ≤1 低档门/C88 五腿 mem≥2 腿/mem 地板均纯分数门）：
 *       无名普通人票口径不变照拦，超级人物票 mem 上移、C88 五腿可达。旧缓存
 *       行 J1.32 不重评（观察期语义），窗口级失效配 invalidate-*-window 同款
 * J1.35（2026-10-18，C92 유과 강아지 0x9d95…7777 事件分不足案）：event_magnitude/dimension2
 *       E 类证据层级重写——用户裁定「它陈述了爆火就信爆火，它给了传播数据就依赖传播
 *       数据判断，它给了社交网络链接就去取数据判断；除非说了爆火但传播数据很弱」。
 *       原「任意2项→B/仅1项→C」升级规则废除——它把找角度票结构性封顶 C（找角度
 *       语料天然无量化数据，2 项凑不齐是常态非票的缺陷）。新四行层级：①有事件层
 *       量化数据（被引述源头/父推帖互动数、转述播放量/热搜位次、媒体大规模报道）
 *       →按数据定档；②仅热度陈述→直接采信（爆火/疯传/大爆→B 档起，全国/全球级
 *       →A/S）；③陈述热但数据弱→数据推翻降档；④发射推/找角度推/回复者自己的
 *       粉丝与互动数不是事件传播数据（十万粉级父推=大V扩散通道证据照常计）。
 *       C 档「无源可溯」封顶收窄为主体存在性（查无主体/编造嫌疑）——程度无量化
 *       数据不再触发封顶（7777 作业票防线保留在主体查无臂）。案发现场：Jev 判
 *       C 档 22+传播 19.28+感染力 mild×0.5=35.64<60 拦；父推（事件源头帖）实测
 *       5.87 万赞/1.03 万转/93.3 万浏览=平台级热度，分析时刻未进 state——fetch 层
 *       in_reply_to 不透传互动数（quoted/retweeted 都有 metrics 映射唯独父推没有）
 *       +渲染层三个被引述段全无互动行，数据在 API 响应里被丢弃。同批修复：
 *       fetcher 补 favorite/retweet/view/quote 四字段映射、twitter-section 三段
 *       （回复/引用/转发）渲染互动行（存量缓存行无 metrics 键不渲染=bit-compat），
 *       单测 _test_parent_tweet_metrics（事故现场数字反证 58730/10324/932891/582）。
 *       mapper 零改动
 * J1.36（2026-10-18，C93 유과 강아지案续+蝙蝠侠摇 0x4547…7777 反证）：event_resonance
 *       题删除（18→17 题）——用户裁定「meme 币发币哪里有什么圈内圈外一说，web3
 *       用户喜欢就行了。event_resonance 是不是可以被替换为 web3_user_event_fit？」（B 案）。
 *       根因：①该题量的「事件对 Web3 用户的情绪行动力」对 Jev 不可观测（只见语料
 *       不见链上行为），推断素材与 web3_user_event_fit 完全同源，独立作答只产生矛盾面（유과
 *       案同次作答 web3_user_event_fit strong_fit 0.97 vs resonance mild 0.79 直接互斥）；②例文
 *       把「圈外」焊死在 mild 档定义里，判定轴腐化为圈层归属而非情绪强度。E 类
 *       折损机制保留但判据源换 web3_user_event_fit（mapper 侧，阈值/系数见 J1.36 注释）；
 *       蝙蝠侠摇形状放行为用户明示接受（实测 web3_user_event_fit strong 0.38+fit 0.38=0.76
 *       ≥0.5 不折——Jev 认为口味契合，当年 -12.4% 归盘面非叙事错判）
 * J1.37（2026-10-18，C96 币安上电视 0xc6d089d749409f7646de440d637ac9db0e047777
 *       CZ 推文 1 秒快枪案）：新增两题（17→19 题）+ event_category F 档澄清——
 *       用户裁定「币安上电视算是个哪门子 meme 币？这是一个陈述不是一个实体」
 *       +方向 1（修分类逃逸）/方向 2（陈述句门）双立项。案发现场：CZ（1299 万粉）
 *       17:21:14 UTC 转发「BNB 上越南国家电视」→ token 创建 17:21:15（1 秒快枪
 *       监听 bot）→ J1.32 判 F 类（Discovery「author-discovered」被 CZ 的
 *       spotted 目击语气满足）A 档 34+传播 28+时效 15=77 high 放行，买入 22 秒
 *       -33.4%。三借壳：量级（CZ 粉借给快枪盘）/mem（币安 super_ip 1.72 借给
 *       陈述句名字）/web3_user_event_fit（BNB strong 0.93 借给「上电视」转述）——三轴全是
 *       事件成分的属性，无一轴衡量名字本身作为 meme 载体。两新题：
 *       ①event_finding_vs_recap（三态恒带）：F 类细化——叙事内容是「作者自己的发现」
 *         还是「新闻转述」。mapper：event_category=F 且 news_recap → 强制改道
 *         E（categoryForced='f_recap_e'，cashtag 改道同构），E 类既有门自动接管
 *         （J1.29 载体门 E+no_visual / J1.36 web3_user_event_fit 折损）。分类逃逸是过关
 *         钥匙：no_visual_entity 0.97 若按语义判 E/D 会被载体门当场拦死，逃进
 *         F 不吃载体门不吃折损。
 *       ②name_form（三态恒带）：币名语言形态——实体指代（名词短语：人物/角色/
 *         IP/机构/产品/梗词/口号）vs 事件陈述（主谓结构转述发生的事：X 上电视/
 *         X 破产/X 涨到 Y——新闻标题非实体，无 meme 载体）。mapper 全域硬拦
 *         statementNameBlock（挂 rm 后 mem 地板前），recognizedEntitySlogan 五腿刻意不
 *         豁——C88 mem 地板（mem<2 拦）拦不住 J1.34 后币安指代 mem≥2+五腿全中
 *         的「币安上电视」形状（mem 轴量不到名字形态，C90「尺子量不到名字」
 *         同款教训），陈述句门是该形状唯一拦截位。
 *       两题答案缺失（旧缓存行）fail-open 零影响（J1.28/J1.29 同款；生产链
 *       JevClient 缺答案 throw）。存量 J1.32-J1.36 行不重评（观察期语义）。
 *       event_category F 档 criteria 补一句澄清（目击/报道新闻≠发现→判 E/D）
 *       ——与 mapper 改道门同向双保险（题面澄清非决定性，教训①家族）。
 * J1.38（2026-10-18，C98 粉红豹法国骚乱案 0x9df97d4239818411237d19a09303262269c47777）：
 *       event_negative_hard_news 题面扩边界——用户裁定「涉及政治的负面事件，影响力也
 *       不够，不应该支持 meme 币成立」。案发现场：中文转述号（2789 粉）reply 挂
 *       西语发图推（父推 1.29 万赞/11.2 万浏览）宣告「法国失控上微博热搜——抗议
 *       物价示威演变为打砸抢烧、143 年利摩日市政厅被纵火，粉红豹成为抗议的象征」
 *       → token 创建后 40s 评级 high 71.78（A 0.52 argmax 赌赢 E 0.47 + super_ip
 *       0.8 + web3 strong_fit 0.72 + C88 五腿命中），实盘买入 5min46s 清仓 -19.4%。
 *       event_negative_hard_news 仅 0.22（argmax=none 0.67 放行）：J1.11 边界「主体是
 *       机构/平台不自嘲、无梗无二创」不含政治暴力，且明确「其他负面不选本项正
 *       常评估」——粉红豹是卡通角色有强二创空间，Jev 按题面语义判「有玩味空间」
 *       不选。扩边界三件：①类别扩——政治暴力/社会动荡（抗议/示威/罢工演变为
 *       打砸抢烧/骚乱/纵火/冲突/恐袭/战争/动乱）纳入窄边界；②语料形态扩——加
 *       「时事转述」（本案是转述微博热搜非事故通报）；③政治暴力臂锚——明确
 *       「不看载体玩味空间」：IP 被当作抗议/声援象征传播时热度来自现实暴力苦难
 *       而非 IP 自身玩梗文化，消费苦难不是梗。反向窄边界同刻：和平政治事件/
 *       政策辩论/选举玩梗（无暴力与灾难）显式不选，正常评估。mapper 零改动
 *       （BLOCK_SCOPE all argmax + ≥0.5 概率门 negativeHardNewsBlock 双挂已就位）
 * J1.39（2026-10-18，C103 Jean Phil 翻译洗白案 0x6915bec6e90dd26d282f544c91304b0846e97777）：
 *       新增条件题 parent_relationship（19→20 题，语料有【回复的推文】块才问——
 *       name_brand_hijack/name_image_consistency 同款条件题模式防幻觉作答）。案发现场：
 *       主推位=Dexerto 原生新闻推（145 万粉，9-28 报道「AI 网红 Jean Phil 币值
 *       $8M」=20 天老）+ website_tweet 位=229 粉小号「热点挖掘机」token 创建前
 *       13s 发的中文翻译推（reply 到 Dexerto 原推，逐句对应无新解读）——C68 载体
 *       集「任一新即活」被翻译推洗白、C75 主推 20d<30d 不触、Jev within_30d 给
 *       10 分 63.65 压线 high 放行。用户裁定：「找角度推文引用某推文解释现象，
 *       被引用的可以老（解释原生推文）；但仅翻译老推、或解释另一个找角度推文，
 *       被翻译/被解释的实效性也要够（24h 内）」。题判载体↔父推内容关系三态+unclear：
 *       new_angle_on_original（新解读，父推可老——豁免臂）/ translation_or_repost
 *       （翻译搬运无新解读）/ explains_derivative（父推本身是二手找角度/转述）。
 *       mapper overrideStaleRelParentTiming：后两态 ∧ 任一载体槽位（主推/
 *       website_tweet/quoted/retweeted）父推 lag>24h → timing 归 older（Jean Phil
 *       63.65→53.65<60 事件分不足拦）。与 C102 分工：C102=币安语料无条件（借壳
 *       不分关系一律拦），本门=通用语料按关系分档。答案缺失（J1.38- 旧缓存行）
 *       /unclear fail-open 零影响
 * J1.40（2026-10-19，C105 日本語版案 0xe156aa3f3e89ded51ef0b980018ef15ae0517777）：
 *       name_form 加第四选 functional_label（题数不变 20）。案发现场：CZ 01:47:24
 *       UTC 发推《Freedom of Money》日本語版本日发售（出书促销推），蹭票者同秒
 *       抢发「日本語版」（symbol/name 逐字=推文元词）。Jev 感知完全正确但无臂表达：
 *       stage3 name_event_relevance=translation_match 0.62（它知道名字是版本词）而
 *       name_form 判 entity_phrase 0.96 → C88 五腿全中（superIp 0.53/mem 2.5/
 *       within_7d/strongFit 0.73/relPositive 0.9）豁 J1.29 载体门（no_visual_entity
 *       0.97 本该拦）+ block 臂 event_routine_content_product 0.82 → S 档 39+27.44+15=
 *       81.44 过线 80.24 high。用户裁定「日本語版根本不能作为 meme 名字，事件本身
 *       在 web3 影响力并不小」——量级轴不背锅（mbti 夹克案候选 B 明确不启用），
 *       洞=名字资格：版本/语言/形态/序号元词描述「某内容的一种版本形态」，无独立
 *       指代对象无玩梗空间，是版本目录行不是符号。判定优先级锚 functional_label >
 *       statement > entity_phrase（版本词语法上是 NP 但语义是元词——同「陈述句里
 *       含实体不改变它是陈述」）；名字核心词是梗/实体、版本词只是修饰（「XX
 *       完整版」核心是 XX）按核心词判不算 functional label。mapper 代码端挂
 *       functionalLabelNameBlock 硬拦（statement 门同族同位，全域无豁免五腿不豁，
 *       门链序 rm→st→fl→memFloor→sc）。断代语义：旧缓存行 name_form∈
 *       {entity_phrase,statement,unclear} 行为 bit 不变（fail-open）
 * J1.41（2026-10-19，C107 名字门收敛）：name_form 判据从语言学形态四分类收敛为
 *       单一合格度判断（用户裁定「其实我觉得可以不加新维度，就使用『是否合适
 *       作为 meme 币』这个维度就好」）：meme_name（合格——名字本身可当符号玩梗
 *       二创传播）/not_meme_name（不合格——陈述句/版本词/序号/功能标注等一切
 *       「读者记住的不是这个名字」的形态；判定锚列举 C96/C105 实例但明确不限
 *       列举，下一形态不用再加选）/unclear。动机：逐形态加臂是打地鼠（C96 陈述
 *       句→C105 版本词→……），名字资格本质是一个判断不是一套语言学分类。mapper
 *       statementNameBlock+functionalLabelNameBlock 两门合并为 notMemeNameBlock
 *       单门（J1.37-J1.40 旧缓存行 choice statement/functional_label 兼容映射
 *       继续拦、entity_phrase 放行，存量行为 bit 不变）。题数不变 20
 * J1.42（2026-10-19，C108 名字门统一）：name_form 判据扩为四分支，升格为唯一
 *       名字门（用户裁定「很多门，不如合并为『合不合适作为 meme 币』门，这是
 *       根本的」+「如果代币的名字指向一个实体，那么这个实体到底是什么情况还是
 *       需要考量（例如普通币安员工就不行），但是 early 并不是一个实体」+「YAYA
 *       就是币安员工所以不行」「meme 名字拼写错误也肯定不行……用一个门涵盖
 *       多种情况」）：①指向实体——无名实体（普通员工花名 YAYA 型）不合格、
 *       圈内符号/超级IP合格；②非实体词——圈内文化词（early/趁早、HODL、LFG）
 *       合格、无感知句片段（滑雪/我要去）不合格，分界=用户侧感知非词源身份；
 *       ③形态缺陷（陈述句/版本词/序号，C107 继承）；④无背景拼写变体（自
 *       block_misspelling 探针并入）。触发案 EARLY（CZ 回复 "you got in early"
 *       逐字发币）被 web3_user_name_entity_acceptance common_word「截词」臂误拦——非实体词不走
 *       实体轴。mapper 侧 nrBlock（J1.10）/rmBlock（J1.28）/memFloor（C88）
 *       拦截位与 misspellingP 探针臂全部退役并入 notMemeNameBlock 单门；
 *       block_misspelling 题删除（C78 实证失效死键：Jev 答 0.13-0.27 拦不住）；
 *       web3_user_name_entity_acceptance/name_entity_memeability 题保留，只喂评分与 C88 五腿豁免链。
 *       题数 20→19
 * J1.43（2026-10-19，C109 题集收敛）：触发案交易猫（0xc929…7777，币安发猫图、
 *       币名=事件核心词）被 J1.29 载体门拦——name_entity_carrier=no_visual conf 仅
 *       0.09（掷硬币），同一次调用 name_image_consistency same_entity=0.73/
 *       conf 0.59 的事实证据被门无视；根因=web3_user_name_entity_acceptance 分类学缺「语料配图中
 *       出现的匿名实体」桶→指代链断裂→主体漂移。用户裁定「合并题/桶」：
 *       ①web3_user_name_entity_acceptance 6→3 桶（notable_other+minor_other+common_word+
 *       none_related 并入 other_referent；合并桶明确配图中出现的形象也是可判定
 *       指代来源——交易猫断链修复点；super_ip 桶不动=C88 sipProb 判据源）；
 *       ②event_subject_entity 8→2 桶（product_entity/other_entity，J1.27 消费口径
 *       功能产品/产品形象本就同拦）③name_entity_carrier 锚修正（删「与
 *       web3_user_name_entity_acceptance/event_subject_entity 同对象口径」假引用，锚定 web3_user_name_entity_acceptance
 *       指代对象）④name_event_relevance+relevance_level 两题合一（9 融合桶吸收
 *       level 语义，分值代码端 RELEVANCE_FUSED_SCORES）⑤quality_spelling+
 *       quality_reasonability 合并为 token_name_quality（0-3 band 索引，联合量纲
 *       0-12 保量表刻度）⑥event_token_block_reason 删 regional_event（182 全量 10815 行
 *       实证：9 次 argmax/0 次域内拦截=死桶，与 magnitude 三个「范围」镜头
 *       冲突）+ subject_unqualified（31 次/23 次弱概率拦截，与 name_form 无名
 *       实体臂/magnitude 无名低档/mem 0 档三重冗余；粉丝<1万量化锚由 name_form
 *       语义承接）。mapper 同批：M1 imgCarrierOverride（图证∧nicMatchP≥0.5 →
 *       J1.29 豁免——高置信事实证据覆盖低置信载体掷硬币）。基础题数 18→16
 *       （name_brand_hijack/name_image_consistency/parent_relationship 条件题另计）
 * J1.44（2026-10-19，C110 题集全面复查低风险收敛）：全量复查（16+3+4 题 ↔ mapper
 *       全消费点对拍）三处冗余收敛：①event_token_block_reason low_quality_derivative+token_ip_reuse
 *       功能双桶合一（均 A 域、判据重叠=对现有 IP/热点的低质衍生与直接复用、拦截
 *       效果等价，并入 token_ip_reuse 单桶；mapper BLOCK_SCOPE 低质桶显式空数组退役）；
 *       ②name_entity_memeability 题面瘦身——删「②与 web3 meme 买家口味的契合」维度
 *       及全部「圈内用户认不认/受众重叠」表述（该判据唯一归 web3_user_event_fit，C88 五腿
 *       内 mem≥2 与 strongFit≥0.5 双携同一判断的冗余收口），题只评对象自身玩味
 *       空间/二创潜力；分数量表 0-5 与 C88 mem≥2 腿判据不动（分数分布会移动）；
 *       ③同批清理：event_resonance 悬空注释（J1.36 已删题）。结构性两冲突
 *       （mag↔dim2 同轴对、event_token_block_reason 例行/营销三桶跨类空洞）用户裁定先 182
 *       扫描后另立 case，本轮不动题
 * J1.45（2026-10-19，C110 扫描后裁定）：①dimension2 题面删「档位应基本一致」
 *       同轴锚（182 实证 Pearson 0.85/Spearman 0.87、档位不一致仅 2.1%/0.26%——
 *       同一判断问两遍），改「同档主体之中传播面强弱细分」镜头 + 明确允许与
 *       档位不一致（高档主体传播面弱给低分、低档主体传播面强给高分，按本题
 *       自己的证据如实评）；类别分带/形状分流/J1.23/J1.35 证据源引用全部不动
 *       （用户裁定「题面瘦身保题」——消除同轴冲突保留档内残差信号，删题方案
 *       的 5.96% 翻转面否决）；②mapper BLOCK_SCOPE event_marketing_gimmick ['W','B']
 *       →'all'（182 空洞扫描：261 行 E/C/D/A/F/G 类蹭营销全放行、high/mid 逃逸
 *       25 票实买 6 票、noneP 全<0.5；「营销噱头无实质产品」语义不分类别，
 *       pubProxy/platformOfficial 豁免不受影响——用户裁定扩全域）。institution_
 *       routine 空洞同批扫描 86 行待 18 票盈亏复查另裁
 * J1.46（2026-10-19，C113 哭哭奶龙案 0xe935…7777）：两裁定落地——
 *       ①找角度语料传播力判轴纠偏（用户裁定重申 C32 正龟 J1.20「强调一万遍」）：
 *       量级/dimension2 传播判定对象=事件本身，不是载体推文数据。现场：奶龙错版
 *       玩偶票 dim2 8.2（微弱带「新账号/千粉以下」）按载体 138 粉判、magnitude
 *       1.61 D 档（「仅个别人提及」臂）按语料覆盖面判，A 类「IP 方权重：知名IP
 *       20-25」未用上。修三处：event_magnitude/dimension2 A 类句各加找角度锚
 *       （主体=被借势 IP 本身、按 IP 真实地位判可用世界知识、载体账号数据与
 *       「语料里只有小号提及」不参与定档）；jev-state-builder PRECOMPUTED 行
 *       （C74 时效分桶产物「低影响力: 138粉,0赞,0转」顶着「直接采信」帽子污染
 *       判断现场）加 tweet_type_note 划定用途边界。②token_ip_reuse 判据边界重写
 *       （用户裁定「合理即可，无意义的修改无意义，有意义的修改为什么不行」）：
 *       「简单替换/拼贴/抄袭/模仿等低质衍生」边界词改为有意义/无意义——有意义的
 *       修改/变形（新造型/错版/变体/新玩法等具体新梗对象）是 meme 币正常玩法不拦，
 *       仅拦纯蹭名（原名原形象直接套用无任何新内容）与无意义修改（换皮改名/硬拼
 *       无关元素）。mapper 零改动（BLOCK_SCOPE token_ip_reuse:['A'] 不动）
 * J1.47（2026-10-19，C114 DND 案 0x4dbcb10e…7777）：name_form 通用梗缩写锚
 *       （用户裁定「从用户的角度想一下，币安发了一个推，内容 DND（do not
 *       disturb），然后视频是一只猫拉上窗帘。DND 能不能作为一个小 meme 币？」
 *       =能）——合格分支②扩通用网络梗/文化缩写（DND/FOMO/LFG：非圈内原生但
 *       用户侧有感知、可配梗传播）；不合格分支加机构职位/品牌内部缩写（工牌
 *       Chief Risk Officer→CRO 型）；对照锚加 DND 合格/CRO 不合格缩写对（缩写
 *       分界同总则=用户侧感知，非是否圈内原生、非出自谁）。同案 mapper 侧
 *       C114 event_empty_content 图证在场豁免（代码臂，另见 jev-result-mapper）。
 *       题数不变 16
 * J1.48（2026-10-19，C116 猫案 0x2157…7777「只是一只猫」）：name_form 整句
 *       情绪姿态分界 + not_meme_name 根本判据立碑（用户两裁定「作为一个 Web3
 *       用户，会接受这个名字吗？——是会接受呀」/「名字也是一样的，用户能不能
 *       接纳它作为 meme 币是最根本的」）——①合格分支②扩「有 meme 情绪姿态的
 *       整句/短语」臂（自嘲/躺平/降格反差/宣言句式：「只是一只猫」=just a
 *       chill guy 同款自嘲降格句式，句子本身携带可传播姿态、用户接得住当
 *       符号）；②不合格分支「句片段」臂加「无情绪姿态」限定（「滑雪/我要去」
 *       =纯生活陈述）；③对照锚加整句对（「只是一只猫」合格/「我要去滑雪」
 *       不合格），句子分界=有无 meme 情绪姿态，非是否整句、非句子长短；④
 *       not_meme_name criteria 立根本判据=web3 用户不接纳它作为 meme 币的名字
 *       （同事件侧 web3_user_event_fit 用户视角同构），形态列举降为佐证。mapper 零改动
 *       （notMemeNameBlock 判据 name_form 三态不动，纯措辞翻 argmax）。
 *       题数不变 16
 * J1.49（2026-10-19，C118 DND 案 0x4dbcb10e…7777 二轮，用户裁定「载体豁免认
 *       演绎关系，立 case 修」）：新增条件题 image_depicts_name（配图对名字的
 *       演绎关系，仅 imageConsistency 时问，17 题）——C114 后 DND 翻过
 *       event_empty_content 落载体门拦死（no_visual 0.40-0.51 掷骰+C109 豁免因
 *       unrelated 0.85 不触发），但「猫拉窗帘视频=do not disturb 的画面演绎」
 *       本身就是载体存在的事实证据。与 10.7 name_image_consistency 正交分工：
 *       10.7=名与图所指实体同一/同类（J1.30 消费），本题=图演绎名字含义
 *       （J1.29 演绎臂消费）——概念名（缩写/口号）无实体对应，10.7 天然
 *       unrelated，演绎证据由本题独立承接；两豁免判据刻意分离防互扩。
 *       对照锚 DND+猫拉窗帘=depicts_name / CRO+猫图=decorative
 * J1.50（2026-10-19，C119 猫案 0x2157…7777 三轮，用户裁定「一切从用户角度
 *       出发」三题用户视角统一）：①name_form 问法收敛「web3 用户能否接纳
 *       这个名字作为 meme 币的名字」+ 三态键改名 web3_user_acceptable /
 *       web3_user_not_acceptable / unclear（mapper NOT_MEME_NAME_CHOICES
 *       收新键+全旧键兼容，正臂结构不变 Set 外即放行）；②name_event_relevance
 *       主轴改「web3 用户能否理解并接纳这种关联」——各档=「关联方式×用户
 *       理解度」刻画非语言学自足分类，用户 get 不到的关联不因论证成立而
 *       升档（Stage3 关联分，不进 Stage2 60 分线）；③event_magnitude 判定
 *       主轴改「Web3 用户对事件的接纳与被影响程度」+ dimension2 同主轴
 *       「实际被调动起来的传播面」——三维度（事件分/传播面/时效=既有公式
 *       三项）降为参考锚不是定死映射：Web3 meme 原生母题（猫狗/动物梗/
 *       doge 系/圈内梗/AI 极客梗，J1.23 圈内偏好同款）按用户侧实际被影响
 *       程度升档，圈外传统热点不因规模大而升档。猫案动机：C116 后名字门
 *       翻正但量级门 59.72<60 拦（事件 22 C 档+传播面 22.72+时效 15）——
 *       猫梗事件对 web3 用户接纳度高，客观传播数据小不该压死用户侧判档。
 *       题数不变 16（条件题 17）
 * J1.51（2026-10-19，C119 批内修正）：dimension2 开头改「评用户侧调动面本身
 *       （母题/IP 圈内认知面），非语料实测互动」——J1.50 版「实际被调动起来
 *       的传播面/多少人注意到/讨论」措辞把镜头导向语料账号实测互动，全量
 *       对拍 C113 哭哭奶龙回归实证：档位稳 B(27) 但 dim2 28.2→13.2 塌档
 *       （probs 落 0-1 带 0.72，138 粉载体推文形状），与 J1.46「载体数据
 *       不参与判分」锚直接打架；猫票同向 22.72→18。修正后镜头=认知面/
 *       传染力（小号载体≠小事件），event_magnitude 两票档位未动（22/27
 *       原样）不改。题数不变
 * J1.52（2026-10-20，C121 用户视角批次一）：①w_product_score 评估主轴切
 *       「web3 用户对这个发布的关注与兴奋度」（客观创新性降参考锚+显式否定
 *       发布后实测数据读法）；各带形态结构词刻意保留（C42 wNewProductP=
 *       1−P(0)−P(1) 依赖 0/1=小改进、2/3=产品发布带结构）。②event_token_block_reason
 *       niche_subculture 判据从「圈外人无法理解/无出圈可能」（大众出圈视角，
 *       与用户视角原则相反：crypto 圈内梗对 web3 用户恰是原生强契合）切
 *       「web3 用户接不接得住」（认知可达性轴）；分工：本题问 get 得到/
 *       get 不到，web3_user_event_fit 问想要/不想要。182 前置扫描 35 行全 event:A
 *       活桶（非死桶故改锚不退役）。BLOCK_SCOPE ['A'] 不变、mapper 零改动。
 *       web3_user_name_entity_acceptance super_ip 量级锚切圈内符号级另立 J1.53 单独成版（五腿
 *       +骑乘改道+策略标签三链翻转归因隔离）。题数不变
 * J1.53（2026-10-20，C122 门名断代，零行为意图）：用户裁定「name_form/
 *       niche_subculture 等门的名字都改一下，现在表达的含义是『Web3 用户
 *       接纳度』/『Web3 用户圈层可达性』」——①name_form 题键改
 *       web3_user_name_acceptability（内容不动，问法本就是「web3 用户能否接纳
 *       这个名字」）；②event_token_block_reason 桶 niche_subculture 改
 *       token_circle_reachability（判据不动，J1.52 已切认知可达性）。题键
 *       断代：mapper 双键读（新键优先，旧键=存量缓存行兼容），审计键
 *       nameForm/nameFormBlock 同步改名 web3UserAcceptability/
 *       web3UserAcceptabilityBlock，概率键跟随题键。BLOCK_SCOPE/LABELS
 *       新旧双键并存（旧键仅存量数据/测试形状可读）。题数不变
 * J1.54（2026-10-20，C123 门名/题键语义化，零判据改动）：用户指令「其它门
 *       的名字也请梳理下，以类似思路，做一下调整」——①event_magnitude 改
 *       web3_user_event_impact（J1.50/J1.51 起主轴已是「Web3 用户对事件的接纳与
 *       被影响程度」，键名仍停在客观量级）②dimension2 改 web3_user_event_spread
 *       （无语义占位名；J1.23/J1.45/J1.50/J1.51 后语义=用户侧传播面/调动面）。
 *       题面判据文字零改动，仅键名与本文件内跨题引用同步改名（原
 *       event_magnitude 引用 8 处、event_subject_entity 引用 1 处）。mapper 双键读
 *       （新键优先、旧键=存量 answers 兼容——scan-c88 等工具读历史行重放）、
 *       审计键同步语义化（详见 mapper 头注释与台账 C123）。题数不变
 * J1.55（2026-10-20，C124 web3_user_name_entity_acceptance 圈内符号级锚）：用户裁定「超级IP 的判据
 *       应是 web3 用户普遍认作符号（被拿名字/形象/绰号玩梗、当标签当口号）
 *       的符号级，不是听说过/大众媒体量级」——super_ip 桶主定义切「圈内符号
 *       级」：大众量级不高但圈内是符号（哭哭奶龙型）照判本档；纯大众知名但
 *       圈内不认作符号（圈外明星/传统品牌）不因大众量级升入本档；明确「本题
 *       只判身份量级、不评玩味（name_entity_memeability 另评）」。J1.18 发布者
 *       指代分支/三前提/关于自己的原话词/亲口提及实体/官方产出物口号/配图
 *       形象指代臂（J1.43）全部保留不动；other_referent ① 承接句同步「知名但
 *       非符号级」。mapper 零改动（choice 键名/兼容不变）；行为边界移动属预期
 *       （C88 五腿第一腿可达性、rideDetour 改道边界、deriveSuperIpLabels 标签
 *       分布）。题数不变
 * J1.56（2026-10-20，C126 何一「こんにちは」案 + 用户视角命名批次）：
 *       ①**题名按评估对象显式化**（用户裁定「命名从用户角度出发，标明针对事件
 *       还是币名」）：web3_user_event_impact / web3_user_event_spread /
 *       web3_user_event_fit（事件轴）、web3_user_name_acceptability /
 *       token_name_quality（币名轴）、name_event_relevance / name_brand_hijack
 *       （名×事件联合）、event_finding_vs_recap / event_token_block_reason /
 *       event_subject_entity（事件轴蛇形补齐）、name_entity_memeability /
 *       name_entity_carrier（币名所指实体）。纯 id 改名，判据/选项零改动。
 *       ②**name_referent → web3_user_name_entity_acceptance 语义重构**（用户
 *       裁定「超级IP 概念复用混淆；应改为币名映射实体对 Web3 用户的接受度/
 *       影响力」）：三选项 accepted（映射到用户认得的实体——含官方口号/发布者
 *       指代）/ unknown（实体存在但用户不认得——普通员工/小号/周边人物）/
 *       no_entity（不映射实体——普通词/截词/问候语/陈述句，**中性不拦**）。
 *       作者原话票不再靠本题升档（问候语如实 no_entity），改由 state
 *       corpus_author_identity + 代码侧 authorUtterance（币名逐字出自主推文本）
 *       承担 C88 第一腿；旧 subject_self/super_ip/other_referent/minor_other/
 *       common_word/notable_other 六选项退役。
 *       ③mapper 配套：unknown ≥0.5 → 实体低影响力拦截门（域 B/C/D/F/G/W，旧
 *       J1.10 nrBlock 规格）；recognizedEntitySlogan → recognizedEntitySlogan（第一腿
 *       accepted≥0.5 ∨ authorUtterance）；rideDetourMass 退役（新 unknown 门
 *       覆盖其 B/C 低影响力实体面，W 数学路径不再触达）；state super_ip_hit →
 *       corpus_author_identity。题数不变
 * J1.57（2026-10-20，C126 概念清理批次，用户裁定「一个概念只出现一次」）：
 *       ①name_entity_memeability 删去 J1.34 越界到实体接受度轴的「对象在 web3
 *       圈的当前/潜在影响力和符号性」措辞——只留内容载体与二创潜力（认得≠好玩：
 *       认知度归 web3_user_name_entity_acceptance，契合度归 web3_user_event_fit）；
 *       0-1 档「无名」改为「无内容载体」，二创实绩=载体证据不是知名度加分。
 *       ②web3_user_name_acceptability 收窄为纯名字形态轴：删「能接纳」里的
 *       「名字指向圈内符号/超级IP/有玩味空间的实体」分支与「不能接纳」里的
 *       「指向无名实体」分支（前者归实体题 accepted、后者归实体题 unknown→实体门）；
 *       保留圈内文化词/通用梗缩写/情绪姿态整句与形态缺陷族。
 *       ③event_token_block_reason.token_circle_reachability 加划界句（事件源圈层可达性
 *       vs 名字实体认知度 vs 用户偏好三轴不互相顶替）；event_empty_content /
 *       event_institution_routine 与 web3_user_event_impact 划界（是否存在事件 vs
 *       事件多大）。题数不变
 * J1.58（2026-10-20，C126 何一「こんにちは」案第二轮，用户裁定「event_empty_content
 *       判断是错误的——何一发一个问候语，在 BSC meme 币场景不是空洞行为，何况
 *       是回复另一个实质性事件」）：event_empty_content 判据收窄——无主体无上下文的
 *       日常闲聊才是空洞；圈内符号级/高影响力账号本人的公开问候/表态/简短回应
 *       是 meme 市场的事件素材，回复实质性事件的简短回应=对该事件的参与/表态，
 *       均不算空洞。mapper 配套：event_empty_content 臂在 context.corpusAuthorInRegistry
 *       （语料作者=super-ip 注册表在册）时不拦（审计 emptyContentAuthorOverride，
 *       与 C114 图证豁免同构）。影响题划界句同步（量级题只评已成立事件）。
 *       题数不变
 * J1.59（2026-10-20，C126 概念清理批次，用户裁定「block reason 也要划分是针对
 *       事件还是针对代币」）：event_block_reason → event_token_block_reason；
 *       选项按对象前缀化——event_empty_content / event_institution_routine /
 *       event_marketing_gimmick / event_baseless_speculation /
 *       event_negative_hard_news / event_routine_content_product（事件层）；
 *       token_ip_reuse / token_circle_reachability（代币层：名字/形象本身缺陷）。
 *       判据/阈值/作用域零改动（纯键名+对象标注）；题面加分类说明。题数不变
 * J1.60（2026-10-20，C126 同批次修复）：J1.59 分类说明里的类别枚举（「空洞/
 *       机构日常/营销噱头/…」）产生 priming 漂移——C119 猫案 none 0.58→0.16、
 *       marketing_gimmick 0.26→0.43（mid→low，3 次采样稳定）。删枚举只留
 *       「event_*=事件层 / token_*=代币层」短说明后恢复 mid 64.74；判据零改动。
 * J1.61（2026-10-20，C126 收口，用户裁定「name_entity_memeability 合并到
 *       web3_user_name_acceptability 然后删除」）：删除独立的 0-5 分玩味题
 *       （题数 17→16）——其「内容载体/二创潜力」判断并入 web3_user_name_
 *       acceptability：能接纳新增「所指对象有可玩/可二创的内容」臂，不能接纳
 *       新增「所指对象没有任何可玩内容」臂；认知度仍归实体题（J1.57 划界不变）。
 *       C88 五腿→四腿（去掉 mem≥2 腿），名字形态/玩味责任由名字门单点承担；
 *       原 mem 审计字段停止产出（历史行保留）。
 * J1.62（2026-10-20，C97 币安游戏案，用户裁定）：①event_marketing_gimmick 收窄
 *       ——有实质对象/参与机制的营销活动（产品发布/活动官宣/节目征名/赛事报名/
 *       抽奖机制等）不选本项，「好的营销」不是阻断理由；事件撑不起币由量级/
 *       影响力轴判（C97 正确死因=地域子账号 D 档量级门「事件撑不起币」，不是
 *       营销噱头）。②web3_user_event_impact 补营销事件口径：营销/征名/节目/
 *       活动类事件按事件本身对 Web3 用户的影响力评档，不按机构规模直接映射
 *       （大机构的边缘活动≠大事件）。题数不变
 * J1.64（2026-10-20，C110 币安菠萝 + C83 BI 簇案，用户裁定「走 B：影响力按
 *       用户侧认知/可调动性，账号规模只作覆盖上限；BI 也可以给过；事件撑不起
 *       币由影响力轴判」）：①web3_user_event_impact 口径重写（B 标准）——形状①/
 *       六档锚点去掉粉丝数映射，改用户侧认知与可调动性；品牌具象视觉物料
 *       （币安符号菠萝、币安脸梵高像）B 档起评；机构边缘活动（节目征名）D 档。
 *       ②删除 event_marketing_gimmick 选项（噱头并入影响力轴——「影响力大但
 *       无实质」在用户侧口径下不成立，标准修正后由 D/E 档承担）；mapper 同步
 *       删除该选项的 argmax 豁免臂与 J1.63 图证豁免。题数不变
 * J1.65（2026-10-20，C126 何一「こんにちは」收口，用户裁定「这个标准就是有问题，
 *       在 Web3 用户侧，何一发这一句作为 meme 名字是应该能被认同的」）：
 *       web3_user_name_acceptability 增「高影响力主体本人说出的词句」能接纳臂
 *       （原话/口令/问候/口头禅，主体有用户侧认知 → 用户会当该主体的梗传播；
 *       C126 锚）；版本/功能标注反锚强化（即便逐字出自超IP原话也不接纳——C105
 *       日本語版案），防止 C105 被本臂误放。题数不变
 * J1.66（2026-10-20，C126 手臂边界细化，用户裁定）：「绝不是说什么话都可以——
 *       问候语可以、口号可以、自创口号、简短情绪表达都可以；但说自己要去滑雪
 *       爬山、单纯说一句谢谢等等都还是不行。还是站在用户角度」：
 *       web3_user_name_acceptability 超IP原话臂收窄为**符号性词句**（问候语/
 *       口号/宣言/自创口号/情绪表达）；新增反锚——生活陈述/个人行动/日程、
 *       礼貌套话/事务性寒暄（谢谢/感谢支持）即便出自超IP原话也不接纳。题数不变
 * J1.67（2026-10-20，C126 同轮措辞细化，用户裁定）：「应该是这样——BSC 链的
 *       用户，或者说 Meme 币的玩家看到这句话」+「何一这句话之所以能过，是因为
 *       她对 BSC 链 Meme 币用户的特殊影响力」：①超IP臂的用户模拟镜头从泛 Web3
 *       用户收紧为 **BSC 链用户 / Meme 币玩家**；②判定锚写明=**该主体在 BSC 链
 *       Meme 币玩家群体里的特殊影响力**（不是泛泛的「高影响力主体」）。判据不变，
 *       只改模拟对象与影响力归属措辞。题数不变
 * J1.69（2026-10-20，C130 名字门判据对象收敛，用户裁定）：「币名应该看 Symbol」：
 *       web3_user_name_acceptability 的判定对象从「代币 Name/Symbol 取更完整的一个」
 *       收敛为**链上 Symbol（币名/ticker）**——Name 是链上全名/描述句，不作本题判据。
 *       判据内容（能接纳/不能接纳的各形态）一字不动，只改判谁。题数不变
 * J1.72（2026-10-20，C132 影响力判分标准重写，用户裁定）：「不是『新影响力』的判分
 *       标准不对」「我一直强调，从 web3 用户的角度出发看影响力，而不是死板的分级」——
 *       J1.71 的 0-5 档位锚仍是主体量级档，Jev 只给量级、传播/时效没进分数（回归
 *       高/低票重叠 r=0.16）。J1.72 改为**模拟 BSC meme 买家的真实反应**评分：
 *       代入买家看到这条叙事的第一反应（会不会停下来/想玩梗/想买/想转发），
 *       分数=反应在用户群体里的强度；传播面/时序是反应来源而非独立项；
 *       criteria 只描述反应强度（0-5），不做事件分级、不按粉丝/播放量查表。
 *       题数不变
 * J1.71（2026-10-20，C132 事件侧三合一，用户裁定）：「web3_user_event_impact 肯定
 *       包含 web3_user_event_spread；event_timing 从用户角度也是影响力的一部分——
 *       全部融合为一个，只有一个：用户角度的影响力」：标准路径只保留一道事件价值题
 *       web3_user_event_impact（语义扩为「Web3 用户影响力」，0-5），传播面与时效作为
 *       题内证据、不再独立计分；web3_user_event_spread 题删除；event_timing 仅保留
 *       给 W 数学（产品类另一套算法）与四条时效 override 审计。C44/C94 传播锚改为
 *       影响力下限 50（用户裁定不保过线）。题数 -1
 * J1.70（2026-10-20，C130 同族收尾，用户指令「mapper 变量能否直接使用名字」）：
 *       审计键/局部变量语义化（**零判据零行为**）——stage2Total→eventCompositeScore、
 *       tierScore→impactTierScore、effSpread→spreadScore、spread→rawSpreadScore、
 *       timeliness→timingScore、加权事件分 eventScore→weightedEventScore；
 *       scoringResult.totalScore→eventCompositeScore；stage_final.details.
 *       stage2TotalScore→eventCompositeScore、eventScore→weightedEventScore。
 *       前端/工具双键读（新键优先、旧键=历史行兼容）。题数不变
 * J1.72（2026-10-20，C133 股城案，用户裁定）：「这是新发的项目，并且已经在 BSC
 *       链用户群发出了信息，那为何说『用户不认得该实体』？我觉得可以算是
 *       new_entity，也就是新实体」：web3_user_name_entity_acceptance 新增第四选
 *       **new_entity**——刚诞生/刚发布、且已在 BSC 链用户群（推特/社区/官方渠道）
 *       发出信息的新项目/新品牌/新角色/新资产；用户此前没听说过是正常的，不按
 *       「认知度不足」判 unknown（unknown 收窄为**已存在实体**在用户侧无认知）。
 *       mapper 实体低影响力门只读 unknown 概率（new_entity argmax ⇒ unknown<0.5
 *       天然不拦）；新实体的名字形态/内容由名字门与下游题判。题数不变
 */

export const JEV_QUESTIONS_VERSION = 'J1.72';

/**
 * 品牌劫持关键词预检表（自 stage3-token-analysis.mjs V21.0 迁入，规则原样）
 * 代币 Symbol/Name（去 emoji/数字/特殊字符后）命中任何一项时才向 Jev 提出
 * name_brand_hijack 问题，否则省略（省 token、避免无品牌代币被误判）。
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
 * 检查代币名是否命中品牌劫持预检（决定是否问 name_brand_hijack 题）
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
 * @param {boolean} [options.referentMemeability] - 已废弃（J1.28 起恒带，传不传
 *   均包含）：J1.21 时仅 superIP 快车道携带（nameReferentBlock 豁免评分）；
 *   J1.28 起标准路径恒带——mapper 低档门（memScore≤1 → 不适合成为meme币）判据源
 * @param {boolean} [options.carrier] - 已废弃（J1.29 起恒带，传不传均包含）：
 *   dry-run 阶段的 opt-in 参数（题面验证期），J1.29 转正式恒带——mapper 载体门
 *   （C/D+非existing / E+no_visual 拦）判据源
 * @param {boolean} [options.imageConsistency] - 是否包含名字与配图主体一致性题
 *   （J1.30，仅语料含【图片内容分析】块——主推配图分析成功挂载——时为 true）：
 *   mapper 名图一致豁免（imgNameExempt）判据源。条件题与 name_brand_hijack 同模式：
 *   无图不问（防幻觉作答），题集形状按语料有无图分叉
 * @param {boolean} [options.parentRelationship] - 是否包含载体与父推关系题
 *   （J1.39，仅语料任一载体槽位（主推/website_tweet/quoted/retweeted）带
 *   【回复的推文】块时为 true）：mapper C103 源头窗（翻译/二手解读 + 父推
 *   >24h → timing older）判据源。条件题同模式：无父推不问防幻觉作答
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildStandardQuestions(options = {}) {
  const includeBrandHijack = options.includeBrandHijack === true;
  const imageConsistency = options.imageConsistency === true;
  // J1.39 条件题 parent_relationship：语料任一载体槽位带【回复的推文】块才问
  // （无父推不问防幻觉作答；twitter-section 渲染条件同源——tweet.in_reply_to
  // 存在即渲染）。mapper hasReplyParent 同判定，两端共用防漂移
  const parentRelationship = options.parentRelationship === true;

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
- D vs W boundary: when a crypto-native institution (exchange / public chain / Web3 platform, e.g. Binance) officially announces ITS OWN new product or feature via its official account, the subject is the institution's announcement → D (institutional action), NOT W. W is reserved for standalone Web3/crypto projects or products where the product/project itself is the subject (a third party launching/announcing a Web3 project, or a non-institutional project's own release).
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
        F: 'Discovery: hidden pattern / data insight / narrative finding, evidence-backed, author-discovered. NOT a news event the author merely witnessed/reported (e.g. "X appeared on national TV" is E; an institution/person making news is D/C) — even if phrased as a discovery ("spotted", "noticed"): F requires the finding itself (the pattern/insight/connection) to be the subject, not a publicly happening news event',
        G: 'Speculation: future prediction with reasoning but insufficient evidence',
        C: 'Personal statement: an individual speaking personally (not as institutional official mouthpiece)',
        D: 'Institutional action: official account announcement/action of a company or organization',
        E: 'Social hotspot: trend/viral content spreading on social platforms now',
      },
    },

    // ── 1.5 发现 vs 新闻转述（J1.37 恒带：mapper F→E 改道判据源——C96 币安
    //     上电视案；非 F 类时为观察答案，落库不消费）──────────────────
    event_finding_vs_recap: {
      type: 'choice',
      instructions: `叙事内容的性质（finding vs recap）。判定语料承载的故事内容属于哪类：
⚠️ 评估对象=叙事内容本身（不是发币者、不是事件主体）：故事讲的是「一个发现」还是「一条新闻」。
- 发现（narrative_finding）：作者声称自己发现/揭示了一个隐藏的模式、数据洞察、异常现象或叙事关联——发现的内容本身是卖点（如：鲸鱼地址在悄悄吸筹、链上出现异常模式、两个看似无关的事物被揭示出联系、一个被所有人忽略的信号）。发现的动作是「揭示」，揭示出的东西在此之前不为人知。
- 新闻转述（news_recap）：语料在报道/目击/搬运/庆祝一条已经发生的新闻事件（X 出现在电视上 / X 发布了新产品 / X 达到了某价格 / X 发生了某事）——「发现」「spotted」「看到了」只是目击动作，事件主体是外部实体，目击者只是报道者，事件的新闻价值属于事件本身。
⚠️ 关键判别：作者的「发现语气」（我看到了/我发现/spotted/noticed）不构成发现——要看「被发现的东西」是隐藏的模式/洞察，还是一条公开发生的新闻。大V 发推报道自己看到的新闻事件（如某人发推说某币上了电视、某产品出现在某处）→ news_recap。`,
      criteria: {
        narrative_finding: '作者自己的发现——隐藏模式/数据洞察/异常现象/叙事关联，发现内容本身是卖点（发现前不为人知）',
        news_recap: '新闻转述——报道/目击/搬运一条已发生的新闻事件，「发现」只是目击动作，事件主体是外部实体',
        unclear: '无法判断——语料不足以区分两者',
      },
    },

    // ── 2. 事件主体量级（原 Stage2 维度一，6 档有序）──────────────────
    web3_user_event_impact: {
      type: 'score',
      instructions: `Web3 用户影响力（web3_user_event_impact；J1.71 合并原 impact+spread+timing，唯一事件价值题），0-5 分。
⚠️ 判断方式（J1.72，用户强调：从 Web3 用户角度出发看影响力，不是死板分级）：
把自己代入一个 **BSC 链的 Meme 币买家**（华语 crypto 圈为主、玩梗/乐子导向、看重财富叙事），正在刷 X/群聊，看到这条叙事时的第一反应是什么——
会停下来吗？看得懂吗？觉得有意思/想玩梗/想买/想转发/想二创/想喊朋友一起吗？还是直接划过去、无感？
分数 = 这种反应在 Web3 用户群体里的强度，不是对事件客观规模的分类：
- 5 = 全圈刷屏——圈内几乎所有人都在讨论/参与/刷屏，你很难不注意到，身边人都在玩/传；
- 4 = 圈内普遍认得住、正在广泛传播/参与，你会主动去看/参与；
- 3 = 圈内一部分人在讨论/玩，你觉得有点意思、可能参与；
- 2 = 少数人知道/小范围讨论，你大概率划过去；
- 1 = 几乎没人注意，你完全不会停下来；
- 0 = 完全无感/无事件——看不懂、没有任何可玩内容、或根本没人提起。
⚠️ 不要按粉丝数/播放量/机构规模查表打分——这些只是线索，不是分数锚。要回答的是「作为一个 BSC meme 玩家，这件事当下对我的影响与调动有多大」。
⚠️ 传播面与时序不是独立加分项，而是这个反应的来源：圈内已经在讨论/传播/二创=反应强；事件已过气、还没发生且无人讨论、或只有发币者自己在说=反应弱。未来事件若已被圈内广泛预期/预热（官宣/大V造势/社区期待），反应可以强；纯未来且没人讨论，反应弱。
⚠️ 主体判定（先分清事件讲的是谁，再模拟用户反应）：
形状① 陈述者关联事件——事件就是陈述者（发推人/被回复者）本人的言行/作品/声明/行为 → 主体=该陈述者本人；影响力按该言行/作品在 Web3 用户侧的真实反应评——粉丝量只是覆盖上限/线索，不是评分锚。
形状② 陈述者无关联、只是陈述者——事件是外部实体（外部热点/他人事件/监管政策/平台现象），陈述者只是报道/搬运/评论/找角度 → 主体=该外部事件本身，按事件自身的传播与用户反应评，陈述者的粉丝数既不代表也不封顶事件量级。
- 推文报道/搬运/讨论外部热点（某视频在抖音爆火、某事件上微博热搜、某大新闻/全国性政策新规）→ 形状②：主体=该热点事件的主角/发起方，发推人只是信息搬运者。
- 有人发币/发推是作者自己的内容/作品/声明 → 形状①：主体=作者；粉丝数/认证只作覆盖上限，评分看内容在用户侧的真实反应。
- 找角度/解读型推文 → 形状②：量级针对被借势/被解读的原始事件主体，不是发推人。
- 回复/转述/引用型语料 → 按被回复父推/被转述源头所陈述的事件定形状与主体；父推/源头本身就是事件的传播证据（十万粉级以上父推主动陈述该事件=事件被大V扩散的证据，计入事件传播规模），回复者本人的粉丝数不参与定档。
⚠️ 用户视角的类别提示（只作思考线索，不是档位映射）：
- 形象 IP/角色：站在买家立场问「这个形象会不会被圈内拿去做梗/二创/当吉祥物/当头像」——可爱萌系/极客风/猎奇荒诞/圈内梗形象天然有反应；传统严肃正剧角色圈内通常无感。作品未开播/大众无名不等于没反应，看圈内会不会玩。
- 非 Web3 产品：看圈内会不会讨论/参与这个产品发布；母公司名气不自动转移给产品；版本更新/小改进通常没人讨论。产品实体（公司发布的产品）：看产品本身在圈内会不会被讨论/玩梗；母公司名气不转移给产品；公司自己的宣传声量/媒体通稿不算自传播；只有产品自带可玩形象或被第三方自发传播才算有反应。
- 人物/机构：看用户在不在意这个人/机构这次说的话/做的事——大号例行内容、机构边缘活动圈内通常无感。
- 社会热点：圈内是不是正在讨论/传播；已过气热点反应弱。
- 品牌具象物料（币安符号菠萝、币安脸梵高像等）是用户会拿去玩梗/二创的资产，反应可以强；没有实质内容的营销噱头圈内无感。
⚠️ J1.57/J1.58/J1.62 划界：是否构成事件由 event_token_block_reason 判；一旦事件成立，按上面的用户反应评分，不重复做「有没有事件」的判断；营销/征名/节目类按用户反应评，不按机构规模。
⚠️ 币安等 crypto 原生机构：链上买家即其生态用户，其产品的用户反应正常评（不因是机构产品而机械降档；事件类别按机构公告口径评估，不判 W）；产品实体切分不适用于它们。`,
      criteria: [
        '0 = 完全无感/无事件：看不懂、没有可玩内容、圈内没人提起',
        '1-2 = 少数人/小圈子有反应，你大概率划过去',
        '3 = 圈内一部分人在讨论/玩，你可能参与',
        '4 = 圈内普遍认得住、正在广泛传播/参与，你会主动参与',
        '5 = 全圈刷屏/大规模参与，你很难不注意到',
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

    // ── 3.5 载体与父推关系（J1.39 条件题，仅 parentRelationship（语料任一载体
    //    槽位带【回复的推文】块）时加入：mapper C103 源头窗判据源——Jean Phil
    //    翻译洗白案。条件题与 name_brand_hijack/name_image_consistency 同模式：无父推
    //    不问防幻觉作答）──
    ...(parentRelationship ? {
      parent_relationship: {
      type: 'choice',
      instructions: `载体推文与被回复（引用）推文的内容关系（时效洗白判据）。语料中的推文（载体）回复/引用了另一条推文（被回复推文，见【回复的推文】块）时，判定两者内容的实质关系：
⚠️ 评估对象=内容关系本身（载体是否贡献了新东西 × 被回复推文是否一手来源），不是影响力、不是真实性、不是时效。
- 新角度解读（new_angle_on_original）：载体推文借被回复的原生推文解释某个现象，有自己的新解读/新角度——被回复推文是原生素材（一手新闻/官方发布/当事人原创），载体的解读本身是新的内容。
- 翻译搬运（translation_or_repost）：载体推文基本是被回复推文的翻译（含跨语言逐句对应）、复述或搬运——内容一一对应，没有新增解读。
- 解读二手解读（explains_derivative）：被回复的推文本身是找角度/解读/转述类内容（不是一手来源，它自己也在解读别处的内容），载体是在解释/传播一条二手内容。
⚠️ 判别锚：跨语言逐句对应=翻译搬运；被回复推文自己就是二手解读=解读二手解读；载体有自己的观点/角度/发现且被回复推文是一手内容=新角度解读。`,
      criteria: {
        new_angle_on_original: '新角度解读——载体借原生父推（一手素材）解释现象，有自己的新解读',
        translation_or_repost: '翻译搬运——载体基本是父推的翻译/复述/搬运，无新增解读',
        explains_derivative: '解读二手解读——父推本身是找角度/解读/转述内容，载体在解释二手内容',
        unclear: '无法判断——语料不足以区分三者',
      },
      },
    } : {}),

    // ── 4. 维度二：主体影响力/传播权重（原各类 Stage2 第二维度，0-30）─
    // ── 5. 硬阻断（原各类 Stage2 阻断条件合集；J1.43 退役 2 桶、J1.44 合桶后=none+8 阻断桶）──
    event_token_block_reason: {
      type: 'choice',
      instructions: `硬阻断检查（hard-block check）。该事件或代币是否命中任一硬阻断条件？未命中选 none。
阻断=无叙事价值/无传播潜力，无论分数多高都不能通过。
⚠️ J1.59 选项按对象分两类：**event_* = 事件层否决**（事件本身的性质）；**token_* = 代币层否决**（代币名/形象本身的缺陷）。选真正命中且最突出的一项。`,
      criteria: {
        none: '无阻断——事件有明确主体和内容，有叙事价值',
        // J1.52（C121）：判据从「圈外人无法理解/无出圈可能」（大众出圈视角，与用户
        // 视角原则相反）切「web3 用户接不接得住」（认知可达性）。分工：本题问 get
        // 得到/get 不到，web3_user_event_fit 问想要/不想要——两种失败不同（圈内能懂但严肃无梗
        // ≠圈外黑话）。crypto 圈内梗对 web3 用户=原生强契合，不选本项（J1.36：meme
        // 币不需要出圈）。⚠️ 品牌营销边界（C110 币安菠萝 A/B 归因：新措辞把
        // 「币圈原生亲切感」泄漏到营销噱头判定，gimmick argmax 100%→47%）：圈内梗
        // 只指社区自发形成的文化梗，交易所/项目方的品牌物料/官方周边/活动噱头
        // 不是社区梗——带币安/crypto 品牌不等于圈内契合。
        // J1.53（C122）：桶键 niche_subculture → token_circle_reachability（门名
        // 对齐语义；判据内容不动）。
        token_circle_reachability: 'Web3 用户圈层可达性不足——名字/形象源自与 crypto 圈不重叠的圈外亚文化（垂直领域黑话/圈子内部梗/地域性社群文化），web3 meme 买家看到它 get 不到梗、无从玩起。⚠️ crypto 圈内梗/黑话≠小圈子——对 web3 用户恰是原生强契合（PEPE/doge/币圈自嘲梗型形象不选本项）；但「圈内梗」只指社区自发形成的文化梗：交易所/项目方的品牌营销物料、官方周边、活动噱头不是社区梗——名字带币安/crypto 品牌不等于圈内契合，无实质产品/事件内容的仍归营销噱头；「圈外」的唯一口径=crypto 圈用户能不能 get（认知可达性），不是大众出圈前景——需不需要/想不想要另有题评（web3_user_event_fit），meme 币不需要出圈。⚠️ J1.57 划界：本题问**事件/叙事源**的圈层可达性（事件本身对圈内不可读）；币名映射实体认不认得由 web3_user_name_entity_acceptance 判——三种失败不要互相顶替',
        event_empty_content: '空洞内容——无主体、无上下文的日常闲聊/自言自语（纯感叹、无信息量的互动），没有任何可传播的事件素材。⚠️ 不算空洞（J1.58）：①圈内符号级/高影响力账号（CZ、何一、币安等）本人的公开问候/表态/简短回应——在 meme 市场这本身就是可玩、可传播的事件素材；②回复/引用一个实质性事件（产品发布/官宣/重要动态）时的简短回应——是对该事件的参与/表态。本项只拦真正无主体的空洞内容；作者/机构量级只在事件成立后影响量级题（量与质分属两题）',
        event_institution_routine: '机构日常运营——机构的例行推文：问候/转发/回复/无信息量互动。⚠️ 实质性内容不算：产品发布/功能更新/政策公告/数据报告/合作消息都是有信息量的实质事件',
        event_baseless_speculation: '无据猜测——预测没有任何推理依据支撑',
        token_ip_reuse: 'IP低质复用——仅限两种形状（J1.46）：①纯蹭名：直接套用现有知名IP/热点的名字或形象，无任何新内容；②无意义修改：替换/拼贴/抄袭/模仿没有产生任何有意义的新对象（换皮改名、硬拼无关元素）。⚠️ 有意义的修改/变形不选本项：在现有IP上产生具体的新梗对象（新造型/错版/变体/新玩法/有玩味空间的新形象）是meme币正常玩法，改按事件自身价值与传播正常评估；无独立叙事生命力的判据也只看事件本身（蹭名无事件 vs 变形带出新事件/新对象）',
        event_negative_hard_news: '负面硬新闻——安全事故/被盗/被黑/暴雷/巨额损失/灾难类负面事件，或政治暴力/社会动荡类负面事件（抗议/示威/罢工演变为打砸抢烧/骚乱/纵火/冲突/恐袭/战争/动乱），语料是事故通报/官方公告/新闻报道/时事转述。事件无meme化玩味空间：主体是机构/平台（不会参与自嘲式传播），无梗、无二创动力，蹭此类事件命名的名字无独立叙事生命力（热度再高也不算叙事价值）。⚠️ 政治暴力臂不看载体玩味空间：即便有可爱形象/知名IP被当作抗议或声援的象征传播，其热度来自现实暴力与苦难而非该形象自身的玩梗文化——现实中的打砸烧抢不是梗，受灾受难的一方不参与自嘲式传播，蹭此类事件的命名只是消费苦难热度，必选本项。⚠️ 仅限该窄边界：监管罚款/项目失败/名人去世等其他负面不选本项，按事件实际叙事价值正常评估；和平政治事件/政策辩论/选举玩梗（无暴力与灾难）不选本项，按实际叙事价值正常评估',
        event_routine_content_product: '常规内容产品宣传——电影/剧集/综艺/动漫/小说/游戏等常规内容型产品的发布/上映/定档/预告/官宣消息。观众是消费者而非玩梗社区：无二创动力、无meme玩味空间，蹭其命名只是消费上映/上线热度——即便作品已官宣已上映、即便系列国民级知名也不构成叙事事件（产品知名度≠该放，同负面硬新闻语义：蹭其命名无独立叙事生命力）。⚠️ 边界收窄：代币名指向作品中的角色（人物/形象，含角色名的音译/译名形式，如くるみ↔久留美/Kurumi——不以字符字面一致为条件）而非作品名本身时必不选本项：即使推文内容本身是作品的宣传/定档消息，角色名币的叙事主体是该角色而非作品宣传——角色是有形象的独立IP实体、可有自身meme生命周期（角色名币≠消费作品上映热度），改按A类（形象IP）评估该角色自身的知名度与玩梗证据（无名/未出圈角色由A类量级门拦截把关）；内容本身已是全民玩梗对象（名场面梗/梗图泛滥/大规模二创模仿）不选本项（按社会热点正常评估）；跨世代文化符号/神话/历史人物/公共事件（如孔子、嫦娥、探月工程）本身不是产品宣传，不选本项；Web3产品不适用本题；世界级颠覆性实体产品/平台发布（硬件/平台级）不选，按实际影响力正常评估',
      },
    },

    // ── 5.5 Web3 用户偏好契合（J1.19 独立题，事件层受众判断，代码端 unfit≥0.5 质量门拦截）──
    web3_user_event_fit: {
      type: 'choice',
      instructions: `Web3用户偏好契合度（web3 meme buyer fit）。判断事件主题与meme币链上买家群体的口味契合度——不是事件影响力大小。
链上买家画像（BSC meme发射平台真实用户群）：以华语crypto圈为主、全球meme玩家参与；玩梗文化、乐子导向、财富叙事；买的是「能玩、能二创、能传播」的主题。
判据核心两问：①这个主题能否被链上买家玩梗/二创/自嘲式传播（有形象、有梗、有乐子）？②事件受众与crypto圈是否重叠？
强契合典型：动物/萌宠形象（猫狗蛙熊猫等）、可爱风/萌系动漫游戏角色、极客风题材（编程/AI/科幻/交易与投机文化讽刺，如炒股炒币题材动画）、币圈自嘲与财富叙事（梭哈/归零/韭菜）、马斯克/CZ/币安等币圈名人梗、奇怪/猎奇/荒诞的乐子梗、知名IP/角色/梗图、有形象可二创的乐子梗。
不契合典型：消费具体弱势真人的土味网红梗（如范小勤/小马云型）、死亡/疾病/器官等阴郁丧主题、纯内容欣赏无玩梗空间（影评式赞叹「立意很好值得一看」）、严肃社会议题、纯人名无形象无梗、娱乐圈八卦、受众与crypto圈完全不重叠的领域热点。
⚠️ 「小众」按Web3买家视角判，不按大众视角判：动漫游戏/极客/ACG题材对crypto圈不是小众（用户群高度重叠，可爱风/极客风/奇怪的东西恰是Web3用户强偏好），不要因大众视角的小众而判marginal——小众指受众与crypto圈不重叠的领域（传统行业/地域文化/严肃专业领域）。
⚠️ 传播数据（点赞/播放量）大小不是本题判断依据——只问主题本身合不合Web3用户口味；Web3产品/币圈事件（W类）天然强契合。
⚠️ 公司产品实体（J1.27）：纯功能型产品（芯片/大模型/软件功能/电商平台/办公工具）无形象无玩梗空间→不高于marginal；有独立可爱形象的产品（吉祥物/角色）按形象自身被玩梗的证据判。币安等 crypto 原生机构（交易所/公链/Web3 平台）的产品不在此列——链上买家即其生态用户，天然强契合。`,
      criteria: {
        strong_fit: '强契合——动物萌宠/可爱萌系ACG角色/极客风题材（AI/科幻/交易投机文化）/币圈梗/马斯克CZ币安/知名IP角色/奇怪猎奇乐子梗，链上买家天然喜欢',
        fit: '契合——有形象或有玩味空间，受众与crypto圈重叠',
        marginal: '边缘——有部分契合要素，但主题落在与crypto圈受众不重叠的小众领域（传统行业/地域文化/严肃专业）或玩味空间有限',
        unfit: '不契合——土味网红消费真人/丧文化阴郁主题/纯内容欣赏无梗/严肃议题/纯人名无形象/受众与crypto圈不重叠',
      },
    },

    // ── 5.6 主体实体类型（J1.27 独立题，C55 公司产品实体主体切分——mapper 产品实体接纳门的判据源）──
    // ── J1.43（C109）：event_subject_entity 8→2 桶——J1.27 产品实体接纳门消费口径
    //     本就功能产品/产品形象同拦（mapper 兼容集认旧 choice 名）──────────
    event_subject_entity: {
      type: 'choice',
      instructions: `主体实体类型（subject entity type）。web3_user_event_impact 所评的事件主体（按其主体判定规则：主体=事件本身的核心实体，不是陈述者）属于哪类实体？
本题只区分一件事：主体是不是「公司/机构发布的产品实体」。产品实体=该公司发布的产品本身（功能产品或产品内形象都算：麒麟芯片/子曰模型/Temu平台/品牌吉祥物/产品内角色），主体是产品而非发布公司。其余一切（公司本身/独立IP形象/真人人物/事件热点/梗词等）一律选 other_entity。`,
      criteria: {
        product_entity: '公司/机构发布的产品实体——主体是该公司发布的产品本身：功能产品（芯片/大模型/软件/平台/功能/硬件/电商服务）或产品中的形象/IP角色（品牌吉祥物/产品内卡通形象/产品线角色）。判断锚：主体是产品→本项；主体是发布公司自身→other_entity；形象不随公司产品发布、是独立 meme 角色/卡通IP/虚拟形象（非「公司发布新产品」语境）→other_entity',
        other_entity: '非产品实体——公司/机构本身（如「币安」「特斯拉」的言行）、独立IP形象/角色、真人人物、事件/热点本身、梗词/流行语、或以上都不是',
      },
    },

    // ── 6-7. W 类专用（产品分 0-35 + 币安交互 0-40，仅 W 类采信）─────
    // （5.7 事件情绪感染力题已删 J1.36/C93——E 类感染力折损判据源换 web3_user_event_fit）
    // ── J1.52（C121）：评估主轴切 web3 用户关注与兴奋度（用户视角批次）。各带
    //     形态结构词（版本更新/新功能/新产品/创新产品）刻意保留——C42 豁免的
    //     wNewProductP = 1−P(0)−P(1) 依赖「0/1 带=小改进、2/3 带=产品发布」带结构 ──
    w_product_score: {
      type: 'score',
      instructions: `Web3产品分（仅当事件是Web3项目发布/更新时评估），0-35分。评估主轴=web3 用户（链上 meme 买家）对这个发布的关注与兴奋度——会不会被链上用户当话题讨论、转发玩梗、产生 FOMO（一切从用户角度出发）。产品客观重要程度（创新性/功能量级）与发布方规格只是参考锚，不是定死映射：客观创新性高但链上用户无感（纯基础设施/企业级功能）不因创新升带；看似轻量但链上用户会当乐子讨论的发布（梗性强的功能/命名/玩法）按用户兴奋度评带。评的是**预期兴奋度**，不是发布后实测数据（发布与发币几乎同时，语料里推文的实测互动量不是本题判断依据）。`,
      criteria: [
        '0-8分：版本更新/小改进——发布本身不构成链上用户话题（UI/参数/小修小补；改进型事件基线5分）',
        '9-17分：一般新功能——部分用户注意到但不至于当话题讨论（新功能基线12分）',
        '18-26分：重要新功能或有特点的新产品——会被链上用户当话题讨论（有梗点/话题性的发布；新产品基线20分）',
        '27-35分：创新产品/重磅发布——链上用户广泛讨论、FOMO 级（新产品20分+用户兴奋度10-15分）',
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
    // ── J1.43（C109）：name_event_relevance+relevance_level 两题合一——9 融合桶吸收
    //     原 level 语义，分值代码端 RELEVANCE_FUSED_SCORES（旧两题形状走 legacy 查表）──
    name_event_relevance: {
      type: 'choice',
      instructions: `代币名与事件的关联（token-event relevance）——判定主轴=web3 用户能否理解并接纳这种关联（一切从用户角度出发）：用户看到币名与事件，能不能看懂这个关联、接不接受它。看名知梗、见名自然联想到事件=用户理解；圈内文化梗用户一眼接得住=理解且接纳；要靠语言学论证才勉强成立、用户只觉得是硬蹭=理解不了也不接纳。
检查代币的Symbol和Name（去emoji/数字/特殊字符后）与事件核心词的关系，选**用户能理解并接纳的最强**一种类型——各档是对「关联方式×用户理解度」的刻画，不是客观语言学的自足分类：客观联系再曲折，用户一看就懂且接得住，按其实际理解度选档；反之用户 get 不到的关联，不因论证成立而升档。
⚠️ 泛化概念预检：代币名是抽象概念（AI/LOVE/meme/PEACE等）或行业大类词时选 generic_concept（低分档），除非该概念就是事件的核心主题。`,
      criteria: {
        exact_match: '完全匹配——代币名与事件核心词完全一致（含"代币即产品本身"的情况）',
        translation_match: '中英文对应——代币名是事件核心词的另一语言形式（trump=特朗普）',
        abbreviation_alias: '缩写/别名/绰号——首字母缩写（MAGA）、数字缩写（K/M/B）、外号',
        semantic_clear: '语义关联·清晰——主题相关但名称不同，见名能自然联想到事件要素（同一话题/同一事件要素；用户能直接理解）',
        semantic_weak: '语义关联·勉强——主题沾边但联系弱，需要解释才能看出联系（用户难以直接理解/接纳）',
        cultural_rich: '文化关联·浓——梗文化/圈层文化上的强关联，圈内人看名即知梗（非字面关联）',
        cultural_thin: '文化关联·淡——圈层文化浅层沾边，只有勉强能看出的淡联系',
        generic_concept: '泛化概念——抽象概念/行业大类，任何事件都能蹭',
        none: '无关联——代币名与事件没有任何关系',
      },
    },

    // ── 10. 币名映射实体对 Web3 用户的接受度/影响力（J1.56 立题，C126 何一
    //     「こんにちは」案；替代 J1.10 name_referent——旧题把「作者侧身份」和
    //     「币名指代对象」混在 super_ip 一个词里，概念复用。新轴=实体映射 +
    //     实体在用户侧的接受度/影响力；作者原话票由代码侧 corpus_author_identity
    //     + authorUtterance 事实承担，不由本题升档（问候语如实答 no_entity）──
    web3_user_name_entity_acceptance: {
      type: 'choice',
      instructions: `币名映射实体对 Web3 用户的接受度/影响力（name-mapped entity acceptance）。判定代币 Symbol/Name（去 emoji/数字/特殊字符后）映射到哪个实体，以及该实体对 web3 用户（链上 meme 买家）的接受度与影响力。
评估对象=币名映射到的那个实体本身（人物/机构/项目/资产/形象/IP）——不是事件整体热度、不是发推人/陈述者的量级（陈述者量级另有题评）、也不是大众媒体知名度。
映射成立的三种方式：①直接指代——实体本名/官方译名/通用称法/形象/作品/原创梗（名字=作者本人的名称/自称/外号/作品/原创梗且出自其本人文本，映射到该作者实体）；②实体产出——该实体产出的官方口号/标志性品牌主张/官方文案（口号的作者=产出它的实体，发现/转述/搬运者不改变归属，如币安APP界面的「货币自由」）；③领域知名发布者的独立新产品/重大升级（发布者知名度指代到产品名；不含现有产品的版本更新/功能改进/新平台移植）。
⚠️ 作者身份本身不是映射——作者的认证/粉丝数不等于币名指向该作者；币名是其本人文本里的普通词/问候语/口头禅等非实体词时，本题如实判「无实体」，不得因作者是超级 IP 而升档（作者原话票由代码侧事实另管）。
⚠️ 语料/配图中真实出现的形象也是可判定的映射来源：币名与该形象对应时，映射到那个形象本身，按其自身在用户侧的地位评。
⚠️ 新实体 ≠ 无名实体（C133）：刚诞生/刚发布的新项目、新品牌、新角色、新资产，且已经在 BSC 链用户群（推特/社区/官方渠道）发出自己的信息（官宣/自我介绍/进展/社区讨论）→ 判 **new_entity**。用户此前没听说过它是正常的——新实体没有认知历史，不能用「认知度不足」去判它；用户第一次见到它时名字/叙事接不接得住，由名字形态/内容题评。
接受度/影响力判据=该实体在 Web3 用户侧被认得、被当符号使用（被拿名字/形象/绰号玩梗、当标签当口号）、被二创传播的程度；「听说过」的知晓级不算，大众知名度不能替代圈内符号性。`,
      criteria: {
        accepted: '币名映射到 Web3 用户高接受度/高影响力的实体——圈内符号级人物/机构/项目/资产/形象（CZ、币安、PEPE、doge 级：被圈内用户当符号使用、拿名字/形象/绰号玩梗）；含该实体的官方口号/标志性品牌主张；含领域知名发布者的独立新产品/重大升级（发布者知名度指代产品名）。⚠️ 判据=实体被 Web3 用户当符号使用，不是大众知名度——大众知名但圈内不认作符号（圈外明星/传统品牌）不归本项；本题只判实体身份量级，不评玩味/二创潜力（name_entity_memeability 另评）',
        unknown: '币名映射到**已存在的**具体实体，但该实体在 Web3 用户侧接受度/影响力低——普通员工/小号/小公司/周边人物/小众作品/被@的普通人/纠纷对象；被超级 IP 或大V提到不改变其无名。用户侧对这名字没有感知，接不住当符号（YAYA=币安普通员工花名型）。⚠️ 不用于刚诞生的新实体（新项目/新品牌/新角色——那是 new_entity）',
        new_entity: '币名映射到一个**刚诞生/刚发布的新实体**——新项目/新品牌/新角色/新资产，且已经在 BSC 链用户群（推特/社区/官方渠道）发出自己的信息（官宣/自我介绍/进展/社区讨论）。用户此前没听说过是正常的（新实体没有认知历史），不按「认知度不足」判；用户第一次见到它时名字/叙事接不接得住由名字形态/内容题评。与 unknown（已存在实体但用户无认知）区分',
        no_entity: '币名不映射任何实体——普通词汇/短语、话中截词、问候语/口头禅等日常用语、陈述句、纯功能词；也未忠实呈现某个已知名称（音译字/形近字/跨书写系统变体、未官宣传闻/泄露命名均不构成映射）。⚠️ 本项中性：不是「用户不接纳」，是「没有实体可评」——名字形态问题交 web3_user_name_acceptability 题判',
      },
    },

    // ── 10.6 形象载体存在性（J1.29 恒带：mapper 载体门判据源——C/D+非existing
    //     拦、E+no_visual 拦；superIP 快车道不消费本题答案）──
    name_entity_carrier: {
      type: 'choice',
      instructions: `形象载体存在性（subject carrier）。评估对象=代币名（Symbol/Name）所指代的那个实体本身（按 web3_user_name_entity_acceptance 题判定的指代对象——不是事件整体、不是发推人/陈述者、也不是新闻的发布方；名字指向配图/语料中出现的形象时，评估对象就是那个形象）。
判定：该指代对象是否是一个具体的、已经存在的、可视化/可形象化的形象实体——即 web3 meme 玩家能不能真的抓住一个「东西」（角色/动物/真人玩梗形象/吉祥物/表情包/meme图/实物形象）拿去做头像、二次创作、玩梗。
⚠️ 只判载体的事实存在性，与热度/量级/时效无关（另有题评）。
三个关键判别：
①形象必须已在事件/语料/配图/官方渠道中真实出现——只存在于代币名或发币者的联想/许愿/想象中的形象不算存在；
②名字含形象词（cat/inu/狗/猫/动物词根）不等于载体存在——要看指代对象本身是否真是那个形象实体（如「XX猫」许愿票：官方从未展示过这只猫→脑补形象；而官方 APP 页面里真实置顶展示的吉祥物→已存在）；
③人物/公司/产品功能/事件/抽象概念/缩写不以形象为存在形式——即便其名字广为人知（真人人物通常玩的是其言行/观点而非形象；但语料/事件本体就是该人物形象玩梗的除外）`,
      criteria: {
        existing_entity: '已存在的形象实体——指代对象是一个真实存在的具体形象：动物/角色/吉祥物/表情包/meme图/虚拟形象/实物玩偶等，且在事件语料/推文配图/官方渠道展示中真实出现过（如语料本体就是那只动物的视频、推文配图里出现的玩偶/动物、官方产品页面置顶展示的吉祥物形象、知名meme角色）',
        improvised_entity: '脑补/许愿的形象——代币名暗示了一个形象（如「XX猫」「XX INU」「要是叫XX就好了」），但该形象并非已存在的实体：是发币者/第三方的联想、谐音嫁接、许愿（"should be"/"why not"）或对尚未发布/从未展示之物的想象，事件/官方本体中从未出现该形象（官方只提到概念/名字，从未画出或展示过这个形象）',
        no_visual_entity: '无形象载体——指代对象不以形象实体为存在形式：真人人物（叙事玩的是其言行/观点/事件，非形象玩梗）、公司/机构名、产品功能/型号/服务、事件/新闻/热点、抽象概念、梗词、缩写代号',
      },
    },

    // ── 10.8 币名 meme 合格度（J1.37/J1.40/J1.41/J1.42/J1.47/J1.48/J1.50 恒带：
    //     mapper 唯一名字门 notMemeNameBlock 判据源——C96 币安上电视案/C105
    //     日本語版案/C107 收敛/C108 名字门统一：nrBlock·rmBlock·memFloor·
    //     misspelling 探针四拦截位全部并入本题；C114 DND 案加通用梗缩写锚
    //     （DND 合格/CRO 不合格，分界=用户侧感知）；C116 猫案加整句情绪姿态
    //     分界（「只是一只猫」合格/「我要去滑雪」不合格）；J1.50 C119 用户
    //     视角统一：问法收敛「web3 用户能否接纳这个名字作为 meme 币的名字」，
    //     三态键改名 web3_user_acceptable/web3_user_not_acceptable/unclear
    //     （mapper NOT_MEME_NAME_CHOICES 收新键+全旧键兼容）；J1.53 C122
    //     题键 name_form → web3_user_name_acceptability（门名对齐语义，判据不动；
    //     mapper 双键读，旧键=存量缓存行兼容）；J1.69 C130 判定对象收敛为
    //     **链上 Symbol（币名）**——Name 是链上全名/描述句不作本门判据
    //     （돼지 H 案：Name=电影全名被判陈述句拦，币名实为 Symbol））──────────
    web3_user_name_acceptability: {
      type: 'choice',
      instructions: `web3 用户能否接纳这个名字作为 meme 币的名字（token name as meme）。仅就代币 Symbol（币名/ticker；去 emoji/数字/特殊字符后）本身判断，一切从用户角度出发：用户侧对它有没有感知、能否被记住、被抓住当一个符号去玩梗、二创、传播——**能否接纳是唯一问法与唯一判据**；名字的语言学分类只是佐证，不是答案。答案三选一（能接纳 / 不能接纳 / 无法判断），佐证形态如下：
- 能接纳（web3_user_acceptable）——名字本身是可传播的符号，满足任一：
  · 圈内文化词/黑话/有圈内深意——web3 用户对这个词本身有感知、拿得住它玩梗（如 Early——圈内「趁早」深意，"you are still early" 是加密文化核心梗）；通用网络梗/文化缩写同构（如 DND=do not disturb、FOMO、LFG）——虽非圈内原生词，但圈内用户对缩写本身有感知、能拿它配梗传播（C114）；有 meme 情绪姿态的整句/短语——自嘲/躺平/降格反差/宣言句式（如「只是一只猫」=just a chill guy 同款自嘲降格句式），这句话本身携带可传播的姿态/情绪，web3 用户接得住它当符号玩（C116）。
  · 名字所指的对象本身有可玩/可二创的内容（形象/作品/梗/名场面/设定），用户能抓住它玩梗——J1.61 由原 name_entity_memeability 的玩味判断并入；只判「有没有可玩内容」，不判对象知名度（认知度归 web3_user_name_entity_acceptance）。
  · **对 BSC 链 Meme 币用户有特殊影响力的主体本人说出的、玩家会当符号用的词句**——判定锚=该主体在 **BSC 链 Meme 币玩家群体里的特殊影响力**（如币安系人物何一/CZ：她/他说的一句话本身在 BSC 圈就是梗/符号）；**模拟 BSC 链的用户 / Meme 币玩家**看到这句话：他们会不会把这句原话当该主体的梗/口号/情绪符号拿来玩、传播（如问候、口号/宣言、自创口头禅、简短情绪表达——C126 何一「こんにちは」案）。⚠️ **判断方式是模拟 BSC 链 Meme 币买家看到这句话的反应，不是套词表/固定句式**（J1.66/J1.67）：日常陈述、个人行动、礼貌套话这类他们不会拿去玩的表达（哪怕主人再有影响力）自然不构成符号。
  · ⚠️ **J1.57 划界**：名字指向实体时，实体本身认不认得/有没有影响力由 web3_user_name_entity_acceptance 判，不在本题的「能接纳」理由里——本题只确认「这个名字本身的形态/所指内容能不能被用户当符号抓住」。
- 不能接纳（web3_user_not_acceptable）——名字当不了符号，用户侧没有感知。典型形态（列举佐证，不限于此——凡「web3 用户不接纳这名字当 meme 符号」的形态都算）：
  · ⚠️ J1.57 划界：**指向无名实体不在本题**（普通员工/小号/周边人物的花名外号→ web3_user_name_entity_acceptance 的 unknown 轴，由实体低影响力门拦）；
  · 所指对象没有任何可玩内容（纯事务性名称/无梗无形象/纯功能词）——用户接不住当符号（J1.61 由原 name_entity_memeability 的 0-1 档并入）；
  · 非实体且无圈内感知：语料里的普通词/无情绪姿态的句片段/日常用语（如「滑雪」「我要去」——纯生活陈述，无自嘲/宣言/玩梗姿态），或机构职位/品牌内部缩写（如工牌上的 Chief Risk Officer→CRO）——出自谁的话不影响，用户侧对它没有 meme 感知；**高影响力主体的同类表达（生活陈述/个人行动/礼貌套话等 BSC 链 Meme 币玩家不会拿去玩的句子）同样不接纳**（J1.66/J1.67，按买家反应判、不按词表判）；
  · 事件陈述：主谓结构转述「一件发生的事」，是新闻标题不是实体（如「币安上电视」「XX 破产了」「XX 涨疯了」）——事件冷了名字就死，无独立 meme 载体；
  · 版本/功能标注：版本/语言/形态/序号等元标注词（如「日本語版」「英文版」「完整版」「remix 版」「version」）——名字只是版本目录里的一行；**即便逐字出自高影响力主体的原话也不接纳**（C105 日本語版案：那是版本标签，不是用户会拿来玩梗的符号）；
  · 无背景拼写错误：对已知实体/概念的明显拼写错误且无独立背景故事或文化来源（有文化来源的变体不算，如 doge→dogwifhat 是 meme 文化变体）。
⚠️ 判名字本身：不判名字指向对象的认知度/影响力（web3_user_name_entity_acceptance 题）、不判玩味价值（name_entity_memeability 题）——实体再有梗、事件影响力再大，名字是陈述句/版本词照样不能接纳。
⚠️ 对照锚：CZ 说 "you got in early" → 「Early」能接纳（圈内趁早深意，用户有感知）；CZ 若说「我要去滑雪」→ 「滑雪」「我要去」都不能接纳（用户侧无感知）。分界=用户侧感知，不是词出自谁、也不是是否截自语料。缩写对照（C114）：币安发推「DND 😾」配猫拉窗帘视频 → 「DND」能接纳（do not disturb=通用网络梗缩写，用户有感知、能配梗传播）；币安员工图戴「CHIEF RISK OFFICER」工牌 → 「CRO」不能接纳（机构职位缩写，用户对缩写本身无 meme 感知）。缩写分界同总则=用户侧感知：通用文化/网络梗缩写（DND/FOMO/LFG）能接纳，机构职位/品牌内部缩写不能接纳。整句对照（C116）：AI 猫经济热点里发币叫「只是一只猫」→ 能接纳（自嘲降格姿态句，just a chill guy 同款句式，用户对这句话本身有情绪感知、能当姿态符号传播）；「我要去滑雪」→ 不能接纳（无姿态的生活陈述）。句子分界=有无 meme 情绪姿态（自嘲/宣言/反差/玩梗），不是是否整句、也不是句子长短。
⚠️ 名字核心词是梗/实体、其他词只是修饰（「XX 完整版」核心是 XX）→ 能接纳；缺陷形态在中心语位置（「币安上电视」整体就是陈述、「日本語版」整体就是版本词）才不能接纳。含知名实体的陈述（「币安上电视」含「币安」）不改变它是陈述。
⚠️ 币名 = Symbol（C130 裁定）：只判链上 Symbol（web3 用户实际称呼、传播的 ticker）；链上 Name（全名/描述句）不是本题判据。`,
      criteria: {
        web3_user_acceptable: '能接纳——名字本身是可传播符号：圈内文化词/黑话/有圈内深意（Early）、口号/宣言/代号、通用网络梗/文化缩写（DND/FOMO/LFG）、有 meme 情绪姿态的整句/短语（如「只是一只猫」）、所指对象有可玩/可二创的内容（形象/作品/梗/名场面）、对 BSC 链 Meme 币用户有特殊影响力的主体本人说出的、玩家会当符号用的词句（问候/口号/自创口头禅/情绪表达——C126 何一こんにちは；按模拟买家反应判、不套词表：日常陈述/个人行动/礼貌套话这类他们不会拿去玩的即便出自有影响力的主体也不接纳，J1.66/J1.67）；实体认知度由 web3_user_name_entity_acceptance 判',
        web3_user_not_acceptable: '不能接纳——web3 用户不接纳它作为 meme 币的名字（唯一判据，一切从用户角度出发——用户接不住它当符号，以下只是典型佐证形态）：所指对象没有任何可玩内容（纯事务性名称/无梗无形象）、无圈内感知/无情绪姿态的普通词·生活陈述句（滑雪/我要去）、机构职位/品牌内部缩写（工牌 Chief Risk Officer→CRO）、事件陈述（X 上电视/X 破产）、版本/功能标注（X語版/完整版/version）、无背景拼写错误等；指向无名实体不在本条（实体题的 unknown 轴）',
        unclear: '无法判断——web3 用户能否接纳这个名字作为 meme 符号无法判定',
      },
    },


    // ── 10.7 名字与配图主体一致性（J1.30 条件题，仅 imageConsistency（语料含
    //     【图片内容分析】块）时问；mapper 名图一致豁免 imgNameExempt 判据源；
    //     superIP 快车道不消费本题答案）──────────────────────────────────
    ...(imageConsistency ? {
      name_image_consistency: {
        type: 'choice',
        instructions: `名字与配图主体一致性（name-image consistency）。比较代币名（Symbol/Name，去emoji/数字/特殊字符后）所指的对象/形象，与【图片内容分析】块描述的配图主体（角色/动物/人物/形象/实物）的关系。
⚠️ 事实性对应判断，不是质量判断——视觉对应本身不加分不减分（关联强度/质量另有题评），本题只回答「名字说的东西」与「图里画的东西」是否同一/同类。
⚠️ meme 盘惯例锚：主推配图通常是名字的视觉锚——名字是动物/角色词、图主体恰是该类形象（名字含鸡、图就是鸡形角色；名字是猫、图就是猫）→ 至少 same_visual_category。图内文字（标题/搜索框/水印/界面文字）中出现的词与币名的关系也计入——图内文字属于图的内容（梗名可能只写在图里）。
⚠️ 反例锚：图是通用背景/界面截图/风景，或图主体与币名所指完全不相干 → unrelated。`,
        criteria: {
          same_entity: '同一对象——币名所指的具体实体就是配图主体本身：图中出现的就是那个具名角色/形象/动物/实物，名字是它的名字或称呼（含图内文字写明其名的形状，如截图标题/搜索框里的词恰是币名）',
          same_visual_category: '同类视觉主体——币名所指与配图主体不是同一实体，但属同一类可视形象/物种/角色类型（名字是鸡、图是鸡形角色；名字含猫、图是猫；名字指某角色、图是该角色的同类形象）',
          unrelated: '无视觉对应——币名所指与配图主体无对象/视觉对应（图是无关背景/界面/风景，或币名是抽象词/事件词/人名而图主体与之不沾边）',
        },
      },
    } : {}),

    // ── 10. 品牌劫持（原 Stage3 1.0 节，仅预检命中时加入）────────────
    ...(includeBrandHijack ? {
      name_brand_hijack: {
        type: 'noul',
        instructions: `品牌劫持判断（brand hijacking）。
⚠️ 核心事实：此代币来自meme代币发行平台，平台上只能创建meme代币，不可能存在真正的知名代币。
「币不是品牌方自己发的」本身不构成劫持理由——平台上的币从来都不是品牌方发的，发行归属不是判据。
当代币名（Symbol或Name，去emoji/数字/特殊字符后）与知名品牌完全匹配或高度相似时，按名实一致性判断：
⚠️ 判断锚（名实一致性）：比较「代币名所指的实体」与「事件的核心概念实体」——
· 币名=事件核心实体的名字（如公司A发布产品B、币名就叫B）→ 名实一致，不算劫持；
· 币名=事件主体本人的名字（如 CZ 本人发布新书的事件、币名CZ）→ 名实一致，不算劫持；
· 币名指向比事件核心实体更大的实体（事件核心是产品B、币名却叫公司A）→ 概念实体不一致/概念扩大，正常评估，劫持可能成立；
· 币名与事件无实质关联、纯蹭品牌热度 → 劫持。
豁免条件（满足任一即不算劫持）：
① 同名但与品牌完全无关（如 Apple 指水果事件）
② 品牌官方衍生且背后有真实重大事件，且币名指向该事件核心实体
③ 显式meme化创作（明显的玩笑/戏仿/二创，圈内公认）——含缩写双关/谐音梗/形象嫁接（如大事件系统的缩写 × meme动物形象）：语料锚定当前热门新鲜事（近期真实大事件）时，这类戏谑性关联是meme创作手法而非劫持——蹭的是事件的增量热度而非品牌存量认知；无新鲜事件锚时纯玩品牌词根才是劫持（J1.24）
④ 知名人物本人直接发起（指事件由本人发起，非指发币）且有实质内容
⑤ 头部机构的重大事件（指事件/官宣由机构自己发布，非指发币），且币名指向该事件核心实体
⑥ 书名/绰号（去掉机构名后剩余部分有独立意义，如"币安风云录"去掉"币安"后"风云录"仍成立）`,
      },
    } : {}),

    // ── 10.8 配图对名字的演绎关系（C118 条件题，仅 imageConsistency（语料含
    //     【图片内容分析】块）时问；mapper 载体豁免演绎臂判据源。与 10.7 正交：
    //     10.7 问名与图【所指实体】是否同一/同类（J1.30 消费），本题问配图是否
    //     在【演绎名字含义】（J1.29 消费）——概念名/抽象名（缩写/口号）无实体可
    //     对应，10.7 天然判 unrelated，但「含义被图演出来」同样是载体存在的
    //     事实证据（DND vs 猫拉窗帘）。两豁免判据刻意分离：J1.30 不消费本题
    //     （演绎≠名实一致，豁免面不互扩）────────────────────────────────
    ...(imageConsistency ? {
      image_depicts_name: {
        type: 'choice',
        instructions: `配图对名字的演绎关系（image depicts name）。上一题（name_image_consistency）问的是名字与配图主体是否同一/同类实体；本题问的是：配图是否在【演绎/诠释/画面化】名字本身的含义——名字说的那个意思，图把它演出来了吗。
⚠️ 概念名/抽象名重点：名字不是实体词时（缩写/概念/口号/短句），看配图是不是该含义的画面化演绎——图中的动作/场景/形象正是名字含义的具象表演（不是随便配图）。
⚠️ 对照锚：币安发推「DND 😾」配猫拉窗帘视频 → depicts_name（do not disturb=别打扰，猫拉上窗帘正是「别打扰」的画面演绎——名字含义被图演出来了，上一题判 unrelated 不影响本题）；名字 CRO 配一张猫图 → decorative（Chief Risk Officer 与猫图无演绎关系，纯装饰配图）；名字「香蕉」配一张真香蕉图 → 上一题已 same_entity，本题按含义是否被演绎判（真香蕉就是香蕉本身，无「演绎」关系 → decorative）。
⚠️ 分界=图与名字【含义】的演绎关系，不是图与名字【所指实体】的对应（那是上一题）——两题答案独立，unrelated 与 depicts_name 可以同票共存。`,
        criteria: {
          depicts_name: '配图演绎名字——图中的动作/场景/形象/文字正是名字含义的画面化诠释（猫拉上窗帘=DND「别打扰」的演绎；名字 LFG 配冲线/起飞画面；名字「拉窗帘」配拉窗帘动作）',
          decorative: '无演绎关系——配图只是装饰/氛围/通用背景/表情包/顺手配图，与名字含义无诠释关系（名字 CRO 配猫图；通用梗图；纯风景）',
          unclear: '无法判断——图与名字含义的关系无法判定',
        },
      },
    } : {}),

    // ── 11. 无背景拼写错误（原 Stage3 截断规则 2）——C108 随名字门统一退役 ──
    // 案史：C78 鲸元卷案实证 Jev noul 探针拦不住（题面改锚分不动家族，答
    // 0.13-0.27），图文对照已由 mapper 纯代码门接管（detectNameImageSpellingMism
    // atch）；C108 名字门统一，「无背景拼写变体」判据并入 name_form 不合格臂
    // （choice 带锚题判准度有 C96/C105/C107 实证背书），本题删除。

    // ── 12-13. 质量（原 Stage3 第二大项，长度分代码端算）─────────────
    // ── J1.43（C109）：quality_spelling+quality_reasonability 两题合一为
    //     token_name_quality（拼写+合理性单维度合并判断，0-3 band 索引；旧两题形状
    //     走 mapper legacy bandInterpolate 路径）──────────────────────────
    token_name_quality: {
      type: 'score',
      instructions: '代币名质量（token name quality：拼写可读性+是否像真实词/有意义组合，合并判断），0-3分。',
      criteria: [
        '0分：完全无法理解——随机字符串/纯符号/无意义荒谬组合',
        '1分：错误较多——大小写混乱/词间无分隔/难读，或可读但奇怪勉强',
        '2分：有小瑕疵——可读、基本合理，但有变形或不够自然',
        '3分：完全正确——标准词/知名品牌名/真实词汇或有意义组合/易读',
      ],
    },
  };

  return questions;
}
