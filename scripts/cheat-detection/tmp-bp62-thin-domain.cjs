// 一次性（182 跑）：用户裁定「famous 只判交易量尚且不足/尚未火过的代币」——适用域区分轴取证：
// c84a（厚盘反例，应翻回 none）vs 147d/0432/米（薄盘③正例）vs 59f5（在场型 none）。
// 维度：盘龄（fire−create）、锚窗 spanSec/tickCount、吞吐、famous 首买相对盘龄、curVs。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const TOKENS = [
  { exp: V95, addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', key: 'c84a-厚盘反例' },
  { exp: V97, addr: '0x147d75f133130713c803d35a046da9b7c19effff', key: '147d-③正例' },
  { exp: V97, addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', key: '0432-③正例' },
  { exp: V97, addr: '0x338a510c6c7abd4c714d74225086542270427777', key: '米-③正例' },
  { exp: V94, addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', key: '59f5-在场型none' },
];

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', addrs);
  const createBy = new Map((creates || []).map((r) => [r.token_address, r]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V97]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  console.log('票 | 盘龄min(fire−create) | 锚窗spanSec | ticks | buyVolBnb | famous首买@盘龄min | 占买% | curVs% | minVs%');
  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (!sigs || !sigs.length) { console.log(`${t.key} 无信号`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const rows = [];
    let fromId = 0;
    for (;;) {
      const { data, error } = await client.from('wss_price_ticks')
        .select('id,block_time,price_bnb,bnb_amount,trade_type').eq('token_address', t.addr)
        .gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
    const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs).slice(-3000);
    const cr = createBy.get(t.addr);
    const createMs = cr ? Date.parse(cr.block_time) : null;
    const p = (cr && cr.payload) || {};
    const meta = { address: t.addr, symbol: p.symbol, name: p.name, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const snap = buildBuyPointSnapshot(win, meta, { anchorTickCount: win.length, signalInfo: null });
    const a = snap.buyDerived || {}, cd = snap.cheatDerived || {};
    const ft = (a.famousTraces || {});
    const firstFamousDt = ft.wallets && ft.wallets.length ? ft.wallets[0].firstBuyDt : null;
    const ageMin = createMs != null ? ((anchorMs - createMs) / 60000).toFixed(1) : '?';
    const fm = firstFamousDt != null ? ((anchorMs + firstFamousDt * 1000 - createMs) / 60000).toFixed(1) : '?';
    console.log(`${t.key} | ${ageMin} | ${cd.spanSec ?? '?'} | ${cd.tickCount ?? win.length} | ${(cd.totalBuyBnb ?? 0).toFixed(2)} | ${fm} | ${ft.groupBuyPct ?? '?'}% | curVs=${a.currentVsLaunchPct ?? '?'} minVs=${a.minVsLaunchPct ?? '?'}`);
    if (ft.wallets) for (const w of ft.wallets) console.log(`    ${w.w.slice(0, 8)} 买${w.buyBnb.toFixed(4)}×${w.buyN}@t+${w.firstBuyDt}s 卖${(w.sellBnb || 0).toFixed(4)}×${w.sellN || 0}@t+${w.firstSellDt}s 净${w.netBnb.toFixed(4)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
