// T144 预扫描（182 只读）：v132 全部 BUY 信号重放 judgeActivityLevel——对照 Jev act 拒面
const path = require('path');
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('b67b7318')).id;
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  let sigs = [], from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at,executed,er:metadata->>execution_reason')
      .eq('experiment_id', id).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs = sigs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`v132 BUY 信号 ${sigs.length} 行重放 judgeActivityLevel`);
  // 基线 act 拒面基数
  const actGateRows = sigs.filter((s) => s.er === 'bp_gate_assessment'); // BP 拒（内含 act 臂）
  const execTokens = new Set(sigs.filter((s) => s.executed).map((s) => s.token_address));
  let n = 0, lowN = 0, ultraN = 0, newlyBlocked = [];
  const branchCnt = new Map();
  for (const s of sigs) {
    n++;
    if (n % 200 === 0) console.log(`  … ${n}/${sigs.length}`);
    try {
      const anchorMs = new Date(s.created_at).getTime();
      const pull = await svc._pullTicksDb(s.token_address, anchorMs);
      if (!pull.rows.length || pull.anchorTickCount < 6) continue;
      const meta = svc._normalizeMeta(s.token_address, { symbol: s.token_symbol, platform: null }, pull, null);
      const snap = buildBuyPointSnapshot(pull.rows, meta, {});
      const r = FPC.judgeActivityLevel(snap);
      if (r.level === 'low') { lowN++; branchCnt.set(r.branch, (branchCnt.get(r.branch) || 0) + 1); if (execTokens.has(s.token_address)) newlyBlocked.push({ sym: s.token_symbol, addr: s.token_address, branch: r.branch, er: s.er }); }
      else if (r.level === 'ultra') { ultraN++; branchCnt.set(r.branch, (branchCnt.get(r.branch) || 0) + 1); if (execTokens.has(s.token_address)) newlyBlocked.push({ sym: s.token_symbol, addr: s.token_address, branch: r.branch, er: s.er }); }
    } catch (e) { /* 单行异常跳过 */ }
  }
  console.log(`\n机械判定：low ${lowN} 行 / ultra ${ultraN} 行（BP 拒面基数 bp_gate_assessment ${actGateRows.length} 行对照）`);
  console.log('分支分布:', [...branchCnt.entries()].map(([k, v]) => k + ':' + v).join(' '));
  const uniq = new Map();
  for (const b of newlyBlocked) if (!uniq.has(b.addr)) uniq.set(b.addr, b);
  console.log(`\nNewly-blocked（机械 act 拒 ∧ v132 买入）${uniq.size} 票：`);
  for (const b of uniq.values()) console.log(`  ${b.branch}  v132 信号 er=${b.er || '(买)'}  ${(b.sym || '?')} ${b.addr}`);
  // 关键票不受影响验证
  for (const pre of ['0xdae106c8', '0x65aebe91']) {
    const s = sigs.find((x) => x.token_address.startsWith(pre));
    if (!s) continue;
    const pull = await svc._pullTicksDb(s.token_address, new Date(s.created_at).getTime());
    const meta = svc._normalizeMeta(s.token_address, { symbol: s.token_symbol, platform: null }, pull, null);
    const r = FPC.judgeActivityLevel(buildBuyPointSnapshot(pull.rows, meta, {}));
    console.log(`关键票 ${(s.token_symbol || '')} ${pre}…：${r.level}（${r.branch}）`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
