#!/usr/bin/env node
/**
 * bundle 门对现行实验实际交易的拦截评估（2026-10-16）：
 * 对指定实验的每笔买入 trade，找其 signal fire 时刻，回放真 FA 读
 * bundleClusterSharePct（w10000），统计 `sharePct < 50` 单条件门会拦多少笔，
 * 并给出被拦/放行两组的实际盈亏（live 票 buy BNB vs sell BNB）。
 *
 * 在 182 跑（ticks 拉取重查询；本地只读小结果）。
 * 双门（2026-10-16 用户裁定）：sharePct < 50（簇占比）+ top1HolderCircPct < X
 * （TOP1 持仓集中度，maxBlockBuyCircPct 的存量替代）——AND 放行=任一超阈即拦。
 * 第三门观察列 copyMax=maxCopyWalletHolderCircPct（跟单簇名单钱包最大净持仓÷流通，
 * FLY 案 2026-10-16）：config/rosters/copy-wallet-roster.json 存在则注入名单，
 * 文件缺失=因子恒 null（fail-closed 同引擎）。
 *   ⚠前视声明：名单是全史扫描产物，13 票回放仅参考非严格 as-of（sniper 名单
 *   「启动加载当前态」parity 先例一致）。
 * 用法：node scripts/eval-bundle-gate-v18.cjs <experiment_id> [shareThreshold=50] [top1Threshold] [copyThreshold]
 *   top1/copy 阈值缺省=不拦（纯观察输出）。
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');

// 与 BacktestEngine TICK_SELECT_COLUMNS 逐字一致（scan-bundle-clusters G4 同款锁定）
const TICK_COLS = 'id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform';
const MIN_TICK_BNB = 0.001;   // collector minTickBnb 口径（尘 tick 不进因子）
const WIN_MS = 10000;         // 现行默认 bundleWinMs

const EXP = process.argv[2];
const THRESHOLD = Number(process.argv[3] || 50);
const TOP1_THRESHOLD = process.argv[4] !== undefined ? Number(process.argv[4]) : Infinity;   // 缺省不拦（纯观察）
const COPY_THRESHOLD = process.argv[5] !== undefined ? Number(process.argv[5]) : Infinity;   // 缺省不拦（纯观察）
if (!EXP) { console.error('用法: node scripts/eval-bundle-gate-v18.cjs <experiment_id> [shareThreshold=50] [top1Threshold] [copyThreshold]'); process.exit(1); }

// 跟单簇名单注入（文件存在才注；缺失=factor 恒 null 与引擎 fail-closed 同形）
const ROSTER = require('path').join(__dirname, '..', 'config', 'rosters', 'copy-wallet-roster.json');
if (fs.existsSync(ROSTER)) {
  const parsed = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  FourMemeFactorAggregator.setCopyWalletsForTest(new Set((parsed.wallets || []).map(w => w.address)));
  console.log(`[名单] copy-wallet-roster 注入 ${(parsed.wallets || []).length} 钱包（生成于 ${parsed.generatedAt}）`);
} else {
  console.log('[名单] copy-wallet-roster 不存在——copyMax 恒 null（观察列空）');
}

const PAGE = 1000;
const rowToTick = (r) => ({
  token_address: r.token_address, trade_type: r.trade_type,
  trader_address: r.trader_address || null,
  sender_address: r.sender_address || null,
  price_bnb: r.price_bnb !== null ? Number(r.price_bnb) : null,
  price_usd: r.price_usd !== null ? Number(r.price_usd) : null,
  bnb_amount: Number(r.bnb_amount), token_amount: Number(r.token_amount),
  block_number: r.block_number, timestamp: new Date(r.block_time).getTime(),   // timestamptz 自带偏移，勿补 Z（补了 Invalid Date）
  tx_hash: r.tx_hash, log_index: r.log_index, price_outlier: r.price_outlier,
});
const cmpChain = (a, b) => a.block_number - b.block_number || a.log_index - b.log_index || a.id - b.id;

async function fetchTicks(token, untilIso) {
  // 单 token eq + id keyset 分页（PostgREST max-rows=1000 静默截断坑）；只拉 fire 前（防未来混入）
  const out = [];
  let lastId = 0;
  while (true) {
    const r = await dbManager.getClient().from('wss_price_ticks')
      .select(TICK_COLS).eq('token_address', token).lt('block_time', untilIso)
      .gt('id', lastId).order('id', { ascending: true }).limit(PAGE);
    if (r.error) throw new Error(r.error.message);
    for (const row of r.data || []) out.push(row);
    if (!r.data || r.data.length < PAGE) break;
    lastId = r.data[r.data.length - 1].id;
  }
  return out.map(rowToTick).sort(cmpChain);
}

(async () => {
  const c = dbManager.getClient();
  // ── 1. 买入 trades + 关联 signal fire 时刻 ──
  const tr = await c.from('trades').select('token_symbol, token_address, trade_direction, input_currency, output_currency, input_amount, output_amount, created_at, signal_id')
    .eq('experiment_id', EXP).order('created_at');
  if (tr.error) throw new Error(tr.error.message);
  const trades = tr.data || [];
  const buys = trades.filter(t => t.trade_direction === 'buy' && t.signal_id);
  const sells = trades.filter(t => t.trade_direction === 'sell');
  // 票级盈亏：每票 Σsell 得 BNB ÷ Σbuy 花 BNB（live 全 BNB 计价；非 BNB 盘 sell 得 BNB 同口径可用）
  const pnl = new Map();
  for (const t of buys) {
    const spent = t.input_currency === 'BNB' ? Number(t.input_amount) : null;
    if (spent === null) continue;
    const cur = pnl.get(t.token_address) || { spent: 0, got: 0, sym: t.token_symbol };
    cur.spent += spent; pnl.set(t.token_address, cur);
  }
  for (const t of sells) {
    const got = t.output_currency === 'BNB' ? Number(t.output_amount) : null;
    if (got === null) continue;
    const cur = pnl.get(t.token_address) || { spent: 0, got: 0, sym: t.token_symbol };
    cur.got += got; pnl.set(t.token_address, cur);
  }
  // signal fire 时刻
  const sigIds = [...new Set(buys.map(b => b.signal_id))];
  const sigMap = new Map();
  for (let i = 0; i < sigIds.length; i += 50) {
    const r = await c.from('strategy_signals').select('id, token_address, created_at').in('id', sigIds.slice(i, i + 50));
    if (r.error) throw new Error(r.error.message);
    for (const s of r.data || []) sigMap.set(s.id, s);
  }

  // ── 2. per token 回放 FA → fire 时刻读 bundle 因子 ──
  const results = [];
  const tokens = [...new Set(buys.map(b => b.token_address))];
  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    const firstBuy = buys.find(b => b.token_address === tok);
    const sig = sigMap.get(firstBuy.signal_id);
    const fireTs = sig ? new Date(sig.created_at).getTime() : new Date(firstBuy.created_at).getTime() - 12000;  // signal miss 回退成交前 12s
    const untilIso = new Date(fireTs + 15000).toISOString();
    const ticks = (await fetchTicks(tok, untilIso)).filter(t => !(t.bnb_amount < MIN_TICK_BNB));   // 尘 tick 不进因子（collector _feedFa 同口径，不分买卖）
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    // platform 无关（bundle 因子不读 meta）；createdAt 用首 tick 近似（age 因子不消费）
    fa.registerToken(tok, { createdAtMs: ticks.length ? ticks[0].timestamp : fireTs, totalSupply: 1e9, symbol: firstBuy.token_symbol, creatorAddress: null });
    let j = 0;
    while (j < ticks.length && ticks[j].timestamp <= fireTs) { fa.processTick(ticks[j], {}); j++; }
    const f = fa.buildFactorMap(tok, fireTs);
    // 观察列：topN 净持仓 ÷ 流通（FLY 案 2026-10-16：TOP5 占 93.2% 同步清仓一砸砸死；
    // 现有键 top3/top5HolderShare 分母=totalSupply 被 ~4× 稀释，测的是换手筹码集中度）
    const st = fa._states.get(tok);
    const _nets = [];
    for (const v of st._walletNetTokens.values()) if (v > 0) _nets.push(v);
    _nets.sort((a, b) => b - a);
    const _sumN = (n) => _nets.slice(0, n).reduce((s, v) => s + v, 0);
    const top3Circ = st._circTokens > 0 ? _sumN(3) / st._circTokens * 100 : 0;
    const top5Circ = st._circTokens > 0 ? _sumN(5) / st._circTokens * 100 : 0;
    const p = pnl.get(tok) || { spent: 0, got: 0, sym: firstBuy.token_symbol };
    results.push({
      sym: firstBuy.token_symbol, token: tok, fireAt: new Date(fireTs).toISOString(),   // 展示用（本地时区无关）
      share: f.bundleClusterSharePct, size: f.bundleClusterSize,
      amtRatio: f.bundleClusterAmountRatio, sameTrader: f.bundleClusterSameTrader,
      circ: f.maxBlockBuyCircPct, top1: f.top1HolderCircPct, top3Circ, top5Circ,
      copyMax: f.maxCopyWalletHolderCircPct,
      blockedShare: f.bundleClusterSharePct >= THRESHOLD,
      blockedTop1: f.top1HolderCircPct >= TOP1_THRESHOLD,
      blockedCopy: f.maxCopyWalletHolderCircPct !== null && f.maxCopyWalletHolderCircPct >= COPY_THRESHOLD,
      spentBnb: p.spent, gotBnb: p.got,
      pnlPct: p.spent > 0 ? ((p.got / p.spent - 1) * 100) : null,
      ticks: ticks.length, sigFound: !!sig,
    });
    console.log(`[回放] ${ti + 1}/${tokens.length} ${firstBuy.token_symbol} share=${f.bundleClusterSharePct.toFixed(1)} size=${f.bundleClusterSize} ticks=${ticks.length}${sig ? '' : '（signal miss 回退）'}`);
  }

  // ── 3. 汇总 ──
  for (const r of results) r.blocked = r.blockedShare || r.blockedTop1 || r.blockedCopy;
  const blocked = results.filter(r => r.blocked), passed = results.filter(r => !r.blocked);
  const byShare = results.filter(r => r.blockedShare), byTop1 = results.filter(r => r.blockedTop1);
  const onlyTop1 = results.filter(r => r.blockedTop1 && !r.blockedShare);
  const byCopy = results.filter(r => r.blockedCopy);
  const onlyCopy = results.filter(r => r.blockedCopy && !r.blockedShare && !r.blockedTop1);
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const t1Txt = Number.isFinite(TOP1_THRESHOLD) ? ' AND top1HolderCircPct < ' + TOP1_THRESHOLD : '（top1 观察）';
  const cpTxt = Number.isFinite(COPY_THRESHOLD) ? ' AND maxCopyWalletHolderCircPct < ' + COPY_THRESHOLD : '（copy 观察）';
  console.log('\n════════ 门评估：sharePct < ' + THRESHOLD + t1Txt + cpTxt + ' ════════');
  console.log(`买入 ${results.length} 笔：被拦 ${blocked.length}（share 门 ${byShare.length} + top1 独立 ${onlyTop1.length} + copy 独立 ${onlyCopy.length}）/ 放行 ${passed.length}`);
  console.log('\n--- 明细（按 top5/流通 降序）---');
  for (const r of [...results].sort((a, b) => b.top5Circ - a.top5Circ)) {
    const why = r.blockedCopy && (r.blockedShare || r.blockedTop1) ? 'copy+拦' : r.blockedCopy ? 'copy拦'
      : r.blockedShare && r.blockedTop1 ? '双拦' : r.blockedShare ? 'share拦' : r.blockedTop1 ? 'top1拦' : '放行';
    console.log(`${r.blocked ? '⛔' : '✅'}${why.padEnd(6)} ${r.sym.padEnd(12)} fire=${r.fireAt.slice(11, 19)} top5=${r.top5Circ.toFixed(1).padStart(5)} top1=${r.top1.toFixed(1).padStart(5)} copy=${r.copyMax === null ? ' null' : r.copyMax.toFixed(1).padStart(5)} share=${r.share.toFixed(1).padStart(5)} | 盈亏=${r.pnlPct === null ? 'n/a' : r.pnlPct.toFixed(1) + '%'} (${r.spentBnb.toFixed(4)}→${r.gotBnb.toFixed(4)}) ${r.token}`);
  }
  const bPnl = sum(blocked, 'pnlPct'), pPnl = sum(passed, 'pnlPct');
  const bNet = sum(blocked, 'gotBnb') - sum(blocked, 'spentBnb');
  const pNet = sum(passed, 'gotBnb') - sum(passed, 'spentBnb');
  const otNet = sum(onlyTop1, 'gotBnb') - sum(onlyTop1, 'spentBnb');
  const ocNet = sum(onlyCopy, 'gotBnb') - sum(onlyCopy, 'spentBnb');
  console.log('\n--- 净效应（若门一直在场）---');
  console.log(`被拦 ${blocked.length} 票：合计盈亏 ${bPnl.toFixed(1)}%，净 BNB ${bNet.toFixed(4)}`);
  console.log(`  其中 top1 门独立拦下：${onlyTop1.length} 票，净 BNB ${otNet.toFixed(4)}（负=门赚）`);
  console.log(`  其中 copy 门独立拦下（share/top1 都放行的）：${onlyCopy.length} 票，净 BNB ${ocNet.toFixed(4)}（负=门赚）`);
  console.log(`放行 ${passed.length} 票：合计盈亏 ${pPnl.toFixed(1)}%，净 BNB ${pNet.toFixed(4)}`);
  console.log(`门净贡献 = 避损 ${(-bNet).toFixed(4)} BNB（被拦票实际为亏则正贡献）`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
