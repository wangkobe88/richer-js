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
  ok(CHEAT_GRADE_RULES_VERSION === 'G15', '版本常量 G15（改规则必须 bump+同步台账+跑黄金集；G15=D3.51 burst_spike_concentration 入 EXT 清单即被 A 主判自动吸收（strong→cheat 拉黑级）——CD157 가나/CD102 SAFU 两票裁定立项「burst 没有问题，但是这里的burst明显是一个尖刺……一算就知道这是作弊行为」+「这个裁定为 cheat」+「好，落吧」；25 票分离度实证占比硬门不可行（healthy CD104 54.6/CD98 48.8 与 cheat 群数值孪生）→结构判读交 Jev 新题、门侧零数值消费；G14=M 通道超高活跃度 ultra→unhealthy M_hyper_activity（CD138 sniper 两口径否证后活跃度档本身即载体，接受 Mamesuke 错杀））');
  ok(MAIN_IDS.length === 9 && !MAIN_IDS.includes('creator_front_run') && !MAIN_IDS.includes('stall_burst_wave')
    && MAIN_IDS.includes('wash_pair') && !MAIN_IDS.includes('holdings_balance')
    && MAIN_IDS.includes('burst_spike_concentration') && !MAIN_IDS.includes('strong_backer_pressure'),
    `九主判=四现象剔 cr + tier/bw/rat/pump/wash/spike（cr/sbw 辅助判定不进主判；holdings_balance G7 刻意排除=独立 J 通道；burst_spike_concentration D3.51 入列=拉黑级铁证与 J 拒买级不同类；**strong_backer_pressure D3.52 刻意排除——CD159 强庄币锚观察期：用户裁定「这个锚先实现，但是可以先不起作用，我们攒个一批数据看看」，EXT 清单会自动吸收 strong→cheat 与豁免意图相反（豁免方向题绝不拉黑），档位只进 FA 投影攒分布，豁免规则攒 case 后再裁，实际 ${MAIN_IDS.join(',')}）`);

  console.log('A. 九主判 strong → cheat');
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

  console.log('A4. strong_backer_pressure 观察期零门侧消费（D3.52/CD159——MAIN_IDS 显式排除反证）');
  {
    // strong 也不触发任何通道（豁免方向题绝不拉黑——EXT 入列≠主判吸收，filter 显式排除；
    // 与 A3 spike「EXT 入列即主判」刻意不同：spike=拦截方向、sbp=豁免方向，自动吸收会反转语义）
    const rStrong = grade(withExt(baseObs(), 'strong_backer_pressure', 'strong'));
    ok(rStrong.grade === 'healthy' && rStrong.reasons.length === 0,
      `sbp strong 单独 → healthy 零 reasons（观察期实证：MAIN_IDS 显式排除不进 A，grade 零消费只攒分布——用户裁定「这个锚先实现，但是可以先不起作用，我们攒个一批数据看看」）（实际 ${rStrong.grade}/${JSON.stringify(rStrong.reasons)}）`);
    const rMod = grade(withExt(baseObs(), 'strong_backer_pressure', 'moderate'));
    ok(rMod.grade === 'healthy',
      'sbp moderate 同零门侧消费（豁免规则立法前任何档位不进任何通道）');
    // 档位+锚窗买卖比照常投影（门零消费≠数据不攒——观察期攒分布数据源）
    const obs = withExt(baseObs(), 'strong_backer_pressure', 'strong');
    obs.anchors.anchorBuySellRatio = 4.74;
    const lv = levelsFromObservation(obs);
    ok(lv.levels.strongBackerPressure === 3 && lv.buckets.strongBackerPressure === 'strong'
      && lv.anchors.anchorBuySellRatio === 4.74,
      `sbp 档位+锚窗买卖比照常投影 levels/buckets/anchors（CD21 实形 4.74 攒分布；实际 ${lv.levels.strongBackerPressure}/${lv.buckets.strongBackerPressure}/${lv.anchors.anchorBuySellRatio}）`);
    // 与其它通道共存不互动：sbp strong 叠 wash moderate（无 A strong）→ healthy 不受影响
    const obsMix = withExt(baseObs(), 'strong_backer_pressure', 'strong');
    obsMix.extLevels.wash_pair = 'moderate';
    ok(grade(obsMix).grade === 'healthy',
      'sbp strong 叠 wash moderate → 仍 healthy（观察期 sbp 与既有通道零互动——豁免臂立法前不放大不压制）');
  }

  console.log('A3. burst 尖刺集中 A 吸收（G15/D3.51——CD157/CD102 裁定立项，EXT 入列即主判）');
  {
    // strong → cheat（九主判循环已覆盖；此处锁 reason 码+锚无关性——门侧零数值消费）
    const obs = withExt(baseObs(), 'burst_spike_concentration', 'strong');
    obs.anchors.spikeBuyPctInBurst = 99.0; obs.anchors.spikeHoldPctAll = 53.8;
    const r = grade(obs);
    ok(r.grade === 'cheat' && r.reasons[0].code === 'A_strong:burst_spike_concentration',
      'burst_spike strong → cheat A_strong 留痕（档位即载体——两锚纯观察不进门侧判据，25 票孪生定论）');
    // moderate 单独不触发 A（A 只收 strong——数值孪生反锚下档位保守）
    const r2 = grade(withExt(baseObs(), 'burst_spike_concentration', 'moderate'));
    ok(r2.grade === 'healthy' && r2.reasons.every((x) => !x.code.startsWith('A_strong:burst_spike')),
      'burst_spike moderate 单独不触发 A（healthy 落点——A 只收 strong）');
    // 档位缺席（≤D3.50 旧档重放）→ 不触发（黄金集 42 票重放零变化防线）
    const r0 = grade(baseObs());
    ok(r0.grade === 'healthy' && r0.reasons.every((x) => !x.code.startsWith('A_strong:burst_spike')),
      'burst_spike 缺席 null 不触发（EXT 容缺断代——旧档重放零变化）');
    // spike+pump 双 strong：A 降级豁免只认「唯一 strong=pump」→ 双 strong 豁免不成立照 cheat
    const obs3 = withExt(baseObs(), 'burst_spike_concentration', 'strong');
    withExt(obs3, 'slow_grind_pump', 'strong');
    withExt(obs3, 'stall_burst_wave', 'burst');
    const r3 = grade(obs3, { famousLevel: null, anchorSellCount: 5 });
    ok(r3.grade === 'cheat' && r3.reasons[0].code === 'A_strong:slow_grind_pump+burst_spike_concentration',
      'spike+pump 双 strong 降级豁免不成立照 cheat（豁免只认唯一 strong=pump——spike strong 在场即非「停滞后自然涌入」；reason 双题合并留痕）');
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

  console.log('R. 异常行为占比通道（G13 改制，D3.39/CD136——abnormal_behavior_ratio=dominant→unhealthy 拒买级。用户裁定「改为『异常行为识别与比例计算』，明确它要做的事情，并且不作有罪推定」：无可见异常即正常（无罪推定开篇），只有异常形状流量占主导才拒买；negligible/noticeable/unclear/null 不触发；独立通道不进 A 主判（A 管单现象铁证拉黑，R 管异常占比整体形状——拒买级留重判域可翻案）');
  {
    const mkP = (bucket) => {
      const o = baseObs();
      if (bucket !== null) o.abnormalBehavior = { bucket, prob: 0.8 };
      return o;
    };
    const rMin = grade(mkP('dominant'), { famousLevel: null });
    ok(rMin.grade === 'unhealthy' && rMin.reasons.some((x) => x.code === 'R_abnormal_dominant' && x.level === 'unhealthy'),
      'R：dominant → unhealthy R_abnormal_dominant（拒买级非拉黑级——CD134 缺省门留重判域）');
    ok(grade(mkP('negligible'), { famousLevel: null }).grade === 'healthy'
      && grade(mkP('noticeable'), { famousLevel: null }).grade === 'healthy'
      && grade(mkP('unclear'), { famousLevel: null }).grade === 'healthy',
      'R：negligible/noticeable/unclear 全不触发（noticeable=异常在场不主导刻意不罚；unclear=证据不足刻意不罚）');
    ok(grade(mkP(null), { famousLevel: null }).grade === 'healthy',
      'R：abnormalBehavior null（<D3.39 旧档断代）不触发（黄金集重放零变化防线）');
    // 旧键断代反证：participation 旧顶层键在场不消费（D3.39 改名=换键非别名）
    const obsOld = baseObs();
    obsOld.participation = { bucket: 'minimal_genuine', prob: 0.9 };
    ok(grade(obsOld, { famousLevel: null }).grade === 'healthy',
      'R：旧顶层键 participation（D3.38 前 obs 形状）在场不消费（断代——镜像语义不可比，旧档重放零变化防线）');
    // 与 A cheat 叠加：单现象铁证仍在，取最重 cheat + R 留痕
    const obsBoth = mkP('dominant');
    withExt(obsBoth, 'wash_pair', 'strong');
    const rBoth = grade(obsBoth, { famousLevel: null });
    ok(rBoth.grade === 'cheat' && rBoth.reasons.some((x) => x.code === 'R_abnormal_dominant')
      && rBoth.reasons.some((x) => x.code === 'A_strong:wash_pair'),
      'R+A 同中双留痕取最重 cheat（R 不进 A 主判也不被 A 遮蔽留痕）');
    // anchors 四键参考数值不进门（参考非门槛反证——数值再高无档不罚）
    const obsAnchor = mkP(null);
    obsAnchor.anchors.maxBlockBuyCount = 8;
    obsAnchor.anchors.maxBlockBuyPct = 58.8;
    obsAnchor.anchors.sameAmountWalletPct = 66.7;
    ok(grade(obsAnchor, { famousLevel: null }).grade === 'healthy',
      'R 侧锚反证：协同买入参考四键纯参考——数值在场无档位不触发（无硬标准，判读全交 abnormal_behavior_ratio 档）');
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

  console.log('F.（G9/G10 退役反证）sbHold 纯数值不产档——G10 起门侧消费全撤（锚照产只喂 Jev/条件串）');
  {
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 50;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'sbHold=50 恰界档位全 none → healthy（F 已退役；G10 起 B 联立/豁免臂消费也全撤——sbHold 是活跃度函数非组织性度量）');
  }

  console.log('G.（G11 退役反证）bd=high 不再产档——G 通道整体退役（2026-11-02 CD133 用户裁定「GMGN的散户是有默认交易额的，大多数都是0.1/0.05，大户则是 0.2/0.25/0.3 之类的，这要是能跨区块，误伤就太大了！同块同额度误伤可能小一些，可以作为参考。如果这种死指标不好用，还是把原始数据输入给Jev，通过现象描述，去综合判断与考量里面是否有协同行为吧」——豁免前提 bundleBuyPct 的 sb∪eq 并集圈定吞前端默认档散户，骨架塌；协同现象由 A 题档承载（D3.34 题面反锚）；bd 档位照判照投影门侧零消费）');
  {
    const obs = baseObs();
    obs.bundledDominance.bucket = 'high';
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'healthy' && r.reasons.length === 0,
      'G11 反证: bd=high 单独 → healthy 零留痕（通道退役——簇圈定死指标门全线退出）');
    // 三锚任意组合不再有门（G10 期豁免/触发二分整体消失）
    const obs6b = baseObs();
    obs6b.bundledDominance.bucket = 'high';
    obs6b.anchors.sameBlockHoldPct = 90;
    obs6b.anchors.equalBandHoldPct = 85;
    obs6b.anchors.bundleBuyPct = 30;
    ok(grade(obs6b, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ sbHold=90 ∧ eqHold=85 ∧ bundleBuy=30 → healthy（三锚门侧消费全无）');
    const obs15 = baseObs();
    obs15.bundledDominance.bucket = 'high';
    obs15.anchors.bundleBuyPct = 80;
    ok(grade(obs15, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ bundleBuy=80（G10 期死盘形状触发点）→ healthy（承接死盘形状不再由死指标拦，交题档判读）');
    const obs16 = baseObs();
    obs16.bundledDominance.bucket = 'high';
    obs16.anchors.bundleBuyPct = null;
    ok(grade(obs16, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: bd=high ∧ bundleBuy=null（G10 期 fail-closed 触发点）→ healthy');
    // CD121/CD128 形状重放：豁免逻辑整个消失（G_bd 拒买级偏差票随通道退役回正）
    const obs10 = baseObs();
    obs10.bundledDominance.bucket = 'high';
    obs10.anchors.sameBlockHoldPct = 11.4;
    obs10.anchors.equalBandHoldPct = 54.0;
    ok(grade(obs10, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: CD121 形状（bundleBuy 无键，G10 期触发点）→ healthy 回正');
    const obs11 = baseObs();
    obs11.bundledDominance.bucket = 'high';
    obs11.anchors.sameBlockHoldPct = 12.6;
    obs11.anchors.equalBandHoldPct = 29.2;
    obs11.anchors.bundleBuyPct = 30;
    ok(grade(obs11, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G11 反证: CD128 形状（G10 期豁免点）→ healthy（豁免/触发二分整体消失）');
    // mid 档位不产档（退役前后一致）
    const obsMid = baseObs();
    obsMid.bundledDominance.bucket = 'mid';
    ok(grade(obsMid, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bd=mid → healthy（退役前后一致）');
    // 与 cheat 通道叠加：bd 不再叠加留痕
    const obs2 = baseObs();
    obs2.bundledDominance.bucket = 'high';
    withExt(obs2, 'amount_tiering', 'strong');
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 10 });
    ok(r2.grade === 'cheat' && r2.reasons.every((x) => x.code !== 'G_bundled_dominance'),
      'G11 反证: bd=high + A_strong → cheat 取最重但零 G 留痕（通道不存在）');
    // 容缺：null/bucket 缺失 → healthy（语义平凡成立）
    const obs4 = baseObs();
    obs4.bundledDominance = null;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bundledDominance null（旧档断代）→ healthy');
    const obs5 = baseObs();
    obs5.bundledDominance = {};
    ok(grade(obs5, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bucket 缺失 → healthy');
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
    ok(agree === 32, `对拍 32/42 一致（实际 ${agree}/42——**G11=G 通道整体退役**（2026-11-02 CD133 用户裁定「GMGN的散户是有默认交易额的，大多数都是0.1/0.05，大户则是 0.2/0.25/0.3 之类的，这要是能跨区块，误伤就太大了！同块同额度误伤可能小一些，可以作为参考。如果这种死指标不好用，还是把原始数据输入给Jev，通过现象描述，去综合判断与考量里面是否有协同行为吧」——sb∪eq 簇圈定把前端默认档散户整档吞入，死指标门全线退出，协同现象由 A 题档承载（D3.34 题面反锚））：较 G10 34 净失 CD95/CD100 两票正命中（expect=unhealthy 由 G 承载，bd=high∧bundleBuy 无键 fail-closed 触发点，退役后失载放行——「宁可放过不误伤」方向的裁定代价）；CD97/CD119/CD121 三票 G 拦截腿消失（expect=cheat 的 G10 期已偏差票由 unhealthy 降 healthy 全放行；承接路径=D3.34 重析题档升 strong 走 A 通道，随 128 票攒批对拍验证——旧档重放口径题档不会自动变）。**改规则破坏此数须重新用户裁定**`);
    ok(diffs.join(',') === 'CD56:cheat>healthy,CD84:healthy>unhealthy,CD95:unhealthy>healthy,CD97:cheat>healthy,CD100:unhealthy>healthy,CD105:healthy>unhealthy,CD107:healthy>unhealthy,CD108:cheat>unhealthy,CD119:cheat>healthy,CD121:cheat>healthy',
      `十票已知偏差锁定（实际 ${diffs.join(',')}）——CD56 版本漂移/CD108 A 降级（与 CD99 人工漂移对称）/
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
    });
    ok(r.levels.equalAmountSplit === 2 && r.levels.coordinatedSellBack === null
      && r.levels.creatorFrontRun === 1 && r.levels.stallBurstWave === 1
      && r.levels.sameBlockBuyWave === 3 && r.levels.amountTiering === null
      && r.levels.washPair === 3 && r.levels.activityLevel === 0
      && r.levels.bundledDominance === 1 && r.levels.burstSpikeConcentration === 2
      && r.levels.strongBackerPressure === null,
      `levelsFromObservation 16 题映射（D3.39 起含 abnormalBehavior/D3.51 起含 burstSpikeConcentration/D3.52 起含 strongBackerPressure（观察期零门侧消费）；实际 ${JSON.stringify(r.levels)}）`);
    ok(r.buckets.sameBlockBuyWave === 'strong' && r.buckets.stallBurstWave === 'burst'
      && r.buckets.washPair === 'strong' && r.buckets.activityLevel === 'low',
      'buckets 字符串原值（metadata 研究留档）');
    const r2 = levelsFromObservation(null);
    ok(Object.values(r2.levels).every((v) => v === null) && Object.keys(r2.levels).length === 16,
      '空观测 → 16 键全 null（容缺不冒充；abnormalBehavior D3.39/burstSpikeConcentration D3.51/strongBackerPressure D3.52 入列）');
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
      anchors: { burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3,
        spikeBuyPctInBurst: 99.3, spikeHoldPctAll: 96.7 } });
    ok(r5.anchors.burstMaxGapSec === 65 && r5.anchors.burstWaveBuyBnb === 1.02
      && r5.anchors.burstWaveWallets === 5 && r5.anchors.noBuySellPct === 63.3
      && r5.anchors.spikeBuyPctInBurst === 99.3 && r5.anchors.spikeHoldPctAll === 96.7
      && r5.anchors.sameBlockHoldPct === null,
      'G8 四新锚+D3.51 尖刺两锚正值精确投影（lib 测试同夹具值：gap65/买1.02/5户/纯卖63.3；尖刺=CD102 实形 99.3/96.7——观察键无门侧消费；未给键照 null）');
    // D3.39：abnormalBehavior 档位映射 + 协同买入五锚透传（unclear 不在映射表→null）
    const r6 = levelsFromObservation({ phenomena: {}, extLevels: {},
      abnormalBehavior: { bucket: 'dominant' },
      anchors: { maxBlockBuyCount: 8, maxBlockBuyPct: 58.8, maxBlockPreGapSec: 412,
        sameAmountWalletPct: 66.7, creatorPeakHoldSupplyPct: 35.2 } });
    ok(r6.levels.abnormalBehavior === 2 && r6.buckets.abnormalBehavior === 'dominant'
      && r6.anchors.maxBlockBuyCount === 8 && r6.anchors.maxBlockBuyPct === 58.8
      && r6.anchors.maxBlockPreGapSec === 412 && r6.anchors.sameAmountWalletPct === 66.7
      && r6.anchors.creatorPeakHoldSupplyPct === 35.2,
      'D3.39 abnormalBehavior 档位（dominant=2）+五锚透传（G13 R 通道/holdings_balance 同源——FA 40 键原料）');
    // D3.53：精确等额同块簇三键透传（CD160——**无门侧消费**：用户裁定「把这个
    // 现象描述出来给 Jev」，state 事实行+FA 投影同源；无合格簇→null 不冒充）
    const r7 = levelsFromObservation({ phenomena: {}, extLevels: {},
      anchors: { exactEqualBlockBuyPct: 97.1, exactEqualBlockClusterCount: 3, exactEqualBlockMaxWallets: 7 } });
    ok(r7.anchors.exactEqualBlockBuyPct === 97.1 && r7.anchors.exactEqualBlockClusterCount === 3
      && r7.anchors.exactEqualBlockMaxWallets === 7
      && levelsFromObservation({ phenomena: {}, extLevels: {} }).anchors.exactEqualBlockBuyPct === null,
      'D3.53 exactEqualBlock 三键透传（0xf5e6 实形 97.1/3 簇/7 钱包——FA cheatExactEqualBlockBuyPct 投影原料；未给键照 null；gradeObservation 全通道零消费=观察键）');
    ok(r6.levels.realParticipation === undefined,
      'levels 旧键 realParticipation 不得残留（D3.39 改名=换键——14 键域锁 abnormalBehavior）');
    ok(levelsFromObservation({ phenomena: {}, extLevels: {}, abnormalBehavior: { bucket: 'unclear' } }).levels.abnormalBehavior === null
      && levelsFromObservation({ phenomena: {}, extLevels: {} }).levels.abnormalBehavior === null
      && levelsFromObservation({ phenomena: {}, extLevels: {}, participation: { bucket: 'minimal_genuine' } }).levels.abnormalBehavior === null,
      'abnormalBehavior unclear→null（刻意不在映射表不冒充）+缺题（旧档）null+旧键 participation 在场不消费（D3.39 断代——回测/黄金集重放零变化防线）');
    const r4 = levelsFromObservation({}, { famousDominancePct: -3, famousDominanceLevel: 'extreme' });
    ok(r4.anchors.sameBlockHoldPct === null && r4.anchors.top1HoldCircPct === null
      && r4.anchors.famousDominancePct === null && r4.anchors.famousDominance === null
      && r4.anchors.famousDominanceLevel === 'extreme',
      '锚缺席/负数/未知档 → 数值 null 不冒充（字符串原值照存留档，buckets 哲学）');
  }

  console.log(`\n✅ _test_cheat_grade 全过（${passed} 断言）`);
}

main();
