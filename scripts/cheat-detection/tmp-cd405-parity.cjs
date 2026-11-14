// CD405 对拍（一次性脚本，182 跑；命中票 REPEAT=2 看 run-to-run 方差）
// 新臂：burst_bundled_wave——波窗（最后 ≥50s 静默段出口+60s，D3.67 同源）内
//   单块去尘捆绑钱包 ≥7（burstWaveBundleMaxWallets）∨ 相邻两 slot（block 差恰 1）去尘合计 ≥7
//   （burstWaveBundleAdjPairSum）→ 豁免失效原判保持；去尘=块内单钱包买入合计 ≥0.01 BNB、剔聚合路由
// 阶段 A：四基底 sweep——生产代码 buildSnapshotFromRows 直读新两键（非重实现算法），
//   同时取生产信号 metadata 的 sbw/act/exempt/originalGrade 对照
// 阶段 B：命中票（任一键 ≥7）gateBuyPoint REPEAT=2——期望 denied=burst_bundled_wave
//   + grade 回原判（cheat/unhealthy=拒买）；门外对照（比格多栋锚内 3w/M4GA/TukTuk 6w）不触发新臂
const fs = require('node:fs');
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const MIN_WALLETS = 7;
const REPEAT = 2;
// 命名对照（比格多栋=用户消息原地址；其余按 symbol 模糊匹配 sweep 结果）
const NAMED = [
  { tag: '比格多栋T022(锚内3w<7,后续捆绑锚后=as-of不可见挡不住)', addr: '0x5fdb483505a6654360191afac176e5ac91997777', anchor: '2026-11-02T19:56:05.180Z' },
  { tag: 'M4GA(门外:4w+尘埃钱包)', symRe: /m4ga/i },
  { tag: 'TukTuk(门外:2+4=6)', symRe: /tuktuk|tuk tuk/i },
];
const fmt = (v) => (v === null || v === undefined ? '—' : v);

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();
  const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});

  // ---------- 阶段 A：sweep（生产 snapshot 新两键） ----------
  console.log('===== 阶段 A：四基底 sweep（buildSnapshotFromRows 直读 CD405 两键）=====');
  const points = [];
  for (const name of SETS) {
    const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
    for (const p of set.points) points.push({ set: name.replace('-trades', ''), ...p });
  }
  const expIds = [...new Set(points.map((p) => p.experimentId))];
  const sigIdOfTrade = new Map();
  for (const eid of expIds) {
    let from = 0;
    while (true) {
      const { data, error } = await client.from('trades').select('id,signal_id').eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
      if (error) throw new Error('trades: ' + error.message);
      for (const t of data) sigIdOfTrade.set(String(t.id), t.signal_id);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const sigIds = [...new Set(points.map((p) => p.trade?.buyTradeId).map((id) => id && sigIdOfTrade.get(String(id))).filter(Boolean))];
  const sigs = new Map();
  for (let i = 0; i < sigIds.length; i += 50) {
    const { data, error } = await client.from('strategy_signals').select('id,created_at,metadata').in('id', sigIds.slice(i, i + 50));
    if (error) throw new Error('signals: ' + error.message);
    for (const s of data) sigs.set(s.id, s);
  }
  const rows = [];
  for (const p of points) {
    const buyId = p.trade?.buyTradeId;
    const sigId = buyId ? sigIdOfTrade.get(String(buyId)) : null;
    const sig = sigId ? sigs.get(sigId) : null;
    const cc = sig?.metadata?.cheatCheck;
    if (!cc) continue;
    const anchorMs = Date.parse(sig.created_at);
    const pull = await svc0._pullTicksDb(p.tokenAddress, anchorMs);
    const createMeta = await svc0._loadCreateMeta(p.tokenAddress);
    const meta = svc0._normalizeMeta(p.tokenAddress, { address: p.tokenAddress, platform: 'fourmeme' }, pull, createMeta);
    const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const d = snap.derived;
    rows.push({
      sym: p.tokenSymbol ?? '?', token: p.tokenAddress, anchor: sig.created_at, set: p.set,
      maxW: d.burstWaveBundleMaxWallets, adjPair: d.burstWaveBundleAdjPairSum,
      sbw: cc.levels?.stallBurstWave ?? null, act: cc.levels?.activityLevel ?? null,
      exempt: cc.exempt?.code ?? null, orig: cc.exempt?.originalGrade ?? cc.grade ?? null,
      prodGrade: cc.grade ?? null, pnl: p.trade?.episode?.pnlBnb ?? null,
    });
  }
  const uniq = new Map();
  for (const r of rows) {
    const k = r.maxW ?? -1, adj = r.adjPair ?? -1;
    const score = Math.max(k, adj);
    if (!uniq.has(r.token) || score > Math.max(uniq.get(r.token).maxW ?? -1, uniq.get(r.token).adjPair ?? -1)) uniq.set(r.token, r);
  }
  const U = [...uniq.values()].sort((a, b) => Math.max(b.maxW ?? -1, b.adjPair ?? -1) - Math.max(a.maxW ?? -1, a.adjPair ?? -1));
  console.log(`有 cheat 段点位 ${rows.length} / 唯一票 ${U.length}；两键 Top12（maxW/adjPair/sbw/act/生产exempt/生产orig/pnl）：`);
  for (const r of U.slice(0, 12))
    console.log(`  ${r.sym} ${r.token}\n    maxW=${fmt(r.maxW)} adjPair=${fmt(r.adjPair)} sbw=${fmt(r.sbw)} act=${fmt(r.act)} exempt=${fmt(r.exempt)} orig=${fmt(r.orig)} prodGrade=${fmt(r.prodGrade)} pnl=${fmt(r.pnl)} [${r.set}] ${r.anchor}`);
  const hits = U.filter((r) => (r.maxW ?? -1) >= MIN_WALLETS || (r.adjPair ?? -1) >= MIN_WALLETS);
  console.log(`\n命中面（任一键 ≥${MIN_WALLETS}）：${hits.length} 票 / pnlΣ ${+hits.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4)}`);
  for (const r of hits) console.log(`  HIT ${r.sym} ${r.token} maxW=${fmt(r.maxW)} adjPair=${fmt(r.adjPair)} act=${fmt(r.act)} exempt=${fmt(r.exempt)} orig=${fmt(r.orig)} pnl=${fmt(r.pnl)}`);

  // ---------- 阶段 B：门链 ----------
  console.log('\n===== 阶段 B：gateBuyPoint（activityExemptLevels=high,ultra 生产缺省）=====');
  const gateList = [...hits.map((r) => ({ ...r, tag: 'HIT' }))];
  for (const n of NAMED) {
    if (n.addr) { gateList.push({ sym: n.tag, token: n.addr, anchor: n.anchor, tag: '对照' }); continue; }
    const m = U.find((r) => n.symRe.test(String(r.sym)));
    if (m) gateList.push({ ...m, tag: '对照' });
    else console.log(`（对照票未找到：${n.tag}）`);
  }
  for (const t of gateList) {
    const { data: d } = await client.from('wss_events').select('token_address,payload,block_time,platform')
      .eq('kind', 'token_create').eq('token_address', t.token).limit(5);
    const c0 = (d && d[0]) || {};
    const p0 = c0.payload || {};
    const metaFor = (addr) => ({ address: addr, symbol: p0.symbol || t.sym || null, name: p0.name || null,
      platform: c0.platform || 'fourmeme', createdAtMs: c0.block_time ? Date.parse(c0.block_time) : null });
    const anchorMs = Date.parse(t.anchor);
    console.log(`\n--- ${t.tag} ${t.sym} ${t.token} anchor=${t.anchor}${t === gateList[0] ? '' : ''}`);
    for (let i = 1; i <= REPEAT; i++) {
      const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
        settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
      let line = '';
      try {
        const res = await svc.gateBuyPoint(t.token, metaFor(t.token), { experimentId: 'cd405-parity' }, { awaitMs: 120000, anchorMs });
        const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
        const act = res && res.buckets ? res.buckets.activityLevel : '?';
        const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
        const reasons = res && res.reasons ? res.reasons.map((r) => r.code || r).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
        const ex = res && res.exempt ? res.exempt.code : null;
        const dn = res && res.exemptDenied ? res.exemptDenied : null;
        const blocked = svc.isGateBlocked(t.token);
        line = `grade=${grade} act=${act} sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)}` +
          (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '') + ` blocked=${blocked} stats.burstBundleDenied=${svc.stats.burstBundleDenied}`;
      } catch (e) {
        line = `门异常: ${e.message}`;
      }
      console.log(`  [run ${i}] ${line}`);
    }
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
