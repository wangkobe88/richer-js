// CD21/CD72 锚后全史轨迹分析 v2（182 跑）：price_bnb/trade_type 真列名
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const CASES = [
  { cid: 'CD21', addr: '0x9d70e873394d31e928ab213f4a2aed24de637777', anchorN: 34 },
  { cid: 'CD72', addr: '0x5641aa3aae2bedc1565ff754b8a430a6abdf7777', anchorN: 19 },
];

(async () => {
  const client = dbManager.getClient();
  for (const c of CASES) {
    const { data, error } = await client
      .from('wss_price_ticks')
      .select('block_number,log_index,block_time,trade_type,price_bnb,bnb_amount,sender_address,trader_address,price_outlier')
      .eq('token_address', c.addr)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(5000);
    if (error) { console.log(c.cid, 'ERR', error.message); continue; }
    const rows = data || [];
    if (!rows.length) { console.log(c.cid, 'NO ROWS'); continue; }

    const types = [...new Set(rows.map(r => r.trade_type))];
    console.log(`\n== ${c.cid} ${c.addr.slice(0, 10)}… == 总笔数=${rows.length} trade_type 域=${types.join('/')}`);
    console.log(`全史时间: ${rows[0].block_time} → ${rows[rows.length - 1].block_time}`);

    const isBuy = r => /buy/i.test(r.trade_type || '');
    const anchorIdx = c.anchorN - 1;
    const anchor = rows[anchorIdx];
    const after = rows.slice(anchorIdx + 1);
    const priceOf = r => (typeof r.price_bnb === 'number' ? r.price_bnb : null);

    const relAfter = after.filter(r => priceOf(r) != null && !r.price_outlier);
    const anchorPrice = priceOf(anchor);
    let peak = null, peakT = null;
    for (const r of relAfter) { const p = priceOf(r); if (peak == null || p > peak) { peak = p; peakT = r.block_time; } }
    const lastP = relAfter.length ? priceOf(relAfter[relAfter.length - 1]) : null;

    let buyBnb = 0, sellBnb = 0, nBuy = 0, nSell = 0;
    const sellTop = {};
    for (const r of after) {
      const w = (r.sender_address || r.trader_address || '?').toLowerCase();
      const bnb = r.bnb_amount || 0;
      if (isBuy(r)) { buyBnb += bnb; nBuy++; }
      else { sellBnb += bnb; nSell++; sellTop[w] = (sellTop[w] || 0) + bnb; }
    }
    const topSellers = Object.entries(sellTop).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const fmt = p => (p == null ? 'null' : p.toPrecision(3));
    const pct = (p, a) => (p == null || a == null ? '-' : ((p / a - 1) * 100).toFixed(0) + '%');
    const spanMin = after.length ? ((new Date(after[after.length - 1].block_time) - new Date(anchor.block_time)) / 60000).toFixed(1) : '0';
    console.log(`锚=第${c.anchorN}笔(${anchor.block_time}) 锚后=${after.length}笔 跨度=${spanMin}min`);
    console.log(`锚价=${fmt(anchorPrice)} 锚后峰=${fmt(peak)}@${peakT}(${pct(peak, anchorPrice)}) 末价=${fmt(lastP)}(${pct(lastP, anchorPrice)})`);
    console.log(`锚后买=${buyBnb.toFixed(2)}BNB/${nBuy}笔 卖=${sellBnb.toFixed(2)}BNB/${nSell}笔`);
    console.log('锚后卖方 top5: ' + topSellers.map(([w, v]) => `${w.slice(0, 8)}=${v.toFixed(3)}`).join(' '));
    // 时间分位：每 37 笔打一个时间点看节奏
    const marks = [0, 0.25, 0.5, 0.75, 1].map(f => rows[Math.floor(f * (rows.length - 1))]);
    console.log('时间分位: ' + marks.map(r => r.block_time.slice(11, 19)).join(' | '));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
