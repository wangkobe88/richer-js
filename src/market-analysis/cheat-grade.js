/**
 * 作弊盘检测三级分级规则（G1，2026-11-01 用户裁定立项）——纯函数，零 DB 零网络
 *
 * 输入=buildObservation 观测产物（Jev 档位 + 代码数值锚），输出交易三级
 * cheat / unhealthy / healthy。**D3.5 判定层停产的修订边界（2026-11-01 用户裁定，
 * 案号见台账 G1 段）**：判断仍一律 Jev——本题集只消费 Jev 档位（现象/EXT/活跃度/
 * 捆绑）与代码数值锚（sbHold/t1流），**不做任何「档位→现象强度」的新判断**；本
 * 模块做的是「档位→交易动作」的策略映射（哪些组合算作弊盘不交易/不健康盘重判/
 * 健康盘放行），属引擎侧策略决策（类似条件串评估），非代码产作弊结论。
 *
 * 规则（G7=G6+J 通道持仓组合垄断，2026-11-02 批次五 CD122 用户裁定立项——
 * 「大户持仓太多了，因为我们似乎只考虑了 top1，这个案例可能不太够，如果
 * top2 跟 top1 紧邻买的，更危险」+「给 Jev 增加 持仓均衡 门吧。注意总供应量
 * 占比最重要，第二 CD122 的 top2 不是单一钱包，而是捆绑簇。需要利用 Jev 的
 * 能力处理复杂情况」+两分叉裁定「strong→unhealthy 独立通道」+「完整持仓
 * 图景」：新增第 13 题 holdings_balance（D3.32，四档 EXT 容缺）判前几大持仓
 * 组合垄断（主口径=占总供应量%——单一独大/前二合计/第1大∪簇并集三口径
 * 参考量级 40%+同源协同迹象），strong → unhealthy 留痕 J_holdings_strong
 * **不进 A 八主判清单**（组合垄断=拒买级非拉黑级，与 F/G 同档语义）；I 通道
 * （单一钱包 ≥40 供 → cheat）不受影响——本题覆盖 I 够不着的组合形状（CD122：
 * top1 供 25.6<40，但 top2=同块捆绑簇成员背靠背块进场 3 秒后卖一半，第1大∪
 * 簇并集 40.1% 人工裁定 unhealthy）。新题对 D3.26 旧档重放=答案缺席 null 不
 * 触发 → 黄金集 34/42 沿用（G3/G4/G5/G6 同款先例）。
 * 此前 G6=G5+③豁免前提「组织买入占比」，2026-11-02 用户补充裁定「著名/绑定钱包
 * 的豁免还是要有一个前提，就是它们砸跑了是砸跑了，但是盘面正常用户流量涌入
 * 依然要比较明显，否则如果整个盘面全部是它们的砸盘，盘子也死了」——D/G 两豁
 * 免共同加前提：组织买入占锚窗总买 <80（正常用户承接至少两成）才豁免；≥80=
 * 盘面流量构成基本是组织方独角戏（死盘形状）豁免不成立。锚（snapshot G6）：
 * D 段=famousGroupBuyPct（famous∪跟单买入占比）、G 段=bundleBuyPct（sb∪eq
 * 簇买入占比）；null（旧档断代/组织集空）→ 不豁免 fail-closed（无承接证据
 * 不给豁免，sbw null 同哲学）。128 票锚窗分布（tmp-flow-exempt-precond@182）：
 * D 豁免形状 8 票中 ≥80 五票（CD47:80 恰界/CD66:90.3/CD86:87.7/CD103:92.9/
 * CD113:87.4）不豁免——批次四两代价票 CD86/CD103 回 unhealthy 与人工一致；
 * CD42:71.7/CD90:49.8/CD116:62.8 维持豁免（CD90 残留 healthy 偏差用户知情）。
 * G 豁免形状 17 票 bundleBuy 全 <44（最高 CD124:43.9 人工 healthy）→现状零
 * 翻转，语义对称落地防未来「簇撤退但买入占九成」对倒洗筹死盘形状。定线 80=
 * 与 D3.29 bw 题「组织不足两成不给档」互为镜像（正常承接两成线）。
 * 此前 G5=G4+两处豁免修正，2026-11-02 批次四裁定：
 * ①G 通道双锚簇残余豁免——用户裁定「其实这里还有一个豁免点，就是如果持仓已经
 * 卖出，也已经对盘面没影响了，也没关系」「如果有已经卖出，且流动性占比不是
 * 特别大，也可以豁免」+CD121 口子收紧裁定：豁免须同块簇与等额簇都基本撤退
 * （sbHold<20 ∧ eqHold<50），sbHold/eqHold 锚 null 不豁免（fail-closed；eqHold
 * =null 例外=该轴零残余）。128 票豁免区仅 CD128（12.6/29.2，A_strong:pump 保底
 * grade 仍 cheat）；CD121（11.4/**54.0**）/CD126（10.7/**59.6**）eqHold≥50 不豁
 * 免→黄金集 34/42 重放零变化（D3.26 旧档含 eqHold 键，CD121 锚 54.0 恰不豁免）；
 * 批次四 G_bd 误伤组五票 sbHold 20.1-73.0 簇全在仓、豁免零受益（价值=未来票
 * 语义正确）。
 * ②D 通道跟单集中度豁免——用户裁定「它们的跟单量是不是高估了？因为聪明钱的
 * 跟单一定程度也不算完全不健康的」「也不能把所有的后续买入全看成 famous 的跟
 * 单」：dom=high ∧ 跟单 top3 占跟单正净 Σ<45%（分散形=几十个散户小额跟进）不
 * 触发；≥45%（集中形=少数大户贴身重仓，疑似分仓）维持触发；null（无跟单/旧档
 * 断代）触发（无跟随时 dom 分子全靠 famous 本人=直接控盘）。16 票研究：跟单窗
 * 覆盖买家数中位 80%+、本人持中位 ~10%——修正前 dom 度量的多是「famous 买入后
 * 60s 内盘面热」。已知代价（用户知情）：分散形 9 票 D 不再触发（CD42/CD47/
 * CD65/CD66/CD86/CD90/CD103/CD113/CD116），其中 CD103/CD113 人工 cheat 无 A
 * strong 时翻 healthy、CD65 人工 unhealthy 同翻——由其余通道（F/G/E）或放行
 * 语义承担。此后 G4=G3+I 通道 t1 供应独大单档，2026-11-01 批次二 CD69 两段裁定：立项
 * 「大户集中度不能只是观察锚，持仓太多了不行，至少这么大总量占比肯定不行的」
 * →口径「我觉得不要看流通占比吧，看总量占比，否则如果检测时间靠前，结果就
 * 不对了」（流通分母=已买入筹码，开盘早期池浅占比虚高时间不无偏；供应分母恒
 * totalSupply）→定线「单档 ≥40 → cheat」；G3 基线 42 票 D3.26 存档对拍 34/42
 * （八票偏差见台账 G2 修订段），G4 对存档重放零变化——t1供 ≥40 全 128 票唯一
 * 命中 CD69(46.5) 不在黄金集；断层 46.5↔31.6（CD104 31.6 人工 healthy 挡住
 * 下探，30 线即误伤；25-30 七票人工混杂不能切；35-40 无票做不出 unhealthy
 * 中间档=空转）：
 *
 *   cheat（优先级最高）:
 *     A. 八主判题（四现象剔 cr + tier/bw/rat/pump/wash）任一 strong
 *        豁免降级 unhealthy：唯一 strong=pump ∧ sbw=burst ∧ 八主判 moderate
 *        合计<3 ∧ sbHold<50（CD99 形状——停滞后涌入的自然 pump，非协同推价）
 *     B. 四现象 moderate≥3 ∧ sbHold≥50 ∧ dom≠high（现象门刻意严格：放宽到
 *        EXT 含计会把 CD95/CD100 两票真 unhealthy 误判永久拉黑）
 *     C. sbHold≥85（极端同块集中）
 *     H. washPairSellPct≥60 ∧ washPairCount≥3（G3 新增，2026-11-01 批次二
 *        CD27 用户裁定「对倒交易非常严重，如有必要可能需要增加锚」+落法选定
 *        「≥60% 且 ≥3 对 → cheat」——对倒=操纵盘面铁指纹；128 票锚窗分布
 *        126 票零配对、唯一命中 CD27 卖占 95.1%，断层稀有占比条件天然防误触）
 *     I. top1HoldSupplyPct≥40（G4 新增，第一大户吃 4 成总供应——单钱包一笔
 *        坐票形状（CD69 一笔 5.1653 BNB 吃 465.13M tok=46.5% 供应，组 14
 *        立项原话「一个钱包持有总额度占比过大肯定不行」）；F/C 消费 sbHold
 *        是簇集中，独大无簇票 sbHold 仅 4.9% 原通道全盲；锚 null（supply
 *        缺失）不触发）
 *   unhealthy:
 *     D. famous dom=high ∧（跟单 top3 ≥45% ∨ 跟单锚 null ∨ 组织买入占比 ≥80
 *        ∨ 组织买入锚 null）（G5 前纯 dom=high；跟单集中度豁免见头注②——分散形
 *        「聪明钱带散户」不触发；G6 组织买入 ≥80 死盘形状豁免不成立，见头注③）
 *     E. Jev activityLevel=low ∧ sbw≠burst（G2 简化，2026-11-01 用户裁定
 *        「活跃度这一臂为 low 的，也判为 unhealthy，不过流量 burst 命中的不要
 *        判定为活跃度 low」——G1 期 t1流<40 吃独食豁免（CD105/CD122）与卖笔≤1
 *        对手盘豁免（CD107）撤销，改由题面 D3.27 burst 反锚在档位源头修正；
 *        sbw=burst 豁免保留为通道层双保险）
 *     F. sbHold≥50（中高同块集中）
 *     G. bd（bundled_trade_dominance）=high ∧ ¬(sbHold<20 ∧ (eqHold<50 ∨
 *        eqHold=null) ∧ 组织买入占比<80)（G2 新增，2026-11-01 用户裁定「捆绑钱包
 *        主导 是重要的负面臂」——128 票影响面 65 票 bd=high：人工 cheat 39/
 *        unhealthy 17/healthy 7，直落 cheat 误伤 healthy 7 票+17 票拉黑级偏重，
 *        用户选定 unhealthy 档=拒买可重判不清仓；G1 期「bd high 单独不定档
 *        （CD98/CD116/CD127 反证）」旧裁定同步废止；G5 双锚簇残余豁免见头注①；
 *        G6 组织买入 ≥80 死盘形状豁免不成立，见头注③）
 *     J. holdings_balance=strong（G7 新增，前几大持仓组合垄断——第一大+紧邻
 *        第二大+捆绑簇凑成垄断总供应量一大截（CD122 形状）或单一独大档位
 *        补充；主口径=占总供应量%；独立通道不进 A 清单=拒买级非拉黑级；
 *        <D3.32 旧档答案缺席 null 不触发）
 *   healthy: 其余
 *
 * cr（创建者抢跑）刻意不进主判=辅助判定（用户语义；CD75 cr strong 人工判
 * unhealthy 反证 cr strong 不足以定 cheat）。
 *
 * 容缺语义（fail-open 放行方向，与 GMGN 层「数据不可用不得拦买点」同向）：
 * 档位 null（旧档断代/容缺）不计 strong/moderate；数值锚 null 不触发比较门。
 * 已知例外：sbw null 按「非 burst」处理（burst 豁免需在场证据，无证据不豁免）。
 *
 * 改规则必须 bump CHEAT_GRADE_RULES_VERSION 并同步台账 G 段+跑 42 票黄金集
 * （scripts/cheat-detection/data/cheat-grade-golden-42.json，单测
 * _test_cheat_grade.cjs 对拍锁定防漂移）。
 */

const { PHENOMENON_IDS, EXT_PHENOMENON_IDS } = require('./cheat-result-mapper');

const CHEAT_GRADE_RULES_VERSION = 'G7';

/**
 * 档位→数值映射（G1 因子化投影，2026-11-01 用户指令「以因子的形式放到表达式中」）：
 * 全族数值序（narrativeRating 1/2/3/9 先例同构）——条件串可直接 >=/</== 比较，
 * 调阈值免改枚举；null=未判定/档位断代/容缺（条件比较恒 false，fail-closed 方向
 * 由条件串作者自定：未判定放行须显式 `cheatGrade IS NULL OR` 臂）。
 * 未知档位值（题集演进新增桶）→ null 不冒充（fail-loud 单测锁）。
 */
const CHEAT_LEVEL_SCORES = {
  grade: { healthy: 0, unhealthy: 1, cheat: 2 },
  level: { none: 0, weak: 1, moderate: 2, strong: 3 }, // 四档现象/EXT 题
  sbw: { none: 0, burst: 1 },                          // 停滞突发二桶
  activity: { low: 0, mid: 1, high: 2, ultra: 3 },     // 活跃度档
  dominance: { low: 0, mid: 1, high: 2 },              // 捆绑主导度档
};

/** 档位→数值（未知值/null → null 不冒充） */
function scoreLevel(map, value) {
  if (value == null) return null;
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

/**
 * 观测产物 → FA 因子投影原料（service 分析链尾部调用，随返回形状透传引擎）：
 * levels=13 题数值档（FA 出口键；washPair D3.28/holdingsBalance D3.32 起入列）、buckets=字符串原值
 * （metadata/日志研究友好）、anchors=数值锚九键（2026-11-01 用户补点「著名钱包
 * 掌控/持仓极不均衡」：obs.anchors 持仓占比四键 sb/eq/t1 供/流 + extras famous
 * 数值/档位——G1 B/C/F 通道 sbHold、E 通道 t1 流、D 通道 famous 档的同源数值；
 * D3.28 同块对敲三键 washPair 数量/卖占/买占——G3 H 通道同源数值，条件串可做
 * 同款门）。
 * activityLevel/bundledDominance/washPair 缺席（<D3.5/<D3.8/<D3.28 旧档）→ null。
 */
function levelsFromObservation(observation, extras = {}) {
  const obs = observation || {};
  const ph = obs.phenomena || {};
  const ex = obs.extLevels || {};
  const fx = extras || {};
  const act = obs.activityLevel && obs.activityLevel.bucket ? obs.activityLevel.bucket : null;
  const dom = obs.bundledDominance && obs.bundledDominance.bucket ? obs.bundledDominance.bucket : null;
  const levels = {
    equalAmountSplit: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.equal_amount_split),
    coordinatedSellBack: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.coordinated_sell_back),
    creatorFrontRun: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.creator_front_run),
    sellDispersion: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.sell_dispersion),
    stallBurstWave: scoreLevel(CHEAT_LEVEL_SCORES.sbw, ex.stall_burst_wave),
    amountTiering: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.amount_tiering),
    sameBlockBuyWave: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.same_block_buy_wave),
    insiderSupplySell: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.insider_supply_sell),
    slowGrindPump: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.slow_grind_pump),
    washPair: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.wash_pair),
    holdingsBalance: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.holdings_balance), // D3.32（G7 J 通道）
    activityLevel: scoreLevel(CHEAT_LEVEL_SCORES.activity, act),
    bundledDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, dom),
  };
  const buckets = {
    equalAmountSplit: ph.equal_amount_split ?? null,
    coordinatedSellBack: ph.coordinated_sell_back ?? null,
    creatorFrontRun: ph.creator_front_run ?? null,
    sellDispersion: ph.sell_dispersion ?? null,
    stallBurstWave: ex.stall_burst_wave ?? null,
    amountTiering: ex.amount_tiering ?? null,
    sameBlockBuyWave: ex.same_block_buy_wave ?? null,
    insiderSupplySell: ex.insider_supply_sell ?? null,
    slowGrindPump: ex.slow_grind_pump ?? null,
    washPair: ex.wash_pair ?? null,
    holdingsBalance: ex.holdings_balance ?? null,
    activityLevel: act,
    bundledDominance: dom,
  };
  const an = obs.anchors || {};
  const famousLevel = typeof fx.famousDominanceLevel === 'string' ? fx.famousDominanceLevel : null;
  const anchors = {
    sameBlockHoldPct: _pct(an.sameBlockHoldPct),
    equalBandHoldPct: _pct(an.equalBandHoldPct),
    washPairCount: _pct(an.washPairCount),
    washPairSellPct: _pct(an.washPairSellPct),
    washPairBuyPct: _pct(an.washPairBuyPct),
    top1HoldSupplyPct: _pct(an.top1HoldSupplyPct),
    top1HoldCircPct: _pct(an.top1HoldCircPct),
    // D3.32 持仓分布锚族（G7 J 通道 holdings_balance 的数值源；缺席=null 不冒充）
    top2HoldSupplyPct: _pct(an.top2HoldSupplyPct),
    top1Top2HoldSupplyPct: _pct(an.top1Top2HoldSupplyPct),
    top1Top2FirstBuyGapSec: _pct(an.top1Top2FirstBuyGapSec),
    clusterHoldSupplyPct: _pct(an.clusterHoldSupplyPct),
    t1PlusClusterSupplyPct: _pct(an.t1PlusClusterSupplyPct),
    famousDominancePct: _pct(fx.famousDominancePct),
    famousDominanceLevel: famousLevel,
    famousDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, famousLevel),
  };
  return { levels, buckets, anchors };
}


/** 四现象题（B 通道现象门原料） */
const PHEN_IDS = PHENOMENON_IDS; // [equal_amount_split, coordinated_sell_back, creator_front_run, sell_dispersion]

/** 八主判题：四现象剔 cr + EXT 剔 sbw（cr/sbw=辅助判定不进主判；wash_pair D3.28
 *  随 EXT 清单自动入列；**holdings_balance D3.32 刻意排除**——G7 用户裁定独立
 *  J 通道（strong→unhealthy）不进 A 主判清单，组合垄断=拒买级非拉黑级） */
const MAIN_IDS = [
  'equal_amount_split',
  'coordinated_sell_back',
  'sell_dispersion',
  ...EXT_PHENOMENON_IDS.filter((id) => id !== 'stall_burst_wave' && id !== 'holdings_balance'), // tier/bw/rat/pump/wash
];

/** 数值锚读取（null/非有限/负数按缺席——绝不冒充） */
function _pct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * 观测记录 → 交易三级
 * @param {Object} observation - buildObservation 产物
 *   {phenomena, extLevels, activityLevel:{bucket}|null, bundledDominance, anchors}
 * @param {Object} [extras] - 分级附加原料
 *   {famousLevel: 'low'|'mid'|'high'|null, famousFollowerTop3Pct: number|null,
 *    famousGroupBuyPct: number|null, anchorSellCount: number|null}
 *   （famousLevel=snapshot.derived.famousDominanceLevel；famousFollowerTop3Pct=
 *   snapshot.derived.famousFollowerTop3Pct（G5 D 通道跟单集中度豁免判据）；
 *   famousGroupBuyPct=snapshot.derived.famousGroupBuyPct（G6 D 通道豁免前提：
 *   famous∪跟单买入占锚窗总买 %，≥80=正常承接不足两成不豁免）；anchorSellCount=
 *   锚窗卖笔数，service 从 pull.rows 现数——G2 起 E 通道不再消费（历史 D3.x
 *   豁免原料），字段保留为 service/digest 兼容形状）
 * @returns {{grade:'cheat'|'unhealthy'|'healthy', reasons:Array<{level:string,code:string}>, version:string}}
 */
function gradeObservation(observation, extras = {}) {
  const obs = observation || {};
  const ex = extras || {};
  const ph = obs.phenomena || {};
  const ext = obs.extLevels || {};
  const lv = {};
  for (const id of PHEN_IDS) lv[id] = ph[id] ?? null;
  for (const id of EXT_PHENOMENON_IDS) lv[id] = ext[id] ?? null;

  const sbw = ext.stall_burst_wave ?? null;
  const strongHit = MAIN_IDS.filter((k) => lv[k] === 'strong');
  const modAll = MAIN_IDS.filter((k) => lv[k] === 'moderate').length;
  const modPhen = PHEN_IDS.filter((k) => ph[k] === 'moderate').length;
  const dom = typeof ex.famousLevel === 'string' ? ex.famousLevel : null;
  const act = obs.activityLevel && typeof obs.activityLevel.bucket === 'string'
    ? obs.activityLevel.bucket : null;
  const bd = obs.bundledDominance && typeof obs.bundledDominance.bucket === 'string'
    ? obs.bundledDominance.bucket : null;
  const anchors = obs.anchors || {};
  const sbHold = _pct(anchors.sameBlockHoldPct);
  const eqHold = _pct(anchors.equalBandHoldPct);
  const washSell = _pct(anchors.washPairSellPct);
  const washCount = _pct(anchors.washPairCount);
  const t1Sup = _pct(anchors.top1HoldSupplyPct);
  const folTop3 = _pct(ex.famousFollowerTop3Pct);
  const famousBuyPct = _pct(ex.famousGroupBuyPct);
  const bundleBuy = _pct(anchors.bundleBuyPct);

  const reasons = [];

  // A：七主判任一 strong → cheat；单 pump+burst 形状降级 unhealthy
  if (strongHit.length > 0) {
    const lonePumpBurst = strongHit.length === 1
      && strongHit[0] === 'slow_grind_pump'
      && sbw === 'burst'
      && modAll < 3
      && (sbHold === null || sbHold < 50);
    if (lonePumpBurst) {
      reasons.push({ level: 'unhealthy', code: 'A_downgrade_single_pump_burst' });
    } else {
      reasons.push({ level: 'cheat', code: `A_strong:${strongHit.join('+')}` });
    }
  }

  // B：现象三档堆叠 + 中高同块集中（dom=high 让位 D——著名主导优先归 unhealthy）
  if (modPhen >= 3 && sbHold !== null && sbHold >= 50 && dom !== 'high') {
    reasons.push({ level: 'cheat', code: `B_phen_mod${modPhen}_sbHold${sbHold.toFixed(0)}` });
  }

  // C：极端同块集中
  if (sbHold !== null && sbHold >= 85) {
    reasons.push({ level: 'cheat', code: `C_sbHold${sbHold.toFixed(0)}` });
  }

  // H：同块对敲锚（G3，2026-11-01 批次二 CD27 用户裁定「对倒交易非常严重，如有
  // 必要可能需要增加锚」+落法选定「≥60% 且 ≥3 对 → cheat」——对倒=操纵盘面
  // 铁指纹：≥60% 卖出是同块等额换手且 ≥3 对。锚缺席（旧档/无配对 null）不触发
  if (washSell !== null && washSell >= 60 && washCount !== null && washCount >= 3) {
    reasons.push({ level: 'cheat', code: `H_wash_pair_sell${washSell.toFixed(0)}x${washCount}` });
  }

  // I：第一大户供应独大（G4，2026-11-01 批次二 CD69 两段裁定——立项「大户集中
  // 度不能只是观察锚，持仓太多了不行」+口径「不要看流通占比吧，看总量占比，
  // 否则如果检测时间靠前，结果就不对了」（流通分母开盘早期虚高）+定线单档
  // ≥40 → cheat。128 票分布唯一命中 CD69(46.5)；下一档 CD104(31.6) 人工
  // healthy 挡住下探。F/C 消费 sbHold 是簇集中——独大无簇形状原通道全盲。
  // 锚 null（totalSupply 缺失/无正持仓）不触发。
  if (t1Sup !== null && t1Sup >= 40) {
    reasons.push({ level: 'cheat', code: `I_t1_supply${t1Sup.toFixed(0)}` });
  }

  // D：著名钱包主导（G5 补跟单集中度豁免，2026-11-02 批次四用户裁定「它们的跟单
  // 量是不是高估了？因为聪明钱的跟单一定程度也不算完全不健康的」+「也不能把所有
  // 的后续买入全看成 famous 的跟单」——dom=high 16 票研究：60s 跟单窗覆盖买家数
  // 中位 80%+（最高 95%），dom 分子主体是跟单者而非 famous 本人（本人持中位 ~10%）
  // → dom 高很大程度度量「famous 买入后 60s 内盘面热」。跟单 top3 合计占跟单正净
  // Σ <45%=分散形（几十个散户小额跟进、首买中位 0.05-0.17 BNB、最大单钱包 <10%）
  // =「聪明钱带散户」豁免不触发；≥45%=集中形（少数大户贴身重仓=疑似分仓/协同，
  // CD63 top3 87%/最大 26%、CD80 81%）维持触发。null（无跟单/跟单正净 Σ=0/旧档
  // 断代）→ 触发：无跟随时 dom 分子全靠 famous 本人=直接控盘更该触发；旧档无键
  // 保持 G4 行为（黄金集 D 段重放零变化）。
  // G6 豁免前提（用户补充裁定，头注③）：组织买入占比 ≥80（正常用户承接不足两
  // 成）→ 不豁免——盘面流量构成基本是 famous∪跟单的独角戏，即使它们已部分撤退
  // 也是死盘形状。famousGroupBuyPct null（旧档断代）→ 不豁免（fail-closed 与
  // sbw null 同哲学：承接证据缺席不给豁免；生产链 dom=high 下该锚必产出数值）。
  if (dom === 'high' && !(folTop3 !== null && folTop3 < 45
    && famousBuyPct !== null && famousBuyPct < 80)) {
    reasons.push({ level: 'unhealthy', code: 'D_famous_dominance' });
  }

  // E：活跃度低（G2 简化，2026-11-01 用户裁定「活跃度这一臂为 low 的，也判为
  // unhealthy，不过流量 burst 命中的不要判定为活跃度 low」——t1流<40 吃独食豁免
  // 与卖笔≤1 对手盘豁免撤销；sbw=burst 豁免保留为通道层双保险，主修正前移到
  // 题面 D3.27：burst 形状（长静默后集中涌入）Jev 不再产 low 档）
  if (act === 'low' && sbw !== 'burst') {
    reasons.push({ level: 'unhealthy', code: 'E_low_activity' });
  }

  // F：中高同块集中
  if (sbHold !== null && sbHold >= 50) {
    reasons.push({ level: 'unhealthy', code: `F_sbHold${sbHold.toFixed(0)}` });
  }

  // G：捆绑钱包主导高档（G2，重要负面臂——用户裁定 unhealthy 档；G5 双锚簇残余
  // 豁免，2026-11-02 批次四用户裁定「其实这里还有一个豁免点，就是如果持仓已经
  // 卖出，也已经对盘面没影响了，也没关系」「如果有已经卖出，且流动性占比不是
  // 特别大，也可以豁免」+CD121 口子收紧裁定（同块簇撤了但 eqHold 54% 等额簇还
  // 持一半筹码≠对盘面无影响）——豁免须**同块簇与等额簇都基本撤退**：sbHold<20
  // ∧ eqHold<50 才豁免；sbHold/eqHold=null（无合格簇锚）不豁免——锚缺席无从谈
  // 「已卖出」，fail-closed 维持触发（eqHold=null 例外：无等额簇=该轴零残余，
  // sbHold<20 即豁免）。128 票分布：豁免区=CD128（12.6/29.2，A_strong:pump 保底
  // grade 仍 cheat）；CD121（11.4/54.0）与 CD126（10.7/59.6）eqHold≥50 不豁免）
  // G6 豁免前提（用户补充裁定，头注③，与 D 段同线）：bundleBuyPct ≥80（sb∪eq
  // 簇买入占锚窗总买 ≥80=正常承接不足两成）→ 不豁免；null（旧档断代/无合格簇
  // 成员）→ 不豁免 fail-closed。128 票 G 豁免形状 bundleBuy 全 <44=现状零翻转，
  // 语义对称落地防「簇撤退但买入占九成」对倒洗筹死盘形状
  if (bd === 'high' && !(sbHold !== null && sbHold < 20 && (eqHold === null || eqHold < 50)
    && bundleBuy !== null && bundleBuy < 80)) {
    reasons.push({ level: 'unhealthy', code: 'G_bundled_dominance' });
  }

  // J：前几大持仓组合垄断（G7，2026-11-02 批次五 CD122 立项——用户裁定「给 Jev
  // 增加 持仓均衡 门吧。注意总供应量占比最重要，第二 CD122 的 top2 不是单一
  // 钱包，而是捆绑簇。需要利用 Jev 的能力处理复杂情况」+「strong→unhealthy
  // （独立通道，不进 A 通道）」）：holdings_balance（D3.32 第 13 题）strong →
  // unhealthy。组合垄断=拒买级非拉黑级（F/G 同档语义）；单一钱包独大 ≥40 供仍
  // 由 I 通道 cheat 管并取最重——本题补 I 够不着的形状（CD122：top1 供 25.6<40
  // 但第1大∪簇并集 40.1%+第二大背靠背块紧邻进场 3 秒卖一半）。档位 null
  // （<D3.32 旧档断代/总供应量缺失缺主口径）不触发（EXT 容缺语义同族）。
  if (lv.holdings_balance === 'strong') {
    reasons.push({ level: 'unhealthy', code: 'J_holdings_strong' });
  }

  const grade = reasons.some((r) => r.level === 'cheat') ? 'cheat'
    : (reasons.some((r) => r.level === 'unhealthy') ? 'unhealthy' : 'healthy');
  return { grade, reasons, version: CHEAT_GRADE_RULES_VERSION };
}

module.exports = {
  gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS,
  CHEAT_LEVEL_SCORES, scoreLevel, levelsFromObservation,
};
