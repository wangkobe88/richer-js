// 用户假设验证：famous 买入后「跟单量」决定危险性（跟单少可买/跟单多危险）
// 182 真重放四窗 sender 完备成交票：famousTraces + famous 首买后非 famous 买入额
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');

const EXPS = [
  ['w1003热', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadTrades(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(600);
  const by = new Map();
  for (const t of trades) {
    if (!by.has(t.token_address)) by.set(t.token_address, { symbol: t.token_symbol, cost: 0, got: 0, sig: null, at: null });
    const e = by.get(t.token_address);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.sig = t.signal_id; e.at = t.created_at; }
    else e.got += Number(t.output_amount || 0);
  }
  return [...by.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, pnl: v.got - v.cost, sig: v.sig, at: v.at }));
}

(async () => {
  const sb = dbManager.getClient();
  const rows = [];
  for (const [w, id] of EXPS) {
    for (const s of await loadTrades(id)) {
      const { data: ev } = await sb.from('wss_events').select('block_time,platform')
        .eq('kind', 'token_create').eq('token_address', s.addr).limit(1);
      if (!ev?.[0]) continue;
      const { data: ticks } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
        .eq('token_address', s.addr).lte('block_time', s.at).order('block_time', { ascending: true }).limit(2000);
      if (!ticks?.length) continue;
      try {
        const snap = buildBuyPointSnapshot(ticks, { platform: ev[0].platform || 'fourmeme', totalSupply: 1e9, createdAt: ev[0].block_time }, {});
        const ft = (snap.buyDerived || {}).famousTraces;
        if (!ft || !Array.isArray(ft.wallets) || !ft.wallets.length) continue; // 无 famous 参与（FP3 域外）
        const tEnd = Math.max(...snap.ticks.map(t => t.dt != null ? t.dt : -1));
        // famous 首买后非 famous 跟单买额（snap.ticks 直算）
        const famSet = new Set(ft.wallets.map(x => x.w));
        const firstDt = ft.groupFirstBuyDt;
        if (firstDt == null) continue;
        let followBnb = 0, followN = 0;
        for (const t of snap.ticks) {
          if (t.side !== 'BUY' || t.dt == null || t.dt <= firstDt) continue;
          if (t.wallet && famSet.has(t.wallet.toLowerCase())) continue;
          followBnb += t.bnb || 0; followN++;
        }
        const soldRatio = ft.groupBuyBnb > 0 ? ft.groupSellBnb / ft.groupBuyBnb : null;
        rows.push({
          w, sym: s.symbol, pnl: s.pnl,
          groupBuy: ft.groupBuyBnb, soldRatio: soldRatio == null ? null : +soldRatio.toFixed(2),
          famN: ft.wallets.length, firstDt, secSinceFirst: tEnd - firstDt,
          followBnb: +followBnb.toFixed(2), followN,
          fp3Thin: soldRatio !== null && soldRatio < 0.7 && ((snap.cheatDerived || {}).totalBuyBnb != null ? (snap.cheatDerived || {}).totalBuyBnb < 3 : null),
          totalBuy: (snap.cheatDerived || {}).totalBuyBnb ?? null,
        });
      } catch (e) {}
    }
  }
  console.log('famous 在场票（wallets>0）:', rows.length, '票 净Σ', rows.reduce((a, r) => a + r.pnl, 0).toFixed(3));
  const grp = (name, f) => {
    const ss = rows.filter(f);
    if (!ss.length) return console.log(name.padEnd(46), 'n=0');
    console.log(name.padEnd(46), 'n=' + String(ss.length).padStart(3), 'win ' + String(Math.round(ss.filter(s => s.pnl > 0.0005).length / ss.length * 100)).padStart(3) + '%', 'Σ' + ss.reduce((a, s) => a + s.pnl, 0).toFixed(3).padStart(7), 'μ' + (ss.reduce((a, s) => a + s.pnl, 0) / ss.length).toFixed(4).padStart(8));
  };
  console.log('\n── 跟单额轴（famous 首买后非 famous 买入）──');
  grp('跟单 <0.5B（用户预测：可买）', r => r.followBnb < 0.5);
  grp('跟单 0.5~1.5B', r => r.followBnb >= 0.5 && r.followBnb < 1.5);
  grp('跟单 1.5~3B', r => r.followBnb >= 1.5 && r.followBnb < 3);
  grp('跟单 ≥3B（用户预测：危险）', r => r.followBnb >= 3);
  console.log('\n── 交叉：famous 买量 × 跟单量（用户：不怕 famous 砸除非买很大）──');
  grp('fam 买<0.2 ∧ 跟单<0.5', r => r.groupBuy < 0.2 && r.followBnb < 0.5);
  grp('fam 买<0.2 ∧ 跟单≥1.5', r => r.groupBuy < 0.2 && r.followBnb >= 1.5);
  grp('fam 买≥0.3 ∧ 跟单<0.5', r => r.groupBuy >= 0.3 && r.followBnb < 0.5);
  grp('fam 买≥0.3 ∧ 跟单≥1.5', r => r.groupBuy >= 0.3 && r.followBnb >= 1.5);
  console.log('\n── 间隔轴（burst 它发起=首买距锚近）──');
  grp('首买距锚 <60s ∧ 跟单<0.5', r => r.secSinceFirst < 60 && r.followBnb < 0.5);
  grp('首买距锚 <60s ∧ 跟单≥1.5', r => r.secSinceFirst < 60 && r.followBnb >= 1.5);
  grp('首买距锚 >180s（老仓）', r => r.secSinceFirst > 180);
  console.log('\n── FP3 薄盘分支现拦截面在跟单轴的分布（是否在误伤「跟单少」好票）──');
  grp('FP3 thin 形状 ∧ 跟单<0.5', r => r.fp3Thin === true && r.followBnb < 0.5);
  grp('FP3 thin 形状 ∧ 跟单≥1.5', r => r.fp3Thin === true && r.followBnb >= 1.5);
  grp('FP3 thin 形状 全体', r => r.fp3Thin === true);
  console.log('\n── 最差/最好各 5（famous 在场票）──');
  for (const r of rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 5)) console.log(' ✂', r.w.slice(0, 5), (r.sym || '').slice(0, 9).padEnd(10), r.pnl.toFixed(4), 'fam买', r.groupBuy, '跟单', r.followBnb, 'sold比', r.soldRatio, '首买距', r.secSinceFirst + 's');
  for (const r of rows.slice().sort((a, b) => b.pnl - a.pnl).slice(0, 5)) console.log(' ▲', r.w.slice(0, 5), (r.sym || '').slice(0, 9).padEnd(10), r.pnl.toFixed(4), 'fam买', r.groupBuy, '跟单', r.followBnb, 'sold比', r.soldRatio, '首买距', r.secSinceFirst + 's');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
