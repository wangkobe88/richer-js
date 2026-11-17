// bt-v116（簇门 A 窗门控臂）vs bt-v115（基线）逐票对拍数据准备（182 跑）
// 拉：两实验 trades per-token 净额 + executed BUY 信号首行 trendFactors 快照
// （含 launchBundleClusterSize/tokenAgeSec/cheatGrade/bpBucket）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const fs = require('fs');
const EXPS = {
  v116: 'aa8fb3b3-d4fe-4770-bcd2-b4bd34409b26',
  v115: '34e78e97-0000-0000-0000-000000000000', // 前缀，下面按名补全
};

(async () => {
  const db = dbManager.getClient();
  // v115 id 按名取（只知道前缀）
  {
    const { data, error } = await db.from('experiments').select('id,status,experiment_name')
      .ilike('experiment_name', 'bt-v115-t139-floor-delgmgn-hold180-v68base%').limit(1);
    if (error || !data[0]) { console.log('v115 load ERR', error && error.message); process.exit(1); }
    if (!data[0].id.startsWith('34e78e97')) throw new Error('v115 前缀不符: ' + data[0].id);
    if (data[0].status !== 'completed') throw new Error('v115 非终态: ' + data[0].status);
    EXPS.v115 = data[0].id;
  }
  console.log('v115 =', EXPS.v115);

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
  fs.writeFileSync('/tmp/tmp-v116v115.json', JSON.stringify(out));
  console.log('written /tmp/tmp-v116v115.json',
    (fs.statSync('/tmp/tmp-v116v115.json').size / 1024).toFixed(0) + 'KB');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
