// T145 顺带调查（二）：v20 期跑的三窗实验（bt-v121/123/126）里 v20 门串放行票中
// 的 XOR 差集（f0≥2 XOR wave≥3，age≤60∧簇<3）=「挡侧 OR 化」提议的新增拦截面盈亏
const { dbManager } = require('../src/services/dbManager.js');

const EXPS = [
  ['A-v20', '54dac9c5-6fdf-4759-8b5a-2195313b6820'], // bt-v121-a-firstwave-gate
  ['B-v20', 'f454a704-706e-48d4-8049-6f885f9ae46b'], // bt-v123-b-firstwave-gate-rerun
  ['C-v20', 'f31d615f-a81e-4012-a52f-67eed65ae28d'], // bt-v125-c-cluster-gate（v19 期? 兜底扫）
];

async function main() {
  const c = await dbManager.getClient();
  for (const [win, expId] of EXPS) {
    const { data: sigs } = await c.from('strategy_signals')
      .select('id,token_address,created_at,metadata')
      .eq('experiment_id', expId)
      .eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(400);
    const firstByToken = new Map();
    for (const s of sigs || []) {
      if (!firstByToken.has(s.token_address)) firstByToken.set(s.token_address, s);
    }
    const { data: trades } = await c.from('trades')
      .select('token_address,trade_direction,input_amount,output_amount,success')
      .eq('experiment_id', expId).eq('success', true);
    const pnl = new Map();
    for (const t of trades || []) {
      const cur = pnl.get(t.token_address) || { buy: 0, sell: 0 };
      if (t.trade_direction === 'buy') cur.buy += Number(t.input_amount);
      else cur.sell += Number(t.output_amount);
      pnl.set(t.token_address, cur);
    }
    const rows = [];
    for (const [addr, s] of firstByToken) {
      const tf = (s.metadata || {}).trendFactors || {};
      const f0 = tf.launchFirstBlockWallets, wave = tf.launchFirstWaveWallets;
      const clu = tf.launchBundleClusterSize, age = tf.tokenAgeSec;
      if (f0 === undefined || wave === undefined || clu === undefined || age === undefined) { rows.length; continue; }
      const p = pnl.get(addr);
      rows.push({ addr: addr.slice(0, 10), f0, wave, clu, age, net: p ? p.sell - p.buy : null });
    }
    const readable = rows.filter(r => r.age !== null).length;
    const inScope = rows.filter(r => r.age <= 60 && r.clu < 3);
    const xor = inScope.filter(r => (r.f0 >= 2) !== (r.wave >= 3));
    const sum = (arr) => arr.filter(r => r.net !== null).reduce((a, r) => a + r.net, 0);
    console.log(`\n== ${win}（首信号键可读 ${readable}，age≤60∧簇<3 ${inScope.length}，XOR 差集 ${xor.length} 净 ${sum(xor).toFixed(4)}）==`);
    for (const r of xor.sort((a, b) => (a.net ?? 0) - (b.net ?? 0))) {
      console.log(`  ${r.addr} f0=${r.f0} wave=${r.wave} clu=${r.clu} age=${Math.round(r.age)}s net=${r.net === null ? '未成交' : r.net.toFixed(4)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
