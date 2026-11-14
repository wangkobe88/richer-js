// 一次性重演（182 跑）：M4GA 0xba5ed45b 07:40:47 cheat 门首判——bt-v88 判 cheat（sbw=none）
// 而 11-08 CD383 二修对拍同锚 healthy+exempt stall_burst。归因假设：CD386（almost 上界
// 20→10）扩大 reset 触发面→豁免证据窗被重置→sbw 判 none→burst 豁免臂失效→A_strong 裸判。
// 打印：grade/reasons/sbw/activityLevel/burst 三键/marketReset/resetAnchorTickCount。
const { dbManager } = require('../src/services/dbManager.js');
const { CheatCheckService } = require('../src/market-analysis/CheatCheckService');

const TOKEN = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const logger = {
  info(t, tag, msg) { if (String(msg).includes('盘面观测') || String(msg).includes('盘面重置')) console.log('LOG:', msg); },
  warn() {}, error() {},
};

async function main() {
  const client = await dbManager.getClient();
  const { data: creates, error: e2 } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', TOKEN);
  if (e2) throw e2;
  const p = (creates[0] && creates[0].payload) || {};
  // ★根因键：引擎传 createdAtMs（token.createdAt×1000）→ service L1064 转 createdAt
  //   → snapshot dt 基='created'。此前直调两键都没传 → dt 基退化 first_tick=reset 窗首，
  //   全部 dt 偏移 −23s → state 渲染不同（tokens 39530 vs 39754）→ 判读分裂。
  //   blockTimeMs=创建块毫秒（与回测 token.createdAt 同源：wss_events 回放）。
  const meta = {
    address: TOKEN, symbol: p.symbol || 'M4GA', name: p.name || null,
    platform: p.platform || 'fourmeme',
    creatorAddress: p.creator || null,
    totalSupply: p.totalSupply ?? null,
    createdAtMs: Number.isFinite(p.blockTimeMs) ? p.blockTimeMs : Date.parse(creates[0].block_time),
  };

  const svc = new CheatCheckService({
    enabled: true,
    gate: { awaitMs: 120000, enabled: true },
    settleDelayMs: 0,
    persist: false,
  }, logger, {});
  const anchorMs = Date.parse('2026-11-05T07:40:47Z');
  const res = await svc.gateBuyPoint(TOKEN, meta, { experimentId: 'm4ga-why' },
    { awaitMs: 120000, forceRecheck: true, anchorMs });
  console.log('status=', res.status, 'grade=', res.grade, 'exempt=', JSON.stringify(res.exempt));
  console.log('reasons=', JSON.stringify(res.reasons));
  const L = res.levels || {}; const A = res.anchors || {};
  console.log('sbw=', L.stallBurstWave, 'act=', L.activityLevel, 'slowGrindPump=', L.slowGrindPump);
  console.log('burst 三键: gap=', A.burstMaxGapSec, 'waveBuyBnb=', A.burstWaveBuyBnb, 'waveWallets=', A.burstWaveWallets);
  console.log('marketReset=', res.marketReset, 'anchorTickCount=', res.anchorTickCount, 'resetAnchorTickCount=', res.resetAnchorTickCount, 'fullAnchorTickCount=', res.fullAnchorTickCount);
  console.log('resetInfo=', JSON.stringify(res.resetInfo || null));
  console.log('status 若非 graded/analyzed 全打印:', JSON.stringify(res).slice(0, 600));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
