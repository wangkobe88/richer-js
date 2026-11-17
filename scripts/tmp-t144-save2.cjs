// T144 节省精算：机械 act 拒 536 行 × 当时实际燃烧（cheat analyzed/BP usage）
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,executed,er:metadata->>execution_reason,metadata')
    .eq('experiment_id', 'b67b7318-1715-443d-a29b-7919b2db6e65').eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).range(0, 1999);
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  let actHit = 0, savedCheat = 0, savedBp = 0, savedBpTok = 0, n = 0;
  for (const s of sigs || []) {
    n++;
    if (n % 250 === 0) console.error(`…${n}`);
    try {
      const pull = await svc._pullTicksDb(s.token_address, new Date(s.created_at).getTime());
      if (!pull.rows.length || pull.anchorTickCount < 6) continue;
      const meta = svc._normalizeMeta(s.token_address, { platform: null }, pull, null);
      const r = FPC.judgeActivityLevel(buildBuyPointSnapshot(pull.rows, meta, {}));
      if (!r.level) continue;
      actHit++;
      const cc = s.metadata && s.metadata.cheatCheck;
      if (cc && cc.status === 'analyzed') savedCheat++;
      const u = s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.usage;
      if (u && u.input_tokens) { savedBp++; savedBpTok += (u.input_tokens + (u.output_tokens || 0)); }
    } catch (e) {}
  }
  console.log(`\n机械 act 拒 ${actHit} 行：省 cheat 真烧 ${savedCheat} 次 × ~55k tok + 省 BP ${savedBp} 次 × 均 ${savedBpTok && Math.round(savedBpTok / savedBp)} tok`);
  const cheatTok = savedCheat * 55000;
  console.log(`≈ 省 ${(cheatTok + savedBpTok) / 1000}k token / 23h 窗（cheat 16 题单次估 ~55k input+output）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
