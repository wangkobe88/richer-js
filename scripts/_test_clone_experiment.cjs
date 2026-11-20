#!/usr/bin/env node
/**
 * clone-experiment.cjs 纯函数单测（T202 策略库二期 2026-11-20 重写）——零 DB 零网络
 *
 * 锁定面：
 *   A. bt→live 转换链：剥 backtest/virtual 段 / settleDelayMs 两处显式 delete /
 *      钱包+live 段注入 / Tier2 live ops 标准段逐键在位（**不含门链 enabled——T202
 *      归策略包 modules，LIVE_STD 不再有五 enabled 键与 stallClose/burstCooldown**）
 *   B. 深合并保基底键（浅合并陷阱反证）：cheatCheck.gate 自定义键保留 /
 *      factorParams 单键 merge 保基底其余键
 *   C. 等值零噪音：基底已带标准值 → changes 不含该键
 *   D. live→live（同模式）：不转换段不要求钱包，Tier2 仍确保
 *   E. fail-fast：bt→live 无钱包 throw
 *   F. --mode virtual：剥回测段+加 virtual 段、无 Tier2
 *   G. 不转换（modeArg=null 回测克隆）：零改动
 *   H. stripPackOwnedKeys：ws 段四 enabled 键+顶层 stallClose/burstCooldown 剥离
 *      留痕；ops 键（gate/memSource/settleDelayMs）保留
 *   I. applyPackReference：旧形状无 --pack throw / --pack 转换剥旧腿+libraryRefs /
 *      新形状缺省沿用 strategyId / strategyResolved 恒剥（陈旧审计）/
 *      stats·eventRecording·permanentBlockCondition 恒保留
 *
 * 用法：node scripts/_test_clone_experiment.cjs
 */
'use strict';
const { LIVE_STD_WS, LIVE_STD_TOP, ensureLiveStandardSections, convertMode, stripPackOwnedKeys, applyPackReference } = require('./clone-experiment.cjs');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}
function throwsWith(name, fn, needle) {
  try { fn(); fail++; console.log(`  ✗ ${name}（未 throw）`); }
  catch (e) {
    if (String(e.message).includes(needle)) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}（消息不含「${needle}」: ${e.message}）`); }
  }
}

const PACK_ID = '00000000-0000-0000-0000-0000000000aa';

function btBaseConfig() {
  return {
    platform: 'fourmeme',
    strategyId: PACK_ID,
    strategiesConfig: { stats: { enabled: true }, eventRecording: { enabled: false }, permanentBlockCondition: 'x > 1' },
    backtest: { startTime: '2026-11-01T00:00:00Z', endTime: '2026-11-02T00:00:00Z', signalGateReal: true, sourceExperimentId: 'abc' },
    fourmemeWs: {
      cheatCheck: { settleDelayMs: 0, gate: { awaitMs: 60000, alwaysRecheck: true, activityExemptLevels: ['high'], customGateKey: 1 } },
      buyPointCheck: { settleDelayMs: 0, gate: { awaitMs: 60000 }, factorCheck: { participantProfile: { enabled: true } } },
      factorParams: { netBuyWinTrades: 20, quietThresholdMs: 45000 },
    },
  };
}

console.log('A. bt→live 转换链');
{
  const cfg = btBaseConfig();
  const { cfg: out, mode, changes } = convertMode(cfg, 'backtest', 'live', {
    wallet: { executorId: 'exec-1', address: '0x1234567890abcdef1234567890abcdef12345678' },
    liveParams: { reserveNative: 0.01, slippageTolerance: 20, maxGasPrice: 10, maxPositionTokens: 0 },
  });
  ok('mode=live', mode === 'live');
  ok('剥 backtest 段（含 signalGateReal/窗口）', out.backtest === undefined);
  ok('wallet 注入（executor 形状）', out.wallet.executorId === 'exec-1' && out.wallet.address.startsWith('0x12345678'));
  ok('live 执行段落位 fourmemeWs.live', out.fourmemeWs.live.slippageTolerance === 20);
  ok('settleDelayMs 两处被剥（回测直通值→live 回落 4000 waitIdle 帽）',
    !('settleDelayMs' in out.fourmemeWs.cheatCheck) && !('settleDelayMs' in out.fourmemeWs.buyPointCheck));
  ok('剥段留痕', changes.some(c => c.includes('剥 backtest 段')) && changes.some(c => c.includes('settleDelayMs')));
  // Tier2 ops 全套逐键（T202：无门链 enabled / 无 stallClose / 无 burstCooldown）
  ok('buySignalMaxPerToken=15（防阶梯截断）', out.fourmemeWs.buySignalMaxPerToken === 15);
  ok('sellDebounceMinTicks=5（5-tick 卖确认门）', out.fourmemeWs.sellDebounceMinTicks === 5);
  ok('cheatCheck.gate.awaitMs=60000 + alwaysRecheck=true + activityExemptLevels=[high]',
    out.fourmemeWs.cheatCheck.gate.awaitMs === 60000 && out.fourmemeWs.cheatCheck.gate.alwaysRecheck === true &&
    JSON.stringify(out.fourmemeWs.cheatCheck.gate.activityExemptLevels) === '["high"]');
  ok('T202：LIVE_STD 不含 cheatCheck.enabled / actFrontGate（归策略包）',
    !('enabled' in out.fourmemeWs.cheatCheck) && !('actFrontGate' in out.fourmemeWs.cheatCheck) &&
    !('enabled' in out.fourmemeWs.buyPointCheck) && !('enabled' in out.fourmemeWs.buyPointCheck.factorCheck));
  ok('buyPointCheck.gate.awaitMs=60000', out.fourmemeWs.buyPointCheck.gate.awaitMs === 60000);
  ok('factorSellFilter.enabled=true（T157/T183/T186 卖保护）', out.fourmemeWs.factorSellFilter.enabled === true);
  ok('accountHealthCheck.enabled=true', out.fourmemeWs.accountHealthCheck.enabled === true);
  ok('observationSignals 全键', out.fourmemeWs.observationSignals.enabled === true && out.fourmemeWs.observationSignals.marketCapThreshold === 27);
  ok('positionManagement.perCardBNB=0.05（张数在包腿上）', out.positionManagement.perCardBNB === 0.05);
  ok('T202：live 标准段不写顶层 stallClose/burstCooldown（归策略包）',
    out.stallClose === undefined && out.burstCooldown === undefined);
  ok('signalGatePerTickEval=false（对齐回测 T154 debounce 形态）', out.fourmemeWs.signalGatePerTickEval === false);
}

console.log('B. 深合并保基底键（浅合并陷阱反证）');
{
  const cfg = btBaseConfig();
  const { cfg: out } = convertMode(cfg, 'backtest', 'live', {
    wallet: { executorId: 'e', address: '0x1111111111111111111111111111111111111111' },
    liveParams: {},
  });
  ok('cheatCheck.gate 自定义键保留', out.fourmemeWs.cheatCheck.gate.customGateKey === 1);
  ok('factorParams 单键 merge：netBuyWinTrades 20→12 且 quietThresholdMs 保留',
    out.fourmemeWs.factorParams.netBuyWinTrades === 12 && out.fourmemeWs.factorParams.quietThresholdMs === 45000);
  ok('memSource.enabled=false 注入且不顶掉基底其它子段', out.fourmemeWs.cheatCheck.memSource.enabled === false);
  ok('buyPointCheck.factorCheck 非键子段保留（participantProfile 观察键）',
    out.fourmemeWs.buyPointCheck.factorCheck.participantProfile.enabled === true);
}

console.log('C. 等值零噪音');
{
  const cfg = {
    platform: 'fourmeme',
    fourmemeWs: JSON.parse(JSON.stringify(LIVE_STD_WS)),
    positionManagement: { perCardBNB: 0.05 },
  };
  const changes = [];
  ensureLiveStandardSections(cfg, 'fourmemeWs', changes);
  ok('基底已带全套标准值 → 零改动零噪音', changes.length === 0, changes);
}

console.log('D. live→live（同模式）');
{
  const cfg = { platform: 'fourmeme', strategyId: PACK_ID, fourmemeWs: {}, wallet: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', privateKey: 'cipher' } };
  const { mode, changes } = convertMode(cfg, 'live', 'live', {});
  ok('mode=live 保持', mode === 'live');
  ok('不要求钱包重注入（整包复制已带）', changes.every(c => !c.includes('wallet 注入')));
  ok('Tier2 仍确保（live 产物自足）', cfg.fourmemeWs.buySignalMaxPerToken === 15);
}

console.log('E. fail-fast');
{
  throwsWith('bt→live 无钱包 throw（--executor/--reuse-wallet 必择一）',
    () => convertMode(btBaseConfig(), 'backtest', 'live', {}), '缺钱包');
  throwsWith('bt→live 钱包缺 address throw',
    () => convertMode(btBaseConfig(), 'backtest', 'live', { wallet: { executorId: 'x' } }), '缺钱包');
}

console.log('F. --mode virtual');
{
  const cfg = btBaseConfig();
  const { cfg: out, mode } = convertMode(cfg, 'backtest', 'virtual', {});
  ok('mode=virtual', mode === 'virtual');
  ok('剥 backtest 段', out.backtest === undefined);
  ok('virtual 段注入（冒烟用）', out.virtual.initialBalance === 100 && out.virtual.tradeAmount === 0.1);
  ok('无 Tier2（virtual 产物不带 live 标准段）', out.fourmemeWs.buySignalMaxPerToken === undefined);
}

console.log('G. 不转换（modeArg=null 回测克隆）');
{
  const cfg = btBaseConfig();
  const { mode, changes } = convertMode(cfg, 'backtest', null, {});
  ok('mode=继承基底', mode === 'backtest');
  ok('零改动', changes.length === 0, changes);
  ok('backtest 段原样保留', cfg.backtest.signalGateReal === true);
}

console.log('H. both 基底只注入 fourmemeWs（引擎 _wsConfigSectionName 只读单段）');
{
  const cfg = btBaseConfig(); cfg.platform = 'both'; cfg.flapWs = { reconnect: {} };
  const { cfg: out } = convertMode(cfg, 'backtest', 'live', {
    wallet: { executorId: 'e', address: '0x2222222222222222222222222222222222222222' }, liveParams: {},
  });
  ok('标准段落 fourmemeWs', out.fourmemeWs.buySignalMaxPerToken === 15);
  ok('flapWs 不带 ops 键（仅 collector 侧 per-platform 覆盖用途）', out.flapWs.buySignalMaxPerToken === undefined && out.flapWs.cheatCheck === undefined);
}

console.log('I. stripPackOwnedKeys（T202 归包键剥离）');
{
  const cfg = btBaseConfig();
  // 模拟旧形状基底的归包键残留
  cfg.fourmemeWs.cheatCheck.enabled = true;
  cfg.fourmemeWs.cheatCheck.actFrontGate = { enabled: true };
  cfg.fourmemeWs.buyPointCheck.enabled = true;
  cfg.fourmemeWs.buyPointCheck.factorCheck.enabled = true;
  cfg.stallClose = { stallMs: 50000, minTickBnb: 0.01 };
  cfg.burstCooldown = {};
  const changes = [];
  stripPackOwnedKeys(cfg, changes);
  ok('四 enabled 键剥净', !('enabled' in cfg.fourmemeWs.cheatCheck)
    && !('actFrontGate' in cfg.fourmemeWs.cheatCheck)
    && !('enabled' in cfg.fourmemeWs.buyPointCheck)
    && !('enabled' in cfg.fourmemeWs.buyPointCheck.factorCheck));
  ok('顶层 stallClose/burstCooldown 剥净', cfg.stallClose === undefined && cfg.burstCooldown === undefined);
  ok('ops 键保留（gate/memSource/settleDelayMs/participantProfile）',
    cfg.fourmemeWs.cheatCheck.gate.awaitMs === 60000 && cfg.fourmemeWs.buyPointCheck.factorCheck.participantProfile.enabled === true);
  ok('六处剥离留痕', changes.filter(c => c.includes('归策略包')).length === 6, changes);
  // 幂等：重复剥离零噪音
  const changes2 = [];
  stripPackOwnedKeys(cfg, changes2);
  ok('幂等（已净 config 零改动）', changes2.length === 0, changes2);
}

console.log('J. applyPackReference（策略包引用转换）');
{
  // J1 旧形状无 --pack → throw
  throwsWith('旧形状无 --pack throw（T202 腿不迁移）', () => {
    const cfg = { strategiesConfig: { buyStrategies: [{ condition: 'a > 1' }], sellStrategies: [{ condition: 'b > 1' }] } };
    applyPackReference(cfg, null, []);
  }, '--pack');
  // J2 旧形状 + --pack → 转换
  {
    const cfg = {
      strategiesConfig: {
        buyStrategies: [{ condition: 'a > 1' }, { condition: 'a > 2' }],
        sellStrategies: [{ condition: 'b > 1' }],
        libraryRefs: [{ libId: 'x', name: 'old', version: 3 }],
        stats: { enabled: true }, eventRecording: { enabled: false }, permanentBlockCondition: 'x > 1',
      },
    };
    const changes = [];
    const ref = applyPackReference(cfg, PACK_ID, changes);
    ok('strategyId 落位', cfg.strategyId === PACK_ID && ref.strategyId === PACK_ID && ref.isLegacy === true);
    ok('旧腿+libraryRefs 剥净（stats/eventRecording/permanentBlockCondition 保留）',
      cfg.strategiesConfig.buyStrategies === undefined && cfg.strategiesConfig.sellStrategies === undefined
      && cfg.strategiesConfig.libraryRefs === undefined && cfg.strategiesConfig.stats.enabled === true
      && cfg.strategiesConfig.eventRecording.enabled === false && cfg.strategiesConfig.permanentBlockCondition === 'x > 1');
    ok('转换留痕', changes.some(c => c.includes('旧腿形状转换')) && changes.some(c => c.includes('剥旧内嵌腿 3 条')));
  }
  // J3 新形状缺省沿用 + strategyResolved 剥离
  {
    const cfg = { strategyId: PACK_ID, strategyResolved: { id: PACK_ID, version: 7 } };
    const changes = [];
    const ref = applyPackReference(cfg, null, changes);
    ok('缺省沿用 strategyId', cfg.strategyId === PACK_ID && ref.isLegacy === false);
    ok('strategyResolved 陈旧审计剥除', cfg.strategyResolved === undefined);
  }
  // J4 新形状换包
  {
    const cfg = { strategyId: '00000000-0000-0000-0000-0000000000bb' };
    const changes = [];
    applyPackReference(cfg, PACK_ID, changes);
    ok('换包落位+留痕', cfg.strategyId === PACK_ID && changes.some(c => c.includes('换包')));
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`clone-experiment 转换链单测：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
