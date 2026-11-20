#!/usr/bin/env node
// e836 案：重放 cheat snapshot（锚=首 BUY 信号 created_at）看 burst 锚族 + state 事实行
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require('../src/market-analysis/cheat-state-builder.js');

const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';
const ANCHOR_ISO = '2026-10-04T11:01:51+00:00';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

(async () => {
  const sb = dbManager.getClient();
  // token meta（run.mjs 同款）
  const { data: ev, error: e1 } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create')
    .eq('token_address', TOKEN).order('id', { ascending: true }).limit(5);
  if (e1) throw e1;
  const hit = (ev ?? []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const meta = {
    address: TOKEN, symbol: p.symbol || null, name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
  console.log('meta:', JSON.stringify({ ...meta, address: TOKEN.slice(0, 10) + '…' }));

  // ticks 全量（单票小结果）→ 锚截窗
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select(TICK_COLS).eq('token_address', TOKEN).gt('id', cursor)
      .order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data); cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  const anchorTs = Date.parse(ANCHOR_ISO);
  const anchored = rows.filter(r => Date.parse(r.block_time) <= anchorTs);
  console.log(`ticks 总 ${rows.length} 行，锚(${ANCHOR_ISO})前 ${anchored.length} 行`);

  if (anchored.length) {
    const quoteToken = (() => { for (let i = anchored.length - 1; i >= 0; i--) if (anchored[i].quote_token) return anchored[i].quote_token; return null; })();
    const snap = buildSnapshotFromRows(anchored, { ...meta, quoteToken });
    const d = snap.derived || {};
    const keys = ['burstMaxGapSec', 'burstLastGapSec', 'burstExitWaveFromDt', 'burstExitWaveEndDt',
      'burstExitWaveBuyBnb', 'burstExitWaveWallets', 'burstWaveWalletAvgBnb', 'burstWaveWalletMedianBnb',
      'burstWaveWalletNetBnb', 'burstWaveSellBackPct', 'burstSecSinceWaveEnd',
      'burstExitVsLaunchPct', 'burstWaveSegBuyBnb', 'burstWaveSegSellBnb', 'burstWaveSegSellPct',
      'burstWaveBundleMaxWallets', 'burstWaveBundleAdjPairSum', 'actSpanSec', 'actTickCount', 'actTicksPerMin', 'actIdlePct'];
    for (const k of keys) console.log(`  ${k} =`, d[k]);
    // 波窗内逐笔
    const f = d.burstExitWaveFromDt, e = d.burstExitWaveEndDt;
    if (f !== null && f !== undefined) {
      console.log('\n波窗逐笔（出口行起 5s）:');
      for (const t of snap.ticks || []) {
        if (t.dt >= f && t.dt <= (e !== null ? e : f + 5)) {
          console.log(`  t+${t.dt}s ${t.side} ${Number(t.bnb).toFixed(4)}B wallet=${String(t.wallet).slice(0, 10)}…${t.i >= 0 ? '' : ''}`);
        }
      }
    }
    // state 停滞突发波事实行
    const { state } = buildCheatState(snap);
    for (const line of String(state).split('\n')) {
      if (/停滞突发波/.test(line)) console.log('STATE|', line.slice(0, 600));
    }
    // 锚窗逐笔全量（46 行）看时序
    console.log('\n锚窗逐笔:');
    for (const t of snap.ticks || []) {
      console.log(`  t+${String(t.dt).padStart(4)}s ${t.side} ${Number(t.bnb).toFixed(4)}B w=${String(t.wallet).slice(0, 8)}…`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
