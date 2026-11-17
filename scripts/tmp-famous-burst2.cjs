// 补充：burst 波窗时间范围 × famous 买入 dt 对照（判定 famous 是否在波内）
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FAMOUS = require('../config/rosters/famous-copy-wallets.json');
const ROSTER = new Set((FAMOUS.wallets || []).map((w) => w.toLowerCase()));
const T = [
  ['550f9e89', '0x5bba5fbb', 'BSA'], ['54dac9c5', '0x1ed2e3e5', '画地为牢'],
  ['54dac9c5', '0x0f4bc185', '我画地为牢'], ['550f9e89', '0x562ba26b', '胖五A'],
];
async function main() {
  const c = await dbManager.getClient();
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  for (const [pre, addrPre, name] of T) {
    const { data: exps } = await c.from('experiments').select('id').limit(500);
    const id = exps.find((e) => e.id.startsWith(pre)).id;
    // 取全部信号逐个对照（burst 判定可能在不同信号时刻不同）
    const { data: sig } = await c.from('strategy_signals')
      .select('token_address,created_at,executed,sbw:metadata->cheatCheck->levels->>stallBurstWave')
      .eq('experiment_id', id).eq('signal_type', 'BUY')
      .ilike('token_address', addrPre + '%').order('created_at', { ascending: true }).limit(6);
    const addr = sig[0].token_address;
    console.log(`\n### ${name} ${addr}`);
    for (const s of sig) {
      const anchorMs = new Date(s.created_at).getTime();
      const pull = await svc._pullTicksDb(addr, anchorMs);
      const meta = svc._normalizeMeta(addr, { platform: null }, pull, null);
      const snap = buildBuyPointSnapshot(pull.rows, meta, {});
      const cd = snap.cheatDerived || {};
      const from = cd.burstExitWaveFromDt, end = cd.burstExitWaveEndDt;
      const famInWave = (snap.ticks || []).filter((t) => t.side === 'BUY' && t.wallet
        && ROSTER.has(String(t.wallet).toLowerCase()) && from !== null && from !== undefined
        && t.dt >= from && t.dt <= (end !== null && end !== undefined ? end : from + 60));
      const famAll = (snap.ticks || []).filter((t) => t.side === 'BUY' && t.wallet && ROSTER.has(String(t.wallet).toLowerCase()));
      console.log(`  信号 ${s.created_at.slice(11,19)} sbw=${s.sbw ?? '?'} 波窗=[${from},${end}] 波内famous=${famInWave.length} 笔 ${famInWave.map((f)=>f.bnb.toFixed(3)+'B@t+'+f.dt+'s').join('|')}（全窗 famous ${famAll.length} 笔：${famAll.map((f)=>f.bnb.toFixed(3)+'B@t+'+f.dt+'s').join('|')}）`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
