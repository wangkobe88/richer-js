#!/usr/bin/env node
/**
 * sybil 大簇合计持仓因子单测（2026-10-20 乌龟案用户裁定）
 * ——本地零 DB 零网络（名单经 setSybilClustersForTest 桩注入；loader 读仓库真实产物）。
 *
 * 因子口径：sybil 大簇名单（build-sybil-clusters.cjs 从 14 天 pair 缓存建「强边
 * co>=50 且 同步卖/等额过半 → 连通分量 size>=3」）**钱包合计**净持仓 ÷ 流通
 * (_circTokens)×100。刻意合计非单钱包最大：乌龟案四钱包等额簇 fire 时单钱包 10.4%
 * 过 famous 15 门，合计 38.9%（c3 口径 72.9%）——单钱包口径对分仓簇天然漏检
 * （与 maxCopyWalletHolderCircPct/famousCopyWalletCircPct 的「最大」口径并存）。
 * null 语义 fail-open（同 famous）：文件缺失/空集合 → 因子恒 null → 条件串 IS NULL
 * 臂放行；非空 → 0 起（有证据零值）。
 *
 * 覆盖：
 *   A. 乌龟案现场反证（四钱包等额簇合计 61.5% 拦截；单钱包 15.4% 过 famous 门
 *      ——合计口径是唯一能拦的形状）
 *   B. 负净持仓不计入（净卖者出局）/ 非簇钱包不计入 / 名单未启用 null
 *   C. 卖腿收缩流通（分母同 top1 口径）
 *   D. 乱序 parity
 *   E. loader：仓库产物可加载（含乌龟四钱包）/ setter 生命周期
 *   F. 探针 + 白名单 + 字面量（三防线零登记出键自动性）
 *   G. 源码锁（合计语义 / 禁 Date.now / 两引擎接线 / 生成脚本与回放定档注释在场）
 *
 * 用法：node scripts/_test_sybil_cluster_factor.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1792425600000; // 2026-10-19 16:00 UTC（乌龟盘创建时刻附近）
const M = 1e6;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

// 乌龟案 0x0adad648…7777 四钱包簇（14 天 pair 缓存：co 116~165 / 同步卖 84~142 / 等额买 88~122）
const TURTLE = [
  '0x371903abb32f5f69b536b77495e92adedfea25da',
  '0x3a9732edd0624b39d006c89a0e327020dc06eb99',
  '0x1fb07574dc38c0d50703b2e85c010aebb23a745d',
  '0x7f77f1fa835e8c163efe34d320e82e30310b3c45',
];
const OUTSIDER = '0x999911114444555566667777888899990000abcd';

// ═══════════════ A. 乌龟案现场反证 ═══════════════
console.log('A. 乌龟案现场反证（四钱包等额簇：单钱包过门、合计必拦）');
{
  const fa = newFA();
  // 散户垫流通 50M（10 钱包各 5M）
  for (let i = 0; i < 10; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 1000 + i, trader_address: `eoaR${i}`, sender_address: `0x000000000000000000000000000000000000${String(i).padStart(4, '0')}`,
      block_number: 500 + i, log_index: i, bnb_amount: 0.1, token_amount: 5 * M }), {});
  }
  // 16:01:16 同块四钱包等额买入（真实形状：各 ~18-22M token，同 block）
  TURTLE.forEach((w, i) => {
    fa.processTick(mkTick({ timestamp: T0 + 40000, trader_address: '0x1de460f363af910f51726def188f9004276bf4bc',
      sender_address: w, block_number: 82604, log_index: 17 + i * 26, bnb_amount: 0.2, token_amount: 20 * M }), {});
  });
  FourMemeFactorAggregator.setSybilClustersForTest(new Set(TURTLE));
  const f = fa.buildFactorMap('0xtoken', T0 + 90000);
  // 流通 = 50 + 80 = 130M；簇合计 80M → 61.5%；单钱包 20M → 15.38%
  check('A1 sybilClusterHolderCircPct ≈ 61.5（簇合计 80M/流通 130M）', () =>
    assert.ok(Math.abs(f.sybilClusterHolderCircPct - 61.5) < 0.1, `got ${f.sybilClusterHolderCircPct}`));
  check('A2 对照：单钱包口径 ≈ 15.4（同一票 famous 门 <15 反而放行——合计口径才拦得住）', () => {
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set([TURTLE[0]]));
    const ff = fa.buildFactorMap('0xtoken', T0 + 90000);
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
    assert.ok(Math.abs(ff.famousCopyWalletCircPct - 15.38) < 0.1, `got ${ff.famousCopyWalletCircPct}`);
  });
  check('A3 门语义：61.5 >= 35 → 裸比较为 false=拒买（2026-10-22 去 NULL 后条件串不带 IS NULL 臂）', () => {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    const cond = 'sybilClusterHolderCircPct < 35';
    assert.strictEqual(ev.evaluate(cond, f), false);
    assert.strictEqual(ev.evaluate(cond, { ...f, sybilClusterHolderCircPct: 20 }), true);
  });
}

// ═══════════════ B. 语义边界 ═══════════════
console.log('B. 语义边界（负净持仓/非簇钱包/未启用）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: TURTLE[0], block_number: 500, log_index: 1,
    bnb_amount: 1, token_amount: 40 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: TURTLE[1], block_number: 501, log_index: 1,
    bnb_amount: 1, token_amount: 10 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: OUTSIDER, block_number: 502, log_index: 1,
    bnb_amount: 5, token_amount: 50 * M }), {});
  FourMemeFactorAggregator.setSybilClustersForTest(new Set(TURTLE));
  // 流通 100M；簇内 TURTLE[0] 40M + TURTLE[1] 10M = 50M → 50%；OUTSIDER 50M 不计
  check('B1 非簇钱包不计入（OUTSIDER 50M 被无视——合计只算簇内）', () =>
    assert.ok(Math.abs(fa.buildFactorMap('0xtoken', T0 + 5000).sybilClusterHolderCircPct - 50) < 1e-9));
  // TURTLE[1] 清仓（卖 10M）→ 出局；流通缩至 90M → 40/90 = 44.4
  fa.processTick(mkTick({ timestamp: T0 + 6000, trader_address: TURTLE[1], trade_type: 'sell',
    block_number: 510, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  check('B2 净卖者出局（清仓者不计；流通收缩口径同 top1）', () =>
    assert.ok(Math.abs(fa.buildFactorMap('0xtoken', T0 + 7000).sybilClusterHolderCircPct - 44.4) < 0.1,
      `got ${fa.buildFactorMap('0xtoken', T0 + 7000).sybilClusterHolderCircPct}`));
  FourMemeFactorAggregator.setSybilClustersForTest(null);
  check('B3 名单 null → 恒 0（未启用 fail-open；2026-10-22 去 NULL 裁定裸比较放行）', () => {
    const f = fa.buildFactorMap('0xtoken', T0 + 7000);
    assert.strictEqual(f.sybilClusterHolderCircPct, 0);
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    assert.strictEqual(new ConditionEvaluator().evaluate(
      'sybilClusterHolderCircPct < 35', f), true);
  });
  FourMemeFactorAggregator.setSybilClustersForTest(new Set());
  check('B4 空集合 → 0（未启用；2026-10-22 裁定不再与「无命中=0」区分）', () =>
    assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 7000).sybilClusterHolderCircPct, 0));
  FourMemeFactorAggregator.setSybilClustersForTest(new Set(['0xdeadbeef'.padEnd(42, '0')]));
  check('B5 名单在但全部 miss → 0（有证据零值，门放行）', () =>
    assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 7000).sybilClusterHolderCircPct, 0));
}

// ═══════════════ C. 乱序 parity ═══════════════
console.log('C. 乱序 parity（defer 乱序喂 == 链序喂）');
{
  const faA = newFA(), faB = newFA();
  const tks = [
    mkTick({ timestamp: T0 + 1000, trader_address: TURTLE[0], block_number: 500, log_index: 1, bnb_amount: 1, token_amount: 30 * M }),
    mkTick({ timestamp: T0 + 2000, trader_address: TURTLE[1], block_number: 501, log_index: 1, bnb_amount: 1, token_amount: 20 * M }),
    mkTick({ timestamp: T0 + 3000, trader_address: 'eoaX', block_number: 502, log_index: 1, bnb_amount: 1, token_amount: 50 * M }),
    mkTick({ timestamp: T0 + 4000, trader_address: TURTLE[0], trade_type: 'sell', block_number: 510, log_index: 1, bnb_amount: 1, token_amount: 10 * M }),
  ];
  for (const tk of tks) faA.processTick(tk, {});
  for (const tk of [tks[3], tks[1], tks[2], tks[0]]) faB.processTick(tk, {});
  FourMemeFactorAggregator.setSybilClustersForTest(new Set([TURTLE[0], TURTLE[1]]));
  const a = faA.buildFactorMap('0xtoken', T0 + 5000);
  const b = faB.buildFactorMap('0xtoken', T0 + 5000);
  check('C1 逆序喂 bit 一致（合计加减交换律，序无关）', () =>
    assert.strictEqual(b.sybilClusterHolderCircPct, a.sybilClusterHolderCircPct));
  check('C2 期望值 = (30-10+20)/90 ≈ 44.4', () =>
    assert.ok(Math.abs(a.sybilClusterHolderCircPct - 44.4) < 0.1, `got ${a.sybilClusterHolderCircPct}`));
}

// ═══════════════ D. loader（仓库真实产物） ═══════════════
console.log('D. loadSybilClusters（仓库产物 config/rosters/sybil-clusters.json）');
(async () => {
  await checkAsync('D1 仓库产物可加载且非空（build-sybil-clusters.cjs --commit 产物随仓库部署）', async () => {
    FourMemeFactorAggregator.setSybilClustersForTest(null); // 复位模块态再走 loader
    const set = await FourMemeFactorAggregator.loadSybilClusters();
    assert.ok(set instanceof Set && set.size > 0, '名单为空=未启用（检查是否忘了 commit 产物）');
  });
  await checkAsync('D2 乌龟案四钱包全部在名单（14 天窗内未滑出）', async () => {
    const set = await FourMemeFactorAggregator.loadSybilClusters();
    for (const w of TURTLE) assert.ok(set.has(w), `${w} 不在簇名单`);
  });
  check('D3 setter 生命周期：null 还原「未加载」（因子恒 0，2026-10-22 去 NULL）', () => {
    FourMemeFactorAggregator.setSybilClustersForTest(null);
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: TURTLE[0], bnb_amount: 1, token_amount: 50 * M }), {});
    assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 2000).sybilClusterHolderCircPct, 0);
  });

  // ═══════════════ E. 探针 + 白名单 + 字面量 ═══════════════
  console.log('E. 探针 + 白名单 + 字面量（三防线零登记出键自动性）');
  {
    const fa = newFA();
    FourMemeFactorAggregator.setSybilClustersForTest(new Set(TURTLE));
    check('E1 getFactorKeys 含键（空 state 探针自动收键）', () =>
      assert.ok(fa.getFactorKeys().has('sybilClusterHolderCircPct')));
    const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
    check('E2 getAvailableFactorIds 含键（引擎装载键集）', () =>
      assert.ok(getAvailableFactorIds().has('sybilClusterHolderCircPct')));
    check('E3 FactorBuilder 快照白名单含键（进程级名单状态不可重算，不落库即丢）', () =>
      assert.ok(read('src/trading-engine/core/FactorBuilder.js').includes('factorResults.sybilClusterHolderCircPct ?? null')));
    check('E4 因子字面量含键（防误删）', () =>
      assert.ok(read('src/services/FourMemeFactorAggregator.js').includes('sybilClusterHolderCircPct,')));
    FourMemeFactorAggregator.setSybilClustersForTest(null);
  }

  // ═══════════════ F. 源码锁 ═══════════════
  console.log('F. 源码锁（合计语义/防前视/接线/产物形状）');
  {
    const src = read('src/services/FourMemeFactorAggregator.js');
    const start = src.indexOf('let sybilClusterHolderCircPct = 0;');
    const end = src.indexOf('const prices', start);
    const body = src.slice(start, end);
    check('F1 读点=合计（_clusterNet += v，刻意非 max——单钱包口径的补盲机制）', () =>
      assert.ok(body.includes('_clusterNet += v'), '合计加总缺失（若改成 max 则退化为主名单口径）'));
    check('F2 读点体内禁 Date.now（防前视红线）', () =>
      assert.ok(!body.includes('Date.now')));
    check('F3 负/零净持仓不计（v > 0 门）+ 命中侧 toLowerCase（名单小写归一；同行累加簇席数 holdersExSybil 原料）', () => {
      assert.ok(body.includes('if (v > 0 && _sybilClusterWallets.has(addr.toLowerCase())) { _clusterNet += v; _sybilClusterHolderN++; }'));
    });
    check('F4 loader 在场（schema 校验 + 缺失→空 Set fail-open + 幂等）', () => {
      const lStart = src.indexOf('static async loadSybilClusters() {');
      assert.ok(lStart > 0, 'loader 未找到');
      const lBody = src.slice(lStart, src.indexOf('static setSybilClustersForTest', lStart));
      assert.ok(lBody.includes('sybil-clusters.json'), '产物路径硬编码');
      assert.ok(lBody.includes('Array.isArray(parsed.wallets)'), 'schema 校验缺 wallets 数组');
      assert.ok(lBody.includes("e.code === 'ENOENT'"), '文件缺失未走 fail-open 分支');
      assert.ok(lBody.includes('if (_sybilClusterWallets) return _sybilClusterWallets;'), '幂等快返回');
    });
    const wss = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    const bt = read('src/trading-engine/implementations/BacktestEngine.js');
    check('F5 两引擎接线在位（实时+回测同入口 parity，fail-open warn 不阻断启动）', () => {
      assert.ok(wss.includes('loadSybilClusters()'), 'Wss 引擎缺接线');
      assert.ok(bt.includes('loadSybilClusters()'), 'Backtest 引擎缺接线');
    });
    const gen = read('scripts/build-sybil-clusters.cjs');
    check('F6 生成脚本在场且判据=强边连通分量（co>=50 + 同步卖/等额过半 + size>=3）', () => {
      assert.ok(gen.includes('sellRatio') && gen.includes('evenRatio'), '强边判据缺失');
      assert.ok(gen.includes('MIN_SIZE'), '簇最小规模参数缺失');
    });
    const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rosters', 'sybil-clusters.json'), 'utf8'));
    check('F7 产物形状（wallets 数组 + clusters 明细 + params 审计）', () => {
      assert.ok(Array.isArray(product.wallets) && product.wallets.length > 0);
      assert.ok(Array.isArray(product.clusters) && product.clusters.length > 0);
      assert.ok(product.params && product.params.minSize >= 3);
      for (const w of product.wallets) assert.strictEqual(w, w.toLowerCase(), '产物必须小写落盘');
    });
  }

  // ═══════════════ H. 人气门去簇口径（buyVolumeBnbExSybil / holdersExSybil） ═══════════════
  console.log('H. 人气门去簇口径（2026-10-22 用户裁定：人气门扣协同簇钱包）');
  {
    // 乌龟案现场形状：四簇钱包等额买入垫人气——原口径过门、去簇口径拒
    const fa = newFA();
    // 8 散户各买 0.125 BNB（量 1.0 / 8 席；二进制精确值防浮点噪声）
    for (let i = 0; i < 8; i++) {
      fa.processTick(mkTick({ timestamp: T0 + 1000 + i,
        trader_address: `0x000000000000000000000000000000000000${String(2000 + i).padStart(4, '0')}`,
        block_number: 600 + i, log_index: 1, bnb_amount: 0.125, token_amount: 5 * M }), {});
    }
    // 四簇钱包各买 0.25 BNB（量 1.0 / 4 席，经 GMGN 路由 sender 归真）
    TURTLE.forEach((w, i) => {
      fa.processTick(mkTick({ timestamp: T0 + 20000 + i, trader_address: '0x1de460f363af910f51726def188f9004276bf4bc',
        sender_address: w, block_number: 700 + i, log_index: 1, bnb_amount: 0.25, token_amount: 10 * M }), {});
    });
    FourMemeFactorAggregator.setSybilClustersForTest(new Set(TURTLE));
    const f = fa.buildFactorMap('0xtoken', T0 + 30000);
    check('H1 公式精确：raw 2.0 BNB/12 席不动；去簇 1.0 BNB / 8 席（簇 4×0.25 量与 4 席全扣）', () => {
      assert.strictEqual(f.buyVolumeBnb, 2);
      assert.strictEqual(f.holders, 12);
      assert.strictEqual(f.buyVolumeBnbExSybil, 1);
      assert.strictEqual(f.holdersExSybil, 8);
    });
    check('H2 门翻转（事故现场反证）：原口径人气门过、去簇口径拒（对倒垫人气失效）', () => {
      const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
      const ev = new ConditionEvaluator();
      assert.strictEqual(ev.evaluate('(buyVolumeBnb >= 1.25 OR holders >= 10)', f), true);
      assert.strictEqual(ev.evaluate('(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)', f), false);
    });
    check('H3 名单未启用/空集合 → 不扣=原值（fail-open 与 0 语义同方向：无 sybil 证据不减人气）', () => {
      FourMemeFactorAggregator.setSybilClustersForTest(null);
      const fNull = fa.buildFactorMap('0xtoken', T0 + 30000);
      assert.strictEqual(fNull.buyVolumeBnbExSybil, 2);
      assert.strictEqual(fNull.holdersExSybil, 12);
      FourMemeFactorAggregator.setSybilClustersForTest(new Set());
      const fEmpty = fa.buildFactorMap('0xtoken', T0 + 30000);
      assert.strictEqual(fEmpty.buyVolumeBnbExSybil, 2);
      assert.strictEqual(fEmpty.holdersExSybil, 12);
      FourMemeFactorAggregator.setSybilClustersForTest(new Set(TURTLE));
    });
    check('H4 拉盘历史量照扣、清仓者不占人气席：簇钱包买 0.5 后全卖 → 量扣 0.5、席不扣', () => {
      const fa2 = newFA();
      fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: TURTLE[0],
        block_number: 500, log_index: 1, bnb_amount: 0.5, token_amount: 20 * M }), {});
      fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'eoaOut',
        block_number: 501, log_index: 1, bnb_amount: 0.5, token_amount: 10 * M }), {});
      fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: TURTLE[0], trade_type: 'sell',
        block_number: 502, log_index: 1, bnb_amount: 0.5, token_amount: 20 * M }), {});
      const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
      assert.strictEqual(f2.buyVolumeBnb, 1);          // 0.5 + 0.5
      assert.strictEqual(f2.buyVolumeBnbExSybil, 0.5); // 簇 0.5 照扣（历史拉盘量，只增不减）
      assert.strictEqual(f2.holders, 1);               // TURTLE[0] 清仓出局
      assert.strictEqual(f2.holdersExSybil, 1);        // 无簇席可扣（v>0 门）
    });
    check('H5 null wallet 买入行计量不扣（无法归集→留在分子，照计量不冒充归属）', () => {
      const fa3 = newFA();
      fa3.processTick(mkTick({ timestamp: T0 + 1000, trader_address: null, sender_address: null,
        block_number: 500, log_index: 1, bnb_amount: 0.3, token_amount: 5 * M }), {});
      const f3 = fa3.buildFactorMap('0xtoken', T0 + 2000);
      assert.strictEqual(f3.buyVolumeBnb, 0.3);
      assert.strictEqual(f3.buyVolumeBnbExSybil, 0.3);
    });
    check('H6 探针+白名单（三防线零登记出键自动性）', () => {
      const fa4 = newFA();
      assert.ok(fa4.getFactorKeys().has('buyVolumeBnbExSybil'));
      assert.ok(fa4.getFactorKeys().has('holdersExSybil'));
      const fb = read('src/trading-engine/core/FactorBuilder.js');
      assert.ok(fb.includes('factorResults.buyVolumeBnbExSybil ?? null'));
      assert.ok(fb.includes('factorResults.holdersExSybil ?? null'));
    });
    FourMemeFactorAggregator.setSybilClustersForTest(null);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
