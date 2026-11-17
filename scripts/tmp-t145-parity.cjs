// T145 对拍（182 跑）：ladder v22 豁免臂换键翻面量化
// 四个 v116 门串实验（A 簇臂 bt-v116 / B 基线 bt-v119 / B 簇臂 bt-v120 / C 基线 bt-v124）
// 全部买入信号票：per token 拉 ticks 算 v21 键（现价 vs 常量）与 v22 键
// （滚动最低 vs min(常量,首买价)），输出三类翻面 + 盈亏
const { dbManager } = require('../src/services/dbManager.js');

const FM = 4496173469e-18;
const FL = 6.14 / (107036752 + 1e9);

const EXPS = [
  ['A-簇臂', 'aa8fb3b3-d4fe-4770-bcd2-b4bd34409b26'],
  ['B-基线', '883e2513-ee2a-400e-8e58-7ce789adc205'],
  ['B-簇臂', '415b4ea0-d7ac-4b00-b58b-df38b3574624'],
  ['C-基线', 'cd40fc2a-ecfd-41c8-aa5e-7927fb11b985'],
];

async function main() {
  const c = await dbManager.getClient();
  for (const [win, expId] of EXPS) {
    const { data: sigs } = await c.from('strategy_signals')
      .select('id,token_address,created_at,metadata')
      .eq('experiment_id', expId)
      .eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(500);
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
      const age = tf.tokenAgeSec;
      if (age === undefined || age === null || age > 60) continue; // 首两波门只在 age≤60 生效
      // 拉该 token 信号时刻前的可靠 ticks
      const { data: ticks } = await c.from('wss_price_ticks')
        .select('block_time,price_bnb,trade_type,price_outlier,platform')
        .eq('token_address', addr)
        .lte('block_time', s.created_at)
        .eq('price_outlier', false)
        .order('block_time', { ascending: true }).limit(2000);
      if (!ticks || !ticks.length) continue;
      const plat = ticks[0].platform;
      const CONST = plat === 'flap' ? FL : FM;
      let firstBuy = null, minRel = Infinity, last = 0;
      for (const t of ticks) {
        const p = Number(t.price_bnb);
        if (!(p > 0)) continue;
        if (firstBuy === null && t.trade_type === 'buy') firstBuy = p;
        if (p < minRel) minRel = p;
        last = p;
      }
      if (!firstBuy || minRel === Infinity) continue;
      const v21 = parseFloat((100 * (last / CONST - 1)).toFixed(2));
      const floor = Math.min(CONST, firstBuy);
      const v22 = parseFloat((100 * (minRel / floor - 1)).toFixed(2));
      const p = pnl.get(addr);
      rows.push({ addr, age, v21, v22, net: p ? p.sell - p.buy : null, plat });
    }
    const exV21 = rows.filter(r => r.v21 <= 0);       // v21 豁免（现价破发）
    const exV22 = rows.filter(r => r.v22 < 0);        // v22 豁免（经历过破发）
    const gain = rows.filter(r => r.v21 > 0 && r.v22 < 0);  // 新放行（v21 挡→v22 豁免）
    const lost = rows.filter(r => r.v21 <= 0 && r.v22 >= 0); // 新拦截（v21 豁免→v22 挡）
    const sum = (arr) => arr.filter(r => r.net !== null).reduce((a, r) => a + r.net, 0);
    console.log(`\n== ${win}（age≤60 信号票 ${rows.length}；v21 豁免 ${exV21.length} / v22 豁免 ${exV22.length}）==`);
    console.log(`新放行（v21 挡 → v22 豁免）${gain.length} 票 净 ${sum(gain).toFixed(4)}：`);
    for (const r of gain) console.log(`  ${r.addr.slice(0, 10)} ${r.plat} age=${Math.round(r.age)}s v21=${r.v21} v22=${r.v22} net=${r.net === null ? '未成交' : r.net.toFixed(4)}`);
    console.log(`新拦截（v21 豁免 → v22 挡）${lost.length} 票 净 ${sum(lost).toFixed(4)}：`);
    for (const r of lost) console.log(`  ${r.addr.slice(0, 10)} ${r.plat} age=${Math.round(r.age)}s v21=${r.v21} v22=${r.v22} net=${r.net === null ? '未成交' : r.net.toFixed(4)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
