// 一次性（182 跑，不烧 Jev）：28ad（restart 立法票）bt-v100 三锚 famous 在场量级取证——
// 用户问「在场量级有多少」：锚窗总量+famousTraces 每钱包买/卖/净/卖买比。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const ADDR = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const ANCHORS = ['2026-11-05T07:15:42Z', '2026-11-05T07:15:54Z', '2026-11-05T07:15:58Z'];

async function main() {
  const client = await dbManager.getClient();
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));
  console.log(`famous 名单：${rosterSet.size} 址`);

  const { data: creates } = await client.from('wss_events')
    .select('platform,payload').eq('kind', 'token_create').eq('token_address', ADDR).limit(3);
  const p = (creates && creates[0] && creates[0].payload) || {};
  const { data: et } = await client.from('experiment_tokens').select('platform').eq('experiment_id', V100).eq('token_address', ADDR).limit(1);
  const meta = { address: ADDR, symbol: p.symbol || null, name: p.name || null, platform: (et && et[0] && et[0].platform) || 'fourmeme' };
  console.log(`token: ${meta.symbol} platform=${meta.platform}`);

  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,trader_address,sender_address')
      .eq('token_address', ADDR).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  console.log(`全史 ticks：${rows.length} 行（${rows[0] ? rows[0].block_time.slice(5, 19) : '-'} → ${rows[rows.length - 1] ? rows[rows.length - 1].block_time.slice(5, 19) : '-'}）`);

  for (const a of ANCHORS) {
    const anchorMs = Date.parse(a);
    const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs);
    const feed = win.slice(-3000);
    const snap = buildBuyPointSnapshot(feed, meta, { capped: win.length > 3000, anchorTickCount: feed.length, signalInfo: null, famousRoster: rosterSet });
    const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {}, ft = bd.famousTraces;
    const buyN = feed.filter((x) => x.trade_type === 'buy').length;
    const buyBnb = feed.filter((x) => x.trade_type === 'buy').reduce((s, x) => s + (x.bnb_amount || 0), 0);
    console.log(`\n===== 锚 ${a.slice(5, 19)} | ticks=${feed.length}（全史到锚 ${win.length}）买笔=${buyN} 买额=${buyBnb.toFixed(3)}B =====`);
    console.log(`cheatDerived.famous: dom=${cd.famousDominancePct}(${cd.famousDominanceLevel}) groupBuyPct=${cd.famousGroupBuyPct} holdPct=${cd.famousHoldPct}`);
    if (ft) {
      console.log(`痕迹行: wallets=${ft.wallets.length} groupBuyBnb=${ft.groupBuyBnb?.toFixed(4)} groupBuyPct=${ft.groupBuyPct?.toFixed(1)} groupSellPct=${ft.groupSellPct?.toFixed(1)} netSum=${ft.netSumBnb?.toFixed(4)} inCustody=${ft.inCustodyCount}`);
      for (const w of ft.wallets)
        console.log(`  ${w.w} 买${w.buyBnb.toFixed(4)}@t+${w.firstBuyDt}s(${w.buyN}笔) 卖${(w.sellBnb || 0).toFixed(4)}(${w.sellN}笔) 净${w.netBnb >= 0 ? '+' : ''}${w.netBnb.toFixed(4)} 卖/买=${w.buyBnb > 0 ? ((w.sellBnb || 0) / w.buyBnb * 100).toFixed(1) : '?'}%`);
    } else console.log('痕迹行: null（无名单钱包活动）');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
