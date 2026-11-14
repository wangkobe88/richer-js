// 一次性（182 跑）：修正版——v100 窗口/信号行（打 error 不吞）+ ba5e ticks 步长 1000 精扫。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  // ① experiments（无 name 列，全 config 打）
  const { data: exp, error: e1 } = await sb.from('experiments').select('id,status,created_at,config').eq('id', V100).limit(1);
  if (e1) console.log('exp err:', e1.message);
  if (exp && exp[0]) {
    const e = exp[0];
    console.log(`v100 status=${e.status} created=${e.created_at}`);
    const bt = (e.config || {}).backtest || {};
    console.log('backtest 段:', JSON.stringify(bt).slice(0, 600));
  } else console.log('experiments 无行');
  // ② v100 信号行（简单列+打 error）
  const { data: s1, error: e2 } = await sb.from('strategy_signals')
    .select('id,created_at,signal_type').eq('experiment_id', V100)
    .order('id', { ascending: true }).limit(3);
  if (e2) console.log('sig err:', e2.message);
  console.log(`v100 信号行前3: ${s1 ? s1.map(r=>r.created_at.slice(5,19)+':'+r.signal_type).join(' | ') : 'null'}`);
  const { data: cnt } = await sb.from('strategy_signals')
    .select('id').eq('experiment_id', V100).order('id', { ascending: false }).limit(2000);
  const buyCnt = (cnt || []).length;
  console.log(`v100 信号行采样(尾2000)=${buyCnt}`);
  // ③ ba5e 精扫：10.90M→11.01M 步长 1000 全行拉内存过滤
  let total = 0; const hits = [];
  for (let base = 10900000; base < 11010000; base += 1000) {
    const { data: seg, error: e3 } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount')
      .gt('id', base).lte('id', base + 1000).order('id', { ascending: true }).limit(1000);
    if (e3) { console.log('seg err@' + base, e3.message); break; }
    for (const r of (seg || [])) if (r.token === undefined) {
      // 需 token_address 字段——重拉带列
    }
    if (!seg || !seg.length) continue;
    // 上面没 select token_address，这里用另一法：整段 select 带 token_address
  }
  // 上面结构写岔了——重写为带 token_address 的一次性拉取
  let total2 = 0; const hits2 = [];
  for (let base = 10900000; base < 11010000; base += 1000) {
    const { data: seg, error: e3 } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,token_address')
      .gt('id', base).lte('id', base + 1000).order('id', { ascending: true }).limit(1000);
    if (e3) { console.log('seg err@' + base, e3.message); break; }
    if (!seg) continue;
    for (const r of seg) if (r.token_address === T) { total2++; hits2.push(r); }
  }
  console.log(`\nba5e ticks（10.90M~11.01M 步长1000 精扫）命中 ${total2} 行`);
  if (hits2.length) {
    console.log(`  首行 id=${hits2[0].id} ${hits2[0].block_time.slice(5,19)} ${hits2[0].trade_type} ${hits2[0].bnb_amount}`);
    console.log(`  末行 id=${hits2[hits2.length-1].id} ${hits2[hits2.length-1].block_time.slice(5,19)}`);
    // 07:39:24(token_create)~07:42:00 窗内行数+前 20 行时间线
    const w = hits2.filter(r => r.block_time >= '2026-11-05T07:39:24' && r.block_time <= '2026-11-05T07:42:00');
    console.log(`  窗 [07:39:24, 07:42:00] 行数=${w.length}`);
    for (const r of w.slice(0, 20)) console.log(`    ${r.block_time.slice(11,19)} ${r.trade_type} ${r.bnb_amount}`);
    if (w.length > 20) console.log(`    …共 ${w.length} 行`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
