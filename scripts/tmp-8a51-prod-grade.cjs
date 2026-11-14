// 对拍生产 cheat_detection 行 + 太空制药在模拟中的信号轨迹(小结果)
const { dbManager } = require('../src/services/dbManager');
const SIM = 'a1457a15-382c-4960-b845-f1b7a91624df';
const SRC = '8a51f2fd-e467-4459-9004-18b9486ab567';
const TOKS = ['0x7e4468d4cd89b5ca97f504b526c592fd37297777', '0xf5e642bc79bd3dff16bb02794c6854933bb57777', '0x6a4f5e1567d1a8e5eb2b1b74772e2b6ee66b7777'];
(async () => {
  const c = dbManager.getClient();
  // 0) 太空制药真实地址:从实际实验 trades 拿 0x6a4f 前缀的完整地址
  const { data: tr } = await c.from('trades').select('token_address,token_symbol').eq('experiment_id', SRC).limit(50);
  const realAddrs = [...new Set((tr || []).map(x => x.token_address))];
  console.log('实际实验 trade tokens:', JSON.stringify(realAddrs.map(a => a.slice(0, 12)), null, 0));
  const toks = realAddrs;
  // 1) 生产 cheat_detection 行
  const { data: cd, error } = await c.from('cheat_detection')
    .select('token_address,grade,grade_reasons,created_at,digest').in('token_address', toks)
    .order('created_at', { ascending: true }).limit(50);
  if (error) console.log('cd ERR', error.message);
  else for (const r of (cd || [])) {
    console.log(`[prod-cheat] ${r.token_address.slice(0, 10)} ${r.created_at?.slice(11, 19)} grade=${r.grade} reasons=${JSON.stringify(r.grade_reasons || []).slice(0, 120)}`);
  }
  // 2) 太空制药在模拟实验的信号
  for (const a of toks) {
    if (!a.startsWith('0x6a4f')) continue;
    const { data: sig } = await c.from('strategy_signals').select('signal_type,action,executed,reason,created_at,metadata').eq('experiment_id', SIM).eq('token_address', a).limit(10);
    console.log(`\n[sim-signals ${a.slice(0, 10)}] rows=${(sig || []).length}`);
    for (const s of (sig || []).slice(0, 4)) {
      console.log(`  ${s.created_at?.slice(11, 19)} ${s.signal_type} exec=${s.executed} reason=${String(s.reason || '').slice(0, 90)}`);
    }
  }
  // 3) 实际实验 3 票的最终盈亏(买 卖 合计)
  for (const a of toks) {
    const { data: t2 } = await c.from('trades').select('trade_direction,input_amount,output_amount,trade_status').eq('experiment_id', SRC).eq('token_address', a).limit(50);
    let inB = 0, outB = 0, inT = 0, outT = 0;
    for (const x of (t2 || [])) {
      if (x.trade_direction === 'buy') { inB += x.input_amount || 0; outT += x.output_amount || 0; }
      else { outB += x.output_amount || 0; inT += x.input_amount || 0; }
    }
    console.log(`[实际盈亏] ${a.slice(0, 10)} 买${inB.toFixed(4)}BNB 卖得${outB.toFixed(5)}BNB realized=${(outB - inB).toFixed(5)} openTok=${(outT - inT).toFixed(1)}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
