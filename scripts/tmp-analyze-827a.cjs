#!/usr/bin/env node
/** 作弊痕迹分析:0x827a…7777 为何没拦住——轻量数据拉取(单 token 小结果,本地 OK) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x827a36d2137fc0e10ec73ee2ec22d4d5ba4e7777';
const EXP = 'cf92cbd3-6acc-4c08-959a-1001bd808d6c';

async function main() {
  const db = dbManager.getClient();

  // 1. token_create 事件
  const { data: ev } = await db.from('wss_events')
    .select('kind, block_time, payload')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true });
  console.log('=== wss_events ===');
  for (const r of ev || []) {
    const p = r.payload || {};
    console.log(r.kind, r.block_time, JSON.stringify({ name: p.name, symbol: p.symbol, creator: p.creator || p.token_creator, deployer: p.deployer }));
  }

  // 2. 实验 info(轻列)
  const { data: exp } = await db.from('experiments')
    .select('id, name, platform, status, config')
    .eq('id', EXP)
    .single();
  if (exp) {
    console.log('\n=== experiment ===');
    console.log(exp.name, exp.platform, exp.status);
    const legs = (exp.config && exp.config.strategiesConfig && exp.config.strategiesConfig.legs) || [];
    for (const l of legs) {
      console.log(`[${l.side}] name=${l.name}`);
      console.log('  trigger:', l.narrativeTriggerCondition || '(none)');
      console.log('  condition:', l.condition);
      console.log('  gmgn:', l.gmgnCheckCondition || '(none)');
      console.log('  preBuy:', l.preBuyCheckCondition || '(none)');
    }
  }

  // 3. 信号
  const { data: sigs } = await db.from('strategy_signals')
    .select('id, side, status, created_at, price, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  console.log('\n=== signals ===', (sigs || []).length, 'rows');
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`#${s.id.slice(0, 8)} ${s.side} ${s.status} ${s.created_at} price=${s.price}`);
    const keep = {};
    for (const k of ['narrativeRoundsSummary', 'gmgnCheck', 'narrativeCall', 'executionReason', 'preBuyCheckFactors', 'triggerConditionPassed']) {
      if (md[k] !== undefined) keep[k] = md[k];
    }
    console.log('  md:', JSON.stringify(keep).slice(0, 3000));
    const fa = md.factorResults || md.factors;
    if (fa) console.log('  factors:', JSON.stringify(fa).slice(0, 3000));
  }

  // 4. 叙事轮次
  const { data: rounds } = await db.from('narrative_analysis_rounds')
    .select('round_no, reason, status, started_at, completed_at, rating')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('round_no', { ascending: true });
  console.log('\n=== narrative rounds ===');
  console.log(JSON.stringify(rounds, null, 1).slice(0, 2000));

  // 5. token_narrative
  const { data: tn } = await db.from('token_narrative')
    .select('numeric_rating, final_rating, pre_check_result, prestage, stage1, raw_api_data, updated_at')
    .eq('token_address', TOKEN)
    .maybeSingle();
  console.log('\n=== token_narrative ===');
  if (tn) {
    console.log('rating:', tn.numeric_rating, 'final:', tn.final_rating, 'precheck:', tn.pre_check_result, 'updated:', tn.updated_at);
    console.log('prestage:', JSON.stringify(tn.prestage).slice(0, 500));
    const s1 = tn.stage1 || {};
    console.log('stage1 keys:', Object.keys(s1).join(','));
    console.log('stage1.jev:', JSON.stringify(s1.jev).slice(0, 2500));
    const raw = tn.raw_api_data || {};
    console.log('raw.name/symbol:', raw.name, raw.symbol, 'created_at:', raw.created_at);
    console.log('raw.urls:', JSON.stringify(raw.urls || raw.classified_urls || '').slice(0, 800));
  } else console.log('(none)');

  // 6. trades
  const { data: trades } = await db.from('trades')
    .select('direction, amount_bnb, price, profit_percent, status, executed_at, tx_hash, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('executed_at', { ascending: true });
  console.log('\n=== trades ===');
  for (const t of trades || []) {
    console.log(t.direction, 'bnb=', t.amount_bnb, 'price=', t.price, 'pnl%=', t.profit_percent, t.status, t.executed_at, (t.tx_hash || '').slice(0, 12));
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
