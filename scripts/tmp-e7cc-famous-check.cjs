#!/usr/bin/env node
// 临时查证：e5941591 实验 + 0xe7cc…7777 信号 + famous 钱包 0xb2d1…851 行为
const { dbManager } = require('../src/services/dbManager');

const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';
const TOKEN = '0xe7ccf2a3d532542606d57fa29b7f4c0bbe677777';
const FAM = '0xb2d1af0746c410e146272e804b1741f07f83b851';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp, error: e1 } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,config').eq('id', EXP).limit(1);
  if (e1) throw new Error(e1.message);
  const x = exp && exp[0];
  if (!x) { console.log('experiment not found'); return; }
  const cfg = x.config || {};
  const fm = cfg.fourmemeWs || {};
  console.log(`=== 实验 ${EXP}`);
  console.log(`name=${x.name} mode=${x.trading_mode} status=${x.status}`);
  console.log(`platform=${cfg.platform} strategiesConfig keys=${Object.keys(cfg.strategiesConfig || {})}`);
  console.log(`buyPointCheck=${JSON.stringify(fm.buyPointCheck || null)}`);
  console.log(`cheatCheck.enabled=${fm.cheatCheck && fm.cheatCheck.enabled} factorCheck=${JSON.stringify((fm.buyPointCheck || {}).factorCheck || null)}`);
  console.log(`buySignalCooldownMs=${fm.buySignalCooldownMs} maxPerToken=${fm.buySignalMaxPerToken}`);

  // 信号
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(3);
  if (e2) throw new Error(e2.message);
  if (sigs && sigs[0]) {
    console.log(`signal columns: ${Object.keys(sigs[0]).join(',')}`);
    console.log(`metadata keys: ${Object.keys(sigs[0].metadata || {}).join(',')}`);
  }
  const { data: sigsAll, error: e2b } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(50);
  if (e2b) throw new Error(e2b.message);
  console.log(`\n=== 信号 ${sigsAll.length} 条`);
  for (const s of sigsAll) {
    const md = s.metadata || {};
    console.log(`- [${s.created_at}] type=${s.signal_type} strat=${s.strategy_name || s.strategyId || '-'} reason=${s.reason}`);
    const fc = md.factorCheck;
    if (fc) console.log(`  factorCheck: status=${fc.status} pass=${fc.pass} reason=${fc.reason} v=${fc.version || '-'}`);
    const cc = md.cheatCheck;
    if (cc) console.log(`  cheatCheck: ${JSON.stringify(cc).slice(0, 200)}`);
    const bp = md.buyPoint;
    if (bp) console.log(`  buyPoint: ${JSON.stringify(bp).slice(0, 200)}`);
  }

  // famous 钱包在该 token 的行
  const { data: famRows, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
    .eq('token_address', TOKEN)
    .or(`sender_address.eq.${FAM},trader_address.eq.${FAM}`)
    .order('block_time', { ascending: true }).limit(400);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== famous 钱包 ${FAM} 行数=${famRows.length}`);
  for (const r of famRows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    console.log(`  [${r.block_time}] blk=${r.block_number}/${r.log_index} ${r.trade_type} ${r.bnb_amount} price=${r.price_bnb} via=${w === FAM ? 'sender' : 'trader'} outlier=${r.price_outlier}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
