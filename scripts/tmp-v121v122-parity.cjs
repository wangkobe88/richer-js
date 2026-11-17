// bt-v121/v122（首两波扩展门门控臂）vs 基线 vs 簇臂 三行两窗归因（2026-11-15，182 跑）
// A 窗：v115(基线 34e78e97) / v116(簇臂 aa8fb3b3) / v121(扩展门 54dac9c5)
// B 窗：v119(基线 883e2513) / v120(簇臂 415b4ea0) / v122(扩展门 631bd2c2)
// 核心输出：v121 vs v115 挡票分解 =「簇臂重复挡（v116 也未买）」vs「首两波臂新增挡（v116 买了）」
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
  if (!data[0].id.startsWith(prefix)) throw new Error(name + ' 前缀不符: ' + data[0].id);
  if (data[0].status !== 'completed') throw new Error(name + ' 非终态: ' + data[0].status);
  return data[0].id;
}

async function pull(c, expId, tag) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
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
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, nBuy: 0, firstBuyAt: null }; byToken.set(t.token_address, e); }
    if (buy) { e.buyBnb += v; e.nBuy++; if (!e.firstBuyAt || t.created_at < e.firstBuyAt) e.firstBuyAt = t.created_at; }
    else { e.sellBnb += v; }
  }
  for (const [k, e] of byToken) e.net = e.sellBnb - e.buyBnb;
  const net = [...byToken.values()].reduce((s, e) => s + e.net, 0);
  const win = [...byToken.values()].filter((e) => e.net > 0).length;
  console.log(`${tag}: trades=${rows.length} tokens=${byToken.size} net=${net.toFixed(4)} win=${win}/${byToken.size}`);
  return byToken;
}

function detail(map, keys, headLine) {
  const arr = keys.map((k) => ({ k, ...map.get(k) })).sort((x, y) => y.net - x.net);
  const sum = arr.reduce((s, r) => s + r.net, 0);
  console.log(`${headLine} ${keys.length} 票净额合计=${sum >= 0 ? '+' : ''}${sum.toFixed(4)}（正票 ${arr.filter((r) => r.net > 0).length} 张 +${arr.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0).toFixed(4)} / 负票 ${arr.filter((r) => r.net <= 0).length} 张 ${arr.filter((r) => r.net <= 0).reduce((s, r) => s + r.net, 0).toFixed(4)}）`);
  for (const r of arr) if (Math.abs(r.net) >= 0.005)
    console.log(`  ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} ${(r.sym || '?').slice(0, 10).padEnd(11)} ${r.k} 买${r.nBuy}次`);
}

async function windowReport(c, wTag, w) {
  console.log(`\n########## ${wTag} 窗 ##########`);
  const idBase = await loadExp(c, w.base[0], w.base[1]);
  const idClu = await loadExp(c, w.cluster[0], w.cluster[1]);
  const idExt = await loadExp(c, w.ext[0], w.ext[1]);
  const base = await pull(c, idBase, wTag + ' 基线  ' + w.base[1].slice(0, 6));
  const clu = await pull(c, idClu, wTag + ' 簇臂  ' + w.cluster[1].slice(0, 6));
  const ext = await pull(c, idExt, wTag + ' 扩展门' + w.ext[1].slice(0, 6));

  // 扩展门 vs 基线
  const blockedByExt = [...base.keys()].filter((k) => !ext.has(k)); // 基线买了、扩展门没买=扩展门挡票全量
  const bothBE = [...base.keys()].filter((k) => ext.has(k));
  const sum = (m, ks) => ks.reduce((s, k) => s + m.get(k).net, 0);
  console.log(`\n== ${wTag} 扩展门 vs 基线 ==`);
  console.log(`共同 ${bothBE.length} 票 net: 基线=${sum(base, bothBE).toFixed(4)} 扩展门=${sum(ext, bothBE).toFixed(4)} Δ=${(sum(ext, bothBE) - sum(base, bothBE)).toFixed(4)}`);
  detail(base, blockedByExt, `[扩展门挡票全量]`);
  // 分解：簇臂重复挡 vs 首两波臂新增挡
  const dupWithClu = blockedByExt.filter((k) => !clu.has(k)); // 簇臂也没买=簇臂重复挡
  const newBlock = blockedByExt.filter((k) => clu.has(k));    // 簇臂买了=首两波臂新增挡（核心）
  detail(base, dupWithClu, '[其中簇臂已挡（v19 重复，非新增）]');
  detail(base, newBlock, '[首两波臂新增挡（v20 增量效应）★]');
  // 共同票漂移
  const drift = bothBE.filter((k) => Math.abs(ext.get(k).net - base.get(k).net) >= 0.03);
  const dAll = bothBE.reduce((s, k) => s + ext.get(k).net - base.get(k).net, 0);
  const fbDiff = bothBE.filter((k) => ext.get(k).firstBuyAt !== base.get(k).firstBuyAt);
  console.log(`[共同票漂移] Δ 合计=${dAll >= 0 ? '+' : ''}${dAll.toFixed(4)}，|Δ|>=0.03 票 ${drift.length} 张，首买时刻不同 ${fbDiff.length} 张`);
  for (const k of drift.slice(0, 10))
    console.log(`  Δ=${(ext.get(k).net - base.get(k).net) >= 0 ? '+' : ''}${(ext.get(k).net - base.get(k).net).toFixed(4)} ${(base.get(k).sym || '?').slice(0, 10)} ${ext.get(k).firstBuyAt !== base.get(k).firstBuyAt ? '[首买不同]' : ''}`);

  // 簇臂 vs 基线（复算一遍对照，供核）
  const blockedByClu = [...base.keys()].filter((k) => !clu.has(k));
  detail(base, blockedByClu, `[簇臂挡票（对照=v19 已知面）]`);

  // 扩展门 vs 簇臂（净差=扩展门总增量）
  const onlyClu = [...clu.keys()].filter((k) => !ext.has(k));
  const onlyExt = [...ext.keys()].filter((k) => !clu.has(k));
  detail(clu, onlyClu, `[扩展门比簇臂多挡（簇臂买/扩展门不买）]`);
  detail(ext, onlyExt, `[扩展门比簇臂新进（簇臂没买/扩展门买）=晚入路径 60s 后触发]`);
  const extNet = [...ext.values()].reduce((s, e) => s + e.net, 0);
  const cluNet = [...clu.values()].reduce((s, e) => s + e.net, 0);
  console.log(`[${wTag} 净额对比] 基线=${[...base.values()].reduce((s, e) => s + e.net, 0).toFixed(4)} 簇臂=${cluNet.toFixed(4)} 扩展门=${extNet.toFixed(4)}；扩展门-基线=${(extNet - [...base.values()].reduce((s, e) => s + e.net, 0)).toFixed(4)} 扩展门-簇臂=${(extNet - cluNet).toFixed(4)}`);
}

async function main() {
  const c = await dbManager.getClient();
  await windowReport(c, 'C', W.C);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
