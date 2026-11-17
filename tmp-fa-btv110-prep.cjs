// bt-v110 (80e3867f) 因子过滤泛化验证——数据准备（182 跑）
// 拉：①trades per-token 净额 ②已执行 BUY 信号首行的 trendFactors 快照 → 紧凑 JSON 落盘
require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const fs = require('fs');
const EXP = '80e3867f-db2c-4f68-9647-180758287ded';
const OUT = '/tmp/tmp-fa-btv110.json';

(async () => {
  const db = dbManager.getClient();

  // ---- trades ----
  const { data: trades, error: te } = await db.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,unit_price,success,created_at,signal_id')
    .eq('experiment_id', EXP)
    .eq('success', true)
    .order('created_at', { ascending: true })
    .limit(3000);
  if (te) { console.log('trades ERR', te.message); process.exit(1); }
  console.log('trades rows:', trades.length);

  const tok = new Map();
  for (const t of trades) {
    if (!tok.has(t.token_address)) tok.set(t.token_address, {
      token: t.token_address, symbol: t.token_symbol || '',
      buyBnb: 0, sellBnb: 0, nBuys: 0, nSells: 0,
      firstBuyAt: null, lastAt: null, buyPrices: [], lastPrice: null,
    });
    const e = tok.get(t.token_address);
    if (t.trade_direction === 'buy') {
      e.buyBnb += Number(t.input_amount) || 0;
      e.nBuys += 1;
      if (!e.firstBuyAt) { e.firstBuyAt = t.created_at; e.buyPrices.push(Number(t.unit_price)); }
      if (e.nBuys === 1) e.entryPrice = Number(t.unit_price);
    } else if (t.trade_direction === 'sell') {
      e.sellBnb += Number(t.output_amount) || 0;
      e.nSells += 1;
      e.lastPrice = Number(t.unit_price);
    }
    if (!e.lastAt || t.created_at > e.lastAt) e.lastAt = t.created_at;
  }
  for (const e of tok.values()) e.net = e.sellBnb - e.buyBnb;
  const bought = [...tok.values()].filter(e => e.nBuys > 0);
  console.log('tokens touched:', tok.size, '| bought:', bought.length,
    '| net total:', bought.reduce((a, e) => a + e.net, 0).toFixed(4));

  // ---- executed BUY signals（每票首条）----
  const { data: sigs, error: se } = await db.from('strategy_signals')
    .select('id,token_address,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('signal_type', 'BUY')
    .eq('executed', true)
    .order('created_at', { ascending: true })
    .limit(500);
  if (se) { console.log('signals ERR', se.message); process.exit(1); }
  console.log('executed BUY signals:', sigs.length);

  const firstSig = new Map();
  for (const s of sigs) {
    if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s);
  }
  console.log('tokens with executed signal:', firstSig.size);

  let matched = 0;
  const out = [];
  for (const e of bought) {
    const s = firstSig.get(e.token);
    if (!s) { out.push({ ...e, factors: null, note: 'no-signal' }); continue; }
    matched++;
    const md = s.metadata || {};
    out.push({
      token: e.token, symbol: e.symbol,
      buyBnb: +e.buyBnb.toFixed(4), sellBnb: +e.sellBnb.toFixed(4),
      net: +e.net.toFixed(4), nBuys: e.nBuys, nSells: e.nSells,
      firstBuyAt: e.firstBuyAt, lastAt: e.lastAt,
      entryPrice: e.entryPrice, lastPrice: e.lastPrice,
      strategyId: md.strategyId || null,
      strategyName: md.strategyName || null,
      signalAt: s.created_at,
      cheatGrade: md.cheatCheck?.grade ?? null,
      cheatExempt: md.cheatCheck?.exempt ?? null,
      bpPassed: md.buyPoint?.passed ?? null,
      bpBucket: md.buyPoint?.assessment?.entry_shape ?? md.buyPoint?.dimensions?.entry_shape ?? null,
      factors: md.trendFactors || null,
    });
  }
  console.log('matched tokens:', matched);
  const payload = { exp: EXP, generatedAt: new Date().toISOString(), tokens: out };
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log('written', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
