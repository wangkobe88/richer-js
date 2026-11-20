// T192 lifecycle_sell_residual 跨窗扫描：两窗（win1012=v155 / win1019=v157）全部
// 成交买点真 snapshot 收腿 + 判官面 + sellPct 线值敏感性 + pnl 对照。
const { dbManager } = require('../src/services/dbManager');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy: judge } = require('../src/market-analysis/factor-pre-buy-check');

const WINDOWS = [
  { label: 'win1012', expPfx: 'dddbe79e', pairPfx: '8d20f3ba' }, // v155 采腿 / v154 备
  { label: 'win1019', expPfx: '2bdf98ab', pairPfx: 'b8ae9f2e' }, // v157 采腿 / v156 备
];

async function main() {
  const sb = dbManager.getClient();
  const svc = new BuyPointCheckService({ enabled: true, factorCheck: { enabled: true },
    settleDelayMs: 0, memSource: { enabled: false }, persist: false }, null, { dbClient: sb });
  const { data: exps } = await sb.from('experiments').select('id').limit(500);
  const idOf = (pfx) => exps.find(e => e.id.slice(0, 8) === pfx).id;

  for (const win of WINDOWS) {
    const expId = idOf(win.expPfx);
    // 成交买信号 + token pnl
    const { data: trades } = await sb.from('trades').select('signal_id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount')
      .eq('experiment_id', expId).limit(4000);
    const execSigIds = new Set(trades.filter(t => t.trade_direction === 'buy' && t.signal_id).map(t => t.signal_id));
    const tokenPnl = {};
    for (const t of trades) {
      const p = tokenPnl[t.token_address] = tokenPnl[t.token_address] || { buys: 0, sells: 0 };
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') p.buys += t.input_amount || 0;
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') p.sells += t.output_amount || 0;
    }
    // 执行买信号行
    const sigIds = [...execSigIds];
    const sigs = [];
    for (let i = 0; i < sigIds.length; i += 100) {
      const { data } = await sb.from('strategy_signals').select('id,created_at,token_address,reason')
        .eq('experiment_id', expId).in('id', sigIds.slice(i, i + 100));
      sigs.push(...(data || []));
    }
    console.log(`\n════ ${win.label}（${win.expPfx}）成交买信号 ${sigs.length} 笔 ════`);

    // token_create meta 缓存
    const metaCache = new Map();
    const getMeta = async (tok) => {
      if (metaCache.has(tok)) return metaCache.get(tok);
      const { data } = await sb.from('wss_events').select('payload,block_time,platform')
        .eq('token_address', tok).eq('kind', 'token_create').limit(1);
      const ev = (data || [])[0] || {};
      metaCache.set(tok, { p: ev.payload || {}, platform: ev.platform || 'fourmeme', bt: ev.block_time });
      return metaCache.get(tok);
    };

    const rows = [];
    let n = 0;
    for (const s of sigs) {
      n++;
      if (n % 40 === 0) console.log(`  ... ${n}/${sigs.length}`);
      try {
        const { p, platform, bt } = await getMeta(s.token_address);
        const anchorMs = new Date(s.created_at).getTime();
        const pull = await svc._pullTicksDb(s.token_address, anchorMs);
        const meta = svc._normalizeMeta(s.token_address, { address: s.token_address, platform,
          createdAtMs: p.blockTimeMs ?? (bt ? new Date(bt).getTime() : null),
          totalSupply: p.totalSupply ?? (platform === 'flap' ? 1e9 : null) }, pull, await svc._loadCreateMeta(s.token_address));
        const snap = buildBuyPointSnapshot(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount, signalInfo: null });
        const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {};
        const v = judge(snap);
        rows.push({
          token: s.token_address, at: s.created_at, reason: s.reason,
          legs: {
            ath: bd.athVsLaunchPct, total: bd.totalVolumeBnb, minVsFloor: bd.launchMinVsFloorPct,
            gap: cd.burstLastGapSec, sinceWaveEnd: cd.burstSecSinceWaveEnd, segEnd: cd.burstSecSinceSegEnd,
            segBuy: cd.burstWaveSegBuyBnb, segSell: cd.burstWaveSegSellBnb, sellPct: cd.burstWaveSegSellPct,
          },
          judgeArms: (v.arms || []), judgePass: v.pass,
          sellHit: (v.arms || []).includes('lifecycle_sell_residual'),
          burstHit: (v.arms || []).includes('lifecycle_burst_residual'),
          otherArm: (v.arms || []).filter(a => a !== 'lifecycle_sell_residual' && a !== 'lifecycle_burst_residual'),
        });
      } catch (e) {
        rows.push({ token: s.token_address, at: s.created_at, reason: s.reason, err: e.message });
      }
    }

    // ═══ 新臂命中面（成交后被拦=完全翻案：该 token 全部执行信号都 sellHit）═══
    const byTok = {};
    for (const r of rows) {
      if (r.err) continue;
      byTok[r.token] = byTok[r.token] || { sigs: [], err: false };
      byTok[r.token].sigs.push(r);
    }
    console.log(`\n── 判官面（现行 FP25）──`);
    let sellHitSig = 0, bothArms = 0;
    for (const r of rows) { if (r.err) continue; if (r.sellHit) sellHitSig++; if (r.sellHit || r.burstHit) bothArms++; }
    console.log(`执行信号 ${rows.filter(r=>!r.err).length} 笔：lifecycle_sell 命中 ${sellHitSig}、lifecycle 两臂合计 ${bothArms}（误差 ${rows.filter(r=>r.err).length}）`);

    const trunkPass = (L) => typeof L.ath === 'number' && L.ath >= 100 && typeof L.total === 'number' && L.total >= 11
      && typeof L.gap === 'number' && L.gap >= 30 && !(typeof L.minVsFloor === 'number' && L.minVsFloor < -10);
    const sellArm = (L, pctLine) => trunkPass(L) && typeof L.segEnd === 'number' && L.segEnd <= 60
      && typeof L.sellPct === 'number' && L.sellPct >= pctLine && typeof L.segSell === 'number' && L.segSell >= 0.3;

    console.log(`\n── 全翻案 token（全部执行信号都被新臂拦）──`);
    for (const pctLine of [40, 50, 60]) {
      const hits = [];
      for (const [tok, info] of Object.entries(byTok)) {
        if (info.sigs.every(r => sellArm(r.legs, pctLine))) hits.push(tok);
      }
      let sum = 0, pos = 0, neg = 0;
      const names = [];
      for (const tok of hits) {
        const pnl = tokenPnl[tok] ? tokenPnl[tok].sells - tokenPnl[tok].buys : 0;
        sum += pnl; if (pnl > 0) pos++; else neg++;
        names.push(`${tok.slice(0, 8)}(${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)})`);
      }
      console.log(`sellPct≥${pctLine}: 全拦 ${hits.length} token | Σpnl=${sum >= 0 ? '+' : ''}${sum.toFixed(4)} | 正${pos}/负${neg} | ${names.join(' ')}`);
    }

    console.log(`\n── 主干过线明细（ath≥100∧总额≥11∧静默≥30∧非深破，按 sellPct 降序）──`);
    const trunkRows = rows.filter(r => !r.err && trunkPass(r.legs)).sort((a, b) => (b.legs.sellPct ?? -1) - (a.legs.sellPct ?? -1));
    for (const r of trunkRows) {
      const L = r.legs;
      const pnl = tokenPnl[r.token] ? (tokenPnl[r.token].sells - tokenPnl[r.token].buys) : null;
      console.log(`${r.token.slice(0, 10)} ${r.at.slice(5, 19)} | sellPct=${L.sellPct} segSell=${L.segSell} segBuy=${L.segBuy} segEnd=${L.segEnd} sinceWaveEnd=${L.sinceWaveEnd} total=${L.total} | pnl=${pnl === null ? '?' : pnl.toFixed(4)} | 判官=${r.judgePass ? '过' : '拒' + JSON.stringify(r.otherArm.slice(0, 2))}${r.sellHit ? ' ★SELL臂' : ''}${r.burstHit ? ' ★BURST臂' : ''}`);
    }

    // ═══ 混合缝隙统计（FP16 fail-open 且卖占比 <50 的执行信号）═══
    const gapEdge = rows.filter(r => !r.err && typeof r.legs.segBuy === 'number' && r.legs.segBuy >= 0.3
      && r.legs.sinceWaveEnd === null && (r.legs.sellPct === null || r.legs.sellPct < 50) && trunkPass(r.legs));
    console.log(`\n── 混合缝隙（FP16 波锚 null∧簇买≥0.3∧卖占<50∧主干过）：${gapEdge.length} 笔 ──`);
    for (const r of gapEdge) console.log(`  ${r.token.slice(0, 10)} sellPct=${r.legs.sellPct} segBuy=${r.legs.segBuy} total=${r.legs.total}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
