// CD404 对拍（一次性脚本，182 跑；REPEAT=3 看 run-to-run 方差）
// 目标票：btv111 分批复审第 6 案 Q币安 0x9b1f…7777
// 期望（D3.70 密集臂两腿成色反锚）：activity_level 三跑稳定 low（旧 D3.69 读 high——吞吐 2.38/min 由
//   卖 1.06 vs 买 0.13=8:1 拉起+尾 5s 唯一「非尘埃买」是同块套利往返单 0.0867）；sbw=none 保持
//   （CD402 量级线波买 0.1264<0.3 正确排除）；grade=unhealthy[E_low_activity]（act=low ∧ sbw≠burst）
// 锚=信号 3a0082b3 created_at（生产口径 block_time<=created_at 宁多勿少）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const TICKET = { key: 'QbiAn', name: 'Q币安#btv111-6', addr: '0x9b1fb6a662e2b1e5a521ea1dd5147f13184b7777', anchor: '2026-11-02T17:18:13+00:00' };
const REPEAT = 3;

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();

  const { data: d, error } = await client.from('wss_events')
    .select('token_address,payload,block_time,platform').eq('kind', 'token_create').eq('token_address', TICKET.addr).limit(5);
  if (error) throw new Error(error.message);
  const c0 = (d && d[0]) || {};
  const p = c0.payload || {};
  const metaFor = (addr) => ({ address: addr, symbol: p.symbol || null, name: p.name || null,
    platform: c0.platform || 'fourmeme', createdAtMs: c0.block_time ? Date.parse(c0.block_time) : null });

  const fmt = (v) => (v === null || v === undefined ? '—' : v);
  const anchorMs = Date.parse(TICKET.anchor);

  // 同锚 digest 复算（临近段吞吐/买卖额——反锚两腿的原料，零 Jev）
  {
    const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
    const pull = await svc0._pullTicksDb(TICKET.addr, anchorMs);
    const createMeta = await svc0._loadCreateMeta(TICKET.addr);
    const meta = svc0._normalizeMeta(TICKET.addr, metaFor(TICKET.addr), pull, createMeta);
    const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const s = snap.derived;
    console.log(`digest: ticks=${pull.anchorTickCount} 波买:${fmt(s.burstExitWaveBuyBnb)} 波净:${fmt(s.burstWaveNetBnb)} exitVs:${fmt(s.burstExitVsLaunchPct)}`);
    console.log(`  临近段吞吐:${fmt(s.nearSegBnbPerMin)} 末10s:${fmt(s.nearTail10BnbPerMin)} 前20s:${fmt(s.nearPre20BnbPerMin)} 买中位:${fmt(s.nearSegBuyMedianBnb)} 尾5s 买N:${fmt(s.nearTail5BuyN)} 买额:${fmt(s.nearTail5BuyBnb)}`);
    // 反锚两腿原料：临近 30s 段买/卖额（直接沿锚窗行算，卖:买 ≥3 倍量级=吞吐由出货拉起）
    const rows = pull.rows || [];
    const tEnd = rows.length ? Date.parse(rows[rows.length - 1].block_time) : anchorMs;
    let nb = 0, ns = 0;
    for (const r of rows) {
      if (tEnd - Date.parse(r.block_time) > 30000) continue;
      if (r.trade_type === 'buy') nb += r.bnb_amount; else if (r.trade_type === 'sell') ns += r.bnb_amount;
    }
    console.log(`  临近30s 买:${nb.toFixed(4)} 卖:${ns.toFixed(4)} 卖买比:${(ns / Math.max(nb, 1e-9)).toFixed(1)}:1`);
  }

  for (let i = 1; i <= REPEAT; i++) {
    const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
      settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
    let line = '';
    try {
      const res = await svc.gateBuyPoint(TICKET.addr, metaFor(TICKET.addr), { experimentId: 'cd404-parity' }, { awaitMs: 120000, anchorMs });
      const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
      const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
      const act = res && res.buckets ? res.buckets.activityLevel : '?';
      const reasons = res && res.reasons ? res.reasons.map((r) => r.code || r).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
      const ex = res && res.exempt ? res.exempt.code : null;
      const dn = res && res.exemptDenied ? res.exemptDenied : null;
      line = `sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)} grade=${grade} act=${act}` +
        (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '');
    } catch (e) {
      line = `门异常: ${e.message}`;
    }
    console.log(`[run ${i}] ${line}`);
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
