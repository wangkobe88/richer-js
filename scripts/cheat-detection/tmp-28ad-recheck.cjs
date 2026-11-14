// 一次性（182 跑）：28ad v95 锚三连跑——归因 0.49 贴线翻③是 Jev 方差还是 BP65 薄盘臂真改判。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const ADDR = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const logger = { info() {}, warn() {}, error() {} };
async function main() {
  const client = await dbManager.getClient();
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at').eq('experiment_id', V95).eq('signal_type', 'BUY')
    .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(1);
  const anchorMs = Date.parse(sigs[0].created_at);
  const { data: ev } = await client.from('wss_events').select('payload').eq('kind', 'token_create').eq('token_address', ADDR).limit(1);
  const p = (ev && ev[0] && ev[0].payload) || {};
  for (let i = 1; i <= 3; i++) {
    const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
    const r = await bp.gateBuyPoint(ADDR, { address: ADDR, symbol: p.symbol || null, name: p.name || null, platform: p.platform || 'fourmeme' }, { experimentId: '28ad-recheck' }, { anchorMs });
    const d = r.dimensions || {}, a = r.assessment || {}, an = r.anchors || {};
    const pat = d.market_pattern || {}, act = d.activity_level || {};
    console.log(`run${i} ${sigs[0].created_at.slice(11,19)} pattern=${pat.bucket}(${pat.prob}) act=${act.bucket}(${act.prob}) 综=${a.bucket}(${a.rule}) curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
