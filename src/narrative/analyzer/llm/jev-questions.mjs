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
 * J1.82（2026-10-21，C140 圈层可达性并入 event_fit + 事件质量两层结构，用户裁定）：
 *       「web3 圈层不可达，就是不适合 web3 用户呗」——token_circle_reachability 桶退役
 *       （event_token_block_reason 删 choice），拦截责任并入 web3_user_event_fit
 *       unfit 档（原 A 域 argmax 桶 → 全域 unfit≥0.5 概率门，mapper web3UnfitBlock
 *       零逻辑改动承接）。判定素材完全同源（同一份语料+同一 web3 用户视角），
 *       独立作答只产生矛盾面——同 J1.36 删 event_resonance 先例。配套锚句迁移：
 *       ①unfit 档吸收圈层不可达判据（圈外亚文化 get 不到梗=unfit；「圈外」唯一
 *       口径=crypto 圈用户能不能 get，非大众出圈前景）+ PEPE/doge 圈内梗反向臂
 *       + 品牌营销物料边界句（J1.52/C110 锚句随迁，缺句会漂移 argmax）；②marginal
 *       圈外臂删除（原「不重叠小众领域落 marginal 不拦」=删桶逃逸洞，C122 时
 *       5/23 张票靠该桶独活拦截）——marginal 收窄为「圈内能 get 但玩味空间有限」。
 *       行为变化（刻意）：全域原 marginal 圈外票（E/C/D 传统行业/地域文化）移档
 *       unfit≥0.5 → rating 1，拦截面扩大。mapper 侧 BLOCK_SCOPE 新旧键
 *       （token_circle_reachability/niche_subculture）显式空域退役（J1.43 先例）。
 *       C122「不合并」裁定针对并入名字接纳度，不冲突；其「A-only 域只能靠独立桶」
 *       前提在 unfit 负门全域生效下已不成立。验证：C122 5 张存活票+SAND/潘多拉
 *       佩吉释放样本定向重析对拍（182）。
 *       同批定位句改写（用户裁定「先判断事件质量，然后事件是否符合 web3 用户，
 *       这两个过了，事件算过了」）：event_token_block_reason 定位句从「硬阻断检查/
 *       无叙事价值」改**事件质量否决三问**——①是否有意义（空洞/无据）②重要度
 *       （机构日常/常规内容产品宣传）③是否负面（硬新闻）——并显式声明两层结构
 *       （本题=第一层质量，web3_user_event_fit=第二层口味，两层都过事件才算过）。
 *       桶群零改动（现有桶天然映射三问），纯定位句重写。键名断代（同裁定
 *       「名字也要改」）：event_token_block_reason → **event_quality_veto**
 *       （J1.17 曾因 token_* 桶加对象前缀，现定位收敛为质量否决第一层；mapper
 *       双键归一读存量 token_narrative 行，C123 改名先例，判据零改动）。
 * J1.83（2026-10-21，C141 产品实体判据并入 event_fit + 契合证据通用门，用户裁定
 *       「这个也是口味契合的大类，应该放到 web3_user_event_fit 中，如果 C/D 类
 *       没有通用硬门可以加」）：①event_subject_entity 题**整题退役**（C55 独立题
 *       →C109 收敛 8→2 桶→本题判据并入 fit，J1.27 判据素材与 fit 完全同源，
 *       独立作答只产生矛盾面——C140 圈层并入同款第二次）；②fit 题尾 J1.27 锚句
 *       升级（「纯功能型→不高于 marginal」→「→unfit」，对齐 mapper 门判据）+ unfit
 *       桶新增产品实体臂（母公司影响力/规格≠产品接纳核心句：华为发布麒麟≠
 *       链上用户接纳麒麟；币安等 crypto 原生机构产品例外=影响力可正常转移，随迁）；
 *       ③mapper 侧 productEntityAcceptanceBlock 退役 → web3FitMassBlock 通用门
 *       （strong_fit+fit<0.5 全域拦，豁免链 pubProxy/isW/binanceCorpus/
 *       platformOfficial 原样继承；门域全域是麒麟簇横跨 A/B/D 三类的必然——
 *       收窄 C/D 会让 B 类发布者指代票逃逸）。行为变化（刻意单向收紧）：非产品
 *       实体票 sf+fit<0.5 旧放新拦（C/D 客观规模票=主要新增面，正是用户点名
 *       的通用硬门）；产品实体票拦截条件为子集关系 bit 不变；豁免救回的 E 类
 *       票 J1.36 折损仍生效（非豁免 E 类低 fit 票改由本门拦，折损臂从主路径
 *       收窄为豁免路径）。题数 -1。
 * J1.84（2026-10-21，C142 W 数学双轴合并为单轴，用户裁定「方案A」）：
 *      w_product_score 与 w_bsc_user_appeal 语义/统计双重重叠——J1.79 实跑
 *      141 张 W 票 Spearman 0.847 / R² 0.711 / 两轴合计方差仅 ~9.6% 独立；
 *      product 系统性比 appeal 高 0.28 带（111/141 product>appeal），其唯一
 *      残差是 C42 形态先验（新产品基线 20）而 C42 wNewProductP 早已退役
 *      （代码零消费，只剩注释/测试锁形态词）。合并为单一 **BSC 用户吸引力**
 *      轴：①w_product_score 题**整题退役**（0-35 轴/形态锚/审计概率键/
 *      scoringResult.wProductScore 全删；旧缓存行残留键 mapper 忽略，历史行
 *      展示保留）；②w_bsc_user_appeal 量程 0-40 → **0-75**（四带 [0,18]/
 *      [19,37]/[38,56]/[57,75]，语义档位不变；Jev Score 原语仍回 0-3 期望带，
 *      mapper 带映射）；③W 数学 = 吸引力(0-75)+时效(0-25)，pass 线 60 → **57**
 *      （J1.79 141 张 W 票按新轴分布校准：60→1 张、57→4 张=精确保持旧三轴
 *      top4 通过集、56→6 张、55→7 张、50→11 张；「保持现状」选 57，放宽留待
 *      用户另裁）；④appeal 3 档在实跑仍不可达（J1.79 argmax band3=0/881），
 *      W 门实质仍是「band2 高位+时效」——刻度问题另行校准，本版不动。
 *      题数 -1（W 专用题 2→1）。C134 案主股城在新轴仍 low（0.94→16.92+25=
 *      41.92<57），C134「新 BSC 项目可过」的动机未由本合并解决，留待 appeal
 *      判据/刻度单独裁定。
 * J1.85（2026-10-21，C143 品牌劫持并入实体轴，用户裁定「C」）：
 *      name_brand_hijack 条件题整题退役，判据并入 web3_user_name_entity_acceptance
 *      新增第六桶 **brand_mismatch**（品牌劫持/概念扩大：币名指向知名品牌/机构/
 *      人物/资产但事件核心实体不是它；优先于 accepted；官方/本人/事件主体不选）。
 *      J1.79 实测 123 条 brand 题 / 39 条 brandP≥0.5 中品牌门实际拦截 0 条（name
 *      接纳度门 22 / 机构日常 6 / W 分 5 / 无形象 3 / 地域锚 2 / 放行 1）；
 *      33/39 brand-high 的 relevance>10（exact 17 / semantic_clear 10 / abbrev 6）
 *      → 品牌门与 relevance 不是同一轴；历史 140 条品牌门拦截中可解析 48 条
 *      relevance 全 ≤10（relevance 截断本可接住）。故并入实体轴（真正拦品牌名的门）
 *      而非 relevance。mapper：brandMismatchP = includeBrandHijack ? 实体题
 *      brand_mismatch 概率 : 0；punExempt/Stage3 品牌劫持臂改吃 brandMismatchP；
 *      brandHijackP 审计键改名 brandMismatchP（历史行 brandHijackP 保留展示）；
 *      name_brand_hijack 概率审计键删除。基础题仍 11（brand 题为条件题，删后
 *      keyword 预检同时作**题集开关**——关键词票实体题加 brand_mismatch 桶，
 *      非关键词票保持 J1.84 五桶原形；以及 mapper 门开关）。punExempt 保留：
 *      显式戏谑双关仍由 mapper 政策层
 *      豁免（题面不预豁免，保证 brandMismatchP 信号仍在）。
 * J1.86（2026-10-21，C143 校准——182 定向重析发现 C96 回归）：
 *      J1.85 的 brand_mismatch 臂在关键词票上把「含品牌名的陈述句」推向 accepted
 *      （C96 币安上电视 entity accepted 0.53 / not_entity 0.24 → 词句门被实体票
 *      跳过 → low→high 回归），并把官方品牌产物判成 brand_mismatch 边缘
 *      （C110 币安菠萝 0.49）。补两条题面锚：①含品牌名的陈述句/短语（币安上电视/
 *      バイナンス人生/币安游戏）判 not_entity，不选 accepted/unknown/brand_mismatch；
 *      ②官方品牌事件的具体产物/符号（币安官方菠萝→「币安菠萝」）不选 brand_mismatch。
 *      桶集/判据结构不变，仅题面锚点；J1.85 未部署，定向重析样本随之重跑。
 * J1.100（2026-10-22，C167 梗王大乱斗案 0x4ded…7777 图证豁免载体性质第四臂，用户
 *      裁定「这个跟图片我觉得没有关系……没有一个可视化的形象IP跟它匹配，配图也是
 *      游戏」「这是叙事本身的问题」「那就 A 吧」）：新条件题 image_carrier_nature
 *      三档（carrier_visual/referent_itself/unclear，仅 imageConsistency 时问，与
 *      10.7/10.8 同条件）。案发现场：名字「梗王大乱斗」=抖音手搓网页游戏标题
 *      （拼贴第三方 IP 的仿大乱斗对战），载体题如实判 no_visual 0.85，但配图=该
 *      游戏界面截图（图内文字恰含 #梗王大乱斗# hashtag）→ name_image_consistency
 *      按题面字面判 same_entity 0.65+same_visual_category 0.22=0.87（match 臂豁免）
 *      且 image_depicts_name 0.98（演绎臂也够）→ C109/C118 图证豁免救回载体门 →
 *      S 档 92 high 放行。洞=豁免把「名-图所指对应」当「载体存在」用：奠基票所指
 *      物都是具象形象（交易猫的鸡/DND 的猫/短尾猫的猫），本票所指物=游戏（非形象
 *      事物），配图=所指物实录，证明的是所指存在（E 类事件分已在量），不是形象
 *      载体存在；名图一致/演绎对「所指物本身」是同义反复（真香蕉锚：香蕉图就是
 *      香蕉，实录非演绎）。本题问该对应是否落在【形象】级：mapper imgCarrierOverride
 *      与 emptyContentImgCarrierOverride（C159 近 tie 臂）统一加第四臂
 *      carrierNature==='carrier_visual' 才豁免；referent_itself/unclear/答案缺失
 *      fail-closed 不豁免（J1.30 imgNameExempt 关联豁免不消费本题——名实一致对
 *      关联豁免仍成立，两豁免面不互扩）。题面锚=事物自我实录不算演绎（游戏叫
 *      大乱斗、截图正在乱斗=它在干它本来干的事）+图内第三方 IP 形象属原 IP 不因
 *      出现在所指物截图里就成为本币载体。审计键 subjectCarrierReferentVeto 命中才落。
 *      条件题 18（imageConsistency 票才问）
 * J1.110（2026-10-23，C181 RichardTeng 案+无名口号臂，用户裁定）：
 *      ① 题改名 web3 用户视角：event_quality_veto → web3_user_event_impact
 *      （主轴=事情质量+重要性=「对 Web3 用户的影响力」；mapper 三键归一读
 *      旧行，桶 id 不变零断代）。② 题面清两句尸体（用户判「没有保留的
 *      意义」）：「第二层 fit **含事件重要度**」与新主轴冲突（重要度归本
 *      题）；routine 排除句指向 J1.87/J1.88 已删桶（C179 清理漏网）。③
 *      empty_content 桶扩②无名作者单条口号/喊话/宣言臂（C175 判据前移
 *      veto：无名氏喊一句「Richard Teng …」无外部依托无情节=对 web3 用户
 *      无影响力，案=0x007f5ddb…7777 拆臂后翻 high 71.14）；排除锚三件
 *      随行：J1.58 圈内高影响力账号本人短句、C159 具名 meme 指认/提问/
 *      玩梗（「实体」收窄为「梗主体」+句式限定，防吃掉无名喊话形状）、
 *      C175b 成型叙事（有情节/持续记录/被命名主体来历不拦）。
 * J1.109（2026-10-23，C179 豁免挪判轴级+题集残留噪声清理，用户双裁定）：
 *      ① 关联题宣告采信豁免段从③ unacceptable 桶后挪到 instructions 判轴级
 *      独立段（判轴声明后、①②③分桶前）——挂在被限制桶下=对被限制桶的自相
 *      注释（用户裁定逻辑冲突根源）；先立规则再列桶。桶内简化：unacceptable
 *      删二轮否定句回归纯语义，acceptable 只留最短指针（判轴级=唯一权威表述）。
 *      BINA 11 跑 6H/5L 掷骰域未消除，本批为结构修复，效果待定向重析验证。
 *      ② 历史残留噪声清理四处（运行时题面文本扫旧概念词表+句式残留，非噪声
 *      不动）：quality_veto 两句删「不再」历史时态/裁定编号引文/已退役门名
 *      negative_hard_news，改正向表述；同句「名字/载体/关联/质量门」删「载体」
 *      （载体轴 J1.102/C171 已整轴退役）；entity 题「（J1.102/C171，原
 *      web3_user_entity_visuality 轴并入）」括注删（引用已删题名）。判读非噪声
 *      保留：词句题桶键 web3_user_acceptable/web3_user_not_acceptable=答案 id
 *      契约（mapper 三键读消费）；event_category 英文 routine=普通形容词用法。
 * J1.108（2026-10-23，C178 宣告采信豁免措辞强化 + 关联题删历史残留句，用户双裁定）：
 *      ①J1.99 豁免「且币名正是承载该名字的代币」前提系统性不触发（BINA 复刻票
 *      0x3384…7777 部署后三跑 high 为掷骰孤例，六批回归+四跑定向全 unacceptable
 *      5 分拦截，总分 83-86 纯卡关联截断）——用户裁定「这个一般来讲都不会明说」：
 *      删明示要求，部署者以本币名发币本身就是币名承载的行为表达，发币+宣告并置
 *      即满足前提（不要求点名、不要求明说「币名=名字」）；保留反臂（宣告明确指出
 *      名字是另一个词≠币名则不豁免）。②题面尾部「不做 semantic_clear/…细分」句
 *      整删（J1.92/C155 简化残留——旧细分桶名当前 LLM 不认识也不需要认识）。
 *      mapper 零改动。
 * J1.107（2026-10-23，用户裁定「w_bsc_user_appeal 可以给弱中强三档」）——W 类
 *      吸引力题 Score 原语（0-3 期望带→四分带插值 0-75）改 Choice 三桶
 *      weak/moderate/strong（语义档弱/中/强；weak 合并旧「无吸引力/一般」两档）；
 *      mapper 侧分值表 weak=15/moderate=47/strong=66（choice 题惯例，概率留审计），
 *      pass 线 32 不动；旧缓存行 score 形状走 legacy bandInterpolate 双形状兼容。
 *      动机=Score 打分 Jev 倾向集中中段（0.4/0.34/0.21/0.05 分布），三档语义化
 *      判读更果断；分数锚定代码侧（C110 教训）。
 * J1.106（2026-10-22，C175b 回归修复，TREE+币安上电视 两案）——C175 双臂上线的
 *      52 票回归暴露两处误伤，锚句边界收口：
 *      ①fit 题「事件本体分量」锚补「空口号 vs 成型叙事」边界（C106 TREE
 *      0xd50e11204f7f3d63598b0118ee4151bf95917777 翻 low 实锤：作者自述种树故事
 *      被读进「无币外分量」臂，sf+fit 30%/23%/22% 三跑全 J1.83 拦）——「至多
 *      marginal」臂只限无事可讲的空口号（除谐音/点名外无任何情节）；事件是成型
 *      叙事（持续行为记录/有情节故事/被命名主体来历）时本体已成立，作者个人产生
 *      不减分量、第三人称报道非必要条件，正常评估契合。
 *      ②实体题「性质定义」锚补陈述句反锚（C96 币安上电视
 *      0xc6d089d749409f7646de440d637ac9db0e047777 稳定翻 high 80-83 三跑实锤：
 *      实体题 accepted 0.40/not_entity 0.33 近 tie 掷 accepted → J1.139 词句题只
 *      评 not_entity 票 → 「Web3 用户不接纳该名字」拦截位失效放行）——「性质
 *      定义」是给币名主体定身份；陈述句/事件描述式名字（「XX上电视」式，说的是
 *      一件事非命名主体）不构成性质定义，句中提及著名实体不因此 accepted，仍归
 *      not_entity 由词句题接管。
 * J1.105（2026-10-22，C175 双臂，京小安+OK❌ 两案，用户裁定「『首款AI警犬』给
 *      实体定了性质，我认为能被 web3 用户接受是根本的（符合我们的门控名字），
 *      而不是知名/广泛报道」+「OK的匹配我觉得没问题，OK 是指欧易，但主要是
 *      『无名用户单条口号推』这个事件对 web3 用户无影响力，不应该是 fit」）：
 *      ①实体题 accepted/unknown 补「性质定义优先于认知度」锚（C94 京小安
 *      0xcb98accaa8040a7e839c305b8aca08e113c87777，symbol=京小安/name=首款AI警犬）：
 *      name/语料已为币名主体明确定义性质/身份（角色定位清晰具体）且该性质是
 *      Web3 用户天然接纳的具象角色形象（警犬/工作犬/动物/AI 宠物/吉祥物）→
 *      accepted——可接纳性是本题根本判据，不以「实体是否知名/被广泛报道/评估
 *      者是否听说过」为前提；unknown 反锚收窄（限于语料未给出可接纳性质定义）。
 *      修复面：Jev 曾判 unknown 0.50（恰压 unknown 门 50% 线，B 域拦）。逃逸门=
 *      空泛自称（无具体角色内容的口号式自称）不满足「明确定义性质」。
 *      ②fit 题 web3_user_event_fit 补「事件本体分量是契合前提」锚（C101 OK❌
 *      0x0195119e4806441c871adada6256296265ed7777，symbol=OK❌/name=尽管东奔西走
 *      欧易全部没有，无名用户单条口号推）：币所关联事件得先有「币外分量」——
 *      源自公共热点/新闻/圈内人物的，宣告者无名不减分量；事件本体只是无名作者
 *      自己的一句口号/一次玩梗（无外部热点依托、无第三方讨论）→ 不是事件，至多
 *      marginal，名字与品牌的谐音匹配再巧也不能凭空造出事件。与传播数据锚划界：
 *      互动数字不作加减分依据，本锚判事件有没有币外来源。修复面：Jev 曾给
 *      strong 0.46+fit 0.17=63%（谐音梗合口味）→ high 70.62 四跑稳定误放。
 * J1.104（2026-10-22，C174 TREE 案 0xd50e11204f7f3d63598b0118ee4151bf95917777，
 *      用户裁定「那这个不应该是 not_entity 应该是 new_entity 吧？」——实体题
 *      new_entity/not_entity 两桶补「被命名+被讲故事的故事主体」锚：语料为主体
 *      起名/起绰号并向用户群讲述其故事的自创称号（TREE 案现场：作者给种了 1.5 年
 *      的橙子树起名 BNB Tree、讲耐心与长期持有寓意，45412 粉可见）→ 判 new_entity，
 *      不因名字字面是普通词判 not_entity（not_entity=没有所指对象；被命名被讲
 *      故事的故事主体有明确所指）。逃逸门=语料须确实陈述命名行为/讲过故事，币名
 *      =普通词而语料无命名行为的蹭名票不适用，仍走 not_entity→词句题照判。修复
 *      面：Jev 曾把 TREE 判 not_entity 0.47（new_entity 仅 0.09）→ J1.139 结构
 *      下 not_entity 触发词句题 not_acceptable 0.59 拦 low；锚正后 new_entity
 *      →词句题跳过→计分≈81 high（C106 expect 达成）。
 * J1.103（2026-10-22，C172 品牌劫持轴整体退役，用户裁定「品牌劫持其实本质
 *      是事件/代币关系层面的，如果要放，也是放到 web3_user_name_event_acceptance，
 *      而如果 web3_user_name_event_acceptance 已经站在了用户视角进行判断了，那么
 *      其实品牌劫持可以删掉」）：实体题 web3_user_name_entity_acceptance 删第六桶
 *      brand_mismatch（J1.85/C143 并入，寿命 1 天余）——品牌劫持是**名字-事件关系**
 *      轴（币名把事件概念扩大到品牌），不是名字-实体映射轴；J1.92/C155
 *      web3_user_name_event_acceptance（exact/acceptable/unacceptable，用户视角）
 *      已是该轴的正确宿主。案发现场=TREE 0xd50e1120…95917777（BNB Tree，C106
 *      j7tracker 案票）：同一次调用 name_event=exact_match 0.74（Tree=种树故事
 *      主体，relevance 20）与 entity=brand_mismatch 0.74（BNB≠故事核心实体）
 *      共存——两轴打架，删错的那轴。整链随桶退役：BRAND_HIJACK_KEYWORDS 预检表
 *      + shouldIncludeBrandHijackCheck（唯一用途=mapper 门开关，门废开关废）+
 *      mapper brandMismatchP/punExempt（J1.24 戏谑豁免前提即 brandMismatchP≥0.5，
 *      恒 0 随死——豁免功能由 J1.92 正确评分承接：真蹭名票 unacceptable →
 *      relevance 低 → 关联≤10 截断自然拦）+ Stage3 品牌劫持截断臂 +
 *      credibleEventAnchor 传参（唯一消费=punExempt）。题数不变（删桶不删题），
 *      实体题回五桶原形
 * J1.102（2026-10-22，C171 形象载体轴整体退役，用户裁定「是否去掉
 *      web3_user_entity_visuality 这一个轴？实体的可视化有形象，其实也是实体的
 *      web3 用户接纳度的一部分（web3_user_name_entity_acceptance），有形象接纳度
 *      会高，但是也不是说没有形象就不行，一切看情况」）：删 3 题——
 *      web3_user_entity_visuality（J1.29 立题/C61，+4.42 回测立门；此后 C88/C109/
 *      C118/C138/C139/C159/C160/C161/C167 九连豁免打洞未止——argmax 档位门无置信
 *      门槛、著名豁免 0.5 概率线对间接指代（域名→人名）结构卡死、类型学错位把
 *      「本来就不该有形象」的 new_entity/人物实体当缺陷拦：股城 0.91/TREE 三桶
 *      0.44 掷骰/Heyi 本票 accepted choice 0.25 概率拦死）+ event_influence
 *      （J1.97/C161，唯一消费=载体门豁免）+ image_carrier_nature（J1.100/C167，
 *      唯一消费=图证豁免第四臂）。**image_depicts_name 保留改挂**（用户中途裁定
 *      「image_depicts_name 这个需要删除吗？这我觉得是事/币关联的一个维度」——
 *      演绎臂从载体图证豁免迁入 J1.30 imgNameExempt 关联豁免第二臂，题面不变）。
 *      判据并入：web3_user_name_entity_acceptance 题面加
 *      形象考量锚句（有形象/可视觉化更易被接纳=加分考量，无形象本身不构成否决）
 *      ——偏好轴语义承接（「一切看情况」）。mapper：entityVisualBlock 门+六豁免
 *      整链退役，审计键 subjectCarrier* 族新行不产出（历史行保留展示）；
 *      J1.30 name_image_consistency 保留（量级门豁免+关联截断豁免仍消费）。
 *      条件题 18→16（imageConsistency 票 -2 题），恒带 -2 题
 * J1.101（2026-10-22，C170 RSA4 案 0x3486657430a3c3ba1cf66b3a00976e9667877777，
 *      用户裁定「去掉 negative_hard_news 得了，直接让 web3 契合度去处理」）：
 *      event_quality_veto 删 event_negative_hard_news 桶（J1.11/C9 bitget被盗案立、
 *      J1.38/C98 粉豹法国骚乱案扩政治暴力边界——整门退役）。案发现场：CZ 转发
 *      IntCyberDigest（印度 CA eMudhra 8 张证书私钥泄露，其中一把本应 116 位的
 *      私钥就是「4」）1 分钟后发币 RSA4，Jev 判 nhn 0.88 拦 low，但同票 strong_fit
 *      0.87/exact_match 0.58/S 级/within_7d 其余门全绿——圈内强相关安全事件被
 *      S 级作者本人玩梗（"the internet was encrypted by '4'"），属于可玩的圈内
 *      梗而非消费苦难。裁定负面事件是否有 meme 玩味空间改由第二层
 *      web3_user_event_fit 判（unfit≥0.5 负门 + C141 sf+fit<0.5 通用硬门接棒）。
 *      mapper 同步：BLOCK_SCOPE 显式空域 + negativeHardNewsBlock 门/
 *      audit negativeHardNewsMass 键退役（J1.87/C145 同构）。
 * J1.99（2026-10-22，C163 宣告采信豁免，用户裁定「相信叙事的陈述」「不用加独立的
 *      锚，而是在已有的门中加入豁免」）：双 BINA 案复刻盘 0x3384…7777 wrong_entity
 *      消除后暴露下一道拦截=关联题 unacceptable（5 分，三次稳定复现）——复刻票自身
 *      语料通篇无币名 Bina（宣告推只说 "the name is confirmed" 不点名、配图图内无
 *      名字），名字与事件的关联全靠部署者宣告+币名字段承载（CZ Taigan 犬官方从未
 *      公布名字，Bina=部署者宣称已确认）。J1.92 关联题（已有门内）加宣告采信豁免：
 *      发币者宣告推声称主体名字已确认/已揭晓且币名承载该名 → acceptable 起步
 *      （逐字出现仍 exact_match），不得因名字未逐字出现在语料而判 unacceptable
 *      （验证宣告真实性不是本题任务，C79 采信陈述同则）。mapper 零改动；题数不变。
 * J1.98（2026-10-22，C162 双 BINA 案·复刻 0x3384…7777 wrong_entity 误拦修正，
 *      用户裁定「修吧」）：CZ 新狗 Taigan 名字揭晓后同名复刻盘 Bina（38s 毕业 11×，
 *      tier S + strong_fit 0.67 全对）被 wrong_entity 0.55 全域拦——Jev 把宣告推里
 *      "it should be paired to BNC"（该币用 BNCB 做交易池计价币，链上 quote_token
 *      实锤）误读成「狗名应配 BNC、币名 Bina 指歪」。题面加显式排除：交易池/计价
 *      配置语句（paired to X / X pair / 用 X 币配对交易）是池子配置说明，不是名字
 *      证据，不得据此判 wrong_entity（instructions+wrong_entity criteria 双处）。
 *      mapper 零改动（门不变，靠 Jev 判读翻正）；题数不变。
 * J1.97（2026-10-21，C161 巨大影响力事件载体门豁免，用户裁定「需要形象载体是
 *      大部分情况，某则 meme 币没有一个落脚点。但是对于影响力巨大的事件（这个
 *      网站确实爆火），是应该可以豁免的」）：新增 event_influence 题（massive/
 *      notable/limited），只作载体门豁免输入，不参与事件分/评级。massive=全球级/
 *      全网级爆火、跨平台跨圈层、主流媒体或大量外部报道；单一平台热搜=notable；
 *      作者自夸无外部证据不选 massive。mapper：event_influence=massive 时
 *      `entityVisualBlock` 早退（审计 `subjectCarrierMassiveInfluenceExempt`），
 *      覆盖 C/D/E 三类载体门；C79 偷窥狂「抖音热搜」应为 notable，不触发。J1.96→J1.97。
 * J1.96（2026-10-21，C160 强情感冲击/动物救助路径，用户裁定「这个币出内盘了，
 *      这是属于对 web3 用户能造成强情感冲击的事件，算是另一条能打动用户的路径」
 *      「尤其是 web3 用户，喜欢猫猫狗狗」）：秦思雨案 0x843b2515…7777 —— 中国
 *      狗妈救助流浪猫狗后早逝，原判 W 类 + fit unfit 0.91 拦死。①event_category
 *      加纪念/公益真实人物故事归属：事件主体=人物/故事 → E（社会热点），不因
 *      文本提到「部署代币」判 W；W 只留给 crypto 产品/项目本身是事件主体。
 *      ②web3_user_event_fit 加强情感冲击/动物救助路径：真实正向公益/纪念（尤其
 *      流浪猫狗救助，web3 用户天然喜欢猫狗）→ 至少 fit，强共鸣可 strong_fit；
 *      情感币/纪念币是真实路径，不要求玩梗/二创。边界=消费弱势真人苦难/土味
 *      网红悲剧/疾病死亡猎奇/虚假未证实悲情仍 unfit（非正向纪念/公益共鸣）。
 *      J1.95→J1.96。
 * J1.95（2026-10-21，C159 短句点名具体 meme 不算空洞，用户裁定「这个矛盾了，
 *      又认为空洞，又认为符合 web3 审美」）：短尾猫案 0x25e1c479…7777 主推
 *      「chinese nubcat?」——event_quality_veto 判 event_empty_content 0.54，
 *      同时 web3_user_event_fit strong_fit 0.83，两层自相矛盾。题面加显式
 *      排除：短句/提问但点名具体 meme/实体/已知 IP（「chinese nubcat?」「XX猫？」）
 *      时主体与指代明确，属有内容的叙事素材，不选 empty_content；本项只留完全
 *      没有可辨识主体/指代的内容（纯表情、纯问候、无指向感叹）。是否为低质 IP
 *      复用由 token_ip_reuse 另判，不得混入空洞。J1.94→J1.95。
 * J1.94（2026-10-21，C157 官方措辞引用纳入超级IP来源臂，用户裁定）：
 *      「把官方措辞引用纳入超级IP来源臂；注意这里只能相信陈述的叙事，不需要去
 *      验证」。web3_user_phrase_acceptability 的超级IP来源判据扩臂：语料陈述某
 *      词句是超级IP/平台官方渠道的官方措辞/口号/命名（如「币安官方称之为智能时代」）
 *      → 采信陈述、不验证来源/页面（CG2.0 信陈述原则）；即使发言者是第三方转述号，
 *      也按超级IP来源的极端否证标准判（视为该IP的官方产出，不是普通转述）。
 *      智能时代案目标：官方措辞引用不再按通用短语拦。J1.93→J1.94。
 * J1.93（2026-10-21，C156 name_event_relevance → web3_user_name_event_acceptance，
 *      用户裁定「名字换了，全部都是用户角度」）：题键对齐用户视角前缀；判据/桶
 *      零改动（exact_match/acceptable/unacceptable）。mapper 双键读旧缓存行
 *      （新键优先，旧键 name_event_relevance 兼容）；审计 probabilities 新键落库。
 *      J1.92→J1.93。
 * J1.92（2026-10-21，C155 name_event_relevance 用户视角简化，用户裁定）：
 *      9 桶细分（semantic_clear/semantic_weak/cultural_rich/cultural_thin/
 *      generic_concept…）收敛为 3 桶——exact_match（明确匹配）/ acceptable
 *      （BSC meme 用户能理解并接受的引申关联）/ unacceptable（看不懂/不接受）。
 *      理由：用户不关心语言学分类，只问用户能不能理解并接受；币安/何一等超级IP
 *      的公开陈述被一定程度引申关联是正常的（「大人，时代变了」→「币安时代」
 *      判 acceptable，不因非逐字匹配降档；币名逐字出现在事件文本/主推中且事件是对
 *      该词的陈述 → exact_match，不因通用概念降档（MEMES 案））。mapper 新桶 acceptable=15 /
 *      unacceptable=5（旧 9 桶分数保留供旧缓存行重放）；Stage3 ≤10 截断不变。
 *      J1.91→J1.92。
 * J1.91（2026-10-21，C154 时效体系清理，用户裁定「哪些机制冗余/无意义都可以删」）：
 *      event_timing 删 expected_within_30d / expected_beyond_30d 两桶——W 票 247 张
 *      实跑 expected_beyond_30d 0 次、expected_within_30d 仅 6 次；未来事件预期
 *      30 天内归 within_30d，超过 30 天/无法判断归 unknown。mapper 同步删
 *      TIMING_SCORES_W 正向表（within_7d=25/within_30d=15/older=0）与 C68
 *      angleTimingOverride（774 行 0 命中）——W 分改纯吸引力 0-75、pass 32，
 *      时效仅对 older/unknown/override 封顶 30。题集版本 J1.90→J1.91；题数不变。
 * J1.90（2026-10-21，C152 MEMES fit 锚，用户裁定「可以」）：
 *      eth_cedric（Flap 平台 dev，46,539 粉）发「Memes will continue.」——empty_content
 *      已被作者豁免翻掉，但第二层 fit 判 unfit 0.33 / marginal 0.29 / strong_fit 0.27
 *      / fit 0.11（sf+fit 0.38<0.5）被 web3FitMassBlock 拦。用户裁定：这是 Flap
 *      开发者本人说的话，跟何一类似（弱一档），怎么会不符合 web3 用户？题面强契合
 *      例子只有马斯克/CZ/币安，缺「圈内平台/项目方核心开发者本人公开表态」锚。
 *      加锚：发言者身份本身是 web3 圈内事件，不因字面普通短语/口号/无具体形象判
 *      unfit/marginal——至少 fit，按发言者层级/话题强度可 strong_fit；普通路人/
 *      媒体账号发同类口号不适用。jev-state-builder 的 corpus_author_identity_note
 *      补作用域澄清（仅约束币名映射实体题，fit 题可按发言者身份判）。mapper 零改动。
 * J1.89（2026-10-21，C151 哭哭奶龙 wrong_entity 误判修正，用户裁定「改吧」）：
 *      「哭哭奶龙判为 wrong_entity 有点奇怪，我的感觉可能是 Prompt 的问题」——
 *      实体题 wrong_entity 的「版本/形态残片」锚把「错版奶龙玩偶→哭哭奶龙」这种
 *      有独立背景故事/文化来源的有意义变形（致敬/二创造型/错版玩偶）误判为指歪
 *      （J1.81/C139 新增全域门后的回归面；C113 原裁定「有意义的修改为什么不行？」
 *      在 ip_reuse 轴已修，实体轴再次误伤）。题面加显式排除：有意义变形不选
 *      wrong_entity（映射原 IP 判 accepted/unknown；作为新角色/新变体判 new_entity），
 *      wrong_entity 只拦无背景拼写错误/不忠实呈现/版本目录残片。mapper 零改动
 *      （wrong_entity≥0.5 门不变，靠 Jev 判读翻正）；题数不变。
 * J1.88（2026-10-21，C150 删除 event_institution_routine，用户裁定）：
 *      「event_institution_routine 也没必要存在，都让 web3_user_event_fit 去判断」。
 *      题集删桶（event_quality_veto 7→6 桶含 none）；mapper BLOCK_SCOPE 显式空域
 *      退役（旧缓存行/旧 fixture 的 institution_routine choice 不再拦）、argmax 链
 *      platformOfficial∧institution_routine 子句删除；BLOCK_LABELS 保留历史展示。
 *      机构日常/重要度不再作第一层质量否决——交第二层 web3_user_event_fit（与
 *      C145 产品/内容日常同向；C117/C132 等机构号票改由 fit+名字/载体/关联/质量门判）。
 *      题数不变（桶删）。
 * J1.87（2026-10-21，C145 删除 event_routine_content_product，用户裁定）：
 *      「event_routine_content_product 我认为应该直接删除（从 event_quality_veto
 *      中也删）；产品日常不应该是事件符不符合要求的最终判定，应该直接到 web3
 *      用户那边，看用户接纳度」「也就是说使用 web3_user_event_fit 即可」。
 *      题集删桶；mapper 删 routineContentProductBlock 概率门（≥0.5）、argmax 臂
 *      routine 子句、BLOCK_SCOPE（显式空域防旧缓存行照拦）；BLOCK_LABELS 保留历史
 *      展示。产品/内容型日常宣传改由 web3_user_event_fit + 名字/载体/关联/质量门判。
 *      event_institution_routine 保留（机构日常仍属重要度臂）。C94 京小安换票
 *      0xcb98accaa8040a7e839c305b8aca08e113c87777（同叙事另一发行，允许过）；
 *      C119 猫原 routine 0.43 随之放行。题数不变（桶删）。
 * J1.81（2026-10-21，C139 名字三轴重构，用户裁定）：实体轴
 *       web3_user_name_entity_acceptance 加第五选 **wrong_entity**（试图指向实体
 *       但指歪/指残：无背景拼写错/不忠实呈现/版本标注残片——「日本語版」映射到
 *       版本目录行而非作品实体本身，即便逐字出自高影响力主体的原话也不接纳，
 *       C105 案史随迁）全域拦 ≥0.5；no_entity 断代改名 **not_entity**（中性桶：
 *       口号/玩梗/文化词/句片段/陈述句——陈述句明确归本桶，拦截交词句轴）。
 *       载体轴 name_entity_carrier 改名 **web3_user_entity_visuality**（题面判据
 *       不变=形象三态；mapper 域不变：C/D 拦 improvised+no_visual、E 只拦
 *       no_visual、A/B/W/F/G 不碰——用户裁定维持现状），域内新增著名免形象资格
 *       （accepted≥0.5 ∨ 超IP认证行在册 ∨ authorUtterance；「名字与主体相关」由
 *       实体/词句轴 Jev 判据兜底）；C88 五腿豁免臂退役（rcp/劫持/关联豁免不动，
 *       评分贡献保留）；图证覆盖豁免保留。词句轴 web3_user_name_acceptability
 *       改名 **web3_user_phrase_acceptability** 并收窄：只评 not_entity 形状（实体
 *       票不经本题——名字质量归实体轴+形象轴）；版本臂/拼写臂删除（归
 *       wrong_entity）；J1.80/C138 超IP来源判据段随行。mapper 多键兼容读旧缓存
 *       行。题数不变（C138 J1.80 段见 10.8 题区注释）
 * J1.79（2026-10-20，C132 标准设计定稿：事件分=fit + 独立身份臂，用户裁定）：
 *      「事件分，我们的方案不是改用 fit 吗？」「改吧」：事件层不再用 impact 打分；
 *      eventCompositeScore = (strong_fit + fit) × 100（0-100，60 过线）。叙事存在性=
 *      event_token_block_reason；名字=web3_user_name_acceptability（Symbol）；拼写=
 *      C78 代码门；载体=J1.29（含 J1.78 动作/趋势规则 + empty_content 图证豁免）；
 *      实体=J1.56；旧源=C68/C75/C102/C103 override（封顶 30）；unfit≥0.5 负门保留。
 *      impact 题删除（14→13 题）。
 * J1.78（2026-10-20，C132 动作/趋势名载体判定，用户裁定）：
 *      载体题补第④判别：动作/舞蹈/趋势/事件名（「蝙蝠侠式蹦迪」「XX摇」）不以
 *      形象为存在形式，即使含知名角色词 → no_visual_entity（C80 由 J1.29 载体门拦）。
 *      注：影响力 +1.8 标尺校准因影响 45 个已校准单测，暂缓落地（见 C132 记录）。
 * J1.77（2026-10-20，C132 借势票热度陈述采信恢复，用户裁定）：「这是一个找角度
 *       推文，不看找角度推文本身的传播，而是看事件本身。我强调了太多太多次了！」
 *       ——J1.75/J1.76 丢了旧 J1.35 的「无事件层量化数据时直接采信热度陈述」规则，
 *       导致抖音/小红书借势票（巴巴鸡/롱캣/小黑/蝙蝠侠摇/鲸元券）被载体小号数据压低。
 *       J1.77 恢复：借势票主体=原始事件；站外热度陈述（全网火了/抖音火爆/热搜）+
 *       现场图/视频=事件层证据直接采信；载体小号数据不参与；只有事件层数据明显
 *       矛盾才降档。
 * J1.76（2026-10-20，C132 被动波及证据口径修正，用户裁定）：「不要就做个回测，
 *       可能回测集合的期望结果都是错的」「给事件描述+你的分数，验证 Jev 跟你是
 *       否一致」——实测 Jev 系统性低估 1-2 分：把刚发布内容的 0 赞当无波及、
 *       忽略高影响力账号受众曝光、借势内容看小号而非源头传播。J1.76 补证据口径：
 *       刚发布/官方内容/借势热点分别怎么判被动波及（仍不是按粉丝数打分）。
 * J1.75（2026-10-20，C132 影响力口径改被动波及，用户裁定）：「我尚未完全决定使用
 *       web3_fit 单臂，先保守一点，还是使用影响力单门。喜好度偏 Web3 主观，影响力
 *       偏被动」——web3_user_event_impact 从「你会不会停下来/买」的主动反应改为
 *       **被动波及**：事件会不会进入用户视野、占据注意力、影响情绪/讨论/行为；
 *       0-5 按波及广度；喜好度仍由 web3_user_event_fit 单独承担（不合并）。
 *       另：用户裁定 C109a 交易猫/C130 돼지 H 期望 high（回归集校准目标）。
 * J1.74（2026-10-20，C134 股城案延续，用户裁定）：「发在 BSC 链的项目，一开始
 *       刚发出，基本上不可能有币安交互，把币安交互这一臂去掉，改为分析项目本身
 *       对 BSC Web3 用户的吸引力」：删除 w_binance_interaction 题，新增
 *       w_bsc_user_appeal（项目对 BSC 链 Web3 用户的吸引力，0-40，同权重）——
 *       评估项目自身的叙事/玩法/参与门槛/传播点，模拟 BSC 用户是否会参与/讨论/
 *       传播；明确不评币安官方交互（刚发布项目不可能有，不扣分），也不评发布后
 *       实测热度。mapper：W 数学三轴=产品+BSC用户吸引力+时效，C42 世界级主体
 *       产品豁免币安交互随被豁免的轴退役；wInteractionScore→wAppealScore。
 *       题数不变
 * J1.113（C184，2026-10-23）：实体题 unknown 桶断代 unacceptable_type——判据轴从
 *       「接受度/影响力低（认知度轴）」换为「实体类型/性质不能被 BSC meme 币用户
 *       接纳为 meme 币名（类型轴）」。用户裁定（观察票 C183-C187 vs C189-C191）：
 *       可乐/银行名/犬种学名=类型不可 meme 化该拦（无论著名与否——著名只让类型更
 *       明确）；天狗/恩恩崽/乐宝豆=可接纳类型该放。二轮裁定：**不评认知度**——事件
 *       已成立且实体与事件关联（关联度门管）时用户已知晓该实体，认知度轴整体删除，
 *       实体题只看类型与性质（实体量级归量级门）。三/四轮裁定：**new_entity 桶随
 *       之删**（类型不因新旧而变，「性质没问题即可，是否新旧都没事」）——五桶→
 *       四桶 accepted/unacceptable_type/wrong_entity/not_entity，故事主体（C174）/
 *       有意义变形（C151）锚落点迁 accepted。mapper nameEntityTypeUnfitBlock
 *       恢复拦截（读 unacceptable_type ≥0.5，不归一读旧 unknown——历史缓存行
 *       零翻转，重析后更新）。
 * J1.112（C183，2026-10-23）：评估主体键名族断代 web3_user_* → bsc_meme_user_*（veto/fit/
 *       关联/实体/词句五题+词句题两桶值）。用户裁定：web3 用户范围太大——「有的事件
 *       不是说在 Web3 不重要，而是对 BSC 的 meme 币用户不重要」（JPM 案 0x27ff2020…7777
 *       归因应落在 BSC meme 币用户）。判据不动（C123 改名先例），题面评估主体措辞同步
 *       收窄；fit 题面引用旧 veto 键 event_quality_veto 的 J1.110 漏改一并修。mapper
 *       归一读旧行（历史缓存行零翻转）。
 * J1.111（C181b，2026-10-23）：veto 题两层缺陷同时命中时事件层优先——无名作者
 *       单句口号式提及（含套人物/机构名）选 event_empty_content，token_ip_reuse
 *       桶划界=只管 meme IP/形象/梗的换皮复用（案发：RichardTeng
 *       0x007f5ddb…7777 J1.110 跑 token_ip_reuse 0.52 / empty_content 0.31 分票，
 *       token_ip_reuse 域仅 A、票 category=C → argmax 域外放行 71.11 high）。
 *       mapper 零改动（桶 id/域/阈值全不动），题面划界使 argmax 收敛到域内桶
 */

export const JEV_QUESTIONS_VERSION = 'J1.121';

/** 品牌 keyword 预检表+shouldIncludeBrandHijackCheck 已废（J1.103/C172 品牌劫持轴
 * 整体退役：brand_mismatch 桶删除后预检唯一用途 mapper 门开关消失；名字-事件
 * 关系轴归 bsc_meme_user_name_event_acceptance 用户视角承接） */

/** 时效 6 档（标准类换算：15/10/0/10/5/0；W 类换算：25/15/0/15/0/0） */
export const TIMING_OPTIONS = [
  'within_7d', 'within_30d', 'older',
  'expected_within_30d', 'expected_beyond_30d', 'unknown',
];

/**
 * 构建主路径问题集（standard 模式，superIP 模式复用同一问题集）
 *
 * @param {Object} [options]
 * （options.brandMismatch 已废 J1.103/C172：brand_mismatch 桶随品牌劫持轴
 *   整体退役，传参静默忽略）
 * @param {boolean} [options.referentMemeability] - 已废弃（J1.28 起恒带，传不传
 *   均包含）：J1.21 时仅 superIP 快车道携带（nameReferentBlock 豁免评分）；
 *   J1.28 起标准路径恒带——mapper 低档门（memScore≤1 → 不适合成为meme币）判据源
 * @param {boolean} [options.carrier] - 已废弃（J1.29 起恒带，传不传均包含）：
 *   dry-run 阶段的 opt-in 参数（题面验证期），J1.29 转正式恒带——mapper 载体门
 *   （C/D+非existing / E+no_visual 拦）判据源
 * @param {boolean} [options.imageConsistency] - 是否包含名字与配图主体一致性题
 *   （J1.30，仅语料含【图片内容分析】块——主推配图分析成功挂载——时为 true）：
 *   mapper 名图一致豁免（imgNameExempt）判据源。条件题与 parent_relationship 同模式：
 *   无图不问（防幻觉作答），题集形状按语料有无图分叉
 * @param {boolean} [options.parentRelationship] - 是否包含载体与父推关系题
 *   （J1.39，仅语料任一载体槽位（主推/website_tweet/quoted/retweeted）带
 *   【回复的推文】块时为 true）：mapper C103 源头窗（翻译/二手解读 + 父推
 *   >24h → timing older）判据源。条件题同模式：无父推不问防幻觉作答
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildStandardQuestions(options = {}) {
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
- token named after a CHARACTER inside a work (anime/manga/game/film character: token name = the character's own name, NOT the work's title): subject = that character as a visual IP → category A. The work's official promo/announcement tweet is merely the corpus source for the character — it does NOT make the event an institutional product announcement (D) or a routine content-product promo. Judge the character's own IP notability and meme evidence; an unknown / not-yet-aired character is a low-tier IP.
- memorial / charity / real-person story (J1.96/C160): when the tweet tells a real person's life, charity, death or collective-mourning story and the token is merely a vehicle to remember them, the event subject is the PERSON/STORY → E (social hotspot), NOT W. W is reserved for the crypto product/project itself being the subject of a launch/update; merely saying 「部署这个代币」 inside a memorial story does NOT make the event a W-class product launch.`,
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

    // ── 2. 事件价值 = bsc_meme_user_event_fit（J1.79：impact 不再打分；叙事存在性由
    //     event_quality_veto 门判（J1.82 前键名 event_token_block_reason），身份缺陷由名字/拼写/载体/实体门判）──

    // ── 3. 事件时效（原 Stage2 时效项，6 档；分数代码端换算）─────────
    event_timing: {
      type: 'choice',
      instructions: `事件时效（timing relative to now）。以当前时间为基准判断事件的发生时间。未来事件：预期30天内发生→within_30d；预期超过30天或无法判断→unknown（J1.91/C154 删独立 expected 桶）。
E类（社会热点）按发酵状态定档：正在发酵/传播进行中→within_7d档；仍是持续热点但热度已过峰值→within_30d档；已过气→older档`,
      criteria: {
        within_7d: '事件已发生，且发生在7天内',
        within_30d: '事件已发生，发生在7-30天前；或未来事件预期30天内发生',
        older: '事件已发生，超过30天',
        unknown: '无法判断（含未来事件预期超过30天）',
      },
    },

    // ── 3.5 载体与父推关系（J1.39 条件题，仅 parentRelationship（语料任一载体
    //    槽位带【回复的推文】块）时加入：mapper C103 源头窗判据源——Jean Phil
    //    翻译洗白案。条件题与 name_image_consistency 同模式：无父推
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
    // ── J1.82（C140）键名断代：event_token_block_reason → event_quality_veto；
    //     J1.110（C181）再断代：event_quality_veto → web3_user_event_impact；
    //     J1.112（C183）三断代：web3_user_event_impact → bsc_meme_user_event_impact
    //     （用户裁定评估主体收窄：web3 用户范围太大——有的事件不是对 Web3 不重要，
    //     而是对 BSC meme 币用户不重要；JPM 案 0x27ff2020…7777。全族 web3_user_*
    //     → bsc_meme_user_* 同批断代，题面评估主体措辞同步；mapper 归一读旧行；
    //     桶 id 不变零断代）──
    bsc_meme_user_event_impact: {
      type: 'choice',
      instructions: `对 BSC meme 币用户的影响力（bsc meme user event impact）。本题为叙事评估**第一层**：评估事情的质量与重要性——是否是真实、有分量、对 BSC meme 币用户有影响力的事件。否决=选对应阻断项，无论分数多高都不能通过。第二层口味契合（是否值得玩/买）由 bsc_meme_user_event_fit 另评——本题只判事情本身。
⚠️ 负面事件（安全事故/被盗/政治暴力等硬新闻）不由本题否决——负面事件是否有 meme 玩味空间、值不值得玩，由第二层 bsc_meme_user_event_fit 判。
⚠️ 选项按对象分两类：**event_* = 事件层否决**（事件本身的性质）；**token_* = 代币层否决**（代币名/形象本身的缺陷）。选真正命中且最突出的一项。⚠️ 两层缺陷同时命中时**事件层优先（J1.111/C181）**：无名作者的单句口号/喊话式提及（事情全部内容=作者一句话，即使套用人物/机构名）→ 票的根基是没有事件，选 event_empty_content（名字是否蹭人名是次要缺陷，不由 token_* 承载）；token_* 留给事件本身成立、但名字/形象是低质换皮复用的票。`,
      criteria: {
        none: '无阻断——事件有明确主体和内容，对 BSC meme 币用户有影响力，有叙事价值',
        event_empty_content: '空洞内容——对 BSC meme 币用户没有影响力、无可传播事件素材的内容。两类形状：①无主体、无上下文的日常闲聊/自言自语（纯感叹、无信息量的互动、纯表情、纯问候、无指向感叹）；②无名作者的单条口号/喊话/宣言/许愿（J1.110/C181）：普通路人/无名账号喊一句话——句子是说事、喊话、表态、许愿而非具名玩梗（对人物/机构/品牌口号式提及，即使点名 Richard Teng/币安等知名对象）——事情全部内容只是作者自己的一句话，无外部热点依托、无情节、无第三方参与/讨论，除作者外没有任何人当回事 → 对 BSC meme 币用户不构成影响力事件。⚠️ 不算空洞（J1.58）：圈内符号级/高影响力账号（CZ、何一、币安等）本人的公开问候/表态/简短回应——在 meme 市场这本身就是可玩、可传播的事件素材（影响力看作者层级，不看句子本身）；回复/引用一个实质性事件（产品发布/官宣/重要动态）时的简短回应——是对该事件的参与/表态。⚠️ 不算空洞（J1.95/C159）：短句/疑问句但点名具体 meme、梗主体或已知 IP 的完整名称/名词主体的指认/提问/玩梗（如「chinese nubcat?」「XX猫？」）——即使只是提问/片段，主体和指代明确，属于有内容的叙事素材；不能把它当无主体闲聊——本项只留完全没有可辨识主体/指代的内容。⚠️ 不算空洞（J1.110/C181，同 C175b 边界）：成型叙事——有情节的故事、持续的行为记录、被命名主体的来历（个人种树记事、救助流浪猫的过程）——哪怕全部由作者个人产生，事件本体已成立、有事可讲，正常评估影响力（无名作者不减已成立事件的分量）。⚠️ 本锚不适用于纯缩写/纯符号/表情+缩写组合（如「DND 😾」）——没有文字命题，仍按原判；有配图时由 C114 图证豁免接管。是否为低质 IP 复用由 token_ip_reuse 另判，不得混入本项。作者/机构量级只在事件成立后影响量级题（量与质分属两题）',
        event_baseless_speculation: '无据猜测——预测没有任何推理依据支撑',
        token_ip_reuse: 'IP低质复用——仅限两种形状（J1.46）：①纯蹭名：直接套用现有知名IP/热点的名字或形象，无任何新内容；②无意义修改：替换/拼贴/抄袭/模仿没有产生任何有意义的新对象（换皮改名、硬拼无关元素）。⚠️ 原生热点梗/人物/事件主体自身的代币化不选本项（C189 彪弟案）：热点梗第一次/正常发币（名字直接取自热点主体、热点事件本身在场、语料可证）是 meme 币的正常叙事参与，蹭名与否、事件契合与传播由关联题/fit 题/量级题正常评估；本项只管同一 IP 形象被**反复换皮/多处收割**的复用形状（无新事件依托的重复发币、纯收割），复用与正常叙事票的分界=有无新的事件依托。⚠️ 仅套用真实人物/机构名（如 CZ、Richard Teng、币安）而无 meme IP/形象/梗的复用，且事件本体=无名作者一句话（口号/喊话式提及）→ 不选本项，按 event_empty_content 判（J1.111/C181 事件层优先：根基是没有事件）；本项只管 meme IP/形象/梗的换皮复用。⚠️ 有意义的修改/变形不选本项：在现有IP上产生具体的新梗对象（新造型/错版/变体/新玩法/有玩味空间的新形象）是meme币正常玩法，改按事件自身价值与传播正常评估；无独立叙事生命力的判据也只看事件本身（蹭名无事件 vs 变形带出新事件/新对象）',
      },
    },

    // ── 5.4 事件影响力题已删（J1.102/C171）——唯一消费点=J1.29 载体门豁免
    //     （J1.97/C161），载体门随轴整体退役后无消费，题随之删除（死题不白烧
    //     fan-out token）。旧缓存行残留 event_influence 键无害（mapper 不再消费）──

    // ── 5.5 Web3 用户偏好契合（J1.19 独立题，事件层受众判断，代码端 unfit≥0.5 质量门拦截）──
    bsc_meme_user_event_fit: {
      type: 'choice',
      instructions: `BSC meme 币用户偏好契合度（bsc meme buyer fit）——**叙事评估第二层**：第一层事件质量（bsc_meme_user_event_impact：有意义/重要度/不负面）过了之后，本题判事件合不合链上买家口味（J1.82 两层结构）。也是标准路径的事件价值题（J1.79）：事件分=本题 strong_fit+fit 质量（0-100，60 过线）。判断事件主题与 meme 币链上买家群体的口味契合度——不是事件影响力大小；叙事是否真实存在由 bsc_meme_user_event_impact 门判，代币名字/拼写/载体/实体缺陷由对应门判，不重复做。
链上买家画像（BSC meme发射平台真实用户群）：以华语crypto圈为主、全球meme玩家参与；玩梗文化、乐子导向、财富叙事；买的是「能玩、能二创、能传播」的主题。
判据核心两问：①这个主题能否被链上买家玩梗/二创/自嘲式传播（有形象、有梗、有乐子）？②事件受众与crypto圈是否重叠？
强契合典型：动物/萌宠形象（猫狗蛙熊猫等）、可爱风/萌系动漫游戏角色、极客风题材（编程/AI/科幻/交易与投机文化讽刺，如炒股炒币题材动画）、币圈自嘲与财富叙事（梭哈/归零/韭菜）、马斯克/CZ/币安等币圈名人梗、奇怪/猎奇/荒诞的乐子梗、知名IP/角色/梗图、有形象可二创的乐子梗。
不契合典型：消费具体弱势真人的土味网红梗（如范小勤/小马云型）、对死亡/疾病/器官的猎奇/阴郁消费（非正向纪念/公益共鸣）、纯内容欣赏无玩梗空间（影评式赞叹「立意很好值得一看」）、严肃社会议题、纯人名无形象无梗、娱乐圈八卦、圈层不可达的圈外领域热点（垂直行业黑话/圈子内部梗/地域性社群文化——web3 买家 get 不到梗）。
⚠️ 「小众」按 BSC meme 买家视角判，不按大众视角判：动漫游戏/极客/ACG题材对crypto圈不是小众（用户群高度重叠，可爱风/极客风/奇怪的东西恰是 BSC meme 币用户强偏好），不要因大众视角的小众而判unfit——圈层可达性归本题后（圈内梗≠小圈子），「受众与crypto圈不重叠的圈外领域（传统行业/地域文化/严肃专业）= get 不到梗 = unfit（不是 marginal）；marginal 只留给圈内能 get、有部分契合要素但玩味空间有限的主题」。
⚠️ 传播数据（点赞/播放量）大小不是本题判断依据——只问主题本身合不合 BSC meme 币用户口味；Web3产品/币圈事件（W类）天然强契合。
⚠️ 事件本体的分量是契合的前提（J1.105/C175，OK❌案）：币所关联的事件得先是 BSC meme 币用户群里真实有分量的存在——事件源自公共热点/新闻/圈内人物或平台的表态等**币外分量**时（宣告者无名不减事件分量：无名账号报道/玩已被传播的热点，事件仍是那个热点）→ 正常评估主题契合；反之，事件本体**只是无名作者自己的一句口号/一次玩梗**（无外部热点依托、无传播、无第三方讨论——除作者外无任何人参与）→ 不是事件，**至多 marginal**：名字与品牌的谐音匹配再巧也不能凭空造出事件（一句口号不是事件）。⚠️ 边界（J1.106/C175b，TREE 案）：本臂只限「空口号」形状——**无叙事内容、无事可讲**（除谐音/点名外没有任何情节）。事件是**成型的叙事**（持续的行为记录、有情节的故事、被命名的主体的来历——如个人种树记事、救助流浪猫的过程）时，事件本体已成立、有事可讲，全部由作者个人产生不减分量，正常评估契合（第三人称报道非必要条件）。与传播数据锚的边界：互动数字不作加减分依据；本锚判的是事件有没有币外来源/分量，不是数字大小。
⚠️ 圈内平台/项目官方账号或核心开发者本人的公开表态/口号（如 Flap dev 的「Memes will continue」、何一/币安高管发言，J1.90/C152）——发言者身份本身是 web3 圈内事件，不因字面是普通短语/口号、无具体形象而判 unfit/marginal；至少 fit，按发言者层级/话题强度可 strong_fit。注意区分：普通路人/媒体账号发同类口号不适用本锚（仍按主题本身判）。
⚠️ 强情感冲击 / 动物救助路径（J1.96/C160）：真实、正向、广泛传播的公益善举/人物纪念故事，尤其是**流浪猫狗救助**（BSC meme 用户对猫猫狗狗有天然好感）——能引发 BSC 用户的共情、敬意、纪念冲动 → 至少 fit，强共鸣可 strong_fit；情感币/纪念币是 meme 市场的一条真实路径，不要求玩梗/二创。⚠️ 边界：消费具体弱势真人苦难、土味网红悲剧、疾病/死亡猎奇、虚假/未证实悲情 → unfit；本锚只认「真实正向公益/纪念 + 猫狗等 BSC meme 用户能共情的主题」。
⚠️ 全球级爆火的产品/网站/游戏/现象（J1.97/C161）：跨平台、跨圈层、有外部报道/维基/官网等证据 → **至少 fit**；如果用户能参与/讨论/二创（人生模拟网站、生成器、小游戏等）→ **strong_fit**。注意：单一平台热搜/圈内刷屏不是全球级，不适用本锚；作者自夸无外部证据不适用。
⚠️ 公司产品实体（J1.27/J1.83）：主体是公司/机构发布的产品本身（而非公司自身）时，BSC meme 币用户对产品的接纳独立判——母公司影响力/规格不转移给产品（华为发布麒麟芯片≠链上用户接纳麒麟）：纯功能型产品（芯片/大模型/软件功能/电商平台/办公工具）无形象无玩梗空间→unfit；有独立可爱形象的产品（吉祥物/角色）按形象自身被玩梗的证据判。币安等 crypto 原生机构（交易所/公链/Web3 平台）的产品不在此列——链上买家即其生态用户，影响力可正常转移给产品，天然强契合。`,
      criteria: {
        strong_fit: '强契合——动物萌宠/可爱萌系ACG角色/极客风题材（AI/科幻/交易投机文化）/币圈梗/马斯克CZ币安/知名IP角色/奇怪猎奇乐子梗，链上买家天然喜欢；圈内平台/项目方核心开发者或官方账号的强表态/口号（按发言者层级与话题强度，J1.90/C152）；真实正向、广泛传播的公益/动物救助（尤其流浪猫狗）/集体纪念事件引发强情感共鸣（J1.96/C160）',
        fit: '契合——有形象或有玩味空间，受众与crypto圈重叠；圈内平台/项目方核心开发者或官方账号的一般公开表态/口号（至少本档，J1.90/C152）；真实正向的情感/纪念故事，尤其猫狗救助主题（至少本档，J1.96/C160）',
        // J1.82/C140：marginal 圈外臂删除（原「不重叠小众领域落 marginal 不拦」=
        // 圈层可达性桶退役后的逃逸洞）——圈外主题一律 unfit，marginal 收窄为
        // 圈内能 get 但玩味空间有限
        marginal: '边缘——圈内能 get、有部分契合要素，但玩味空间有限（有形象/有素材，二创与自嘲式传播空间窄；受众与crypto圈不重叠的圈外主题不是本项——get 不到梗=unfit）',
        // J1.82/C140：unfit 吸收 token_circle_reachability 拦截责任（原 A 域 argmax
        // 桶→本题全域概率门）——锚句随迁：圈外口径=能不能 get 非出圈前景、
        // PEPE/doge 圈内梗反向臂、品牌营销物料边界（C110：缺句会漂移 argmax）
        unfit: '不契合——土味网红消费真人/对死亡/疾病/器官的猎奇或阴郁消费（非正向纪念/公益共鸣）/纯内容欣赏无梗/严肃议题/纯人名无形象/公司产品实体不被接纳（主体是公司/机构发布的产品本身而非公司：功能产品/产品内形象/吉祥物，BSC meme 币用户对产品本身无感——母公司影响力与规格不转移给产品，华为发布麒麟芯片≠链上用户接纳麒麟；crypto 原生机构（币安/公链/Web3 平台）的产品例外：链上买家即其生态用户，天然强契合不选本项）/圈层不可达（名字/形象/主题源自与crypto圈不重叠的圈外亚文化：垂直领域黑话/圈子内部梗/地域性社群文化，BSC meme 买家 get 不到梗、无从玩起。「圈外」的唯一口径=crypto 圈用户能不能 get（认知可达性），不是大众出圈前景——meme 币不需要出圈）。⚠️ crypto 圈内梗/黑话≠小圈子——社区自发形成的圈内文化梗（PEPE/doge/币圈自嘲梗型）对 BSC meme 用户是原生强契合，不选本项；交易所/项目方的品牌营销物料/官方周边/活动噱头不是社区梗——带币安/crypto 品牌不等于圈内契合，无实质产品/事件内容的仍归营销噱头（第一层阻断判）',
      },
    },

    // ── 5.6 主体实体类型题已删（J1.83/C141）——判据并入 bsc_meme_user_event_fit
    //     unfit 桶（母公司影响力≠产品接纳臂）；mapper 侧 productEntityAcceptanceBlock
    //     退役为 web3FitMassBlock 通用门（sf+fit<0.5 全域，豁免链继承）。旧缓存行
    //     残留 event_subject_entity 键无害（mapper/前端不再消费 choice）──

    // ── 6. W 类专用（项目对 BSC 用户吸引力 0-75，仅 W 类采信）──
    // （5.7 事件情绪感染力题已删 J1.36/C93；w_product_score 已删 J1.84/C142——
    //   与本题语义/统计双重重叠，W 数学合并为单轴）
    w_bsc_user_appeal: {
      type: 'choice',
      instructions: `项目对 BSC 链 Meme 币用户的吸引力（仅 Web3 项目评估），弱/中/强三档。评估对象=项目自身（叙事题材/玩法与参与机制/参与门槛/传播点），一切从用户角度出发：模拟 BSC 链的 Meme 币玩家第一次看到这个项目时的反应——会不会感兴趣、想参与、想讨论转发、想拉人来玩。评的是项目属性带来的**预期吸引力**，不是发布后的实测热度（语料里的互动量不是本题判断依据）；项目方的技术自述/路线图不直接等于用户吸引力，要看用户能不能感知到玩法/梗/参与理由。
⚠️ **不评与币安官方的交互/合作/上币预期**：刚发布的 BSC 项目本来就不可能有币安交互，这不是项目的吸引力证据，也不因此扣分（本题已取代旧「币安交互分」）。`,
      criteria: {
        weak: '弱吸引力——没有或只有基本的概念/玩法：无叙事记忆点、同类常见无差异、参与理由弱，用户看一眼就过（合并旧「无吸引力/一般」两档）',
        moderate: '中——有明确吸引力：有具体的玩法/参与机制或叙事记忆点，BSC 用户愿意尝试、讨论、转发',
        strong: '强吸引力——玩法/叙事直击 BSC meme 玩家、参与门槛低且有自传播/FOMO 点，用户会主动拉人参与',
      },
    },

    // ── 8-9. 关联性（原 Stage3 第一大项）─────────────────────────────
    // ── J1.43（C109）：name_event_relevance+relevance_level 两题合一——9 融合桶吸收
    //     原 level 语义，分值代码端 RELEVANCE_FUSED_SCORES（旧两题形状走 legacy 查表）──
    bsc_meme_user_name_event_acceptance: {
      type: 'choice',
      instructions: `代币名与事件的关联（token-event relevance）——判定轴只有一条：**BSC meme 用户能不能理解并接受这种关联**（一切从用户角度出发）。检查代币 Symbol/Name（去 emoji/数字/特殊字符后）与事件核心词的关系。
⚠️ 宣告采信豁免（判轴级规则，先于分桶判定）：发币者自己的宣告推声称事件主体的名字已确认/已揭晓/已定（如 "the name is confirmed / 名字已确认 / name revealed"）→ 判 **acceptable** 起步，**不要求宣告点名说出名字**——部署者以本币名发币，本身就是「币名承载该名字」的行为表达；发币 + 宣告「名字已确认」两件事并置即满足前提，**不得要求语料再明说「币名=该名字」**（部署者一般不会明说这句）。币名逐字出现在语料仍判 exact_match；**不得因币名未逐字出现在语料文本/配图中而判 unacceptable**——验证宣告真实性不是本题任务（采信陈述）。⚠️ 反臂：宣告推若明确指出主体名字是另一个词（≠币名），则币名不是承载者，不适用本豁免。
① **exact_match 明确匹配**：币名与事件核心词明确对应（原名/官方译名/通用称法/缩写/别名/作品/口号），用户一看就知道是同一个东西。
   ⚠️ 币名（去 emoji/大小写后）**逐字出现在事件文本/主推中**（如「Memes will continue」与币名 MEMES；CZ 推文「you got in early」与币名 EARLY；「DND 😾」与币名 DND；「こんにちは💛」与币名 こんにちは）→ 判 **exact_match**，不选 unacceptable——用户看到名字就能直接对应到这句话；即使该词本身是普通词/问候语/圈内文化词，也按逐字匹配处理，不因通用概念降档。
② **acceptable 用户能理解并接受**：不是逐字匹配，但 BSC meme 用户能看懂并接受这种引申/文化关联（语义引申、圈内梗、玩梗、对超级IP陈述的合理引申）。
   ⚠️ 币安/何一等超级IP的公开陈述被一定程度引申关联是正常的（如「大人，时代变了」→「币安时代」）——BSC meme 用户会这样引申且能接住，判 acceptable，不因不是逐字匹配而降档。
③ **unacceptable 用户看不懂/不接受**：硬蹭、无关联、需要语言学论证才勉强成立、圈外梗、通用短语与事件无绑定。`,
      criteria: {
        exact_match: '明确匹配——币名与事件核心词明确对应（原名/官方译名/通用称法/缩写/别名/作品/口号），用户一看就知道是同一个东西；币名逐字出现在事件文本/主推中 → 本项（含普通词/问候语/圈内文化词，不因通用概念降档）',
        acceptable: '用户能理解并接受——不是逐字匹配，但 BSC meme 用户能看懂并接受这种关联（语义引申/文化梗/圈内玩梗/对超级IP陈述的合理引申；币安/何一等超级IP的陈述被一定程度引申关联是正常的；宣告采信豁免适用 → 本桶起步（规则见题面判轴段））',
        unacceptable: '用户不能理解/不接受——硬蹭/无关联/需要语言学论证才勉强成立/圈外梗/通用短语与事件无绑定',
      },
    },

    // ── 10. 币名映射实体对 Web3 用户的接受度/影响力（J1.56 立题，C126 何一
    //     「こんにちは」案；替代 J1.10 name_referent——旧题把「作者侧身份」和
    //     「币名指代对象」混在 super_ip 一个词里，概念复用。新轴=实体映射 +
    //     实体在用户侧的接受度/影响力；作者原话票由代码侧 corpus_author_identity
    //     + authorUtterance 事实承担，不由本题升档（问候语如实答 not_entity）；J1.81/C139
    //     加第五选 wrong_entity（全域拦）+ no_entity 断代改名 not_entity；J1.85/C143
    //     加第六选 brand_mismatch（品牌劫持/概念扩大，吸收已退役的 name_brand_hijack
    //     条件题）——J1.103/C172 删（品牌劫持轴整体退役：名字-事件关系归
    //     bsc_meme_user_name_event_acceptance 用户视角承接，实体题回五桶原形）；
    //     J1.113/C184 unknown 桶断代 unacceptable_type（类型轴）──
    bsc_meme_user_name_entity_acceptance: {
      type: 'choice',
      instructions: `币名映射实体的类型/性质能否被 BSC meme 币用户接纳为 meme 币名（name-mapped entity acceptance，J1.114）。判定代币 Symbol/Name（去 emoji/数字/特殊字符后）映射到哪个实体，以及该实体的类型/性质对 BSC meme 币用户（链上 meme 买家）是否可作为 meme 币名接纳。
评估对象=币名映射到的那个实体本身（人物/机构/项目/资产/形象/IP）——不是事件整体热度、不是发推人/陈述者的量级（陈述者量级另有题评）、也不是大众媒体知名度。
映射成立的三种方式：①直接指代——实体本名/官方译名/通用称法/形象/作品/原创梗（名字=作者本人的名称/自称/外号/作品/原创梗且出自其本人文本，映射到该作者实体）；②实体产出——该实体产出的官方口号/标志性品牌主张/官方文案（口号的作者=产出它的实体，发现/转述/搬运者不改变归属，如币安APP界面的「货币自由」）；③领域知名发布者的独立新产品/重大升级（发布者知名度指代到产品名；不含现有产品的版本更新/功能改进/新平台移植）。
⚠️ 作者身份本身不是映射——作者的认证/粉丝数不等于币名指向该作者；币名是其本人文本里的普通词/问候语/口头禅等非实体词时，本题如实判「无实体」，不得因作者是超级 IP 而升档（作者原话票由代码侧事实另管）。
⚠️ 语料/配图中真实出现的形象也是可判定的映射来源：币名与该形象对应时，映射到那个形象本身，按其自身在用户侧的地位评。
⚠️ 指歪≠指到：币名试图指向已知实体但映射失败（无背景拼写错误/不忠实呈现/版本标注残片）=wrong_entity（拦截位，判据见桶文）；没试图指实体=not_entity（中性）。
⚠️ 被命名+被讲故事的故事主体（J1.104/C174，TREE 案）：语料为主体起名/起绰号并讲述其故事的自创称号（如种了 1.5 年的橙子树起名 BNB Tree）→ 映射该故事主体，判 accepted；不因名字字面是普通词（树/猫/橙子）判 not_entity。逃逸门：须语料确实陈述了命名行为/讲过故事——无命名行为的普通词蹭名票不适用，仍走 not_entity。
⚠️ 专名即实体（J1.121/C190，混混猫案——性质轴延伸，同 J1.113「新旧不是维度」）：名字被用作**特定主体的称谓/专名**——社区名、mascot/吉祥物名、角色名、外号、组织名（如「XX社区」「XX家族」式专名搭配在场、官方以该名运营社区/形象）——币名即映射到该主体，按类型轴评，**无论自创还是已知、无论知名与否、无论语料是否讲过它的故事/是否陈述命名行为**（称谓在场使用即可，不要求 C174 的命名行为陈述）；「实体」不要求已存在/知名/词典收录——自创 mascot/社区形象属可玩梗的具象角色类型，类型可接纳即 accepted。not_entity 只留给名字本身不映射任何主体的形状：泛称普通词无专名化搭配、且无语料命名/故事陈述。
⚠️ 性质定义优先（J1.105/C175，京小安案）：name/语料已为币名主体给出明确的性质/身份定义（角色定位清晰具体，如「首款AI警犬」）且该性质是用户天然接纳的具象角色形象 → 判 accepted，不以知名/被广泛报道为前提。反锚（J1.106/C175b，币安上电视案）：陈述句/事件描述式名字（「XX上电视」「XX要来了」式说事非命名）不构成性质定义，即便句中提及著名实体也不因此 accepted，仍归 not_entity 由词句题接管；空泛自称（「官方币/年度最强」式口号）不满足明确定义。
⚠️ 形象考量：有可视觉化形象、可被玩梗/二创传播的实体更易被接纳（加分考量）；无具象形象（项目/平台/软件/人物本人）本身不构成否决，一切按实体在用户侧的整体接纳情况综合判断。
判据（J1.114）=**只看实体的类型/性质**能否被 BSC meme 币用户接纳为 meme 币名，不评认知度/知名度/影响力——事件已成立且实体与事件关联在场时，用户已知晓该实体（知晓由事件与关联度保证，不是本题的事）；实体量级/影响力由量级门评，玩味/二创潜力由 name_entity_memeability 另评。天然可接纳的类型：人物/形象/IP/梗形象/圈内项目/平台/资产/动物与神话角色等本身是 meme 用户玩梗/当符号对象的类型；不可接纳的类型：圈外商业品牌/消费品（可乐）、金融机构/银行、动物品种/生物分类学名（犬种学名）、严肃机构/组织/政府主体、事务性公司/工具产品——这些类型无论实体多么著名都判 unacceptable_type（著名只让类型更明确，不改变类型不可接纳）。`,
      criteria: {
        accepted: '币名映射到**类型/性质可被 BSC meme 币用户接纳为 meme 币名**的实体——圈内符号级人物/机构/项目/资产/形象（CZ、币安、PEPE、doge 级）、人物/形象/IP/梗形象/圈内项目平台资产、天然可玩梗的具象角色等本身是 meme 用户玩梗/当符号对象的类型；含该实体的官方口号/标志性品牌主张（实体产出）；含领域知名发布者的独立新产品/重大升级（发布者知名度指代产品名）；含刚诞生的新项目/新品牌/新角色/新资产（类型可接纳即归本项——J1.113/C184：性质没问题即可，新旧不是维度，认知度不是判据）；含被命名+被讲故事的故事主体（J1.104/C174，如 BNB Tree——不因名字字面是普通词降 not_entity）；含已知 IP 的有意义衍生新造型/错版玩偶/二创角色（J1.89/C151：错版奶龙→哭哭奶龙——是新的玩梗对象，不是指歪）；含语料已明确定义可接纳性质的角色（J1.105/C175：「首款AI警犬」——不以知名为前提）；含被用作特定主体称谓的自创专名（J1.121/C190：社区名/mascot 名/角色名/外号——「XX社区」式专名搭配在场即映射该主体，自创 mascot/社区形象=可玩梗具象角色；新旧/知名/语料是否讲故事都不是维度）',
        unacceptable_type: '币名映射到**可辨的实体**，但该实体的类型/性质不能被 BSC meme 币用户接纳为 meme 币名——圈外商业品牌/消费品（可乐、快狗打车）、金融机构/银行（浙商银行）、动物品种/生物分类学名（犬种学名 TAIGAN）、严肃机构/组织/政府主体、事务性公司/工具产品等：这些类型不是 BSC meme 币用户玩梗/当符号的对象，作为 meme 币名直接不被接纳。⚠️ 判据=类型/性质不合，不是认知度——实体再著名也不改变类型不可接纳（可乐人人认识，「可乐」当 meme 币名照样不被接纳）；被超级 IP 或大V提到、大众媒体广泛报道同样不改变类型。⚠️ 圈内项目/平台/资产、梗形象、人物等类型可接纳的实体不因「是品牌/公司/资产」降本项；是否新旧不是维度（新实体类型不合照样归本项）。语料已给出明确可接纳性质定义的（如「首款AI警犬」）不属本项（→ accepted，J1.105/C175）',
        wrong_entity: '币名试图指向一个已知实体/概念/作品，但指歪了/指残了——①无背景拼写错误：对已知实体/概念的明显拼写错误且无独立背景故事或文化来源（有文化来源的变体不算，如 doge→dogwifhat 是 meme 文化变体）；②不忠实呈现：音译字/形近字/跨书写系统变体、未官宣的传闻/泄露命名均不构成对已知名称的忠实映射；③版本/功能标注残片：版本/语言/形态/序号等元标注词（日本語版/英文版/完整版/remix 版/version）——映射到的是版本目录里的一行，不是作品/产品实体本身，版本标注残片即便逐字出自高影响力主体的原话也不接纳（C105 日本語版案）。⚠️ 有独立背景故事/文化来源的有意义变形（错版/错印/玩偶/新造型/二创造型/致敬变体/联名，如错版奶龙→哭哭奶龙）不选本项（J1.89/C151）——映射到原 IP 可判 accepted/unacceptable_type，有意义变形本身（新角色/新变体）可判 accepted（J1.113/C184 新旧不是维度）。⚠️ 交易池/计价配置语句（paired to X / X pair / 用 X 币配对交易）是池子配置说明，与币名映射无关，不得据此选本项（J1.98/C162）。⚠️ 本项是拦截位（全域）：试图指实体但指歪的名字无论类别都不该过；与 not_entity（中性、没试图指实体）区分',
        not_entity: '币名不映射任何实体（也未试图指向某个已知名称——试图指但指歪的拼写错误/不忠实呈现/版本残片是 wrong_entity 拦截位）——普通词汇/短语、话中截词、问候语/口头禅等日常用语、陈述句、口号/玩梗词、纯功能词。⚠️ 本项中性：不是「用户不接纳」，是「没有实体可评」——词句形态问题交 bsc_meme_user_phrase_acceptability 题判；⚠️ 名字已被用作特定主体称谓的不属本项（J1.121/C190：社区名/mascot 名/角色名/外号——「XX社区」式专名搭配在场即映射该主体按类型轴评，无论自创与否、无论语料是否陈述命名行为/讲过故事；混混猫=自创社区 mascot 专名不落本项）；⚠️ 语料已陈述命名行为/已讲故事的主体（有明确所指，如 BNB Tree）不属本项（→ accepted，J1.104/C174）',
      },
    },

    // ── 10.6 实体形象性题已删（J1.102/C171）——bsc_meme_user_entity_visuality
    //     （J1.29/C61 立题、J1.81/C139 改名）整轴退役：形象载体=用户偏好轴非
    //     资格轴（用户裁定「有形象接纳度会高，但不是没有形象就不行，一切看情况」）。
    //     形象考量并入 bsc_meme_user_name_entity_acceptance 题面锚句；mapper
    //     entityVisualBlock 门+六豁免整链退役（案史：C61 +4.42 立门后
    //     C88/C109/C118/C138/C139/C159/C160/C161/C167 九连打洞未止；股城
    //     new_entity 0.91、TREE 三桶 0.44 掷骰、Heyi accepted choice 但概率
    //     0.25<0.5 线拦死三型结构卡死）。旧缓存行残留
    //     bsc_meme_user_entity_visuality/name_entity_carrier 键无害（mapper 不再
    //     消费 choice/probabilities）──────────────────────────────────

    // ── 10.8 币名 meme 合格度（J1.37/J1.40/J1.41/J1.42/J1.47/J1.48/J1.50 恒带：
    //     mapper 唯一名字门 notMemeNameBlock 判据源——C96 币安上电视案/C105
    //     日本語版案/C107 收敛/C108 名字门统一：nrBlock·rmBlock·memFloor·
    //     misspelling 探针四拦截位全部并入本题；C114 DND 案加通用梗缩写锚
    //     （DND 合格/CRO 不合格，分界=用户侧感知）；C116 猫案加整句情绪姿态
    //     分界（「只是一只猫」合格/「我要去滑雪」不合格）；J1.50 C119 用户
    //     视角统一：问法收敛「web3 用户能否接纳这个名字作为 meme 币的名字」，
    //     三态键改名 bsc_meme_user_acceptable/bsc_meme_user_not_acceptable/unclear
    //     （mapper NOT_MEME_NAME_CHOICES 收新键+全旧键兼容）；J1.53 C122
    //     题键 name_form → bsc_meme_user_name_acceptability（门名对齐语义，判据不动；
    //     mapper 双键读，旧键=存量缓存行兼容）；J1.69 C130 判定对象收敛为
    //     **链上 Symbol（币名）**——Name 是链上全名/描述句不作本门判据
    //     （돼지 H 案：Name=电影全名被判陈述句拦，币名实为 Symbol）；J1.80 C138
    //     heyi.ai 案超IP来源判据（追加段，原判据零改动）：判断信息
    //     corpus_author_identity 认证行在册 ∧ 名字与主体相关 → 不能接纳标准
    //     提高为极端否证「从 BSC 链 meme 币交易者角度，即使是超级IP即影响力
    //     超大的用户讲的话，也完全当不了符号，完全不适合作为 meme 币，不会
    //     产生购买意愿」——主体代称/官宣事物名（heyi+.ai 概念后缀型）放行；
    //     choice 仍三态，mapper 零改动）──────────
    // ── J1.121（2026-10-24，C190 混混猫案，用户裁定「not_entity 是『不是
    //     实体』，自创社区 mascot 名也是实体名字，不应该因为这个理由拦
    //     截；看的是性质，所以退役了 new_entity 门」）：实体题补**专名即
    //     实体**锚（性质轴延伸）——名字被用作特定主体的称谓/专名（社区名
    //     /mascot 名/角色名/外号，「XX社区」式专名搭配在场）即映射该主体
    //     按类型轴评，无论自创/知名/语料是否陈述命名行为；not_entity 只
    //     留给名字本身不映射任何主体的形状（泛称词无专名搭配+无 C174 命
    //     名故事陈述）。案发=混混猫 0x b10b…7777 官方 recap 以「混混猫社
    //     区」称谓在场却被判 not_entity 0.66 落词句臂拦（C174 故事主体锚
    //     有「命名行为在场」逃逸门救不到称谓使用形状）；mapper 零改动
    // ── J1.120（2026-10-24，C189 全量回归六裁定批）：①C96 币安上电视追裁
    //     「先走实体门，然后走 phrase 门——要不被实体拒绝，要不被口号拒绝」
    //     ——事件陈述句名=口号类落本题按三因素评（J1.118「归实体门域」措辞
    //     修正：实体臂判 not_entity 后**落词句臂**，非中性放行评分层）；②
    //     事件承载臂补**重要度门槛**（用户裁定「如果要走重大事件促生口号这
    //     条路，事件的重要度明显不够」）：民族级/全球级重大事件（航天发射）
    //     才够格，平台级/媒体级露出（上电视/上热搜）不够；③ip_reuse 补
    //     **原生热点锚**（C129 彪弟案「低质复用明显不合适」）：原生热点梗/
    //     人物主体自身代币化=正常叙事参与不选本项，复用=反复换皮/多处收割
    //     （分界=有无新的事件依托）。mapper 同批恢复词句门拦截（C189，见
    //     jev-result-mapper 门链 uaBlock 臂）
    // ── J1.116（2026-10-24，C187 词句题三因素重构，用户裁定）：梗/口号
    //     meme 不同于实体 meme——原题面单判「名字形态可接纳性」，影响力/
    //     感染力维度散落纠缠：J1.66/C126「高影响力主体说的词」当加分臂与
    //     J1.80/C138 超IP极端否证反向放宽=影响力两臂方向打架（一个加分、
    //     一个放宽拦截，皆非门槛）；J1.61 可玩臂与 C116 姿态臂重复判同一
    //     件事。重构为**三因素缺一不可**框架：①有来由（喊梗/口号的主体有
    //     强影响力，或词句本身是已流通的梗——普通用户喊的口号完全无来由，
    //     不能接纳）②有感染力（「you are still early」有感染力、「我要去
    //     滑雪」毫无感染力——按模拟 BSC meme 币用户反应判）③Symbol 形态
    //     可被接纳为 meme 币名字。J1.80 极端否证段+J1.94 官方措辞引用臂
    //     并入①（官方措辞=强影响力主体产出，采信陈述原则保留）；J1.61/
    //     C116/C126 三臂并入①②。**CRO 判例翻案（同日用户裁定「Chief
    //     Risk Officer 是玩梗呢，可以接受」）**：C114「机构职位/品牌内部
    //     缩写不合格」半边退役（工牌自嘲=玩梗），DND 正样本（通用梗缩写）
    //     保留、缩写分界句随之退役。具体事件→实体题路由确认（not_entity
    //     才进本题）。choice 三态键不动，mapper 零改动（C180 后纯观察落
    //     档）─────────────────────────────────────────────
    bsc_meme_user_phrase_acceptability: {
      type: 'choice',
      instructions: `BSC meme 币用户能否接纳这个词句作为 meme 币的名字（token phrase as meme）。本题只评**不映射实体**的名字（实体题 bsc_meme_user_name_entity_acceptance 判 not_entity 的形状）：若事件是一个**非常具体的事件**，币名一般是事件中核心的实体（人物/角色/动物/事物）——那是实体题的域，不经本题；币名只是梗/口号/文化词/句片段/缩写（「谁谁说了一个梗、一个口号」的形状），或主谓重述一件发生的事的**陈述句名**（「币安上电视」型说事句——不是实体映射，属口号类，按本题三因素评）才走本题。另一类是「谁谁强调/提及/陈述了某一个实体」（如 heyi.ai 是个域名、何一发了它）——名字指代了具体实体的（含代称/域名/缩写形态的指代），也先走实体臂按实体评估；实体臂不接受（判 not_entity=不映射实体）才落到本题按词句评，实体臂拦截（unacceptable_type/wrong_entity）不经过本题。
梗/口号 meme 不同于实体 meme：本题**不判词句指向的对象（实体题的事），也不只判 token 名字形态**——要完全从 BSC meme 币用户角度出发，综合考量以下三个因素；本质仍是：BSC 链用户能不能接纳它作为一个 meme 币。**三因素缺一不可，任一不满足 → 不能接纳**：
① **有来由**（喊出/承载这个梗或口号的主体有强影响力，或词句本身是已流通的梗）——梗/口号必须有出处且出处够硬，普通用户喊的口号完全无来由：
  · 对 BSC meme 币用户有特殊影响力的主体本人说出的词句（币安系人物何一/CZ、世界级人物/机构、平台官方渠道、圈内知名人物）——问候、口号/宣言、自创口头禅、简短情绪表达都算；
  · 语料陈述某词句是超级IP/平台官方渠道的**官方措辞/口号/命名**（如「币安官方称之为智能时代」）——采信该陈述、不要求验证来源，第三方转述号也视为官方产出；
  · 词句承载自**影响力巨大或情感触动极强的事件本身**——口号/宣言就在事件中、是事件的组成部分（如中国航天发射，箭体上拼出「中国人能飞」五个大字：事件本身承载了这个口号，民族自豪/情感触动极强，无需谁单独喊出也有来由）→ 有来由。⚠️ 本臂有事件重要度门槛：**民族级/全球级的重大事件**（航天发射/国家级胜利时刻）才够格；平台级/媒体级的露出事件（上电视/上热搜/上了新闻/平台公告）重要度不够，不构成来由（对照：中国人能飞的箭体五大字=民族级；「币安上电视」=媒体级露出，喊出者还非币安本人 → 无来由）；
  · 词句本身是圈内文化词/黑话（Early=圈内「趁早」深意、FOMO、LFG）、通用网络梗/文化缩写（DND=do not disturb），或承接流通梗的姿态句式（「只是一只猫」=just a chill guy 同款自嘲降格句）——梗本身在用户侧已有流通感知；
  · ⚠️ **普通用户（无强影响力的主体）喊出的梗/口号/宣言 → 完全无来由，不能接纳**——用户对普通人的一句话没有感知，接不住当 meme 币名字（对照：CZ 说 "you got in early" → 「Early」有来由；同样的话若是无名用户喊的则无来由）。
② **有感染力**（词句本身携带可传播的姿态/情绪/玩梗空间）——「you are still early」有感染力，「我要去滑雪」毫无感染力：
  · 判断方式=模拟 BSC meme 币用户看到这个词句的反应：他们会不会拿这句话去玩梗、二创、传播（不套词表/固定句式，按反应判）；
  · 有感染力：承载 meme 情绪姿态（自嘲/躺平/宣言/降格反差），或词句承载的内容有可玩/可二创的空间（梗/名场面/设定）；
  · 主体本人说出的问候/口头禅/简短情绪表达（①已过门的形态）按同一模拟反应判：BSC meme 币玩家会把它当**该主体的符号**拿来玩、传播（C126 何一「こんにちは」——问候语本身成了她的口头禅梗，玩家接得住）→ 有感染力；玩家不会拿去玩的普通寒暄/事务性回应 → 无感染力。
  · 无感染力：无姿态的生活陈述（「我要去滑雪」「滑雪」「我要去」）、日常礼貌套话、纯事务性表达/功能词——哪怕出自强影响力主体，用户也不会拿去玩，同样不能接纳。
③ **名字形态可被接纳为 meme 币名字**——仅就链上 Symbol（币名/ticker；去 emoji/数字/特殊字符后；链上 Name 是全名/描述句不作判据）本身判断：用户侧对它有没有感知、能否被记住、被抓住当一个符号去玩梗/传播。
划界（不在本题的形状）：实体票不在本题（类型不可接纳→unacceptable_type 轴、认知度→实体题轴，J1.113/C184）；版本词/拼写错/不忠实呈现不在本题（→实体题 wrong_entity 轴全域拦）；实体本身认不认得/有没有影响力由实体题判（J1.57），本题只判「词句本身」。事件陈述句名（币名主谓重述一件发生的事，如「币安上电视」「XX 破产了」）**不是实体映射（实体题判 not_entity），属口号类落本题按三因素评**（C189 裁定「先走实体门，然后走 phrase 门——要不被实体拒绝，要不被口号拒绝」）：①看事件承载臂重要度门槛（民族级/全球级才够）+陈述出自谁之口，够不上 → 无来由 → 不能接纳。词句核心是梗、其他词只是修饰（「XX 完整版」核心是 XX）→ 看 XX 的三因素；缺陷形态在中心语位置才拦。
对照锚：CZ 说 "you got in early" → 「Early」能接纳（①强影响力主体+②趁早感染力+③符号感知）；无名用户发「我要去滑雪」→ 不能接纳（①无来由+②无感染力）；币安发推「DND 😾」配猫拉窗帘视频 → 「DND」能接纳（①官方主体+通用梗缩写流通、②可配梗玩）；AI 猫经济热点里「只是一只猫」→ 能接纳（①承接 chill guy 流通梗姿态、②自嘲姿态、③符号感）；「币安上电视」→ 不能接纳（陈述句口号类：①上电视=媒体级露出够不上事件承载臂门槛、且非币安本人喊出——无来由）。分界=用户侧感知与反应，不是词出自谁、也不是是否截自语料。`,
      criteria: {
        bsc_meme_user_acceptable: '能接纳——三因素齐备：①有来由（强影响力主体本人说出/官方措辞采信陈述/词句本身是圈内文化词·通用梗缩写·流通梗姿态句——普通用户喊的口号无来由不算）②有感染力（meme 情绪姿态/可玩可二创——按模拟 BSC meme 币用户反应判；无姿态生活陈述哪怕强影响力主体说的也不算）③Symbol 形态用户侧有感知、抓得住当符号',
        bsc_meme_user_not_acceptable: '不能接纳——三因素任一缺失即拦（一切从用户角度出发，以下只是典型佐证形态）：①无来由（普通用户喊的梗/口号/宣言——用户对普通人的话没有感知）②无感染力（无姿态生活陈述「我要去滑雪」/礼貌套话/纯事务性表达/功能词）③名字形态当不了符号；实体票（类型不合/无认知）不在本条（实体题 unacceptable_type 轴，J1.113/C184）、版本词/拼写错不在本条（实体题 wrong_entity 轴全域拦）',
        unclear: '无法判断——BSC meme 币用户能否接纳这个名字作为 meme 符号无法判定',
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

    // ── 10. 品牌劫持条件题已删（J1.85/C143）；brand_mismatch 桶亦删
    //     （J1.103/C172 品牌劫持轴整体退役——判据归 bsc_meme_user_name_event_acceptance
    //     用户视角，keyword 预检/门/豁免全链随死）──

    // ── 10.8 配图对名字的演绎关系（C118 条件题，仅 imageConsistency（语料含
    //     【图片内容分析】块）时问）。J1.102/C171 消费链迁移：原挂载体门图证豁免
    //     演绎臂，载体门随轴退役后**保留并改挂 J1.30 imgNameExempt 关联豁免第二
    //     臂**（用户裁定「演绎关系是事/币关联的一个维度」——配图在演绎名字含义
    //     =币名↔叙事的关联证据，与主体有无形象正交）。J1.29 消费注释全部随门
    //     退役清理。C186（2026-10-24 ATM 案）：对照锚补「同域非演绎」第四锚——
    //     名字 ATM 配银行吉祥物/数字人民币 IP 图判 decorative（图与名字同在金融
    //     域但未画面化 ATM 含义、演的是数字人民币吉祥物——域联想≠演绎），分界
    //     句尾同步；J1.114→J1.115 ─────────────────────────────────────────
    ...(imageConsistency ? {
      image_depicts_name: {
        type: 'choice',
        instructions: `配图对名字的演绎关系（image depicts name）。上一题（name_image_consistency）问的是名字与配图主体是否同一/同类实体；本题问的是：配图是否在【演绎/诠释/画面化】名字本身的含义——名字说的那个意思，图把它演出来了吗。
⚠️ 概念名/抽象名重点：名字不是实体词时（缩写/概念/口号/短句），看配图是不是该含义的画面化演绎——图中的动作/场景/形象正是名字含义的具象表演（不是随便配图）。
⚠️ 对照锚：币安发推「DND 😾」配猫拉窗帘视频 → depicts_name（do not disturb=别打扰，猫拉上窗帘正是「别打扰」的画面演绎——名字含义被图演出来了，上一题判 unrelated 不影响本题）；名字 CRO 配一张猫图 → decorative（Chief Risk Officer 与猫图无演绎关系，纯装饰配图）；名字 ATM 配银行吉祥物/数字人民币 IP 图 → decorative（图与名字同在金融域，但图没有画面化 ATM（自动取款）的含义、演的是数字人民币吉祥物——同域/同话题联想不等于演绎）；名字「香蕉」配一张真香蕉图 → 上一题已 same_entity，本题按含义是否被演绎判（真香蕉就是香蕉本身，无「演绎」关系 → decorative）。
⚠️ 分界=图与名字【含义】的演绎关系，不是图与名字【所指实体】的对应（那是上一题）——两题答案独立，unrelated 与 depicts_name 可以同票共存；同域联想（图与名字恰好同属一个领域/话题但名字含义本身未被画面化演出）判 decorative。`,
        criteria: {
          depicts_name: '配图演绎名字——图中的动作/场景/形象/文字正是名字含义的画面化诠释（猫拉上窗帘=DND「别打扰」的演绎；名字 LFG 配冲线/起飞画面；名字「拉窗帘」配拉窗帘动作）',
          decorative: '无演绎关系——配图只是装饰/氛围/通用背景/表情包/顺手配图，与名字含义无诠释关系（名字 CRO 配猫图；通用梗图；纯风景）',
          unclear: '无法判断——图与名字含义的关系无法判定',
        },
      },
    } : {}),

    // ── 10.9 配图载体性质题已删（J1.102/C171）——image_carrier_nature（J1.100/
    //     C167 立题）唯一消费点=载体图证豁免第四臂 carrierNature==='carrier_visual'
    //     fail-closed，载体门随轴整体退役后无消费，题随之删除。旧缓存行残留键无害

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
