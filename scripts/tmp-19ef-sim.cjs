// bt-v134 (19ef6433)：用 executed 信号 trendFactors 模拟 ladder v18~v22 门串再过滤 + BP 段结构探测
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).range(0, 999);
  const m = new Map();
  for (const t of rows || []) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  const nets = [...m.entries()].map(([addr, e]) => ({ addr, sym: e.sym, net: e.sellBnb - e.buyBnb }));

  let all = [];
  for (let off = 0; off < 3000; off += 1000) {
    const { data } = await c.from('strategy_signals')
      .select('token_address,signal_type,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').range(off, off + 999);
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const exec = all.filter((s) => (s.metadata || {}).execution_status === 'executed');
  console.log(`executed signals: ${exec.length}`);
  // 探一行结构
  const p = exec[0].metadata || {};
  console.log('metadata keys:', Object.keys(p).join(','));
  const tf0 = p.trendFactors || {};
  const hasAge = 'tokenAgeSec' in tf0, hasClu = 'launchBundleClusterSize' in tf0;
  console.log(`trendFactors keys(${Object.keys(tf0).length}):`, Object.keys(tf0).join(','));
  const bp = p.buyPoint || p.buyPointCheck || null;
  console.log('buyPoint-like:', JSON.stringify(bp && Object.keys(bp)));

  // v18~v22 门串模拟：挡 = age<=60 且 (簇>=3 或 f0>=2 或 wave>=3) 且 非经历过破发(launchMinVsFloorPct>=0)；t0/t0a 臂另加 age<15 拒
  // 注意快照是 fire 时刻因子；簇/年龄字段缺失=旧快照(v17 实验 FA 版本可能无 f0/wave/minVs 键)→记录缺失面
  let v18Block = [], v19Block = [], missing = 0, both = 0;
  const perToken = new Map(); // addr -> {net, legs:[{leg,tf}]}
  for (const s of exec) {
    const md = s.metadata || {};
    const tf = md.trendFactors || {};
    const gate = md.signalGate || {};
    const leg = gate.legId || md.strategyId || '?';
    if (!perToken.has(s.token_address)) {
      const n = nets.find((x) => x.addr === s.token_address);
      perToken.set(s.token_address, { net: n ? n.net : 0, sym: n ? n.sym : '?', legs: [] });
    }
    perToken.get(s.token_address).legs.push({ leg, tf, trig: gate.triggerNo });
  }
  console.log(`\nper-token with exec signals: ${perToken.size}`);
  // 快照字段覆盖面
  let cov = { age: 0, clu: 0, f0: 0, wave: 0, minVs: 0, constVs: 0 };
  for (const [, v] of perToken) for (const l of v.legs) {
    const t = l.tf;
    if (t.tokenAgeSec != null) cov.age++;
    if (t.launchBundleClusterSize != null) cov.clu++;
    if (t.launchFirstBlockWallets != null) cov.f0++;
    if (t.launchFirstWaveWallets != null) cov.wave++;
    if (t.launchMinVsFloorPct != null) cov.minVs++;
    if (t.launchConstVsPct != null) cov.constVs++;
  }
  const totalLegs = [...perToken.values()].reduce((s2, v) => s2 + v.legs.length, 0);
  console.log('快照覆盖(legs):', JSON.stringify({ totalLegs, ...cov }));

  // 模拟：v18 年龄门（只对 t0/t0a 臂 = buy_0_1 / buy_0_2 假设前两个早臂）→ 先确认腿 id 分布
  const legDist = new Map();
  for (const [, v] of perToken) for (const l of v.legs) legDist.set(l.leg, (legDist.get(l.leg) || 0) + 1);
  console.log('leg 分布:', JSON.stringify([...legDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)));

  // 逐票模拟门串（v19/v20/v22 簇门全腿 + v18 年龄门早臂）
  let sumBlock = 0, sumKeep = 0, blockList = [], falseHit = [];
  for (const [addr, v] of perToken) {
    // 该票任一 executed 腿若被 v18-v22 挡住（按首 exec 腿近似——v17 实际只有 t0 有 maxTriggers 2）
    const first = v.legs[0];
    const t = first.tf;
    const age = t.tokenAgeSec, clu = t.launchBundleClusterSize, f0 = t.launchFirstBlockWallets, wave = t.launchFirstWaveWallets;
    const minVs = t.launchMinVsFloorPct;
    const isEarlyArm = /^(buy_0_)/.test(first.leg);
    const ageBlock = isEarlyArm && age != null && age < 15;
    const exempt = minVs != null ? minVs < 0 : false; // 经历过破发豁免
    const cluBlock = age != null && age <= 60 && (clu != null || f0 != null || wave != null)
      ? ((clu != null && clu >= 3) || (f0 != null && f0 >= 2) || (wave != null && wave >= 3)) && !exempt
      : false;
    if (ageBlock || cluBlock) { sumBlock += v.net; blockList.push({ ...v, addr, why: `${ageBlock ? 'age<15' : ''}${ageBlock && cluBlock ? '+' : ''}${cluBlock ? 'clu' : ''}`, age, clu, f0, wave, minVs }); }
    else sumKeep += v.net;
  }
  console.log(`\n== v18~v22 门串再过滤模拟（首 exec 腿近似）==`);
  console.log(`被挡 ${blockList.length} 票 净额 ${sumBlock.toFixed(4)}（负=止血正=误伤）；保留票净额 ${sumKeep.toFixed(4)}`);
  blockList.sort((a, b) => a.net - b.net);
  for (const b of blockList.slice(0, 20)) console.log(`${b.net.toFixed(4)} ${b.sym} ${b.why} age=${b.age} clu=${b.clu} f0=${b.f0} wave=${b.wave} minVs=${b.minVs}`);
  const hurt = blockList.filter((b) => b.net > 0).reduce((s2, b) => s2 + b.net, 0);
  const save = blockList.filter((b) => b.net < 0).reduce((s2, b) => s2 + b.net, 0);
  console.log(`止血面 ${save.toFixed(4)} / 误伤面 +${hurt.toFixed(4)} / 净效应 ${(save + hurt).toFixed(4)}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
