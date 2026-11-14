// 一次性（182 跑）：0432（收割中未翻③排查）+ c84a（③漂移排查——名单扩容效应？）
// dump 痕迹行 famousTraces + cheatDerived.famous* + state 痕迹/筹码结构行。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState } = require('../../src/market-analysis/buy-point-state-builder');

const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const TOKENS = [
  { exp: V97, addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', key: '0432' },
  { exp: V95, addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', key: 'c84a' },
];

async function main() {
  const client = await dbManager.getClient();
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));

  for (const t of TOKENS) {
    const { data: creates } = await client.from('wss_events')
      .select('token_address,payload').eq('kind', 'token_create').eq('token_address', t.addr);
    const p = (creates && creates[0] && creates[0].payload) || {};
    const { data: et } = await client.from('experiment_tokens')
      .select('token_address,platform').eq('experiment_id', t.exp).eq('token_address', t.addr);
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: (et && et[0] && et[0].platform) || p.platform || 'fourmeme' };
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (!sigs || !sigs.length) { console.log(`${t.key} 无信号`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);

    const rows = [];
    let fromId = 0;
    for (;;) {
      const { data, error } = await client.from('wss_price_ticks')
        .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,trader_address,sender_address')
        .eq('token_address', t.addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
    const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs);
    const feed = win.slice(-3000);
    const snap = buildBuyPointSnapshot(feed, meta, { capped: win.length > 3000, anchorTickCount: feed.length, signalInfo: null, famousRoster: rosterSet });
    const cd = snap.cheatDerived || {}; const ft = (snap.buyDerived || {}).famousTraces;
    console.log(`\n===== ${t.key} ${sigs[0].created_at.slice(11, 19)} ticks=${feed.length} =====`);
    console.log(`cheatDerived.famous: dom=${cd.famousDominancePct}(${cd.famousDominanceLevel}) groupBuyPct=${cd.famousGroupBuyPct} holdPct=${cd.famousHoldPct}`);
    if (ft) {
      console.log(`痕迹行: wallets=${ft.wallets.length} groupBuyBnb=${ft.groupBuyBnb?.toFixed(4)} groupBuyPct=${ft.groupBuyPct?.toFixed(1)} groupSellPct=${ft.groupSellPct?.toFixed(1)} netSum=${ft.netSumBnb?.toFixed(4)} inCustody=${ft.inCustodyCount}`);
      for (const w of ft.wallets) console.log(`  ${w.w} 买${w.buyBnb.toFixed(4)}@t+${w.firstBuyDt}s(${w.buyN}笔) 卖${(w.sellBnb || 0).toFixed(4)}(${w.sellN}笔) 净${w.netBnb >= 0 ? '+' : ''}${w.netBnb.toFixed(4)} 卖/买=${w.buyBnb > 0 ? ((w.sellBnb || 0) / w.buyBnb * 100).toFixed(1) : '?'}%`);
    } else console.log('痕迹行: null');
    const { state } = buildBuyPointState(snap);
    for (const ln of state.split('\n')) {
      if (/famous 痕迹|筹码结构/.test(ln)) console.log(`  | ${ln.slice(0, 600)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
