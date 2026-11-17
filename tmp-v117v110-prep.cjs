// bt-v117（v102 老 config 重跑）vs bt-v110（KOL HOLD 新 config）vs bt-v102（原跑）三方对拍
// 数据准备（182 跑）——差距归因：策略集代差/代码代差/方差
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const fs = require('fs');
const EXPS = {
  v117: 'b02c907f-6c81-4971-b5b9-d6c548d2d2d3',
  v110: '80e3867f-db2c-4f68-9647-180758287ded',
  v102: 'c961a49d-2294-4152-9649-07ca13e4fd95',
};

(async () => {
  const db = dbManager.getClient();
  const out = { meta: {} };
  for (const [label, EXP] of Object.entries(EXPS)) {
    const { data: erow, error: ee } = await db.from('experiments')
      .select('id,status,experiment_name,stats,config->backtest').eq('id', EXP).limit(1);
    if (ee || !erow[0]) { console.log(label, 'exp ERR', ee && ee.message); process.exit(1); }
    const e = erow[0];
    const bt = e.backtest || {};
    out.meta[label] = {
      id: EXP, name: e.experiment_name, status: e.status, stats: e.stats,
      win: { start: bt.startTime, end: bt.endTime, src: bt.sourceExperimentId, rows: bt.maxTickRows },
    };
    console.log(label, e.status, e.experiment_name, JSON.stringify(out.meta[label].win));

    const { data: trades, error: te } = await db.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,success,created_at')
      .eq('experiment_id', EXP).eq('success', true)
      .order('created_at', { ascending: true }).limit(1000);
    if (te) { console.log(label, 'trades ERR', te.message); process.exit(1); }
    if (trades.length === 1000) { console.log(label, 'trades 触 1000 帽，需分页！'); process.exit(1); }

    const tok = new Map();
    for (const t of trades) {
      if (!tok.has(t.token_address)) tok.set(t.token_address, {
        token: t.token_address, symbol: t.token_symbol || '',
        buyBnb: 0, sellBnb: 0, nBuys: 0, nSells: 0, firstBuyAt: null, lastAt: null,
        buys: [], sells: [],
      });
      const r = tok.get(t.token_address);
      if (t.trade_direction === 'buy') {
        r.buyBnb += Number(t.input_amount) || 0; r.nBuys += 1;
        if (!r.firstBuyAt) r.firstBuyAt = t.created_at;
        if (r.buys.length < 6) r.buys.push({ at: t.created_at, bnb: +(Number(t.input_amount) || 0).toFixed(3) });
      } else {
        r.sellBnb += Number(t.output_amount) || 0; r.nSells += 1;
        if (r.sells.length < 8) r.sells.push({ at: t.created_at, bnb: +(Number(t.output_amount) || 0).toFixed(3) });
      }
      if (!r.lastAt || t.created_at > r.lastAt) r.lastAt = t.created_at;
    }
    for (const r of tok.values()) r.net = +(r.sellBnb - r.buyBnb).toFixed(4);
    const bought = [...tok.values()].filter(r => r.nBuys > 0);

    const { data: sigs, error: se } = await db.from('strategy_signals')
      .select('id,token_address,signal_type,created_at,metadata')
      .eq('experiment_id', EXP).in('signal_type', ['BUY', 'SELL']).eq('executed', true)
      .order('created_at', { ascending: true }).limit(3000);
    if (se) { console.log(label, 'signals ERR', se.message); process.exit(1); }
    if (sigs.length === 3000) { console.log(label, 'sigs 触 3000 帽'); process.exit(1); }

    const firstBuy = new Map();
    const sellSigs = new Map();
    for (const s of sigs) {
      if (s.signal_type === 'BUY') {
        if (!firstBuy.has(s.token_address)) firstBuy.set(s.token_address, s);
      } else {
        if (!sellSigs.has(s.token_address)) sellSigs.set(s.token_address, []);
        const arr = sellSigs.get(s.token_address);
        if (arr.length < 12) arr.push({ at: s.created_at, sid: (s.metadata || {}).strategyId || null });
      }
    }

    const rows = bought.map(r => {
      const s = firstBuy.get(r.token);
      const md = s ? (s.metadata || {}) : {};
      const f = md.trendFactors || {};
      return {
        token: r.token, symbol: r.symbol,
        buyBnb: +r.buyBnb.toFixed(4), sellBnb: +r.sellBnb.toFixed(4),
        net: r.net, nBuys: r.nBuys, nSells: r.nSells,
        firstBuyAt: r.firstBuyAt, lastAt: r.lastAt,
        buys: r.buys, sells: r.sells,
        sellSigs: sellSigs.get(r.token) || [],
        strategyId: md.strategyId || null,
        cheatGrade: md.cheatCheck?.grade ?? null,
        cheatExempt: md.cheatCheck?.exempt ?? null,
        bpBucket: md.buyPoint?.assessment?.entry_shape ?? md.buyPoint?.dimensions?.entry_shape ?? null,
        cluster: f.launchBundleClusterSize ?? null,
        ageAtFire: f.tokenAgeSec ?? null,
      };
    });
    const net = rows.reduce((a, r) => a + r.net, 0);
    console.log(label, 'bought:', rows.length, 'net:', net.toFixed(4));
    out[label] = rows;
  }
  fs.writeFileSync('/tmp/tmp-v117v110.json', JSON.stringify(out));
  console.log('written /tmp/tmp-v117v110.json',
    (fs.statSync('/tmp/tmp-v117v110.json').size / 1024).toFixed(0) + 'KB');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
