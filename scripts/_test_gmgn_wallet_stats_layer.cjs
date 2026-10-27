#!/usr/bin/env node
/**
 * GMGN 钱包画像层接线单测（2026-10-18，Agentum 快枪捆绑/Konasu 对倒/7777 sybil
 * 三案后 GMGN wallet_stats 调研接入）——本地零 DB 零网络。
 *
 * 接线面（service 本体行为见 _test_gmgn_wallet_stats_service.cjs，本文件只测接线）：
 *   A. 键集扩展：GMGN_CONDITION_FACTOR_KEYS = 原 token-api 5 键 ∪ gwp 18 键
 *   B. checkAndEvaluate 第五参：缺省/null 不并键=存量零影响；传入并键可评；
 *      covered=0 机制硬拒优先；gwpCovered=null 走 IS NULL 臂
 *   C. 引擎接线删除反证（T71 2026-10-26）：gwp 数据口 getEarlyTopBuyers 随 early 族
 *      退役 → ctor/预取挂点/构建门/stop 清态/第五参透传整链删，第五参恒 null
 *   E. BacktestEngine：gwp 键显式 null spread（回测不接线——动态计数对历史
 *      fire 是时序穿越，跳过比穿越诚实）
 *   F. config 默认关 + 17 键与 DEFAULTS 同值（漂移防线）
 *   G. 校验链：gmgnCheckCondition 引用 gwp 键过 validateLegs（未知因子
 *      fail-fast 不误拒新键）
 *
 * 用法：node scripts/_test_gmgn_wallet_stats_layer.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ── 打桩准备：先污染 gmgn-api 模块再加载被测模块（惰性 require 拿 stub）──
const gmgnMod = require(path.join(ROOT, 'src/core/gmgn-api'));
const apiCalls = [];
let stubBehavior = null; // { response } | { error }
class StubGMGNTokenAPI {
  constructor(opts) { this.opts = opts; }
  async getTokenInfo(chain, address) {
    apiCalls.push({ chain, address });
    if (stubBehavior && stubBehavior.error) throw stubBehavior.error;
    return stubBehavior ? stubBehavior.response : null;
  }
}
gmgnMod.GMGNTokenAPI = StubGMGNTokenAPI;

const { GmgnRiskCheckService, GMGN_CONDITION_FACTOR_KEYS } =
  require(path.join(ROOT, 'src/trading-engine/pre-check/GmgnRiskCheckService'));
const { GWP_FACTOR_KEYS, DEFAULTS, GmgnWalletStatsService } =
  require(path.join(ROOT, 'src/trading-engine/pre-check/GmgnWalletStatsService'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

// GMGN token-api 覆盖成功形状（covered=1 前置，gwp 臂才被评到）
const OK_INFO = {
  dev: { twitter_create_token_count: 0, creator_token_status: 'creator_hold' },
  wallet_tags_stat: { bundler_wallets: 1, top_wallets: 8 },
  visiting_count: 3,
};

// ═══════════════ A. 键集扩展 ═══════════════
console.log('A. 键集扩展（GmgnRiskCheckService 第四键集单一真相源）');
{
  const need = new Set(GWP_FACTOR_KEYS);
  const extra = GMGN_CONDITION_FACTOR_KEYS.filter(k => !need.has(k));
  check('A1 原 token-api 5 键保留（bundler/issuer/riskCovered/visiting/narrativeCategory）',
    ['gmgnBundlerWalletRatio', 'gmgnIssuerTokenCount', 'gmgnRiskCovered', 'gmgnVisitingCount', 'narrativeCategory']
      .every(k => GMGN_CONDITION_FACTOR_KEYS.includes(k)),
    String(GMGN_CONDITION_FACTOR_KEYS));
  check('A2 gwp 18 键全数并入', GWP_FACTOR_KEYS.every(k => GMGN_CONDITION_FACTOR_KEYS.includes(k)),
    `missing: ${GWP_FACTOR_KEYS.filter(k => !GMGN_CONDITION_FACTOR_KEYS.includes(k)).join(',')}`);
  check('A3 键集无意外杂键（5+18+T76 注意力空转四键=27 恰好，2026-10-27）',
    GMGN_CONDITION_FACTOR_KEYS.length === 27 && extra.length === 9,
    `len=${GMGN_CONDITION_FACTOR_KEYS.length} extra=${extra.join(',')}`);
}

// ═══════════════ B. checkAndEvaluate 第五参 ═══════════════
console.log('B. checkAndEvaluate 第五参（存量零影响）');
(async () => {
  const savedKey = process.env.GMGN_API_KEY;
  process.env.GMGN_API_KEY = 'test-key';
  try {
    const GWP_GATE = '(gwpCovered IS NULL OR (gwpCovered == 1 AND gwpCreatedClusterWallets < 3))';
    const svc = () => new GmgnRiskCheckService({ perTokenTtlMs: 0 }, { info() {}, warn() {}, error() {} });

    // B1 缺省（不传四五参）：context 无任何 gwp 键
    apiCalls.length = 0; stubBehavior = { response: OK_INFO };
    const v1 = await svc().checkAndEvaluate('0xB1', 'bsc', 'gmgnBundlerWalletRatio <= 75');
    check('B1 缺省第五参：context 零 gwp 键（存量零影响）',
      v1.passed === true && GWP_FACTOR_KEYS.every(k => v1.factors[k] === undefined),
      JSON.stringify(v1.factors));
    // B2 显式 null 同形状
    const v2 = await svc().checkAndEvaluate('0xB2', 'bsc', 'gmgnBundlerWalletRatio <= 75', null, null);
    check('B2 第五参 null：同缺省（未启用/回测路径）',
      v2.passed === true && GWP_FACTOR_KEYS.every(k => v2.factors[k] === undefined));
    // B3 传入 gwp 因子：并键 + 表达式可评
    const gwp = GmgnWalletStatsService.computeWalletProfileFactors(
      [{ wallet: 'w1', bnb: 0.3 }, { wallet: 'w2', bnb: 0.3 }, { wallet: 'w3', bnb: 0.3 }],
      new Map([
        ['w1', { tags: [], createdAtSec: 100, buy7d: 707, sell7d: 707, tokenNum7d: 710 }],
        ['w2', { tags: [], createdAtSec: 101, buy7d: 704, sell7d: 710, tokenNum7d: 707 }],
        ['w3', { tags: [], createdAtSec: 102, buy7d: 700, sell7d: 707, tokenNum7d: 709 }],
      ]), {}, Date.now());
    const v3 = await svc().checkAndEvaluate('0xB3', 'bsc', GWP_GATE, null,
      { ...gwp, gwpCovered: 1, gwpSelected: 3, gwpProfiled: 3, gwpFailed: 0 });
    check('B3 传入 gwp：并键可评（Konasu 形状 cCluster=3 门拒）',
      v3.passed === false && v3.factors.gwpCovered === 1 && v3.factors.gwpCreatedClusterWallets === 3,
      JSON.stringify(v3.factors));
    // B4 covered=0 → token 层 fail-open 放行（2026-10-20 乌龟案裁定），gwp 键不评
    apiCalls.length = 0; stubBehavior = { error: new Error('boom') };
    const v4 = await svc().checkAndEvaluate('0xB4', 'bsc', GWP_GATE, null,
      { ...GmgnWalletStatsService.emptyFactors(), gwpCovered: 1, gwpSelected: 1, gwpProfiled: 1 });
    check('B4 gmgnRiskCovered=0 → fail-open 放行（gwp 键在 context 也不评表达式，reason 留痕）',
      v4.passed === true && v4.evaluated === false && v4.reason && v4.reason.startsWith('gmgn_check_no_data'));
    // B5 gwpCovered=null 走 IS NULL 臂放行（未启用语义在表达式层）
    apiCalls.length = 0; stubBehavior = { response: OK_INFO };
    const v5 = await svc().checkAndEvaluate('0xB5', 'bsc', GWP_GATE, null,
      { ...GmgnWalletStatsService.emptyFactors(), gwpSelected: 0 });
    check('B5 gwpCovered=null IS NULL 臂放行（C85 narrativeCategory 同款）', v5.passed === true);
  } finally {
    if (savedKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = savedKey;
  }

  // ═══════════════ C. 实时引擎源码口径 ═══════════════
  // 2026-10-26 T71：earlyTrades* 族整族删除 → 数据口 getEarlyTopBuyers 作废 → 引擎接线
  // 整链删除（ctor/预取挂点/构建门/stop 清态/第五参透传）。本段翻防复活反证；将来重启
  // gwp 层须换全史数据源并重写本段。
  console.log('C. 引擎接线删除反证（T71 gwp 数据口作废）');
  {
    const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
    const noComments = src.replace(/\/\/[^\n]*/g, '');
    check('C1 引擎无 gwp 接线残留（service/预取/构建门/状态 Map 墓碑外零子串）',
      !['GmgnWalletStatsService', '_walletStatsService', '_walletProfilePrefetchCheck',
        '_gwpConditionLegExists', '_walletProfileStates'].some(s => noComments.includes(s)),
      'gwp 接线标识复活');
    check('C2 checkAndEvaluate 调用点第五参恒 null（存量零影响形状；T76 第六参 buyContext 独立追加不占第五参位）',
      /factorResults\?\.narrativeCategory \?\? null,\s*\n\s*null,\s*\n\s*\/\/ T76/.test(src),
      '第五参非恒 null');
    check('C3 数据口 getEarlyTopBuyers 已随 early 族删除（FA 不再有该方法）',
      typeof new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} }).getEarlyTopBuyers !== 'function',
      'getEarlyTopBuyers 复活');
  }

  // ═══════════════ E. BacktestEngine ═══════════════
  console.log('E. BacktestEngine（回测不接线——时序穿越防线）');
  {
    const btsrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    check('E1 GMGN 快照层 spread emptyFactors（gwp 键显式 null）',
      btsrc.includes('...GmgnWalletStatsService.emptyFactors(),'));
    check('E2 回测不构造 GmgnWalletStatsService（动态计数对历史 fire=时序穿越，跳过比穿越诚实）',
      !btsrc.includes('new GmgnWalletStatsService'));
    const empt = GmgnWalletStatsService.emptyFactors();
    check('E3 emptyFactors 全键 null（IS NULL 臂放行）',
      GWP_FACTOR_KEYS.every(k => empt[k] === null) && Object.keys(empt).length === GWP_FACTOR_KEYS.length);
  }

  // ═══════════════ F. config 默认关 + 键漂移防线 ═══════════════
  console.log('F. config/default.json 默认关');
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/default.json'), 'utf8'));
    const seg = cfg.fourmemeWs && cfg.fourmemeWs.gmgnWalletStats;
    check('F1 enabled:false 物化（Phase 0 存量 bit-identical）', seg && seg.enabled === false);
    const drift = Object.keys(DEFAULTS).filter(k => k !== 'enabled' && seg[k] !== DEFAULTS[k]);
    check('F2 17 键与 DEFAULTS 同值（漂移防线）', drift.length === 0, `drift: ${drift.join(',')}`);
    check('F3 flapWs 无独立段（经 _mergedWsConfig 同键——flap 实验配 flapWs.gmgnWalletStats 生效）',
      !(cfg.flapWs && cfg.flapWs.gmgnWalletStats));
  }

  // ═══════════════ G. 校验链 ═══════════════
  console.log('G. validateLegs（未知因子 fail-fast 不误拒 gwp 键）');
  {
    const { validateLegs } = require(path.join(ROOT, 'src/web/services/StrategyLibraryService'));
    const GWP_GATE = '(gwpCovered IS NULL OR (gwpCovered == 1 AND gwpCreatedClusterWallets < 3 ' +
      'AND gwpNearMirrorClusterWallets < 3 AND (gwpYoungCount < 3 OR gwpYoungBnbPct < 60)))';
    const legs = [{ name: 'gwp-obs', condition: 'buyVolumeBnb >= 1.0',
      gmgnCheckCondition: `gmgnRiskCovered == 1 AND ${GWP_GATE}` }];
    const err = validateLegs('buy', legs);
    check('G1 gmgnCheckCondition 引用 gwp 键过校验（键集已扩）',
      err && err.valid === true, JSON.stringify(err && err.errors));
    const bad = validateLegs('buy', [{ name: 'bad', condition: 'buyVolumeBnb >= 1.0',
      gmgnCheckCondition: 'gwpTypoKey < 3' }]);
    check('G2 拼错 gwp 键仍拒（fail-fast 防线不被键集扩展削弱）',
      bad && bad.valid === false && bad.errors.some(e => /gwpTypoKey/.test(e)),
      JSON.stringify(bad && bad.errors));
  }

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('[fatal]', e); process.exit(1); });
