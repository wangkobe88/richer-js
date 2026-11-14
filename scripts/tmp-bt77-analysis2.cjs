// bt-v77 结果分析 v2（列名实况版）：锚对照+拒因+盈亏
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'ff1c8725-e6dd-46fb-a877-43fb6f463098';
const ANCHORS = [
  '0x92aac04f03278ce7ac82ba0367dbaf9686437777',
  '0xb97d5772bf70814161d29243b0e39ec62f734444',
  '0x24436292ae46bb4f0bdc4389d7180eaa82747777',
  '0xc88bf78562ad5b5212dc31750a694c1cf5d17777',
  '0x275c17eb37d8e5d4184d2f12565e4b4722727777',
  '0xb88113c98d5e33b15925edd635170e80a0fbffff',
  '0xbcb27c14a0faec17461cb6101810aee9fb554444',
  '0x5a8d94c69998daffcfdc365f1d333dc4ab087777',
];
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  let from = 0; const reasons = {}; let total = 0; const buyRows = [];
  for (;;) {
    const { data, error } = await db.from('strategy_signals')
      .select('token_address,token_symbol,signal_type,executed,reason,created_at')
      .eq('experiment_id', EXP).order('created_at').range(from, from + 999);
    if (error) throw new Error('signals: ' + error.message);
    if (!data || !data.length) break;
    for (const r of data) {
      if (r.signal_type !== 'BUY') continue;
      total++;
      const k = r.reason || (r.executed ? 'executed' : '?');
      reasons[k] = (reasons[k] || 0) + 1;
      if (r.executed) buyRows.push(r);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('== BUY 信号拒因分布（total=' + total + ' executed=' + buyRows.length + '）');
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);

  console.log('== BP39 通过锚 8 token 对照');
  for (const a of ANCHORS) {
    const { data: sig } = await db.from('strategy_signals')
      .select('signal_type,executed,reason,created_at').eq('experiment_id', EXP).eq('token_address', a);
    const buys = (sig || []).filter(s => s.signal_type === 'BUY');
    const last = buys[buys.length - 1];
    const { data: tr } = await db.from('trades')
      .select('trade_direction,input_currency,input_amount,output_amount,executed_at')
      .eq('experiment_id', EXP).eq('token_address', a).order('executed_at');
    let bnb = 0;
    for (const t of tr || []) bnb += t.trade_direction === 'sell' ? Number(t.output_amount || 0) : -Number(t.input_amount || 0);
    console.log(`  ${a.slice(0, 10)} BUY信号=${buys.length} 末=${last ? (last.executed ? '已执行' : last.reason) : '无信号'} 成交=${(tr || []).length} 笔 盈亏=${bnb.toFixed(5)}`);
  }

  // executed 买入票盈亏汇总
  console.log('== 已执行买入的 token 盈亏');
  const toks = [...new Set(buyRows.map(r => r.token_address))];
  let sum = 0;
  for (const t of toks) {
    const { data: tr } = await db.from('trades')
      .select('trade_direction,input_amount,output_amount')
      .eq('experiment_id', EXP).eq('token_address', t);
    let bnb = 0;
    for (const x of tr || []) bnb += x.trade_direction === 'sell' ? Number(x.output_amount || 0) : -Number(x.input_amount || 0);
    sum += bnb;
    console.log(`  ${t.slice(0, 10)} ${bnb >= 0 ? '+' : ''}${bnb.toFixed(5)}`);
  }
  console.log('  合计:', sum.toFixed(5));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
