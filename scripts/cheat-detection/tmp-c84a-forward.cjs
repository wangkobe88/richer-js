// 一次性（182 跑）：c84a 12:31:38 锚之后的完整走势——分桶价格轨迹 + 最大反弹点 + 终局（graduation/归零）。
const { dbManager } = require('../../src/services/dbManager.js');
const C84A = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const ANCHOR = '2026-11-05T12:31:38'; // 深挖锚（v101 信号 created_at=回测虚拟时钟，实际数据日 11-05；北京时间 20:31:38）

async function main() {
  const client = await dbManager.getClient();
  // 前向全量分页拉（block_number 升序）
  const rows = [];
  for (let off = 0; off < 5000; off += 1000) {
    const { data } = await client.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier')
      .eq('token_address', C84A)
      .gte('block_time', ANCHOR)
      .order('block_number', { ascending: true })
      .range(off, off + 999);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const rel = rows.filter((r) => !r.price_outlier && r.price_bnb > 0)
    .map((r) => ({ t: Date.parse(r.block_time), p: r.price_bnb, ty: r.trade_type, b: r.bnb_amount || 0 }))
    .sort((a, b) => a.t - b.t);
  const t0 = Date.parse(ANCHOR + 'Z');
  const covEnd = rel.length ? rel[rel.length - 1].t : t0;
  console.log(`锚=${ANCHOR}Z 前向行=${rows.length}（reliable ${rel.length}）覆盖至 +${((covEnd - t0) / 60000).toFixed(1)}min`);
  const base = rel.length ? rel[0].p : null;
  const f2 = (n) => (n == null ? '?' : (+n).toFixed(2));
  const pct = (p) => (base != null ? f2((p / base - 1) * 100) : '?');
  console.log(`锚后首可靠价=${base.toExponential(4)}`);

  // 全局最大反弹
  let hiP = null, hiT = null, loP = null, loT = null;
  for (const x of rel) { if (hiP == null || x.p > hiP) { hiP = x.p; hiT = x.t; } if (loP == null || x.p < loP) { loP = x.p; loT = x.t; } }
  if (hiP != null) console.log(`锚后最高=${hiP.toExponential(4)}（${pct(hiP)}%，+${((hiT - t0) / 1000).toFixed(0)}s） 最低=${loP.toExponential(4)}（${pct(loP)}%，+${((loT - t0) / 1000).toFixed(0)}s）`);

  // 分桶轨迹：前 5min 逐 30s，之后逐 2min 到 20min
  const bucket = (t0s, t1s) => {
    const inB = rel.filter((x) => x.t >= t0 + t0s * 1000 && x.t < t0 + t1s * 1000);
    if (!inB.length) return null;
    const buys = inB.filter((x) => x.ty === 'buy');
    const sells = inB.filter((x) => x.ty !== 'buy');
    const mx = Math.max(...inB.map((x) => x.p));
    return { n: inB.length, pS: inB[0].p, pE: inB[inB.length - 1].p, mx, bb: buys.reduce((s, x) => s + x.b, 0), sb: sells.reduce((s, x) => s + x.b, 0), bn: buys.length, sn: sells.length };
  };
  console.log(`\n-- 前 5min 逐 30s（段涨跌% vs 段首 / 累计% vs 锚后首价 / 段内最大 vs 锚后首价 / 买卖额）--`);
  for (let i = 0; i < 10; i++) {
    const b = bucket(i * 30, (i + 1) * 30);
    if (!b) { console.log(`+${i * 30}~${(i + 1) * 30}s 无行`); continue; }
    console.log(`+${i * 30}~${(i + 1) * 30}s n=${b.n} 段${f2((b.pE / b.pS - 1) * 100)}% 累计${pct(b.pE)}% 段内最大${pct(b.mx)}% 买${b.bn}/${b.bb.toFixed(2)}B 卖${b.sn}/${b.sb.toFixed(2)}B`);
  }
  console.log(`\n-- 5~20min 逐 2min --`);
  for (let i = 5; i < 20; i += 2) {
    const b = bucket(i * 60, (i + 2) * 60);
    if (!b) { console.log(`+${i}~${i + 2}min 无行`); continue; }
    console.log(`+${i}~${i + 2}min n=${b.n} 段${f2((b.pE / b.pS - 1) * 100)}% 累计${pct(b.pE)}% 段内最大${pct(b.mx)}% 买${b.bn}/${b.bb.toFixed(2)}B 卖${b.sn}/${b.sb.toFixed(2)}B`);
  }
  // 关键时点价
  console.log(`\n-- 关键时点现价（vs 锚后首价）--`);
  for (const m of [1, 2, 3, 5, 10, 15, 20]) {
    const cand = rel.filter((x) => x.t <= t0 + m * 60000);
    const x = cand.length ? cand[cand.length - 1] : null;
    if (x) console.log(`+${m}min 价=${x.p.toExponential(4)}（${pct(x.p)}%）`);
  }
  // 终局：graduation 事件 + 末行时间
  const { data: grads } = await client.from('wss_events').select('block_time,payload')
    .eq('kind', 'graduation').eq('token_address', C84A).limit(5);
  console.log(`\ngraduation 事件=${(grads || []).length ? (grads[0].block_time || '?') : '无'}`);
  const { data: lastRow } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb').eq('token_address', C84A)
    .order('id', { ascending: false }).limit(1);
  if (lastRow && lastRow[0]) {
    console.log(`全表末行=${lastRow[0].block_time} 价=${Number(lastRow[0].price_bnb).toExponential(4)}（vs 锚后首价 ${pct(lastRow[0].price_bnb)}%）`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
