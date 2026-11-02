#!/usr/bin/env node
/**
 * 作弊盘三级分级规则单测（G4）——零 DB 零网络纯函数
 *
 * 覆盖：九通道逐条（A_strong/A 降级/B/C/D/E/F/G/H_wash_pair/I_t1_supply）/
 * 豁免边界（burst、sbHold 50/85 恰界、washPair 60%×3 对恰界、t1供 40 恰界）/
 * cr-sbw 辅助判定不进主判 / 容缺 fail-open（档位 null 不计、锚 null 不触发、
 * sbw null 按 non-burst、washPair 键缺席旧档重放零变化）/ 优先级（cheat>
 * unhealthy>healthy 多通道叠加）/ 42 票黄金集对拍 34/42（八票已知偏差锁定
 * ——定性见台账 G2 修订段，**改规则须连此锁定一起重裁定**；G3/G4 对 D3.26
 * 存档重放零变化：旧档 anchors 无 washPair 键=H 缺席不触发、extLevels 无
 * wash_pair=A 容缺 null 不计；t1供 ≥40 全 128 票唯一命中 CD69(46.5) 不在
 * 黄金集）。失败 exit 非零。
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
      slow_grind_pump: 'none', wash_pair: 'none',
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
  ok(CHEAT_GRADE_RULES_VERSION === 'G5', '版本常量 G5（改规则必须 bump+同步台账+跑黄金集）');
  ok(MAIN_IDS.length === 8 && !MAIN_IDS.includes('creator_front_run') && !MAIN_IDS.includes('stall_burst_wave')
    && MAIN_IDS.includes('wash_pair'),
    `八主判=四现象剔 cr + tier/bw/rat/pump/wash（cr/sbw 辅助判定不进主判，实际 ${MAIN_IDS.join(',')}）`);

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

  console.log('A2. 单 pump+burst 降级豁免（CD99 形状）');
  {
    // 唯一 strong=pump ∧ sbw=burst ∧ mod<3 ∧ sbHold<50 → unhealthy
    const obs = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs, 'stall_burst_wave', 'burst');
    obs.anchors.sameBlockHoldPct = 30;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 5 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'A_downgrade_single_pump_burst',
      '唯一 pump strong+burst+sbHold<50 → 降级 unhealthy（停滞后自然涌入非协同推价）');
    // sbHold≥50 → 降级豁免四腿不全 → A_strong 重新成立（cheat 优先于 F）
    const obs2 = withExt(baseObs(), 'slow_grind_pump', 'strong');
    withExt(obs2, 'stall_burst_wave', 'burst');
    obs2.anchors.sameBlockHoldPct = 55;
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 5 });
    ok(r2.grade === 'cheat' && r2.reasons.some((x) => x.code === 'A_strong:slow_grind_pump')
      && r2.reasons.some((x) => x.code === 'F_sbHold55'),
      'sbHold≥50 豁免失效 → cheat（A_strong 重新成立；F 同时留痕但 grade 取最重）');
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

  console.log('B. 四现象 moderate≥3 ∧ sbHold≥50 ∧ dom≠high → cheat');
  {
    const obs = baseObs();
    withPhen(obs, 'equal_amount_split', 'moderate');
    withPhen(obs, 'coordinated_sell_back', 'moderate');
    withPhen(obs, 'sell_dispersion', 'moderate');
    obs.anchors.sameBlockHoldPct = 60;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'cheat' && r.reasons.some((x) => x.code.startsWith('B_phen_mod3')),
      '三现象 mod+sbHold≥50 → cheat（B 通道）');
    // EXT moderate 不计入现象门（刻意严格：放宽会误伤 CD95/CD100）
    const obs2 = baseObs();
    withPhen(obs2, 'equal_amount_split', 'moderate');
    withExt(obs2, 'amount_tiering', 'moderate');
    withExt(obs2, 'same_block_buy_wave', 'moderate');
    withExt(obs2, 'insider_supply_sell', 'moderate');
    obs2.anchors.sameBlockHoldPct = 60;
    const r2 = grade(obs2, { famousLevel: null, anchorSellCount: 10 });
    ok(r2.grade === 'unhealthy' && !r2.reasons.some((x) => x.code.startsWith('B_')),
      'EXT mod 含计不进现象门（B 只认四现象——CD95/CD100 反证锁定）');
    // dom=high → B 让位 D
    const obs3 = baseObs();
    withPhen(obs3, 'equal_amount_split', 'moderate');
    withPhen(obs3, 'coordinated_sell_back', 'moderate');
    withPhen(obs3, 'sell_dispersion', 'moderate');
    obs3.anchors.sameBlockHoldPct = 60;
    const r3 = grade(obs3, { famousLevel: 'high', anchorSellCount: 10 });
    ok(r3.grade === 'unhealthy' && r3.reasons.some((x) => x.code === 'D_famous_dominance')
      && !r3.reasons.some((x) => x.code.startsWith('B_')),
      'dom=high → B 让位 D（著名主导优先归 unhealthy）');
    // sbHold<50 → B 不触发
    const obs4 = baseObs();
    withPhen(obs4, 'equal_amount_split', 'moderate');
    withPhen(obs4, 'coordinated_sell_back', 'moderate');
    withPhen(obs4, 'sell_dispersion', 'moderate');
    obs4.anchors.sameBlockHoldPct = 45;
    const r4 = grade(obs4, { famousLevel: null, anchorSellCount: 10 });
    ok(r4.grade === 'healthy', '三现象 mod 但 sbHold<50 → healthy（无其它通道）');
  }

  console.log('C. sbHold≥85 极端同块集中 → cheat');
  {
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 85;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'cheat' && r.reasons.some((x) => x.code === 'C_sbHold85'), 'sbHold=85 恰界 → cheat（C 通道）');
    const obs2 = baseObs();
    obs2.anchors.sameBlockHoldPct = 84.9;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'sbHold 84.9 → C 不触发（F 兜住 unhealthy）');
  }

  console.log('H. 同块对敲锚 washPairSellPct≥60 ∧ washPairCount≥3 → cheat（G3，2026-11-01 批次二 CD27 用户裁定）');
  {
    // CD27 形状：95.1% 卖出为同块等额买回、10 对 → cheat（H 通道独立触发，不依赖任何题档）
    const obs = baseObs();
    obs.anchors.washPairSellPct = 95.1;
    obs.anchors.washPairCount = 10;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'cheat' && r.reasons.some((x) => x.code.startsWith('H_wash_pair_sell95x10')),
      'washPair 95.1%×10 对 → cheat（H_wash_pair 留痕卖占×对数——CD27 对倒形状）');
    // 60% 与 3 对恰界
    const obs2 = baseObs();
    obs2.anchors.washPairSellPct = 60;
    obs2.anchors.washPairCount = 3;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 10 }).grade === 'cheat',
      '60%×3 对恰界 → cheat（≥ 两腿含等）');
    // 59.9% 不触发（占比不足不为据——CD90 大流量随机碰撞 3 对仅 1.9% 的对称防线）
    const obs3 = baseObs();
    obs3.anchors.washPairSellPct = 59.9;
    obs3.anchors.washPairCount = 10;
    ok(grade(obs3, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      '卖占 59.9% 不触发（占比条件天然兜偶发碰撞）');
    // <3 对不触发（CD14 1 对 6.4% / CD90 3 对 1.9% 形状——对数腿防孤对）
    const obs4 = baseObs();
    obs4.anchors.washPairSellPct = 95;
    obs4.anchors.washPairCount = 2;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      '2 对不触发（对数腿防孤对——单对等额碰撞不构成对倒结论）');
    // 锚缺席（旧档/无配对 null）不触发——G3 对 D3.26 存档重放零变化的防线
    const obs5 = baseObs();
    delete obs5.anchors.washPairSellPct;
    delete obs5.anchors.washPairCount;
    ok(grade(obs5, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'washPair 键缺席（旧档断代）→ H 不触发（fail-open：锚 null 不触发比较门）');
    // 与 unhealthy 通道叠加：grade 取最重
    const obs6 = baseObs();
    obs6.anchors.washPairSellPct = 80;
    obs6.anchors.washPairCount = 5;
    obs6.anchors.sameBlockHoldPct = 55;
    const r6 = grade(obs6, { famousLevel: null, anchorSellCount: 10 });
    ok(r6.grade === 'cheat' && r6.reasons.some((x) => x.level === 'cheat' && x.code.startsWith('H_wash_pair'))
      && r6.reasons.some((x) => x.code === 'F_sbHold55'),
      'H + F 叠加 → cheat 取最重、F 留痕（多通道叠加语义）');
  }

  console.log('I. 第一大户供应独大 top1HoldSupplyPct≥40 → cheat（G4，2026-11-01 批次二 CD69 两段裁定）');
  {
    // CD69 形状：TROLLON 第一大户一笔 5.1653 BNB 吃 465.13M tok=46.5% 供应 → cheat
    const obs = baseObs();
    obs.anchors.top1HoldSupplyPct = 46.5;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'cheat' && r.reasons.some((x) => x.code === 'I_t1_supply47'),
      't1 供 46.5 → cheat（I_t1_supply 留痕整数档——CD69 一笔坐票形状）');
    // 40 恰界
    const obs2 = baseObs();
    obs2.anchors.top1HoldSupplyPct = 40;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 10 }).grade === 'cheat',
      't1 供 40 恰界 → cheat（≥ 含等）');
    // 39.9 不触发（CD104 31.6 人工 healthy 挡住下探——30 线即误伤）
    const obs3 = baseObs();
    obs3.anchors.top1HoldSupplyPct = 39.9;
    ok(grade(obs3, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      't1 供 39.9 → healthy（CD69 46.5 断层至 CD104 31.6，单档不下探）');
    // 锚缺席（旧档/totalSupply 缺失）不触发——G4 对 D3.26 存档重放零变化的防线
    const obs4 = baseObs();
    delete obs4.anchors.top1HoldSupplyPct;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      't1 供键缺席（旧档断代/supply 缺失）→ I 不触发（fail-open：锚 null 不触发比较门）');
    // 与 E_low_activity 叠加：grade 取最重、双码留痕（CD69 实际形状=E 通道在 G3 期先落 unhealthy）
    const obs5 = baseObs();
    obs5.anchors.top1HoldSupplyPct = 42;
    obs5.activityLevel.bucket = 'low';
    const r5 = grade(obs5, { famousLevel: null, anchorSellCount: 10 });
    ok(r5.grade === 'cheat' && r5.reasons.some((x) => x.level === 'cheat' && x.code === 'I_t1_supply42')
      && r5.reasons.some((x) => x.code === 'E_low_activity'),
      'I + E_low_activity 叠加 → cheat 取最重、E 留痕（CD69 独大+低活跃共存实形）');
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
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 44.9, anchorSellCount: 10 }).grade === 'healthy',
      'G5: dom=high ∧ 跟单 top3=44.9%（分散形散户跟风）→ D 豁免不触发');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 45, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: dom=high ∧ 跟单 top3=45% 恰界 → 触发（集中形线 ≥45）');
    ok(grade(obs, { famousLevel: 'high', famousFollowerTop3Pct: 87, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: dom=high ∧ 跟单 top3=87%（CD63 集中形）→ 触发（疑似分仓维持 unhealthy）');
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

  console.log('F. sbHold≥50 中高同块集中 → unhealthy');
  {
    const obs = baseObs();
    obs.anchors.sameBlockHoldPct = 50;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 10 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'F_sbHold50', 'sbHold=50 恰界 → unhealthy（F 通道）');
    obs.anchors.sameBlockHoldPct = 49.9;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy', 'sbHold 49.9 → healthy');
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
    // 与 F 叠加两条 unhealthy 留痕
    const obs3 = baseObs();
    obs3.bundledDominance.bucket = 'high';
    obs3.anchors.sameBlockHoldPct = 55;
    const r3 = grade(obs3, { famousLevel: null, anchorSellCount: 10 });
    ok(r3.grade === 'unhealthy' && r3.reasons.length === 2,
      'bd=high + F_sbHold 双 unhealthy 留痕（reasons 全记）');
    // 容缺：bundledDominance null / 桶缺失 → 不触发（fail-open 放行方向）
    const obs4 = baseObs();
    obs4.bundledDominance = null;
    ok(grade(obs4, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bundledDominance null（旧档断代）→ G 不触发');
    const obs5 = baseObs();
    obs5.bundledDominance = {};
    ok(grade(obs5, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'bucket 缺失 → G 不触发');
    // G5 簇残余豁免（2026-11-02 批次四用户裁定「其实这里还有一个豁免点，就是如果持仓
    // 已经卖出，也已经对盘面没影响了，也没关系」「如果有已经卖出，且流动性占比不是
    // 特别大，也可以豁免」）：bd=high ∧ sbHold<20 → 不触发；sbHold=null（无合格簇锚）
    // 不豁免 fail-closed 维持触发。128 票分布：豁免仅 CD121(11.4)/CD126(10.7)/
    // CD128(12.6) 三票人工全 cheat 走 A 通道 grade 不变
    const obs6 = baseObs();
    obs6.bundledDominance.bucket = 'high';
    obs6.anchors.sameBlockHoldPct = 19.9;
    ok(grade(obs6, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G5: bd=high ∧ sbHold=19.9（簇残余<20）→ 豁免不触发（簇已卖出对盘面无影响）');
    const obs7 = baseObs();
    obs7.bundledDominance.bucket = 'high';
    obs7.anchors.sameBlockHoldPct = 20;
    ok(grade(obs7, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: bd=high ∧ sbHold=20 恰界 → 触发（豁免线严格小于 20）');
    const obs8 = baseObs();
    obs8.bundledDominance.bucket = 'high';
    obs8.anchors.sameBlockHoldPct = null;
    ok(grade(obs8, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5: bd=high ∧ sbHold=null（无合格簇锚）→ 不豁免维持触发（锚缺席无从谈已卖出，fail-closed）');
    // 簇残余豁免与 F 通道独立：sbHold=19.9 豁免 G 但不触发 F（F 线 50）
    const obs9 = baseObs();
    obs9.bundledDominance.bucket = 'high';
    obs9.anchors.sameBlockHoldPct = 15;
    ok(grade(obs9, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G5: bd=high ∧ sbHold=15 → G/F 均不触发（豁免只作用于 G，F 自有线）');
    // G5 收紧（CD121 口子裁定）：豁免须同块簇与等额簇都基本撤退 sbHold<20 ∧ eqHold<50
    // ——CD121（sbHold 11.4 但 eqHold 54 等额簇持一半筹码）不豁免保住 unhealthy；
    // CD128（12.6/29.2 双簇都撤）豁免（A_strong:pump 保底 grade 仍 cheat）
    const obs10 = baseObs();
    obs10.bundledDominance.bucket = 'high';
    obs10.anchors.sameBlockHoldPct = 11.4;
    obs10.anchors.equalBandHoldPct = 54.0;
    ok(grade(obs10, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5 收紧: bd=high ∧ sbHold=11.4 ∧ eqHold=54.0（CD121 形状=等额簇还持一半）→ 不豁免触发');
    const obs11 = baseObs();
    obs11.bundledDominance.bucket = 'high';
    obs11.anchors.sameBlockHoldPct = 12.6;
    obs11.anchors.equalBandHoldPct = 29.2;
    ok(grade(obs11, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G5 收紧: bd=high ∧ sbHold=12.6 ∧ eqHold=29.2（CD128 形状=双簇都撤）→ 豁免');
    const obs12 = baseObs();
    obs12.bundledDominance.bucket = 'high';
    obs12.anchors.sameBlockHoldPct = 19.9;
    obs12.anchors.equalBandHoldPct = 49.9;
    ok(grade(obs12, { famousLevel: null, anchorSellCount: 10 }).grade === 'healthy',
      'G5 收紧: sbHold<20 ∧ eqHold=49.9 双恰界内 → 豁免');
    const obs13 = baseObs();
    obs13.bundledDominance.bucket = 'high';
    obs13.anchors.sameBlockHoldPct = 19.9;
    obs13.anchors.equalBandHoldPct = 50;
    ok(grade(obs13, { famousLevel: null, anchorSellCount: 10 }).grade === 'unhealthy',
      'G5 收紧: sbHold<20 但 eqHold=50 恰界 → 不豁免（eqHold 线严格小于 50）');
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
    ok(agree === 34, `对拍 34/42 一致（实际 ${agree}/42——G3/G4/G5 对 D3.26 存档重放 agree 不变：旧档 anchors 无 washPair 键=H 缺席不触发、extLevels 无 wash_pair=A 容缺不计；G4 I 通道唯一命中 CD69(46.5) 不在黄金集；G5 双豁免修正——D 跟单集中度：旧档 extras 无 famousFollowerTop3Pct=null→触发零变化（断代保持 G4 行为，实时新锚落 G5 新语义）；G 簇残余豁免双锚收紧（sbHold<20 ∧ eqHold<50）：豁免区 128 票仅 CD128（12.6/29.2，A_strong:pump 保底 grade 仍 cheat）、CD121（11.4 但 eqHold 54≥50 等额簇还持一半）与 CD126（10.7/59.6）不豁免落点回 G4 形状；改规则破坏此数须重新用户裁定）`);
    ok(diffs.join(',') === 'CD56:cheat>healthy,CD84:healthy>unhealthy,CD105:healthy>unhealthy,CD107:healthy>unhealthy,CD108:cheat>unhealthy,CD119:cheat>unhealthy,CD121:cheat>unhealthy,CD122:healthy>unhealthy',
      `八票已知偏差锁定（实际 ${diffs.join(',')}）——CD56 版本漂移/CD108 A 降级（与 CD99 人工漂移对称）/
CD119 B 口径权衡（放宽误伤 CD95/CD100）/CD121 半坡盲区（已质询不立项；机器 G 通道抬 unhealthy——G5 双锚收紧后 sbHold 11.4<20 但 eqHold 54≥50 等额簇还持一半筹码不豁免，落点回 G4 形状）/
CD84+CD105+CD107+CD122=G2 E 简化撤豁免代价（用户裁定「活跃度 low 也判 unhealthy，burst 不判 low」：
t1流吃独食豁免（CD105/CD122）+卖笔对手盘豁免（CD107）撤销+CD84 act=low 搁置票；**本表为旧档位
digest 重放口径——CD105 在 burst 名单，D3.27 题面 burst 反锚重析后 act 应翻非 low 回 healthy**）`);
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
      `levelsFromObservation 12 题映射（实际 ${JSON.stringify(r.levels)}）`);
    ok(r.buckets.sameBlockBuyWave === 'strong' && r.buckets.stallBurstWave === 'burst'
      && r.buckets.washPair === 'strong' && r.buckets.activityLevel === 'low',
      'buckets 字符串原值（metadata 研究留档）');
    const r2 = levelsFromObservation(null);
    ok(Object.values(r2.levels).every((v) => v === null) && Object.keys(r2.levels).length === 12,
      '空观测 → 12 键全 null（容缺不冒充）');
    // 数值锚（用户补点「著名钱包掌控/持仓极不均衡」+D3.28 对敲三键）：obs.anchors
    // 持仓占比四键 + washPair 三键 + extras famous 数值/档位；famousDominance=low/mid/high→0/1/2
    const r3 = levelsFromObservation({
      phenomena: {}, extLevels: {},
      anchors: { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2,
        top1HoldSupplyPct: 25.6, top1HoldCircPct: 53.4,
        washPairCount: 10, washPairSellPct: 95.1, washPairBuyPct: 27.3 },
    }, { famousDominancePct: 87.5, famousDominanceLevel: 'high' });
    ok(r3.anchors && r3.anchors.sameBlockHoldPct === 66.1
      && r3.anchors.equalBandHoldPct === 57.2 && r3.anchors.top1HoldSupplyPct === 25.6
      && r3.anchors.top1HoldCircPct === 53.4 && r3.anchors.famousDominancePct === 87.5
      && r3.anchors.famousDominanceLevel === 'high' && r3.anchors.famousDominance === 2
      && r3.anchors.washPairCount === 10 && r3.anchors.washPairSellPct === 95.1
      && r3.anchors.washPairBuyPct === 27.3,
      `anchors 七键精确映射含 washPair 三键（实际 ${JSON.stringify(r3.anchors)}）`);
    ok(levelsFromObservation({}, { famousDominanceLevel: 'mid' }).anchors.famousDominance === 1,
      'famous 档 low/mid/high → 0/1/2（dominance 映射表复用）');
    const r4 = levelsFromObservation({}, { famousDominancePct: -3, famousDominanceLevel: 'extreme' });
    ok(r4.anchors.sameBlockHoldPct === null && r4.anchors.top1HoldCircPct === null
      && r4.anchors.famousDominancePct === null && r4.anchors.famousDominance === null
      && r4.anchors.famousDominanceLevel === 'extreme',
      '锚缺席/负数/未知档 → 数值 null 不冒充（字符串原值照存留档，buckets 哲学）');
  }

  console.log(`\n✅ _test_cheat_grade 全过（${passed} 断言）`);
}

main();
