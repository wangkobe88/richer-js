// 一次性对拍（182 跑）：ea7d 案 famous 在场型——用户点名「这个也是 famous，0xffbd 在场」。
// 0xffbd 已在名单（11-07 收录）。输出：全部 BUY 信号锚的 gateBuyPoint 判定（persist:false）
// + famousTraces 痕迹行 + 0xffbd 全史时间线 + cheatDerived famous 键。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState } = require('../../src/market-analysis/buy-point-state-builder');

const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const ADDR = '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777';

async function main() {
  const client = await dbManager.getClient();
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));
  console.log(`famous roster ${rosterSet.size} 址（含新收录 0xb4e1e5…fee9）`);

  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', ADDR);
  const p = (creates && creates[0] && creates[0].payload) || {};
  const { data: et } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', V97).eq('token_address', ADDR);
  const meta = { address: ADDR, symbol: p.symbol || null, name: p.name || null, platform: (et && et[0] && et[0].platform) || p.platform || 'fourmeme' };

  const { data: sigs, error: sigErr } = await client.from('strategy_signals')
    .select('id,created_at').eq('experiment_id', V97).eq('signal_type', 'BUY')
    .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(10);
  if (sigErr) throw sigErr;
  console.log(`BUY 信号 ${sigs.length} 条`);

  // 全量 ticks（时间线用）
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
  console.log(`ticks 全部 ${rows.length} 行`);
  const allSorted = rows.slice().sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const t0 = allSorted.length ? Date.parse(allSorted[0].block_time) : 0;

  // famous 全史时间线（0xffbd + 任何名单钱包）
  const famAll = allSorted.filter((r) => rosterSet.has(String(r.sender_address || r.trader_address || '').toLowerCase()));
  console.log(`\n---- famous 全史 ${famAll.length} 行 ----`);
  for (const r of famAll.slice(0, 40)) {
    const tRel = ((Date.parse(r.block_time) - t0) / 1000).toFixed(0);
    console.log(`  t+${tRel}s ${String(r.trade_type).toUpperCase()} ${Number(r.bnb_amount).toFixed(4)} ${String(r.sender_address || r.trader_address).slice(0, 10)}…`);
  }

  const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false },
    { info() {}, warn() {}, error() {} }, {});

  for (const s of sigs) {
    const anchorMs = Date.parse(s.created_at);
    const r = await bp.gateBuyPoint(ADDR, meta, { experimentId: 'bp61-ea7d' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`\n== 信号 ${s.created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule}) pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);

    // 痕迹行 state 渲染（首条信号打印全文行）
    if (s === sigs[0]) {
      const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs);
      const feed = win.slice(-3000);
      const snap = buildBuyPointSnapshot(feed, meta, { capped: win.length > 3000, anchorTickCount: feed.length, signalInfo: null, famousRoster: rosterSet });
      const cd = snap.cheatDerived || {}; const ft = (snap.buyDerived || {}).famousTraces;
      console.log(`  cheatDerived.famous: dom=${cd.famousDominancePct}(${cd.famousDominanceLevel}) groupBuy=${cd.famousGroupBuyPct} hold=${cd.famousHoldPct}`);
      if (ft) {
        console.log(`  痕迹行: wallets=${ft.wallets.length} groupBuyBnb=${ft.groupBuyBnb?.toFixed(4)} groupBuyPct=${ft.groupBuyPct?.toFixed(1)} netSum=${ft.netSumBnb?.toFixed(4)} inCustody=${ft.inCustodyCount}`);
        for (const w of ft.wallets) console.log(`    ${w.w} 买${w.buyBnb.toFixed(4)}@t+${w.firstBuyDt}s 卖${(w.sellBnb || 0).toFixed(4)} 净${w.netBnb >= 0 ? '+' : ''}${w.netBnb.toFixed(4)}`);
      } else console.log('  痕迹行: null');
      const { state } = buildBuyPointState(snap);
      for (const ln of state.split('\n')) {
        if (/famous 痕迹|筹码结构/.test(ln)) console.log(`  | ${ln.slice(0, 500)}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
