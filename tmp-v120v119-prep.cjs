// bt-v116（簇门 A 窗门控臂）vs bt-v115（基线）逐票对拍数据准备（182 跑）
// 拉：两实验 trades per-token 净额 + executed BUY 信号首行 trendFactors 快照
// （含 launchBundleClusterSize/tokenAgeSec/cheatGrade/bpBucket）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const fs = require('fs');
const EXPS = {
  v120: '415b4ea0-d7ac-4b00-b58b-df38b3574624',
  v119: '883e2513-ee2a-400e-8e58-7ce789adc205',
};

(async () => {
  const db = dbManager.getClient();
  const out = {};
  for (const [label, EXP] of Object.entries(EXPS)) {
    const { data: trades, error: te } = await db.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,unit_price,success,created_at')
      .eq('experiment_id', EXP).eq('success', true)
      .order('created_at', { ascending: true }).limit(1000);
    if (te) { console.log(label, 'trades ERR', te.message); process.exit(1); }

    const tok = new Map();
    for (const t of trades) {
      if (!tok.has(t.token_address)) tok.set(t.token_address, {
        token: t.token_address, symbol: t.token_symbol || '',
        buyBnb: 0, sellBnb: 0, nBuys: 0, nSells: 0, firstBuyAt: null, lastAt: null,
      });
      const e = tok.get(t.token_address);
      if (t.trade_direction === 'buy') {
        e.buyBnb += Number(t.input_amount) || 0; e.nBuys += 1;
        if (!e.firstBuyAt) e.firstBuyAt = t.created_at;
      } else {
        e.sellBnb += Number(t.output_amount) || 0; e.nSells += 1;
      }
      if (!e.lastAt || t.created_at > e.lastAt) e.lastAt = t.created_at;
    }
    for (const e of tok.values()) e.net = e.sellBnb - e.buyBnb;
    const bought = [...tok.values()].filter(e => e.nBuys > 0);

    const { data: sigs, error: se } = await db.from('strategy_signals')
      .select('id,token_address,created_at,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
      .order('created_at', { ascending: true }).limit(600);
    if (se) { console.log(label, 'signals ERR', se.message); process.exit(1); }
    const firstSig = new Map();
    for (const s of sigs) if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s);

    const rows = bought.map(e => {
      const s = firstSig.get(e.token);
      const md = s ? (s.metadata || {}) : {};
      const f = md.trendFactors || {};
      return {
        token: e.token, symbol: e.symbol,
        buyBnb: +e.buyBnb.toFixed(4), sellBnb: +e.sellBnb.toFixed(4),
        net: +e.net.toFixed(4), nBuys: e.nBuys, nSells: e.nSells,
        firstBuyAt: e.firstBuyAt, lastAt: e.lastAt,
        signalAt: s ? s.created_at : null,
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
  fs.writeFileSync('/tmp/tmp-v120v119.json', JSON.stringify(out));
  console.log('written /tmp/tmp-v116v115.json',
    (fs.statSync('/tmp/tmp-v120v119.json').size / 1024).toFixed(0) + 'KB');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
