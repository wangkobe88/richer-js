// 一次性（182 跑）：c84a v100 六信号完整 metadata 结构+fire 时刻因子值（解开 curVs 矛盾）。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
async function main() {
  const sb = await dbManager.getClient();
  const { data: rows } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', V100).eq('token_address', T).order('created_at');
  for (const r of rows || []) {
    const m = r.metadata || {};
    const sg = m.signalGate || {};
    console.log(`\n===== ${r.created_at.slice(5, 19)} 腿=${sg.legId} =====`);
    console.log('signalGate keys:', Object.keys(sg).join(','));
    for (const k of ['condition', 'factors', 'factorResults', 'triggerFactors', 'legName', 'conditionPassed']) {
      if (sg[k] !== undefined) console.log(`  ${k}=${JSON.stringify(sg[k]).slice(0, 300)}`);
    }
    // 顶层因子快照
    for (const k of Object.keys(m)) {
      if (/factor|Factor/.test(k)) console.log(`  metadata.${k}=${JSON.stringify(m[k]).slice(0, 400)}`);
    }
  }
  // n=80~95 原始 tick 价（看 outlier/低值笔）
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,price_bnb')
    .eq('token_address', T).order('id', { ascending: true }).limit(95);
  (ticks || []).slice(78, 95).forEach((x, i) => console.log(`n=${79 + i} ${x.block_time.slice(11, 19)} ${x.trade_type} ${(x.bnb_amount || 0).toFixed(4)}B price=${x.price_bnb ? x.price_bnb.toExponential(3) : '-'}`));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
