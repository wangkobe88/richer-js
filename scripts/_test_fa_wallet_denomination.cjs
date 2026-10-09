#!/usr/bin/env node
/**
 * FA 钱包口径切换单测（GMGN 案 B，2026-10-01，bSTOCKS 0x0ad6…7777 案衍生）——零 DB。
 *
 * 改动语义：FA processTick 内聚合分两口径——
 *   wallet 口径（sender||trader，NULL 回退 = 旧行为等价）：
 *     holderCount(holders)/_holderSeries(holderTrend)/_walletNetTokens(P 组 top3/top5、
 *     sniperHolderShare top20、bigHolder 交叉)/K 组(_buyerAddresses/_buyerVolume/
 *     _sellerAddresses 等)/_walletBoughtTokens(cumBuy)/滑窗(_slideTraderCounts)/smartBot
 *   trader 口径（刻意锁定）：
 *     _traderNetTokens/_traderMaxNetTokens（TPA 基准——wallet_offline_profiles 画像库
 *     trader 口径，单切持仓侧会画像 miss 错配，二期整套切）
 *     uniqueTraders（classifier metrics 契约，与离线 classifyToken/token-classifier 锁定）
 *
 * 运行：node scripts/_test_fa_wallet_denomination.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const COLLECTOR_FM_PATH = path.join(__dirname, '..', 'src', 'collectors', 'fourmeme-ankr-ws-collector.js');
const COLLECTOR_FL_PATH = path.join(__dirname, '..', 'src', 'collectors', 'flap-ankr-ws-collector.js');
const BACKTEST_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');
const OPB_PATH = path.join(__dirname, '..', 'src', 'services', 'OnlineProfileBuilder.js');
const TPA_PATH = path.join(__dirname, '..', 'src', 'services', 'TokenPositionAnalyzer.js');

const FourMemeFactorAggregator = require(FA_PATH);

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

/** 造一笔 tick（真实 shape 对齐 SharedTickConsumer.processTick 透传） */
function mkTick(overrides) {
  return Object.assign({
    token_address: '0xtoken',
    trade_type: 'buy',
    trader_address: null,
    sender_address: null,
    price_bnb: 0.00001,
    price_usd: 5,
    bnb_amount: 1,
    token_amount: 1000,
    block_number: 100,
    timestamp: Date.now(),
    tx_hash: '0xtx',
    log_index: 0,
  }, overrides);
}

function newFA() {
  return new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
}

const GMGN = '0x1de460f363af910f51726def188f9004276bf4bc';
const T0 = 1790802000000;

// ═══════════ A 节：COALESCE 矩阵（wallet = sender || trader） ═══════════
console.log('\nA 节：COALESCE 矩阵');
{
  // A1：sender 存在 → wallet 聚合按 sender；trader map 仍按 trader
  const fa = newFA();
  fa.processTick(mkTick({ trader_address: GMGN, sender_address: '0xE1', timestamp: T0 }));
  const st = fa._states.get('0xtoken');
  check('A1 sender 聚合：_walletNetTokens 键 = sender', () => assert.strictEqual(st._walletNetTokens.get('0xE1'), 1000));
  check('A1 trader 基准不动：_traderNetTokens 键 = trader(GMGN)', () => assert.strictEqual(st._traderNetTokens.get(GMGN), 1000));
  check('A1 holders = 1（wallet 口径）', () => assert.strictEqual(st.holderCount, 1));
  check('A1 uniqueTraders = trader 契约（GMGN 在册）', () => assert.ok(st.uniqueTraders.has(GMGN) && !st.uniqueTraders.has('0xE1')));

  // A2：sender NULL → 回退 trader（旧行为等价）
  const fa2 = newFA();
  fa2.processTick(mkTick({ trader_address: '0xE2', sender_address: null, timestamp: T0 }));
  const st2 = fa2._states.get('0xtoken');
  check('A2 NULL 回退：_walletNetTokens 键 = trader', () => assert.strictEqual(st2._walletNetTokens.get('0xE2'), 1000));
  check('A2 NULL 回退：holders 旧行为等价', () => assert.strictEqual(st2.holderCount, 1));

  // A3：双 NULL → 两口径都不记（旧守卫保持）
  const fa3 = newFA();
  fa3.processTick(mkTick({ trader_address: null, sender_address: null, timestamp: T0 }));
  const st3 = fa3._states.get('0xtoken');
  check('A3 双 NULL：零聚合零 holders', () => assert.strictEqual(st3.holderCount, 0) || assert.strictEqual(st3._walletNetTokens.size, 0));

  // A4：sender 空串 → falsy 回退 trader（防御 DB 脏值 ''）
  const fa4 = newFA();
  fa4.processTick(mkTick({ trader_address: '0xE3', sender_address: '', timestamp: T0 }));
  check('A4 空串回退：wallet 键 = trader', () => assert.strictEqual(fa4._states.get('0xtoken')._walletNetTokens.get('0xE3'), 1000));
}

// ═══════════ B 节：GMGN 合并复现（bSTOCKS 形状锚定） ═══════════
console.log('\nB 节：GMGN 合并复现');
{
  // bSTOCKS 案形状：N 个真实散户经 GMGN（trader 同、sender 异）+ M 个直连 EOA
  const fa = newFA();
  const N_ROUTED = 7, M_DIRECT = 3;
  let ts = T0;
  for (let i = 0; i < N_ROUTED; i++) {
    fa.processTick(mkTick({ trader_address: GMGN, sender_address: `0xROUTED${i}`, timestamp: ++ts }));
  }
  for (let i = 0; i < M_DIRECT; i++) {
    fa.processTick(mkTick({ trader_address: `0xDIRECT${i}`, sender_address: `0xDIRECT${i}`, timestamp: ++ts }));
  }
  const st = fa._states.get('0xtoken');

  check('B1 修正后 holders = N+M = 10（真实分散度）', () => assert.strictEqual(st.holderCount, 10));
  check('B2 修正前口径对照：trader 净持仓键数 = 1(GMGN)+3 = 4（TPA 基准仍 trader，合并像）',
    () => assert.strictEqual(st._traderNetTokens.size, 4));
  check('B3 uniqueTraders 契约口径 = 4（trader 去重）', () => assert.strictEqual(st.uniqueTraders.size, 4));

  // B4：同票零 sender 数据（watcher 旧行/回填前）→ 与历史行为 bit-identical
  const faOld = newFA();
  ts = T0;
  for (let i = 0; i < N_ROUTED; i++) faOld.processTick(mkTick({ trader_address: GMGN, timestamp: ++ts }));
  for (let i = 0; i < M_DIRECT; i++) faOld.processTick(mkTick({ trader_address: `0xDIRECT${i}`, timestamp: ++ts }));
  check('B4 零 sender 数据 = 旧行为（holders 4）', () => assert.strictEqual(faOld._states.get('0xtoken').holderCount, 4));

  // B5：GMGN 净卖出（散户经路由出货）→ wallet 口径各自减仓、TPA 口径 GMGN 总净
  const fa5 = newFA();
  fa5.processTick(mkTick({ trader_address: GMGN, sender_address: '0xR0', timestamp: T0, token_amount: 100 }));
  fa5.processTick(mkTick({ trader_address: GMGN, sender_address: '0xR0', timestamp: T0 + 1, token_amount: 100, trade_type: 'sell' }));
  const st5 = fa5._states.get('0xtoken');
  check('B5 清仓者出 holders（净 0 不计）', () => assert.strictEqual(st5.holderCount, 0));
  check('B5 TPA 基准：GMGN 净 0（trader 层合并后净额）', () => assert.strictEqual(st5._traderNetTokens.get(GMGN), 0));
}

// ═══════════ C 节：K 组 / 滑窗 / smartBot / cumBuy 口径 ═══════════
console.log('\nC 节：K 组/滑窗/smartBot/cumBuy');
{
  const fa = newFA();
  const ts = T0;
  // 两个散户经 GMGN 买 + 一个散户经 GMGN 卖（对倒单 EOA：0xR0 买又卖）
  fa.processTick(mkTick({ trader_address: GMGN, sender_address: '0xR0', timestamp: ts, bnb_amount: 2 }));
  fa.processTick(mkTick({ trader_address: GMGN, sender_address: '0xR1', timestamp: ts + 1, bnb_amount: 3 }));
  fa.processTick(mkTick({ trader_address: GMGN, sender_address: '0xR0', timestamp: ts + 2, bnb_amount: 1, trade_type: 'sell', token_amount: 400 }));
  const st = fa._states.get('0xtoken');

  check('C1 K 组买方 = 2 wallet（0xR0/0xR1；trader 口径会是 GMGN 1 个）',
    () => assert.deepStrictEqual([...st._buyerAddresses].sort(), ['0xR0', '0xR1']));
  check('C2 K 组累计买额按 wallet 分账（0xR1=3）', () => assert.strictEqual(st._buyerVolume.get('0xR1'), 3));
  check('C3 卖方 = 0xR0（同一 EOA 两栖 → 对敲重叠可检；trader 口径下会记成 GMGN 自买自卖）',
    () => assert.deepStrictEqual([...st._sellerAddresses], ['0xR0']));
  check('C4 滑窗 wallet 计数键 = 2（不含 GMGN）', () => assert.strictEqual(st._slideTraderCounts.size, 2));
  check('C5 cumBuy 按 wallet（_walletBoughtTokens 0xR0=1000）', () => assert.strictEqual(st._walletBoughtTokens.get('0xR0'), 1000));
  check('C6 旧名 _traderBoughtTokens 已不存在（改名防口径混淆）', () => assert.ok(!('_traderBoughtTokens' in st)));
}

// C7 节：smartBot 名单（模块级名单，经 loadSmartBotWallets 打桩 supabase 注入；异步，末尾统一 await）
const c7 = (async () => {
  console.log('\nC7 节：smartBot 名单匹配');
  const fakeSupabase = {
    from() {
      // 链式桩：select→eq→eq→gt→order→limit（async 出数）；data.length(1) < pageSize → 单页终止
      const stub = {
        select: () => stub, eq: () => stub, gt: () => stub, order: () => stub,
        limit: async () => ({ data: [{ id: 1, address: '0xSMART' }], error: null }),
      };
      return stub;
    },
  };
  await FourMemeFactorAggregator.loadSmartBotWallets(fakeSupabase);
  const fa7 = newFA();
  fa7.processTick(mkTick({ trader_address: GMGN, sender_address: '0xSMART', timestamp: T0, bnb_amount: 4 }));
  check('C7 smartBot 名单匹配 sender（经路由的智能钱包不再被 GMGN 壳吞）',
    () => assert.strictEqual(fa7._states.get('0xtoken')._smartBotBuyBnb.get('0xSMART'), 4));
  const fa7b = newFA();
  fa7b.processTick(mkTick({ trader_address: '0xSMART', sender_address: null, timestamp: T0, bnb_amount: 4 }));
  check('C7b 直连智能钱包（无 sender）旧行为等价', () => assert.strictEqual(fa7b._states.get('0xtoken')._smartBotBuyBnb.get('0xSMART'), 4));
})();

// ═══════════ D 节：读取时聚合走 _walletNetTokens ═══════════
console.log('\nD 节：读取时聚合（buildFactorMap 出口）');
{
  // 形状：GMGN 盘 6 散户各 0.5 BNB（GMGN 累 3 BNB，trader 口径过 W 门[1.0]=bigHolder
  // 合并像；wallet 口径各 0.5 不过门）+ 1 直连大户 30 BNB（两口径都过门）
  const fa = newFA();
  fa.registerToken('0xtoken', { totalSupply: 20000, createdAtMs: T0 }); // top3HolderShare 分母
  const ts = T0;
  for (let i = 0; i < 6; i++) {
    fa.processTick(mkTick({ trader_address: GMGN, sender_address: `0xS${i}`, timestamp: ts + i, token_amount: 1000, bnb_amount: 0.5 }));
  }
  fa.processTick(mkTick({ trader_address: '0xWHALE', sender_address: '0xWHALE', timestamp: ts + 10, token_amount: 6000, bnb_amount: 30 }));
  const factors = fa.buildFactorMap('0xtoken', T0 + 12000);

  check('D1 holders 因子 = 7（wallet 口径）', () => assert.strictEqual(factors.holders, 7));
  // top3 净持仓 = 6000(WHALE)+1000+1000；分母 totalSupply=20000（P 组 share 口径）
  check('D2 top3HolderShare 走 wallet 净持仓 (6000+1000+1000)/20000',
    () => assert.ok(Math.abs(factors.top3HolderShare - 8000 / 20000) < 1e-9));
  check('D3 uniqueTraderCount = trader 契约口径（GMGN+0xWHALE = 2）', () => assert.strictEqual(factors.uniqueTraderCount, 2));

  // bigHolder 族交叉（_buyerVolume × 净持仓，同 wallet 口径）：GMGN 合并像不再入册
  check('D4 bigHolderTotal = 1（只 0xWHALE；trader 口径会把 GMGN 累 3 BNB 合并像判成第 2 个大户）',
    () => assert.strictEqual(factors.bigHolderTotal, 1));
  check('D5 bigHolderPresent = 1 且来自 wallet 净持仓交叉', () => assert.strictEqual(factors.bigHolderPresent, 1));
}

// ═══════════ E 节：链路透传（源码口径断言） ═══════════
console.log('\nE 节：链路透传');
{
  // 实时链透传点已从 SharedTickConsumer 换到 collector（直连架构 2026-10-09 watcher 废除）：
  // tickRow 构造带 sender_address 位（resolver 回推定值）+ _feedFa 透传给 FA（NULL 归一）
  const fmColSrc = fs.readFileSync(COLLECTOR_FM_PATH, 'utf8');
  const flColSrc = fs.readFileSync(COLLECTOR_FL_PATH, 'utf8');
  check('E1 两 collector tickRow 构造含 sender_address（resolver 回推定值位）',
    () => assert.ok(/sender_address: null/.test(fmColSrc) && /sender_address: null/.test(flColSrc)));
  check('E2 collector _feedFa 透传 sender_address（NULL 归一，FA COALESCE 输入）',
    () => assert.ok(/sender_address: tickRow\.sender_address \|\| null/.test(fmColSrc)
      && /sender_address: tickRow\.sender_address \|\| null/.test(flColSrc)));

  const backtestSrc = fs.readFileSync(BACKTEST_PATH, 'utf8');
  check('E3 BacktestEngine _loadWssTicks 透传 sender_address（既有，09-30；H0 开关内真臂）',
    () => assert.ok(/: \(row\.sender_address \|\| null\)/.test(backtestSrc)));

  const faSrc = fs.readFileSync(FA_PATH, 'utf8');
  check('E4 FA 单点 COALESCE（walletAddr = sender || trader）',
    () => assert.ok(/const walletAddr = tick\.sender_address \|\| tick\.trader_address \|\| null/.test(faSrc)));
  check('E5 holderCount 由 _walletNetTokens 派生',
    () => assert.ok(/for \(const net of state\._walletNetTokens\.values\(\)\)/.test(faSrc)));
  check('E6 P 组集中度遍历 _walletNetTokens',
    () => assert.ok(/for \(const v of state\._walletNetTokens\.values\(\)\)/.test(faSrc)));

  // E7：TPA 基准与 uniqueTraders 的锁定不受切口径影响（外部读者契约）
  const tpaSrc = fs.readFileSync(TPA_PATH, 'utf8');
  check('E7 TPA 仍读 _traderNetTokens（minHolders/retention 基准口径锁定）',
    () => assert.ok(tpaSrc.includes('faState._traderNetTokens') && tpaSrc.includes('faState._traderMaxNetTokens')));
  const opbSrc = fs.readFileSync(OPB_PATH, 'utf8');
  check('E8 OPB 仍读 uniqueTraders（classifier metrics 契约锁定）',
    () => assert.ok(/tokenState\.uniqueTraders/.test(opbSrc)));

  // E9/E10：配对回测对照臂开关（H0 臂剥 sender 复现旧口径；与 B4 行为证明配套）
  check('E9 BacktestEngine stripSenderAddress 开关接线（strip → null 回退 trader）',
    () => assert.ok(/stripSender \? null : \(row\.sender_address \|\| null\)/.test(backtestSrc)));
  check('E10 开关读 config.backtest.stripSenderAddress === true（缺省 false = 新口径默认）',
    () => assert.ok(/config\?\.backtest\?\.stripSenderAddress === true/.test(backtestSrc)));
}

// ═══════════ F 节：buy-v2 买门语义（holders > 5 在 GMGN 盘的翻案形状） ═══════════
console.log('\nF 节：买门翻案形状');
{
  // bSTOCKS 实案形状：48 独立钱包、routerPct 56.4%，trader 口径 holders=6 险过 >5。
  // 构造更极端：10 散户经 GMGN + 1 直连 → 修正前 holders=2（被拦），修正后 = 11（放行）
  const faNew = newFA(), faOld = newFA();
  const ts = T0;
  for (let i = 0; i < 10; i++) {
    const t = mkTick({ trader_address: GMGN, sender_address: `0xU${i}`, timestamp: ts + i, token_amount: 500, bnb_amount: 0.5 });
    faNew.processTick(t);
    faOld.processTick(Object.assign({}, t, { sender_address: null })); // 模拟旧行为（无 sender）
  }
  faNew.processTick(mkTick({ trader_address: '0xD0', sender_address: '0xD0', timestamp: ts + 20, token_amount: 500, bnb_amount: 0.5 }));
  faOld.processTick(mkTick({ trader_address: '0xD0', timestamp: ts + 20, token_amount: 500, bnb_amount: 0.5 }));
  const hNew = faNew._states.get('0xtoken').holderCount;
  const hOld = faOld._states.get('0xtoken').holderCount;
  check('F1 修正前 holders=2（GMGN 合并 → buy-v2 `holders > 5` 拦截）', () => assert.strictEqual(hOld, 2));
  check('F2 修正后 holders=11（真实分散 → 放行）', () => assert.strictEqual(hNew, 11));
  check('F3 门语义翻案（2 → 11 跨过 5 阈值）', () => assert.ok(hOld <= 5 && hNew > 5));
}

(async () => {
  await c7; // C7 异步注入名单后断言（输出顺序：C7 的 check 在汇总前）
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
