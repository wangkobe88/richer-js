// duanju 0x65aebe91…7777 双问题取证 v2（182 跑）：地址以 DB ilike 反查为准（首版 eq 失配=地址含不可见差异）。
// 问题① 首买 0.3 BNB 为何判 pvp；问题② burst 形状为何活跃度 low。BP/cheat 表回测 persist:false 不落，
// 明细在 signal metadata（buyPoint/cheatCheck 段）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('4af09d63')).id;
  const { data: sig } = await c.from('strategy_signals')
    .select('created_at,executed,metadata,token_address')
    .eq('experiment_id', id).eq('signal_type', 'BUY')
    .ilike('token_address', '0x65aebe91%')
    .order('created_at', { ascending: true }).limit(5);
  const ADDR = sig && sig[0] && sig[0].token_address;
  console.log(`== duanju BUY 信号 ${sig ? sig.length : 0} 行 ADDR=${ADDR} ==`);
  for (const s of sig || []) {
    const m = s.metadata || {};
    console.log(`\n--- ${s.created_at} exec=${s.executed} er=${m.execution_reason || ''} ---`);
    if (m.buyPoint) {
      const bp = JSON.stringify(m.buyPoint);
      console.log('buyPoint:', bp.slice(0, 1500));
    }
    if (m.cheatCheck) console.log('cheatCheck:', JSON.stringify(m.cheatCheck).slice(0, 1200));
  }
  // ticks 轨迹（全窗）
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
      .eq('token_address', ADDR)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(off, off + 499);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 500) break;
    off += 500;
  }
  console.log(`\n== ticks ${rows.length} 行；首 35 行 ==`);
  for (const r of rows.slice(0, 35)) {
    const w = (r.sender_address || r.trader_address || '?').slice(0, 10);
    const p = Number(r.price_bnb || 0);
    console.log(`  ${r.block_time.slice(5, 19)} blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)}B @${p.toExponential(3)} ${w}${r.price_outlier ? ' OUT' : ''}`);
  }
  // 静默段扫描（≥30s gap）+ 各段买量/钱包数（burst 判据对拍）
  console.log('\n== 行间 gap 扫描（≥20s 的间隙） ==');
  let prevTs = null, segStart = rows[0] ? rows[0].block_time : null;
  const segs = [];
  let cur = { buy: 0, sell: 0, wallets: new Set(), n: 0, start: null };
  const flush = () => { if (cur.n > 0) segs.push(cur); cur = { buy: 0, sell: 0, wallets: new Set(), n: 0, start: null }; };
  for (const r of rows) {
    const ts = new Date(r.block_time).getTime();
    if (prevTs !== null && ts - prevTs >= 20000) { // ≥20s gap 开新段
      flush();
      console.log(`  gap ${(ts - prevTs) / 1000 | 0}s @ ${r.block_time.slice(11, 19)} 前段末 ${new Date(prevTs).toISOString().slice(11, 19)}`);
    }
    if (!cur.start) cur.start = r.block_time;
    cur.n++;
    const w = r.sender_address || r.trader_address;
    if (r.trade_type === 'buy') { cur.buy += Number(r.bnb_amount || 0); if (w) cur.wallets.add(w); }
    else cur.sell += Number(r.bnb_amount || 0);
    prevTs = ts;
  }
  flush();
  console.log('== 段摘要（gap≥20s 切分）==');
  for (const s of segs)
    console.log(`  [${s.start.slice(11, 19)} 起] ${s.n} 行 买${s.buy.toFixed(3)}B/${s.wallets.size} 钱包 卖${s.sell.toFixed(3)}B`);
  // ≥0.19 大户轨迹
  const bigs = new Map();
  for (const r of rows) {
    const w = r.sender_address || r.trader_address;
    if (!w) continue;
    if (r.trade_type === 'buy' && Number(r.bnb_amount || 0) >= 0.19 && !bigs.has(w)) bigs.set(w, Number(r.bnb_amount));
  }
  console.log(`\n== ≥0.19 首买大户 ${bigs.size} 个全程轨迹 ==`);
  for (const [w, fb] of bigs) {
    let buy = 0, sell = 0, last = '';
    for (const r of rows) {
      if ((r.sender_address || r.trader_address) !== w) continue;
      if (r.trade_type === 'buy') buy += Number(r.bnb_amount || 0); else sell += Number(r.bnb_amount || 0);
      last = r.block_time;
    }
    console.log(`  ${w.slice(0, 12)} 首买${fb.toFixed(3)}B 全程买${buy.toFixed(3)} 卖${sell.toFixed(3)} 末行${last.slice(11, 19)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
