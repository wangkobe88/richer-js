#!/usr/bin/env node
// 一次性：建「JG6 taildip 有机盘豁免对拍」Case 集合并加三窗 LEG6 命中 112 票为成员。
// 182 跑（LEG6 重放需拉 ticks）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const NAME = 'JG6-taildip豁免对拍';
const DESC = '金狗 JG-6（쿠우타 0xc0e896dd…7777）案 FP33 tail_dip 有机盘豁免对拍集：三窗（w1003 bt-v164/w1019 bt-v159/w1012 bt-v155）tail_dip_knife 被拦人群中 LEG6 底形状（无对敲∧nbs<10∧HHI<0.2∧买≥3B∧路由入口≥60∧top1买<15）命中全集——含最终豁免面（28 票）与被精化腿剔除的对照（量超/捆绑/famous 未参与/跟单重）。回测用法：同包两臂对拍（fourmemeWs.buyPointCheck.factorCheck.tailDipOrganicExempt 开 vs 关）。';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;
const LEG6 = d => (d.washPairCount ?? 0) === 0 && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2
  && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15;
const WINS = [
  ['9e9163de-a677-4d39-9c33-9ec9df05e400', 'w1003'],
  ['ce102e94-293c-4f8f-af98-cd06f4b0e98c', 'w1019'],
  ['dddbe79e-480a-402a-aa35-85a72d2f591e', 'w1012'],
];

(async () => {
  const sb = dbManager.getClient();
  // 集合行（幂等：同名先查）
  const { data: exist } = await sb.from('case_collections').select('id, name').eq('name', NAME).maybeSingle();
  let colId;
  if (exist) { colId = exist.id; console.log('集合已存在:', colId); }
  else {
    const id = crypto.randomUUID();
    const { error } = await sb.from('case_collections').insert({ id, name: NAME, description: DESC });
    if (error) throw new Error(error.message);
    colId = id; console.log('集合已建:', colId);
  }

  async function loadAllTicks(addr) {
    const rows = []; let f = 0;
    while (f <= CAP) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data); if (data.length < 1000) break; f += 1000;
    }
    return rows;
  }
  const members = new Map(); // addr → {meta, note}
  for (const [exp, label] of WINS) {
    let sigs = []; let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address, created_at').eq('experiment_id', exp).eq('signal_type', 'BUY')
        .filter('metadata->>execution_reason', 'eq', 'factor_gate_tail_dip_knife')
        .order('id', { ascending: true }).range(from, from + 199);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      sigs.push(...data); if (data.length < 200) break; from += 200;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s.created_at);
    console.log(`[${label}] 被拦 ${sigs.length} 行 / ${first.size} 票 → LEG6 过滤中`);
    let hit = 0;
    for (const [addr, t0s] of first) {
      if (members.has(addr)) continue;
      const t0 = new Date(t0s).getTime();
      const rows = await loadAllTicks(addr);
      for (const r of rows) r.bt = new Date(r.block_time).getTime();
      rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
      const anchorRows = rows.filter(r => r.bt <= t0).slice(-CAP);
      if (anchorRows.length < 7) continue;
      const { data: ev } = await sb.from('wss_events').select('platform,payload,block_time')
        .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(5);
      const hitEv = (ev || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
      const p = hitEv ? hitEv.payload : {};
      const meta = {
        address: addr, symbol: p.symbol || null, name: p.name || null, platform: hitEv ? hitEv.platform : null,
        createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hitEv ? hitEv.block_time : null),
        creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
        totalSupply: p.totalSupply ?? ((hitEv && (hitEv.platform === 'flap' || hitEv.platform === 'gang')) ? 1e9 : null),
        quoteToken: [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null,
      };
      let d = null;
      try { d = buildSnapshotFromRows(anchorRows, meta, { capped: rows.length > CAP, anchorTickCount: anchorRows.length }).derived; } catch { }
      if (!d || !LEG6(d)) continue;
      members.set(addr, { meta, note: `JG-6 对拍成员（${label} LEG6 命中）` });
      hit++;
    }
    console.log(`[${label}] LEG6 命中 ${hit} 票`);
  }
  console.log('合计去重成员:', members.size);

  // 插成员（幂等：UNIQUE(collection_id,token_address) 冲突跳过）
  let inserted = 0;
  for (const [addr, m] of members) {
    const { data: dup } = await sb.from('case_collection_tokens').select('id')
      .eq('collection_id', colId).eq('token_address', addr).maybeSingle();
    if (dup) continue;
    const { error } = await sb.from('case_collection_tokens').insert({
      collection_id: colId, token_address: addr, platform: m.meta.platform,
      note: m.note, token_meta: m.meta, sync_state: 'pending',
    });
    if (error) throw new Error(error.message);
    inserted++;
  }
  console.log(`成员插入 ${inserted} 行（冲突跳过 ${members.size - inserted}）`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
