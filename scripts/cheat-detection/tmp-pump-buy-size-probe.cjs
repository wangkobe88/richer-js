// 一次性探针 4：pump 盘判据④——单笔买额度分布（182 跑）。用户判据「买入额度也不是正常用户的额度」：
// 拉升脚本的买入单笔额度形状（小而整齐/等额聚集）vs 正常散户分布
const { dbManager } = require('../../src/services/dbManager.js');

const CASES = [
  ['CD166 火龙果树(pump)', '0xea44b0c60475cca4ad0f86790735af115e3c7777', 25],
  ['CD165 币安分红', '0x7c1e61ce0caa3a74d0bd2a01c0d0690e79a57777', 32],
  ['CD167 相信币安', '0xe931945a412fee281789bb495434eb61deae7777', 25],
  ['CD169 厉娜', '0x65a4c2da0aa16945cdf610c012d71c5906017777', 25],
  ['CD170 豆豆', '0xdd42eec51757028333981d342d302807b3957777', 18],
  ['CD172 厉娜', '0xa3c24f0c1fee7840967a440e5c34b18369767777', 29],
  ['CD179 MFD', '0x040b6766346b465b2a8403ecfd2bdfb9ffe07777', 20],
];

function stats(name, rows) {
  const buys = rows.filter((r) => r.trade_type === 'buy').map((r) => Number(r.bnb_amount || 0)).filter((v) => v > 0);
  if (buys.length < 5) { console.log(`${name} | 买笔不足(${buys.length})`); return; }
  const sorted = [...buys].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const mean = buys.reduce((s, v) => s + v, 0) / buys.length;
  const cv = Math.sqrt(buys.reduce((s, v) => s + (v - mean) ** 2, 0) / buys.length) / mean; // 变异系数：越小越整齐
  // 等额聚集：toFixed(3)（0.001 BNB 精度）同值最大桶占比 + toFixed(2)
  const byKey = (prec) => {
    const m = new Map();
    for (const v of buys) { const k = v.toFixed(prec); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1])[0];
  };
  const top3k = byKey(3), top2k = byKey(2);
  console.log(
    `${name} | ${buys.length} 笔 | 中位 ${med.toFixed(3)} | 均值 ${mean.toFixed(3)} | min ${sorted[0].toFixed(3)} max ${sorted[sorted.length - 1].toFixed(3)}` +
    ` | CV=${cv.toFixed(2)} | 0.001精度最大同值桶 ${top3k[1]}/${buys.length}(${(top3k[1] / buys.length * 100).toFixed(0)}% @${top3k[0]})` +
    ` | 0.01精度最大同值桶 ${top2k[1]}/${buys.length}(${(top2k[1] / buys.length * 100).toFixed(0)}% @${top2k[0]})`
  );
}

async function main() {
  const client = await dbManager.getClient();
  console.log('===== A. 锚窗内（as-of）=====');
  for (const [id, addr, anchor] of CASES) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('trade_type,bnb_amount')
      .eq('token_address', addr)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(anchor);
    if (error) throw error;
    stats(`${id}`, data || []);
  }

  console.log('\n===== B. CD166 关键阶段 =====');
  const { data: full, error: e2 } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount')
    .eq('token_address', CASES[0][1])
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(400);
  if (e2) throw e2;
  const rows = full || [];
  stats('拉升段(行25→砸盘前)', rows.slice(25, 69));
  stats('砸盘及躺死段', rows.slice(69));

  console.log('\n===== C. 反例票锚后全史（误伤对照）=====');
  for (const [id, addr] of CASES.slice(1)) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('trade_type,bnb_amount')
      .eq('token_address', addr)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(400);
    if (error) throw error;
    stats(`${id} 锚后全史`, data || []);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
