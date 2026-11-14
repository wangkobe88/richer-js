// 一次性取证（182 跑）：v98 config 里 ladder 买腿条件原文（t0a/NL15/RL15 价格门验证）
// + ea78 09:59:55-10:18:55 tick 级价格（t0a 触发时刻实际 curVs）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';

async function main() {
  const client = await dbManager.getClient();
  const { data: exp } = await client.from('experiments').select('config').eq('id', V98).limit(1);
  const cfg = (exp && exp[0] && exp[0].config) || {};
  const sc = cfg.strategiesConfig || {};
  console.log('libraryRefs:', JSON.stringify(sc.libraryRefs || null).slice(0, 300));
  const legs = (sc.strategies && sc.strategies.buy) || (Array.isArray(sc.strategies) ? sc.strategies.filter((s) => s.side === 'buy') : []);
  console.log('买腿数:', legs.length);
  for (const [i, leg] of legs.slice(0, 14).entries()) {
    const cond = (leg.condition || '').replace(/\s+/g, ' ');
    console.log(`[${i}] p=${leg.priority} ${leg.name || ''} signalGate=${leg.signalGate ? JSON.stringify(leg.signalGate).slice(0, 60) : '-'}\n    cond=${cond.slice(0, 220)}`);
  }
  // ea78 触发时刻 tick 价
  const { data: ticks } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,trade_type,bnb_amount')
    .eq('token_address', '0xea7886d590ba1d7d6d4e7761148ba26405c67777')
    .gte('block_time', '2026-11-05T09:59:50').lt('block_time', '2026-11-05T10:19:10')
    .order('block_time', { ascending: true }).limit(20);
  console.log('\nea78 信号窗 ticks:');
  for (const t of (ticks || [])) {
    const curVs = ((t.price_bnb / 4496173469e-18 - 1) * 100).toFixed(1);
    console.log(`  ${t.block_time.slice(11, 19)} ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B curVs=${curVs}%`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
