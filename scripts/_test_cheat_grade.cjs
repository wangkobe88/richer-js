#!/usr/bin/env node
/**
 * 作弊盘三级分级规则单测（G10）——零 DB 零网络纯函数
 *
 * 覆盖：六通道逐条（A_strong/A 降级/D/E/G/J/L）+ G9 五纯数值门退役反证
 * （C sbHold≥85/F sbHold≥50/H washPair 数值/I t1 供≥40/K noBuySell≥40——
 * 判罚不经 Jev 档位，2026-11-02 用户裁定退役，现象改由题档承载）+
 * G10 sbHold/eqHold 门侧消费退役反证与 B 通道整体退役（用户裁定「sbHold
 * 让我感觉不适……活跃度极高直接被拉很高，基于它判断不合理。eqHold 有一定
 * 合理之处，可是如果能通过语言描述现象，就不要使用这种死指标」——B 联立/
 * A 降级豁免 sbHold 腿/G 豁免双锚腿全撤，G 豁免只剩组织买入占比单腿；B 骨架
 * 塌+零正命中随裁定退役）/ 豁免边界（burst、弱 burst 三键、组织买入占比 80
 * 线）/ cr-sbw 辅助判定不进主判 / 容缺 fail-open（档位 null 不计、锚 null
 * 不触发、sbw null 按 non-burst、washPair 键缺席旧档重放零变化）/ 优先级
 * （cheat>unhealthy>healthy 多通道叠加）/ 42 票黄金集对拍 34/42（八票已知
 * 偏差锁定——与 G9 同八票：G10 相对 G9 净变化=B 退役回正 CD98/CD124 两票
 * 健康盘错杀；**改规则须连此锁定一起重裁定**）。失败 exit 非零。
 */

const { gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS,
  CHEAT_LEVEL_SCORES, scoreLevel, levelsFromObservation } = require('../src/market-analysis/cheat-grade');

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
function grade(obs, extras) { return gradeObservation(obs, extras || { famousLevel: null, anchorSellCount: null }); }

function main() {
  ok(CHEAT_GRADE_RULES_VERSION === 'G10', '版本常量 G10（改规则必须 bump+同步台账+跑黄金集）');
  ok(MAIN_IDS.length === 8 && !MAIN_IDS.includes('creator_front_run') && !MAIN_IDS.includes('stall_burst_wave')
    && MAIN_IDS.includes('wash_pair') && !MAIN_IDS.includes('holdings_balance'),
    `八主判=四现象剔 cr + tier/bw/rat/pump/wash（cr/sbw 辅助判定不进主判；holdings_balance G7 刻意排除=独立 J 通道，实际 ${MAIN_IDS.join(',')}）`);

  console.log('A. 八主判 strong → cheat');
  {
    for (const id of MAIN_IDS) {
      // 直接设八题各一 strong（phen/ext 键重复无害——按 id 域写）
      const obs = baseObs();
      if (obs.phenomena[id] !== undefined) obs.phenomena[id] = 'strong'; else obs.extLevels[id] = 'strong';
      const rr = gradeObservation(obs, { famousLevel: null, anchorSellCount: null });
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

  console.log('A2. 单 pump+burst 降级豁免（CD99 形状；G10 起 sbHold<50 腿退役）');
  {
    // 唯一 strong=pump ∧ sbw=burst ∧ mod<3 → unhealthy（G10 起不再看 sbHold）
    const obs = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs, 'stall_burst_wave', 'burst');
    obs.anchors.sameBlockHoldPct = 30;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 5 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'A_downgrade_single_pump_burst',
      '唯一 pump strong+burst+mod<3 → 降级 unhealthy（停滞后自然涌入非协同推价）');
    // G10 退役反证：sbHold 任意高值不改变降级（sbHold 是活跃度函数非组织性度量）
    const obs2 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs2, 'stall_burst_wave', 'burst');
    obs2.anchors.sameBlockHoldPct = 55;
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 5 });
    ok(r2.grade === 'unhealthy' && r2.reasons[0].code === 'A_downgrade_single_pump_burst',
      'G10 反证: sbHold=55 照样降级 unhealthy（sbHold 腿已退役——高活跃盘簇圈定吞散户拉高 sbHold 是数学性质，不作豁免判据）');
    // sbw=none → 豁免不成立 → cheat
    const obs3 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    const r3 = grade(obs3, { famousLevel: null, anchorSellCount: 5 });
    ok(r3.grade === 'cheat' && r3.reasons[0].code === 'A_strong:slow_grind_pump',
      '无 burst 在场 → 豁免不成立 → cheat（burst 豁免需在场证据）');
    // pump+另一主判双 strong → 豁免只认唯一 strong
    const obs4 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs4, 'amount_tiering', 'strong');
    withExt(obs4, 'stall_burst_wave', 'burst');
    obs4.anchors.sameBlockHoldPct = 10;
    const r4 = grade(obs4, { famousLevel: null, anchorSellCount: 5 });
    ok(r4.grade === 'cheat', '双 strong（pump+tier）→ 降级豁免只认唯一 strong → cheat');
    // modAll≥3（EXT 含计）→ 豁免失效
    const obs5 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs5, 'stall_burst_wave', 'burst');
    withExt(obs5, 'amount_tiering', 'moderate');
    withExt(obs5, 'same_block_buy_wave', 'moderate');
    withExt(obs5, 'insider_supply_sell', 'moderate');
    obs5.anchors.sameBlockHoldPct = 10;
    const r5 = grade(obs5, { famousLevel: null, anchorSellCount: 5 });
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
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'B 退役反证: 三现象 mod+sbHold=60 → healthy（moderate 共振不足以拉黑——「多现象共振」证据交 A 主判 strong 档与题面校准）');
    const obs4 = baseObs();
    withPhen(obs4, 'equal_amount_split', 'moderate');
    withPhen(obs4, 'coordinated_sell_back', 'moderate');
    withPhen(obs4, 'sell_dispersion', 'moderate');
    obs4.anchors.sameBlockHoldPct = 45;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'B 退役反证: 三现象 mod sbHold<45 同 healthy（CD98/CD124 错杀票回正）');
    // dom=high 照走 D（B 让位语义随 B 退役自然消失）
    const obs3 = baseObs();
    withPhen(obs3, 'equal_amount_split', 'moderate');
    withPhen(obs3, 'coordinated_sell_back', 'moderate');
    withPhen(obs3, 'sell_dispersion', 'moderate');
    const r3 = grade(obs3, { famousLevel: 'high', anchorSellCount: 10 });
    ok(r3.grade === 'unhealthy' && r3.reasons.some((x) => x.code === 'D_famous_dominance'),
      'dom=high → D 照触发（著名主导归 unhealthy；B 让位语义随退役消失）');
  }

  console.log('C.（G9 退役反证）sbHold≥85 纯数值不再产档——判罚须经 Jev 档位');
  {
    // 2026-11-02 用户裁定退役 C/F：sbHold 高值无 Jev 档位 → 不判罚（原 C 85/F 50 两线）
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 85;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'sbHold=85 档位全 none → healthy（C 已退役：锚不直读产 cheat，黄金集 CD97 随此降 unhealthy）');
    const obs2 = baseObs();
    obs2.anchors.sameBlockHoldPct = 84.9;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'sbHold 84.9 → healthy（C/F 双退役，无 Jev 档位不判罚）');
  }

  console.log('H.（G9 退役反证）washPair 纯数值不再产档——对倒现象由 wash_pair 题档承载（A 主判）');
  {
    // CD27 形状：95.1% 卖出同块等额买回 10 对，但 Jev 题档全 none → 不判罚
    const obs = baseObs();
    obs.anchors.washPairSellPct = 95.1;
    obs.anchors.washPairCount = 10;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'washPair 95.1%×10 对档位全 none → healthy（H 已退役：锚值不直读，[PRECOMPUTED] 事实行照常喂 Jev）');
    // 对倒现象由 Jev 档承载：wash_pair strong → A 主判 cheat（MAIN_IDS 含 wash）
    const obs2 = withExt(baseObs(), 'wash_pair', 'strong');
    obs2.anchors.washPairSellPct = 95.1;
    obs2.anchors.washPairCount = 10;
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 10 });
    ok(r2.grade === 'cheat' && r2.reasons.some((x) => x.code === 'A_strong:wash_pair'),
      'wash_pair 题档 strong（CD27 对倒形状由 Jev 判档）→ cheat A_strong:wash_pair');
    // moderate 不拉黑：H 原纯数值线已退役，拒买级留待 Jev/其余通道
    const obs3 = withExt(baseObs(), 'wash_pair', 'moderate');
    obs3.anchors.washPairSellPct = 95;
    obs3.anchors.washPairCount = 10;
    ok(grade(obs3, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'wash_pair moderate → 不拉黑（对倒档位证据不足硬门已撤——已知代价 CD27 类形状降依赖 Jev 判档）');
  }

  console.log('I.（G9 退役反证）t1 供≥40 纯数值不再产档——独大现象由 holdings_balance/insider 题档承载');
  {
    // CD69 形状：第一大户一笔吃 46.5% 供应，但 Jev 题档全 none → 不判罚
    const obs = baseObs();
    obs.anchors.top1HoldSupplyPct = 46.5;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      't1 供 46.5 档位全 none → healthy（I 已退役：独大判读交 holdings_balance 题档，D3.32 题面判据已含主口径占总供应量%）');
    // 独大+低活跃共存（CD69 实形）：I 退役后由 E 承载 unhealthy
    const obs5 = baseObs();
    obs5.anchors.top1HoldSupplyPct = 42;
    obs5.activityLevel.bucket = 'low';
    const r5 = grade(obs5, { famousLevel: null, anchorSellCount: 10 });
    ok(r5.grade === 'unhealthy' && r5.reasons.some((x) => x.code === 'E_low_activity'),
      't1 供 42 + act=low → unhealthy（E 留痕；I 已退役不产 cheat——已知代价：独大铁证形状依赖 holdings 题档 strong 或 J/L）');
  }

  console.log('J. holdings_balance=strong → unhealthy 独立通道（G7，2026-11-02 批次五 CD122 裁定——「给 Jev 增加 持仓均衡 门吧。注意总供应量占比最重要，第二 CD122 的 top2 不是单一钱包，而是捆绑簇。需要利用 Jev 的能力处理复杂情况」+「strong→unhealthy（独立通道，不进 A 通道）」）');
  {
    // CD122 形状：top1 供 25.6（<40 I 不触发）+ top2=同块捆绑簇成员背靠背进场
    // 3 秒卖一半，第1大∪簇并集 40.1% → holdings_balance strong → J unhealthy
    const obs = withExt(baseObs(), 'holdings_balance', 'strong');
    obs.anchors.top1HoldSupplyPct = 25.6;
    obs.anchors.top1Top2HoldSupplyPct = 35.0;
    obs.anchors.t1PlusClusterSupplyPct = 40.1;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 5 });
    ok(r.grade === 'unhealthy' && r.reasons.some((x) => x.code === 'J_holdings_strong'),
      'holdings_balance strong（CD122 形状：t1 供 25.6<40 I 不触发、并集 40.1）→ unhealthy J_holdings_strong');
    // moderate 不触发（拒买级通道只消费 strong——用户裁定档位）
    const obs2 = withExt(baseObs(), 'holdings_balance', 'moderate');
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 5 }).grade === 'healthy',
      'holdings_balance moderate → 不触发（J 只消费 strong）');
    // 旧档断代（<D3.32 答案缺席）不触发——黄金集重放零变化防线
    const obs3 = baseObs();
    delete obs3.extLevels.holdings_balance;
    ok(grade(obs3, { famousLevel: null, anchorSellCount: 5 }).grade === 'healthy',
      'holdings_balance 键缺席（旧档断代/容缺）→ J 不触发（EXT 容缺语义同族，黄金集 34/42 沿用防线）');
    // 单一独大 46.5 同时 holdings strong（CD69 形状）：I 已退役（G9），J 承载 unhealthy
    const obs4 = withExt(baseObs(), 'holdings_balance', 'strong');
    obs4.anchors.top1HoldSupplyPct = 46.5;
    const r4 = grade(obs4, { famousLevel: null, anchorSellCount: 10 });
    ok(r4.grade === 'unhealthy' && r4.reasons.some((x) => x.code === 'J_holdings_strong'),
      'holdings strong + t1 供 46.5 → unhealthy J（I 已退役 G9：独大数值不再直读产 cheat，档位承载）');
  }

  console.log('D. 著名钱包主导 → unhealthy（G5 补跟单集中度豁免）');
  {
    const obs = baseObs();
    const r = grade(obs, { famousLevel: 'high', anchorSellCount: 10 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'D_famous_dominance',
      'famousLevel=high 单独（top3 键缺席=null）→ unhealthy（无跟随时 dom 分子全靠 famous 本人=直接控盘；旧档断代同形状保持 G4 行为）');
    ok(grade(obs, { famousLevel: 'mid', anchorSellCount: 10 }).grade === 'healthy',
      'famousLevel=mid 不触发 D');
    // G5 跟单集中度豁免（2026-11-02 批次四用户裁定「它们的跟单量是不是高估了？因为
    // 聪明钱的跟单一定程度也不算完全不健康的」「也不能把所有的后续买入全看成
    // famous 的跟单」）：跟单 top3 占跟单正净 Σ <45%=分散形（几十个散户小额跟进）
    // 豁免；≥45%=集中形（少数大户贴身重仓=疑似分仓，CD63 top3 87%/最大 26%）触发
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 44.9, famousGroupBuyPct: 30, anchorSellCount: 10 }).grade === 'healthy',
      'G5+G6: dom=high ∧ top3=44.9%（分散形散户跟风）∧ 组织买=30%（承接充足）→ D 豁免不触发');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 45, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: dom=high ∧ 跟单 top3=45% 恰界 → 触发（集中形线 ≥45）');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 87, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: dom=high ∧ 跟单 top3=87%（CD63 集中形）→ 触发（疑似分仓维持 unhealthy）');
    // G6 豁免前提（2026-11-02 用户补充裁定「著名/绑定钱包的豁免还是要有一个前提，
    // ……盘面正常用户流量涌入依然要比较明显，否则如果整个盘面全部是它们的砸盘，
    // 盘子也死了」）：famous∪跟单买入占锚窗总买 ≥80（正常承接不足两成）=死盘
    // 形状豁免不成立。null（旧档断代）→ 不豁免 fail-closed（sbw null 同哲学）
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 20, famousGroupBuyPct: 79.9, anchorSellCount: 10 }).grade === 'healthy',
      'G6: dom=high ∧ top3=20 分散形 ∧ 组织买=79.9%（承接刚过两成）→ 豁免维持');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 20, famousGroupBuyPct: 80, anchorSellCount: 10 }).grade === 'unhealthy',
      'G6: dom=high ∧ top3=20 分散形 ∧ 组织买=80 恰界 → 豁免不成立触发（CD47 实形）');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 20, famousGroupBuyPct: 92.9, anchorSellCount: 10 }).grade === 'unhealthy',
      'G6: dom=high ∧ top3=20 分散形 ∧ 组织买=92.9%（CD103 整个盘面全是它们的）→ 触发');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 20, famousGroupBuyPct: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G6: 组织买锚 null（旧档断代）→ 不豁免维持触发（承接证据缺席不给豁免）');
  }

  console.log('E. 活跃度低（G2 简化：唯一豁免=burst；t1流/卖笔豁免已撤销）');
  {
    const obs = baseObs();
    obs.activityLevel.bucket = 'low';
    obs.anchors.top1HoldCircPct = 10;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 1 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'E_low_activity',
      'act=low ∧ sbw≠burst → unhealthy（G2 用户裁定「活跃度这一臂为 low 的也判 unhealthy」）');
    // 唯一豁免：sbw=burst（通道层双保险；主修正=D3.27 题面 burst 反锚）
    withExt(obs, 'stall_burst_wave', 'burst');
    ok(grade(obs, { famousLevel: null, anchorSellCount: 1 }).grade === 'healthy',
      '豁免：sbw=burst（停滞突发不算活跃度低——主修正 D3.27 题面，通道层双保险）');
    // 撤销的豁免①：t1流≥40 不再豁免（吃独食家族 CD105/CD122 改判 unhealthy）
    withExt(obs, 'stall_burst_wave', 'none');
    obs.anchors.top1HoldCircPct = 40;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 1 }).grade === 'unhealthy',
      't1 流 40 恰界不再豁免（G2 撤销吃独食豁免——E 只看 act+burst）');
    // 撤销的豁免②：卖笔≥2 不再豁免（对手盘 CD107 改判 unhealthy）
    obs.anchors.top1HoldCircPct = 10;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 2 }).grade === 'unhealthy',
      '卖笔 2 恰界不再豁免（G2 撤销对手盘豁免——anchorSellCount 不再被 E 消费）');
    // sbw null 按「非 burst」处理（无证据不豁免）
    const obs2 = baseObs();
    obs2.activityLevel.bucket = 'low';
    obs2.anchors.top1HoldCircPct = 10;
    obs2.extLevels.stall_burst_wave = null;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 1 }).grade === 'unhealthy',
      'sbw null 按 non-burst（burst 豁免需在场证据，已知容缺例外）');
    // anchorSellCount 缺席（旧 digest 重放）→ E 照触发（G2 起不消费该键）
    ok(grade((() => { const o = baseObs(); o.activityLevel.bucket = 'low'; o.anchors.top1HoldCircPct = 10; return o; })(), { famousLevel: null }).grade === 'unhealthy',
      'anchorSellCount 缺席 → E 照触发（G2 起不消费该键，旧档重放兼容）');
    // act null → E 不触发
    const obs3 = baseObs();
    obs3.activityLevel = null;
    obs3.anchors.top1HoldCircPct = 10;
    ok(grade(obs3, { famousLevel: null, anchorSellCount: 0 }).grade === 'healthy',
      'activityLevel null → E 不触发');
  }

  console.log('E2. G8 弱 burst 代码臂（2026-11-02 批次六 CD37/CD79 用户裁定「长期停滞突然涌入一波小流量，依然应该算低活跃度，但是如果涌入流量大，才能推翻 低活跃度 结论」——选「弱 burst 代码臂」落法）');
  {
    const mk = (anchors, sbw = 'burst') => {
      const o = baseObs();
      o.activityLevel.bucket = 'low';
      o.anchors.top1HoldCircPct = 10;
      o.extLevels.stall_burst_wave = sbw;
      Object.assign(o.anchors, anchors);
      return o;
    };
    // 三键全中 → 豁免不成立（长期停滞后只涌入一点小流量）
    const r1 = grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 1.04, burstWaveWallets: 12 }), { famousLevel: null, anchorSellCount: 1 });
    ok(r1.grade === 'unhealthy'
      && r1.reasons.some((x) => x.code === 'E_low_activity_weak_burst'),
      '弱 burst 三键全中（gap 60 恰界/买 1.04/钱包 12）→ unhealthy E_low_activity_weak_burst（CD79/CD108/CD70 定线形状）');
    // 波买入恰界 1.05 → 不算弱 burst（豁免维持；定线「<1.05」严格）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 1.05, burstWaveWallets: 12 }), { famousLevel: null }).grade === 'healthy',
      '波买入 1.05 恰界 → 豁免维持（涌入流量足够=推翻低活跃度）');
    // 强波（买 2.0/钱包 20）→ 豁免维持（G7 行为）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 2.0, burstWaveWallets: 20 }), { famousLevel: null }).grade === 'healthy',
      '强波（买 2.0/20 户）→ 豁免维持（真流量涌入）');
    // 停滞不足 60s → 豁免维持（人工 healthy 4 票中 3 票 maxGap 19~43s=开盘密集正常形状）
    ok(grade(mk({ burstMaxGapSec: 59, burstWaveBuyBnb: 0.2, burstWaveWallets: 3 }), { famousLevel: null }).grade === 'healthy',
      'gap 59 <60 → 豁免维持（停滞深度是必要第三维——无停滞不谈弱 burst）');
    // 钱包恰界 13 → 豁免维持（「<13」严格）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: 0.2, burstWaveWallets: 13 }), { famousLevel: null }).grade === 'healthy',
      '波钱包 13 恰界 → 豁免维持');
    // 三键任一 null（<G8 旧档断代/dt 缺失）→ 维持 G7 豁免（黄金集重放零变化的机制保证）
    ok(grade(mk({ burstMaxGapSec: 60, burstWaveBuyBnb: null, burstWaveWallets: 12 }), { famousLevel: null }).grade === 'healthy'
      && grade(mk({ burstMaxGapSec: null, burstWaveBuyBnb: 0.2, burstWaveWallets: 3 }), { famousLevel: null }).grade === 'healthy'
      && grade(baseObs(), { famousLevel: null }).grade === 'healthy',
      '三键任一 null（旧档断代）→ 维持 G7 豁免（新切口对存档重放零变化）');
    // sbw≠burst 主路径带弱波键 → code 不带 weak_burst 后缀（sbw=none 主判定）
    const r2 = grade(mk({ burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5 }, 'none'), { famousLevel: null });
    ok(r2.grade === 'unhealthy' && r2.reasons.some((x) => x.code === 'E_low_activity')
      && !r2.reasons.some((x) => x.code === 'E_low_activity_weak_burst'),
      'sbw≠burst → E_low_activity 主 code（弱波键在场不改变非 burst 主路径留痕）');
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

  console.log('F.（G9/G10 退役反证）sbHold 纯数值不产档——G10 起门侧消费全撤（锚照产只喂 Jev/条件串）');
  {
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 50;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'sbHold=50 恰界档位全 none → healthy（F 已退役；G10 起 B 联立/豁免臂消费也全撤——sbHold 是活跃度函数非组织性度量）');
  }

  console.log('G. bd（捆绑钱包主导）=high → unhealthy（G2 重要负面臂，2026-11-01 用户裁定）');
  {
    const obs = baseObs();
    obs.bundledDominance.bucket = 'high';
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'unhealthy' && r.reasons.some((x) => x.code === 'G_bundled_dominance'),
      'bd=high 单独 → unhealthy（拒买可重判不清仓——用户选定 B 档）');
    // mid/low 不触发（baseObs 默认 low 全表 healthy 前提）
    obs.bundledDominance.bucket = 'mid';
    ok(grade(obs, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bd=mid → 不触发（负面臂只挂最高档）');
    // 与 cheat 通道叠加：grade 取最重、G 留痕
    const obs2 = baseObs();
    obs2.bundledDominance.bucket = 'high';
    withExt(obs2, 'amount_tiering', 'strong');
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 10 });
    ok(r2.grade === 'cheat' && r2.reasons.some((x) => x.code === 'A_strong:amount_tiering')
      && r2.reasons.some((x) => x.code === 'G_bundled_dominance'),
      'bd=high + A_strong 叠加 → cheat 取最重、G 留痕（多通道叠加语义）');
    // bd=high + sbHold 55：F 已退役（G9），单 unhealthy 留痕（sbHold 数值不再独立产档）
    const obs3 = baseObs();
    obs3.bundledDominance.bucket = 'high';
    obs3.anchors.sameBlockHoldPct = 55;
    const r3 = grade(obs3, { famousLevel: null, anchorSellCount: 10 });
    ok(r3.grade === 'unhealthy' && r3.reasons.length === 1 && r3.reasons[0].code === 'G_bundled_dominance',
      'bd=high + sbHold=55 → 仅 G 留痕（F 已退役 G9：sbHold 不豁免 G 但不独立产档）');
    // 容缺：bundledDominance null / 桶缺失 → 不触发（fail-open 放行方向）
    const obs4 = baseObs();
    obs4.bundledDominance = null;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bundledDominance null（旧档断代）→ G 不触发');
    const obs5 = baseObs();
    obs5.bundledDominance = {};
    ok(grade(obs5, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bucket 缺失 → G 不触发');
    // G10 豁免=组织买入占比单腿（G5 双锚簇残余豁免 sbHold<20∧eqHold<50 已随
    // sbHold/eqHold 门侧退役撤除——用户裁定「如果能通过语言描述现象，就不要
    // 使用这种死指标」，簇撤退现象交题面判读）：bundleBuyPct<80（sb∪eq 簇买入
    // 占锚窗总买不足八成=正常用户承接至少两成）才豁免；≥80 死盘形状或 null
    // （旧档断代/无合格簇成员）→ 不豁免 fail-closed
    const obs6 = baseObs();
    obs6.bundledDominance.bucket = 'high';
    obs6.anchors.sameBlockHoldPct = 19.9;
    obs6.anchors.bundleBuyPct = 30;
    ok(grade(obs6, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G10: bd=high ∧ bundleBuy=30（承接充足）→ 豁免（sbHold/eqHold 不再进门）');
    // G10 退役反证：sbHold 任意高值不阻止豁免（活跃度函数不作判据）
    const obs6b = baseObs();
    obs6b.bundledDominance.bucket = 'high';
    obs6b.anchors.sameBlockHoldPct = 90;
    obs6b.anchors.equalBandHoldPct = 85;
    obs6b.anchors.bundleBuyPct = 30;
    ok(grade(obs6b, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G10 退役反证: sbHold=90 ∧ eqHold=85 ∧ bundleBuy=30 → 照样豁免 healthy（双锚门侧消费已全撤）');
    const obs7 = baseObs();
    obs7.bundledDominance.bucket = 'high';
    ok(grade(obs7, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G10: bd=high ∧ bundleBuy 缺席=null → 不豁免维持触发（承接证据缺席不给豁免，fail-closed）');
    const obs8 = baseObs();
    obs8.bundledDominance.bucket = 'high';
    obs8.anchors.sameBlockHoldPct = null;
    ok(grade(obs8, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G10: bd=high ∧ sbHold=null（无合格簇锚）→ 不豁免维持触发（bundleBuy 同缺席）');
    // CD121/CD128 形状重放：G10 下豁免只看 bundleBuy（存档无键=null 不豁免）
    const obs10 = baseObs();
    obs10.bundledDominance.bucket = 'high';
    obs10.anchors.sameBlockHoldPct = 11.4;
    obs10.anchors.equalBandHoldPct = 54.0;
    ok(grade(obs10, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G10: CD121 形状（bundleBuy 无键）→ 不豁免触发（承接锚缺席 fail-closed；sbHold 11.4/eqHold 54 不再进门）');
    const obs11 = baseObs();
    obs11.bundledDominance.bucket = 'high';
    obs11.anchors.sameBlockHoldPct = 12.6;
    obs11.anchors.equalBandHoldPct = 29.2;
    obs11.anchors.bundleBuyPct = 30;
    ok(grade(obs11, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G10: CD128 形状 ∧ bundleBuy=30 → 豁免（承接充足）');
    // G6 豁免前提（用户补充裁定，D 段同线）：簇买入占锚窗总买 ≥80（正常承接
    // 不足两成）=死盘形状豁免不成立；恰界 80 严格
    const obs14 = baseObs();
    obs14.bundledDominance.bucket = 'high';
    obs14.anchors.bundleBuyPct = 79.9;
    ok(grade(obs14, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G6: bundleBuy=79.9%（承接刚过两成）→ 豁免维持');
    const obs15 = baseObs();
    obs15.bundledDominance.bucket = 'high';
    obs15.anchors.bundleBuyPct = 80;
    ok(grade(obs15, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G6: bundleBuy=80 恰界 → 豁免不成立触发（买入独大死盘形状）');
    const obs16 = baseObs();
    obs16.bundledDominance.bucket = 'high';
    obs16.anchors.bundleBuyPct = null;
    ok(grade(obs16, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G6: 簇买锚 null（旧档断代）→ 不豁免维持触发（承接证据缺席不给豁免）');
  }

  console.log('优先级与容缺');
  {
    // 多通道叠加：cheat>unhealthy
    const obs = baseObs();
    withExt(obs, 'amount_tiering', 'strong');
    obs.anchors.sameBlockHoldPct = 60;
    obs.activityLevel.bucket = 'low';
    obs.anchors.top1HoldCircPct = 10;
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
    const r3 = grade(obs3, { famousLevel: null, anchorSellCount: 10 });
    ok(r3.grade === 'healthy', '负数锚按缺席（绝不冒充触发门）');
    const obs4 = baseObs();
    obs4.anchors.sameBlockHoldPct = NaN;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy', 'NaN 锚按缺席');
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
    ok(agree === 34, `对拍 34/42 一致（实际 ${agree}/42——**G10=sbHold/eqHold 门侧消费全撤+B 通道退役**（2026-11-02 用户裁定「sbHold 让我感觉不适……活跃度极高直接被拉很高，基于它判断不合理。eqHold 有一定的合理之处，可是如果能通过语言描述现象，就不要使用这种死指标」）：与 G9 同 34/42——sbHold 联立撤后 B 裸 moderate 共振错杀 CD98/CD124 两票人工 healthy，B 零正命中随裁定整体退役回正；锚照常产出于 state/FA 只不作门；改规则破坏此数须重新用户裁定）`);
    ok(diffs.join(',') === 'CD56:cheat>healthy,CD84:healthy>unhealthy,CD97:cheat>unhealthy,CD105:healthy>unhealthy,CD107:healthy>unhealthy,CD108:cheat>unhealthy,CD119:cheat>unhealthy,CD121:cheat>unhealthy',
      `八票已知偏差锁定（实际 ${diffs.join(',')}）——CD56 版本漂移/CD108 A 降级（与 CD99 人工漂移对称）/
CD119/CD121=G_bd 拒买级偏差（G10 豁免只看组织买入占比；拉黑级证据交 A strong 档）/CD97=G9 已知代价（C_sbHold90 独载票随纯数值门退役降 unhealthy——sbHold 89.9 但 Jev 档位无 strong，unhealthy 拒买仍在）/
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
        wash_pair: 'strong' },
      activityLevel: { bucket: 'low' }, bundledDominance: { bucket: 'mid' },
    });
    ok(r.levels.equalAmountSplit === 2 && r.levels.coordinatedSellBack === null
      && r.levels.creatorFrontRun === 1 && r.levels.stallBurstWave === 1
      && r.levels.sameBlockBuyWave === 3 && r.levels.amountTiering === null
      && r.levels.washPair === 3 && r.levels.activityLevel === 0
      && r.levels.bundledDominance === 1,
      `levelsFromObservation 13 题映射（实际 ${JSON.stringify(r.levels)}）`);
    ok(r.buckets.sameBlockBuyWave === 'strong' && r.buckets.stallBurstWave === 'burst'
      && r.buckets.washPair === 'strong' && r.buckets.activityLevel === 'low',
      'buckets 字符串原值（metadata 研究留档）');
    const r2 = levelsFromObservation(null);
    ok(Object.values(r2.levels).every((v) => v === null) && Object.keys(r2.levels).length === 13,
      '空观测 → 13 键全 null（容缺不冒充；holdingsBalance D3.32 入列）');
    // 数值锚（用户补点「著名钱包掌控/持仓极不均衡」+D3.28 对敲三键+D3.32 持仓分布五键）：
    // obs.anchors 持仓占比四键 + washPair 三键 + holdings 五键（CD122 实值）+
    // extras famous 数值/档位；famousDominance=low/mid/high→0/1/2
    const r3 = levelsFromObservation({
      phenomena: {}, extLevels: {},
      anchors: { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2,
        top1HoldSupplyPct: 25.6, top1HoldCircPct: 53.4,
        washPairCount: 10, washPairSellPct: 95.1, washPairBuyPct: 27.3,
        top2HoldSupplyPct: 9.4, top1Top2HoldSupplyPct: 35.0, top1Top2FirstBuyGapSec: 1,
        clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1 },
    }, { famousDominancePct: 87.5, famousDominanceLevel: 'high' });
    ok(r3.anchors && r3.anchors.sameBlockHoldPct === 66.1
      && r3.anchors.equalBandHoldPct === 57.2 && r3.anchors.top1HoldSupplyPct === 25.6
      && r3.anchors.top1HoldCircPct === 53.4 && r3.anchors.famousDominancePct === 87.5
      && r3.anchors.famousDominanceLevel === 'high' && r3.anchors.famousDominance === 2
      && r3.anchors.washPairCount === 10 && r3.anchors.washPairSellPct === 95.1
      && r3.anchors.washPairBuyPct === 27.3
      && r3.anchors.top2HoldSupplyPct === 9.4 && r3.anchors.top1Top2HoldSupplyPct === 35.0
      && r3.anchors.top1Top2FirstBuyGapSec === 1 && r3.anchors.clusterHoldSupplyPct === 14.5
      && r3.anchors.t1PlusClusterSupplyPct === 40.1,
      `anchors 十二键精确映射含 holdings 五键（CD122 实值 t2 9.4/Σ2 35.0/Δ1s/簇 14.5/∪40.1；实际 ${JSON.stringify(r3.anchors)}）`);
    ok(levelsFromObservation({}, { famousDominanceLevel: 'mid' }).anchors.famousDominance === 1,
      'famous 档 low/mid/high → 0/1/2（dominance 映射表复用）');
    const r5 = levelsFromObservation({ phenomena: {}, extLevels: {},
      anchors: { burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3 } });
    ok(r5.anchors.burstMaxGapSec === 65 && r5.anchors.burstWaveBuyBnb === 1.02
      && r5.anchors.burstWaveWallets === 5 && r5.anchors.noBuySellPct === 63.3
      && r5.anchors.sameBlockHoldPct === null,
      'G8 四新锚正值精确投影（lib 测试同夹具值：gap65/买1.02/5户/纯卖63.3；未给键照 null）');
    const r4 = levelsFromObservation({}, { famousDominancePct: -3, famousDominanceLevel: 'extreme' });
    ok(r4.anchors.sameBlockHoldPct === null && r4.anchors.top1HoldCircPct === null
      && r4.anchors.famousDominancePct === null && r4.anchors.famousDominance === null
      && r4.anchors.famousDominanceLevel === 'extreme',
      '锚缺席/负数/未知档 → 数值 null 不冒充（字符串原值照存留档，buckets 哲学）');
  }

  console.log(`\n✅ _test_cheat_grade 全过（${passed} 断言）`);
}

main();
