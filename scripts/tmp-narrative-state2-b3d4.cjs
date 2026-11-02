// b3d4 第三挖：trades（探列名）+ wss_events token_create + creator 对比蓝筹牛来 creator
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xb3d4d7faf25bec37960be028fbc40bf500957777';
const BLUECHIP = '0xbeea1d618e533a387d941f58a7d4c9b7bd377777';

(async () => {
  const db = dbManager.getClient();

  const { data: t0, error: e0 } = await db.from('trades').select('*').eq('token_address', ADDR).limit(1);
  if (e0) { console.log('trades err:', e0.message); }
  else if (t0.length) {
    console.log('=== trades 列名:', Object.keys(t0[0]).join(','));
    const { data: all } = await db.from('trades').select('*').eq('token_address', ADDR).order('id', { ascending: true }).limit(20);
    console.log('=== trades 行数:', all.length);
    for (const t of all) {
      const meta = t.metadata ? JSON.stringify(t.metadata).slice(0, 150) : '';
      console.log(`${t.side} qty=${t.quantity} bnb=${t.bnb_amount} pnl=${t.pnl} time=${t.created_at} exp=${String(t.experiment_id).slice(0, 8)} ${meta}`);
    }
  } else console.log('=== trades: 0 行');

  const { data: ev0, error: ev0e } = await db.from('wss_events').select('*').eq('token_address', ADDR).limit(1);
  if (ev0e) console.log('events err:', ev0e.message);
  else if (ev0.length) {
    console.log('\n=== wss_events 列名:', Object.keys(ev0[0]).join(','));
    const { data: evs } = await db.from('wss_events').select('*').eq('token_address', ADDR).limit(5);
    for (const e of evs) {
      const p = e.payload || {};
      console.log(`${e.kind}: creator=${p.creator} name=${p.name} symbol=${p.symbol} twitter=${p.twitterUrl ?? p.twitter ?? p.social} blockTime=${p.blockTime ?? e.created_at}`);
    }
  } else console.log('\n=== wss_events: 0 行（可能列名不同或未落）');

  // 蓝筹牛来的 creator（对比是否同人发币）
  const { data: blue, error: eb } = await db.from('wss_events').select('*').eq('token_address', BLUECHIP).limit(3);
  if (eb) console.log('bluechip events err:', eb.message);
  else {
    console.log('\n=== 蓝筹牛来 wss_events:', blue.length);
    for (const e of blue) {
      const p = e.payload || {};
      console.log(`${e.kind}: creator=${p.creator} time=${e.created_at}`);
    }
  }

  // raw_api_data 里自带 creator/txHash（叙事侧落档）——直接打出来
  const { data: tn } = await db.from('token_narrative').select('raw_api_data').eq('token_address', ADDR);
  const rad = tn[0]?.raw_api_data || {};
  console.log('\n=== b3d4 raw creator:', rad.creator, '| txHash:', rad.txHash, '| eventTs:', rad.eventTs, '| source:', rad.source);
  console.log('meta:', JSON.stringify(rad.meta).slice(0, 400));

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
