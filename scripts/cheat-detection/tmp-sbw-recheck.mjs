// D3.69 参考线对拍九票（tmp 不进 git 不落 fixtures）：锚=成交信号 created_at+4s
// 期望：前四票（波 <0.3B/零买窗）翻 none；后五票（波 ≥0.56B）保持 burst
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { anchorCountAt } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { dbManager } = require_('../../src/services/dbManager.js');
const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const TARGETS = [
  ['反·T031 BNB时代', '0xea62a97fe03b20a143672184847b0c11e46d7777', '2026-11-02T23:02:12Z'],
  ['反·T032 币安logo', '0xc1763b4c7e284da879c213cbc32a86de1f307777', '2026-11-03T00:25:04Z'],
  ['反·T035 狼王共建', '0x6d5d4537f3ac5bf044207166af4638673c367777', '2026-11-03T01:40:19Z'],
  ['反·기니휘기零买窗', '0xef2767d619022bcd6a889ef5deca17e3364a7777', '2026-11-03T05:34:28Z'],
  ['正·画地为牢', '0x1ed2e3e5a991c5e04d4b0e88153a9aaef7167777', '2026-11-03T14:09:53Z'],
  ['正·纸小狗', '0xbb9e0095ee8677393f61da75f12bcf59758c7777', '2026-11-03T09:13:01Z'],
  ['正·CT PACKS', '0x35b19bdf25074ab8ae073eb13321d8cf62867777', '2026-11-03T07:41:49Z'],
  ['正·OSK', '0x54b8f943ff523f2cc427062980d95dd4abad7777', '2026-11-03T09:01:20Z'],
  ['正·跳跳虎', '0xab20a37fc09f6cef2bce82814489970cd7337777', '2026-11-03T02:17:11Z'],
];
const c = await dbManager.getClient();
for (const [name, addr, at] of TARGETS) {
  const anchorAt = new Date(Date.parse(at) + 4000).toISOString();
  const { data: rows0, error } = await c.from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', addr).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3001);
  if (error) throw new Error(error.message);
  const rows = (rows0 ?? []).slice(0, 3000);
  const n = anchorCountAt(rows, anchorAt);
  const window = rows.slice(0, n);
  const { data: ev } = await c.from('wss_events').select('platform,payload,block_time')
    .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(5);
  const hit = (ev ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  let quoteToken = null;
  for (let i = window.length - 1; i >= 0; i--) if (window[i].quote_token) { quoteToken = window[i].quote_token; break; }
  const meta = { address: addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null), quoteToken };
  const snap = buildSnapshotFromRows(window, meta, { capped: false, anchorTickCount: window.length });
  const { state } = buildCheatState(snap);
  const d = snap.derived;
  console.log(`\n===== ${name} 题集 ${q.CHEAT_QUESTIONS_VERSION} 锚=${n} 行 =====`);
  console.log('D3.67 十键:', JSON.stringify({ burstLastGapSec: d.burstLastGapSec, exitWaveFrom: d.burstExitWaveFromDt, exitWaveEnd: d.burstExitWaveEndDt,
    exitWaveBuyBnb: d.burstExitWaveBuyBnb, exitWaveWallets: d.burstExitWaveWallets, secSinceWaveEnd: d.burstSecSinceWaveEnd,
    waveNetBnb: d.burstWaveNetBnb, walletNetBnb: d.burstWaveWalletNetBnb, sellBackPct: d.burstWaveSellBackPct,
    avg: d.burstWaveWalletAvgBnb, median: d.burstWaveWalletMedianBnb, exitVs: d.burstExitVsLaunchPct,
    旧全窗键参考: { burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets } }));
  const factLine = state.split('\n').filter((l) => l.includes('停滞突发波事实') || l.includes('burst'));
  console.log('state 事实行:', factLine.join(' || ') || '(无)');
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'tmp-sbw-recheck' });
  const sbwA = res.answers.stall_burst_wave; const actA = res.answers.activity_level;
  console.log('Jev sbw =', JSON.stringify(sbwA), '| act =', actA ? `${actA.bucket} ${actA.prob}` : null);
}
await dbManager.close?.();
