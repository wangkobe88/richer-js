require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { GMGNPortfolioAPI } = require('../src/core/gmgn-api/portfolio-api');

const TARGETS = [
  // 赢家组
  { p: '0xefbd24cf', tag: 'WIN +96.6%' },
  { p: '0xba5ed45b', tag: 'WIN +338.6%' },
  { p: '0x40efb3d5', tag: 'WIN +498.6%' },
  { p: '0xc97a6ea7', tag: 'WIN +141.4%' },
  { p: '0xbcb72829', tag: 'WIN +183.8%' },
  // 输家组
  { p: '0x577c885d', tag: 'LOSE -19.9%' },
  { p: '0x583a37e3', tag: 'LOSE -22.1%' },
  { p: '0x531ddef1', tag: 'LOSE -31.2%' },
  { p: '0x1878376d', tag: 'LOSE -15.7%' },
  { p: '0xe1cddaf0', tag: 'LOSE -23.3%' },
];
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const sb = dbManager.getClient();
  const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 15000 });
  const groups = { WIN: [], LOSE: [] };
  for (const t of TARGETS) {
    // v156 首 BUY 信号（531d/1878 可能在 v155/v145——用四窗找）
    const { data: sigs } = await sb.from('strategy_signals').select('token_address,created_at')
      .like('token_address', t.p + '%').eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(5);
    if (!sigs || !sigs.length) { console.log(t.p, '未找到信号'); continue; }
    // 取与 v156 同窗的（或最早）
    const sig = sigs.find(s => s.token_address) && sigs[0];
    const tok = sig.token_address, sigT = sig.created_at;
    const since = new Date(new Date(sigT).getTime() - 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('sender_address,trader_address,bnb_amount')
      .eq('token_address', tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', sigT).limit(200);
    const ws = new Map();
    for (const tk of (ticks || [])) {
      const w = (tk.sender_address || tk.trader_address || '').toLowerCase();
      if (w) ws.set(w, (ws.get(w) || 0) + Number(tk.bnb_amount));
    }
    const top = [...ws.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`\n### ${t.tag} ${tok.slice(0, 10)} 波内 top8 钱包`);
    const key = t.tag.startsWith('WIN') ? 'WIN' : 'LOSE';
    for (const [w, bnb] of top) {
      await sleep(250);
      let st = null;
      try {
        const r = await api.getWalletStats('bsc', w, '30d');
        st = r && !r.code ? r : null;
      } catch (e) { console.log('  ', w.slice(0, 10), 'ERR', e.message.slice(0, 60)); }
      if (!st) continue;
      const ps = st.pnl_stat || {}, cm = st.common || {};
      const row = {
        w: w.slice(0, 10), bnb: +bnb.toFixed(3),
        rp: Number(st.realized_profit || 0),
        buys: st.buy, sells: st.sell,
        tokNum: ps.token_num, wr: ps.winrate,
        hold5x: ps.pnl_gt_5x_num, hold2x: ps.pnl_2x_5x_num,
        avgHold: ps.avg_holding_period,
        tags: (cm.tags || []).join('/'), tag: cm.tag || '', last: st.last_timestamp,
      };
      groups[key].push(row);
      console.log(`   ${row.w} 波内${row.bnb}B | 30d盈亏${row.rp.toFixed(1)}$ 买${row.buys}/卖${row.sells} 票数${row.tokNum} 胜率${row.wr}% ${row.hold2x ? '2-5x:' + row.hold2x : ''}${row.hold5x ? ' >5x:' + row.hold5x : ''} 持仓${row.avgHold}s ${row.tag ? '标签[' + row.tag + ']' : ''}${row.tags ? '/' + row.tags : ''}`);
    }
  }
  // 汇总
  const agg = (g) => {
    if (!g.length) return '无数据';
    const n = g.length;
    const live = g.filter(r => r.buys + r.sells > 0);
    const rp = g.reduce((x, r) => x + r.rp, 0);
    const wr = live.length ? live.reduce((x, r) => x + r.wr, 0) / live.length : 0;
    const tokNum = live.length ? live.reduce((x, r) => x + r.tokNum, 0) / live.length : 0;
    return `${n} 钱包 | 活跃(30d有交易)${live.length} | 盈亏Σ${rp.toFixed(0)}$ | 活跃者胜率均${wr.toFixed(0)}% | 活跃者票数均${tokNum.toFixed(0)} | 死钱包(零交易)${n - live.length}`;
  };
  console.log('\n== 赢家组波内钱包 GMGN 30d 汇总 ==\n' + agg(groups.WIN));
  console.log('\n== 输家组波内钱包 GMGN 30d 汇总 ==\n' + agg(groups.LOSE));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
