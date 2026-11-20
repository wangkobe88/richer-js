// CD422 对拍（一次性脚本，182 跑）：sbw 波绑定收紧——D3.67 单段绑定波从「出口后
// 60s 内最密 5s 窗」改为「断流出口行起 5s 固定窗；出口行孤笔→波族九键 null」。
// 阶段 A（零 Jev）：
//  A1 本案 0xc71a685b…7777 信号#2 锚直读：期望 burstLastGapSec=33 + 波族九键全 null
//     （旧口径此处=0.3284B/3w 缝合值）
//  A2 burst 观测行抽样保持率：cheat_detection answers sbw=burst 的行（qv 降序 token
//     去重取最新观测），锚=同 exp 同 token ≤analyzed_at 最近信号；每票锚窗直读新口径
//     波族 + 脚本内联旧口径（出口后 60s 最密 5s 窗）对照 → 保持/孤笔翻案/迟到缩量分布
// 阶段 B（Jev 门链）：本案 REPEAT=3（期望 sbw=none）+ 翻案面 2 票 REPEAT=2（期望
//     none）+ 保持面 2 票 REPEAT=2（期望保持 burst）
// 用法：node tmp-cd422-parity.cjs [--stage a|b]（缺省 a）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const CASE = { sym: 'NativeCoin(c71a)', addr: '0xc71a685b7ccb5dcd119ddc889f78f048e4e37777', expId: 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f', anchor: '2026-10-04T12:55:23Z' };
const STAGE = process.argv.includes('--stage') ? process.argv[process.argv.indexOf('--stage') + 1] : 'a';
const fmt = (v) => (v === null || v === undefined ? '—' : v);
const r4 = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(4));

// 旧口径内联（出口后 60s 内最密 5s 滑窗，D3.67 pre-CD422）——仅对拍用
function oldWave(rowsSec) {
  // rowsSec: [{dt, side, bnb, wallet}] 已按 dt 升序、dt=相对首行秒
  if (!rowsSec.length) return null;
  let lastGapIdx = -1;
  for (let i = 1; i < rowsSec.length; i++) if (rowsSec[i].dt - rowsSec[i - 1].dt >= 30) lastGapIdx = i;
  if (lastGapIdx < 1) return { gapSec: null };
  const exit = rowsSec[lastGapIdx];
  const zone = [];
  for (let i = lastGapIdx; i < rowsSec.length; i++) { if (rowsSec[i].dt - exit.dt > 60) break; zone.push(rowsSec[i]); }
  let j = 0, bestN = 0, bestL = 0, bestR = -1, curN = 0;
  for (let i = 0; i < zone.length; i++) {
    curN++;
    while (zone[i].dt - zone[j].dt > 5) { curN--; j++; }
    if (curN > bestN) { bestN = curN; bestL = j; bestR = i; }
  }
  const win = zone.slice(bestL, bestR + 1);
  const buys = win.filter((t) => t.side === 'buy');
  const ws = new Set(buys.map((t) => t.wallet).filter(Boolean));
  return { gapSec: exit.dt - rowsSec[lastGapIdx - 1].dt, buyBnb: +buys.reduce((s, t) => s + t.bnb, 0).toFixed(4), wallets: ws.size };
}

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();
  const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});

  // ── 抽样：burst 观测行（qv 降序 token 去重取最新） ──
  const bursts = [];
  {
    let from = null;
    outer: for (let page = 0; page < 6; page++) {
      let q = client.from('cheat_detection').select('token_address,analyzed_at,question_version,source_experiment_id,answers_raw')
        .order('analyzed_at', { ascending: false }).limit(1000);
      if (from) q = q.lt('analyzed_at', from);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      if (!r.data.length) break;
      from = r.data[r.data.length - 1].analyzed_at;
      for (const o of r.data) {
        let sbw = null;
        try { const raw = typeof o.answers_raw === 'string' ? JSON.parse(o.answers_raw) : o.answers_raw; sbw = raw?.answers?.stall_burst_wave?.choice; } catch {}
        if (sbw !== 'burst') continue;
        if (bursts.some((b) => b.t === o.token_address)) continue;
        bursts.push({ t: o.token_address, at: o.analyzed_at, qv: o.question_version, exp: o.source_experiment_id });
        if (bursts.length >= 36) break outer;
      }
    }
  }
  console.log(`burst 观测抽样 ${bursts.length} 票（qv=${[...new Set(bursts.map((b) => b.qv))].join('/')}`);

  // 每票锚：同 exp 同 token ≤analyzed_at 最近信号
  const anchored = [];
  for (const b of bursts) {
    const q = client.from('strategy_signals').select('id,created_at').eq('token_address', b.t).order('created_at', { ascending: true }).limit(200);
    const { data } = await (b.exp ? q.eq('experiment_id', b.exp) : q);
    if (!data || !data.length) continue;
    const at = Date.parse(b.at);
    let best = null;
    for (const s of data) { const ts = Date.parse(s.created_at); if (ts <= at + 5000 && (!best || ts > Date.parse(best))) best = s.created_at; }
    if (!best) best = data[data.length - 1].created_at;
    anchored.push({ ...b, anchor: best });
  }
  console.log(`带精确锚 ${anchored.length} 票`);

  const pullAndDerive = async (addr, anchorIso) => {
    const pull = await svc0._pullTicksDb(addr, Date.parse(anchorIso));
    const createMeta = await svc0._loadCreateMeta(addr);
    const meta = svc0._normalizeMeta(addr, { address: addr, platform: 'fourmeme' }, pull, createMeta);
    const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const t0 = pull.rows.length ? Date.parse(pull.rows[0].block_time) / 1000 : null;
    const rowsSec = pull.rows.map((r) => ({ dt: t0 === null ? 0 : Math.round(Date.parse(r.block_time) / 1000 - t0), side: r.trade_type, bnb: Number(r.bnb_amount), wallet: (r.sender_address || r.trader_address || '').toLowerCase() }));
    return { d: snap.derived, old: oldWave(rowsSec), n: pull.rows.length };
  };

  if (STAGE === 'a') {
    // A1 本案
    console.log('\n===== A1 本案 0xc71a 信号#2 锚直读 =====');
    const { d, old } = await pullAndDerive(CASE.addr, CASE.anchor);
    console.log(`新口径: 段=${fmt(d.burstLastGapSec)}s 波买=${fmt(d.burstExitWaveBuyBnb)}(${fmt(d.burstExitWaveWallets)}w) FromDt=${fmt(d.burstExitWaveFromDt)} 距锚=${fmt(d.burstSecSinceWaveEnd)}s`);
    console.log(`旧口径(内联): 段=${fmt(old?.gapSec)}s 波买=${fmt(old?.buyBnb)}(${fmt(old?.wallets)}w)`);
    console.log(`期望: 新=段33s+波族全null（孤笔）；旧=段33s+0.3284B/3w（缝合值）`);

    // A2 抽样保持率
    console.log('\n===== A2 burst 观测抽样新旧行对照 =====');
    const cls = { keep: [], alone: [], shrink: [], nosg: [], nodata: [] };
    for (const b of anchored) {
      let res;
      try { res = await pullAndDerive(b.t, b.anchor); } catch (e) { cls.nodata.push({ ...b, why: e.message }); continue; }
      const { d, old, n } = res;
      const newBuy = d.burstExitWaveBuyBnb, newW = d.burstExitWaveWallets;
      const oldBuy = old?.buyBnb ?? null, oldW = old?.wallets ?? null;
      const rec = { ...b, rows: n, newBuy, newW, oldBuy, oldW, gap: d.burstLastGapSec };
      const hasSeg = (d.burstLastGapSec !== null && d.burstLastGapSec !== undefined) || (old && old.gapSec != null);
      if (!hasSeg) cls.nosg.push(rec);                                 // 新旧都无 ≥30s 段（sbw=扫 TICKS 自判形状，非本收紧靶面）
      else if (newBuy === null) cls.alone.push(rec);                   // 段在而新波族 null：出口孤笔 → sbw 必翻 none
      else if ((oldBuy ?? 0) >= 0.3 && newBuy < 0.3) cls.shrink.push(rec); // 迟到剥离致量级线跌落 → 大概率翻 none
      else cls.keep.push(rec);
    }
    const tot = cls.keep.length + cls.alone.length + cls.shrink.length + cls.nosg.length;
    console.log(`有效 ${tot}：保持(新波≥0.3或旧本<0.3)=${cls.keep.length} 孤笔翻案=${cls.alone.length} 迟到缩量=${cls.shrink.length} 无段(自判形状非靶面)=${cls.nosg.length} 拉数失败=${cls.nodata.length}`);
    for (const [tag, arr] of [['孤笔翻案', cls.alone], ['迟到缩量', cls.shrink]]) {
      console.log(`\n-- ${tag} ${arr.length} 票：`);
      for (const r of arr.slice(0, 12)) console.log(`  ${r.t} qv=${r.qv} 段=${fmt(r.gap)}s 旧=${fmt(r.oldBuy)}/${fmt(r.oldW)}w → 新=${fmt(r.newBuy)}/${fmt(r.newW)}w anchor=${r.anchor}`);
    }
    console.log(`\n-- 保持面首 8（波值过线抽查）：`);
    for (const r of cls.keep.filter((x) => (x.newBuy ?? 0) >= 0.3).slice(0, 8)) console.log(`  ${r.t} qv=${r.qv} 段=${fmt(r.gap)}s 旧=${fmt(r.oldBuy)}/${fmt(r.oldW)}w → 新=${fmt(r.newBuy)}/${fmt(r.newW)}w`);
    // 阶段 B 候选打印
    const flipPick = cls.alone[0], shrinkPick = cls.shrink[0];
    const keepPicks = cls.keep.filter((x) => (x.newBuy ?? 0) >= 0.3 && (x.newW ?? 0) >= 2).slice(0, 2);
    console.log(`\nB 阶段候选：flip=${flipPick ? flipPick.t + '@' + flipPick.anchor : '无'} shrink=${shrinkPick ? shrinkPick.t + '@' + shrinkPick.anchor : '无'}`);
    keepPicks.forEach((k) => console.log(`keep=${k.t}@${k.anchor} 新=${fmt(k.newBuy)}/${fmt(k.newW)}w`));
  }

  if (STAGE === 'b') {
    console.log('===== B gateBuyPoint 门链（activityExemptLevels=high,ultra 生产缺省）=====');
    const metaOf = async (addr) => {
      const { data } = await client.from('wss_events').select('token_address,payload,block_time,platform')
        .eq('kind', 'token_create').eq('token_address', addr).limit(5);
      const c0 = (data && data[0]) || {}; const p0 = c0.payload || {};
      return () => ({ address: addr, symbol: p0.symbol || null, name: p0.name || null,
        platform: c0.platform || 'fourmeme', createdAtMs: c0.block_time ? Date.parse(c0.block_time) : null });
    };
    const runGate = async (tag, addr, anchorIso, metaFor, repeat) => {
      console.log(`\n--- ${tag} ${addr} anchor=${anchorIso}`);
      for (let i = 1; i <= repeat; i++) {
        const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 180000, activityExemptLevels: ['high', 'ultra'] },
          settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
        let line = '';
        try {
          const res = await svc.gateBuyPoint(addr, metaFor(), { experimentId: 'cd422-parity' }, { awaitMs: 180000, anchorMs: Date.parse(anchorIso) });
          const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
          const act = res && res.buckets ? res.buckets.activityLevel : '?';
          const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
          const reasons = res && res.reasons ? res.reasons.map((x) => x.code || x).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
          const ex = res && res.exempt ? res.exempt.code : null;
          const dn = res && res.exemptDenied ? res.exemptDenied : null;
          line = `grade=${grade} act=${act} sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)}`
            + (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '') + ` blocked=${svc.isGateBlocked(addr)}`;
        } catch (e) { line = `门异常: ${e.message}`; }
        console.log(`  [run ${i}] ${line}`);
      }
    };
    const args = process.argv.slice(process.argv.indexOf('--stage') + 2);
    // 用法：--stage b [flipAddr flipAnchor shrinkAddr shrinkAnchor keep1Addr keep1Anchor keep2Addr keep2Anchor]
    const cMeta = await metaOf(CASE.addr);
    await runGate(`本案:${CASE.sym}`, CASE.addr, CASE.anchor, cMeta, 3);
    const names = ['翻案面', '缩量面', '保持面1', '保持面2'];
    for (let i = 0; i < 4; i++) {
      const addr = args[i * 2], anchor = args[i * 2 + 1];
      if (!addr || !anchor) { console.log(`\n--- ${names[i]} 未提供，跳过`); continue; }
      const m = await metaOf(addr);
      await runGate(names[i], addr, anchor, m, 2);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
