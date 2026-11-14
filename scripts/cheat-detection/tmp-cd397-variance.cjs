// 一次性（182 跑）：CD397 对拍补方差——idx72 持械入宋（仍 burst 豁免）×3、ba5e 07:52 锚 ×2
// CD319/CD387 同族 run-to-run 方差先例：同版题集多次重判读分布
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');

const logger = { info() {}, warn() {}, error() {} };
const RUNS = [
  { name: 'idx72-持械入宋', addr: '0xea3ce510829b2b3c77dae374aad440e23be94444', anchorIso: '2026-11-05T07:41:31+00:00', n: 3 },
  { name: 'ba5e-0752锚', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', anchorIso: '2026-11-05T07:52:17+00:00', n: 2 },
];

(async () => {
  const client = await dbManager.getClient();
  const addrs = [...new Set(RUNS.map((r) => r.addr))];
  const { data: creates, error } = await client.from('wss_events')
    .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', addrs);
  if (error) throw new Error(error.message);
  const metaFor = (addr) => {
    const c = (creates || []).find((r) => r.token_address === addr); const p = (c && c.payload) || {};
    return { address: addr, symbol: p.symbol || null, name: p.name || null, platform: p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
  };
  for (const r of RUNS) {
    for (let i = 1; i <= r.n; i++) {
      const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
        settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
      try {
        const res = await svc.gateBuyPoint(r.addr, metaFor(r.addr), { experimentId: 'cd397-variance' }, { awaitMs: 120000, anchorMs: Date.parse(r.anchorIso) });
        const sbw = res && res.levels ? res.levels.stallBurstWave : undefined;
        console.log(`[${r.name} #${i}] sbw=${sbw === 1 ? 'burst' : sbw === 0 ? 'none' : sbw} grade=${res && res.grade ? res.grade : (res && res.status) || '?'} act=${res && res.buckets ? res.buckets.activityLevel : '?'}` +
          (res && res.exempt ? ` exempt=${res.exempt.code}` : '') + (res && res.exemptDenied ? ` denied=${res.exemptDenied}` : ''));
      } catch (e) {
        console.log(`[${r.name} #${i}] 异常 ${e.message}`);
      }
    }
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
