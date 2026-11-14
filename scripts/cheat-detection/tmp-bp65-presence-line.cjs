// 一次性（182 跑，不烧 Jev）：BP65 在场持有+交易额豁免臂定线——
// 用户裁定「famous 在场的话，需要略大的交易额历史才能豁免」。
// 矩阵：59f5（拦截目标，v99 成交锚）/c84a（不误伤正票=BP62 厚吞吐豁免 6.96B）/
//       ea7d（用户点名在场票 0xffbd）/d928（dom=100 教科书，统一门兜住）。
// 输出：锚窗 ticks/buyN/totalBuyBnb + famousTraces 明细 + cheatDerived famous 族。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V99 = '87cc5a7d-d845-4c46-8edd-f19dde4ef10f';
const TARGETS = [
  { tag: '59f5-拦', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', exp: V99, anchor: '2026-11-05T05:09:57Z' },
  { tag: 'c84a-不误伤', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', exp: V95 },
  { tag: 'ea7d-点名在场', addr: '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777', exp: V97 },
  { tag: 'd928-dom100', addr: '0xd9289dbf', exp: V96 }, // 前缀→查全址
];

async function firstBuyAnchor(client, exp, addr) {
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at').eq('experiment_id', exp).eq('signal_type', 'BUY')
    .eq('token_address', addr).order('created_at', { ascending: true }).limit(1);
  return sigs && sigs.length ? sigs[0].created_at : null;
}

async function main() {
  const client = await dbManager.getClient();
  // d928 全址解析（like 前缀→小结果读取）
  if (TARGETS[3].addr.length < 42) {
    const { data } = await client.from('strategy_signals').select('token_address')
      .eq('experiment_id', TARGETS[3].exp).eq('signal_type', 'BUY').like('token_address', '0xd9289dbf%').limit(1);
    TARGETS[3].addr = data && data[0] ? data[0].token_address : null;
  }
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));

  for (const t of TARGETS) {
    console.log(`\n===== ${t.tag} ${t.addr || '(未解析)'} =====`);
    if (!t.addr || t.addr.length < 42) { console.log('跳过'); continue; }
    let anchorIso = t.anchor;
    if (!anchorIso) anchorIso = await firstBuyAnchor(client, t.exp, t.addr);
    if (!anchorIso) { console.log('无信号锚'); continue; }
    const anchorMs = Date.parse(anchorIso);
    const { data: creates } = await client.from('wss_events')
      .select('platform,payload').eq('kind', 'token_create').eq('token_address', t.addr).limit(3);
    const p = (creates && creates[0] && creates[0].payload) || {};
    const { data: et } = await client.from('experiment_tokens').select('platform').eq('experiment_id', t.exp).eq('token_address', t.addr).limit(1);
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: (et && et[0] && et[0].platform) || 'fourmeme' };

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
    const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {}, ft = bd.famousTraces;
    const buyN = feed.filter((x) => x.trade_type === 'buy').length;
    const buyBnb = feed.filter((x) => x.trade_type === 'buy').reduce((s, x) => s + (x.bnb_amount || 0), 0);
    console.log(`锚=${anchorIso.slice(5, 19)} ticks=${feed.length}（全史到锚 ${win.length}）买笔=${buyN} 买额=${buyBnb.toFixed(2)}B`);
    console.log(`cheatDerived.famous: dom=${cd.famousDominancePct}(${cd.famousDominanceLevel}) groupBuyPct=${cd.famousGroupBuyPct} holdPct=${cd.famousHoldPct}`);
    if (ft) {
      console.log(`痕迹行: wallets=${ft.wallets.length} groupBuyBnb=${ft.groupBuyBnb?.toFixed(4)} groupBuyPct=${ft.groupBuyPct?.toFixed(1)} groupSellPct=${ft.groupSellPct?.toFixed(1)} netSum=${ft.netSumBnb?.toFixed(4)} inCustody=${ft.inCustodyCount}`);
      for (const w of ft.wallets) console.log(`  ${w.w.slice(0, 10)} 买${w.buyBnb.toFixed(4)}@t+${w.firstBuyDt}s(${w.buyN}笔) 卖${(w.sellBnb || 0).toFixed(4)}(${w.sellN}笔) 净${w.netBnb >= 0 ? '+' : ''}${w.netBnb.toFixed(4)} 卖/买=${w.buyBnb > 0 ? ((w.sellBnb || 0) / w.buyBnb * 100).toFixed(1) : '?'}%`);
    } else console.log('痕迹行: null（无名单钱包活动）');
  }
  // ea7d 在 v97 的成交盈亏（放行后结果）
  console.log('\n===== ea7d v97 成交 =====');
  const { data: tr } = await client.from('trades').select('trade_direction,input_amount,output_amount,created_at')
    .eq('experiment_id', V97).eq('token_address', '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777').order('created_at').limit(8);
  for (const x of tr || []) console.log(`${x.trade_direction} ${x.created_at.slice(5, 19)} in=${x.input_amount} out=${x.output_amount}`);
  if (!tr || !tr.length) console.log('无成交');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
