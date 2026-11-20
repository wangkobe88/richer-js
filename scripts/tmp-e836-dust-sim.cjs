#!/usr/bin/env node
// e836 案模拟：burst 判定链剔尘埃（买+卖 bnb < 尘线）——新旧口径对拍
// 旧=现网 buildSnapshotFromRows；新=同函数但行集预过滤 bnb >= DUST_LINE（模拟仅读 burst 键，
// 其余键受过滤影响属模拟误差——真实现只过滤 burst 扫描行集）
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require('../src/market-analysis/cheat-state-builder.js');

const DUST_LINE = Number(process.env.DUST_LINE || 0.03);
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const CASES = [
  { tag: 'e836 牢猫(本案)', token: '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777', n: 46 },
  { tag: 'CD422 NATIVE(源案)', token: '0xc71a685b7ccb5dcd119ddc889f78f048e4e37777', n: 15 },
];

async function loadMeta(sb, token) {
  const { data, error } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create')
    .eq('token_address', token).order('id', { ascending: true }).limit(5);
  if (error) throw error;
  const hit = (data ?? []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return {
    address: token, symbol: p.symbol || null, name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

async function pullToAnchor(sb, token, n) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw error;
  if (!data || data.length < n) throw new Error(`锚截窗不足: ${data ? data.length : 0}/${n}`);
  return data;
}

function burstOf(snap) {
  const d = snap.derived || {};
  return {
    lastGap: d.burstLastGapSec, fromDt: d.burstExitWaveFromDt, endDt: d.burstExitWaveEndDt,
    buyBnb: d.burstExitWaveBuyBnb, wallets: d.burstExitWaveWallets,
    avg: d.burstWaveWalletAvgBnb, med: d.burstWaveWalletMedianBnb,
    sinceEnd: d.burstSecSinceWaveEnd, exitVs: d.burstExitVsLaunchPct,
    segBuy: d.burstWaveSegBuyBnb, segSell: d.burstWaveSegSellBnb, segSellPct: d.burstWaveSegSellPct,
    bundleMax: d.burstWaveBundleMaxWallets, bundleAdj: d.burstWaveBundleAdjPairSum,
  };
}

function factRow(snap) {
  const { state } = buildCheatState(snap);
  for (const line of String(state).split('\n')) if (/停滞突发波事实/.test(line)) return line.trim();
  return '(无事实行)';
}

(async () => {
  const sb = dbManager.getClient();
  for (const c of CASES) {
    const meta = await loadMeta(sb, c.token);
    const rows = await pullToAnchor(sb, c.token, c.n);
    const quoteToken = (() => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].quote_token) return rows[i].quote_token; return null; })();
    const oldSnap = buildSnapshotFromRows(rows, { ...meta, quoteToken });
    const kept = rows.filter(r => (Number(r.bnb_amount) || 0) >= DUST_LINE);
    const dropped = rows.length - kept.length;
    const newSnap = buildSnapshotFromRows(kept, { ...meta, quoteToken });
    console.log(`\n===== ${c.tag}  尘线=${DUST_LINE}  锚${c.n}行(剔${dropped}) =====`);
    console.log('旧:', JSON.stringify(burstOf(oldSnap)));
    console.log('新:', JSON.stringify(burstOf(newSnap)));
    console.log('旧事实行:', factRow(oldSnap).slice(0, 300));
    console.log('新事实行:', factRow(newSnap).slice(0, 300));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
