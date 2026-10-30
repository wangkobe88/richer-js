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
 * D1.1：首版（2026-10-30），3 题小体量（照 prestage 形状）：Q1 三分类+证据不足
 *   四桶 / Q2 cheat 模式细分（仅 cheat 域消费）/ Q3 真实散户参与度 Score。
 *   mapper 端概率门（cheat 桶 P≥0.5）+ runner-up 规则 + 桶名→列值映射表
 *   （unclear_insufficient→'unclear'）
 */

export const CHEAT_QUESTIONS_VERSION = 'D1.1';

/**
 * 构建作弊盘检测问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildCheatQuestions() {
  return {

    // ── 1. 盘面健康三分类（主判定题；时点语义——判定截至锚时点的状态）──
    market_health_verdict: {
      type: 'choice',
      instructions: `Judge the HEALTH of this token's market at the ANCHOR point in time given below. The [PRECOMPUTED] statistics and [TICKS]/[WALLETS] sections are ground truth — trust them as computed facts; your job is the JUDGMENT those facts cannot encode: is the dominant flow of liquidity organic, or coordinated?

The verdict you give is about the market STATE AT THE ANCHOR (the first N ticks), not the token's whole life. The three classes:
- cheat: the dominant liquidity comes from coordinated/controlled funds. Signatures (in combination, no single one is sufficient): creator front-running its own launch then dumping within seconds; many wallets buying in the same block in a synchronized rhythm; exact-equal buy amounts split across wallets (position-splitting to dodge concentration gates); seconds-scale buy→sell churn that manufactures volume and pumps the price; a tight cluster of wallets that buys together and dumps together while genuine retail is only exit liquidity. Coordinated funds may DISGUISE as many small independent wallets — look through per-wallet aggregates to the rhythm (timing correlation, amount correlation, block correlation), not just wallet count. Mixed with genuine retail does NOT make it clean: judge by who DOMINATES the flow.
- unhealthy: NOT coordinated cheating, but the market is out of balance AT THIS MOMENT — e.g. late-stage pump (price far above the recent base on shrinking buy flow), buy flow exhausted with pure sell pressure, one or two large healthy-looking holders starting to dump on every uptick, churn/overheat far beyond what organic interest supports. This is a POINT-IN-TIME state: the same token can be healthy earlier or later — judge only the window up to the anchor.
- healthy: organic structure — inflow from many unrelated wallets at varied sizes and times, selling distributed and explainable (profit-taking, not synchronized dumps), price supported by real two-way flow.
- unclear_insufficient: ticks are too few, evidence is self-contradictory, or the window does not distinguish the classes — say so instead of guessing.

When the evidence is genuinely ambiguous between cheat and unhealthy, prefer unhealthy (coordinated-control is the harder claim). When ambiguous between unhealthy and healthy, prefer the class the DOMINANT FLOW supports.`,
      criteria: {
        cheat: 'Dominant liquidity is coordinated/controlled funds: synchronized same-block clusters, equal-amount splits, seconds-scale churn, creator self-trading, or buy-together-dump-together clusters that retail merely exit-provides for — possibly mixed with genuine retail but dominated by the coordinated side',
        unhealthy: 'Not coordinated cheating, but the market at this anchor is out of balance: late-stage pump on shrinking inflow, exhausted buy flow under pure sell pressure, large holders dumping on strength, or churn/overheat beyond organic support — a point-in-time state that can convert to healthy later',
        healthy: 'Organic structure at this anchor: many unrelated wallets at varied sizes/times, distributed explainable selling, price supported by real two-way flow',
        unclear_insufficient: 'Too few ticks, self-contradictory evidence, or the window cannot distinguish the classes',
      },
    },

    // ── 2. 作弊模式细分（仅 verdict=cheat 时由 mapper 消费；单选主导模式）──
    cheat_pattern: {
      type: 'choice',
      instructions: `The DOMINANT coordination pattern in this market window (answer even if you judged healthy/unhealthy — the mapper only consumes it for cheat verdicts; pick none_apparent when no coordination pattern is visible).
Judge by which pattern explains the largest share of the suspicious flow:
- dev_self_trade: the token creator is itself the dominant early buyer/dumper (front-run own launch, buy at t≈0 then sell within seconds).
- same_block_burst: the signature is many buys packed into the same blocks in a repeated rhythm (see [PRECOMPUTED] same-block clusters).
- equal_amount_split: the signature is exact-equal buy amounts spread across distinct wallets (see [PRECOMPUTED] equal-amount clusters; note quote-converted amounts are approximate on non-BNB quoted pools).
- rapid_churn: the signature is seconds-scale buy→sell reversal churn — wallets whose entire lifecycle inside the window is buy-then-immediately-sell (see [PRECOMPUTED] churn stats and per-wallet lines).
- wash_pump: the signature is fabricated volume/price pumping — self-dealing trades that lift the price with no real intent to hold, typically producing the price arc shown (pump then collapse at the anchor).
- none_apparent: no coordination pattern is visible in this window.`,
      criteria: {
        dev_self_trade: 'Creator front-run / self-trading dominates: the creator wallet (marked isCreator in [WALLETS]) is the dominant early buyer and dumps within seconds',
        same_block_burst: 'Synchronized same-block buy clusters dominate the suspicious flow (repeated multi-buy blocks in rhythm)',
        equal_amount_split: 'Exact-equal amounts split across distinct wallets dominate (position-splitting to dodge concentration gates)',
        rapid_churn: 'Seconds-scale buy→sell churn dominates: many wallets whose whole lifecycle is buy-then-immediately-sell',
        wash_pump: 'Self-dealing volume/price fabrication dominates: pump-and-collapse arc with no real holding intent',
        none_apparent: 'No coordination pattern visible in this window',
      },
    },

    // ── 3. 真实散户参与度（0-10 Score；「作弊与正常糅杂」判别轴）──
    retail_participation: {
      type: 'score',
      instructions: `How much of this market window's flow is GENUINE RETAIL participation — independent wallets acting on their own interest, not the coordinated side and not exit-liquidity chasers? 0-10 分。
Unresolved-sender ticks noted in [PRECOMPUTED] are an evidence hole — discount accordingly rather than guessing generously. Wallets that buy AFTER the pump has clearly started and get dumped on are exit-liquidity chasers, not healthy retail participation, but they are still genuine (uncorrelated) humans — score them as weak retail, not as coordinated.`,
      criteria: [
        '0-1分：几乎没有真实散户——全部或近乎全部流量来自协同/受控一侧',
        '2-3分：真实散户痕迹很少——零星独立钱包夹杂在主导性协同流量中',
        '4-5分：真实散户与协同流量并存，散户是明显次要一侧',
        '6-7分：真实散户占可观份额，与协同/大户流量大致平衡',
        '8-9分：真实散户为主导——独立钱包多源多样，协同痕迹微弱',
        '10分：几乎纯真实散户——协同流量可忽略',
      ],
    },
  };
}
