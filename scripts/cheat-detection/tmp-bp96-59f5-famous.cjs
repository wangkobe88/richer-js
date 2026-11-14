// 一次性探针（182 跑）：bt-v96 0x59f5ccb6…7777 为何没判 famous_monopoly——
// 1) 拉该票 BUY 信号行 metadata（BP dimensions/anchors + cheatCheck famous 轴）
// 2) 拉 famous-copy-wallets 名单，对锚窗 ticks 算 famous 命中（买额/净持仓/占流通/占买入）
const { dbManager } = require('../../src/services/dbManager.js');

const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const ADDR = '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777';
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,metadata')
    .eq('experiment_id', V96).eq('token_address', ADDR).order('created_at', { ascending: true });
  if (error) throw error;
  console.log(`信号行 ${sigs.length} 条`);
  let firstBuy = null;
  for (const s of sigs) {
    const md = s.metadata || {};
    const bp = md.buyPoint || md.buyPointCheck || {};
    const dims = bp.dimensions || {};
    const mp = dims.market_pattern || {}, es = dims.entry_shape || {};
    const cheat = md.cheatCheck || md.cheat || {};
    const an = bp.anchors || {};
    console.log(`\n[${s.signal_type}] ${s.created_at} rule=${bp.rule} status=${bp.status}`);
    console.log(`  综=${(bp.assessment || {}).bucket} pattern=${mp.bucket}(${mp.prob}) entry=${es.bucket}(${es.prob})` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} athVs=${an.athVsLaunchPct ?? '?'}` +
      ` ticks=${an.tickCount ?? an.anchorTickCount ?? '?'} buyVol=${an.buyVolumeBnb ?? '?'}`);
    console.log(`  cheat.grade=${cheat.grade} reasons=${JSON.stringify(cheat.reasons || null)}`);
    // famous 轴锚（BP anchors + cheat digest）
    const famKeys = {};
    for (const k of Object.keys(an)) if (/famous|bundle/i.test(k)) famKeys[k] = an[k];
    console.log(`  bp.famous锚=${JSON.stringify(famKeys)}`);
    const lv = cheat.levels || {};
    const lvFam = {};
    for (const k of Object.keys(lv)) if (/famous|bundle|dom/i.test(k)) lvFam[k] = lv[k];
    console.log(`  cheat.famous档=${JSON.stringify(lvFam)}`);
    if (s.signal_type === 'BUY' && !firstBuy) firstBuy = s;
  }

  // famous 名单交集（锚窗=首 BUY 信号前全部行，按链上真序）
  const rosterRaw = require('../../config/rosters/famous-copy-wallets.json');
  const roster = (rosterRaw.wallets || []).map((w) => String(w).toLowerCase());
  const rosterSet = new Set(roster);
  console.log(`\nfamous 名单 ${roster.length} 址`);
  if (!firstBuy) { console.log('无 BUY 信号，跳过交集'); process.exit(0); }
  const anchorMs = Date.parse(firstBuy.created_at);

  // wss_price_ticks 单 token 查询：id 探针窗（无 token 索引，直接 eq 会 timeout）
  // 先用 wss_events token_create 定位创建时刻，再按 block_time 范围+id 递进窗拉
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload,block_time')
    .eq('kind', 'token_create').eq('token_address', ADDR);
  const createdMs = creates && creates.length ? Date.parse(creates[0].block_time) : null;
  console.log(`token_create=${createdMs ? new Date(createdMs).toISOString() : '?'} 首BUY=${firstBuy.created_at}`);

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
  win.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  console.log(`ticks 全部 ${rows.length} 行，锚窗 ${win.length} 行`);

  // 净持仓聚合（wallet=sender||trader；wallet 列即该口径落库值）
  const net = new Map(), buyBnb = new Map();
  for (const r of win) {
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    if (!w) continue;
    const isBuy = String(r.trade_type || '').toLowerCase() === 'buy';
    const amt = Number(r.bnb_amount || 0) * (isBuy ? 1 : -1);
    net.set(w, (net.get(w) || 0) + amt);
    if (isBuy) buyBnb.set(w, (buyBnb.get(w) || 0) + Number(r.bnb_amount || 0));
  }
  const pos = [...net.entries()].filter(([, v]) => v > 0);
  const posTotal = pos.reduce((a, [, v]) => a + v, 0);
  const totalBuy = [...buyBnb.values()].reduce((a, v) => a + v, 0);
  const famHits = pos.filter(([w]) => rosterSet.has(w));
  const famBuy = [...buyBnb.entries()].filter(([w]) => rosterSet.has(w));
  console.log(`正净钱包 ${pos.length} 个 Σ=${posTotal.toFixed(4)} BNB；Σ买=${totalBuy.toFixed(4)} BNB`);
  console.log(`famous 命中（正净）${famHits.length}：${famHits.map(([w, v]) => `${w.slice(0, 10)} net=${v.toFixed(4)} (${(v / posTotal * 100).toFixed(1)}%正净)`).join(' | ') || '(无)'}`);
  console.log(`famous 命中（买入）${famBuy.length}：${famBuy.map(([w, v]) => `${w.slice(0, 10)} buy=${v.toFixed(4)} (${(v / totalBuy * 100).toFixed(1)}%Σ买)`).join(' | ') || '(无)'}`);
  const top10 = pos.sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`正净 Top10：${top10.map(([w, v]) => `${w.slice(0, 10)} ${(v / posTotal * 100).toFixed(1)}%`).join(' | ')}`);
  const buyTop10 = [...buyBnb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`买入 Top10：${buyTop10.map(([w, v]) => `${w.slice(0, 10)} ${v.toFixed(3)} (${(v / totalBuy * 100).toFixed(1)}%)`).join(' | ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
