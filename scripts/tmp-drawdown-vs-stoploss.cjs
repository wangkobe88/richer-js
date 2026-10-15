#!/usr/bin/env node
/** 临时诊断（本地单条点查）：0xc7fe…7777 为何走止损臂而非从高点回撤臂 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '203570e3-6117-4841-bc50-936461e78a8a';
const ADDR = '0xc7fece98502ffbbe3ad4944bb6bec19cf0687777';

async function main() {
  const db = dbManager.getClient();

  // 1. 实验配置（卖腿条件）
  const exp = await db.from('experiments').select('id,name,mode,platform,status,config').eq('id', EXP).limit(1);
  const e = (exp.data || [])[0] || {};
  console.log('=== 实验 ===');
  console.log(e.id, e.name, e.mode, e.platform, e.status);
  const legs = (e.config && e.config.strategiesConfig && e.config.strategiesConfig.legs) || (e.config && e.config.legs) || [];
  for (const l of legs) {
    if (l.side === 'sell') {
      console.log(JSON.stringify({
        name: l.name, side: l.side, condition: l.condition, bypassDebounce: l.bypassDebounce,
        maxExecutions: l.maxExecutions, cooldownSec: l.cooldownSec, cards: l.cards,
        sizing: l.sizing, stopLossPrice: l.stopLossPrice, stopLossTime: l.stopLossTime,
      }));
    }
  }
  const sl = e.config && e.config.stopLoss;
  console.log('engine stopLoss 段:', JSON.stringify(sl) || '(无)');

  // 2. 该 token 的 trades（本实验）
  const tr = await db.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', ADDR).order('executed_at').limit(50);
  console.log('\n=== trades ===');
  for (const t of tr.data || []) {
    console.log(JSON.stringify({
      side: t.side, status: t.status, executed_at: t.executed_at, bnb: t.bnb_amount,
      tokens: t.token_amount, price: t.price, price_bnb: t.price_bnb,
      reason: t.metadata && (t.metadata.reason || t.metadata.sellReason || t.metadata.legName),
      card: t.metadata && t.metadata.cardTrade,
    }));
  }

  // 3. 该 token 的 signals（本实验，含 fire 快照因子）
  const sg = await db.from('strategy_signals').select('id,side,status,created_at,price,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at').limit(100);
  console.log('\n=== signals ===');
  for (const s of sg.data || []) {
    const md = s.metadata || {};
    console.log(JSON.stringify({
      side: s.side, status: s.status, created_at: s.created_at, price: s.price,
      leg: md.legName, reason: md.reason || md.rejectedReason,
      profitPercent: md.profitPercent, peakProfitPct: md.peakProfitPct, drawdownPct: md.drawdownPct,
      tokenAgeSec: md.tokenAgeSec, factors: md.factors ? {
        profitPercent: md.factors.profitPercent, peakProfitPct: md.factors.peakProfitPct,
        drawdownPct: md.factors.drawdownPct, tokenAgeSec: md.factors.tokenAgeSec,
        currentPriceBnb: md.factors.currentPriceBnb, buyPriceBnb: md.factors.buyPriceBnb,
        highestPriceSinceBuyBnb: md.factors.highestPriceSinceBuyBnb,
      } : null,
    }));
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
