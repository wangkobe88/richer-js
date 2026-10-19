#!/usr/bin/env node
/** 排查:0xd839…7777 与跟单钱包 0x550647…4653——轻量数据拉取(单 token 小结果,本地 OK) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xd839e94b5bfd9f5ea69e2199c4ecf86f2fc7777';
const EXP = '18032923-d95b-4bf8-9600-71a5b92fef1f';
const WALLET = '0x550647e8faf10116f0367526080c1005809b4653';

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
    console.log(r.kind, r.block_time, JSON.stringify({ name: p.name, symbol: p.symbol, creator: p.creator || p.token_creator }));
  }

  // 2. 实验 legs(copy 门写法)
  const { data: exp } = await db.from('experiments')
    .select('id, experiment_name, platform, status, config')
    .eq('id', EXP)
    .single();
  if (exp) {
    console.log('\n=== experiment ===');
    console.log(exp.experiment_name, exp.platform, exp.status);
    const legs = (exp.config && exp.config.strategiesConfig && exp.config.strategiesConfig.legs) || [];
    for (const l of legs) {
      console.log(`[${l.side}] name=${l.name}`);
      console.log('  trigger:', l.narrativeTriggerCondition || '(none)');
      console.log('  condition:', l.condition);
      console.log('  gmgn:', l.gmgnCheckCondition || '(none)');
    }
  }

  // 3. 信号(重点 copy 族因子)
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
    for (const k of ['executionReason', 'narrativeRoundsSummary', 'gmgnCheck', 'triggerConditionPassed']) {
      if (md[k] !== undefined) keep[k] = md[k];
    }
    console.log('  md:', JSON.stringify(keep).slice(0, 1500));
    const fa = md.factorResults || md.factors;
    if (fa) {
      const pick = {};
      for (const k of Object.keys(fa)) {
        if (/copy|famous|narrativeRating|buyVolumeBnb|marketCap|holderCount|currentPrice/i.test(k)) pick[k] = fa[k];
      }
      console.log('  factors(pick):', JSON.stringify(pick));
    }
  }

  // 4. trades
  const { data: tr } = await db.from('trades')
    .select('id, side, status, trade_time, token_amount, bnb_amount, price_bnb, profit_percent, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('trade_time', { ascending: true });
  console.log('\n=== trades ===', (tr || []).length, 'rows');
  for (const t of tr || []) {
    console.log(t.side, t.status, t.trade_time, `token=${t.token_amount} bnb=${t.bnb_amount} px=${t.price_bnb} pnl%=${t.profit_percent}`);
  }

  // 5. 目标钱包在本盘的买卖行为
  const { count } = await db.from('wss_price_ticks')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', TOKEN)
    .or(`sender_address.eq.${WALLET},trader_address.eq.${WALLET}`);
  console.log('\n=== wallet ticks count ===', count);
  if (count > 0 && count <= 200) {
    const { data: wt } = await db.from('wss_price_ticks')
      .select('block_time, event_type, sender_address, trader_address, token_amount, bnb_amount, price_bnb')
      .eq('token_address', TOKEN)
      .or(`sender_address.eq.${WALLET},trader_address.eq.${WALLET}`)
      .order('block_time', { ascending: true })
      .limit(200);
    let netToken = 0, buyBnb = 0;
    for (const r of wt || []) {
      const isBuy = Number(r.token_amount) > 0;
      netToken += Number(r.token_amount);
      if (isBuy) buyBnb += Number(r.bnb_amount);
      console.log(r.block_time, isBuy ? 'BUY ' : 'SELL', `token=${r.token_amount} bnb=${r.bnb_amount} sender=${(r.sender_address || '').slice(0, 10)} trader=${(r.trader_address || '').slice(0, 10)}`);
    }
    console.log(`netToken=${netToken} buyBnb=${buyBnb}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
