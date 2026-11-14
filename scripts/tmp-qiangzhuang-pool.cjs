// 强庄币候选池扫描（182 跑）：149 票里 机器 unhealthy/cheat × 锚后大涨 的票
const fs = require('fs');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const fixtures = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/fixtures.json', 'utf8'));
const run = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/data/cd-run-2026-11-03T13-38-03-338Z.json', 'utf8'));
const gradeBy = new Map(run.results.map(r => [r.caseId, r]));

(async () => {
  const client = dbManager.getClient();
  const out = [];
  for (const c of fixtures.cases) {
    const g = gradeBy.get(c.caseId);
    if (!g || g.grade === 'healthy') continue; // 只看被拦截票
    const anchorN = c.anchor && c.anchor.tickCount;
    if (!anchorN) continue;
    let rows;
    try {
      const res = await client
        .from('wss_price_ticks')
        .select('block_number,log_index,block_time,trade_type,price_bnb,bnb_amount,price_outlier')
        .eq('token_address', c.addr)
        .order('block_number', { ascending: true })
        .order('log_index', { ascending: true })
        .limit(5000);
      rows = res.data || [];
    } catch (e) { continue; }
    if (rows.length <= anchorN) continue;
    const anchor = rows[anchorN - 1];
    if (!anchor || typeof anchor.price_bnb !== 'number') continue;
    const relAfter = rows.slice(anchorN).filter(r => typeof r.price_bnb === 'number' && !r.price_outlier);
    if (!relAfter.length) continue;
    let peak = 0, peakT = null;
    for (const r of relAfter) if (r.price_bnb > peak) { peak = r.price_bnb; peakT = r.block_time; }
    const risePct = (peak / anchor.price_bnb - 1) * 100;
    if (risePct < 100) continue; // 锚后峰涨 ≥100% 才进池
    // 锚后 15 分钟窗内买卖比（拉盘验证）
    const t0 = new Date(anchor.block_time).getTime();
    const w = relAfter.filter(r => new Date(r.block_time).getTime() - t0 <= 15 * 60000);
    let buyB = 0, sellB = 0, nB = 0, nS = 0;
    for (const r of w) { if (/buy/i.test(r.trade_type || '')) { buyB += r.bnb_amount || 0; nB++; } else { sellB += r.bnb_amount || 0; nS++; } }
    out.push({
      caseId: c.caseId, symbol: c.symbol, addr: c.addr, grade: g.grade,
      expect: c.expect && c.expect.verdict, anchorPrice: anchor.price_bnb,
      peak, risePct: +risePct.toFixed(0), peakT: (peakT || '').slice(11, 19),
      buy15: +buyB.toFixed(2), sell15: +sellB.toFixed(2), nB, nS, total: rows.length,
    });
  }
  out.sort((a, b) => b.risePct - a.risePct);
  console.log('强庄币候选池（机器拦截 × 锚后峰涨≥100%）共 ' + out.length + ' 票：\n');
  for (const o of out) {
    console.log(`${o.caseId} ${o.symbol} ${o.addr} 机器=${o.grade} expect=${o.expect} 锚后峰=+${o.risePct}%@${o.peakT} 15min窗买/卖=${o.buy15}/${o.sell15}BNB(${o.nB}/${o.nS}笔) 总笔=${o.total}`);
  }
  fs.writeFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/data/tmp-qiangzhuang-pool.json', JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
