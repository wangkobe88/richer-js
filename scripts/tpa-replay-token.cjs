#!/usr/bin/env node
/**
 * TPA as-of 复算（诊断工具，零写入）：对指定 token 在历史时刻 T 重放 TokenPositionAnalyzer
 * 的完整判定管线（holders → as-of 钱包画像 → 评分/庄散 → verdict），回答
 * 「若实验挂了 TPA，该票在 T 时刻会被 approve 还是 block」。
 *
 * 口径对齐（与引擎运行时逐步同源）：
 *   - faState 用 wss_price_ticks 全史 [创建, asOf) 重放 FA processTick 的累加语义：
 *     tradeCount / totalBuyBnb / totalBuyTokens/totalSellTokens / _traderNetTokens /
 *     _traderMaxNetTokens(running max) / firstBlockNumber / firstTickAt
 *   - creatorAddress / totalSupply 取 wss_events kind='token_create' payload（flap 恒 1e9）
 *   - 画像三路径（offline fresh/stale 增量/miss 实时 14d 窗）走 TPA 原方法，不做任何捷径
 *
 * 用法（在 182 上跑——含 per-wallet 14d ticks 重查询）：
 *   手动时点:  node scripts/tpa-replay-token.cjs <token> <asOfIso> [token2 asOfIso2 ...]
 *   真实触发:  node scripts/tpa-replay-token.cjs --at-trigger <token> [token2 ...]
 *              ↑ 全史扫描首次过门 tick，在该 tick 时点复算（生产语义：verdict 就绪于此 tick 后数秒）
 *   可选环境变量：TPA_REPLAY_TRIGGER='{"blocks":1,"tradeCount":10,"buyBnb":1,"minHolders":4}'
 *                 TPA_REPLAY_ZHUANG='TPAPre_tokenScore > 2'（默认=2026-09-28 裁定：只用 tokenScore）
 *   （buyBnb=1 为 BSC 口径裁定 2026-09-28：母版 6 是 SOL 面额不可直迁）
 *
 * 不落表（experimentId 不注入，_persist 空转；本脚本根本不调 _analyze，只复用其子步骤）。
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { TokenPositionAnalyzer } = require('../src/services/TokenPositionAnalyzer');
const { classifyHolderDetail } = require('../src/services/wallet-scorer');

// buyBnb=1：BSC 口径裁定（2026-09-28 用户拍板）——母版 6 是 SOL 面额，SOL/BNB 价差大不可直迁。
//   参照系：good-action/low-level-bad-action 的 SOL→BNB 换算系数 ×0.4（5/10 SOL→2/4 BNB、1.5→0.6）。
const DEFAULT_TRIGGER = { blocks: 1, tradeCount: 10, buyBnb: 1, minHolders: 4 };
// zhuangCondition 只用 tokenScore（2026-09-28 用户二次裁定）：flap 早期持有者全是职业钱包 →
//   庄散比≈0 在 8/13 票出现（区分度崩 + 误拦唯一盈利票王之蔑视），弃用；可用 TPA_REPLAY_ZHUANG 覆盖。
const DEFAULT_ZHUANG = 'TPAPre_tokenScore > 2';

function fmtTokens(n) {
  if (n == null) return 'null';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

async function fetchAllTicks(sb, token, asOfIso) {
  const COLS = 'id,trade_type,trader_address,bnb_amount,token_amount,block_number,block_time';
  const rows = [];
  let lastId = 0;
  let guard = 0;
  while (guard++ < 500) {
    let q = sb.from('wss_price_ticks')
      .select(COLS)
      .eq('token_address', token)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(1000);
    if (asOfIso) q = q.lt('block_time', asOfIso); // asOfIso=null → 全史（--at-trigger 模式）
    const page = await q;
    if (page.error) throw new Error('ticks: ' + page.error.message);
    rows.push(...page.data);
    if (page.data.length < 1000) break;
    lastId = page.data[page.data.length - 1].id;
  }
  return rows;
}

async function fetchTokenCreate(sb, token) {
  const { data, error } = await sb.from('wss_events')
    .select('platform,payload,block_time')
    .eq('token_address', token)
    .eq('kind', 'token_create')
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error('events: ' + error.message);
  return data?.[0] ?? null;
}

function initState(createEv) {
  const st = {
    firstTickAt: null,
    firstBlockNumber: null,
    tradeCount: 0,
    totalBuyBnb: 0,
    totalSellBnb: 0,
    totalBuyTokens: 0,
    totalSellTokens: 0,
    _traderNetTokens: new Map(),
    _traderMaxNetTokens: new Map(),
    _traderBoughtTokens: new Map(),
    holderCount: 0,
    creatorAddress: null,
    totalSupply: 0,
  };
  if (createEv) {
    const p = createEv.payload || {};
    st.creatorAddress = p.creator || null;
    st.totalSupply = createEv.platform === 'flap' ? 1e9 : (Number(p.totalSupply) || 0);
    st.platform = createEv.platform;
  }
  return st;
}

/** 单 tick 累加（逐字对齐 FA processTick 的计数/地址统计段）。 */
function feedTick(st, t) {
  const ts = Date.parse(t.block_time);
  if (st.firstTickAt === null) st.firstTickAt = ts;
  if (st.firstBlockNumber === null && t.block_number != null) st.firstBlockNumber = Number(t.block_number);
  const isBuy = String(t.trade_type).toLowerCase() === 'buy';
  const bnb = +t.bnb_amount || 0;
  const tok = +t.token_amount || 0;
  st.tradeCount++;
  if (isBuy) { st.totalBuyBnb += bnb; st.totalBuyTokens += tok; } else { st.totalSellBnb += bnb; st.totalSellTokens += tok; }
  if (t.trader_address && tok > 0) {
    const cur = (st._traderNetTokens.get(t.trader_address) || 0) + (isBuy ? tok : -tok);
    st._traderNetTokens.set(t.trader_address, cur);
    const mx = st._traderMaxNetTokens.get(t.trader_address) || 0;
    if (cur > mx) st._traderMaxNetTokens.set(t.trader_address, cur);
    if (isBuy) st._traderBoughtTokens.set(t.trader_address, (st._traderBoughtTokens.get(t.trader_address) || 0) + tok);
  }
  st.holderCount = 0;
  for (const net of st._traderNetTokens.values()) if (net > 0) st.holderCount++;
}

function buildFaState(ticks, createEv) {
  const st = initState(createEv);
  for (const t of ticks) feedTick(st, t);
  return st;
}

/** 触发门判定（checkAndTrigger 同口径：严格 > / ≥；blocks 需当前 tick 与首块都有块证据）。 */
function gatesPass(st, tick, trigger) {
  if (trigger.blocks != null) {
    if (st.firstBlockNumber == null || tick?.block_number == null) return false;
    if (Number(tick.block_number) - st.firstBlockNumber < trigger.blocks) return false;
  } else if (st.firstTickAt == null || (Date.parse(tick.block_time) - st.firstTickAt) / 1000 <= (trigger.ageSeconds ?? 0)) {
    return false;
  }
  return st.tradeCount > trigger.tradeCount && st.totalBuyBnb > trigger.buyBnb && st.holderCount >= trigger.minHolders;
}

(async () => {
  const argv = process.argv.slice(2);
  const atTrigger = argv[0] === '--at-trigger';
  const rest = atTrigger ? argv.slice(1) : argv;
  if (!rest.length || (!atTrigger && rest.length % 2 !== 0)) {
    console.error('用法:');
    console.error('  手动时点:  node scripts/tpa-replay-token.cjs <token> <asOfIso> [token2 asOfIso2 ...]');
    console.error('  真实触发:  node scripts/tpa-replay-token.cjs --at-trigger <token> [token2 ...]   ← 全史扫描首次过门 tick，在该时点复算（生产语义）');
    process.exit(1);
  }
  const trigger = process.env.TPA_REPLAY_TRIGGER ? JSON.parse(process.env.TPA_REPLAY_TRIGGER) : DEFAULT_TRIGGER;
  const zhuangCondition = process.env.TPA_REPLAY_ZHUANG || DEFAULT_ZHUANG;
  const sb = dbManager.getClient();

  const tpa = new TokenPositionAnalyzer(
    { enabled: true, trigger, zhuangCondition },
    { logger: { info: () => {}, error: (m, d) => console.error('[TPA]', m, d || '') } },
  );

  const jobs = atTrigger ? rest.map(t => ({ token: t })) : [];
  if (!atTrigger) for (let i = 0; i < rest.length; i += 2) jobs.push({ token: rest[i], asOfIso: rest[i + 1] });

  for (const job of jobs) {
    const { token, asOfIso: manualAsOf } = job;
    console.log(`\n${'='.repeat(90)}\n▶ token ${token}${atTrigger ? '  [at-trigger 模式]' : '  asOf=' + manualAsOf}`);
    const createEv = await fetchTokenCreate(sb, token);
    if (!createEv) console.log('  ⚠ wss_events 无 token_create（creator/supply 缺失，isCreator/whp 按 null 口径）');

    let fa, asOfMs, ticks;
    if (atTrigger) {
      ticks = await fetchAllTicks(sb, token, null); // 全史
      const st = initState(createEv);
      let trig = null;
      for (const t of ticks) {
        feedTick(st, t);
        if (gatesPass(st, t, trigger)) { trig = t; break; }
      }
      if (!trig) {
        console.log(`  ticks(全史)=${ticks.length}  platform=${createEv?.platform ?? '?'}  creator=${(createEv?.payload?.creator || '').slice(0, 12) || '无'}`);
        const lastBlock = ticks.length ? ticks[ticks.length - 1].block_number : null;
        console.log(`  终态门: tradeCount=${st.tradeCount}(>${trigger.tradeCount}?) buyBnb=${st.totalBuyBnb.toFixed(3)}(>${trigger.buyBnb}?) holders=${st.holderCount}(≥${trigger.minHolders}?) blockDiff=${lastBlock != null && st.firstBlockNumber != null ? Number(lastBlock) - st.firstBlockNumber : '无块'}`);
        console.log('  → 全史从未过门 → TPA 永不触发 → verdict 恒 pending → TPAPre_* 条件恒 false（fail-closed 不买）');
        continue;
      }
      fa = st;
      asOfMs = Date.parse(trig.block_time);
      const age = fa.firstTickAt != null ? ((asOfMs - fa.firstTickAt) / 1000).toFixed(0) : '?';
      console.log(`  ticks(全史)=${ticks.length}  platform=${createEv?.platform ?? '?'}  creator=${(createEv?.payload?.creator || '').slice(0, 12) || '无'}`);
      console.log(`  ★ 首次过门 tick: ${trig.block_time} (id=${trig.id}, age=${age}s)  门状态: tradeCount=${fa.tradeCount} buyBnb=${fa.totalBuyBnb.toFixed(3)} holders=${fa.holderCount} blockDiff=${Number(trig.block_number) - fa.firstBlockNumber}`);
      console.log(`  → 生产语义：TPA 在此刻触发，verdict 于此 tick 后数秒就绪（画像 asOf=此刻）`);
    } else {
      const asOfMs0 = Date.parse(manualAsOf);
      if (!Number.isFinite(asOfMs0)) { console.error(`非法 asOf: ${manualAsOf}`); continue; }
      ticks = await fetchAllTicks(sb, token, manualAsOf);
      console.log(`  ticks[创建,asOf)=${ticks.length}  platform=${createEv?.platform ?? '?'}  creator=${(createEv?.payload?.creator || '').slice(0, 12) || '无'}`);
      fa = buildFaState(ticks, createEv);
      asOfMs = asOfMs0;
      const lastBlock = ticks.length ? ticks[ticks.length - 1].block_number : null;
      const blockDiff = (fa.firstBlockNumber != null && lastBlock != null) ? Number(lastBlock) - fa.firstBlockNumber : null;
      const gates = fa.tradeCount > trigger.tradeCount && fa.totalBuyBnb > trigger.buyBnb
        && fa.holderCount >= trigger.minHolders && blockDiff != null && blockDiff >= trigger.blocks;
      console.log(`  触发门@asOf: tradeCount=${fa.tradeCount}(>${trigger.tradeCount}?) buyBnb=${fa.totalBuyBnb.toFixed(3)}(>${trigger.buyBnb}?) holders=${fa.holderCount}(≥${trigger.minHolders}?) blockDiff=${blockDiff}(≥${trigger.blocks}?) age=${((asOfMs - (fa.firstTickAt || asOfMs)) / 1000).toFixed(0)}s`);
      console.log(`  → 触发${gates ? '✅命中（write-once 首次满足在更早 tick，画像以 asOf 为准）' : '❌未过门（TPA 不会分析此票，下面为强制判定）'}`);
    }

    // TPA 管线（与 _analyze 步骤 1-6 同源，不落表不回填）
    const topHolders = tpa._collectTopHolders(fa);
    console.log(`  top${topHolders.length} holders（net>0 按持仓降序）:`);
    const metrics = await tpa._computeHolderMetrics(topHolders, fa, asOfMs);
    const { walletProfiles, walletScoreSummary, zhuangRetail, zhuangRetailRatio, walletHoldingPct } = metrics;

    const holdingFactors = { TPAPre_walletHoldingPct: walletHoldingPct, TPAPre_tokenScore: walletScoreSummary?.totalScore ?? null };
    if (zhuangRetail) {
      holdingFactors.TPAPre_zhuangScore = zhuangRetail.zhuangScore;
      holdingFactors.TPAPre_retailScore = zhuangRetail.retailScore;
      holdingFactors.TPAPre_newWalletScore = zhuangRetail.newWalletScore;
      holdingFactors.TPAPre_neutralScore = zhuangRetail.neutralScore;
      holdingFactors.TPAPre_minZR = zhuangRetail.minZR;
      holdingFactors.TPAPre_gapZR = zhuangRetail.gapZR;
      holdingFactors.TPAPre_zhuangPct = zhuangRetail.zhuangPct;
      holdingFactors.TPAPre_newWalletPct = zhuangRetail.newWalletPct;
      holdingFactors.TPAPre_retailPct = zhuangRetail.retailPct;
      holdingFactors.TPAPre_neutralPct = zhuangRetail.neutralPct;
      holdingFactors.TPAPre_zhuangHolderCount = zhuangRetail.holderCount;
      holdingFactors.TPAPre_zhuangRetailRatio = Number.isFinite(zhuangRetailRatio) ? Number(zhuangRetailRatio.toFixed(3)) : null;
      holdingFactors.TPAPre_zhuangRetailRatioInfinite = !Number.isFinite(zhuangRetailRatio);
    }

    // 明细表
    console.log('\n  #  地址            float%   net(峰值)      score  分类(子型)           画像源     tokenCnt  bad14d  avgBnb    totalBnb   早期大买/砸盘卖');
    walletProfiles.forEach((p, idx) => {
      const d = classifyHolderDetail(p) || {};
      const sub = [d.subtype?.dust && 'dust', d.subtype?.big && 'big'].filter(Boolean).join('+');
      console.log(
        String(idx + 1).padStart(2) + ' ' + (p.address || '').slice(0, 12).padEnd(14)
        + String(p.floatPct ?? '-').padStart(6) + '% '
        + (fmtTokens(p.netTokens) + '(' + fmtTokens(fa._traderMaxNetTokens.get(p.address)) + ')').padEnd(14)
        + String(p.score ?? 'null').padStart(6).slice(0, 6) + '  '
        + String(d.bucket ?? '?').padEnd(10) + String(sub).padEnd(10)
        + String(p.source ?? '?').padEnd(10)
        + String(p.tokenCount ?? 0).padStart(8) + ' '
        + String(p.badCount14d ?? 0).padStart(6) + ' '
        + String(Number((p.avgBnb ?? 0).toPrecision(3))).padStart(8) + ' '
        + String(Number((p.totalBnb ?? 0).toPrecision(3))).padStart(9) + '  '
        + `${p.earlyLargeBuyCount ?? 0}/${p.crashLargeSellCount ?? 0}`,
      );
    });

    // 聚合 + verdict
    console.log(`\n  tokenScore=${walletScoreSummary?.totalScore}  whp=${walletHoldingPct}%  scoredN=${walletScoreSummary?.scoredCount ?? '?'}`);
    if (zhuangRetail) {
      console.log(`  庄散: 庄=${zhuangRetail.zhuangScore}(${zhuangRetail.zhuangPct}%) 新钱包=${zhuangRetail.newWalletScore}(${zhuangRetail.newWalletPct}%) 散户=${zhuangRetail.retailScore}(${zhuangRetail.retailPct}%) 中性=${zhuangRetail.neutralScore}(${zhuangRetail.neutralPct}%) holderCount=${zhuangRetail.holderCount}`);
      console.log(`  庄散比 (庄+新)/散 = ${Number.isFinite(zhuangRetailRatio) ? zhuangRetailRatio.toFixed(3) : '∞ (retail=0)'}  minZR=${zhuangRetail.minZR} gapZR=${zhuangRetail.gapZR}`);
    } else {
      console.log('  庄散: null（holderCount=0 → ratio null → fail-closed）');
    }
    const { verdict, blockReasons } = tpa._decideVerdict(walletScoreSummary, zhuangRetail, holdingFactors);
    console.log(`\n  ★ verdict = ${verdict.toUpperCase()}${blockReasons.length ? '  block: [' + blockReasons.join(' ; ') + ']' : ''}`);
    console.log(`  默认 zhuangCondition = ${tpa._zhuangCondition}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
