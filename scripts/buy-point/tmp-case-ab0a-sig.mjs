// 单票诊断：btv111 0xab0ad29b…7777 的信号 + 买点附近 ticks 买卖分布（本地小结果读取）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0xab0ad29b9d701aa2607dbc5392aba032b33e7777';
const c = await dbManager.getClient();

// 1) 信号
const { data: sigs, error: e1 } = await c.from('strategy_signals')
  .select('id,action,executed,reason,created_at,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true }).limit(100);
if (e1) throw new Error('signals: ' + e1.message);

// 2) trades
const { data: trades, error: e2 } = await c.from('trades')
  .select('id,trade_direction,created_at,metadata,signal_id')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true }).limit(100);
if (e2) throw new Error('trades: ' + e2.message);

// 3) ticks（单票全量，锚=信号窗）
const { data: ticks, error: e3 } = await c.from('wss_price_ticks')
  .select('id,trader_address,sender_address,bnb_amount,price_usd,trade_type,block_time,block_number,log_index')
  .eq('token_address', TOKEN)
  .order('block_time', { ascending: true }).limit(2000);
if (e3) throw new Error('ticks: ' + e3.message);

const wallet = t => (t.sender_address || t.trader_address || '').toLowerCase();
const fmt = b => Number(b).toFixed(4);

console.log('== 信号 ==');
for (const s of sigs) {
  const md = s.metadata || {};
  const sg = md.signalGate || {};
  console.log(`#${s.id} ${s.created_at} action=${s.action} status=${s.status} executed=${s.executed}`);
  if (md.signalGate) console.log('  signalGate:', JSON.stringify({ strategy: sg.strategyId ?? sg.strategyName, triggerNo: sg.triggerNo }));
  if (md.cheatCheck) console.log('  cheat:', JSON.stringify({ status: md.cheatCheck.status, grade: md.cheatCheck.grade, exempt: md.cheatCheck.exempt, exemptDenied: md.cheatCheck.exemptDenied, reasons: md.cheatCheck.reasons }));
  if (md.buyPoint) console.log('  buyPoint:', JSON.stringify(md.buyPoint));
  if (!md.signalGate && !md.cheatCheck && !md.buyPoint) console.log('  keys:', Object.keys(md).join(','));
}
console.log('== trades ==');
for (const t of trades) console.log(`#${t.id} ${t.created_at} ${t.trade_direction} bnb=${fmt(t.metadata?.bnbAmount ?? t.metadata?.totalCostBnb ?? '?')} sig=${t.signal_id}`);

console.log(`== ticks 总数 ${ticks.length} ==`);
const buy = ticks.filter(t => t.trade_type === 'buy');
const sell = ticks.filter(t => t.trade_type === 'sell');
const sumB = buy.reduce((a, t) => a + Number(t.bnb_amount), 0);
const sumS = sell.reduce((a, t) => a + Number(t.bnb_amount), 0);
console.log(`buy: ${buy.length} 笔 ${fmt(sumB)} BNB | sell: ${sell.length} 笔 ${fmt(sumS)} BNB`);
if (ticks.length) {
  console.log(`首 tick: ${ticks[0].block_time} 末 tick: ${ticks[ticks.length - 1].block_time}`);
  const p0 = Number(ticks[0].price_usd), pEnd = Number(ticks[ticks.length - 1].price_usd);
  console.log(`price_usd 首→末: ${p0} → ${pEnd}`);
}

// 4) 每个信号锚前 60s/10s 买卖分布
const anchorOf = s => new Date(s.created_at).getTime();
for (const s of sigs) {
  const a = anchorOf(s);
  for (const [win, label] of [[60, '前60s'], [10, '前10s'], [300, '前300s']]) {
    const w = ticks.filter(t => {
      const ts = new Date(t.block_time).getTime();
      return ts <= a && ts > a - win * 1000;
    });
    const wb = w.filter(t => t.trade_type === 'buy'), ws = w.filter(t => t.trade_type === 'sell');
    const bN = wb.reduce((x, t) => x + Number(t.bnb_amount), 0), sN = ws.reduce((x, t) => x + Number(t.bnb_amount), 0);
    console.log(`sig#${String(s.id).slice(0, 8)} ${label}: buy=${wb.length}笔/${fmt(bN)}B sell=${ws.length}笔/${fmt(sN)}B`);
  }
  // 锚后 60s 也看一眼（后向）
  const af = ticks.filter(t => {
    const ts = new Date(t.block_time).getTime();
    return ts > a && ts <= a + 60 * 1000;
  });
  const ab = af.filter(t => t.trade_type === 'buy'), as = af.filter(t => t.trade_type === 'sell');
  console.log(`sig#${String(s.id).slice(0, 8)} 后60s: buy=${ab.length}笔/${fmt(ab.reduce((x, t) => x + Number(t.bnb_amount), 0))}B sell=${as.length}笔/${fmt(as.reduce((x, t) => x + Number(t.bnb_amount), 0))}B`);
}

// 5) 尾部 40 笔逐笔（看看临近买点的形态）
console.log('== 尾部 40 笔 ==');
for (const t of ticks.slice(-40)) {
  console.log(`${t.block_time} blk=${t.block_number} ${t.trade_type.toUpperCase()} ${fmt(t.bnb_amount)}B px=${Number(t.price_usd).toPrecision(4)} w=${wallet(t).slice(0, 10)}`);
}
process.exit(0);
