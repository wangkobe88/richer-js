#!/usr/bin/env node
// JG-6 用户三疑点锚验证：中国奶娃(捆绑砸盘?)/凡人修仙传(下跌不正常?)/持枪仓鼠(活跃度?) vs 쿠우타/SI/릴테이 正例。
// 锚=各自实验首次被 tail_dip 拦时刻。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;
const CASES = [
  { exp: 'dddbe79e-480a-402a-aa35-85a72d2f591e', addr: '0x53d978f85ab742f38be628278ba1b8ba69227777', label: '中国奶娃大学(用户:捆绑砸盘)' },
  { exp: 'dddbe79e-480a-402a-aa35-85a72d2f591e', addr: '0x0717bde1932e4375eabca87ef86b7ebeb5087777', label: '凡人修仙传(用户:下跌不正常)' },
  { exp: 'dddbe79e-480a-402a-aa35-85a72d2f591e', addr: '0x9b5bbc831a61e4a351801ae24b4b79f506827777', label: '持枪仓鼠(用户:活跃度不行)' },
  { exp: '9e9163de-a677-4d39-9c33-9ec9df05e400', addr: '0xc0e896ddec43881055a25786c17fa5d5d6337777', label: '쿠우타(正例)' },
  { exp: '9e9163de-a677-4d39-9c33-9ec9df05e400', addr: '0xac5055c15c1b4d166e60fefcdcbaf631a7d87777', label: 'SI(正例)' },
  { exp: '9e9163de-a677-4d39-9c33-9ec9df05e400', addr: '0x28ea270ad6cd7151fc2cf563079dcf4e530d7777', label: '릴테이(正例)' },
];

(async () => {
  const sb = dbManager.getClient();
  for (const c of CASES) {
    // 首次被拦时刻
    const { data: sig } = await sb.from('strategy_signals')
      .select('created_at, metadata').eq('experiment_id', c.exp).eq('token_address', c.addr)
      .eq('signal_type', 'BUY').filter('metadata->>execution_reason', 'eq', 'factor_gate_tail_dip_knife')
      .order('created_at', { ascending: true }).limit(1);
    if (!sig || !sig.length) { console.log(`${c.label}: 无 tail_dip 拒行`); continue; }
    const t0 = new Date(sig[0].created_at).getTime();
    const tf = (sig[0].metadata || {}).trendFactors || {};
    // ticks
    const rows = []; let f = 0;
    while (f <= CAP) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', c.addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data); if (data.length < 1000) break; f += 1000;
    }
    for (const r of rows) r.bt = new Date(r.block_time).getTime();
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const anchorRows = rows.filter(r => r.bt <= t0).slice(-CAP);
    const { data: ev } = await sb.from('wss_events').select('platform,payload,block_time')
      .eq('kind', 'token_create').eq('token_address', c.addr).order('id', { ascending: true }).limit(5);
    const hit = (ev || []).find(r => r.payload && r.payload.symbol);
    const p = hit ? hit.payload : {};
    const meta = {
      address: c.addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
      quoteToken: [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null,
    };
    const d = buildSnapshotFromRows(anchorRows, meta, { capped: rows.length > CAP, anchorTickCount: anchorRows.length }).derived;
    // 崩塌段卖买结构（锚前 120s）
    let s120 = 0, b120 = 0, sellN120 = 0;
    for (const r of anchorRows) {
      if (r.bt < t0 - 120000 || r.bt > t0) continue;
      if ((r.trade_type || '').toUpperCase() === 'BUY') b120 += r.bnb_amount || 0;
      else { s120 += r.bnb_amount || 0; sellN120++; }
    }
    console.log(`\n=== ${c.label} ${new Date(t0).toISOString().slice(11, 19)} ===`);
    console.log(JSON.stringify({
      贴锚砸块: d.nearDumpQualBlocks, 砸块最恶卖方: d.nearDumpWorstSellers, 砸块距锚: d.nearDumpWorstSecToAnchor,
      买卖比_全窗: d.anchorBuySellRatio?.toFixed(2), 崩塌120s: `卖${s120.toFixed(2)}B/${sellN120}笔 vs 买${b120.toFixed(2)}B`,
      卖侧捆绑: `launchSellBundleClusterSize=${tf.launchSellBundleClusterSize} launchBundleClusterSize=${tf.launchBundleClusterSize}`,
      活跃度: `${d.activityLevel ?? '-'}${d.activityUneven ? '~起伏' : ''} 吞吐${(d.actWeightedThroughputBnbPerMin ?? -1).toFixed(1)}B/min`,
      临近段: `tail10s=${d.nearTail10TickN}笔 seg=${d.nearSegTickN}笔 preGap=${(d.nearSegMaxGapSec ?? -1)}s`,
      买中位: d.buyMedianBnb?.toFixed(3), 总卖: `${d.totalSellBnb?.toFixed(1)}B`, 簇往返: d.clusterRoundTripPct?.toFixed(0) + '%',
    }, null, 0).replace(/,/g, '，').replace(/"/g, ''));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
