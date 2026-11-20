const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x493110fac98328a4fd3447f2125a34d514107777';

async function main() {
  const sb = dbManager.getClient();

  // 1) token_create 时间
  const { data: evs } = await sb.from('wss_events')
    .select('block_time,payload,kind')
    .eq('token_address', TOKEN).in('kind', ['token_create', 'graduation'])
    .order('block_time', { ascending: true }).limit(5);
  for (const e of (evs || [])) {
    console.log('EVENT', e.kind, e.block_time);
  }
  const createdAt = evs && evs[0] ? new Date(evs[0].block_time) : null;

  // 2) 信号行
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  console.log('\n信号行数:', (sigs || []).length);
  for (const s of (sigs || [])) {
    const m = s.metadata || {};
    console.log('\n===', s.created_at, s.signal_type, s.action, '| status=', s.status, '| reason=', s.reason);
    if (createdAt) console.log('  ageSec@sig =', ((new Date(s.created_at) - createdAt) / 1000).toFixed(1));
    const sg = m.signalGate;
    if (sg) console.log('  signalGate:', JSON.stringify(sg).slice(0, 400));
    // 因子快照里的 launch* / 首块相关键
    const f = s.factors || (m.factors) || null;
    if (f) {
      const keys = ['launchBundleClusterSize','launchFirstBlockWallets','launchFirstWaveWallets','launchMinVsFloorPct','launchConstVsPct','tradeCount','buyVolumeBnb','tokenAgeSec','currentVsLaunchPct','actTotalBnb','holdersExDust','circSupplyPct','holderHHI'];
      const out = {};
      for (const k of keys) if (f[k] !== undefined) out[k] = f[k];
      console.log('  因子快照 launch/trade 键:', JSON.stringify(out));
    }
    if (s.status && s.status !== 'executed') {
      console.log('  非executed FULL metadata:', JSON.stringify(m).slice(0, 2000));
    }
  }

  // 3) trades
  const { data: trades } = await sb.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  console.log('\ntrades 行数:', (trades || []).length);
  for (const t of (trades || [])) {
    console.log(' ', t.created_at, t.action || t.trade_type || t.side, 'bnb=', t.bnb_amount ?? t.amount_bnb, 'price=', t.price, 'profit=', t.profit_bnb ?? '');
  }

  // 4) 首块形状：最早 150 行 ticks
  const { data: ticks, error: tErr } = await sb.from('wss_price_ticks')
    .select('block_number,block_time,log_index,event_type,bnb_amount,sender_address,trader_address,price')
    .eq('token_address', TOKEN)
    .gt('block_number', 0)
    .order('block_number', { ascending: true })
    .limit(150);
  if (tErr) { console.log('ticks err:', tErr.message); process.exit(0); }
  console.log('\n首块 ticks 拉到行数:', (ticks || []).length);
  if (ticks && ticks.length) {
    const firstBlock = ticks[0].block_number;
    const fbRows = ticks.filter(r => r.block_number === firstBlock);
    const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
    const wallets = new Set(fbRows.filter(r => r.event_type === 'buy').map(wallet));
    let buyBnb = 0, sellBnb = 0;
    for (const r of fbRows) {
      if (r.event_type === 'buy') buyBnb += Number(r.bnb_amount || 0);
      else if (r.event_type === 'sell') sellBnb += Number(r.bnb_amount || 0);
    }
    console.log(`首块 block=${firstBlock} 行数=${fbRows.length} 买钱包数=${wallets.size} 买额=${buyBnb.toFixed(4)} 卖额=${sellBnb.toFixed(4)}`);
    console.log('首块时间:', fbRows[0].block_time, '| token_create:', createdAt ? createdAt.toISOString() : '?');
    // 逐行明细
    for (const r of fbRows) {
      console.log(`  ${r.event_type} ${Number(r.bnb_amount||0).toFixed(4)}B w=${wallet(r).slice(0,10)} price=${r.price}`);
    }
    // 第二块
    const blocks = [...new Set(ticks.map(r => r.block_number))].sort((a,b)=>a-b);
    if (blocks.length > 1) {
      const b2 = blocks[1];
      const b2rows = ticks.filter(r => r.block_number === b2);
      const w2 = new Set(b2rows.filter(r => r.event_type==='buy').map(wallet));
      let b2buy = 0; for (const r of b2rows) if (r.event_type==='buy') b2buy += Number(r.bnb_amount||0);
      console.log(`\n第二块 block=${b2} 行数=${b2rows.length} 买钱包数=${w2.size} 买额=${b2buy.toFixed(4)}`);
    }
    // 首 120 秒逐块摘要
    const t0 = fbRows[0].block_time;
    const perBlock = new Map();
    for (const r of ticks) {
      const k = r.block_number;
      if (!perBlock.has(k)) perBlock.set(k, { n: 0, buy: 0, sell: 0, wallets: new Set(), dt: r.block_time });
      const o = perBlock.get(k);
      o.n++;
      if (r.event_type === 'buy') { o.buy += Number(r.bnb_amount||0); o.wallets.add(wallet(r)); }
      else o.sell += Number(r.bnb_amount||0);
    }
    console.log('\n前 20 块摘要 (block | 距首块s | 行 | 买B | 卖B | 买钱包):');
    let i = 0;
    for (const [blk, o] of [...perBlock.entries()].sort((a,b)=>a[0]-b[0])) {
      if (i++ >= 20) break;
      const dt = ((new Date(o.dt) - new Date(t0)) / 1000).toFixed(1);
      console.log(`  ${blk} | +${dt}s | n=${o.n} | buy=${o.buy.toFixed(3)} | sell=${o.sell.toFixed(3)} | w=${o.wallets.size}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
