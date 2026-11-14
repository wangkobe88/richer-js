// 一次性探针（182 跑）：bt-v97 0x147d75f1…ffff 用户点名应判 famous（「买入的时候算是 famous 收割完了的状态」）——
// 1) 信号行判型（bt-v97 已查本地：pattern=none(0.9) 全门过买入，79s 后流动性止损）
// 2) famous 11 址在锚窗内的全程行为：买入额/卖出额/净持仓/清仓时间线（收割完形状=买点时刻净 0/负但历史大额买入在场）
const { dbManager } = require('../../src/services/dbManager.js');

const EXP = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const ADDR = '0x147d75f133130713c803d35a046da9b7c19effff';

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  if (error) throw error;
  let firstBuy = null;
  for (const s of sigs) {
    const md = s.metadata || {};
    const bp = md.buyPoint || {};
    const an = bp.anchors || {};
    const dims = bp.dimensions || {};
    const mp = dims.market_pattern || {};
    console.log(`[${s.signal_type}] ${s.created_at} rule=${bp.rule} pattern=${mp.bucket}(${mp.prob}) curVs=${an.currentVsLaunchPct ?? '?'} ticks=${an.tickCount ?? an.anchorTickCount ?? '?'} buyVol=${an.buyVolumeBnb ?? '?'} cheat=${(md.cheatCheck||{}).grade}`);
    if (s.signal_type === 'BUY' && !firstBuy) firstBuy = s;
  }
  if (!firstBuy) { console.log('无 BUY 信号'); process.exit(0); }
  const anchorMs = Date.parse(firstBuy.created_at);

  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const rosterSet = new Set((rosterRaw.wallets || []).map((w) => String(w).toLowerCase()));

  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error: e2 } = await client.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,trader_address,sender_address')
      .eq('token_address', ADDR).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (e2) throw e2;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  const win = rows.filter((r) => Date.parse(r.block_time) <= anchorMs);
  const all = rows.slice().sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  win.sort((a, b) => (a.block_number - a.block_number) || (a.log_index - b.log_index));
  const t0 = win.length ? Date.parse(win[0].block_time) : anchorMs;
  console.log(`\nticks 全部 ${rows.length} 行，锚窗 ${win.length} 行，锚=首BUY ${firstBuy.created_at}`);

  const net = new Map(), buyBnb = new Map(), sellBnb = new Map();
  for (const r of win) {
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    if (!w) continue;
    const isBuy = String(r.trade_type || '').toLowerCase() === 'buy';
    const amt = Number(r.bnb_amount || 0);
    net.set(w, (net.get(w) || 0) + (isBuy ? amt : -amt));
    if (isBuy) buyBnb.set(w, (buyBnb.get(w) || 0) + amt); else sellBnb.set(w, (sellBnb.get(w) || 0) + amt);
  }
  const pos = [...net.entries()].filter(([, v]) => v > 0);
  const posTotal = pos.reduce((a, [, v]) => a + v, 0);
  const totalBuy = [...buyBnb.values()].reduce((a, v) => a + v, 0);
  const totalSell = [...sellBnb.values()].reduce((a, v) => a + v, 0);

  // famous 专项：全程时间线（含锚后）+锚窗净持仓
  console.log(`正净 ${pos.length} 钱包 Σ=${posTotal.toFixed(4)}；Σ买=${totalBuy.toFixed(4)} Σ卖=${totalSell.toFixed(4)}`);
  const famAll = all.filter((r) => rosterSet.has(String(r.sender_address || r.trader_address || '').toLowerCase()));
  console.log(`\nfamous 名单行（全史 ${famAll.length} 行）：`);
  for (const r of famAll) {
    const tRel = ((Date.parse(r.block_time) - t0) / 1000).toFixed(0);
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    const after = Date.parse(r.block_time) > anchorMs ? ' [锚后]' : '';
    console.log(`  t+${tRel}s ${String(r.trade_type).toUpperCase()} ${Number(r.bnb_amount).toFixed(4)} @${Number(r.price_bnb).toExponential(3)} ${w.slice(0, 10)}…${after}`);
  }
  const famNet = new Map(), famBuy = new Map(), famSell = new Map();
  for (const r of win) {
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    if (!rosterSet.has(w)) continue;
    const isBuy = String(r.trade_type || '').toLowerCase() === 'buy';
    const amt = Number(r.bnb_amount || 0);
    famNet.set(w, (famNet.get(w) || 0) + (isBuy ? amt : -amt));
    if (isBuy) famBuy.set(w, (famBuy.get(w) || 0) + amt); else famSell.set(w, (famSell.get(w) || 0) + amt);
  }
  for (const w of new Set([...famBuy.keys(), ...famSell.keys()])) {
    console.log(`锚窗 famous ${w.slice(0, 10)}… buy=${(famBuy.get(w) || 0).toFixed(4)} sell=${(famSell.get(w) || 0).toFixed(4)} net=${(famNet.get(w) || 0).toFixed(4)}`);
  }
  const famBuyTot = [...famBuy.values()].reduce((a, v) => a + v, 0);
  const famSellTot = [...famSell.values()].reduce((a, v) => a + v, 0);
  console.log(`famous 合计：锚窗买=${famBuyTot.toFixed(4)}（${(famBuyTot / totalBuy * 100).toFixed(1)}%Σ买）卖=${famSellTot.toFixed(4)}（${(famSellTot / totalSell * 100).toFixed(1)}%Σ卖）净=${([...famNet.values()].reduce((a, v) => a + v, 0)).toFixed(4)}`);

  const top10 = pos.sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\n正净 Top10：${top10.map(([w, v]) => `${w.slice(0, 10)} ${v.toFixed(3)}(${(v / posTotal * 100).toFixed(1)}%)`).join(' | ')}`);
  const buyTop10 = [...buyBnb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`买入 Top10：${buyTop10.map(([w, v]) => `${w.slice(0, 10)} ${v.toFixed(3)}(${(v / totalBuy * 100).toFixed(1)}%)`).join(' | ')}`);
  // famous 是否进入买入 Top
  for (const [w, v] of buyTop10) if (rosterSet.has(w)) console.log(`※ 买入 Top10 含 famous：${w}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
