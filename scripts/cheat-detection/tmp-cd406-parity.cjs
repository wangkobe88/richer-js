// CD406 对拍（一次性脚本，182 跑）：BURST_STALL_GAP_SEC 50→30 段定位器放宽
// 期望面：
//  ①梗 0x89e4 信号3（46s 沉积+2.21B/14 户第二波）：旧 sbw=none→E_low 拒；新 30s 成段→sbw=burst
//    （CD402 质量线双过）→E 通道不触发→grade 放行（或 unhealthy→burst 资格臂豁免）
//  ②CD405 命中 4 票（Callcat13w/Crypto Winter/网上南宁/callcat小）：段重锚后两键仍 ≥7 → denied 保持
//  ③CD401 靶面（魔渊/MBF/谷歌SI 等 sweep 命中面）：出口段三键命中保持（gap ≥50s 段定位不变）
//  ④对照（比格多栋/M4GA/TukTuk/SPP）：零翻动（照豁免/照放行）
// 阶段 A（零 Jev）：梗票 3 锚直读段键 + 四基底 sweep 直读 CD405 两键/CD401 三键/D3.67 段键
// 阶段 B（Jev 门链）：梗 3 锚 REPEAT=3 / CD405 命中 4 票 REPEAT=2 / 对照 2 票 REPEAT=1
// 用法：node tmp-cd406-parity.cjs [--stage a|b]（缺省 a）
const fs = require('node:fs');
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const GENG = { sym: '梗', addr: '0x89e42b0bfe286b8f7f93c4c7e2bc65e6f8af7777', expId: '5390bbfa-0c86-48a2-b9e1-94537c54ac17' };
const CD405_HITS = [
  { sym: 'Callcat13w', addr: '0x77a835b48b9ac8111036c958e737a015f2297777' },
  { sym: 'CryptoWinter', addr: '0xa3efddca9d8a138ace3548b8f70118a1c4767777' },
  { sym: '网上南宁', addr: '0x5026a06af5a92525474538fade0da3106f1b7777' },
  { sym: 'callcat小', addr: '0x7c373f45590db865e121eb73a26cd3d0c3b27777' },
];
const CD401_TARGETS = [
  { sym: '魔渊', addr: '0x9295363666be41791f9ac20ad5cba59a69e07777' },
  { sym: 'MBF', addr: '0xa29fefb9922a761093a316e9f658c0f0ebc07777' },
  { sym: '谷歌SI', addr: '0xb714df9fec771df721e0576706a11246973d7777' },
];
const CTRL = [
  { sym: '比格多栋(锚内3w)', addr: '0x5fdb483505a6654360191afac176e5ac91997777', anchor: '2026-11-02T19:56:05.180Z' },
  { sym: 'M4GA(4w+尘埃)', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444' },
  { sym: 'TukTuk(2+4=6)', addr: '0x2711e159f3e9ff438ff2bb80456d19a6bd827777' },
  { sym: 'SPP(sbw=0不拦)', addr: '0xb20a8aab74e0064287f097f51345f0f093ee7777' },
];
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const STAGE = process.argv.includes('--stage') ? process.argv[process.argv.indexOf('--stage') + 1] : 'a';
const fmt = (v) => (v === null || v === undefined ? '—' : v);
const r4 = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(4));

// 段键摘要（新 30s 阈值直读）：段时长/出口波/CD405 两键/CD401 三键/exitVs
function segDigest(d) {
  return {
    gapSec: d.burstLastGapSec, segBuy: d.burstExitSegBuyBnb, segSell: d.burstExitSegSellBnb, segPct: d.burstExitSegSellPct,
    waveBuy: d.burstExitWaveBuyBnb, waveWallets: d.burstExitWaveWallets, secSinceEnd: d.burstSecSinceWaveEnd,
    bundleMax: d.burstWaveBundleMaxWallets, bundleAdj: d.burstWaveBundleAdjPairSum, exitVs: d.burstExitVsLaunchPct,
  };
}
function printDigest(tag, dg) {
  console.log(`  ${tag}: 段时长=${fmt(dg.gapSec)}s 出口波买=${fmt(dg.waveBuy)}(${fmt(dg.waveWallets)}户) 距波末=${fmt(dg.secSinceEnd)}s` +
    ` bundle=${fmt(dg.bundleMax)}/${fmt(dg.bundleAdj)} 出口段卖=${fmt(dg.segSell)}/${fmt(dg.segPct)}% exitVs=${fmt(dg.exitVs)}`);
}

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();
  const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});

  // 梗票 3 信号锚（DB 直查）
  const { data: gSigs, error: gErr } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', GENG.expId).eq('token_address', GENG.addr)
    .order('created_at', { ascending: true }).limit(20);
  if (gErr) throw new Error('梗 signals: ' + gErr.message);
  console.log(`梗票 ${GENG.addr} 信号 ${gSigs.length} 行`);

  if (STAGE === 'a') {
    // ---------- A1：梗票 3 锚直读 ----------
    console.log('\n===== A1 梗票信号锚直读（新 30s 段定位）=====');
    for (const s of gSigs) {
      const cc = s.metadata?.cheatCheck;
      const anchorMs = Date.parse(s.created_at);
      const pull = await svc0._pullTicksDb(GENG.addr, anchorMs);
      const createMeta = await svc0._loadCreateMeta(GENG.addr);
      const meta = svc0._normalizeMeta(GENG.addr, { address: GENG.addr, platform: 'fourmeme' }, pull, createMeta);
      const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const dg = segDigest(snap.derived);
      console.log(`--- ${s.created_at} 生产grade=${fmt(cc?.grade)} act=${fmt(cc?.levels?.activityLevel)} sbw=${fmt(cc?.levels?.stallBurstWave)} exempt=${fmt(cc?.exempt?.code)} denied=${fmt(cc?.exemptDenied)} rows=${pull.rows.length}`);
      printDigest('  新读', dg);
    }

    // ---------- A2：四基底 sweep（缓存优先，零 Jev）----------
    console.log('\n===== A2 四基底 sweep（CD405 两键 / CD401 三键 / 段键）=====');
    const points = [];
    for (const name of SETS) {
      try {
        const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
        for (const p of set.points) points.push({ set: name.replace('-trades', ''), ...p });
      } catch (e) { console.log(`  set ${name} 读取失败: ${e.message}`); }
    }
    console.log(`点位 ${points.length}`);
    const byAddr = new Map(); // addr -> best（命中面取最强）
    const newSeg = []; // 段时长 ∈[30,50) = CD406 新解锁段
    let n = 0;
    for (const p of points) {
      const base = `scripts/buy-point/sets/${p.set}-trades`;
      let rows, anchorIso;
      try {
        const f = JSON.parse(fs.readFileSync(`${base}-ticks/${p.tokenAddress}.json`, 'utf8'));
        rows = f.rows;
        anchorIso = p.anchorTimeIso || rows[rows.length - 1].block_time;
      } catch {
        // 缓存 miss → 跳过（sweep 用缓存就够：四基底 ticks 在 182 齐）
        continue;
      }
      const aTs = Date.parse(anchorIso);
      const pre = rows.filter((r) => Date.parse(r.block_time) <= aTs);
      if (pre.length < 7) continue;
      n++;
      const meta = { address: p.tokenAddress, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
      const d = buildSnapshotFromRows(pre, meta).derived;
      const rec = {
        set: p.set, sym: p.tokenSymbol ?? '?', addr: p.tokenAddress, anchor: anchorIso,
        dg: segDigest(d), pnl: p.trade?.episode?.pnlBnb ?? null,
      };
      const score = Math.max(rec.dg.bundleMax ?? -1, rec.dg.bundleAdj ?? -1, rec.dg.segPct ?? -1);
      if (!byAddr.has(rec.addr) || score > Math.max(byAddr.get(rec.addr).dg.bundleMax ?? -1, byAddr.get(rec.addr).dg.bundleAdj ?? -1, byAddr.get(rec.addr).dg.segPct ?? -1)) byAddr.set(rec.addr, rec);
      if (rec.dg.gapSec !== null && rec.dg.gapSec !== undefined && rec.dg.gapSec < 50) newSeg.push(rec);
    }
    console.log(`有效点位 ${n} / 唯一票 ${byAddr.size}`);
    const U = [...byAddr.values()];

    // CD405 命中 4 票
    console.log(`\n--- CD405 命中 4 票（期望两键仍 ≥7 → denied 保持）：`);
    for (const t of CD405_HITS) {
      const r = U.find((x) => x.addr === t.addr);
      if (!r) { console.log(`  ${t.sym} ${t.addr} 不在 sweep（无缓存/无点位）→ 阶段 B 直查锚`); continue; }
      printDigest(`${t.sym} pnl=${fmt(r.pnl)} [${r.set}]`, r.dg);
    }
    // CD401 靶面
    console.log(`\n--- CD401 靶面（期望出口段卖%≥30 ∧ 卖≥0.3 命中保持 / sbw=0 对照照放）：`);
    for (const t of CD401_TARGETS) {
      const rs = U.filter((x) => x.addr === t.addr);
      if (!rs.length) { console.log(`  ${t.sym} ${t.addr} 不在 sweep → 阶段 B 直查锚`); continue; }
      for (const r of rs) printDigest(`${t.sym} pnl=${fmt(r.pnl)} [${r.set}]`, r.dg);
    }
    // 对照组
    console.log(`\n--- 对照组（期望零翻动）：`);
    for (const t of CTRL) {
      const rs = U.filter((x) => x.addr === t.addr);
      if (!rs.length) { console.log(`  ${t.sym} ${t.addr} 不在 sweep`); continue; }
      for (const r of rs) printDigest(`${t.sym} pnl=${fmt(r.pnl)} [${r.set}]`, r.dg);
    }
    // 新成段面（30~49s）
    console.log(`\n--- CD406 新成段面（段时长 ∈[30,50) = 旧 50s 线下不成段、现在有段）${newSeg.length} 点：`);
    for (const r of newSeg.slice(0, 20))
      printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
    // 全量 CD405/CD401 命中面
    const b45 = U.filter((x) => (x.dg.bundleMax ?? -1) >= 7 || (x.dg.bundleAdj ?? -1) >= 7);
    const b41 = U.filter((x) => (x.dg.segPct ?? -1) >= 30 && (x.dg.segSell ?? -1) >= 0.3);
    console.log(`\nCD405 命中面（≥7）：${b45.length} 票 Σpnl=${r4(b45.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of b45) printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
    console.log(`CD401 命中面（≥30%∧≥0.3）：${b41.length} 票 Σpnl=${r4(b41.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of b41) printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
  }

  if (STAGE === 'b') {
    // ---------- B：门链（Jev 真调）----------
    console.log('===== B gateBuyPoint 门链（activityExemptLevels=high,ultra 生产缺省）=====');
    const metaOf = async (addr, sym) => {
      const { data } = await client.from('wss_events').select('token_address,payload,block_time,platform')
        .eq('kind', 'token_create').eq('token_address', addr).limit(5);
      const c0 = (data && data[0]) || {}; const p0 = c0.payload || {};
      return () => ({ address: addr, symbol: p0.symbol || sym || null, name: p0.name || null,
        platform: c0.platform || 'fourmeme', createdAtMs: c0.block_time ? Date.parse(c0.block_time) : null });
    };
    const runGate = async (tag, addr, anchorIso, metaFor, repeat) => {
      console.log(`\n--- ${tag} ${addr} anchor=${anchorIso}`);
      for (let i = 1; i <= repeat; i++) {
        const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 180000, activityExemptLevels: ['high', 'ultra'] },
          settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
        let line = '';
        try {
          const res = await svc.gateBuyPoint(addr, metaFor(), { experimentId: 'cd406-parity' }, { awaitMs: 180000, anchorMs: Date.parse(anchorIso) });
          const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
          const act = res && res.buckets ? res.buckets.activityLevel : '?';
          const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
          const reasons = res && res.reasons ? res.reasons.map((x) => x.code || x).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
          const ex = res && res.exempt ? res.exempt.code : null;
          const dn = res && res.exemptDenied ? res.exemptDenied : null;
          line = `grade=${grade} act=${act} sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)}` +
            (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '') +
            ` blocked=${svc.isGateBlocked(addr)}` +
            ` stats(bb/se/sp/dr)=${svc.stats.burstBundleDenied}/${svc.stats.burstSellDenied}/${svc.stats.stallBurstExemptions}/${svc.stats.dumpRatioDenied}`;
        } catch (e) { line = `门异常: ${e.message}`; }
        console.log(`  [run ${i}] ${line}`);
      }
    };
    // B1 梗票 3 锚 REPEAT=3
    const gMeta = await metaOf(GENG.addr, GENG.sym);
    for (const s of gSigs) await runGate(`梗信号`, GENG.addr, s.created_at, gMeta, 3);
    // B2 CD405 命中 4 票（锚=sweep 最强点位；miss 则信号页首信号）
    for (const t of CD405_HITS) {
      let anchor = null;
      const { data: ss } = await client.from('strategy_signals').select('id,created_at,metadata')
        .eq('token_address', t.addr).not('metadata->cheatCheck', 'is', null).order('created_at', { ascending: true }).limit(10);
      if (ss && ss.length) anchor = ss[0].created_at;
      if (!anchor) { console.log(`\n--- ${t.sym} 无信号锚可查，跳过（阶段 A 已直读两键）`); continue; }
      const m = await metaOf(t.addr, t.sym);
      await runGate(`CD405保持:${t.sym}`, t.addr, anchor, m, 2);
    }
    // B2.5 米（CD406 新成段带出的 CD405 新命中 7w、btv103-r2 正票 +0.0548）——
    // 验证原判路径：healthy 原判=denied 无挂点照放；unhealthy+豁免=denied 拦=CD406 代价
    {
      const t = { sym: '米(新命中7w,正票)', addr: '0x6848b3a5fe21ca77e330c105cd6dcc35a9274444' };
      const m = await metaOf(t.addr, t.sym);
      await runGate(`CD406新命中:${t.sym}`, t.addr, '2026-11-05T09:26:03.139Z', m, 2);
    }
    // B3 对照（比格多栋自带锚；M4GA 查首信号锚）
    const bMeta = await metaOf(CTRL[0].addr, CTRL[0].sym);
    await runGate(`对照:${CTRL[0].sym}`, CTRL[0].addr, CTRL[0].anchor, bMeta, 1);
    for (const t of [CTRL[1]]) {
      const { data: ss } = await client.from('strategy_signals').select('id,created_at,metadata')
        .eq('token_address', t.addr).not('metadata->cheatCheck', 'is', null).order('created_at', { ascending: true }).limit(10);
      if (!ss || !ss.length) { console.log(`\n--- 对照:${t.sym} 无信号锚，跳过`); continue; }
      const m = await metaOf(t.addr, t.sym);
      await runGate(`对照:${t.sym}`, t.addr, ss[0].created_at, m, 1);
    }
  }

  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
