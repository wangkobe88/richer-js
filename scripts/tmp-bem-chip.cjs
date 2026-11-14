#!/usr/bin/env node
/**
 * BEM Miner 筹码锚探针（v73 复审 #14 T018 追问：famous 控盘+top 集中）——182 跑
 *
 * 用户裁定 T018=poor 后提出新层面：①盘子被 famous 掌控 ②holders 不小但 top 占比
 * 太大 → CD 筹码锚迁移 BP 候选议题。本探针打两个口径验证「买点时点可得性」：
 *   锚窗 = block_time <= 信号 created_at（07:03:39）——BP/CD 决策时可得的 as-of 视角
 *   全量 = 不截窗（用户事后判断的视角）
 * 若锚窗 already 显现 → 迁移锚在买点可拦；若事后才展开 → 拦不住归卖侧监控。
 */
'use strict';

const { dbManager } = require('../src/services/dbManager.js');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const TOKEN = '0x75d5286d3ac478334fe098f015624486d7a77777';
const SIGNAL_AT = '2026-11-05T07:03:39'; // 生产 v1-t6 信号 created_at
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

function report(tag, snap) {
  const d = snap.derived ?? {};
  const out = {};
  for (const k of [
    'buyN', 'sellN', 'tickN',
    'famousDominancePct', 'famousFollowerTop3Pct', 'famousGroupBuyPct',
    'top1Top2HoldSupplyPct', 'top2HoldSupplyPct', 'clusterHoldSupplyPct', 't1PlusClusterSupplyPct',
    'bundleBuyPct', 'washPairSellPct', 'noBuySellPct', 'routerEntryBuyPct',
    'sameBlockHoldPct', 'equalBandHoldPct',
  ]) out[k] = d[k] === undefined ? null : d[k];
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(out, null, 1));
  const hp = d.holdingsProfile;
  if (hp) console.log('holdingsProfile:', JSON.stringify(hp));
  // top5 净持仓明细（wallets 数组已按 buyBnb 降序？——按净持仓重排打印）
  const w = (snap.wallets ?? []).map((x) => ({ w: x.wallet || x.addr || '?', buy: x.buyBnb, sell: x.sellBnb, net: x.netBnb, buys: x.buyCount ?? x.buys, famous: x.famous }));
  w.sort((a, b) => (b.net || 0) - (a.net || 0));
  console.log('top5 正净持仓钱包:', JSON.stringify(w.slice(0, 5), null, 1));
  const holders = w.filter((x) => (x.net || 0) > 0).length;
  const posSum = w.reduce((s, x) => s + Math.max(0, x.net || 0), 0);
  console.log(`正净持仓人数=${holders} Σ正净=${posSum.toFixed(4)} BNB`);
  if (holders > 0 && w[0]) {
    const top1 = w[0].net || 0, top2 = (w[1] && w[1].net) || 0;
    console.log(`top1 净占比=${((top1 / posSum) * 100).toFixed(1)}% top1+2=${(((top1 + top2) / posSum) * 100).toFixed(1)}%（流通域）`);
  }
}

async function main() {
  const sb = dbManager.getClient();
  const { data: ev, error: evErr } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', TOKEN)
    .order('id', { ascending: true }).limit(5);
  if (evErr) throw new Error(evErr.message);
  const meta = (ev ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  console.log('token meta:', meta ? `${meta.payload.symbol}/${meta.payload.name} create=${meta.block_time}` : 'MISS');

  const { data: all, error } = await sb.from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', TOKEN).order('block_number', { ascending: true })
    .order('log_index', { ascending: true }).limit(3001);
  if (error) throw new Error(error.message);
  const rows = all ?? [];
  console.log(`全量行数=${rows.length} 首=${rows[0] && rows[0].block_time} 末=${rows[rows.length - 1] && rows[rows.length - 1].block_time}`);

  const win = rows.filter((r) => r.block_time <= SIGNAL_AT);
  console.log(`锚窗行数=${win.length}`);

  // 多刀时点扫描：famous dom/筹码集中何时在锚窗显形（迁移立法的可得性证据）
  for (const cut of ['2026-11-05T07:03:39', '2026-11-05T07:03:44', '2026-11-05T07:04:10', '2026-11-05T07:04:40', '2026-11-05T07:05:30', '2026-11-05T07:07:18']) {
    const w = rows.filter((r) => r.block_time <= cut);
    if (!w.length) { console.log(`\n===== <= ${cut}：0 行 =====`); continue; }
    const s = buildSnapshotFromRows(w, meta, { anchorTickCount: w.length });
    const d = s.derived ?? {};
    const hp = d.holdingsProfile ?? [];
    console.log(`\n===== <= ${cut}（${w.length} 行）===== famousDom=${d.famousDominancePct} followerTop3=${d.famousFollowerTop3Pct} groupBuy=${d.famousGroupBuyPct} bundle=${d.bundleBuyPct} sbHold=${d.sameBlockHoldPct === null ? 'null' : d.sameBlockHoldPct.toFixed(1)} top1circ=${hp[0] ? hp[0].circPct.toFixed(1) : '-'}% top1+2circ=${hp.length > 1 ? (hp[0].circPct + hp[1].circPct).toFixed(1) : '-'}% 持有人=${hp.length} buys=${d.buyN}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
