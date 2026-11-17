// ASTER 0x31e20378…7777 全形状取证（2026-11-15，182 跑）：
// ① C 窗三臂全部信号行；② ticks 价格轨迹（首两波/高点/买点/破发形状）；
// ③ 首两波钱包离场时点（首块+wave 块首买钱包何时卖光）。
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x31e2037870d82ba8b634287f972ec926373a7777';

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id,experiment_name').limit(500);
  const arms = [['v124', 'cd40fc2a'], ['v125', 'f31d615f'], ['v126', '8eddeb38']];
  for (const [tag, pre] of arms) {
    const id = exps.find((e) => e.id.startsWith(pre)).id;
    const { data: sig } = await c.from('strategy_signals')
      .select('created_at,signal_type,executed,reason,er:metadata->>execution_reason')
      .eq('experiment_id', id).eq('token_address', ADDR)
      .order('created_at', { ascending: true }).limit(20);
    console.log(`\n== ${tag} ASTER 信号 ${sig ? sig.length : 0} 行 ==`);
    for (const s of sig || []) console.log(`  ${s.created_at} ${s.signal_type} exec=${s.executed} [${s.reason || ''}] ${s.er || ''}`);
  }
  // ticks 轨迹（C 窗源 v72 采集段）
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
      .eq('token_address', ADDR)
      .gte('block_time', '2026-11-04T17:00:00Z').lte('block_time', '2026-11-04T17:20:00Z')
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`\n== ticks ${rows.length} 行（17:00→17:20）==`);
  const launch = 4496173469e-18; // fourmeme 主流档常量（参考）
  let hi = 0, hiT = '';
  for (const r of rows) {
    const p = Number(r.price_bnb || 0);
    if (p > hi) { hi = p; hiT = r.block_time; }
  }
  console.log(`区间最高价 ${hi.toExponential(4)} @ ${hiT.slice(11, 19)}（vs 常量发行价 ${((hi / launch - 1) * 100).toFixed(1)}%）`);
  // 逐行打印前 60 行（首两波形状）+ 买点段（17:08:30→17:09:10）
  const show = (list, tag) => {
    console.log(`-- ${tag} --`);
    for (const r of list) {
      const p = Number(r.price_bnb || 0);
      console.log(`  ${r.block_time.slice(11, 19)} blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(3)}B @${p.toExponential(3)} (${((p / launch - 1) * 100).toFixed(1)}%) ${(r.sender_address || r.trader_address || '').slice(0, 10)}${r.price_outlier ? ' OUT' : ''}`);
    }
  };
  show(rows.slice(0, 45), '开盘首两波段');
  const nearBuy = rows.filter((r) => r.block_time >= '2026-11-04T17:08:30' && r.block_time <= '2026-11-04T17:09:20');
  show(nearBuy, 'v124 买点段 17:08:30→17:09:20');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
