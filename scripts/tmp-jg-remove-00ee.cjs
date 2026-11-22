#!/usr/bin/env node
/**
 * 一次性脚本（本地小结果读取）：金狗集合 a8414632 移除 0x00ee…7777
 * 用户裁定 2026-11-21：前期行为太怪异，没办法参与。
 * 前置核查：成员在位 + 无运行中实验引用该集合；删除走 case_collection_tokens 单行
 * （级联删该票 case_ticks/case_events 副本——集合内副本，不动 wss_price_ticks 全局行）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0x00ee613ddfef429b892aa122c8a4fde764f47777';
const DRY = process.argv.includes('--dry');

async function main() {
  const c = dbManager.getClient();

  // 1. 集合与成员在位核查
  const { data: col } = await c.from('case_collections')
    .select('id, name').eq('id', COLLECTION_ID).single();
  if (!col) throw new Error('集合不存在: ' + COLLECTION_ID);
  console.log(`集合: ${col.name} (${col.id})`);

  const { data: member, error: mErr } = await c.from('case_collection_tokens')
    .select('token_address, platform, sync_state, tick_count, event_count, note, token_meta')
    .eq('collection_id', COLLECTION_ID).eq('token_address', ADDR).maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!member) {
    console.log('成员不存在（可能已移除），无操作。');
    return { removed: false };
  }
  const meta = member.token_meta || {};
  console.log(`成员在位: ${meta.symbol || '?'} platform=${member.platform} sync_state=${member.sync_state} ticks=${member.tick_count} events=${member.event_count}`);
  if (member.note) console.log(`原 note: ${member.note}`);

  // 2. 运行中实验引用核查（回测含未 synced 成员拒启；运行中移除成员会让后续重启装载少票）
  const { data: running } = await c.from('experiments')
    .select('id, name, status')
    .eq('status', 'running')
    .contains('config', { backtest: { caseCollectionId: COLLECTION_ID } });
  if (running && running.length) {
    console.log('⚠ 有运行中实验引用该集合，先停再移除:', JSON.stringify(running));
    throw new Error('运行中实验在引用集合，中止');
  }
  console.log('运行中引用: 无');

  // 3. 剩余成员数（移除后）
  const { count: remain } = await c.from('case_collection_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', COLLECTION_ID);
  console.log(`当前成员数: ${remain} → 移除后 ${remain - 1}`);

  if (DRY) { console.log('[dry] 到此为止，未删除。'); return { removed: false, dry: true }; }

  // 4. 单行删除（服务端级联 ticks+events 副本）
  const { error: delErr } = await c.from('case_collection_tokens')
    .delete().eq('collection_id', COLLECTION_ID).eq('token_address', ADDR);
  if (delErr) throw new Error(delErr.message);

  // 5. 复核
  const { data: after } = await c.from('case_collection_tokens')
    .select('token_address').eq('collection_id', COLLECTION_ID).eq('token_address', ADDR).maybeSingle();
  const { count: remainAfter } = await c.from('case_collection_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', COLLECTION_ID);
  console.log(`已删除。残留行: ${after ? '有(异常!)' : '无'}；成员数 ${remain} → ${remainAfter}`);
  console.log(`移除规模: ticks=${member.tick_count} events=${member.event_count}（集合内副本；wss_price_ticks/wss_events 全局行不受影响）`);
  return { removed: true };
}

main().then(r => { process.exit(0); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
