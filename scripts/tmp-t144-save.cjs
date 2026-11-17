// T144 Jev 节省核算（182）：v132 机械 act 拒行 × 当时实际烧掉的 Jev 调用路径
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('created_at,executed,er:metadata->>execution_reason,metadata')
    .eq('experiment_id', 'b67b7318-1715-443d-a29b-7919b2db6e65').eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).range(0, 1999);
  const rows = sigs || [];
  // 每行实际烧掉的调用：有 cheatCheck.metadata 段=烧了 cheat（拉黑秒回无 analysis 细节但有段）；
  // 更准：cheatCheck.status==='analyzed'=真烧 16 题；cached=粘滞秒回零 Jev
  let cheatBurned = 0, cheatCached = 0, bpBurned = 0, total = 0;
  const burnByEr = new Map();
  for (const s of rows) {
    total++;
    const cc = s.metadata && s.metadata.cheatCheck;
    const bp = s.metadata && s.metadata.buyPoint;
    const er = s.er || (s.executed ? 'executed' : 'no-er');
    let saved = { cheat: 0, bp: 0 };
    if (cc && cc.status === 'analyzed') { cheatBurned++; saved.cheat = 1; }
    else if (cc && cc.cached === true) cheatCached++;
    if (bp && bp.usage && bp.usage.input_tokens) { bpBurned++; saved.bp = 1; }
    const cur = burnByEr.get(er) || { n: 0, cheat: 0, bp: 0 };
    cur.n++; cur.cheat += saved.cheat; cur.bp += saved.bp;
    burnByEr.set(er, cur);
  }
  console.log(`v132 全量 ${total} 行：cheat 真烧(analyzed)=${cheatBurned} / cheat 粘滞秒回(cached)=${cheatCached} / BP 烧=${bpBurned}`);
  console.log('\n按当时拒因分布（n / cheat烧 / BP烧）:');
  for (const [er, v] of [...burnByEr.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${String(v.n).padStart(5)}  cheat=${String(v.cheat).padStart(4)}  bp=${String(v.bp).padStart(4)}  ${er}`);
  // BP 单次 token 采样
  let bpTok = 0, bpN = 0;
  for (const s of rows) { const u = s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.usage; if (u && u.input_tokens) { bpTok += u.input_tokens + (u.output_tokens || 0); bpN++; } }
  if (bpN) console.log(`\nBP 单次均 token=${Math.round(bpTok / bpN)}（${bpN} 次采样）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
