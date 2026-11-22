'use strict';
// 0xfc23 一姐：两笔信号完整门链 metadata + 15:41~15:47 UTC ticks 盘面
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const sg = md.signalGate || {};
    console.log(`\n===== ${s.created_at} leg=${sg.legId} trigger=${sg.trigger}/${sg.maxTriggers} =====`);
    for (const k of ['factorCheck', 'actFrontGate', 'cheatCheck', 'buyPoint', 'fpRetry']) {
      if (md[k]) console.log(`${k}: ${JSON.stringify(md[k]).slice(0, 500)}`);
    }
    if (sg.decision || sg.reason) console.log(`signalGate.decision=${sg.decision}/${sg.reason}`);
    const exec = md.execution || {};
    if (Object.keys(exec).length) console.log('execution:', JSON.stringify(exec).slice(0, 300));
  }
  // ticks 盘面（15:41~15:47 UTC 全窗，粗粒度 10s 聚合）
  const { data: ticks, error: tkErr } = await sb.from('wss_price_ticks')
    .select('block_time,price_usd,bnb_amount,price_outlier')
    .eq('token_address', TOKEN).gte('block_time', '2026-10-04T15:41:00Z').lte('block_time', '2026-10-04T15:47:00Z')
    .order('block_time', { ascending: true }).limit(1000);
  if (tkErr) throw new Error(tkErr.message);
  console.log(`\nticks 总数 ${(ticks || []).length}（含 outlier ${(ticks || []).filter(t => t.price_outlier).length}）`);
  const buckets = {};
  for (const t of (ticks || [])) {
    if (t.price_outlier) continue;
    const b = t.block_time.slice(11, 19);
    const sec = b.slice(0, 8);
    const key = sec.slice(0, 7) + '0'; // 10s 桶
    buckets[key] = buckets[key] || { n: 0, vol: 0, pFirst: t.price_usd, pLast: t.price_usd };
    buckets[key].n++; buckets[key].vol += Number(t.bnb_amount || 0); buckets[key].pLast = t.price_usd;
  }
  const keys = Object.keys(buckets).sort();
  let base = null;
  for (const k of keys) {
    const b = buckets[k];
    if (base === null && b.pFirst) base = b.pFirst;
    const chg = base ? ((b.pLast / base - 1) * 100).toFixed(1) : '-';
    console.log(`${k}  笔数=${String(b.n).padStart(3)} 量=${b.vol.toFixed(2)}B  价=${b.pLast ? b.pLast.toExponential(3) : 'null'}  vs窗首=${chg}%`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
