#!/usr/bin/env node
/** review 0x76e8…7777（v22 实验 43381df7）——单 token 小结果,本地 OK */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x76e85a190587d0a600179b60a4236211c61b7777';
const EXP = '43381df7-9bc4-4937-9f88-2bb3dbca372c';

async function main() {
  const db = dbManager.getClient();

  // 1. token_create / graduation 事件
  const { data: ev } = await db.from('wss_events')
    .select('kind, block_time, payload')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true });
  console.log('=== wss_events ===');
  for (const r of ev || []) {
    const p = r.payload || {};
    console.log(r.kind, r.block_time, JSON.stringify({ name: p.name, symbol: p.symbol, creator: p.creator || p.token_creator }).slice(0, 300));
  }

  // 2. 实验 legs（看门形状）
  const { data: exp } = await db.from('experiments')
    .select('id, name, platform, status, created_at')
    .eq('id', EXP)
    .single();
  if (exp) {
    console.log('\n=== experiment ===');
    console.log(exp.name, exp.platform, exp.status, 'created:', exp.created_at);
  }
  const { data: legs } = await db.from('strategy_library')
    .select('name, legs')
    .in('name', ['buy-v2', 'sell']);
  for (const l of legs || []) {
    for (const leg of l.legs || []) {
      console.log(`[lib:${l.name}] [${leg.side}] ${leg.name || ''}`);
      console.log('  trigger:', leg.narrativeTriggerCondition || '(none)');
      console.log('  condition:', (leg.condition || '').slice(0, 500));
      console.log('  gmgn:', leg.gmgnCheckCondition || '(none)');
    }
  }

  // 3. 信号 + metadata
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
    for (const k of ['narrativeRoundsSummary', 'gmgnCheck', 'narrativeCall', 'executionReason', 'triggerConditionPassed', 'stopLossType']) {
      if (md[k] !== undefined) keep[k] = md[k];
    }
    console.log('  md:', JSON.stringify(keep).slice(0, 2500));
    const fa = md.factorResults || md.factors;
    if (fa) console.log('  factors:', JSON.stringify(fa).slice(0, 4000));
  }

  // 4. 叙事轮次
  const { data: rounds } = await db.from('narrative_analysis_rounds')
    .select('round_no, reason, status, started_at, completed_at, rating')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('round_no', { ascending: true });
  console.log('\n=== narrative rounds ===');
  console.log(JSON.stringify(rounds).slice(0, 2000));

  // 5. token_narrative
  const { data: tn } = await db.from('token_narrative')
    .select('numeric_rating, final_rating, pre_check_result, token_category, prestage, stage1, raw_api_data, updated_at')
    .eq('token_address', TOKEN)
    .maybeSingle();
  console.log('\n=== token_narrative ===');
  if (tn) {
    console.log('rating:', tn.numeric_rating, 'final:', tn.final_rating, 'precheck:', tn.pre_check_result, 'category:', tn.token_category, 'updated:', tn.updated_at);
    console.log('prestage:', JSON.stringify(tn.prestage).slice(0, 400));
    const s1 = tn.stage1 || {};
    console.log('stage1 keys:', Object.keys(s1).join(','));
    console.log('stage1.jev:', JSON.stringify(s1.jev).slice(0, 3000));
    const raw = tn.raw_api_data || {};
    console.log('raw.name/symbol:', raw.name, raw.symbol, 'created_at:', raw.created_at);
    console.log('raw.urls:', JSON.stringify(raw.urls || raw.classified_urls || '').slice(0, 600));
  } else console.log('(none)');

  // 6. trades
  const { data: trades } = await db.from('trades')
    .select('direction, amount_bnb, token_amount, price, profit_percent, status, executed_at, tx_hash, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('executed_at', { ascending: true });
  console.log('\n=== trades ===');
  for (const t of trades || []) {
    console.log(t.direction, 'bnb=', t.amount_bnb, 'tok=', t.token_amount, 'price=', t.price, 'pnl%=', t.profit_percent, t.status, t.executed_at, (t.tx_hash || '').slice(0, 12));
    if (t.metadata) console.log('  tmd:', JSON.stringify(t.metadata).slice(0, 400));
  }

  // 7. ticks 概况：count + 价格轨迹 + 买卖钱包分布（对倒审查）
  const { count } = await db.from('wss_price_ticks')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', TOKEN);
  console.log('\n=== ticks count ===', count);

  const { data: ticks } = await db.from('wss_price_ticks')
    .select('block_time, price_bnb, bnb_amount, token_amount, sender_address, trader_address, is_buy, price_outlier, quote_token')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true })
    .limit(3000);
  console.log('fetched', (ticks || []).length, 'rows (cap 3000)');
  if (ticks && ticks.length) {
    const t0 = new Date(ticks[0].block_time).getTime();
    let peak = 0, peakT = 0;
    const buys = new Map(); // wallet -> {bnb, rows, firstT}
    const sellers = new Map();
    let buyBnb = 0, sellBnb = 0;
    for (const t of ticks) {
      const ts = new Date(t.block_time).getTime();
      const off = ((ts - t0) / 1000).toFixed(1);
      const p = Number(t.price_bnb) || 0;
      if (p > peak) { peak = p; peakT = off; }
      const w = t.sender_address || t.trader_address || '(null)';
      const bnb = Number(t.bnb_amount) || 0;
      if (t.is_buy) {
        buyBnb += bnb;
        const e = buys.get(w) || { bnb: 0, rows: 0, firstT: off, trader: t.trader_address };
        e.bnb += bnb; e.rows++; buys.set(w, e);
      } else {
        sellBnb += bnb;
        const e = sellers.get(w) || { bnb: 0, rows: 0, firstT: off };
        e.bnb += bnb; e.rows++; sellers.set(w, e);
      }
    }
    console.log('price first→peak→last:', ticks[0].price_bnb, '→', peak.toExponential(4), '@+' + peakT + 's →', ticks[ticks.length - 1].price_bnb);
    console.log('span:', ticks[0].block_time, '→', ticks[ticks.length - 1].block_time);
    console.log('buyBnb=', buyBnb.toFixed(4), 'sellBnb=', sellBnb.toFixed(4));
    console.log('\n-- top buyers (wallet: bnb, rows, firstOffs, trader) --');
    [...buys.entries()].sort((a, b) => b[1].bnb - a[1].bnb).slice(0, 12)
      .forEach(([w, e]) => console.log(w.slice(0, 10), e.bnb.toFixed(4), 'rows=' + e.rows, 't=' + e.firstT + 's', (e.trader || '').slice(0, 10)));
    console.log('-- top sellers --');
    [...sellers.entries()].sort((a, b) => b[1].bnb - a[1].bnb).slice(0, 8)
      .forEach(([w, e]) => console.log(w.slice(0, 10), e.bnb.toFixed(4), 'rows=' + e.rows, 't=' + e.firstT + 's'));
    console.log('\n-- first 40 ticks --');
    ticks.slice(0, 40).forEach((t, i) => {
      const ts = new Date(t.block_time).getTime();
      console.log(i, '+' + ((ts - t0) / 1000).toFixed(1) + 's', t.is_buy ? 'BUY' : 'SELL', 'bnb=' + (Number(t.bnb_amount) || 0).toFixed(4), 'price=' + t.price_bnb, (t.sender_address || 'null').slice(0, 10), (t.trader_address || '').slice(0, 10), t.price_outlier ? 'OUTLIER' : '');
    });
    console.log('-- last 15 ticks --');
    ticks.slice(-15).forEach((t, i) => {
      const ts = new Date(t.block_time).getTime();
      console.log(i, '+' + ((ts - t0) / 1000).toFixed(1) + 's', t.is_buy ? 'BUY' : 'SELL', 'bnb=' + (Number(t.bnb_amount) || 0).toFixed(4), 'price=' + t.price_bnb, (t.sender_address || 'null').slice(0, 10));
    });
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
