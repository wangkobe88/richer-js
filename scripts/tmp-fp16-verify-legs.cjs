// FP16 阈值核验：对 5 张关键票用真实 pullTicks+buildBuyPointSnapshot 重建
// lifecycle_burst 六腿原料（gate 显示值缺波近锚/深破豁免两腿），并模拟各阈值翻转。
const { dbManager } = require('../src/services/dbManager');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy: judge } = require('../src/market-analysis/factor-pre-buy-check');

// token: [实验id前缀, 标注, 参考 pnl]
const TARGETS = [
  ['0x8fbb5ae7', 'b8ae9f2e', 'win1019 误伤票 +0.0321'],
  ['0x854d4f2f', 'b8ae9f2e', 'win1019 chibi 止血票 -0.0228'],
  ['0x4c6c9378', 'b8ae9f2e', 'win1019 平票 0.0000'],
  ['0x9391a6d2', 'b8ae9f2e', 'win1019 平票 0.0000'],
  ['0x953866a7', 'dddbe79e', 'win1012 误伤票 +0.0272'],
];

async function main() {
  const sb = dbManager.getClient();
  const svc = new BuyPointCheckService({
    enabled: true, factorCheck: { enabled: true },
    settleDelayMs: 0, memSource: { enabled: false }, persist: false,
  }, null, { dbClient: sb });

  for (const [tokPfx, expPfx, note] of TARGETS) {
    // ── 找实验完整 id 与成交买信号 ──
    const { data: exps } = await sb.from('experiments').select('id').limit(500);
    const expId = (exps || []).find(e => e.id.slice(0, 8) === expPfx).id;
    const { data: expsAll } = await sb.from('experiments').select('id').limit(500); // noop 保形
    // token 完整地址：从该实验信号行取
    const { data: sigLike } = await sb.from('strategy_signals').select('token_address')
      .eq('experiment_id', expId).like('token_address', tokPfx + '%').limit(1);
    if (!sigLike || !sigLike.length) { console.log(`[${tokPfx}] 找不到信号行`); continue; }
    const token = sigLike[0].token_address;
    // 买成交 → signal_id → 信号行
    const { data: trades } = await sb.from('trades').select('signal_id,created_at')
      .eq('experiment_id', expId).eq('token_address', token).eq('trade_direction', 'buy').limit(5);
    const sigIds = (trades || []).map(t => t.signal_id).filter(Boolean);
    if (!sigIds.length) { console.log(`[${tokPfx}] 无成交买信号`); continue; }
    const { data: sigs } = await sb.from('strategy_signals').select('id,created_at,reason,metadata->factorCheck')
      .eq('experiment_id', expId).eq('token_address', token).in('id', sigIds);
    const sig = (sigs || []).find(s => s.factorCheck) || (sigs || [])[0];
    if (!sig) { console.log(`[${tokPfx}] 信号行缺失`); continue; }

    const prodGate = sig.factorCheck && Array.isArray(sig.factorCheck.gates)
      ? sig.factorCheck.gates.find(g => g.id === 'lifecycle_burst') : null;

    // ── token_create meta ──
    const { data: evRows } = await sb.from('wss_events').select('payload,block_time,platform')
      .eq('token_address', token).eq('kind', 'token_create').limit(1);
    const ev = (evRows || [])[0] || {};
    const p = ev.payload || {};
    const platform = ev.platform || p.platform || 'fourmeme';
    const totalSupply = p.totalSupply ?? (platform === 'flap' ? 1e9 : null);

    // ── 真实拉数 + snapshot ──
    const anchorMs = new Date(sig.created_at).getTime();
    const pull = await svc._pullTicksDb(token, anchorMs);
    const createMeta = await svc._loadCreateMeta(token);
    const meta = svc._normalizeMeta(token, {
      address: token, symbol: p.symbol || null, name: p.name || null, platform,
      createdAtMs: p.blockTimeMs ?? (ev.block_time ? new Date(ev.block_time).getTime() : null),
      creatorAddress: p.creator || null, totalSupply,
    }, pull, createMeta);
    const snapshot = buildBuyPointSnapshot(pull.rows, meta, {
      capped: pull.capped, anchorTickCount: pull.anchorTickCount, signalInfo: null,
    });
    const bd = snapshot.buyDerived || {}, cd = snapshot.cheatDerived || {};

    // ── 六腿原料与翻转模拟 ──
    const v = {
      ath: bd.athVsLaunchPct, total: bd.totalVolumeBnb, minVsFloor: bd.launchMinVsFloorPct,
      gap: cd.burstLastGapSec, sinceWaveEnd: cd.burstSecSinceWaveEnd, waveBuy: cd.burstWaveSegBuyBnb,
    };
    const baseOk = v.ath >= 100 && v.gap >= 30 && v.sinceWaveEnd !== null && v.sinceWaveEnd <= 60
      && v.waveBuy >= 0.3 && !(typeof v.minVsFloor === 'number' && v.minVsFloor < -10);
    console.log(`\n══ [${tokPfx}] ${token} | ${note}`);
    console.log(`   信号=${sig.created_at} ${sig.reason} | platform=${platform} ticks=${pull.anchorTickCount}`);
    console.log(`   生产 gate 值: ${prodGate ? prodGate.value : '(无)'}`);
    console.log(`   重建六腿: ath=${v.ath} total=${v.total} minVsFloor=${v.minVsFloor} gap=${v.gap} sinceWaveEnd=${v.sinceWaveEnd} waveBuy=${v.waveBuy}`);
    const flips = [];
    for (const T of [10, 10.5, 11, 11.5, 12, 13, 14]) {
      const hit = baseOk && v.total >= T;
      if (hit) flips.push(T);
    }
    console.log(`   除总额外五腿全过=${baseOk} → 阈值翻转点=${baseOk ? (flips.length ? 'T≤' + Math.min(...flips) + ' 起拦' : '任何阈值都不拦(总额<10)') : '不翻转(有腿失)'}`);

    // 真判官 sanity：arms 与生产一致
    try {
      const verdict = judge(snapshot);
      const lc = (verdict.arms || []).includes('lifecycle_burst_residual');
      console.log(`   真判官(现行线): pass=${verdict.pass} arms=${JSON.stringify((verdict.arms || []).slice(0, 6))} lifecycle_hit=${lc}`);
    } catch (e) { console.log('   判官异常:', e.message); }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
