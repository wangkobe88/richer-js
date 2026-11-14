// 一次性探针：pump 盘斜率稳定性锚分离度——锚窗可靠价序列回归 R²（log 价/原始价）立项票 vs 反例票（182 跑）
const { dbManager } = require('../../src/services/dbManager.js');

// [caseId, addr, anchor]（全部 v70 f0898589 信号票，锚=生产首析行）
const CASES = [
  ['CD166 火龙果树(pump 立项)', '0xea44b0c60475cca4ad0f86790735af115e3c7777', 25],
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
  const slope = sxy / sxx;
  return { r2: (sxy * sxy) / (sxx * syy), slope };
}

async function main() {
  const client = await dbManager.getClient();
  console.log('case | 可靠价点数 | 窗长(s) | 价格轨迹 | R2(log价) | R2(原始价) | log斜率%/min | 首末涨幅%');
  for (const [id, addr, anchor] of CASES) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier')
      .eq('token_address', addr)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(anchor);
    if (error) throw error;
    const rel = (data || []).filter((r) => r.price_bnb != null && !r.price_outlier)
      .map((r) => [new Date(r.block_time).getTime() / 1000, Number(r.price_bnb)]);
    if (rel.length < 3) { console.log(`${id} | ${rel.length}（点数不足）`); continue; }
    const t0 = rel[0][0];
    const xs = rel.map(([t]) => t - t0);
    const logP = rel.map(([, p]) => Math.log(p));
    const linP = rel.map(([, p]) => p);
    const g1 = regress(xs.map((x, i) => [x, logP[i]]));
    const g2 = regress(xs.map((x, i) => [x, linP[i]]));
    const span = xs[xs.length - 1];
    const rise = (rel[rel.length - 1][1] / rel[0][1] - 1) * 100;
    console.log(`${id} | ${rel.length} | ${span.toFixed(0)} | ${(rise >= 0 ? '升' : '跌')}${Math.abs(rise).toFixed(1)}% | ${g1 ? g1.r2.toFixed(4) : '-'} | ${g2 ? g2.r2.toFixed(4) : '-'} | ${g1 ? (g1.slope * 60 * 100).toFixed(2) : '-'} | ${rise.toFixed(1)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
