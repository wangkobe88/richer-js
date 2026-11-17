// 0x65aebe91…7777 BP 判定取证（2026-11-15，182 跑）：用户问「首买不就是 0.3 BNB 吗，怎么给个 pvp 盘」
// ① v129 信号行+buyPoint 段；② buy_point_analyses 判定明细；③ ticks 首段大户行为轨迹。
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x65aebe91f87b3b8f94e8061f2fa578d7ed8577777';

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('4af09d63')).id;
  // ① 信号行
  const { data: sig } = await c.from('strategy_signals')
    .select('created_at,executed,reason,metadata')
    .eq('experiment_id', id).eq('token_address', ADDR).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(5);
  console.log(`== v129 该票 BUY 信号 ${sig ? sig.length : 0} 行 ==`);
  for (const s of sig || []) {
    const m = s.metadata || {};
    console.log(`${s.created_at} exec=${s.executed} er=${m.execution_reason || ''}`);
    if (m.buyPoint) console.log('  buyPoint:', JSON.stringify(m.buyPoint).slice(0, 900));
  }
  // ② buy_point_analyses
  const { data: bpa } = await c.from('buy_point_analyses')
    .select('*').eq('token_address', ADDR)
    .order('created_at', { ascending: false }).limit(3);
  console.log(`\n== buy_point_analyses ${bpa ? bpa.length : 0} 行 ==`);
  for (const r of bpa || []) {
    const keys = Object.keys(r);
    console.log(`${r.created_at} exp=${(r.experiment_id || '').slice(0, 8)} bucket=${r.bucket || r.market_pattern || '?'}`);
    const d = r.snapshot_digest || r.digest || null;
    if (d) {
      const dj = typeof d === 'string' ? JSON.parse(d) : d;
      // 打 wallets 前列/开盘段/dumpBlock 相关字段
      const sel = {};
      for (const k of ['wallets', 'openSeg', 'buyDerived', 'phaseSplit', 'state', 'answers', 'qualities'])
        if (dj[k] !== undefined) sel[k] = dj[k];
      console.log('  digest 摘要:', JSON.stringify(sel).slice(0, 2200));
    }
    console.log('  行键:', keys.join(',').slice(0, 400));
  }
  // ②b cheat_detection 行（sbw/act 判定链）
  const { data: cdt } = await c.from('cheat_detection')
    .select('*').eq('token_address', ADDR)
    .order('created_at', { ascending: false }).limit(2);
  console.log(`\n== cheat_detection ${cdt ? cdt.length : 0} 行 ==`);
  for (const r of cdt || []) {
    const d = r.digest || r.observation || null;
    const dj = d ? (typeof d === 'string' ? JSON.parse(d) : d) : null;
    console.log(`${r.created_at} exp=${(r.experiment_id || '').slice(0, 8)} grade=${r.grade || '?'} verdict=${r.verdict || '?'}`);
    if (dj) {
      const sel = {};
      for (const k of ['activityLevel', 'activity_level', 'extLevels', 'levels', 'anchors', 'state', 'phenomena'])
        if (dj[k] !== undefined) sel[k] = dj[k];
      console.log('  digest 摘要:', JSON.stringify(sel).slice(0, 1800));
    }
    console.log('  行键:', Object.keys(r).join(',').slice(0, 300));
  }
  // ③ ticks 首段
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
      .eq('token_address', ADDR)
      .gte('block_time', '2026-11-03T15:00:00Z').lte('block_time', '2026-11-04T14:00:00Z')
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(off, off + 499);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 500) break;
    off += 500;
  }
  console.log(`\n== ticks ${rows.length} 行（前 40 行） ==`);
  for (const r of rows.slice(0, 40)) {
    const w = (r.sender_address || r.trader_address || '?').slice(0, 10);
    console.log(`  ${r.block_time.slice(11, 19)} blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)}B ${w}`);
  }
  // 大户钱包的后续行为（首 3 分钟内 ≥0.19 的买单钱包逐个统计买/卖）
  const bigs = new Map();
  for (const r of rows) {
    const w = r.sender_address || r.trader_address;
    if (!w) continue;
    const b = Number(r.bnb_amount || 0);
    if (r.trade_type === 'buy' && b >= 0.19 && !bigs.has(w)) bigs.set(w, b);
  }
  console.log(`\n== ≥0.19 首买大户 ${bigs.size} 个，行为轨迹（全部行） ==`);
  for (const [w, firstB] of bigs) {
    let buy = 0, sell = 0, last = '';
    for (const r of rows) {
      const rw = r.sender_address || r.trader_address;
      if (rw !== w) continue;
      if (r.trade_type === 'buy') buy += Number(r.bnb_amount || 0); else sell += Number(r.bnb_amount || 0);
      last = r.block_time;
    }
    console.log(`  ${w.slice(0, 12)} 首买${firstB.toFixed(3)}B 全程买${buy.toFixed(3)} 卖${sell.toFixed(3)} 末行${last.slice(11, 19)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
