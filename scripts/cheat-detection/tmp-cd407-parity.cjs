// CD407 对拍（一次性脚本，182 跑）：burst 卖压审查对象收紧为「这一波突然的流量」
// burstWaveSeg 三键（簇=出口行起连续 gap<5s）替换 burstExitSeg 三键（出口→锚整窗）作 CD401 臂判据源
// 期望面：
//  ①主案 Cashless 0xbcb72829（bt-v113 38d91153）：trig1 生产被 CD401 denied（旧键 30.3%/0.4082 贴线）→
//    新键簇=波 4 买 0.7412→gap 9s 切断→簇卖 0 → denied 解除 → cheat∧act=high → CD391 豁免 healthy 放行
//  ②CD401 立法五票（魔渊/callcat小/MBF×2/谷歌SI）：簇内卖压仍 ≥30%∧≥0.3 → denied 保持拒买；
//    簇外（卖出隔 ≥5s）→ 知情放行报 pnl 数字
//  ③CD405 命中 4 票：bundle 两键不受 CD407 影响 → 保持
//  ④四基底 sweep：新旧命中面全表（旧命中被放行/新命中新增）
// 阶段 A（零 Jev）锚直读+sweep；阶段 B（Jev 门链）Cashless REPEAT=3 + 立法票 REPEAT=2
// 用法：node tmp-cd407-parity.cjs [--stage a|b]（缺省 a）
const fs = require('node:fs');
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const CASHLESS = { sym: 'Cashless', addr: '0xbcb728291999b8fc26629530ea97d5a218df7777', expId: '38d91153-7758-469e-a376-e748c3b3d63a' };
const CD401_TARGETS = [
  { sym: '魔渊', addr: '0x9295363666be41791f9ac20ad5cba59a69e07777' },
  { sym: 'MBF', addr: '0xa29fefb9922a761093a316e9f658c0f0ebc07777' },
  { sym: '谷歌SI', addr: '0xb714df9fec771df721e0576706a11246973d7777' },
  { sym: 'callcat小', addr: '0x7c373f45590db865e121eb73a26cd3d0c3b27777' },
];
const CD405_HITS = [
  { sym: 'Callcat13w', addr: '0x77a835b48b9ac8111036c958e737a015f2297777' },
  { sym: 'CryptoWinter', addr: '0xa3efddca9d8a138ace3548b8f70118a1c4767777' },
  { sym: '网上南宁', addr: '0x5026a06af5a92525474538fade0da3106f1b7777' },
];
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const STAGE = process.argv.includes('--stage') ? process.argv[process.argv.indexOf('--stage') + 1] : 'a';
const fmt = (v) => (v === null || v === undefined ? '—' : v);
const r4 = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(4));

// 新旧键对照摘要
function segDigest(d) {
  return {
    gapSec: d.burstLastGapSec,
    oldBuy: d.burstExitSegBuyBnb, oldSell: d.burstExitSegSellBnb, oldPct: d.burstExitSegSellPct,
    newBuy: d.burstWaveSegBuyBnb, newSell: d.burstWaveSegSellBnb, newPct: d.burstWaveSegSellPct,
    bundleMax: d.burstWaveBundleMaxWallets, bundleAdj: d.burstWaveBundleAdjPairSum,
  };
}
const oldHit = (dg) => (dg.oldPct ?? -1) >= 30 && (dg.oldSell ?? -1) >= 0.3;
const newHit = (dg) => (dg.newPct ?? -1) >= 30 && (dg.newSell ?? -1) >= 0.3;
function printDigest(tag, dg) {
  console.log(`  ${tag}: 段=${fmt(dg.gapSec)}s 旧=${fmt(dg.oldBuy)}/${fmt(dg.oldSell)}/${fmt(dg.oldPct)}%${oldHit(dg) ? '★' : ''}` +
    ` 新簇=${fmt(dg.newBuy)}/${fmt(dg.newSell)}/${fmt(dg.newPct)}%${newHit(dg) ? '★' : ''} bundle=${fmt(dg.bundleMax)}/${fmt(dg.bundleAdj)}`);
}

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();
  const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});

  const { data: cSigs, error: cErr } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', CASHLESS.expId).eq('token_address', CASHLESS.addr)
    .order('created_at', { ascending: true }).limit(20);
  if (cErr) throw new Error('Cashless signals: ' + cErr.message);
  console.log(`Cashless ${CASHLESS.addr} 信号 ${cSigs.length} 行（bt-v113）`);

  if (STAGE === 'a') {
    // ---------- A1：Cashless 信号锚直读 ----------
    console.log('\n===== A1 Cashless 信号锚直读（簇=出口行起连续 gap<5s）=====');
    for (const s of cSigs) {
      const cc = s.metadata?.cheatCheck;
      const ci = cc?.info || cc || {};
      const anchorMs = Date.parse(s.created_at);
      const pull = await svc0._pullTicksDb(CASHLESS.addr, anchorMs);
      const createMeta = await svc0._loadCreateMeta(CASHLESS.addr);
      const meta = svc0._normalizeMeta(CASHLESS.addr, { address: CASHLESS.addr, platform: 'fourmeme' }, pull, createMeta);
      const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const dg = segDigest(snap.derived);
      console.log(`--- ${s.created_at} 生产grade=${fmt(ci.grade)} sbw=${fmt((ci.levels || {}).stallBurstWave)} exempt=${fmt((ci.exempt || {}).code)} denied=${fmt(ci.exemptDenied)}`);
      printDigest('  新读', dg);
    }

    // ---------- A2：四基底 sweep（缓存优先，零 Jev）----------
    console.log('\n===== A2 四基底 sweep（新旧键对照）=====');
    const points = [];
    for (const name of SETS) {
      try {
        const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
        for (const p of set.points) points.push({ set: name.replace('-trades', ''), ...p });
      } catch (e) { console.log(`  set ${name} 读取失败: ${e.message}`); }
    }
    console.log(`点位 ${points.length}`);
    const byAddr = new Map();
    let n = 0;
    for (const p of points) {
      const base = `scripts/buy-point/sets/${p.set}-trades`;
      let rows, anchorIso;
      try {
        const f = JSON.parse(fs.readFileSync(`${base}-ticks/${p.tokenAddress}.json`, 'utf8'));
        rows = f.rows;
        anchorIso = p.anchorTimeIso || rows[rows.length - 1].block_time;
      } catch { continue; }
      const aTs = Date.parse(anchorIso);
      const pre = rows.filter((r) => Date.parse(r.block_time) <= aTs);
      if (pre.length < 7) continue;
      n++;
      const meta = { address: p.tokenAddress, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
      const d = buildSnapshotFromRows(pre, meta).derived;
      const rec = { set: p.set, sym: p.tokenSymbol ?? '?', addr: p.tokenAddress, anchor: anchorIso, dg: segDigest(d), pnl: p.trade?.episode?.pnlBnb ?? null };
      const score = Math.max(rec.dg.newPct ?? -1, rec.dg.oldPct ?? -1, rec.dg.bundleMax ?? -1, rec.dg.bundleAdj ?? -1);
      const cur = byAddr.get(rec.addr);
      const curScore = cur ? Math.max(cur.dg.newPct ?? -1, cur.dg.oldPct ?? -1, cur.dg.bundleMax ?? -1, cur.dg.bundleAdj ?? -1) : -1;
      if (!cur || score > curScore) byAddr.set(rec.addr, rec);
    }
    console.log(`有效点位 ${n} / 唯一票 ${byAddr.size}`);
    const U = [...byAddr.values()];

    // 立法五票靶面
    console.log(`\n--- CD401 立法票靶面（期望簇内卖压 ≥30%∧≥0.3 保持★；簇外=知情放行报 pnl）：`);
    for (const t of CD401_TARGETS) {
      const rs = U.filter((x) => x.addr === t.addr);
      if (!rs.length) { console.log(`  ${t.sym} ${t.addr} 不在 sweep → 阶段 B 锚直读`); continue; }
      for (const r of rs) printDigest(`${t.sym} pnl=${fmt(r.pnl)} [${r.set}]`, r.dg);
    }
    // CD405 命中对照
    console.log(`\n--- CD405 命中对照（bundle 两键不受 CD407 影响，期望保持 ≥7★）：`);
    for (const t of CD405_HITS) {
      const r = U.find((x) => x.addr === t.addr);
      if (!r) { console.log(`  ${t.sym} 不在 sweep → 跳过`); continue; }
      printDigest(`${t.sym} pnl=${fmt(r.pnl)} [${r.set}]`, r.dg);
    }
    // 命中面变化全表
    const onlyOld = U.filter((x) => oldHit(x.dg) && !newHit(x.dg));
    const onlyNew = U.filter((x) => !oldHit(x.dg) && newHit(x.dg));
    const bothHit = U.filter((x) => oldHit(x.dg) && newHit(x.dg));
    console.log(`\n== 命中面变化 ==`);
    console.log(`双命中（保持 denied）：${bothHit.length} 票 Σpnl=${r4(bothHit.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of bothHit) printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
    console.log(`旧命中→放行（CD407 解除=簇外卖压）：${onlyOld.length} 票 Σpnl=${r4(onlyOld.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of onlyOld) printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
    console.log(`新命中（旧整窗稀释掉的簇内卖压）：${onlyNew.length} 票 Σpnl=${r4(onlyNew.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of onlyNew) printDigest(`${r.sym} [${r.set}] pnl=${fmt(r.pnl)}`, r.dg);
  }

  if (STAGE === 'b') {
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
          const res = await svc.gateBuyPoint(addr, metaFor(), { experimentId: 'cd407-parity' }, { awaitMs: 180000, anchorMs: Date.parse(anchorIso) });
          const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
          const act = res && res.buckets ? res.buckets.activityLevel : '?';
          const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
          const reasons = res && res.reasons ? res.reasons.map((x) => x.code || x).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
          const ex = res && res.exempt ? res.exempt.code : null;
          const dn = res && res.exemptDenied ? res.exemptDenied : null;
          const an = (res && res.observation && res.observation.anchors) || {};
          line = `grade=${grade} act=${act} sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)}`
            + (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '')
            + ` 簇=${fmt(an.burstWaveSegBuyBnb)}/${fmt(an.burstWaveSegSellBnb)}/${fmt(an.burstWaveSegSellPct)}%`
            + ` 旧=${fmt(an.burstExitSegSellBnb)}/${fmt(an.burstExitSegSellPct)}%`
            + ` blocked=${svc.isGateBlocked(addr)}`;
        } catch (e) { line = `门异常: ${e.message}`; }
        console.log(`  [run ${i}] ${line}`);
      }
    };
    // B1 Cashless 主案 REPEAT=3（全部信号锚）
    const cMeta = await metaOf(CASHLESS.addr, CASHLESS.sym);
    for (const s of cSigs) await runGate(`Cashless主案`, CASHLESS.addr, s.created_at, cMeta, 3);
    // B2 CD401 立法票 REPEAT=2（锚=首个带 cheatCheck 的信号）
    for (const t of CD401_TARGETS) {
      const { data: ss } = await client.from('strategy_signals').select('id,created_at,metadata')
        .eq('token_address', t.addr).not('metadata->cheatCheck', 'is', null).order('created_at', { ascending: true }).limit(10);
      if (!ss || !ss.length) { console.log(`\n--- ${t.sym} 无信号锚可查，跳过（阶段 A 已直读）`); continue; }
      const m = await metaOf(t.addr, t.sym);
      await runGate(`CD401保持:${t.sym}`, t.addr, ss[0].created_at, m, 2);
    }
  }

  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
