require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0x4509204c4f82dee14352bf7cfafae4138b287777';

async function main() {
  const sb = dbManager.getClient();

  // 1) 信号全列（重点 SELL 行 metadata）
  const { data: sigs, error: e1 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (e1) throw new Error(JSON.stringify(e1));
  console.log('### signals:', sigs.length);
  for (const row of sigs) {
    const md = row.metadata || {};
    const sg = md.signalGate || {};
    console.log(`\n--- ${row.created_at} ${row.signal_type} ${row.action} ${row.execution_status} reason=${row.reason || ''} price=${row.price}`);
    if (Object.keys(sg).length) console.log('signalGate:', JSON.stringify({ legId: sg.legId, legName: sg.legName, triggerNo: sg.triggerNo }));
    if (md.stallClose) console.log('stallClose:', JSON.stringify(md.stallClose));
    if (md.burstCooldownInfo) console.log('burstCooldownInfo:', JSON.stringify(md.burstCooldownInfo));
    if (md.strategy) console.log('strategy:', JSON.stringify(md.strategy).slice(0, 300));
    if (md.factorResults) {
      const fr = md.factorResults;
      console.log('factor@sig:', JSON.stringify({
        tradeCount: fr.tradeCount, buyVolumeBnb: fr.buyVolumeBnb, tokenAgeSec: fr.tokenAgeSec,
        currentVsLaunchPct: fr.currentVsLaunchPct, actTotalBnb: fr.actTotalBnb, priceBnb: fr.currentPriceBnb
      }));
    }
  }

  // 2) 成交
  const { data: trades, error: e2 } = await sb.from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('executed_at', { ascending: true })
    .limit(20);
  if (e2) throw new Error(JSON.stringify(e2));
  console.log('\n### trades:', trades.length);
  for (const t of trades) {
    console.log(`${t.executed_at || t.created_at} ${t.trade_type || t.side} qty=${t.token_amount} bnb=${t.bnb_amount} price=${t.price_bnb || t.price} profit=${t.profit_amount !== undefined ? t.profit_amount : ''}`, JSON.stringify(t.metadata || {}).slice(0, 200));
  }

  // 3) 实验配置 stallClose / burstCooldown
  const { data: exp, error: e3 } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,config')
    .eq('id', EXP)
    .limit(1);
  if (e3) throw new Error(JSON.stringify(e3));
  const cfg = (exp[0] && exp[0].config) || {};
  console.log('\n### experiment:', exp[0] && exp[0].name, exp[0] && exp[0].trading_mode);
  console.log('stallClose:', JSON.stringify((cfg.positionManagement || {}).stallClose || cfg.stallClose || null));
  console.log('burstCooldown:', JSON.stringify((cfg.positionManagement || {}).burstCooldown || cfg.burstCooldown || null));
  const ws = cfg.fourmemeWs || cfg.flapWs || {};
  console.log('platform:', exp[0] && (exp[0].config || {}).platform);

  // 4) 出生锚
  const { data: ev, error: e4 } = await sb.from('wss_events')
    .select('block_time,payload')
    .eq('token_address', TOKEN)
    .eq('kind', 'token_create')
    .limit(2);
  if (e4) throw new Error(JSON.stringify(e4));
  const created = ev[0] ? ev[0].block_time : null;
  console.log('\n### token_create:', created, ev[0] ? JSON.stringify(ev[0].payload || {}).slice(0, 200) : '');

  // 5) 全生命周期 ticks（keyset 分页，单票小结果）
  const rows = [];
  let cur = null;
  for (let i = 0; i < 8; i++) {
    let q = sb.from('wss_price_ticks')
      .select('id,block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address,block_number')
      .eq('token_address', TOKEN)
      .order('id', { ascending: true })
      .limit(1000);
    if (cur) q = q.gt('id', cur);
    const { data, error } = await q;
    if (error) throw new Error(JSON.stringify(error));
    rows.push(...data);
    if (data.length < 1000) break;
    cur = data[data.length - 1].id;
  }
  console.log('\n### ticks total:', rows.length);
  const t0 = created ? new Date(created).getTime() : new Date(rows[0].block_time).getTime();
  let lastTs = null;
  for (const t of rows) {
    const ts = new Date(t.block_time).getTime();
    const gap = lastTs ? ((ts - lastTs) / 1000).toFixed(1) : '-';
    const w = (t.sender_address || t.trader_address || '').slice(0, 8);
    const age = ((ts - t0) / 1000).toFixed(0);
    console.log(`${t.block_time} age=${age}s gap=${gap}s ${t.trade_type === 'sell' ? 'S' : 'B'} ${Number(t.bnb_amount).toFixed(4)}B px=${Number(t.price_bnb).toExponential(3)} w=${w} blk=${t.block_number}`);
    lastTs = ts;
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
