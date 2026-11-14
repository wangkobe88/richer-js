// CD398 二修对拍（一次性脚本，182 跑；主判量=burstWaveNetBnb 波窗自身净流 Σ买−Σ卖）
// 期望：
//  - 谷歌SI：波内卖家巨鲸（0.429+0.590 拆 block 卖）→ winNet<0 → 流向腿拒（豁免不成立原判保持）
//  - TukTuk / M4GA / 海水#78 / memes#85（盈利豁免带）：winNet≥0 豁免照旧成立
//  - 小四#82：CD397 结构效应 sbw=none → 无豁免资格 → cheat 保持拒（与流向腿无关，留档）
// 真调 Jev（fresh service per token, persist:false），锚=成交时刻（trades 源点位锚）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const TICKETS = [
  { key: 'SI-google', name: '谷歌SI#51', addr: '0xb714df9fec771df721e0576706a11246973d7777', anchor: '2026-11-05T05:16:23.994Z', expect: '流向腿拒（豁免不成立原判保持）' },
  { key: 'TukTuk', name: 'TukTuk#54', addr: '0x2711e159f3e9ff438ff2bb80456d19a6bd827777', anchor: '2026-11-05T09:00:47.361Z', expect: '豁免照旧（winNet 波内全买 +0.455）' },
  { key: 'M4GA', name: 'M4GA#84', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', anchor: '2026-11-05T07:40:45.025Z', expect: '豁免照旧（CD383 立法票，winNet≥0）' },
  { key: 'XiaoSi', name: '小四#82', addr: '0xf0576fc1267506123b0bb843b2a325e9010b4444', anchor: '2026-11-05T07:47:55.852Z', expect: 'CD397 效应 sbw=none → cheat 保持拒（与流向腿无关）' },
  { key: 'HaiShui78', name: '海水#78', addr: '0x30238ffd6137cd0fa70e681d0d5585d413cbffff', anchor: '2026-11-05T09:51:17.436Z', expect: '豁免照旧（78min 慢热 restart）' },
  { key: 'memes85', name: 'memes#85', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', anchor: '2026-11-05T07:15:57.727Z', expect: '豁免照旧（restart 立法票）' },
];

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();

  // token_create meta（platform/launch 常量源）
  const addrs = [...new Set(TICKETS.map((t) => t.addr))];
  const creates = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const { data: d, error } = await client.from('wss_events')
      .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 100));
    if (error) throw new Error(error.message);
    if (d) creates.push(...d);
  }
  const createByToken = new Map(creates.map((r) => [r.token_address, r]));
  const metaFor = (addr) => {
    const c = createByToken.get(addr); const p = (c && c.payload) || {};
    return { address: addr, symbol: p.symbol || null, name: p.name || null, platform: p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
  };

  const fmt = (v) => (v === null || v === undefined ? '—' : v);
  console.log(`共 ${TICKETS.length} 票`);
  for (const t of TICKETS) {
    const anchorMs = Date.parse(t.anchor);
    const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
      settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
    let line = '';
    try {
      const res = await svc.gateBuyPoint(t.addr, metaFor(t.addr), { experimentId: 'cd398-parity' }, { awaitMs: 120000, anchorMs });
      const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
      const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
      const act = res && res.buckets ? res.buckets.activityLevel : '?';
      const ex = res && res.exempt ? res.exempt.code : null;
      const dn = res && res.exemptDenied ? res.exemptDenied : null;
      line = `sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)} grade=${grade} act=${act}` +
        (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '');
    } catch (e) {
      line = `门异常: ${e.message}`;
    }
    // 同锚复算 digest（读 D3.67 波族键，零 Jev）
    let dline = '';
    try {
      const svc2 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
      const pull = await svc2._pullTicksDb(t.addr, anchorMs);
      const createMeta = await svc2._loadCreateMeta(t.addr);
      const meta = svc2._normalizeMeta(t.addr, metaFor(t.addr), pull, createMeta);
      const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const d = snap.derived;
      dline = `ticks=${pull.anchorTickCount} winNet:${fmt(d.burstWaveNetBnb)} netBnb:${fmt(d.burstWaveWalletNetBnb)} sbwGap:${fmt(d.burstLastGapSec)} wEndAgo:${fmt(d.burstSecSinceWaveEnd)} exitVs:${fmt(d.burstExitVsLaunchPct)} sellBack:${fmt(d.burstWaveSellBackPct)}`;
    } catch (e) {
      dline = `digest 复算异常: ${e.message}`;
    }
    console.log(`[${t.key}] ${t.name} ${t.addr.slice(0, 10)}… ${t.anchor}`);
    console.log(`  期望: ${t.expect}`);
    console.log(`  门: ${line}`);
    console.log(`  digest: ${dline}`);
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
