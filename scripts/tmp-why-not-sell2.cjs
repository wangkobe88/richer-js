#!/usr/bin/env node
/** 临时诊断 2：实验 203570e3 详情 + trades 原始行 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x8ff900181e50ed68926dada17f6d6650fe1e7777';

async function main() {
  const db = dbManager.getClient();

  // 1. 该实验完整行
  const exp = await db.from('experiments').select('*').eq('id', '203570e3-0000-0000-0000-000000000000'.replace(/-0000-0000-0000-000000000000$/, '')) // 先试短名会失败，改用 like
    .like('id', '203570e3%').limit(3);
  console.log('=== 实验 203570e3 ===');
  for (const e of exp.data || []) {
    console.log(JSON.stringify({
      id: e.id, name: e.name, status: e.status, mode: e.mode, platform: e.platform,
      started_at: e.started_at, stopped_at: e.stopped_at, updated_at: e.updated_at,
    }, null, 1));
    const cfg = e.config || {};
    console.log('config keys:', Object.keys(cfg));
    console.log('策略腿数：', JSON.stringify((cfg.strategiesConfig || {}).legs || cfg.strategies || '见下'));
    const sc = cfg.strategiesConfig;
    if (sc) {
      const legs = sc.legs || sc.strategies || [];
      if (Array.isArray(legs)) {
        for (const l of legs) console.log('  leg:', JSON.stringify({ side: l.side, name: l.name, condition: (l.condition || '').slice(0, 300), bypass: l.bypass, maxExec: l.maxExecutions, cd: l.cooldownSec, cards: l.cards, stopLossP: l.stopLossPrice, stopLossT: l.stopLossTime }));
      } else {
        console.log('strategiesConfig:', JSON.stringify(sc).slice(0, 2000));
      }
    }
    console.log('stopLoss 段:', JSON.stringify(cfg.stopLoss));
    console.log('positionManagement:', JSON.stringify(cfg.positionManagement));
  }

  // 2. 最近 10 个实验（任意状态）
  const recent = await db.from('experiments').select('id,name,status,mode,platform,started_at,stopped_at').order('created_at', { ascending: false }).limit(10);
  console.log('\n=== 最近 10 实验 ===');
  for (const e of recent.data || []) console.log(e.id.slice(0, 8), e.status.padEnd(10), (e.mode || '?').padEnd(8), e.platform || '?', e.started_at, '→', e.stopped_at || '…', e.name);

  // 3. trades 原始行（看真实列名）
  const tr = await db.from('trades').select('*').eq('token_address', ADDR).order('executed_at').limit(5);
  console.log('\n=== trades 原始行 ===');
  for (const t of tr.data || []) console.log(JSON.stringify(t).slice(0, 1500));

  // 4. 该实验下所有 trades（看整个实验的持仓/卖出全貌）
  if (exp.data && exp.data[0]) {
    const all = await db.from('trades').select('token_address,side,trade_type,status,executed_at,bnb_amount,token_amount,error_message').eq('experiment_id', exp.data[0].id).order('executed_at').limit(60);
    console.log('\n=== 该实验全部 trades ===');
    for (const t of all.data || []) console.log(t.executed_at, (t.side || t.trade_type || '?'), (t.status || '?').slice(0, 20), t.token_address.slice(0, 10), 'bnb=', t.bnb_amount, t.error_message ? 'ERR:' + String(t.error_message).slice(0, 120) : '');
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
