#!/usr/bin/env node
/**
 * 作弊盘三级分级规则单测（G1）——零 DB 零网络纯函数
 *
 * 覆盖：六通道逐条（A_strong/A 降级/B/C/D/E/F）/ 豁免边界（burst、t1=40、
 * 卖笔 2 三豁免恰界）/ cr-sbw 辅助判定不进主判 / 容缺 fail-open（档位 null
 * 不计、锚 null 不触发、sells 缺席 E 不触发、sbw null 按 non-burst）/
 * 优先级（cheat>unhealthy>healthy 多通道叠加）/ 42 票黄金集对拍 37/42
 * （五票已知偏差锁定：CD56 版本漂移/CD108 A 降级/CD110 t1 豁免副作用/
 * CD119 B 口径权衡/CD121 半坡盲区——定性见台账 G1 段，**改规则须连此锁定
 * 一起重裁定**）。失败 exit 非零。
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

// ── 观测工厂：全 none 干净盘（六通道全不触发的基底）──
function baseObs() {
  return {
    phenomena: {
      equal_amount_split: 'none', coordinated_sell_back: 'none',
      creator_front_run: 'none', sell_dispersion: 'none',
    },
    extLevels: {
      stall_burst_wave: 'none', amount_tiering: 'none',
      same_block_buy_wave: 'none', insider_supply_sell: 'none',
      slow_grind_pump: 'none',
    },
    activityLevel: { bucket: 'mid', prob: 0.8 },
    bundledDominance: { bucket: 'low', prob: 0.9 },
    anchors: { sameBlockHoldPct: null, top1HoldCircPct: null },
  };
}
function withPhen(obs, id, bucket) { obs.phenomena[id] = bucket; return obs; }
function withExt(obs, id, bucket) { obs.extLevels[id] = bucket; return obs; }
function grade(obs, extras) { return gradeObservation(obs, extras || { famousLevel: null, anchorSellCount: null }); }

function main() {
  ok(CHEAT_GRADE_RULES_VERSION === 'G1', '版本常量 G1（改规则必须 bump+同步台账+跑黄金集）');
  ok(MAIN_IDS.length === 7 && !MAIN_IDS.includes('creator_front_run') && !MAIN_IDS.includes('stall_burst_wave'),
    `七主判=四现象剔 cr + tier/bw/rat/pump（cr/sbw 辅助判定不进主判，实际 ${MAIN_IDS.join(',')}）`);

  console.log('A. 七主判 strong → cheat');
  {
    for (const id of MAIN_IDS) {
      const r = grade(withExt(withPhen(baseObs(), id.replace(/^(amount_tiering|same_block_buy_wave|insider_supply_sell|slow_grind_pump)$/, '$&'), 'strong'), id, 'strong'));
      // 直接设七题各一 strong（phen/ext 键重复无害——按 id 域写）
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

  console.log('D. 著名钱包主导 → unhealthy');
  {
    const obs = baseObs();
    const r = grade(obs, { famousLevel: 'high', anchorSellCount: 10 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'D_famous_dominance',
      'famousLevel=high 单独 → unhealthy（bd=high 不足以定 cheat——CD98/CD116/CD127 反证）');
    ok(grade(obs, { famousLevel: 'mid', anchorSellCount: 10 }).grade === 'healthy',
      'famousLevel=mid 不触发 D');
  }

  console.log('E. 活跃度低（三豁免）');
  {
    const obs = baseObs();
    obs.activityLevel.bucket = 'low';
    obs.anchors.top1HoldCircPct = 10;
    const r = grade(obs, { famousLevel: null, anchorSellCount: 1 });
    ok(r.grade === 'unhealthy' && r.reasons[0].code === 'E_low_activity(sells=1)',
      'act=low ∧ sbw≠burst ∧ t1<40 ∧ 卖笔≤1 → unhealthy（CD101「活跃度低」载体化）');
    // 豁免一：sbw=burst
    withExt(obs, 'stall_burst_wave', 'burst');
    ok(grade(obs, { famousLevel: null, anchorSellCount: 1 }).grade === 'healthy',
      '豁免①：sbw=burst（停滞突发不算活跃度低——用户语义）');
    // 豁免二：t1流≥40
    withExt(obs, 'stall_burst_wave', 'none');
    obs.anchors.top1HoldCircPct = 40;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 1 }).grade === 'healthy',
      '豁免②：t1 流 40 恰界（≥40 单钱包吃独食家族——CD105/CD122）');
    // 豁免三：卖笔≥2
    obs.anchors.top1HoldCircPct = 10;
    ok(grade(obs, { famousLevel: null, anchorSellCount: 2 }).grade === 'healthy',
      '豁免③：卖笔 2 恰界（≥2 有真实对手盘——CD107）');
    // sbw null 按「非 burst」处理（无证据不豁免）
    const obs2 = baseObs();
    obs2.activityLevel.bucket = 'low';
    obs2.anchors.top1HoldCircPct = 10;
    obs2.extLevels.stall_burst_wave = null;
    ok(grade(obs2, { famousLevel: null, anchorSellCount: 1 }).grade === 'unhealthy',
      'sbw null 按 non-burst（burst 豁免需在场证据，已知容缺例外）');
    // anchorSellCount 缺席（旧 digest 重放）→ E 不触发
    ok(grade(baseObs() && (() => { const o = baseObs(); o.activityLevel.bucket = 'low'; o.anchors.top1HoldCircPct = 10; return o; })(), { famousLevel: null }).grade === 'healthy',
      'anchorSellCount 缺席 → E 不触发（fail-open 放行方向）');
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

  console.log('42 票黄金集对拍（D3.26 存档+fixtures expect）');
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
    ok(agree === 37, `对拍 37/42 一致（实际 ${agree}/42——改规则破坏此数须重新用户裁定）`);
    ok(diffs.join(',') === 'CD56:cheat>healthy,CD108:cheat>unhealthy,CD110:unhealthy>healthy,CD119:cheat>unhealthy,CD121:cheat>healthy',
      `五票已知偏差锁定（实际 ${diffs.join(',')}）——CD56 版本漂移/CD108 A 降级（与 CD99 人工漂移对称）/
CD110 t1 豁免副作用（保护 CD105/CD122 代价）/CD119 B 口径权衡（放宽误伤 CD95/CD100）/CD121 半坡盲区（已质询不立项）`);
  }

  // ── G1 因子化（2026-11-01 用户指令）：档位→数值映射表 + levelsFromObservation ──
  console.log('\nH. 因子化数值映射（CHEAT_LEVEL_SCORES / levelsFromObservation）');
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
        same_block_buy_wave: 'strong', insider_supply_sell: 'weak', slow_grind_pump: 'none' },
      activityLevel: { bucket: 'low' }, bundledDominance: { bucket: 'mid' },
    });
    ok(r.levels.equalAmountSplit === 2 && r.levels.coordinatedSellBack === null
      && r.levels.creatorFrontRun === 1 && r.levels.stallBurstWave === 1
      && r.levels.sameBlockBuyWave === 3 && r.levels.amountTiering === null
      && r.levels.activityLevel === 0 && r.levels.bundledDominance === 1,
      `levelsFromObservation 11 题映射（实际 ${JSON.stringify(r.levels)}）`);
    ok(r.buckets.sameBlockBuyWave === 'strong' && r.buckets.stallBurstWave === 'burst'
      && r.buckets.activityLevel === 'low', 'buckets 字符串原值（metadata 研究留档）');
    const r2 = levelsFromObservation(null);
    ok(Object.values(r2.levels).every((v) => v === null) && Object.keys(r2.levels).length === 11,
      '空观测 → 11 键全 null（容缺不冒充）');
    // 数值锚六键（用户补点「著名钱包掌控/持仓极不均衡」）：obs.anchors 四键
    // 持仓占比 + extras famous 数值/档位；famousDominance=low/mid/high→0/1/2
    const r3 = levelsFromObservation({
      phenomena: {}, extLevels: {},
      anchors: { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2,
        top1HoldSupplyPct: 25.6, top1HoldCircPct: 53.4 },
    }, { famousDominancePct: 87.5, famousDominanceLevel: 'high' });
    ok(r3.anchors && r3.anchors.sameBlockHoldPct === 66.1
      && r3.anchors.equalBandHoldPct === 57.2 && r3.anchors.top1HoldSupplyPct === 25.6
      && r3.anchors.top1HoldCircPct === 53.4 && r3.anchors.famousDominancePct === 87.5
      && r3.anchors.famousDominanceLevel === 'high' && r3.anchors.famousDominance === 2,
      `anchors 六键精确映射（实际 ${JSON.stringify(r3.anchors)}）`);
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
