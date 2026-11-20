#!/usr/bin/env node
/**
 * clone-experiment.cjs --mode live 转换链单测（2026-11-20 实盘恢复对齐审计立）——零 DB 零网络
 *
 * 背景：实盘停止于 2026-11-05（v74=库 v3/v4 时代），其后全部机制改进只在回测验证。
 * 恢复实盘的最大洞=配置层：default.json 缺省几乎全关（BP 门 fail-closed 全拒零买入、
 * factorSellFilter/stallClose/burstCooldown 缺段即关静默回退、buySignalMaxPerToken 5
 * 截断 15 信号阶梯、sellDebounceMinTicks 0 丢 5-tick 卖确认门），旧克隆工具只确保
 * 4 个 enabled 布尔。本测锁定 convertMode/ensureLiveStandardSections 纯函数：
 *   A. bt→live 转换链：剥 backtest/virtual 段 / settleDelayMs 两处显式 delete（live
 *      携 0=跳过 settle→sender 未定值→wallet 口径退化——剥键回落 4000 waitIdle 帽）/
 *      钱包+live 段注入 / Tier2 标准段全套逐键在位（docs/当前最优买卖策略.md 基准）
 *   B. 深合并保基底键（浅合并陷阱反证）：cheatCheck.gate 自定义键保留 / factorParams
 *      单键 merge 保基底其余键 / stallClose merge 保 almostLaunchStallMs 延长档
 *   C. 等值零噪音：基底已带标准值 → changes 不含该键
 *   D. live→live（同模式）：不转换段不要求钱包，Tier2 仍确保
 *   E. fail-fast：bt→live 无钱包 throw
 *   F. --mode virtual：剥回测段+加 virtual 段、无 Tier2
 *   G. 不转换（modeArg=null 回测克隆）：零改动（Tier1 在主脚本全模式段，不在本函数）
 *   H. 用户裁定值：burstCooldown {} 启用 / signalGatePerTickEval false 对齐回测
 *
 * 用法：node scripts/_test_clone_experiment.cjs
 */
'use strict';
const { LIVE_STD_WS, LIVE_STD_TOP, ensureLiveStandardSections, convertMode } = require('./clone-experiment.cjs');

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

function btBaseConfig() {
  return {
    platform: 'fourmeme',
    strategiesConfig: { buyStrategies: [{ name: 't0', signalGate: { maxTriggers: 2 }, cards: 4 }], sellStrategies: [] },
    backtest: { startTime: '2026-11-01T00:00:00Z', endTime: '2026-11-02T00:00:00Z', signalGateReal: true, sourceExperimentId: 'abc' },
    fourmemeWs: {
      cheatCheck: { enabled: true, settleDelayMs: 0, gate: { awaitMs: 60000, alwaysRecheck: true, activityExemptLevels: ['high'], customGateKey: 1 } },
      buyPointCheck: { enabled: true, settleDelayMs: 0, gate: { awaitMs: 60000 }, factorCheck: { enabled: true } },
      factorParams: { netBuyWinTrades: 20, quietThresholdMs: 45000 },
    },
    stallClose: { stallMs: 50000, minTickBnb: 0.01, almostLaunchStallMs: 90000 },
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
  // Tier2 全套逐键
  ok('buySignalMaxPerToken=15（防阶梯截断）', out.fourmemeWs.buySignalMaxPerToken === 15);
  ok('sellDebounceMinTicks=5（5-tick 卖确认门）', out.fourmemeWs.sellDebounceMinTicks === 5);
  ok('cheatCheck.gate.awaitMs=60000 + alwaysRecheck=true + activityExemptLevels=[high]',
    out.fourmemeWs.cheatCheck.gate.awaitMs === 60000 && out.fourmemeWs.cheatCheck.gate.alwaysRecheck === true &&
    JSON.stringify(out.fourmemeWs.cheatCheck.gate.activityExemptLevels) === '["high"]');
  ok('actFrontGate.enabled=true（AF1）', out.fourmemeWs.cheatCheck.actFrontGate.enabled === true);
  ok('buyPointCheck.factorCheck.enabled=true（FP 门）', out.fourmemeWs.buyPointCheck.factorCheck.enabled === true);
  ok('buyPointCheck.gate.awaitMs=60000', out.fourmemeWs.buyPointCheck.gate.awaitMs === 60000);
  ok('factorSellFilter.enabled=true（T157/T183/T186 卖保护）', out.fourmemeWs.factorSellFilter.enabled === true);
  ok('accountHealthCheck.enabled=true', out.fourmemeWs.accountHealthCheck.enabled === true);
  ok('observationSignals 全键', out.fourmemeWs.observationSignals.enabled === true && out.fourmemeWs.observationSignals.marketCapThreshold === 27);
  ok('positionManagement.perCardBNB=0.05（+cards:4=0.2 BNB/笔）', out.positionManagement.perCardBNB === 0.05);
  ok('stallClose minTickBnb=0.01 保留+stallMs 50000', out.stallClose.stallMs === 50000 && out.stallClose.minTickBnb === 0.01);
  ok('burstCooldown 段在场（2026-11-20 用户裁定启用，全默认）', out.burstCooldown && Object.keys(out.burstCooldown).length === 0);
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
  ok('stallClose merge 保 almostLaunchStallMs 延长档', out.stallClose.almostLaunchStallMs === 90000);
  ok('memSource.enabled=false 注入且不顶掉基底其它子段', out.fourmemeWs.cheatCheck.memSource.enabled === false);
}

console.log('C. 等值零噪音');
{
  const cfg = {
    platform: 'fourmeme',
    fourmemeWs: JSON.parse(JSON.stringify(LIVE_STD_WS)),
    positionManagement: { perCardBNB: 0.05 },
    stallClose: { stallMs: 50000, minTickBnb: 0.01 },
    burstCooldown: {},
  };
  const changes = [];
  ensureLiveStandardSections(cfg, 'fourmemeWs', changes);
  ok('基底已带全套标准值 → 零改动零噪音', changes.length === 0, changes);
}

console.log('D. live→live（同模式）');
{
  const cfg = { platform: 'fourmeme', fourmemeWs: {}, wallet: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', privateKey: 'cipher' } };
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
  ok('无 Tier2（virtual 产物不带 live 标准段）', out.fourmemeWs.buySignalMaxPerToken === undefined && out.burstCooldown === undefined);
}

console.log('G. 不转换（modeArg=null 回测克隆）');
{
  const cfg = btBaseConfig();
  const { mode, changes } = convertMode(cfg, 'backtest', null, {});
  ok('mode=继承基底', mode === 'backtest');
  ok('零改动（Tier1 在主脚本全模式段，不在本函数——回测克隆 bit 一致）', changes.length === 0, changes);
  ok('backtest 段原样保留', cfg.backtest.signalGateReal === true);
}

console.log('H. both 基底只注入 fourmemeWs（引擎 _wsConfigSectionName 只读单段）');
{
  const cfg = btBaseConfig(); cfg.platform = 'both'; cfg.flapWs = { reconnect: {} };
  const { cfg: out } = convertMode(cfg, 'backtest', 'live', {
    wallet: { executorId: 'e', address: '0x2222222222222222222222222222222222222222' }, liveParams: {},
  });
  ok('标准段落 fourmemeWs', out.fourmemeWs.buySignalMaxPerToken === 15);
  ok('flapWs 不带门链键（仅 collector 侧 per-platform 覆盖用途）', out.flapWs.buySignalMaxPerToken === undefined && out.flapWs.cheatCheck === undefined);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`clone-experiment 转换链单测：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
