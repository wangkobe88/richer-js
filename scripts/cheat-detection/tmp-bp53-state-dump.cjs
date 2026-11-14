// 一次性探针（182 跑）：BP53 对拍两立法票未翻③的根因——Jev 实际看到的 state 里
// famous 材料可见性。4 票：147d/0432/59f5/米338a（用户 11-10 新点名）。
// 打印：cheatDerived famous 键 + state 渲染行（筹码结构/[WALLETS] 前列）+ 米的 famous 全史时间线。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState } = require('../../src/market-analysis/buy-point-state-builder');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const TOKENS = [
  { exp: V97, key: '147d', addr: '0x147d75f133130713c803d35a046da9b7c19effff', full: true },
  { exp: V97, key: '0432', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777' },
  { exp: V96, key: '59f5', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777' },
  { exp: V97, key: '米338a', addr: '0x338a510c6c7abd4c714d74225086542270427777', fallbackExp: V94, timeline: true },
];

async function main() {
  const client = await dbManager.getClient();
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));
  console.log(`famous roster ${rosterSet.size} 址`);

  for (const t of TOKENS) {
    let sigs = null;
    for (const expId of [t.exp, t.fallbackExp].filter(Boolean)) {
      const { data } = await client.from('strategy_signals')
        .select('id,created_at').eq('experiment_id', expId).eq('signal_type', 'BUY')
        .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
      if (data && data.length) { sigs = data; t._exp = expId; break; }
    }
    if (!sigs) { console.log(`\n== ${t.key} 无 BUY 信号跳过`); continue; }
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
    const win = rows.filter((r) => Date.parse(r.block_time) <= anchorMs);
    const feed = win.slice(-3000);
    const meta = { address: t.addr, symbol: null, name: null, platform: 'fourmeme' };
    const snap = buildBuyPointSnapshot(feed, meta, { capped: win.length > 3000, anchorTickCount: feed.length, signalInfo: null });
    const d = snap.cheatDerived || {};
    console.log(`\n== ${t.key} (${t._exp}) 锚=${sigs[0].created_at.slice(11, 19)} 全部 ${rows.length} 行 / 锚窗 ${win.length} 行（喂 ${feed.length}）`);
    console.log(`cheatDerived.famous: dom=${d.famousDominancePct}(${d.famousDominanceLevel}) groupBuy=${d.famousGroupBuyPct} followerTop3=${d.famousFollowerTop3Pct} hold=${d.famousHoldPct}`);

    const { state } = buildBuyPointState(snap);
    const lines = state.split('\n');
    for (const ln of lines) {
      if (/筹码结构|famous|前列|大户|买入榜|卖压|参与结构/.test(ln)) console.log(`  | ${ln.slice(0, 400)}`);
    }
    if (t.full) {
      console.log('---- [WALLETS] 段全文 ----');
      let inW = false;
      for (const ln of lines) {
        if (ln.includes('[WALLETS]')) inW = true;
        else if (/^\[/.test(ln) && !ln.includes('[WALLETS]')) inW = false;
        if (inW) console.log(`  W| ${ln.slice(0, 300)}`);
      }
    }
    if (t.timeline) {
      const all = rows.slice().sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      const famAll = all.filter((r) => rosterSet.has(String(r.sender_address || r.trader_address || '').toLowerCase()));
      const t0 = all.length ? Date.parse(all[0].block_time) : anchorMs;
      console.log(`---- famous 全史 ${famAll.length} 行 ----`);
      for (const r of famAll.slice(0, 30)) {
        const tRel = ((Date.parse(r.block_time) - t0) / 1000).toFixed(0);
        const after = Date.parse(r.block_time) > anchorMs ? ' [锚后]' : '';
        console.log(`  t+${tRel}s ${String(r.trade_type).toUpperCase()} ${Number(r.bnb_amount).toFixed(4)} ${String(r.sender_address || r.trader_address).slice(0, 10)}…${after}`);
      }
      const net = new Map();
      for (const r of all.filter((x) => Date.parse(x.block_time) <= anchorMs)) {
        const w = String(r.sender_address || r.trader_address || '').toLowerCase();
        if (!rosterSet.has(w)) continue;
        net.set(w, (net.get(w) || 0) + (String(r.trade_type).toLowerCase() === 'buy' ? Number(r.bnb_amount || 0) : -Number(r.bnb_amount || 0)));
      }
      for (const [w, v] of net) console.log(`  锚窗 famous ${w.slice(0, 10)}… net=${v.toFixed(4)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
