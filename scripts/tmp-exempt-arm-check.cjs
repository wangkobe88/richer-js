// 豁免臂选型验证（2026-11-15，182 跑）：三窗全部「门串真拦票」（ext 无 BUY 信号行 ∧ 基线有成交）
// 逐张取基线首 BUY 信号 fire 价 → 常量锚相对价（A 臂豁免条件 launchConstVsPct <= 0 是否漏放止血票）。
const { dbManager } = require('../src/services/dbManager.js');
const FOUR_CONST = 4496173469e-18;
const FLAP_CONST = 5.546e-9;
const W = {
  A: { base: '34e78e97', cluster: 'aa8fb3b3', ext: '54dac9c5', tag: 'A 窗' },
  B: { base: '883e2513', cluster: '415b4ea0', ext: 'f454a704', tag: 'B 窗' },
  C: { base: 'cd40fc2a', cluster: 'f31d615f', ext: '8eddeb38', tag: 'C 窗' },
};

async function expId(c, pre) {
  const { data } = await c.from('experiments').select('id').limit(500);
  const hit = data.find((e) => e.id.startsWith(pre));
  if (!hit) throw new Error(pre + ' 未找到');
  return hit.id;
}

async function netByToken(c, expIdArg) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', expIdArg).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buy: 0, sell: 0 }; m.set(t.token_address, e); }
    if (buy) e.buy += v; else e.sell += v;
  }
  for (const [, e] of m) e.net = e.sell - e.buy;
  return m;
}

async function main() {
  const c = await dbManager.getClient();
  for (const w of Object.values(W)) {
    const idB = await expId(c, w.base), idC = await expId(c, w.cluster), idE = await expId(c, w.ext);
    const base = await netByToken(c, idB), clu = await netByToken(c, idC);
    // 门串真拦票：基线∩簇臂买了、ext 无 BUY 信号行（gateBlocked）——首两波臂直接命中面
    const cand = [...base.keys()].filter((k) => clu.has(k));
    const { data: extSigs } = await c.from('strategy_signals')
      .select('token_address').eq('experiment_id', idE).eq('signal_type', 'BUY').limit(2000);
    const extTokens = new Set((extSigs || []).map((s) => s.token_address));
    const blocked = cand.filter((k) => !extTokens.has(k));
    console.log(`\n===== ${w.tag} 门串真拦 ${blocked.length} 票 =====`);
    for (const k of blocked) {
      const { data: sig } = await c.from('strategy_signals')
        .select('created_at,metadata')
        .eq('experiment_id', idB).eq('token_address', k).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).limit(1);
      const e = base.get(k);
      if (!sig || !sig[0]) { console.log(`  ${(e.sym || '?').slice(0, 12).padEnd(13)} 净${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  基线无信号行?`); continue; }
      const m = sig[0].metadata || {};
      const tf = m.trendFactors || {};
      const price = Number(m.price || tf.currentPriceBnb || 0);
      // platform 未知则按票地址平台查：flap 地址段难辨——用 metadata.tokenCreateTime? 直接两常量都算
      const vsF = (price / FOUR_CONST - 1) * 100, vsFl = (price / FLAP_CONST - 1) * 100;
      console.log(`  ${(e.sym || '?').slice(0, 12).padEnd(13)} 净${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  fire=${sig[0].created_at.slice(11, 19)} price=${price.toExponential(3)} 常量锚:fourmeme ${vsF >= 0 ? '+' : ''}${vsF.toFixed(1)}% / flap ${vsFl >= 0 ? '+' : ''}${vsFl.toFixed(1)}%  ${k}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
