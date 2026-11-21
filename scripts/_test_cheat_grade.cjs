#!/usr/bin/env node
/**
 * 作弊盘三级分级规则单测（G11）——零 DB 零网络纯函数
 *
 * 覆盖：五通道逐条（A_strong/A 降级/D/E/J/L）+ G9 五纯数值门退役反证
 * （C sbHold≥85/F sbHold≥50/H washPair 数值/I t1 供≥40/K noBuySell≥40——
 * 判罚不经 Jev 档位，2026-11-02 用户裁定退役，现象改由题档承载）+
 * G10 sbHold/eqHold 门侧消费退役反证与 B 通道整体退役（用户裁定「sbHold
 * 让我感觉不适……活跃度极高直接被拉很高，基于它判断不合理。eqHold 有一定
 * 合理之处，可是如果能通过语言描述现象，就不要使用这种死指标」）+
 * G11 G 通道整体退役（2026-11-02 CD133 用户裁定「GMGN的散户是有默认交易额
 * 的，大多数都是0.1/0.05，大户则是 0.2/0.25/0.3 之类的，这要是能跨区块，
 * 误伤就太大了！同块同额度误伤可能小一些，可以作为参考。如果这种死指标
 * 不好用，还是把原始数据输入给Jev，通过现象描述，去综合判断与考量里面有
 * 是否有协同行为吧」——豁免前提 bundleBuyPct 的 sb∪eq 并集圈定把前端默认
 * 档散户整档吞入（7746 例 0.2500/0.1037/0.1086 同块各异金额入 sb 臂），bd
 * 档位照判照投影门侧零消费，协同现象由 A 题档承载——D3.34 题面加前端默认
 * 档反锚）/ 豁免边界（burst、弱 burst 三键）/ cr-sbw 辅助判定不进主判 /
 * 容缺 fail-open（档位 null 不计、锚 null 不触发、sbw null 按 non-burst、
 * washPair 键缺席旧档重放零变化）/ 优先级（cheat>unhealthy>healthy 多通道
 * 叠加）/ 42 票黄金集对拍（**改规则须连此锁定一起重裁定**）。失败 exit 非零。
 */

const { gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS,
  CHEAT_LEVEL_SCORES, scoreLevel, levelsFromObservation,
  strongbackerShapeHit, STRONGBACKER_RULE, STRONGBACKER_RULE_VERSION } = require('../src/market-analysis/cheat-grade');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

// ── 观测工厂：全 none 干净盘（八通道全不触发的基底）──
function baseObs() {
  return {
    phenomena: {
      equal_amount_split: 'none', coordinated_sell_back: 'none',
      creator_front_run: 'none', sell_dispersion: 'none',
    },
    extLevels: {
      stall_burst_wave: 'none', amount_tiering: 'none',
      same_block_buy_wave: 'none', insider_supply_sell: 'none',
      slow_grind_pump: 'none', wash_pair: 'none', holdings_balance: 'none',
    },
    activityLevel: { bucket: 'mid', prob: 0.8 },
    bundledDominance: { bucket: 'low', prob: 0.9 },
    anchors: { sameBlockHoldPct: null, top1HoldCircPct: null, top1HoldSupplyPct: null,
      washPairCount: null, washPairSellPct: null, washPairBuyPct: null },
  };
}
function withPhen(obs, id, bucket) { obs.phenomena[id] = bucket; return obs; }
function withExt(obs, id, bucket) { obs.extLevels[id] = bucket; return obs; }
function grade(obs, extras) { return gradeObservation(obs, extras || { anchorSellCount: null }); }

function main() {
  ok(CHEAT_GRADE_RULES_VERSION === 'G23', '版本常量 G23（改规则必须 bump+同步台账+跑黄金集；G23=T205 E 通道阶段前提（2026-11-21 金狗 GWC 0xb71209cb…7777 案）：E_low_activity 加阶段腿——灰度 extras.enableActStageCold ∧ extras.stageAthVsLaunchPct（锚窗最高可靠价较地板发行价，cheat snapshot 新键）<80 未火过 → E 不产 unhealthy（cheat 门放行进 BP）——低活跃票最终守门员（FP act 臂/AF1 reject_low 同原则贯通 act-stage.js 共享线，不落本腿则上游放行 low 票死在 E）；ultra/M 通道刻意不动；ath null=照拦；灰度关=零行为黄金集 bit 不变；台账金狗 JG-15+交易 T205）；G22=G21−R 通道（2026-11-17 CD419/D3.77 用户裁定原话「abnormal_behavior_ratio 是针对一些不普世的异常现象，也删除吧，分工问题，如果发现有一些异常现象在 cheat 的其它锚不好控，会增加因子过滤锚，这个比较泛的 cheat 锚就不保留了」：泛异常兜底题与分工不符——不普世异常形状的承接载体=FP 因子门（T143 FP 族纯代码零 Jev）而非泛 cheat 题；题随 D3.77 整题删除（11→10）、R_abnormal_dominant 通道随题退役不再产出（历史行留档）、levels/buckets abnormalBehavior 键移除、FA cheatAbnormalBehaviorRatio 键恒 null；判读原料锚（D3.35 四键/D3.54 脉冲三键/创建者峰值）照算纯观察、state 两喂料行移除；黄金集 D3.26 存档无该题答案→重放零变化）；G21=G20−A 主判 burst_spike_concentration（CD418/D3.76——sbw=burst 豁免链天然放行 A 主判冗余：题整删+EXT 清单移除+MAIN_IDS 九→八主判+spike+pump 双 strong 封堵降级豁免臂随题退役，尖刺两锚照算纯观察）；G20=−D 通道（CD416 famous 锚删除——CD379 活跃度豁免下实际拦截为零，famous 拦截载体=BP ③桶+卖侧 T133/T136/T161/T137 臂）；G19=−J_holdings_strong 臂（btv140 食蟹猴二案）+D3.72 slow_grind_pump 合力反锚第二通道；G18=−G8 弱 burst 代码臂（CD397）；G17=N 通道（CD374）；G16=D 邻界联立臂（CD323，已随 G20 整体退役）；G15=burst_spike 入 EXT（→G21 出列）；G14=M 通道 ultra；G12/G13=R 通道立/改制（→G22 随题退役）')
  ok(MAIN_IDS.length === 8 && !MAIN_IDS.includes('creator_front_run') && !MAIN_IDS.includes('stall_burst_wave')
    && MAIN_IDS.includes('wash_pair') && !MAIN_IDS.includes('holdings_balance')
    && !MAIN_IDS.includes('burst_spike_concentration') && !MAIN_IDS.includes('strong_backer_pressure'),
    `八主判=三现象 + tier/bw/rat/pump/wash（cr/sbw 辅助判定不进主判；holdings_balance G7 刻意排除=独立 J 通道；burst_spike_concentration D3.51 入列→D3.76/G21 随题退役出列（CD418——sbw=burst 豁免链天然放行，A 主判冗余）；**strong_backer_pressure D3.52 刻意排除——CD159 强庄币锚观察期：豁免方向题绝不拉黑（EXT 清单会自动吸收 strong→cheat 与豁免意图相反），档位只进 FA 投影攒分布，实际 ${MAIN_IDS.join(',')}）`);

  console.log('A. 八主判 strong → cheat');
  {
    for (const id of MAIN_IDS) {
      // 直接设八题各一 strong（phen/ext 键重复无害——按 id 域写）
      const obs = baseObs();
      if (obs.phenomena[id] !== undefined) obs.phenomena[id] = 'strong'; else obs.extLevels[id] = 'strong';
      const rr = gradeObservation(obs, { anchorSellCount: null });
      ok(rr.grade === 'cheat' && rr.reasons[0].code.startsWith(`A_strong:${id}`),
        `${id} 单 strong → cheat（A_strong 留痕题名）`);
    }
  }
  {
    // cr strong 不进主判：单 cr strong 无锚 → healthy（CD75 反证：cr strong 不足以定 cheat）
    const obs = withPhen(baseObs(), 'creator_front_run', 'strong');
    const r = grade(obs);
    ok(r.grade === 'healthy' && r.reasons.length === 0, 'cr 单 strong 不进主判 → healthy（辅助判定，CD75 反证）');
    // sbw=burst 现象二分非档位强度，不进主判
    const obs2 = withExt(baseObs(), 'stall_burst_wave', 'burst');
    ok(grade(obs2).grade === 'healthy', 'sbw=burst 单独不触发任何通道（辅助判定）');
  }

  console.log('A3. burst 尖刺集中随题退役（G21/CD418/D3.76——sbw=burst 豁免链天然放行，A 主判冗余）');
  {
    // 旧档/在场 spike strong 答案被 EXT 清单忽略 → 不触发任何 A 留痕（断代防线）
    const obs = withExt(baseObs(), 'burst_spike_concentration', 'strong');
    obs.anchors.spikeBuyPctInBurst = 99.0; obs.anchors.spikeHoldPctAll = 53.8;
    const r = grade(obs);
    ok(r.grade === 'healthy' && r.reasons.every((x) => !x.code.startsWith('A_strong')),
      'burst_spike 旧档 strong 答案被 EXT 清单忽略不触发 A（D3.76 断代——黄金集 42 票重放零变化防线；两锚纯观察照落不进门侧判据）');
    const r2 = grade(withExt(baseObs(), 'burst_spike_concentration', 'moderate'));
    ok(r2.grade === 'healthy' && r2.reasons.every((x) => !x.code.startsWith('A_strong')),
      'burst_spike moderate 同被忽略（healthy 落点）');
    // spike+pump 双 strong：spike 已不在 MAIN_IDS → strongHit 只剩 pump=唯一 strong
    // ∧ sbw=burst ∧ mod<3 → A 降级豁免成立（G21 起 spike 不再封堵——burst 方向豁免一致性）
    const obs3 = withExt(baseObs(), 'burst_spike_concentration', 'strong');
    withExt(obs3, 'slow_grind_pump', 'strong');
    withExt(obs3, 'stall_burst_wave', 'burst');
    const r3 = grade(obs3, { anchorSellCount: 5 });
    ok(r3.grade === 'unhealthy' && r3.reasons[0].code === 'A_downgrade_single_pump_burst',
      'spike+pump 双 strong → pump 唯一 strong∧sbw=burst 降级豁免成立 unhealthy（G15 时代「spike strong 在场即非停滞后自然涌入」封堵臂随题退役——CD418 burst 直通下一层语义）');
  }

  console.log('A2. 单 pump+burst 降级豁免（CD99 形状；G10 起 sbHold<50 腿退役）');
  {
    // 唯一 strong=pump ∧ sbw=burst ∧ mod<3 → unhealthy（G10 起不再看 sbHold）
    const obs = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs, 'stall_burst_wave', 'burst');
    obs.anchors.sameBlockHoldPct = 30;
    const r = grade(obs, { anchorSellCount: 5 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'A_downgrade_single_pump_burst',
      '唯一 pump strong+burst+mod<3 → 降级 unhealthy（停滞后自然涌入非协同推价）');
    // G10 退役反证：sbHold 任意高值不改变降级（sbHold 是活跃度函数非组织性度量）
    const obs2 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs2, 'stall_burst_wave', 'burst');
    obs2.anchors.sameBlockHoldPct = 55;
    const r2 = grade(obs2, { anchorSellCount: 5 });
    ok(r2.grade === 'unhealthy' && r2.reasons[0].code === 'A_downgrade_single_pump_burst',
      'G10 反证: sbHold=55 照样降级 unhealthy（sbHold 腿已退役——高活跃盘簇圈定吞散户拉高 sbHold 是数学性质，不作豁免判据）');
    // sbw=none → 豁免不成立 → cheat
    const obs3 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    const r3 = grade(obs3, { anchorSellCount: 5 });
    ok(r3.grade === 'cheat' && r3.reasons[0].code === 'A_strong:slow_grind_pump',
      '无 burst 在场 → 豁免不成立 → cheat（burst 豁免需在场证据）');
    // pump+另一主判双 strong → 豁免只认唯一 strong
    const obs4 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs4, 'amount_tiering', 'strong');
    withExt(obs4, 'stall_burst_wave', 'burst');
    obs4.anchors.sameBlockHoldPct = 10;
    const r4 = grade(obs4, { anchorSellCount: 5 });
    ok(r4.grade === 'cheat', '双 strong（pump+tier）→ 降级豁免只认唯一 strong → cheat');
    // modAll≥3（EXT 含计）→ 豁免失效
    const obs5 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs5, 'stall_burst_wave', 'burst');
    withExt(obs5, 'amount_tiering', 'moderate');
    withExt(obs5, 'same_block_buy_wave', 'moderate');
    withExt(obs5, 'insider_supply_sell', 'moderate');
    obs5.anchors.sameBlockHoldPct = 10;
    const r5 = grade(obs5, { anchorSellCount: 5 });
    ok(r5.grade === 'cheat', 'pump strong+burst 但七主判 mod 合计≥3（EXT 含计）→ 豁免失效 cheat');
  }

  console.log('B.（G10 退役反证）四现象 moderate 共振不再产档——B 通道整体退役');
  {
    // 2026-11-02 用户裁定 sbHold/eqHold 门侧退役后 B 骨架塌（联立撤后裸 moderate
    // 共振错杀 CD98/CD124 两票人工 healthy 且 G1-G9 零正命中）→ 整体退役
    const obs = baseObs();
    withPhen(obs, 'equal_amount_split', 'moderate');
    withPhen(obs, 'coordinated_sell_back', 'moderate');
    withPhen(obs, 'sell_dispersion', 'moderate');
    obs.anchors.sameBlockHoldPct = 60;
    const r = grade(obs, { anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'B 退役反证: 三现象 mod+sbHold=60 → healthy（moderate 共振不足以拉黑——「多现象共振」证据交 A 主判 strong 档与题面校准）');
    const obs4 = baseObs();
    withPhen(obs4, 'equal_amount_split', 'moderate');
    withPhen(obs4, 'coordinated_sell_back', 'moderate');
    withPhen(obs4, 'sell_dispersion', 'moderate');
    obs4.anchors.sameBlockHoldPct = 45;
    ok(grade(obs4, { anchorSellCount: 10 }).grade === 'healthy',
      'B 退役反证: 三现象 mod sbHold<45 同 healthy（CD98/CD124 错杀票回正）');
    // dom=high 照走 D（B 让位语义随 B 退役自然消失）
    const obs3 = baseObs();
    withPhen(obs3, 'equal_amount_split', 'moderate');
    withPhen(obs3, 'coordinated_sell_back', 'moderate');
    withPhen(obs3, 'sell_dispersion', 'moderate');
    // G20/CD416 退役反证：extras 携带 famousLevel:'high'（旧调用形状）不再触发
    // D 通道——cheat 门 famous 判定整链拆除（拦截现行载体=BP ③桶+卖侧臂）
    const r3 = grade(obs3, { famousLevel: 'high', anchorSellCount: 10 });
    ok(r3.grade === 'healthy' && !r3.reasons.some((x) => /D_famous/.test(x.code)),
      'G20 退役反证: famous dom=high 不再触发 D（历史 unhealthy 载体移交 BP ③桶）');
  }

  console.log('C.（G9 退役反证）sbHold≥85 纯数值不再产档——判罚须经 Jev 档位');
  {
    // 2026-11-02 用户裁定退役 C/F：sbHold 高值无 Jev 档位 → 不判罚（原 C 85/F 50 两线）
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 85;
    const r = grade(obs, { anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'sbHold=85 档位全 none → healthy（C 已退役：锚不直读产 cheat，黄金集 CD97 随此降 unhealthy）');
    const obs2 = baseObs();
    obs2.anchors.sameBlockHoldPct = 84.9;
    ok(grade(obs2, { anchorSellCount: 10 }).grade === 'healthy',
      'sbHold 84.9 → healthy（C/F 双退役，无 Jev 档位不判罚）');
  }

  console.log('H.（G9 退役反证）washPair 纯数值不再产档——对倒现象由 wash_pair 题档承载（A 主判）');
  {
    // CD27 形状：95.1% 卖出同块等额买回 10 对，但 Jev 题档全 none → 不判罚
    const obs = baseObs();
    obs.anchors.washPairSellPct = 95.1;
    obs.anchors.washPairCount = 10;
    ok(grade(obs, { anchorSellCount: 10 }).grade === 'healthy',
      'washPair 95.1%×10 对档位全 none → healthy（H 已退役：锚值不直读，[PRECOMPUTED] 事实行照常喂 Jev）');
    // 对倒现象由 Jev 档承载：wash_pair strong → A 主判 cheat（MAIN_IDS 含 wash）
    const obs2 = withExt(baseObs(), 'wash_pair', 'strong');
    obs2.anchors.washPairSellPct = 95.1;
    obs2.anchors.washPairCount = 10;
    const r2 = grade(obs2, { anchorSellCount: 10 });
    ok(r2.grade === 'cheat' && r2.reasons.some((x) => x.code === 'A_strong:wash_pair'),
      'wash_pair 题档 strong（CD27 对倒形状由 Jev 判档）→ cheat A_strong:wash_pair');
    // moderate 不拉黑：H 原纯数值线已退役，拒买级留待 Jev/其余通道
    const obs3 = withExt(baseObs(), 'wash_pair', 'moderate');
    obs3.anchors.washPairSellPct = 95;
    obs3.anchors.washPairCount = 10;
    ok(grade(obs3, { anchorSellCount: 10 }).grade === 'healthy',
      'wash_pair moderate → 不拉黑（对倒档位证据不足硬门已撤——已知代价 CD27 类形状降依赖 Jev 判档）');
  }

  console.log('I.（G9 退役反证）t1 供≥40 纯数值不再产档——独大现象由 holdings_balance/insider 题档承载');
  {
    // CD69 形状：第一大户一笔吃 46.5% 供应，但 Jev 题档全 none → 不判罚
    const obs = baseObs();
    obs.anchors.top1HoldSupplyPct = 46.5;
    const r = grade(obs, { anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      't1 供 46.5 档位全 none → healthy（I 已退役：独大判读交 holdings_balance 题档，D3.32 题面判据已含主口径占总供应量%）');
    // 独大+低活跃共存（CD69 实形）：I 退役后由 E 承载 unhealthy
    const obs5 = baseObs();
    obs5.anchors.top1HoldSupplyPct = 42;
    obs5.activityLevel.bucket = 'low';
    const r5 = grade(obs5, { anchorSellCount: 10 });
    ok(r5.grade === 'unhealthy' && r5.reasons.some((x) => x.code === 'E_low_activity'),
      't1 供 42 + act=low → unhealthy（E 留痕；I 已退役不产 cheat——已知代价：独大铁证形状依赖 holdings 题档 strong 或 J/L）');
  }

  console.log('J.（G19 退役反证，2026-11-17 btv140 BP-T006 食蟹猴二案用户裁定「holdingsBalance 这一臂去掉」）holdings_balance strong 不再产生 unhealthy 拒——题照算照落档，历史 J_holdings_strong 行留档');
  {
    // CD122 形状：top1 供 25.6 + 并集 40.1% → holdings_balance strong
    // G19 起 J 臂退役：不再 unhealthy（持仓维度拦截由 A/D 通道与豁免臂成色另行承载）
    const obs = withExt(baseObs(), 'holdings_balance', 'strong');
    obs.anchors.top1HoldSupplyPct = 25.6;
    obs.anchors.top1Top2HoldSupplyPct = 35.0;
    obs.anchors.t1PlusClusterSupplyPct = 40.1;
    const r = grade(obs, { anchorSellCount: 5 });
    ok(r.grade === 'healthy' && !r.reasons.some((x) => x.code === 'J_holdings_strong'),
      'holdings_balance strong（CD122 形状）→ G19 退役不再 unhealthy（J_holdings_strong 不产出）');
    // moderate 同样不触发（J 全档退役）
    const obs2 = withExt(baseObs(), 'holdings_balance', 'moderate');
    ok(grade(obs2, { anchorSellCount: 5 }).grade === 'healthy',
      'holdings_balance moderate → 不触发');
    // 旧档断代（<D3.32 答案缺席）不触发——黄金集重放零变化防线
    const obs3 = baseObs();
    delete obs3.extLevels.holdings_balance;
    ok(grade(obs3, { anchorSellCount: 5 }).grade === 'healthy',
      'holdings_balance 键缺席（旧档断代/容缺）→ J 不触发（EXT 容缺语义同族，黄金集 34/42 沿用防线）');
    // 单一独大 46.5 同时 holdings strong（CD69 形状）：I 已退役（G9）、J 退役（G19）
    // → 持仓维度不再产 unhealthy；独大形状的拦截依赖 A/D 通道与豁免臂成色（G19 已知代价）
    const obs4 = withExt(baseObs(), 'holdings_balance', 'strong');
    obs4.anchors.top1HoldSupplyPct = 46.5;
    const r4 = grade(obs4, { anchorSellCount: 10 });
    ok(r4.grade === 'healthy' && !r4.reasons.some((x) => x.code === 'J_holdings_strong'),
      'holdings strong + t1 供 46.5 → G19 退役不再 unhealthy（独大数值不直读，档位通道已撤）');
  }

  console.log('D.（G20/CD416 退役反证）famous 主导不再触发——cheat 门 famous 整链拆除');
  {
    const obs = baseObs();
    // 旧调用形状（extras 携带 famous 三键）在 G20 下全部 healthy——多余键无害忽略
    ok(grade(obs, { famousLevel: 'high', anchorSellCount: 10 }).grade === 'healthy',
      'G20 退役反证: famousLevel=high 单独 → healthy（D 通道拆除；拦截载体=BP ③桶+卖侧臂）');
    ok(grade(obs, { famousLevel: 'mid', anchorSellCount: 10 }).grade === 'healthy',
      'famousLevel=mid 不触发（历史行为不变方向）');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 45, anchorSellCount: 10 }).grade === 'healthy',
      'G20 退役反证: dom=high ∧ top3=45（G5 集中形线）→ 不再触发');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 87, anchorSellCount: 10 }).grade === 'healthy',
      'G20 退役反证: CD63 集中形（top3=87）→ 不再触发');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 20, famousGroupBuyPct: 92.9, anchorSellCount: 10 }).grade === 'healthy',
      'G20 退役反证: CD103 死盘形状（组织买=92.9）→ 不再触发');
    const nb = grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 40.9, famousGroupBuyPct: 75.7, anchorSellCount: 10 });
    ok(nb.grade === 'healthy' && !nb.reasons.some((x) => /D_famous/.test(x.code)),
      'G20 退役反证: CD323 huh 双贴线形状 → 不再触发（历史 D_famous_near_band 码停产）');
  }

  console.log('E. 活跃度低（G2 简化：唯一豁免=burst；t1流/卖笔豁免已撤销）');
  {
    const obs = baseObs();
    obs.activityLevel.bucket = 'low';
    obs.anchors.top1HoldCircPct = 10;
    const r = grade(obs, { anchorSellCount: 1 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'E_low_activity',
      'act=low ∧ sbw≠burst → unhealthy（G2 用户裁定「活跃度这一臂为 low 的也判 unhealthy」）');
    // 唯一豁免：sbw=burst（通道层双保险；主修正=D3.27 题面 burst 反锚）
    withExt(obs, 'stall_burst_wave', 'burst');
    ok(grade(obs, { anchorSellCount: 1 }).grade === 'healthy',
      '豁免：sbw=burst（停滞突发不算活跃度低——主修正 D3.27 题面，通道层双保险）');
    // 撤销的豁免①：t1流≥40 不再豁免（吃独食家族 CD105/CD122 改判 unhealthy）
    withExt(obs, 'stall_burst_wave', 'none');
    obs.anchors.top1HoldCircPct = 40;
    ok(grade(obs, { anchorSellCount: 1 }).grade === 'unhealthy',
      't1 流 40 恰界不再豁免（G2 撤销吃独食豁免——E 只看 act+burst）');
    // 撤销的豁免②：卖笔≥2 不再豁免（对手盘 CD107 改判 unhealthy）
    obs.anchors.top1HoldCircPct = 10;
    ok(grade(obs, { anchorSellCount: 2 }).grade === 'unhealthy',
      '卖笔 2 恰界不再豁免（G2 撤销对手盘豁免——anchorSellCount 不再被 E 消费）');
    // sbw null 按「非 burst」处理（无证据不豁免）
    const obs2 = baseObs();
    obs2.activityLevel.bucket = 'low';
    obs2.anchors.top1HoldCircPct = 10;
    obs2.extLevels.stall_burst_wave = null;
    ok(grade(obs2, { anchorSellCount: 1 }).grade === 'unhealthy',
      'sbw null 按 non-burst（burst 豁免需在场证据，已知容缺例外）');
    // anchorSellCount 缺席（旧 digest 重放）→ E 照触发（G2 起不消费该键）
    ok(grade((() => { const o = baseObs(); o.activityLevel.bucket = 'low'; o.anchors.top1HoldCircPct = 10; return o; })(), { famousLevel: null }).grade === 'unhealthy',
      'anchorSellCount 缺席 → E 照触发（G2 起不消费该键，旧档重放兼容）');
    // act null → E 不触发
    const obs3 = baseObs();
    obs3.activityLevel = null;
    obs3.anchors.top1HoldCircPct = 10;
    ok(grade(obs3, { anchorSellCount: 0 }).grade === 'healthy',
      'activityLevel null → E 不触发');
  }

  console.log('E2. G8 弱 burst 代码臂已随 G18 退役（2026-11-11 CD397 族三 14 票取证收官，用户四条裁定第三条「burst 的判定被代码魔改了，我的建议依然是不要魔改，用 Jev 判断」——E 通道恢复 sbw 单条件，弱波排除教学移交 sbw 题 D3.67 题面四判轴；定线研究=tmp-burst-strength@182 17 票 sbw=burst 豁免挡住的全是自己人（14 票 Jev act 已判 low）：弱波判定权归 Jev 后「gap 60/买 1.04/户 12」这类形状由题面跨度/尘埃/流向轴拒掉 sbw=burst 本身，E 自然恢复拦截）');
  {
    const mk = (anchors, sbw = 'burst') => {
      const o = baseObs();
      o.activityLevel.bucket = 'low';
      o.anchors.top1HoldCircPct = 10;
      o.extLevels.stall_burst_wave = sbw;
      Object.assign(o.anchors, anchors);
      return o;
    };
    // G8 退役反证一：原「弱 burst 三键全中」形状（gap 60/买 1.04/户 12）在 G18 下豁免维持
    // ——代码不再以数值推翻 Jev 的 burst 判定（旧 G8 会产 E_low_activity_weak_burst 拦截）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 1.04, burstWaveWallets: 12 }), { anchorSellCount: 1 }).grade === 'healthy',
      'G18 反证：弱波三键全中（gap 60/买 1.04/户 12）∧ sbw=burst → 豁免维持（代码硬线退役——判定权归 Jev，弱波形状由 D3.67 题面拒 sbw 本身）');
    // G8 退役反证二：波键极端小（买 0.2/户 3）∧ sbw=burst → 豁免照维持（无任何数值下限）
    ok(grade(mk({ burstMaxGapSec: 59, burstWaveBuyBnb: 0.2, burstWaveWallets: 3 }), { famousLevel: null }).grade === 'healthy'
      && grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 0.01, burstWaveWallets: 1 }), { famousLevel: null }).grade === 'healthy',
      'G18 反证：波键极端小 ∧ sbw=burst → 豁免照维持（零数值下限——「停滞后只涌入一点小流量」的排除教学移交题面）');
    // 三键任一 null（<G8 旧档断代）→ 豁免维持（与 G8 时代同结果——黄金集重放零变化）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: null, burstWaveWallets: 12 }), { famousLevel: null }).grade === 'healthy'
      && grade(mk({ burstMaxGapSec: null, burstWaveBuyBnb: 0.2, burstWaveWallets: 3 }), { famousLevel: null }).grade === 'healthy',
      '三键任一 null（旧档断代）→ 豁免维持（G18 与 G8-null 同结果——存档重放零变化）');
    // sbw≠burst 主路径 → E_low_activity 主 code，weak_burst 码全域不再产出
    const r2 = grade(mk({ burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5 }, 'none'), { famousLevel: null });
    ok(r2.grade === 'unhealthy' && r2.reasons.some((x) => x.code === 'E_low_activity'),
      'sbw≠burst → E_low_activity（弱波键在场不改变主路径——锚已纯观察）');
    const fs = require('fs');
    const gradeSrc = fs.readFileSync(require.resolve('../src/market-analysis/cheat-grade.js'), 'utf8');
    // 剥注释后检查（头注/行注的案史留档不算产出）；再锁 reasons.push 无 weak_burst 形状
    const gradeNoComments = gradeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!gradeNoComments.includes('E_low_activity_weak_burst'),
      '源码锁：cheat-grade.js 剥注释后零 E_low_activity_weak_burst（G8 臂整链退役——gradeObs 不再产出该码，头注案史留档不算）');
  }

  console.log('K/L. 零买入纯卖方通道+insider 联立臂（G8 双修，2026-11-02 批次六 CD5 用户裁定「创建者已经卖了，而且应该是通过代币转入的方式卖的，你检查下，这也是一个明显的作弊行为」——链上实锤=创建块同块 Transfer 分光 3.18 亿 token、6 接收户零买入同块卖出 Σ2.09 BNB 占总卖 45%；Transfer 不在采集域，swap 侧写=零买入纯卖方）');
  {
    const mk = (noBuySellPct, insider = 'none') => {
      const o = baseObs();
      if (noBuySellPct !== null) o.anchors.noBuySellPct = noBuySellPct;
      if (insider !== 'none') o.extLevels.insider_supply_sell = insider;
      return o;
    };
    // K 已退役（G9）：noBuySellPct 单锚不再产档（40 恰界反证）
    const rK = grade(mk(40), { famousLevel: null });
    ok(rK.grade === 'healthy' && rK.reasons.length === 0,
      'K 退役反证：noBuySellPct=40 档位全 none → healthy（纯卖方现象改由 L insider 档位联立承载）');
    ok(grade(mk(45, null), { famousLevel: null }).grade === 'healthy',
      'K 退役反证：45 高值无档位同样不判罚');
    // L：insider 档位联立（25 线=档位证据补足数值证据；G9 后纯卖方唯一通道）
    const rL = grade(mk(25, 'moderate'), { famousLevel: null });
    ok(rL.grade === 'unhealthy' && rL.reasons.some((x) => x.code === 'L_insider_sell25'),
      'L：insider moderate ∧ 25 恰界 → unhealthy L_insider_sell25');
    const rLs = grade(mk(24.9, 'strong'), { famousLevel: null });
    ok(rLs.grade === 'cheat' && rLs.reasons.some((x) => x.code === 'A_strong:insider_supply_sell')
      && !rLs.reasons.some((x) => x.code.startsWith('L_')),
      'L：insider strong ∧ 24.9 → L 不触发（CD60 反例形状恰被排除；strong 自身走 A 主判 cheat 是既有行为，L 联立线独立不冒充）');
    ok(grade(mk(40, 'weak'), { famousLevel: null }).grade === 'healthy',
      'L：insider weak ∧ 40 → 不触发（weak 不在 {moderate,strong}；K 退役后无单锚兜底）');
    ok(grade(mk(40, null), { famousLevel: null }).grade === 'healthy',
      'L：insider null（旧档断代）不触发（EXT 容缺同族）');
    // insider strong ∧ 45：strong 走 A 主判取最重 cheat + L 联立留痕（K 码已随 G9 退役）
    const rKL = grade(mk(45, 'strong'), { famousLevel: null });
    ok(rKL.grade === 'cheat' && rKL.reasons.some((x) => x.code === 'A_strong:insider_supply_sell')
      && rKL.reasons.some((x) => x.code === 'L_insider_sell45'),
      'A+L 同中双留痕（insider strong ∧ 45 取最重 cheat=A 主判既有行为）');
  }

  console.log('R.（G22 退役，2026-11-17 CD419/D3.77——abnormal_behavior_ratio 整题删除：泛异常兜底题与分工不符，不普世异常形状承接载体=FP 因子门（T143 FP 族）而非泛 cheat 题；用户裁定原话「abnormal_behavior_ratio 是针对一些不普世的异常现象，也删除吧，分工问题，如果发现有一些异常现象在 cheat 的其它锚不好控，会增加因子过滤锚，这个比较泛的 cheat 锚就不保留了」）');
  {
    const mkP = (bucket) => {
      const o = baseObs();
      if (bucket !== null) o.abnormalBehavior = { bucket, prob: 0.8 };
      return o;
    };
    const rMin = grade(mkP('dominant'), { famousLevel: null });
    ok(rMin.grade === 'healthy' && rMin.reasons.every((x) => x.code !== 'R_abnormal_dominant'),
      'R 退役反证：旧档 dominant 观测在场（历史 digest 重放形状）不再触发任何 R 留痕（通道已随题删除——旧档重放零变化防线）');
    ok(grade(mkP('negligible'), { famousLevel: null }).grade === 'healthy'
      && grade(mkP('noticeable'), { famousLevel: null }).grade === 'healthy'
      && grade(mkP('unclear'), { famousLevel: null }).grade === 'healthy',
      'R 退役反证：全桶位旧观测同落 healthy（通道不存在=桶位无语义）');
    ok(grade(mkP(null), { famousLevel: null }).grade === 'healthy',
      'R 退役反证：abnormalBehavior 缺席照常 healthy（黄金集重放零变化防线）');
    // 旧键断代反证保持：participation 旧顶层键在场不消费
    const obsOld = baseObs();
    obsOld.participation = { bucket: 'minimal_genuine', prob: 0.9 };
    ok(grade(obsOld, { famousLevel: null }).grade === 'healthy',
      'R 退役反证：旧顶层键 participation（D3.38 前 obs 形状）在场不消费（断代防线随通道退役继续成立）');
    // 与 A cheat 叠加形状：A 单现象铁证仍独撑 cheat（R 留痕不再产出）
    const obsBoth = mkP('dominant');
    withExt(obsBoth, 'wash_pair', 'strong');
    const rBoth = grade(obsBoth, { famousLevel: null });
    ok(rBoth.grade === 'cheat' && rBoth.reasons.some((x) => x.code === 'A_strong:wash_pair')
      && rBoth.reasons.every((x) => x.code !== 'R_abnormal_dominant'),
      'R 退役反证：A_strong:wash_pair 独撑 cheat、R 留痕不产出（泛异常形状的拦截载体移交 FP 因子门）');
    // anchors 四键参考数值不进门（纯观察留档反证——数值再高无档不罚）
    const obsAnchor = mkP(null);
    obsAnchor.anchors.maxBlockBuyCount = 8;
    obsAnchor.anchors.maxBlockBuyPct = 58.8;
    obsAnchor.anchors.sameAmountWalletPct = 66.7;
    ok(grade(obsAnchor, { famousLevel: null }).grade === 'healthy',
      'R 侧锚反证：协同买入参考四键纯观察留档——数值在场无档不触发（题已删无判读载体，FP 因子门另立锚）');
  }

  console.log('M. 超高活跃度通道（G14 新增，CD138/2026-11-03 v68 成交票扩集第一批——activity_level=ultra→unhealthy M_hyper_activity 拒买级。用户裁定「CD138 活跃度过高我建议给 unhealthy……我给 unhealthy」+sniper 两口径否证（跨盘画像 isSniperProfile 命中 meme 0.1% 买入反而 Mamesuke 42.8%；创建后 ≤10s 首买覆盖 meme 73% vs Mamesuke 91%=打新盘全员早期买入常态）后续「就超高活跃度 unhealthy 吧」「接受 Mamesuke 错杀」：定线 v68 20 票 ultra 六票 ticksPerMin 86.7-436、high 档最高 65.5 断崖清晰——「过度密集/活跃度太过」载体就是活跃度档本身；与 E 通道 act=low 对称（Jev 判档、代码只映射动作）；已知代价=CD141 Mamesuke（86.67/min ultra@0.50 人工 healthy）被错杀——用户明示接受（拒买可重判）');
  {
    const mkA = (bucket) => {
      const o = baseObs();
      if (bucket !== null) o.activityLevel = { bucket, prob: 0.7 };
      return o;
    };
    const rU = grade(mkA('ultra'), { famousLevel: null });
    ok(rU.grade === 'unhealthy' && rU.reasons.some((x) => x.code === 'M_hyper_activity' && x.level === 'unhealthy'),
      'M：ultra → unhealthy M_hyper_activity（拒买级非拉黑级——CD134 缺省门留重判域，不用尽不拉黑）');
    ok(grade(mkA('mid'), { famousLevel: null }).grade === 'healthy'
      && grade(mkA('high'), { famousLevel: null }).grade === 'healthy'
      && grade(mkA('low'), { famousLevel: null }).grade !== 'healthy',
      'M：mid/high 不触发（high 最高 65.5 ticks/min 断崖之下）；low 走 E 通道不受 M 影响（对称共存反证）');
    ok(grade(mkA(null), { famousLevel: null }).grade === 'healthy',
      'M：activityLevel null（题缺席/旧档断代）不触发（黄金集重放零变化防线）');
    // Mamesuke 错杀锁定（G14 立法已知代价——ultra∧其余题档全弱照 unhealthy，用户明示接受）
    const mamesuke = mkA('ultra');
    mamesuke.phenomena.equal_amount_split = 'moderate';
    withExt(mamesuke, 'holdings_balance', 'weak');
    const rM = grade(mamesuke, { famousLevel: null });
    ok(rM.grade === 'unhealthy' && rM.reasons.length === 1 && rM.reasons[0].code === 'M_hyper_activity',
      'M：Mamesuke 错杀形状锁定（ultra@其余全 moderate/weak 无其他通道——仅 M 单留痕 unhealthy，2026-11-03 用户明示接受的立法代价）');
    // 与 E 对称反证：同票 act 单值不可能双触发；ultra 票叠加 A cheat 取最重
    const obsCheat = mkA('ultra');
    withExt(obsCheat, 'wash_pair', 'strong');
    const rCheat = grade(obsCheat, { famousLevel: null });
    ok(rCheat.grade === 'cheat' && rCheat.reasons.some((x) => x.code === 'M_hyper_activity'),
      'M+A 同中双留痕取最重 cheat（M 不遮蔽留痕；CD140 币安兄弟 ultra∧holdings strong 同构=unhealthy 多通道留痕）');
  }

  console.log('N. 聚合路由入口占比通道（G17 新增，2026-11-05 CD374/CD350 侦察立项——routerEntryBuyPct<10% 且非 null → unhealthy N_no_retail_entry<值> 拒买级。用户提案「把 GMGN 路由的流量占比给过去，如果太低就不行」+裁定「门可以加」；363 票 9 址口径分布定线：healthy 52 票 min 23.8/中位 75、strongbacked 8 票 min 50、<10% 全在 cheat 17+unhealthy 4——散户入场通道份额=笔数口径（金额口径被直连单笔大户稀释，CD36 GMGN 单址 5.9% 误伤候选 vs 9 址合计 23.8%=healthy 组 min）；锚=纯代码数值门不进 state/题面（与 E 弱 burst 代码臂同族）；null（买 <15 笔 ROUTER_ENTRY_MIN_BUYS 样本薄/零买入/<D3.62 旧档断代缺键）fail-open 不触发；**独立通道不进 A 主判**');
  {
    const mkN = (pct) => { const o = baseObs(); o.anchors.routerEntryBuyPct = pct; return o; };
    ok(grade(mkN(4.2), { famousLevel: null }).grade === 'unhealthy'
      && grade(mkN(4.2), { famousLevel: null }).reasons.some((x) => x.level === 'unhealthy' && x.code === 'N_no_retail_entry4.2'),
      'N：4.2% → unhealthy N_no_retail_entry4.2（码带一位小数=锚精度，不四舍五入吞界）');
    ok(grade(mkN(9.9), { famousLevel: null }).reasons.some((x) => x.code === 'N_no_retail_entry9.9')
      && grade(mkN(9.9), { famousLevel: null }).grade === 'unhealthy',
      'N：9.9 贴线界内 → 触发（码显 9.9 而非 toFixed(0) 舍成 10 的误导形状）');
    ok(grade(mkN(10), { famousLevel: null }).grade === 'healthy'
      && grade(mkN(10), { famousLevel: null }).reasons.length === 0,
      'N：恰 10.0 不触发（严格小于——10.0 已是「有一成散户入口」的合格形状；healthy 组 min 23.8 远离界线）');
    ok(grade(mkN(null), { famousLevel: null }).grade === 'healthy'
      && grade(mkN(null), { famousLevel: null }).reasons.length === 0,
      'N：null（<15 笔样本薄/零买入/<D3.62 旧档断代）不触发 fail-open（黄金集重放零变化防线——G17 对 <15 笔票零影响）');
    ok(grade(mkN(75), { famousLevel: null }).grade === 'healthy',
      'N：75%（healthy 组中位）不触发（门只判低占比方向=入口缺失；2026-10-31 删 routerPct 高占比裁定不回潮）');
    // 与 A 主判隔离：N 触发不升 cheat（独立拒买级通道，取最重仍由 A 决定）
    const obsA = mkN(2.1);
    withExt(obsA, 'wash_pair', 'strong');
    const rA = grade(obsA, { famousLevel: null });
    ok(rA.grade === 'cheat' && rA.reasons.some((x) => x.code === 'N_no_retail_entry2.1'),
      'N+A 同中双留痕取最重 cheat（N 不遮蔽留痕不升档——拒买级非拉黑级）');
  }

  console.log('F.（G9/G10 退役反证）sbHold 纯数值不产档——G10 起门侧消费全撤（锚照产只喂 Jev/条件串）');
  {
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 50;
    const r = grade(obs, { anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'sbHold=50 恰界档位全 none → healthy（F 已退役；G10 起 B 联立/豁免臂消费也全撤——sbHold 是活跃度函数非组织性度量）');
  }

  console.log('G.（G11 退役反证）bd=high 不再产档——G 通道整体退役（2026-11-02 CD133 用户裁定「GMGN的散户是有默认交易额的，大多数都是0.1/0.05，大户则是 0.2/0.25/0.3 之类的，这要是能跨区块，误伤就太大了！同块同额度误伤可能小一些，可以作为参考。如果这种死指标不好用，还是把原始数据输入给Jev，通过现象描述，去综合判断与考量里面是否有协同行为吧」——豁免前提 bundleBuyPct 的 sb∪eq 并集圈定吞前端默认档散户，骨架塌；协同现象由 A 题档承载（D3.34 题面反锚）；bd 档位照判照投影门侧零消费）');
  {
    const obs = baseObs();
    obs.bundledDominance.bucket = 'high';
    const r = grade(obs, { anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'G11 反证: bd=high 单独 → healthy 零留痕（通道退役——簇圈定死指标门全线退出）');
    // 三锚任意组合不再有门（G10 期豁免/触发二分整体消失）
    const obs6b = baseObs();
    obs6b.bundledDominance.bucket = 'high';
    obs6b.anchors.sameBlockHoldPct = 90;
    obs6b.anchors.equalBandHoldPct = 85;
    obs6b.anchors.bundleBuyPct = 30;
    ok(grade(obs6b, { anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ sbHold=90 ∧ eqHold=85 ∧ bundleBuy=30 → healthy（三锚门侧消费全无）');
    const obs15 = baseObs();
    obs15.bundledDominance.bucket = 'high';
    obs15.anchors.bundleBuyPct = 80;
    ok(grade(obs15, { anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ bundleBuy=80（G10 期死盘形状触发点）→ healthy（承接死盘形状不再由死指标拦，交题档判读）');
    const obs16 = baseObs();
    obs16.bundledDominance.bucket = 'high';
    obs16.anchors.bundleBuyPct = null;
    ok(grade(obs16, { anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ bundleBuy=null（G10 期 fail-closed 触发点）→ healthy');
    // CD121/CD128 形状重放：豁免逻辑整个消失（G_bd 拒买级偏差票随通道退役回正）
    const obs10 = baseObs();
    obs10.bundledDominance.bucket = 'high';
    obs10.anchors.sameBlockHoldPct = 11.4;
    obs10.anchors.equalBandHoldPct = 54.0;
    ok(grade(obs10, { anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: CD121 形状（bundleBuy 无键，G10 期触发点）→ healthy 回正');
    const obs11 = baseObs();
    obs11.bundledDominance.bucket = 'high';
    obs11.anchors.sameBlockHoldPct = 12.6;
    obs11.anchors.equalBandHoldPct = 29.2;
    obs11.anchors.bundleBuyPct = 30;
    ok(grade(obs11, { anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: CD128 形状（G10 期豁免点）→ healthy（豁免/触发二分整体消失）');
    // mid 档位不产档（退役前后一致）
    const obsMid = baseObs();
    obsMid.bundledDominance.bucket = 'mid';
    ok(grade(obsMid, { anchorSellCount: 10 }).grade === 'healthy',
      'bd=mid → healthy（退役前后一致）');
    // 与 cheat 通道叠加：bd 不再叠加留痕
    const obs2 = baseObs();
    obs2.bundledDominance.bucket = 'high';
    withExt(obs2, 'amount_tiering', 'strong');
    const r2 = grade(obs2, { anchorSellCount: 10 });
    ok(r2.grade === 'cheat' && r2.reasons.every((x) => x.code !== 'G_bundled_dominance'),
      'G11 反证: bd=high + A_strong → cheat 取最重但零 G 留痕（通道不存在）');
    // 容缺：null/bucket 缺失 → healthy（语义平凡成立）
    const obs4 = baseObs();
    obs4.bundledDominance = null;
    ok(grade(obs4, { anchorSellCount: 10 }).grade === 'healthy',
      'bundledDominance null（旧档断代）→ healthy');
    const obs5 = baseObs();
    obs5.bundledDominance = {};
    ok(grade(obs5, { anchorSellCount: 10 }).grade === 'healthy',
      'bucket 缺失 → healthy');
  }

  console.log('优先级与容缺');
  {
    // 多通道叠加：cheat>unhealthy（A strong + E low + L insider 三条——D 已随
    // G20/CD416 退役、R 已随 G22/CD419 随题退役，凑数通道换 L（insider 联立臂））
    const obs = baseObs();
    withExt(obs, 'amount_tiering', 'strong');
    obs.anchors.sameBlockHoldPct = 60;
    obs.activityLevel.bucket = 'low';
    obs.anchors.top1HoldCircPct = 10;
    withExt(obs, 'insider_supply_sell', 'moderate');
    obs.anchors.noBuySellPct = 30;
    const r = grade(obs, { famousLevel: 'high', anchorSellCount: 1 });
    ok(r.grade === 'cheat' && r.reasons.length >= 3,
      `多通道叠加 reasons 全留痕但 grade 取最重（实际 ${r.grade}/${r.reasons.length} 条）`);
    // 全容缺（旧档断代形状）→ healthy
    const obs2 = {
      phenomena: null, extLevels: null, activityLevel: null, bundledDominance: null, anchors: null,
    };
    const r2 = gradeObservation(obs2, {});
    ok(r2.grade === 'healthy' && r2.reasons.length === 0,
      '全 null 旧档 → healthy 放行（fail-open：档位 null 不计、锚 null 不触发）');
    // 负数/NaN 锚按缺席
    const obs3 = baseObs();
    obs3.anchors.sameBlockHoldPct = -1;
    const r3 = grade(obs3, { anchorSellCount: 10 });
    ok(r3.grade === 'healthy', '负数锚按缺席（绝不冒充触发门）');
    const obs4 = baseObs();
    obs4.anchors.sameBlockHoldPct = NaN;
    ok(grade(obs4, { anchorSellCount: 10 }).grade === 'healthy', 'NaN 锚按缺席');
    ok(gradeObservation(null, null).grade === 'healthy', 'observation 整体 null → healthy（不抛）');
  }

  console.log('42 票黄金集对拍（D3.26 存档+fixtures expect；G3/G4 重放零变化）');
  {
    const golden = require('./cheat-detection/data/cheat-grade-golden-42.json');
    ok(golden.rulesVersion === CHEAT_GRADE_RULES_VERSION, '黄金集版本与规则常量一致');
    ok(golden.cases.length === 42, '42 票');
    let agree = 0;
    const diffs = [];
    for (const c of golden.cases) {
      const r = gradeObservation(c.observation, c.extras || {});
      if (r.grade === c.expect) agree++;
      else diffs.push(`${c.caseId}:${c.expect}>${r.grade}`);
    }
    ok(agree === 28, `对拍 28/42 一致（实际 ${agree}/42——**G20/CD416 D 通道退役**（2026-11-17 用户裁定「cheat 门的 famous 锚删除」）：较 G19 32 净失 CD103/CD113/CD114/CD116 四票正命中（expect=unhealthy 由 D 承载——CD103/CD113=G6 组织买 ≥80 死盘形状案、CD114/CD116 同族，退役后失载放行 healthy——「宁可放过不误伤」方向的裁定代价，famous 拦截载体移交 BP ③桶+卖侧臂）。**G11=G 通道整体退役**（2026-11-02 CD133 用户裁定——sb∪eq 簇圈定把前端默认档散户整档吞入，死指标门全线退出，协同现象由 A 题档承载（D3.34 题面反锚））：较 G10 34 净失 CD95/CD100 两票正命中；CD97/CD119/CD121 三票 G 拦截腿消失（承接路径=D3.34 重析题档升 strong 走 A 通道，随 128 票攒批对拍验证）。**改规则破坏此数须重新用户裁定**`);
    ok(diffs.join(',') === 'CD56:cheat>healthy,CD84:healthy>unhealthy,CD95:unhealthy>healthy,CD97:cheat>healthy,CD100:unhealthy>healthy,CD103:unhealthy>healthy,CD105:healthy>unhealthy,CD107:healthy>unhealthy,CD108:cheat>unhealthy,CD113:unhealthy>healthy,CD114:unhealthy>healthy,CD116:unhealthy>healthy,CD119:cheat>healthy,CD121:cheat>healthy',
      `十四票已知偏差锁定（实际 ${diffs.join(',')}）——CD56 版本漂移/CD108 A 降级（与 CD99 人工漂移对称）/
CD103+CD113+CD114+CD116=G20/CD416 D 通道退役失载（famous dom=high 家族 expect=unhealthy 由 D 独撑，拦截载体移交 BP ③桶+卖侧 T133/T136/T161/T137 臂）/
CD95+CD100=G11 退役失载（G 通道黄金集仅存两票正命中 expect=unhealthy，bd=high∧bundleBuy 无键触发点，随通道退役放行）/CD97+CD119+CD121=G 拦截腿消失（expect=cheat，A 通道档位无 strong 是 Jev 旧档判档——sbHold 89.9 的 CD97 曾由 C_sbHold90 拦（G9 退役）再由 G 拦（G11 退役）两轮退出，D3.34 重析承接）/
CD84+CD105+CD107=G2 E 简化撤豁免代价（用户裁定「活跃度 low 也判 unhealthy，burst 不判 low」：
t1流吃独食豁免（CD105）+卖笔对手盘豁免（CD107）撤销+CD84 act=low 搁置票；**本表为旧档位
digest 重放口径——CD105 在 burst 名单，D3.27 题面 burst 反锚重析后 act 应翻非 low 回 healthy**；
CD122 批次五人工改 unhealthy 已出偏差表——机器 E 通道与人工一致化）`);
  }

  // ── G1 因子化（2026-11-01 用户指令）：档位→数值映射表 + levelsFromObservation ──
  console.log('\n因子化数值映射（CHEAT_LEVEL_SCORES / levelsFromObservation）');
  {
    ok(CHEAT_LEVEL_SCORES.grade.healthy === 0 && CHEAT_LEVEL_SCORES.grade.unhealthy === 1
      && CHEAT_LEVEL_SCORES.grade.cheat === 2, 'grade 数值序 healthy=0/unhealthy=1/cheat=2（严格递增=严重度）');
    ok(CHEAT_LEVEL_SCORES.level.none === 0 && CHEAT_LEVEL_SCORES.level.weak === 1
      && CHEAT_LEVEL_SCORES.level.moderate === 2 && CHEAT_LEVEL_SCORES.level.strong === 3,
      '四档题数值序 none=0/weak=1/moderate=2/strong=3');
    ok(CHEAT_LEVEL_SCORES.sbw.burst === 1 && CHEAT_LEVEL_SCORES.activity.ultra === 3
      && CHEAT_LEVEL_SCORES.dominance.high === 2, '二桶/活跃度/主导度档各自数值序');
    ok(scoreLevel(CHEAT_LEVEL_SCORES.level, 'extreme') === null
      && scoreLevel(CHEAT_LEVEL_SCORES.level, null) === null
      && scoreLevel(CHEAT_LEVEL_SCORES.sbw, 'strong') === null,
      '未知档位/null → null 不冒充（题集演进新桶不误映射）');
    const r = levelsFromObservation({
      phenomena: { equal_amount_split: 'moderate', coordinated_sell_back: null,
        creator_front_run: 'weak', sell_dispersion: 'none' },
      extLevels: { stall_burst_wave: 'burst', amount_tiering: null,
        same_block_buy_wave: 'strong', insider_supply_sell: 'weak', slow_grind_pump: 'none',
        wash_pair: 'strong', burst_spike_concentration: 'moderate' },
      activityLevel: { bucket: 'low' }, bundledDominance: { bucket: 'mid' },
      abnormalBehavior: { bucket: 'dominant' },
    });
    ok(r.levels.equalAmountSplit === 2 && r.levels.coordinatedSellBack === null
      && r.levels.stallBurstWave === 1
      && r.levels.sameBlockBuyWave === 3 && r.levels.amountTiering === null
      && r.levels.washPair === 3 && r.levels.activityLevel === 0
      && r.levels.burstSpikeConcentration === undefined
      && r.levels.abnormalBehavior === undefined,
      `levelsFromObservation 10 题映射（D3.77/G22 abr 随题退役 11→10 键——fixture 在场旧观测 'dominant' 被忽略键缺席；spike D3.76 同款；实际 ${JSON.stringify(r.levels)}）`);
    ok(r.buckets.sameBlockBuyWave === 'strong' && r.buckets.stallBurstWave === 'burst'
      && r.buckets.washPair === 'strong' && r.buckets.activityLevel === 'low'
      && r.buckets.burstSpikeConcentration === undefined
      && r.buckets.abnormalBehavior === undefined,
      'buckets 字符串原值（metadata 研究留档；spike/abr 键 D3.76/D3.77 同批缺席）');
    const r2 = levelsFromObservation(null);
    ok(Object.values(r2.levels).every((v) => v === null) && Object.keys(r2.levels).length === 10,
      '空观测 → 10 键全 null（D3.77 abr 随题退役 11→10；spike/cr/sbp/holdings/bd 同批先例；容缺不冒充）');
    // 数值锚（用户补点「持仓极不均衡」+D3.28 对敲三键+D3.32 持仓分布五键）：
    // obs.anchors 持仓占比四键 + washPair 三键 + holdings 五键（CD122 实值）
    // （extras famous 数值/档位三键已随 G20/CD416 退役）
    const r3 = levelsFromObservation({
      phenomena: {}, extLevels: {},
      anchors: { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2,
        top1HoldSupplyPct: 25.6, top1HoldCircPct: 53.4,
        washPairCount: 10, washPairSellPct: 95.1, washPairBuyPct: 27.3,
        top2HoldSupplyPct: 9.4, top1Top2HoldSupplyPct: 35.0, top1Top2FirstBuyGapSec: 1,
        clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1 },
    });
    // （extras famousDominancePct/Level 两键已随 G20/CD416 退役——投影键不再产出）
    ok(r3.anchors && r3.anchors.sameBlockHoldPct === 66.1
      && r3.anchors.equalBandHoldPct === 57.2 && r3.anchors.top1HoldSupplyPct === 25.6
      && r3.anchors.top1HoldCircPct === 53.4
      && r3.anchors.famousDominancePct === undefined
      && r3.anchors.washPairCount === 10 && r3.anchors.washPairSellPct === 95.1
      && r3.anchors.washPairBuyPct === 27.3
      && r3.anchors.top2HoldSupplyPct === 9.4 && r3.anchors.top1Top2HoldSupplyPct === 35.0
      && r3.anchors.top1Top2FirstBuyGapSec === 1 && r3.anchors.clusterHoldSupplyPct === 14.5
      && r3.anchors.t1PlusClusterSupplyPct === 40.1,
      `anchors 十二键精确映射含 holdings 五键（CD122 实值 t2 9.4/Σ2 35.0/Δ1s/簇 14.5/∪40.1；实际 ${JSON.stringify(r3.anchors)}）`);
    ok(levelsFromObservation({}, { famousDominanceLevel: 'mid' }).anchors.famousDominance === undefined,
      'G20 退役反证: extras 携带 famousDominanceLevel（旧调用形状）不再产出 famousDominance 键');
    const r5 = levelsFromObservation({ phenomena: {}, extLevels: {},
      anchors: { burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3,
        spikeBuyPctInBurst: 99.3, spikeHoldPctAll: 96.7 } });
    ok(r5.anchors.burstMaxGapSec === 65 && r5.anchors.burstWaveBuyBnb === 1.02
      && r5.anchors.burstWaveWallets === 5 && r5.anchors.noBuySellPct === 63.3
      && r5.anchors.spikeBuyPctInBurst === 99.3 && r5.anchors.spikeHoldPctAll === 96.7
      && r5.anchors.sameBlockHoldPct === null,
      'G8 四新锚+D3.51 尖刺两锚正值精确投影（lib 测试同夹具值：gap65/买1.02/5户/纯卖63.3；尖刺=CD102 实形 99.3/96.7——观察键无门侧消费；未给键照 null）');
    // D3.39→D3.77：abnormalBehavior 档位映射已随题退役（在场旧观测被忽略键缺席）
    // + 协同买入五锚透传照常（纯观察留档）
    const r6 = levelsFromObservation({ phenomena: {}, extLevels: {},
      abnormalBehavior: { bucket: 'dominant' },
      anchors: { maxBlockBuyCount: 8, maxBlockBuyPct: 58.8, maxBlockPreGapSec: 412,
        sameAmountWalletPct: 66.7, creatorPeakHoldSupplyPct: 35.2 } });
    ok(r6.levels.abnormalBehavior === undefined && r6.buckets.abnormalBehavior === undefined
      && r6.anchors.maxBlockBuyCount === 8 && r6.anchors.maxBlockBuyPct === 58.8
      && r6.anchors.maxBlockPreGapSec === 412 && r6.anchors.sameAmountWalletPct === 66.7
      && r6.anchors.creatorPeakHoldSupplyPct === 35.2,
      'D3.39 abr 档位映射随 D3.77/G22 随题退役（在场旧观测 dominant 被忽略键缺席）+五锚透传照常（纯观察——FA cheatMaxBlock* 等投影原料）');
    // D3.53：精确等额同块簇三键透传（CD160——**无门侧消费**：用户裁定「把这个
    // 现象描述出来给 Jev」，state 事实行+FA 投影同源；无合格簇→null 不冒充）
    const r7 = levelsFromObservation({ phenomena: {}, extLevels: {},
      anchors: { exactEqualBlockBuyPct: 97.1, exactEqualBlockClusterCount: 3, exactEqualBlockMaxWallets: 7 } });
    ok(r7.anchors.exactEqualBlockBuyPct === 97.1 && r7.anchors.exactEqualBlockClusterCount === 3
      && r7.anchors.exactEqualBlockMaxWallets === 7
      && levelsFromObservation({ phenomena: {}, extLevels: {} }).anchors.exactEqualBlockBuyPct === null,
      'D3.53 exactEqualBlock 三键透传（0xf5e6 实形 97.1/3 簇/7 钱包——FA cheatExactEqualBlockBuyPct 投影原料；未给键照 null；gradeObservation 全通道零消费=观察键）');
    ok(r6.levels.realParticipation === undefined,
      'levels 旧键 realParticipation 不得残留（D3.39 改名=换键；D3.77 起 realParticipation/abnormalBehavior 两键均无）');
    ok(levelsFromObservation({ phenomena: {}, extLevels: {}, abnormalBehavior: { bucket: 'unclear' } }).levels.abnormalBehavior === undefined
      && levelsFromObservation({ phenomena: {}, extLevels: {} }).levels.abnormalBehavior === undefined
      && levelsFromObservation({ phenomena: {}, extLevels: {}, participation: { bucket: 'minimal_genuine' } }).levels.abnormalBehavior === undefined,
      'abnormalBehavior 全形状（unclear/缺题/旧键 participation 在场）→ 键缺席 undefined（D3.77 随题退役——回测/黄金集重放零变化防线）');
    const r4 = levelsFromObservation({}, { famousDominancePct: -3, famousDominanceLevel: 'extreme' });
    ok(r4.anchors.sameBlockHoldPct === null && r4.anchors.top1HoldCircPct === null
      && r4.anchors.famousDominancePct === undefined && r4.anchors.famousDominance === undefined,
      '锚缺席 → 数值 null 不冒充；famous 三键 G20/CD416 已退役不再产出（extras 携带=无害忽略）');
  }

  // ── CD159 强庄形状规则（SB1，§七.5「曾经命中」粘滞的当轮判定纯函数）──
  {
    const hit = strongbackerShapeHit;
    ok(STRONGBACKER_RULE_VERSION === 'SB1' && STRONGBACKER_RULE.burstWaveBuyBnbMin === 2.2
      && STRONGBACKER_RULE.top2HoldSupplyPctMin === 4.5 && STRONGBACKER_RULE.sameAmountWalletPctMax === 15,
      'SB1 阈值常量锁定（波资金≥2.2 ∧ 第二大户≥4.5 ∧ 等额<15——§七.5 网格定形值；改值=改统计口径须重跑对拍+同步台账）');
    const base = { burstWaveBuyBnb: 2.8, top2HoldSupplyPct: 6.0, sameAmountWalletPct: 11, washPairCount: null, activityLevel: 'mid' };
    ok(hit(base) === true, '全条件满足 → 命中（CD21 首锚形状 2.8/6.0/11）');
    ok(hit({ ...base, burstWaveBuyBnb: 2.19 }) === false
      && hit({ ...base, top2HoldSupplyPct: 4.49 }) === false
      && hit({ ...base, sameAmountWalletPct: 15 }) === false,
      '三数值腿边界外不命中（2.2/4.5/15 恰外）');
    ok(hit({ ...base, burstWaveBuyBnb: 2.2, top2HoldSupplyPct: 4.5, sameAmountWalletPct: 14.99 }) === true,
      '边界含等（≥2.2/≥4.5 且 <15）');
    ok(hit({ ...base, sameAmountWalletPct: null }) === false,
      'sameAmountWalletPct null=无等额簇按不过（研究口径 ??99 保守——null 语义即统计口径，改语义须重跑 §七.5）');
    ok(hit({ ...base, washPairCount: 3 }) === false
      && hit({ ...base, washPairCount: 0 }) === true,
      'washPairCount>0 剔（对敲=强庄从不同向）；0 命中');
    ok(hit({ ...base, activityLevel: 'low' }) === false
      && hit({ ...base, activityLevel: null }) === true,
      'act=low 剔（死盘）；null（dt 缺失）按过（排除臂缺证据不剔）');
    ok(hit(null) === false && hit(undefined) === false && hit({}) === false,
      'derived 缺席/空 → false（fail-closed 不冒充）');
    // 零门效应防线：规则绝不进 gradeObservation（G15 不变，黄金集重放零变化）
    const g0 = gradeObservation({ phenomena: {}, extLevels: {}, anchors: {} }, {});
    ok(g0.grade === 'healthy' && g0.version === CHEAT_GRADE_RULES_VERSION,
      'SB1 观察臂零门效应（gradeObservation 不消费强庄形状——G15 版本不变）');
  }

  // ═════ T205/G23 E 通道阶段前提（金狗 GWC 0xb71209cb…7777 复活拉回案） ═════
  // 灰度 extras.enableActStageCold（CheatCheckService gate.actStageColdExempt）∧
  // extras.stageAthVsLaunchPct<80（未火过）→ E_low_activity 不产 unhealthy——低活跃
  // 票最终守门员（FP act 臂/AF1 reject_low 同原则贯通 act-stage.js 共享线）；
  // ath null=照拦；灰度关=零行为。
  {
    const mkLow = () => { const o = baseObs(); o.activityLevel.bucket = 'low'; o.anchors.top1HoldCircPct = 10; return o; };
    const gCold = grade(mkLow(), { anchorSellCount: 1, enableActStageCold: true, stageAthVsLaunchPct: 43.5 });
    ok(gCold.grade === 'healthy' && !gCold.reasons.some((x) => x.code === 'E_low_activity'),
      'G23：灰度开∧未火过（ath=43.5 GWC 案值）→ E 不产 unhealthy（cheat 门放行进 BP）');
    const gEdge = grade(mkLow(), { anchorSellCount: 1, enableActStageCold: true, stageAthVsLaunchPct: 79.9 });
    ok(gEdge.grade === 'healthy', 'G23 边界：ath=79.9 让位');
    const gHot = grade(mkLow(), { anchorSellCount: 1, enableActStageCold: true, stageAthVsLaunchPct: 80 });
    ok(gHot.grade === 'unhealthy' && gHot.reasons.some((x) => x.code === 'E_low_activity'),
      'G23 边界：ath=80 恰照拦（火过线 80=FP27 同线严格 <）');
    const gNull = grade(mkLow(), { anchorSellCount: 1, enableActStageCold: true, stageAthVsLaunchPct: null });
    ok(gNull.grade === 'unhealthy', 'G23：ath null=照拦（放行方向证据缺席不释放）');
    const gOff = grade(mkLow(), { anchorSellCount: 1, stageAthVsLaunchPct: 43.5 });
    ok(gOff.grade === 'unhealthy', 'G23：灰度关（缺省）→ 照拦（零行为）');
    // ultra（M 通道）刻意不受阶段影响：activity ultra 照 unhealthy
    const mkUltra = () => { const o = baseObs(); o.activityLevel.bucket = 'ultra'; return o; };
    const gU = grade(mkUltra(), { enableActStageCold: true, stageAthVsLaunchPct: 10 });
    ok(gU.grade === 'unhealthy' && gU.reasons.some((x) => x.code === 'M_hyper_activity'),
      'G23：ultra/M 通道不受阶段前提影响（协同出货=当下事实）');
    // burst 豁免优先级不动
    const oB = mkLow(); withExt(oB, 'stall_burst_wave', 'burst');
    ok(grade(oB, { enableActStageCold: true, stageAthVsLaunchPct: 10 }).grade === 'healthy',
      'G23：sbw=burst 豁免照常（与阶段前提正交）');
  }

  console.log(`\n✅ _test_cheat_grade 全过（${passed} 断言）`);
}

main();
