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
 * D2.1（2026-10-31 用户三条裁定）：①[PRECOMPUTED] 撤同块簇/等额簇预列——结构指纹
 *   由 Jev 自己从 [TICKS]/[WALLETS] 归纳（预列=把指纹喂到嘴边强化指纹偏置，
 *   same_block_burst 33/55 误判根源）②tick 行 [GMGN] 标记去除（反噬——健康票
 *   GMGN 占比反而更高）③补聚合路由机制陈述且明确「走路由≠真人」（bot 同样走
 *   路由）——Q3 原「router 行=独立真人」表述废止。state-builder 同步修订。
 * D2.0（2026-10-30）：基线 51 票逐票人工 review（50/51 裁定：cheat 26/unhealthy
 *   12/healthy 16）反哺的判据重写——D1.1 全票判 cheat 零区分度，偏置根源=同块簇/
 *   等额带等局部指纹在正常票上常态在场（跨票常驻蜂群播种）。Q1 重构为三段判据：
 *   ①主证据=买簇→同块集中卖回波配对（买了拿着≠作弊）/配额梯假热度（砸盘缺失≠
 *   排除）/强庄真实推升未收割≠cheat（归 unhealthy）②第二轴=散户参与定 cheat 与
 *   其余的分界（启动簇之后无新面孔无承接=cheat）③背景噪声声明=指纹是加权项非
 *   verdict（近等额带躲检测/creator 部分卖=常态/纯卖配额低活跃盘弱证据）。Q2 加
 *   quota_ladder / slow_coordinated_accumulation 两桶（CD33/CD44 盲区形状）。Q3
 *   收紧散户定义（班底簇成员/纯卖配额者不计；二次承接+新面孔持续=强证据）。
 * D1.1：首版（2026-10-30），3 题小体量（照 prestage 形状）：Q1 三分类+证据不足
 *   四桶 / Q2 cheat 模式细分（仅 cheat 域消费）/ Q3 真实散户参与度 Score。
 *   mapper 端概率门（cheat 桶 P≥0.5）+ runner-up 规则 + 桶名→列值映射表
 *   （unclear_insufficient→'unclear'）
 */

export const CHEAT_QUESTIONS_VERSION = 'D2.1';

/**
 * 构建作弊盘检测问题集
 * @returns {Object} questions {id: {type, instructions, criteria}}
 */
export function buildCheatQuestions() {
  return {

    // ── 1. 盘面健康三分类（主判定题；时点语义——判定截至锚时点的状态）──
    market_health_verdict: {
      type: 'choice',
      instructions: `Judge the HEALTH of this token's market at the ANCHOR point in time given below. The [PRECOMPUTED] statistics and [TICKS]/[WALLETS] sections are ground truth — trust them as computed facts; your job is the JUDGMENT those facts cannot encode: who dominates the flow, is their behavior coordinated, and does genuine participation carry real weight.

The verdict you give is about the market STATE AT THE ANCHOR (the first N ticks), not the token's whole life.

PRIMARY EVIDENCE — what the dominant buyers DO with their position:
- The strongest cheat signature is BUY-TOGETHER → SELL-BACK-TOGETHER pairing: a cluster of wallets buys in a synchronized rhythm (same blocks, equal or near-equal amounts), then sells back in a concentrated synchronized wave (several sells packed into the same blocks shortly after), harvesting the ramp they manufactured. Check whether the big early buyers are still HOLDING or already dumped together — wallets that bought and are still holding are NOT this signature.
- A dump is NOT required for cheat: quota-ladder fake heat — controlled wallets relay-buying in graded amounts to manufacture momentum, one-directional buy/sell imbalance, no genuine new-blood inflow behind the ramp — is cheat even before any dump arrives. Test: mentally strip the suspected-coordinated wallets; would the remaining flow alone support this price action?
- A single large player (or a small set) GENUINELY buying big and pushing price with real capital — not split into many synchronized wallets, not yet dumping in waves — is NOT cheat. That is a strong-hand market: unhealthy (dominated, one-sided, not safe to enter), or healthy if genuine retail participates broadly.
- The creator buying a meaningful stake at launch and selling PART of it over time is normal. The creator front-running its own launch and selling within seconds, or dumping its whole quota into the ramp, is not.

SECOND AXIS — genuine retail participation (this decides cheat-vs-the-rest more than any fingerprint):
- Ask whether uncorrelated new participants exist BEYOND the launch cluster: new faces arriving at varied sizes/times after t+0, follow-on buying that absorbs early sellers' exits (second-wave absorption), selling distributed across many unrelated wallets at varied times.
- A coordinated buy-side with ZERO natural continuation — no new wallets after the initial burst, no absorption, only exit-chasers — is cheat even if a few bag-holders drifted in.
- Real continuous retail does not clean a coordinated ramp (who DOMINATES still decides cheat), but it moves a strong-hand market away from cheat toward unhealthy, and a broad-based one to healthy.

BACKGROUND NOISE — fingerprints are weights, not verdicts:
- Compute the structural fingerprints YOURSELF from the raw [TICKS] and [WALLETS] sections — same-block groupings, exact- and near-equal amount bands, synchronized sell-back waves, wallet lifecycle pairings. [PRECOMPUTED] deliberately does NOT pre-list clusters; deriving them from the raw flow is part of your task.
- Same-block bursts, exact-equal clusters, twin/triplet buys and sybil-looking wallet bands ALSO appear on healthy tokens (organized crews seed many launches with the same roster; their presence alone proves nothing about THIS market).
- Near-equal amounts (e.g. 0.3301/0.3298/0.3302) evade exact-equality grouping — scan for near-equal bands, not just exact ones.
- High aggregator-router share (see [PRECOMPUTED]) is evidence in NEITHER direction: genuine humans and automated bots both route through it — do not read it as organic, nor as fake.
- Sell-only wallets with no buys (dev/airdrop quota dumping): in an otherwise low-activity market this alone is weak evidence; combined with an orchestrated buy-side it completes the cheat picture.
- Low activity by itself (few ticks, slow pace, small volume, clean structure) is unhealthy (not participable), not cheat.

The four classes:
- cheat: dominant liquidity is coordinated/controlled funds — buy-cluster→synchronized-sell-back pairing, quota-ladder fake heat, split-wallet orchestration, creator front-run/self-trade. Mixed with genuine retail does NOT make it clean; judge by who DOMINATES.
- unhealthy: NOT coordinated cheating, but not a healthy entry at this anchor — strong-hand/whale real buying dominating one-sidedly, low-activity shell, late-stage pump on shrinking inflow, buy flow exhausted under sell pressure, churn beyond organic support. Point-in-time; can convert.
- healthy: organic structure — genuine retail participation carries meaningful weight; inflow from many unrelated wallets at varied sizes/times; selling distributed and explainable; second-wave absorption present; two-way flow supports price.
- unclear_insufficient: ticks too few, evidence self-contradictory, or the window cannot distinguish the classes — say so instead of guessing.

When genuinely ambiguous between cheat and unhealthy, prefer unhealthy (coordinated-control is the harder claim). When ambiguous between unhealthy and healthy, prefer the class the DOMINANT FLOW supports.`,
      criteria: {
        cheat: 'Dominant liquidity is coordinated/controlled funds — buy-together→sell-back-together pairing (synchronized clusters harvesting their own ramp), quota-ladder fake heat (graded relay buys, one-directional imbalance, no genuine new blood — dump not yet required), split-wallet orchestration, or creator front-run/self-trade; mixed retail does not clean it',
        unhealthy: 'Not coordinated cheating, but not a healthy entry at this anchor: strong-hand/whale real buying dominating one-sidedly without an orchestrated dump, low-activity shell, late-stage pump on shrinking inflow, exhausted buy flow under sell pressure, or churn beyond organic support — point-in-time, can convert',
        healthy: 'Organic structure at this anchor: genuine retail participation carries meaningful weight — many unrelated wallets at varied sizes/times, distributed explainable selling, second-wave absorption, two-way flow supporting price',
        unclear_insufficient: 'Too few ticks, self-contradictory evidence, or the window cannot distinguish the classes',
      },
    },

    // ── 2. 作弊模式细分（仅 verdict=cheat 时由 mapper 消费；单选主导模式）──
    cheat_pattern: {
      type: 'choice',
      instructions: `The DOMINANT coordination pattern in this market window (answer even if you judged healthy/unhealthy — the mapper only consumes it for cheat verdicts; pick none_apparent when no coordination pattern is visible).
Judge by which pattern explains the largest share of the suspicious flow:
- dev_self_trade: the token creator is itself the dominant early buyer/dumper (front-run own launch, buy at t≈0 then sell within seconds).
- same_block_burst: the signature is many buys packed into the same blocks in a repeated rhythm (find the groupings yourself in [TICKS] by block number).
- equal_amount_split: the signature is exact- or near-equal buy amounts spread across distinct wallets (find equal and near-equal bands yourself across [TICKS]/[WALLETS]; note quote-converted amounts are approximate on non-BNB quoted pools).
- rapid_churn: the signature is seconds-scale buy→sell reversal churn — wallets whose entire lifecycle inside the window is buy-then-immediately-sell (see the per-wallet lines in [WALLETS]).
- wash_pump: the signature is fabricated volume/price pumping — self-dealing trades that lift the price with no real intent to hold, typically producing the price arc shown (pump then collapse at the anchor).
- quota_ladder: no visible clusters needed — controlled wallets relay-buy in graded amounts manufacturing heat (one-directional buy/sell imbalance, stepped or monotonic climb, little genuine new blood), typically capped by quota-sized concentrated dumps (equal-ish large sells or one large terminal dump); sell-only quota dumpers with an orchestrated buy-side also fit here.
- slow_coordinated_accumulation: the coordination is visible only in the aggregate — many dispersed wallets buying in relay with extreme buy/sell imbalance and a no-drawdown monotonic climb, NO same-block or equal-amount fingerprints at all, ending in a coordinated exit.
- none_apparent: no coordination pattern is visible in this window.`,
      criteria: {
        dev_self_trade: 'Creator front-run / self-trading dominates: the creator wallet (marked isCreator in [WALLETS]) is the dominant early buyer and dumps within seconds, or dumps its whole quota into the ramp',
        same_block_burst: 'Synchronized same-block buy clusters dominate the suspicious flow (repeated multi-buy blocks in rhythm)',
        equal_amount_split: 'Exact- or near-equal amounts split across distinct wallets dominate (position-splitting to dodge concentration gates)',
        rapid_churn: 'Seconds-scale buy→sell churn dominates: many wallets whose whole lifecycle is buy-then-immediately-sell',
        wash_pump: 'Self-dealing volume/price fabrication dominates: pump-and-collapse arc with no real holding intent',
        quota_ladder: 'Graded relay buys manufacturing fake heat with one-directional imbalance, capped by quota-sized concentrated dumps — may show no same-block/equal clusters at all',
        slow_coordinated_accumulation: 'Coordination visible only in the aggregate: dispersed relay buys, extreme buy/sell imbalance, no-drawdown monotonic climb, no cluster fingerprints, coordinated exit at the end',
        none_apparent: 'No coordination pattern visible in this window',
      },
    },

    // ── 3. 真实散户参与度（0-10 Score；「作弊与正常糅杂」判别轴）──
    retail_participation: {
      type: 'score',
      instructions: `How much of this market window's flow is GENUINE RETAIL participation — independent wallets acting on their own interest, not the coordinated side and not exit-liquidity chasers? 0-10 分。
What counts as genuine retail: NEW faces arriving after the launch burst at varied sizes and times; follow-on buying that absorbs early sellers' exits (second-wave absorption); selling distributed across many unrelated wallets at varied times. What does NOT count: members of a synchronized cluster/roster (they are the coordinated side, however many wallets it spreads across); sell-only quota dumpers; copy-chasers piling in only after the pump to be dumped on (genuine humans but weak retail — count them low).
Unresolved-sender ticks noted in [PRECOMPUTED] are an evidence hole — discount accordingly rather than guessing generously. Aggregator-router usage (aggregate share in [PRECOMPUTED]; rows are not individually tagged) says NOTHING by itself about human vs bot — both use it; judge initiator independence from timing/amount correlation in the raw flow, never from route usage.`,
      criteria: [
        '0-1分：几乎没有真实散户——全部或近乎全部流量来自协同/受控一侧，启动簇之后无新面孔、无承接',
        '2-3分：真实散户痕迹很少——零星独立钱包夹杂在主导性协同流量中，启动簇之后偶有散单但无持续入场',
        '4-5分：真实散户与协同流量并存，散户是明显次要一侧',
        '6-7分：真实散户占可观份额，与协同/大户流量大致平衡，启动簇之后仍见新面孔陆续入场',
        '8-9分：真实散户为主导——独立钱包多源多样、金额时间分散，二次承接可见，协同痕迹微弱',
        '10分：几乎纯真实散户——协同流量可忽略',
      ],
    },
  };
}
