// btv109 全量成交票 sbw 出口波 sweep（tmp 不进 git）：生产答案 + snapshot 出口波十键，不烧 Jev
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { dbManager } = require_('../../src/services/dbManager.js');
const c = await dbManager.getClient();
const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

// 1) 每票首条成交 buy 信号
const sig = await c.from('strategy_signals').select('token_address,created_at,metadata')
  .eq('experiment_id', EXP).eq('action','buy').eq('executed', true).order('created_at', { ascending: true }).limit(1000);
const byToken = new Map();
for (const s of sig.data ?? []) if (!byToken.has(s.token_address)) byToken.set(s.token_address, s);
console.log('成交票数', byToken.size);

const out = [];
let i = 0;
for (const [addr, s] of byToken) {
  i++;
  const cc = s.metadata?.cheatCheck ?? {};
  const bp = s.metadata?.buyPoint ?? {};
  try {
    const { data: rows0, error } = await c.from('wss_price_ticks').select(TICK_COLS)
      .eq('token_address', addr).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3001);
    if (error) throw new Error(error.message);
    const rows = (rows0 ?? []).slice(0, 3000);
    const anchorAt = new Date(Date.parse(s.created_at) + 4000).toISOString();
    let n = 0;
    for (const r of rows) { const bt = Date.parse(r.block_time); if (Number.isFinite(bt) && bt <= Date.parse(anchorAt)) n++; }
    const window = rows.slice(0, n);
    const { data: ev } = await c.from('wss_events').select('platform,payload,block_time')
      .eq('kind','token_create').eq('token_address', addr).order('id',{ascending:true}).limit(5);
    const hit = (ev ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    let quoteToken = null;
    for (let k = window.length - 1; k >= 0; k--) if (window[k].quote_token) { quoteToken = window[k].quote_token; break; }
    const meta = { address: addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, totalSupply: p.totalSupply ?? ((hit && (hit.platform==='flap'||hit.platform==='gang')) ? 1e9 : null), quoteToken };
    const snap = buildSnapshotFromRows(window, meta, { capped: false, anchorTickCount: window.length });
    const d = snap.derived;
    out.push({
      addr, symbol: p.symbol ?? '', anchor: s.created_at, anchorN: window.length,
      prodSbw: cc.levels?.stallBurstWave ?? null, prodAct: cc.levels?.activityLevel ?? null,
      prodGrade: cc.grade ?? null, prodExempt: cc.exempt?.code ?? null,
      bpAct: bp.dimensions?.activity_level?.bucket ?? null,
      lastGapSec: d.burstLastGapSec, exitWaveBuyBnb: d.burstExitWaveBuyBnb, exitWaveWallets: d.burstExitWaveWallets,
      secSinceWaveEnd: d.burstSecSinceWaveEnd, waveNetBnb: d.burstWaveNetBnb, walletNetBnb: d.burstWaveWalletNetBnb,
      sellBackPct: d.burstWaveSellBackPct, median: d.burstWaveWalletMedianBnb, avg: d.burstWaveWalletAvgBnb,
      exitVs: d.burstExitVsLaunchPct, burstExitSegSellPct: d.burstExitSegSellPct ?? null,
      winBuyBnb: d.totalBuyBnb, winTickN: d.tickCount,
    });
  } catch (e) {
    out.push({ addr, error: String(e.message).slice(0,80), prodSbw: cc.levels?.stallBurstWave ?? null, prodAct: cc.levels?.activityLevel ?? null, bpAct: bp.dimensions?.activity_level?.bucket ?? null });
  }
  if (i % 20 === 0) console.log('进度', i);
}
writeFileSync('/tmp/bp-runs/btv109-sbw-sweep.json', JSON.stringify(out));
console.log('done', out.length, '错误', out.filter(o=>o.error).length);
await dbManager.close?.();
