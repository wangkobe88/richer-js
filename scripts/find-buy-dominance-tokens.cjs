#!/usr/bin/env node
/**
 * 单钱包买入主导扫描（作弊票挖掘，2026-09-29 用户需求）
 *
 * 口径（用户裁定）：「买的时候就这一个钱包占据绝大多数流动性」才算作弊票——
 * 叙事好、后期逐渐多人参与的票不算。因此主判据锚在**首 earlySec 秒窗**
 * （默认 90s，对齐 EarlyParticipantCheckService 固定回溯窗与引擎买点节奏）：
 *   top1EarlyShare = 首窗内单一钱包买入 BNB / 首窗总买入 BNB ≥ share 阈值
 *   且 首窗总买入 ≥ minBnb（过滤尘埃票）
 * 全史 top1 占比只作参考列输出，不做判据。
 *
 * 数据：wss_price_ticks 全表 id 游标分页（只拉 trade_type='buy' 行），JS 侧
 * 聚合——postgrest 无 GROUP BY，重聚合必须在 182 跑（本地 VPN 必超时）。
 * 排除 PROTOCOL_ADDRS（four.meme 内盘官方）。窗口按 token 首 tick 锚定，
 * 首 tick 早于 cutoff 的 token 整体剔除（窗口前创建的票首窗不完整）。
 *
 * 联动标注：top1 钱包 sniper 画像（wallet_offline_profiles + isSniperProfile，
 * 与引擎运行时判定同源）、token_narrative 评级（叙事好+多人参与不该误伤）、
 * 7777 尾号 vanity 标记、已知对倒主力标记。
 *
 * 用法（182）：
 *   NODE_OPTIONS=--max-old-space-size=8192 node scripts/find-buy-dominance-tokens.cjs \
 *     --days 7 --share 0.6 --min-bnb 1 --early-sec 90
 * 输出：控制台摘要 + 明细表；全量结果 JSON 落 data/buy-dominance-scan-<ts>.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { isSniperProfile, PROTOCOL_ADDRS } = require('../src/trading-engine/pre-check/sniper-detector');

// ── CLI ──
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v == null || v.startsWith('--') ? dflt : v;
}
const DAYS = Number(arg('days', 7));
const SHARE = Number(arg('share', 0.6));       // 首窗 top1 买入占比阈值
const MIN_BNB = Number(arg('min-bnb', 1));     // 首窗总买入下限（BNB）
const EARLY_SEC = Number(arg('early-sec', 90)); // 首窗宽度
const TOP_N = Number(arg('top', 60));          // 控制台明细行数
const PAGE = 1000;                              // 分页大小（< Supabase max rows）

const GANG_WALLET = '0x1de460f363af910f51726def188f9004276bf4bc'; // 显化之歌案对倒主力

function ts(v) {
  return new Date(new Date(v).getTime() + 8 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
}

(async () => {
  const db = dbManager.getClient();
  const cutoff = Date.now() - DAYS * 24 * 3600 * 1000;

  // token → 聚合桶（普通对象，避免 Map 套 Map 的双倍开销）
  const tokens = new Map();
  let rows = 0, pages = 0;

  console.log(`扫描 wss_price_ticks 买入行 | days=${DAYS} share>=${SHARE} minBnb=${MIN_BNB} earlySec=${EARLY_SEC}`);
  console.log(`cutoff=${ts(cutoff)} (北京)`);

  let cursor = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id,token_address,trader_address,bnb_amount,block_time,platform')
      .eq('trade_type', 'buy')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`读 ticks 失败: ${error.message}`);
    if (!data || data.length === 0) break;
    pages++; rows += data.length;
    for (const r of data) {
      const bnb = +r.bnb_amount;
      if (!r.token_address || !r.trader_address || !(bnb > 0)) continue;
      if (PROTOCOL_ADDRS.has(r.trader_address.toLowerCase())) continue;
      const t = Date.parse(r.block_time);
      if (!Number.isFinite(t)) continue;

      let b = tokens.get(r.token_address);
      if (!b) {
        b = { firstTs: t, platform: r.platform || '?', total: 0, wallets: new Map(),
              earlyTotal: 0, earlyWallets: new Map(), buyCount: 0 };
        tokens.set(r.token_address, b);
      }
      if (t < b.firstTs) b.firstTs = t;
      b.total += bnb; b.buyCount++;
      b.wallets.set(r.trader_address, (b.wallets.get(r.trader_address) || 0) + bnb);
      if (t <= b.firstTs + EARLY_SEC * 1000) {
        b.earlyTotal += bnb;
        b.earlyWallets.set(r.trader_address, (b.earlyWallets.get(r.trader_address) || 0) + bnb);
      }
    }
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
    if (pages % 200 === 0) {
      console.log(`  … ${rows} 行 / ${tokens.size} token / ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
    }
  }
  console.log(`拉取完成：${rows} 买入行，${pages} 页，${tokens.size} token，${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);

  // ── 过滤：窗口内创建 + 首窗量够 + 首窗 top1 占比达标 ──
  const matched = [];
  let inWindow = 0;
  for (const [addr, b] of tokens) {
    if (b.firstTs < cutoff) continue; // 窗口前创建的票首窗不完整，剔除
    inWindow++;
    if (!(b.earlyTotal >= MIN_BNB)) continue;
    // 首窗 top1/top3
    let w1 = null, v1 = 0, arr = [...b.earlyWallets.entries()].sort((x, y) => y[1] - x[1]);
    if (arr.length) { w1 = arr[0][0]; v1 = arr[0][1]; }
    const top3e = arr.slice(0, 3).reduce((s, x) => s + x[1], 0);
    const share = v1 / b.earlyTotal;
    if (!(share >= SHARE)) continue;
    // 全史参考
    const arrF = [...b.wallets.entries()].sort((x, y) => y[1] - x[1]);
    matched.push({
      token: addr, platform: b.platform, createdMs: b.firstTs,
      earlyBuyBnb: +b.earlyTotal.toFixed(3),
      earlyWallets: b.earlyWallets.size,
      top1: w1, top1EarlyBnb: +v1.toFixed(3), top1EarlyShare: +share.toFixed(4),
      top3EarlyShare: +(top3e / b.earlyTotal).toFixed(4),
      top1FullShare: +(arrF.length ? arrF[0][1] / b.total : 0).toFixed(4),
      fullBuyBnb: +b.total.toFixed(3), fullWallets: b.wallets.size, buyCount: b.buyCount,
      tail7777: addr.endsWith('7777'), gangTop1: w1 === GANG_WALLET,
    });
  }
  matched.sort((x, y) => y.earlyBuyBnb - x.earlyBuyBnb);
  console.log(`\n窗口内新 token：${inWindow}；命中（首${EARLY_SEC}s top1 买入占比≥${SHARE} 且 ≥${MIN_BNB} BNB）：${matched.length}`);

  // ── 联动标注：top1 钱包 sniper 画像 + token 叙事评级（批量小查询）──
  const top1Set = [...new Set(matched.map(m => m.top1).filter(Boolean))];
  const sniperMap = new Map();
  for (let i = 0; i < top1Set.length; i += 100) {
    const { data: prof } = await db.from('wallet_offline_profiles')
      .select('address,profile')
      .in('address', top1Set.slice(i, i + 100));
    for (const p of prof || []) sniperMap.set(p.address, isSniperProfile(p.profile));
  }
  const tokenSet = matched.map(m => m.token);
  const ratingMap = new Map();
  for (let i = 0; i < tokenSet.length; i += 100) {
    const { data: narr } = await db.from('token_narrative')
      .select('token_address,numeric_rating')
      .in('token_address', tokenSet.slice(i, i + 100));
    for (const n of narr || []) {
      if (n.numeric_rating != null && !ratingMap.has(n.token_address)) ratingMap.set(n.token_address, n.numeric_rating);
    }
  }
  let sniperCnt = 0, tailCnt = 0, rated23 = 0;
  for (const m of matched) {
    m.top1Sniper = sniperMap.get(m.top1) || false;
    m.narrativeRating = ratingMap.get(m.token) ?? null;
    if (m.top1Sniper) sniperCnt++;
    if (m.tail7777) tailCnt++;
    if (m.narrativeRating === 2 || m.narrativeRating === 3) rated23++;
  }

  // ── 摘要 ──
  console.log(`其中：top1 为 sniper 画像钱包 ${sniperCnt}；7777 尾号 ${tailCnt}；叙事评级 2/3（好叙事需人工复核是否误伤）${rated23}`);
  const buckets = [0.6, 0.7, 0.8, 0.9, 0.98];
  for (const bk of buckets) {
    console.log(`  首窗 top1 占比 ≥${bk * 100}%：${matched.filter(m => m.top1EarlyShare >= bk).length}`);
  }

  // ── 明细表 ──
  console.log(`\nTop ${Math.min(TOP_N, matched.length)}（按首窗买入额降序）：`);
  console.log('token                                    plat  created(北京)       首窗BNB  首窗钱包  top1份额  top3份额  全史份额  sniper 7777 叙事');
  for (const m of matched.slice(0, TOP_N)) {
    console.log(
      `${m.token}  ${m.platform.slice(0, 4).padEnd(4)}  ${ts(m.createdMs)}  ${String(m.earlyBuyBnb).padStart(7)}  ${String(m.earlyWallets).padStart(5)}    ` +
      `${(m.top1EarlyShare * 100).toFixed(1).padStart(5)}%  ${(m.top3EarlyShare * 100).toFixed(1).padStart(5)}%  ${(m.top1FullShare * 100).toFixed(1).padStart(5)}%  ` +
      `${m.top1Sniper ? '🎯' : '  '}  ${m.tail7777 ? '7️⃣' : ' '}  ${m.narrativeRating ?? '-'}`);
  }

  // ── 全量落盘 ──
  const out = path.join(__dirname, '..', 'data', `buy-dominance-scan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify({
    params: { days: DAYS, share: SHARE, minBnb: MIN_BNB, earlySec: EARLY_SEC, scannedBuyRows: rows, tokensInWindow: inWindow },
    matched,
  }, null, 2));
  console.log(`\n全量结果已写入 ${out}（${matched.length} 条）`);
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
