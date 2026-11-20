const { dbManager } = require('../src/services/dbManager');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];

async function main() {
  const sb = dbManager.getClient();
  const rows = [];
  const seen = new Map();
  for (const w of WINS) {
    const sigs = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals').select('*')
        .eq('experiment_id', w.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      sigs.push(...data); from += 1000;
      if (data.length < 1000) break;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    const tmap = new Map();
    let f2 = 0;
    while (true) {
      const { data, error } = await sb.from('trades').select('*')
        .eq('experiment_id', w.id).order('created_at').range(f2, f2 + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const t of data) {
        if (!tmap.has(t.token_address)) tmap.set(t.token_address, { b: 0, s: 0, nBuy: 0 });
        const o = tmap.get(t.token_address);
        if (t.trade_direction === 'buy' && t.success) { o.b += Number(t.input_amount); o.nBuy++; }
        if (t.trade_direction === 'sell' && t.success) o.s += Number(t.output_amount);
      }
      f2 += 1000;
      if (data.length < 1000) break;
    }
    for (const [tok, s] of first) {
      const dk = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dk)) continue;
      seen.set(dk, 1);
      const t = tmap.get(tok);
      if (!t || !t.nBuy) continue;
      const m = s.metadata || {};
      const bp = m.buyPoint || {}; const an = bp.anchors || {}; const dim = bp.dimensions || {};
      const shape = dim.entry_shape && dim.entry_shape.bucket;
      const chg5 = an.chg5Pct;
      if (shape !== 'spike' && !(typeof chg5 === 'number' && chg5 >= 25)) continue;
      rows.push({ win: w.k, tok, buyT: s.created_at, pnl: +(t.s - t.b).toFixed(4), roi: (t.s / t.b - 1) * 100 });
    }
  }
  let okN = 0;
  for (const r of rows) {
    const fireMs = new Date(r.buyT).getTime();
    const sinceMs = fireMs - 60000;
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,bnb_amount,trade_type,price_bnb,sender_address,trader_address')
      .eq('token_address', r.tok).gte('block_time', new Date(sinceMs).toISOString())
      .order('block_time', { ascending: true }).limit(1200);
    if (error || !ticks || ticks.length < 3) continue;
    const arr = ticks.map(t => ({ ms: new Date(t.block_time).getTime(), bnb: Number(t.bnb_amount), side: t.trade_type, p: Number(t.price_bnb), w: ((t.sender_address || t.trader_address) || '').toLowerCase() })).filter(t => t.p > 0);
    if (!arr.length) continue;
    // burst 窗（densest 5s，波末≤fire+5s）
    let best = null;
    for (let i = 0; i < arr.length; i++) {
      let j = i;
      while (j < arr.length && arr[j].ms - arr[i].ms <= 5000) j++;
      const n = j - i;
      if (arr[j - 1].ms > fireMs + 5000) break;
      if (!best || n > best.n) best = { n, i, endIdx: j - 1 };
    }
    if (!best || !best.n) continue;
    const bStart = arr[best.i].ms, bEnd = arr[best.endIdx].ms;
    // burst 成员钱包集（burst 窗内买过的钱包）
    const burstWallets = new Set(arr.filter(t => t.ms >= bStart && t.ms <= bEnd && t.side === 'buy' && t.w).map(t => t.w));
    const fireTick = arr.find(t => t.ms >= fireMs) || arr[arr.length - 1];
    r.fireP = fireTick.p;
    // 两个检查点窗
    const w1 = arr.filter(t => t.ms >= fireMs && t.ms < fireMs + 15000);
    const w2 = arr.filter(t => t.ms >= fireMs + 15000 && t.ms < fireMs + 30000);
    const stat = win => {
      let nb = 0, nn = 0, tot = 0, ticks = 0, buyN = 0;
      for (const t of win) {
        ticks++; tot += t.bnb;
        if (t.side === 'buy') {
          buyN++;
          if (!(t.w && burstWallets.has(t.w))) { nb += t.bnb; nn++; }
        }
      }
      return { nb: +nb.toFixed(3), nn, tot: +tot.toFixed(3), ticks, buyN };
    };
    r.s1 = stat(w1); r.s2 = stat(w2);
    r.p15 = w1.length ? w1[w1.length - 1].p : fireTick.p;
    r.p30 = w2.length ? w2[w2.length - 1].p : r.p15;
    r.ok = true; okN++;
  }
  const ok = rows.filter(r => r.ok);
  const actual = ok.reduce((x, r) => x + r.pnl, 0);
  console.log('有效票:', okN, '| 实际 pnlΣ', actual.toFixed(4));

  // 规则族
  const runRule = (name, fn) => {
    const sim = ok.map(r => {
      const m = fn(r);
      return m ? { r, simPnl: +((m.sellP / r.fireP - 1) * 0.2).toFixed(4) } : { r, simPnl: r.pnl };
    });
    const trig = sim.filter(x => x.simPnl !== x.r.pnl || fn(x.r));
    const simTotal = sim.reduce((x, x2) => x + x2.simPnl, 0);
    const delta = simTotal - actual;
    const better = trig.filter(x => x.simPnl > x.r.pnl), worse = trig.filter(x => x.simPnl <= x.r.pnl);
    console.log(`${name}: 触发 ${String(trig.length).padStart(2)} | Δ净 ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | 改善 ${better.length} +${better.reduce((x, x2) => x + (x2.simPnl - x2.r.pnl), 0).toFixed(3)} / 恶化 ${worse.length} ${worse.reduce((x, x2) => x + (x2.simPnl - x2.r.pnl), 0).toFixed(3)} | 恶化最大: ${[...worse].sort((a, b) => (a.simPnl - a.r.pnl) - (b.simPnl - b.r.pnl)).slice(0, 3).map(x => x.r.tok.slice(0, 8) + (x.simPnl - x.r.pnl).toFixed(3)).join(' ')}`);
  };
  console.log('\n== 规则族（承接=非 burst 成员钱包买额）==');
  for (const X of [0.05, 0.1, 0.2]) {
    runRule(`A 递进版: 15s<${X}B ∧ 30s<${X}B → 30s价全卖`, r => (r.s1.nb < X && r.s2.nb < X) ? { sellP: r.p30 } : null);
    runRule(`B 单次版: 15s<${X}B → 15s价全卖`, r => (r.s1.nb < X) ? { sellP: r.p15 } : null);
  }
  // 笔数版
  runRule('C 笔数版: 15s新买笔<2 ∧ 30s<2 → 30s价全卖', r => (r.s1.nn < 2 && r.s2.nn < 2) ? { sellP: r.p30 } : null);
  runRule('D 总额版: 15s总额<0.2B ∧ 30s总额<0.2B → 30s价全卖', r => (r.s1.tot < 0.2 && r.s2.tot < 0.2) ? { sellP: r.p30 } : null);

  // 关键票落位（0.1 线）
  console.log('\n== 关键票落位（承接买额口径，X=0.1）==');
  console.log('token         roi%    | 15s: 承接/笔 总额 tick | 30s: 承接/笔 总额 tick | A版触发? 15s价 30s价 vs fire');
  for (const p of ['0x577c885d', '0x583a37e3', '0x6bd2cd2e', '0x531ddef1', '0xc97a6ea7', '0x7c89016d', '0x2f17249e', '0x40efb3d5', '0xba5ed45b', '0xefbd24cf', '0xfa99d9b5']) {
    const r = ok.find(x => x.tok.startsWith(p));
    if (!r) { console.log(p, '无'); continue; }
    const trig = r.s1.nb < 0.1 && r.s2.nb < 0.1;
    console.log(`${r.tok.slice(0, 10)} ${String(r.roi.toFixed(1)).padStart(6)}% | ${r.s1.nb}B/${r.s1.nn} ${r.s1.tot}B ${r.s1.ticks}t | ${r.s2.nb}B/${r.s2.nn} ${r.s2.tot}B ${r.s2.ticks}t | ${trig ? '触发' : '否'} 15s价${((r.p15 / r.fireP - 1) * 100).toFixed(1)}% 30s价${((r.p30 / r.fireP - 1) * 100).toFixed(1)}%`);
  }
  // A 版(0.1) 触发票全景
  console.log('\n== A 递进版(0.1) 全部触发票 ==');
  for (const r of ok.filter(r => r.s1.nb < 0.1 && r.s2.nb < 0.1).sort((a, b) => a.roi - b.roi)) {
    const simPnl = ((r.p30 / r.fireP - 1) * 0.2);
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} 实际${r.pnl.toFixed(4)} → 模拟${simPnl.toFixed(4)} (Δ${(simPnl - r.pnl >= 0 ? '+' : '') + (simPnl - r.pnl).toFixed(4)}) roi=${r.roi.toFixed(1)}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
