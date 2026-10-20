// 一次性查询：0xcfc3…7777 叙事分析落点（单票小结果读取）
const util = require('util');
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xcfc39a869380200949685d16197e93f100207777';

function dump(label, obj, depth = 6) {
  console.log(`\n=== ${label} ===`);
  console.log(util.inspect(obj, { depth, colors: false, maxArrayLength: 20, maxStringLength: 1200, breakLength: 140 }));
}

async function main() {
  const client = await dbManager.getClient();

  // 1. 叙事行
  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('id,token_address,token_symbol,platform,analyzed_at,created_at,is_valid,prompt_version,analysis_stage,prompt_type,token_category,pre_check_result,prestage_result,stage1_result,stage2_result,stage3_result,stage_final_result')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative: 无行（该 token 从未落叙事结果）');
  } else {
    const brief = { ...narr };
    console.log('\n=== token_narrative 概览 ===');
    const summary = {
      id: narr.id, symbol: narr.token_symbol, platform: narr.platform,
      analyzed_at: narr.analyzed_at, created_at: narr.created_at,
      is_valid: narr.is_valid, prompt_version: narr.prompt_version,
      analysis_stage: narr.analysis_stage, prompt_type: narr.prompt_type,
      token_category: narr.token_category,
    };
    console.log(JSON.stringify(summary, null, 1));
    dump('pre_check_result', narr.pre_check_result);
    dump('prestage_result', narr.prestage_result);
    dump('stage1_result', narr.stage1_result);
    dump('stage2_result', narr.stage2_result);
    dump('stage3_result', narr.stage3_result);
    dump('stage_final_result', narr.stage_final_result);
  }

  // 2. 实验 token 行
  const { data: toks, error: e2 } = await client
    .from('experiment_tokens')
    .select('id,experiment_id,token_symbol,platform,created_at,raw_api_data')
    .eq('token_address', ADDR)
    .limit(10);
  if (e2) throw e2;
  console.log(`\n=== experiment_tokens: ${toks?.length ?? 0} 行 ===`);
  for (const t of toks || []) {
    const raw = t.raw_api_data || {};
    console.log(`exp=${t.experiment_id} sym=${t.token_symbol} platform=${t.platform} created=${t.created_at} raw.created_at=${raw.created_at} twitter=${raw.twitter_url || raw.twitterUrl || '-'} name=${raw.name || '-'}`);
  }

  // 3. wss_events token_create
  const { data: evs, error: e3 } = await client
    .from('wss_events')
    .select('id,kind,created_at,block_time,payload')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(10);
  if (e3) throw e3;
  console.log(`\n=== wss_events: ${evs?.length ?? 0} 行 ===`);
  for (const e of evs || []) console.log(`${e.kind} at=${e.created_at} blockTime=${e.block_time} payload.tx=${e.payload?.txHash || e.payload?.tx_hash || '-'} sender=${e.payload?.sender || '-'}`);

  // 4. 信号
  const { data: sigs, error: e4 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e4) throw e4;
  console.log(`\n=== strategy_signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} executed=${s.executed} at=${s.created_at} reason=${String(s.reason||'').slice(0,200)}`);
    if (md.narrativeCall) dump(`sig#${s.id} narrativeCall`, md.narrativeCall, 5);
    if (md.narrativeTrigger) dump(`sig#${s.id} narrativeTrigger`, md.narrativeTrigger, 5);
  }

  // 5. 交易
  const { data: trades, error: e5 } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e5) throw e5;
  console.log(`\n=== trades: ${trades?.length ?? 0} 行 ===`);
  for (const t of trades || []) console.log(`#${t.id} exp=${t.experiment_id} ${t.trade_type} amt=${t.amount_bnb} pnl%=${t.profit_percent} at=${t.created_at}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
