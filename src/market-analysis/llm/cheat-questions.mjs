/**
 * Jev 作弊盘检测问题集（CD1 立项，2026-10-30 用户裁定）
 *
 * 对象：买点同步式盘面健康检测（CheatCheckService，交易侧 CJS 经 dynamic import
 * 消费）。输入不是叙事语料而是 wss_price_ticks 重建的盘面快照（CheatSnapshot →
 * 纯文本 state，代码端 [PRECOMPUTED] 段已定事实 + 逐笔 tick 时序 + 钱包聚合）。
 *
 * 用户三分类语义（2026-10-30 裁定原话）：「作弊盘 / 不健康盘 / 健康盘。其中不
 * 健康盘跟健康盘可以相互转化，买点不同，性质可能会有差异。」——判定对象是
 * 「截至锚时点的盘面状态」而非 token 终身属性；cheat=协同资金主导的既成事实
 * （不可逆），unhealthy/healthy=时点状态（可转化）。
 *
 * 动机：作弊行为多变且与正常用户行为糅杂，规则门（sybil/bundle/evenCluster）
 * 拦截时要么误伤正常票、要么作弊票因瞬时条件通过而买到最高点（ZERODAY
 * 0x23f1c4af…7777 案：27 钱包分仓 4 分钟对倒、dev 抢跑 6s 自卖、top1 集中度
 * 仅 7.4% 全绕现有门）——综合判别交给 Jev 深度思考。
 *
 * 版本：改动任何一题的 instructions/criteria 后必须 bump CHEAT_QUESTIONS_VERSION
 * D3.1（2026-10-31 用户裁定：题集瘦身——「把零分离度的锚删除（没关系，之后我们
 *   会继续增加）；删 retail 题」）。D3.0 55 票重放归因：Jev 判**具体可核查事实**
 *   的题 strong 档零误报（creator 抢跑 8:0:0 / 等额强规整 10:0:0 / 协同卖回强
 *   6:1:0），**眼估流量份额**的题全面饱和（配额梯 55 票全过 moderate、同块簇
 *   moderate 是三类众数、二次承接 cheat 反而最高）→ 零分离四题退役：
 *   same_block_buy_burst / quota_ladder_heat / second_wave_absorption /
 *   strong_hand_real_buy（无规则消费点）；retail_participation 退役（三类中位
 *   1.3/1.5/1.6、q75 全 <2.2 无区分度——用户裁定「Jev 无法通过简单规则判断是否
 *   散户」）。买侧结构量化改代码侧：snapshot 新增 sameBlockHoldPct /
 *   equalBandHoldPct 持仓占比锚进 [PRECOMPUTED]，mapper 直接消费锚数值过门
 *   （Jev 不再眼估占比）。存续 4 题=equal_amount_split / coordinated_sell_back /
 *   creator_front_run / sell_dispersion。规则改动零配额重放=scripts/cheat-detection/
 *   replay.mjs（对存档 answersRaw 重跑 mapper）。
 * D3.0（2026-10-31 用户裁定：架构重设「现象锚观测 + 代码综合」分层）：8 现象
 *   Choice 四档题替代 Q1 端到端三分类——Jev 只判现象有无与程度，verdict 由 mapper
 *   综合规则导出。首跑 27/55（cheat 召回 27/27 但非 cheat 28 票全误判 cheat），
 *   现象级归因见上。
 * D2.2（2026-10-31 用户裁定：题面语言换中文）：51.9% 不掉点，中文定型。
 * D2.1（撤簇预列/去 [GMGN] 标记/路由机制陈述）；D2.0（48.1% 纯 prompt 到顶）；
 * D1.1（首版 3 题）。
 */

export const CHEAT_QUESTIONS_VERSION = 'D3.1';

/** 现象程度四桶（题面与 mapper LEVELS 序必须一致——mapper 按档位序消费） */
export const PHENOMENON_LEVELS = ['none', 'weak', 'moderate', 'strong'];

/** 逐现象题共用程度分档锚句（Choice criteria；「程度」按该现象解释的流量份额与清晰度判） */
const LEVEL_CRITERIA = {
  none: '该现象不存在：窗口内找不到此形状，或只有孤立的偶然一两笔（可忽略的背景噪声）',
  weak: '弱在场：形状可见但零星孤立、解释的流量份额很小，单看不足以支持任何结论',
  moderate: '明显在场：形状清晰反复出现，解释了可观份额的可疑流量，构成实质证据项',
  strong: '主导性：该形状解释了窗口内可疑资金流的主要部分，节奏/金额/参与者高度规整，是盘面的决定性结构',
};

/**
 * 构建作弊盘检测问题集（D3.1 瘦身形状：4 现象题）
 *
 * 每题=定义 + 从哪段材料看 + 程度分档；**只判现象不判性质**——盘面三分类由
 * mapper 综合规则导出（题面绝不预告各现象对应什么 verdict，防答题被结论锚定）。
 * 买侧簇结构（同块/近等额占比）由 [PRECOMPUTED] 锚量化，程度题可作参照。
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildCheatQuestions() {
  return {

    // 1. 等额/近等额分仓（strong 档零误报：D3.0 实测 10:0:0）
    equal_amount_split: {
      type: 'choice',
      instructions: `观察「等额分仓」现象：精确相等或近等额的买入金额分散在多个不同钱包。
在 [TICKS]/[WALLETS] 中自行扫金额带：精确等额（如 0.3300×4）与近等额带（如 0.3301/0.3298/0.3302——刻意躲精确等额分组）都要扫；[PRECOMPUTED] 的「近等额簇持仓占比」已量化带内（±2%、≥3 钱包）结构的持仓份额，可作程度参照（注意整数额买单在健康票上也会自然聚带——「占比与规整度」比「有没有」重要）；非 BNB 计价盘的换算金额只是近似值（见 [TOKEN] 注记）。
只描述现象程度，不下任何盘面结论。`,
      criteria: LEVEL_CRITERIA,
    },

    // 2. 买簇→集中同步卖回配对（strong 档近零误报：6:1:0；moderate 档健康票也常见
    //    早期获利盘同卖，故 moderate 需 mapper 侧卖分散反证联判）
    coordinated_sell_back: {
      type: 'choice',
      instructions: `观察「协同卖回」现象：曾经同步/协同买入的一簇钱包，随后在集中同步的卖出波中卖回——数笔卖单挤进相同区块或极短时间窗，收割他们自己制造的拉升。
在 [TICKS]/[WALLETS] 中自行配对：找出买入节奏协同的钱包簇（同块/等额/时间耦合），检查其成员后续是否出现在集中同步的卖波里。关键鉴别：**买了并且仍持有的钱包不构成此现象**——只有「一起买→一起卖回」的闭环配对才算；卖出分散、各自择时的不算。
只描述现象程度，不下任何盘面结论。`,
      criteria: LEVEL_CRITERIA,
    },

    // 3. creator 抢跑/自卖（strong 档零误报：8:0:0）
    creator_front_run: {
      type: 'choice',
      instructions: `观察「creator 抢跑/自卖」现象：代币创建者（[WALLETS] 中标 [CREATOR]/isCreator 的钱包）抢跑自己的启动——t≈0 买入后数秒内卖出；或把大量配额倾倒进拉升段。
程度校准基准：creator 在启动时买入有分量的仓位、此后**分批卖出一部分**是常态（弱或无）；秒级抢跑自卖、连卖、或全额配额倾倒是该现象的强形态。
只描述现象程度，不下任何盘面结论。`,
      criteria: LEVEL_CRITERIA,
    },

    // 4. 卖出分散度（健康轴最佳信号：moderate 档 healthy 69% vs cheat 22%）
    sell_dispersion: {
      type: 'choice',
      instructions: `观察「卖出分散度」现象：卖出行为分散在许多互不相关的钱包、各自独立择时——与「集中同步卖波」（少数钱包在相同块/极短窗内一起卖）相反的两极。
在 [TICKS]/[WALLETS] 中自行统计卖方的钱包数、卖出时点分布、以及是否存在同步卖波。注意：此现象与「协同卖回」是同一枚硬币的两面——卖出越分散、越各自择时，本现象越强。
只描述现象程度，不下任何盘面结论。`,
      criteria: LEVEL_CRITERIA,
    },
  };
}
