// v121/v122「首两波臂新增挡」票拒因分类（2026-11-15，182 跑）：
//   newBlock 票（base∩簇臂买了、扩展门没买）逐张查 ext 的 BUY 信号行：
//   无行=门串真拦（condition 层）；有行 exec=false=门链拒（cheat/BP Jev 方差嫌疑）。
const { dbManager } = require('../src/services/dbManager.js');
const W = {
  C: {
    base: ['cd40fc2a', 'bt-v124-c-baseline-v116strat'],
    cluster: ['f31d615f', 'bt-v125-c-cluster-gate-v116strat'],
    ext: ['8eddeb38', 'bt-v126-c-firstwave-gate'],
  },
};

async function loadExp(c, prefix, name) {
  const { data, error } = await c.from('experiments').select('id,status').ilike('experiment_name', name + '%').limit(1);
  if (error || !data[0]) throw new Error(name + ' 读取失败: ' + (error && error.message));
  if (!data[0].id.startsWith(prefix)) throw new Error(name + ' 前缀不符');
  return data[0].id;
}

async function pull(c, expId) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', expId).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const byToken = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy
      ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0)
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0);
    let e = byToken.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; byToken.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  for (const [, e] of byToken) e.net = e.sellBnb - e.buyBnb;
  return byToken;
}

async function main() {
  const c = await dbManager.getClient();
  for (const [wTag, w] of Object.entries(W)) {
    if (wTag !== 'C') continue;
    const idBase = await loadExp(c, w.base[0], w.base[1]);
    const idClu = await loadExp(c, w.cluster[0], w.cluster[1]);
    const idExt = await loadExp(c, w.ext[0], w.ext[1]);
    const base = await pull(c, idBase);
    const clu = await pull(c, idClu);
    const ext = await pull(c, idExt);
    const blockedByExt = [...base.keys()].filter((k) => !ext.has(k));
    const newBlock = blockedByExt.filter((k) => clu.has(k)); // 首两波臂新增挡
    console.log(`\n########## ${wTag} 窗 首两波臂新增挡 ${newBlock.length} 票 ##########`);
    const buckets = { gateBlocked: [], chainRejected: [], other: [] };
    for (const k of newBlock) {
      const { data: sig, error } = await c.from('strategy_signals')
        .select('created_at,executed,er:metadata->>execution_reason')
        .eq('experiment_id', idExt).eq('token_address', k).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).limit(3);
      if (error) throw new Error(k + ': ' + error.message);
      const e = { k, sym: base.get(k).sym, net: base.get(k).net, sig };
      if (!sig || sig.length === 0) buckets.gateBlocked.push(e);
      else if (sig.every((s) => s.executed === false)) buckets.chainRejected.push(e);
      else buckets.other.push(e);
    }
    for (const [name, arr] of Object.entries(buckets)) {
      const sum = arr.reduce((s, e) => s + e.net, 0);
      console.log(`\n== [${name}] ${arr.length} 票 机会净额(base.net 合计)=${sum >= 0 ? '+' : ''}${sum.toFixed(4)} ==`);
      for (const e of arr.sort((x, y) => y.net - x.net)) {
        const reasons = e.sig && e.sig.length
          ? e.sig.map((s) => `${s.created_at.slice(11, 19)}:${s.er || '?'}`).join(' | ')
          : '(无信号行=门串拦)';
        console.log(`  ${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)} ${(e.sym || '?').slice(0, 12).padEnd(13)} ${e.k} ${reasons}`);
      }
    }
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
