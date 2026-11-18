// CD417 对拍（一次性脚本，182 跑）：act 题⑦密集臂段前背景反锚（D3.75）
// snapshot 新键 nearPre10GapSec（脉冲紧前纯静默）/nearPre10Wallets（段前独立钱包）
// 期望面：
//  ①主案 0xba67f3e1…7777（实验 6e75ed6d，2026-11-02 12:06:16）：生产行（D3.33）act=high
//    放行→49s 后重判翻 cheat；D3.75 下期望 act≠high（反锚两腿 24s/1 命中→至多中）
//  ②回归票 memes 0x28ad2c7d（CD394 豁免放行代表 act=high）：正常盘段前多钱包/无长静默
//    → 反锚不触发，act=high 保持（豁免语义不变）
//  ③四基底 sweep：两腿命中面分布+命中票 pnl 对照（误伤面=命中票里正票占比）
//  ④金额轴分离带：D3.73 加权分 vs 尾 10s 吞吐比值——两轴接住/接不住的对照
// 阶段 A（零 Jev）sweep+主案锚直读；阶段 B（Jev 门链）主案 REPEAT=3+回归 REPEAT=2
// 用法：node tmp-cd417-parity.cjs [--stage a|b]（缺省 a）
const fs = require('node:fs');
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const MAIN = { sym: '0xba67主案', addr: '0xba67f3e17ebfc3e51645bb95122a747e9adf7777', expId: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' };
const REGRESS = [
  { sym: 'memes(CD394豁免代表)', addr: null }, // 全地址由 DB like 派生（手敲地址陷阱）
];
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const STAGE = process.argv.includes('--stage') ? process.argv.indexOf('--stage') >= 0 ? process.argv[process.argv.indexOf('--stage') + 1] : 'a' : 'a';
const fmt = (v) => (v === null || v === undefined ? '—' : v);
const r4 = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(4));
// 反锚两腿（题面参考线）
const hit = (d) => (d.nearPre10GapSec ?? -1) >= 15 && (d.nearPre10Wallets ?? 99) <= 2;

(async () => {
  const logger = { info: () => {}, warn: (m) => console.log('  warn:', m), error: (m) => console.log('  err:', m) };
  const client = dbManager.getClient();
  const svc0 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});

  // memes 全地址从 signals 模糊定位（查不到=跳过该回归票）
  const { data: mSig } = await client.from('strategy_signals').select('token_address')
    .like('token_address', '0x28ad2c7d%').limit(1);
  if (mSig && mSig[0]) REGRESS[0].addr = mSig[0].token_address;
  else REGRESS[0] = null;
  for (let i = REGRESS.length - 1; i >= 0; i--) if (!REGRESS[i]) REGRESS.splice(i, 1);

  const { data: mSigs, error: mErr } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', MAIN.expId).eq('token_address', MAIN.addr)
    .order('created_at', { ascending: true }).limit(10);
  if (mErr) throw new Error('主案 signals: ' + mErr.message);
  console.log(`主案 ${MAIN.addr} 信号 ${mSigs.length} 行`);

  if (STAGE === 'a') {
    // ---------- A1：主案锚直读 ----------
    console.log('\n===== A1 主案锚直读（D3.75 两键+金额轴对照）=====');
    for (const s of mSigs) {
      const cc = s.metadata?.cheatCheck;
      const ci = cc?.info || cc || {};
      const anchorMs = Date.parse(s.created_at);
      const pull = await svc0._pullTicksDb(MAIN.addr, anchorMs);
      const createMeta = await svc0._loadCreateMeta(MAIN.addr);
      const meta = svc0._normalizeMeta(MAIN.addr, { address: MAIN.addr, platform: 'fourmeme' }, pull, createMeta);
      const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const d = snap.derived;
      console.log(`--- ${s.created_at} 生产grade=${fmt(ci.grade)} act=${fmt((ci.buckets || {}).activityLevel)}`);
      console.log(`  D3.75: 段前静默=${fmt(d.nearPre10GapSec)}s 段前钱包=${fmt(d.nearPre10Wallets)} ${hit(d) ? '★反锚命中' : '不命中'}`
        + ` | D3.73: 加权=${fmt(d.actWeightedThroughputBnbPerMin)} 尾10s=${fmt(d.nearTail10BnbPerMin)} 比值=${d.nearTail10BnbPerMin ? (d.actWeightedThroughputBnbPerMin / d.nearTail10BnbPerMin).toFixed(2) : '—'}`
        + ` | idlePct=${fmt(d.idlePct)} maxGap=${fmt(d.maxGapSec)} 尾5买=${fmt(d.nearTail5BuyN)}笔`);
    }

    // ---------- A2：四基底 sweep ----------
    console.log('\n===== A2 四基底 sweep（两腿命中面+金额轴分离带）=====');
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
      const rec = { set: p.set, sym: p.tokenSymbol ?? '?', addr: p.tokenAddress, anchor: anchorIso, d, pnl: p.trade?.episode?.pnlBnb ?? null };
      if (!byAddr.has(p.tokenAddress)) byAddr.set(p.tokenAddress, rec);
    }
    console.log(`有效点位 ${n} / 唯一票 ${byAddr.size}`);
    const U = [...byAddr.values()];
    const hits = U.filter((x) => hit(x.d));
    const miss = U.filter((x) => !hit(x.d));
    console.log(`\n== 两腿命中（反锚触发面）${hits.length} 票 Σpnl=${r4(hits.reduce((s, x) => s + (x.pnl ?? 0), 0))}`);
    for (const r of hits) {
      const ratio = r.d.nearTail10BnbPerMin ? (r.d.actWeightedThroughputBnbPerMin / r.d.nearTail10BnbPerMin).toFixed(2) : '—';
      console.log(`  ${r.sym} [${r.set}] pnl=${fmt(r.pnl)} 静默=${fmt(r.d.nearPre10GapSec)}s 钱包=${fmt(r.d.nearPre10Wallets)} 加权=${fmt(r.d.actWeightedThroughputBnbPerMin)}/${fmt(r.d.nearTail10BnbPerMin)}(${ratio}) idle=${fmt(r.d.idlePct)}`);
    }
    console.log(`\n== 未命中 ${miss.length} 票（抽样前 8：段前多钱包/无长静默=正常盘）`);
    for (const r of miss.slice(0, 8)) console.log(`  ${r.sym} [${r.set}] pnl=${fmt(r.pnl)} 静默=${fmt(r.d.nearPre10GapSec)}s 钱包=${fmt(r.d.nearPre10Wallets)}`);
    // 金额轴分离带：比值 <0.7（D3.73 可疑带）但反锚不命中的票=两轴分离面
    const sep = U.filter((x) => !hit(x.d) && x.d.nearTail10BnbPerMin && x.d.actWeightedThroughputBnbPerMin != null
      && x.d.actWeightedThroughputBnbPerMin / x.d.nearTail10BnbPerMin < 0.7);
    console.log(`\n== 金额轴分离带（比值<0.7 且反锚不命中——D3.73 域/D3.75 域互补面）${sep.length} 票`);
    for (const r of sep.slice(0, 8)) console.log(`  ${r.sym} [${r.set}] pnl=${fmt(r.pnl)} 静默=${fmt(r.d.nearPre10GapSec)}s 钱包=${fmt(r.d.nearPre10Wallets)} 比值=${(r.d.actWeightedThroughputBnbPerMin / r.d.nearTail10BnbPerMin).toFixed(2)}`);
  }

  if (STAGE === 'b') {
    console.log('===== B gateBuyPoint 门链（activityExemptLevels=high 生产缺省）=====');
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
        const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 180000, activityExemptLevels: ['high'] },
          settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
        let line = '';
        try {
          const res = await svc.gateBuyPoint(addr, metaFor(), { experimentId: 'cd417-parity' }, { awaitMs: 180000, anchorMs: Date.parse(anchorIso) });
          const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
          const act = res && res.buckets ? res.buckets.activityLevel : '?';
          const reasons = res && res.reasons ? res.reasons.map((x) => x.code || x).join(',') : (res && res.gradeReasons ? res.gradeReasons.join(',') : '');
          const ex = res && res.exempt ? res.exempt.code : null;
          const dn = res && res.exemptDenied ? res.exemptDenied : null;
          const an = (res && res.observation && res.observation.anchors) || {};
          line = `grade=${grade} act=${act}` + (reasons ? ` [${reasons}]` : '') + (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '')
            + ` 段前=${fmt(an.nearPre10GapSec)}s/${fmt(an.nearPre10Wallets)}w` + ` blocked=${svc.isGateBlocked(addr)}`;
        } catch (e) { line = `门异常: ${e.message}`; }
        console.log(`  [run ${i}] ${line}`);
      }
    };
    // B1 主案 REPEAT=3（BUY 信号锚）
    const mMeta = await metaOf(MAIN.addr, MAIN.sym);
    const buySigs = (mSigs || []).filter((s) => (s.metadata?.signal_type || s.metadata?.side || 'BUY') !== 'SELL');
    const anchor = buySigs[0] || (mSigs || [])[0];
    if (anchor) await runGate('主案D3.75', MAIN.addr, anchor.created_at, mMeta, 3);
    // B2 回归票 REPEAT=2
    for (const t of REGRESS) {
      const { data: ss } = await client.from('strategy_signals').select('id,created_at,metadata')
        .eq('token_address', t.addr).not('metadata->cheatCheck', 'is', null).order('created_at', { ascending: true }).limit(30);
      if (!ss || !ss.length) { console.log(`\n--- ${t.sym} 无信号锚可查，跳过`); continue; }
      const m = await metaOf(t.addr, t.sym);
      // 首锚可能 insufficient_ticks（memes CD394 锚=07:16 窗口非首个信号）——取末锚
      await runGate(`回归:${t.sym}`, t.addr, ss[ss.length - 1].created_at, m, 2);
    }
  }

  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
