#!/usr/bin/env node
// 尾部域接刀臂复验（一键）：exp id 列表 → 尾部组 chg5 拦截面 + E 组对照
// 用法：node scripts/tmp-tail-revalidate.cjs <expId1> [expId2 ...]
const { dbManager } = require('../src/services/dbManager');

const TAIL_VOL = 3, TAIL_WALLETS = 40, LOW_CURVS = 28.5;

function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  const expIds = process.argv.slice(2);
  if (!expIds.length) { console.log('usage: node tmp-tail-revalidate.cjs <expId...>'); process.exit(1); }
  const nmMap = new Map();

  const pts = []; // 买点
  for (const id of expIds) {
    const { data: e } = await sb.from('experiments').select('experiment_name,config').eq('id', id).limit(1);
    const nm = e && e[0] ? e[0].experiment_name : id.slice(0, 8);
    nmMap.set(id, nm);
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,output_currency,created_at,signal_id')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(nm + ': ' + error.message);
    const buysT = tr.filter(t => t.trade_direction === 'buy' && t.trade_status === 'success');
    const sigIds = [...new Set(buysT.map(t => t.signal_id).filter(Boolean))];
    const sigM = new Map();
    for (let i = 0; i < sigIds.length; i += 50) {
      const { data: sgs } = await sb.from('strategy_signals').select('id,token_address,created_at,metadata').in('id', sigIds.slice(i, i + 50));
      for (const s of sgs || []) sigM.set(s.id, s);
    }
    for (const t of buysT) {
      const sig = sigM.get(t.signal_id);
      const tf = (sig && sig.metadata && sig.metadata.trendFactors) || {};
      const lp = Number(tf.launchPrice), cur = Number(tf.currentPrice), hi = Number(tf.highestPrice);
      const curVs = lp && cur ? (cur / lp - 1) * 100 : null;
      const vol = Number(tf.buyVolumeBnb) || 0, wals = Number(tf.buyWallets) || 0;
      pts.push({
        exp: nm, token: t.token_address, buyTs: new Date(t.created_at).getTime(),
        tf, curVs, vol, wals,
        tail: curVs != null && curVs <= LOW_CURVS && vol >= TAIL_VOL && wals >= TAIL_WALLETS,
      });
    }
    // episode ep
    const epM = new Map();
    for (const t of tr) {
      if (t.trade_status !== 'success') continue;
      const k = t.token_address;
      if (!epM.has(k)) epM.set(k, { i: 0, o: 0 });
      const e2 = epM.get(k);
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e2.i += Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e2.o += Number(t.output_amount);
    }
    for (const p of pts) if (p.exp === nm) p.ep = epM.has(p.token) ? (epM.get(p.token).i > 0 ? (epM.get(p.token).o - epM.get(p.token).i) / epM.get(p.token).i * 100 : null) : null;
    console.log(`${nm}: buys=${buysT.length}`);
  }

  // 按票去重
  const byTk = new Map();
  for (const p of pts) { const k = p.exp + '|' + p.token; if (!byTk.has(k)) byTk.set(k, p); }
  const P = [...byTk.values()];

  // chg5（买点前后 3s 末价 vs 买点前 5s 窗首价）+ 前向 mx
  const toks = [...new Set(P.map(p => p.token))];
  async function one(p) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_usd,price_outlier')
      .eq('token_address', p.token)
      .gte('block_time', new Date(p.buyTs - 15000).toISOString()).lt('block_time', new Date(p.buyTs + 1830000).toISOString())
      .order('block_time', { ascending: true }).limit(3000);
    if (error) return;
    const rows = (data || []).filter(r => !r.price_outlier && Number(r.price_usd) > 0)
      .map(r => ({ ts: new Date(r.block_time).getTime(), p: Number(r.price_usd) }));
    if (!rows.length) return;
    const near = rows.filter(r => r.ts <= p.buyTs + 3000);
    const P0 = near.length ? near[near.length - 1].p : null;
    if (P0 == null) return;
    const ref = near.find(r => r.ts > p.buyTs - 5000);
    p.chg5 = (P0 / (ref ? ref.p : near[0].p) - 1) * 100;
    const fwd = rows.filter(r => r.ts >= p.buyTs);
    let mx = -1e9, mxT = null;
    for (const t of fwd) { const r2 = (t.p / P0 - 1) * 100; if (r2 > mx) { mx = r2; mxT = Math.round((t.ts - p.buyTs) / 1000); } }
    p.mx = mx === -1e9 ? null : mx; p.mxT = mxT;
  }
  const q = [...P];
  async function w() { while (q.length) { const p = q.shift(); try { await one(p); } catch (e) {} } }
  await Promise.all([w(), w(), w(), w(), w(), w()]);

  const valid = P.filter(p => p.chg5 != null && p.mx != null);
  const tail = valid.filter(p => p.tail), eGrp = valid.filter(p => !p.tail);
  console.log(`\n有效买点=${valid.length}（尾部=${tail.length} 对照=${eGrp.length}）`);

  for (const [nm2, rs] of [['尾部域', tail], ['对照组', eGrp]]) {
    for (const [ln, pred] of [['chg5<-5', p => p.chg5 < -5], ['chg5<0', p => p.chg5 < 0], ['chg5>=0', p => p.chg5 >= 0]]) {
      const h = rs.filter(pred);
      const eps = h.map(p => p.ep).filter(x => x != null);
      const d = h.filter(p => p.mx < 3).length, u = h.filter(p => p.mx >= 10).length;
      console.log(`${nm2} ${ln.padEnd(8)} n=${h.length}(死${d}/涨${u}) epΣ=${eps.length ? eps.reduce((s, x) => s + x, 0).toFixed(1) : '—'} mean=${mean(eps)?.toFixed(1)}`);
    }
    const allEp = rs.map(p => p.ep).filter(x => x != null);
    console.log(`${nm2} 全体    n=${rs.length} epΣ=${allEp.length ? allEp.reduce((s, x) => s + x, 0).toFixed(1) : '—'} mean=${mean(allEp)?.toFixed(1)}`);
  }
  // 尾部域 chg5<-5 明细
  console.log('\n尾部域 chg5<-5 明细:');
  for (const p of tail.filter(p => p.chg5 < -5)) {
    console.log(`${p.exp} ${p.token.slice(0, 10)} chg5=${p.chg5.toFixed(1)} chg30=? mx=${p.mx.toFixed(0)}@${p.mxT}s ep=${p.ep?.toFixed(1)} ${p.mx < 3 ? '死盘' : p.mx >= 10 ? '起涨' : '中间'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
