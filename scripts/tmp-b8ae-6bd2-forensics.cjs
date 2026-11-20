const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x6bd2cd2e2ad82b72c1fa95df66acdea9b8077777';

async function main() {
  const sb = dbManager.getClient();
  const { data: ev } = await sb.from('wss_events').select('block_time,payload')
    .eq('token_address', TOKEN).eq('kind', 'token_create').limit(2);
  if (ev && ev.length) console.log('token_create @', ev[0].block_time, '| name=', ev[0].payload?.name);

  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log('\n===', s.created_at, s.signal_type, '| reason=', s.reason);
    if (s.signal_type === 'BUY') {
      const tf = m.trendFactors || {};
      console.log('fire 因子: curVs=', tf.currentVsLaunchPct, 'chg5=', tf.chg5Pct, 'chg30=', tf.chg30Pct, 'buyVol=', tf.buyVolumeBnb && tf.buyVolumeBnb.toFixed(3), 'age=', tf.tokenAgeSec, 'actTotal=', tf.actTotalBnb);
      const fc = m.factorCheck;
      if (fc) for (const g of (fc.gates || []).filter(g => /burst|pvp|act_idle|act_near/.test(g.id))) console.log('  FP', g.id, g.hit, '|', g.value);
      console.log('  actFront:', JSON.stringify(m.actFrontGate));
      const cc = m.cheatCheck;
      if (cc) console.log('  cheat:', cc.grade, 'sbw=', cc.levels && cc.levels.stallBurstWave, 'act=', cc.levels && cc.levels.activityLevel, 'exempt=', JSON.stringify(cc.exempt));
      const bp = m.buyPoint;
      if (bp) console.log('  BP: passed=', bp.passed, '| shape=', JSON.stringify(bp.dimensions && bp.dimensions.entry_shape), '| pattern=', JSON.stringify(bp.dimensions && bp.dimensions.market_pattern), '| chg5=', bp.anchors && bp.anchors.chg5Pct, 'curVs=', bp.anchors && bp.anchors.currentVsLaunchPct, 'idle=', bp.anchors && bp.anchors.actIdlePct, 'burst5=', bp.anchors && bp.anchors.burst5N, 'w/', bp.anchors && bp.anchors.burst5BuyBnb, 'B tvm=', bp.anchors && bp.anchors.totalVolumeBnb);
    } else {
      console.log('  pp=', m.profitPercent, '| stallClose=', JSON.stringify(m.stallClose), '| fsf=', JSON.stringify(m.factorSellFilter));
    }
  }
  const { data: trades } = await sb.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const t of trades || []) {
    console.log('TRADE', t.created_at, t.trade_direction, '| in=', Number(t.input_amount).toFixed(4), '| out=', Number(t.output_amount).toFixed(4), '| pp=', t.metadata && t.metadata.profitPercent);
  }
  // ticks 轨迹
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,price_bnb,bnb_amount,trade_type,sender_address')
    .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(400);
  const ts = ticks || [];
  const t0 = ts.length ? new Date(ts[0].block_time).getTime() : 0;
  const buckets = new Map();
  for (const t of ts) {
    const b = Math.floor((new Date(t.block_time).getTime() - t0) / 30000);
    if (!buckets.has(b)) buckets.set(b, { n: 0, buy: 0, sell: 0, buyB: 0, hi: 0, lo: Infinity });
    const o = buckets.get(b); o.n++;
    const p = Number(t.price_bnb);
    if (t.trade_type === 'buy') { o.buy++; o.buyB += Number(t.bnb_amount); } else o.sell++;
    o.hi = Math.max(o.hi, p); o.lo = Math.min(o.lo, p);
  }
  console.log('\nticks:', ts.length);
  for (const [b, o] of [...buckets].sort((a, b) => a[0] - b[0]).slice(0, 20)) {
    console.log(`  t+${String(b * 30).padStart(4)}s ${String(o.n).padStart(3)}笔 买${o.buy}/卖${o.sell} 买额${o.buyB.toFixed(2)}B  hi=${(o.hi / 5.5463e-9 * 100 - 100).toFixed(1)}% lo=${(o.lo / 5.5463e-9 * 100 - 100).toFixed(1)}%`);
  }
  let ath = 0, athT = null, last = ts[ts.length - 1];
  for (const t of ts) { const p = Number(t.price_bnb); if (p > ath) { ath = p; athT = t.block_time; } }
  console.log(`ATH=${(ath / 5.5463e-9 * 100 - 100).toFixed(1)}%@${athT} | 末tick=${(Number(last.price_bnb) / 5.5463e-9 * 100 - 100).toFixed(1)}%`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
