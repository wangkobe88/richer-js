// 一次性（182 跑 v2）：quote 盘（flap 非 BNB 计价）首 tick BNB 域价分布。
// v1 教训：wss_events kind 大窗查询 statement timeout → 改不排序 limit 400。
// price_bnb 列已换算 BNB 域（collector 落库换算，头注释+赵公主三列自洽实证）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: qs, error: e1 } = await c.from('wss_events')
    .select('token_address').eq('kind', 'token_quote_set').limit(400);
  if (e1) throw e1;
  const tokens = [...new Set((qs || []).map((r) => r.token_address))];
  console.log('quote_set 票数:', tokens.length);

  const out = [];
  let done = 0, empty = 0, errs = 0;
  const pool = tokens.slice();
  async function worker() {
    while (pool.length) {
      const t = pool.shift();
      try {
        const { data, error } = await c.from('wss_price_ticks')
          .select('price_bnb,bnb_amount,token_amount,price_outlier').eq('token_address', t)
          .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(5);
        if (error) { errs++; }
        else if (data && data.length && data[0].price_bnb > 0) {
          const first = data[0].price_bnb;
          // 前 5 笔最低价（更接近池初始价 P₀：冲击前的早期低价）
          const earlyMin = Math.min(...data.map((r) => r.price_bnb).filter((v) => v > 0));
          out.push({ t, first, earlyMin, out1: data[0].price_outlier, n: data.length });
        } else { empty++; }
      } catch (e) { errs++; }
      done++;
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  console.log('有首 tick 样本:', out.length, '| 空(无ticks):', empty, '| 查询失败:', errs);

  const stat = (key) => {
    const vals = out.map((o) => o[key]).filter((v) => v > 0).sort((a, b) => a - b);
    if (!vals.length) return 'n=0';
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    return `n=${vals.length} min=${vals[0].toExponential(2)} p10=${q(0.1).toExponential(2)} p25=${q(0.25).toExponential(2)} p50=${q(0.5).toExponential(2)} p75=${q(0.75).toExponential(2)} p90=${q(0.9).toExponential(2)} max=${vals[vals.length - 1].toExponential(2)}`;
  };
  console.log('首 tick BNB 域价:', stat('first'));
  console.log('前5笔最低价    :', stat('earlyMin'));
  console.log('对照: FLAP BNB盘常量 5.546e-9 / FM 常量 4.496e-9 / 赵公主首 tick 8.258e-9');

  // 与常量的倍数分布（首 tick ÷ 5.546e-9）
  const FL = 6.14 / (107036752 + 1e9);
  const ratio = out.map((o) => o.first / FL).sort((a, b) => a - b);
  if (ratio.length) {
    const q = (p) => ratio[Math.min(ratio.length - 1, Math.floor(p * ratio.length))];
    console.log(`首tick/FL常量 倍数: p10=${q(0.1).toFixed(1)}x p25=${q(0.25).toFixed(1)}x p50=${q(0.5).toFixed(1)}x p75=${q(0.75).toFixed(1)}x p90=${q(0.9).toFixed(1)}x`);
    const within = ratio.filter((r) => r >= 0.5 && r <= 3).length;
    console.log(`落在 [0.5x,3x] 常量区间的票: ${within}/${ratio.length}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
