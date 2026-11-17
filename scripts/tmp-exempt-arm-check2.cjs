// 豁免臂 A 验证·修正版（2026-11-15，182 跑）：首两波臂新增挡票全量（基线∩簇臂成交∧ext 无成交——parity 口径）
// 逐张取基线首 BUY 信号 metadata.price（USD 计价）→ 相对常量发行价（USD 域=BNB 常量×745）。
const { dbManager } = require('../src/services/dbManager.js');
const CONST_USD = 4496173469e-18 * 745; // fourmeme 主流档常量 × T84 换算率
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

async function boughtSet(c, expIdArg) {
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
    if (t.success === false || t.trade_direction !== 'buy') continue;
    const v = t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0);
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    e.buyBnb += v;
  }
  for (const t of rows) {
    if (t.success === false || t.trade_direction !== 'sell') continue;
    const v = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0);
    const e = m.get(t.token_address);
    if (e) e.sellBnb += v;
  }
  for (const [, e] of m) e.net = e.sellBnb - e.buyBnb;
  return m;
}

async function main() {
  const c = await dbManager.getClient();
  for (const w of Object.values(W)) {
    const idB = await expId(c, w.base), idC = await expId(c, w.cluster), idE = await expId(c, w.ext);
    const base = await boughtSet(c, idB), clu = await boughtSet(c, idC), ext = await boughtSet(c, idE);
    const newBlock = [...base.keys()].filter((k) => clu.has(k) && !ext.has(k));
    console.log(`\n===== ${w.tag} 首两波臂新增挡 ${newBlock.length} 票（常量锚 USD 域，<=0 即 A 臂豁免放行）=====`);
    for (const k of newBlock) {
      const { data: sig } = await c.from('strategy_signals')
        .select('created_at,metadata')
        .eq('experiment_id', idB).eq('token_address', k).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).limit(1);
      const e = base.get(k);
      if (!sig || !sig[0]) { console.log(`  ${(e.sym || '?').slice(0, 12).padEnd(13)} 净${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  基线无信号行（不适用）`); continue; }
      const price = Number((sig[0].metadata || {}).price || 0);
      if (!price) { console.log(`  ${(e.sym || '?').slice(0, 12).padEnd(13)} 净${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  metadata.price 缺失`); continue; }
      const vs = (price / CONST_USD - 1) * 100;
      console.log(`  ${(e.sym || '?').slice(0, 12).padEnd(13)} 净${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  fire=${sig[0].created_at.slice(11, 19)} 常量锚 ${vs >= 0 ? '+' : ''}${vs.toFixed(1)}%${vs <= 0 ? '  ←A臂放行' : ''}  ${k}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
