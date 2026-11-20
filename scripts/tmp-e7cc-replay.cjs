#!/usr/bin/env node
// 临时查证：0xe7cc…7777 在 e5941591 的四个买信号锚点上，把 0xb2d1…851 加入
// famous roster 后 FP 因子门（生产代码路径重放：_pullTicksDb 同款拉数+snapshot+
// evaluateFactorPreBuy）是否会拒。
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check.js');
const fs = require('fs');
const path = require('path');

const TOKEN = '0xe7ccf2a3d532542606d57fa29b7f4c0bbe677777';
const FAM = '0xb2d1af0746c410e146272e804b1741f07f83b851';
const ANCHORS = [
  ['sig1 P10·首买', '2026-11-04T20:26:57+00:00'],
  ['sig2 P11·首买', '2026-11-04T20:27:04+00:00'],
  ['sig3 P1·首买 ', '2026-11-04T20:56:56+00:00'],
  ['sig4 P1·首买(成交锚)', '2026-11-04T20:57:01+00:00'],
];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

async function pullTicksDb(sb, anchorIso) {
  let q = sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', TOKEN);
  if (anchorIso) q = q.lte('block_time', anchorIso);
  const tail = await q.order('block_number', { ascending: false }).order('log_index', { ascending: false }).limit(3000);
  if (tail.error) throw new Error(tail.error.message);
  const tailRows = tail.data || [];
  if (tailRows.length === 0) return { rows: [], n: 0, capped: false, quoteToken: null };
  if (tailRows.length < 3000) {
    const rows = tailRows.slice().reverse();
    return { rows, n: rows.length, capped: false, quoteToken: rows[rows.length - 1].quote_token || null };
  }
  let hq = sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', TOKEN);
  if (anchorIso) hq = hq.lte('block_time', anchorIso);
  const head = await hq.order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(300);
  if (head.error) throw new Error(head.error.message);
  const seen = new Set(tailRows.map((r) => `${r.block_number}:${r.log_index}`));
  const headOnly = (head.data || []).filter((r) => !seen.has(`${r.block_number}:${r.log_index}`));
  const rows = headOnly.concat(tailRows.slice().reverse());
  return { rows, n: tailRows.length, capped: true, quoteToken: rows[rows.length - 1].quote_token || null };
}

async function main() {
  const sb = dbManager.getClient();
  // token_create 元数据
  const { data: ev, error: ee } = await sb.from('wss_events').select('payload,block_time,platform')
    .eq('kind', 'token_create').eq('token_address', TOKEN).limit(1);
  if (ee) throw new Error(ee.message);
  const pl = (ev && ev[0] && ev[0].payload) || {};
  console.log(`token_create: block_time=${ev && ev[0] && ev[0].block_time} platform=${ev && ev[0] && ev[0].platform}`);
  console.log(`payload keys: ${Object.keys(pl).join(',')} symbol=${pl.symbol || pl.tokenSymbol} totalSupply=${pl.totalSupply}`);

  // roster = 现行 + 新增钱包
  const rosterJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  const roster = new Set(rosterJson.wallets.map((w) => String(w).toLowerCase()));
  roster.add(FAM.toLowerCase());
  console.log(`roster: v${rosterJson.version} ${rosterJson.wallets.length} 址 + ${FAM.slice(0, 8)}… = ${roster.size}`);

  const meta = {
    address: TOKEN,
    symbol: pl.symbol || pl.tokenSymbol || null,
    name: pl.name || null,
    platform: (ev && ev[0] && ev[0].platform) || pl.platform || null,
    quoteToken: null,
    createdAt: (ev && ev[0] && ev[0].block_time) || null,
    totalSupply: pl.totalSupply ?? null,
    creatorAddress: pl.creator || null,
  };

  for (const [label, ts] of ANCHORS) {
    const anchorIso = new Date(ts).toISOString();
    const pull = await pullTicksDb(sb, anchorIso);
    meta.quoteToken = pull.quoteToken;
    const snap = buildBuyPointSnapshot(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.n, signalInfo: {}, famousRoster: roster });
    const withFam = evaluateFactorPreBuy(snap); // roster 已含新增
    const bd = snap.buyDerived || {};
    const ft = bd.famousTraces;
    const sr = ft && ft.groupBuyBnb > 0 ? (ft.groupSellBnb / ft.groupBuyBnb).toFixed(3) : '-';
    console.log(`\n=== ${label} @ ${ts}  窗=${pull.n}行 capped=${pull.capped}`);
    console.log(`FP(含新famous): pass=${withFam.pass} reason=${withFam.reason} arms=[${withFam.arms.join(',')}]`);
    if (ft) {
      console.log(`famousTraces: 钱包数=${ft.wallets.length} 群买=${ft.groupBuyBnb}B(${ft.groupBuyPct}%) 群卖=${ft.groupSellBnb}B(${ft.groupSellPct}%) 卖比=${sr} 残仓=${ft.presenceNetBnb}B(比=${ft.groupBuyBnb > 0 ? (ft.presenceNetBnb / ft.groupBuyBnb).toFixed(3) : '-'})`);
      console.log(`  首买@+${ft.groupFirstBuyDt}s 顺位=${ft.groupFirstBuyRank} 末卖@+${ft.lastSellVsLaunchPct}% 距锚${ft.lastSellToAnchorSec}s 入场均价=${ft.groupEntryAvgBnb} 首买后最低=${ft.postEntryMinBnb}`);
      for (const w of ft.wallets) {
        console.log(`  - ${w.w.slice(0, 10)} 买${w.buyBnb} 卖${w.sellBnb} 净${w.netBnb} 首买@+${w.firstBuyDt}s entryVs=${w.entryVsLaunchPct}% hold=${w.holdSec}s fastFlip=${w.fastFlip}`);
      }
    } else {
      console.log('famousTraces: null（roster 缺失）');
    }
    console.log(`盘面: ath=${bd.athVsLaunchPct} chg30=${bd.chg30Pct} curVs=${bd.curVsLaunchPct ?? '-'} minVs=${bd.minVsLaunchPct} 总额=${bd.totalVolumeBnb}`);
    // 逐 famous 门值
    const g = (withFam.gates || []).filter((x) => ['fam_holding', 'fam_harvest', 'fam_harvest_final', 'fam_low_exit', 'fam_early_flip', 'fam_burst_wave', 'fam_dom_fall'].includes(x.id));
    for (const x of g) console.log(`  门[${x.id}] hit=${x.hit} observe=${!!x.observe} ${x.value}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
