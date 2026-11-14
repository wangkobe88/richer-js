// 一次性（182 跑，不烧 Jev）：restart 尘埃残仓豁免臂定线取证——
// 四票锚窗 launch 族锚（minVsLaunchPct=涨起后最低 vs 发行价；≤+10 即回过 almost_launch 域=BP43 重启形状）
// + famousTraces 在场净额（判「尘埃」量级）。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V99 = '87cc5a7d-d845-4c46-8edd-f19dde4ef10f';
const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const TARGETS = [
  { tag: '28ad-立法票', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', exp: V100, anchor: '2026-11-05T07:15:54Z' },
  { tag: '59f5-反例(BP65翻③)', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', exp: V99 },
  { tag: 'ea7d-反例(点名在场)', addr: '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777', exp: V97 },
  { tag: 'd928-反例(dom100)', addr: '0xd9289dbf', exp: V96 },
];

async function firstBuyAnchor(client, exp, addr) {
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at').eq('experiment_id', exp).eq('signal_type', 'BUY')
    .eq('token_address', addr).order('created_at', { ascending: true }).limit(1);
  return sigs && sigs.length ? sigs[0].created_at : null;
}

async function main() {
  const client = await dbManager.getClient();
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
    const an = snap.buyDerived || {}, bd = an, ft = bd.famousTraces, cd = snap.cheatDerived || {};
    const buyBnb = feed.filter((x) => x.trade_type === 'buy').reduce((s, x) => s + (x.bnb_amount || 0), 0);
    console.log(`锚=${anchorIso.slice(5, 19)} ticks=${feed.length} 买额=${buyBnb.toFixed(2)}B | minVs=${an.minVsLaunchPct} curVs=${an.currentVsLaunchPct} athVs=${an.athVsLaunchPct} launchCovered=${an.launchCovered}`);
    const ps = cd.postStall || null, w60 = bd.win && bd.win[60], w30 = bd.win && bd.win[30];
    console.log(`  重启证据: postStall=${ps ? JSON.stringify(ps) : 'null(无≥300s静默)'} | 近窗60s=${w60 ? `买${w60.buyBnb}B/${w60.buyN}笔 卖${w60.sellBnb}B/${w60.sellN}笔` : '-'} 近窗30s=${w30 ? `买${w30.buyBnb}B/${w30.buyN}笔` : '-'}`);
    console.log(`  act锚: ${cd.activity ? `ticks=${cd.activity.tickCount} tpm=${cd.activity.ticksPerMin} idlePct=${cd.activity.idlePct} maxGap=${cd.activity.maxGapSec}s` : '-'}`);
    if (ft) {
      const pres = ft.wallets.filter((w) => w.netBnb > 0);
      console.log(`famous: 在场 ${pres.length}/${ft.wallets.length}，在场净额 ${pres.map((w) => w.w.slice(0, 6) + '+' + w.netBnb.toFixed(4)).join(' ') || '-'}，在场净和 ${pres.reduce((s, w) => s + w.netBnb, 0).toFixed(4)}`);
      for (const w of ft.wallets)
        console.log(`    ${w.w} 买${w.buyBnb.toFixed(4)}@t+${w.firstBuyDt}s(${w.buyN}笔) 卖${(w.sellBnb || 0).toFixed(4)}(${w.sellN}笔) 净${w.netBnb >= 0 ? '+' : ''}${w.netBnb.toFixed(4)} 卖/买=${w.buyBnb > 0 ? ((w.sellBnb || 0) / w.buyBnb * 100).toFixed(1) : '?'}%`);
    } else console.log('famous: 无名单钱包活动');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
