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
 */

export const JEV_QUESTIONS_VERSION = 'J1.3';

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

    // ── 1. 事件分类（原 Stage1，8 类 + 边界规则）──────────────────────
    event_category: {
      type: 'choice',
      instructions: `事件分类（event classification）。判断这条推文/内容构成的事件属于哪一类，只选一个最佳类别。
边界规则：
- 优先级（同时符合多类时）：A > W > B > F > G > C > D > E
- E=正在流行的热点内容；F=新发现的规律/模式（有证据）
- F=有证据支撑的发现；G=无充分证据的推测/预测
- C=个人账号的言论；D=机构/公司官方账号的动作
- 找角度/借势推文（angle-seeking）：事件主体是被借势的原始事件，不是发推人自己
- 解读型回复（interpretive reply）：事件主体是被解读的原始消息的发布者，不是回复者`,
      criteria: {
        A: '形象化IP：meme角色/形象/吉祥物/虚拟形象/卡通IP/表情包形象',
        W: 'Web3项目：区块链/加密项目发布（代币/DeFi/NFT/公链/工具/协议）',
        B: '非Web3产品：非Web3产品发布/更新（App/游戏/硬件/网站/消费产品）',
        F: '发现型：发现隐藏模式/规律/数据洞察/叙事发现（有证据支撑）',
        G: '推测型：对未来事件的预测/猜想（有推理但无充分证据）',
        C: '人物言论：个人（非机构官方身份）的声明/言论/动作',
        D: '机构动作：机构/公司官方账号的公告/动作',
        E: '社会热点：社交媒体正在流行的趋势/病毒式内容/热点事件',
      },
    },

    // ── 2. 事件主体量级（原 Stage2 维度一，6 档有序）──────────────────
    event_magnitude: {
      type: 'score',
      instructions: `事件主体量级（原各类Stage2维度一分量等级），从低到高评估。
⚠️ 主体判定规则（最重要）：主体=事件本身的核心实体，不一定是发推人。
- 推文报道/搬运/讨论外部热点（某视频在抖音爆火、某事件上微博热搜、某大新闻）→ 主体=该热点事件的主角/发起方，按热点的传播规模定档，发推人只是信息搬运者，其粉丝数不代表事件量级
- 推文是作者自己的内容/作品/声明 → 主体=作者（此时才看发推人粉丝数/认证）
- 找角度/解读型推文：量级针对被借势/被解读的原始事件主体，不是发推人
量级含义按事件类别（分类见event_category题）：
- A类（形象化IP）=IP/形象的知名度；B类（非Web3产品）=发布方地位+产品影响力；C/D类=人物/机构影响力；E类（社会热点）=热点传播量级；W类不适用本题
E类无量化数据时的升级规则（仅有定性描述时）：
- 强热度词（爆火/热搜/疯传/大爆/持续发酵）/主流平台持续有新内容/跨语言地域传播/用户自发二创模仿/被KOL大V主动报道——任意2项→至少B档；仅1项→C档；0项→D档以下
B类第三方限制：发布方是第三方小号（非产品官方）且影响力低→最高C档，除非第三方本身是世界级/知名机构人物`,
      criteria: [
        'E档：完全无热度/无价值——无名主体、无传播、无独特性（各类阻断档）',
        'D档：小主体——粉丝<1万普通创作者/小型不知名媒体/无特色产品/地区性本地事件（各类阻断档）',
        'C档：一般主体——粉丝<4万的普通KOL/第三方小号/普通个人创作/社区级讨论（十万级传播）/小项目（语料中找不到主体影响力证据时最高到此档）',
        'B档：知名主体——粉丝>4万的KOL或知名个人/知名中小IP/普通公司有特点产品/平台级热点爆款（百万级传播：播放100万+或点赞50万+）/中型机构',
        'A档：头部主体——知名大IP/知名公司或行业影响力产品/全国级人物或大型机构/全国级热点（千万级传播/全国热搜）',
        'S档：世界级——全球性IP/世界级公司或颠覆性产品/世界级名人/顶级机构（币安/OpenAI级）/全球热点（亿级传播/全球热搜）',
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

    // ── 4. 维度二：传播力加分（原各类 Stage2 第二维度，0-30）─────────
    dimension2: {
      type: 'score',
      instructions: `事件第二维度加分（原各类Stage2维度二，0-30分），含义按事件类别：
- A类（形象化IP）=IP方权重：世界级IP 30/知名IP 20-25/KOL>4万粉 18-22/普通KOL 12-17/普通创作者 8-11/新账号 5-8；自创IP上限：创作者粉丝<1万→最高11分、1-10万→最高17分、≥10万或认证→无上限
- B类（非Web3产品）=发布方权重（基于发布方本身的影响力，不是内容涉及的名人）：世界级公司25-30/知名机构约22/知名个人约20/普通团队8-15/小号约8
- C/D类=人物/机构传播与职务权重
- E类（社会热点）=传播与meme元素权重：强二创模仿文化/全网热议25-30、多级扩散15-24、有限讨论5-14
- W类不适用本题（W类独立计分）
⚠️ 传播力归属规则：看事件本身在其源头平台的传播（热点视频/热搜的播放量、讨论度、出圈程度、二创情况），不是发推人账号的互动数据；推文描述的"爆火/热搜/疯传"即为传播证据，直接采信不质疑`,
      criteria: [
        '0-4分：无传播——零互动/无扩散/无名主体',
        '5-9分：微弱——普通创作者/小号/极小范围传播',
        '10-14分：小范围——普通KOL/小圈子内传播/有限讨论',
        '15-19分：中等——知名KOL/中等传播/有一定讨论度和跟风',
        '20-24分：较强——知名IP/大V/多级转发扩散/持续发酵',
        '25-30分：极强——世界级IP/全民话题/病毒式传播/大规模二创',
      ],
    },

    // ── 5. 硬阻断（原各类 Stage2 阻断条件合集，10 选项）───────────────
    block_reason: {
      type: 'choice',
      instructions: `硬阻断检查（hard-block check）。该事件是否命中任一硬阻断条件？未命中选 none。
阻断=事件本身无叙事价值/无传播潜力，无论分数多高都不能通过。`,
      criteria: {
        none: '无阻断——事件有明确主体和内容，有叙事价值',
        subject_unqualified: '主体资格不足——事件主体（注意：是事件本身的核心实体，报道外部热点的推文其主体是热点主角而非发推人）粉丝<1万且无认证且非知名IP',
        niche_subculture: '小圈子亚文化——圈内梗/黑话，圈外人无法理解，无出圈可能',
        empty_content: '空洞内容——纯问候/感叹/日常闲聊，无具体事件或设定',
        institution_routine: '机构日常运营——机构日常发推/回复/转发，非重大事件',
        low_quality_derivative: '低质衍生——对现有IP/热点的简单替换/拼贴/抄袭/模仿',
        marketing_gimmick: '营销噱头——纯营销包装/标题党/蹭热度无实质内容',
        baseless_speculation: '无据猜测——预测没有任何推理依据支撑',
        ip_reuse: 'IP二次利用——直接使用现有知名IP但活动无重大传播力（活动有重大传播力则不算）',
        regional_event: '地区性事件——仅特定地区有感知，无更大范围影响',
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
