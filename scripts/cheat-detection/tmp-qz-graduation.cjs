// CD159 强庄票候选池「毕业出内盘」交叉分析（182 跑）
// 集合=29 票候选池（机器 unhealthy/cheat × 锚后峰涨≥100%）；查 wss_events
// kind='graduation' 交叉出已毕业票；只呈报事实（毕业时间/锚→毕业时长/末价），
// 不下「毕业=不是作弊」结论——用户明确「绝非出了内盘就不是作弊币了」须逐票复核
const fs = require('fs');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const pool = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/data/tmp-qiangzhuang-pool.json', 'utf8'));
const fixtures = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/fixtures.json', 'utf8'));
const anchorBy = new Map(fixtures.cases.map((c) => [c.caseId, c]));

(async () => {
  const client = dbManager.getClient();
  const addrs = pool.map((p) => p.addr);

  // 探列名（一次即可）
  const { data: probe } = await client.from('wss_events').select('*').eq('kind', 'graduation').limit(1);
  if (!probe || !probe.length) { console.log('NO graduation rows at all'); }
  else console.log('wss_events graduation 列:', Object.keys(probe[0]).join(','));

  const { data: grads, error } = await client
    .from('wss_events')
    .select('token_address,block_time')
    .eq('kind', 'graduation')
    .in('token_address', addrs);
  if (error) { console.error('graduation query error', error.message); process.exit(1); }
  const gradBy = new Map();
  for (const g of grads || []) gradBy.set(String(g.token_address).toLowerCase(), g.block_time);

  const out = [];
  for (const p of pool) {
    const gt = gradBy.get(String(p.addr).toLowerCase());
    if (!gt) continue; // 未毕业票不进本表
    const { data: rows } = await client
      .from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier')
      .eq('token_address', p.addr)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(5000);
    const list = rows || [];
    const a = anchorBy.get(p.caseId);
    const anchorN = a && a.anchor && a.anchor.tickCount;
    const anchorT = anchorN && list[anchorN - 1] ? list[anchorN - 1].block_time : null;
    const lastRel = [...list].reverse().find((r) => typeof r.price_bnb === 'number' && !r.price_outlier);
    const { data: sig } = await client.from('strategy_signals')
      .select('experiment_id').eq('token_address', p.addr).limit(1);
    out.push({
      caseId: p.caseId, symbol: p.symbol, addr: p.addr, grade: p.grade, expect: p.expect,
      risePct: p.risePct, buy15: p.buy15, sell15: p.sell15,
      gradTime: gt, anchorT,
      gradMin: anchorT ? +(((new Date(gt)) - (new Date(anchorT))) / 60000).toFixed(1) : null,
      lastPrice: lastRel ? lastRel.price_bnb : null, lastT: lastRel ? lastRel.block_time : null,
      total: p.total, expId: sig && sig[0] ? sig[0].experiment_id : null,
    });
  }
  out.sort((x, y) => (y.risePct || 0) - (x.risePct || 0));
  console.log(`\n候选池 ${pool.length} 票中已毕业出内盘 ${out.length} 票：\n`);
  for (const o of out) {
    console.log(`${o.caseId} ${o.symbol} ${o.addr} 机器=${o.grade} 人工=${o.expect} 锚后峰=+${o.risePct}% 15min买/卖=${o.buy15}/${o.sell15} 锚=${o.anchorT ? o.anchorT.slice(11, 19) : '?'} 毕业=${o.gradTime.slice(11, 19)} 锚→毕业=${o.gradMin !== null ? o.gradMin + 'min' : '?'} 末笔=${o.lastT ? o.lastT.slice(11, 19) : '?'}@${o.lastPrice != null ? o.lastPrice.toPrecision(3) : 'null'} 总笔=${o.total} 实验=${o.expId || '无'}`);
  }
  fs.writeFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/data/tmp-qz-graduation.json', JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
