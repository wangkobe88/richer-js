#!/usr/bin/env node
// 0xdf0e burst 定位：token_create + signals metadata burst 键 + 同块捆绑钱包
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const TOKEN = '0xdf0e577577a1a2df2a4728c7e238c964ae477777';
const EXP = 'd3453504-03d5-480c-89e0-483db930361c';
const lc = s => (s || '').toLowerCase();

async function main() {
  const sb = dbManager.getClient();
  const { data: ev } = await sb.from('wss_events').select('block_time,payload').eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  console.log(`token_create: ${ev?.[0]?.block_time} name=${ev?.[0]?.payload?.name}`);

  const { data: sig } = await sb.from('strategy_signals').select('created_at,signal_type,executed,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at').limit(10);
  console.log(`signals=${sig?.length || 0}`);
  for (const s of sig || []) {
    const m = s.metadata || {};
    const cc = m.cheatCheck || {}; const info = cc.info || {};
    const af = m.actFrontGate || {};
    const anchors = info.anchors || {};
    const bk = {}; for (const k of Object.keys(anchors)) if (/burst/i.test(k)) bk[k] = anchors[k];
    console.log(`\n${s.created_at} ${s.signal_type} exec=${s.executed} ${(s.reason || '').slice(0, 40)}`);
    console.log(`  actFront path=${af.path} sbw=${af.sbw}`);
    console.log(`  cheat=${info.status}/${info.grade} act=${info.levels?.activityLevel} sbw=${info.levels?.stallBurstWave}`);
    console.log(`  burst锚=${JSON.stringify(bk)}`);
    fs.writeFileSync(`/tmp/tmp-df0e-meta-${s.signal_type}-${s.created_at.slice(11, 19)}.json`, JSON.stringify(m, null, 1));
  }

  // ticks
  const want = ['id','block_time','block_number','log_index','trade_type','bnb_amount','price_bnb','sender_address','trader_address'].join(',');
  const rows = []; let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks').select(want).eq('token_address', TOKEN).gt('id', cursor).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id > cursor) cursor = r.id;
    if (data.length < 1000) break;
  }
  rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  console.log(`\nticks=${rows.length} 首=${rows[0]?.block_time} 末=${rows[rows.length - 1]?.block_time}`);
  fs.writeFileSync('/tmp/tmp-df0e-ticks.json', JSON.stringify(rows));
  const t0 = new Date(rows[0].block_time);
  for (const r of rows.slice(0, 60)) {
    const sec = (new Date(r.block_time) - t0) / 1000;
    const w = (lc(r.sender_address) || lc(r.trader_address) || '?').slice(0, 10);
    console.log(`t+${String(Math.round(sec)).padStart(5)}s blk=${r.block_number} ${r.trade_type} ${(+r.bnb_amount).toFixed(4)}B ${(r.price_bnb ?? 0).toExponential(3)} ${w}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
