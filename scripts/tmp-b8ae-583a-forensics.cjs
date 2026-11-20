const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x583a37e3398b6bdab92a032e7356aa551b4f7777';

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
      console.log('fire 因子: curVs=', tf.currentVsLaunchPct, 'chg5?', tf.tokenAgeSec, 'age=', tf.tokenAgeSec, 'buyVol=', tf.buyVolumeBnb, 'actTotal=', tf.actTotalBnb, 'holders=', tf.holdersExDust);
      const fc = m.factorCheck;
      if (fc) {
        const bg = (fc.gates || []).filter(g => /burst|pvp|act_idle/.test(g.id));
        for (const g of bg) console.log('  FP', g.id, g.hit, g.value);
      }
      console.log('  actFront:', JSON.stringify(m.actFrontGate));
      const cc = m.cheatCheck;
      if (cc) console.log('  cheat:', cc.grade, 'sbw=', cc.levels && cc.levels.stallBurstWave, 'act=', cc.levels && cc.levels.activityLevel, 'burstWaveBuyBnb=', cc.anchors && cc.anchors.burstWaveBuyBnb, 'exempt=', JSON.stringify(cc.exempt));
      const bp = m.buyPoint;
      if (bp) console.log('  BP: passed=', bp.passed, '| shape=', JSON.stringify(bp.dimensions && bp.dimensions.entry_shape), '| anchors chg5=', bp.anchors && bp.anchors.chg5Pct, 'curVs=', bp.anchors && bp.anchors.currentVsLaunchPct, 'idle=', bp.anchors && bp.anchors.actIdlePct, 'athVs=', bp.anchors && bp.anchors.athVsLaunchPct, 'burst5=', bp.anchors && bp.anchors.burst5N, bp.anchors && bp.anchors.burst5BuyBnb, 'tvm=', bp.anchors && bp.anchors.totalVolumeBnb);
    } else {
      console.log('  stallClose:', JSON.stringify(m.stallClose), '| pp=', m.profitPercent, '| reason 细节=', m.reason);
    }
  }
  const { data: trades } = await sb.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const t of trades || []) {
    console.log('\nTRADE', t.created_at, t.trade_direction, '| in=', t.input_amount, '| out=', t.output_amount, '| unit=', t.unit_price, '| success=', t.success);
    if (t.metadata && (t.metadata.pnlBnb != null || t.metadata.profitPercent != null)) console.log('   pnlBnb=', t.metadata.pnlBnb, 'pp=', t.metadata.profitPercent);
  }
  // ticks 轨迹
  const createT = ev && ev[0] ? ev[0].block_time : '2026-10-19T00:00:00';
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,price_bnb,bnb_amount,trade_type')
    .eq('token_address', TOKEN)
    .gte('block_time', createT)
    .order('block_time', { ascending: true }).limit(1500);
  if (error) throw error;
  const ts = ticks || [];
  const t0 = ts.length ? new Date(ts[0].block_time).getTime() : 0;
  console.log('\nticks 总数:', ts.length);
  // 30s 桶
  const buckets = new Map();
  for (const t of ts) {
    const b = Math.floor((new Date(t.block_time).getTime() - t0) / 30000);
    if (!buckets.has(b)) buckets.set(b, { n: 0, buy: 0, sell: 0, buyBnb: 0, hi: 0, lo: Infinity });
    const o = buckets.get(b); o.n++;
    const p = Number(t.price_bnb);
    if (t.trade_type === 'buy') { o.buy++; o.buyBnb += Number(t.bnb_amount); } else o.sell++;
    o.hi = Math.max(o.hi, p); o.lo = Math.min(o.lo, p);
  }
  console.log('-- 30s 桶（t+秒 买卖笔/买额 hi/lo 价指数e-9）:');
  for (const [b, o] of [...buckets].sort((a, b) => a[0] - b[0]).slice(0, 40)) {
    console.log(`  t+${String(b * 30).padStart(5)}s ${String(o.n).padStart(3)}笔 买${o.buy}/卖${o.sell} 买额${o.buyBnb.toFixed(2)}B  hi=${o.hi.toExponential(3).slice(0, 8)} lo=${o.lo.toExponential(3).slice(0, 8)}`);
  }
  let ath = 0, athT = null;
  for (const t of ts) { const p = Number(t.price_bnb); if (p > ath) { ath = p; athT = t.block_time; } }
  const last = ts[ts.length - 1];
  console.log(`\nATH=${ath.toExponential(4)}@${athT}  末价=${Number(last.price_bnb).toExponential(4)}@${last.block_time} 末/ATH=${(Number(last.price_bnb) / ath * 100).toFixed(1)}%`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
