// 一次性探针 3：pump 盘三判据联合分离度（182 跑）——用户判据：
// ① 斜率稳定（某长阶段）② 涨幅与买量不匹配（很少流动性推很大涨幅）③ 卖方长期缺失
// 对 7 票锚窗（as-of）+ CD166 拉升段（锚后长阶段）分别计算，看分离度
const { dbManager } = require('../../src/services/dbManager.js');

// [caseId, addr, anchor]（v70 信号票：CD166=立项，其余=反例）
const CASES = [
  ['CD166 火龙果树(pump)', '0xea44b0c60475cca4ad0f86790735af115e3c7777', 25],
  ['CD165 币安分红', '0x7c1e61ce0caa3a74d0bd2a01c0d0690e79a57777', 32],
  ['CD167 相信币安', '0xe931945a412fee281789bb495434eb61deae7777', 25],
  ['CD169 厉娜', '0x65a4c2da0aa16945cdf610c012d71c5906017777', 25],
  ['CD170 豆豆', '0xdd42eec51757028333981d342d302807b3957777', 18],
  ['CD172 厉娜', '0xa3c24f0c1fee7840967a440e5c34b18369767777', 29],
  ['CD179 MFD', '0x040b6766346b465b2a8403ecfd2bdfb9ffe07777', 20],
];

function regress(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of points) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return { r2: (sxy * sxy) / (sxx * syy), slope: sxy / sxx };
}

// 判据①：最长稳定斜率子段——O(n²) 枚举所有连续子段，取 R²(log)≥0.95 中最长
function longestStable(rel) {
  let best = { len: 0, span: 0, r2: 0, slope: 0, n: 0 };
  for (let i = 0; i < rel.length; i++) {
    for (let j = i + 3; j <= rel.length; j++) {
      const pts = rel.slice(i, j).map(([t, p], k) => [t - rel[i][0], Math.log(p)]);
      const g = regress(pts);
      if (g && g.r2 >= 0.95) {
        const span = rel[j - 1][0] - rel[i][0];
        if (span > best.span) best = { len: j - i, span, r2: g.r2, slope: g.slope, n: rel.length };
      }
    }
  }
  return best;
}

// 三判据：rows=锚窗全行（含买卖），rel=可靠价 [ts,price]
function triad(name, rows) {
  const rel = rows.filter((r) => r.price_bnb != null && !r.price_outlier)
    .map((r) => [new Date(r.block_time).getTime() / 1000, Number(r.price_bnb)]);
  if (rel.length < 4) { console.log(`${name} | 可靠价点不足(${rel.length})`); return; }
  const buys = rows.filter((r) => r.trade_type === 'buy');
  const sells = rows.filter((r) => r.trade_type === 'sell');
  const bnb = (a) => a.reduce((s, r) => s + Number(r.bnb_amount || 0), 0);
  const buyBnb = bnb(buys), sellBnb = bnb(sells);
  const p0 = rel[0][1], p1 = rel[rel.length - 1][1];
  const rise = (p1 / p0 - 1) * 100;
  const logRise = Math.log(p1 / p0); // 判据②：log 涨幅/买 BNB（量纲稳）
  const perBnb = logRise / Math.max(buyBnb, 0.001);
  const sellPct = rows.length ? (sells.length / rows.length) * 100 : 0;
  const st = longestStable(rel);
  const span = rel[rel.length - 1][0] - rel[0][0];
  console.log(
    `${name} | ${String(rows.length).padStart(3)} 行/${String(span.toFixed(0)).padStart(5)}s | 升${rise.toFixed(1)}%` +
    ` | 买 ${buyBnb.toFixed(2)}bnb(${buys.length}笔) 卖 ${sellBnb.toFixed(2)}bnb(${sells.length}笔,${sellPct.toFixed(0)}%)` +
    ` | log涨幅/买bnb=${perBnb.toFixed(2)}` +
    ` | 稳定段 ${st.span.toFixed(0)}s/${st.len}点 R2=${st.r2.toFixed(3)} 斜率${(st.slope * 60 * 100).toFixed(1)}%/min`
  );
}

async function main() {
  const client = await dbManager.getClient();

  console.log('===== A. 各票锚窗（as-of，行数=生产锚）=====');
  for (const [id, addr, anchor] of CASES) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier,trade_type,bnb_amount')
      .eq('token_address', addr)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(anchor);
    if (error) throw error;
    triad(`${id}`, data || []);
  }

  console.log('\n===== B. CD166 锚后长阶段（拉升段=砸盘前 / 砸盘后躺死 / 锚后全史）=====');
  const { data: full, error: e2 } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,price_outlier,trade_type,bnb_amount')
    .eq('token_address', CASES[0][1])
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(400);
  if (e2) throw e2;
  const rows = full || [];
  // 砸盘桶=锚后首个 5 行窗内 ≥4 卖的位置（CD166 形状：单桶 56 笔卖）
  const dumpIdx = rows.slice(25).findIndex((r, i) => rows.slice(25 + i, 25 + i + 5).filter((x) => x.trade_type === 'sell').length >= 4);
  const cut = dumpIdx > 0 ? 25 + dumpIdx : rows.length;
  triad('拉升段(锚后→砸盘前)', rows.slice(25, cut));
  triad('砸盘及躺死段', rows.slice(cut));
  triad('锚后全史', rows.slice(25));

  // 对照：反例票「锚后全史」同口径（判据在长窗是否误伤）
  console.log('\n===== C. 反例票锚后全史（判据②③在长窗的误伤对照）=====');
  for (const [id, addr] of CASES.slice(1)) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier,trade_type,bnb_amount')
      .eq('token_address', addr)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(400);
    if (error) throw error;
    triad(`${id} 锚后全史`, (data || []).slice(0));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
