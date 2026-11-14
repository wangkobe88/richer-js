// 一次性探针 6：pump 票逐信号锚三判据（182 跑）——token+锚列表参数化，验证组合门命中
// 用法：node tmp-pump-signal3-probe.cjs <addr> <锚1,锚2,...> [全史帽]
const { dbManager } = require('../../src/services/dbManager.js');

const TOKEN = process.argv[2];
const ANCHORS = (process.argv[3] || '').split(',').map(Number).filter(Boolean);
const FULL_CAP = Number(process.argv[4] || 0);

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

function longestStable(rel) {
  let best = { len: 0, span: 0, r2: 0, slope: 0 };
  for (let i = 0; i < rel.length; i++) {
    for (let j = i + 3; j <= rel.length; j++) {
      const pts = rel.slice(i, j).map(([t, p]) => [t - rel[i][0], Math.log(p)]);
      const g = regress(pts);
      if (g && g.r2 >= 0.95) {
        const span = rel[j - 1][0] - rel[i][0];
        if (span > best.span) best = { len: j - i, span, r2: g.r2, slope: g.slope };
      }
    }
  }
  return best;
}

function triad(name, win) {
  const rel = win.filter((r) => r.price_bnb != null && !r.price_outlier)
    .map((r) => [new Date(r.block_time).getTime() / 1000, Number(r.price_bnb)]);
  if (rel.length < 4) { console.log(`${name} | 可靠价点不足(${rel.length})`); return; }
  const buys = win.filter((r) => r.trade_type === 'buy');
  const sells = win.filter((r) => r.trade_type === 'sell');
  const buyBnb = buys.reduce((s, r) => s + Number(r.bnb_amount || 0), 0);
  const sellBnb = sells.reduce((s, r) => s + Number(r.bnb_amount || 0), 0);
  const p0 = rel[0][1], p1 = rel[rel.length - 1][1];
  const rise = (p1 / p0 - 1) * 100;
  const perBnb = Math.log(p1 / p0) / Math.max(buyBnb, 0.001);
  const sellPct = (sells.length / win.length) * 100;
  const st = longestStable(rel);
  const hit = st.len >= 15 && perBnb >= 0.15 && sellPct <= 20 && st.slope > 0;
  console.log(
    `${name} | ${win.length} 行 | 升${rise.toFixed(1)}%` +
    ` | 买 ${buyBnb.toFixed(2)}bnb/${buys.length}笔 卖 ${sells.length}笔(${sellPct.toFixed(0)}%)/${sellBnb.toFixed(2)}bnb` +
    ` | perBnb=${perBnb.toFixed(2)} | 稳定段 ${st.span.toFixed(0)}s/${st.len}点 R2=${st.r2.toFixed(3)} 斜率${(st.slope * 60 * 100).toFixed(1)}%/min` +
    (hit ? ' | ★组合门命中' : '')
  );
}

async function main() {
  const client = await dbManager.getClient();
  const cap = Math.max(...ANCHORS, FULL_CAP, 30);
  const { data, error } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,price_outlier,trade_type,bnb_amount')
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(cap);
  if (error) throw error;
  const rows = data || [];
  console.log(`token=${TOKEN.slice(0, 10)}… 首=${rows[0].block_time.slice(11, 19)} 末=${rows[rows.length - 1].block_time.slice(11, 19)} 共${rows.length}行`);
  for (const a of ANCHORS) {
    triad(`锚=${a}`, rows.slice(0, a));
  }
  if (FULL_CAP) {
    triad(`全史(≤${FULL_CAP})`, rows);
    // 最后 60 行（砸盘后形态）
    if (rows.length > FULL_CAP - 60) triad(`尾部60行`, rows.slice(-60));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
