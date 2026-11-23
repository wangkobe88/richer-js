#!/usr/bin/env node
/**
 * T213b 好散户币通路包策略单测（零 DB 零网络）：
 *   A. filterArmsByClass 决策核：null=现行语义 bit 不变 / 'cheat'=效果类全撤+作弊类保留
 *      + act_ultra 优先级保持
 *   B. evaluateFactorPreBuy armClass 透传（最小快照端到端：quality 臂不拒）
 *   C. validatePack gatePolicy 白名单（合法过 / 未知键拒 / 非法值拒）
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const {
  filterArmsByClass, CHEAT_CLASS_ARM_CODES, evaluateFactorPreBuy,
} = require(path.join(ROOT, 'src/market-analysis/factor-pre-buy-check.js'));
const { validatePack } = require(path.join(ROOT, 'src/web/services/StrategyLibraryService.js'));

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

console.log('A. filterArmsByClass 决策核');
{
  check('A1 null=现行优先级语义（act_low 优先）', () => {
    const r = filterArmsByClass({ arms: ['cd400_dump_no_absorption'], pvpReason: null, actLevel: 'low', tailReason: null, famousReason: null }, null);
    assert.deepStrictEqual(r, { arms: ['cd400_dump_no_absorption'], reason: 'act_low' });
  });
  check('A2 null=arms[0] 兜底', () => {
    const r = filterArmsByClass({ arms: ['holder_scatter'], pvpReason: null, actLevel: null, tailReason: null, famousReason: null }, null);
    assert.strictEqual(r.reason, 'holder_scatter');
  });
  check('A3 cheat=效果类臂被滤（tail_no_buyer/act_low/pvp/famous 全撤 → pass）', () => {
    const r = filterArmsByClass({ arms: ['tail_no_buyer_pressure', 'holder_scatter'], pvpReason: 'pvp_no_big_participation', actLevel: 'low', tailReason: null, famousReason: 'fam_harvested_dump' }, 'cheat');
    assert.deepStrictEqual(r.arms, []);
    assert.strictEqual(r.reason, null);
  });
  check('A4 cheat=作弊臂保留（cd400 拒因）', () => {
    const r = filterArmsByClass({ arms: ['tail_no_buyer_pressure', 'cd400_dump_no_absorption'], pvpReason: null, actLevel: 'low', tailReason: null, famousReason: null }, 'cheat');
    assert.deepStrictEqual(r.arms, ['cd400_dump_no_absorption']);
    assert.strictEqual(r.reason, 'cd400_dump_no_absorption');
  });
  check('A5 cheat=act_ultra 保留且优先（协同出货=假流量维度，与撤的 low 档不同轴）', () => {
    const r = filterArmsByClass({ arms: ['launch_squad_dominance', 'act_ultra'], pvpReason: null, actLevel: 'ultra', tailReason: null, famousReason: null }, 'cheat');
    assert.strictEqual(r.reason, 'act_ultra');
  });
  check('A6 作弊类全集 12 码（防误改）', () => {
    assert.strictEqual(CHEAT_CLASS_ARM_CODES.size, 12);
    for (const c of ['launch_squad_dominance', 'even_split_crew', 'oversell_residual', 'arb_bot_holdings',
      'cd400_dump_no_absorption', 'cd403_dump_low_absorption', 'dump_pair_low_absorption',
      'cd405_burst_bundled_wave', 'cd412_extreme_dump_sellers', 'cd414_dense_dump',
      'slow_pump_unload', 'act_ultra']) assert.ok(CHEAT_CLASS_ARM_CODES.has(c), c);
  });
}

console.log('B. evaluateFactorPreBuy armClass 端到端（最小快照）');
{
  const snap = { cheatDerived: {}, buyDerived: {} };
  const base = evaluateFactorPreBuy(snap, {});
  check('B1 无策略=现行行为（空快照 act_low 拒；无 armClass 字段）', () => {
    assert.strictEqual(base.pass, false);
    assert.strictEqual(base.armClass, undefined);
  });
  const cheat = evaluateFactorPreBuy(snap, { armClass: 'cheat' });
  check('B2 armClass=cheat 同快照放行（act_low 属效果类被滤）+ 透传字段在场', () => {
    assert.strictEqual(cheat.armClass, 'cheat');
    assert.strictEqual(cheat.pass, true);
  });
}

console.log('C. validatePack gatePolicy 白名单');
{
  const mk = (gp) => ({
    buyLegs: [{ action: 'buy', condition: 'tokenAgeSec >= 15', cards: 1 }],
    sellLegs: [{ action: 'sell', condition: 'profitPercent > 100', cards: 'all' }],
    ...(gp ? { gatePolicy: gp } : {}),
  });
  check('C1 无 gatePolicy=合法（现状包不受影响）', () => assert.strictEqual(validatePack(mk(null)).valid, true));
  check('C2 三键合法值过', () => assert.strictEqual(validatePack(mk({ factorCheckArms: 'cheatOnly', actFront: 'pass', buyPoint: 'stuffingOnly' })).valid, true));
  check('C3 未知键拒', () => assert.strictEqual(validatePack(mk({ nope: 1 })).valid, false));
  check('C4 非法值拒', () => assert.strictEqual(validatePack(mk({ actFront: 'skip' })).valid, false));
}
console.log(`\n全部通过 ${passed}/${passed}`);
